'use server'

import { createClient } from '@/utils/supabase/server'
import { revalidatePath } from 'next/cache'
import type { Database, GameType, WinStage, GameStatus, SessionStatus, UserRole } from '@/types/database'
import { SupabaseClient } from '@supabase/supabase-js'

type GameInsert = Database['public']['Tables']['games']['Insert']

const stageOrder: Record<WinStage, number> = {
  'Line': 1,
  'Two Lines': 2,
  'Full House': 3,
}

const sortStages = (stages: WinStage[]) => stages.sort((a, b) => stageOrder[a] - stageOrder[b])

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

export async function createGame(sessionId: string, _prevState: unknown, formData: FormData) {
  const supabase = await createClient()
  const authResult = await authorizeAdmin(supabase)
  if (!authResult.authorized) return { error: authResult.error }

  const name = formData.get('name') as string
  const type = formData.get('type') as GameType
  const game_index = Number.parseInt(formData.get('game_index') as string, 10)
  const background_colour = formData.get('background_colour') as string
  const notes = formData.get('notes') as string
  const snowball_pot_id = (formData.get('snowball_pot_id') as string) || null

  const selectedStages = formData.getAll('stages') as WinStage[]
  const stage_sequence: WinStage[] = selectedStages.length > 0
    ? sortStages([...selectedStages])
    : type === 'snowball'
      ? ['Full House']
      : ['Line', 'Two Lines', 'Full House']

  const prizes: Record<string, string> = {}
  stage_sequence.forEach((stage) => {
      const prize = formData.get(`prize_${stage}`) as string
      if (prize) prizes[stage] = prize
  })

  const newGame: GameInsert = {
    session_id: sessionId,
    name,
    game_index,
    type,
    background_colour,
    notes,
    stage_sequence,
    snowball_pot_id,
    prizes,
  }

  const { error } = await supabase
    .from('games')
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    .insert(newGame)

  if (error) {
    return { error: error.message }
  }

  revalidatePath(`/admin/sessions/${sessionId}`)
  return { success: true }
}

export async function updateGame(gameId: string, sessionId: string, _prevState: unknown, formData: FormData) {
  const supabase = await createClient()
  const authResult = await authorizeAdmin(supabase)
  if (!authResult.authorized) return { error: authResult.error }

  // 1. Fetch original game and session status
  const { data: originalGame, error: fetchGameError } = await supabase
    .from('games')
    .select('type, snowball_pot_id, stage_sequence')
    .eq('id', gameId)
    .single<Pick<Database['public']['Tables']['games']['Row'], 'type' | 'snowball_pot_id' | 'stage_sequence'>>()

  if (fetchGameError || !originalGame) {
    return { error: fetchGameError?.message || "Original game not found." }
  }

  const { data: session, error: fetchSessionError } = await supabase
    .from('sessions')
    .select('status')
    .eq('id', sessionId)
    .single<{ status: SessionStatus }>()

  if (fetchSessionError || !session) {
    return { error: fetchSessionError?.message || "Session not found." }
  }

  const name = formData.get('name') as string
  const background_colour = formData.get('background_colour') as string
  const notes = formData.get('notes') as string
  const type = formData.get('type') as GameType
  const snowball_pot_id = (formData.get('snowball_pot_id') as string) || null

  const selectedStages = formData.getAll('stages') as WinStage[]
  const stage_sequence: WinStage[] = selectedStages.length > 0
    ? sortStages([...selectedStages])
    : type === 'snowball'
      ? ['Full House']
      : ['Line', 'Two Lines', 'Full House']

  // 2. Enforce rules if session is running
  if (session.status === 'running') {
    if (type !== originalGame.type) {
      return { error: "Cannot change game type while session is running." }
    }
    if (snowball_pot_id !== originalGame.snowball_pot_id) {
      return { error: "Cannot change snowball pot while session is running." }
    }
    // Compare stage_sequence as JSON strings or deep equality
    if (JSON.stringify(stage_sequence) !== JSON.stringify(originalGame.stage_sequence)) {
      return { error: "Cannot change stage sequence while session is running." }
    }
  }

  const prizes: Record<string, string> = {}
  stage_sequence.forEach((stage) => {
      const prize = formData.get(`prize_${stage}`) as string
      if (prize) prizes[stage] = prize
  })

  const { error } = await supabase
    .from('games')
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    .update({
      name,
      background_colour,
      notes,
      type, // Will be same as original if running
      snowball_pot_id, // Will be same as original if running
      stage_sequence, // Will be same as original if running
      prizes,
    })
    .eq('id', gameId)

  if (error) {
    return { error: error.message }
  }

  revalidatePath(`/admin/sessions/${sessionId}`)
  return { success: true }
}

export async function duplicateGame(gameId: string, sessionId: string) {
  const supabase = await createClient()
  const authResult = await authorizeAdmin(supabase)
  if (!authResult.authorized) return { error: authResult.error }

  // 1. Fetch the original game
  const { data: originalGame, error: fetchError } = await supabase
    .from('games')
    .select('*')
    .eq('id', gameId)
    .single<Database['public']['Tables']['games']['Row']>()

  if (fetchError || !originalGame) {
    return { error: "Original game not found" }
  }

  // 2. Determine new index (find max index in session + 1)
  const { data: games } = await supabase
    .from('games')
    .select('game_index')
    .eq('session_id', sessionId)

  const maxIndex = games?.reduce((max: number, g: { game_index: number }) => (g.game_index > max ? g.game_index : max), 0) || 0
  const newIndex = maxIndex + 1

  const newGame: GameInsert = {
    session_id: sessionId,
    game_index: newIndex,
    name: `${originalGame.name} (Copy)`,
    type: originalGame.type,
    stage_sequence: originalGame.stage_sequence,
    background_colour: originalGame.background_colour,
    prizes: originalGame.prizes,
    notes: originalGame.notes,
    snowball_pot_id: originalGame.snowball_pot_id,
  }

  const { error: insertError } = await supabase
    .from('games')
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    .insert(newGame)

  if (insertError) {
    return { error: insertError.message }
  }

  revalidatePath(`/admin/sessions/${sessionId}`)
  return { success: true }
}

export async function deleteGame(gameId: string, sessionId: string) {
  const supabase = await createClient()
  const authResult = await authorizeAdmin(supabase)
  if (!authResult.authorized) return { error: authResult.error }

  // Check if game is in progress
  const { data: gameState } = await supabase
    .from('game_states')
    .select('status')
    .eq('game_id', gameId)
    .single<{ status: GameStatus }>()

  if (gameState?.status === 'in_progress') {
    return { error: "Cannot delete a game that is currently in progress." }
  }

  const { error } = await supabase
    .from('games')
    .delete()
    .eq('id', gameId)

  if (error) {
    return { error: error.message }
  }

  revalidatePath(`/admin/sessions/${sessionId}`)
  return { success: true }
}

export async function updateSessionStatus(sessionId: string, status: 'ready' | 'running' | 'completed') {
  const supabase = await createClient()
  const authResult = await authorizeAdmin(supabase)
  if (!authResult.authorized) return { error: authResult.error }

  const { error } = await supabase
    .from('sessions')
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    .update({ status })
    .eq('id', sessionId)

  if (error) {
    return { error: error.message }
  }

  revalidatePath(`/admin/sessions/${sessionId}`)
  return { success: true }
}

export async function resetSession(sessionId: string) {
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
    return { error: "Cannot reset a running session. Please end the session first." }
  }

  // 1. Get all game IDs for this session to clean up game_states
  const { data: games } = await supabase
    .from('games')
    .select('id')
    .eq('session_id', sessionId)

  if (games && games.length > 0) {
      const gameIds = games.map((g: { id: string }) => g.id)

      // 2. Delete game_states
      const { error: deleteStatesError } = await supabase
        .from('game_states')
        .delete()
        .in('game_id', gameIds)

      if (deleteStatesError) {
          console.error("Error deleting game states:", deleteStatesError)
          return { error: "Failed to reset game states: " + deleteStatesError.message }
      }
  }

  // 3. Delete winners
  const { error: deleteWinnersError } = await supabase
    .from('winners')
    .delete()
    .eq('session_id', sessionId)

  if (deleteWinnersError) {
      console.error("Error deleting winners:", deleteWinnersError)
      return { error: "Failed to reset winners: " + deleteWinnersError.message }
  }

  // 4. Reset Session Status
  const { error: updateSessionError } = await supabase
    .from('sessions')
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    .update({ status: 'ready', active_game_id: null })
    .eq('id', sessionId)

  if (updateSessionError) {
      return { error: "Failed to update session status: " + updateSessionError.message }
  }

  revalidatePath(`/admin/sessions/${sessionId}`)
  return { success: true }
}
