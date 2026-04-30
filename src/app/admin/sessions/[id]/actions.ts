'use server'

import { createClient } from '@/utils/supabase/server'
import { revalidatePath } from 'next/cache'
import type { Database, GameType, WinStage, GameStatus, UserRole } from '@/types/database'
import type { ActionResult } from '@/types/actions'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import { validateGamePrizes } from '@/lib/prize-validation'

type GameInsert = Database['public']['Tables']['games']['Insert']

type AdminAuthResult =
  | { authorized: false; error: string }
  | { authorized: true; user: User; role: UserRole }

const stageOrder: Record<WinStage, number> = {
  'Line': 1,
  'Two Lines': 2,
  'Full House': 3,
}

const sortStages = (stages: WinStage[]) => stages.sort((a, b) => stageOrder[a] - stageOrder[b])

const getDefaultStagesForType = (type: GameType): WinStage[] => {
  if (type === 'snowball' || type === 'jackpot') {
    return ['Full House'];
  }

  return ['Line', 'Two Lines', 'Full House'];
}

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

export async function createGame(sessionId: string, _prevState: unknown, formData: FormData): Promise<ActionResult> {
  const supabase = await createClient()
  const authResult = await authorizeAdmin(supabase)
  if (!authResult.authorized) return { success: false, error: authResult.error }

  const name = (formData.get('name') as string)?.trim()
  const type = formData.get('type') as GameType
  const game_index = Number.parseInt(formData.get('game_index') as string, 10)
  const background_colour = formData.get('background_colour') as string
  const notes = formData.get('notes') as string
  const snowball_pot_id = (formData.get('snowball_pot_id') as string) || null

  if (!name) {
    return { success: false, error: 'Game name is required.' }
  }

  if (!Number.isFinite(game_index) || game_index < 1) {
    return { success: false, error: 'Game order must be a positive number.' }
  }

  const selectedStages = formData.getAll('stages') as WinStage[]
  const stage_sequence: WinStage[] = type === 'snowball' || type === 'jackpot'
    ? ['Full House']
    : selectedStages.length > 0
      ? sortStages([...selectedStages])
      : getDefaultStagesForType(type)

  if (type === 'snowball' && !snowball_pot_id) {
    return { success: false, error: 'Snowball games must be linked to a snowball pot.' }
  }

  // Trim every prize before saving. Empty/whitespace-only values are dropped
  // so the validation helper sees a clean view.
  const prizes: Partial<Record<WinStage, string>> = {}
  stage_sequence.forEach((stage) => {
    const raw = formData.get(`prize_${stage}`)
    if (typeof raw === 'string') {
      const trimmed = raw.trim()
      if (trimmed.length > 0) prizes[stage] = trimmed
    }
  })

  const validation = validateGamePrizes({ type, stage_sequence, prizes })
  if (!validation.valid) {
    return {
      success: false,
      error: `${name}: prize required for ${validation.missingStages.join(', ')}`,
    }
  }

  const newGame: GameInsert = {
    session_id: sessionId,
    name,
    game_index,
    type,
    background_colour,
    notes,
    stage_sequence,
    snowball_pot_id: type === 'snowball' ? snowball_pot_id : null,
    prizes,
  }

  const { error } = await supabase
    .from('games')
    .insert(newGame)

  if (error) {
    return { success: false, error: error.message }
  }

  revalidatePath(`/admin/sessions/${sessionId}`)
  return { success: true }
}

export async function updateGame(gameId: string, sessionId: string, _prevState: unknown, formData: FormData): Promise<ActionResult> {
  const supabase = await createClient()
  const authResult = await authorizeAdmin(supabase)
  if (!authResult.authorized) return { success: false, error: authResult.error }

  // 1. Fetch original game and the per-game live status. The lock is
  // per-game (game_states.status), not session-level, so future not_started
  // games inside a running session remain editable.
  const { data: originalGame, error: fetchGameError } = await supabase
    .from('games')
    .select('type, snowball_pot_id, stage_sequence, prizes')
    .eq('id', gameId)
    .single<Pick<Database['public']['Tables']['games']['Row'], 'type' | 'snowball_pot_id' | 'stage_sequence' | 'prizes'>>()

  if (fetchGameError || !originalGame) {
    return { success: false, error: fetchGameError?.message || "Original game not found." }
  }

  const { data: gameStateRow, error: gameStateError } = await supabase
    .from('game_states')
    .select('status')
    .eq('game_id', gameId)
    .maybeSingle<{ status: GameStatus }>()

  if (gameStateError) {
    return { success: false, error: gameStateError.message }
  }

  const isLocked = gameStateRow ? gameStateRow.status !== 'not_started' : false

  const name = (formData.get('name') as string)?.trim()
  const game_index = Number.parseInt(formData.get('game_index') as string, 10)
  const background_colour = formData.get('background_colour') as string
  const notes = formData.get('notes') as string
  const type = formData.get('type') as GameType
  const snowball_pot_id = (formData.get('snowball_pot_id') as string) || null

  if (!name) {
    return { success: false, error: 'Game name is required.' }
  }

  if (!Number.isFinite(game_index) || game_index < 1) {
    return { success: false, error: 'Game order must be a positive number.' }
  }

  const selectedStages = formData.getAll('stages') as WinStage[]
  const stage_sequence: WinStage[] = type === 'snowball' || type === 'jackpot'
    ? ['Full House']
    : selectedStages.length > 0
      ? sortStages([...selectedStages])
      : getDefaultStagesForType(type)

  if (type === 'snowball' && !snowball_pot_id) {
    return { success: false, error: 'Snowball games must be linked to a snowball pot.' }
  }

  // Trim prizes before saving and validation.
  const prizes: Partial<Record<WinStage, string>> = {}
  stage_sequence.forEach((stage) => {
    const raw = formData.get(`prize_${stage}`)
    if (typeof raw === 'string') {
      const trimmed = raw.trim()
      if (trimmed.length > 0) prizes[stage] = trimmed
    }
  })

  // 2. If the game has already started, lock the structural and prize fields.
  // Reject any attempt to edit prizes, type, snowball_pot_id, or stage_sequence.
  if (isLocked) {
    const desiredSnowballPotId = type === 'snowball' ? snowball_pot_id : null
    const originalPrizes = (originalGame.prizes as Partial<Record<WinStage, string>> | null) ?? {}

    const lockedFields: string[] = []
    if (type !== originalGame.type) lockedFields.push('type')
    if (desiredSnowballPotId !== originalGame.snowball_pot_id) lockedFields.push('snowball_pot_id')
    if (JSON.stringify(stage_sequence) !== JSON.stringify(originalGame.stage_sequence)) {
      lockedFields.push('stage_sequence')
    }
    if (JSON.stringify(prizes) !== JSON.stringify(originalPrizes)) {
      lockedFields.push('prizes')
    }

    if (lockedFields.length > 0) {
      return {
        success: false,
        error: `Cannot edit ${lockedFields.join(', ')} on a started game`,
      }
    }
  }

  // 3. Validate prizes after the lock check (so the error message is the
  // lock message, not a missing-prize message, when both apply).
  const validation = validateGamePrizes({ type, stage_sequence, prizes })
  if (!validation.valid) {
    return {
      success: false,
      error: `${name}: prize required for ${validation.missingStages.join(', ')}`,
    }
  }

  const { data: updatedGame, error } = await supabase
    .from('games')
    .update({
      name,
      game_index,
      background_colour,
      notes,
      type,
      snowball_pot_id: type === 'snowball' ? snowball_pot_id : null,
      stage_sequence,
      prizes,
    })
    .eq('id', gameId)
    .select('id')
    .single<{ id: string }>()

  if (error) {
    return { success: false, error: error.message }
  }
  if (!updatedGame) {
    return { success: false, error: 'Game update did not apply.' }
  }

  revalidatePath(`/admin/sessions/${sessionId}`)
  return { success: true }
}

export async function duplicateGame(gameId: string, sessionId: string): Promise<ActionResult> {
  const supabase = await createClient()
  const authResult = await authorizeAdmin(supabase)
  if (!authResult.authorized) return { success: false, error: authResult.error }

  // 1. Fetch the original game
  const { data: originalGame, error: fetchError } = await supabase
    .from('games')
    .select('*')
    .eq('id', gameId)
    .single<Database['public']['Tables']['games']['Row']>()

  if (fetchError || !originalGame) {
    return { success: false, error: "Original game not found" }
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
    .insert(newGame)

  if (insertError) {
    return { success: false, error: insertError.message }
  }

  revalidatePath(`/admin/sessions/${sessionId}`)
  return { success: true }
}

export async function deleteGame(gameId: string, sessionId: string): Promise<ActionResult> {
  const supabase = await createClient()
  const authResult = await authorizeAdmin(supabase)
  if (!authResult.authorized) return { success: false, error: authResult.error }

  // Allow deletion only when the game has no state row, OR the state row is
  // 'not_started'. A missing row means the game has never been started.
  const { data: gameState, error: gameStateError } = await supabase
    .from('game_states')
    .select('status')
    .eq('game_id', gameId)
    .maybeSingle<{ status: GameStatus }>()

  if (gameStateError) {
    return { success: false, error: gameStateError.message }
  }

  if (gameState && gameState.status !== 'not_started') {
    return {
      success: false,
      error: `Cannot delete a game with status ${gameState.status}.`,
    }
  }

  // Reject deletion if the game has any recorded winners. This protects
  // historical results even when the live state has been reset.
  const { count: winnerCount, error: winnerCountError } = await supabase
    .from('winners')
    .select('id', { count: 'exact', head: true })
    .eq('game_id', gameId)

  if (winnerCountError) {
    return { success: false, error: winnerCountError.message }
  }

  if ((winnerCount ?? 0) > 0) {
    return { success: false, error: 'Cannot delete a game that has recorded winners.' }
  }

  const { error } = await supabase
    .from('games')
    .delete()
    .eq('id', gameId)

  if (error) {
    return { success: false, error: error.message }
  }

  revalidatePath(`/admin/sessions/${sessionId}`)
  return { success: true }
}

export async function updateSessionStatus(sessionId: string, status: 'ready' | 'running' | 'completed'): Promise<ActionResult> {
  const supabase = await createClient()
  const authResult = await authorizeAdmin(supabase)
  if (!authResult.authorized) return { success: false, error: authResult.error }

  const { error } = await supabase
    .from('sessions')
    .update({ status })
    .eq('id', sessionId)

  if (error) {
    return { success: false, error: error.message }
  }

  revalidatePath(`/admin/sessions/${sessionId}`)
  return { success: true }
}

export async function resetSession(sessionId: string, confirmationText: string): Promise<ActionResult> {
  const supabase = await createClient()
  const authResult = await authorizeAdmin(supabase)
  if (!authResult.authorized) return { success: false, error: authResult.error }

  // Read the session so we can validate the typed confirmation against the
  // session's name. Either 'RESET' or the session name is accepted.
  const { data: session, error: sessionError } = await supabase
    .from('sessions')
    .select('id, name')
    .eq('id', sessionId)
    .single<{ id: string; name: string }>()

  if (sessionError || !session) {
    return { success: false, error: sessionError?.message || 'Session not found.' }
  }

  const typed = (confirmationText ?? '').trim()
  if (typed !== 'RESET' && typed !== session.name) {
    return { success: false, error: 'Type RESET or the session name to confirm.' }
  }

  // 1. Get all game IDs for this session to clean up game_states
  const { data: games } = await supabase
    .from('games')
    .select('id')
    .eq('session_id', sessionId)

  if (games && games.length > 0) {
    const gameIds = games.map((g: { id: string }) => g.id)

    // 2. Delete game_states (idempotent: a missing row is fine).
    const { error: deleteStatesError } = await supabase
      .from('game_states')
      .delete()
      .in('game_id', gameIds)

    if (deleteStatesError) {
      return { success: false, error: "Failed to reset game states: " + deleteStatesError.message }
    }
  }

  // 3. Delete winners (idempotent).
  const { error: deleteWinnersError } = await supabase
    .from('winners')
    .delete()
    .eq('session_id', sessionId)

  if (deleteWinnersError) {
    return { success: false, error: "Failed to reset winners: " + deleteWinnersError.message }
  }

  // 4. Reset Session Status
  const { error: updateSessionError } = await supabase
    .from('sessions')
    .update({ status: 'ready', active_game_id: null })
    .eq('id', sessionId)

  if (updateSessionError) {
    return { success: false, error: "Failed to update session status: " + updateSessionError.message }
  }

  revalidatePath(`/admin/sessions/${sessionId}`)
  return { success: true }
}

export async function voidWinner(winnerId: string, voidReason: string): Promise<ActionResult> {
  const supabase = await createClient()
  const authResult = await authorizeAdmin(supabase)
  if (!authResult.authorized) return { success: false, error: authResult.error }

  if (!winnerId || winnerId.trim().length === 0) {
    return { success: false, error: 'Winner ID is required.' }
  }
  if (!voidReason || voidReason.trim().length === 0) {
    return { success: false, error: 'Void reason is required.' }
  }

  const { error } = await supabase
    .from('winners')
    .update({ is_void: true, void_reason: voidReason.trim() })
    .eq('id', winnerId)

  if (error) {
    return { success: false, error: error.message }
  }

  return { success: true }
}
