"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Database, UserRole } from '@/types/database';
import { createClient } from '@/utils/supabase/client';
import { callNextNumber, toggleBreak, validateClaim, recordWinner, skipStage, voidLastNumber, pauseForValidation, resumeGame, announceWin, toggleWinnerPrizeGiven, takeControl, sendHeartbeat, moveToNextGameOnBreak, moveToNextGameAfterWin, advanceToNextStage } from '@/app/host/actions';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Modal } from '@/components/ui/modal';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { BingoBall } from '@/components/ui/bingo-ball';
import { useWakeLock } from '@/hooks/wake-lock';
import { formatPounds, getSnowballCallsLabel, getSnowballCallsRemaining, isSnowballJackpotEligible } from '@/lib/snowball';

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
}

// Hardcoded for now (same as before)
const NUMBER_NICKNAMES: { [key: number]: string } = {
    1: "Kelly's Eye",
    2: "One Little Duck",
    3: "Goodness Me",
    4: "Knock at the Door",
    5: "Man Alive",
    6: "Half Dozen",
    7: "Lucky For Some",
    8: "Garden Gate",
    9: "Doctor's Orders",
    11: "Legs Eleven",
    12: "One Dozen",
    13: "Unlucky For Some",
    14: "Valentines Day",
    15: "Young And Keen",
    16: "Sweet Sixteen",
    17: "Dancing Queen",
    20: "Blind Twenty",
    22: "Two Little Ducks",
    25: "Duck And Dive",
    26: "Pick And Mix",
    27: "Gateway To Heaven",
    28: "In A State",
    29: "Rise And Shine",
    30: "Dirty Gertie",
    31: "Get Up And Run",
    32: "Buckle My Shoe",
    33: "All The Threes",
    34: "Ask For More",
    36: "Three Dozen",
    40: "Naughty Forty",
    42: "Winnie The Pooh",
    44: "All The Fours",
    45: "Halfway There",
    46: "Up To Tricks",
    47: "Four And Seven",
    48: "Four Dozen",
    51: "Tweak Of The Thumb",
    52: "Danny La Rue",
    53: "Stuck In The Tree",
    54: "Clean The Floor",
    55: "All The Fives",
    57: "Heinz Varieties",
    58: "Make Them Wait",
    59: "Brighton Line",
    61: "Bakers Bun",
    62: "Tickety Boo",
    63: "Tickle Me",
    66: "Clickety Click",
    67: "Made In Heaven",
    69: "Any Way Up",
    73: "Queen B",
    77: "All The Sevens",
    81: "Stop And Run",
    83: "Time For Tea",
    85: "Staying Alive",
    88: "Two Fat Ladies",
    90: "Top Of The Shop"
};

const DISPLAY_SYNC_BUFFER_MS = 200;

const getRequiredSelectionCount = (stage: string | undefined): number => {
    if (!stage) return 5;
    const normalized = stage.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

    if (normalized.includes('full') || normalized.includes('house')) return 15;
    const isTwoLineStage =
        (normalized.includes('two') || normalized.includes('2') || normalized.includes('double')) &&
        normalized.includes('line');
    if (isTwoLineStage) return 10;
    if (normalized.includes('line')) return 5;
    return 5;
};


export default function GameControl({ sessionId, gameId, game, initialGameState, currentUserId, currentUserRole }: GameControlProps) {
    const router = useRouter();
    const [currentGameState, setCurrentGameState] = useState<GameState>(initialGameState);
    const [currentSnowballPot, setCurrentSnowballPot] = useState<SnowballPot | null>(null);
    const [isCallingNumber, setIsCallingNumber] = useState(false);
    const [actionError, setActionError] = useState<string | null>(null);
    const [isConnected, setIsConnected] = useState(true);
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
    const [displaySyncRemainingMs, setDisplaySyncRemainingMs] = useState(0);
    const [winnerName, setWinnerName] = useState('');
    const [prizeGiven, setPrizeGiven] = useState(false);
    const [snowballEligible, setSnowballEligible] = useState(false);
    const [currentWinners, setCurrentWinners] = useState<Winner[]>([]);
    const [sessionWinners, setSessionWinners] = useState<SessionWinner[]>([]);

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
                await sendHeartbeat(gameId);
            }, 10000); // Send heartbeat every 10s
        }
        return () => clearInterval(interval);
    }, [isController, gameId]);

    const handleTakeControl = async () => {
        setActionError(null);
        const result = await takeControl(gameId);
        if (!result?.success) {
            setActionError(result?.error || "Failed to take control.");
        }
    };

    const getPlannedPrize = useCallback((stageIndex: number) => {
        const stage = game.stage_sequence[stageIndex];
        return game.prizes?.[stage as keyof typeof game.prizes] || '';
    }, [game]);

    const [prizeDescription, setPrizeDescription] = useState(getPlannedPrize(initialGameState.current_stage_index));

    // Winners Subscription
    useEffect(() => {
        const supabase = createClient();
        const fetchWinners = async () => {
            const { data } = await supabase.from('winners').select('*').eq('game_id', gameId).order('created_at', { ascending: false });
            if (data) setCurrentWinners(data);
        };

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
    }, [gameId]);

    // Session-wide winners subscription so prize status can be managed after moving to later games
    useEffect(() => {
        const supabase = createClient();
        const fetchSessionWinners = async () => {
            const { data } = await supabase
                .from('winners')
                .select(`
                    *,
                    game:games (id, name, game_index)
                `)
                .eq('session_id', sessionId)
                .order('created_at', { ascending: false });

            if (data) setSessionWinners(data as SessionWinner[]);
        };

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
    }, [sessionId]);

    const handleTogglePrize = async (winnerId: string, currentStatus: boolean) => {
        if (!canTogglePrize) return;
        // Optimistic update
        setCurrentWinners(prev => prev.map(w => w.id === winnerId ? { ...w, prize_given: !currentStatus } : w));
        setSessionWinners(prev => prev.map(w => w.id === winnerId ? { ...w, prize_given: !currentStatus } : w));

        const result = await toggleWinnerPrizeGiven(sessionId, gameId, winnerId, !currentStatus);
        if (!result?.success) {
            setActionError(result?.error || "Failed to update prize status.");
            // Revert
            setCurrentWinners(prev => prev.map(w => w.id === winnerId ? { ...w, prize_given: currentStatus } : w));
            setSessionWinners(prev => prev.map(w => w.id === winnerId ? { ...w, prize_given: currentStatus } : w));
        }
    };

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setPrizeDescription(getPlannedPrize(currentGameState.current_stage_index));
    }, [currentGameState.current_stage_index, getPlannedPrize]);

    const currentNumber = currentGameState.called_numbers?.[currentGameState.numbers_called_count - 1] || null;
    const currentNickname = currentNumber ? NUMBER_NICKNAMES[currentNumber] : null;
    const lastNNumbers = (currentGameState.called_numbers || []).slice(-10, -1);
    const fallbackStageName = game.stage_sequence[game.stage_sequence.length - 1];
    const currentStageName = game.stage_sequence[currentGameState.current_stage_index] || fallbackStageName;
    const currentStagePrize = getPlannedPrize(currentGameState.current_stage_index) || 'Standard Prize';
    const requiredSelectionCount = getRequiredSelectionCount(currentStageName);
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

    const navigateToHostPath = (targetPath?: string) => {
        const destination = targetPath || '/host';
        if (typeof window !== 'undefined') {
            window.location.assign(destination);
            return;
        }
        router.push(destination);
    };

    useEffect(() => {
        const isCallableState =
            currentGameState.status === 'in_progress' &&
            !currentGameState.on_break &&
            !currentGameState.paused_for_validation;

        if (!isCallableState || currentGameState.numbers_called_count === 0 || !currentGameState.last_call_at) {
            const resetTimeout = setTimeout(() => setDisplaySyncRemainingMs(0), 0);
            return () => clearTimeout(resetTimeout);
        }

        const lastCallAtMs = new Date(currentGameState.last_call_at).getTime();
        if (Number.isNaN(lastCallAtMs)) {
            const resetTimeout = setTimeout(() => setDisplaySyncRemainingMs(0), 0);
            return () => clearTimeout(resetTimeout);
        }

        const lockDurationMs = Math.max(0, currentGameState.call_delay_seconds * 1000 + DISPLAY_SYNC_BUFFER_MS);
        const unlockAtMs = lastCallAtMs + lockDurationMs;

        const updateRemaining = () => {
            const remainingMs = Math.max(0, unlockAtMs - Date.now());
            setDisplaySyncRemainingMs(remainingMs);
        };

        const initialUpdateTimeout = setTimeout(updateRemaining, 0);
        if (unlockAtMs <= Date.now()) {
            return () => clearTimeout(initialUpdateTimeout);
        }

        const interval = setInterval(updateRemaining, 100);
        return () => {
            clearTimeout(initialUpdateTimeout);
            clearInterval(interval);
        };
    }, [
        currentGameState.call_delay_seconds,
        currentGameState.last_call_at,
        currentGameState.numbers_called_count,
        currentGameState.on_break,
        currentGameState.paused_for_validation,
        currentGameState.status
    ]);

    useEffect(() => {
        const supabase = createClient();
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

    useEffect(() => {
        const supabase = createClient();

        const channel = supabase
            .channel(`game_state:${gameId}`)
            .on<GameState>(
                'postgres_changes',
                {
                    event: 'UPDATE',
                    schema: 'public',
                    table: 'game_states',
                    filter: `game_id=eq.${gameId}`
                },
                (payload) => {
                    setCurrentGameState(payload.new);
                }
            )
            .subscribe((status) => {
                if (status === 'SUBSCRIBED') {
                    setIsConnected(true);
                } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
                    setIsConnected(false);
                }
            });

        return () => {
            supabase.removeChannel(channel);
        };
    }, [gameId]);

    const handleCallNextNumber = async () => {
        if (!isController) return;
        setIsCallingNumber(true);
        setActionError(null);

        const previousState = { ...currentGameState };

        if (currentGameState.number_sequence && currentGameState.numbers_called_count < currentGameState.number_sequence.length) {
            const nextNum = currentGameState.number_sequence[currentGameState.numbers_called_count];

            const optimisticState: GameState = {
                ...currentGameState,
                numbers_called_count: currentGameState.numbers_called_count + 1,
                called_numbers: [...(currentGameState.called_numbers as number[]), nextNum],
                last_call_at: new Date().toISOString()
            };
            setCurrentGameState(optimisticState);
        }

        const result = await callNextNumber(gameId);
        if (!result?.success) {
            setActionError(result?.error || "Failed to call next number.");
            setCurrentGameState(previousState);
        }
        setIsCallingNumber(false);
    };

    const handleToggleBreak = async () => {
        if (!isController) return;
        setActionError(null);
        const newOnBreakStatus = !currentGameState.on_break;
        const result = await toggleBreak(gameId, newOnBreakStatus);
        if (!result?.success) {
            setActionError(result?.error || "Failed to toggle break.");
        }
    };

    const handleContinuePlaying = async (putOnBreak: boolean = false) => {
        if (!isController) return;
        setActionError(null);

        const advanceResult = await advanceToNextStage(gameId);
        if (!advanceResult?.success) {
            setActionError(advanceResult?.error || "Failed to continue playing.");
            return;
        }

        if (putOnBreak) {
            const breakResult = await toggleBreak(gameId, true);
            if (!breakResult?.success) {
                setActionError(breakResult?.error || "Failed to start break.");
                return;
            }
        }

        setShowPostWinModal(false);
        setShowValidationModal(false);
        handleClearSelection();
    };

    const handleMoveToNextGame = async () => {
        if (!isController) return;

        if (!isFinalStage) {
            await handleContinuePlaying();
            return;
        }

        setActionError(null);
        const result = await moveToNextGameAfterWin(gameId, sessionId);
        if (!result?.success) {
            setActionError(result?.error || "Failed to move to next game.");
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
    };

    const handleTakeBreakAfterGame = async () => {
        if (!isController) return;

        if (!isFinalStage) {
            await handleContinuePlaying(true);
            return;
        }

        setActionError(null);
        const result = await moveToNextGameOnBreak(gameId, sessionId);
        if (!result?.success) {
            setActionError(result?.error || "Failed to move to next game break.");
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
    };

    const handleConfirmCashJackpotAndContinue = async () => {
        if (!isController) return;
        if (!cashJackpotAmount.trim()) {
            setActionError("Enter a cash jackpot amount before continuing.");
            return;
        }

        setIsSubmittingCashJackpot(true);
        setActionError(null);
        const transitionResult = cashJackpotMode === 'break'
            ? await moveToNextGameOnBreak(gameId, sessionId, cashJackpotAmount)
            : await moveToNextGameAfterWin(gameId, sessionId, cashJackpotAmount);

        setIsSubmittingCashJackpot(false);

        if (!transitionResult?.success) {
            setActionError(transitionResult?.error || "Failed to continue to next game.");
            return;
        }

        setShowCashJackpotModal(false);
        setShowValidationModal(false);
        handleClearSelection();
        navigateToHostPath(transitionResult.data?.redirectTo);
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

    const handleBeginClaimCheck = async () => {
        if (!isController) return;
        setActionError(null);
        setValidationResult(null);
        setShowValidationModal(true);

        const pauseResult = await pauseForValidation(gameId);
        if (!pauseResult?.success) {
            setActionError("Failed to start claim check: " + (pauseResult?.error || "Unknown error"));
            setShowValidationModal(false);
        }
    };

    const handleCheckWin = async () => {
        if (!isController) return;
        setActionError(null);
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
            if (isSnowballGame && currentStage === 'Full House') {
                setSnowballEligible(false);
            }

            const announceResult = await announceWin(gameId, currentStage);
            if (!announceResult?.success) {
                setActionError(announceResult?.error || "Failed to announce win.");
                return;
            }
            setShowWinnerModal(true);
        }
    }

    const handleRecordWinner = async () => {
        if (!isController) return;
        setActionError(null);
        if (!winnerName.trim()) {
            setActionError("Winner name cannot be empty.");
            return;
        }
        const currentStage = currentStageName;
        if (!currentStage) {
            setActionError("Current stage is not available for this game.");
            return;
        }

        const result = await recordWinner(
            sessionId,
            gameId,
            currentStage,
            winnerName,
            prizeDescription,
            currentGameState.numbers_called_count,
            prizeGiven,
            false,
            snowballEligible
        );

        if (!result?.success) {
            setActionError(result?.error || "Failed to record winner.");
        } else {
            setWinnerName('');
            setPrizeGiven(false);
            setSnowballEligible(false);
            setShowWinnerModal(false);
            setShowPostWinModal(true);
        }
    };

    const handleSkipStage = async () => {
        if (!isController) return;
        if (confirm("Are you sure you want to skip this stage without a winner?")) {
            setActionError(null);
            const result = await skipStage(gameId, currentGameState.current_stage_index, game.stage_sequence.length);
            if (!result?.success) {
                setActionError(result?.error || "Failed to skip stage.");
            } else {
                setShowValidationModal(false);
            }
        }
    };

    const handleVoidLastNumber = async () => {
        if (!isController) return;
        if (!currentNumber) {
            setActionError("No numbers to void.");
            return;
        }
        if (confirm(`Are you sure you want to void the last called number (${currentNumber})?`)) {
            setActionError(null);
            const result = await voidLastNumber(gameId);
            if (!result?.success) {
                setActionError(result?.error || "Failed to void last number.");
            } else {
            }
        }
    };

    const handleResumeGame = async () => {
        if (!isController) return;
        setActionError(null);
        const result = await resumeGame(gameId);
        if (!result?.success) {
            setActionError("Failed to resume game: " + (result?.error || "Unknown error"));
            return;
        }
        setShowValidationModal(false);
        handleClearSelection();
    };

    const isGameCompleted = currentGameState.status === 'completed';
    const isGameNotInProgress = currentGameState.status !== 'in_progress';
    const isPausedForValidation = currentGameState.paused_for_validation;
    const isDisplaySyncLocked = displaySyncRemainingMs > 0;
    const displaySyncSeconds = Math.ceil(displaySyncRemainingMs / 1000);

    const isNextNumberDisabled = !isController || isCallingNumber || currentGameState.on_break || isGameNotInProgress || isGameCompleted || isPausedForValidation || isDisplaySyncLocked || currentGameState.numbers_called_count >= 90;
    const isBreakToggleDisabled = !isController || isGameNotInProgress || isGameCompleted || isPausedForValidation;
    const isValidateButtonDisabled = !isController || isGameNotInProgress || currentGameState.on_break || isGameCompleted || currentGameState.numbers_called_count === 0;
    const isVoidLastNumberDisabled = !isController || currentGameState.numbers_called_count === 0 || isGameCompleted || isPausedForValidation;
    const hostSurfaceClass = "bg-[#003f27]/88 border border-[#1f7c58]";


    return (
        <div className="p-4 pb-32 max-w-5xl mx-auto relative text-white">
            {/* Controller Locked Overlay / Banner */}
            {!isController && (
                <div className="absolute inset-x-0 top-0 z-50 p-4">
                    <div className="bg-[#003f27]/95 border border-[#a57626] text-white p-4 rounded-xl shadow-2xl backdrop-blur-sm flex flex-col items-center gap-3 text-center">
                        <div>
                            <h3 className="font-bold text-lg">View Only Mode</h3>
                            <p className="text-sm text-white/85">Another host is currently controlling this game.</p>
                        </div>
                        {canTakeControl && (
                            <Button variant="secondary" className="bg-[#a57626] hover:bg-[#8f6621] border-[#a57626] text-white animate-pulse" onClick={handleTakeControl}>
                                Take Control
                            </Button>
                        )}
                    </div>
                </div>
            )}

            {/* Connection Status */}
            <div className="flex justify-center mb-4">
                {isConnected ? (
                    <div className="bg-[#0f6846]/70 text-white text-xs font-bold px-3 py-1 rounded-full border border-[#1f7c58] flex items-center gap-2">
                        <div className="w-2 h-2 bg-[#a57626] rounded-full animate-pulse"></div>
                        LIVE
                    </div>
                ) : (
                    <div className="bg-[#a57626]/20 text-white text-xs font-bold px-3 py-1 rounded-full border border-[#a57626]/80">
                        OFFLINE
                    </div>
                )}
            </div>

            {/* Alerts */}
            {actionError && <div className="mb-4 p-4 bg-[#a57626]/20 border border-[#a57626] text-white rounded-lg text-center">{actionError}</div>}
            {isGameCompleted && <div className="mb-4 p-4 bg-[#003f27]/90 border border-[#1f7c58] text-white rounded-lg text-center">Game Completed</div>}
            {currentGameState.on_break && <div className="mb-4 p-4 bg-[#a57626]/20 border border-[#a57626] text-white rounded-lg text-center text-lg font-bold animate-pulse">ON BREAK</div>}
            {currentGameState.paused_for_validation && <div className="mb-4 p-4 bg-[#a57626]/25 border border-[#a57626] text-white rounded-lg text-center text-lg font-bold">CHECKING CLAIM...</div>}

            {/* Main Display Card */}
            <Card className={cn(hostSurfaceClass, "mb-6 overflow-hidden")}>
                <CardContent className="p-8 flex flex-col items-center text-center">
                    <div className="mb-6 relative">
                        {currentNumber ? (
                            <BingoBall number={currentNumber} variant="active" className="w-40 h-40 text-7xl bg-[#005131] border-[#a57626]/70 text-white shadow-[0_0_40px_rgba(165,118,38,0.35)]" />
                        ) : (
                            <div className="w-40 h-40 rounded-full bg-[#005131] border-4 border-[#1f7c58] flex items-center justify-center text-white/70 text-sm font-bold">
                                READY
                            </div>
                        )}
                    </div>

                    {currentNickname && (
                        <h2 className="text-3xl font-bold text-white mb-4 animate-in fade-in slide-in-from-bottom-4">{currentNickname}</h2>
                    )}

                    <div className="flex items-center gap-6 text-sm text-white/90 border-t border-[#1f7c58] pt-4 w-full justify-center">
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
                            <span className="text-xl font-bold text-white">{currentStagePrize}</span>
                        </div>
                    </div>
                    {isSnowballGame && (
                        <div className="mt-4 w-full rounded-xl border border-[#a57626]/70 bg-[#005131]/65 px-4 py-3 flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                            {currentSnowballPot && snowballCallsLabel ? (
                                <>
                                    <p className="text-white font-semibold">
                                        Snowball Jackpot: £{formatPounds(Number(currentSnowballPot.current_jackpot_amount))}
                                    </p>
                                    <p className="text-white/90 font-semibold text-right">
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
                </CardContent>
            </Card>

            {/* Control Pad */}
            <div className={cn("grid grid-cols-2 gap-4 mb-6", !isController && "opacity-50 pointer-events-none")}>
                <Button
                    variant="primary"
                    size="xl"
                    className={cn("col-span-2 h-24 text-3xl bg-[#005131] hover:bg-[#0f6846] border border-[#a57626] shadow-lg shadow-black/20", isCallingNumber && "opacity-80")}
                    onClick={handleCallNextNumber}
                    disabled={isNextNumberDisabled}
                >
                    {isCallingNumber ? "CALLING..." : currentGameState.numbers_called_count >= 90 ? "ALL NUMBERS CALLED" : isDisplaySyncLocked ? `WAITING FOR DISPLAY (${displaySyncSeconds})` : "NEXT NUMBER"}
                </Button>

                <Button
                    variant={currentGameState.on_break ? 'secondary' : 'secondary'}
                    size="lg"
                    className={cn("h-16 bg-[#0f6846] hover:bg-[#136f4b] border border-[#1f7c58] text-white", currentGameState.on_break ? "bg-[#a57626] hover:bg-[#8f6621] border-[#a57626]" : "")}
                    onClick={handleToggleBreak}
                    disabled={isBreakToggleDisabled}
                >
                    {currentGameState.on_break ? 'Resume Session' : 'Take Break'}
                </Button>

                <Button
                    variant="secondary"
                    size="lg"
                    className="h-16 bg-[#0f6846] border border-[#a57626] text-white hover:bg-[#136f4b]"
                    onClick={handleBeginClaimCheck}
                    disabled={isValidateButtonDisabled}
                >
                    Check Claim
                </Button>
            </div>
            {isDisplaySyncLocked && isController && (
                <p className="text-center text-sm text-white/80 mb-6">
                    Next number unlocks when the previous ball is visible on the display.
                </p>
            )}

            {/* Secondary Controls */}
            <div className={cn("flex justify-center gap-4 mb-8", !isController && "opacity-50 pointer-events-none")}>
                <Button
                    variant="ghost"
                    size="sm"
                    className="text-white/80 hover:text-white hover:bg-[#0f6846]"
                    onClick={handleVoidLastNumber}
                    disabled={isVoidLastNumberDisabled}
                >
                    Undo Last Call
                </Button>
            </div>
            <div className="flex justify-center mb-8">
                <Button
                    variant="secondary"
                    size="sm"
                    className="border-[#a57626] text-white hover:bg-[#0f6846]"
                    onClick={() => setShowSessionWinnersModal(true)}
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
                        className="bg-[#0f6846] border-[#a57626] text-white hover:bg-[#136f4b]"
                        onClick={() => {
                            setWinnerName('');
                            setPrizeDescription(`£${currentSnowballPot.current_jackpot_amount} (Manual Snowball Win)`);
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
                        {actionError && <div className="p-3 bg-[#a57626]/20 border border-[#a57626] text-white rounded mb-3">{actionError}</div>}

                        {validationResult ? (
                            validationResult.valid ? (
                                <div className="p-4 bg-[#005131]/80 border border-[#1f7c58] rounded-lg flex items-center justify-between mb-4">
                                    <span className="text-white font-bold text-lg">Valid Claim</span>
                                    <div className="flex gap-2">
                                        <Button onClick={() => setShowWinnerModal(true)}>Record Winner</Button>
                                        <Button variant="ghost" onClick={handleSkipStage} className="text-white/80 hover:text-white hover:bg-[#0f6846]">Skip (No Winner)</Button>
                                    </div>
                                </div>
                            ) : (
                                <div className="p-4 bg-[#a57626]/20 border border-[#a57626] rounded-lg mb-4">
                                    <span className="text-white font-bold text-lg block mb-1">Invalid Claim</span>
                                    <span className="text-white/85 text-sm">Numbers not called: {validationResult.invalidNumbers?.join(', ')}</span>
                                    <div className="mt-2">
                                        <Button variant="outline" size="sm" onClick={handleResumeGame} className="text-white border-[#a57626] hover:bg-[#a57626]/25">Reject & Resume</Button>
                                    </div>
                                </div>
                            )
                        ) : (
                            <div className="space-y-1">
                                <p className="text-white/85 text-sm text-center">Tap the claimed numbers on the grid below.</p>
                                <p className="text-white text-sm text-center font-semibold">Select exactly {requiredSelectionCount} numbers for {currentStageName || 'this stage'}.</p>
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
                        <Button variant="secondary" onClick={handleResumeGame}>
                            {currentGameState.paused_for_validation ? 'Cancel & Resume' : 'Cancel'}
                        </Button>
                        <div className="flex gap-2">
                            <Button variant="ghost" onClick={handleClearSelection} disabled={selectedNumbers.length === 0}>Clear</Button>
                            <Button
                                variant="primary"
                                onClick={handleCheckWin}
                                disabled={selectedNumbers.length !== requiredSelectionCount || (currentNumber !== null && !selectedNumbers.includes(currentNumber))}
                            >
                                Check Win
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
                    <p className="text-sm text-white/85">
                        Review winners across all games in this session and mark prizes as given when handed out.
                    </p>
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
                                                "min-w-[120px]",
                                                winner.prize_given ? "text-white border-[#a57626] hover:bg-[#a57626]/20" : "bg-[#a57626] hover:bg-[#8f6621] text-white border-[#a57626]"
                                            )}
                                            onClick={() => handleTogglePrize(winner.id, winner.prize_given || false)}
                                            disabled={!canTogglePrize || winner.is_void}
                                        >
                                            {winner.prize_given ? "Given ✅" : "Mark Given"}
                                        </Button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
                <div className="mt-6 flex justify-end">
                    <Button variant="secondary" onClick={() => setShowSessionWinnersModal(false)}>
                        Close
                    </Button>
                </div>
            </Modal>

            {/* Record Winner Modal */}
            <Modal isOpen={showWinnerModal} onClose={() => setShowWinnerModal(false)} title={`Winner: ${currentStageName || 'Stage'}`} className="bg-[#003f27] border border-[#1f7c58]">
                <div className="space-y-4">
                    <div>
                        <label className="text-sm text-white/85 block mb-1">Winner Name</label>
                        <Input
                            value={winnerName}
                            onChange={(e) => setWinnerName(e.target.value)}
                            placeholder="e.g. Dave - Table 6"
                            autoFocus
                        />
                    </div>
                    <div>
                        <label className="text-sm text-white/85 block mb-1">Prize Description</label>
                        <Input
                            value={prizeDescription}
                            onChange={(e) => setPrizeDescription(e.target.value)}
                            placeholder="e.g. £10 Cash"
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
                        <div className="rounded-lg border border-[#a57626]/70 bg-[#005131]/60 px-3 py-2">
                            <div className="flex items-center gap-2">
                                <input
                                    type="checkbox"
                                    id="snowballEligible"
                                    checked={snowballEligible}
                                    onChange={(e) => setSnowballEligible(e.target.checked)}
                                    disabled={!isSnowballJackpotWindowOpen}
                                    className="w-5 h-5 rounded border-[#1f7c58] bg-[#005131] text-[#a57626] focus:ring-[#a57626] accent-[#a57626] cursor-pointer disabled:opacity-50"
                                />
                                <label htmlFor="snowballEligible" className="text-sm text-white/90 select-none cursor-pointer">
                                    Winner is eligible for Snowball (attended last 3 games)
                                </label>
                            </div>
                            <p className="text-xs text-white/75 mt-2">
                                {isSnowballJackpotWindowOpen
                                    ? snowballEligible
                                        ? `Will award stage prize + Snowball Jackpot £${formatPounds(Number(currentSnowballPot.current_jackpot_amount))}.`
                                        : 'Will award stage prize only.'
                                    : 'Snowball jackpot cannot be awarded after the call limit.'}
                            </p>
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
                    <Button variant="secondary" onClick={() => setShowWinnerModal(false)}>Cancel</Button>
                    <Button variant="primary" onClick={() => handleRecordWinner()}>Confirm Winner</Button>
                </div>
            </Modal>

            {/* Post Win Modal */}
            <Modal isOpen={showPostWinModal} onClose={() => { }} title="Winner Recorded!" className="bg-[#003f27] border border-[#1f7c58]">
                <div className="space-y-6 text-center py-4">
                    <div className="w-16 h-16 bg-[#a57626]/20 text-white rounded-full flex items-center justify-center mx-auto text-3xl border border-[#a57626]">
                        🎉
                    </div>
                    <p className="text-white/90">The winner has been announced. What&apos;s next?</p>

                    <div className="flex flex-col gap-3">
                        <Button variant="primary" size="lg" className="w-full bg-[#005131] hover:bg-[#0f6846] border border-[#a57626]" onClick={handleMoveToNextGame}>
                            {isFinalStage ? 'Move to Next Game' : 'Continue Playing'}
                        </Button>

                        <div className="grid grid-cols-1 gap-3">
                            <Button variant="secondary" onClick={async () => {
                                setShowPostWinModal(false);
                                setWinnerName('');
                                setPrizeDescription(getPlannedPrize(currentGameState.current_stage_index));
                                handleClearSelection();
                                await handleBeginClaimCheck();
                            }}>
                                Validate Another Winner
                            </Button>

                            <Button variant="secondary" className="border-[#a57626] text-white hover:bg-[#a57626]/20" onClick={handleTakeBreakAfterGame}>
                                {isFinalStage ? 'Take a Break' : 'Continue & Take Break'}
                            </Button>
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
                        onClick={handleCancelCashJackpotModal}
                    >
                        Cancel
                    </Button>
                    <Button
                        variant="primary"
                        className="bg-[#005131] hover:bg-[#0f6846] border border-[#a57626]"
                        onClick={handleConfirmCashJackpotAndContinue}
                        disabled={isSubmittingCashJackpot}
                    >
                        {isSubmittingCashJackpot ? "Starting..." : "Set Amount & Start"}
                    </Button>
                </div>
            </Modal>

            {/* Manual Snowball Win Modal */}
            <Modal isOpen={showManualSnowballModal} onClose={() => setShowManualSnowballModal(false)} title="Manual Snowball Award" className="bg-[#003f27] border border-[#1f7c58]">
                <div className="space-y-4">
                    <div className="p-3 bg-[#a57626]/20 border border-[#a57626] rounded text-white text-sm">
                        This will record a Snowball Jackpot win, display the celebration, and <strong>reset the pot</strong>.
                        Use this if the automatic trigger was missed or for special circumstances.
                    </div>
                    <div>
                        <label className="text-sm text-white/85 block mb-1">Winner Name</label>
                        <Input
                            value={winnerName}
                            onChange={(e) => setWinnerName(e.target.value)}
                            placeholder="e.g. Lucky Winner"
                            autoFocus
                        />
                    </div>
                    <div>
                        <label className="text-sm text-white/85 block mb-1">Prize Description</label>
                        <Input
                            value={prizeDescription}
                            onChange={(e) => setPrizeDescription(e.target.value)}
                        />
                    </div>
                </div>
                <div className="mt-6 flex justify-end gap-3">
                    <Button variant="secondary" onClick={() => setShowManualSnowballModal(false)}>Cancel</Button>
                    <Button
                        variant="primary"
                        onClick={async () => {
                            if (!winnerName.trim()) {
                                setActionError("Winner name required.");
                                return;
                            }

                            // Force record as snowball jackpot
                            const result = await recordWinner(
                                sessionId,
                                gameId,
                                'Full House', // Assume Snowball is always FH
                                winnerName,
                                prizeDescription,
                                currentGameState.numbers_called_count,
                                true, // Prize given immediately? Assume yes for manual award or make optional. Let's default true for "Close out".
                                true, // Force snowball jackpot override for manual award path.
                                true
                            );

                            if (!result?.success) {
                                setActionError(result?.error || "Failed to record snowball win.");
                            } else {
                                setShowManualSnowballModal(false);
                                setWinnerName('');
                                setShowPostWinModal(true);
                            }
                        }}
                    >
                        Confirm Snowball Win
                    </Button>
                </div>
            </Modal>

        </div>
    );
}
