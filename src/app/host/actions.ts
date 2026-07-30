'use server'

import { createClient } from '@/utils/supabase/server'
import { revalidatePath } from 'next/cache'
import { GameStatus, WinStage, UserRole } from '@/types/database'
import type { Database } from '@/types/database'
import type { ActionFailureCode, ActionResult } from '@/types/actions'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import { formatCashJackpotPrize, isCashJackpotGame, parseCashJackpotAmount } from '@/lib/jackpot'
import { getRequiredSelectionCountForStage } from '@/lib/win-stages'
import { DEFAULT_PUBLIC_CALL_DELAY_SECONDS, HOST_MIN_CALL_GAP_MS } from '@/lib/call-timing'
import { logActionFailure, logActionLatency } from '@/lib/log-action-failure'

type GameStateRow = Database['public']['Tables']['game_states']['Row']

/** How long a controller heartbeat stays live before another host may take over. */
const CONTROLLER_HEARTBEAT_TIMEOUT_MS = 30000

// Host-facing failure text. Short and plain, because it is read at arm's length
// on a phone behind the bar. Raw Postgres and Supabase messages never reach the
// host: they go to logActionFailure instead.
const GENERIC_ACTION_ERROR = 'Something went wrong. Please try again.'
const COULD_NOT_READ_GAME_ERROR = 'Could not read this game. Please reload.'
const STATE_MOVED_ERROR = 'The game changed while you were acting. Refreshed now.'
// Only ever shown when the pot genuinely did not move. A missing audit row is
// not a missing pot update, and must never reach the host as one.
const SNOWBALL_POT_NOT_MOVED_ERROR = 'The game finished but the snowball pot did not update. Please check the pot in Admin.'

interface MappedRpcError {
  error: string
  conflict?: true
  /** Set only where the UI must branch on the reason, never on the wording. */
  code?: ActionFailureCode
}

/**
 * Contract with supabase/migrations/20260729120000_atomic_host_mutations.sql.
 * Those functions raise short machine-readable keys, and this map is the only
 * place those keys become words a host reads. Keep the two in step.
 */
const HOST_RPC_ERRORS: Readonly<Record<string, MappedRpcError | undefined>> = {
  not_controller: { error: 'Another host is now controlling this game.', conflict: true },
  not_in_progress: { error: 'This game is not in progress.', conflict: true },
  on_break: { error: 'The game is on a break. Resume before calling.', conflict: true },
  paused_for_validation: { error: 'The game is paused for a claim check.', conflict: true },
  stage_mismatch: { error: 'The live stage has moved on. Refreshing now.', conflict: true },
  too_soon: { error: 'Just a moment, that was too quick.' },
  no_more_numbers: { error: 'All 90 balls have been called.' },
  nothing_to_void: { error: 'There is no ball to undo.' },
  winner_on_ball: {
    error: 'Cannot undo because a winner was recorded on this ball. Void that winner in the Winners and Prizes list, with a reason, then undo.',
    code: 'winner_on_ball',
  },
  wrong_session: { error: COULD_NOT_READ_GAME_ERROR },
  winner_not_found: { error: 'Could not find that winner. Please reload.' },
  game_not_found: { error: COULD_NOT_READ_GAME_ERROR },
  game_state_not_found: { error: COULD_NOT_READ_GAME_ERROR },
  unauthorized: { error: 'You do not have permission to do that.' },
}

function mapHostRpcError(rawMessage: string | null | undefined): MappedRpcError {
  // A raised message is either a bare key ('nothing_to_void') or key plus detail
  // ('too_soon:350', 'unauthorized: host or admin role required'). The detail is
  // never shown to the host; it survives in the logActionFailure line.
  const key = (rawMessage ?? '').trim().split(':')[0]
  return HOST_RPC_ERRORS[key] ?? { error: GENERIC_ACTION_ERROR }
}

/** Logs the failure and returns the host-facing result in one step. */
function failure(
  action: string,
  hostMessage: string,
  logged: unknown = hostMessage
): { success: false; error: string } {
  logActionFailure(action, logged)
  return { success: false, error: hostMessage }
}

/** The failure arm of ActionResult, whatever the success payload. */
type ActionFailure = { success: false; error: string; conflict?: true; code?: ActionFailureCode }

/**
 * Rewraps an inner action's failure for a composite action.
 *
 * Composite actions (moveToNextGameOnBreak, moveToNextGameAfterWin) call other
 * actions and used to rebuild the failure with `failure()`, which dropped
 * `conflict` and `code`. The client then never refreshed on a state conflict, so
 * the host stared at a stale screen. Both flags are carried through here.
 */
function relayFailure(
  action: string,
  inner: ActionFailure,
  fallbackMessage: string
): ActionFailure {
  const hostMessage = inner.error || fallbackMessage
  logActionFailure(action, hostMessage)
  return {
    success: false,
    error: hostMessage,
    ...(inner.conflict ? { conflict: true as const } : {}),
    ...(inner.code ? { code: inner.code } : {}),
  }
}

/** As `failure`, but tells the client the state moved so it should refresh. */
function conflictFailure(
  action: string,
  hostMessage: string,
  logged: unknown = hostMessage
): { success: false; error: string; conflict: true } {
  logActionFailure(action, logged)
  return { success: false, error: hostMessage, conflict: true }
}

/** Logs a raised Postgres error and returns its mapped host-facing text. */
function rpcFailure(
  action: string,
  rpcError: { message?: string } | null,
  startedAtMs: number
): { success: false; error: string; conflict?: true; code?: ActionFailureCode } {
  logActionFailure(action, rpcError)
  logActionLatency(action, startedAtMs)
  return { success: false, ...mapHostRpcError(rpcError?.message) }
}

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
    .single<Pick<GameStateRow, 'controlling_host_id'>>()

  if (gameStateError || !gameState) {
    // The raw Postgres message stays in the log; the host gets plain words.
    logActionFailure('requireController', gameStateError ?? 'game state not found')
    return { authorized: false, error: COULD_NOT_READ_GAME_ERROR }
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

/** Postgres unique violation. */
const UNIQUE_VIOLATION_CODE = '23505'

interface SnowballSettlementResult {
    /**
     * False ONLY when the pot itself demonstrably did not move. Three of the four
     * outcomes settle_snowball_pot can report mean the pot is already correct, so
     * none of those sets this to false.
     */
    success: boolean
    /** Diagnostic detail for the log. Never shown to the host. */
    error?: string
}

/**
 * Settles the snowball pot for a game that has just finished: reset if the
 * jackpot was won, rollover if it was not.
 *
 * One RPC, one transaction. settle_snowball_pot takes a `for update` lock on the
 * pot row, derives both new values from that row's own base/increment columns,
 * writes the audit claim and moves the pot together, and works out reset vs
 * rollover from the winners table server-side. The host names a game id and
 * nothing else: there is no value the client can choose. See
 * supabase/migrations/20260730120000_atomic_snowball_settlement.sql.
 *
 * That function is security definer, which is what lets a host-role account
 * settle while snowball_pots UPDATE and snowball_pot_history INSERT both stay
 * admin-only. Widening those policies instead would have let a host write any
 * value to the pot by hand-crafted API call.
 *
 * Once per game, still enforced by the database: the claim row carries game_id,
 * and the partial unique index on (snowball_pot_id, game_id) turns a second
 * attempt into the 'already_settled' outcome, which is how a re-opened and
 * re-ended game is stopped from inventing cash.
 *
 * The old "claim landed but the pot update then failed" gap is gone. Both writes
 * share one transaction, so a failure leaves no claim behind and the retry
 * simply works. No pot needs correcting by hand any more.
 *
 * Must be called with the cookie-based client. auth.uid() is null under the
 * service-role client, so the call would be rejected.
 */
async function handleSnowballPotUpdate(supabase: SupabaseClient<Database>, gameId: string): Promise<SnowballSettlementResult> {
    const { data, error } = await supabase.rpc('settle_snowball_pot', { p_game_id: gameId });

    if (error) {
        return { success: false, error: `Failed to settle the snowball pot: ${error.message}` };
    }

    const settlement = data?.[0];
    if (!settlement) {
        return { success: false, error: 'settle_snowball_pot returned no row' };
    }

    if (settlement.outcome === 'already_settled') {
        // Most likely a completed game re-opened and ended again. The pot is
        // correct, it simply moved earlier, so this is a success.
        logActionFailure('handleSnowballPotUpdate', 'already settled for this game, pot left unchanged');
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
      if (!authResult.authorized) return failure('startGame', authResult.error)

      const dbClient = getServiceRoleClient() || supabase;

      const { data: gameDetailsForStart, error: gameDetailsError } = await dbClient
        .from('games')
        .select('name, type, stage_sequence, prizes')
        .eq('id', gameId)
        .single<Pick<Database['public']['Tables']['games']['Row'], 'name' | 'type' | 'stage_sequence' | 'prizes'>>();

      if (gameDetailsError || !gameDetailsForStart) {
        return failure('startGame', COULD_NOT_READ_GAME_ERROR, gameDetailsError ?? 'game not found');
      }

      // 1. Check if game_state already exists
      const { data: existingGameState, error: fetchGameStateError } = await dbClient
        .from('game_states')
        .select('id, status, number_sequence, called_numbers, numbers_called_count, current_stage_index, controlling_host_id, controller_last_seen_at, call_delay_seconds')
        .eq('game_id', gameId)
        .single<Pick<Database['public']['Tables']['game_states']['Row'], 'id' | 'status' | 'number_sequence' | 'called_numbers' | 'numbers_called_count' | 'current_stage_index' | 'controlling_host_id' | 'controller_last_seen_at' | 'call_delay_seconds'>>()

      if (fetchGameStateError && fetchGameStateError.code !== 'PGRST116') {
        return failure('startGame', COULD_NOT_READ_GAME_ERROR, fetchGameStateError);
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
          return failure('startGame', "Please enter a valid cash jackpot amount.");
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
          return failure('startGame', 'Could not save the jackpot amount. Please try again.', gamePrizeError);
        }
      }

      const nowIso = new Date().toISOString();

      if (existingGameState?.status === 'in_progress') {
        const lastSeen = existingGameState.controller_last_seen_at
          ? new Date(existingGameState.controller_last_seen_at)
          : null;
        if (
          existingGameState.controlling_host_id &&
          existingGameState.controlling_host_id !== authResult.user!.id &&
          lastSeen &&
          (Date.now() - lastSeen.getTime() < CONTROLLER_HEARTBEAT_TIMEOUT_MS)
        ) {
          return failure('startGame', "Another host is currently controlling this game.");
        }

        // Bound to the status this branch was chosen for. Without it a delayed
        // request could apply a takeover to a game that has since been reset.
        const { data: takeoverRows, error: updateError } = await dbClient
          .from('game_states')
          .update({
            controlling_host_id: authResult.user!.id,
            controller_last_seen_at: nowIso,
          } satisfies Database['public']['Tables']['game_states']['Update'])
          .eq('game_id', gameId)
          .eq('status', 'in_progress')
          .select('id')

        if (updateError) {
          return failure('startGame', 'Could not take control of this game. Please try again.', updateError);
        }
        if (!takeoverRows || takeoverRows.length === 0) {
          return conflictFailure('startGame', STATE_MOVED_ERROR, 'takeover found no in_progress row');
        }
      } else if (existingGameState?.status === 'completed') {
        // Bound to 'completed'. Without it a delayed restart could re-open a game
        // another host has already started and is calling balls in.
        const { data: restartRows, error: updateError } = await dbClient
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
          .eq('status', 'completed')
          .select('id')

        if (updateError) {
          return failure('startGame', 'Could not restart this game. Please try again.', updateError);
        }
        if (!restartRows || restartRows.length === 0) {
          return conflictFailure('startGame', STATE_MOVED_ERROR, 'restart found no completed row');
        }
      } else {
        const sequence = existingGameState?.number_sequence ?? generateShuffledNumberSequence();
        const callDelaySeconds = existingGameState?.call_delay_seconds ?? DEFAULT_PUBLIC_CALL_DELAY_SECONDS;

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
          // Bound to 'not_started', and this is the destructive one: freshState
          // zeroes called_numbers and numbers_called_count. Two host devices on
          // the same unstarted game both read 'not_started'; the second, delayed
          // request must not wipe a board the first has already filled.
          const { data: freshRows, error: updateError } = await dbClient
            .from('game_states')
            .update(freshState)
            .eq('game_id', gameId)
            .eq('status', 'not_started')
            .select('id')

          if (updateError) {
            return failure('startGame', 'Could not start this game. Please try again.', updateError);
          }
          if (!freshRows || freshRows.length === 0) {
            return conflictFailure('startGame', STATE_MOVED_ERROR, 'fresh start found no not_started row');
          }
        } else {
          const { error: insertError } = await dbClient
            .from('game_states')
            .insert(freshState);

          if (insertError) {
            // game_states.game_id is unique, so a duplicate here means another
            // device created the state first. That is a conflict, not a failure.
            if (insertError.code === UNIQUE_VIOLATION_CODE) {
              return conflictFailure('startGame', STATE_MOVED_ERROR, insertError);
            }
            return failure('startGame', 'Could not start this game. Please try again.', insertError);
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
        return failure('startGame', 'Could not read this session. Please reload.', fetchSessionError ?? 'session not found');
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
          return failure('startGame', 'Could not mark this session as running. Please try again.', updateSessionError);
        }
      }

      revalidatePath(`/host`);
      revalidatePath(`/host/${sessionId}/${gameId}`);

  } catch (e) {
      return failure('startGame', GENERIC_ACTION_ERROR, e);
  }

  return { success: true, redirectTo: `/host/${sessionId}/${gameId}` };
}

export async function takeControl(gameId: string): Promise<ActionResult<{ gameState: GameStateRow }>> {
    const supabase = await createClient();
    const authResult = await authorizeHost(supabase);
    if (!authResult.authorized) return failure('takeControl', authResult.error);

    const nowIso = new Date().toISOString();
    const staleBefore = new Date(Date.now() - CONTROLLER_HEARTBEAT_TIMEOUT_MS).toISOString();

    // One conditional update, not read-then-write: the conditions that allow a
    // takeover are the same conditions the write binds, so two hosts pressing
    // "Take control" at once cannot both win. Take control when nobody holds it,
    // when we already hold it, or when the current holder's heartbeat is stale
    // (a null heartbeat is not a live lock either).
    const controlUpdate: Database['public']['Tables']['game_states']['Update'] = {
        controlling_host_id: authResult.user!.id,
        controller_last_seen_at: nowIso
    };
    const { data: rows, error: updateError } = await supabase
        .from('game_states')
        .update(controlUpdate)
        .eq('game_id', gameId)
        .or([
            'controlling_host_id.is.null',
            `controlling_host_id.eq.${authResult.user!.id}`,
            'controller_last_seen_at.is.null',
            `controller_last_seen_at.lt."${staleBefore}"`,
        ].join(','))
        .select('*');

    if (updateError) {
        return failure('takeControl', 'Could not take control of this game. Please try again.', updateError);
    }
    if (!rows || rows.length === 0) {
        return conflictFailure('takeControl', 'Another host is currently controlling this game.');
    }

    // No revalidatePath: the caller applies the returned row directly, and the
    // old `/host/${gameId}` path never existed.
    return { success: true, data: { gameState: rows[0] } };
}

export async function sendHeartbeat(gameId: string): Promise<ActionResult> {
    const supabase = await createClient();
    const controlResult = await requireController(supabase, gameId)
    if (!controlResult.authorized) return failure('sendHeartbeat', controlResult.error)

    const heartbeatUpdate: Database['public']['Tables']['game_states']['Update'] = {
        controller_last_seen_at: new Date().toISOString()
    };
    const { error } = await supabase
        .from('game_states')
        .update(heartbeatUpdate)
        .eq('game_id', gameId)
        .eq('controlling_host_id', controlResult.user!.id); // Only update if WE are the controller

    if (error) return failure('sendHeartbeat', GENERIC_ACTION_ERROR, error);

    return { success: true };
}

export async function getCurrentGameState(gameId: string): Promise<ActionResult<GameStateRow>> {
    const supabase = await createClient();
    const authResult = await authorizeHost(supabase);
    if (!authResult.authorized) return failure('getCurrentGameState', authResult.error);

    const { data: gameState, error } = await supabase
        .from('game_states')
        .select('*')
        .eq('game_id', gameId)
        .single<GameStateRow>();

    if (error && error.code !== 'PGRST116') { // PGRST116 means 'no rows found'
        return failure('getCurrentGameState', COULD_NOT_READ_GAME_ERROR, error);
    }

    // If no game state found, return null or a default
    if (!gameState) {
        return failure('getCurrentGameState', "No game state found for this game.");
    }

    return { success: true, data: gameState };
}

/**
 * Draws the next ball.
 *
 * Every check (host role, controller, status, break, claim pause, balls left and
 * the anti-double-tap gap) happens inside call_next_number under a row lock, so
 * the checks are still true at the moment of the write. HOST_MIN_CALL_GAP_MS is
 * the host gap only: the public reveal delay is call_delay_seconds, which none
 * of this touches.
 */
export async function callNextNumber(
  gameId: string
): Promise<ActionResult<{ nextNumber: number; gameState: GameStateRow }>> {
  const startedAtMs = Date.now()
  // Cookie-based client, never the service role: the function reads auth.uid().
  const supabase = await createClient()

  const { data: gameState, error: rpcError } = await supabase.rpc('call_next_number', {
    p_game_id: gameId,
    p_min_gap_ms: HOST_MIN_CALL_GAP_MS,
  })

  if (rpcError) {
    return rpcFailure('callNextNumber', rpcError, startedAtMs)
  }
  if (!gameState) {
    return failure('callNextNumber', COULD_NOT_READ_GAME_ERROR, 'call_next_number returned no row')
  }

  // The drawn ball is the last element of the committed called_numbers, so the
  // client contract keeps its nextNumber field without a second read.
  const calledNumbers = gameState.called_numbers ?? []
  const nextNumber = calledNumbers[calledNumbers.length - 1]

  if (typeof nextNumber !== 'number') {
    return failure('callNextNumber', COULD_NOT_READ_GAME_ERROR, 'call_next_number returned no called number')
  }

  logActionLatency('callNextNumber', startedAtMs)
  return { success: true, data: { nextNumber, gameState } }
}

export async function toggleBreak(gameId: string, onBreak: boolean): Promise<ActionResult<{ gameState: GameStateRow }>> {
    const supabase = await createClient()
    const controlResult = await requireController(supabase, gameId)
    if (!controlResult.authorized) return failure('toggleBreak', controlResult.error)

    const { data: gameState, error: fetchError } = await supabase
        .from('game_states')
        .select('status')
        .eq('game_id', gameId)
        .single<Pick<GameStateRow, 'status'>>();

    if (fetchError || !gameState) {
        return failure('toggleBreak', COULD_NOT_READ_GAME_ERROR, fetchError ?? 'game state not found');
    }

    // A stale host screen is the usual cause, so this is a conflict: the client
    // refreshes and shows the real state rather than treating it as a hard error.
    if (gameState.status !== 'in_progress') {
        return conflictFailure('toggleBreak', "This game is not in progress.");
    }

    // Deliberately does NOT touch last_call_at. It used to be bumped here to
    // "reflect activity", which mattered only while call_delay_seconds doubled as
    // the host gap. It is now purely the public reveal clock, so bumping it on a
    // break would push an unrevealed ball out by another call_delay_seconds, both
    // going into a break and coming out of one.
    const breakUpdate: Database['public']['Tables']['game_states']['Update'] = {
        on_break: onBreak,
        paused_for_validation: false, // Ensure we unpause if coming from validation
        display_win_type: null, // Clear any win display so "Break" shows
        display_win_text: null,
        display_winner_name: null,
    };
    // The update binds everything the prechecks asserted, so a break cannot
    // commit after another device took control or ended the game.
    const { data: rows, error: updateError } = await supabase
        .from('game_states')
        .update(breakUpdate)
        .eq('game_id', gameId)
        .eq('controlling_host_id', controlResult.user!.id)
        .eq('status', 'in_progress')
        .select('*');

    if (updateError) {
        return failure('toggleBreak', GENERIC_ACTION_ERROR, updateError);
    }
    if (!rows || rows.length === 0) {
        return conflictFailure('toggleBreak', STATE_MOVED_ERROR);
    }

    return { success: true, data: { gameState: rows[0] } };
}

export async function pauseForValidation(gameId: string): Promise<ActionResult<{ gameState: GameStateRow }>> {
    const supabase = await createClient()
    const controlResult = await requireController(supabase, gameId)
    if (!controlResult.authorized) return failure('pauseForValidation', controlResult.error)

    const validationUpdate: Database['public']['Tables']['game_states']['Update'] = {
        paused_for_validation: true,
        display_win_type: null, // Clear old win display if any
        display_win_text: null,
        display_winner_name: null,
    };
    const { data: rows, error } = await supabase
        .from('game_states')
        .update(validationUpdate)
        .eq('game_id', gameId)
        .eq('controlling_host_id', controlResult.user!.id)
        .eq('status', 'in_progress')
        .eq('on_break', false)
        .select('*');

    if (error) {
        return failure('pauseForValidation', GENERIC_ACTION_ERROR, error);
    }
    if (!rows || rows.length === 0) {
        return conflictFailure(
            'pauseForValidation',
            'Could not pause for a claim check. The game may be on a break or no longer in progress.'
        );
    }

    return { success: true, data: { gameState: rows[0] } };
}

export async function resumeGame(gameId: string): Promise<ActionResult<{ gameState: GameStateRow }>> {
    const supabase = await createClient()
    const controlResult = await requireController(supabase, gameId)
    if (!controlResult.authorized) return failure('resumeGame', controlResult.error)

    const resumeUpdate: Database['public']['Tables']['game_states']['Update'] = {
        paused_for_validation: false,
        display_win_type: null,
        display_win_text: null,
        display_winner_name: null,
    };
    const { data: rows, error } = await supabase
        .from('game_states')
        .update(resumeUpdate)
        .eq('game_id', gameId)
        .eq('controlling_host_id', controlResult.user!.id)
        .eq('status', 'in_progress')
        .select('*');

    if (error) {
        return failure('resumeGame', GENERIC_ACTION_ERROR, error);
    }
    if (!rows || rows.length === 0) {
        return conflictFailure('resumeGame', STATE_MOVED_ERROR);
    }

    return { success: true, data: { gameState: rows[0] } };
}

export async function endGame(gameId: string, sessionId: string): Promise<ActionResult<{ gameState: GameStateRow }>> {
    const supabase = await createClient()
    const controlResult = await requireController(supabase, gameId)
    if (!controlResult.authorized) return failure('endGame', controlResult.error)

    const { data: gameState, error: fetchError } = await supabase
        .from('game_states')
        .select('status')
        .eq('game_id', gameId)
        .single<Pick<GameStateRow, 'status'>>();

    if (fetchError || !gameState) {
        return failure('endGame', COULD_NOT_READ_GAME_ERROR, fetchError ?? 'game state not found');
    }

    if (gameState.status !== 'in_progress') {
        return conflictFailure('endGame', "This game is not in progress.");
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
    const { data: rows, error: updateError } = await supabase
        .from('game_states')
        .update(endUpdate)
        .eq('game_id', gameId)
        .eq('controlling_host_id', controlResult.user!.id)
        .eq('status', 'in_progress')
        .select('*');

    if (updateError) {
        return failure('endGame', GENERIC_ACTION_ERROR, updateError);
    }
    // Zero rows means the game was already ended or taken over, so the snowball
    // pot must not be settled a second time.
    if (!rows || rows.length === 0) {
        return conflictFailure('endGame', STATE_MOVED_ERROR);
    }

    // Use the shared helper for Snowball Logic. A pot failure here does not stop
    // the game ending, exactly as before, but it is no longer silent.
    const potResult = await handleSnowballPotUpdate(supabase, gameId);
    if (!potResult.success) {
        logActionFailure('endGame', potResult.error ?? 'snowball pot update failed');
    }
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
            return failure('endGame', 'The game ended but the session did not update. Please reload.', clearActiveError);
        }
    }

    revalidatePath(`/host/${sessionId}/${gameId}`); // Revalidate the specific game page
    revalidatePath(`/host`); // Revalidate the host dashboard
    return { success: true, data: { gameState: rows[0] } };
}

export async function moveToNextGameOnBreak(
    currentGameId: string,
    sessionId: string,
    cashJackpotAmountInput?: string
): Promise<ActionResult<{ redirectTo?: string; requiresCashJackpotAmount?: boolean; gameName?: string }>> {
    const supabase = await createClient();
    const controlResult = await requireController(supabase, currentGameId);
    if (!controlResult.authorized) return failure('moveToNextGameOnBreak', controlResult.error);

    const { data: sessionGames, error: sessionGamesError } = await supabase
        .from('games')
        .select('id, game_index, created_at')
        .eq('session_id', sessionId)
        .order('game_index', { ascending: true })
        .order('created_at', { ascending: true });

    if (sessionGamesError || !sessionGames) {
        return failure('moveToNextGameOnBreak', 'Could not read the games in this session. Please reload.', sessionGamesError ?? 'no games returned');
    }

    const currentGamePosition = sessionGames.findIndex((game) => game.id === currentGameId);
    if (currentGamePosition === -1) {
        return failure('moveToNextGameOnBreak', "Current game not found in this session.");
    }

    const nextGameId = sessionGames[currentGamePosition + 1]?.id;

    const { data: currentGameState, error: currentStateError } = await supabase
        .from('game_states')
        .select('status')
        .eq('game_id', currentGameId)
        .single<Pick<GameStateRow, 'status'>>();

    if (currentStateError || !currentGameState) {
        return failure('moveToNextGameOnBreak', COULD_NOT_READ_GAME_ERROR, currentStateError ?? 'game state not found');
    }

    if (currentGameState.status !== 'completed') {
        const endResult = await endGame(currentGameId, sessionId);
        if (!endResult.success) {
            return relayFailure('moveToNextGameOnBreak', endResult, "Could not finish the current game.");
        }
    }
    if (!nextGameId) {
        return { success: true, data: { redirectTo: '/host' } };
    }

    const startResult = await startGame(sessionId, nextGameId, cashJackpotAmountInput);
    if (!startResult.success) {
        return relayFailure('moveToNextGameOnBreak', startResult, "Could not start the next game.");
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
        return relayFailure('moveToNextGameOnBreak', breakResult, "Could not put the next game on a break.");
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
    if (!controlResult.authorized) return failure('moveToNextGameAfterWin', controlResult.error);

    const { data: sessionGames, error: sessionGamesError } = await supabase
        .from('games')
        .select('id, game_index, created_at')
        .eq('session_id', sessionId)
        .order('game_index', { ascending: true })
        .order('created_at', { ascending: true });

    if (sessionGamesError || !sessionGames) {
        return failure('moveToNextGameAfterWin', 'Could not read the games in this session. Please reload.', sessionGamesError ?? 'no games returned');
    }

    const currentGamePosition = sessionGames.findIndex((game) => game.id === currentGameId);
    if (currentGamePosition === -1) {
        return failure('moveToNextGameAfterWin', "Current game not found in this session.");
    }

    const nextGameId = sessionGames[currentGamePosition + 1]?.id;

    const { data: currentGameState, error: currentStateError } = await supabase
        .from('game_states')
        .select('status')
        .eq('game_id', currentGameId)
        .single<Pick<GameStateRow, 'status'>>();

    if (currentStateError || !currentGameState) {
        return failure('moveToNextGameAfterWin', COULD_NOT_READ_GAME_ERROR, currentStateError ?? 'game state not found');
    }

    if (currentGameState.status !== 'completed') {
        const endResult = await endGame(currentGameId, sessionId);
        if (!endResult.success) {
            return relayFailure('moveToNextGameAfterWin', endResult, "Could not finish the current game.");
        }
    }

    if (!nextGameId) {
        return { success: true, data: { redirectTo: '/host' } };
    }

    const startResult = await startGame(sessionId, nextGameId, cashJackpotAmountInput);
    if (!startResult.success) {
        return relayFailure('moveToNextGameAfterWin', startResult, "Could not start the next game.");
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
        return failure('validateClaim', 'Invalid game ID.');
    }
    if (!Array.isArray(claimedNumbers)) {
        return failure('validateClaim', 'Claimed numbers must be an array.');
    }
    if (claimedNumbers.some(n => !Number.isInteger(n) || n < 1 || n > 90)) {
        return failure('validateClaim', 'Each claimed number must be an integer between 1 and 90.');
    }

    const supabase = await createClient()
    const controlResult = await requireController(supabase, gameId)
    if (!controlResult.authorized) return failure('validateClaim', controlResult.error)

    const { data: gameState, error: fetchError } = await supabase
        .from('game_states')
        .select('called_numbers, current_stage_index, numbers_called_count')
        .eq('game_id', gameId)
        .single<Pick<GameStateRow, 'called_numbers' | 'current_stage_index' | 'numbers_called_count'>>();

    if (fetchError || !gameState) {
        return failure('validateClaim', COULD_NOT_READ_GAME_ERROR, fetchError ?? 'game state not found');
    }

    const { data: gameDetails, error: gameDetailsError } = await supabase
        .from('games')
        .select('stage_sequence')
        .eq('id', gameId)
        .single<Pick<Database['public']['Tables']['games']['Row'], 'stage_sequence'>>();

    if (gameDetailsError || !gameDetails) {
        return failure('validateClaim', COULD_NOT_READ_GAME_ERROR, gameDetailsError ?? 'game not found');
    }

    const stageSequence = (gameDetails.stage_sequence as string[]) || [];
    const fallbackStageName = stageSequence[stageSequence.length - 1];
    const currentStageName = stageSequence[gameState.current_stage_index] || fallbackStageName;
    const requiredSelectionCount = currentStageName
        ? getRequiredSelectionCountForStage(currentStageName)
        : null;

    if (requiredSelectionCount === null) {
        return failure('validateClaim', 'This stage is not valid for claim checking.');
    }

    if (claimedNumbers.length !== requiredSelectionCount) {
        return failure('validateClaim', `Select exactly ${requiredSelectionCount} numbers for ${currentStageName}.`);
    }

    const calledNumbers = gameState.called_numbers as number[];
    const calledNumbersSet = new Set(calledNumbers);
    const invalidNumbers: number[] = [];

    if (!gameState.numbers_called_count || calledNumbers.length === 0) {
        return failure('validateClaim', "No numbers have been called yet.");
    }

    const lastCalledNumber = calledNumbers[gameState.numbers_called_count - 1];
    if (!claimedNumbers.includes(lastCalledNumber)) {
        return failure('validateClaim', `Claim must include the last called number (${lastCalledNumber}).`);
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

export async function announceWin(gameId: string, stage: WinStage | 'snowball'): Promise<ActionResult<{ gameState: GameStateRow }>> {
    const supabase = await createClient();
    const controlResult = await requireController(supabase, gameId)
    if (!controlResult.authorized) return failure('announceWin', controlResult.error)

    const { data: gameState, error: gameStateError } = await supabase
        .from('game_states')
        .select('current_stage_index, status')
        .eq('game_id', gameId)
        .single<Pick<GameStateRow, 'current_stage_index' | 'status'>>();
    if (gameStateError || !gameState) {
        return failure('announceWin', COULD_NOT_READ_GAME_ERROR, gameStateError ?? 'game state not found');
    }
    if (gameState.status !== 'in_progress') {
        return conflictFailure('announceWin', "This game is not in progress.");
    }

    const { data: gameRow, error: gameRowError } = await supabase
        .from('games')
        .select('type, stage_sequence')
        .eq('id', gameId)
        .single<Pick<Database['public']['Tables']['games']['Row'], 'type' | 'stage_sequence'>>();
    if (gameRowError || !gameRow) {
        return failure('announceWin', COULD_NOT_READ_GAME_ERROR, gameRowError ?? 'game not found');
    }

    const expectedStage = (gameRow.stage_sequence as string[] | null)?.[gameState.current_stage_index];
    if (!expectedStage) {
        return failure('announceWin', "This stage is not set up for this game.");
    }

    if (stage === 'snowball') {
        if (gameRow.type !== 'snowball' || expectedStage !== 'Full House') {
            return failure('announceWin', "A snowball announcement only works during Full House of a snowball game.");
        }
    } else if (stage !== expectedStage) {
        return conflictFailure('announceWin', 'The live stage has moved on. Refreshing now.');
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
    // Bind the stage that was checked above as well as the status, so an
    // announcement cannot land on a stage that has since advanced.
    const { data: rows, error } = await supabase
        .from('game_states')
        .update(winUpdate)
        .eq('game_id', gameId)
        .eq('controlling_host_id', controlResult.user!.id)
        .eq('status', 'in_progress')
        .eq('current_stage_index', gameState.current_stage_index)
        .select('*');

    if (error) {
        return failure('announceWin', GENERIC_ACTION_ERROR, error);
    }
    if (!rows || rows.length === 0) {
        return conflictFailure('announceWin', STATE_MOVED_ERROR);
    }

    return { success: true, data: { gameState: rows[0] } };
}

export async function advanceToNextStage(gameId: string): Promise<ActionResult<{ gameState: GameStateRow }>> {
    const supabase = await createClient();
    const controlResult = await requireController(supabase, gameId)
    if (!controlResult.authorized) return failure('advanceToNextStage', controlResult.error)

    const { data: currentGameState, error: fetchError } = await supabase
        .from('game_states')
        .select('current_stage_index, status')
        .eq('game_id', gameId)
        .single<Pick<GameStateRow, 'current_stage_index' | 'status'>>();

    if (fetchError || !currentGameState) {
         return failure('advanceToNextStage', COULD_NOT_READ_GAME_ERROR, fetchError ?? 'game state not found');
    }

    if (currentGameState.status === 'completed') {
        return conflictFailure('advanceToNextStage', 'This game has already finished.');
    }

    const { data: gameDetails, error: gameDetailsError } = await supabase
        .from('games')
        .select('session_id, type, snowball_pot_id, stage_sequence')
        .eq('id', gameId)
        .single<Pick<Database['public']['Tables']['games']['Row'], 'session_id' | 'type' | 'snowball_pot_id' | 'stage_sequence'>>();

    if (!gameDetails) {
        return failure('advanceToNextStage', COULD_NOT_READ_GAME_ERROR, gameDetailsError ?? 'game not found');
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
    // Binding the stage index we read is what stops a double tap advancing two
    // stages: the second write finds no row to update.
    const { data: rows, error: updateError } = await supabase
        .from('game_states')
        .update(stageUpdate)
        .eq('game_id', gameId)
        .eq('controlling_host_id', controlResult.user!.id)
        .eq('current_stage_index', currentGameState.current_stage_index)
        .neq('status', 'completed')
        .select('*');

    if (updateError) {
        return failure('advanceToNextStage', GENERIC_ACTION_ERROR, updateError);
    }
    if (!rows || rows.length === 0) {
        return conflictFailure('advanceToNextStage', STATE_MOVED_ERROR);
    }

    // If the game is now completed, check Snowball logic (Rollover vs Reset).
    // This only fires when the pot itself did not move. A missing audit row is
    // logged inside the helper and never reported to the host as a pot failure.
    if (newGameStatus === 'completed') {
        const potResult = await handleSnowballPotUpdate(supabase, gameId);
        if (!potResult.success) {
            return failure('advanceToNextStage', SNOWBALL_POT_NOT_MOVED_ERROR, potResult.error);
        }
        await maybeCompleteSession(supabase, gameDetails.session_id);
    }

    return { success: true, data: { gameState: rows[0] } };
}

/**
 * Records a winner.
 *
 * The winner insert and the win announcement are one transaction inside
 * record_winner_atomic, so a failure on either half leaves nothing behind and a
 * retry cannot record the same winner twice. Snowball eligibility, the call
 * count at win, the prize text and the announcement wording are all derived in
 * the function from locked rows, never from the client.
 *
 * `snowballEligible` carries the host's explicit Eligible / Not eligible choice.
 * It can only award the jackpot while the call window is genuinely open.
 */
export async function recordWinner(
    sessionId: string,
    gameId: string,
    stage: WinStage,
    prizeDescription: string | null,
    prizeGiven: boolean = false,
    forceSnowballJackpot: boolean = false,
    snowballEligible: boolean = false
): Promise<ActionResult<{ gameState: GameStateRow }>> {
    const startedAtMs = Date.now();
    // Cookie-based client, never the service role: the function reads auth.uid().
    const supabase = await createClient();

    const { data: gameState, error: rpcError } = await supabase.rpc('record_winner_atomic', {
        p_session_id: sessionId,
        p_game_id: gameId,
        p_stage: stage,
        p_prize_description: prizeDescription,
        p_prize_given: prizeGiven,
        p_force_snowball_jackpot: forceSnowballJackpot,
        p_snowball_eligible: snowballEligible,
    });

    if (rpcError) {
        return rpcFailure('recordWinner', rpcError, startedAtMs);
    }
    if (!gameState) {
        return failure('recordWinner', COULD_NOT_READ_GAME_ERROR, 'record_winner_atomic returned no row');
    }

    revalidatePath(`/host/${sessionId}/${gameId}`);
    logActionLatency('recordWinner', startedAtMs);
    return { success: true, data: { gameState } };
}

/**
 * Marks a recorded prize as handed over, or un-marks it.
 *
 * Goes through set_winner_prize_given rather than a direct update on winners.
 * The winners UPDATE policy is admin-only, so the direct update matched zero rows
 * for a host-role account, and because it did not call .select() PostgREST
 * returned no error and no rows: the host was told the tick had saved when
 * nothing had been written. The function is security definer, writes exactly the
 * prize_given column, and returns the persisted value so a write that did not
 * land is a real error here. Voiding a win stays admin-only, see
 * supabase/migrations/20260730130000_host_can_mark_prize_given.sql.
 */
export async function toggleWinnerPrizeGiven(sessionId: string, gameId: string, winnerId: string, prizeGiven: boolean): Promise<ActionResult> {
    const startedAtMs = Date.now();
    const supabase = await createClient();
    const controlResult = await requireController(supabase, gameId)
    if (!controlResult.authorized) return failure('toggleWinnerPrizeGiven', controlResult.error)

    // Cookie-based client, never the service role: the function reads auth.uid().
    const { data: persistedPrizeGiven, error: rpcError } = await supabase.rpc('set_winner_prize_given', {
        p_winner_id: winnerId,
        p_session_id: sessionId,
        p_prize_given: prizeGiven,
    });

    if (rpcError) {
        return rpcFailure('toggleWinnerPrizeGiven', rpcError, startedAtMs);
    }
    if (persistedPrizeGiven !== prizeGiven) {
        return failure(
            'toggleWinnerPrizeGiven',
            GENERIC_ACTION_ERROR,
            `set_winner_prize_given persisted ${String(persistedPrizeGiven)}, asked for ${String(prizeGiven)}`
        );
    }

    revalidatePath(`/host/${sessionId}/${gameId}`);
    logActionLatency('toggleWinnerPrizeGiven', startedAtMs);
    return { success: true };
}

/**
 * Voids a recorded winner from the host screen, with a reason.
 *
 * Admin only, mirroring the admin-only voidWinner in
 * src/app/admin/sessions/[id]/actions.ts. This is the route that makes a blocked
 * undo recoverable: void the winner on the ball, then undo the ball.
 */
export async function voidWinnerFromHost(
    sessionId: string,
    gameId: string,
    winnerId: string,
    reason: string
): Promise<ActionResult> {
    const supabase = await createClient();
    const authResult = await authorizeHost(supabase);
    if (!authResult.authorized) return failure('voidWinnerFromHost', authResult.error);

    if (authResult.role !== 'admin') {
        return failure('voidWinnerFromHost', 'Only an admin can void a winner. Ask an admin to void it, then undo.');
    }

    if (!winnerId || winnerId.trim().length === 0) {
        return failure('voidWinnerFromHost', 'Winner ID is required.');
    }

    const trimmedReason = (reason ?? '').trim();
    if (trimmedReason.length === 0) {
        return failure('voidWinnerFromHost', 'Give a reason before voiding this winner.');
    }

    const { data: winner, error: winnerError } = await supabase
        .from('winners')
        .select('session_id')
        .eq('id', winnerId)
        .single<Pick<Database['public']['Tables']['winners']['Row'], 'session_id'>>();

    if (winnerError || !winner) {
        return failure('voidWinnerFromHost', 'Could not find that winner. Please reload.', winnerError ?? 'winner not found');
    }
    if (winner.session_id !== sessionId) {
        return failure('voidWinnerFromHost', 'That winner belongs to a different session.');
    }

    // .select() matters here. Without it an update that RLS filtered out returns
    // no error and no rows, and this action would report that as success. The
    // winners UPDATE policy is admin-only and this action is admin-only, so the
    // two agree today; the check is what keeps them honest if either moves.
    const { data: voidedWinners, error } = await supabase
        .from('winners')
        .update({ is_void: true, void_reason: trimmedReason } satisfies Database['public']['Tables']['winners']['Update'])
        .eq('id', winnerId)
        .eq('session_id', sessionId)
        .select('id');

    if (error) {
        return failure('voidWinnerFromHost', 'Could not void that winner. Please try again.', error);
    }
    if (!voidedWinners || voidedWinners.length === 0) {
        return failure(
            'voidWinnerFromHost',
            'Could not void that winner. Please reload and try again.',
            'void update matched no rows'
        );
    }

    revalidatePath(`/host/${sessionId}/${gameId}`);
    return { success: true };
}

/**
 * Skips the current stage with no winner.
 *
 * The stage index and the stage count are derived here from game_states and
 * games. They used to be passed in by the client, which meant a stale host
 * screen could move the game to a stage the server had already left.
 */
export async function skipStage(gameId: string): Promise<ActionResult<{ gameState: GameStateRow }>> {
    const supabase = await createClient();
    const controlResult = await requireController(supabase, gameId)
    if (!controlResult.authorized) return failure('skipStage', controlResult.error)

    const { data: currentGameState, error: stateError } = await supabase
        .from('game_states')
        .select('current_stage_index, status')
        .eq('game_id', gameId)
        .single<Pick<GameStateRow, 'current_stage_index' | 'status'>>();

    if (stateError || !currentGameState) {
        return failure('skipStage', COULD_NOT_READ_GAME_ERROR, stateError ?? 'game state not found');
    }

    if (currentGameState.status === 'completed') {
        return conflictFailure('skipStage', 'This game has already finished.');
    }

    const { data: gameDetails, error: gameDetailsError } = await supabase
        .from('games')
        .select('session_id, stage_sequence')
        .eq('id', gameId)
        .single<Pick<Database['public']['Tables']['games']['Row'], 'session_id' | 'stage_sequence'>>();

    if (gameDetailsError || !gameDetails) {
        return failure('skipStage', COULD_NOT_READ_GAME_ERROR, gameDetailsError ?? 'game not found');
    }

    const totalStages = (gameDetails.stage_sequence as WinStage[] | null)?.length ?? 0;
    if (totalStages === 0) {
        return failure('skipStage', 'This game has no stages set up.');
    }

    let newStageIndex = currentGameState.current_stage_index + 1;
    let newStatus = 'in_progress' as GameStatus;

    if (newStageIndex >= totalStages) {
        newStageIndex = totalStages - 1; // Cap at last stage: totalStages is a count, so the highest index is count - 1
        newStatus = 'completed'; // If skipping the last stage, the game ends
    }

    // Bind the stage index that was read, so a double tap skips one stage only.
    const { data: rows, error } = await supabase
        .from('game_states')
        .update({
            current_stage_index: newStageIndex,
            status: newStatus,
            paused_for_validation: false, // Clear validation pause
            display_win_type: null, // Clear any win display
            display_win_text: null,
            display_winner_name: null,
        } satisfies Database['public']['Tables']['game_states']['Update'])
        .eq('game_id', gameId)
        .eq('controlling_host_id', controlResult.user!.id)
        .eq('current_stage_index', currentGameState.current_stage_index)
        .neq('status', 'completed')
        .select('*');

    if (error) {
        return failure('skipStage', GENERIC_ACTION_ERROR, error);
    }
    if (!rows || rows.length === 0) {
        return conflictFailure('skipStage', STATE_MOVED_ERROR);
    }

    if (newStatus === 'completed') {
        // As in advanceToNextStage: only a genuine pot failure reaches the host.
        const potResult = await handleSnowballPotUpdate(supabase, gameId);
        if (!potResult.success) {
            return failure('skipStage', SNOWBALL_POT_NOT_MOVED_ERROR, potResult.error);
        }
        await maybeCompleteSession(supabase, gameDetails.session_id);
    }

    return { success: true, data: { gameState: rows[0] } };
}

/**
 * Takes the most recently called ball back off the board.
 *
 * The ball goes back in the bag: number_sequence is untouched while the count
 * decrements, so the next call re-draws the same number. The host confirm modal
 * says so. The winner guard, the controller check and the decrement all happen
 * under one row lock inside void_last_number, and voided winners do not block.
 */
export async function voidLastNumber(gameId: string): Promise<ActionResult<{ gameState: GameStateRow }>> {
    const startedAtMs = Date.now();
    // Cookie-based client, never the service role: the function reads auth.uid().
    const supabase = await createClient();

    const { data: gameState, error: rpcError } = await supabase.rpc('void_last_number', {
        p_game_id: gameId,
    });

    if (rpcError) {
        return rpcFailure('voidLastNumber', rpcError, startedAtMs);
    }
    if (!gameState) {
        return failure('voidLastNumber', COULD_NOT_READ_GAME_ERROR, 'void_last_number returned no row');
    }

    logActionLatency('voidLastNumber', startedAtMs);
    return { success: true, data: { gameState } };
}
