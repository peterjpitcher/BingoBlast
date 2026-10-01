"use client";

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Database } from '@/types/database';
import { createClient } from '@/utils/supabase/client';
import { cn } from '@/lib/utils';
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
import { formatWinHeadline } from '@/lib/win-headline';
import { getRequiredSelectionCountForStage } from '@/lib/win-stages';
import {
  buildPlaylist,
  slideAllowsCornerQr,
  slideShowsStatusInTopBar,
  type EventsProjection,
  type Slide,
  type SlideKind,
} from '@/lib/playlist';
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
import { isPublicReloadSafe } from '@/lib/build-check';
import { useWakeLock } from '@/hooks/wake-lock';
import { ConnectionBanner } from '@/components/connection-banner';
import { BingoBall, NumberChip } from '@/components/ui/bingo-ball';
import { cardClass } from '@/components/ui/card';
import { AnchorLogo, Grain } from '@/components/ui/logo';
import { ClaimBalls, ClaimPanel } from '@/components/display/claim-panel';
import { CORNER_QR_CARD_WIDTH, FollowAlongSlide, FollowQrBadge } from '@/components/display/follow-qr';
import { RulesSlide } from '@/components/display/rules-slide';
import { SlideLoop } from '@/components/display/slide-loop';
import { PromoSlide, SlidePreload } from '@/components/display/promo-slide';
import { useEventsProjection } from '@/components/display/use-events-projection';
import { useMinuteClock, useWindowOrigin } from '@/components/display/screen-hooks';
import { useSessionOverview } from '@/components/display/use-session-overview';
import { useDisplayLifecycle } from '@/components/display/use-display-lifecycle';
import { TV_KICKER_CLASS, TV_SIZE, tvText } from '@/components/display/tv-text';
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
 * The TV's layout budget, as CSS variables on the screen's root. Each is
 * clamp(size at 1280x720, a vh or vw term that lands on the 1920x1080 size,
 * that size), so the bars hold the design's proportions on both and stop
 * growing at 1080p, like the text sizes inside them (tv-xs to tv-base).
 *
 *                      1920x1080   1280x720
 *   top bar               112px       76px
 *   book colour band       22px       15px   (only with a game in play)
 *   footer                184px      124px   (only while calling, checking or won)
 *   main area padding      28px       19px   top and bottom; 40px and 27px at the sides
 *
 * What is left for the main area: 762px and 505px with the band and the
 * footer (706px and 468px inside its padding, which is what the ball gets);
 * 890px and 592px on a break; 912px and 607px before, between and after games.
 * Change a height here and every sum that uses it follows.
 */
const TV_LAYOUT_VARS = {
  '--tv-top': 'clamp(76px, 10.37vh, 112px)',
  '--tv-band': 'clamp(15px, 2.04vh, 22px)',
  '--tv-foot': 'clamp(124px, 17.04vh, 184px)',
  '--tv-pad-y': 'clamp(18px, 2.6vh, 28px)',
  '--tv-pad-x': 'clamp(26px, 2.08vw, 40px)',
  // Between the corner QR's column and the rest of the main area.
  '--tv-gap': 'clamp(20px, 1.67vw, 32px)',
  '--tv-qr-col': CORNER_QR_CARD_WIDTH,
  // The widest the snowball card may be: 355px and 237px.
  '--tv-snowball': '18.5vw',
} as React.CSSProperties;

/**
 * The main ball's diameter: the design's 64vh (690px at 1080p), capped by
 *   - the height left between the bars: the screen less the top bar, the band,
 *     the footer and the main area's padding (706px at 1080p, so 64vh binds;
 *     468px at 720p against 461px, so it binds there too, with 7px to spare);
 *   - the width that keeps it clear of the corner QR on its left and the
 *     snowball card on its right. The ball is centred on the screen, so it can
 *     be the main area less twice the wider of the two (the QR's column and
 *     its gap, or the snowball card and 10px of air). Never the binding term
 *     at 16:9 (1110px and 700px), only on a narrower screen.
 */
const TV_BALL_SIZE =
  'min(64vh, calc(100vh - var(--tv-top) - var(--tv-band) - var(--tv-foot) - 2 * var(--tv-pad-y)), calc(100vw - 2 * var(--tv-pad-x) - 2 * max(var(--tv-qr-col) + var(--tv-gap), var(--tv-snowball) + 10px)))';
// The design's shadow, scaled with the ball: a dark edge, a gold glow below and
// an inner shade (6px, 24px 80px and -40px 90px at 1080p).
const TV_BALL_SHADOW_CLASS =
  'shadow-[0_0_0_0.56vh_color-mix(in_srgb,var(--anchor-green-deep)_60%,transparent),0_2.2vh_7.4vh_color-mix(in_srgb,var(--anchor-gold-bright)_25%,transparent),inset_0_-3.7vh_8.3vh_rgb(0_0_0/0.3)]';

// Recent calls: the newest chip is 104px with a 5px gold border, the rest 84px
// (69px and 56px at 720p, where the numerals are 37px and 31px).
const TV_CHIP_LATEST_SIZE = 'clamp(69px, 9.63vh, 104px)';
const TV_CHIP_SIZE = 'clamp(56px, 7.78vh, 84px)';

// The win, by how much has to fit under it. Tier 0 is the design: the 200px
// headline over one row of balls (a Line) or none. Tier 1 is for two rows of
// balls or a long headline, tier 2 for three rows (a Full House), so the whole
// announcement still fits the main area at 1280x720.
const WIN_HEADLINE_CLASS = [
  cn(TV_SIZE.win, 'leading-[0.88]'),
  cn(TV_SIZE.count, 'leading-[0.9]'),
  tvText('2xl', 'leading-[1.05]'),
];
const WIN_SCRIPT_CLASS = [TV_SIZE.scriptXl, TV_SIZE.scriptLg, TV_SIZE.callout];
const WIN_GAP_CLASS = ['gap-[clamp(16px,3.3vh,36px)]', 'gap-[clamp(13px,2.4vh,26px)]', 'gap-[clamp(10px,1.7vh,18px)]'];
/** A win headline longer than this ("Full house + snowball £180!") cannot take the biggest size. */
const WIN_LONG_TEXT_LENGTH = 18;

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

  // New releases: reload by itself, but only with no game in progress or on a
  // break. Never while numbers are being called, a claim check or a win.
  useBuildCheck({ mode: 'auto', safe: isPublicReloadSafe(currentGameState) });

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
  // minutes and on each change of phase. Never shown as an error. It runs in
  // every phase, a game in progress included, so the list is already here and
  // no more than 10 minutes old when a break starts.
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
  // Which kind of slide the loop is showing (null with no loop), reported by
  // SlideLoop before the browser paints. Decides the corner QR below.
  const [activeSlideKind, setActiveSlideKind] = useState<SlideKind | null>(null);

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
  // Never two QR codes at once: while a slide with a code of its own is up (an
  // event or the next bingo night, on a break or between games), the corner QR
  // and its column go, which also gives the event slide the full width it is
  // laid out for. They go for the Break time card too, so it sits in the
  // middle of the screen on its own (slideAllowsCornerQr).
  const slideHidesCornerQr = playlist.length > 0 && activeSlideKind !== null && !slideAllowsCornerQr(activeSlideKind);
  const showCornerQr =
    !!followUrl && (hasRenderableGame || nightPhase === 'between_games') && !slideHidesCornerQr;

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

  // The book colour is a band under the top bar and a chip beside the game's
  // number, never the screen's background: text always sits on the dark green,
  // whatever the colour (a white or pale yellow book included).
  const bookColour = currentActiveGame?.background_colour || null;
  // "Game 2 of 10 · Blue book": key information, so the key-information size,
  // in the kicker's gold capitals.
  const gameIdentityClass = tvText('base', 'font-bold uppercase leading-[1.1] tracking-[0.1em] text-anchor-gold-bright');
  // The footer's stage, prize and snowball: a kicker over the value, one line
  // each, so a long prize ends in "..." rather than spilling out of the footer.
  const footerCellClass = 'flex flex-col gap-[clamp(4px,0.55vh,6px)]';
  const footerRuleClass = 'h-[clamp(74px,10.2vh,110px)] w-px shrink-0 bg-line-gold';
  const footerMoneyClass = cn(TV_SIZE.barPrize, 'truncate font-display leading-[1.1] text-anchor-gold-bright');
  // The break and between-games screens share one centred column (the end
  // of the night is a slide loop of its own): kicker, headline, a line of
  // body and the kitchen card, straight on the dark green.
  const serviceColumnClass =
    'mx-auto flex h-full w-full max-w-[1200px] flex-col items-center justify-center gap-[clamp(16px,2.6vh,40px)] text-center';
  // The line under a win, "£10 · Line · call 22": the stage's prize, the stage
  // and the revealed count. Recording a winner pauses the game in the same
  // write, so the count shown is the call the win was made on. A part that is
  // not known is left out.
  const winSummary = [
    currentPrizeText,
    currentStageName ? formatStageLabel(currentStageName) : null,
    revealedCallCount > 0 ? `call ${revealedCallCount}` : null,
  ].filter(Boolean).join(' · ');
  // Which of the win's three sizes fits (WIN_HEADLINE_CLASS): by the rows of
  // claimed balls under the headline (five a row) and by the headline's length.
  const winBallRows = claimPanel ? Math.ceil(claimPanel.balls.length / 5) : 0;
  const winTextIsLong = (currentGameState?.display_win_text?.length ?? 0) > WIN_LONG_TEXT_LENGTH;
  const winTier = winBallRows >= 3 || (winBallRows === 2 && winTextIsLong) ? 2 : winBallRows === 2 || winTextIsLong ? 1 : 0;
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
    <div
      className={cardClass({
        accent: true,
        className:
          'mt-[1.5vh] flex min-w-[min(100%,70vh)] flex-col items-center gap-[0.75vh] px-[clamp(28px,2.5vw,56px)] py-[clamp(18px,3vh,36px)]',
      })}
    >
      <p className={cn(TV_SIZE.callout, 'font-display leading-none')}>Kitchen open until {KITCHEN_OPEN_UNTIL}</p>
      <p className={tvText('sm', 'font-medium')}>Order food and drinks at the bar.</p>
    </div>
  );

  const renderBreakSlide = () => (
    <div className={serviceColumnClass}>
      <p className={TV_KICKER_CLASS}>Anchor Bingo Night</p>
      <h1 className={cn(TV_SIZE.hero, 'leading-[0.9]')}>Break time</h1>
      <p className={tvText('base', 'font-medium')}>Hold on to your tickets. We will be back shortly.</p>
      {renderKitchenCard()}
      <p className={cn(TV_SIZE.callout, 'mt-[0.7vh] font-script text-anchor-gold-bright')}>Eat, Drink, Enjoy</p>
    </div>
  );

  // Between games (spec 5.1): "Next game coming up", with the next game's
  // name and colour once the game list is in.
  const renderNextGameSlide = () => (
    <div className={serviceColumnClass}>
      <p className={TV_KICKER_CLASS}>Anchor Bingo Night</p>
      <h1 className={tvText('3xl')}>Next game coming up</h1>
      {nextGame && (
        <div className="flex flex-col items-center gap-[1vh]">
          <p className={tvText('lg', 'font-display')}>{nextGame.name}</p>
          {nextIdentity && (
            <p className={cn(gameIdentityClass, 'flex items-center justify-center gap-[0.5em]')}>
              <span
                aria-hidden
                className="inline-block shrink-0 rounded-full border-2 border-anchor-cream-text"
                style={{ backgroundColor: nextGame.background_colour, width: '0.8em', height: '0.8em' }}
              />
              {nextIdentity}
            </p>
          )}
        </div>
      )}
      {renderKitchenCard()}
    </div>
  );

  // Keeps the part of the night in view on the slides that are about something
  // else: the rules, and the events and next bingo night shown on a break
  // and between games.
  const pauseStatusLabel =
    nightPhase === 'between_games' ? 'Next game coming up' : inGameSubState === 'break' ? 'Break time' : null;
  // The rules slide carries that label itself. An event or next-bingo slide
  // does not: while one is up, the top bar says it, in place of the game and
  // book colour, and the slide keeps all its room for the artwork.
  const topBarStatusLabel =
    pauseStatusLabel && playlist.length > 0 && activeSlideKind !== null && slideShowsStatusInTopBar(activeSlideKind)
      ? pauseStatusLabel
      : null;

  const renderSlideContent = (slide: Slide) => {
    switch (slide.kind) {
      case 'follow_along':
        return followUrl ? <FollowAlongSlide url={followUrl} /> : null;
      case 'rules':
        return <RulesSlide rules={houseRules} statusLabel={pauseStatusLabel} />;
      case 'break':
        return renderBreakSlide();
      case 'next_game':
        return renderNextGameSlide();
      default:
        // Events, next bingo, thanks, review: shared with the idle /display.
        // On a break and between games the top bar carries the status label
        // for them (topBarStatusLabel above). They need no backing panel: the
        // screen stays dark green and the book colour is only the band under
        // the top bar.
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
      <div className={tvText('sm', 'relative flex h-screen items-center justify-center bg-anchor-green-deep font-medium text-anchor-cream-text')}>
        <Grain />
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
        className="relative flex h-screen flex-col items-center justify-center gap-[clamp(16px,2.6vh,40px)] bg-anchor-green-deep px-[5vw] text-center text-anchor-cream-text"
      >
        <Grain />
        <p className={TV_KICKER_CLASS}>
          Anchor Bingo Night
        </p>
        <h1 className={tvText('2xl')}>
          Reconnecting to the game
        </h1>
        <p className={tvText('sm', 'font-medium')}>
          Hold on to your tickets, the screen will catch up in a moment.
        </p>
      </div>
    );
  }

  return (
    <div
      className="relative flex h-screen max-h-screen w-full flex-col overflow-hidden bg-anchor-green-deep text-anchor-cream-text"
      style={TV_LAYOUT_VARS}
    >
      {/* Film grain over the whole screen, bars and overlays included. */}
      <Grain className="z-[90]" />
      <ConnectionBanner variant="tv" visible={health.shouldShowBanner} shouldAutoRefresh={health.shouldAutoRefresh} />
      {/* Top Bar */}
      <header
        className="relative z-10 flex h-[var(--tv-top)] shrink-0 items-center gap-[var(--tv-pad-x)] border-b border-line-gold bg-anchor-green-deep/[0.88] px-[var(--tv-pad-x)]"
        data-check-overlap="top-bar"
      >
         <AnchorLogo height={68} priority className="h-[clamp(46px,6.3vh,68px)]" />
         {/* min-w-0 lets the name shrink inside the flex row, and truncate
             keeps a long session or game name to one line instead of pushing
             out of the bar (X12f). During play the right block leads with the
             game number and book colour (spec 5.3) at the key-information
             size, over the game's name, beside a chip in the book colour.
             While an event slide is up on a break or between games, that
             first line reads "Break time" or "Next game coming up" instead
             (topBarStatusLabel). With
             leading-[1.1] the two lines fit the bar: 49px + 36px in 112px at
             1080p, 33px + 24px in 76px at 720p. The block may take up to 62%
             of the bar before its lines end in "...". */}
         <h2 className={cn(TV_SIZE.barTitle, 'min-w-0 flex-1 truncate leading-[1.2]')}>{currentSession.name}</h2>
         {hasRenderableGame && currentActiveGame && (
           <div className="flex min-w-0 max-w-[62%] shrink-0 items-center gap-[clamp(16px,1.25vw,24px)]">
             <div className="flex min-w-0 flex-col items-end gap-[2px]">
               {(topBarStatusLabel ?? activeIdentity) && (
                 <p className={cn(gameIdentityClass, 'max-w-full truncate')}>{topBarStatusLabel ?? activeIdentity}</p>
               )}
               <p className={tvText('xs', 'max-w-full truncate font-medium leading-[1.1]')}>{currentActiveGame.name}</p>
             </div>
             {bookColour && (
               <span
                 aria-hidden
                 className="h-[clamp(48px,6.67vh,72px)] w-[clamp(48px,6.67vh,72px)] shrink-0 rounded-full border-[length:clamp(3px,0.37vh,4px)] border-anchor-cream-text shadow-[0_0_0_2px_rgb(0_0_0/0.4)]"
                 style={{ backgroundColor: bookColour }}
               />
             )}
           </div>
         )}
         {/* Between games there is no game in play, so no right block: the
             status label stands there on its own while an event slide is up. */}
         {!(hasRenderableGame && currentActiveGame) && topBarStatusLabel && (
           <p className={cn(gameIdentityClass, 'max-w-[62%] shrink-0 truncate')}>{topBarStatusLabel}</p>
         )}
      </header>

      {/* The book colour: a band under the top bar while a game is in play,
          the break included. Nothing is ever written on it. */}
      {hasRenderableGame && currentActiveGame && bookColour && (
        <div
          aria-hidden
          className="h-[var(--tv-band)] shrink-0 transition-colors duration-[400ms] ease-anchor"
          style={{ backgroundColor: bookColour }}
          data-check-overlap="band"
        />
      )}

      {/* Main Content Area */}
      <div className="relative flex min-h-0 flex-1 gap-[var(--tv-gap)] overflow-hidden px-[var(--tv-pad-x)] py-[var(--tv-pad-y)]">

          {/* data-check-overlap marks the TV's main regions for the render
              check (scripts/check-render.js): none of them may overlap. The
              slide column is only marked while slides show, because the
              snowball card sits over its corner (clear of the ball) during
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
              <SlideLoop
                className="h-full w-full"
                slides={playlist}
                renderSlide={renderSlide}
                onSlideChange={setActiveSlideKind}
              />
            )}

            {/* Stages and prizes, before the first call. The card is wide, so
                it stays in the column beside the corner QR. They are key
                information, so they are not pulsed: people need to read them. */}
            {showActiveGame && !currentNumberDelayed && showPreCallStagePreview && (
              <div className="flex h-full w-full flex-col items-center justify-center">
                <div
                  className={cardClass({
                    accent: true,
                    className: 'w-full max-w-[1100px] animate-fade-in p-[clamp(18px,3vh,40px)]',
                  })}
                  data-check-overlap="stages"
                >
                  <p className={cn(TV_KICKER_CLASS, 'text-center')}>
                    Game stages & prizes
                  </p>
                  <div className="mt-[clamp(12px,1.9vh,24px)] flex flex-col gap-[clamp(8px,1.1vh,14px)]">
                    {stagePrizePreview.map((item) => (
                      <div
                        key={`${item.stageLabel}-${item.index}`}
                        className="flex items-baseline justify-between gap-[2vw] rounded-card border border-line bg-anchor-green-raised px-[clamp(16px,1.5vw,28px)] py-[clamp(10px,1.5vh,18px)]"
                      >
                        <p className={tvText('base', 'shrink-0 font-semibold')}>
                          Stage {item.index + 1}: {item.stageLabel}
                        </p>
                        {/* An empty prize is a setup gap for the host to
                            fix, not something to put in front of guests
                            (X12e): the host screen still flags it. */}
                        {item.prizeLabel && (
                          <p className={tvText('lg', 'min-w-0 text-right font-display text-anchor-gold-bright')}>
                            {item.prizeLabel}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* The ball, and "Ready..." before it. Centred on the screen, not in
              the column beside the corner QR: that column starts a QR card's
              width in from the left, which pushed the ball off centre. A layer
              over the whole main area, whose padding is the same on both
              sides, so its middle is the screen's. The ball's size keeps it
              clear of the QR and the snowball card (TV_BALL_SIZE). */}
          {showActiveGame && (currentNumberDelayed || !showPreCallStagePreview) && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              {currentNumberDelayed ? (
                <div className="relative" data-check-overlap="ball">
                  {/* The main ball. TV_BALL_SIZE is the design's 64vh capped
                      by the real vertical chrome (the top bar, the band, the
                      footer and the main area's padding, all from
                      TV_LAYOUT_VARS), so it can never be flat-topped by the
                      bars. Keyed on the number, so each new call scales in
                      from 0.92 and fades in over 400ms (animate-ball-in;
                      nothing moves under prefers-reduced-motion). */}
                  <BingoBall
                    key={currentNumberDelayed}
                    number={currentNumberDelayed}
                    size={TV_BALL_SIZE}
                    numberScale={0.68}
                    borderScale={0.02}
                    className={cn('animate-ball-in', TV_BALL_SHADOW_CLASS)}
                  />
                </div>
              ) : (
                // Straight on the dark green: the screen is never the
                // game's colour now, so it needs no backing panel.
                <div data-check-overlap="ready">
                  <h1 className={cn(TV_SIZE.hero, 'leading-[0.9]')}>Ready...</h1>
                </div>
              )}
            </div>
          )}

          {/* Snowball countdown card. Top right so it can never collide with
              the corner QR, and static so it needs no prefers-reduced-motion
              opt-out. The z-70 claim overlay and the z-80 win overlay cover it
              as they cover everything else. */}
          {/* max-w (--tv-snowball, 18.5vw) keeps the card clear of the ball at
              1280x720 and 1920x1080, so a long label such as "Last qualifying
              call" wraps instead of running across the ball. The ball's own
              size allows for a card that wide (TV_BALL_SIZE). */}
          {isSnowballGame && (showActiveGame || showPausedForValidation) && currentSnowballPot && snowballWindowStatus && (
            <div
              className={cardClass({
                className:
                  'absolute right-[var(--tv-pad-x)] top-[var(--tv-pad-y)] z-40 flex min-w-[15vw] max-w-[var(--tv-snowball)] flex-col items-center gap-[0.4vh] px-[clamp(12px,1.25vw,32px)] py-[clamp(12px,1.85vh,20px)] text-center',
              })}
              data-check-overlap="snowball"
            >
              {snowballWindowStatus === 'open' ? (
                <>
                  <p className={cn(TV_SIZE.count, 'font-display leading-[0.85] text-anchor-gold-bright tabular-nums lining-nums')}>
                    {snowballCallsRemaining}
                  </p>
                  <p className={TV_KICKER_CLASS}>
                    Calls left
                  </p>
                </>
              ) : (
                <p className={tvText('base', 'font-display leading-[1.05] text-anchor-gold-bright')}>
                  {snowballCallsLabel}
                </p>
              )}
              <p className={tvText('base', 'mt-[0.5vh] font-semibold leading-[1.1] tabular-nums')}>
                £{formatPounds(Number(currentSnowballPot.current_jackpot_amount))} jackpot
              </p>
            </div>
          )}

          {/* The live claim (spec 5.2): each number as the caller reads it,
              ticked or crossed, then the server's verdict. It replaced the old
              "Checking Claim" card. It covers the main area only: the bars
              stay. The panel brings its own padding (claim-panel.tsx). */}
          {showPausedForValidation && claimPanel && (
            <div className="absolute inset-0 z-[70] flex items-center justify-center overflow-hidden bg-anchor-green-deep/[0.94] p-[clamp(12px,2.2vh,24px)] backdrop-blur-md">
                <div className={cardClass({ className: 'w-full max-w-[1500px]' })} data-check-overlap="claim">
                    <ClaimPanel state={claimPanel} variant="tv" />
                </div>
            </div>
          )}

          {/* WIN OVERLAY. The claimed balls stay on screen under the win, so
              the room can see what won; the headline and the script line step
              down as the balls take more rows (winTier), so a Full House still
              fits at 1280x720. The headline is the server's text, which is in
              capitals; formatWinHeadline recases it. The balls sit on the deep
              green here, so their badges take that border (--claim-surface). */}
          {showWinState && currentGameState && (
            <div className="absolute inset-0 z-[80] animate-fade-in overflow-hidden bg-anchor-green-deep/[0.95] backdrop-blur-md [--claim-surface:var(--anchor-green-deep)]">
              <div
                className={cn(
                  'flex h-full animate-fade-up flex-col items-center justify-center p-[clamp(12px,2.2vh,24px)] text-center',
                  WIN_GAP_CLASS[winTier]
                )}
              >
                <p className={cn(WIN_SCRIPT_CLASS[winTier], 'font-script text-anchor-gold-bright')}>Well played</p>
                <h1 className={WIN_HEADLINE_CLASS[winTier]}>
                    {formatWinHeadline(currentGameState.display_win_text)}
                </h1>
                {currentGameState.display_winner_name && (
                    <p className={tvText('base', 'break-words font-semibold')}>
                        <span className={cn(TV_KICKER_CLASS, 'mr-[0.6em]')}>Winner</span>
                        {currentGameState.display_winner_name}
                    </p>
                )}
                {claimPanel && <ClaimBalls balls={claimPanel.balls} variant="tv" />}
                {winSummary && <p className={tvText('base', 'font-semibold text-anchor-gold-bright')}>{winSummary}</p>}
              </div>
            </div>
          )}
      </div>

      {/* Footer Info Bar. Its height (--tv-foot: 184px at 1080p, 124px at
          720p) is one of the terms in the main ball's size (TV_BALL_SIZE),
          which reads the same variable, so the two cannot drift apart. It
          only shows while a game is being called, checked or won. */}
      {showFooter && (
        <footer
          className="relative z-10 grid h-[var(--tv-foot)] shrink-0 grid-cols-[fit-content(55%)_minmax(0,1fr)] items-center gap-[clamp(36px,2.9vw,56px)] border-t border-line-gold bg-anchor-green-deep/[0.88] px-[var(--tv-pad-x)]"
          data-check-overlap="footer"
        >
              <div className="flex min-w-0 items-center gap-[clamp(24px,2.5vw,48px)]">
                  <div className={cn(footerCellClass, 'shrink-0')}>
                    <p className={TV_KICKER_CLASS}>Playing for</p>
                    <p className={cn(TV_SIZE.barValue, 'whitespace-nowrap font-semibold leading-[1.1]')}>
                      {formatStageLabel(currentStageName ?? undefined)}
                    </p>
                  </div>
                  {/* Hidden when empty: "Prize not set" is for the host
                      screen only (X12e). */}
                  {currentPrizeText && (
                    <>
                      <div aria-hidden className={footerRuleClass} />
                      <div className={cn(footerCellClass, 'min-w-0')}>
                        <p className={TV_KICKER_CLASS}>Prize</p>
                        <p className={footerMoneyClass}>{currentPrizeText}</p>
                      </div>
                    </>
                  )}
                  {isSnowballGame && (
                    <>
                      <div aria-hidden className={footerRuleClass} />
                      <div className={cn(footerCellClass, currentSnowballPot ? 'shrink-0' : 'min-w-0')}>
                        <p className={TV_KICKER_CLASS}>Snowball</p>
                        {currentSnowballPot ? (
                          <p className={cn(footerMoneyClass, 'tabular-nums')}>
                            £{formatPounds(Number(currentSnowballPot.current_jackpot_amount))}
                          </p>
                        ) : (
                          <p className={tvText('base', 'truncate font-semibold')}>
                            Countdown unavailable (no linked snowball pot)
                          </p>
                        )}
                      </div>
                    </>
                  )}
              </div>

              <div className="flex min-w-0 flex-col gap-[clamp(8px,1.1vh,12px)] overflow-hidden">
                  {delayedNumbers.length > 0 && (
                      <>
                        <div className="flex items-baseline justify-between gap-4">
                            <span className={TV_KICKER_CLASS}>Recent calls</span>
                            <span className={tvText('xs', 'font-semibold tabular-nums')}>{revealedCallCount} called</span>
                        </div>
                        {/* The chips are sized by height like the footer they
                            sit in. The numerals are at least the
                            key-information size: 46px in the 84px chips at
                            1080p, 31px in the 56px chips at 720p. */}
                        <div className="flex items-center gap-[clamp(11px,1.5vh,16px)] overflow-hidden mask-linear-fade">
                            {delayedNumbers.slice().reverse().map((num, idx) => (
                                <NumberChip
                                  key={idx}
                                  number={num}
                                  latest={idx === 0}
                                  size={idx === 0 ? TV_CHIP_LATEST_SIZE : TV_CHIP_SIZE}
                                  numberScale={idx === 0 ? 0.54 : 0.55}
                                  className={idx === 0 ? 'border-[length:clamp(3px,0.46vh,5px)]' : undefined}
                                />
                            ))}
                        </div>
                      </>
                  )}
              </div>
          </footer>
      )}
    </div>
  );
}
