'use server'

import { createClient } from '@/utils/supabase/server'
import { revalidatePath } from 'next/cache'
import type { Database, SessionStatus, UserRole } from '@/types/database'
import { SupabaseClient } from '@supabase/supabase-js'

type SessionInsert = Database['public']['Tables']['sessions']['Insert']
type GameRow = Database['public']['Tables']['games']['Row']
type GameInsert = Database['public']['Tables']['games']['Insert']

async function authorizeAdmin(supabase: SupabaseClient<Database>) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { authorized: false, error: "Not authenticated" }
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single<{ role: UserRole }>()

  if (profileError || !profile || profile.role !== 'admin') {
    return { authorized: false, error: "Unauthorized: Admin access required" }
  }
  
  return { authorized: true, user, role: profile.role }
}

export async function createSession(_prevState: unknown, formData: FormData) {
  const supabase = await createClient()
  const authResult = await authorizeAdmin(supabase)
  if (!authResult.authorized) return { error: authResult.error }

  const name = formData.get('name') as string
  const notes = formData.get('notes') as string
  const is_test_session = formData.get('is_test_session') === 'on'

  if (!name) return { error: 'Session name is required' }

  const newSession: SessionInsert = {
    name,
    notes,
    is_test_session,
    created_by: authResult.user!.id,
    status: 'draft',
  }

  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore - Supabase types fail to infer with local Database definition
  const { error } = await supabase
    .from('sessions')
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    .insert<SessionInsert>(newSession)

  if (error) {
    return { error: error.message }
  }

  revalidatePath('/admin')
  return { success: true, redirectTo: '/admin' }
}

export async function deleteSession(sessionId: string) {
  const supabase = await createClient()
  const authResult = await authorizeAdmin(supabase)
  if (!authResult.authorized) return { error: authResult.error }

  // Check if session is running
  const { data: session } = await supabase
    .from('sessions')
    .select('status')
    .eq('id', sessionId)
    .single<{ status: SessionStatus }>()

  if (session?.status === 'running') {
    return { error: "Cannot delete a running session. Please end the session first." }
  }

  const { error } = await supabase
    .from('sessions')
    .delete()
    .eq('id', sessionId)

  if (error) {
    return { error: error.message }
  }

  revalidatePath('/admin')
  return { success: true, redirectTo: '/admin' }
}

export async function duplicateSession(sessionId: string) {
  const supabase = await createClient()
  const authResult = await authorizeAdmin(supabase)
  if (!authResult.authorized) return { error: authResult.error }

  // 1. Fetch original session
  const { data: originalSession, error: sessionError } = await supabase
    .from('sessions')
    .select('*')
    .eq('id', sessionId)
    .single<Database['public']['Tables']['sessions']['Row']>()

  if (sessionError || !originalSession) {
    return { error: "Session not found" }
  }

  // 2. Create new session
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore - Supabase types fail to infer with local Database definition
  const { data: newSessionData, error: createError } = await supabase
    .from('sessions')
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    .insert<SessionInsert>({
      name: `${originalSession.name} (Copy)`,
      start_date: new Date().toISOString().split('T')[0],
      notes: originalSession.notes,
      status: 'draft',
      is_test_session: originalSession.is_test_session,
      created_by: authResult.user!.id,
    } satisfies SessionInsert)
    .select()
    .single()

  const newSession = newSessionData as Database['public']['Tables']['sessions']['Row'] | null

  if (createError || !newSession) {
    return { error: createError?.message ?? 'Session not created' }
  }

  // 3. Fetch games from original session
  const { data: games } = await supabase
    .from('games')
    .select('*')
    .eq('session_id', sessionId)

  if (games && games.length > 0) {
    const newGames: GameInsert[] = games.map((g: GameRow) => ({
      session_id: newSession.id,
      game_index: g.game_index,
      name: g.name,
      type: g.type,
      stage_sequence: g.stage_sequence,
      background_colour: g.background_colour,
      prizes: g.prizes,
      notes: g.notes,
      snowball_pot_id: g.snowball_pot_id,
    }))

    const { error: gamesInsertError } = await supabase
      .from('games')
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      .insert(newGames)

    if (gamesInsertError) {
      return { error: "Session created but games failed to copy: " + gamesInsertError.message }
    }
  }

  revalidatePath('/admin')
  return { success: true, redirectTo: '/admin' }
}
