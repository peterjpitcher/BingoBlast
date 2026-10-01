"use client";

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Coffee, RefreshCw } from 'lucide-react';
import { Database } from '@/types/database';
import { createClient } from '@/utils/supabase/client';
import { cn } from '@/lib/utils';
import { BingoBall, NumberChip } from '@/components/ui/bingo-ball';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Kicker } from '@/components/ui/kicker';
import { AnchorLogo } from '@/components/ui/logo';
import { Sheet } from '@/components/ui/sheet';
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
import { formatWinHeadline } from '@/lib/win-headline';
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
import { KITCHEN_OPEN_UNTIL } from '@/lib/venue-links';

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

  // The line under a win, "£10 · Line · call 22": the stage's prize, the stage
  // and the revealed count. Recording a winner pauses the game in the same
  // write, so the count shown is the call the win was made on. A part that is
  // not known is left out.
  const winSummary = [
    currentPrizeText,
    currentStageName,
    revealedCallCount > 0 ? `call ${revealedCallCount}` : null,
  ].filter(Boolean).join(' · ');

  // First server answer not in yet. Deliberately brief: unlike the old boolean
  // gate this can always be left, because the poll above resolves the phase on
  // its first response.
  if (loadPhase === 'loading') {
    return (
      <div className="flex min-h-screen-safe flex-col items-center justify-center gap-4 bg-anchor-green-deep px-4 text-center text-[15px] text-anchor-sage animate-fade-in">
        <AnchorLogo height={64} priority />
        Connecting to game…
      </div>
    );
  }

  // Recoverable outage. Polling continues, and the next good read moves the
  // screen straight on with no reload.
  if (loadPhase === 'failed') {
    return (
      <div className="flex min-h-screen-safe items-center justify-center bg-anchor-green-deep p-4 text-anchor-cream-text">
        <Card className="w-full max-w-md">
          <div className="flex flex-col items-center gap-2 px-5 py-6 text-center" role="status" aria-live="polite">
            <RefreshCw aria-hidden="true" size={36} strokeWidth={2} className="text-anchor-gold-bright" />
            <h2 className="text-[28px] leading-[1.05] text-anchor-cream-text">Reconnecting to the game</h2>
            <p className="text-[15px] leading-normal text-anchor-sage">
              Hold on to your tickets, this screen will catch up in a moment.
            </p>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen-safe bg-anchor-green-deep pb-10 text-anchor-cream-text">
      <ConnectionBanner visible={health.shouldShowBanner} shouldAutoRefresh={health.shouldAutoRefresh} />
      {/* Header. The Rules button is here in every part of the night, during
          play included (spec 5.3). Close to solid, not see-through: it stays
          put while the events list scrolls under it, and the list's text
          showed through an 80 percent tint. The top padding clears the
          phone's status bar. */}
      <header className="sticky top-0 z-20 border-b border-line-gold bg-anchor-green-deep/[0.96]">
        <div className="mx-auto flex w-full max-w-md items-center justify-between gap-3 px-4 pb-3 pt-[calc(env(safe-area-inset-top)+12px)]">
          <div className="flex min-w-0 flex-col gap-[3px]">
            <h1 className="truncate text-[22px] leading-[1.15] text-anchor-cream-text">{currentSession.name}</h1>
            {hasRenderableGame && currentActiveGame && (
              <>
                {/* The book colour is a dot here and a band below: text never
                    sits on it, whatever colour the admin picked. */}
                <p className="flex items-center gap-1.5 text-xs font-semibold uppercase leading-[1.3] tracking-[0.12em] text-anchor-gold-bright">
                  <span
                    aria-hidden="true"
                    className="inline-block h-3 w-3 shrink-0 rounded-full border border-anchor-cream-text"
                    style={{ backgroundColor: currentActiveGame.background_colour }}
                  />
                  <span className="truncate">{activeIdentity}</span>
                </p>
                <p className="truncate text-sm leading-[1.3] text-anchor-sage">{currentActiveGame.name}</p>
              </>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0 px-4"
            onClick={() => setShowRules(true)}
          >
            Rules
          </Button>
        </div>
      </header>

      {/* The book colour, as an 8px band under the header for the whole game,
          break included. */}
      {hasRenderableGame && currentActiveGame && (
        <div aria-hidden="true" className="h-2" style={{ backgroundColor: currentActiveGame.background_colour }} />
      )}

      {/* On the raised green in cream, so it reads on every phone. An earlier
          tint over the game colour left this hint invisible, and phones slept
          mid-game. */}
      {!isWakeLockActive && (
        <div className="border-b border-line bg-anchor-green-raised px-4 py-2 text-center text-sm font-semibold text-anchor-cream-text">
          Tap once to keep this screen awake
        </div>
      )}

      {/* Main Status Content */}
      <div className="mx-auto flex w-full max-w-md flex-col gap-3.5 p-4">

        {/* Status Banners */}
        {isNightOver && (
          <Card accent className="flex flex-col items-center gap-2 px-5 py-6 text-center">
            <Kicker>Anchor Bingo night</Kicker>
            <h2 className="text-[34px] leading-none text-anchor-cream-text">Thanks for coming!</h2>
            <p className="text-[15px] leading-normal">Book your table for the next bingo night at the bar before you leave.</p>
            <p className="mt-1.5 font-script text-[30px] text-anchor-gold-bright">Where everyone&apos;s welcome</p>
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
            <Card accent className="flex flex-col items-center gap-1.5 px-5 py-6 text-center">
              <Kicker>Eyes down shortly</Kicker>
              <h2 className="text-[30px] leading-[1.05] text-anchor-cream-text">Waiting for the caller</h2>
              <p className="text-[15px] leading-normal text-anchor-sage">Get your books in and your pens ready.</p>
            </Card>
            {/* The rules inline before the first game (spec 5.3). */}
            <Card className="flex flex-col gap-3 p-5">
              <h2 className="text-2xl leading-[1.1] text-anchor-cream-text">House rules</h2>
              <PhoneRules rules={houseRules} />
            </Card>
            {/* What else is on (spec 5.5), next bingo night first. */}
            <PhoneEvents projection={initialEvents} sessionDate={currentSession.start_date ?? null} phase="before_start" />
          </>
        )}

        {/* Between games (spec 5.1): the same words as the TV, then what else
            is on, as on a break and with the same in-game links. */}
        {nightPhase === 'between_games' && (
          <>
            <Card accent className="flex flex-col items-center gap-1.5 px-5 py-6 text-center">
              <Kicker>Anchor Bingo night</Kicker>
              <h2 className="text-[30px] leading-[1.05] text-anchor-cream-text">Next game coming up</h2>
              {nextGame && (
                <>
                  <p className="mt-1.5 font-display text-[22px] leading-[1.1] text-anchor-cream-text">{nextGame.name}</p>
                  {nextIdentity && (
                    <p className="flex items-center justify-center gap-1.5 text-xs font-semibold uppercase leading-[1.3] tracking-[0.12em] text-anchor-gold-bright">
                      <span
                        aria-hidden
                        className="inline-block h-3 w-3 shrink-0 rounded-full border border-anchor-cream-text"
                        style={{ backgroundColor: nextGame.background_colour }}
                      />
                      {nextIdentity}
                    </p>
                  )}
                </>
              )}
            </Card>
            <PhoneEvents
              projection={initialEvents}
              sessionDate={currentSession.start_date ?? null}
              phase="between_games"
            />
          </>
        )}

        {isOnBreak && (
          <>
            <Card accent className="flex flex-col items-center gap-1.5 px-5 py-6 text-center">
              <Coffee aria-hidden="true" size={36} strokeWidth={2} className="text-anchor-gold-bright" />
              <h2 className="text-[34px] leading-none text-anchor-cream-text">Break time</h2>
              <p className="text-[15px] leading-normal">Hold on to your tickets. We will be back shortly.</p>
              <p className="mt-1.5 font-script text-[30px] text-anchor-gold-bright">Kitchen open until {KITCHEN_OPEN_UNTIL}</p>
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

        {/* The live claim (spec 5.2), replacing the old "Checking Claim" card.
            The panel draws the headline, the balls and the count; the card
            and its label are drawn here. */}
        {isValidating && claimPanel && (
          <Card className="flex flex-col gap-3 border-line-strong px-4 py-5 text-center">
            <Kicker as="p">Hold your tickets</Kicker>
            <ClaimPanel state={claimPanel} variant="phone" />
          </Card>
        )}

        {/* The win is only ever shown once it is recorded. The headline comes
            from the database in capitals; formatWinHeadline recases it. */}
        {isWin && (
          <Card accent className="flex flex-col items-center gap-2.5 px-4 py-6 text-center shadow-gold animate-fade-up">
            <p className="font-script text-[30px] text-anchor-gold-bright">Well played</p>
            <h2 className="text-[40px] leading-[0.95] text-anchor-cream-text">
              {formatWinHeadline(currentGameState?.display_win_text)}
            </h2>
            {currentGameState?.display_winner_name && (
              <p className="text-[15px] leading-normal text-anchor-sage">{currentGameState.display_winner_name}</p>
            )}
            {/* The claimed balls stay on screen under the win. */}
            {claimPanel && claimPanel.balls.length > 0 && (
              <div className="mt-1.5">
                <ClaimBalls balls={claimPanel.balls} variant="phone" />
              </div>
            )}
            {winSummary && <p className="text-[15px] font-semibold text-anchor-gold-bright">{winSummary}</p>}
          </Card>
        )}

        {/* Active Game Display */}
        {hasRenderableGame && !isOnBreak && (
          <>
            <Card accent className="flex flex-col items-center gap-3.5 px-4 pb-4 pt-5">
              {/* Current Number. Keyed on the number, so each new call fades
                  in and settles once. */}
              {currentNumberDelayed ? (
                <BingoBall
                  key={currentNumberDelayed}
                  number={currentNumberDelayed}
                  size={200}
                  numberScale={0.55}
                  className="animate-ball-in shadow-gold inset-shadow-[0_-12px_28px_rgb(0_0_0/0.25)]"
                />
              ) : (
                <div className="flex h-[200px] w-[200px] shrink-0 items-center justify-center rounded-full border-2 border-dashed border-line-strong bg-anchor-green-raised">
                  <Kicker>Ready</Kicker>
                </div>
              )}

              {/* Calls, the stage and its prize, divided by gold rules. The
                  labels and the stage stay on one line; a long prize (it is
                  free text) wraps inside its own cell rather than push the
                  row off the card. */}
              <div className="flex w-full items-stretch justify-between gap-3.5 border-t border-line-gold pt-3.5 text-left">
                <div className="flex shrink-0 flex-col gap-1">
                  <Kicker className="whitespace-nowrap text-[11px]">Calls</Kicker>
                  <span className="text-2xl font-semibold leading-[1.1] tabular-nums">{revealedCallCount}</span>
                </div>
                <div aria-hidden="true" className="w-px shrink-0 bg-line-gold" />
                <div className="flex shrink-0 flex-col gap-1">
                  <Kicker className="whitespace-nowrap text-[11px]">Playing for</Kicker>
                  <span className="whitespace-nowrap text-2xl font-semibold leading-[1.1]">
                    {currentStageName}
                  </span>
                </div>
                {/* Hidden when empty: "Prize not set" is for the host screen
                    only (X12e). */}
                {currentPrizeText && (
                  <>
                    <div aria-hidden="true" className="w-px shrink-0 bg-line-gold" />
                    <div className="flex min-w-0 flex-col gap-1">
                      <Kicker className="whitespace-nowrap text-[11px]">Prize</Kicker>
                      <span className="break-words font-display text-[26px] leading-[1.1] text-anchor-gold-bright">
                        {currentPrizeText}
                      </span>
                    </div>
                  </>
                )}
              </div>
            </Card>

            {/* The most valuable number on the screen, so it has a card of
                its own. */}
            {isSnowballGame && (
              <Card className="px-4 py-3.5">
                {currentSnowballPot && currentGameState && snowballWindowStatus ? (
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <Kicker className="text-[11px]">Snowball jackpot</Kicker>
                      <span className="font-display text-[32px] leading-none text-anchor-gold-bright">£{formatPounds(Number(currentSnowballPot.current_jackpot_amount))}</span>
                      <span className="mt-1 text-[13px] leading-[1.3] text-anchor-sage">
                        Full House within {currentSnowballPot.current_max_calls} calls
                      </span>
                    </div>
                    <div className="flex shrink-0 flex-col items-end text-right">
                      {snowballWindowStatus === 'open' ? (
                        <>
                          <span className="text-[48px] font-bold leading-none tabular-nums">
                            {snowballCallsRemaining}
                          </span>
                          <Kicker className="text-[11px]">Calls left</Kicker>
                        </>
                      ) : (
                        <span className="max-w-[9rem] text-lg font-semibold leading-[1.2] text-anchor-gold-bright">
                          {snowballCallsLabel}
                        </span>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="text-[15px] font-semibold leading-normal">
                    Snowball countdown unavailable: this game is not linked to a snowball pot.
                  </p>
                )}
              </Card>
            )}

            {/* Every number called so far, newest first, wrapping into rows:
                the newest is top left and the card grows downwards. The chips
                wrap rather than shrink (NumberChip carries shrink-0), so they
                stay circular at 320px and at 200 percent text zoom. Keyed on
                the number, so only the new chip fades in. */}
            {/* "All 90 numbers" is the only route to the full 1 to 90 board,
                which is the one thing a punter with a paper book actually
                wants, so it keeps a 44px target and the gold of a link. */}
            <Card className="flex flex-col gap-2.5 px-4 py-3.5">
              <div className="flex items-center justify-between gap-3">
                <Kicker>Recent calls</Kicker>
                <Button
                  variant="ghost"
                  size="sm"
                  className="-mr-2.5 px-2.5 text-anchor-gold-bright"
                  onClick={() => setShowFullHistory(true)}
                >
                  All 90 numbers
                </Button>
              </div>
              {/* As many 56px columns as fit (five on most phones, four at
                  320px), spread to the card's edges so every row lines up. */}
              <div className="grid grid-cols-[repeat(auto-fill,56px)] justify-between gap-x-2 gap-y-2.5">
                {delayedNumbers.slice().reverse().map((num, i) => (
                  <NumberChip
                    key={num}
                    number={num}
                    size={56}
                    numberScale={0.39}
                    latest={i === 0}
                    className="animate-fade-in"
                  />
                ))}
                {delayedNumbers.length === 0 && <p className="col-span-full text-[15px] leading-normal text-anchor-sage">No numbers called yet</p>}
              </div>
            </Card>
          </>
        )}
      </div>

      {/* The full 1 to 90 board, as a bottom sheet. */}
      <Sheet
        isOpen={showFullHistory}
        onClose={() => setShowFullHistory(false)}
        title="Called numbers"
        description={`${revealedCallCount} of 90 called · newest ringed in gold`}
        bodyClassName="py-4"
        footer={
          <Button variant="outline" size="md" block onClick={() => setShowFullHistory(false)}>Close</Button>
        }
      >
        <div className="grid grid-cols-6 gap-1.5">
          {Array.from({ length: 90 }, (_, i) => i + 1).map(num => {
            const isCalled = delayedNumbers.includes(num);
            const isNewest = num === currentNumberDelayed;
            return (
              <div
                key={num}
                className={cn(
                  "flex aspect-square min-h-12 items-center justify-center rounded-card border text-xl font-semibold tabular-nums",
                  isNewest
                    ? "border-anchor-gold-bright bg-anchor-gold-bright font-bold text-anchor-charcoal"
                    : isCalled
                      ? "border-anchor-gold-bright bg-anchor-green-raised text-anchor-cream-text"
                      : "border-anchor-gold-bright/[0.12] bg-anchor-green-deep text-anchor-sage"
                )}
              >
                {num}
              </div>
            );
          })}
        </div>
      </Sheet>

      {/* House rules, available all night (spec 5.3). */}
      <Sheet
        isOpen={showRules}
        onClose={() => setShowRules(false)}
        title="House rules"
        bodyClassName="py-4"
        footer={
          <Button variant="outline" size="md" block onClick={() => setShowRules(false)}>
            Close
          </Button>
        }
      >
        <PhoneRules rules={houseRules} />
      </Sheet>

    </div>
  );
}
