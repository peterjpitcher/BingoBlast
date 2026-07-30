"use client";

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Database, UserRole } from '@/types/database';
import { createClient } from '@/utils/supabase/client';
import { callNextNumber, toggleBreak, validateClaim, recordWinner, skipStage, voidLastNumber, pauseForValidation, resumeGame, announceWin, toggleWinnerPrizeGiven, takeControl, sendHeartbeat, moveToNextGameOnBreak, moveToNextGameAfterWin, advanceToNextStage, voidWinnerFromHost } from '@/app/host/actions';
import type { ActionFailureCode, ActionResult } from '@/types/actions';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Modal } from '@/components/ui/modal';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { BingoBall } from '@/components/ui/bingo-ball';
import { useWakeLock } from '@/hooks/wake-lock';
import { useConnectionHealth } from '@/hooks/use-connection-health';
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
    const [isCallingNumber, setIsCallingNumber] = useState(false);
    const [actionError, setActionError] = useState<string | null>(null);
    const [showValidationModal, setShowValidationModal] = useState(false);
    const [selectedNumbers, setSelectedNumbers] = useState<number[]>([]);
    const [validationResult, setValidationResult] = useState<{ valid: boolean; invalidNumbers?: number[] } | null>(null);
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

    // Idempotency keys for recording a win, one per claim attempt. Refs rather
    // than state: nothing renders them, and a handler must read the current value
    // rather than the one captured by the render it was created in.
    //
    // The key is what makes a retry safe. A record-winner call that commits but
    // loses its response on the bar wifi used to insert a second winner when the
    // host tapped again, at the same stage and the same ball, and the same prize
    // was then owed twice. Same claim, same key, so the server refuses the second
    // insert and hands back the state instead. A tie is a different claim and gets
    // a different key, so both winners still save.
    //
    // Minted where each modal opens, which is also what regenerates it for
    // "Validate Another Winner": that path goes back through the claim check and
    // reopens Record Winner. The two paths keep separate keys so they can never
    // borrow each other's.
    const claimRequestIdRef = useRef<string | null>(null);
    const manualSnowballRequestIdRef = useRef<string | null>(null);

    /** The key for the claim on screen, minted on first use if a path missed it. */
    const ensureClaimRequestId = (ref: React.RefObject<string | null>): string => {
        ref.current ??= newClaimRequestId();
        return ref.current;
    };

    // Undo confirm modal (T4.3): replaces the blocking window.confirm.
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

    // Singleton Supabase client — all subscriptions share one WebSocket connection
    const supabaseRef = useRef(createClient());

    // Connection health: drives the reconnecting banner + auto-refresh.
    // The returned object changes once a second by design, so ONLY the stable
    // callbacks destructured below may appear in a dependency array. Putting
    // `health` itself in one is what stopped the host screen updating: the 3
    // second poll was cleared before it fired and the Realtime channel was
    // re-subscribed every second. See src/hooks/use-connection-health.ts.
    const health = useConnectionHealth();
    const { markPollSuccess, markPollFailure, markRealtimeStatus } = health;

    // Polling guards: monotonic sequence + in-flight flag prevent stale poll
    // results from clobbering newer state when responses arrive out-of-order.
    const pollSeqRef = useRef(0);
    const pollInFlightRef = useRef(false);

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
        const supabase = supabaseRef.current;
        const { data } = await supabase.from('winners').select('*').eq('game_id', gameId).order('created_at', { ascending: false });
        if (data) setCurrentWinners(data);
    }, [gameId]);

    const fetchSessionWinners = useCallback(async () => {
        const supabase = supabaseRef.current;
        const { data } = await supabase
            .from('winners')
            .select(`
                *,
                game:games (id, name, game_index)
            `)
            .eq('session_id', sessionId)
            .order('created_at', { ascending: false });

        if (data) setSessionWinners(data as SessionWinner[]);
    }, [sessionId]);

    const refreshWinnerLists = useCallback(async () => {
        await Promise.all([fetchGameWinners(), fetchSessionWinners()]);
    }, [fetchGameWinners, fetchSessionWinners]);

    // Winners Subscription
    useEffect(() => {
        const supabase = supabaseRef.current;
        const fetchWinners = fetchGameWinners;

        fetchWinners();

        const channel = supabase
            .channel(`winners:${gameId}`)
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'winners', filter: `game_id=eq.${gameId}` },
                () => {
                    fetchWinners();
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [gameId, fetchGameWinners]);

    // Session-wide winners subscription so prize status can be managed after moving to later games
    useEffect(() => {
        const supabase = supabaseRef.current;

        fetchSessionWinners();

        const channel = supabase
            .channel(`session_winners:${sessionId}`)
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'winners', filter: `session_id=eq.${sessionId}` },
                () => {
                    fetchSessionWinners();
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
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
    const isFinalStage = currentGameState.current_stage_index >= Math.max(0, game.stage_sequence.length - 1);
    // Last stage of the last game: there is nothing after this. The post-win
    // buttons must say so. Labelling it "Move to Next Game" when no next game
    // exists reads as "not for me", which is how two sessions were left running.
    const isEndOfSession = isFinalStage && isLastGameOfSession;

    // Snowball eligibility is an explicit host choice, only demanded when it can
    // actually change what is paid out: a snowball Full House with the jackpot
    // window still open. There used to be an effect auto-ticking eligibility here
    // and another resetting it in handleCheckWin, and the two fought each other.
    const isSnowballChoiceRequired = isSnowballEligibilityStage && isSnowballJackpotWindowOpen;

    const navigateToHostPath = (targetPath?: string) => {
        const destination = targetPath || '/host';
        if (typeof window !== 'undefined') {
            window.location.assign(destination);
            return;
        }
        router.push(destination);
    };

    useEffect(() => {
        const supabase = supabaseRef.current;
        let potChannel: ReturnType<typeof supabase.channel> | null = null;

        const fetchAndSubscribePot = async () => {
            if (game.type === 'snowball' && game.snowball_pot_id) {
                const { data } = await supabase
                    .from('snowball_pots')
                    .select('*')
                    .eq('id', game.snowball_pot_id)
                    .single();
                if (data) setCurrentSnowballPot(data);

                potChannel = supabase
                    .channel(`pot_updates_host:${game.snowball_pot_id}`)
                    .on<SnowballPot>(
                        'postgres_changes',
                        { event: 'UPDATE', schema: 'public', table: 'snowball_pots', filter: `id=eq.${game.snowball_pot_id}` },
                        (payload) => {
                            setCurrentSnowballPot(payload.new);
                        }
                    )
                    .subscribe();
            } else {
                setCurrentSnowballPot(null);
            }
        };

        fetchAndSubscribePot();

        return () => {
            if (potChannel) supabase.removeChannel(potChannel);
        };
    }, [game.type, game.snowball_pot_id]);

    // Shared poll routine — used by the polling interval, the visibility
    // handler, and the realtime reconnect path. Tracks an in-flight flag and a
    // monotonic sequence so a slow response can't clobber newer state.
    const pollGameState = useCallback(async () => {
        if (pollInFlightRef.current) return;
        const supabase = supabaseRef.current;
        const seq = ++pollSeqRef.current;
        pollInFlightRef.current = true;
        try {
            const { data: freshState, error } = await supabase
                .from('game_states')
                .select('*')
                .eq('game_id', gameId)
                .single<GameState>();
            if (error) {
                markPollFailure();
                logError('host-control', error);
                return;
            }
            // If a newer poll has started since this one fired, drop the result.
            if (seq !== pollSeqRef.current) return;
            if (freshState) {
                setCurrentGameState((current) =>
                    isFreshGameState(current, freshState) ? freshState : current,
                );
                markPollSuccess();
            }
        } catch (err) {
            markPollFailure();
            logError('host-control', err);
        } finally {
            pollInFlightRef.current = false;
        }
        // Depends on the stable health callbacks, never on the health object:
        // the object changes every second, which would give this callback a new
        // identity every second and re-arm the 3 second poll interval forever.
    }, [gameId, markPollSuccess, markPollFailure]);

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
    const applyMutation = useCallback(
        (result: ActionResult<{ gameState: GameState }> | undefined, fallback: string): boolean => {
            if (!result?.success) {
                setActionError(result?.error || fallback);
                // A conflict means the server state moved under us. Re-read it so
                // the host sees why the action was refused.
                if (result && 'conflict' in result && result.conflict) void pollGameState();
                return false;
            }
            if (result.data?.gameState) {
                const incoming = result.data.gameState;
                setCurrentGameState((current) =>
                    isFreshGameState(current, incoming) ? incoming : current,
                );
            }
            return true;
        },
        [pollGameState],
    );

    // Stable callable so the visibility handler can force-reconnect realtime.
    const reconnectRealtimeRef = useRef<(() => void) | null>(null);

    useEffect(() => {
        const supabase = supabaseRef.current;
        let isMounted = true;
        let activeChannel: ReturnType<typeof supabase.channel> | null = null;
        let reconnectTimeout: NodeJS.Timeout | null = null;
        let attemptCount = 0;

        const connect = () => {
            if (!isMounted) return;
            // Clear any pending reconnect so manual reconnects don't double-up.
            if (reconnectTimeout) {
                clearTimeout(reconnectTimeout);
                reconnectTimeout = null;
            }
            // Tear down any existing channel first.
            if (activeChannel) {
                supabase.removeChannel(activeChannel);
                activeChannel = null;
            }

            activeChannel = supabase
                .channel(`game_state:${gameId}:${Date.now()}`)
                .on<GameState>(
                    'postgres_changes',
                    {
                        event: 'UPDATE',
                        schema: 'public',
                        table: 'game_states',
                        filter: `game_id=eq.${gameId}`
                    },
                    (payload) => {
                        if (!isMounted) return;
                        setCurrentGameState((current) =>
                            isFreshGameState(current, payload.new) ? payload.new : current,
                        );
                    }
                )
                .subscribe((status) => {
                    if (!isMounted) return;
                    markRealtimeStatus(status);
                    if (status === 'SUBSCRIBED') {
                        attemptCount = 0;
                    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
                        if (activeChannel) {
                            supabase.removeChannel(activeChannel);
                            activeChannel = null;
                        }
                        // Exponential backoff: 1s, 2s, 4s, 8s … capped at 30s
                        const delay = Math.min(1000 * Math.pow(2, attemptCount), 30000);
                        attemptCount += 1;
                        reconnectTimeout = setTimeout(connect, delay);
                    }
                });
        };

        reconnectRealtimeRef.current = connect;
        connect();

        return () => {
            isMounted = false;
            reconnectRealtimeRef.current = null;
            if (reconnectTimeout) clearTimeout(reconnectTimeout);
            if (activeChannel) supabase.removeChannel(activeChannel);
        };
        // Depends on the stable markRealtimeStatus callback, never on the health
        // object: depending on the object tore this channel down and rebuilt it
        // every second, which is faster than Supabase can subscribe a channel, so
        // the host never received a single Realtime update.
    }, [gameId, markRealtimeStatus]);

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
            reconnectRealtimeRef.current?.();
            void pollGameState();
        };
        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
    }, [pollGameState]);

    const handleCallNextNumber = async () => {
        if (!isController || isCallingNumber) return;
        setIsCallingNumber(true);
        setActionError(null);

        try {
            // The host is the author of this change, so apply the server's
            // already-synced state snapshot immediately. The freshness gate keeps
            // a slightly older Realtime echo from clobbering it.
            applyMutation(await callNextNumber(gameId), "Failed to call next number.");
        } catch (err) {
            // This is the control the host presses every ten seconds all night.
            // Without the catch and finally, one dropped request left
            // isCallingNumber true forever: the button stayed disabled reading
            // "CALLING..." with no error, and only a reload recovered it.
            logError('host-control', err);
            setActionError("Could not reach the server to call the next number. Check the connection and try again.");
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
        } finally {
            setIsTogglingBreak(false);
        }
    };

    /**
     * Post Win "Continue Playing" and "Continue and Take Break" (spec 4.3).
     * Advances one stage, optionally starts a break, then closes the Post Win and
     * validation modals and clears the selection. The prize text follows the new
     * stage through the current_stage_index effect above.
     */
    const handleContinuePlaying = async (putOnBreak: boolean = false) => {
        if (!isController || isAdvancing) return;
        setActionError(null);
        setIsAdvancing(true);
        try {
            if (!applyMutation(await advanceToNextStage(gameId), "Failed to continue playing.")) return;

            if (putOnBreak) {
                if (!applyMutation(await toggleBreak(gameId, true), "Failed to start break.")) return;
            }

            setShowPostWinModal(false);
            setShowValidationModal(false);
            handleClearSelection();
        } finally {
            setIsAdvancing(false);
        }
    };

    const handleMoveToNextGame = async () => {
        if (!isController || isMovingGame) return;

        if (!isFinalStage) {
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
            handleClearSelection();
            navigateToHostPath(result.data?.redirectTo);
        } finally {
            setIsMovingGame(false);
        }
    };

    const handleTakeBreakAfterGame = async () => {
        if (!isController || isMovingGame) return;

        if (!isFinalStage) {
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
            handleClearSelection();
            navigateToHostPath(result.data?.redirectTo);
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
            navigateToHostPath(transitionResult.data?.redirectTo);
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
            navigateToHostPath('/host');
            return;
        }

        setShowPostWinModal(true);
    };

    const handleToggleNumber = (num: number) => {
        setSelectedNumbers(prev =>
            prev.includes(num) ? prev.filter(n => n !== num) : [...prev, num].sort((a, b) => a - b)
        );
    };

    const handleClearSelection = () => {
        setSelectedNumbers([]);
        setValidationResult(null);
    };

    /**
     * A recorded claim is spent, so every trace of it has to go.
     *
     * Still load-bearing after the claim key landed, and worth being exact about
     * why. The key stops a *retry* of one attempt: same modal, same key, so the
     * server refuses the second insert. It cannot stop a *fresh* attempt on a
     * ticket that was already paid, because reopening Record Winner mints a new
     * key, and it has to: that is the same path a genuine tie arrives on, and the
     * server has no way to tell the two apart. Leaving `showValidationModal` open
     * behind the Post Win modal produced exactly that: closing Post Win revealed
     * the green Valid Claim panel again, with the same numbers highlighted and
     * nothing saying the win was already recorded. One tap wrote a second winners
     * row, and on a snowball Full House it paid the jackpot twice.
     *
     * Call this on every path that records a win, and on the Post Win escape.
     */
    const clearSpentClaim = () => {
        setShowValidationModal(false);
        setValidationResult(null);
        setSelectedNumbers([]);
    };

    const handleBeginClaimCheck = async () => {
        if (!isController || isPausing) return;
        setActionError(null);
        setValidationResult(null);
        setShowValidationModal(true);
        setIsPausing(true);
        try {
            // pauseForValidation also nulls the win display fields, which is what
            // returns the public screens to "Checking Claim" when the host chooses
            // "Validate Another Winner" in the Post Win modal (spec 4.3).
            const pauseResult = await pauseForValidation(gameId);
            if (!applyMutation(pauseResult, "Failed to start claim check.")) {
                setShowValidationModal(false);
            }
        } finally {
            setIsPausing(false);
        }
    };

    const handleCheckWin = async () => {
        if (!isController || isCheckingWin) return;
        setActionError(null);
        if (requiredSelectionCount === null) {
            setActionError(`This stage is not valid for claim checking.`);
            return;
        }
        if (selectedNumbers.length !== requiredSelectionCount) {
            setActionError(`Select exactly ${requiredSelectionCount} numbers for ${currentStageName || 'this stage'} before checking.`);
            return;
        }
        if (!currentNumber) {
            setActionError("No last called number is available to verify this claim.");
            return;
        }
        if (!selectedNumbers.includes(currentNumber)) {
            setActionError(`Claim must include the last called number (${currentNumber}).`);
            return;
        }

        setIsCheckingWin(true);
        try {
            const result = await validateClaim(gameId, selectedNumbers);
            if (!result?.success) {
                setActionError(result?.error || "Failed to validate claim.");
                setValidationResult(null);
                return;
            }
            const validation = result.data;
            setValidationResult(validation || null);
            if (validation?.valid) {
                const currentStage = currentStageName;
                if (!applyMutation(await announceWin(gameId, currentStage), "Failed to announce win.")) {
                    return;
                }
                handleOpenRecordWinnerModal();
            }
        } finally {
            setIsCheckingWin(false);
        }
    }

    const handleRecordWinner = async () => {
        if (!isController) return;
        if (isRecordingWinner) return; // Double-tap guard
        setActionError(null);
        const currentStage = currentStageName;
        if (!currentStage) {
            setActionError("Current stage is not available for this game.");
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
                ensureClaimRequestId(claimRequestIdRef)
            );

            if (applyMutation(result, "Failed to record winner.")) {
                setPrizeGiven(false);
                setSnowballEligibleChoice(null);
                setShowWinnerModal(false);
                // The claim is spent. Without this the validation modal survived
                // behind Post Win with a live Record Winner button on the same
                // ticket, which paid a snowball jackpot twice.
                clearSpentClaim();
                setShowPostWinModal(true);
            }
        } catch (err) {
            // A transport failure here used to be the worst case: the host sees
            // "Recording…" flash back to idle with no way to know whether the win
            // landed, and a second tap could record it twice. The claim key makes
            // that second tap safe, so the message now says to take it. The key is
            // deliberately left on the ref for exactly that reason.
            logError('host-control', err);
            setActionError("Could not reach the server. Check the connection and tap Confirm Winner again: if the win did save, tapping again will not record it twice.");
        } finally {
            setIsRecordingWinner(false);
        }
    };

    const handleSkipStage = async () => {
        if (!isController || isSkipping) return;
        setActionError(null);
        setIsSkipping(true);
        try {
            // The stage index and stage count are derived server-side, so a stale
            // host screen can no longer move the game to a stage it already left.
            if (applyMutation(await skipStage(gameId), "Failed to skip stage.")) {
                setShowValidationModal(false);
                handleClearSelection();
            }
        } finally {
            setIsSkipping(false);
        }
    };

    /**
     * Opens Record Winner with the eligibility choice cleared, so every win is a
     * fresh decision and a previous "Eligible" can never carry over to the next
     * one.
     *
     * This is the only path that opens the modal, so minting the claim key here is
     * what guarantees one key per claim: every retry inside this modal reuses it,
     * and the next claim (including the tie that arrives via "Validate Another
     * Winner") comes back through here for a fresh one.
     */
    const handleOpenRecordWinnerModal = () => {
        // This modal now shows actionError, so clear any stale one from an earlier
        // refusal. Otherwise an unrelated message would greet the host here.
        setActionError(null);
        setSnowballEligibleChoice(null);
        claimRequestIdRef.current = newClaimRequestId();
        setShowWinnerModal(true);
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
        } finally {
            setIsVoiding(false);
        }
    };

    const handleResumeGame = async () => {
        if (!isController || isResuming) return;
        setActionError(null);
        setIsResuming(true);
        try {
            if (!applyMutation(await resumeGame(gameId), "Failed to resume game.")) return;
            setShowValidationModal(false);
            handleClearSelection();
        } finally {
            setIsResuming(false);
        }
    };

    /** Post Win: "Validate Another Winner" (spec 4.3). */
    const handleValidateAnotherWinner = async () => {
        setShowPostWinModal(false);
        setPrizeDescription(getPlannedPrize(currentGameState.current_stage_index));
        handleClearSelection();
        await handleBeginClaimCheck();
    };

    /** Post Win: "Close and stay paused" (spec 4.3). The guaranteed escape. */
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
        } finally {
            setIsVoidingWinner(false);
        }
    };

    const isGameCompleted = currentGameState.status === 'completed';
    const isGameNotInProgress = currentGameState.status !== 'in_progress';
    const isPausedForValidation = currentGameState.paused_for_validation;

    const isNextNumberDisabled = !isController || isCallingNumber || currentGameState.on_break || isGameNotInProgress || isGameCompleted || isPausedForValidation || currentGameState.numbers_called_count >= 90;
    const isBreakToggleDisabled = !isController || isTogglingBreak || isGameNotInProgress || isGameCompleted || isPausedForValidation;
    const isValidateButtonDisabled = !isController || isPausing || isGameNotInProgress || currentGameState.on_break || isGameCompleted || currentGameState.numbers_called_count === 0;
    const isVoidLastNumberDisabled = !isController || isVoiding || currentGameState.numbers_called_count === 0 || isGameCompleted || isPausedForValidation;
    const canVoidWinner = currentUserRole === 'admin';
    const hostSurfaceClass = "bg-[#003f27]/88 border border-[#1f7c58]";
    const modalErrorClass = "p-3 bg-[#a57626]/20 border border-[#a57626] text-white rounded";
    // Every modal that can produce an actionError now renders it inside itself,
    // because a banner on the page behind a modal is a banner the host never sees.
    // The page banner therefore stands down while one of those is open: two
    // role="alert" regions holding the same text would be announced twice.
    const isActionErrorShownInModal = showValidationModal || showWinnerModal || showPostWinModal || showCashJackpotModal || showManualSnowballModal || showSessionWinnersModal;


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
                                className="bg-[#a57626] hover:bg-[#8f6621] border-[#a57626] text-white animate-pulse min-h-[44px]"
                                onClick={handleTakeControl}
                                disabled={isTakingControl}
                            >
                                {isTakingControl ? 'Taking control…' : 'Take Control'}
                            </Button>
                        )}
                    </div>
                </div>
            )}

            {/* Connection Banner — shows during reconnect, auto-refreshes if unhealthy too long */}
            <ConnectionBanner
                visible={health.shouldShowBanner}
                shouldAutoRefresh={health.shouldAutoRefresh}
            />

            {/* Alerts. Hidden while any modal that renders the same error inside
                itself is open, because that is where the host can actually see it. */}
            {actionError && !isActionErrorShownInModal && (
                <div role="alert" className="mb-4 p-4 bg-[#a57626]/20 border border-[#a57626] text-white rounded-lg text-center">{actionError}</div>
            )}
            {isGameCompleted && <div className="mb-4 p-4 bg-[#003f27]/90 border border-[#1f7c58] text-white rounded-lg text-center">Game Completed</div>}
            {currentGameState.on_break && <div className="mb-4 p-4 bg-[#a57626]/20 border border-[#a57626] text-white rounded-lg text-center text-lg font-bold animate-pulse">ON BREAK</div>}
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
                                    <span className="block text-white/80 uppercase text-xs tracking-wider mb-1">Calls</span>
                                    <span className="text-xl font-mono text-white">{currentGameState.numbers_called_count}</span>
                                </div>
                                <div className="h-8 w-px bg-[#1f7c58]"></div>
                                <div>
                                    <span className="block text-white/80 uppercase text-xs tracking-wider mb-1">Playing For</span>
                                    <span className="text-xl font-bold text-white">{currentStageName || 'Finished'}</span>
                                </div>
                                <div className="h-8 w-px bg-[#1f7c58]"></div>
                                <div>
                                    <span className="block text-white/80 uppercase text-xs tracking-wider mb-1">Prize</span>
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
                    onClick={handleBeginClaimCheck}
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
            </div>
            <div className="flex justify-center mb-8">
                <Button
                    variant="secondary"
                    size="sm"
                    className="border-[#a57626] text-white hover:bg-[#0f6846] min-h-[44px]"
                    onClick={() => {
                        setActionError(null);
                        setShowSessionWinnersModal(true);
                    }}
                >
                    Winners &amp; Prizes ({sessionWinners.length})
                </Button>
            </div>

            {/* Manual Snowball Win Button (Only for Snowball Games) */}
            {game.type === 'snowball' && currentSnowballPot && (
                <div className={cn("flex justify-center mb-8", !isController && "opacity-50 pointer-events-none")}>
                    <Button
                        variant="secondary"
                        size="sm"
                        className="bg-[#0f6846] border-[#a57626] text-white hover:bg-[#136f4b] min-h-[44px]"
                        onClick={() => {
                            setActionError(null);
                            setPrizeDescription(`£${currentSnowballPot.current_jackpot_amount} (Manual Snowball Win)`);
                            // Fresh key per award. This path pays the jackpot, so
                            // it is the one where a retried tap costs real money.
                            manualSnowballRequestIdRef.current = newClaimRequestId();
                            setShowManualSnowballModal(true);
                        }}
                    >
                        🏆 Manual Snowball Win
                    </Button>
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
                        {currentWinners.map(winner => (
                            <div key={winner.id} className="p-4 flex items-center justify-between gap-4">
                                <div>
                                    <p className="font-bold text-white">{winner.winner_name}</p>
                                    <p className="text-sm text-white/85">{winner.stage} - {winner.prize_description}</p>
                                </div>
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
                            </div>
                        ))}
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
                        {actionError && !showWinnerModal && <div role="alert" className={cn(modalErrorClass, "mb-3")}>{actionError}</div>}

                        {/* Claim progress. Big enough to read at arm's length behind the
                            bar, and announced politely so it does not chatter. Stays up
                            after a rejected claim, because that is when the host is
                            re-counting the ticket. */}
                        {!validationResult?.valid && (
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

                        {validationResult ? (
                            validationResult.valid ? (
                                <div className="p-4 bg-[#005131]/80 border border-[#1f7c58] rounded-lg flex flex-wrap items-center justify-between gap-2 mb-4">
                                    <span className="text-white font-bold text-lg">Valid Claim</span>
                                    <div className="flex gap-2">
                                        <Button className="min-h-[44px]" onClick={handleOpenRecordWinnerModal}>Record Winner</Button>
                                        <Button variant="ghost" onClick={handleSkipStage} disabled={isSkipping} className="text-white/80 hover:text-white hover:bg-[#0f6846] min-h-[44px]">
                                            {isSkipping ? 'Skipping…' : 'Skip (No Winner)'}
                                        </Button>
                                    </div>
                                </div>
                            ) : (
                                <div className="p-4 bg-[#a57626]/20 border border-[#a57626] rounded-lg mb-4">
                                    <span className="text-white font-bold text-lg block mb-1">Invalid Claim</span>
                                    <span className="text-white/85 text-sm">Numbers not called: {validationResult.invalidNumbers?.join(', ')}</span>
                                    <div className="mt-2">
                                        <Button variant="outline" size="sm" onClick={handleResumeGame} disabled={isResuming} className="text-white border-[#a57626] hover:bg-[#a57626]/25 min-h-[44px]">
                                            {isResuming ? 'Resuming…' : 'Reject & Resume'}
                                        </Button>
                                    </div>
                                </div>
                            )
                        ) : (
                            <div className="space-y-2">
                                <p className="text-white/85 text-sm text-center">Tap the claimed numbers on the grid below.</p>
                                {isStageValidForClaimCheck ? (
                                    <p className="text-white text-sm text-center font-semibold">Select exactly {requiredSelectionCount} numbers for {currentStageName || 'this stage'}.</p>
                                ) : (
                                    <p className="text-white text-sm text-center font-semibold">Check the game&apos;s stages in the admin screen, then try again.</p>
                                )}
                                <p className="text-white/75 text-xs text-center">The claim must include the last called number (highlighted).</p>
                            </div>
                        )}
                    </div>

                    <div className="flex-1 overflow-y-auto bg-[#003f27]/80 rounded-lg p-2 border border-[#1f7c58]">
                        <div className="grid grid-cols-10 gap-1 sm:gap-2">
                            {Array.from({ length: 90 }, (_, i) => i + 1).map(num => {
                                const isSelected = selectedNumbers.includes(num);
                                const isCalled = (currentGameState.called_numbers as number[]).includes(num);
                                const isLastCalled = num === currentNumber;

                                let buttonStyle = "bg-[#0f6846] text-white/55 hover:bg-[#136f4b]";

                                if (isSelected) {
                                    if (isCalled) {
                                        buttonStyle = "bg-[#005131] text-white shadow-lg shadow-black/30 scale-105 z-10 border border-[#a57626]";
                                    } else {
                                        buttonStyle = "bg-[#a57626] text-white shadow-lg shadow-black/30 scale-105 z-10 border border-white/70";
                                    }
                                } else if (isLastCalled) {
                                    buttonStyle = "bg-[#a57626] text-white font-bold border-2 border-white ring-2 ring-[#f3d59d] ring-offset-0";
                                } else if (isCalled) {
                                    buttonStyle = "bg-[#0f6846] text-white font-bold border border-[#a57626]/60";
                                }

                                return (
                                    <button
                                        key={num}
                                        onClick={() => handleToggleNumber(num)}
                                        className={cn(
                                            "aspect-square flex items-center justify-center text-sm sm:text-base rounded transition-all active:scale-95",
                                            buttonStyle
                                        )}
                                        disabled={!isController}
                                    >
                                        {num}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    <div className="shrink-0 pt-4 mt-4 border-t border-[#1f7c58] flex justify-between gap-3">
                        <Button variant="secondary" className="min-h-[44px]" onClick={handleResumeGame} disabled={isResuming}>
                            {isResuming ? 'Resuming…' : currentGameState.paused_for_validation ? 'Cancel & Resume' : 'Cancel'}
                        </Button>
                        <div className="flex gap-2">
                            <Button variant="ghost" className="min-h-[44px]" onClick={handleClearSelection} disabled={selectedNumbers.length === 0}>Clear</Button>
                            <Button
                                variant="primary"
                                className="min-h-[44px]"
                                onClick={handleCheckWin}
                                disabled={!isStageValidForClaimCheck || isCheckingWin || !isClaimCountMet || (currentNumber !== null && !claimIncludesLastBall)}
                            >
                                {isCheckingWin ? 'Checking…' : 'Check Win'}
                            </Button>
                        </div>
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
                                        <p className="text-sm text-white/70 truncate">
                                            {winner.prize_description || 'No prize description'}
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                        {winner.is_void && (
                                            <span className="px-2 py-1 rounded-full text-xs font-semibold border border-[#a57626] text-white bg-[#a57626]/20">
                                                VOID
                                            </span>
                                        )}
                                        <Button
                                            size="sm"
                                            variant={winner.prize_given ? "outline" : "secondary"}
                                            className={cn(
                                                "min-w-[120px] min-h-[44px]",
                                                winner.prize_given ? "text-white border-[#a57626] hover:bg-[#a57626]/20" : "bg-[#a57626] hover:bg-[#8f6621] text-white border-[#a57626]"
                                            )}
                                            onClick={() => handleTogglePrize(winner.id, winner.prize_given || false)}
                                            disabled={!canTogglePrize || winner.is_void === true}
                                        >
                                            {winner.prize_given ? "Given ✅" : "Mark Given"}
                                        </Button>
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
                        <div role="alert" className="p-3 bg-[#a57626]/20 border border-[#a57626] text-white rounded">
                            {voidWinnerError}
                        </div>
                    )}
                    <p className="text-sm text-white/90">
                        {voidWinnerTarget
                            ? `Voiding the ${voidWinnerTarget.stage} win${voidWinnerTarget.game ? ` from Game ${voidWinnerTarget.game.game_index}` : ''}. The win stays on record, marked void, and stops counting towards the snowball pot.`
                            : ''}
                    </p>
                    <div>
                        <label htmlFor="voidWinnerReason" className="text-sm text-white/85 block mb-1">
                            Reason (required)
                        </label>
                        <textarea
                            id="voidWinnerReason"
                            value={voidWinnerReason}
                            onChange={(e) => setVoidWinnerReason(e.target.value)}
                            rows={3}
                            placeholder="e.g. Claim called on the wrong ball"
                            className="w-full rounded-md border border-[#1f7c58] bg-[#005131] px-3 py-2 text-white placeholder:text-white/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#a57626]"
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
                isOpen={showUndoModal}
                onClose={handleCloseUndoModal}
                title="Undo last call"
                className="bg-[#003f27] border border-[#1f7c58] max-w-md"
            >
                <div className="space-y-4">
                    {undoError && (
                        <div role="alert" className="p-3 bg-[#a57626]/20 border border-[#a57626] text-white rounded space-y-3">
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
                    <p className="text-white/90 text-sm">
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
                    <p className="text-sm text-white/85">
                        Winners are recorded anonymously. Confirm the prize details below to log the win.
                    </p>
                    <div>
                        <label className="text-sm text-white/85 block mb-1">Prize Description</label>
                        <Input
                            value={prizeDescription}
                            onChange={(e) => setPrizeDescription(e.target.value)}
                            placeholder="e.g. £10 Cash"
                            autoFocus
                        />
                        {isSnowballEligibilityStage && currentSnowballPot && (
                            <p className="text-xs text-white/75 mt-2">
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
                                    <p className="text-xs font-semibold text-[#f3d59d] mb-2">
                                        Jackpot window is OPEN. Choose eligibility carefully: this decides whether the jackpot is paid out.
                                    </p>
                                    <p className="text-sm text-white/90 mb-2">
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
                                    <p className="text-xs text-white/75 mt-2">
                                        {snowballEligibleChoice === null
                                            ? 'Choose eligibility before recording.'
                                            : snowballEligibleChoice
                                                ? `Will award stage prize plus Snowball Jackpot £${formatPounds(Number(currentSnowballPot.current_jackpot_amount))}.`
                                                : 'Will award stage prize only.'}
                                    </p>
                                </>
                            ) : (
                                <p className="text-xs text-white/75">
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
                        <label htmlFor="prizeGiven" className="text-sm text-white/90 select-none cursor-pointer">Prize Given Immediately?</label>
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
                        <div role="alert" className="p-3 bg-[#a57626]/20 border border-[#a57626] text-white rounded text-left">
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
                                : isEndOfSession
                                    ? 'End Game & Finish Session'
                                    : isFinalStage ? 'Move to Next Game' : 'Continue Playing'}
                        </Button>
                        {isEndOfSession && !isPostWinBusy && (
                            <p className="text-xs text-white/75 -mt-1">
                                This is the last game. Pressing this ends it and closes the session.
                            </p>
                        )}

                        <div className="grid grid-cols-1 gap-3">
                            <Button
                                variant="secondary"
                                className="min-h-[44px]"
                                onClick={handleValidateAnotherWinner}
                                disabled={isPostWinBusy}
                            >
                                Validate Another Winner
                            </Button>

                            {/* Hidden at the end of the session: there is no next
                                game to break into, so this would just end the
                                game under a misleading label. */}
                            {!isEndOfSession && (
                                <Button
                                    variant="secondary"
                                    className="min-h-[44px] border-[#a57626] text-white hover:bg-[#a57626]/20"
                                    onClick={handleTakeBreakAfterGame}
                                    disabled={isPostWinBusy}
                                >
                                    {isFinalStage ? 'Take a Break' : 'Continue & Take Break'}
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
                            <p className="text-xs text-white/75">
                                Closes this box and leaves the game paused with the win on screen. Resume or check another claim from the main pad when you are ready.
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
                    <p className="text-sm text-white/90">
                        Enter tonight&apos;s cash jackpot amount for <span className="font-bold">{cashJackpotGameName}</span> before this game starts.
                    </p>
                    <div>
                        <label className="text-sm text-white/85 block mb-1">Cash Jackpot Amount</label>
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
            <Modal isOpen={showManualSnowballModal} onClose={() => setShowManualSnowballModal(false)} title="Manual Snowball Award" className="bg-[#003f27] border border-[#1f7c58]">
                <div className="space-y-4">
                    {actionError && (
                        <div role="alert" className={modalErrorClass}>{actionError}</div>
                    )}
                    <div className="p-3 bg-[#a57626]/20 border border-[#a57626] rounded text-white text-sm">
                        This will record a Snowball Jackpot win, display the celebration, and <strong>reset the pot</strong>.
                        Use this if the automatic trigger was missed or for special circumstances.
                    </div>
                    <p className="text-sm text-white/85">
                        Winners are recorded anonymously. Confirm the prize details below to log the snowball win.
                    </p>
                    <div>
                        <label className="text-sm text-white/85 block mb-1">Prize Description</label>
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
                        onClick={() => setShowManualSnowballModal(false)}
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
                                    setShowPostWinModal(true);
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
