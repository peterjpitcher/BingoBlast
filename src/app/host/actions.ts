'use server'

import { createClient } from '@/utils/supabase/server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { GameStatus, WinStage, UserRole } from '@/types/database'
import type { Database } from '@/types/database'
import { SupabaseClient, createClient as createSupabaseClient } from '@supabase/supabase-js'

async function authorizeHost(supabase: SupabaseClient<Database>) {
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
async function handleSnowballPotUpdate(supabase: SupabaseClient<Database>, sessionId: string, gameId: string) {
    // 1. Check session type
    const { data: session, error: sessionError } = await supabase
        .from('sessions')
        .select('is_test_session')
        .eq('id', sessionId)
        .single<Pick<Database['public']['Tables']['sessions']['Row'], 'is_test_session'>>();

    if (sessionError) {
        console.error("Error checking session type for snowball logic:", sessionError.message);
    }

    if (session?.is_test_session) {
         console.log("Test session: Snowball pot updates skipped.");
         return;
    }

    // 2. Check game type
    const { data: gameData } = await supabase
        .from('games')
        .select('type, snowball_pot_id')
        .eq('id', gameId)
        .single<Pick<Database['public']['Tables']['games']['Row'], 'type' | 'snowball_pot_id'>>();

    if (gameData?.type !== 'snowball' || !gameData.snowball_pot_id) return;

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
        
    if (!potData) return;

    if (jackpotWon) {
        // Reset Pot (if needed)
         if (potData.current_jackpot_amount > potData.base_jackpot_amount || potData.current_max_calls > potData.base_max_calls) {
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            const { error: potError } = await supabase.from('snowball_pots').update({
                current_max_calls: potData.base_max_calls,
                current_jackpot_amount: potData.base_jackpot_amount,
                last_awarded_at: new Date().toISOString()
            }).eq('id', potData.id);

             if (potError) {
                console.error("Failed to reset snowball pot:", potError);
            } else {
                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-ignore
                await supabase.from('snowball_pot_history').insert({
                    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                    // @ts-ignore
                    snowball_pot_id: potData.id,
                    change_type: 'jackpot_won',
                    old_val_max: potData.current_max_calls,
                    new_val_max: potData.base_max_calls,
                    old_val_jackpot: potData.current_jackpot_amount,
                    new_val_jackpot: potData.base_jackpot_amount,
                });
            }
         }
    } else {
        // Rollover
        const newMaxCalls = potData.current_max_calls + potData.calls_increment;
        const newJackpot = Number(potData.current_jackpot_amount) + Number(potData.jackpot_increment);

        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        const { error: potError } = await supabase.from('snowball_pots').update({
            current_max_calls: newMaxCalls,
            current_jackpot_amount: newJackpot
        }).eq('id', potData.id);

        if (potError) {
             console.error("Failed to rollover snowball pot:", potError);
        } else {
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            await supabase.from('snowball_pot_history').insert({
                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-ignore
                snowball_pot_id: potData.id,
                change_type: 'rollover',
                old_val_max: potData.current_max_calls,
                new_val_max: newMaxCalls,
                old_val_jackpot: potData.current_jackpot_amount,
                new_val_jackpot: newJackpot,
            });
        }
    }
}

export async function startGame(sessionId: string, gameId: string) {
  const supabase = await createClient()
  const authResult = await authorizeHost(supabase)
  if (!authResult.authorized) return { error: authResult.error }

  const dbClient = getServiceRoleClient() || supabase;

  // 1. Check if game_state already exists
  const { data: existingGameState, error: fetchGameStateError } = await dbClient
    .from('game_states')
    .select('id, status, number_sequence, called_numbers, numbers_called_count, current_stage_index') // Select all needed fields
    .eq('game_id', gameId)
    .single<Pick<Database['public']['Tables']['game_states']['Row'], 'id' | 'status' | 'number_sequence' | 'called_numbers' | 'numbers_called_count' | 'current_stage_index'>>()

  if (fetchGameStateError && fetchGameStateError.code !== 'PGRST116') { // PGRST116 means 'no rows found'
    console.error("Error fetching existing game state:", fetchGameStateError);
    return { error: fetchGameStateError.message };
  }

  // 2. Generate new sequence if not already in_progress or completed
  let sequence = existingGameState?.number_sequence;
  if (!existingGameState || existingGameState.status === 'not_started') {
      sequence = generateShuffledNumberSequence();
  }
  // Keep existing sequence if status is 'completed' (Re-opening) or 'in_progress'


  // 3. Insert or update game_state
  const commonGameState = {
    number_sequence: sequence,
    called_numbers: existingGameState?.status === 'completed' ? existingGameState.called_numbers : [], // Keep calls if re-opening? PRD says "Allows host to resume calling", implies keeping calls.
    numbers_called_count: existingGameState?.status === 'completed' ? existingGameState.numbers_called_count : 0,
    current_stage_index: existingGameState?.status === 'completed' ? existingGameState.current_stage_index : 0,
    status: 'in_progress' as GameStatus,
    started_at: new Date().toISOString(),
    ended_at: null,
    last_call_at: null,
    on_break: false,
    paused_for_validation: false,
    call_delay_seconds: 3, // Default, can be configurable
    display_win_type: null, // Reset display flags
    display_win_text: null,
    display_winner_name: null,
  };

  // Actually, if re-opening, we shouldn't reset 'called_numbers' to [] if we want to resume.
  // But if it is a fresh start, we want [].
  // Let's refine:
  // If existingGameState.status === 'completed', we are Re-opening.
  // We should keep 'called_numbers', 'numbers_called_count', 'current_stage_index'.
  
  const isReopening = existingGameState?.status === 'completed';
  
  const stateToUpsert = isReopening ? {
      status: 'in_progress' as GameStatus,
      ended_at: null,
      display_win_type: null,
      display_win_text: null,
      display_winner_name: null,
      paused_for_validation: false,
      controlling_host_id: authResult.user!.id, // Set controller on re-open
      controller_last_seen_at: new Date().toISOString(),
  } : {
      ...commonGameState,
      // Ensure we reset if it was not completed (i.e. fresh start)
      called_numbers: [],
      numbers_called_count: 0,
      current_stage_index: 0,
      controlling_host_id: authResult.user!.id, // Set controller on start
      controller_last_seen_at: new Date().toISOString(),
  };


  const { error: upsertError } = await dbClient
    .from('game_states')
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    .upsert({
      game_id: gameId,
      number_sequence: sequence, // Always ensure sequence is set
      ...stateToUpsert,
    }, { onConflict: 'game_id' }); 

  if (upsertError) {
    console.error("Error upserting game state:", upsertError);
    return { error: upsertError.message };
  }

  // 4. Update session status to 'running' and set active_game_id
  const { data: session, error: fetchSessionError } = await dbClient
    .from('sessions')
    .select('status, active_game_id') // Select active_game_id too
    .eq('id', sessionId)
    .single<Pick<Database['public']['Tables']['sessions']['Row'], 'status' | 'active_game_id'>>()

  if (fetchSessionError || !session) {
    console.error("Error fetching session to update status:", fetchSessionError);
    return { error: fetchSessionError?.message || "Session not found" };
  }

  // Update only if status is not already running or active_game_id is different
  if (session.status !== 'running' || session.active_game_id !== gameId) {
    const { error: updateSessionError } = await dbClient
      .from('sessions')
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      .update({ status: 'running', active_game_id: gameId })
      .eq('id', sessionId)
    
    if (updateSessionError) {
      console.error("Error updating session status and active_game_id:", updateSessionError);
      return { error: updateSessionError.message };
    }
  }

  revalidatePath(`/host`); // Revalidate host page to show updated status
  revalidatePath(`/host/${sessionId}/${gameId}`); // Revalidate the game control page

  redirect(`/host/${sessionId}/${gameId}`);
}

export async function takeControl(gameId: string) {
    const supabase = await createClient();
    const authResult = await authorizeHost(supabase);
    if (!authResult.authorized) return { error: authResult.error };

    // Check current controller
    const { data: currentState, error: fetchError } = await supabase
        .from('game_states')
        .select('controlling_host_id, controller_last_seen_at')
        .eq('game_id', gameId)
        .single<Pick<Database['public']['Tables']['game_states']['Row'], 'controlling_host_id' | 'controller_last_seen_at'>>();

    if (fetchError) return { error: fetchError.message };

    const now = new Date();
    const lastSeen = currentState?.controller_last_seen_at ? new Date(currentState.controller_last_seen_at) : null;
    const heartbeatThresholdMs = 30000; // 30 seconds

    // If someone else is controlling AND they have been seen recently
    if (currentState?.controlling_host_id && 
        currentState.controlling_host_id !== authResult.user!.id && 
        lastSeen && 
        (now.getTime() - lastSeen.getTime() < heartbeatThresholdMs)) {
            return { error: "Another host is currently controlling this game." };
    }

    // Take control
    const { error: updateError } = await supabase
        .from('game_states')
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        .update({
            controlling_host_id: authResult.user!.id,
            controller_last_seen_at: now.toISOString()
        })
        .eq('game_id', gameId);

    if (updateError) return { error: updateError.message };

    revalidatePath(`/host/${gameId}`);
    return { success: true };
}

export async function sendHeartbeat(gameId: string) {
    const supabase = await createClient();
    const authResult = await authorizeHost(supabase);
    if (!authResult.authorized) return { error: authResult.error };

    const { error } = await supabase
        .from('game_states')
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        .update({
            controller_last_seen_at: new Date().toISOString()
        })
        .eq('game_id', gameId)
        .eq('controlling_host_id', authResult.user!.id); // Only update if WE are the controller

    if (error) return { error: error.message };
    
    return { success: true };
}

export async function getCurrentGameState(gameId: string) {
    const supabase = await createClient();

    const { data: gameState, error } = await supabase
        .from('game_states')
        .select('*')
        .eq('game_id', gameId)
        .single<Database['public']['Tables']['game_states']['Row']>();

    if (error && error.code !== 'PGRST116') { // PGRST116 means 'no rows found'
        console.error("Error fetching game state:", error.message);
        return { error: error.message };
    }

    // If no game state found, return null or a default
    if (!gameState) {
        return { error: "No game state found for this game." };
    }

    return { data: gameState };
}

export async function callNextNumber(gameId: string) {
  const supabase = await createClient()
  const authResult = await authorizeHost(supabase)
  if (!authResult.authorized) return { error: authResult.error }

  const { data: gameState, error: fetchError } = await supabase
    .from('game_states')
    .select('number_sequence, called_numbers, numbers_called_count, status')
    .eq('game_id', gameId)
    .single<Pick<Database['public']['Tables']['game_states']['Row'], 'number_sequence' | 'called_numbers' | 'numbers_called_count' | 'status'>>()

  if (fetchError || !gameState) {
    console.error("Error fetching game state for next number:", fetchError?.message);
    return { error: fetchError?.message || "Game state not found." };
  }

  if (gameState.status !== 'in_progress') {
    return { error: "Game is not in progress." };
  }

  if (!gameState.number_sequence || gameState.numbers_called_count >= gameState.number_sequence.length) {
    return { error: "No more numbers to call." };
  }

  const nextNumber = gameState.number_sequence[gameState.numbers_called_count];
  const newCalledNumbers = [...(gameState.called_numbers as number[]), nextNumber];
  const newNumbersCalledCount = gameState.numbers_called_count + 1;

  const { error: updateError } = await supabase
    .from('game_states')
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    .update({
      called_numbers: newCalledNumbers,
      numbers_called_count: newNumbersCalledCount,
      last_call_at: new Date().toISOString(),
    })
    .eq('game_id', gameId);

  if (updateError) {
    console.error("Error updating game state after call:", updateError.message);
    return { error: updateError.message };
  }

  revalidatePath(`/host/${gameId}`); // Revalidate the game control page
  return { success: true, nextNumber };
}

export async function toggleBreak(gameId: string, onBreak: boolean) {
    const supabase = await createClient()
    const authResult = await authorizeHost(supabase)
    if (!authResult.authorized) return { error: authResult.error }

    const { data: gameState, error: fetchError } = await supabase
        .from('game_states')
        .select('status')
        .eq('game_id', gameId)
        .single<Pick<Database['public']['Tables']['game_states']['Row'], 'status'>>();
    
    if (fetchError || !gameState) {
        console.error("Error fetching game state for toggleBreak:", fetchError?.message);
        return { error: fetchError?.message || "Game state not found." };
    }

    if (gameState.status !== 'in_progress') {
        return { error: "Cannot toggle break for a game not in progress." };
    }

    const { error: updateError } = await supabase
        .from('game_states')
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        .update({
            on_break: onBreak,
            last_call_at: new Date().toISOString(), // Update timestamp to reflect activity
            paused_for_validation: false, // Ensure we unpause if coming from validation
            display_win_type: null, // Clear any win display so "Break" shows
            display_win_text: null,
            display_winner_name: null,
        })
        .eq('game_id', gameId);

    if (updateError) {
        console.error("Error updating break status:", updateError.message);
        return { error: updateError.message };
    }
    revalidatePath(`/host/${gameId}`);
    return { success: true };
}

export async function pauseForValidation(gameId: string) {
    const supabase = await createClient()
    const authResult = await authorizeHost(supabase)
    if (!authResult.authorized) return { error: authResult.error }
    
    const { error } = await supabase
        .from('game_states')
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        .update({
            paused_for_validation: true,
            display_win_type: null, // Clear old win display if any
        })
        .eq('game_id', gameId);

    if (error) {
        console.error("Error pausing for validation:", error.message);
        return { error: error.message };
    }
    
    revalidatePath(`/host/${gameId}`);
    return { success: true };
}

export async function resumeGame(gameId: string) {
    const supabase = await createClient()
    const authResult = await authorizeHost(supabase)
    if (!authResult.authorized) return { error: authResult.error }
    
    const { error } = await supabase
        .from('game_states')
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        .update({
            paused_for_validation: false,
        })
        .eq('game_id', gameId);

    if (error) {
        console.error("Error resuming game:", error.message);
        return { error: error.message };
    }
    
    revalidatePath(`/host/${gameId}`);
    return { success: true };
}

export async function endGame(gameId: string, sessionId: string) {
    const supabase = await createClient()
    const authResult = await authorizeHost(supabase)
    if (!authResult.authorized) return { error: authResult.error }

    const { data: gameState, error: fetchError } = await supabase
        .from('game_states')
        .select('status')
        .eq('game_id', gameId)
        .single<Pick<Database['public']['Tables']['game_states']['Row'], 'status'>>();
    
    if (fetchError || !gameState) {
        console.error("Error fetching game state for endGame:", fetchError?.message);
        return { error: fetchError?.message || "Game state not found." };
    }

    if (gameState.status !== 'in_progress') {
        return { error: "Game is not in progress." };
    }

    const { error: updateError } = await supabase
        .from('game_states')
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        .update({
            status: 'completed',
            ended_at: new Date().toISOString(),
        })
        .eq('game_id', gameId);

    if (updateError) {
        console.error("Error updating game status to completed:", updateError.message);
        return { error: updateError.message };
    }

    // Use the shared helper for Snowball Logic
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    await handleSnowballPotUpdate(supabase, sessionId, gameId);

    revalidatePath(`/host/${sessionId}/${gameId}`); // Revalidate the specific game page
    revalidatePath(`/host`); // Revalidate the host dashboard
    return { success: true };
}

export async function validateClaim(gameId: string, claimedNumbers: number[]) {
    const supabase = await createClient()
    const authResult = await authorizeHost(supabase)
    if (!authResult.authorized) return { error: authResult.error }

    const { data: gameState, error: fetchError } = await supabase
        .from('game_states')
        .select('called_numbers, current_stage_index')
        .eq('game_id', gameId)
        .single<Pick<Database['public']['Tables']['game_states']['Row'], 'called_numbers' | 'current_stage_index'>>();

    if (fetchError || !gameState) {
        return { error: fetchError?.message || "Game state not found." };
    }

    const calledNumbersSet = new Set(gameState.called_numbers as number[]);
    const invalidNumbers: number[] = [];

    for (const num of claimedNumbers) {
        if (!calledNumbersSet.has(num)) {
            invalidNumbers.push(num);
        }
    }

    if (invalidNumbers.length > 0) {
        return { valid: false, invalidNumbers };
    } else {
        return { valid: true };
    }
}

export async function announceWin(gameId: string, stage: WinStage | 'snowball') {
    const supabase = await createClient();

    let displayWinText: string;
    let displayWinType: string;

    if (stage === 'snowball') {
        displayWinType = 'snowball';
        displayWinText = 'JACKPOT WIN!';
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

    const { error } = await supabase
        .from('game_states')
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        .update({
            display_win_type: displayWinType,
            display_win_text: displayWinText,
            // Keep paused_for_validation true or ensure it is treated as such
            paused_for_validation: true 
        })
        .eq('game_id', gameId);

    if (error) {
        console.error("Error announcing win:", error.message);
        return { error: error.message };
    }
    
    revalidatePath(`/host/${gameId}`);
    return { success: true };
}

export async function advanceToNextStage(gameId: string) {
    const supabase = await createClient();

    const { data: currentGameState, error: fetchError } = await supabase
        .from('game_states')
        .select('current_stage_index')
        .eq('game_id', gameId)
        .single<Pick<Database['public']['Tables']['game_states']['Row'], 'current_stage_index'>>();

    if (fetchError || !currentGameState) {
         return { error: fetchError?.message || "Game state not found." };
    }

    const { data: gameDetails } = await supabase
        .from('games')
        .select('session_id, type, snowball_pot_id, stage_sequence')
        .eq('id', gameId)
        .single<Pick<Database['public']['Tables']['games']['Row'], 'session_id' | 'type' | 'snowball_pot_id' | 'stage_sequence'>>();

    if (!gameDetails) {
        return { error: "Game details not found." };
    }

    let newStageIndex = currentGameState.current_stage_index + 1;
    let newGameStatus: GameStatus = 'in_progress';

    if (newStageIndex >= (gameDetails.stage_sequence as WinStage[]).length) {
        newStageIndex = (gameDetails.stage_sequence as WinStage[]).length - 1; 
        newGameStatus = 'completed';
    }

    const { error: updateError } = await supabase
        .from('game_states')
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        .update({
            current_stage_index: newStageIndex,
            status: newGameStatus,
            paused_for_validation: false,
            display_win_type: null,
            display_win_text: null,
            display_winner_name: null,
        })
        .eq('game_id', gameId);

    if (updateError) {
        return { error: updateError.message };
    }

    // If the game is now completed, check Snowball logic (Rollover vs Reset)
    if (newGameStatus === 'completed') {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        await handleSnowballPotUpdate(supabase, gameDetails.session_id, gameId);
    } else {
        // If NOT completed, but we just finished a stage, do we check for Jackpot win reset?
        // handleSnowballPotUpdate handles "Reset if Won".
        // So we CAN call it here even if not completed, IF we want to reset immediately upon win record.
        // BUT `handleSnowballPotUpdate` also handles Rollover if NOT won.
        // We do NOT want to rollover if the game is still in progress (e.g. just Line won).
        // So we should only call it if the game is COMPLETED OR if we know a jackpot was won.
        
        // Check if jackpot was won specifically to trigger reset early?
        // The helper checks "if (jackpotWon)".
        // If jackpot won, we reset.
        // If NOT jackpot won, we rollover.
        // SO: We must ONLY call this if we are ready to potentially Rollover.
        // Which is only when the game ends.
        // What if Jackpot is won on "Full House" stage, but there are no more stages, so game ends? -> Handled by newGameStatus === 'completed'.
        
        // What if Jackpot is won, but for some reason there are more stages? (Unlikely for Snowball game).
        // Snowball game usually only has Full House.
        // So `newGameStatus` will likely be `completed`.
        
        // SAFE: Only call if completed.
    }

    revalidatePath(`/host/${gameId}`);
    return { success: true };
}

export async function recordWinner(
    sessionId: string,
    gameId: string,
    stage: WinStage,
    winnerName: string,
    prizeDescription: string | null,
    callCountAtWin: number,
    // isSnowballJackpot: boolean, // Removed, calculated server-side
    prizeGiven: boolean = false
) {
    const supabase = await createClient();
    const authResult = await authorizeHost(supabase)
    if (!authResult.authorized) return { error: authResult.error }

    // Re-calculate isSnowballJackpot on the server for security
    let actualIsSnowballJackpot = false;
    const { data: game, error: gameError } = await supabase
        .from('games')
        .select('type, snowball_pot_id, stage_sequence')
        .eq('id', gameId)
        .single<Pick<Database['public']['Tables']['games']['Row'], 'type' | 'snowball_pot_id' | 'stage_sequence'>>();
    
    if (gameError) {
        console.error("Error fetching game for snowball check:", gameError.message);
        // Continue, but actualIsSnowballJackpot remains false
    }

    if (game && game.type === 'snowball' && stage === 'Full House' && game.snowball_pot_id) {
        const { data: snowballPot, error: potError } = await supabase
            .from('snowball_pots')
            .select('current_max_calls')
            .eq('id', game.snowball_pot_id)
            .single<Pick<Database['public']['Tables']['snowball_pots']['Row'], 'current_max_calls'>>();

        if (potError) {
            console.error("Error fetching snowball pot for jackpot check:", potError.message);
            // Continue, but actualIsSnowballJackpot remains false
        }

        if (snowballPot && callCountAtWin <= snowballPot.current_max_calls) {
            actualIsSnowballJackpot = true;
        }
    }

    // Insert winner record
    const { error: winnerInsertError } = await supabase
        .from('winners')
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        .insert({
            session_id: sessionId,
            game_id: gameId,
            stage,
            winner_name: winnerName,
            prize_description: prizeDescription,
            call_count_at_win: callCountAtWin,
            is_snowball_jackpot: actualIsSnowballJackpot, // Use server-calculated value
            prize_given: prizeGiven,
        });

    if (winnerInsertError) {
        console.error("Error recording winner:", winnerInsertError.message);
        return { error: winnerInsertError.message };
    }

    // Determine display win type and text
    let displayWinType: string;
    let displayWinText: string;
    if (actualIsSnowballJackpot) {
        displayWinType = 'snowball';
        displayWinText = 'JACKPOT WIN!';
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

    // Just update the display to show the winner name. Do NOT advance stage yet.
    const { error: gameStateUpdateError } = await supabase
        .from('game_states')
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        .update({
            // paused_for_validation: true, // Should already be true, keep it so
            display_win_type: displayWinType,
            display_win_text: displayWinText,
            display_winner_name: winnerName,
        })
        .eq('game_id', gameId);

    if (gameStateUpdateError) {
        console.error("Error updating game state after winner record:", gameStateUpdateError.message);
        return { error: gameStateUpdateError.message };
    }

    revalidatePath(`/host/${sessionId}/${gameId}`); // Revalidate to show updated winner info if needed
    return { success: true };
}

export async function toggleWinnerPrizeGiven(sessionId: string, gameId: string, winnerId: string, prizeGiven: boolean) {
    const supabase = await createClient();
    const authResult = await authorizeHost(supabase)
    if (!authResult.authorized) return { error: authResult.error }
    
    const { error } = await supabase
        .from('winners')
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        .update({ prize_given: prizeGiven })
        .eq('id', winnerId);

    if (error) {
        return { error: error.message };
    }
    
    revalidatePath(`/host/${sessionId}/${gameId}`);
    return { success: true };
}

export async function skipStage(gameId: string, currentStageIndex: number, totalStages: number) {
    const supabase = await createClient();
    const authResult = await authorizeHost(supabase)
    if (!authResult.authorized) return { error: authResult.error }

    let newStageIndex = currentStageIndex + 1;
    let newStatus = 'in_progress' as GameStatus;

    if (newStageIndex >= totalStages) {
        newStageIndex = totalStages - 1; // Cap at last stage (fixed: totalStages is count, index is count-1 max)
        newStatus = 'completed'; // If skipping last stage, game ends
    }
    
    const { error } = await supabase
        .from('game_states')
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        .update({
            current_stage_index: newStageIndex,
            status: newStatus,
            paused_for_validation: false, // Clear validation pause
            display_win_type: null, // Clear any win display
            display_win_text: null,
            display_winner_name: null,
        })
        .eq('game_id', gameId);

    if (error) {
        return { error: "Error updating game state to skip stage: " + error.message };
    }

    revalidatePath(`/host/${gameId}`);
    return { success: true };
}

export async function voidLastNumber(gameId: string) {
    const supabase = await createClient();
    const authResult = await authorizeHost(supabase)
    if (!authResult.authorized) return { error: authResult.error }

    const { data: gameState, error: fetchError } = await supabase
        .from('game_states')
        .select('called_numbers, numbers_called_count, status')
        .eq('game_id', gameId)
        .single<Pick<Database['public']['Tables']['game_states']['Row'], 'called_numbers' | 'numbers_called_count' | 'status'>>();

    if (fetchError || !gameState) {
        return { error: fetchError?.message || "Game state not found." };
    }

    if (gameState.status !== 'in_progress') {
        return { error: "Cannot void number for a game not in progress." };
    }
    if (gameState.numbers_called_count === 0 || !(gameState.called_numbers as number[]).length) {
        return { error: "No numbers have been called to void." };
    }

    // Check if a winner was recorded on this number
    const { count: winnerCount, error: winnerCheckError } = await supabase
        .from('winners')
        .select('*', { count: 'exact', head: true })
        .eq('game_id', gameId)
        .eq('call_count_at_win', gameState.numbers_called_count);

    if (winnerCheckError) {
        console.error("Error checking winners for void:", winnerCheckError.message);
        return { error: "Failed to verify winner status." };
    }

    if (winnerCount && winnerCount > 0) {
        return { error: "Cannot undo: A winner was recorded on this number. Please delete the winner record first." };
    }

    const newCalledNumbers = (gameState.called_numbers as number[]).slice(0, -1); // Remove last number
    const newNumbersCalledCount = gameState.numbers_called_count - 1;

    const { error: updateError } = await supabase
        .from('game_states')
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        .update({
            called_numbers: newCalledNumbers,
            numbers_called_count: newNumbersCalledCount,
            // last_call_at: new Date().toISOString(), // Do not update timestamp for void action
            // Clear any lingering win display if voiding might affect a just-called winning number
            display_win_type: null, 
            display_win_text: null,
            display_winner_name: null,
        })
        .eq('game_id', gameId);

    if (updateError) {
        console.error("Error voiding last number:", updateError.message);
        return { error: updateError.message };
    }

    revalidatePath(`/host/${gameId}`);
    return { success: true };
}