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
import {
  PUBLIC_GAME_COLUMNS,
  PUBLIC_GAME_STATE_COLUMNS,
  PUBLIC_SESSION_COLUMNS,
  isFreshSession,
} from '@/lib/public-selectors';
import { getInGameSubState, getNightPhase, pickNextGame } from '@/lib/night-phase';
import { getClaimPanelState } from '@/lib/claim-panel';
import { getRequiredSelectionCountForStage } from '@/lib/win-stages';
import { formatGameIdentity, getGamePosition, getHouseRules } from '@/lib/house-rules';
import { shouldApplyPolledPot } from '@/lib/snowball-pot-poll';
import { planReveal } from '@/lib/reveal-queue';
import { DEFAULT_PUBLIC_CALL_DELAY_SECONDS, PUBLIC_MIN_DWELL_MS } from '@/lib/call-timing';
import { createPollRunner, type PollRunner } from '@/lib/poll-runner';
import { useConnectionHealth } from '@/hooks/use-connection-health';
import { useRealtimeChannel } from '@/hooks/use-realtime-channel';
import { useClockOffset } from '@/hooks/use-clock-offset';
import { useBuildCheck } from '@/hooks/use-build-check';
import { isPublicReloadSafe } from '@/lib/build-check';
import { ConnectionBanner } from '@/components/connection-banner';
import { ClaimBalls, ClaimPanel } from '@/components/display/claim-panel';
import { PhoneRules } from '@/components/display/phone-rules';
import { PhoneEvents, PhoneReviewButton } from '@/components/display/phone-events';
import type { EventsProjection } from '@/lib/playlist';
import { useSessionOverview } from '@/components/display/use-session-overview';
import { logError } from '@/lib/log-error';

// Define types for props
type Session = Database['public']['Tables']['sessions']['Row'];
type Game = Database['public']['Tables']['games']['Row'];
type GameState = Database['public']['Tables']['game_states_public']['Row'];
type SnowballPot = Database['public']['Tables']['snowball_pots']['Row'];
type PublicClient = ReturnType<typeof createClient>;

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
  /** Upcoming events as the server page read them (spec 5.5); phones read them once, on load. */
  initialEvents: EventsProjection | null;
}

/**
 * Whether the screen can show the night yet. 'ready' screens are then chosen by
 * the part of the night (getNightPhase in src/lib/night-phase.ts), exactly as on
 * the pub TV at /display, so the phone and the big screen can never disagree in
 * front of guests.
 *
 * This replaces the old "have we loaded yet" boolean, which was initialised to
 * `initialGameState != null` and could therefore never turn true before the host
 * started a game: there is no `game_states_public` row yet, so the follower sat
 * on "Connecting to game..." for the whole pre-game period.
 */
type LoadPhase = 'loading' | 'ready' | 'failed';

/**
 * The only part of the screen choice that is real client state. The part of
 * the night is a function of the session and of the game state we hold, so
 * storing it separately would duplicate state and let the screen disagree with
 * itself.
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

/** One poll's worth of public state, read in full before any of it is applied. */
interface PublicSnapshot {
  session: Session;
  /** The game `state` belongs to, or null when the session has no active game. */
  game: Game | null;
  /** True when `game` is not the game the screen showed when the poll started. */
  gameChanged: boolean;
  state: GameState | null;
  /** Null when there is no pot, or its non-critical read failed. */
  pot: SnowballPot | null;
  potPollStartedAt: number | null;
}

/**
 * A fresh mount, or a switch to another game, must not trickle an existing
 * backlog out one ball at a time: forty balls at PUBLIC_MIN_DWELL_MS each would
 * take the best part of a minute. Adopt every ball except the newest, then let
 * planReveal gate that one on its own call time plus the public delay.
 */
const adoptRevealCount = (serverCount: number) => Math.max(0, serverCount - 1);

const readCalledNumbers = (state: GameState | null): number[] =>
  state && Array.isArray(state.called_numbers) ? state.called_numbers : [];

const POLL_INTERVAL_MS = 3000;
const LOG_SCOPE = 'player';

/**
 * Reads a game and its public state together. Used for every game switch, so
 * the new game's name and colour never reach the screen before its state does:
 * setting the game first used to show the new name over the old game's board
 * for a moment (X12b).
 */
async function fetchGameWithState(
  client: PublicClient,
  gameId: string,
  signal?: AbortSignal,
): Promise<{ game: Game; state: GameState }> {
  const gameQuery = client.from('games').select(PUBLIC_GAME_COLUMNS).eq('id', gameId);
  const { data: game, error: gameError } = await (signal ? gameQuery.abortSignal(signal) : gameQuery).single<Game>();
  if (gameError || !game) throw gameError ?? new Error('Active game lookup returned no row');

  const stateQuery = client.from('game_states_public').select(PUBLIC_GAME_STATE_COLUMNS).eq('game_id', game.id);
  const { data: state, error: stateError } = await (signal ? stateQuery.abortSignal(signal) : stateQuery).single<GameState>();
  if (stateError || !state) throw stateError ?? new Error('Active game state lookup returned no row');

  return { game, state };
}

/**
 * One poll: the session, then the active game's state (and the game itself on
 * a switch), then the pot. Nothing is applied here; the caller applies the whole
 * snapshot at once, and only if no Realtime event or newer poll overtook it.
 */
async function fetchPublicSnapshot(
  client: PublicClient,
  sessionId: string,
  knownGame: Game | null,
  signal: AbortSignal,
): Promise<PublicSnapshot> {
  const { data: session, error: sessionError } = await client
    .from('sessions')
    .select(PUBLIC_SESSION_COLUMNS)
    .eq('id', sessionId)
    .abortSignal(signal)
    .single<Session>();
  if (sessionError || !session) throw sessionError ?? new Error('Polling sessions returned no row');

  const targetGameId = session.active_game_id;
  if (!targetGameId) {
    return { session, game: null, gameChanged: knownGame !== null, state: null, pot: null, potPollStartedAt: null };
  }

  let game: Game;
  let state: GameState;
  let gameChanged = false;
  if (!knownGame || knownGame.id !== targetGameId) {
    ({ game, state } = await fetchGameWithState(client, targetGameId, signal));
    gameChanged = true;
  } else {
    game = knownGame;
    const { data: freshState, error: stateError } = await client
      .from('game_states_public')
      .select(PUBLIC_GAME_STATE_COLUMNS)
      .eq('game_id', game.id)
      .abortSignal(signal)
      .single<GameState>();
    if (stateError || !freshState) throw stateError ?? new Error('Polling game_states_public returned no row');
    state = freshState;
  }

  // The pot rides on the poll as well as its Realtime channel, so a missed pot
  // event cannot leave a stale jackpot up for the rest of the game. Non-critical
  // like the channel: a failed read is logged and never fails the poll, so it
  // cannot raise the banner.
  let pot: SnowballPot | null = null;
  let potPollStartedAt: number | null = null;
  if (game.type === 'snowball' && game.snowball_pot_id) {
    potPollStartedAt = Date.now();
    const { data: freshPot, error: potError } = await client
      .from('snowball_pots')
      .select('*')
      .eq('id', game.snowball_pot_id)
      .abortSignal(signal)
      .single<SnowballPot>();
    if (potError || !freshPot) {
      logError(LOG_SCOPE, potError ?? new Error('Polling snowball_pots returned no row'));
    } else {
      pot = freshPot;
    }
  }

  return { session, game, gameChanged, state, pot, potPollStartedAt };
}

export default function PlayerUI({
  session,
  activeGame: initialActiveGame,
  initialGameState: initialActiveGameState,
  initialPrizeText,
  initialLoadStatus,
  initialEvents,
}: PlayerUIProps) {
  // One client for the life of the screen. Held in state rather than a ref so
  // it can be passed to hooks during render.
  const [supabase] = useState<PublicClient>(createClient);

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
  // The last pot row read from any source. Only shown while it is the active
  // game's pot (see currentSnowballPot below), so a late read or event for the
  // previous game's pot can never be shown against this one.
  const [latestPot, setLatestPot] = useState<SnowballPot | null>(null);
  const [showFullHistory, setShowFullHistory] = useState(false);
  const [showRules, setShowRules] = useState(false);
  // The server page's read counts as the first good read whenever it did not
  // fail, with or without a game state. Before the first game there is no
  // game state at all, and waiting for the first poll instead left the phone
  // on "Connecting to game…" until it answered, for good if the page was
  // hidden or Realtime was down.
  const [connectionPhase, setConnectionPhase] = useState<ConnectionPhase>(
    initialLoadStatus === 'failed' ? 'failed' : 'ready'
  );
  // Whether this screen has ever had a good read. Before the first one a
  // failure shows "Connecting"; after it, the last good screen stays up.
  const [hasBeenReady, setHasBeenReady] = useState<boolean>(initialLoadStatus !== 'failed');
  // How many balls this client shows, and for which game. planReveal owns the
  // value; the displayed numbers are sliced from it so there is a single source
  // of truth. Keyed by game so a render for a new game never uses the old
  // game's count (see revealCount below).
  const [reveal, setReveal] = useState<{ gameId: string | null; count: number }>({
    gameId: initialActiveGameState ? initialActiveGameState.game_id : null,
    count: initialRevealCount,
  });

  const revealedCountRef = useRef<number>(initialRevealCount);
  // performance.now() of this client's last advance: the dwell clock.
  const lastRevealAtRef = useRef<number | null>(null);
  const revealGameIdRef = useRef<string | null>(
    initialActiveGameState ? initialActiveGameState.game_id : null
  );
  const revealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // When (performance.now()) this client first saw the current newest ball.
  const newestSeenRef = useRef<{ gameId: string; count: number; atMs: number } | null>(null);

  // Connection health: drives the reconnecting banner + auto-refresh.
  // NEVER put `health` itself in a dependency array: it changes every second.
  const health = useConnectionHealth();
  const { markPollSuccess, markPollFailure, markRealtimeStatus } = health;

  // Device clock correction for the reveal delay (X12d).
  const clockOffsetMs = useClockOffset();

  // The poll's sequencing and deadline. Realtime handlers call invalidate()
  // before applying, so a poll that was already in flight cannot put older
  // state back on screen.
  const pollRunnerRef = useRef<PollRunner<PublicSnapshot> | null>(null);
  // refreshActiveGame request-order guard: if active_game_id flips A to B and
  // A's fetch resolves last, the wrong game would win.
  const refreshSeqRef = useRef(0);
  // When the pot channel last delivered, so a slower poll cannot overwrite it.
  const potRealtimeAtRef = useRef<number | null>(null);

  // Stable refs for fields that the polling effect reads but should not retrigger
  // its setup.
  const currentActiveGameRef = useRef(currentActiveGame);
  useEffect(() => {
    currentActiveGameRef.current = currentActiveGame;
  }, [currentActiveGame]);

  // The version of the session row on screen. A session snapshot older than
  // this is dropped (isFreshSession, R09): sessions.state_version is bumped by
  // trigger on every update, so a late poll can no longer put an ended night
  // back to running, or a finished game back on screen.
  const sessionVersionRef = useRef<{ state_version?: number | null }>({ state_version: session.state_version });
  const applySession = useCallback((incoming: Session) => {
    sessionVersionRef.current = { state_version: incoming.state_version };
    setCurrentSession(incoming);
  }, []);

  const { isLocked: isWakeLockActive } = useWakeLock();

  const currentActiveGameId = currentActiveGame ? currentActiveGame.id : null;
  const activePotId =
    currentActiveGame?.type === 'snowball' && currentActiveGame.snowball_pot_id
      ? currentActiveGame.snowball_pot_id
      : null;

  const refreshActiveGame = useCallback(
    async (newActiveGameId: string | null): Promise<RefreshResult> => {
      const knownGameId = currentActiveGameRef.current?.id ?? null;
      if (newActiveGameId === knownGameId) {
        return { status: 'ok', hasGame: newActiveGameId !== null };
      }
      const seq = ++refreshSeqRef.current;

      if (!newActiveGameId) {
        setCurrentActiveGame(null);
        setCurrentGameState(null);
        return { status: 'ok', hasGame: false };
      }

      try {
        const { game, state } = await fetchGameWithState(supabase, newActiveGameId);
        if (seq !== refreshSeqRef.current) return { status: 'superseded' };
        // Game and state in the same render (X12b).
        setCurrentActiveGame(game);
        setCurrentGameState(state);
        return { status: 'ok', hasGame: true };
      } catch (err) {
        if (seq !== refreshSeqRef.current) return { status: 'superseded' };
        logError(LOG_SCOPE, err);
        return { status: 'failed' };
      }
    },
    [supabase]
  );

  // Session-level realtime: track changes to active_game_id / status.
  // Deliberately NOT reported into useConnectionHealth. The 3 second poll
  // already picks up game switches and session status, so this channel is
  // non-critical and a wobble here must never put a "Reconnecting" banner in
  // front of a guest. Only the game-state channel reports into connection
  // health.
  useRealtimeChannel({
    supabase,
    key: `session_updates_player:${session.id}`,
    build: (channel, isCurrent) =>
      channel.on<Session>(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'sessions', filter: `id=eq.${session.id}` },
        async (payload) => {
          if (!isCurrent()) return;
          if (!isFreshSession(sessionVersionRef.current, payload.new)) return;
          pollRunnerRef.current?.invalidate();
          applySession(payload.new);
          const result = await refreshActiveGame(payload.new.active_game_id);
          if (result.status === 'failed') {
            setConnectionPhase('failed');
          } else if (result.status === 'ok') {
            setConnectionPhase('ready');
            setHasBeenReady(true);
          }
        }
      ),
  });

  // Game state realtime. This is the ONLY channel that reports into connection
  // health: it is the one carrying live calls, so it is the only one whose
  // failure guests need to know about. useRealtimeChannel owns the reconnect
  // and its backoff, and ignores the CLOSED that tearing a channel down fires.
  const { reconnect: reconnectGameState } = useRealtimeChannel({
    supabase,
    key: `game_state_public_updates_player:${currentActiveGameId ?? 'none'}`,
    enabled: currentActiveGameId !== null,
    onStatus: markRealtimeStatus,
    build: (channel, isCurrent) =>
      channel.on<GameState>(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'game_states_public', filter: `game_id=eq.${currentActiveGameId}` },
        (payload) => {
          if (!isCurrent()) return;
          // Drop payloads for a different game (active-game switch race).
          const incoming = payload.new as GameState | undefined;
          const activeId = currentActiveGameRef.current?.id;
          if (!incoming || (activeId && incoming.game_id !== activeId)) return;
          // Anything the poll has in flight was requested before this event.
          pollRunnerRef.current?.invalidate();
          // Freshness gate: ignore older snapshots that may arrive after a
          // reconnect or out-of-order broadcast (state_version is monotonic).
          setCurrentGameState((current) => (isFreshGameState(current, incoming) ? incoming : current));
          setConnectionPhase('ready');
          setHasBeenReady(true);
        }
      ),
  });

  // Force-reconnect the game-state channel when the phone comes back into view.
  // Mobile browsers kill background WebSockets silently, and the poll below
  // already re-fires on the same event.
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      reconnectGameState();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [reconnectGameState]);

  // Snowball pot realtime. Deliberately non-critical: this channel does not
  // report into useConnectionHealth. The pot is re-read whenever the active
  // game changes and on every poll, and the jackpot figure is not time
  // critical, so a pot channel failure must never put a "Reconnecting" banner
  // in front of a guest. It used to be opened outside any reconnect logic
  // and could leak (X12c); it now shares the guarded connector and checks the
  // pot id.
  useRealtimeChannel({
    supabase,
    key: `pot_updates_player:${activePotId ?? 'none'}`,
    enabled: activePotId !== null,
    build: (channel, isCurrent) =>
      channel.on<SnowballPot>(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'snowball_pots', filter: `id=eq.${activePotId}` },
        (payload) => {
          if (!isCurrent()) return;
          const incoming = payload.new;
          if (!incoming || incoming.id !== currentActiveGameRef.current?.snowball_pot_id) return;
          potRealtimeAtRef.current = Date.now();
          setLatestPot(incoming);
        }
      ),
  });

  // Read the pot whenever the active game's pot changes.
  useEffect(() => {
    if (!activePotId) return;
    let cancelled = false;
    const readStartedAt = Date.now();
    void (async () => {
      const { data, error } = await supabase
        .from('snowball_pots')
        .select('*')
        .eq('id', activePotId)
        .single<SnowballPot>();
      if (cancelled) return;
      if (error || !data) {
        logError(LOG_SCOPE, error ?? new Error('Snowball pot lookup returned no row'));
        return;
      }
      if (shouldApplyPolledPot({
        polledPotId: data.id,
        activePotId,
        pollStartedAt: readStartedAt,
        lastRealtimeAt: potRealtimeAtRef.current,
      })) {
        setLatestPot(data);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, activePotId]);

  // Polling fallback: re-reads session + game state every 3 seconds. The runner
  // gives every poll an 8 second deadline (a hung request used to stop polling
  // for good) and a sequence number, so a response that a Realtime event or a
  // newer poll has overtaken is discarded rather than applied.
  useEffect(() => {
    let cancelled = false;
    const runner = createPollRunner<PublicSnapshot>({
      run: (signal) => fetchPublicSnapshot(supabase, session.id, currentActiveGameRef.current, signal),
    });
    pollRunnerRef.current = runner;

    const applySnapshot = (snapshot: PublicSnapshot) => {
      // An older session row than the one on screen is dropped, and so is the
      // game switch read from it: both would move the screen backwards.
      const sessionIsFresh = isFreshSession(sessionVersionRef.current, snapshot.session);
      if (sessionIsFresh) applySession(snapshot.session);

      const incoming = snapshot.state;
      if (snapshot.gameChanged) {
        if (!sessionIsFresh) return;
        // Supersede any slower switch started by a Realtime session event, then
        // change game and state in the same render.
        refreshSeqRef.current += 1;
        setCurrentActiveGame(snapshot.game);
        setCurrentGameState((current) =>
          incoming && current && current.game_id === incoming.game_id && !isFreshGameState(current, incoming)
            ? current
            : incoming
        );
      } else if (incoming) {
        // Freshness-gated apply: discard a stale snapshot that lost a race with
        // a more recent realtime event or earlier poll response.
        setCurrentGameState((current) => (isFreshGameState(current, incoming) ? incoming : current));
      }

      if (snapshot.pot && snapshot.potPollStartedAt !== null && shouldApplyPolledPot({
        polledPotId: snapshot.pot.id,
        activePotId: snapshot.game?.snowball_pot_id,
        pollStartedAt: snapshot.potPollStartedAt,
        lastRealtimeAt: potRealtimeAtRef.current,
      })) {
        setLatestPot(snapshot.pot);
      }
    };

    const poll = async () => {
      if (cancelled) return;
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      const started = runner.start();
      if (!started) return;

      try {
        const snapshot = await started.promise;
        if (cancelled || !runner.isCurrent(started.seq)) return;
        applySnapshot(snapshot);
        setConnectionPhase('ready');
        setHasBeenReady(true);
        markPollSuccess();
      } catch (err) {
        if (cancelled || !runner.isCurrent(started.seq)) return;
        logError(LOG_SCOPE, err);
        setConnectionPhase('failed');
        markPollFailure();
      }
    };

    void poll();
    const interval = setInterval(() => { void poll(); }, POLL_INTERVAL_MS);

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void poll();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      cancelled = true;
      if (pollRunnerRef.current === runner) pollRunnerRef.current = null;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [supabase, session.id, markPollSuccess, markPollFailure, applySession]);

  const serverNumbers = useMemo<number[]>(
    () => readCalledNumbers(currentGameState),
    [currentGameState]
  );

  // Reveal pacing, identical to the pub TV. planReveal is the single decision
  // point: it never skips a ball, never shows the newest one early, and snaps
  // to the server during a claim check or at game end. One timer at a time,
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
      // Nothing to show: delayedNumbers is empty without a game state, so only
      // the refs need resetting. The next game is adopted afresh below.
      revealGameIdRef.current = null;
      revealedCountRef.current = 0;
      lastRevealAtRef.current = null;
      newestSeenRef.current = null;
      return;
    }

    if (revealGameIdRef.current !== currentGameState.game_id) {
      revealGameIdRef.current = currentGameState.game_id;
      revealedCountRef.current = adoptRevealCount(serverNumbers.length);
      lastRevealAtRef.current = null;
    }
    const revealGameId = currentGameState.game_id;

    const serverCount = serverNumbers.length;
    // The first moment this device saw the current newest ball. A call time
    // that looks like the future is measured from here instead (reveal-queue).
    let newestSeen = newestSeenRef.current;
    if (!newestSeen || newestSeen.gameId !== currentGameState.game_id || newestSeen.count !== serverCount) {
      newestSeen = { gameId: currentGameState.game_id, count: serverCount, atMs: performance.now() };
      newestSeenRef.current = newestSeen;
    }
    const newestSeenAtMs = newestSeen.atMs;

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
        // last_call_at is a server timestamp, so compare it with the device
        // clock corrected by the measured offset. The dwell uses the
        // monotonic clock, which nothing can move.
        nowMs: Date.now() + clockOffsetMs,
        monotonicNowMs: performance.now(),
        newestSeenAtMs,
      });

      if (plan.revealCount !== revealedCountRef.current) {
        revealedCountRef.current = plan.revealCount;
        lastRevealAtRef.current = performance.now();
      }
      // Publish the count for this game. Returning the same object when nothing
      // changed lets React skip the render.
      const count = revealedCountRef.current;
      setReveal((current) =>
        current.gameId === revealGameId && current.count === count ? current : { gameId: revealGameId, count }
      );

      revealTimerRef.current =
        plan.nextTickInMs === null ? null : setTimeout(step, plan.nextTickInMs);
    };

    // Scheduled rather than called inline, so no state is set synchronously in
    // the effect body. Effects already run after paint, so this adds nothing
    // a viewer could see.
    revealTimerRef.current = setTimeout(step, 0);

    return clearRevealTimer;
  }, [currentActiveGame, currentGameState, serverNumbers, clockOffsetMs]);

  // A game the reveal effect has not caught up with yet (a switch, or the first
  // snapshot after no game) shows the adopted count straight away rather than
  // the previous game's count, which could briefly show the newest ball early.
  const revealCount =
    currentGameState && reveal.gameId === currentGameState.game_id
      ? reveal.count
      : adoptRevealCount(serverNumbers.length);
  const delayedNumbers = useMemo<number[]>(
    () => serverNumbers.slice(0, revealCount),
    [serverNumbers, revealCount]
  );
  // The revealed count is what every public counter must use. Reading
  // numbers_called_count would tick a counter down up to 3 seconds before the
  // ball itself appears, spoiling the call and disagreeing with the ball strip.
  const revealedCallCount = delayedNumbers.length;
  // Only the active game's pot is ever shown (X12c).
  const currentSnowballPot =
    latestPot && activePotId && latestPot.id === activePotId ? latestPot : null;
  const currentNumberDelayed = revealedCallCount > 0 ? delayedNumbers[revealedCallCount - 1] : null;

  // --- UI States ---
  /**
   * The part of the night (src/lib/night-phase.ts), from the session and the
   * active game's state, exactly as on the pub TV. A finished game is not a
   * game in play: between games the phone says what is coming next.
   */
  const activeStateForPhase =
    currentActiveGame && currentGameState && currentGameState.game_id === currentActiveGame.id
      ? currentGameState
      : null;
  const nightPhase = getNightPhase({ session: currentSession, activeGameState: activeStateForPhase });
  const inGameSubState =
    nightPhase === 'in_game' && currentGameState ? getInGameSubState(currentGameState) : null;
  const isNightOver = nightPhase === 'night_over';
  const hasRenderableGame = nightPhase === 'in_game';

  /**
   * The full-screen "Reconnecting" card needs the same 10 second unhealthy
   * window as the ConnectionBanner, exactly as on the pub TV (X12a). One failed
   * poll used to switch a waiting phone straight to it. shouldShowBanner is a
   * boolean read inline, never the health object in a dependency array.
   */
  const hasFailedLongEnough = connectionPhase === 'failed' && health.shouldShowBanner;

  /**
   * Screen precedence, in order and for a reason:
   *  - the end of the night is terminal, so the thank-you card always wins;
   *  - a game in play beats 'failed', because a single query blip must never
   *    rip a live game off the screen. The ConnectionBanner covers that case;
   *  - 'failed' (after the grace period) beats the pre-game and between-games
   *    screens, so an outage is never dressed up as "the host has not started
   *    yet". It recovers on the next good read;
   *  - inside the grace period a phone that has never had a good read shows
   *    "Connecting", and one that has keeps showing what it had.
   */
  const loadPhase: LoadPhase =
    isNightOver || hasRenderableGame
      ? 'ready'
      : hasFailedLongEnough
        ? 'failed'
        : connectionPhase === 'loading' || (connectionPhase === 'failed' && !hasBeenReady)
          ? 'loading'
          : 'ready';

  // New releases: reload by itself, but only with no game in progress or on a
  // break. Never while numbers are being called, a claim check or a win.
  useBuildCheck({ mode: 'auto', safe: isPublicReloadSafe(currentGameState) });

  // The rest of the night: game numbers, the next game and the rules' pot.
  const overview = useSessionOverview({
    supabase,
    sessionId: session.id,
    refreshKey: `${currentSession.state_version ?? ''}:${currentSession.active_game_id ?? ''}:${currentSession.status}`,
    logScope: LOG_SCOPE,
  });

  // Rule 8 uses the live pot during a snowball game, else the night's first snowball pot.
  const houseRules = getHouseRules(currentSnowballPot ?? overview?.rulesPot ?? null);

  const activePosition = overview ? getGamePosition(overview.games, currentActiveGame?.id) : null;
  const activeIdentity = currentActiveGame
    ? formatGameIdentity({
        number: activePosition?.number ?? currentActiveGame.game_index,
        total: activePosition?.total ?? null,
        colourHex: currentActiveGame.background_colour,
      })
    : '';
  const nextGame = overview ? pickNextGame(overview.games, overview.statusByGameId) : null;
  const nextPosition = nextGame && overview ? getGamePosition(overview.games, nextGame.id) : null;
  const nextIdentity = nextGame
    ? formatGameIdentity({
        number: nextPosition?.number ?? nextGame.game_index,
        total: nextPosition?.total ?? null,
        colourHex: nextGame.background_colour,
      })
    : '';

  const currentStageName =
    currentActiveGame && currentGameState
      ? currentActiveGame.stage_sequence[currentGameState.current_stage_index] ?? null
      : null;
  // The live claim (spec 5.2), as on the TV.
  const claimPanel =
    hasRenderableGame && currentGameState
      ? getClaimPanelState({
          paused: currentGameState.paused_for_validation,
          claimNumbers: Array.isArray(currentGameState.claim_numbers) ? currentGameState.claim_numbers : null,
          claimResult: currentGameState.claim_result ?? null,
          calledNumbers: serverNumbers,
          stageName: currentStageName,
          requiredCount: currentStageName ? getRequiredSelectionCountForStage(currentStageName) : null,
        })
      : null;

  const isOnBreak = inGameSubState === 'break';
  const isValidating = inGameSubState === 'claim_check';
  const isWin = inGameSubState === 'win';

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
  // gate this can always be left, because the poll above resolves the phase on
  // its first response.
  if (loadPhase === 'loading') {
    return (
      <div className="flex h-screen items-center justify-center text-white" style={{ backgroundColor: '#005131' }}>
        <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-current mr-3" />
        Connecting to game…
      </div>
    );
  }

  // Recoverable outage. Polling continues, and the next good read moves the
  // screen straight on with no reload.
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
      {/* Header. The Rules button is here in every part of the night, during
          play included (spec 5.3). Solid, not see-through: it stays put while
          the events list scrolls under it, and the list's text showed through
          an 80 percent tint. */}
      <div className="bg-[#003f27] p-4 border-b border-[#1f7c58] flex items-center justify-between gap-3 sticky top-0 z-20 shadow-md">
        <div className="min-w-0">
          <h1 className="font-bold text-lg leading-tight text-white">{currentSession.name}</h1>
          {hasRenderableGame && currentActiveGame && (
            <p className="text-base text-white">
              {[activeIdentity, currentActiveGame.name].filter(Boolean).join(' · ')}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="min-h-[44px] px-3 text-base"
            onClick={() => setShowRules(true)}
          >
            Rules
          </Button>
          {hasRenderableGame && currentGameState && (
            <div className="bg-[#005131] px-3 py-1 rounded border border-[#1f7c58]">
              <span className="text-sm text-white uppercase block">Calls</span>
              <span className="font-mono font-bold text-xl leading-none">{revealedCallCount}</span>
            </div>
          )}
        </div>
      </div>

      {/* Solid, not a tint. This used to be bg-[#a57626]/20 painted straight over
          the game colour, which on the pale yellows and peaches the pub uses to
          match its paper books left white text on near-white at about 1.4:1.
          The hint was invisible, so phones slept mid-game. */}
      {!isWakeLockActive && (
        <div className="bg-[#003f27] border-b border-[#a57626]/60 px-4 py-2 text-center text-base font-semibold uppercase tracking-wide text-white">
          Tap once to keep this screen awake
        </div>
      )}

      {/* Main Status Content */}
      <div className="p-4 space-y-4">

        {/* Status Banners */}
        {isNightOver && (
          <Card className="bg-[#003f27]/80 border-[#1f7c58]">
            <CardContent className="p-6 text-center">
              <div className="text-4xl mb-2">🙏</div>
              <h2 className="text-xl font-bold text-white">Thanks for coming!</h2>
              <p className="text-white">Please book for our next bingo event at the bar.</p>
            </CardContent>
          </Card>
        )}

        {/* The end of the night (spec 5.5, 5.6): the review button when it is
            switched on, then what is coming up, next bingo night first. */}
        {isNightOver && (
          <>
            <PhoneReviewButton />
            <PhoneEvents projection={initialEvents} sessionDate={currentSession.start_date ?? null} phase="night_over" />
          </>
        )}

        {nightPhase === 'before_start' && (
          <>
            <Card className="bg-[#003f27]/80 border-[#1f7c58]">
              <CardContent className="p-6 text-center">
                <div className="text-4xl mb-2">⏳</div>
                <h2 className="text-xl font-bold text-white">Waiting for Host</h2>
                <p className="text-white">Game will start soon...</p>
              </CardContent>
            </Card>
            {/* The rules inline before the first game (spec 5.3). */}
            <Card className="bg-[#003f27] border-[#1f7c58]">
              <CardContent className="p-5">
                <h2 className="text-xl font-bold text-white mb-3">House rules</h2>
                <PhoneRules rules={houseRules} />
              </CardContent>
            </Card>
            {/* What else is on (spec 5.5), next bingo night first. */}
            <PhoneEvents projection={initialEvents} sessionDate={currentSession.start_date ?? null} phase="before_start" />
          </>
        )}

        {/* Between games (spec 5.1): the same words as the TV. */}
        {nightPhase === 'between_games' && (
          <Card className="bg-[#003f27] border-[#1f7c58]">
            <CardContent className="p-6 text-center">
              <h2 className="text-xl font-bold text-white">Next game coming up</h2>
              {nextGame && (
                <>
                  <p className="mt-2 text-xl font-bold text-white">{nextGame.name}</p>
                  {nextIdentity && (
                    <p className="mt-1 flex items-center justify-center gap-2 text-base font-semibold text-[#f3d59d]">
                      <span
                        aria-hidden
                        className="inline-block h-4 w-4 shrink-0 rounded-full border-2 border-white"
                        style={{ backgroundColor: nextGame.background_colour }}
                      />
                      {nextIdentity}
                    </p>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        )}

        {isOnBreak && (
          <>
            {/* The solid card background, not a 20 percent tint over the game
                colour, which left white text at about 1.4:1 on a pale book colour. */}
            <Card className="bg-[#003f27] border-yellow-600">
              <CardContent className="p-6 text-center">
                <div className="text-4xl mb-2 animate-bounce">☕️</div>
                <h2 className="text-2xl font-bold text-white">On Break</h2>
                <p className="text-white">We will resume shortly</p>
              </CardContent>
            </Card>
            {/* What else is on, under the break card and next bingo night
                first: the same list as the TV's break loop, with the in-game
                links. Nothing shows when there are no events. */}
            <PhoneEvents
              projection={initialEvents}
              sessionDate={currentSession.start_date ?? null}
              phase="in_game"
              inGameSubState="break"
            />
          </>
        )}

        {/* The live claim (spec 5.2), replacing the old "Checking Claim" card. */}
        {isValidating && claimPanel && (
          <Card className="bg-[#003f27] border-[#a57626]">
            <CardContent className="p-5">
              <ClaimPanel state={claimPanel} variant="phone" />
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
              {/* The claimed balls stay on screen under the win. */}
              {claimPanel && claimPanel.balls.length > 0 && (
                <div className="mt-4">
                  <ClaimBalls balls={claimPanel.balls} variant="phone" />
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Active Game Display */}
        {hasRenderableGame && !isOnBreak && (
          <>
            {/* Info Cards */}
            <div className="grid grid-cols-2 gap-3">
              <div className={cn("bg-[#003f27]/80 p-3 rounded-lg border border-[#1f7c58]", !currentPrizeText && "col-span-2")}>
                <span className="text-sm text-white uppercase block">Playing For</span>
                <span className="font-bold text-white text-xl leading-tight">
                  {currentStageName}
                </span>
              </div>
              {/* Hidden when empty: "Prize not set" is for the host screen
                  only (X12e). */}
              {currentPrizeText && (
                <div className="bg-[#003f27]/80 p-3 rounded-lg border border-[#1f7c58]">
                  <span className="text-sm text-white uppercase block">Prize</span>
                  <span className="font-bold text-xl leading-tight text-white">
                    {currentPrizeText}
                  </span>
                </div>
              )}
            </div>

            {/* Solid, not a 25 percent tint. Over a pale game colour the old
                tint left the jackpot figure and the calls-left countdown as
                white on near-white. This is the most valuable number on the
                screen, so it gets a background of its own. */}
            {isSnowballGame && (
              <div className="bg-[#7a5719] p-3 rounded-lg border border-[#f3d59d]/70 shadow-lg shadow-black/25">
                {currentSnowballPot && currentGameState && snowballWindowStatus ? (
                  <>
                    <div className="flex justify-between items-center gap-4">
                      <div>
                        <span className="text-white text-sm font-bold uppercase block">Snowball Jackpot</span>
                        <span className="text-2xl font-bold text-white">£{formatPounds(Number(currentSnowballPot.current_jackpot_amount))}</span>
                      </div>
                      <div className="text-right shrink-0">
                        {snowballWindowStatus === 'open' ? (
                          <>
                            <span className="block text-6xl font-black leading-none text-white tabular-nums">
                              {snowballCallsRemaining}
                            </span>
                            <span className="block text-sm font-bold uppercase tracking-wider text-white/90 mt-1">
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
                    <p className="text-base text-white/90 mt-2">
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
                // Filled rather than transparent: the dashed outline used to let
                // the game colour through behind white text.
                <div className="w-48 h-48 rounded-full border-4 border-[#1f7c58] border-dashed bg-[#003f27]/90 flex items-center justify-center">
                  <span className="text-white font-bold">READY</span>
                </div>
              )}
            </div>

            {/* Recent History. Five balls, 40 percent larger than before, and
                allowed to slide sideways rather than shrink: BingoBall carries
                shrink-0 so the balls stay circular at 320px and at 200 percent
                text zoom. */}
            {/* Everything here used to sit on the raw game colour. "View All
                Numbers" is the only route to the full 1 to 90 board, which is
                the one thing a punter with a paper book actually wants, and on
                a pale game colour it was white on near-white and effectively
                unreachable. The dark panel makes the contrast a property of the
                component rather than of whichever colour the admin picked. */}
            <div className="rounded-xl border border-[#1f7c58] bg-[#003f27]/90 p-3">
              <div className="flex justify-between items-end mb-2">
                <span className="text-base text-white font-medium">Recent Calls</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-white h-auto min-h-[44px] px-3 text-base underline decoration-[#f3d59d] underline-offset-4 hover:bg-white/10"
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
                {delayedNumbers.length === 0 && <p className="text-white italic text-base">No numbers called yet</p>}
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
                    "aspect-square flex items-center justify-center text-base font-bold rounded",
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

      {/* House rules, available all night (spec 5.3). */}
      <Modal isOpen={showRules} onClose={() => setShowRules(false)} title="House rules">
        <PhoneRules rules={houseRules} />
        <div className="mt-4">
          <Button variant="secondary" className="w-full min-h-[44px] text-base" onClick={() => setShowRules(false)}>
            Close
          </Button>
        </div>
      </Modal>

    </div>
  );
}
