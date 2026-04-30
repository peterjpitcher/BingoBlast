'use server'

import { createClient } from '@/utils/supabase/server'
import { revalidatePath } from 'next/cache'
import { GameStatus, WinStage, UserRole } from '@/types/database'
import type { Database } from '@/types/database'
import type { ActionResult } from '@/types/actions'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import { formatPounds, isSnowballJackpotEligible } from '@/lib/snowball'
import { formatCashJackpotPrize, isCashJackpotGame, parseCashJackpotAmount } from '@/lib/jackpot'
import { getRequiredSelectionCountForStage } from '@/lib/win-stages'

type HostAuthResult =
  | { authorized: false; error: string }
  | { authorized: true; user: User; role: UserRole }

async function authorizeHost(
  supabase: SupabaseClient<Database>
): Promise<HostAuthResult> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { authorized: false, error: "Not authenticated" };
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single<{ role: UserRole }>();

  if (profileError || !profile || (profile.role !== 'admin' && profile.role !== 'host')) {
    return { authorized: false, error: "Unauthorized: Host or Admin access required" };
  }
  
  return { authorized: true, user, role: profile.role };
}

async function requireController(
  supabase: SupabaseClient<Database>,
  gameId: string
): Promise<HostAuthResult> {
  const authResult = await authorizeHost(supabase)
  if (!authResult.authorized) {
    return { authorized: false, error: authResult.error }
  }

  const { data: gameState, error: gameStateError } = await supabase
    .from('game_states')
    .select('controlling_host_id')
    .eq('game_id', gameId)
    .single<Pick<Database['public']['Tables']['game_states']['Row'], 'controlling_host_id'>>()

  if (gameStateError || !gameState) {
    return { authorized: false, error: gameStateError?.message || "Game state not found." }
  }

  if (!gameState.controlling_host_id || gameState.controlling_host_id !== authResult.user!.id) {
    return { authorized: false, error: "Another host is currently controlling this game." }
  }

  return { authorized: true, user: authResult.user!, role: authResult.role }
}

function getServiceRoleClient() {
    if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
        return createSupabaseClient<Database>(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY,
            {
                auth: {
                    autoRefreshToken: false,
                    persistSession: false
                }
            }
        );
    }
    return null;
}

// Helper to generate a shuffled 1-90 array
function generateShuffledNumberSequence(): number[] {
  const numbers = Array.from({ length: 90 }, (_, i) => i + 1);
  for (let i = numbers.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [numbers[i], numbers[j]] = [numbers[j], numbers[i]]; // Swap
  }
  return numbers;
}

// Shared Snowball Logic Helper
async function handleSnowballPotUpdate(supabase: SupabaseClient<Database>, sessionId: string, gameId: string): Promise<{ success: boolean; error?: string }> {
    // 1. Check session type
    const { data: session, error: sessionError } = await supabase
        .from('sessions')
        .select('is_test_session')
        .eq('id', sessionId)
        .single<Pick<Database['public']['Tables']['sessions']['Row'], 'is_test_session'>>();

    if (sessionError) {
        return { success: false, error: "Error checking session type for snowball logic: " + sessionError.message };
    }

    if (session?.is_test_session) {
         return { success: true };
    }

    // 2. Check game type
    const { data: gameData } = await supabase
        .from('games')
        .select('type, snowball_pot_id')
        .eq('id', gameId)
        .single<Pick<Database['public']['Tables']['games']['Row'], 'type' | 'snowball_pot_id'>>();

    if (gameData?.type !== 'snowball' || !gameData.snowball_pot_id) return { success: true };

    // 3. Check for jackpot winner
    const { count } = await supabase
        .from('winners')
        .select('*', { count: 'exact', head: true })
        .eq('game_id', gameId)
        .eq('is_snowball_jackpot', true);

    const jackpotWon = count !== null && count > 0;

    const { data: potData } = await supabase
        .from('snowball_pots')
        .select('*')
        .eq('id', gameData.snowball_pot_id)
        .single<Database['public']['Tables']['snowball_pots']['Row']>();

    if (!potData) return { success: true };

    if (jackpotWon) {
        const resetUpdate: Database['public']['Tables']['snowball_pots']['Update'] = {
            current_max_calls: potData.base_max_calls,
            current_jackpot_amount: potData.base_jackpot_amount,
            last_awarded_at: new Date().toISOString()
        };
        const { error: potError } = await supabase
          .from('snowball_pots')
          .update(resetUpdate)
          .eq('id', potData.id);

        if (potError) {
            return { success: false, error: "Failed to reset snowball pot: " + potError.message };
        } else {
            const jackpotHistory: Database['public']['Tables']['snowball_pot_history']['Insert'] = {
                snowball_pot_id: potData.id,
                change_type: 'jackpot_won',
                old_val_max: potData.current_max_calls,
                new_val_max: potData.base_max_calls,
                old_val_jackpot: potData.current_jackpot_amount,
                new_val_jackpot: potData.base_jackpot_amount,
            };
            await supabase.from('snowball_pot_history').insert(jackpotHistory);
        }
    } else {
        // Rollover
        const newMaxCalls = potData.current_max_calls + potData.calls_increment;
        const newJackpot = Number(potData.current_jackpot_amount) + Number(potData.jackpot_increment);

        const rolloverUpdate: Database['public']['Tables']['snowball_pots']['Update'] = {
            current_max_calls: newMaxCalls,
            current_jackpot_amount: newJackpot
        };
        const { error: potError } = await supabase
          .from('snowball_pots')
          .update(rolloverUpdate)
          .eq('id', potData.id);

        if (potError) {
            return { success: false, error: "Failed to rollover snowball pot: " + potError.message };
        } else {
            const rolloverHistory: Database['public']['Tables']['snowball_pot_history']['Insert'] = {
                snowball_pot_id: potData.id,
                change_type: 'rollover',
                old_val_max: potData.current_max_calls,
                new_val_max: newMaxCalls,
                old_val_jackpot: potData.current_jackpot_amount,
                new_val_jackpot: newJackpot,
            };
            await supabase.from('snowball_pot_history').insert(rolloverHistory);
        }
    }
    return { success: true };
}

async function maybeCompleteSession(supabase: SupabaseClient<Database>, sessionId: string) {
    const { data: games, error } = await supabase
        .from('games')
        .select('id')
        .eq('session_id', sessionId)

    if (error || !games || games.length === 0) return;

    const gameIds = games.map((g: { id: string }) => g.id);
    const { data: completedStates, error: completedStatesError } = await supabase
        .from('game_states')
        .select('game_id')
        .in('game_id', gameIds)
        .eq('status', 'completed');

    if (completedStatesError) return;

    const completedGameIds = new Set((completedStates || []).map((s: { game_id: string }) => s.game_id));
    const hasIncompleteGame = gameIds.some((id: string) => !completedGameIds.has(id));

    if (!hasIncompleteGame) {
        await supabase
            .from('sessions')
            .update({ status: 'completed', active_game_id: null })
            .eq('id', sessionId)
    }
}

export async function startGame(
  sessionId: string,
  gameId: string,
  cashJackpotAmountInput?: string
): Promise<ActionResult<{ requiresCashJackpotAmount?: boolean; gameName?: string }>> {
  try {
      const supabase = await createClient()
      const authResult = await authorizeHost(supabase)
      if (!authResult.authorized) return { success: false, error: authResult.error }

      const dbClient = getServiceRoleClient() || supabase;

      const { data: gameDetailsForStart, error: gameDetailsError } = await dbClient
        .from('games')
        .select('name, type, stage_sequence, prizes')
        .eq('id', gameId)
        .single<Pick<Database['public']['Tables']['games']['Row'], 'name' | 'type' | 'stage_sequence' | 'prizes'>>();

      if (gameDetailsError || !gameDetailsForStart) {
        return { success: false, error: gameDetailsError?.message || "Game not found." };
      }

      // 1. Check if game_state already exists
      const { data: existingGameState, error: fetchGameStateError } = await dbClient
        .from('game_states')
        .select('id, status, number_sequence, called_numbers, numbers_called_count, current_stage_index, controlling_host_id, controller_last_seen_at, call_delay_seconds')
        .eq('game_id', gameId)
        .single<Pick<Database['public']['Tables']['game_states']['Row'], 'id' | 'status' | 'number_sequence' | 'called_numbers' | 'numbers_called_count' | 'current_stage_index' | 'controlling_host_id' | 'controller_last_seen_at' | 'call_delay_seconds'>>()

      if (fetchGameStateError && fetchGameStateError.code !== 'PGRST116') {
        return { success: false, error: fetchGameStateError.message };
      }

      const isFirstStartAttempt = !existingGameState || existingGameState.status === 'not_started';
      const requiresCashJackpotAmount = isFirstStartAttempt && isCashJackpotGame(gameDetailsForStart.name, gameDetailsForStart.type);
      const providedCashJackpotAmount = cashJackpotAmountInput?.trim();

      if (requiresCashJackpotAmount && !providedCashJackpotAmount) {
        return { success: true, data: { requiresCashJackpotAmount: true, gameName: gameDetailsForStart.name } };
      }

      if (requiresCashJackpotAmount && providedCashJackpotAmount) {
        const parsedAmount = parseCashJackpotAmount(providedCashJackpotAmount);
        if (parsedAmount === null) {
          return { success: false, error: "Please enter a valid cash jackpot amount." };
        }

        const jackpotPrizeText = formatCashJackpotPrize(parsedAmount);
        const updatedPrizes = { ...(gameDetailsForStart.prizes || {}) };
        for (const stage of gameDetailsForStart.stage_sequence || []) {
          updatedPrizes[stage] = jackpotPrizeText;
        }

        const gamePrizeUpdate: Database['public']['Tables']['games']['Update'] = {
          prizes: updatedPrizes,
        };
        const { error: gamePrizeError } = await dbClient
          .from('games')
          .update(gamePrizeUpdate)
          .eq('id', gameId);

        if (gamePrizeError) {
          return { success: false, error: gamePrizeError.message };
        }
      }

      const nowIso = new Date().toISOString();
      const heartbeatThresholdMs = 30000;

      if (existingGameState?.status === 'in_progress') {
        const lastSeen = existingGameState.controller_last_seen_at
          ? new Date(existingGameState.controller_last_seen_at)
          : null;
        if (
          existingGameState.controlling_host_id &&
          existingGameState.controlling_host_id !== authResult.user!.id &&
          lastSeen &&
          (Date.now() - lastSeen.getTime() < heartbeatThresholdMs)
        ) {
          return { success: false, error: "Another host is currently controlling this game." };
        }

        const { error: updateError } = await dbClient
          .from('game_states')
          .update({
            controlling_host_id: authResult.user!.id,
            controller_last_seen_at: nowIso,
          } satisfies Database['public']['Tables']['game_states']['Update'])
          .eq('game_id', gameId)

        if (updateError) {
          return { success: false, error: updateError.message };
        }
      } else if (existingGameState?.status === 'completed') {
        const { error: updateError } = await dbClient
          .from('game_states')
          .update({
            status: 'in_progress',
            ended_at: null,
            paused_for_validation: false,
            display_win_type: null,
            display_win_text: null,
            display_winner_name: null,
            controlling_host_id: authResult.user!.id,
            controller_last_seen_at: nowIso,
          } satisfies Database['public']['Tables']['game_states']['Update'])
          .eq('game_id', gameId)

        if (updateError) {
          return { success: false, error: updateError.message };
        }
      } else {
        const sequence = existingGameState?.number_sequence ?? generateShuffledNumberSequence();
        const callDelaySeconds = existingGameState?.call_delay_seconds ?? 2;

        const freshState: Database['public']['Tables']['game_states']['Insert'] = {
          game_id: gameId,
          number_sequence: sequence,
          called_numbers: [],
          numbers_called_count: 0,
          current_stage_index: 0,
          status: 'in_progress',
          started_at: nowIso,
          ended_at: null,
          last_call_at: null,
          on_break: false,
          paused_for_validation: false,
          call_delay_seconds: callDelaySeconds,
          display_win_type: null,
          display_win_text: null,
          display_winner_name: null,
          controlling_host_id: authResult.user!.id,
          controller_last_seen_at: nowIso,
        };

        if (existingGameState) {
          const { error: updateError } = await dbClient
            .from('game_states')
            .update(freshState)
            .eq('game_id', gameId)

          if (updateError) {
            return { success: false, error: updateError.message };
          }
        } else {
          const { error: insertError } = await dbClient
            .from('game_states')
            .insert(freshState);

          if (insertError) {
            return { success: false, error: insertError.message };
          }
        }
      }

      // 4. Update session status to 'running' and set active_game_id
      const { data: session, error: fetchSessionError } = await dbClient
        .from('sessions')
        .select('status, active_game_id')
        .eq('id', sessionId)
        .single<Pick<Database['public']['Tables']['sessions']['Row'], 'status' | 'active_game_id'>>()

      if (fetchSessionError || !session) {
        return { success: false, error: fetchSessionError?.message || "Session not found" };
      }

      if (session.status !== 'running' || session.active_game_id !== gameId) {
        const sessionUpdate: Database['public']['Tables']['sessions']['Update'] = {
          status: 'running',
          active_game_id: gameId,
        };
        const { error: updateSessionError } = await dbClient
          .from('sessions')
          .update(sessionUpdate)
          .eq('id', sessionId)
        
        if (updateSessionError) {
          return { success: false, error: updateSessionError.message };
        }
      }

      revalidatePath(`/host`);
      revalidatePath(`/host/${sessionId}/${gameId}`);

  } catch (e) {
      return { success: false, error: "Server Error: " + (e instanceof Error ? e.message : String(e)) };
  }

  return { success: true, redirectTo: `/host/${sessionId}/${gameId}` };
}

export async function takeControl(gameId: string): Promise<ActionResult> {
    const supabase = await createClient();
    const authResult = await authorizeHost(supabase);
    if (!authResult.authorized) return { success: false, error: authResult.error };

    // Check current controller
    const { data: currentState, error: fetchError } = await supabase
        .from('game_states')
        .select('controlling_host_id, controller_last_seen_at')
        .eq('game_id', gameId)
        .single<Pick<Database['public']['Tables']['game_states']['Row'], 'controlling_host_id' | 'controller_last_seen_at'>>();

    if (fetchError) return { success: false, error: fetchError.message };

    const now = new Date();
    const lastSeen = currentState?.controller_last_seen_at ? new Date(currentState.controller_last_seen_at) : null;
    const heartbeatThresholdMs = 30000; // 30 seconds

    // If someone else is controlling AND they have been seen recently
    if (currentState?.controlling_host_id && 
        currentState.controlling_host_id !== authResult.user!.id && 
        lastSeen && 
        (now.getTime() - lastSeen.getTime() < heartbeatThresholdMs)) {
            return { success: false, error: "Another host is currently controlling this game." };
    }

    // Take control
    const controlUpdate: Database['public']['Tables']['game_states']['Update'] = {
        controlling_host_id: authResult.user!.id,
        controller_last_seen_at: now.toISOString()
    };
    const { error: updateError } = await supabase
        .from('game_states')
        .update(controlUpdate)
        .eq('game_id', gameId);

    if (updateError) return { success: false, error: updateError.message };

    revalidatePath(`/host/${gameId}`);
    return { success: true };
}

export async function sendHeartbeat(gameId: string): Promise<ActionResult> {
    const supabase = await createClient();
    const controlResult = await requireController(supabase, gameId)
    if (!controlResult.authorized) return { success: false, error: controlResult.error }

    const heartbeatUpdate: Database['public']['Tables']['game_states']['Update'] = {
        controller_last_seen_at: new Date().toISOString()
    };
    const { error } = await supabase
        .from('game_states')
        .update(heartbeatUpdate)
        .eq('game_id', gameId)
        .eq('controlling_host_id', controlResult.user!.id); // Only update if WE are the controller

    if (error) return { success: false, error: error.message };
    
    return { success: true };
}

export async function getCurrentGameState(gameId: string): Promise<ActionResult<Database['public']['Tables']['game_states']['Row']>> {
    const supabase = await createClient();
    const authResult = await authorizeHost(supabase);
    if (!authResult.authorized) return { success: false, error: authResult.error };

    const { data: gameState, error } = await supabase
        .from('game_states')
        .select('*')
        .eq('game_id', gameId)
        .single<Database['public']['Tables']['game_states']['Row']>();

    if (error && error.code !== 'PGRST116') { // PGRST116 means 'no rows found'
        return { success: false, error: error.message };
    }

    // If no game state found, return null or a default
    if (!gameState) {
        return { success: false, error: "No game state found for this game." };
    }

    return { success: true, data: gameState };
}

export async function callNextNumber(
  gameId: string
): Promise<ActionResult<{ nextNumber: number; gameState: Database['public']['Tables']['game_states']['Row'] }>> {
  const supabase = await createClient()
  const controlResult = await requireController(supabase, gameId)
  if (!controlResult.authorized) return { success: false, error: controlResult.error }

  const { data: gameState, error: fetchError } = await supabase
    .from('game_states')
    .select('number_sequence, called_numbers, numbers_called_count, status, call_delay_seconds, last_call_at, on_break, paused_for_validation')
    .eq('game_id', gameId)
    .single<Pick<Database['public']['Tables']['game_states']['Row'], 'number_sequence' | 'called_numbers' | 'numbers_called_count' | 'status' | 'call_delay_seconds' | 'last_call_at' | 'on_break' | 'paused_for_validation'>>()

  if (fetchError || !gameState) {
    return { success: false, error: fetchError?.message || "Game state not found." };
  }

  if (gameState.status !== 'in_progress') {
    return { success: false, error: "Game is not in progress." };
  }
  if (gameState.on_break) {
    return { success: false, error: "Game is on break." };
  }
  if (gameState.paused_for_validation) {
    return { success: false, error: "Game is paused for claim validation." };
  }

  // Server-side gap enforcement. No 200ms display-sync buffer — host sees the new
  // ball instantly from this action's response; only the public surfaces wait
  // call_delay_seconds via last_call_at.
  if (gameState.last_call_at && gameState.numbers_called_count > 0) {
    const lastCallAtMs = new Date(gameState.last_call_at).getTime();
    if (!Number.isNaN(lastCallAtMs)) {
      const minGapMs = Math.max(0, gameState.call_delay_seconds * 1000);
      const remainingMs = lastCallAtMs + minGapMs - Date.now();
      if (remainingMs > 0) {
        const remainingSeconds = Math.ceil(remainingMs / 1000);
        return {
          success: false,
          error: `Please wait ${remainingSeconds}s before calling the next number.`
        };
      }
    }
  }

  if (!gameState.number_sequence || gameState.numbers_called_count >= gameState.number_sequence.length) {
    return { success: false, error: "No more numbers to call." };
  }

  const nextNumber = gameState.number_sequence[gameState.numbers_called_count];
  const newCalledNumbers = [...(gameState.called_numbers as number[]), nextNumber];
  const newNumbersCalledCount = gameState.numbers_called_count + 1;

  const callUpdate: Database['public']['Tables']['game_states']['Update'] = {
    called_numbers: newCalledNumbers,
    numbers_called_count: newNumbersCalledCount,
    last_call_at: new Date().toISOString(),
  };

  // Compare-and-set guard: only commit if numbers_called_count is still the value
  // we read above. Prevents two concurrent calls from both incrementing.
  const { data: updatedRows, error: updateError } = await supabase
    .from('game_states')
    .update(callUpdate)
    .eq('game_id', gameId)
    .eq('numbers_called_count', gameState.numbers_called_count)
    .select('numbers_called_count');

  if (updateError) {
    return { success: false, error: updateError.message };
  }
  if (!updatedRows || updatedRows.length === 0) {
    return { success: false, error: "Game state changed. Please try again." };
  }

  // Re-read the row so the host gets the fully-synced state, including the
  // state_version bumped by the bump_game_state_version BEFORE UPDATE trigger.
  const { data: updatedGameState, error: rereadError } = await supabase
    .from('game_states')
    .select('*')
    .eq('game_id', gameId)
    .single<Database['public']['Tables']['game_states']['Row']>();

  if (rereadError || !updatedGameState) {
    return { success: false, error: rereadError?.message || "Failed to read updated game state." };
  }

  revalidatePath(`/host/${gameId}`);
  return { success: true, data: { nextNumber, gameState: updatedGameState } };
}

export async function toggleBreak(gameId: string, onBreak: boolean): Promise<ActionResult> {
    const supabase = await createClient()
    const controlResult = await requireController(supabase, gameId)
    if (!controlResult.authorized) return { success: false, error: controlResult.error }

    const { data: gameState, error: fetchError } = await supabase
        .from('game_states')
        .select('status')
        .eq('game_id', gameId)
        .single<Pick<Database['public']['Tables']['game_states']['Row'], 'status'>>();
    
    if (fetchError || !gameState) {
        return { success: false, error: fetchError?.message || "Game state not found." };
    }

    if (gameState.status !== 'in_progress') {
        return { success: false, error: "Cannot toggle break for a game not in progress." };
    }

    const breakUpdate: Database['public']['Tables']['game_states']['Update'] = {
        on_break: onBreak,
        last_call_at: new Date().toISOString(), // Update timestamp to reflect activity
        paused_for_validation: false, // Ensure we unpause if coming from validation
        display_win_type: null, // Clear any win display so "Break" shows
        display_win_text: null,
        display_winner_name: null,
    };
    const { error: updateError } = await supabase
        .from('game_states')
        .update(breakUpdate)
        .eq('game_id', gameId);

    if (updateError) {
        return { success: false, error: updateError.message };
    }
    revalidatePath(`/host/${gameId}`);
    return { success: true };
}

export async function pauseForValidation(gameId: string): Promise<ActionResult> {
    const supabase = await createClient()
    const controlResult = await requireController(supabase, gameId)
    if (!controlResult.authorized) return { success: false, error: controlResult.error }
    
    const validationUpdate: Database['public']['Tables']['game_states']['Update'] = {
        paused_for_validation: true,
        display_win_type: null, // Clear old win display if any
        display_win_text: null,
        display_winner_name: null,
    };
    const { error } = await supabase
        .from('game_states')
        .update(validationUpdate)
        .eq('game_id', gameId);

    if (error) {
        return { success: false, error: error.message };
    }
    
    revalidatePath(`/host/${gameId}`);
    return { success: true };
}

export async function resumeGame(gameId: string): Promise<ActionResult> {
    const supabase = await createClient()
    const controlResult = await requireController(supabase, gameId)
    if (!controlResult.authorized) return { success: false, error: controlResult.error }
    
    const resumeUpdate: Database['public']['Tables']['game_states']['Update'] = {
        paused_for_validation: false,
        display_win_type: null,
        display_win_text: null,
        display_winner_name: null,
    };
    const { error } = await supabase
        .from('game_states')
        .update(resumeUpdate)
        .eq('game_id', gameId);

    if (error) {
        return { success: false, error: error.message };
    }
    
    revalidatePath(`/host/${gameId}`);
    return { success: true };
}

export async function endGame(gameId: string, sessionId: string): Promise<ActionResult> {
    const supabase = await createClient()
    const controlResult = await requireController(supabase, gameId)
    if (!controlResult.authorized) return { success: false, error: controlResult.error }

    const { data: gameState, error: fetchError } = await supabase
        .from('game_states')
        .select('status')
        .eq('game_id', gameId)
        .single<Pick<Database['public']['Tables']['game_states']['Row'], 'status'>>();
    
    if (fetchError || !gameState) {
        return { success: false, error: fetchError?.message || "Game state not found." };
    }

    if (gameState.status !== 'in_progress') {
        return { success: false, error: "Game is not in progress." };
    }

    const endUpdate: Database['public']['Tables']['game_states']['Update'] = {
        status: 'completed',
        ended_at: new Date().toISOString(),
        on_break: false,
        paused_for_validation: false,
        display_win_type: null,
        display_win_text: null,
        display_winner_name: null,
    };
    const { error: updateError } = await supabase
        .from('game_states')
        .update(endUpdate)
        .eq('game_id', gameId);

    if (updateError) {
        return { success: false, error: updateError.message };
    }

    // Use the shared helper for Snowball Logic
    await handleSnowballPotUpdate(supabase, sessionId, gameId);
    await maybeCompleteSession(supabase, sessionId);

    const { data: sessionAfterEnd, error: sessionAfterEndError } = await supabase
        .from('sessions')
        .select('status')
        .eq('id', sessionId)
        .single<Pick<Database['public']['Tables']['sessions']['Row'], 'status'>>();

    if (!sessionAfterEndError && sessionAfterEnd && sessionAfterEnd.status !== 'completed') {
        const clearActiveGameUpdate: Database['public']['Tables']['sessions']['Update'] = {
            active_game_id: null,
            status: 'running',
        };
        const { error: clearActiveError } = await supabase
            .from('sessions')
            .update(clearActiveGameUpdate)
            .eq('id', sessionId);

        if (clearActiveError) {
            return { success: false, error: clearActiveError.message };
        }
    }

    revalidatePath(`/host/${sessionId}/${gameId}`); // Revalidate the specific game page
    revalidatePath(`/host`); // Revalidate the host dashboard
    return { success: true };
}

export async function moveToNextGameOnBreak(
    currentGameId: string,
    sessionId: string,
    cashJackpotAmountInput?: string
): Promise<ActionResult<{ redirectTo?: string; requiresCashJackpotAmount?: boolean; gameName?: string }>> {
    const supabase = await createClient();
    const controlResult = await requireController(supabase, currentGameId);
    if (!controlResult.authorized) return { success: false, error: controlResult.error };

    const { data: sessionGames, error: sessionGamesError } = await supabase
        .from('games')
        .select('id, game_index, created_at')
        .eq('session_id', sessionId)
        .order('game_index', { ascending: true })
        .order('created_at', { ascending: true });

    if (sessionGamesError || !sessionGames) {
        return { success: false, error: sessionGamesError?.message || "Could not read session games." };
    }

    const currentGamePosition = sessionGames.findIndex((game) => game.id === currentGameId);
    if (currentGamePosition === -1) {
        return { success: false, error: "Current game not found in this session." };
    }

    const nextGameId = sessionGames[currentGamePosition + 1]?.id;

    const { data: currentGameState, error: currentStateError } = await supabase
        .from('game_states')
        .select('status')
        .eq('game_id', currentGameId)
        .single<Pick<Database['public']['Tables']['game_states']['Row'], 'status'>>();

    if (currentStateError || !currentGameState) {
        return { success: false, error: currentStateError?.message || "Could not read current game state." };
    }

    if (currentGameState.status !== 'completed') {
        const endResult = await endGame(currentGameId, sessionId);
        if (!endResult.success) {
            return { success: false, error: endResult.error || "Failed to complete current game." };
        }
    }
    if (!nextGameId) {
        return { success: true, data: { redirectTo: '/host' } };
    }

    const startResult = await startGame(sessionId, nextGameId, cashJackpotAmountInput);
    if (!startResult.success) {
        return { success: false, error: startResult.error || "Failed to start next game." };
    }
    if (startResult.data?.requiresCashJackpotAmount) {
        return {
            success: true,
            data: {
                requiresCashJackpotAmount: true,
                gameName: startResult.data.gameName,
            },
        };
    }

    const breakResult = await toggleBreak(nextGameId, true);
    if (!breakResult.success) {
        return { success: false, error: breakResult.error || "Failed to put next game on break." };
    }

    revalidatePath(`/host/${sessionId}/${nextGameId}`);
    revalidatePath(`/host`);

    return { success: true, data: { redirectTo: `/host/${sessionId}/${nextGameId}` } };
}

export async function moveToNextGameAfterWin(
    currentGameId: string,
    sessionId: string,
    cashJackpotAmountInput?: string
): Promise<ActionResult<{ redirectTo?: string; requiresCashJackpotAmount?: boolean; gameName?: string }>> {
    const supabase = await createClient();
    const controlResult = await requireController(supabase, currentGameId);
    if (!controlResult.authorized) return { success: false, error: controlResult.error };

    const { data: sessionGames, error: sessionGamesError } = await supabase
        .from('games')
        .select('id, game_index, created_at')
        .eq('session_id', sessionId)
        .order('game_index', { ascending: true })
        .order('created_at', { ascending: true });

    if (sessionGamesError || !sessionGames) {
        return { success: false, error: sessionGamesError?.message || "Could not read session games." };
    }

    const currentGamePosition = sessionGames.findIndex((game) => game.id === currentGameId);
    if (currentGamePosition === -1) {
        return { success: false, error: "Current game not found in this session." };
    }

    const nextGameId = sessionGames[currentGamePosition + 1]?.id;

    const { data: currentGameState, error: currentStateError } = await supabase
        .from('game_states')
        .select('status')
        .eq('game_id', currentGameId)
        .single<Pick<Database['public']['Tables']['game_states']['Row'], 'status'>>();

    if (currentStateError || !currentGameState) {
        return { success: false, error: currentStateError?.message || "Could not read current game state." };
    }

    if (currentGameState.status !== 'completed') {
        const endResult = await endGame(currentGameId, sessionId);
        if (!endResult.success) {
            return { success: false, error: endResult.error || "Failed to complete current game." };
        }
    }

    if (!nextGameId) {
        return { success: true, data: { redirectTo: '/host' } };
    }

    const startResult = await startGame(sessionId, nextGameId, cashJackpotAmountInput);
    if (!startResult.success) {
        return { success: false, error: startResult.error || "Failed to start next game." };
    }
    if (startResult.data?.requiresCashJackpotAmount) {
        return {
            success: true,
            data: {
                requiresCashJackpotAmount: true,
                gameName: startResult.data.gameName,
            },
        };
    }

    revalidatePath(`/host/${sessionId}/${nextGameId}`);
    revalidatePath(`/host`);

    return { success: true, data: { redirectTo: `/host/${sessionId}/${nextGameId}` } };
}

export async function validateClaim(gameId: string, claimedNumbers: number[]): Promise<ActionResult<{ valid: boolean; invalidNumbers?: number[] }>> {
    // Input validation
    if (!gameId) {
        return { success: false, error: 'Invalid game ID.' };
    }
    if (!Array.isArray(claimedNumbers)) {
        return { success: false, error: 'Claimed numbers must be an array.' };
    }
    if (claimedNumbers.some(n => !Number.isInteger(n) || n < 1 || n > 90)) {
        return { success: false, error: 'Each claimed number must be an integer between 1 and 90.' };
    }

    const supabase = await createClient()
    const controlResult = await requireController(supabase, gameId)
    if (!controlResult.authorized) return { success: false, error: controlResult.error }

    const { data: gameState, error: fetchError } = await supabase
        .from('game_states')
        .select('called_numbers, current_stage_index, numbers_called_count')
        .eq('game_id', gameId)
        .single<Pick<Database['public']['Tables']['game_states']['Row'], 'called_numbers' | 'current_stage_index' | 'numbers_called_count'>>();

    if (fetchError || !gameState) {
        return { success: false, error: fetchError?.message || "Game state not found." };
    }

    const { data: gameDetails, error: gameDetailsError } = await supabase
        .from('games')
        .select('stage_sequence')
        .eq('id', gameId)
        .single<Pick<Database['public']['Tables']['games']['Row'], 'stage_sequence'>>();

    if (gameDetailsError || !gameDetails) {
        return { success: false, error: gameDetailsError?.message || "Game details not found." };
    }

    const stageSequence = (gameDetails.stage_sequence as string[]) || [];
    const fallbackStageName = stageSequence[stageSequence.length - 1];
    const currentStageName = stageSequence[gameState.current_stage_index] || fallbackStageName;
    const requiredSelectionCount = currentStageName
        ? getRequiredSelectionCountForStage(currentStageName)
        : null;

    if (requiredSelectionCount === null) {
        return { success: false, error: 'Stage not valid for this game' };
    }

    if (claimedNumbers.length !== requiredSelectionCount) {
        return {
            success: false,
            error: `Select exactly ${requiredSelectionCount} numbers for ${currentStageName}.`,
        };
    }

    const calledNumbers = gameState.called_numbers as number[];
    const calledNumbersSet = new Set(calledNumbers);
    const invalidNumbers: number[] = [];

    if (!gameState.numbers_called_count || calledNumbers.length === 0) {
        return { success: false, error: "No numbers have been called yet." };
    }

    const lastCalledNumber = calledNumbers[gameState.numbers_called_count - 1];
    if (!claimedNumbers.includes(lastCalledNumber)) {
        return { success: false, error: `Claim must include the last called number (${lastCalledNumber}).` };
    }

    for (const num of claimedNumbers) {
        if (!calledNumbersSet.has(num)) {
            invalidNumbers.push(num);
        }
    }

    if (invalidNumbers.length > 0) {
        return { success: true, data: { valid: false, invalidNumbers } };
    } else {
        return { success: true, data: { valid: true } };
    }
}

export async function announceWin(gameId: string, stage: WinStage | 'snowball'): Promise<ActionResult> {
    const supabase = await createClient();
    const controlResult = await requireController(supabase, gameId)
    if (!controlResult.authorized) return { success: false, error: controlResult.error }

    const { data: gameState, error: gameStateError } = await supabase
        .from('game_states')
        .select('current_stage_index, status')
        .eq('game_id', gameId)
        .single<Pick<Database['public']['Tables']['game_states']['Row'], 'current_stage_index' | 'status'>>();
    if (gameStateError || !gameState) {
        return { success: false, error: gameStateError?.message || "Game state not found." };
    }
    if (gameState.status !== 'in_progress') {
        return { success: false, error: "Cannot announce a winner unless the game is in progress." };
    }

    const { data: gameRow, error: gameRowError } = await supabase
        .from('games')
        .select('type, stage_sequence')
        .eq('id', gameId)
        .single<Pick<Database['public']['Tables']['games']['Row'], 'type' | 'stage_sequence'>>();
    if (gameRowError || !gameRow) {
        return { success: false, error: gameRowError?.message || "Game details not found." };
    }

    const expectedStage = (gameRow.stage_sequence as string[] | null)?.[gameState.current_stage_index];
    if (!expectedStage) {
        return { success: false, error: "Current stage is not configured for this game." };
    }

    if (stage === 'snowball') {
        if (gameRow.type !== 'snowball' || expectedStage !== 'Full House') {
            return { success: false, error: "Snowball announcement is only valid during Full House of a snowball game." };
        }
    } else if (stage !== expectedStage) {
        return { success: false, error: `Stage mismatch: live stage is ${expectedStage}.` };
    }

    let displayWinText: string;
    let displayWinType: string;

    if (stage === 'snowball') {
        displayWinType = 'snowball';
        displayWinText = 'SNOWBALL JACKPOT WIN!';
    } else {
        switch (stage) {
            case 'Line':
                displayWinType = 'line';
                displayWinText = 'LINE WINNER!';
                break;
            case 'Two Lines':
                displayWinType = 'two_lines';
                displayWinText = 'TWO LINES WINNER!';
                break;
            case 'Full House':
                displayWinType = 'full_house';
                displayWinText = 'FULL HOUSE WINNER!';
                break;
            default:
                displayWinType = 'win';
                displayWinText = 'WINNER!';
        }
    }

    const winUpdate: Database['public']['Tables']['game_states']['Update'] = {
        display_win_type: displayWinType,
        display_win_text: displayWinText,
        display_winner_name: null,
        // Keep paused_for_validation true or ensure it is treated as such
        paused_for_validation: true 
    };
    const { error } = await supabase
        .from('game_states')
        .update(winUpdate)
        .eq('game_id', gameId);

    if (error) {
        return { success: false, error: error.message };
    }
    
    revalidatePath(`/host/${gameId}`);
    return { success: true };
}

export async function advanceToNextStage(gameId: string): Promise<ActionResult> {
    const supabase = await createClient();
    const controlResult = await requireController(supabase, gameId)
    if (!controlResult.authorized) return { success: false, error: controlResult.error }

    const { data: currentGameState, error: fetchError } = await supabase
        .from('game_states')
        .select('current_stage_index, status')
        .eq('game_id', gameId)
        .single<Pick<Database['public']['Tables']['game_states']['Row'], 'current_stage_index' | 'status'>>();

    if (fetchError || !currentGameState) {
         return { success: false, error: fetchError?.message || "Game state not found." };
    }

    if (currentGameState.status === 'completed') {
        return { success: false, error: 'Game is already completed.' };
    }

    const { data: gameDetails } = await supabase
        .from('games')
        .select('session_id, type, snowball_pot_id, stage_sequence')
        .eq('id', gameId)
        .single<Pick<Database['public']['Tables']['games']['Row'], 'session_id' | 'type' | 'snowball_pot_id' | 'stage_sequence'>>();

    if (!gameDetails) {
        return { success: false, error: "Game details not found." };
    }

    let newStageIndex = currentGameState.current_stage_index + 1;
    let newGameStatus: GameStatus = 'in_progress';

    if (newStageIndex >= (gameDetails.stage_sequence as WinStage[]).length) {
        newStageIndex = (gameDetails.stage_sequence as WinStage[]).length - 1; 
        newGameStatus = 'completed';
    }

    const stageUpdate: Database['public']['Tables']['game_states']['Update'] = {
        current_stage_index: newStageIndex,
        status: newGameStatus,
        paused_for_validation: false,
        display_win_type: null,
        display_win_text: null,
        display_winner_name: null,
    };
    const { error: updateError } = await supabase
        .from('game_states')
        .update(stageUpdate)
        .eq('game_id', gameId);

    if (updateError) {
        return { success: false, error: updateError.message };
    }

    // If the game is now completed, check Snowball logic (Rollover vs Reset)
    if (newGameStatus === 'completed') {
        const potResult = await handleSnowballPotUpdate(supabase, gameDetails.session_id, gameId);
        if (!potResult.success) {
            return { success: false, error: potResult.error || 'Failed to update snowball pot.' };
        }
        await maybeCompleteSession(supabase, gameDetails.session_id);
    }

    revalidatePath(`/host/${gameId}`);
    return { success: true };
}

export async function recordWinner(
    sessionId: string,
    gameId: string,
    stage: WinStage,
    prizeDescription: string | null,
    prizeGiven: boolean = false,
    forceSnowballJackpot: boolean = false,
    snowballEligible: boolean = false
): Promise<ActionResult> {
    // Input validation
    const validStages: WinStage[] = ['Line', 'Two Lines', 'Full House'];
    if (!validStages.includes(stage)) {
        return { success: false, error: 'Invalid stage value.' };
    }
    if (!sessionId || !gameId) {
        return { success: false, error: 'Invalid session or game ID.' };
    }

    const supabase = await createClient();
    const controlResult = await requireController(supabase, gameId)
    if (!controlResult.authorized) return { success: false, error: controlResult.error }

    const { data: liveGameRow, error: liveGameRowError } = await supabase
        .from('games')
        .select('session_id, type, snowball_pot_id, stage_sequence')
        .eq('id', gameId)
        .single<Pick<Database['public']['Tables']['games']['Row'], 'session_id' | 'type' | 'snowball_pot_id' | 'stage_sequence'>>();
    if (liveGameRowError || !liveGameRow) {
        return { success: false, error: liveGameRowError?.message || "Game details not found." };
    }
    if (liveGameRow.session_id !== sessionId) {
        return { success: false, error: "Game does not belong to this session." };
    }

    const { data: liveStateRow, error: liveStateRowError } = await supabase
        .from('game_states')
        .select('numbers_called_count, current_stage_index, status')
        .eq('game_id', gameId)
        .single<Pick<Database['public']['Tables']['game_states']['Row'], 'numbers_called_count' | 'current_stage_index' | 'status'>>();
    if (liveStateRowError || !liveStateRow) {
        return { success: false, error: liveStateRowError?.message || "Game state not found." };
    }
    if (liveStateRow.status !== 'in_progress') {
        return { success: false, error: "Cannot record a winner unless the game is in progress." };
    }

    const expectedStage = (liveGameRow.stage_sequence as string[] | null)?.[liveStateRow.current_stage_index];
    if (!expectedStage) {
        return { success: false, error: "Current stage is not configured for this game." };
    }
    if (stage !== expectedStage) {
        return { success: false, error: `Stage mismatch: live stage is ${expectedStage}.` };
    }

    // Always re-read live numbers_called_count server-side; never trust the client value.
    const resolvedCallCountAtWin = liveStateRow.numbers_called_count;

    // Check if this is a test session — suppress snowball jackpot for test sessions
    const { data: sessionData } = await supabase
        .from('sessions')
        .select('is_test_session')
        .eq('id', sessionId)
        .single<Pick<Database['public']['Tables']['sessions']['Row'], 'is_test_session'>>();

    const isTestSession = sessionData?.is_test_session ?? false;

    // Re-calculate isSnowballJackpot on the server for security
    let actualIsSnowballJackpot = false;
    let snowballJackpotAmount: number | null = null;
    let isSnowballFullHouseStage = false;
    let snowballWindowOpen = false;
    const game = liveGameRow;

    if (!isTestSession && game.type === 'snowball' && stage === 'Full House' && game.snowball_pot_id) {
        isSnowballFullHouseStage = true;
        const { data: snowballPot } = await supabase
            .from('snowball_pots')
            .select('current_max_calls, current_jackpot_amount')
            .eq('id', game.snowball_pot_id)
            .single<Pick<Database['public']['Tables']['snowball_pots']['Row'], 'current_max_calls' | 'current_jackpot_amount'>>();

        if (snowballPot) {
            snowballWindowOpen = isSnowballJackpotEligible(resolvedCallCountAtWin, snowballPot.current_max_calls);
        }

        if (snowballPot && (forceSnowballJackpot || (snowballWindowOpen && snowballEligible))) {
            actualIsSnowballJackpot = true;
            snowballJackpotAmount = Number(snowballPot.current_jackpot_amount);
        }
    }

    const normalizedPrizeDescription = prizeDescription?.trim() || null;
    let finalPrizeDescription = normalizedPrizeDescription;
    if (actualIsSnowballJackpot && snowballJackpotAmount !== null) {
        const jackpotDescription = `Snowball Jackpot £${formatPounds(snowballJackpotAmount)}`;
        if (!normalizedPrizeDescription) {
            finalPrizeDescription = jackpotDescription;
        } else if (!normalizedPrizeDescription.toLowerCase().includes('snowball')) {
            finalPrizeDescription = `${normalizedPrizeDescription} + ${jackpotDescription}`;
        }
    }

    // Insert winner record. Winner names are anonymous on the public surfaces;
    // persist 'Anonymous' so historical records remain queryable but never expose
    // a person name on display/player.
    const winnerInsert: Database['public']['Tables']['winners']['Insert'] = {
        session_id: sessionId,
        game_id: gameId,
        stage,
        winner_name: 'Anonymous',
        prize_description: finalPrizeDescription,
        call_count_at_win: resolvedCallCountAtWin,
        is_snowball_eligible: snowballEligible,
        is_snowball_jackpot: actualIsSnowballJackpot,
        prize_given: prizeGiven,
    };
    const { error: winnerInsertError } = await supabase
        .from('winners')
        .insert(winnerInsert);

    if (winnerInsertError) {
        return { success: false, error: winnerInsertError.message };
    }

    // Determine display win type and text. Snowball jackpot wins keep their
    // existing celebratory text including the cash amount — hiding the jackpot
    // amount would be worse UX. Regular wins use the generic 'BINGO!' label.
    let displayWinType: string;
    let displayWinText: string;
    if (actualIsSnowballJackpot) {
        displayWinType = 'snowball';
        displayWinText = snowballJackpotAmount !== null
            ? `FULL HOUSE + SNOWBALL £${formatPounds(snowballJackpotAmount)}!`
            : 'FULL HOUSE + SNOWBALL JACKPOT!';
    } else if (isSnowballFullHouseStage && snowballWindowOpen && !snowballEligible) {
        // Snowball game, window still open, but the host marked the claim as
        // ineligible for the jackpot prize. Keep this informative wording so the
        // host UI accurately reflects the snowball state.
        displayWinType = 'full_house';
        displayWinText = 'BINGO!';
    } else if (isSnowballFullHouseStage && !snowballWindowOpen) {
        displayWinType = 'full_house';
        displayWinText = 'BINGO!';
    } else {
        switch (stage) {
            case 'Line':
                displayWinType = 'line';
                displayWinText = 'BINGO!';
                break;
            case 'Two Lines':
                displayWinType = 'two_lines';
                displayWinText = 'BINGO!';
                break;
            case 'Full House':
                displayWinType = 'full_house';
                displayWinText = 'BINGO!';
                break;
            default:
                displayWinType = 'win';
                displayWinText = 'BINGO!';
        }
    }

    // Update the display state. display_winner_name is intentionally null so the
    // public surfaces show only the celebratory text (e.g. 'BINGO!').
    const winnerDisplayUpdate: Database['public']['Tables']['game_states']['Update'] = {
        paused_for_validation: true,
        display_win_type: displayWinType,
        display_win_text: displayWinText,
        display_winner_name: null,
    };
    const { error: gameStateUpdateError } = await supabase
        .from('game_states')
        .update(winnerDisplayUpdate)
        .eq('game_id', gameId);

    if (gameStateUpdateError) {
        return { success: false, error: 'Winner recorded but failed to update game state. Please refresh and try again.' };
    }

    revalidatePath(`/host/${sessionId}/${gameId}`);
    return { success: true };
}

export async function toggleWinnerPrizeGiven(sessionId: string, gameId: string, winnerId: string, prizeGiven: boolean): Promise<ActionResult> {
    const supabase = await createClient();
    const controlResult = await requireController(supabase, gameId)
    if (!controlResult.authorized) return { success: false, error: controlResult.error }

    const { data: winner, error: winnerError } = await supabase
        .from('winners')
        .select('session_id')
        .eq('id', winnerId)
        .single<Pick<Database['public']['Tables']['winners']['Row'], 'session_id'>>();

    if (winnerError || !winner) {
        return { success: false, error: winnerError?.message || "Winner not found." };
    }

    if (winner.session_id !== sessionId) {
        return { success: false, error: "Winner does not belong to this session." };
    }
    
    const { error } = await supabase
        .from('winners')
        .update({ prize_given: prizeGiven } satisfies Database['public']['Tables']['winners']['Update'])
        .eq('id', winnerId)
        .eq('session_id', sessionId);

    if (error) {
        return { success: false, error: error.message };
    }
    
    revalidatePath(`/host/${sessionId}/${gameId}`);
    return { success: true };
}

export async function skipStage(gameId: string, currentStageIndex: number, totalStages: number): Promise<ActionResult> {
    const supabase = await createClient();
    const controlResult = await requireController(supabase, gameId)
    if (!controlResult.authorized) return { success: false, error: controlResult.error }

    const { data: gameDetails, error: gameDetailsError } = await supabase
        .from('games')
        .select('session_id')
        .eq('id', gameId)
        .single<Pick<Database['public']['Tables']['games']['Row'], 'session_id'>>();

    if (gameDetailsError || !gameDetails) {
        return { success: false, error: gameDetailsError?.message || "Game details not found." };
    }

    let newStageIndex = currentStageIndex + 1;
    let newStatus = 'in_progress' as GameStatus;

    if (newStageIndex >= totalStages) {
        newStageIndex = totalStages - 1; // Cap at last stage (fixed: totalStages is count, index is count-1 max)
        newStatus = 'completed'; // If skipping last stage, game ends
    }
    
    const { error } = await supabase
        .from('game_states')
        .update({
            current_stage_index: newStageIndex,
            status: newStatus,
            paused_for_validation: false, // Clear validation pause
            display_win_type: null, // Clear any win display
            display_win_text: null,
            display_winner_name: null,
        } satisfies Database['public']['Tables']['game_states']['Update'])
        .eq('game_id', gameId);

    if (error) {
        return { success: false, error: "Error updating game state to skip stage: " + error.message };
    }

    if (newStatus === 'completed') {
        await handleSnowballPotUpdate(supabase, gameDetails.session_id, gameId);
        await maybeCompleteSession(supabase, gameDetails.session_id);
    }

    revalidatePath(`/host/${gameId}`);
    return { success: true };
}

export async function voidLastNumber(gameId: string): Promise<ActionResult> {
    const supabase = await createClient();
    const controlResult = await requireController(supabase, gameId)
    if (!controlResult.authorized) return { success: false, error: controlResult.error }

    const { data: gameState, error: fetchError } = await supabase
        .from('game_states')
        .select('called_numbers, numbers_called_count, status')
        .eq('game_id', gameId)
        .single<Pick<Database['public']['Tables']['game_states']['Row'], 'called_numbers' | 'numbers_called_count' | 'status'>>();

    if (fetchError || !gameState) {
        return { success: false, error: fetchError?.message || "Game state not found." };
    }

    if (gameState.status !== 'in_progress') {
        return { success: false, error: "Cannot void number for a game not in progress." };
    }
    if (gameState.numbers_called_count === 0 || !(gameState.called_numbers as number[]).length) {
        return { success: false, error: "No numbers have been called to void." };
    }

    // Check if a winner was recorded on this number
    const { count: winnerCount, error: winnerCheckError } = await supabase
        .from('winners')
        .select('*', { count: 'exact', head: true })
        .eq('game_id', gameId)
        .eq('call_count_at_win', gameState.numbers_called_count);

    if (winnerCheckError) {
        return { success: false, error: "Failed to verify winner status." };
    }

    if (winnerCount && winnerCount > 0) {
        return { success: false, error: "Cannot undo: A winner was recorded on this number. Please delete the winner record first." };
    }

    const newCalledNumbers = (gameState.called_numbers as number[]).slice(0, -1); // Remove last number
    const newNumbersCalledCount = gameState.numbers_called_count - 1;

    const { error: updateError } = await supabase
        .from('game_states')
        .update({
            called_numbers: newCalledNumbers,
            numbers_called_count: newNumbersCalledCount,
            // last_call_at: new Date().toISOString(), // Do not update timestamp for void action
            // Clear any lingering win display if voiding might affect a just-called winning number
            display_win_type: null, 
            display_win_text: null,
            display_winner_name: null,
        } satisfies Database['public']['Tables']['game_states']['Update'])
        .eq('game_id', gameId);

    if (updateError) {
        return { success: false, error: updateError.message };
    }

    revalidatePath(`/host/${gameId}`);
    return { success: true };
}
