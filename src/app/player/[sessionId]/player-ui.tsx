"use client";

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Database } from '@/types/database';
import { createClient } from '@/utils/supabase/client';
import { cn } from '@/lib/utils';
import { BingoBall } from '@/components/ui/bingo-ball';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Modal } from '@/components/ui/modal';
import { useWakeLock } from '@/hooks/wake-lock';
import {
  formatPounds,
  getSnowballCallsLabel,
  getSnowballCallsRemaining,
  getSnowballWindowStatus,
} from '@/lib/snowball';
import { isFreshGameState } from '@/lib/game-state-version';
import { planReveal } from '@/lib/reveal-queue';
import { DEFAULT_PUBLIC_CALL_DELAY_SECONDS, PUBLIC_MIN_DWELL_MS } from '@/lib/call-timing';
import { useConnectionHealth } from '@/hooks/use-connection-health';
import { ConnectionBanner } from '@/components/connection-banner';
import type { RealtimeStatus } from '@/lib/connection-health';
import { logError } from '@/lib/log-error';

// Define types for props
type Session = Database['public']['Tables']['sessions']['Row'];
type Game = Database['public']['Tables']['games']['Row'];
type GameState = Database['public']['Tables']['game_states_public']['Row'];
type SnowballPot = Database['public']['Tables']['snowball_pots']['Row'];

/**
 * Outcome of the server-side initial read in page.tsx. 'failed' means a session,
 * game or game-state query errored, which must never be presented to guests as
 * "the host has not started yet".
 */
export type InitialLoadStatus = 'ready' | 'failed';

interface PlayerUIProps {
  session: Session;
  activeGame: Game | null;
  initialGameState: GameState | null;
  initialPrizeText: string;
  initialLoadStatus: InitialLoadStatus;
}

/**
 * What the screen is showing right now. Kept deliberately identical to the pub
 * TV at /display so the phone and the big screen can never disagree in front of
 * guests.
 *
 * This replaces the old "have we loaded yet" boolean, which was initialised to
 * `initialGameState != null` and could therefore never turn true before the host
 * started a game: there is no `game_states_public` row yet, so the follower sat
 * on "Connecting to game..." for the whole pre-game period.
 */
type LoadPhase = 'loading' | 'waiting' | 'active' | 'completed' | 'failed';

/**
 * The only part of the phase that is real client state. 'waiting', 'active' and
 * 'completed' are all functions of the session status and of whether we hold a
 * renderable game state, so storing them separately would duplicate state and
 * let the screen disagree with itself.
 */
type ConnectionPhase = 'loading' | 'ready' | 'failed';

/**
 * Result of `refreshActiveGame`. It used to return void and silently null the
 * state, so an RLS, network or schema failure looked identical to "no game".
 * 'superseded' means a newer refresh has already taken over, so the caller must
 * leave the phase alone rather than judge the connection on a discarded read.
 */
type RefreshResult =
  | { status: 'ok'; hasGame: boolean }
  | { status: 'failed' }
  | { status: 'superseded' };

/**
 * A fresh mount, or a switch to another game, must not trickle an existing
 * backlog out one ball at a time: forty balls at PUBLIC_MIN_DWELL_MS each would
 * take the best part of a minute. Adopt every ball except the newest, then let
 * planReveal gate that one on its own call time plus the public delay.
 */
const adoptRevealCount = (serverCount: number) => Math.max(0, serverCount - 1);

const readCalledNumbers = (state: GameState | null): number[] =>
  state && Array.isArray(state.called_numbers) ? state.called_numbers : [];

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
  initialLoadStatus,
}: PlayerUIProps) {
  const supabase = useRef(createClient());

  const initialRevealCount = adoptRevealCount(readCalledNumbers(initialActiveGameState).length);

  const [currentSession, setCurrentSession] = useState<Session>(session);
  const [currentActiveGame, setCurrentActiveGame] = useState<Game | null>(initialActiveGame);
  const [currentGameState, setCurrentGameState] = useState<GameState | null>(initialActiveGameState);
  // Derived from currentActiveGame + currentGameState. currentGameState is
  // freshness-gated by isFreshGameState in every setter path, so the prize
  // text inherits that gating and cannot drift to a stale stage.
  const currentPrizeText = useMemo<string>(() => {
    if (!currentActiveGame || !currentGameState) return initialPrizeText;
    const stageKey = currentActiveGame.stage_sequence[currentGameState.current_stage_index];
    return currentActiveGame.prizes?.[stageKey as keyof typeof currentActiveGame.prizes] || '';
  }, [currentActiveGame, currentGameState, initialPrizeText]);
  const [currentSnowballPot, setCurrentSnowballPot] = useState<SnowballPot | null>(null);
  const [showFullHistory, setShowFullHistory] = useState(false);
  const [connectionPhase, setConnectionPhase] = useState<ConnectionPhase>(
    initialLoadStatus === 'failed' ? 'failed' : initialActiveGameState ? 'ready' : 'loading'
  );
  // How many balls this client currently shows. planReveal owns the value; the
  // displayed numbers are sliced from it so there is a single source of truth.
  const [revealCount, setRevealCount] = useState<number>(initialRevealCount);

  const revealedCountRef = useRef<number>(initialRevealCount);
  const lastRevealAtRef = useRef<number | null>(null);
  const revealGameIdRef = useRef<string | null>(
    initialActiveGameState ? initialActiveGameState.game_id : null
  );
  const revealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Lets the visibilitychange handler force the game-state channel to rebuild.
  const reconnectGameStateRef = useRef<(() => void) | null>(null);

  // Connection health: drives the reconnecting banner + auto-refresh.
  const health = useConnectionHealth();
  const { markPollSuccess, markPollFailure, markRealtimeStatus } = health;

  // Polling guards: monotonic sequence + in-flight flag prevent stale poll
  // results from clobbering newer state when responses arrive out-of-order.
  const pollSeqRef = useRef(0);
  const pollInFlightRef = useRef(false);
  // refreshActiveGame request-order guard: if active_game_id flips A to B and
  // A's fetch resolves last, the wrong game would win.
  const refreshSeqRef = useRef(0);

  // Stable ref so subscription callbacks can read the active game without
  // re-running this effect every time the game object identity changes.
  const currentActiveGameRef = useRef(currentActiveGame);
  useEffect(() => {
    currentActiveGameRef.current = currentActiveGame;
  }, [currentActiveGame]);

  const { isLocked: isWakeLockActive } = useWakeLock();

  const currentActiveGameId = currentActiveGame ? currentActiveGame.id : null;

  // --- Data Fetching & Subscription Logic (Shared with Display) ---

  const refreshActiveGame = useCallback(
    async (newActiveGameId: string | null): Promise<RefreshResult> => {
      if (newActiveGameId === currentActiveGameId) {
        return { status: 'ok', hasGame: newActiveGameId !== null };
      }
      const seq = ++refreshSeqRef.current;

      if (!newActiveGameId) {
        setCurrentActiveGame(null);
        setCurrentGameState(null);
        return { status: 'ok', hasGame: false };
      }

      const { data: newGame, error: gameError } = await supabase.current
        .from('games')
        .select(GAME_SELECT)
        .eq('id', newActiveGameId)
        .single<Database['public']['Tables']['games']['Row']>();
      if (seq !== refreshSeqRef.current) return { status: 'superseded' };
      if (gameError || !newGame) {
        logError('player', gameError ?? new Error('Active game lookup returned no row'));
        return { status: 'failed' };
      }

      setCurrentActiveGame(newGame);

      const { data: newGameState, error: stateError } = await supabase.current
        .from('game_states_public')
        .select(GAME_STATE_PUBLIC_SELECT)
        .eq('game_id', newGame.id)
        .single<Database['public']['Tables']['game_states_public']['Row']>();
      if (seq !== refreshSeqRef.current) return { status: 'superseded' };
      if (stateError || !newGameState) {
        logError('player', stateError ?? new Error('Active game state lookup returned no row'));
        setCurrentGameState(null);
        return { status: 'failed' };
      }

      setCurrentGameState(newGameState);
      return { status: 'ok', hasGame: true };
    },
    [currentActiveGameId]
  );

  // Session-level realtime: track changes to active_game_id / status, with the
  // same exponential-backoff reconnect as the game-state channel.
  useEffect(() => {
    const supabaseClient = supabase.current;

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
        .channel(`session_updates_player:${session.id}:${Date.now()}`)
        .on<Session>(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'sessions', filter: `id=eq.${session.id}` },
          async (payload) => {
            if (!isMounted) return;
            setCurrentSession(payload.new);
            const result = await refreshActiveGame(payload.new.active_game_id);
            if (!isMounted) return;
            if (result.status === 'failed') setConnectionPhase('failed');
            else if (result.status === 'ok') setConnectionPhase('ready');
          }
        )
        .subscribe((status) => {
          if (!isMounted) return;
          // Deliberately NOT reported into useConnectionHealth. The 3 second
          // poll already picks up game switches and session status, so this
          // channel is non-critical and a wobble here must never put a
          // "Reconnecting" banner in front of a guest. Only the game-state
          // channel reports into connection health.
          if (status === 'SUBSCRIBED') {
            attemptCount = 0;
            return;
          }
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            if (reconnectTimer) clearTimeout(reconnectTimer);
            // Exponential backoff: 1s, 2s, 4s and so on, capped at 30s.
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
  }, [session.id, refreshActiveGame]);

  // Game state realtime with exponential-backoff auto-reconnect.
  // Each reconnect tears down the previous channel before creating the next
  // (ordering matters, because Supabase rejects subscribe() on a torn channel).
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
            // Drop payloads for a different game (active-game switch race).
            const incoming = payload.new as GameState | undefined;
            const activeId = currentActiveGameRef.current?.id;
            if (!incoming || (activeId && incoming.game_id !== activeId)) return;
            // Freshness gate: ignore older snapshots that may arrive after a
            // reconnect or out-of-order broadcast (state_version is monotonic).
            // currentPrizeText is derived from currentGameState via useMemo,
            // so it inherits this gating automatically.
            setCurrentGameState((current) => (isFreshGameState(current, incoming) ? incoming : current));
            setConnectionPhase('ready');
          }
        )
        .subscribe((status) => {
          if (!isMounted) return;
          // This is the ONLY channel that reports into connection health: it is
          // the one carrying live calls, so it is the only one whose failure
          // guests need to know about.
          markRealtimeStatus(status as RealtimeStatus);
          if (status === 'SUBSCRIBED') {
            attemptCount = 0;
            return;
          }
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            if (reconnectTimer) clearTimeout(reconnectTimer);
            // Exponential backoff: 1s, 2s, 4s and so on, capped at 30s.
            const delay = Math.min(1000 * Math.pow(2, attemptCount), 30000);
            attemptCount += 1;
            reconnectTimer = setTimeout(() => { void connect(); }, delay);
          }
        });

      activeChannel = channel;
    };

    reconnectGameStateRef.current = () => { void connect(); };
    void connect();

    return () => {
      isMounted = false;
      reconnectGameStateRef.current = null;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (activeChannel) void supabaseClient.removeChannel(activeChannel);
    };
  }, [currentActiveGame?.id, markRealtimeStatus]);

  // Force-reconnect the game-state channel when the phone comes back into view.
  // Mobile browsers kill background WebSockets silently, and the poll below
  // already re-fires on the same event.
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      reconnectGameStateRef.current?.();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

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

        // Deliberately non-critical: this channel does not report into
        // useConnectionHealth. The pot is re-read whenever the active game
        // changes and the jackpot figure is not time critical, so a pot channel
        // failure must never put a "Reconnecting" banner in front of a guest.
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

  // Polling fallback: re-fetches session + game state every 3 seconds with
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
          setConnectionPhase('failed');
          markPollFailure();
          return;
        }

        setCurrentSession(freshSession);

        const activeGame = currentActiveGameRef.current;
        const knownGameId = activeGame ? activeGame.id : null;
        if (freshSession.active_game_id !== knownGameId) {
          const result = await refreshActiveGame(freshSession.active_game_id);
          if (cancelled) return;
          if (result.status === 'failed') {
            setConnectionPhase('failed');
            markPollFailure();
            return;
          }
          if (result.status === 'ok') setConnectionPhase('ready');
          markPollSuccess();
          return;
        }

        if (activeGame) {
          const { data: freshState, error: stateError } = await supabase.current
            .from('game_states_public')
            .select(GAME_STATE_PUBLIC_SELECT)
            .eq('game_id', activeGame.id)
            .single<GameState>();
          if (cancelled || seq !== pollSeqRef.current) return;
          if (stateError || !freshState) {
            logError('player', stateError ?? new Error('Polling game_states_public returned no row'));
            setConnectionPhase('failed');
            markPollFailure();
            return;
          }

          // Freshness-gated apply: discard stale snapshots that lost a race
          // with a more recent realtime event or earlier poll response.
          // currentPrizeText is derived from currentGameState via useMemo,
          // so it inherits this gating automatically.
          setCurrentGameState((current) => (isFreshGameState(current, freshState) ? freshState : current));
        }

        setConnectionPhase('ready');
        markPollSuccess();
      } catch (err) {
        if (!cancelled) {
          logError('player', err);
          setConnectionPhase('failed');
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

  const serverNumbers = useMemo<number[]>(
    () => readCalledNumbers(currentGameState),
    [currentGameState]
  );

  // Reveal pacing, identical to the pub TV. planReveal is the single decision
  // point: it never skips a ball, never shows the newest one early, and snaps to
  // the server during a claim check or at game end. One timer at a time,
  // re-planned on every snapshot, so the state is fully derivable after a poll
  // or a reconnect.
  useEffect(() => {
    const clearRevealTimer = () => {
      if (revealTimerRef.current) {
        clearTimeout(revealTimerRef.current);
        revealTimerRef.current = null;
      }
    };
    clearRevealTimer();

    if (!currentActiveGame || !currentGameState) {
      revealGameIdRef.current = null;
      revealedCountRef.current = 0;
      lastRevealAtRef.current = null;
      setRevealCount(0);
      return;
    }

    if (revealGameIdRef.current !== currentGameState.game_id) {
      const adopted = adoptRevealCount(serverNumbers.length);
      revealGameIdRef.current = currentGameState.game_id;
      revealedCountRef.current = adopted;
      lastRevealAtRef.current = null;
      setRevealCount(adopted);
    }

    const serverCount = serverNumbers.length;
    const publicDelayMs =
      (Number.isFinite(currentGameState.call_delay_seconds)
        ? currentGameState.call_delay_seconds
        : DEFAULT_PUBLIC_CALL_DELAY_SECONDS) * 1000;
    const parsedLastCallAt = currentGameState.last_call_at
      ? new Date(currentGameState.last_call_at).getTime()
      : null;
    const lastCallAtMs =
      parsedLastCallAt !== null && Number.isFinite(parsedLastCallAt) ? parsedLastCallAt : null;
    const snapImmediately =
      currentGameState.paused_for_validation || currentGameState.status === 'completed';

    const step = () => {
      const plan = planReveal({
        serverCount,
        revealedCount: revealedCountRef.current,
        lastCallAtMs,
        publicDelayMs,
        minDwellMs: PUBLIC_MIN_DWELL_MS,
        lastRevealAtMs: lastRevealAtRef.current,
        snapImmediately,
        nowMs: Date.now(),
      });

      if (plan.revealCount !== revealedCountRef.current) {
        revealedCountRef.current = plan.revealCount;
        lastRevealAtRef.current = Date.now();
        setRevealCount(plan.revealCount);
      }

      revealTimerRef.current =
        plan.nextTickInMs === null ? null : setTimeout(step, plan.nextTickInMs);
    };

    step();

    return clearRevealTimer;
  }, [currentActiveGame, currentGameState, serverNumbers]);

  const delayedNumbers = useMemo<number[]>(
    () => serverNumbers.slice(0, revealCount),
    [serverNumbers, revealCount]
  );
  // The revealed count is what every public counter must use. Reading
  // numbers_called_count would tick a counter down up to 3 seconds before the
  // ball itself appears, spoiling the call and disagreeing with the ball strip.
  const revealedCallCount = delayedNumbers.length;
  const currentNumberDelayed = revealedCallCount > 0 ? delayedNumbers[revealedCallCount - 1] : null;

  // --- UI States ---
  const isSessionCompleted = currentSession.status === 'completed';
  /**
   * A game counts as active once this surface has something to render for it.
   * The phone has its own "Game Over" card, so a completed game is renderable
   * here even though on the pub TV it falls through to the waiting screen.
   */
  const hasRenderableGame =
    currentActiveGame !== null &&
    currentGameState !== null &&
    (currentGameState.status === 'in_progress' || currentGameState.status === 'completed');

  /**
   * Phase precedence, in order and for a reason:
   *  - a completed session is terminal, so the thank-you card always wins;
   *  - a renderable game beats 'failed', because a single query blip must never
   *    rip a live game off the screen. The ConnectionBanner covers that case;
   *  - 'failed' beats 'waiting' and 'loading', so an outage is never dressed up
   *    as "the host has not started yet". It recovers on the next good read.
   */
  const loadPhase = useMemo<LoadPhase>(() => {
    if (isSessionCompleted) return 'completed';
    if (hasRenderableGame) return 'active';
    if (connectionPhase === 'failed') return 'failed';
    if (connectionPhase === 'loading') return 'loading';
    return 'waiting';
  }, [isSessionCompleted, hasRenderableGame, connectionPhase]);

  const isWaiting = !isSessionCompleted && !hasRenderableGame;
  const isOnBreak = currentGameState?.on_break;
  const isCompleted = currentGameState?.status === 'completed';
  const isValidating = currentGameState?.paused_for_validation;
  const isWin = !!currentGameState?.display_win_type;

  const backgroundColor = currentActiveGame?.background_colour || '#005131';
  const isSnowballGame = currentActiveGame?.type === 'snowball';
  const snowballCallsLabel = currentSnowballPot && currentGameState
    ? getSnowballCallsLabel(revealedCallCount, currentSnowballPot.current_max_calls)
    : null;
  const snowballCallsRemaining = currentSnowballPot && currentGameState
    ? getSnowballCallsRemaining(revealedCallCount, currentSnowballPot.current_max_calls)
    : null;
  const snowballWindowStatus = currentSnowballPot && currentGameState
    ? getSnowballWindowStatus(revealedCallCount, currentSnowballPot.current_max_calls)
    : null;

  // First server answer not in yet. Deliberately brief: unlike the old boolean
  // gate this can always be left, because the poll above resolves the phase to
  // waiting, active, completed or failed on its first response.
  if (loadPhase === 'loading') {
    return (
      <div className="flex h-screen items-center justify-center text-white" style={{ backgroundColor: '#005131' }}>
        <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-current mr-3" />
        Connecting to game…
      </div>
    );
  }

  // Recoverable outage. Polling continues, and the next good read moves the
  // screen straight on to the waiting or active phase with no reload.
  if (loadPhase === 'failed') {
    return (
      <div
        className="flex min-h-screen items-center justify-center p-6 text-white"
        style={{ backgroundColor: '#005131' }}
      >
        <Card className="w-full max-w-sm bg-[#003f27]/80 border-[#1f7c58]">
          <CardContent className="p-6 text-center" role="status" aria-live="polite">
            <div className="text-4xl mb-2">📡</div>
            <h2 className="text-xl font-bold text-white">Reconnecting to the game</h2>
            <p className="text-white mt-1">Hold on to your tickets, this screen will catch up in a moment.</p>
            <span className="mt-4 inline-block h-2 w-2 animate-pulse rounded-full bg-white" />
          </CardContent>
        </Card>
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
            <span className="font-mono font-bold text-xl leading-none">{revealedCallCount}</span>
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
              {/* The claim is validated against the last called ball, and the
                  reveal queue snaps to the server state while paused, so this is
                  always the true last call. */}
              {currentNumberDelayed !== null && (
                <p className="mt-2 text-lg font-bold text-white">
                  Claim must include: {currentNumberDelayed}
                </p>
              )}
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
              <div className="bg-[#a57626]/25 p-3 rounded-lg border border-[#a57626]/60 shadow-lg shadow-black/25">
                {currentSnowballPot && currentGameState && snowballWindowStatus ? (
                  <>
                    <div className="flex justify-between items-center gap-4">
                      <div>
                        <span className="text-white text-xs font-bold uppercase block">Snowball Jackpot</span>
                        <span className="text-2xl font-bold text-white">£{formatPounds(Number(currentSnowballPot.current_jackpot_amount))}</span>
                      </div>
                      <div className="text-right shrink-0">
                        {snowballWindowStatus === 'open' ? (
                          <>
                            <span className="block text-6xl font-black leading-none text-white tabular-nums">
                              {snowballCallsRemaining}
                            </span>
                            <span className="block text-[0.7rem] font-bold uppercase tracking-wider text-white/90 mt-1">
                              Calls Left
                            </span>
                          </>
                        ) : (
                          <span className="block text-xl font-black uppercase text-white">
                            {snowballCallsLabel}
                          </span>
                        )}
                      </div>
                    </div>
                    <p className="text-xs text-white/90 mt-2">
                      {revealedCallCount}/{currentSnowballPot.current_max_calls} calls made for the jackpot
                    </p>
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

            {/* Recent History. Five balls, 40 percent larger than before, and
                allowed to slide sideways rather than shrink: BingoBall carries
                shrink-0 so the balls stay circular at 320px and at 200 percent
                text zoom. */}
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
                    className={i === 0 ? "w-[4.9rem] h-[4.9rem] text-[1.75rem] bg-[#005131] text-white border-white/70" : "w-[4.2rem] h-[4.2rem] text-[1.575rem] opacity-80 bg-[#005131] text-white border-white/50"}
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
