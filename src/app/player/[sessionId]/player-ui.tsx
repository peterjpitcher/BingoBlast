"use client";

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Database } from '@/types/database';
import { createClient } from '@/utils/supabase/client';
import { cn } from '@/lib/utils';
import { BingoBall } from '@/components/ui/bingo-ball';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Modal } from '@/components/ui/modal';
import { useWakeLock } from '@/hooks/wake-lock';
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

interface PlayerUIProps {
  session: Session;
  activeGame: Game | null;
  initialGameState: GameState | null;
  initialPrizeText: string;
}

// Explicit narrow column lists keep public surfaces from leaking unintended
// fields and document exactly what the UI consumes from each table.
const SESSION_SELECT = 'id, name, status, active_game_id';
const GAME_SELECT =
  'id, session_id, game_index, name, type, stage_sequence, background_colour, prizes, snowball_pot_id';
const GAME_STATE_PUBLIC_SELECT =
  'game_id, called_numbers, numbers_called_count, current_stage_index, status, call_delay_seconds, on_break, paused_for_validation, display_win_type, display_win_text, display_winner_name, started_at, ended_at, last_call_at, updated_at, state_version';

const POLL_INTERVAL_MS = 3000;

export default function PlayerUI({
  session,
  activeGame: initialActiveGame,
  initialGameState: initialActiveGameState,
  initialPrizeText,
}: PlayerUIProps) {
  const supabase = useRef(createClient());

  const [currentSession, setCurrentSession] = useState<Session>(session);
  const [currentActiveGame, setCurrentActiveGame] = useState<Game | null>(initialActiveGame);
  const [currentGameState, setCurrentGameState] = useState<GameState | null>(initialActiveGameState);
  const [currentPrizeText, setCurrentPrizeText] = useState<string>(initialPrizeText);
  const [currentSnowballPot, setCurrentSnowballPot] = useState<SnowballPot | null>(null);

  const [currentNumberDelayed, setCurrentNumberDelayed] = useState<number | null>(null);
  const [delayedNumbers, setDelayedNumbers] = useState<number[]>([]);
  const [showFullHistory, setShowFullHistory] = useState(false);
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

  // Stable ref so subscription callbacks can read the active game without
  // re-running this effect every time the game object identity changes.
  const currentActiveGameRef = useRef(currentActiveGame);
  useEffect(() => {
    currentActiveGameRef.current = currentActiveGame;
  }, [currentActiveGame]);

  const { isLocked: isWakeLockActive } = useWakeLock();


  // --- Data Fetching & Subscription Logic (Shared with Display) ---

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
  }, [currentActiveGame?.id]);

  // Session-level realtime: track changes to active_game_id / status.
  useEffect(() => {
    const supabaseClient = supabase.current;

    const sessionChannel = supabaseClient
      .channel(`session_updates_player:${session.id}`)
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
        .channel(`game_state_public_updates_player:${activeGameId}:${Date.now()}`)
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
          .channel(`pot_updates_player:${currentActiveGame.snowball_pot_id}`)
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
          logError('player', sessionError ?? new Error('Polling sessions returned no row'));
          markPollFailure();
          return;
        }

        setCurrentSession(freshSession);

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
            logError('player', stateError ?? new Error('Polling game_states_public returned no row'));
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
          logError('player', err);
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

  // --- Delay Logic (Same as Display) ---
  useEffect(() => {
    if (numberCallTimeoutRef.current) {
      clearTimeout(numberCallTimeoutRef.current);
    }

    if (currentActiveGame && currentGameState) {
      const serverCalledNumbers = currentGameState.called_numbers as number[];

      // Immediate sync
      if (currentGameState.paused_for_validation || currentGameState.status === 'completed') {
        setDelayedNumbers(serverCalledNumbers);
        const newLastNumber = serverCalledNumbers.length > 0 ? serverCalledNumbers[serverCalledNumbers.length - 1] : null;
        setCurrentNumberDelayed(newLastNumber);
        return;
      }

      if (serverCalledNumbers.length < delayedNumbers.length) {
        setDelayedNumbers(serverCalledNumbers);
        const newLastNumber = serverCalledNumbers.length > 0 ? serverCalledNumbers[serverCalledNumbers.length - 1] : null;
        setCurrentNumberDelayed(newLastNumber);
        return;
      }

      if (currentGameState.numbers_called_count > 0) {
        const lastCalledNumber = serverCalledNumbers[currentGameState.numbers_called_count - 1];
        const lastCallTimestamp = currentGameState.last_call_at ? new Date(currentGameState.last_call_at).getTime() : 0;
        const callDelay = currentGameState.call_delay_seconds * 1000;

        const now = Date.now();
        const timeSinceLastCall = now - lastCallTimestamp;

        if (currentNumberDelayed === lastCalledNumber) {
          if (delayedNumbers.length !== serverCalledNumbers.length) {
            if (!delayedNumbers.includes(lastCalledNumber)) {
              setDelayedNumbers(prev => [...prev, lastCalledNumber]);
            }
          }
          return;
        }

        if (timeSinceLastCall >= callDelay) {
          setCurrentNumberDelayed(lastCalledNumber);
          setDelayedNumbers(serverCalledNumbers);
        } else {
          numberCallTimeoutRef.current = setTimeout(() => {
            setCurrentNumberDelayed(lastCalledNumber);
            setDelayedNumbers(serverCalledNumbers);
          }, callDelay - timeSinceLastCall);
        }
      } else {
        setCurrentNumberDelayed(null);
        setDelayedNumbers([]);
      }
    } else {
      setCurrentNumberDelayed(null);
      setDelayedNumbers([]);
    }

    return () => {
      if (numberCallTimeoutRef.current) {
        clearTimeout(numberCallTimeoutRef.current);
      }
    };
  }, [currentActiveGame, currentGameState, currentNumberDelayed, delayedNumbers]);


  // --- UI States ---
  const isSessionCompleted = currentSession.status === 'completed';
  const isWaiting = !isSessionCompleted && (!currentActiveGame || (currentGameState?.status !== 'in_progress' && currentGameState?.status !== 'completed'));
  const isOnBreak = currentGameState?.on_break;
  const isCompleted = currentGameState?.status === 'completed';
  const isValidating = currentGameState?.paused_for_validation;
  const isWin = !!currentGameState?.display_win_type;

  const backgroundColor = currentActiveGame?.background_colour || '#005131';
  const isSnowballGame = currentActiveGame?.type === 'snowball';
  const snowballCallsLabel = currentSnowballPot && currentGameState
    ? getSnowballCallsLabel(currentGameState.numbers_called_count, currentSnowballPot.current_max_calls)
    : null;
  const snowballCallsRemaining = currentSnowballPot && currentGameState
    ? getSnowballCallsRemaining(currentGameState.numbers_called_count, currentSnowballPot.current_max_calls)
    : null;

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
        "min-h-screen pb-8 text-white"
      )}
      style={{ backgroundColor: backgroundColor }}
    >
      <ConnectionBanner visible={health.shouldShowBanner} shouldAutoRefresh={health.shouldAutoRefresh} />
      {/* Header */}
      <div className="bg-[#003f27]/80 p-4 border-b border-[#1f7c58] flex items-center justify-between sticky top-0 z-20 shadow-md">
        <div>
          <h1 className="font-bold text-lg leading-none text-white">{currentSession.name}</h1>
          {currentActiveGame && <p className="text-sm text-white">{currentActiveGame.name}</p>}
        </div>
        {currentGameState && (
          <div className="bg-[#005131] px-3 py-1 rounded border border-[#1f7c58]">
            <span className="text-xs text-white uppercase block">Calls</span>
            <span className="font-mono font-bold text-xl leading-none">{delayedNumbers.length}</span>
          </div>
        )}
      </div>

      {!isWakeLockActive && (
        <div className="bg-[#a57626]/20 border-b border-[#a57626]/50 px-4 py-2 text-center text-xs font-semibold uppercase tracking-wide text-white">
          Tap once to keep this screen awake
        </div>
      )}

      {/* Main Status Content */}
      <div className="p-4 space-y-4">

        {/* Status Banners */}
        {isSessionCompleted && (
          <Card className="bg-[#003f27]/80 border-[#1f7c58]">
            <CardContent className="p-6 text-center">
              <div className="text-4xl mb-2">🙏</div>
              <h2 className="text-xl font-bold text-white">Thanks for coming!</h2>
              <p className="text-white">Please book for our next bingo event at the bar.</p>
            </CardContent>
          </Card>
        )}

        {isWaiting && (
          <Card className="bg-[#003f27]/80 border-[#1f7c58]">
            <CardContent className="p-6 text-center">
              <div className="text-4xl mb-2">⏳</div>
              <h2 className="text-xl font-bold text-white">Waiting for Host</h2>
              <p className="text-white">Game will start soon...</p>
            </CardContent>
          </Card>
        )}

        {isOnBreak && !isCompleted && (
          <Card className="bg-yellow-900/20 border-yellow-600">
            <CardContent className="p-6 text-center">
              <div className="text-4xl mb-2 animate-bounce">☕️</div>
              <h2 className="text-2xl font-bold text-white">On Break</h2>
              <p className="text-white">We will resume shortly</p>
            </CardContent>
          </Card>
        )}

        {isCompleted && !isSessionCompleted && (
          <Card className="bg-green-900/20 border-green-600">
            <CardContent className="p-6 text-center">
              <div className="text-4xl mb-2">🏁</div>
              <h2 className="text-2xl font-bold text-white">Game Over</h2>
              <p className="text-white">Thanks for playing!</p>
            </CardContent>
          </Card>
        )}

        {isValidating && !isWin && (
          <Card className="bg-blue-900/20 border-blue-500 animate-pulse">
            <CardContent className="p-6 text-center">
              <div className="text-4xl mb-2">🎫</div>
              <h2 className="text-2xl font-bold text-white">Checking Claim</h2>
              <p className="text-white">Please wait...</p>
            </CardContent>
          </Card>
        )}

        {isWin && (
          <Card className="bg-green-600 border-green-400 shadow-[0_0_30px_rgba(34,197,94,0.4)]">
            <CardContent className="p-6 text-center text-white">
              <div className="text-6xl mb-2">🎉</div>
              <h2 className="text-3xl font-black uppercase">{currentGameState?.display_win_text}</h2>
              {currentGameState?.display_winner_name && (
                <p className="text-xl mt-2 font-medium">{currentGameState.display_winner_name}</p>
              )}
            </CardContent>
          </Card>
        )}

        {/* Active Game Display */}
        {!isSessionCompleted && !isWaiting && !isCompleted && !isOnBreak && (
          <>
            {/* Info Cards */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-[#003f27]/80 p-3 rounded-lg border border-[#1f7c58]">
                <span className="text-xs text-white uppercase block">Playing For</span>
                <span className="font-bold text-white text-lg leading-tight">
                  {currentActiveGame?.stage_sequence[currentGameState?.current_stage_index || 0]}
                </span>
              </div>
              <div className="bg-[#003f27]/80 p-3 rounded-lg border border-[#1f7c58]">
                <span className="text-xs text-white uppercase block">Prize</span>
                <span
                  className={cn(
                    "font-bold text-lg leading-tight",
                    currentPrizeText ? "text-white" : "text-red-400"
                  )}
                >
                  {currentPrizeText ? currentPrizeText : '⚠️ Prize not set'}
                </span>
              </div>
            </div>

            {isSnowballGame && (
              <div className="bg-[#a57626]/25 p-3 rounded-lg border border-[#a57626]/60 flex justify-between items-center shadow-lg shadow-black/25 gap-4">
                {currentSnowballPot && currentGameState ? (
                  <>
                    <div>
                      <span className="text-white text-xs font-bold uppercase block">Snowball Jackpot</span>
                      <span className="text-2xl font-bold text-white">£{formatPounds(Number(currentSnowballPot.current_jackpot_amount))}</span>
                    </div>
                    <div className="text-right">
                      <span className="text-white text-xs block">Status</span>
                      <span className="text-xl font-bold text-white">
                        {snowballCallsLabel}
                      </span>
                      <span className="text-xs text-white/90 block">
                        {currentGameState.numbers_called_count}/{currentSnowballPot.current_max_calls} calls
                        {typeof snowballCallsRemaining === 'number' ? ` • ${snowballCallsRemaining} left` : ''}
                      </span>
                    </div>
                  </>
                ) : (
                  <p className="text-white font-semibold">
                    Snowball countdown unavailable: this game is not linked to a snowball pot.
                  </p>
                )}
              </div>
            )}

            {/* Current Number */}
            <div className="flex justify-center py-4">
              {currentNumberDelayed ? (
                <div className="relative">
                <div className="w-48 h-48 bg-[#005131] rounded-full flex items-center justify-center shadow-2xl border-8 border-white">
                    <span className="text-8xl font-black text-white tracking-tighter">
                      {currentNumberDelayed}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="w-48 h-48 rounded-full border-4 border-[#1f7c58] border-dashed flex items-center justify-center">
                  <span className="text-white font-bold">READY</span>
                </div>
              )}
            </div>

            {/* Recent History */}
            <div>
              <div className="flex justify-between items-end mb-2">
                <span className="text-sm text-white font-medium">Recent Calls</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-white h-auto p-0 hover:bg-transparent"
                  onClick={() => setShowFullHistory(true)}
                >
                  View All Numbers
                </Button>
              </div>
              <div className="flex gap-2 overflow-x-auto pb-2 mask-linear-fade-right">
                {delayedNumbers.slice(-5).reverse().map((num, i) => (
                  <BingoBall
                    key={i}
                    number={num}
                    variant={i === 0 ? "active" : "called"}
                    className={i === 0 ? "w-14 h-14 text-xl bg-[#005131] text-white border-white/70" : "w-12 h-12 text-lg opacity-80 bg-[#005131] text-white border-white/50"}
                  />
                ))}
                {delayedNumbers.length === 0 && <p className="text-white italic text-sm">No numbers called yet</p>}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Full History Modal */}
      <Modal
        isOpen={showFullHistory}
        onClose={() => setShowFullHistory(false)}
        title="Called Numbers"
        className="h-[80vh] flex flex-col"
      >
        <div className="flex-1 overflow-y-auto p-1">
          <div className="grid grid-cols-10 gap-1">
            {Array.from({ length: 90 }, (_, i) => i + 1).map(num => {
              const isCalled = delayedNumbers.includes(num);
              return (
                <div
                  key={num}
                  className={cn(
                    "aspect-square flex items-center justify-center text-sm font-bold rounded",
                    isCalled ? "bg-green-600 text-white" : "bg-[#003f27] text-white"
                  )}
                >
                  {num}
                </div>
              );
            })}
          </div>
        </div>
        <div className="mt-4 text-center">
          <Button variant="secondary" className="w-full" onClick={() => setShowFullHistory(false)}>Close</Button>
        </div>
      </Modal>

    </div>
  );
}
