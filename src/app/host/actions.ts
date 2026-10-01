'use server'

import { randomInt } from 'node:crypto'
import { createClient } from '@/utils/supabase/server'
import { revalidatePath } from 'next/cache'
import { WinStage, UserRole } from '@/types/database'
import type { ClaimRpcResult, Database } from '@/types/database'
import type { ActionFailureCode, ActionResult } from '@/types/actions'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import { isCashJackpotGame, parseCashJackpotAmount } from '@/lib/jackpot'
import { HOST_MIN_CALL_GAP_MS } from '@/lib/call-timing'
import { logActionFailure, logActionLatency } from '@/lib/log-action-failure'
import { reportError } from '@/lib/report-error'
import { isUuid } from '@/lib/utils'
import type {
  BeginClaimCheckData,
  CheckClaimData,
  CheckClaimOutcome,
  ClaimSnapshot,
  FinishedGameData,
  SetClaimDraftData,
  UnsettledSnowballGame,
} from './claim-action-types'

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
 * Contract with supabase/migrations/20260729231945_atomic_host_mutations.sql,
 * 20260730064309_winner_idempotency_key.sql and the four migrations of
 * 1 October 2026 (20261001000100_night_lifecycle.sql,
 * 20261001000200_claim_attempts.sql, 20261001000300_jackpot_components.sql,
 * 20261001000400_claim_enforcement.sql). Those functions raise short
 * machine-readable keys, and the claim functions also return them as `code`
 * on a refusal; this map is the only place those keys become words a host
 * reads. Keep the two in step.
 *
 * An entry whose text is GENERIC_ACTION_ERROR is a client bug rather than a
 * refusal, so rpcFailure reports it instead of only logging it.
 */
const HOST_RPC_ERRORS: Readonly<Record<string, MappedRpcError | undefined>> = {
  not_controller: { error: 'Another host is now controlling this game.', conflict: true },
  not_in_progress: { error: 'This game is not in progress.', conflict: true },
  on_break: { error: 'The game is on a break. Resume before calling.', conflict: true },
  paused_for_validation: { error: 'The game is paused for a claim check.', conflict: true },

  // Night lifecycle (start_game, finish_game, end_night).
  night_ended: {
    error: 'This night has ended. An admin must set the session back to running before a game can start.',
    conflict: true,
    code: 'night_ended',
  },
  other_game_in_progress: {
    error: 'Another game is still in progress. Finish that game first.',
    conflict: true,
    code: 'other_game_in_progress',
  },
  invalid_sequence: { error: GENERIC_ACTION_ERROR, code: 'invalid_sequence' },
  session_not_found: { error: 'Could not find this session. Please reload.', code: 'session_not_found' },
  game_in_progress: {
    error: 'A game is still in progress. End that game before ending the night.',
    conflict: true,
    code: 'game_in_progress',
  },
  // The cash jackpot amount start_game saves on a fresh start of a jackpot game.
  invalid_cash_jackpot: { error: 'Please enter a valid cash jackpot amount, in pounds and pence.' },
  cash_jackpot_not_allowed: {
    error: 'A jackpot amount can only be set when a jackpot game first starts, and this one has changed. Refreshed now.',
    conflict: true,
  },
  cash_jackpot_stage_count: {
    error: 'This jackpot game is not set to Full House only, so the cash amount cannot be applied. Ask an admin to set it to Full House only.',
  },

  // Claims (begin_claim_check, set_claim_draft, check_claim, the bound undo,
  // and the checks record_winner_atomic makes on a new winner).
  attempt_required: { error: GENERIC_ACTION_ERROR, code: 'attempt_required' },
  unknown_stage: {
    error: "This stage is not set up for claim checking. Check the game's stages in Admin.",
    code: 'unknown_stage',
  },
  attempt_mismatch: {
    error: 'Another claim is being checked on this game. Showing that claim now.',
    conflict: true,
    code: 'attempt_mismatch',
  },
  stale_attempt: {
    error: 'The stage has moved on since this claim was started. Start a new claim check.',
    conflict: true,
    code: 'stale_attempt',
  },
  verdict_already_given: {
    error: 'This claim has already been checked. Use Check another claimant for a different claim.',
    conflict: true,
    code: 'verdict_already_given',
  },
  already_undone: {
    error: 'That ball has already been taken off. Checking the claim again.',
    conflict: true,
    code: 'already_undone',
  },
  not_paused: {
    error: 'The game is no longer paused for this claim. Refreshed now.',
    conflict: true,
    code: 'not_paused',
  },
  number_out_of_range: { error: 'Each number must be between 1 and 90.', code: 'number_out_of_range' },
  duplicate_numbers: { error: 'A number was tapped twice. Clear the claim and tap each number once.', code: 'duplicate_numbers' },
  too_many_numbers: { error: 'Too many numbers for this stage. Untap one first.', code: 'too_many_numbers' },
  wrong_count: { error: 'Tap exactly the numbers this stage needs, then check again.', code: 'wrong_count' },
  claim_fields_protected: { error: GENERIC_ACTION_ERROR, code: 'claim_fields_protected' },
  claim_not_checked: {
    error: 'Check this claim before recording the winner.',
    conflict: true,
    code: 'claim_not_checked',
  },
  claim_not_valid: {
    error: 'This claim is not a winner, so it cannot be recorded.',
    conflict: true,
    code: 'claim_not_valid',
  },

  // Money.
  game_not_completed: {
    error: 'The game has not finished yet, so the snowball pot cannot be settled.',
    conflict: true,
    code: 'game_not_completed',
  },
  winner_void: {
    error: 'This win has been voided, so its prize cannot be marked as given.',
    conflict: true,
    code: 'winner_void',
  },

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
  // A claim key already spent on a different game: a client bug, never a retry.
  // The wording sends the host to the winners list first, because the one thing
  // that must not happen next is a blind second attempt at the same prize.
  request_id_reused: {
    error: 'Could not record that winner. Reload the page, then check the Winners and Prizes list before recording again.',
  },
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
  const mapped = mapHostRpcError(rpcError?.message)

  // A refusal is not a fault. `not_controller`, `too_soon`, `on_break` and the
  // rest are the guards doing their job several times a night, and reporting
  // them would bury the one that matters. Only an unmapped message, meaning
  // something nobody anticipated, is worth waking anyone for.
  const isExpectedRefusal = mapped.error !== GENERIC_ACTION_ERROR
  if (!isExpectedRefusal) {
    void reportError({ scope: `host:${action}` }, rpcError)
  } else {
    logActionFailure(action, rpcError)
  }

  logActionLatency(action, startedAtMs)
  return { success: false, ...mapped }
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

/**
 * The draw order for a game: 1 to 90 shuffled with Node's crypto (Fisher-Yates
 * with an unbiased randomInt). start_game checks it is a permutation of 1 to
 * 90 before it stores it. It used to use Math.random, which is not a source a
 * money game should draw from.
 */
function generateShuffledNumberSequence(): number[] {
  const numbers = Array.from({ length: 90 }, (_, i) => i + 1);
  for (let i = numbers.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [numbers[i], numbers[j]] = [numbers[j], numbers[i]];
  }
  return numbers;
}

/** A refusal code a claim function returned with ok = false, as a host-facing failure. */
function claimRefusal(
  action: string,
  code: string,
  startedAtMs: number
): { success: false; error: string; conflict?: true; code?: ActionFailureCode } {
  const mapped = mapHostRpcError(code)
  logActionFailure(action, `refused: ${code}`)
  logActionLatency(action, startedAtMs)
  return { success: false, ...mapped }
}

/** Only whole numbers survive; the jsonb column is never trusted to be tidy. */
function toNumberList(value: unknown): number[] {
  return Array.isArray(value) ? value.filter((n): n is number => Number.isInteger(n)) : []
}

/** The claim fields every claim function returns, in the shape the host screen adopts. */
function toClaimSnapshot(result: ClaimRpcResult<string>): ClaimSnapshot {
  return {
    attemptId: result.attempt_id ?? null,
    claimNumbers: toNumberList(result.claim_numbers),
    claimResult: result.claim_result ?? null,
    claimDraftSeq: Number.isInteger(result.claim_draft_seq) ? result.claim_draft_seq : 0,
    gameState: result.game_state,
  }
}

/** A claim list from the host screen: whole numbers only, checked before any round trip. */
function isClaimNumberList(numbers: unknown): numbers is number[] {
  return Array.isArray(numbers) && numbers.length <= 90 && numbers.every((n) => Number.isInteger(n))
}

interface SnowballSettlementResult {
    /**
     * False ONLY when the pot itself demonstrably did not move. Three of the four
     * outcomes settle_snowball_pot can report mean the pot is already correct, so
     * none of those sets this to false.
     */
    success: boolean
    /** Diagnostic detail for the log. Never shown to the host. */
    error?: string
    /** The raised message, when the function refused, so the caller can map its key. */
    rpcMessage?: string
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
 * supabase/migrations/20260730065531_atomic_snowball_settlement.sql.
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
        return { success: false, error: `Failed to settle the snowball pot: ${error.message}`, rpcMessage: error.message };
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

/**
 * Settles the snowball pot for a game that has already finished.
 *
 * Every route to settlement ran inside endGame, advanceToNextStage or skipStage,
 * and all three refuse once the game is completed. So a settlement that failed,
 * for any reason including a dropped connection at exactly the wrong moment,
 * was terminal: the game was completed, the pot had not moved, and there was no
 * way to try again. The pot then advertised last week's figure until an admin
 * corrected it by hand on /admin/snowball, which is a manual cash adjustment
 * standing in for a retry.
 *
 * settle_snowball_pot is already safe to call repeatedly: the partial unique
 * index on (snowball_pot_id, game_id) turns a second attempt into
 * 'already_settled' and leaves the pot exactly where it is. So the retry needs
 * no new guard, only a route to it.
 *
 * Does not check the game status itself: settle_snowball_pot refuses with
 * game_not_completed unless the game is completed (X7), and that refusal is
 * mapped to plain words here rather than reported as a pot that did not move.
 *
 * Used by the retry banner on the host game screen and by the Settle button on
 * the host dashboard, which lists finished snowball games with no settlement
 * record, so a failed settlement survives a reload or leaving the page (X6).
 */
export async function settleSnowballPotForGame(gameId: string): Promise<ActionResult> {
    const startedAtMs = Date.now();
    const supabase = await createClient();
    const authResult = await authorizeHost(supabase);
    if (!authResult.authorized) return failure('settleSnowballPotForGame', authResult.error);

    const result = await handleSnowballPotUpdate(supabase, gameId);
    if (!result.success) {
        const mapped = mapHostRpcError(result.rpcMessage);
        if (mapped.code) {
            return rpcFailure('settleSnowballPotForGame', { message: result.rpcMessage }, startedAtMs);
        }
        return failure('settleSnowballPotForGame', SNOWBALL_POT_NOT_MOVED_ERROR, result.error);
    }

    revalidatePath('/host');
    return { success: true };
}

/**
 * The finished snowball games whose pot never settled (X6), for the Settle
 * buttons on the host dashboard, so a failed settlement survives a reload or
 * leaving the game page.
 *
 * One read through list_unsettled_snowball_games. "Settled" there is exactly
 * the test settle_snowball_pot uses for already_settled, and only games that
 * ended on or after midnight on 1 October 2026, London time, are checked:
 * before then a failed settlement was often put right by a manual pot
 * correction, which leaves no per-game record, so settling an older game here
 * could move the pot twice. The function reads the admin-only settlement
 * history as its owner and returns games only, so a host gets the real list.
 * The dashboard used to read that history directly, which only an admin could.
 *
 * No sessionId lists every night, which is what the dashboard asks for:
 * finishing the last game completes the night, so the night whose final
 * settlement failed is no longer among its ready and running sessions.
 *
 * Fails closed: a read that failed is a failure, never an empty list, so the
 * dashboard can say it could not check. Cookie client, like every host call.
 */
export async function listUnsettledSnowballGames(
    sessionId?: string
): Promise<ActionResult<UnsettledSnowballGame[]>> {
    const startedAtMs = Date.now();
    if (sessionId !== undefined && !isUuid(sessionId)) {
        return failure('listUnsettledSnowballGames', GENERIC_ACTION_ERROR, `invalid sessionId: ${sessionId}`);
    }

    try {
        const supabase = await createClient();
        const { data, error } = await supabase.rpc('list_unsettled_snowball_games', {
            p_session_id: sessionId ?? null,
        });

        if (error) {
            return rpcFailure('listUnsettledSnowballGames', error, startedAtMs);
        }

        logActionLatency('listUnsettledSnowballGames', startedAtMs);
        return {
            success: true,
            data: (data ?? []).map((row) => ({
                gameId: row.game_id,
                gameName: row.game_name,
                gameIndex: row.game_index,
                sessionName: row.session_name,
                sessionStartDate: row.session_start_date,
                endedAt: row.ended_at,
            })),
        };
    } catch (e) {
        return failure('listUnsettledSnowballGames', GENERIC_ACTION_ERROR, e);
    }
}

/**
 * Finishes a game through finish_game, then settles the snowball pot (X9, X6).
 *
 * finish_game locks the session and then the game state, completes the game,
 * clears the pause, break, win and claim, clears active_game_id if it points
 * here, and completes the session when every game is completed. That replaced
 * separate writes to game_states and sessions (and maybeCompleteSession), which
 * could leave a game half finished or a completed night with a running game.
 * It is idempotent: a retry after a lost response returns the completed game.
 *
 * Settlement stays a separate call after it, and runs on every finishing path,
 * including a repeat: settle_snowball_pot is once per game, so a repeat either
 * settles a pot that failed before or answers already_settled. A pot that did
 * not move never fails the finish: the game HAS finished, and the answer says
 * so with `snowballPotDidNotSettle` so the host screen can offer the retry.
 *
 * Cookie client only: finish_game and settle_snowball_pot read auth.uid().
 */
async function finishGameAndSettle(
    supabase: SupabaseClient<Database>,
    action: string,
    gameId: string,
    startedAtMs: number
): Promise<ActionResult<FinishedGameData>> {
    const { data, error } = await supabase.rpc('finish_game', { p_game_id: gameId });

    if (error) {
        return rpcFailure(action, error, startedAtMs);
    }
    const gameState = data?.game_state;
    if (!gameState) {
        return failure(action, COULD_NOT_READ_GAME_ERROR, 'finish_game returned no game state');
    }

    const potResult = await handleSnowballPotUpdate(supabase, gameId);
    if (!potResult.success) {
        logActionFailure(action, potResult.error ?? 'snowball pot update failed');
    }

    logActionLatency(action, startedAtMs);
    return {
        success: true,
        data: {
            gameState,
            sessionCompleted: data.session_completed === true,
            ...(potResult.success ? {} : { snowballPotDidNotSettle: true as const }),
        },
    };
}

/**
 * Starts, re-opens or takes over a game (X10, X11).
 *
 * The writes are one call to start_game, which locks the session and then the
 * game state, refuses night_ended and other_game_in_progress under that lock,
 * and then either creates the state, re-opens a completed game (stage kept) or
 * hands control to this host, before setting the session running, pointing
 * active_game_id here and stamping started_at the first time. The separate
 * game_states and sessions writes this used to make could race an end of night
 * and leave a running game in a completed night, and could re-open a game while
 * another was running.
 *
 * Cookie client only: start_game reads auth.uid() for the controller. The
 * service-role write client that used to sit here, with its silent fallback to
 * the cookie client, is gone.
 *
 * The cash jackpot amount goes to start_game too, which validates it and
 * writes the Full House prize text ("£125 Cash Jackpot") in the same
 * transaction. games UPDATE is admin only in RLS, so a host could not save it
 * from here once the service-role client went; and in one transaction a start
 * can no longer save a prize for a game that then fails to start, or start a
 * game whose prize did not save.
 *
 * What stays in TypeScript: the shuffle (with crypto; the database checks it is
 * a permutation of 1 to 90), the session pairing check, deciding whether to ask
 * for a cash jackpot amount and reading the typed text as a number, and the
 * heartbeat check before a takeover.
 */
export async function startGame(
  sessionId: string,
  gameId: string,
  cashJackpotAmountInput?: string
): Promise<ActionResult<{ requiresCashJackpotAmount?: boolean; gameName?: string }>> {
  const startedAtMs = Date.now()
  try {
      const supabase = await createClient()
      const authResult = await authorizeHost(supabase)
      if (!authResult.authorized) return failure('startGame', authResult.error)

      const { data: gameDetailsForStart, error: gameDetailsError } = await supabase
        .from('games')
        .select('session_id, name, type')
        .eq('id', gameId)
        .single<Pick<Database['public']['Tables']['games']['Row'], 'session_id' | 'name' | 'type'>>();

      if (gameDetailsError || !gameDetailsForStart) {
        return failure('startGame', COULD_NOT_READ_GAME_ERROR, gameDetailsError ?? 'game not found');
      }

      // The two ids are supplied by the caller and were never checked against
      // each other. A mismatched pair used to point one session's live game at
      // another session. start_game derives the session from the game, and
      // this refuses the mismatch before anything is written at all.
      if (gameDetailsForStart.session_id !== sessionId) {
        return failure(
          'startGame',
          COULD_NOT_READ_GAME_ERROR,
          'game does not belong to the session it was asked to start in'
        );
      }

      const { data: existingGameState, error: fetchGameStateError } = await supabase
        .from('game_states')
        .select('status, controlling_host_id, controller_last_seen_at')
        .eq('game_id', gameId)
        .single<Pick<GameStateRow, 'status' | 'controlling_host_id' | 'controller_last_seen_at'>>()

      if (fetchGameStateError && fetchGameStateError.code !== 'PGRST116') {
        return failure('startGame', COULD_NOT_READ_GAME_ERROR, fetchGameStateError);
      }

      const isFirstStartAttempt = !existingGameState || existingGameState.status === 'not_started';
      // Decided by game type alone. It used to also match a regex on the game
      // NAME, which meant an ordinary three-stage game called something like
      // "Game 5 - Mini Jackpot" prompted for a cash amount and then had all
      // three of its configured prizes overwritten with it, permanently.
      const requiresCashJackpotAmount = isFirstStartAttempt && isCashJackpotGame(gameDetailsForStart.type);
      const providedCashJackpotAmount = cashJackpotAmountInput?.trim();

      if (requiresCashJackpotAmount && !providedCashJackpotAmount) {
        return { success: true, data: { requiresCashJackpotAmount: true, gameName: gameDetailsForStart.name } };
      }

      // Only a fresh start of a jackpot game sends an amount. start_game
      // refuses one anywhere else (cash_jackpot_not_allowed), so an amount
      // typed for a game another host has started meanwhile is refused rather
      // than written over the prize the night started with. It also checks the
      // amount is positive with at most two decimals (invalid_cash_jackpot)
      // and that the game has exactly one stage (cash_jackpot_stage_count).
      let cashJackpotAmount: number | null = null;
      if (requiresCashJackpotAmount && providedCashJackpotAmount) {
        cashJackpotAmount = parseCashJackpotAmount(providedCashJackpotAmount);
        if (cashJackpotAmount === null) {
          return failure('startGame', 'Please enter a valid cash jackpot amount, in pounds and pence.');
        }
      }

      // A takeover of a game another host is still driving is refused here, as
      // before: start_game hands control to whoever calls it.
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
      }

      // A fresh start sends a new shuffle. A not_started row that already holds
      // a sequence keeps it (start_game prefers the stored one), and a re-open
      // or a takeover needs none.
      const { error: startError } = await supabase.rpc('start_game', {
        p_game_id: gameId,
        p_number_sequence: isFirstStartAttempt ? generateShuffledNumberSequence() : null,
        p_cash_jackpot_amount: cashJackpotAmount,
      });

      if (startError) {
        return rpcFailure('startGame', startError, startedAtMs);
      }

      revalidatePath(`/host`);
      revalidatePath(`/host/${sessionId}/${gameId}`);

  } catch (e) {
      return failure('startGame', GENERIC_ACTION_ERROR, e);
  }

  logActionLatency('startGame', startedAtMs);
  return { success: true, redirectTo: `/host/${sessionId}/${gameId}` };
}

/**
 * Ends the night (spec 5.1).
 *
 * end_night locks the session, refuses game_in_progress while a game is being
 * played, and otherwise marks the session completed and clears active_game_id.
 * Unplayed games stay not_started and their snowball pot is untouched. It is
 * idempotent: ending a night that has already ended returns it as it is, and
 * the first completed_at stands.
 *
 * Cookie client only, like every host function.
 */
export async function endNight(
  sessionId: string
): Promise<ActionResult<{ session: Database['public']['Tables']['sessions']['Row'] }>> {
  const startedAtMs = Date.now()
  if (!isUuid(sessionId)) {
    return failure('endNight', GENERIC_ACTION_ERROR, `invalid sessionId: ${sessionId}`)
  }

  const supabase = await createClient()
  const { data: session, error } = await supabase.rpc('end_night', { p_session_id: sessionId })

  if (error) {
    return rpcFailure('endNight', error, startedAtMs)
  }
  if (!session || session.status !== 'completed') {
    return failure('endNight', 'The night did not end. Please reload and try again.', 'end_night returned a session that is not completed')
  }

  revalidatePath('/host')
  logActionLatency('endNight', startedAtMs)
  return { success: true, data: { session } }
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
  gameId: string,
  clientRequestId: string | null = null
): Promise<ActionResult<{ nextNumber: number; gameState: GameStateRow }>> {
  const startedAtMs = Date.now()

  // Refused rather than passed through as null, exactly as recordWinner does. A
  // malformed key would be a silent downgrade to the unprotected path, which is
  // the failure this parameter exists to stop.
  if (clientRequestId !== null && !isUuid(clientRequestId)) {
    return failure('callNextNumber', GENERIC_ACTION_ERROR, `invalid clientRequestId: ${clientRequestId}`)
  }

  // Cookie-based client, never the service role: the function reads auth.uid().
  const supabase = await createClient()

  const { data: gameState, error: rpcError } = await supabase.rpc('call_next_number', {
    p_game_id: gameId,
    p_min_gap_ms: HOST_MIN_CALL_GAP_MS,
    p_client_request_id: clientRequestId,
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

/**
 * Starts a claim check for one claim attempt (spec 5.2). Replaces
 * pauseForValidation.
 *
 * The host's phone mints the attempt id when the host taps Check Claim or
 * Check another claimant. begin_claim_check pauses the game, clears the win
 * fields and stores the attempt with its stage and ball-count snapshots. The
 * attempt then binds every draft, the verdict, the one permitted undo and the
 * recorded winner, whose idempotency key it is.
 *
 * - Same attempt again (a retry after a lost response): nothing is written.
 * - A different attempt is already being checked and `newClaimant` is false:
 *   the answer is code 'attempt_mismatch' with that attempt and its draft,
 *   which the phone adopts. This is how a reloaded or taken-over phone picks
 *   up a claim in progress, so it is a success for the caller, not a failure:
 *   nothing was written and the data says exactly what to show.
 * - `newClaimant` (Check another claimant) replaces the attempt and clears the
 *   claim and the win on screen.
 */
export async function beginClaimCheck(
    gameId: string,
    attemptId: string,
    newClaimant: boolean = false
): Promise<ActionResult<BeginClaimCheckData>> {
    const startedAtMs = Date.now();
    if (!isUuid(attemptId)) {
        return failure('beginClaimCheck', GENERIC_ACTION_ERROR, `invalid attemptId: ${attemptId}`);
    }

    // Cookie-based client, never the service role: the function reads auth.uid().
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('begin_claim_check', {
        p_game_id: gameId,
        p_attempt_id: attemptId,
        p_new_claimant: newClaimant,
    });

    if (error) {
        return rpcFailure('beginClaimCheck', error, startedAtMs);
    }
    if (!data?.game_state) {
        return failure('beginClaimCheck', COULD_NOT_READ_GAME_ERROR, 'begin_claim_check returned no game state');
    }

    logActionLatency('beginClaimCheck', startedAtMs);
    return { success: true, data: { code: data.code, ...toClaimSnapshot(data) } };
}

/**
 * Stores the live draft of a claim, in tap order, for the TV and phones.
 *
 * Called by the host screen's claim draft queue (src/lib/claim-draft-queue.ts):
 * one request at a time, the newest list wins, and `seq` only goes up. A
 * sequence the server has already passed is answered 'stale_seq' and ignored,
 * so an out-of-order write can never replace a newer draft. A refusal (the
 * claim ended, the attempt was replaced, a verdict was given) comes back as a
 * failure with its code, and the queue stops.
 *
 * Correctness never depends on this: Check Win sends the full list.
 */
export async function setClaimDraft(
    gameId: string,
    attemptId: string,
    numbers: number[],
    seq: number
): Promise<ActionResult<SetClaimDraftData>> {
    const startedAtMs = Date.now();
    if (!isUuid(attemptId) || !isClaimNumberList(numbers) || !Number.isInteger(seq) || seq < 1) {
        return failure('setClaimDraft', GENERIC_ACTION_ERROR, 'invalid claim draft arguments');
    }

    const supabase = await createClient();
    const { data, error } = await supabase.rpc('set_claim_draft', {
        p_game_id: gameId,
        p_attempt_id: attemptId,
        p_numbers: numbers,
        p_seq: seq,
    });

    if (error) {
        return rpcFailure('setClaimDraft', error, startedAtMs);
    }
    if (!data) {
        return failure('setClaimDraft', COULD_NOT_READ_GAME_ERROR, 'set_claim_draft returned nothing');
    }
    if (!data.ok || (data.code !== 'saved' && data.code !== 'stale_seq')) {
        return claimRefusal('setClaimDraft', data.code, startedAtMs);
    }

    logActionLatency('setClaimDraft', startedAtMs);
    return {
        success: true,
        data: { code: data.code, claimDraftSeq: Number.isInteger(data.claim_draft_seq) ? data.claim_draft_seq : seq },
    };
}

const CHECK_CLAIM_OUTCOMES: ReadonlySet<string> = new Set<CheckClaimOutcome>(['valid', 'invalid', 'late', 'missing_last_ball']);

/**
 * The server's verdict on a claim (spec 5.2, X16). Replaces validateClaim.
 *
 * check_claim re-reads the board under the lock and, for the stage's count of
 * numbers with no duplicates, answers:
 * - 'invalid' when any number has not been called (with `invalidNumbers`);
 * - 'missing_last_ball' when every number was called but the last ball is not
 *   among them and `rejectAsLate` is false. No verdict is written: the host
 *   decides whether the claim came before that ball was announced (A1);
 * - 'late' in that same case when `rejectAsLate` is true;
 * - 'valid' otherwise.
 *
 * A retry with the same numbers once a verdict exists returns that verdict, so
 * a lost response is safe to repeat. It no longer announces the win (X5): the
 * TV shows the win only once record_winner_atomic has recorded it.
 */
export async function checkClaim(
    gameId: string,
    attemptId: string,
    numbers: number[],
    rejectAsLate: boolean = false
): Promise<ActionResult<CheckClaimData>> {
    const startedAtMs = Date.now();
    if (!isUuid(attemptId) || !isClaimNumberList(numbers)) {
        return failure('checkClaim', GENERIC_ACTION_ERROR, 'invalid claim check arguments');
    }

    const supabase = await createClient();
    const { data, error } = await supabase.rpc('check_claim', {
        p_game_id: gameId,
        p_attempt_id: attemptId,
        p_numbers: numbers,
        p_reject_as_late: rejectAsLate,
    });

    if (error) {
        return rpcFailure('checkClaim', error, startedAtMs);
    }
    if (!data?.game_state) {
        return failure('checkClaim', COULD_NOT_READ_GAME_ERROR, 'check_claim returned no game state');
    }
    if (!data.ok || !CHECK_CLAIM_OUTCOMES.has(data.code)) {
        return claimRefusal('checkClaim', data.code, startedAtMs);
    }

    logActionLatency('checkClaim', startedAtMs);
    return {
        success: true,
        data: {
            ...toClaimSnapshot(data),
            code: data.code as CheckClaimOutcome,
            invalidNumbers: toNumberList(data.invalid_numbers),
            lastNumber: Number.isInteger(data.last_number) ? data.last_number : null,
        },
    };
}

/**
 * The one undo a claim attempt may make (X17, A1): the host said the claim was
 * made before the last ball was announced.
 *
 * void_last_number, paused, needs the matching attempt, no verdict yet, the
 * undo not already used, and `expectedCount` equal to the ball count the host
 * saw. So a repeated tap, or a retry after the first undo landed, refuses with
 * already_undone instead of removing a second ball. It also refuses while a
 * live winner sits on that ball.
 */
export async function undoLastNumberForClaim(
    gameId: string,
    attemptId: string,
    expectedCount: number
): Promise<ActionResult<{ gameState: GameStateRow }>> {
    const startedAtMs = Date.now();
    if (!isUuid(attemptId) || !Number.isInteger(expectedCount) || expectedCount < 1) {
        return failure('undoLastNumberForClaim', GENERIC_ACTION_ERROR, 'invalid claim undo arguments');
    }

    // Cookie-based client, never the service role: the function reads auth.uid().
    const supabase = await createClient();
    const { data: gameState, error } = await supabase.rpc('void_last_number', {
        p_game_id: gameId,
        p_attempt_id: attemptId,
        p_expected_count: expectedCount,
    });

    if (error) {
        return rpcFailure('undoLastNumberForClaim', error, startedAtMs);
    }
    if (!gameState) {
        return failure('undoLastNumberForClaim', COULD_NOT_READ_GAME_ERROR, 'void_last_number returned no row');
    }

    logActionLatency('undoLastNumberForClaim', startedAtMs);
    return { success: true, data: { gameState } };
}

/**
 * Resumes calling after a claim check.
 *
 * Refuses with code 'stage_already_won' when a live (non-void) winner is
 * already recorded at the current stage (X4). "Close and stay paused" then
 * "Resume calling" used to carry on calling for a stage that had been won, so
 * the next claim at that stage was a second prize. The host screen offers
 * Continue to the next stage instead.
 */
export async function resumeGame(gameId: string): Promise<ActionResult<{ gameState: GameStateRow }>> {
    const supabase = await createClient()
    const controlResult = await requireController(supabase, gameId)
    if (!controlResult.authorized) return failure('resumeGame', controlResult.error)

    const { data: gameState, error: stateError } = await supabase
        .from('game_states')
        .select('current_stage_index, status')
        .eq('game_id', gameId)
        .single<Pick<GameStateRow, 'current_stage_index' | 'status'>>();

    if (stateError || !gameState) {
        return failure('resumeGame', COULD_NOT_READ_GAME_ERROR, stateError ?? 'game state not found');
    }
    if (gameState.status !== 'in_progress') {
        return conflictFailure('resumeGame', 'This game is not in progress.');
    }

    const { data: gameRow, error: gameError } = await supabase
        .from('games')
        .select('stage_sequence')
        .eq('id', gameId)
        .single<Pick<Database['public']['Tables']['games']['Row'], 'stage_sequence'>>();

    if (gameError || !gameRow) {
        return failure('resumeGame', COULD_NOT_READ_GAME_ERROR, gameError ?? 'game not found');
    }

    const stageName = (gameRow.stage_sequence as string[] | null)?.[gameState.current_stage_index];
    if (stageName) {
        // is_void is nullable, so "not void" is null or false. A plain
        // eq('is_void', false) would skip the null rows.
        const { data: stageWinners, error: winnersError } = await supabase
            .from('winners')
            .select('id')
            .eq('game_id', gameId)
            .eq('stage', stageName as WinStage)
            .or('is_void.is.null,is_void.eq.false')
            .limit(1);

        if (winnersError) {
            return failure('resumeGame', COULD_NOT_READ_GAME_ERROR, winnersError);
        }
        if (stageWinners && stageWinners.length > 0) {
            logActionFailure('resumeGame', 'refused: stage_already_won');
            return {
                success: false,
                error: `${stageName} has already been won. Continue to the next stage instead of resuming.`,
                code: 'stage_already_won',
            };
        }
    }

    const resumeUpdate: Database['public']['Tables']['game_states']['Update'] = {
        paused_for_validation: false,
        display_win_type: null,
        display_win_text: null,
        display_winner_name: null,
    };
    // Bound to the stage the winner check read, so a resume cannot land on a
    // stage that moved on in between.
    const { data: rows, error } = await supabase
        .from('game_states')
        .update(resumeUpdate)
        .eq('game_id', gameId)
        .eq('controlling_host_id', controlResult.user!.id)
        .eq('status', 'in_progress')
        .eq('current_stage_index', gameState.current_stage_index)
        .select('*');

    if (error) {
        return failure('resumeGame', GENERIC_ACTION_ERROR, error);
    }
    if (!rows || rows.length === 0) {
        return conflictFailure('resumeGame', STATE_MOVED_ERROR);
    }

    return { success: true, data: { gameState: rows[0] } };
}

/**
 * Ends the game with no further winner, through finish_game (X9), then settles
 * the snowball pot. Completes the session too when this was the last game to
 * finish. A pot that did not move is reported with `snowballPotDidNotSettle`,
 * never as a failure: the game has ended.
 */
export async function endGame(
    gameId: string,
    sessionId: string
): Promise<ActionResult<FinishedGameData>> {
    const startedAtMs = Date.now();
    // Cookie-based client, never the service role: finish_game reads auth.uid()
    // and checks the controller under its lock.
    const supabase = await createClient()

    const finished = await finishGameAndSettle(supabase, 'endGame', gameId, startedAtMs);
    if (!finished.success) return finished;

    revalidatePath(`/host/${sessionId}/${gameId}`);
    revalidatePath(`/host`);
    return finished;
}

/** What a move to the next game reports. The current game has finished whenever this succeeds. */
interface NextGameData {
    redirectTo?: string
    requiresCashJackpotAmount?: boolean
    gameName?: string
    /** The finished game's snowball pot did not move: offer the retry before navigating (X6). */
    snowballPotDidNotSettle?: true
}

export async function moveToNextGameOnBreak(
    currentGameId: string,
    sessionId: string,
    cashJackpotAmountInput?: string
): Promise<ActionResult<NextGameData>> {
    const startedAtMs = Date.now();
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

    // Every time, not only when the game still looks unfinished: finish_game is
    // idempotent, and the settlement after it is what retries a pot that did not
    // move on an earlier attempt (X6).
    const finished = await finishGameAndSettle(supabase, 'moveToNextGameOnBreak', currentGameId, startedAtMs);
    if (!finished.success) {
        return relayFailure('moveToNextGameOnBreak', finished, "Could not finish the current game.");
    }
    const potFlag = finished.data?.snowballPotDidNotSettle ? { snowballPotDidNotSettle: true as const } : {};

    if (!nextGameId) {
        revalidatePath(`/host`);
        return { success: true, data: { redirectTo: '/host', ...potFlag } };
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
                ...potFlag,
            },
        };
    }

    const breakResult = await toggleBreak(nextGameId, true);
    if (!breakResult.success) {
        return relayFailure('moveToNextGameOnBreak', breakResult, "Could not put the next game on a break.");
    }

    revalidatePath(`/host/${sessionId}/${nextGameId}`);
    revalidatePath(`/host`);

    return { success: true, data: { redirectTo: `/host/${sessionId}/${nextGameId}`, ...potFlag } };
}

/**
 * Finishes the current game and starts the next one. On the last game of the
 * session this is "End Game & Finish Session" (spec 5.1): finish_game, then
 * end_night if the session is still open (it is when a game was left unplayed,
 * because finish_game only completes the session once every game has).
 */
export async function moveToNextGameAfterWin(
    currentGameId: string,
    sessionId: string,
    cashJackpotAmountInput?: string
): Promise<ActionResult<NextGameData>> {
    const startedAtMs = Date.now();
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

    // Every time, as in moveToNextGameOnBreak: idempotent, and it retries the
    // settlement of a pot that did not move before.
    const finished = await finishGameAndSettle(supabase, 'moveToNextGameAfterWin', currentGameId, startedAtMs);
    if (!finished.success) {
        return relayFailure('moveToNextGameAfterWin', finished, "Could not finish the current game.");
    }
    const potFlag = finished.data?.snowballPotDidNotSettle ? { snowballPotDidNotSettle: true as const } : {};

    if (!nextGameId) {
        if (!finished.data?.sessionCompleted) {
            const nightResult = await endNight(sessionId);
            if (!nightResult.success) {
                return relayFailure('moveToNextGameAfterWin', nightResult, 'The game finished but the night did not end. End the night from the host console.');
            }
        }
        revalidatePath(`/host`);
        return { success: true, data: { redirectTo: '/host', ...potFlag } };
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
                ...potFlag,
            },
        };
    }

    revalidatePath(`/host/${sessionId}/${nextGameId}`);
    revalidatePath(`/host`);

    return { success: true, data: { redirectTo: `/host/${sessionId}/${nextGameId}`, ...potFlag } };
}

/**
 * Moves the game on one stage, and optionally starts a break in the same call.
 *
 * `expectedStageIndex` is the retry contract, and it is the whole point of this
 * signature. The client sends the stage index it was looking at when the host
 * tapped, and holds that value fixed across every retry of the same tap.
 *
 * Without it, a request that committed server-side but lost its response on pub
 * wifi was unrecoverable in the worst way: the host saw the button return to
 * idle with no message, tapped again, and the second call re-read the now
 * advanced index, bound to it, and advanced AGAIN. A whole stage was skipped
 * with its prize unawarded. Binding `.eq('current_stage_index', ...)` to a
 * freshly read value defends against two devices, but not against the same
 * device retrying, because the fresh read moves with the state.
 *
 * With it, a retry arrives carrying the ORIGINAL index, sees the state is
 * already exactly one stage past it, and reports success without writing
 * anything. That is the same shape as the claim key on recordWinner: the retry
 * is safe because the server can tell it is a retry.
 *
 * `putOnBreak` folds "Continue and Take Break" into one round trip. It used to
 * be two calls from the client, so a break request that failed after a
 * successful advance left the stage moved and the retry advanced again. Toggling
 * a break on is naturally idempotent, so the combined call is safe to repeat.
 */
export async function advanceToNextStage(
    gameId: string,
    expectedStageIndex: number,
    putOnBreak: boolean = false
): Promise<ActionResult<{ gameState: GameStateRow; sessionCompleted?: boolean; snowballPotDidNotSettle?: true }>> {
    const startedAtMs = Date.now();
    if (!Number.isInteger(expectedStageIndex) || expectedStageIndex < 0) {
        return failure('advanceToNextStage', GENERIC_ACTION_ERROR, `invalid expectedStageIndex: ${expectedStageIndex}`);
    }

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

    const { data: gameDetails, error: gameDetailsError } = await supabase
        .from('games')
        .select('stage_sequence')
        .eq('id', gameId)
        .single<Pick<Database['public']['Tables']['games']['Row'], 'stage_sequence'>>();

    if (!gameDetails) {
        return failure('advanceToNextStage', COULD_NOT_READ_GAME_ERROR, gameDetailsError ?? 'game not found');
    }

    const totalStages = (gameDetails.stage_sequence as WinStage[] | null)?.length ?? 0;
    if (totalStages === 0) {
        return failure('advanceToNextStage', 'This game has no stages set up.');
    }

    // The last stage: moving on finishes the game, through finish_game (X9).
    // It used to write status 'completed' here and then settle and complete the
    // session in separate calls, so a failure between them left the game half
    // finished. finish_game is idempotent, so a retry after a lost response
    // finds the game completed and simply reports it.
    if (expectedStageIndex + 1 >= totalStages) {
        if (currentGameState.current_stage_index !== expectedStageIndex) {
            return conflictFailure(
                'advanceToNextStage',
                STATE_MOVED_ERROR,
                `expected stage ${expectedStageIndex}, found ${currentGameState.current_stage_index}`
            );
        }
        return finishGameAndSettle(supabase, 'advanceToNextStage', gameId, startedAtMs);
    }

    // Where the requested advance was always going to land.
    const intendedStageIndex = expectedStageIndex + 1;

    if (currentGameState.current_stage_index !== expectedStageIndex) {
        // Already where this call was trying to get to: this is a retry of a
        // request that committed and lost its answer. Report the truth rather
        // than advancing a second time.
        if (currentGameState.current_stage_index === intendedStageIndex) {
            // A retry of a request that committed and lost its answer. Nothing
            // is advanced. The break is still applied if it was asked for and
            // did not land, because toggling a break on is idempotent.
            if (putOnBreak) {
                await supabase
                    .from('game_states')
                    .update({ on_break: true } satisfies Database['public']['Tables']['game_states']['Update'])
                    .eq('game_id', gameId)
                    .eq('controlling_host_id', controlResult.user!.id)
                    .eq('status', 'in_progress')
                    .select('id');
            }

            const { data: settledState, error: settledError } = await supabase
                .from('game_states')
                .select('*')
                .eq('game_id', gameId)
                .single<GameStateRow>();

            if (settledError || !settledState) {
                return failure('advanceToNextStage', COULD_NOT_READ_GAME_ERROR, settledError ?? 'game state not found');
            }

            // Logged, not shown. The host asked for one advance and got one; the
            // fact that it took two attempts is a diagnostic, not their problem.
            logActionFailure('advanceToNextStage', `retry absorbed: already at stage ${intendedStageIndex}, nothing written`);
            return { success: true, data: { gameState: settledState } };
        }
        return conflictFailure(
            'advanceToNextStage',
            STATE_MOVED_ERROR,
            `expected stage ${expectedStageIndex}, found ${currentGameState.current_stage_index}`
        );
    }

    if (currentGameState.status === 'completed') {
        return conflictFailure('advanceToNextStage', 'This game has already finished.');
    }

    const stageUpdate: Database['public']['Tables']['game_states']['Update'] = {
        current_stage_index: intendedStageIndex,
        paused_for_validation: false,
        display_win_type: null,
        display_win_text: null,
        display_winner_name: null,
        // A break requested alongside the advance is applied in the same write,
        // so there is no window in which the stage has moved and the break has
        // not.
        ...(putOnBreak ? { on_break: true } : {}),
    };
    // Bound to the index the CLIENT named, not to a freshly read one. That is
    // what makes a retry inert rather than a second advance.
    const { data: rows, error: updateError } = await supabase
        .from('game_states')
        .update(stageUpdate)
        .eq('game_id', gameId)
        .eq('controlling_host_id', controlResult.user!.id)
        .eq('current_stage_index', expectedStageIndex)
        .eq('status', 'in_progress')
        .select('*');

    if (updateError) {
        return failure('advanceToNextStage', GENERIC_ACTION_ERROR, updateError);
    }
    if (!rows || rows.length === 0) {
        return conflictFailure('advanceToNextStage', STATE_MOVED_ERROR);
    }

    return { success: true, data: { gameState: rows[0] } };
}

/**
 * Records a winner.
 *
 * The winner insert and the win announcement are one transaction inside
 * record_winner_atomic, so a failure on either half leaves nothing behind.
 * Snowball eligibility, the call count at win, the prize text and the
 * announcement wording are all derived in the function from locked rows, never
 * from the client.
 *
 * `clientRequestId` is the claim ATTEMPT id: the one the host's phone minted
 * for begin_claim_check and that check_claim gave a 'valid' verdict (spec 5.2).
 * It is the winner's idempotency key, so a call that committed but lost its
 * response can be repeated with the same attempt, after a reload, the next
 * stage or a takeover, and the function inserts nothing and returns the state
 * as it stands. A tie is a separate attempt (Check another claimant), so both
 * winners still save. From 20261001000400_claim_enforcement.sql a new winner
 * without that checked, valid attempt is refused (claim_not_checked,
 * attempt_mismatch, stale_attempt, claim_not_valid). The one exemption is
 * Manual Snowball Win (`forceSnowballJackpot`), which keeps its own key and is
 * only accepted for a snowball Full House inside the open jackpot window.
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
    snowballEligible: boolean = false,
    clientRequestId: string | null = null
): Promise<ActionResult<{ gameState: GameStateRow }>> {
    const startedAtMs = Date.now();

    // Refused rather than passed through as null. A malformed key would be a
    // silent downgrade to the unprotected path, which is exactly the failure this
    // parameter exists to stop, and it is a client bug the host cannot act on.
    if (clientRequestId !== null && !isUuid(clientRequestId)) {
        return failure('recordWinner', GENERIC_ACTION_ERROR, `invalid clientRequestId: ${clientRequestId}`);
    }

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
        p_client_request_id: clientRequestId,
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
 * supabase/migrations/20260730065446_host_can_mark_prize_given.sql.
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
export async function skipStage(
    gameId: string,
    expectedStageIndex: number
): Promise<ActionResult<{ gameState: GameStateRow; sessionCompleted?: boolean; snowballPotDidNotSettle?: true }>> {
    const startedAtMs = Date.now();
    // Same retry contract as advanceToNextStage, for the same reason: a lost
    // response used to turn a second tap into a second skipped stage, and
    // skipping a stage means a prize goes unawarded with nothing recording it.
    if (!Number.isInteger(expectedStageIndex) || expectedStageIndex < 0) {
        return failure('skipStage', GENERIC_ACTION_ERROR, `invalid expectedStageIndex: ${expectedStageIndex}`);
    }

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

    const { data: gameDetails, error: gameDetailsError } = await supabase
        .from('games')
        .select('stage_sequence')
        .eq('id', gameId)
        .single<Pick<Database['public']['Tables']['games']['Row'], 'stage_sequence'>>();

    if (gameDetailsError || !gameDetails) {
        return failure('skipStage', COULD_NOT_READ_GAME_ERROR, gameDetailsError ?? 'game not found');
    }

    const totalStages = (gameDetails.stage_sequence as WinStage[] | null)?.length ?? 0;
    if (totalStages === 0) {
        return failure('skipStage', 'This game has no stages set up.');
    }

    // Skipping the last stage ends the game, through finish_game, exactly as a
    // final-stage advance does (X9). finish_game is idempotent, so a retry
    // after a lost response reports the finished game rather than failing.
    if (expectedStageIndex + 1 >= totalStages) {
        if (currentGameState.current_stage_index !== expectedStageIndex) {
            return conflictFailure(
                'skipStage',
                STATE_MOVED_ERROR,
                `expected stage ${expectedStageIndex}, found ${currentGameState.current_stage_index}`
            );
        }
        return finishGameAndSettle(supabase, 'skipStage', gameId, startedAtMs);
    }

    const intendedStageIndex = expectedStageIndex + 1;

    if (currentGameState.current_stage_index !== expectedStageIndex) {
        if (currentGameState.current_stage_index === intendedStageIndex) {
            const { data: settledState, error: settledError } = await supabase
                .from('game_states')
                .select('*')
                .eq('game_id', gameId)
                .single<GameStateRow>();

            if (settledError || !settledState) {
                return failure('skipStage', COULD_NOT_READ_GAME_ERROR, settledError ?? 'game state not found');
            }

            logActionFailure('skipStage', `retry absorbed: already at stage ${intendedStageIndex}, nothing written`);
            return { success: true, data: { gameState: settledState } };
        }
        return conflictFailure(
            'skipStage',
            STATE_MOVED_ERROR,
            `expected stage ${expectedStageIndex}, found ${currentGameState.current_stage_index}`
        );
    }

    if (currentGameState.status === 'completed') {
        return conflictFailure('skipStage', 'This game has already finished.');
    }

    // Bound to the index the CLIENT named, so a retry finds no row to update.
    const { data: rows, error } = await supabase
        .from('game_states')
        .update({
            current_stage_index: intendedStageIndex,
            paused_for_validation: false, // Clear validation pause
            display_win_type: null, // Clear any win display
            display_win_text: null,
            display_winner_name: null,
        } satisfies Database['public']['Tables']['game_states']['Update'])
        .eq('game_id', gameId)
        .eq('controlling_host_id', controlResult.user!.id)
        .eq('current_stage_index', expectedStageIndex)
        .eq('status', 'in_progress')
        .select('*');

    if (error) {
        return failure('skipStage', GENERIC_ACTION_ERROR, error);
    }
    if (!rows || rows.length === 0) {
        return conflictFailure('skipStage', STATE_MOVED_ERROR);
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
