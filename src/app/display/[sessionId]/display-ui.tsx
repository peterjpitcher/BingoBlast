"use client";

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Database } from '@/types/database';
import { createClient } from '@/utils/supabase/client';
import { cn } from '@/lib/utils';
import Image from 'next/image';
import { QRCodeSVG } from 'qrcode.react';
import { formatPounds, getSnowballCallsLabel, getSnowballCallsRemaining } from '@/lib/snowball';
import { isFreshGameState } from '@/lib/game-state-version';
import { useConnectionHealth } from '@/hooks/use-connection-health';
import { ConnectionBanner } from '@/components/connection-banner';
import type { RealtimeStatus } from '@/lib/connection-health';
import { logError } from '@/lib/log-error';

// Define types for props
type Session = Database['public']['Tables']['sessions']['Row'];
type Game = Database['public']['Tables']['games']['Row'];
type GameState = Database['public']['Tables']['game_states_public']['Row'];
type SnowballPot = Database['public']['Tables']['snowball_pots']['Row'];

interface DisplayUIProps {
  session: Session;
  activeGame: Game | null;
  initialGameState: GameState | null;
  initialPrizeText: string;
  isWaitingState: boolean;
  playerJoinUrl: string;
}

const formatStageLabel = (stage: string | undefined) => {
  if (!stage) return '-';

  return stage
    .replace(/[_-]+/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
};

// Explicit narrow column lists keep public surfaces from leaking unintended
// fields and document exactly what the UI consumes from each table.
const SESSION_SELECT = 'id, name, status, active_game_id';
const GAME_SELECT =
  'id, session_id, game_index, name, type, stage_sequence, background_colour, prizes, snowball_pot_id';
const GAME_STATE_PUBLIC_SELECT =
  'game_id, called_numbers, numbers_called_count, current_stage_index, status, call_delay_seconds, on_break, paused_for_validation, display_win_type, display_win_text, display_winner_name, started_at, ended_at, last_call_at, updated_at, state_version';

const POLL_INTERVAL_MS = 3000;

export default function DisplayUI({
  session,
  activeGame: initialActiveGame,
  initialGameState: initialActiveGameState,
  initialPrizeText,
  isWaitingState: initialWaitingState,
  playerJoinUrl,
}: DisplayUIProps) {
  const supabase = useRef(createClient());

  const [currentSession, setCurrentSession] = useState<Session>(session);
  const [currentActiveGame, setCurrentActiveGame] = useState<Game | null>(initialActiveGame);
  const [currentGameState, setCurrentGameState] = useState<GameState | null>(initialActiveGameState);
  const [currentPrizeText, setCurrentPrizeText] = useState<string>(initialPrizeText);
  const [isWaitingState, setIsWaitingState] = useState<boolean>(initialWaitingState);
  const [currentNumberDelayed, setCurrentNumberDelayed] = useState<number | null>(null);
  const [delayedNumbers, setDelayedNumbers] = useState<number[]>([]);
  const [currentSnowballPot, setCurrentSnowballPot] = useState<SnowballPot | null>(null);
  // Tracks whether we have applied any usable game state (initial render or
  // first poll/realtime payload). Used to gate the "Connecting to game…" skeleton.
  const [hasLoaded, setHasLoaded] = useState<boolean>(initialActiveGameState != null);

  const numberCallTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Connection health: drives the reconnecting banner + auto-refresh.
  const health = useConnectionHealth();
  const { markPollSuccess, markPollFailure, markRealtimeStatus } = health;

  // Polling guards: monotonic sequence + in-flight flag prevent stale poll
  // results from clobbering newer state when responses arrive out-of-order.
  const pollSeqRef = useRef(0);
  const pollInFlightRef = useRef(false);

  // Stable refs for fields that the polling effect reads but should not retrigger
  // its setup. Pairs with the `currentActiveGame?.id` dependency below.
  const currentActiveGameRef = useRef(currentActiveGame);
  useEffect(() => {
    currentActiveGameRef.current = currentActiveGame;
  }, [currentActiveGame]);

  const refreshActiveGame = useCallback(async (newActiveGameId: string | null) => {
      if (newActiveGameId === currentActiveGame?.id) return;

      if (newActiveGameId) {
          const { data: newGame } = await supabase.current
          .from('games')
          .select(GAME_SELECT)
          .eq('id', newActiveGameId)
          .single<Database['public']['Tables']['games']['Row']>();

        if (newGame) {
          setCurrentActiveGame(newGame);
          const { data: newGameState } = await supabase.current
            .from('game_states_public')
            .select(GAME_STATE_PUBLIC_SELECT)
            .eq('game_id', newGame.id)
            .single<Database['public']['Tables']['game_states_public']['Row']>();

          if (newGameState) {
            setCurrentGameState(newGameState);
            setHasLoaded(true);
            setCurrentPrizeText(newGame.prizes?.[newGame.stage_sequence[newGameState.current_stage_index] as keyof typeof newGame.prizes] || '');
          } else {
            setCurrentGameState(null);
          }
        } else {
          setCurrentActiveGame(null);
          setCurrentGameState(null);
        }
      } else {
        setCurrentActiveGame(null);
        setCurrentGameState(null);
      }
      setIsWaitingState(!newActiveGameId);
  }, [currentActiveGame?.id]);

  // Session-level realtime: track changes to active_game_id / status.
  useEffect(() => {
    const supabaseClient = supabase.current;

    const sessionChannel = supabaseClient
      .channel(`session_updates:${session.id}`)
      .on<Session>(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'sessions', filter: `id=eq.${session.id}` },
        async (payload) => {
          setCurrentSession(payload.new);
          await refreshActiveGame(payload.new.active_game_id);
        }
      )
      .subscribe();

    return () => {
      supabaseClient.removeChannel(sessionChannel);
    };
  }, [session.id, refreshActiveGame]);

  // Game state realtime with exponential-backoff auto-reconnect.
  // Each reconnect tears down the previous channel before creating the next
  // (ordering matters — Supabase rejects subscribe() against a torn channel).
  useEffect(() => {
    const supabaseClient = supabase.current;
    const activeGameId = currentActiveGame?.id;
    if (!activeGameId) return;

    let isMounted = true;
    let activeChannel: ReturnType<typeof supabaseClient.channel> | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let attemptCount = 0;

    const connect = async () => {
      if (!isMounted) return;
      if (activeChannel) {
        await supabaseClient.removeChannel(activeChannel);
        activeChannel = null;
      }
      if (!isMounted) return;

      const channel = supabaseClient
        .channel(`game_state_public_updates:${activeGameId}:${Date.now()}`)
        .on<GameState>(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'game_states_public', filter: `game_id=eq.${activeGameId}` },
          (payload) => {
            if (!isMounted) return;
            const incoming = payload.new as GameState;
            // Freshness gate: ignore older snapshots that may arrive after a
            // reconnect or out-of-order broadcast (state_version is monotonic).
            setCurrentGameState((current) => (isFreshGameState(current, incoming) ? incoming : current));
            setHasLoaded(true);
            const game = currentActiveGameRef.current;
            if (game) {
              const stageKey = game.stage_sequence[incoming.current_stage_index];
              setCurrentPrizeText(game.prizes?.[stageKey as keyof typeof game.prizes] || '');
            }
          }
        )
        .subscribe((status) => {
          if (!isMounted) return;
          markRealtimeStatus(status as RealtimeStatus);
          if (status === 'SUBSCRIBED') {
            attemptCount = 0;
            return;
          }
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            if (reconnectTimer) clearTimeout(reconnectTimer);
            // Exponential backoff: 1s, 2s, 4s … capped at 30s.
            const delay = Math.min(1000 * Math.pow(2, attemptCount), 30000);
            attemptCount += 1;
            reconnectTimer = setTimeout(() => { void connect(); }, delay);
          }
        });

      activeChannel = channel;
    };

    void connect();

    return () => {
      isMounted = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (activeChannel) void supabaseClient.removeChannel(activeChannel);
    };
  }, [currentActiveGame?.id, markRealtimeStatus]);

  // Polling fallback — re-fetches session + game state every 3 seconds with
  // request-order guards so out-of-order responses cannot clobber newer state.
  useEffect(() => {
    let cancelled = false;
    let interval: NodeJS.Timeout | null = null;

    const poll = async () => {
      if (cancelled) return;
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      if (pollInFlightRef.current) return;

      pollInFlightRef.current = true;
      const seq = ++pollSeqRef.current;

      try {
        const { data: freshSession, error: sessionError } = await supabase.current
          .from('sessions')
          .select(SESSION_SELECT)
          .eq('id', session.id)
          .single<Session>();
        if (cancelled || seq !== pollSeqRef.current) return;
        if (sessionError || !freshSession) {
          logError('display', sessionError ?? new Error('Polling sessions returned no row'));
          markPollFailure();
          return;
        }

        setCurrentSession(freshSession);
        setIsWaitingState(!freshSession.active_game_id && freshSession.status !== 'running');

        const activeGame = currentActiveGameRef.current;
        if (freshSession.active_game_id !== activeGame?.id) {
          await refreshActiveGame(freshSession.active_game_id);
          markPollSuccess();
          return;
        }

        if (activeGame?.id) {
          const { data: freshState, error: stateError } = await supabase.current
            .from('game_states_public')
            .select(GAME_STATE_PUBLIC_SELECT)
            .eq('game_id', activeGame.id)
            .single<GameState>();
          if (cancelled || seq !== pollSeqRef.current) return;
          if (stateError || !freshState) {
            logError('display', stateError ?? new Error('Polling game_states_public returned no row'));
            markPollFailure();
            return;
          }

          // Freshness-gated apply: discard stale snapshots that lost a race
          // with a more recent realtime event or earlier poll response.
          setCurrentGameState((current) => (isFreshGameState(current, freshState) ? freshState : current));
          setHasLoaded(true);
          const stageKey = activeGame.stage_sequence[freshState.current_stage_index];
          setCurrentPrizeText(
            activeGame.prizes?.[stageKey as keyof typeof activeGame.prizes] || ''
          );
        }

        markPollSuccess();
      } catch (err) {
        if (!cancelled) {
          logError('display', err);
          markPollFailure();
        }
      } finally {
        pollInFlightRef.current = false;
      }
    };

    void poll();
    interval = setInterval(() => { void poll(); }, POLL_INTERVAL_MS);

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void poll();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [session.id, currentActiveGame?.id, refreshActiveGame, markPollSuccess, markPollFailure]);

  useEffect(() => {
    const supabaseClient = supabase.current;
    let potChannel: ReturnType<typeof supabaseClient.channel> | null = null;

    const fetchAndSubscribePot = async () => {
        if (currentActiveGame?.type === 'snowball' && currentActiveGame.snowball_pot_id) {
            const { data } = await supabaseClient
            .from('snowball_pots')
            .select('*')
            .eq('id', currentActiveGame.snowball_pot_id)
            .single();
            if (data) setCurrentSnowballPot(data);

            potChannel = supabaseClient
            .channel(`pot_updates:${currentActiveGame.snowball_pot_id}`)
            .on<SnowballPot>(
                'postgres_changes',
                { event: 'UPDATE', schema: 'public', table: 'snowball_pots', filter: `id=eq.${currentActiveGame.snowball_pot_id}` },
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
        if (potChannel) supabaseClient.removeChannel(potChannel);
    };
  }, [currentActiveGame]);

  useEffect(() => {
    if (numberCallTimeoutRef.current) {
      clearTimeout(numberCallTimeoutRef.current);
      numberCallTimeoutRef.current = null;
    }

    const scheduleUpdate = (callback: () => void, delayMs: number) => {
      numberCallTimeoutRef.current = setTimeout(callback, delayMs);
    };

    if (!currentActiveGame || !currentGameState) {
      scheduleUpdate(() => {
        setCurrentNumberDelayed(null);
        setDelayedNumbers([]);
      }, 0);
    } else {
      const serverCalledNumbers = currentGameState.called_numbers as number[];
      const lastServerNumber =
        serverCalledNumbers.length > 0
          ? serverCalledNumbers[serverCalledNumbers.length - 1]
          : null;

      // Force immediate sync if paused or completed (FR-34: Fast-forward)
      if (
        currentGameState.paused_for_validation ||
        currentGameState.status === 'completed'
      ) {
        scheduleUpdate(() => {
          setDelayedNumbers(serverCalledNumbers);
          setCurrentNumberDelayed(lastServerNumber);
        }, 0);
      } else if (serverCalledNumbers.length < delayedNumbers.length) {
        scheduleUpdate(() => {
          setDelayedNumbers(serverCalledNumbers);
          setCurrentNumberDelayed(lastServerNumber);
        }, 0);
      } else if (currentGameState.numbers_called_count > 0) {
        const lastCalledNumber =
          serverCalledNumbers[currentGameState.numbers_called_count - 1];
        const lastCallTimestamp = currentGameState.last_call_at
          ? new Date(currentGameState.last_call_at).getTime()
          : 0;
        const callDelayMs = currentGameState.call_delay_seconds * 1000;

        const now = Date.now();
        const timeSinceLastCall = now - lastCallTimestamp;

        if (currentNumberDelayed === lastCalledNumber) {
          if (
            delayedNumbers.length !== serverCalledNumbers.length &&
            !delayedNumbers.includes(lastCalledNumber)
          ) {
            scheduleUpdate(() => {
              setDelayedNumbers((prev) =>
                prev.includes(lastCalledNumber)
                  ? prev
                  : [...prev, lastCalledNumber]
              );
            }, 0);
          }
        } else {
          const delayMs = Math.max(0, callDelayMs - timeSinceLastCall);
          scheduleUpdate(() => {
            setCurrentNumberDelayed(lastCalledNumber);
            setDelayedNumbers(serverCalledNumbers);
          }, delayMs);
        }
      } else {
        scheduleUpdate(() => {
          setCurrentNumberDelayed(null);
          setDelayedNumbers([]);
        }, 0);
      }
    }

    return () => {
      if (numberCallTimeoutRef.current) {
        clearTimeout(numberCallTimeoutRef.current);
        numberCallTimeoutRef.current = null;
      }
    };
  }, [currentActiveGame, currentGameState, currentNumberDelayed, delayedNumbers]);

  const isSessionCompletedState = currentSession.status === 'completed';
  const showActiveGame = currentActiveGame && currentGameState && currentGameState.status === 'in_progress' && !currentGameState.on_break && !isSessionCompletedState && !currentGameState.display_win_type && !currentGameState.paused_for_validation;
  const showBreak = currentActiveGame && currentGameState?.on_break && !isSessionCompletedState;
  const showPausedForValidation = currentActiveGame && currentGameState?.paused_for_validation && !isSessionCompletedState;
  const showWinState = !!currentGameState?.display_win_type && !isSessionCompletedState;
  const showServiceState = !!((isWaitingState && !isSessionCompletedState) || showBreak || isSessionCompletedState);
  const isSnowballGame = currentActiveGame?.type === 'snowball';
  const snowballCallsLabel = currentSnowballPot && currentGameState
    ? getSnowballCallsLabel(currentGameState.numbers_called_count, currentSnowballPot.current_max_calls)
    : null;
  const snowballCallsRemaining = currentSnowballPot && currentGameState
    ? getSnowballCallsRemaining(currentGameState.numbers_called_count, currentSnowballPot.current_max_calls)
    : null;
  const resolvedJoinUrl = playerJoinUrl.startsWith('http')
    ? playerJoinUrl
    : `${typeof window !== 'undefined' ? window.location.origin : ''}/player/${session.id}`;

  const displayBackgroundColor = currentActiveGame?.background_colour || '#005131';
  const dimTextColor = 'text-white';
  const footerLeftTextClass = "text-[clamp(1.1rem,1.9vw,1.8rem)] font-semibold text-white";
  const houseRulesTitleClass = "text-[clamp(2.6rem,3.8vw,4rem)] font-bold text-white mb-4 border-b border-[#1f7c58] pb-3";
  const houseRulesListClass = "space-y-4 text-[clamp(1.7rem,2.35vw,2.45rem)] leading-[1.22] text-white";
  const stagePrizePreview = currentActiveGame
    ? currentActiveGame.stage_sequence.map((stage, index) => {
        const prize = currentActiveGame.prizes?.[stage as keyof typeof currentActiveGame.prizes];
        return {
          index,
          stageLabel: formatStageLabel(stage),
          prizeLabel: prize || '',
          prizeMissing: !prize,
        };
      })
    : [];
  const showPreCallStagePreview = !!(
    showActiveGame &&
    currentGameState &&
    currentGameState.numbers_called_count === 0 &&
    stagePrizePreview.length > 0
  );

  const renderHouseRulesPanel = () => (
    <div className="bg-[#003f27]/85 border border-[#1f7c58] rounded-3xl p-6 text-left backdrop-blur-md overflow-hidden">
      <h3 className={houseRulesTitleClass}>House Rules</h3>
      <ul className={houseRulesListClass}>
        <li className="flex gap-4 items-start">
          <span className="text-white mt-1">➤</span>
          <span>Claims must be called on the number they&apos;re won on - <span className="font-bold">late claims invalid</span></span>
        </li>
        <li className="flex gap-4 items-start">
          <span className="text-white mt-1">➤</span>
          <span>Multiple claims share the prize</span>
        </li>
        <li className="flex gap-4 items-start">
          <span className="text-white mt-1">➤</span>
          <span>Snowball eligibility: Players must have been here for the last three games</span>
        </li>
        <li className="flex gap-4 items-start pt-1">
          <span className="text-[clamp(1.7rem,2.3vw,2.4rem)]">🎉</span>
          <span className="font-bold italic">Enjoy the night and best of luck to everyone!</span>
        </li>
      </ul>
    </div>
  );

  // Initial load skeleton: show until first poll/realtime payload completes.
  if (!hasLoaded) {
    return (
      <div className="flex h-screen items-center justify-center text-white" style={{ backgroundColor: '#005131' }}>
        <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-current mr-3" />
        Connecting to game…
      </div>
    );
  }

  return (
    <div
      className={cn(
          "h-screen max-h-screen w-full flex flex-col transition-colors duration-1000 ease-in-out overflow-hidden relative text-white"
      )}
      style={{ backgroundColor: displayBackgroundColor }}
    >
      <ConnectionBanner visible={health.shouldShowBanner} shouldAutoRefresh={health.shouldAutoRefresh} />
      {/* Top Bar */}
      <div className="h-24 px-8 flex items-center justify-between bg-[#005131] border-b border-[#1f7c58] z-10">
         <div className="flex items-center gap-4">
             <div className="relative w-64 h-20">
                 <Image src="/the-anchor-pub-logo-white-transparent.png" alt="The Anchor" fill className="object-contain object-left" />
             </div>
         </div>
         <div className="text-right">
             <h2 className="text-[36px] font-bold tracking-tight">{currentSession.name}</h2>
             {currentActiveGame && <p className={cn("text-[27px] font-medium uppercase tracking-wider", dimTextColor)}>{currentActiveGame.name}</p>}
         </div>
      </div>

      {/* Main Content Area */}
      <div className={cn("flex-1 flex items-center justify-center relative p-6 overflow-hidden", showServiceState && "xl:pl-44")}>

          {isWaitingState && !isSessionCompletedState && (
            <div className="w-full h-full max-w-[1500px] mx-auto grid grid-cols-12 gap-6 animate-in fade-in duration-700 items-center overflow-hidden">
                <div className="col-span-12 xl:col-span-6 flex flex-col justify-center gap-6">
                    <div className="text-center xl:text-left">
                        <p className="text-[clamp(0.95rem,1.2vw,1.1rem)] uppercase tracking-[0.2em] text-white/85 font-semibold">Anchor Bingo Night</p>
                        <h1 className="text-[clamp(2rem,4.6vw,4.2rem)] font-black uppercase tracking-[0.07em] text-white mt-1">Session Starts Shortly</h1>
                        <p className="text-[clamp(1rem,1.55vw,1.35rem)] text-white/90 mt-2">Please have your tickets ready and watch the screen for the first call.</p>
                    </div>

                    <div className="w-full bg-[#005131]/90 border border-[#a57626] rounded-3xl p-5 text-center xl:text-left backdrop-blur-sm">
                        <h2 className={cn("text-[clamp(1.7rem,3.2vw,3.1rem)] font-black uppercase tracking-[0.08em] text-white", "animate-pulse")}>Kitchen Open Until 9pm</h2>
                        <p className="text-[clamp(1rem,1.7vw,1.5rem)] text-white mt-2 font-medium">Get your drinks and order food at the bar!</p>
                    </div>
                </div>

                <div className="col-span-12 xl:col-span-6">
                    {renderHouseRulesPanel()}
                </div>
            </div>
          )}

          {showBreak && (
            <div className="w-full h-full max-w-[1500px] mx-auto grid grid-cols-12 gap-6 animate-in zoom-in duration-500 items-center overflow-hidden">
                <div className="col-span-12 xl:col-span-6 flex flex-col justify-center gap-6">
                    <div className="text-center xl:text-left">
                        <p className="text-[clamp(0.95rem,1.2vw,1.1rem)] uppercase tracking-[0.2em] text-white/85 font-semibold">Anchor Bingo Night</p>
                        <h1 className="text-[clamp(2rem,4.6vw,4.2rem)] font-black uppercase tracking-[0.07em] text-white mt-1">Break Time</h1>
                        <p className="text-[clamp(1rem,1.55vw,1.35rem)] text-white/90 mt-2">Please hold your tickets, we will resume shortly.</p>
                    </div>

                    <div className="w-full bg-[#005131]/90 border border-[#a57626] rounded-3xl p-5 text-center xl:text-left backdrop-blur-sm">
                        <h2 className={cn("text-[clamp(1.7rem,3.2vw,3.1rem)] font-black uppercase tracking-[0.08em] text-white", "animate-pulse")}>Kitchen Open Until 9pm</h2>
                        <p className="text-[clamp(1rem,1.7vw,1.5rem)] text-white mt-2 font-medium">Get your drinks and order food at the bar!</p>
                    </div>

                    <div className="bg-[#003f27]/85 border border-[#1f7c58] rounded-3xl p-5 text-center xl:text-left backdrop-blur-md">
                        <h3 className="text-[clamp(1.5rem,2.3vw,2.3rem)] font-bold text-white">We&apos;ll be back in a moment</h3>
                        <p className="text-[clamp(1rem,1.45vw,1.3rem)] text-white/90 mt-1">Keep your tickets handy for the next call.</p>
                    </div>
                </div>

                <div className="col-span-12 xl:col-span-6">
                    {renderHouseRulesPanel()}
                </div>
            </div>
          )}

                  {isSessionCompletedState && (
            <div className="w-full h-full max-w-[1500px] mx-auto grid grid-cols-12 gap-6 animate-in fade-in duration-700 items-center overflow-hidden">
                <div className="col-span-12 xl:col-span-6 flex flex-col justify-center gap-6 text-center xl:text-left">
                    <div>
                        <p className="text-[clamp(0.95rem,1.2vw,1.1rem)] uppercase tracking-[0.2em] text-white/85 font-semibold">Anchor Bingo Night</p>
                        <h1 className="text-[clamp(2rem,4.6vw,4.2rem)] font-black uppercase tracking-[0.07em] text-white mt-1">Thanks For Coming!</h1>
                        <p className="text-[clamp(1rem,1.55vw,1.35rem)] text-white/90 mt-2">Please book your table for our next bingo event before you leave.</p>
                    </div>

                    <div className="w-full bg-[#005131]/90 border border-[#a57626] rounded-3xl p-5 text-center xl:text-left backdrop-blur-sm">
                        <h2 className={cn("text-[clamp(1.7rem,3.2vw,3.1rem)] font-black uppercase tracking-[0.08em] text-white", "animate-pulse")}>Book For Our Next Event</h2>
                        <p className="text-[clamp(1rem,1.7vw,1.5rem)] text-white mt-2 font-medium">Don&apos;t miss out. Reserve your table at the bar tonight.</p>
                    </div>

                    <div className="bg-[#003f27]/85 border border-[#1f7c58] rounded-3xl p-5 text-center xl:text-left backdrop-blur-md">
                        <h3 className="text-[clamp(1.5rem,2.3vw,2.3rem)] font-bold text-white">Bring friends for the next one</h3>
                        <p className="text-[clamp(1rem,1.45vw,1.3rem)] text-white/90 mt-1">Ask the team about dates and get booked in early.</p>
                    </div>
                </div>

                <div className="col-span-12 xl:col-span-6">
                    {renderHouseRulesPanel()}
                </div>
            </div>
          )}

          {showPausedForValidation && (
            <div className="absolute inset-0 z-[70] flex items-center justify-center bg-[#003f27]/95 backdrop-blur-md p-8 text-center animate-in fade-in duration-300">
                <div className="w-full max-w-4xl bg-[#005131]/90 border border-[#a57626] rounded-3xl p-10">
                    <p className="text-[clamp(1rem,2vw,1.5rem)] uppercase tracking-[0.18em] font-bold text-[#f3d59d]">Validation In Progress</p>
                    <h1 className="text-[clamp(2.7rem,7.2vw,6.5rem)] font-black uppercase tracking-[0.08em] text-white mt-3">Checking Claim</h1>
                    <p className="text-[clamp(1.1rem,2.4vw,2rem)] text-white/90 mt-4">Please hold all calls while the ticket is verified.</p>
                </div>
            </div>
          )}

          {showActiveGame && (
            <div className="flex flex-col items-center justify-center h-full w-full">
              {currentNumberDelayed ? (
                <div className="relative animate-in zoom-in duration-300">
                   {/* Massive Main Number */}
                  <div
                    className="relative bg-[#005131] border-4 border-white rounded-full flex items-center justify-center overflow-hidden"
                    style={{
                      ['--display-ball-size' as string]: 'min(68vh, calc(100vw - 6rem), calc(100vh - 16rem))',
                      width: 'var(--display-ball-size)',
                      height: 'var(--display-ball-size)',
                    } as React.CSSProperties}
                  >
                      <span
                        className="block font-bold text-white text-center select-none leading-none"
                        style={{
                          fontSize: 'calc(var(--display-ball-size) * 0.73)',
                          fontVariantNumeric: 'tabular-nums lining-nums',
                        }}
                      >
                          {currentNumberDelayed}
                      </span>
                  </div>
                </div>
              ) : (
                <>
                  {showPreCallStagePreview ? (
                    <div className="w-full max-w-4xl bg-[#005131]/92 border border-[#a57626] rounded-3xl p-8 text-white animate-in fade-in duration-500">
                      <p className="text-[clamp(1rem,1.5vw,1.2rem)] uppercase tracking-[0.2em] font-semibold text-[#f3d59d] text-center animate-pulse">
                        Game Stages & Prizes
                      </p>
                      <div className="mt-5 space-y-3">
                        {stagePrizePreview.map((item) => (
                          <div
                            key={`${item.stageLabel}-${item.index}`}
                            className="grid grid-cols-[1fr_auto] gap-4 items-center bg-[#003f27]/75 border border-[#1f7c58] rounded-2xl px-5 py-4 animate-pulse"
                            style={{ animationDelay: `${item.index * 180}ms` }}
                          >
                            <p className="text-[clamp(1.2rem,2vw,1.8rem)] font-bold tracking-wide">
                              Stage {item.index + 1}: {item.stageLabel}
                            </p>
                            <p
                              className={cn(
                                "text-[clamp(1.1rem,1.8vw,1.6rem)] font-semibold",
                                item.prizeMissing ? "text-red-400" : "text-[#f3d59d]"
                              )}
                            >
                              {item.prizeMissing ? '⚠️ Prize not set' : item.prizeLabel}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <h1 className="text-[72px] font-bold opacity-40 animate-pulse">READY...</h1>
                  )}
                </>
              )}
            </div>
          )}

          {/* WIN OVERLAY */}
          {showWinState && currentGameState && (
            <div className="absolute inset-0 z-[80] flex flex-col items-center justify-center bg-[#003f27]/95 backdrop-blur-md animate-in fade-in duration-300 p-8 text-center">
              <h1
                className={cn(
                    "text-[clamp(3rem,10vw,9rem)] leading-[0.9] font-black mb-8",
                    "text-white"
                )}
              >
                  {currentGameState.display_win_text}
              </h1>
              {currentGameState.display_winner_name && (
                  <div className="w-full max-w-3xl bg-[#005131]/92 px-12 py-8 rounded-3xl border border-[#a57626] backdrop-blur-xl animate-in slide-in-from-bottom duration-500">
                      <p className="text-[clamp(1rem,2vw,1.5rem)] text-[#f3d59d] uppercase tracking-[0.16em] mb-2 font-bold">Winner</p>
                      <h2 className="text-[clamp(2.2rem,6vw,5rem)] font-black text-white break-words">{currentGameState.display_winner_name}</h2>
                  </div>
              )}
            </div>
          )}
      </div>

      {/* Footer Info Bar */}
      <div className="h-32 bg-[#005131] border-t border-[#1f7c58] grid grid-cols-2 px-8 z-10">
            <div className="flex flex-col justify-center border-r border-white/10 pr-8">
                {(showActiveGame || showPausedForValidation) && (
                  <>
                    <p className={footerLeftTextClass}>
                      Playing for: {formatStageLabel(currentActiveGame?.stage_sequence[currentGameState?.current_stage_index || 0])}
                    </p>
                    <p className={footerLeftTextClass}>
                      Prize: {currentPrizeText
                        ? currentPrizeText
                        : <span className="text-red-400">⚠️ Prize not set</span>}
                    </p>
                    {isSnowballGame && (
                      <p className={footerLeftTextClass}>
                        {currentSnowballPot && snowballCallsLabel && currentGameState
                          ? `Snowball: £${formatPounds(Number(currentSnowballPot.current_jackpot_amount))} - ${snowballCallsLabel} (${currentGameState.numbers_called_count}/${currentSnowballPot.current_max_calls} calls${typeof snowballCallsRemaining === 'number' ? `, ${snowballCallsRemaining} left` : ''})`
                          : 'Snowball: countdown unavailable (no linked snowball pot)'}
                      </p>
                    )}
                  </>
                )}
            </div>

            <div className="flex flex-col justify-center pl-8 overflow-hidden">
                {(showActiveGame || showPausedForValidation) && delayedNumbers.length > 0 && (
                    <>
                      <div className="flex justify-between items-end mb-2">
                          <span className={cn("text-[16px] uppercase tracking-widest font-bold", dimTextColor)}>Recent Calls</span>
                          <span className={cn("text-[16px] uppercase tracking-widest font-bold", dimTextColor)}>Total Calls: {delayedNumbers.length}</span>
                      </div>
                      <div className="flex items-center gap-3 overflow-hidden mask-linear-fade">
                          {delayedNumbers.slice().reverse().map((num, idx) => (
                              <div key={idx} className={cn(
                                  "flex items-center justify-center rounded-full bg-[#005131] border border-white/60 font-bold text-white shrink-0",
                                  idx === 0 ? "w-16 h-16 text-[36px] border-4 border-white" : "w-12 h-12 text-[27px] opacity-70"
                              )}>
                                  {num}
                              </div>
                          ))}
                      </div>
                    </>
                )}
            </div>
        </div>

      {/* Player Join QR Code */}
      <div className="absolute bottom-36 left-8 bg-[#005131] border border-white/30 p-4 rounded-xl flex flex-col items-center gap-2 animate-in slide-in-from-left duration-1000 z-40">
          <div className="bg-white p-2 rounded-lg">
             <QRCodeSVG
                value={resolvedJoinUrl}
                size={100}
                level="H"
                fgColor="#005131"
                bgColor="#FFFFFF"
             />
          </div>
          <p className="text-white font-bold text-[21px] uppercase tracking-wider">Play Along</p>
      </div>
    </div>
  );
}
