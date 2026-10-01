// src/lib/events-feed/types.ts
//
// The shapes the public screens receive. Types only, with no runtime imports,
// so client components can `import type` from here without pulling any
// server code (or the management key) into the browser bundle.

/**
 * - `ok`: at least one upcoming event or bingo night.
 * - `no_events`: the feed answered, but nothing upcoming is left to show.
 * - `error`: the feed failed with no good projection to fall back on (a cold
 *   start), or the last good one is more than 24 hours old.
 * - `missing_config`: ANCHOR_API_KEY is not set (a local run or a preview).
 */
export type EventsProjectionStatus = 'ok' | 'no_events' | 'error' | 'missing_config';

/**
 * The management app's QR channels this app's screens use: before the night,
 * during it (a break in a game) and after it. The names and their utm_source
 * values match the management app's channel table (its
 * src/lib/short-links/channels.ts).
 */
export type ScreenChannel = 'pre_event_screen' | 'in_game_screen' | 'post_event_screen';

export interface ScreenEventImage {
  /** An https URL in the event-images bucket (see image-host.ts). */
  url: string;
  /** The event's alt text, or its title when the event has none. */
  alt: string;
  /**
   * True when this is the square artwork (no landscape was usable), which the
   * spec shows whole beside the text rather than cropped (5.5).
   */
  square: boolean;
}

/** One upcoming event as the TV and phones see it; never the raw API event. */
export interface ScreenEvent {
  id: string;
  title: string;
  /** When it starts, as an ISO 8601 UTC instant (for example 2026-10-16T18:00:00.000Z). */
  startsAt: string;
  /** The management category slug, for example 'music-bingo', or null. */
  category: string | null;
  /** Landscape, else square, else hero artwork; null for a text-only card. */
  image: ScreenEventImage | null;
  /** QR target before the night starts (pre_event_screen short link, else the id link). */
  qrPre: string;
  /** QR target while the night is under way, on a break (in_game_screen short link, else the id link). */
  qrInGame: string;
  /** QR target once the night is over (post_event_screen short link, else the id link). */
  qrPost: string;
}

export interface EventsProjection {
  status: EventsProjectionStatus;
  /** When the management app was last read successfully; null when it never was. */
  fetchedAt: string | null;
  /** Up to 8 upcoming events, earliest first, one per name, no bingo nights. */
  events: ScreenEvent[];
  /** Up to 5 upcoming bingo nights, earliest first; the next-bingo slot uses these. */
  bingoNights: ScreenEvent[];
}
