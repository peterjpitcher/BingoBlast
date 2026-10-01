// src/lib/playlist.ts
//
// What the pub TV loops through when no game is being called (spec 5.4, 5.5).
// Pure: the TV passes the phase, the events projection (null until the TV
// fetches it in S4), the time and its session's date, and renders whatever
// comes back through src/components/display/slide-loop.tsx.
//
// This slice covers the follow-along and rules slides, plus the break and
// between-games screens, which alternate with the rules so all eight fit at
// 1280x720. The events slice (S4) adds event, next-bingo, thanks, review and
// idle slides to the same function, using the EventsProjection it receives.
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

/** Slide kinds rendered today. S4 adds 'event', 'next_bingo', 'thanks', 'review' and 'idle_bingo'. */
export type SlideKind = 'follow_along' | 'rules' | 'break' | 'next_game';

export interface Slide {
  /** Stable within one playlist: the loop keeps its place while the keys match. */
  key: string;
  kind: SlideKind;
  durationMs: number;
}

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

// ---- Playlists --------------------------------------------------------------

export const FOLLOW_ALONG_MS = 20_000;
/** Follow-along alone with the rules, when there are no events to show. */
export const FOLLOW_ALONG_FALLBACK_MS = 30_000;
export const RULES_MS = 20_000;
export const STATUS_SLIDE_MS = 20_000;

export interface BuildPlaylistOptions {
  /** For the in_game phase: only a break loops (break screen, then the rules). */
  inGameSubState?: InGameSubState | null;
}

/**
 * The loop for a phase. An empty list means the screen shows its own fixed
 * layout (a game being called, the end of the night until S4, the idle page).
 *
 * before_start: the follow-along QR, then the rules. With events to show the
 * follow-along runs 20 s (S4 threads the event slides between them); without,
 * 30 s, per the spec 5.5 fallback.
 */
export function buildPlaylist(
  phase: PlaylistPhase,
  projection: EventsProjection | null,
  now: Date,
  sessionDate: string | null,
  opts: BuildPlaylistOptions = {}
): Slide[] {
  switch (phase) {
    case 'before_start': {
      const usable = getUsableEvents(projection, now, sessionDate);
      const hasEvents = usable.events.length > 0 || usable.nextBingo !== null;
      return [
        { key: 'follow_along-0', kind: 'follow_along', durationMs: hasEvents ? FOLLOW_ALONG_MS : FOLLOW_ALONG_FALLBACK_MS },
        { key: 'rules-0', kind: 'rules', durationMs: RULES_MS },
      ];
    }
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
    case 'idle':
      return [];
  }
}

/** A string that changes whenever the slides do, for resetting a loop. */
export function playlistSignature(slides: ReadonlyArray<Slide>): string {
  return slides.map((slide) => `${slide.key}:${slide.durationMs}`).join('|');
}
