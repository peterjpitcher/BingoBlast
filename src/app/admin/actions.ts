'use server'

import { createClient } from '@/utils/supabase/server'
import { revalidatePath } from 'next/cache'
import type { Database, SessionStatus, UserRole } from '@/types/database'
import type { ActionResult } from '@/types/actions'
import type { SupabaseClient, User } from '@supabase/supabase-js'

type SessionInsert = Database['public']['Tables']['sessions']['Insert']
type GameRow = Database['public']['Tables']['games']['Row']
type GameInsert = Database['public']['Tables']['games']['Insert']

type AdminAuthResult =
  | { authorized: false; error: string }
  | { authorized: true; user: User; role: UserRole }

async function authorizeAdmin(
  supabase: SupabaseClient<Database>
): Promise<AdminAuthResult> {
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

export async function createSession(_prevState: unknown, formData: FormData): Promise<ActionResult> {
  const supabase = await createClient()
  const authResult = await authorizeAdmin(supabase)
  if (!authResult.authorized) return { success: false, error: authResult.error }

  const name = formData.get('name') as string
  const notes = formData.get('notes') as string
  const is_test_session = formData.get('is_test_session') === 'on'

  if (!name) return { success: false, error: 'Session name is required' }

  const newSession: SessionInsert = {
    name,
    notes,
    is_test_session,
    created_by: authResult.user!.id,
    status: 'draft',
  }

  const { error } = await supabase
    .from('sessions')
    .insert(newSession)

  if (error) {
    return { success: false, error: error.message }
  }

  revalidatePath('/admin')
  return { success: true, redirectTo: '/admin' }
}

export async function deleteSession(sessionId: string): Promise<ActionResult> {
  const supabase = await createClient()
  const authResult = await authorizeAdmin(supabase)
  if (!authResult.authorized) return { success: false, error: authResult.error }

  // Check if session is running
  const { data: session } = await supabase
    .from('sessions')
    .select('status')
    .eq('id', sessionId)
    .single<{ status: SessionStatus }>()

  if (session?.status === 'running') {
    return { success: false, error: "Cannot delete a running session. Please end the session first." }
  }

  const { error } = await supabase
    .from('sessions')
    .delete()
    .eq('id', sessionId)

  if (error) {
    return { success: false, error: error.message }
  }

  revalidatePath('/admin')
  return { success: true, redirectTo: '/admin' }
}

export async function duplicateSession(sessionId: string): Promise<ActionResult> {
  const supabase = await createClient()
  const authResult = await authorizeAdmin(supabase)
  if (!authResult.authorized) return { success: false, error: authResult.error }

  // 1. Fetch original session
  const { data: originalSession, error: sessionError } = await supabase
    .from('sessions')
    .select('*')
    .eq('id', sessionId)
    .single<Database['public']['Tables']['sessions']['Row']>()

  if (sessionError || !originalSession) {
    return { success: false, error: "Session not found" }
  }

  // 2. Create new session
  const { data: newSessionData, error: createError } = await supabase
    .from('sessions')
    .insert({
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
    return { success: false, error: createError?.message ?? 'Session not created' }
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
      .insert(newGames)

    if (gamesInsertError) {
      return { success: false, error: "Session created but games failed to copy: " + gamesInsertError.message }
    }
  }

  revalidatePath('/admin')
  return { success: true, redirectTo: '/admin' }
}
