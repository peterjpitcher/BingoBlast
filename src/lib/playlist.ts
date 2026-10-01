// src/lib/playlist.ts
//
// What the pub TV loops through when no game is being called (spec 5.4, 5.5).
// Pure: the TV passes the phase, the events projection, the time, its
// session's date and the review switch, and renders whatever comes back
// through src/components/display/slide-loop.tsx.
//
// The loops, per the spec 5.5 table:
//   - before_start: the follow-along QR, the next bingo night, the events two
//     at a time with the follow-along again after every two, and the rules.
//   - night_over: thanks, the review invitation (only when switched on), the
//     next bingo night, the events, and thanks or review again after every two.
//   - idle (/display with no session): "Bingo nights at The Anchor", the next
//     bingo night, the events.
//   - the break and between-games screens alternate with the rules.
// With no events (none, an error, or no key), each falls back to its own short
// loop. The TV never shows an error about events.
import type { InGameSubState, NightPhase } from './night-phase';
import { getLondonIsoDate } from './dates';
import type {
  EventsProjection,
  EventsProjectionStatus,
  ScreenEvent,
  ScreenEventImage,
} from './events-feed/types';

/** A phase of the night, or a TV on /display with no session to join. */
export type PlaylistPhase = NightPhase | 'idle';

/** Slides that need nothing but the slide kind to draw. */
export type PlainSlideKind =
  | 'follow_along'
  | 'rules'
  | 'break'
  | 'next_game'
  | 'thanks'
  | 'review'
  | 'idle_bingo';

/** Slides that show one event: an upcoming event, or the next bingo night. */
export type EventSlideKind = 'event' | 'next_bingo';

interface SlideBase {
  /** Stable within one playlist: the loop keeps its place while the keys match. */
  key: string;
  durationMs: number;
  /**
   * The image of the slide after this one, so the screen can start loading it
   * while this one shows. Null when the next slide has no image.
   */
  preloadImage?: ScreenEventImage | null;
}

export interface PlainSlide extends SlideBase {
  kind: PlainSlideKind;
}

export interface EventBearingSlide extends SlideBase {
  kind: EventSlideKind;
  event: ScreenEvent;
  /** The QR target for this phase: qrPre before the night, qrPost after it and on the idle screen. */
  qrUrl: string;
}

export type Slide = PlainSlide | EventBearingSlide;
export type SlideKind = Slide['kind'];

// ---- Events projection ------------------------------------------------------
//
// The projection comes from the events back end (src/lib/events-feed), which
// owns its shape. Re-exported so screen code has one place to import from.

export type { EventsProjection, EventsProjectionStatus, ScreenEvent, ScreenEventImage };

export interface UsableEvents {
  events: ScreenEvent[];
  /** The first bingo night still to come, other than tonight's. */
  nextBingo: ScreenEvent | null;
}

/**
 * The events a screen may show at `now`: drops anything that has started, and
 * the bingo night on the screen's own session date (it is tonight). Done on the
 * client at render time, so a cached projection is never wrong after midnight
 * (R10). An error or missing projection gives nothing, never an error slide.
 */
export function getUsableEvents(
  projection: EventsProjection | null,
  now: Date,
  sessionDate: string | null
): UsableEvents {
  // 'no_events', 'error' and 'missing_config' all mean nothing to show.
  if (!projection || projection.status !== 'ok') return { events: [], nextBingo: null };
  const nowMs = now.getTime();
  const upcoming = (event: ScreenEvent) => {
    const startsMs = new Date(event.startsAt).getTime();
    return Number.isFinite(startsMs) && startsMs > nowMs;
  };
  const notTonight = (event: ScreenEvent) => !sessionDate || getLondonIsoDate(event.startsAt) !== sessionDate;
  return {
    events: projection.events.filter(upcoming),
    nextBingo: projection.bingoNights.filter(upcoming).filter(notTonight)[0] ?? null,
  };
}

/**
 * Where an event's QR or "View event" link points in a phase: the
 * pre_event_screen link before the night starts, and the post_event_screen
 * link once it is over and on the idle screen (spec 5.5).
 */
export function eventLinkForPhase(event: ScreenEvent, phase: PlaylistPhase): string {
  return phase === 'before_start' ? event.qrPre : event.qrPost;
}

export interface PhoneEventItem {
  event: ScreenEvent;
  /** True for the next bingo night, which leads the list. */
  isNextBingo: boolean;
}

/**
 * The events a phone lists, next bingo night first (spec 5.5, D5): the same
 * events as the TV, dropped and chosen the same way.
 */
export function getPhoneEventList(
  projection: EventsProjection | null,
  now: Date,
  sessionDate: string | null
): PhoneEventItem[] {
  const usable = getUsableEvents(projection, now, sessionDate);
  const items = usable.events.map((event) => ({ event, isNextBingo: false }));
  return usable.nextBingo ? [{ event: usable.nextBingo, isNextBingo: true }, ...items] : items;
}

// ---- Reading the projection on the client -----------------------------------

const PROJECTION_STATUSES: ReadonlyArray<EventsProjectionStatus> = ['ok', 'no_events', 'error', 'missing_config'];

const isString = (value: unknown): value is string => typeof value === 'string';

function readScreenEvent(value: unknown): ScreenEvent | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (!isString(raw.id) || !isString(raw.title) || !isString(raw.startsAt)) return null;
  if (!isString(raw.qrPre) || !isString(raw.qrPost)) return null;
  let image: ScreenEventImage | null = null;
  if (raw.image && typeof raw.image === 'object') {
    const img = raw.image as Record<string, unknown>;
    if (isString(img.url) && isString(img.alt) && typeof img.square === 'boolean') {
      image = { url: img.url, alt: img.alt, square: img.square };
    }
  }
  return {
    id: raw.id,
    title: raw.title,
    startsAt: raw.startsAt,
    category: isString(raw.category) ? raw.category : null,
    image,
    qrPre: raw.qrPre,
    qrPost: raw.qrPost,
  };
}

function readScreenEvents(value: unknown): ScreenEvent[] {
  if (!Array.isArray(value)) return [];
  return value.map(readScreenEvent).filter((event): event is ScreenEvent => event !== null);
}

/**
 * The body of GET /api/screen/events, checked before the TV uses it. Null when
 * it is not a projection at all; a malformed event is dropped on its own.
 */
export function readEventsProjection(value: unknown): EventsProjection | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const status = PROJECTION_STATUSES.find((candidate) => candidate === raw.status);
  if (!status) return null;
  return {
    status,
    fetchedAt: isString(raw.fetchedAt) ? raw.fetchedAt : null,
    events: readScreenEvents(raw.events),
    bingoNights: readScreenEvents(raw.bingoNights),
  };
}

/**
 * Which projection a screen keeps after a refresh. An 'error' answer never
 * replaces a good list the screen already has: the screen still drops events
 * as they start, so the worst case is a cancelled event lingering until the
 * feed is back. Anything else (a new list, no events, no key) replaces it.
 */
export function chooseEventsProjection(
  current: EventsProjection | null,
  incoming: EventsProjection
): EventsProjection {
  if (incoming.status === 'error' && current?.status === 'ok') return current;
  return incoming;
}

// ---- Playlists --------------------------------------------------------------

export const FOLLOW_ALONG_MS = 20_000;
/** Follow-along alone with the rules, when there are no events to show. */
export const FOLLOW_ALONG_FALLBACK_MS = 30_000;
export const RULES_MS = 20_000;
export const STATUS_SLIDE_MS = 20_000;
export const EVENT_MS = 12_000;
export const NEXT_BINGO_MS = 12_000;
export const THANKS_MS = 15_000;
export const REVIEW_MS = 20_000;
/** The idle "Bingo nights at The Anchor" slide; the spec gives no time, so it matches the follow-along. */
export const IDLE_BINGO_MS = 20_000;

export interface BuildPlaylistOptions {
  /** For the in_game phase: only a break loops (break screen, then the rules). */
  inGameSubState?: InGameSubState | null;
  /**
   * Whether the review invitation is switched on (isReviewInviteEnabled() in
   * src/lib/venue-links.ts). Passed in so this stays pure. Off by default.
   */
  reviewEnabled?: boolean;
}

/** Builds slides with keys that stay unique however often a kind repeats. */
function createSlideList() {
  const slides: Slide[] = [];
  const counts = new Map<string, number>();
  const nextKey = (base: string) => {
    const n = counts.get(base) ?? 0;
    counts.set(base, n + 1);
    return `${base}-${n}`;
  };
  return {
    slides,
    plain(kind: PlainSlideKind, durationMs: number) {
      slides.push({ key: nextKey(kind), kind, durationMs });
    },
    event(kind: EventSlideKind, event: ScreenEvent, durationMs: number, phase: PlaylistPhase) {
      slides.push({
        key: nextKey(`${kind}-${event.id}`),
        kind,
        durationMs,
        event,
        qrUrl: eventLinkForPhase(event, phase),
      });
    },
  };
}

/** Events two at a time: the unit between follow-along, thanks or review slides. */
function inPairs<T>(items: ReadonlyArray<T>): T[][] {
  const pairs: T[][] = [];
  for (let i = 0; i < items.length; i += 2) pairs.push(items.slice(i, i + 2));
  return pairs;
}

/** Each slide learns the next slide's image (wrapping round), for preloading. */
function withPreloads(slides: Slide[]): Slide[] {
  return slides.map((slide, index) => {
    const next = slides[(index + 1) % slides.length];
    const image = next && next !== slide && 'event' in next ? next.event.image : null;
    return { ...slide, preloadImage: image };
  });
}

/**
 * before_start (spec 5.5): follow-along (20 s), next bingo (12 s), E1, E2
 * (12 s each), follow-along, rules (20 s), E3, E4, follow-along, next bingo,
 * E5, E6, follow-along, rules, E7, E8, and round again. After each
 * follow-along comes the next bingo night and the rules in turn (the next
 * bingo slot is skipped when there is none), then the next two events. There
 * are always at least two rounds, so the rules show once a loop even with one
 * event or none.
 */
function buildBeforeStart(usable: UsableEvents): Slide[] {
  const list = createSlideList();
  if (usable.events.length === 0 && !usable.nextBingo) {
    list.plain('follow_along', FOLLOW_ALONG_FALLBACK_MS);
    list.plain('rules', RULES_MS);
    return list.slides;
  }
  const pairs = inPairs(usable.events);
  const rounds = Math.max(pairs.length, 2);
  for (let round = 0; round < rounds; round += 1) {
    list.plain('follow_along', FOLLOW_ALONG_MS);
    if (round % 2 === 1) list.plain('rules', RULES_MS);
    else if (usable.nextBingo) list.event('next_bingo', usable.nextBingo, NEXT_BINGO_MS, 'before_start');
    for (const event of pairs[round] ?? []) list.event('event', event, EVENT_MS, 'before_start');
  }
  return list.slides;
}

/**
 * night_over (spec 5.5): thanks (15 s), the review slide when switched on
 * (20 s), next bingo, E1, E2, then thanks or review again after every two
 * events (taking turns when review is on), and round again to thanks.
 */
function buildNightOver(usable: UsableEvents, reviewEnabled: boolean): Slide[] {
  const list = createSlideList();
  list.plain('thanks', THANKS_MS);
  if (reviewEnabled) list.plain('review', REVIEW_MS);
  if (usable.nextBingo) list.event('next_bingo', usable.nextBingo, NEXT_BINGO_MS, 'night_over');
  const pairs = inPairs(usable.events);
  pairs.forEach((pair, index) => {
    // Between pairs only: after the last pair the loop is back at thanks.
    if (index > 0) {
      if (reviewEnabled && index % 2 === 0) list.plain('review', REVIEW_MS);
      else list.plain('thanks', THANKS_MS);
    }
    for (const event of pair) list.event('event', event, EVENT_MS, 'night_over');
  });
  return list.slides;
}

/**
 * The idle /display (spec 5.5): "Bingo nights at The Anchor" (with the
 * what's-on QR), the next bingo night, then the events. With nothing to show,
 * just the "Bingo nights at The Anchor" slide.
 */
function buildIdle(usable: UsableEvents): Slide[] {
  const list = createSlideList();
  list.plain('idle_bingo', IDLE_BINGO_MS);
  if (usable.nextBingo) list.event('next_bingo', usable.nextBingo, NEXT_BINGO_MS, 'idle');
  for (const event of usable.events) list.event('event', event, EVENT_MS, 'idle');
  return list.slides;
}

/**
 * The loop for a phase. An empty list means the screen shows its own fixed
 * layout (a game being called, a claim being checked, a win).
 *
 * `now` and `sessionDate` decide which events are still to come (see
 * getUsableEvents); the idle screen has no session, so passes null.
 */
export function buildPlaylist(
  phase: PlaylistPhase,
  projection: EventsProjection | null,
  now: Date,
  sessionDate: string | null,
  opts: BuildPlaylistOptions = {}
): Slide[] {
  switch (phase) {
    case 'before_start':
      return withPreloads(buildBeforeStart(getUsableEvents(projection, now, sessionDate)));
    case 'between_games':
      return [
        { key: 'next_game-0', kind: 'next_game', durationMs: STATUS_SLIDE_MS },
        { key: 'rules-0', kind: 'rules', durationMs: RULES_MS },
      ];
    case 'in_game':
      return opts.inGameSubState === 'break'
        ? [
            { key: 'break-0', kind: 'break', durationMs: STATUS_SLIDE_MS },
            { key: 'rules-0', kind: 'rules', durationMs: RULES_MS },
          ]
        : [];
    case 'night_over':
      return withPreloads(buildNightOver(getUsableEvents(projection, now, sessionDate), opts.reviewEnabled === true));
    case 'idle':
      return withPreloads(buildIdle(getUsableEvents(projection, now, sessionDate)));
  }
}

/** A string that changes whenever the slides do, for resetting a loop. */
export function playlistSignature(slides: ReadonlyArray<Slide>): string {
  return slides.map((slide) => `${slide.key}:${slide.durationMs}`).join('|');
}
