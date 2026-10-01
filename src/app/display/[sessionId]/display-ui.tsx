"use client";

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Database } from '@/types/database';
import { createClient } from '@/utils/supabase/client';
import { cn } from '@/lib/utils';
import Image from 'next/image';
import {
  formatPounds,
  getSnowballCallsLabel,
  getSnowballCallsRemaining,
  getSnowballWindowStatus,
} from '@/lib/snowball';
import {
  formatGameIdentity,
  getGamePosition,
  getHouseRules,
} from '@/lib/house-rules';
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
import { buildPlaylist, type EventsProjection, type Slide } from '@/lib/playlist';
import { buildFollowUrl } from '@/lib/follow-link';
import { shouldApplyPolledPot } from '@/lib/snowball-pot-poll';
import { planReveal } from '@/lib/reveal-queue';
import { DEFAULT_PUBLIC_CALL_DELAY_SECONDS, PUBLIC_MIN_DWELL_MS } from '@/lib/call-timing';
import { createPollRunner, type PollRunner } from '@/lib/poll-runner';
import { KITCHEN_OPEN_UNTIL, isReviewInviteEnabled } from '@/lib/venue-links';
import { useConnectionHealth } from '@/hooks/use-connection-health';
import { useRealtimeChannel } from '@/hooks/use-realtime-channel';
import { useClockOffset } from '@/hooks/use-clock-offset';
import { useBuildCheck } from '@/hooks/use-build-check';
import { useWakeLock } from '@/hooks/wake-lock';
import { ConnectionBanner } from '@/components/connection-banner';
import { ClaimBalls, ClaimPanel } from '@/components/display/claim-panel';
import { FollowAlongSlide, FollowQrBadge } from '@/components/display/follow-qr';
import { RulesSlide } from '@/components/display/rules-slide';
import { SlideLoop } from '@/components/display/slide-loop';
import { PromoSlide, SlidePreload } from '@/components/display/promo-slide';
import { useEventsProjection } from '@/components/display/use-events-projection';
import { useMinuteClock, useWindowOrigin } from '@/components/display/screen-hooks';
import { useSessionOverview } from '@/components/display/use-session-overview';
import { useDisplayLifecycle } from '@/components/display/use-display-lifecycle';
import { tvText } from '@/components/display/tv-text';
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

interface DisplayUIProps {
  session: Session;
  activeGame: Game | null;
  initialGameState: GameState | null;
  initialPrizeText: string;
  initialLoadStatus: InitialLoadStatus;
  /** The public origin for the follow-along QR (getSiteOrigin); null falls back to this page's own origin. */
  followOrigin: string | null;
  /** Whether /play would pick this session by itself, per the server's first read. */
  initialIsUniqueSession: boolean;
  /** `?rehearsal=1`: test sessions count, and the TV returns to the rehearsal lobby. */
  rehearsal: boolean;
  /** The upcoming events as the server page read them (getEventsProjection); refreshed here. */
  initialEvents: EventsProjection | null;
}

/**
 * Whether the screen can show the night yet. 'ready' screens are then chosen by
 * the part of the night (getNightPhase in src/lib/night-phase.ts).
 *
 * This replaces the old "have we loaded yet" boolean, which was initialised to
 * `initialGameState != null` and could therefore never turn true before the host
 * started a game: there is no `game_states_public` row yet, so the pub TV sat on
 * "Connecting to game..." for the whole pre-game period instead of showing the
 * waiting screen with the House Rules.
 */
type LoadPhase = 'loading' | 'ready' | 'failed';

/**
 * The only part of the screen choice that is real client state. The part of
 * the night is a function of the session and of the game state we hold, so
 * storing it separately would duplicate state and let the screen disagree with
 * itself, which is exactly how the old boolean stranded the TV on a spinner.
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

const POLL_INTERVAL_MS = 3000;
const LOG_SCOPE = 'display';

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

export default function DisplayUI({
  session,
  activeGame: initialActiveGame,
  initialGameState: initialActiveGameState,
  initialPrizeText,
  initialLoadStatus,
  followOrigin,
  initialIsUniqueSession,
  rehearsal,
  initialEvents,
}: DisplayUIProps) {
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
  // The server page's read counts as the first good read whenever it did not
  // fail, with or without a game state. Before the first game there is no
  // game state at all, and waiting for the first poll instead left the TV on
  // "Connecting to game…" until it answered, for good if the page was hidden
  // or Realtime was down.
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

  // A TV is left on all night: keep the screen awake.
  useWakeLock();

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
  // non-critical and a wobble here must never put a "Reconnecting" banner on
  // the pub TV. Only the game-state channel reports into connection health.
  useRealtimeChannel({
    supabase,
    key: `session_updates:${session.id}`,
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
    key: `game_state_public_updates:${currentActiveGameId ?? 'none'}`,
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

  // Force-reconnect the game-state channel when the screen comes back into
  // view. TV browsers and phones kill background WebSockets silently, and the
  // poll below already re-fires on the same event.
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
  // on the TV. It used to be opened outside any reconnect logic and could leak
  // (X12c); it now shares the guarded connector and checks the pot id.
  useRealtimeChannel({
    supabase,
    key: `pot_updates:${activePotId ?? 'none'}`,
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

  /**
   * The part of the night (src/lib/night-phase.ts), from the session and the
   * active game's state. A state row that is 'not_started' or 'completed'
   * does not count as a game in play, so the TV falls through to the
   * between-games screen rather than being left blank.
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
   * The full-screen "Reconnecting" page needs the same 10 second unhealthy
   * window as the ConnectionBanner (X12a). One failed poll used to switch a
   * pre-game TV straight to it; now the last good screen stays up, and the page
   * only appears once the connection has been failing for as long as the
   * banner would wait. shouldShowBanner is a boolean read inline, never the
   * health object in a dependency array.
   */
  const hasFailedLongEnough = connectionPhase === 'failed' && health.shouldShowBanner;

  /**
   * Screen precedence, in order and for a reason:
   *  - the end of the night is terminal, so the thank-you screen always wins;
   *  - a game in play beats 'failed', because a single query blip must never
   *    rip a live game off the TV. The ConnectionBanner covers that case;
   *  - 'failed' (after the grace period) beats the pre-game and between-games
   *    screens, so an outage is never dressed up as "the host has not started
   *    yet". It recovers on the next good read;
   *  - inside the grace period a screen that has never had a good read shows
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

  // New releases: reload by itself, but never over a claim check or a win.
  useBuildCheck({
    mode: 'auto',
    safe:
      !currentGameState ||
      currentGameState.status !== 'in_progress' ||
      (!currentGameState.paused_for_validation && !currentGameState.display_win_type),
  });

  // The rest of the night: game numbers, the next game and the rules' pot.
  // Re-read whenever the session row moves on (a game starts or finishes).
  const overview = useSessionOverview({
    supabase,
    sessionId: session.id,
    refreshKey: `${currentSession.state_version ?? ''}:${currentSession.active_game_id ?? ''}:${currentSession.status}`,
    logScope: LOG_SCOPE,
  });

  // Keeps the QR payload right, and moves the TV on after the night (A3).
  const { isUniqueSession } = useDisplayLifecycle({
    supabase,
    sessionId: session.id,
    rehearsal,
    nightPhase: loadPhase === 'ready' ? nightPhase : null,
    completedAt: currentSession.completed_at ?? null,
    clockOffsetMs,
    initialIsUniqueSession,
    logScope: LOG_SCOPE,
  });

  const windowOrigin = useWindowOrigin();
  const qrOrigin = followOrigin ?? windowOrigin;
  const followUrl = qrOrigin ? buildFollowUrl({ origin: qrOrigin, sessionId: session.id, isUniqueSession }) : '';

  // Upcoming events (spec 5.5): the server's first read, then every 10
  // minutes and on each change of phase. Never shown as an error.
  const events = useEventsProjection(initialEvents, { refreshKey: nightPhase, logScope: LOG_SCOPE });

  // The TV's clock, corrected like the reveal delay, to the minute: enough to
  // drop events as they start and to say "Tonight". 0 before the browser runs.
  const minuteMs = useMinuteClock();
  const slideNowMs = minuteMs > 0 ? minuteMs + clockOffsetMs : 0;
  const sessionDate = currentSession.start_date ?? null;
  const reviewEnabled = isReviewInviteEnabled();
  const playlist = useMemo(
    () => buildPlaylist(nightPhase, events, new Date(slideNowMs), sessionDate, { inGameSubState, reviewEnabled }),
    [nightPhase, events, slideNowMs, sessionDate, inGameSubState, reviewEnabled]
  );

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
  // The live claim (spec 5.2), from the public claim fields checked against
  // the public called numbers. Pausing snaps the reveal to the server, so the
  // full called list is what the room has seen.
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

  const showActiveGame = inGameSubState === 'calling';
  const showPausedForValidation = inGameSubState === 'claim_check';
  const showWinState = inGameSubState === 'win';
  // The footer carries the stage, prize and recent calls, so it shows while a
  // game is being called, checked or won. Everywhere else it is hidden and the
  // slides get its height.
  const showFooter = hasRenderableGame && inGameSubState !== 'break';
  // The corner QR has a column of its own, so it can never cover the ball or a
  // slide at 1280x720. It stays in place under the claim and win overlays, so
  // the ball does not jump sideways when a claim starts. None at night_over.
  const showCornerQr = !!followUrl && (hasRenderableGame || nightPhase === 'between_games');

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

  const displayBackgroundColor = currentActiveGame?.background_colour || '#005131';
  const dimTextColor = 'text-white';
  // Key information (stage, prize, snowball), one line each: three lines of
  // tv-base fill the 10rem footer at 1080p, so a long prize ends in "..."
  // rather than spilling out of the footer.
  const footerLeftTextClass = tvText('base', 'truncate font-semibold text-white');
  // The break and between-games screens share one centred column (the end
  // of the night is a slide loop of its own). Sizes are the text-tv-* tokens
  // (tailwind.config.ts). Headlines sit on a backing panel, never straight on
  // the game colour, which can be a pale yellow or peach.
  const serviceColumnClass = "mx-auto flex h-full w-full max-w-5xl flex-col justify-center gap-4 2xl:gap-6 text-center";
  const serviceCardPadClass = "p-4 2xl:p-5";
  const serviceHeadlinePanelClass = "rounded-3xl border border-[#1f7c58] bg-[#003f27]/85 backdrop-blur-md";
  const serviceEyebrowClass = tvText('xs', 'uppercase tracking-[0.2em] text-white/85 font-semibold');
  const serviceHeadlineClass = tvText('xl', 'font-black uppercase tracking-[0.07em] text-white mt-1');
  const serviceSubheadClass = tvText('sm', 'text-white/90 mt-2');
  const servicePromoTitleClass = tvText('lg', 'font-black uppercase tracking-[0.08em] text-white');
  const servicePromoBodyClass = tvText('sm', 'text-white mt-2 font-medium');
  const serviceCardTitleClass = tvText('base', 'font-bold text-white');
  const serviceCardBodyClass = tvText('sm', 'text-white/90 mt-1');
  const stagePrizePreview = currentActiveGame
    ? currentActiveGame.stage_sequence.map((stage, index) => {
        const prize = currentActiveGame.prizes?.[stage as keyof typeof currentActiveGame.prizes];
        return {
          index,
          stageLabel: formatStageLabel(stage),
          prizeLabel: prize || '',
        };
      })
    : [];
  const showPreCallStagePreview = !!(
    showActiveGame &&
    currentGameState &&
    revealedCallCount === 0 &&
    stagePrizePreview.length > 0
  );

  const renderKitchenCard = () => (
    <div className={cn("w-full bg-[#005131]/90 border border-[#a57626] rounded-3xl backdrop-blur-sm", serviceCardPadClass)}>
      <h2 className={servicePromoTitleClass}>Kitchen Open Until {KITCHEN_OPEN_UNTIL}</h2>
      <p className={servicePromoBodyClass}>Get your drinks and order food at the bar!</p>
    </div>
  );

  const renderBreakSlide = () => (
    <div className={serviceColumnClass}>
      <div className={cn(serviceHeadlinePanelClass, serviceCardPadClass)}>
        <p className={serviceEyebrowClass}>Anchor Bingo Night</p>
        <h1 className={serviceHeadlineClass}>Break Time</h1>
        <p className={serviceSubheadClass}>Please hold your tickets, we will resume shortly.</p>
      </div>
      {renderKitchenCard()}
      <div className={cn("bg-[#003f27]/85 border border-[#1f7c58] rounded-3xl backdrop-blur-md", serviceCardPadClass)}>
        <h3 className={serviceCardTitleClass}>We&apos;ll be back in a moment</h3>
        <p className={serviceCardBodyClass}>Keep your tickets handy for the next call.</p>
      </div>
    </div>
  );

  // Between games (spec 5.1): "Next game coming up", with the next game's
  // name and colour once the game list is in.
  const renderNextGameSlide = () => (
    <div className={serviceColumnClass}>
      <div className={cn(serviceHeadlinePanelClass, serviceCardPadClass)}>
        <p className={serviceEyebrowClass}>Anchor Bingo Night</p>
        <h1 className={serviceHeadlineClass}>Next game coming up</h1>
        {nextGame && (
          <div className="mt-[2vh] space-y-[1vh]">
            <p className={tvText('base', 'font-bold text-white')}>{nextGame.name}</p>
            {nextIdentity && (
              <p className={tvText('base', 'flex items-center justify-center gap-[0.4em] font-bold text-[#f3d59d]')}>
                <span
                  aria-hidden
                  className="inline-block shrink-0 rounded-full border-2 border-white"
                  style={{ backgroundColor: nextGame.background_colour, width: '0.8em', height: '0.8em' }}
                />
                {nextIdentity}
              </p>
            )}
          </div>
        )}
      </div>
      {renderKitchenCard()}
    </div>
  );

  const rulesStatusLabel =
    nightPhase === 'between_games' ? 'Next game coming up' : inGameSubState === 'break' ? 'Break time' : null;

  const renderSlideContent = (slide: Slide) => {
    switch (slide.kind) {
      case 'follow_along':
        return followUrl ? <FollowAlongSlide url={followUrl} /> : null;
      case 'rules':
        return <RulesSlide rules={houseRules} statusLabel={rulesStatusLabel} />;
      case 'break':
        return renderBreakSlide();
      case 'next_game':
        return renderNextGameSlide();
      default:
        // Events, next bingo, thanks, review: shared with the idle /display.
        return <PromoSlide slide={slide} nowMs={slideNowMs} />;
    }
  };

  const renderSlide = (slide: Slide) => (
    <>
      <SlidePreload slide={slide} nowMs={slideNowMs} />
      {renderSlideContent(slide)}
    </>
  );

  // First server answer not in yet. Deliberately brief: unlike the old boolean
  // gate this can always be left, because the poll below resolves the phase on
  // its first response.
  if (loadPhase === 'loading') {
    return (
      <div className={tvText('sm', 'flex h-screen items-center justify-center text-white')} style={{ backgroundColor: '#005131' }}>
        <span className="inline-block h-[0.4em] w-[0.4em] animate-pulse rounded-full bg-current mr-[0.6em]" />
        Connecting to game…
      </div>
    );
  }

  // Recoverable outage. Polling continues, and the next good read moves the
  // screen straight on with no reload.
  if (loadPhase === 'failed') {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex h-screen flex-col items-center justify-center gap-5 px-10 text-center text-white"
        style={{ backgroundColor: '#005131' }}
      >
        <p className={tvText('xs', 'uppercase tracking-[0.2em] font-semibold text-white/85')}>
          Anchor Bingo Night
        </p>
        <h1 className={tvText('2xl', 'font-black uppercase tracking-[0.07em]')}>
          Reconnecting To The Game
        </h1>
        <p className={tvText('sm', 'text-white/90')}>
          Hold on to your tickets, the screen will catch up in a moment.
        </p>
        <span className="inline-block h-[1.5vh] w-[1.5vh] min-h-3 min-w-3 animate-pulse rounded-full bg-white" />
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
      <ConnectionBanner variant="tv" visible={health.shouldShowBanner} shouldAutoRefresh={health.shouldAutoRefresh} />
      {/* Top Bar */}
      <div className="h-24 shrink-0 px-8 flex items-center justify-between bg-[#005131] border-b border-[#1f7c58] z-10" data-check-overlap="top-bar">
         <div className="flex items-center gap-4 shrink-0">
             <div className="relative w-64 h-20">
                 <Image src="/the-anchor-pub-logo-white-transparent.png" alt="The Anchor" fill className="object-contain object-left" />
             </div>
         </div>
         {/* min-w-0 lets this column shrink inside the flex row, and truncate
             keeps a long session or game name to one line instead of pushing
             out of the 6rem bar (X12f). During play the second line leads with
             the game number and book colour (spec 5.3), at the key-information
             size; with leading-[1.1] on the name the two lines fit the 6rem
             bar at 1080p (41.6px + 51px). */}
         <div className="min-w-0 flex-1 pl-6 text-right">
             <h2 className={tvText('sm', 'truncate font-bold tracking-tight leading-[1.1]')}>{currentSession.name}</h2>
             {hasRenderableGame && currentActiveGame && (
               <p className={tvText('base', 'truncate font-medium uppercase tracking-wider', dimTextColor)}>
                 {[activeIdentity, currentActiveGame.name].filter(Boolean).join(' · ')}
               </p>
             )}
         </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 min-h-0 flex gap-6 relative p-6 overflow-hidden">

          {/* data-check-overlap marks the TV's main regions for the render
              check (scripts/check-render.js): none of them may overlap. The
              slide column is only marked while slides show, because the
              snowball badge sits over its corner (clear of the ball) during
              play. */}
          {showCornerQr && (
            <div className="flex shrink-0 items-end" data-check-overlap="qr">
              <FollowQrBadge url={followUrl} />
            </div>
          )}

          <div
            className="relative flex min-h-0 min-w-0 flex-1 items-center justify-center"
            data-check-overlap={playlist.length > 0 ? 'slides' : undefined}
          >
            {playlist.length > 0 && (
              <SlideLoop className="h-full w-full" slides={playlist} renderSlide={renderSlide} />
            )}

            {showActiveGame && (
              <div className="flex flex-col items-center justify-center h-full w-full">
                {currentNumberDelayed ? (
                  <div className="relative animate-in zoom-in duration-300" data-check-overlap="ball">
                     {/* Massive Main Number.
                        The 19rem subtracted below is the real vertical chrome:
                        h-24 top bar (6rem) + h-40 footer (10rem) + the main area's
                        p-6 top and bottom (3rem) = 19rem. It used to say 18rem,
                        which is exactly 1rem short, so at 1280x720 the calc asked
                        for 432px against 416px available and flat-topped the ball
                        by 8px top and bottom. Masked at 1080p only because the
                        68vh term binds first there. */}
                    <div
                      className="relative bg-[#005131] border-4 border-white rounded-full flex items-center justify-center overflow-hidden"
                      style={{
                        ['--display-ball-size' as string]: 'min(68vh, calc(100vw - 6rem), calc(100vh - 19rem))',
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
                    {/* Stages and prizes are key information, so they are
                        not pulsed: people need to read them. */}
                    {showPreCallStagePreview ? (
                      <div className="w-full max-w-6xl bg-[#005131]/92 border border-[#a57626] rounded-3xl p-8 text-white animate-in fade-in duration-500" data-check-overlap="stages">
                        <p className={tvText('xs', 'uppercase tracking-[0.2em] font-semibold text-[#f3d59d] text-center')}>
                          Game Stages & Prizes
                        </p>
                        <div className="mt-5 space-y-3">
                          {stagePrizePreview.map((item) => (
                            <div
                              key={`${item.stageLabel}-${item.index}`}
                              className="grid grid-cols-[1fr_auto] gap-4 items-center bg-[#003f27]/75 border border-[#1f7c58] rounded-2xl px-5 py-4"
                            >
                              <p className={tvText('base', 'font-bold tracking-wide')}>
                                Stage {item.index + 1}: {item.stageLabel}
                              </p>
                              {/* An empty prize is a setup gap for the host to
                                  fix, not something to put in front of guests
                                  (X12e): the host screen still flags it. */}
                              {item.prizeLabel && (
                                <p className={tvText('base', 'font-semibold text-[#f3d59d] text-right')}>
                                  {item.prizeLabel}
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      // On a backing panel at full strength: it used to be
                      // 40 percent white straight on the game colour.
                      <div className="rounded-3xl border border-[#1f7c58] bg-[#003f27]/85 px-[4vh] py-[2vh]" data-check-overlap="ready">
                        <h1 className={tvText('3xl', 'font-bold text-white')}>READY...</h1>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>

          {/* Snowball countdown badge. Top right so it can never collide with
              the corner QR, and static so it needs no prefers-reduced-motion
              opt-out. The z-70 claim overlay and the z-80 win overlay cover it
              as they cover everything else. */}
          {/* max-w-[20vw] keeps the badge clear of the ball at 1280x720 and
              1920x1080, so a long label such as "Last qualifying call" wraps
              instead of running across the ball. */}
          {isSnowballGame && (showActiveGame || showPausedForValidation) && currentSnowballPot && snowballWindowStatus && (
            <div className="absolute top-4 right-4 z-40 max-w-[20vw] rounded-3xl border border-[#a57626] bg-[#005131]/92 px-6 py-4 text-center backdrop-blur-sm" data-check-overlap="snowball">
              {snowballWindowStatus === 'open' ? (
                <>
                  <p
                    className={tvText('3xl', 'font-black leading-none text-[#f3d59d]')}
                    style={{ fontVariantNumeric: 'tabular-nums lining-nums' }}
                  >
                    {snowballCallsRemaining}
                  </p>
                  <p className={tvText('xs', 'mt-1 font-bold uppercase tracking-[0.16em] text-white')}>
                    Calls Left
                  </p>
                </>
              ) : (
                <p className={tvText('base', 'font-black uppercase leading-[1.05] text-[#f3d59d]')}>
                  {snowballCallsLabel}
                </p>
              )}
              <p className={tvText('base', 'mt-2 font-bold text-white')}>
                £{formatPounds(Number(currentSnowballPot.current_jackpot_amount))}
              </p>
            </div>
          )}

          {/* The live claim (spec 5.2): each number as the caller reads it,
              ticked or crossed, then the server's verdict. It replaced the old
              "Checking Claim" card. */}
          {showPausedForValidation && claimPanel && (
            <div className="absolute inset-0 z-[70] flex items-center justify-center overflow-hidden bg-[#003f27]/95 backdrop-blur-md p-[1.5vh]">
                <div className="w-full max-w-[1500px] rounded-3xl border border-[#a57626] bg-[#005131]/90 p-[2vh]" data-check-overlap="claim">
                    <ClaimPanel state={claimPanel} variant="tv" />
                </div>
            </div>
          )}

          {/* WIN OVERLAY. The claimed balls stay on screen under the win, so
              the room can see what won; the headline steps down a size when
              they are there, so a Full House still fits at 1280x720. */}
          {showWinState && currentGameState && (
            <div className="absolute inset-0 z-[80] flex flex-col items-center justify-center gap-[3vh] overflow-hidden bg-[#003f27]/95 backdrop-blur-md animate-in fade-in duration-300 p-[2vh] text-center">
              <h1
                className={tvText(
                    claimPanel && claimPanel.balls.length > 0 ? '3xl' : '4xl',
                    "leading-[0.9] font-black text-white"
                )}
              >
                  {currentGameState.display_win_text}
              </h1>
              {currentGameState.display_winner_name && (
                  <div className="w-full max-w-5xl bg-[#005131]/92 px-12 py-8 rounded-3xl border border-[#a57626] backdrop-blur-xl animate-in slide-in-from-bottom duration-500">
                      <p className={tvText('xs', 'text-[#f3d59d] uppercase tracking-[0.16em] mb-2 font-bold')}>Winner</p>
                      <h2 className={tvText('2xl', 'font-black text-white break-words')}>{currentGameState.display_winner_name}</h2>
                  </div>
              )}
              {claimPanel && <ClaimBalls balls={claimPanel.balls} variant="tv" />}
            </div>
          )}
      </div>

      {/* Footer Info Bar. h-40 rather than h-32 to clear the enlarged recent
          calls strip. Its 10rem is one of the three terms in the main ball's
          calc(100vh - 19rem) above (6rem top bar + 10rem footer + 3rem main
          padding). Change this height and you must re-do that subtraction. It
          only shows while a game is being called, checked or won. */}
      {showFooter && (
        <div className="h-40 shrink-0 bg-[#005131] border-t border-[#1f7c58] grid grid-cols-2 px-8 z-10" data-check-overlap="footer">
              <div className="flex min-w-0 flex-col justify-center border-r border-white/10 pr-8">
                  <p className={footerLeftTextClass}>
                    Playing for: {formatStageLabel(currentStageName ?? undefined)}
                  </p>
                  {/* Hidden when empty: "Prize not set" is for the host
                      screen only (X12e). */}
                  {currentPrizeText && (
                    <p className={footerLeftTextClass}>
                      Prize: {currentPrizeText}
                    </p>
                  )}
                  {isSnowballGame && (
                    <p className={footerLeftTextClass}>
                      {currentSnowballPot
                        ? `Snowball: £${formatPounds(Number(currentSnowballPot.current_jackpot_amount))}`
                        : 'Snowball: countdown unavailable (no linked snowball pot)'}
                    </p>
                  )}
              </div>

              <div className="flex flex-col justify-center pl-8 overflow-hidden">
                  {delayedNumbers.length > 0 && (
                      <>
                        <div className="flex justify-between items-end gap-4 mb-2">
                            <span className={tvText('xs', "uppercase tracking-widest font-bold", dimTextColor)}>Recent Calls</span>
                            <span className={tvText('xs', "uppercase tracking-widest font-bold", dimTextColor)}>Total Calls: {revealedCallCount}</span>
                        </div>
                        {/* The digits stay in px: they are sized to the
                            balls, which are fixed rem like the footer. 44px
                            in the small balls is the key-information floor. */}
                        <div className="flex items-center gap-3 overflow-hidden mask-linear-fade">
                            {delayedNumbers.slice().reverse().map((num, idx) => (
                                <div key={idx} className={cn(
                                    "flex items-center justify-center rounded-full bg-[#005131] border border-white/60 font-bold text-white shrink-0",
                                    idx === 0 ? "w-[5.6rem] h-[5.6rem] text-[50px] border-4 border-white" : "w-[4.2rem] h-[4.2rem] text-[44px] opacity-70"
                                )}>
                                    {num}
                                </div>
                            ))}
                        </div>
                      </>
                  )}
              </div>
          </div>
      )}
    </div>
  );
}
