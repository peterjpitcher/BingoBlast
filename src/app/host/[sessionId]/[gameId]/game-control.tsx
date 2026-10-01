"use client";

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import type { PostgrestError } from '@supabase/supabase-js';
import { ClaimResult, Database, UserRole } from '@/types/database';
import { createClient } from '@/utils/supabase/client';
import { callNextNumber, toggleBreak, recordWinner, skipStage, voidLastNumber, resumeGame, toggleWinnerPrizeGiven, takeControl, sendHeartbeat, moveToNextGameOnBreak, moveToNextGameAfterWin, advanceToNextStage, voidWinnerFromHost, endGame, settleSnowballPotForGame, beginClaimCheck, setClaimDraft, checkClaim, undoLastNumberForClaim } from '@/app/host/actions';
import type { ClaimSnapshot } from '@/app/host/claim-action-types';
import type { ActionFailureCode, ActionResult } from '@/types/actions';
import { createClaimDraftQueue, type ClaimDraftQueue, type ClaimDraftQueueState } from '@/lib/claim-draft-queue';
import { createPollRunner } from '@/lib/poll-runner';
import { describeWinnerTotal, winnerTotalPence } from '@/lib/money';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Modal } from '@/components/ui/modal';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { BingoBall } from '@/components/ui/bingo-ball';
import { useWakeLock } from '@/hooks/wake-lock';
import { useConnectionHealth } from '@/hooks/use-connection-health';
import { useRealtimeChannel } from '@/hooks/use-realtime-channel';
import { useBuildCheck } from '@/hooks/use-build-check';
import { NewVersionBanner } from '@/components/new-version-banner';
import { ConnectionBanner } from '@/components/connection-banner';
import { formatPounds, getSnowballCallsLabel, getSnowballCallsRemaining, isSnowballJackpotEligible } from '@/lib/snowball';
import { isFreshGameState } from '@/lib/game-state-version';
import { getRequiredSelectionCountForStage } from '@/lib/win-stages';
import { logError } from '@/lib/log-error';
import { getNumberNickname } from '@/lib/number-nicknames';
import { newClaimRequestId } from '@/lib/claim-request-id';
import { PreGameBriefing } from '@/components/host/pre-game-briefing';

type Game = Database['public']['Tables']['games']['Row'];
type GameState = Database['public']['Tables']['game_states']['Row'];
type SnowballPot = Database['public']['Tables']['snowball_pots']['Row'];
type Winner = Database['public']['Tables']['winners']['Row'];
type SessionWinner = Winner & {
    game: Pick<Game, 'id' | 'name' | 'game_index'> | null;
};

/** One host poll of the game state: the query's own answer, never thrown. */
interface GameStatePoll {
    data: GameState | null;
    error: PostgrestError | null;
}

/**
 * A draft refusal that retrying cannot fix: the claim ended, the attempt was
 * replaced, a verdict was given, the stage moved or the list itself is wrong.
 * The draft queue stops on these instead of retrying for ever. Anything else,
 * including a dropped connection, is retried.
 */
const PERMANENT_DRAFT_REFUSALS: ReadonlySet<ActionFailureCode | undefined> = new Set<ActionFailureCode>([
    'not_paused',
    'attempt_mismatch',
    'verdict_already_given',
    'stale_attempt',
    'number_out_of_range',
    'duplicate_numbers',
    'too_many_numbers',
    'unknown_stage',
]);

/** The missing_last_ball decision (A1), captured when check_claim asks for it. */
interface MissingLastBallPrompt {
    lastNumber: number;
    /** The ball count the host saw, which binds the one undo to exactly this ball. */
    expectedCount: number;
    /** False once this attempt has used its undo: then only "reject as late" is left. */
    undoAvailable: boolean;
}

interface GameControlProps {
    sessionId: string;
    gameId: string;
    game: Game;
    initialGameState: GameState;
    currentUserId: string;
    currentUserRole: UserRole;
    isFirstGameOfSession: boolean;
    isLastGameOfSession: boolean;
}

export default function GameControl({ sessionId, gameId, game, initialGameState, currentUserId, currentUserRole, isFirstGameOfSession, isLastGameOfSession }: GameControlProps) {
    const router = useRouter();
    const [currentGameState, setCurrentGameState] = useState<GameState>(initialGameState);
    const [currentSnowballPot, setCurrentSnowballPot] = useState<SnowballPot | null>(null);
    // 'not-applicable' means this game has no pot linked, which is a fact.
    // 'failed' means this game HAS a pot and we could not read it, which is an
    // outage. Collapsing the two into "currentSnowballPot is null" is what let a
    // failed request quietly withhold a jackpot.
    const [potLoadState, setPotLoadState] = useState<'not-applicable' | 'loading' | 'loaded' | 'failed'>('not-applicable');
    const [isCallingNumber, setIsCallingNumber] = useState(false);
    const [actionError, setActionError] = useState<string | null>(null);
    const [showValidationModal, setShowValidationModal] = useState(false);
    // The claim on screen (spec 5.2). The numbers are in TAP order, because
    // that is the order the TV and phones show them as the caller reads them.
    const [selectedNumbers, setSelectedNumbers] = useState<number[]>([]);
    // The server's verdict for this attempt, or null while none has been given.
    const [claimVerdict, setClaimVerdict] = useState<ClaimResult | null>(null);
    // check_claim answered missing_last_ball: the host decides (A1).
    const [missingLastBall, setMissingLastBall] = useState<MissingLastBallPrompt | null>(null);
    const [isUndoingForClaim, setIsUndoingForClaim] = useState(false);
    // Short guidance inside the claim modal: an adopted claim, a full grid.
    const [claimNotice, setClaimNotice] = useState<string | null>(null);
    // The draft queue's state, for "TV not updated, retrying".
    const [draftQueueState, setDraftQueueState] = useState<ClaimDraftQueueState>('idle');
    const [showWinnerModal, setShowWinnerModal] = useState(false);
    const [showManualSnowballModal, setShowManualSnowballModal] = useState(false);
    const [showPostWinModal, setShowPostWinModal] = useState(false);
    const [showSessionWinnersModal, setShowSessionWinnersModal] = useState(false);
    const [showCashJackpotModal, setShowCashJackpotModal] = useState(false);
    const [cashJackpotAmount, setCashJackpotAmount] = useState('');
    const [cashJackpotGameName, setCashJackpotGameName] = useState('Jackpot Game');
    const [cashJackpotMode, setCashJackpotMode] = useState<'next' | 'break'>('next');
    const [isSubmittingCashJackpot, setIsSubmittingCashJackpot] = useState(false);
    const [prizeGiven, setPrizeGiven] = useState(false);
    // Tri-state on purpose (T4.6): null means the host has not chosen yet, and
    // Confirm Winner stays disabled. There is no default, because a wrong default
    // either gives away the jackpot or withholds it.
    const [snowballEligibleChoice, setSnowballEligibleChoice] = useState<boolean | null>(null);
    const [isRecordingWinner, setIsRecordingWinner] = useState(false);
    const [isRecordingSnowballWinner, setIsRecordingSnowballWinner] = useState(false);
    const [currentWinners, setCurrentWinners] = useState<Winner[]>([]);
    const [sessionWinners, setSessionWinners] = useState<SessionWinner[]>([]);
    // The recovery below must not reopen a claim that is already a recorded
    // winner, so it waits until this game's winners have been read once.
    const [winnersLoaded, setWinnersLoaded] = useState(false);

    // The claim ATTEMPT (spec 5.2). Minted on this phone when the host taps
    // Check Claim or Check another claimant, stored by begin_claim_check, and
    // from then on it binds every draft, the verdict, the one permitted undo
    // and the recorded winner: it IS record_winner_atomic's idempotency key.
    // A committed save retried after a lost response, a reload, the next stage
    // or a takeover returns the existing winner instead of a second one. It
    // replaced the React-ref claim key, which a reload or a takeover lost.
    //
    // State for rendering, mirrored in a ref for handlers that must read the
    // latest value rather than the one their render captured.
    const [claimAttemptId, setClaimAttemptId] = useState<string | null>(null);
    const claimAttemptIdRef = useRef<string | null>(null);
    // Sends each tap to set_claim_draft: one request at a time, newest list wins.
    const claimDraftQueueRef = useRef<ClaimDraftQueue | null>(null);
    // Attempts this tab has finished with (recorded, or closed by the host once
    // the stage was won), so the recovery below does not keep reopening them.
    const dismissedAttemptIdsRef = useRef<Set<string>>(new Set());
    // Where a finishing move was heading when the snowball pot did not settle
    // (X6): the host sees the retry banner first, then carries on from it.
    const [pendingRedirect, setPendingRedirect] = useState<string | null>(null);
    /**
     * Idempotency key for one intended ball, set on the tap and cleared as soon
     * as any response arrives. It survives only a transport failure, which is
     * exactly the case where the host will tap again and must not draw twice.
     */
    const callRequestIdRef = useRef<string | null>(null);
    // Manual Snowball Win keeps its own key: it is the one route that records a
    // winner without a checked claim (a snowball Full House inside the open
    // jackpot window, checked under the lock by record_winner_atomic).
    const manualSnowballRequestIdRef = useRef<string | null>(null);

    /** The manual award's key, minted on first use if a path missed it. */
    const ensureClaimRequestId = (ref: React.RefObject<string | null>): string => {
        ref.current ??= newClaimRequestId();
        return ref.current;
    };

    // Undo confirm modal (T4.3): replaces the blocking window.confirm.
    // Set when endGame reports that the game ended but the snowball pot did not
    // move. Before this there was no route back at all: every path to settlement
    // refuses once the game is completed, so a settlement that failed was
    // terminal and the pot advertised last week's figure until an admin
    // corrected it by hand.
    const [potNeedsSettling, setPotNeedsSettling] = useState(false);
    const [isSettlingPot, setIsSettlingPot] = useState(false);
    const [showSkipConfirm, setShowSkipConfirm] = useState(false);
    // The stage the Post Win and Skip modals are about, captured when each one
    // opens and used for every tap until the modal closes (X2).
    //
    // The expected stage used to be read from the live state at the moment of
    // the tap. After an advance that committed but lost its response, the poll
    // moved the live state on a stage, so the retry named the NEW stage and the
    // server advanced again: a whole stage skipped with its prize unawarded.
    // Captured here, a retry names the stage the host actually won or skipped,
    // and the server absorbs it as a repeat.
    //
    // State rather than a ref because the modals' own labels (Continue Playing
    // or Move to Next Game, the skip title) must come from the same captured
    // stage. It is only ever set as a modal opens, so every handler render
    // reads the captured value.
    const [postWinStageIndex, setPostWinStageIndex] = useState<number | null>(null);
    const [skipStageIndex, setSkipStageIndex] = useState<number | null>(null);
    const [skipError, setSkipError] = useState<string | null>(null);
    const [showEndGameModal, setShowEndGameModal] = useState(false);
    const [isEndingGame, setIsEndingGame] = useState(false);
    const [endGameError, setEndGameError] = useState<string | null>(null);
    const [showUndoModal, setShowUndoModal] = useState(false);
    // Undo refusals are held separately so they can render inside the undo modal.
    // `code` lets the modal offer the Winners and Prizes route out without
    // pattern-matching the wording, which is copy and will be reworded.
    const [undoError, setUndoError] = useState<{ message: string; code?: ActionFailureCode } | null>(null);

    // Void winner confirm (T4.7).
    const [voidWinnerTarget, setVoidWinnerTarget] = useState<SessionWinner | null>(null);
    const [voidWinnerReason, setVoidWinnerReason] = useState('');
    const [voidWinnerError, setVoidWinnerError] = useState<string | null>(null);
    const [isVoidingWinner, setIsVoidingWinner] = useState(false);

    // Per-action in-flight flags (T4.2). A publican taps twice on a phone, so
    // every mutation gets its own flag and its own disabled control.
    const [isTakingControl, setIsTakingControl] = useState(false);
    const [isTogglingBreak, setIsTogglingBreak] = useState(false);
    const [isVoiding, setIsVoiding] = useState(false);
    const [isAdvancing, setIsAdvancing] = useState(false);
    const [isSkipping, setIsSkipping] = useState(false);
    const [isResuming, setIsResuming] = useState(false);
    const [isPausing, setIsPausing] = useState(false);
    const [isMovingGame, setIsMovingGame] = useState(false);
    const [isCheckingWin, setIsCheckingWin] = useState(false);

    // Any Post Win choice in flight disables all of them, so the host cannot
    // advance a stage and move to the next game with two quick taps.
    const isPostWinBusy = isAdvancing || isMovingGame || isPausing || isTogglingBreak;

    // Everything a page reload would silently destroy. The connection banner's
    // auto-refresh is suppressed while any of it is true: a claim half tapped
    // into the grid is the obvious one, but a modal open at all means the host
    // is mid-decision, and a request in flight means the answer is still coming.
    // Before this guard, thirty seconds of flaky wifi wiped a claim the host was
    // reading off a punter's book.
    const isAnyModalOpen =
        showValidationModal || showWinnerModal || showManualSnowballModal ||
        showPostWinModal || showSessionWinnersModal || showCashJackpotModal ||
        showUndoModal || showEndGameModal || showSkipConfirm || voidWinnerTarget !== null ||
        missingLastBall !== null;
    const isAnyRequestInFlight =
        isCallingNumber || isRecordingWinner || isRecordingSnowballWinner ||
        isTakingControl || isTogglingBreak || isVoiding || isAdvancing ||
        isSkipping || isResuming || isPausing || isMovingGame || isCheckingWin ||
        isVoidingWinner || isSubmittingCashJackpot || isEndingGame || isSettlingPot ||
        isUndoingForClaim;
    // The claim itself now survives a reload (the server holds the attempt and
    // its draft), but a reload mid-claim still costs the host their place, so
    // the guard stays.
    const hasUnsavedWork = isAnyModalOpen || selectedNumbers.length > 0 || isAnyRequestInFlight;

    // New releases (S0.4). The host screen never reloads by itself: it offers
    // "A new version is ready" with a Reload button, and holds even that back
    // while the host is in a claim, so it cannot land on top of a ticket being
    // read out.
    const isInClaim =
        showValidationModal || showWinnerModal || showManualSnowballModal ||
        showPostWinModal || selectedNumbers.length > 0 || claimAttemptId !== null ||
        missingLastBall !== null;
    const { showPrompt: showNewVersionPrompt, reload: reloadForNewVersion } = useBuildCheck({
        mode: 'prompt',
        safe: !isInClaim,
    });

    // One Supabase client for the screen: every subscription shares its
    // WebSocket. Held in state rather than a ref so it can be handed to hooks
    // during render.
    const [supabase] = useState(createClient);

    // Connection health: drives the reconnecting banner + auto-refresh.
    // The returned object changes once a second by design, so ONLY the stable
    // callbacks destructured below may appear in a dependency array. Putting
    // `health` itself in one is what stopped the host screen updating: the 3
    // second poll was cleared before it fired and the Realtime channel was
    // re-subscribed every second. See src/hooks/use-connection-health.ts.
    const health = useConnectionHealth();
    const { markPollSuccess, markPollFailure, markRealtimeStatus } = health;

    // The host's own 3 second poll, through the same runner as the public
    // screens (spec 5.8): one request at a time, an 8 second deadline so a hung
    // request frees the in-flight flag instead of stopping the poll for good,
    // and a sequence so a slow answer never lands on top of a newer one.
    const pollRunner = useMemo(
        () => createPollRunner<GameStatePoll>({
            run: async (signal) => {
                const { data, error } = await supabase
                    .from('game_states')
                    .select('*')
                    .eq('game_id', gameId)
                    .abortSignal(signal)
                    .single<GameState>();
                return { data, error };
            },
        }),
        [supabase, gameId],
    );

  useWakeLock();

    // Controller Locking Logic
    const isController = currentGameState.controlling_host_id === currentUserId;
    const canTogglePrize = isController && (currentUserRole === 'admin' || currentUserRole === 'host');
    // Allow taking control if no one is controlling OR the last heartbeat was > 30s ago
    const canTakeControl = !currentGameState.controlling_host_id ||
        (currentGameState.controller_last_seen_at && (new Date().getTime() - new Date(currentGameState.controller_last_seen_at).getTime() > 30000));

    useEffect(() => {
        let interval: NodeJS.Timeout;
        if (isController) {
            interval = setInterval(async () => {
                // A dropped heartbeat is expected on pub wifi and recovers on the
                // next tick, so swallow it. Without the catch every blip raised an
                // unhandled promise rejection, ten seconds apart, all night.
                try {
                    await sendHeartbeat(gameId);
                } catch (err) {
                    logError('host-control', err);
                }
            }, 10000); // Send heartbeat every 10s
        }
        return () => clearInterval(interval);
    }, [isController, gameId]);

    const handleTakeControl = async () => {
        if (isTakingControl) return;
        setActionError(null);
        setIsTakingControl(true);
        try {
            // applyMutation is declared further down but only ever runs on a click,
            // by which point the const is initialised for this render.
            applyMutation(await takeControl(gameId), "Failed to take control.");
        } catch (err) {
            logError('host-control', err);
            setActionError("Could not reach the server to take control. Check the connection and try again.");
        } finally {
            setIsTakingControl(false);
        }
    };

    const getPlannedPrize = useCallback((stageIndex: number) => {
        const stage = game.stage_sequence[stageIndex];
        return game.prizes?.[stage as keyof typeof game.prizes] || '';
    }, [game]);

    const [prizeDescription, setPrizeDescription] = useState(getPlannedPrize(initialGameState.current_stage_index));

    // Winner list fetchers, shared by the subscriptions below and by the void
    // control so a void refreshes both lists without waiting on Realtime.
    const fetchGameWinners = useCallback(async () => {
        const { data } = await supabase.from('winners').select('*').eq('game_id', gameId).order('created_at', { ascending: false });
        if (data) {
            setCurrentWinners(data);
            setWinnersLoaded(true);
        }
    }, [supabase, gameId]);

    const fetchSessionWinners = useCallback(async () => {
        const { data } = await supabase
            .from('winners')
            .select(`
                *,
                game:games (id, name, game_index)
            `)
            .eq('session_id', sessionId)
            .order('created_at', { ascending: false });

        if (data) setSessionWinners(data as SessionWinner[]);
    }, [supabase, sessionId]);

    const refreshWinnerLists = useCallback(async () => {
        await Promise.all([fetchGameWinners(), fetchSessionWinners()]);
    }, [fetchGameWinners, fetchSessionWinners]);

    // Both winner lists are loaded on mount and then refreshed explicitly after
    // every mutation that changes them, and when the Winners and Prizes list is
    // opened.
    //
    // They used to be kept up to date by two Supabase Realtime subscriptions on
    // public.winners. Those could never fire: `winners` is not a member of the
    // supabase_realtime publication, and only sessions, game_states and
    // game_states_public are. So the lists were frozen at mount for the life of
    // the page. In practice the host recorded a Line winner, the card still said
    // "Winners & Prizes (0)", and they could not tick "prize given" for the
    // punter standing at the bar. It also broke the documented recovery route
    // for a mis-called ball, because void_last_number refuses with
    // `winner_on_ball` and sends the host to a list that did not contain the
    // blocking winner.
    //
    // The fix is deliberately NOT to publish `winners`. Postgres Changes
    // broadcasts whole rows to subscribers, and winners SELECT is readable by
    // anon, so publishing it would push prize text and free-text void reasons to
    // every client. Explicit refresh is both narrower and more reliable, because
    // it does not depend on replication configuration being right.
    useEffect(() => {
        void fetchGameWinners();
    }, [gameId, fetchGameWinners]);

    useEffect(() => {
        void fetchSessionWinners();
    }, [sessionId, fetchSessionWinners]);

    const handleTogglePrize = async (winnerId: string, currentStatus: boolean) => {
        if (!canTogglePrize) return;
        // Optimistic update
        setCurrentWinners(prev => prev.map(w => w.id === winnerId ? { ...w, prize_given: !currentStatus } : w));
        setSessionWinners(prev => prev.map(w => w.id === winnerId ? { ...w, prize_given: !currentStatus } : w));

        // Revert on refusal AND on a transport failure. Without the catch a
        // dropped request left the optimistic tick showing a prize as given when
        // the write never landed.
        const revert = () => {
            setCurrentWinners(prev => prev.map(w => w.id === winnerId ? { ...w, prize_given: currentStatus } : w));
            setSessionWinners(prev => prev.map(w => w.id === winnerId ? { ...w, prize_given: currentStatus } : w));
        };

        try {
            const result = await toggleWinnerPrizeGiven(sessionId, gameId, winnerId, !currentStatus);
            if (!result?.success) {
                setActionError(result?.error || "Failed to update prize status.");
                revert();
            } else {
                // Replace the optimistic value with what actually persisted, and
                // pick up anything another device changed while this was open.
                void refreshWinnerLists();
            }
        } catch (err) {
            logError('host-control', err);
            setActionError("Could not reach the server to update prize status. Check the connection and try again.");
            revert();
        }
    };

    useEffect(() => {
         
        setPrizeDescription(getPlannedPrize(currentGameState.current_stage_index));
    }, [currentGameState.current_stage_index, getPlannedPrize]);

    const currentNumber = currentGameState.called_numbers?.[currentGameState.numbers_called_count - 1] || null;
    const currentNickname = currentNumber ? getNumberNickname(currentNumber) : null;
    const lastNNumbers = (currentGameState.called_numbers || []).slice(-10, -1);
    const fallbackStageName = game.stage_sequence[game.stage_sequence.length - 1];
    const currentStageName = game.stage_sequence[currentGameState.current_stage_index] || fallbackStageName;
    const plannedStagePrize = getPlannedPrize(currentGameState.current_stage_index);
    const isStagePrizeMissing = !plannedStagePrize;
    // No fallback count. The server rejects an unrecognised stage outright, so the
    // host screen says the same thing rather than inviting a claim check that can
    // only fail. null disables Check Win and shows an explanation.
    const requiredSelectionCount = getRequiredSelectionCountForStage(currentStageName);
    const isStageValidForClaimCheck = requiredSelectionCount !== null;
    const claimIncludesLastBall = currentNumber !== null && selectedNumbers.includes(currentNumber);
    const calledNumberSet = new Set<number>(currentGameState.called_numbers ?? []);
    // Tapped but never called, in tap order: the fault the host must not miss.
    const claimNumbersNotCalled = selectedNumbers.filter((n) => !calledNumberSet.has(n));
    const isClaimCountMet = requiredSelectionCount !== null && selectedNumbers.length === requiredSelectionCount;
    const isSnowballGame = game.type === 'snowball';
    const snowballCallsLabel = currentSnowballPot
        ? getSnowballCallsLabel(currentGameState.numbers_called_count, currentSnowballPot.current_max_calls)
        : null;
    const snowballCallsRemaining = currentSnowballPot
        ? getSnowballCallsRemaining(currentGameState.numbers_called_count, currentSnowballPot.current_max_calls)
        : null;
    const isSnowballJackpotWindowOpen = !!(
        currentSnowballPot &&
        isSnowballJackpotEligible(currentGameState.numbers_called_count, currentSnowballPot.current_max_calls)
    );
    const isSnowballEligibilityStage = isSnowballGame && currentStageName === 'Full House';
    // The stage captured when Post Win opened (X2). Everything inside the Post
    // Win modal reads these, never the live state, so its labels and its
    // requests always agree about which stage the host just won.
    const lastStageIndex = Math.max(0, game.stage_sequence.length - 1);
    const postWinStage = postWinStageIndex ?? currentGameState.current_stage_index;
    const postWinIsFinalStage = postWinStage >= lastStageIndex;
    // Last stage of the last game: there is nothing after this. The post-win
    // buttons must say so. Labelling it "Move to Next Game" when no next game
    // exists reads as "not for me", which is how two sessions were left running.
    const postWinIsEndOfSession = postWinIsFinalStage && isLastGameOfSession;
    // And for the stage captured when Skip opened.
    const skipModalStage = skipStageIndex ?? currentGameState.current_stage_index;
    const skipStageName = game.stage_sequence[skipModalStage] || fallbackStageName;
    const skipStagePrize = getPlannedPrize(skipModalStage);
    const skipIsFinalStage = skipModalStage >= lastStageIndex;

    // Snowball eligibility is an explicit host choice, only demanded when it can
    // actually change what is paid out: a snowball Full House with the jackpot
    // window still open. There used to be an effect auto-ticking eligibility here
    // and another resetting it in handleCheckWin, and the two fought each other.
    const isSnowballChoiceRequired = isSnowballEligibilityStage && isSnowballJackpotWindowOpen;

    // X4: a live (non-void) winner is already on record for the stage being
    // played. resumeGame refuses then, so the pad offers Continue to the next
    // stage instead of Resume calling.
    const isCurrentStageWon = currentWinners.some(
        (w) => w.stage === currentStageName && w.is_void !== true,
    );
    const hasNextStage = currentGameState.current_stage_index < lastStageIndex;
    const nextStageName = hasNextStage ? game.stage_sequence[currentGameState.current_stage_index + 1] : null;

    const navigateToHostPath = (targetPath?: string) => {
        const destination = targetPath || '/host';
        if (typeof window !== 'undefined') {
            window.location.assign(destination);
            return;
        }
        router.push(destination);
    };

    /**
     * Loads the snowball pot for this game, and keeps trying until it has it.
     *
     * This one request decides whether the host is offered the Eligible / Not
     * eligible choice at all. It used to be fired once with its error thrown
     * away (`const { data } = await ...; if (data) setCurrentSnowballPot(data)`),
     * so a single failed request during page load silently:
     *   - printed "this game is not linked to a snowball pot" on a game that is,
     *   - removed the eligibility choice, because isSnowballChoiceRequired needs
     *     currentSnowballPot to be non-null,
     *   - and therefore sent snowballEligible = false to record_winner_atomic,
     *     which records a qualifying Full House inside the window as an ordinary
     *     win. The punter is not paid the jackpot and the pot rolls over instead
     *     of resetting.
     *
     * Nothing was logged and nothing was shown. Now: the error is kept, the load
     * is retried with backoff, the failure is distinguishable from "no pot", and
     * recording is blocked while the pot is unknown (see handleRecordWinner).
     *
     * There is deliberately no Realtime subscription here any more. The channel
     * this effect used to open never delivered, because snowball_pots was not
     * in the supabase_realtime publication until 20260929091809 (added for the
     * public screens). The pot only moves at settlement, which is after this
     * screen is finished with it, so the poll on reconnect below is all this
     * needs.
     */
    useEffect(() => {
        if (game.type !== 'snowball' || !game.snowball_pot_id) {
            setCurrentSnowballPot(null);
            setPotLoadState('not-applicable');
            return;
        }

        const potId = game.snowball_pot_id;
        let cancelled = false;
        let retryTimer: ReturnType<typeof setTimeout> | null = null;
        let attempt = 0;

        const load = async () => {
            if (cancelled) return;
            setPotLoadState((current) => (current === 'loaded' ? current : 'loading'));

            const { data, error } = await supabase
                .from('snowball_pots')
                .select('*')
                .eq('id', potId)
                .single();

            if (cancelled) return;

            if (error || !data) {
                logError('host-control:snowball-pot', error ?? new Error('snowball pot lookup returned no row'));
                setPotLoadState('failed');
                attempt += 1;
                // Backs off to a 30 second ceiling and keeps trying: the host may
                // be standing there for several minutes before the stage that
                // needs this, and the answer must be right by then.
                const delay = Math.min(1000 * 2 ** Math.min(attempt, 5), 30000);
                retryTimer = setTimeout(load, delay);
                return;
            }

            attempt = 0;
            setCurrentSnowballPot(data);
            setPotLoadState('loaded');
        };

        void load();

        // Coming back to the tab is the cheapest moment to re-check a pot that
        // failed to load while the screen was in the host's pocket.
        const onVisible = () => {
            if (document.visibilityState === 'visible') void load();
        };
        document.addEventListener('visibilitychange', onVisible);

        return () => {
            cancelled = true;
            if (retryTimer) clearTimeout(retryTimer);
            document.removeEventListener('visibilitychange', onVisible);
        };
    }, [supabase, game.type, game.snowball_pot_id]);

    // Shared poll routine — used by the polling interval, the visibility
    // handler, and the realtime reconnect path. Tracks an in-flight flag and a
    // monotonic sequence so a slow response can't clobber newer state.
    const pollGameState = useCallback(async () => {
        // Null while a poll is still in flight; the runner frees that flag at
        // the 8 second deadline even if the request never answers.
        const started = pollRunner.start();
        if (!started) return;
        try {
            const { data: freshState, error } = await started.promise;
            if (error) {
                markPollFailure();
                logError('host-control', error);
                return;
            }
            // A newer poll or a Realtime payload has moved on since this one
            // started, so its answer is older than what is on screen.
            if (!pollRunner.isCurrent(started.seq)) return;
            if (freshState) {
                setCurrentGameState((current) =>
                    isFreshGameState(current, freshState) ? freshState : current,
                );
                markPollSuccess();
            }
        } catch (err) {
            // Includes the deadline: a hung request counts as a failed poll.
            markPollFailure();
            logError('host-control', err);
        }
        // Depends on the stable health callbacks, never on the health object:
        // the object changes every second, which would give this callback a new
        // identity every second and re-arm the 3 second poll interval forever.
    }, [pollRunner, markPollSuccess, markPollFailure]);

    /**
     * Applies whatever state a mutation returned, and turns a conflict into a
     * refresh rather than a dead end.
     *
     * Every host mutation that writes `game_states` now returns the committed row
     * (see docs/architecture/server-actions.md). Applying it here means break,
     * undo, pause, resume and stage advance land on the host screen at once
     * instead of waiting on Realtime.
     *
     * Returns true on success so callers can gate their own follow-up work.
     */
    /** Applies a committed row from the server, unless something newer is already on screen. */
    const applyIncomingState = useCallback((incoming: GameState) => {
        setCurrentGameState((current) =>
            isFreshGameState(current, incoming) ? incoming : current,
        );
    }, []);

    const applyMutation = useCallback(
        (result: ActionResult<{ gameState: GameState }> | undefined, fallback: string): boolean => {
            if (!result?.success) {
                setActionError(result?.error || fallback);
                // A conflict means the server state moved under us. Re-read it so
                // the host sees why the action was refused.
                if (result && 'conflict' in result && result.conflict) void pollGameState();
                return false;
            }
            if (result.data?.gameState) applyIncomingState(result.data.gameState);
            return true;
        },
        [pollGameState, applyIncomingState],
    );

    /** Drops the claim on this screen: the attempt, its draft queue, its numbers and verdict. */
    const clearLocalClaim = useCallback(() => {
        claimDraftQueueRef.current?.dispose();
        claimDraftQueueRef.current = null;
        claimAttemptIdRef.current = null;
        setClaimAttemptId(null);
        setSelectedNumbers([]);
        setClaimVerdict(null);
        setMissingLastBall(null);
        setClaimNotice(null);
        setDraftQueueState('idle');
    }, []);

    /**
     * Takes on the claim the server holds: the attempt, its numbers in tap
     * order, its verdict, and a fresh draft queue that continues the stored
     * sequence. Used when a check starts, when another attempt is adopted
     * (attempt_mismatch), and when a reload or a takeover finds a claim open.
     */
    const adoptClaim = useCallback((claim: Pick<ClaimSnapshot, 'attemptId' | 'claimNumbers' | 'claimResult' | 'claimDraftSeq'>) => {
        claimDraftQueueRef.current?.dispose();
        claimDraftQueueRef.current = null;
        claimAttemptIdRef.current = claim.attemptId;
        setClaimAttemptId(claim.attemptId);
        setSelectedNumbers(claim.claimNumbers);
        setClaimVerdict(claim.claimResult);
        setMissingLastBall(null);
        setClaimNotice(null);
        setDraftQueueState('idle');

        const attemptId = claim.attemptId;
        // No drafts once a verdict exists: the server refuses them.
        if (!attemptId || claim.claimResult !== null) return;

        claimDraftQueueRef.current = createClaimDraftQueue({
            initialSeq: claim.claimDraftSeq,
            send: async (numbers, seq) => {
                const result = await setClaimDraft(gameId, attemptId, [...numbers], seq);
                if (result?.success) return 'ok';
                if (result && (result.conflict || PERMANENT_DRAFT_REFUSALS.has(result.code))) {
                    // The claim moved under us. Re-read the game, so the screen
                    // shows what the server actually holds.
                    void pollGameState();
                    return 'stop';
                }
                return 'error';
            },
            onStateChange: setDraftQueueState,
        });
    }, [gameId, pollGameState]);

    // The draft queue can hold a retry timer; it must not outlive the screen.
    useEffect(() => {
        const queueRef = claimDraftQueueRef;
        return () => queueRef.current?.dispose();
    }, []);

    // Live game state. useRealtimeChannel owns the reconnect (X1): one channel
    // at a time, at most one pending retry with a 1s to 30s backoff, and the
    // CLOSED that realtime-js fires synchronously while a channel is being torn
    // down is ignored instead of being taken for a failure. The hand-rolled
    // version reacted to that CLOSED by removing and reconnecting again, and a
    // late CLOSED from an old channel could tear down its replacement.
    //
    // onStatus is the stable markRealtimeStatus callback, never the health
    // object: depending on the object tore this channel down and rebuilt it
    // every second, which is faster than Supabase can subscribe a channel, so
    // the host never received a single Realtime update.
    const { reconnect: reconnectRealtime } = useRealtimeChannel({
        supabase,
        key: `game_state:${gameId}`,
        onStatus: markRealtimeStatus,
        build: (channel, isCurrent) =>
            channel.on<GameState>(
                'postgres_changes',
                {
                    event: 'UPDATE',
                    schema: 'public',
                    table: 'game_states',
                    filter: `game_id=eq.${gameId}`
                },
                (payload) => {
                    if (!isCurrent()) return;
                    // A poll already in flight started before this change, so
                    // its answer is discarded (spec 5.8).
                    pollRunner.invalidate();
                    setCurrentGameState((current) =>
                        isFreshGameState(current, payload.new) ? payload.new : current,
                    );
                }
            ),
    });

    // Polling fallback — re-fetch game state every 3 seconds to recover from
    // missed Realtime events. Skips when tab is hidden to save bandwidth.
    useEffect(() => {
        const interval = setInterval(() => {
            if (document.visibilityState !== 'visible') return;
            void pollGameState();
        }, 3000);
        return () => clearInterval(interval);
    }, [pollGameState]);

    // Force-reconnect realtime + immediate poll when the tab becomes visible
    // again. Mobile browsers often kill background WebSockets silently.
    useEffect(() => {
        const handleVisibilityChange = () => {
            if (document.visibilityState !== 'visible') return;
            reconnectRealtime();
            void pollGameState();
        };
        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
    }, [pollGameState, reconnectRealtime]);

    // Recovery (spec 5.2). After a reload, or a takeover from another phone,
    // the claim the server holds (its attempt, numbers in tap order, draft
    // sequence and any verdict) reopens here, so the host carries on where it
    // was left instead of the claim vanishing with the old page.
    //
    // Not reopened: a claim already recorded as a winner (the pad offers
    // Continue and Check another claimant instead), one this tab has finished
    // with, or while this tab is starting a check of its own. It waits for the
    // winners to load once, because only they can say the claim was recorded.
    const claimOnServer = currentGameState.status === 'in_progress' && currentGameState.paused_for_validation
        ? currentGameState.claim_attempt_id
        : null;
    useEffect(() => {
        if (!isController || !winnersLoaded || isPausing || !claimOnServer) return;
        if (claimAttemptIdRef.current !== null) return;
        if (dismissedAttemptIdsRef.current.has(claimOnServer)) return;
        if (currentWinners.some((w) => w.client_request_id === claimOnServer)) return;

        adoptClaim({
            attemptId: claimOnServer,
            claimNumbers: currentGameState.claim_numbers ?? [],
            claimResult: currentGameState.claim_result,
            claimDraftSeq: currentGameState.claim_draft_seq ?? 0,
        });
        setClaimNotice('This claim was already being checked. Carry on from where it was left.');
        setShowValidationModal(true);
    }, [
        isController,
        winnersLoaded,
        isPausing,
        claimOnServer,
        currentWinners,
        currentGameState.claim_numbers,
        currentGameState.claim_result,
        currentGameState.claim_draft_seq,
        adoptClaim,
    ]);

    const handleCallNextNumber = async () => {
        if (!isController || isCallingNumber) return;
        setIsCallingNumber(true);
        setActionError(null);

        // One key per intended call, held across retries of that call and
        // cleared only once a response arrives. Minting it here rather than in
        // the action is what makes a retry a retry: the second tap after a
        // dropped response carries the SAME key, so call_next_number recognises
        // the draw that already committed and returns the board as it stands
        // instead of pulling a second ball out of the bag.
        //
        // If the first attempt never committed, the key was never stored, so the
        // retry does not match and draws normally. Both outcomes are correct and
        // neither needs this code to know which happened.
        if (!callRequestIdRef.current) {
            callRequestIdRef.current = newClaimRequestId();
        }

        try {
            // The host is the author of this change, so apply the server's
            // already-synced state snapshot immediately. The freshness gate keeps
            // a slightly older Realtime echo from clobbering it.
            const result = await callNextNumber(gameId, callRequestIdRef.current);
            applyMutation(result, "Failed to call next number.");
            // A response of any kind ends this call, successful or refused. Only
            // a transport failure leaves the key in place for the retry.
            callRequestIdRef.current = null;
        } catch (err) {
            // This is the control the host presses every ten seconds all night.
            // Without the catch and finally, one dropped request left
            // isCallingNumber true forever: the button stayed disabled reading
            // "CALLING..." with no error, and only a reload recovered it.
            logError('host-control', err);
            setActionError("Could not reach the server to call the next number. Check the connection and tap again: if the ball did come out, tapping again will not draw a second one.");
        } finally {
            setIsCallingNumber(false);
        }
    };

    const handleToggleBreak = async () => {
        if (!isController || isTogglingBreak) return;
        setActionError(null);
        setIsTogglingBreak(true);
        try {
            const newOnBreakStatus = !currentGameState.on_break;
            applyMutation(await toggleBreak(gameId, newOnBreakStatus), "Failed to toggle break.");
        } catch (err) {
            // Without this the button simply returned to idle with nothing on
            // screen, and the host could not tell a refused break from a lost
            // request. Starting or ending a break is safe to repeat.
            logError('host-control', err);
            setActionError("Could not reach the server to change the break. Check the connection and try again.");
        } finally {
            setIsTogglingBreak(false);
        }
    };

    /**
     * Where a finishing move was heading, once the snowball pot question is
     * settled (X6). When the pot did not move, the host sees the retry banner
     * first and carries on from there; otherwise this navigates at once.
     */
    const continueAfterFinish = (redirectTo: string | undefined, potDidNotSettle: boolean) => {
        if (potDidNotSettle) {
            setPotNeedsSettling(true);
            setPendingRedirect(redirectTo ?? null);
            return;
        }
        navigateToHostPath(redirectTo);
    };

    /**
     * Post Win "Continue Playing" and "Continue and Take Break" (spec 4.3), and
     * the pad's "Continue to [next stage]" once a stage has been won (X4).
     * Advances one stage, optionally starts a break, then closes the Post Win and
     * validation modals and drops the claim. The prize text follows the new stage
     * through the current_stage_index effect above.
     */
    const handleContinuePlaying = async (putOnBreak: boolean = false, stageIndex: number = postWinStage) => {
        if (!isController || isAdvancing) return;
        setActionError(null);
        setIsAdvancing(true);
        // The stage captured when Post Win opened (X2), not the live stage. The
        // server binds to this rather than to a value it reads itself, so a
        // retry after a lost response is absorbed rather than advancing a
        // second time, even after the poll has moved the live state on.
        const expectedStageIndex = stageIndex;
        try {
            // One call, not two. "Continue and Take Break" used to advance the
            // stage and then issue the break separately, so a break that failed
            // or was lost left the stage already moved, and the retry advanced
            // again with a whole stage skipped and its prize unawarded.
            const result = await advanceToNextStage(gameId, expectedStageIndex, putOnBreak);
            if (!applyMutation(result, "Failed to continue playing.")) return;
            if (result.success && result.data?.snowballPotDidNotSettle) setPotNeedsSettling(true);

            setShowPostWinModal(false);
            setShowValidationModal(false);
            clearLocalClaim();
        } catch (err) {
            logError('host-control', err);
            setActionError("Could not reach the server to move the game on. Check the connection and tap again: if it did save, tapping again will not skip a stage.");
        } finally {
            setIsAdvancing(false);
        }
    };

    const handleMoveToNextGame = async () => {
        if (!isController || isMovingGame) return;

        if (!postWinIsFinalStage) {
            await handleContinuePlaying();
            return;
        }

        setActionError(null);
        setIsMovingGame(true);
        try {
            const result = await moveToNextGameAfterWin(gameId, sessionId);
            if (!result?.success) {
                setActionError(result?.error || "Failed to move to next game.");
                // `result &&` guard matches applyMutation: an action that resolves
                // undefined would otherwise throw a TypeError right after the
                // error was set, losing the message the host needs.
                if (result && 'conflict' in result && result.conflict) void pollGameState();
                return;
            }
            const potDidNotSettle = result.data?.snowballPotDidNotSettle === true;
            if (potDidNotSettle) setPotNeedsSettling(true);
            if (result.data?.requiresCashJackpotAmount) {
                setCashJackpotMode('next');
                setCashJackpotGameName(result.data.gameName || 'Jackpot Game');
                setCashJackpotAmount('');
                setShowCashJackpotModal(true);
                setShowPostWinModal(false);
                return;
            }
            setShowPostWinModal(false);
            setShowValidationModal(false);
            clearLocalClaim();
            continueAfterFinish(result.data?.redirectTo, potDidNotSettle);
        } catch (err) {
            logError('host-control', err);
            setActionError("Could not reach the server to move to the next game. Check the connection and try again.");
        } finally {
            setIsMovingGame(false);
        }
    };

    const handleTakeBreakAfterGame = async () => {
        if (!isController || isMovingGame) return;

        if (!postWinIsFinalStage) {
            await handleContinuePlaying(true);
            return;
        }

        setActionError(null);
        setIsMovingGame(true);
        try {
            const result = await moveToNextGameOnBreak(gameId, sessionId);
            if (!result?.success) {
                setActionError(result?.error || "Failed to move to next game break.");
                if (result && 'conflict' in result && result.conflict) void pollGameState();
                return;
            }
            const potDidNotSettle = result.data?.snowballPotDidNotSettle === true;
            if (potDidNotSettle) setPotNeedsSettling(true);
            if (result.data?.requiresCashJackpotAmount) {
                setCashJackpotMode('break');
                setCashJackpotGameName(result.data.gameName || 'Jackpot Game');
                setCashJackpotAmount('');
                setShowCashJackpotModal(true);
                setShowPostWinModal(false);
                return;
            }
            setShowPostWinModal(false);
            setShowValidationModal(false);
            clearLocalClaim();
            continueAfterFinish(result.data?.redirectTo, potDidNotSettle);
        } catch (err) {
            logError('host-control', err);
            setActionError("Could not reach the server to move to the next game. Check the connection and try again.");
        } finally {
            setIsMovingGame(false);
        }
    };

    /**
     * Every route out of this modal was gated on isSubmittingCashJackpot: Confirm
     * is disabled by it, Cancel returns early while it is set, the ✕ calls Cancel
     * and Escape clicks the ✕. So a rejected transition, which used to skip the
     * flag reset entirely, trapped the host with no way out but a reload, mid
     * game-transition. Hence the finally. The re-entrancy guard is the other half:
     * without it a double tap fired two game transitions.
     */
    const handleConfirmCashJackpotAndContinue = async () => {
        if (!isController || isSubmittingCashJackpot) return;
        if (!cashJackpotAmount.trim()) {
            setActionError("Enter a cash jackpot amount before continuing.");
            return;
        }

        setIsSubmittingCashJackpot(true);
        setActionError(null);
        try {
            const transitionResult = cashJackpotMode === 'break'
                ? await moveToNextGameOnBreak(gameId, sessionId, cashJackpotAmount)
                : await moveToNextGameAfterWin(gameId, sessionId, cashJackpotAmount);

            if (!transitionResult?.success) {
                setActionError(transitionResult?.error || "Failed to continue to next game.");
                return;
            }

            setShowCashJackpotModal(false);
            clearSpentClaim();
            const potDidNotSettle = transitionResult.data?.snowballPotDidNotSettle === true;
            continueAfterFinish(transitionResult.data?.redirectTo, potDidNotSettle);
        } catch (err) {
            logError('host-control', err);
            setActionError("Could not reach the server to start the next game. Check the connection and try again.");
        } finally {
            setIsSubmittingCashJackpot(false);
        }
    };

    const handleCancelCashJackpotModal = () => {
        if (isSubmittingCashJackpot) return;
        setShowCashJackpotModal(false);
        setCashJackpotAmount('');

        if (currentGameState.status === 'completed') {
            // The pot banner, if it is up, comes first: leaving now would take
            // the retry away with the page (X6).
            if (potNeedsSettling) {
                setPendingRedirect('/host');
                return;
            }
            navigateToHostPath('/host');
            return;
        }

        setShowPostWinModal(true);
    };

    /**
     * A tap on the claim grid. The grid keeps TAP order, because the TV and the
     * phones show the claim in the order the caller reads it (spec 5.2), and
     * every tap sends the whole ordered list through the draft queue. A tap
     * never waits for the server: the grid updates at once, and a failed send
     * retries by itself while "TV not updated, retrying" shows.
     */
    const handleToggleNumber = (num: number) => {
        if (!isController || claimVerdict !== null || !claimAttemptIdRef.current) return;
        setClaimNotice(null);

        let next: number[];
        if (selectedNumbers.includes(num)) {
            next = selectedNumbers.filter((n) => n !== num);
        } else {
            // The server refuses more than the stage needs, so the grid does too.
            if (requiredSelectionCount !== null && selectedNumbers.length >= requiredSelectionCount) {
                setClaimNotice(`${currentStageName} needs ${requiredSelectionCount} numbers. Untap one to change it.`);
                return;
            }
            next = [...selectedNumbers, num];
        }

        setSelectedNumbers(next);
        // Changing the claim withdraws any open "missing the last number" question.
        setMissingLastBall(null);
        claimDraftQueueRef.current?.push(next);
    };

    const handleClearSelection = () => {
        if (claimVerdict !== null) return;
        setSelectedNumbers([]);
        setMissingLastBall(null);
        setClaimNotice(null);
        claimDraftQueueRef.current?.push([]);
    };

    /**
     * A recorded claim is spent, so every trace of it has to go from this
     * screen.
     *
     * Leaving the validation modal open behind Post Win once produced a second
     * winners row from one ticket: closing Post Win revealed the green Valid
     * Claim panel again with a live Record Winner button. The attempt now makes
     * a repeat save return the same winner, but the modal still closes, and the
     * attempt is marked as finished in this tab so the recovery below does not
     * reopen it.
     *
     * Call this on every path that records a win, and on the Post Win escape.
     */
    const clearSpentClaim = () => {
        const attemptId = claimAttemptIdRef.current;
        if (attemptId) dismissedAttemptIdsRef.current.add(attemptId);
        setShowValidationModal(false);
        clearLocalClaim();
    };

    /**
     * Check Claim, and Check another claimant (spec 5.2).
     *
     * Mints a fresh attempt and asks begin_claim_check to start it. When
     * another attempt is already being checked (this phone reloaded, or took
     * over from another), the answer is attempt_mismatch with that attempt and
     * its draft, and this screen adopts it and carries on. `newClaimant` is the
     * explicit "a different person is claiming": it replaces the attempt and
     * clears the claim and the win on screen, so a tie is a separate winner.
     */
    const handleBeginClaimCheck = async (newClaimant: boolean = false) => {
        if (!isController || isPausing) return;
        setActionError(null);
        clearLocalClaim();
        setShowValidationModal(true);
        setIsPausing(true);
        const attemptId = newClaimRequestId();
        try {
            const result = await beginClaimCheck(gameId, attemptId, newClaimant);
            if (!result?.success) {
                setActionError(result?.error || "Failed to start the claim check.");
                if (result && 'conflict' in result && result.conflict) void pollGameState();
                setShowValidationModal(false);
                return;
            }
            applyIncomingState(result.data!.gameState);
            const adopted = result.data!;
            if (adopted.attemptId) dismissedAttemptIdsRef.current.delete(adopted.attemptId);
            adoptClaim(adopted);
            if (adopted.code === 'attempt_mismatch') {
                setClaimNotice('This claim was already being checked. Carry on from where it was left.');
            }
        } catch (err) {
            logError('host-control', err);
            // Safe to repeat: a check that did start is adopted on the next tap.
            setActionError("Could not reach the server to start the claim check. Check the connection and tap Check Claim again.");
            setShowValidationModal(false);
        } finally {
            setIsPausing(false);
        }
    };

    /** Check another claimant: a new attempt for a different person, for a tie. */
    const handleCheckAnotherClaimant = async () => {
        setShowPostWinModal(false);
        setPrizeDescription(getPlannedPrize(currentGameState.current_stage_index));
        await handleBeginClaimCheck(true);
    };

    /**
     * Sends the claim to check_claim and shows the answer. Shared by Check Win,
     * the re-check after the bound undo, and "No: reject as late".
     */
    const runClaimCheck = async (attemptId: string, numbers: number[], rejectAsLate: boolean) => {
        const result = await checkClaim(gameId, attemptId, numbers, rejectAsLate);
        if (!result?.success) {
            setActionError(result?.error || "Failed to check the claim.");
            if (result && 'conflict' in result && result.conflict) void pollGameState();
            return;
        }
        const checked = result.data!;
        applyIncomingState(checked.gameState);
        setSelectedNumbers(checked.claimNumbers.length > 0 ? checked.claimNumbers : numbers);

        if (checked.code === 'missing_last_ball') {
            setClaimVerdict(null);
            setMissingLastBall(checked.lastNumber === null ? null : {
                lastNumber: checked.lastNumber,
                expectedCount: checked.gameState.numbers_called_count,
                undoAvailable: !checked.gameState.claim_undo_used,
            });
            return;
        }

        // A verdict is final for this attempt: no more drafts.
        claimDraftQueueRef.current?.dispose();
        claimDraftQueueRef.current = null;
        setDraftQueueState('idle');
        setMissingLastBall(null);
        setClaimVerdict(checked.code);
        // X5: nothing is announced here any more. The TV shows the win only once
        // record_winner_atomic has recorded it.
        if (checked.code === 'valid') handleOpenRecordWinnerModal();
    };

    const handleCheckWin = async () => {
        if (!isController || isCheckingWin) return;
        setActionError(null);
        const attemptId = claimAttemptIdRef.current;
        if (!attemptId) {
            setActionError("This claim check has ended. Tap Check Claim to start again.");
            return;
        }
        if (requiredSelectionCount === null) {
            setActionError(`This stage is not valid for claim checking.`);
            return;
        }
        if (selectedNumbers.length !== requiredSelectionCount) {
            setActionError(`Select exactly ${requiredSelectionCount} numbers for ${currentStageName || 'this stage'} before checking.`);
            return;
        }

        setIsCheckingWin(true);
        try {
            // Send any draft still waiting, so the room sees the list being
            // checked. Correctness does not depend on it: check_claim gets the
            // full list below.
            await claimDraftQueueRef.current?.flush();
            await runClaimCheck(attemptId, selectedNumbers, false);
        } catch (err) {
            // Safe to repeat: the same attempt with the same numbers returns the
            // verdict already given.
            logError('host-control', err);
            setActionError("Could not reach the server to check that claim. Check the connection and tap Check Win again.");
        } finally {
            setIsCheckingWin(false);
        }
    }

    /**
     * "Yes: undo [n] and check again" (A1). The claim came before the last ball
     * was announced, so that ball is taken back off the board, once, bound to
     * this attempt and to the ball count the host saw. A repeated tap, or a
     * retry after the undo landed, answers already_undone rather than taking a
     * second ball off, and the same numbers are then checked again.
     */
    const handleUndoLastBallAndRecheck = async () => {
        const attemptId = claimAttemptIdRef.current;
        const prompt = missingLastBall;
        if (!isController || !attemptId || !prompt || isUndoingForClaim || isCheckingWin) return;
        setActionError(null);
        setIsUndoingForClaim(true);
        try {
            const undo = await undoLastNumberForClaim(gameId, attemptId, prompt.expectedCount);
            if (undo?.success) {
                applyIncomingState(undo.data!.gameState);
            } else if (undo?.code !== 'already_undone') {
                setActionError(undo?.error || "Could not undo the last number.");
                if (undo && 'conflict' in undo && undo.conflict) void pollGameState();
                return;
            }
            setMissingLastBall(null);
            await runClaimCheck(attemptId, selectedNumbers, false);
        } catch (err) {
            logError('host-control', err);
            setActionError("Could not reach the server. Tap Yes again: the ball is only ever taken off once for this claim.");
        } finally {
            setIsUndoingForClaim(false);
        }
    };

    /** "No: reject as late" (A1): the claim came after the last ball was announced. */
    const handleRejectAsLate = async () => {
        const attemptId = claimAttemptIdRef.current;
        if (!isController || !attemptId || isCheckingWin || isUndoingForClaim) return;
        setActionError(null);
        setIsCheckingWin(true);
        try {
            await runClaimCheck(attemptId, selectedNumbers, true);
        } catch (err) {
            logError('host-control', err);
            setActionError("Could not reach the server to reject the claim. Check the connection and tap again.");
        } finally {
            setIsCheckingWin(false);
        }
    };

    const handleRecordWinner = async () => {
        if (!isController) return;
        if (isRecordingWinner) return; // Double-tap guard
        setActionError(null);
        const currentStage = currentStageName;
        if (!currentStage) {
            setActionError("Current stage is not available for this game.");
            return;
        }
        // The checked attempt is the winner's key. Without one there is no
        // checked claim to record, and the server would refuse it anyway.
        const attemptId = claimAttemptIdRef.current;
        if (!attemptId) {
            setActionError("Check the claim before recording the winner.");
            return;
        }
        // Money decision: never record a snowball Full House while the pot is
        // unknown. With the pot unread, isSnowballChoiceRequired is false, so
        // the guard below would wave the claim through with eligible = false and
        // pay an ordinary prize for a jackpot win. Refusing is the only safe
        // answer: the host can retry once the pot loads, and the attempt means
        // retrying costs nothing.
        if (isSnowballEligibilityStage && potLoadState === 'failed') {
            setActionError("Cannot record this yet: the snowball pot has not loaded, so eligibility cannot be judged. Check the connection and try again in a moment.");
            return;
        }

        // Money decision: never record a snowball Full House with the jackpot
        // window open until the host has said Eligible or Not eligible.
        if (isSnowballChoiceRequired && snowballEligibleChoice === null) {
            setActionError("Choose eligibility before recording.");
            return;
        }

        setIsRecordingWinner(true);
        try {
            const result = await recordWinner(
                sessionId,
                gameId,
                currentStage,
                prizeDescription,
                prizeGiven,
                false,
                snowballEligibleChoice === true,
                attemptId
            );

            if (applyMutation(result, "Failed to record winner.")) {
                setPrizeGiven(false);
                setSnowballEligibleChoice(null);
                setShowWinnerModal(false);
                // The claim is spent. Without this the validation modal survived
                // behind Post Win with a live Record Winner button on the same
                // ticket, which paid a snowball jackpot twice.
                clearSpentClaim();
                openPostWinModal();
                // The win that just saved has to appear in both lists now. This
                // is the only thing that puts it there: `winners` is not
                // published over Realtime.
                void refreshWinnerLists();
            }
        } catch (err) {
            // A transport failure here used to be the worst case: the host sees
            // "Recording…" flash back to idle with no way to know whether the win
            // landed, and a second tap could record it twice. The attempt makes
            // that second tap safe, so the message says to take it.
            logError('host-control', err);
            setActionError("Could not reach the server. Check the connection and tap Confirm Winner again: if the win did save, tapping again will not record it twice.");
        } finally {
            setIsRecordingWinner(false);
        }
    };

    const handleSkipStage = async () => {
        if (!isController || isSkipping) return;
        setActionError(null);
        setSkipError(null);
        setIsSkipping(true);
        // As in handleContinuePlaying: the stage captured when this modal opened
        // (X2), so a retry after a lost response is absorbed rather than
        // skipping a second stage and its prize.
        const expectedStageIndex = skipModalStage;
        try {
            const result = await skipStage(gameId, expectedStageIndex);
            if (!result?.success) {
                setSkipError(result?.error || 'Failed to skip stage.');
            }
            if (applyMutation(result, "Failed to skip stage.")) {
                // Skipping the last stage finishes the game, which settles the
                // snowball pot; a pot that did not move gets its banner (X6).
                if (result.success && result.data?.snowballPotDidNotSettle) setPotNeedsSettling(true);
                setShowSkipConfirm(false);
                setShowValidationModal(false);
                clearLocalClaim();
            }
        } catch (err) {
            logError('host-control', err);
            setSkipError("Could not reach the server to skip the stage. Check the connection and tap again: if it did save, tapping again will not skip a second stage.");
        } finally {
            setIsSkipping(false);
        }
    };

    /** Opens Post Win for the stage just won, capturing it (X2). */
    const openPostWinModal = () => {
        setPostWinStageIndex(currentGameState.current_stage_index);
        setShowPostWinModal(true);
    };

    /** Opens the skip confirmation for the stage on screen, capturing it (X2). */
    const openSkipConfirm = () => {
        setSkipError(null);
        setSkipStageIndex(currentGameState.current_stage_index);
        setShowSkipConfirm(true);
    };

    /**
     * Opens Record Winner with the eligibility choice cleared, so every win is a
     * fresh decision and a previous "Eligible" can never carry over to the next
     * one. The winner's key is the claim attempt, which check_claim has just
     * called valid; there is no separate key to mint here any more.
     */
    const handleOpenRecordWinnerModal = () => {
        // This modal now shows actionError, so clear any stale one from an earlier
        // refusal. Otherwise an unrelated message would greet the host here.
        setActionError(null);
        setSnowballEligibleChoice(null);
        // Always the planned prize for this stage (X15). The Manual Snowball
        // Win prefill ("£140 (Manual Snowball Win)") used to survive a cancel
        // and greet the next ordinary winner.
        setPrizeDescription(getPlannedPrize(currentGameState.current_stage_index));
        setShowWinnerModal(true);
    };

    /** Cancel or close on Manual Snowball Win: drop its prefill (X15). */
    const handleCloseManualSnowballModal = () => {
        if (isRecordingSnowballWinner) return;
        setShowManualSnowballModal(false);
        setPrizeDescription(getPlannedPrize(currentGameState.current_stage_index));
    };

    const handleCloseRecordWinnerModal = () => {
        if (isRecordingWinner) return;
        setSnowballEligibleChoice(null);
        setShowWinnerModal(false);
    };

    const handleOpenUndoModal = () => {
        if (!isController) return;
        if (!currentNumber) {
            setActionError("No numbers to void.");
            return;
        }
        setUndoError(null);
        setShowUndoModal(true);
    };

    const handleCloseUndoModal = () => {
        if (isVoiding) return;
        setShowUndoModal(false);
        setUndoError(null);
    };

    const handleConfirmVoidLastNumber = async () => {
        if (!isController || isVoiding) return;
        setUndoError(null);
        setIsVoiding(true);
        try {
            const result = await voidLastNumber(gameId);
            if (!result?.success) {
                // Errors stay inside the modal so the host can read the refusal and
                // act on it, rather than hunting for a banner behind the modal.
                setUndoError({
                    message: result?.error || "Failed to undo the last call.",
                    code: result?.code,
                });
                if (result && 'conflict' in result && result.conflict) void pollGameState();
                return;
            }
            applyMutation(result, "Failed to undo the last call.");
            setShowUndoModal(false);
        } catch (err) {
            // Undo is NOT safe to repeat blindly: a second undo takes a second
            // ball off the board. The message says to reload and look, not to
            // tap again.
            logError('host-control', err);
            setUndoError({ message: "Could not reach the server. Reload the page and check the board before undoing again: undoing twice takes two balls off." });
        } finally {
            setIsVoiding(false);
        }
    };

    /**
     * Ends the game without needing a winner first.
     *
     * There was no such control. The only routes to a completed game were
     * recording a winner and then working through the Post Win modal, or
     * skipping the final stage. So a game nobody won, or a game the host walked
     * away from because the room had thinned out, stayed 'in_progress' for ever.
     *
     * That matters most on the snowball game, because settlement only ever runs
     * from a completion path. An abandoned snowball game left the jackpot frozen
     * exactly where it was, and the next Friday the pub TV and the pre-game
     * briefing both announced last week's figure as if it had never been played
     * for. The only correction was a manual pot edit.
     *
     * endGame goes through finish_game, which also completes the session when
     * this was the last game to finish, and then settles the pot.
     */
    const handleConfirmEndGame = async () => {
        if (!isController || isEndingGame) return;
        setEndGameError(null);
        setIsEndingGame(true);
        try {
            const result = await endGame(gameId, sessionId);
            if (!result?.success) {
                setEndGameError(result?.error || 'Failed to end the game.');
                if (result && 'conflict' in result && result.conflict) void pollGameState();
                return;
            }
            applyMutation(result, 'Failed to end the game.');
            if (result.data?.snowballPotDidNotSettle) setPotNeedsSettling(true);
            setShowEndGameModal(false);
            setShowValidationModal(false);
            clearLocalClaim();
        } catch (err) {
            logError('host-control', err);
            setEndGameError('Could not reach the server to end the game. Check the connection and try again.');
        } finally {
            setIsEndingGame(false);
        }
    };

    const handleRetrySettlement = async () => {
        if (isSettlingPot) return;
        setActionError(null);
        setIsSettlingPot(true);
        try {
            const result = await settleSnowballPotForGame(gameId);
            if (!result?.success) {
                setActionError(result?.error || 'The snowball pot still did not update.');
                return;
            }
            setPotNeedsSettling(false);
            // Settled: carry on to wherever the finishing move was heading.
            if (pendingRedirect) {
                const destination = pendingRedirect;
                setPendingRedirect(null);
                navigateToHostPath(destination);
            }
        } catch (err) {
            logError('host-control', err);
            setActionError('Could not reach the server to settle the pot. Check the connection and try again.');
        } finally {
            setIsSettlingPot(false);
        }
    };

    /** Leaves the pot banner behind and carries on (X6). The pot stays unsettled. */
    const handleCarryOnWithoutSettling = () => {
        if (!pendingRedirect || isSettlingPot) return;
        const destination = pendingRedirect;
        setPendingRedirect(null);
        navigateToHostPath(destination);
    };

    const handleResumeGame = async () => {
        if (!isController || isResuming) return;
        setActionError(null);
        setIsResuming(true);
        try {
            const result = await resumeGame(gameId);
            if (!result?.success && result?.code === 'stage_already_won') {
                // X4: the stage was won, so calling on would be for a prize that
                // is gone. The pad now offers Continue instead; the winners list
                // is what tells it so.
                void refreshWinnerLists();
            }
            if (!applyMutation(result, "Failed to resume game.")) return;
            setShowValidationModal(false);
            clearLocalClaim();
        } catch (err) {
            logError('host-control', err);
            setActionError("Could not reach the server to resume the game. Check the connection and try again.");
        } finally {
            setIsResuming(false);
        }
    };

    /**
     * Closes the claim modal and leaves the game paused. Only offered once the
     * stage has been won (resuming is then refused, X4): the pad takes over
     * with Continue and Check another claimant.
     */
    const handleCloseClaimAndStayPaused = () => {
        if (isCheckingWin || isUndoingForClaim) return;
        const attemptId = claimAttemptIdRef.current;
        if (attemptId) dismissedAttemptIdsRef.current.add(attemptId);
        setActionError(null);
        setShowValidationModal(false);
        clearLocalClaim();
    };

    /**
     * Rejects an invalid or late claim. With no winner at this stage that is
     * Reject & Resume. Once the stage has been won, resuming is refused (X4), so
     * the host goes to the Post Win choices instead: continue, check another
     * claimant, or stay paused.
     */
    const handleRejectClaim = async () => {
        if (!isCurrentStageWon) {
            await handleResumeGame();
            return;
        }
        handleCloseClaimAndStayPaused();
        openPostWinModal();
    };

    /** The pad's way on once the stage has been won (X4). */
    const handleContinueAfterStageWon = async () => {
        if (!isController) return;
        if (!hasNextStage) {
            // The last stage: Post Win has the right choices (next game, a
            // break, or finishing the session).
            openPostWinModal();
            return;
        }
        await handleContinuePlaying(false, currentGameState.current_stage_index);
    };

    /** Post Win "Close and stay paused" (spec 4.3). The guaranteed escape. */
    const handleClosePostWinAndStayPaused = () => {
        if (isPostWinBusy) return;
        setActionError(null);
        setShowPostWinModal(false);
        // Belt and braces: recordWinner already spent the claim, so there should
        // be nothing left to clear. This guarantees closing Post Win can never
        // reveal a live Record Winner button for a win that is already on record.
        clearSpentClaim();
    };

    const handleOpenVoidWinner = (winner: SessionWinner) => {
        setVoidWinnerTarget(winner);
        setVoidWinnerReason('');
        setVoidWinnerError(null);
    };

    const handleCloseVoidWinner = () => {
        if (isVoidingWinner) return;
        setVoidWinnerTarget(null);
        setVoidWinnerReason('');
        setVoidWinnerError(null);
    };

    /**
     * Voids a recorded winner with a reason (T4.7). This is the host's only route
     * out of an undo blocked by a winner on the last ball, so it has to work
     * without leaving the game screen.
     */
    const handleConfirmVoidWinner = async () => {
        if (!voidWinnerTarget || isVoidingWinner) return;
        const reason = voidWinnerReason.trim();
        if (reason.length === 0) {
            setVoidWinnerError("Give a reason before voiding this winner.");
            return;
        }
        setVoidWinnerError(null);
        setIsVoidingWinner(true);
        try {
            const result = await voidWinnerFromHost(sessionId, gameId, voidWinnerTarget.id, reason);
            if (!result?.success) {
                setVoidWinnerError(result?.error || "Failed to void that winner.");
                return;
            }
            await refreshWinnerLists();
            setVoidWinnerTarget(null);
            setVoidWinnerReason('');
        } catch (err) {
            logError('host-control', err);
            setVoidWinnerError("Could not reach the server to void that winner. Check the connection and try again.");
        } finally {
            setIsVoidingWinner(false);
        }
    };

    const isGameCompleted = currentGameState.status === 'completed';
    const isGameNotInProgress = currentGameState.status !== 'in_progress';
    const isPausedForValidation = currentGameState.paused_for_validation;

    const isNextNumberDisabled = !isController || isCallingNumber || currentGameState.on_break || isGameNotInProgress || isGameCompleted || isPausedForValidation || currentGameState.numbers_called_count >= 90;
    const isBreakToggleDisabled = !isController || isTogglingBreak || isGameNotInProgress || isGameCompleted || isPausedForValidation;
    // Once the stage has a winner, the paused banner offers Check another
    // claimant explicitly, so the pad's Check Claim stands down.
    const isValidateButtonDisabled = !isController || isPausing || isGameNotInProgress || currentGameState.on_break || isGameCompleted || currentGameState.numbers_called_count === 0 || (isPausedForValidation && isCurrentStageWon);
    const isVoidLastNumberDisabled = !isController || isVoiding || currentGameState.numbers_called_count === 0 || isGameCompleted || isPausedForValidation;
    const canVoidWinner = currentUserRole === 'admin';
    const hostSurfaceClass = "bg-[#003f27]/88 border border-[#1f7c58]";
    // Errors are red, so they never read as one of the amber status banners
    // (ON BREAK, CHECKING CLAIM) or the amber notices.
    const modalErrorClass = "p-3 bg-red-950/80 border-2 border-red-500 text-white rounded";
    // Every modal that can produce an actionError now renders it inside itself,
    // because a banner on the page behind a modal is a banner the host never sees.
    // The page banner therefore stands down while one of those is open: two
    // role="alert" regions holding the same text would be announced twice.
    const isActionErrorShownInModal = showValidationModal || showWinnerModal || showPostWinModal || showCashJackpotModal || showManualSnowballModal || showSessionWinnersModal || missingLastBall !== null;


    return (
        <div className="p-4 pb-24 max-w-5xl mx-auto relative text-white">
            {/* Controller Locked Overlay / Banner */}
            {!isController && (
                <div className="absolute inset-x-0 top-0 z-50 p-4">
                    <div className="bg-[#003f27]/95 border border-[#a57626] text-white p-4 rounded-xl shadow-2xl backdrop-blur-sm flex flex-col items-center gap-3 text-center">
                        <div>
                            <h3 className="font-bold text-lg">View Only Mode</h3>
                            <p className="text-sm text-white/85">Another host is currently controlling this game.</p>
                        </div>
                        {canTakeControl && (
                            <Button
                                variant="secondary"
                                className="bg-[#a57626] hover:bg-[#8f6621] border-[#a57626] text-white min-h-[44px]"
                                onClick={handleTakeControl}
                                disabled={isTakingControl}
                            >
                                {isTakingControl ? 'Taking control…' : 'Take Control'}
                            </Button>
                        )}
                    </div>
                </div>
            )}

            {/* Connection banner. Shows during a reconnect, and auto-refreshes
                only when the browser believes it is online AND the host is not
                mid-way through something a reload would throw away. */}
            <ConnectionBanner
                visible={health.shouldShowBanner}
                shouldAutoRefresh={health.shouldAutoRefresh}
                hasUnsavedWork={hasUnsavedWork}
            />

            <NewVersionBanner visible={showNewVersionPrompt} onReload={reloadForNewVersion} />

            {/* Alerts. Hidden while any modal that renders the same error inside
                itself is open, because that is where the host can actually see it. */}
            {actionError && !isActionErrorShownInModal && (
                <div role="alert" className="mb-4 p-4 bg-red-950/80 border-2 border-red-500 text-white rounded-lg text-center font-semibold">{actionError}</div>
            )}
            {isGameCompleted && <div className="mb-4 p-4 bg-[#003f27]/90 border border-[#1f7c58] text-white rounded-lg text-center">Game Completed</div>}
            {currentGameState.on_break && <div className="mb-4 p-4 bg-[#a57626]/20 border border-[#a57626] text-white rounded-lg text-center text-lg font-bold">ON BREAK</div>}
            {currentGameState.paused_for_validation && <div className="mb-4 p-4 bg-[#a57626]/25 border border-[#a57626] text-white rounded-lg text-center text-lg font-bold">CHECKING CLAIM...</div>}

            {/* Main Display Card */}
            <Card className={cn(hostSurfaceClass, "mb-4 overflow-hidden")}>
                <CardContent className="p-5 flex flex-col items-center text-center">
                    {currentGameState.numbers_called_count === 0 ? (
                        // Pre-game briefing — scrolls inside its own container so primary controls stay pinned.
                        <div className="w-full max-h-[55vh] overflow-y-auto pr-1">
                            <PreGameBriefing
                                game={game}
                                currentSnowballPot={currentSnowballPot}
                                isFirstGameOfSession={isFirstGameOfSession}
                            />
                        </div>
                    ) : (
                        <>
                            {currentNickname && (
                                <h2 className="text-3xl font-bold text-white mb-3 animate-in fade-in slide-in-from-top-4">
                                    {currentNickname}
                                </h2>
                            )}
                            <div className="mb-3 relative">
                                {currentNumber ? (
                                    <BingoBall
                                        number={currentNumber}
                                        variant="active"
                                        className="w-32 h-32 text-6xl bg-[#005131] border-[#a57626]/70 text-white shadow-[0_0_40px_rgba(165,118,38,0.35)]"
                                    />
                                ) : (
                                    // Edge case: numbers_called_count > 0 but no current number resolvable.
                                    // Keep a small READY fallback for safety.
                                    <div className="w-32 h-32 rounded-full bg-[#005131] border-4 border-[#1f7c58] flex items-center justify-center text-white/70 text-sm font-bold">
                                        READY
                                    </div>
                                )}
                            </div>

                            <div className="flex items-center gap-6 text-sm text-white/90 border-t border-[#1f7c58] pt-3 w-full justify-center">
                                <div>
                                    <span className="block text-white/80 uppercase text-sm tracking-wider mb-1">Calls</span>
                                    <span className="text-xl font-mono text-white">{currentGameState.numbers_called_count}</span>
                                </div>
                                <div className="h-8 w-px bg-[#1f7c58]"></div>
                                <div>
                                    <span className="block text-white/80 uppercase text-sm tracking-wider mb-1">Playing For</span>
                                    <span className="text-xl font-bold text-white">{currentStageName || 'Finished'}</span>
                                </div>
                                <div className="h-8 w-px bg-[#1f7c58]"></div>
                                <div>
                                    <span className="block text-white/80 uppercase text-sm tracking-wider mb-1">Prize</span>
                                    {isStagePrizeMissing ? (
                                        <span className="text-xl font-bold text-destructive">⚠️ Prize not set</span>
                                    ) : (
                                        <span className="text-xl font-bold text-white">{plannedStagePrize}</span>
                                    )}
                                </div>
                            </div>
                            {isSnowballGame && (
                                <div className="mt-4 w-full rounded-xl border border-[#a57626]/70 bg-[#005131]/65 px-4 py-3 flex flex-col items-center text-center gap-2 md:flex-row md:items-center md:justify-between md:text-left">
                                    {currentSnowballPot && snowballCallsLabel ? (
                                        <>
                                            <p className="text-white font-semibold">
                                                Snowball Jackpot: £{formatPounds(Number(currentSnowballPot.current_jackpot_amount))}
                                            </p>
                                            <p className="text-white/90 font-semibold text-center md:text-right">
                                                {snowballCallsLabel}
                                                {` • ${currentGameState.numbers_called_count}/${currentSnowballPot.current_max_calls} calls`}
                                                {typeof snowballCallsRemaining === 'number' ? ` • ${snowballCallsRemaining} left` : ''}
                                            </p>
                                        </>
                                    ) : potLoadState === 'failed' ? (
                                        <p className="text-white font-semibold" role="alert">
                                            Snowball pot could not be loaded. Still retrying. Do not record a Full
                                            House on this game until the jackpot figure appears here.
                                        </p>
                                    ) : potLoadState === 'loading' ? (
                                        <p className="text-white/90 font-semibold">Loading the snowball pot…</p>
                                    ) : (
                                        <p className="text-white/90 font-semibold">
                                            Snowball countdown unavailable: this game is not linked to a snowball pot.
                                        </p>
                                    )}
                                </div>
                            )}
                        </>
                    )}
                </CardContent>
            </Card>

            {potNeedsSettling && (
                <div className="mb-4 rounded-xl border border-[#a57626] bg-[#7a5719]/50 p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <p className="font-bold text-white">The game ended but the snowball pot did not update</p>
                        <p className="text-base text-white/85">
                            The jackpot is still showing its old figure. Trying again is safe: if it did
                            move after all, this will say so and change nothing.
                        </p>
                        {pendingRedirect && (
                            <p className="text-base text-white/85 mt-1">
                                Settle it before you move on if you can. If you carry on without it, ask an
                                admin to settle it from the host console.
                            </p>
                        )}
                    </div>
                    <div className="flex flex-col gap-2 shrink-0">
                        <Button
                            variant="primary"
                            size="lg"
                            className="min-h-[56px]"
                            onClick={handleRetrySettlement}
                            disabled={isSettlingPot}
                        >
                            {isSettlingPot ? 'Settling…' : 'Settle the pot'}
                        </Button>
                        {pendingRedirect && (
                            <Button
                                variant="ghost"
                                className="min-h-[44px] text-white/85 hover:text-white hover:bg-[#0f6846]"
                                onClick={handleCarryOnWithoutSettling}
                                disabled={isSettlingPot}
                            >
                                {pendingRedirect === '/host' ? 'Leave without settling' : 'Go to the next game without settling'}
                            </Button>
                        )}
                    </div>
                </div>
            )}

            {/* The way out of a claim pause.

                Resume used to live ONLY inside the validation modal. "Close and
                stay paused" closes that modal and leaves paused_for_validation
                true, and every control on this pad is disabled while it is: no
                Next Number, no Break, no Undo, no Resume. The host was stuck with
                nothing to press, and the Post Win modal's own copy told them to
                "Resume ... from the main pad", which did not exist. The only way
                out was to reopen Check Claim and cancel it.

                Once the stage has a winner, Resume is refused (X4): "Close and
                stay paused" then "Resume calling" used to carry on calling for a
                prize that had already gone. The way out is then Continue to the
                next stage, or Check another claimant for a tie. */}
            {isPausedForValidation && !isGameCompleted && (
                isCurrentStageWon ? (
                    <div className={cn(
                        "mb-4 rounded-xl border border-[#a57626] bg-[#7a5719]/40 p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between",
                        !isController && "opacity-50 pointer-events-none"
                    )}>
                        <div>
                            <p className="font-bold text-white">{currentStageName} has been won</p>
                            <p className="text-base text-white/85">
                                Move on when the room is ready, or check another claimant if someone else
                                has the same win.
                            </p>
                        </div>
                        <div className="flex flex-col gap-2 shrink-0 sm:items-end">
                            <Button
                                variant="primary"
                                size="lg"
                                className="min-h-[56px]"
                                onClick={() => { void handleContinueAfterStageWon(); }}
                                disabled={!isController || isAdvancing || isPausing}
                            >
                                {isAdvancing
                                    ? 'Working…'
                                    : hasNextStage && nextStageName ? `Continue to ${nextStageName}` : 'Finish this game'}
                            </Button>
                            <Button
                                variant="secondary"
                                className="min-h-[44px] border-[#a57626] text-white hover:bg-[#a57626]/20"
                                onClick={() => { void handleBeginClaimCheck(true); }}
                                disabled={!isController || isPausing || isAdvancing}
                            >
                                {isPausing ? 'Starting…' : 'Check another claimant'}
                            </Button>
                        </div>
                    </div>
                ) : (
                    <div className={cn(
                        "mb-4 rounded-xl border border-[#a57626] bg-[#7a5719]/40 p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between",
                        !isController && "opacity-50 pointer-events-none"
                    )}>
                        <div>
                            <p className="font-bold text-white">Paused for a claim check</p>
                            <p className="text-sm text-white/85">Calling is on hold until you resume.</p>
                        </div>
                        <Button
                            variant="primary"
                            size="lg"
                            className="min-h-[56px] shrink-0"
                            onClick={handleResumeGame}
                            disabled={!isController || isResuming}
                        >
                            {isResuming ? 'Resuming…' : 'Resume calling'}
                        </Button>
                    </div>
                )
            )}

            {/* Control Pad */}
            <div className={cn("grid grid-cols-2 gap-3 mb-4", !isController && "opacity-50 pointer-events-none")}>
                <Button
                    variant="primary"
                    size="xl"
                    className={cn("col-span-2 h-20 text-2xl bg-[#005131] hover:bg-[#0f6846] border border-[#a57626] shadow-lg shadow-black/20", isCallingNumber && "opacity-80")}
                    onClick={handleCallNextNumber}
                    disabled={isNextNumberDisabled}
                >
                    {isCallingNumber ? "CALLING..." : currentGameState.numbers_called_count >= 90 ? "ALL NUMBERS CALLED" : "NEXT NUMBER"}
                </Button>

                <Button
                    variant={currentGameState.on_break ? 'secondary' : 'secondary'}
                    size="lg"
                    className={cn("h-16 bg-[#0f6846] hover:bg-[#136f4b] border border-[#1f7c58] text-white", currentGameState.on_break ? "bg-[#a57626] hover:bg-[#8f6621] border-[#a57626]" : "")}
                    onClick={handleToggleBreak}
                    disabled={isBreakToggleDisabled}
                >
                    {isTogglingBreak
                        ? (currentGameState.on_break ? 'Resuming…' : 'Starting break…')
                        : (currentGameState.on_break ? 'Resume Session' : 'Take Break')}
                </Button>

                <Button
                    variant="secondary"
                    size="lg"
                    className="h-16 bg-[#0f6846] border border-[#a57626] text-white hover:bg-[#136f4b]"
                    onClick={() => { void handleBeginClaimCheck(false); }}
                    disabled={isValidateButtonDisabled}
                >
                    {isPausing ? 'Pausing…' : 'Check Claim'}
                </Button>
            </div>

            {/* Secondary Controls */}
            <div className={cn("flex justify-center gap-4 mb-8", !isController && "opacity-50 pointer-events-none")}>
                <Button
                    variant="ghost"
                    size="sm"
                    className="text-white/80 hover:text-white hover:bg-[#0f6846] min-h-[44px]"
                    onClick={handleOpenUndoModal}
                    disabled={isVoidLastNumberDisabled}
                >
                    Undo Last Call
                </Button>
                <Button
                    variant="ghost"
                    size="sm"
                    className="text-white/80 hover:text-white hover:bg-[#0f6846] min-h-[44px]"
                    onClick={() => { setEndGameError(null); setShowEndGameModal(true); }}
                    disabled={!isController || isGameNotInProgress || isGameCompleted}
                >
                    End Game
                </Button>
            </div>
            <div className="flex justify-center mb-8">
                <Button
                    variant="secondary"
                    size="sm"
                    className="border-[#a57626] text-white hover:bg-[#0f6846] min-h-[44px]"
                    onClick={() => {
                        setActionError(null);
                        setShowSessionWinnersModal(true);
                        // Pick up anything another device recorded. The list is
                        // not live, so opening it is the moment to re-read it.
                        void refreshWinnerLists();
                    }}
                >
                    Winners &amp; Prizes ({sessionWinners.length})
                </Button>
            </div>

            {/* Manual Snowball Win.

                Offered only while the jackpot window is genuinely open, and only
                during Full House. It used to be offered at any stage and at any
                call count, and it set p_force_snowball_jackpot, which skipped the
                window check inside record_winner_atomic entirely. So the button
                paid the full pot after the window had closed, on a stage that was
                not Full House, with nothing recording that it had been forced.

                The database now refuses to award the jackpot outside the window on
                this route as well. Hiding the button when it cannot legitimately
                be used is the other half: a control that silently records an
                ordinary win instead of the jackpot the host thought they were
                awarding would be worse than no control. */}
            {isSnowballGame && (
                <div className={cn("flex flex-col items-center gap-2 mb-8", !isController && "opacity-50 pointer-events-none")}>
                    {currentSnowballPot && isSnowballEligibilityStage && isSnowballJackpotWindowOpen ? (
                        <Button
                            variant="secondary"
                            size="sm"
                            className="bg-[#0f6846] border-[#a57626] text-white hover:bg-[#136f4b] min-h-[44px]"
                            onClick={() => {
                                setActionError(null);
                                setPrizeDescription(`£${formatPounds(Number(currentSnowballPot.current_jackpot_amount))} (Manual Snowball Win)`);
                                // Fresh key per award. This path pays the jackpot, so
                                // it is the one where a retried tap costs real money.
                                manualSnowballRequestIdRef.current = newClaimRequestId();
                                setShowManualSnowballModal(true);
                            }}
                        >
                            🏆 Manual Snowball Win
                        </Button>
                    ) : currentSnowballPot && isSnowballEligibilityStage ? (
                        <p className="text-sm text-white/70 text-center max-w-sm">
                            The jackpot window has closed, so the jackpot cannot be awarded from this
                            screen. A Full House still records as a normal win.
                        </p>
                    ) : null}
                </div>
            )}

            {/* Last Numbers Strip */}
            <div className="overflow-x-auto pb-4 mb-6">
                <div className="flex gap-2 justify-center min-w-max px-4">
                    {lastNNumbers.map((num, i) => (
                        <BingoBall key={i} number={num} variant="called" className="w-12 h-12 text-lg" />
                    ))}
                    {lastNNumbers.length === 0 && <p className="text-white/70 text-sm italic">No history yet</p>}
                </div>
            </div>

            {/* Winners List */}
            {currentWinners.length > 0 && (
                <Card className={cn(hostSurfaceClass, "mb-8 mx-4 md:mx-0")}>
                    <div className="p-4 border-b border-[#1f7c58]">
                        <h3 className="font-bold text-white">Winners</h3>
                    </div>
                    <div className="divide-y divide-[#1f7c58]">
                        {currentWinners.map(winner => {
                            // X14: a voided win is not a prize owed. It used to
                            // look like any other on this card, with a working
                            // Give Prize button; set_winner_prize_given now
                            // refuses it too.
                            const isVoid = winner.is_void === true;
                            // X22: the ordinary share plus the jackpot share.
                            const totalLine = describeWinnerTotal(winnerTotalPence(winner));
                            return (
                                <div key={winner.id} className="p-4 flex items-center justify-between gap-4">
                                    <div className="min-w-0">
                                        <p className="font-bold text-white">{winner.winner_name}</p>
                                        <p className={cn("text-base text-white/85", isVoid && "line-through")}>
                                            {winner.stage} - {winner.prize_description}
                                        </p>
                                        {totalLine && (
                                            <p className="text-base font-semibold text-white">{totalLine}</p>
                                        )}
                                    </div>
                                    {isVoid ? (
                                        <span className="px-2 py-1 rounded-full text-sm font-semibold border border-[#a57626] text-white bg-[#a57626]/20 shrink-0">
                                            VOID
                                        </span>
                                    ) : (
                                        <Button
                                            size="sm"
                                            variant={winner.prize_given ? "outline" : "secondary"}
                                            className={cn(
                                                "min-w-[100px] shrink-0",
                                                winner.prize_given ? "text-white border-[#a57626] hover:bg-[#a57626]/20" : "bg-[#a57626] hover:bg-[#8f6621] text-white border-[#a57626]"
                                            )}
                                            onClick={() => handleTogglePrize(winner.id, winner.prize_given || false)}
                                            disabled={!canTogglePrize}
                                        >
                                            {winner.prize_given ? "Given ✅" : "Give Prize"}
                                        </Button>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </Card>
            )}

            {/* Validation Modal */}
            <Modal
                isOpen={showValidationModal}
                onClose={() => {
                    if (!currentGameState.paused_for_validation) setShowValidationModal(false);
                }}
                showCloseButton={false}
                title="Validate Ticket"
                className="max-w-4xl h-[80vh] bg-[#003f27] border border-[#1f7c58]"
            >
                <div className="flex flex-col h-full">
                    <div className="shrink-0 mb-4">
                        {/* Suppressed while Record Winner is stacked on top of this
                            modal: that one renders the same error where the host is
                            looking, and two role="alert" regions holding the same
                            text would be announced twice. */}
                        {actionError && !showWinnerModal && missingLastBall === null && <div role="alert" className={cn(modalErrorClass, "mb-3")}>{actionError}</div>}

                        {/* Shown under the error, never instead of it: an adopted
                            claim, a full grid. */}
                        {claimNotice && (
                            <p role="status" className="mb-3 text-center text-sm font-semibold text-[#f3d59d]">{claimNotice}</p>
                        )}

                        {/* The draft queue failed a send and is retrying by itself.
                            The claim here is safe either way: Check Win sends the
                            full list. Only the room's view is behind. */}
                        {draftQueueState === 'retrying' && (
                            <p role="status" className="mb-3 text-center text-sm font-semibold text-white">
                                TV not updated, retrying
                            </p>
                        )}

                        {/* Claim progress. Big enough to read at arm's length behind the
                            bar, and announced politely so it does not chatter. Stays up
                            after a rejected claim, because that is when the host is
                            re-counting the ticket. The last-ball line is a guide
                            only: a claim without it goes to the server, which asks
                            whether it came before that ball was announced (A1). */}
                        {claimVerdict !== 'valid' && (
                            <div aria-live="polite" className="text-center mb-3">
                                {isStageValidForClaimCheck ? (
                                    <p className={cn(
                                        "text-4xl font-bold font-mono tabular-nums",
                                        isClaimCountMet ? "text-[#f3d59d]" : "text-white",
                                    )}>
                                        {selectedNumbers.length}/{requiredSelectionCount}
                                    </p>
                                ) : (
                                    <p className="text-lg font-bold text-white">This stage is not valid for claim checking.</p>
                                )}
                                {isStageValidForClaimCheck && (
                                    <p className={cn(
                                        "text-base font-semibold mt-1",
                                        claimIncludesLastBall ? "text-[#f3d59d]" : "text-white/85",
                                    )}>
                                        {claimIncludesLastBall ? '✓' : '✗'} Includes last ball ({currentNumber ?? 'none'})
                                    </p>
                                )}
                            </div>
                        )}

                        {/* Record Winner and Skip used to sit 8px apart on the same
                            row, on a phone, at the moment the host is looking at a
                            punter rather than at the screen. Skip closes the stage
                            with its prize unawarded and cannot be undone, while the
                            cheaper Undo Last Call has a confirmation. Skip is now
                            separated, quieter, and confirmed. */}
                        {claimVerdict === 'valid' ? (
                            <div className="p-4 bg-[#005131]/80 border border-[#1f7c58] rounded-lg mb-4">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <span className="text-white font-bold text-lg">Valid Claim</span>
                                    <Button className="min-h-[48px]" onClick={handleOpenRecordWinnerModal}>Record Winner</Button>
                                </div>
                                <p className="mt-2 text-sm text-white/85">
                                    The TV shows every number as called. The win goes up on screen once you record it.
                                </p>
                                <div className="mt-4 pt-3 border-t border-[#1f7c58]/70">
                                    <Button
                                        variant="ghost"
                                        onClick={openSkipConfirm}
                                        disabled={isSkipping}
                                        className="text-white/70 hover:text-white hover:bg-[#0f6846] min-h-[44px] text-sm"
                                    >
                                        {isSkipping ? 'Skipping…' : 'Skip this stage with no winner'}
                                    </Button>
                                </div>
                            </div>
                        ) : claimVerdict === 'invalid' || claimVerdict === 'late' ? (
                            <div className="p-4 bg-[#a57626]/20 border border-[#a57626] rounded-lg mb-4">
                                <span className="text-white font-bold text-lg block mb-1">
                                    {claimVerdict === 'late' ? 'Too late' : 'Not a winner'}
                                </span>
                                <span className="text-white/85 text-sm">
                                    {claimVerdict === 'late'
                                        ? `The claim had to include ${currentNumber ?? 'the last number called'}.`
                                        : `Numbers not called: ${claimNumbersNotCalled.join(', ')}`}
                                </span>
                                <div className="mt-3 flex flex-wrap gap-2">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => { void handleRejectClaim(); }}
                                        disabled={isResuming || isPausing}
                                        className="text-white border-[#a57626] hover:bg-[#a57626]/25 min-h-[44px]"
                                    >
                                        {isResuming ? 'Resuming…' : isCurrentStageWon ? 'Reject' : 'Reject & Resume'}
                                    </Button>
                                    <Button
                                        variant="secondary"
                                        size="sm"
                                        onClick={() => { void handleBeginClaimCheck(true); }}
                                        disabled={isResuming || isPausing}
                                        className="min-h-[44px]"
                                    >
                                        {isPausing ? 'Starting…' : 'Check another claimant'}
                                    </Button>
                                </div>
                            </div>
                        ) : (
                            <div className="space-y-2">
                                <p className="text-white/85 text-sm text-center">Tap the claimed numbers on the grid below, in the order the caller reads them. The TV shows each one as you tap it.</p>
                                {isStageValidForClaimCheck ? (
                                    <p className="text-white text-sm text-center font-semibold">Select exactly {requiredSelectionCount} numbers for {currentStageName || 'this stage'}.</p>
                                ) : (
                                    <p className="text-white text-sm text-center font-semibold">Check the game&apos;s stages in the admin screen, then try again.</p>
                                )}
                                <p className="text-white/75 text-sm text-center">A winning claim includes the last called number (highlighted).</p>
                            </div>
                        )}
                    </div>

                    {/* The claim grid.

                        This is the screen where a mis-tap pays the wrong person,
                        and it was the least forgiving screen in the app. Ten
                        columns inside a max-w-lg modal put the targets at roughly
                        27px on a phone, well under the 44px minimum, with a 4px
                        gap between them. Called and uncalled numbers differed only
                        by text opacity (white/55 against white) plus a 60 percent
                        alpha hairline, which is not a difference you can rely on
                        in a dim pub at arm's length.

                        Six columns on a phone gives roughly 48px targets. The
                        called state is now a different background, not a different
                        text opacity, and every button carries aria-pressed and a
                        spoken label so the state is not conveyed by colour alone.
                        A called number also carries a tick in its corner, so the
                        difference is a shape on screen as well (spec 5.7), and the
                        numbers are 20px on a phone and 24px from sm up.

                        Locked once the server has given its verdict: the verdict
                        belongs to exactly these numbers. A different claim is
                        Check another claimant. */}
                    <div className="flex-1 overflow-y-auto bg-[#003f27]/80 rounded-lg p-2 border border-[#1f7c58]">
                        <div className="grid grid-cols-6 sm:grid-cols-10 gap-1.5 sm:gap-2">
                            {Array.from({ length: 90 }, (_, i) => i + 1).map(num => {
                                const isSelected = selectedNumbers.includes(num);
                                const isCalled = calledNumberSet.has(num);
                                const isLastCalled = num === currentNumber;

                                // Uncalled: dark and flat. Anything tapped that is
                                // not called is the fault the host needs to see, so
                                // it is the loudest state on the grid.
                                let buttonStyle = "bg-[#00301d] text-white/70 border border-[#1f7c58]/60 hover:bg-[#0f6846]";

                                if (isSelected) {
                                    if (isCalled) {
                                        buttonStyle = "bg-[#f3d59d] text-[#00301d] font-bold shadow-lg shadow-black/30 z-10 border-2 border-white";
                                    } else {
                                        buttonStyle = "bg-red-600 text-white font-bold shadow-lg shadow-black/30 z-10 border-2 border-white";
                                    }
                                } else if (isLastCalled) {
                                    buttonStyle = "bg-[#a57626] text-white font-bold border-2 border-white ring-2 ring-[#f3d59d] ring-offset-0";
                                } else if (isCalled) {
                                    buttonStyle = "bg-[#0f6846] text-white font-bold border border-[#a57626]";
                                }

                                const stateLabel = isSelected
                                    ? (isCalled ? 'selected, called' : 'selected, NOT called')
                                    : isLastCalled
                                        ? 'last ball called'
                                        : isCalled ? 'called' : 'not called';

                                return (
                                    <button
                                        key={num}
                                        type="button"
                                        onClick={() => handleToggleNumber(num)}
                                        aria-pressed={isSelected}
                                        aria-label={`${num}, ${stateLabel}`}
                                        className={cn(
                                            "relative aspect-square min-h-[44px] sm:min-h-0 flex items-center justify-center text-xl sm:text-2xl rounded transition-colors",
                                            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white",
                                            buttonStyle
                                        )}
                                        disabled={!isController || claimVerdict !== null || claimAttemptId === null}
                                    >
                                        {num}
                                        {isCalled && (
                                            <svg
                                                viewBox="0 0 24 24"
                                                aria-hidden="true"
                                                className="pointer-events-none absolute right-[6%] top-[6%] h-[30%] w-[30%]"
                                            >
                                                <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
                                            </svg>
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* Read-back. The host is comparing a paper ticket against a
                        grid of ninety cells; asking them to verify the tap by
                        finding it again in the grid is asking them to make the
                        same mistake twice. In tap order, because that is exactly
                        what the TV and the phones are showing the room. Numbers
                        that were tapped but never called are called out
                        separately, because that is the one case that must not
                        reach "Check Win" unnoticed. */}
                    {selectedNumbers.length > 0 && claimVerdict === null && (
                        <div className="shrink-0 mt-3 rounded-lg border border-[#1f7c58] bg-[#00301d] p-3" aria-live="polite">
                            <p className="text-sm uppercase tracking-wider text-white/70 mb-1">You have tapped, as the TV shows it</p>
                            <p className="font-mono text-lg text-white tabular-nums break-words">
                                {selectedNumbers.join('  ')}
                            </p>
                            {claimNumbersNotCalled.length > 0 && (
                                <p className="mt-2 text-sm font-semibold text-red-300">
                                    Not called yet:{' '}
                                    {[...claimNumbersNotCalled].sort((a, b) => a - b).join(', ')}
                                </p>
                            )}
                        </div>
                    )}

                    <div className="shrink-0 pt-4 mt-4 border-t border-[#1f7c58] flex justify-between gap-3">
                        {isCurrentStageWon ? (
                            // Resume is refused once the stage has a winner (X4).
                            // Close leaves the game paused; the pad offers
                            // Continue and Check another claimant.
                            <Button variant="secondary" className="min-h-[44px]" onClick={handleCloseClaimAndStayPaused} disabled={isCheckingWin || isUndoingForClaim}>
                                Close
                            </Button>
                        ) : (
                            <Button variant="secondary" className="min-h-[44px]" onClick={handleResumeGame} disabled={isResuming}>
                                {isResuming ? 'Resuming…' : currentGameState.paused_for_validation ? 'Cancel & Resume' : 'Cancel'}
                            </Button>
                        )}
                        <div className="flex gap-2">
                            <Button variant="ghost" className="min-h-[44px]" onClick={handleClearSelection} disabled={selectedNumbers.length === 0 || claimVerdict !== null}>Clear</Button>
                            <Button
                                variant="primary"
                                className="min-h-[44px]"
                                onClick={handleCheckWin}
                                disabled={!isStageValidForClaimCheck || isCheckingWin || isUndoingForClaim || isPausing || !isClaimCountMet || claimVerdict !== null || claimAttemptId === null}
                            >
                                {isCheckingWin ? 'Checking…' : 'Check Win'}
                            </Button>
                        </div>
                    </div>
                </div>
            </Modal>

            {/* The claim missed the last number called (spec 5.2, A1). The app
                does not guess from timings, because the TV can lag: the host
                decides. Yes takes that one ball back off the board, bound to
                this attempt, then checks the same numbers again. No rejects the
                claim as late. */}
            <Modal
                isOpen={missingLastBall !== null}
                onClose={() => { if (!isUndoingForClaim && !isCheckingWin) setMissingLastBall(null); }}
                title="The last number is not in this claim"
                className="bg-[#003f27] border border-[#1f7c58] max-w-md"
            >
                <div className="space-y-4">
                    {actionError && (
                        <div role="alert" className={modalErrorClass}>{actionError}</div>
                    )}
                    <p className="text-white text-lg font-semibold">
                        This claim does not include the last number called ({missingLastBall?.lastNumber}). Did they call before {missingLastBall?.lastNumber} was announced?
                    </p>
                    {missingLastBall && !missingLastBall.undoAvailable && (
                        <p className="text-sm text-white/85">
                            A number has already been undone once for this claim, so it can only be rejected as late now.
                        </p>
                    )}
                    <div className="flex flex-col gap-3 pt-2">
                        {missingLastBall?.undoAvailable && (
                            <Button
                                variant="primary"
                                className="min-h-[48px] w-full"
                                onClick={() => { void handleUndoLastBallAndRecheck(); }}
                                disabled={isUndoingForClaim || isCheckingWin}
                            >
                                {isUndoingForClaim ? 'Undoing and checking…' : `Yes: undo ${missingLastBall.lastNumber} and check again`}
                            </Button>
                        )}
                        <Button
                            variant="secondary"
                            className="min-h-[48px] w-full"
                            onClick={() => { void handleRejectAsLate(); }}
                            disabled={isUndoingForClaim || isCheckingWin}
                        >
                            {isCheckingWin ? 'Checking…' : 'No: reject as late'}
                        </Button>
                    </div>
                </div>
            </Modal>

            {/* Session Winners Modal */}
            <Modal
                isOpen={showSessionWinnersModal}
                onClose={() => setShowSessionWinnersModal(false)}
                title="Session Winners & Prizes"
                className="max-w-4xl bg-[#003f27] border border-[#1f7c58]"
            >
                <div className="space-y-4">
                    {/* Mark Given raises actionError, and this modal covers the page
                        banner, so a failed toggle would otherwise be invisible. */}
                    {actionError && (
                        <div role="alert" className={modalErrorClass}>{actionError}</div>
                    )}
                    <p className="text-sm text-white/85">
                        Review winners across all games in this session and mark prizes as given when handed out.
                        Voiding a winner is how you clear an undo that is blocked by a win on the last ball.
                    </p>
                    {!canVoidWinner && (
                        <p className="text-sm text-white/75">
                            Only an admin can void a winner. Ask an admin to void it, then undo.
                        </p>
                    )}
                    {sessionWinners.length === 0 ? (
                        <div className="rounded-lg border border-[#1f7c58] bg-[#003f27]/80 p-6 text-sm text-white/70">
                            No winners recorded yet.
                        </div>
                    ) : (
                        <div className="max-h-[60vh] overflow-y-auto rounded-lg border border-[#1f7c58] divide-y divide-[#1f7c58]">
                            {sessionWinners.map((winner) => (
                                <div key={winner.id} className="p-4 flex items-center justify-between gap-4">
                                    <div className="min-w-0">
                                        <p className="font-bold text-white truncate">{winner.winner_name}</p>
                                        <p className="text-sm text-white/85">
                                            {winner.game ? `Game ${winner.game.game_index}: ${winner.game.name}` : 'Unknown game'} • {winner.stage}
                                        </p>
                                        <p className={cn("text-base text-white/70 truncate", winner.is_void && "line-through")}>
                                            {winner.prize_description || 'No prize description'}
                                        </p>
                                        {(() => {
                                            const totalLine = describeWinnerTotal(winnerTotalPence(winner));
                                            return totalLine ? <p className="text-base font-semibold text-white">{totalLine}</p> : null;
                                        })()}
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                        {winner.is_void && (
                                            <span className="px-2 py-1 rounded-full text-sm font-semibold border border-[#a57626] text-white bg-[#a57626]/20">
                                                VOID
                                            </span>
                                        )}
                                        {/* X14: no prize to hand over on a voided win. */}
                                        {!winner.is_void && (
                                            <Button
                                                size="sm"
                                                variant={winner.prize_given ? "outline" : "secondary"}
                                                className={cn(
                                                    "min-w-[120px] min-h-[44px]",
                                                    winner.prize_given ? "text-white border-[#a57626] hover:bg-[#a57626]/20" : "bg-[#a57626] hover:bg-[#8f6621] text-white border-[#a57626]"
                                                )}
                                                onClick={() => handleTogglePrize(winner.id, winner.prize_given || false)}
                                                disabled={!canTogglePrize}
                                            >
                                                {winner.prize_given ? "Given ✅" : "Mark Given"}
                                            </Button>
                                        )}
                                        {!winner.is_void && (
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                className="min-h-[44px] text-white border-[#a57626] hover:bg-[#a57626]/20"
                                                onClick={() => handleOpenVoidWinner(winner)}
                                                disabled={!canVoidWinner}
                                                title={canVoidWinner ? undefined : 'Only an admin can void a winner. Ask an admin to void it, then undo.'}
                                            >
                                                Void
                                            </Button>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
                <div className="mt-6 flex justify-end">
                    <Button variant="secondary" className="min-h-[44px]" onClick={() => setShowSessionWinnersModal(false)}>
                        Close
                    </Button>
                </div>
            </Modal>

            {/* Void Winner Confirm (T4.7). Reason is mandatory, and this is the only
                route out of an undo blocked by a winner on the last ball. */}
            <Modal
                isOpen={voidWinnerTarget !== null}
                onClose={handleCloseVoidWinner}
                title="Void this winner"
                className="bg-[#003f27] border border-[#1f7c58] max-w-md"
            >
                <div className="space-y-4">
                    {voidWinnerError && (
                        <div role="alert" className={modalErrorClass}>
                            {voidWinnerError}
                        </div>
                    )}
                    <p className="text-base text-white/90">
                        {voidWinnerTarget
                            ? `Voiding the ${voidWinnerTarget.stage} win${voidWinnerTarget.game ? ` from Game ${voidWinnerTarget.game.game_index}` : ''}. The win stays on record, marked void, and stops counting towards the snowball pot.`
                            : ''}
                    </p>
                    <div>
                        <label htmlFor="voidWinnerReason" className="text-base text-white/85 block mb-1">
                            Reason (required)
                        </label>
                        <textarea
                            id="voidWinnerReason"
                            value={voidWinnerReason}
                            onChange={(e) => setVoidWinnerReason(e.target.value)}
                            rows={3}
                            placeholder="e.g. Claim called on the wrong ball"
                            className="w-full rounded-md border border-[#1f7c58] bg-[#005131] px-3 py-2 text-base text-white placeholder:text-white/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#a57626]"
                        />
                    </div>
                </div>
                <div className="mt-6 flex justify-end gap-3">
                    <Button variant="secondary" className="min-h-[44px]" onClick={handleCloseVoidWinner} disabled={isVoidingWinner}>
                        Cancel
                    </Button>
                    <Button
                        variant="primary"
                        className="min-h-[44px] bg-[#a57626] hover:bg-[#8f6621] border border-[#a57626]"
                        onClick={handleConfirmVoidWinner}
                        disabled={isVoidingWinner || voidWinnerReason.trim().length === 0}
                    >
                        {isVoidingWinner ? 'Voiding…' : 'Void winner'}
                    </Button>
                </div>
            </Modal>

            {/* Undo Confirm (T4.3). Names the ball and says plainly that it goes back
                in the bag, because "undo" reads as "skip" to a host mid-game. */}
            <Modal
                isOpen={showSkipConfirm}
                onClose={() => { if (!isSkipping) { setShowSkipConfirm(false); setSkipError(null); } }}
                title={`Skip ${skipStageName || 'this stage'} with no winner?`}
                className="bg-[#003f27] border border-[#1f7c58] max-w-md"
            >
                <div className="space-y-4">
                    <p className="text-white/90">
                        The stage closes and its prize is not awarded to anyone. This cannot be undone:
                        a game can only move forwards through its stages.
                    </p>
                    {skipStagePrize && (
                        <p className="text-base text-[#f3d59d]">
                            Unawarded: {skipStagePrize}
                        </p>
                    )}
                    {skipIsFinalStage && (
                        <p className="text-base text-white/85">
                            This is the last stage, so skipping it ends the game.
                        </p>
                    )}
                    {skipError && (
                        <div role="alert" className={modalErrorClass}>
                            {skipError}
                        </div>
                    )}
                    <div className="flex justify-end gap-3 pt-2">
                        <Button variant="ghost" type="button" onClick={() => setShowSkipConfirm(false)} disabled={isSkipping}>
                            Keep the stage open
                        </Button>
                        <Button variant="danger" type="button" onClick={handleSkipStage} disabled={isSkipping}>
                            {isSkipping ? 'Skipping…' : 'Skip the stage'}
                        </Button>
                    </div>
                </div>
            </Modal>

            <Modal
                isOpen={showEndGameModal}
                onClose={() => { if (!isEndingGame) { setShowEndGameModal(false); setEndGameError(null); } }}
                title="End this game now?"
            >
                <div className="space-y-4">
                    <p className="text-white/90">
                        The game is closed with no further winner recorded. Any stage still to play is
                        left unplayed.
                    </p>
                    {isSnowballGame && (
                        <p className="text-base text-[#f3d59d]">
                            This is the snowball game, so ending it settles the pot: it rolls over if
                            nobody won the jackpot, and resets if somebody did. Leaving the game open
                            instead means the pot does not move at all.
                        </p>
                    )}
                    {isLastGameOfSession && (
                        <p className="text-base text-white/85">
                            This is the last game of the session, so the session is marked completed too.
                        </p>
                    )}
                    {endGameError && (
                        <div role="alert" className={modalErrorClass}>
                            {endGameError}
                        </div>
                    )}
                    <div className="flex justify-end gap-3 pt-2">
                        <Button variant="ghost" type="button" onClick={() => setShowEndGameModal(false)} disabled={isEndingGame}>
                            Keep playing
                        </Button>
                        <Button variant="danger" type="button" onClick={handleConfirmEndGame} disabled={isEndingGame}>
                            {isEndingGame ? 'Ending…' : 'End game'}
                        </Button>
                    </div>
                </div>
            </Modal>

            <Modal
                isOpen={showUndoModal}
                onClose={handleCloseUndoModal}
                title="Undo last call"
                className="bg-[#003f27] border border-[#1f7c58] max-w-md"
            >
                <div className="space-y-4">
                    {undoError && (
                        <div role="alert" className={cn(modalErrorClass, "space-y-3")}>
                            <p>{undoError.message}</p>
                            {undoError.code === 'winner_on_ball' && (
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    className="min-h-[44px] border-[#a57626] text-white hover:bg-[#a57626]/20"
                                    onClick={() => {
                                        setShowUndoModal(false);
                                        setUndoError(null);
                                        setShowSessionWinnersModal(true);
                                        // This is the recovery route from a
                                        // refused undo, so the blocking winner
                                        // MUST be in the list when it opens.
                                        void refreshWinnerLists();
                                    }}
                                >
                                    Open Winners and Prizes
                                </Button>
                            )}
                        </div>
                    )}
                    <p className="text-white font-semibold">
                        This will take ball {currentNumber ?? '?'} off the board.
                    </p>
                    <p className="text-white/90 text-base">
                        The next call will draw ball {currentNumber ?? '?'} again. It goes back in the bag, it is not skipped.
                    </p>
                </div>
                <div className="mt-6 flex justify-end gap-3">
                    <Button variant="secondary" className="min-h-[44px]" onClick={handleCloseUndoModal} disabled={isVoiding}>
                        Cancel
                    </Button>
                    <Button
                        variant="primary"
                        className="min-h-[44px] bg-[#a57626] hover:bg-[#8f6621] border border-[#a57626]"
                        onClick={handleConfirmVoidLastNumber}
                        disabled={isVoiding || currentNumber === null}
                    >
                        {isVoiding ? 'Undoing…' : `Undo ball ${currentNumber ?? ''}`}
                    </Button>
                </div>
            </Modal>

            {/* Record Winner Modal — winners are anonymous on public surfaces, so no name input. */}
            <Modal isOpen={showWinnerModal} onClose={handleCloseRecordWinnerModal} title={`Winner: ${currentStageName || 'Stage'}`} className="bg-[#003f27] border border-[#1f7c58]">
                <div className="space-y-4">
                    {/* This modal sits on top, so a failed Confirm Winner used to
                        look like nothing happened at all: the error rendered only on
                        the page and in the two modals behind. The host then tapped
                        again, which is how a duplicate win got recorded. */}
                    {actionError && (
                        <div role="alert" className={modalErrorClass}>{actionError}</div>
                    )}
                    <p className="text-base text-white/85">
                        Winners are recorded anonymously. Confirm the prize details below to log the win.
                    </p>
                    <div>
                        <label className="text-base text-white/85 block mb-1">Prize Description</label>
                        <Input
                            value={prizeDescription}
                            onChange={(e) => setPrizeDescription(e.target.value)}
                            placeholder="e.g. £10 Cash"
                            autoFocus
                        />
                        {isSnowballEligibilityStage && currentSnowballPot && (
                            <p className="text-base text-white/75 mt-2">
                                {isSnowballJackpotWindowOpen
                                    ? `Jackpot is live (${snowballCallsLabel}). Mark the winner as snowball eligible to award both prizes.`
                                    : `Jackpot is closed (${snowballCallsLabel}). This will record the normal game prize only.`}
                            </p>
                        )}
                    </div>
                    {isSnowballEligibilityStage && currentSnowballPot && (
                        <div className="rounded-lg border border-[#a57626]/70 bg-[#005131]/60 px-3 py-3">
                            {isSnowballJackpotWindowOpen ? (
                                <>
                                    <p className="text-base font-semibold text-[#f3d59d] mb-2">
                                        Jackpot window is OPEN. Choose eligibility carefully: this decides whether the jackpot is paid out.
                                    </p>
                                    <p className="text-base text-white/90 mb-2">
                                        Has the winner attended the last 3 games?
                                    </p>
                                    {/* Two explicit choices, no default (T4.6). The old
                                        checkbox auto-ticked itself, so a host could pay a
                                        jackpot without ever making the decision. */}
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                        <Button
                                            type="button"
                                            variant={snowballEligibleChoice === true ? 'primary' : 'outline'}
                                            aria-pressed={snowballEligibleChoice === true}
                                            className={cn(
                                                "min-h-[44px] w-full",
                                                snowballEligibleChoice === true
                                                    ? "bg-[#a57626] hover:bg-[#8f6621] border border-[#a57626] text-white"
                                                    : "text-white border-[#a57626] hover:bg-[#a57626]/20",
                                            )}
                                            onClick={() => setSnowballEligibleChoice(true)}
                                        >
                                            Eligible for jackpot
                                        </Button>
                                        <Button
                                            type="button"
                                            variant={snowballEligibleChoice === false ? 'primary' : 'outline'}
                                            aria-pressed={snowballEligibleChoice === false}
                                            className={cn(
                                                "min-h-[44px] w-full",
                                                snowballEligibleChoice === false
                                                    ? "bg-[#005131] hover:bg-[#0f6846] border border-[#a57626] text-white"
                                                    : "text-white border-[#a57626] hover:bg-[#a57626]/20",
                                            )}
                                            onClick={() => setSnowballEligibleChoice(false)}
                                        >
                                            Not eligible
                                        </Button>
                                    </div>
                                    <p className="text-base text-white/75 mt-2">
                                        {snowballEligibleChoice === null
                                            ? 'Choose eligibility before recording.'
                                            : snowballEligibleChoice
                                                ? `Will award stage prize plus Snowball Jackpot £${formatPounds(Number(currentSnowballPot.current_jackpot_amount))}.`
                                                : 'Will award stage prize only.'}
                                    </p>
                                </>
                            ) : (
                                <p className="text-base text-white/75">
                                    Snowball jackpot cannot be awarded after the call limit. This will record the stage prize only.
                                </p>
                            )}
                        </div>
                    )}
                    <div className="flex items-center gap-2 pt-2">
                        <input
                            type="checkbox"
                            id="prizeGiven"
                            checked={prizeGiven}
                            onChange={(e) => setPrizeGiven(e.target.checked)}
                            className="w-5 h-5 rounded border-[#1f7c58] bg-[#005131] text-[#a57626] focus:ring-[#a57626] accent-[#a57626] cursor-pointer"
                        />
                        <label htmlFor="prizeGiven" className="text-base text-white/90 select-none cursor-pointer">Prize Given Immediately?</label>
                    </div>
                </div>
                <div className="mt-6 flex justify-end gap-3">
                    <Button variant="secondary" className="min-h-[44px]" onClick={handleCloseRecordWinnerModal} disabled={isRecordingWinner}>Cancel</Button>
                    <Button
                        variant="primary"
                        className="min-h-[44px]"
                        onClick={() => handleRecordWinner()}
                        disabled={isRecordingWinner || (isSnowballChoiceRequired && snowballEligibleChoice === null)}
                    >
                        {isRecordingWinner ? 'Recording…' : 'Confirm Winner'}
                    </Button>
                </div>
            </Modal>

            {/* Post Win Modal. Implements the state table in spec 4.3.
                onClose is a real close (it used to be a no-op, which killed the ✕ and
                Escape and trapped the host whenever a button failed), and errors
                render inside the modal rather than on the page behind it. */}
            <Modal
                isOpen={showPostWinModal}
                onClose={handleClosePostWinAndStayPaused}
                title="Winner Recorded!"
                className="bg-[#003f27] border border-[#1f7c58]"
            >
                <div className="space-y-6 text-center py-4">
                    {actionError && (
                        <div role="alert" className={cn(modalErrorClass, "text-left")}>
                            {actionError}
                        </div>
                    )}
                    <div className="w-16 h-16 bg-[#a57626]/20 text-white rounded-full flex items-center justify-center mx-auto text-3xl border border-[#a57626]">
                        🎉
                    </div>
                    <p className="text-white/90">The winner has been announced. What&apos;s next?</p>

                    <div className="flex flex-col gap-3">
                        <Button
                            variant="primary"
                            size="lg"
                            className="w-full min-h-[44px] bg-[#005131] hover:bg-[#0f6846] border border-[#a57626]"
                            onClick={handleMoveToNextGame}
                            disabled={isPostWinBusy}
                        >
                            {isPostWinBusy && (isAdvancing || isMovingGame)
                                ? 'Working…'
                                : postWinIsEndOfSession
                                    ? 'End Game & Finish Session'
                                    : postWinIsFinalStage ? 'Move to Next Game' : 'Continue Playing'}
                        </Button>
                        {postWinIsEndOfSession && !isPostWinBusy && (
                            <p className="text-base text-white/75 -mt-1">
                                This is the last game. Pressing this ends it and closes the session.
                            </p>
                        )}

                        <div className="grid grid-cols-1 gap-3">
                            {/* A second person with the same win is a new claim
                                attempt, so a tie is a separate winner with its own
                                key (spec 5.2). It replaced "Validate Another
                                Winner". */}
                            <Button
                                variant="secondary"
                                className="min-h-[44px]"
                                onClick={() => { void handleCheckAnotherClaimant(); }}
                                disabled={isPostWinBusy}
                            >
                                Check another claimant
                            </Button>

                            {/* Hidden at the end of the session: there is no next
                                game to break into, so this would just end the
                                game under a misleading label. */}
                            {!postWinIsEndOfSession && (
                                <Button
                                    variant="secondary"
                                    className="min-h-[44px] border-[#a57626] text-white hover:bg-[#a57626]/20"
                                    onClick={handleTakeBreakAfterGame}
                                    disabled={isPostWinBusy}
                                >
                                    {postWinIsFinalStage ? 'Take a Break' : 'Continue & Take Break'}
                                </Button>
                            )}

                            <Button
                                variant="ghost"
                                className="min-h-[44px] text-white/85 hover:text-white hover:bg-[#0f6846]"
                                onClick={handleClosePostWinAndStayPaused}
                                disabled={isPostWinBusy}
                            >
                                Close and stay paused
                            </Button>
                            <p className="text-sm text-white/75">
                                Closes this box and leaves the game paused with the win on screen. Continue or check another claimant from the main pad when you are ready.
                            </p>
                        </div>
                    </div>
                </div>
            </Modal>

            <Modal
                isOpen={showCashJackpotModal}
                onClose={handleCancelCashJackpotModal}
                title="Set Cash Jackpot"
                className="bg-[#003f27] border border-[#1f7c58] max-w-md"
            >
                <div className="space-y-4">
                    {actionError && (
                        <div role="alert" className={modalErrorClass}>{actionError}</div>
                    )}
                    <p className="text-base text-white/90">
                        Enter tonight&apos;s cash jackpot amount for <span className="font-bold">{cashJackpotGameName}</span> before this game starts.
                    </p>
                    <div>
                        <label className="text-base text-white/85 block mb-1">Cash Jackpot Amount</label>
                        <Input
                            type="number"
                            inputMode="decimal"
                            min="0"
                            step="0.01"
                            placeholder="e.g. 250"
                            value={cashJackpotAmount}
                            onChange={(e) => setCashJackpotAmount(e.target.value)}
                            autoFocus
                        />
                    </div>
                </div>
                <div className="mt-6 flex justify-end gap-3">
                    <Button
                        variant="secondary"
                        className="min-h-[44px]"
                        onClick={handleCancelCashJackpotModal}
                        disabled={isSubmittingCashJackpot}
                    >
                        Cancel
                    </Button>
                    <Button
                        variant="primary"
                        className="min-h-[44px] bg-[#005131] hover:bg-[#0f6846] border border-[#a57626]"
                        onClick={handleConfirmCashJackpotAndContinue}
                        // Disabled on an empty field rather than only refused after
                        // the tap: the refusal used to set an error the host could
                        // not see from inside this modal, so the tap did nothing at
                        // all as far as they could tell.
                        disabled={isSubmittingCashJackpot || cashJackpotAmount.trim().length === 0}
                    >
                        {isSubmittingCashJackpot ? "Starting..." : "Set Amount & Start"}
                    </Button>
                </div>
            </Modal>

            {/* Manual Snowball Win Modal — winners are anonymous on public surfaces, so no name input. */}
            <Modal isOpen={showManualSnowballModal} onClose={handleCloseManualSnowballModal} title="Manual Snowball Award" className="bg-[#003f27] border border-[#1f7c58]">
                <div className="space-y-4">
                    {actionError && (
                        <div role="alert" className={modalErrorClass}>{actionError}</div>
                    )}
                    <div className="p-3 bg-[#a57626]/20 border border-[#a57626] rounded text-white text-base">
                        This will record a Snowball Jackpot win, display the celebration, and <strong>reset the pot</strong>.
                        Use this if the automatic trigger was missed or for special circumstances.
                    </div>
                    <p className="text-base text-white/85">
                        Winners are recorded anonymously. Confirm the prize details below to log the snowball win.
                    </p>
                    <div>
                        <label className="text-base text-white/85 block mb-1">Prize Description</label>
                        <Input
                            value={prizeDescription}
                            onChange={(e) => setPrizeDescription(e.target.value)}
                            autoFocus
                        />
                    </div>
                </div>
                <div className="mt-6 flex justify-end gap-3">
                    <Button
                        variant="secondary"
                        className="min-h-[44px]"
                        onClick={handleCloseManualSnowballModal}
                        disabled={isRecordingSnowballWinner}
                    >
                        Cancel
                    </Button>
                    <Button
                        variant="primary"
                        className="min-h-[44px]"
                        disabled={isRecordingSnowballWinner}
                        onClick={async () => {
                            if (isRecordingSnowballWinner) return; // Double-tap guard
                            setActionError(null);
                            setIsRecordingSnowballWinner(true);
                            try {
                                // Force record as snowball jackpot. Winner is always
                                // anonymous on the public surfaces; the action sets
                                // winner_name='Anonymous' server-side.
                                const result = await recordWinner(
                                    sessionId,
                                    gameId,
                                    'Full House', // Assume Snowball is always FH
                                    prizeDescription,
                                    true, // Prize given immediately for manual close-out.
                                    true, // Force snowball jackpot override for manual award path.
                                    true,
                                    ensureClaimRequestId(manualSnowballRequestIdRef)
                                );

                                if (applyMutation(result, "Failed to record snowball win.")) {
                                    setShowManualSnowballModal(false);
                                    // This award is a recorded win too, so the claim
                                    // it belongs to is spent.
                                    clearSpentClaim();
                                    openPostWinModal();
                                    void refreshWinnerLists();
                                }
                            } catch (err) {
                                logError('host-control', err);
                                setActionError("Could not reach the server. Check the connection and tap Confirm Snowball Win again: if it did save, tapping again will not award the jackpot twice.");
                            } finally {
                                setIsRecordingSnowballWinner(false);
                            }
                        }}
                    >
                        {isRecordingSnowballWinner ? 'Recording…' : 'Confirm Snowball Win'}
                    </Button>
                </div>
            </Modal>

        </div>
    );
}
