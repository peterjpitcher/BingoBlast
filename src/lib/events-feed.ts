// src/lib/events-feed.ts
//
// SERVER ONLY. Upcoming events for the pub TV and the phones (Anchor Nights
// standard S7.1 to S7.3), from the shared kit's events feed
// (@anchor-nights/kit/events), which imports 'server-only' so Next fails the
// build if a client component ever reaches for the management key.
//
// The kit does the work this app used to do itself in src/lib/events-feed/:
// the management API client, the category lookup by slug ('bingo-night'), the
// five-minute cache that keeps serving the last good answer for up to 24
// hours while the management app is down, and dropping events that have
// started. getFeed() never throws: its status is 'ok', 'no_events', 'error'
// or 'missing_config' (no ANCHOR_API_KEY, as on previews and local runs).
//
// Environment: ANCHOR_API_KEY (the management app's read:events key) and
// ANCHOR_API_BASE_URL (optional), read by the kit.

import { after } from 'next/server';
import {
  createEventsFeed,
  NIGHT_CATEGORY_SLUGS,
  type CreateEventsFeedOptions,
  type EventsFeed,
  type ScreenFeed,
} from '@anchor-nights/kit/events';
import { reportError } from './report-error';

/** utm_source on the fallback event links, and this app's name in error reports. */
export const EVENTS_APP = 'anchor-bingo';

/** Cash Bingo's own format in the management app (spec S7.2). */
export const BINGO_CATEGORY_SLUG = NIGHT_CATEGORY_SLUGS.cashBingo;

/**
 * Hands a failure to reportError without waiting for it; never throws.
 *
 * The promise form of `after()` goes straight to the platform's waitUntil, so
 * the report still lands when it comes from a refresh that finishes after the
 * response has gone. Outside a request (a script, a test) it simply runs
 * untracked.
 */
function scheduleReport(scope: string, err: unknown): void {
  const reporting = reportError({ scope }, err);
  try {
    after(reporting);
  } catch {
    // Not in a request scope.
  }
}

/** A feed for Cash Bingo; the options are for tests (a fake fetch, a fixed clock). */
export function createBingoEventsFeed(
  options: Omit<CreateEventsFeedOptions, 'app' | 'categorySlug'> = {}
): EventsFeed {
  return createEventsFeed({ report: scheduleReport, ...options, app: EVENTS_APP, categorySlug: BINGO_CATEGORY_SLUG });
}

// One per server instance: the cache and the one refresh in flight live here.
const eventsFeed = createBingoEventsFeed();

/** Upcoming events for the public screens. Server only. Never throws. */
export function getEventsFeed(): Promise<ScreenFeed> {
  return eventsFeed.getFeed();
}
