"use client";

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Database } from '@/types/database';
import { createClient } from '@/utils/supabase/client';
import { cn } from '@/lib/utils';
import Image from 'next/image';
import { QRCodeSVG } from 'qrcode.react';
import {
  formatPounds,
  getSnowballCallsLabel,
  getSnowballCallsRemaining,
  getSnowballWindowStatus,
} from '@/lib/snowball';
import { HOUSE_RULES, CALL_RESPONSES } from '@/lib/house-rules';
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

interface DisplayUIProps {
  session: Session;
  activeGame: Game | null;
  initialGameState: GameState | null;
  initialPrizeText: string;
  initialLoadStatus: InitialLoadStatus;
  playerJoinUrl: string;
}

/**
 * What the screen is showing right now.
 *
 * This replaces the old "have we loaded yet" boolean, which was initialised to
 * `initialGameState != null` and could therefore never turn true before the host
 * started a game: there is no `game_states_public` row yet, so the pub TV sat on
 * "Connecting to game..." for the whole pre-game period instead of showing the
 * waiting screen with the House Rules.
 */
type LoadPhase = 'loading' | 'waiting' | 'active' | 'completed' | 'failed';

/**
 * The only part of the phase that is real client state. 'waiting', 'active' and
 * 'completed' are all functions of the session status and of whether we hold a
 * renderable game state, so storing them separately would duplicate state and
 * let the screen disagree with itself, which is exactly how the old boolean
 * stranded the TV on a spinner.
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

const formatStageLabel = (stage: string | undefined) => {
  if (!stage) return '-';

  return stage
    .replace(/[_-]+/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
};

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

export default function DisplayUI({
  session,
  activeGame: initialActiveGame,
  initialGameState: initialActiveGameState,
  initialPrizeText,
  initialLoadStatus,
  playerJoinUrl,
}: DisplayUIProps) {
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

  // Stable refs for fields that the polling effect reads but should not retrigger
  // its setup. Pairs with the `currentActiveGame?.id` dependency below.
  const currentActiveGameRef = useRef(currentActiveGame);
  useEffect(() => {
    currentActiveGameRef.current = currentActiveGame;
  }, [currentActiveGame]);

  const currentActiveGameId = currentActiveGame ? currentActiveGame.id : null;

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
        logError('display', gameError ?? new Error('Active game lookup returned no row'));
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
        logError('display', stateError ?? new Error('Active game state lookup returned no row'));
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
        .channel(`session_updates:${session.id}:${Date.now()}`)
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
          // "Reconnecting" banner on the pub TV. Only the game-state channel
          // reports into connection health.
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
        .channel(`game_state_public_updates:${activeGameId}:${Date.now()}`)
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

  // Force-reconnect the game-state channel when the screen comes back into
  // view. TV browsers and phones kill background WebSockets silently, and the
  // poll below already re-fires on the same event.
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      reconnectGameStateRef.current?.();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

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
          logError('display', sessionError ?? new Error('Polling sessions returned no row'));
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
            logError('display', stateError ?? new Error('Polling game_states_public returned no row'));
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
          logError('display', err);
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
            // changes and the jackpot figure is not time critical, so a pot
            // channel failure must never put a "Reconnecting" banner on the TV.
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

  const serverNumbers = useMemo<number[]>(
    () => readCalledNumbers(currentGameState),
    [currentGameState]
  );

  // Reveal pacing. planReveal is the single decision point: it never skips a
  // ball, never shows the newest one early, and snaps to the server during a
  // claim check or at game end. One timer at a time, re-planned on every
  // snapshot, so the state is fully derivable after a poll or a reconnect.
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

  const isSessionCompletedState = currentSession.status === 'completed';
  /**
   * A game only counts as active once this screen has something to put in the
   * main area. A row that is 'not_started' or 'completed' renders nothing here,
   * so it must fall through to the waiting screen rather than leave the pub TV
   * blank between games.
   */
  const hasRenderableGame =
    currentActiveGame !== null &&
    currentGameState !== null &&
    currentGameState.status === 'in_progress';

  /**
   * Phase precedence, in order and for a reason:
   *  - a completed session is terminal, so the thank-you screen always wins;
   *  - a renderable game beats 'failed', because a single query blip must never
   *    rip a live game off the TV. The ConnectionBanner covers that case;
   *  - 'failed' beats 'waiting' and 'loading', so an outage is never dressed up
   *    as "the host has not started yet". It recovers on the next good read.
   */
  const loadPhase = useMemo<LoadPhase>(() => {
    if (isSessionCompletedState) return 'completed';
    if (hasRenderableGame) return 'active';
    if (connectionPhase === 'failed') return 'failed';
    if (connectionPhase === 'loading') return 'loading';
    return 'waiting';
  }, [isSessionCompletedState, hasRenderableGame, connectionPhase]);

  const isWaitingState = loadPhase === 'waiting';
  // Every game overlay hangs off hasRenderableGame, so the waiting screen and
  // the live-game screens are mutually exclusive: a stale on_break or
  // paused_for_validation flag on a finished game can never stack a break or
  // claim-check overlay on top of the waiting screen.
  const showActiveGame = hasRenderableGame && !currentGameState?.on_break && !isSessionCompletedState && !currentGameState?.display_win_type && !currentGameState?.paused_for_validation;
  const showBreak = hasRenderableGame && !!currentGameState?.on_break && !isSessionCompletedState;
  const showPausedForValidation = hasRenderableGame && !!currentGameState?.paused_for_validation && !isSessionCompletedState;
  const showWinState = hasRenderableGame && !!currentGameState?.display_win_type && !isSessionCompletedState;
  const showServiceState = !!((isWaitingState && !isSessionCompletedState) || showBreak || isSessionCompletedState);
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
  const resolvedJoinUrl = playerJoinUrl.startsWith('http')
    ? playerJoinUrl
    : `${typeof window !== 'undefined' ? window.location.origin : ''}/player/${session.id}`;

  const displayBackgroundColor = currentActiveGame?.background_colour || '#005131';
  const dimTextColor = 'text-white';
  const footerLeftTextClass = "text-[clamp(1.1rem,1.9vw,1.8rem)] font-semibold text-white";
  // This panel is height-constrained: it lives in a fixed-height main area and is
  // overflow-hidden, so anything that does not fit is clipped silently rather
  // than scrolled. Sizing off vw alone (the old approach) therefore clipped the
  // closing rule on shorter screens. These scales take min() of a width term and
  // a height term so the binding constraint wins, and they now have to carry the
  // Join in grid as well. Do not raise them without re-checking 1280x720 AND
  // 1920x1080 on all three screens that render this panel.
  const houseRulesTitleClass = "text-[min(2.9vw,5vh)] font-bold text-white mb-3 border-b border-[#1f7c58] pb-2";
  // space-y-3 rather than space-y-4: the tighter list buys back the room the
  // "Join in" grid needs, because this panel clips instead of scrolling.
  const houseRulesListClass = "space-y-2 text-[min(2.35vw,3.2vh)] leading-[1.2] text-white";
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
    revealedCallCount === 0 &&
    stagePrizePreview.length > 0
  );

  const renderHouseRulesPanel = () => (
    <div className="bg-[#003f27]/85 border border-[#1f7c58] rounded-3xl p-6 text-left backdrop-blur-md overflow-hidden">
      <h3 className={houseRulesTitleClass}>House Rules</h3>
      <ul className={houseRulesListClass}>
        {HOUSE_RULES.map((rule, i) => (
          <li
            key={i}
            className={cn(
              'flex gap-4 items-start',
              rule.variant === 'closing' && 'pt-1'
            )}
          >
            <span
              className={
                rule.variant === 'closing'
                  ? 'text-[clamp(1.7rem,2.3vw,2.4rem)]'
                  : 'text-white mt-1'
              }
            >
              {rule.icon}
            </span>
            {rule.variant === 'closing' ? (
              <span className="font-bold italic">
                {rule.segments.map((seg, j) =>
                  seg.bold ? (
                    <span key={j} className="font-bold">{seg.text}</span>
                  ) : (
                    <React.Fragment key={j}>{seg.text}</React.Fragment>
                  )
                )}
              </span>
            ) : (
              <span>
                {rule.segments.map((seg, j) =>
                  seg.bold ? (
                    <span key={j} className="font-bold">{seg.text}</span>
                  ) : (
                    <React.Fragment key={j}>{seg.text}</React.Fragment>
                  )
                )}
              </span>
            )}
          </li>
        ))}
      </ul>

      {/* Call-and-response nudges. Two columns and three rows, deliberately
          smaller than the rules and tightly spaced: the panel is
          overflow-hidden, so anything that does not fit is clipped silently. */}
      <div className="mt-3 border-t border-[#1f7c58] pt-2">
        <h4 className="text-[min(1.35vw,2.2vh)] font-bold uppercase tracking-[0.12em] text-white mb-1.5">
          Join in
        </h4>
        <div className="grid grid-cols-2 gap-x-5 gap-y-0.5">
          {CALL_RESPONSES.map((item) => (
            <p
              key={item.number}
              className="text-[min(1.6vw,2.4vh)] leading-tight text-white"
            >
              <span className="font-bold text-[#f3d59d]">{item.number}</span> {item.response}
            </p>
          ))}
        </div>
      </div>
    </div>
  );

  // First server answer not in yet. Deliberately brief: unlike the old boolean
  // gate this can always be left, because the poll below resolves the phase to
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
        role="status"
        aria-live="polite"
        className="flex h-screen flex-col items-center justify-center gap-5 px-10 text-center text-white"
        style={{ backgroundColor: '#005131' }}
      >
        <p className="text-[clamp(0.95rem,1.2vw,1.1rem)] uppercase tracking-[0.2em] font-semibold text-white/85">
          Anchor Bingo Night
        </p>
        <h1 className="text-[clamp(2rem,4.6vw,4.2rem)] font-black uppercase tracking-[0.07em]">
          Reconnecting To The Game
        </h1>
        <p className="text-[clamp(1rem,1.55vw,1.35rem)] text-white/90">
          Hold on to your tickets, the screen will catch up in a moment.
        </p>
        <span className="inline-block h-3 w-3 animate-pulse rounded-full bg-white" />
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

          {/* Snowball countdown badge. Top right so it can never collide with
              the bottom-left join QR, and static so it needs no
              prefers-reduced-motion opt-out. The z-70 validation overlay and
              the z-80 win overlay cover it as they cover everything else. */}
          {isSnowballGame && (showActiveGame || showPausedForValidation) && currentSnowballPot && snowballWindowStatus && (
            <div className="absolute top-4 right-4 z-40 rounded-3xl border border-[#a57626] bg-[#005131]/92 px-6 py-4 text-center backdrop-blur-sm">
              {snowballWindowStatus === 'open' ? (
                <>
                  <p
                    className="font-black leading-none text-[#f3d59d]"
                    style={{
                      fontSize: 'clamp(3rem,6vw,5.5rem)',
                      fontVariantNumeric: 'tabular-nums lining-nums',
                    }}
                  >
                    {snowballCallsRemaining}
                  </p>
                  <p className="mt-1 text-[clamp(0.9rem,1.3vw,1.2rem)] font-bold uppercase tracking-[0.16em] text-white">
                    Calls Left
                  </p>
                </>
              ) : (
                <p
                  className="font-black uppercase leading-none text-[#f3d59d]"
                  style={{ fontSize: 'clamp(1.6rem,3vw,2.8rem)' }}
                >
                  {snowballCallsLabel}
                </p>
              )}
              <p className="mt-2 text-[clamp(1.1rem,1.8vw,1.6rem)] font-bold text-white">
                £{formatPounds(Number(currentSnowballPot.current_jackpot_amount))}
              </p>
            </div>
          )}

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
                <div className="w-full max-w-6xl bg-[#005131]/90 border border-[#a57626] rounded-3xl p-8 flex flex-col lg:flex-row items-center justify-center gap-8">
                    <div className="text-center lg:text-left">
                      <p className="text-[clamp(1rem,2vw,1.5rem)] uppercase tracking-[0.18em] font-bold text-[#f3d59d]">Validation In Progress</p>
                      <h1 className="text-[clamp(2.7rem,7.2vw,6.5rem)] leading-[1.02] font-black uppercase tracking-[0.08em] text-white mt-2">Checking Claim</h1>
                      <p className="text-[clamp(1.1rem,2.4vw,2rem)] leading-tight text-white/90 mt-3">Please hold all calls while the ticket is verified.</p>
                    </div>
                    {/* The claim is validated against the last called ball, and the
                        reveal queue snaps to the server state while paused, so this
                        is always the true last call. */}
                    {currentNumberDelayed !== null && (
                      <div className="flex flex-col items-center gap-2 shrink-0">
                        <p className="text-[clamp(0.9rem,1.5vw,1.3rem)] uppercase tracking-[0.16em] font-bold text-[#f3d59d]">Claim must include</p>
                        <div
                          className="flex items-center justify-center rounded-full bg-[#005131] border-4 border-white font-bold text-white leading-none shrink-0"
                          style={{
                            width: 'clamp(4rem,12vw,10rem)',
                            height: 'clamp(4rem,12vw,10rem)',
                            fontSize: 'clamp(2rem,6vw,5rem)',
                            fontVariantNumeric: 'tabular-nums lining-nums',
                          }}
                        >
                          {currentNumberDelayed}
                        </div>
                      </div>
                    )}
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
                      ['--display-ball-size' as string]: 'min(68vh, calc(100vw - 6rem), calc(100vh - 18rem))',
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

      {/* Footer Info Bar. h-40 rather than h-32 to clear the enlarged recent
          calls strip, paired with the main ball's calc(100vh - 18rem) and the
          QR badge at bottom-44. Change all four together or 1080p breaks. */}
      <div className="h-40 bg-[#005131] border-t border-[#1f7c58] grid grid-cols-2 px-8 z-10">
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
                        {currentSnowballPot
                          ? `Snowball: £${formatPounds(Number(currentSnowballPot.current_jackpot_amount))}`
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
                          <span className={cn("text-[16px] uppercase tracking-widest font-bold", dimTextColor)}>Total Calls: {revealedCallCount}</span>
                      </div>
                      <div className="flex items-center gap-3 overflow-hidden mask-linear-fade">
                          {delayedNumbers.slice().reverse().map((num, idx) => (
                              <div key={idx} className={cn(
                                  "flex items-center justify-center rounded-full bg-[#005131] border border-white/60 font-bold text-white shrink-0",
                                  idx === 0 ? "w-[5.6rem] h-[5.6rem] text-[50px] border-4 border-white" : "w-[4.2rem] h-[4.2rem] text-[38px] opacity-70"
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
      <div className="absolute bottom-44 left-8 bg-[#005131] border border-white/30 p-4 rounded-xl flex flex-col items-center gap-2 animate-in slide-in-from-left duration-1000 z-40">
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
