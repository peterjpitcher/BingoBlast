// src/lib/events-feed/projection.ts
//
// SERVER ONLY (it imports client.ts, which sends the management key). The
// one shared, cached view of upcoming events that the TV and phones use
// (spec 5.5). It does not depend on the phase, the session, the time of day or
// the viewer, so a single cache entry serves everybody; clients work out
// "Tonight" and pick qrPre, qrInGame or qrPost themselves.
//
// HOW THE CACHING WORKS
//   The refresh (buildEventsProjection) is wrapped in Next's `unstable_cache`
//   with `revalidate: 300` and the tag 'events-projection'. `unstable_cache` is
//   still supported in Next 16 without Cache Components; its replacement,
//   `use cache`, needs `cacheComponents: true`, which would change how every
//   route in the app renders, so it is out of scope here.
//
//   `unstable_cache` serves a stale entry at once and refreshes it in the
//   background. The refresh THROWS on failure instead of returning an empty
//   list, and Next keeps the stale entry when a background refresh throws, so
//   a failed refresh never replaces a good projection. getEventsProjection
//   stops serving a projection once it is 24 hours old. With nothing cached (a
//   cold start), the throw reaches getEventsProjection, which answers 'error'
//   straight away.
//
//   Fetches inside `unstable_cache` bypass Next's data cache, and a nested
//   `unstable_cache` is bypassed too, so the 24-hour category id and the
//   1-hour event details are memoised in this server instance's memory
//   instead. A cold instance simply looks them up again on its next refresh.
//
// WHEN THE MANAGEMENT APP IS DOWN (createProjectionRefresher)
//   Inside one server instance there is only ever one refresh in flight:
//   requests that arrive while it runs share it rather than each starting
//   their own. After a failed refresh, every refresh for the next
//   REFRESH_FAIL_FAST_MS fails at once with that same error instead of trying
//   again, so with a stale entry Next keeps serving it without a pile of
//   background refreshes, and with nothing cached each page answers 'error'
//   straight away instead of waiting up to the 8-second refresh budget.
//
//   A list in which every event is malformed fails the refresh too (a 'parse'
//   error), so a broken response can never replace a good projection with an
//   empty one.
//
// ERRORS
//   Every failure goes to reportError through Next's `after()`, so reporting
//   never delays a response. That includes a failed background refresh, which
//   Next would otherwise only write to its own log. Nothing here logs a
//   response body or the key.

import { unstable_cache } from 'next/cache';
import { after } from 'next/server';
import { getTodayIsoDateInLondon } from '@/lib/dates';
import { reportError } from '@/lib/report-error';
import { fetchManagementJson, getEventsFeedConfig } from './client';
import { eventsDateWindows } from './date-window';
import { EventsFeedError } from './errors';
import { isAllowedEventImageUrl } from './image-host';
import { eventQr, type ScreenShortLinks } from './links';
import { findCategoryId, parseEventList, parseScreenShortLinks, type ManagementEvent } from './schema';
import { BINGO_NIGHT_CATEGORY, MAX_BINGO_NIGHTS, dropStarted, selectScreenEvents } from './select';
import type { EventsProjection, EventsProjectionStatus, ScreenEvent, ScreenEventImage } from './types';

/** The cache tag, for revalidateTag if a manual refresh is ever wanted. */
export const EVENTS_PROJECTION_TAG = 'events-projection';

/** Seconds between refreshes. */
export const EVENTS_REVALIDATE_SECONDS = 300;

/** The whole refresh, list, category and details together. */
export const REFRESH_BUDGET_MS = 8_000;

/** Each list call and the category call. */
export const LIST_TIMEOUT_MS = 5_000;

/** Each event detail call. */
export const DETAIL_TIMEOUT_MS = 3_000;

/** How long a projection may keep serving while refreshes fail. */
export const MAX_PROJECTION_AGE_MS = 24 * 60 * 60 * 1000;

/** After a failed refresh, how long every refresh fails at once instead of trying again. */
export const REFRESH_FAIL_FAST_MS = 60_000;

const CATEGORY_MEMO_MS = 24 * 60 * 60 * 1000;
const DETAIL_MEMO_MS = 60 * 60 * 1000;

/** The general list's page size. */
const GENERAL_LIMIT = 50;

/** What the cache holds: a successful refresh, before per-request filtering. */
export interface CachedEventsProjection {
  fetchedAt: string;
  events: ScreenEvent[];
  bingoNights: ScreenEvent[];
}

export type FetchJson = (path: string, options: { timeoutMs: number }) => Promise<unknown>;

/** Reports a failure; must not throw or block. */
export type ReportFn = (scope: string, err: unknown) => void;

// ---------------------------------------------------------------------------
// A small time-limited memo, per server instance.
// ---------------------------------------------------------------------------

interface MemoEntry<T> {
  value: T;
  expiresAt: number;
}

export class TtlMemo<T> {
  private readonly entries = new Map<string, MemoEntry<T>>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;

  constructor(ttlMs: number, maxEntries = 200) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
  }

  get(key: string, nowMs: number): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= nowMs) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T, nowMs: number): void {
    if (this.entries.size >= this.maxEntries) {
      for (const [k, entry] of this.entries) {
        if (entry.expiresAt <= nowMs) this.entries.delete(k);
      }
      // Still full: drop the oldest insertion.
      const oldest = this.entries.keys().next();
      if (this.entries.size >= this.maxEntries && !oldest.done) this.entries.delete(oldest.value);
    }
    this.entries.set(key, { value, expiresAt: nowMs + this.ttlMs });
  }
}

export interface ProjectionMemo {
  /** The bingo-night category id (null when the category does not exist). */
  category: TtlMemo<string | null>;
  /** Each event's screen short links, by event id. Failures are never memoised. */
  links: TtlMemo<Required<ScreenShortLinks>>;
}

export function createProjectionMemo(): ProjectionMemo {
  return {
    category: new TtlMemo<string | null>(CATEGORY_MEMO_MS, 4),
    links: new TtlMemo<Required<ScreenShortLinks>>(DETAIL_MEMO_MS, 200),
  };
}

// ---------------------------------------------------------------------------
// Building a projection (testable: every dependency is injected).
// ---------------------------------------------------------------------------

/**
 * Landscape, else square, else hero; only URLs next/image is configured to
 * load. The management app's hero image is the square artwork, so both of the
 * fallbacks are flagged square.
 */
export function pickEventImage(event: ManagementEvent): ScreenEventImage | null {
  const candidates: Array<[string | null, boolean]> = [
    [event.images.landscape, false],
    [event.images.square, true],
    [event.images.hero, true],
  ];
  for (const [url, square] of candidates) {
    if (url && isAllowedEventImageUrl(url)) {
      return { url, alt: event.imageAlt ?? event.title, square };
    }
  }
  return null;
}

export function toScreenEvent(event: ManagementEvent, shortLinks: ScreenShortLinks | null): ScreenEvent {
  const source = { id: event.id, shortLinks };
  return {
    id: event.id,
    title: event.title,
    startsAt: event.startsAt,
    category: event.category,
    image: pickEventImage(event),
    qrPre: eventQr(source, 'pre_event_screen'),
    qrInGame: eventQr(source, 'in_game_screen'),
    qrPost: eventQr(source, 'post_event_screen'),
  };
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : 'an unknown error';
}

export interface BuildProjectionDeps {
  fetchJson: FetchJson;
  /** Today's date in London, YYYY-MM-DD. */
  todayIso: string;
  /** Defaults to Date.now. */
  now?: () => number;
  /** Omit to look everything up every time. */
  memo?: ProjectionMemo;
  /** Non-fatal problems (failed details, dropped events). */
  report?: ReportFn;
}

/**
 * Reads the management app and builds a projection.
 *
 * Throws when the general list, the category lookup or the bingo-night list
 * fails, so the caller's cache keeps its last good value. A failed event
 * detail does not throw: that event falls back to its id link.
 */
export async function buildEventsProjection(deps: BuildProjectionDeps): Promise<CachedEventsProjection> {
  const now = deps.now ?? Date.now;
  const { fetchJson, memo, report } = deps;
  const deadline = now() + REFRESH_BUDGET_MS;

  /** The call's own timeout, cut short by what is left of the refresh budget. */
  const timeoutWithin = (capMs: number): number => Math.min(capMs, deadline - now());

  const listTimeout = (): number => {
    const timeoutMs = timeoutWithin(LIST_TIMEOUT_MS);
    if (timeoutMs <= 0) {
      throw new EventsFeedError(`The events refresh used up its ${REFRESH_BUDGET_MS}ms budget`, 'timeout');
    }
    return timeoutMs;
  };

  const windows = eventsDateWindows(deps.todayIso);
  let dropped = 0;

  const loadList = async (params: Record<string, string>): Promise<ManagementEvent[]> => {
    const query = new URLSearchParams(params).toString();
    const parsed = parseEventList(await fetchJson(`/events?${query}`, { timeoutMs: listTimeout() }));
    if (parsed.events.length === 0 && parsed.dropped > 0) {
      // Not one event in the list could be read: almost certainly a change in
      // the management app's format, not a genuinely empty list. Failing the
      // refresh keeps the last good projection serving rather than caching
      // nothing.
      throw new EventsFeedError(
        `All ${parsed.dropped} events in a management events list were malformed`,
        'parse',
      );
    }
    dropped += parsed.dropped;
    return parsed.events;
  };

  const resolveBingoCategoryId = async (): Promise<string | null> => {
    const remembered = memo?.category.get(BINGO_NIGHT_CATEGORY, now());
    if (remembered !== undefined) return remembered;
    const id = findCategoryId(
      await fetchJson('/event-categories', { timeoutMs: listTimeout() }),
      BINGO_NIGHT_CATEGORY,
    );
    memo?.category.set(BINGO_NIGHT_CATEGORY, id, now());
    if (id === null) {
      report?.(
        'events-feed:bingo-category',
        new Error(`The management app has no "${BINGO_NIGHT_CATEGORY}" category, so the next bingo night comes from the general list only`),
      );
    }
    return id;
  };

  const loadBingoNights = async (): Promise<ManagementEvent[]> => {
    const categoryId = await resolveBingoCategoryId();
    if (categoryId === null) return [];
    return loadList({
      category_id: categoryId,
      status: 'scheduled',
      from_date: windows.from,
      to_date: windows.bingoTo,
      limit: String(MAX_BINGO_NIGHTS),
    });
  };

  const [general, bingo] = await Promise.all([
    loadList({
      from_date: windows.from,
      to_date: windows.generalTo,
      status: 'scheduled',
      limit: String(GENERAL_LIMIT),
    }),
    loadBingoNights(),
  ]);

  if (dropped > 0) {
    report?.('events-feed:parse', new Error(`${dropped} events from the management app were malformed and left out`));
  }

  const selectedAt = now();
  const selection = selectScreenEvents(general, bingo, selectedAt);
  const ids = Array.from(new Set([...selection.events, ...selection.bingoNights].map((event) => event.id)));

  // Details in parallel, each on its own; a failure costs only that event its short link.
  const failures: unknown[] = [];
  const linkEntries = await Promise.all(
    ids.map(async (id): Promise<[string, Required<ScreenShortLinks> | null]> => {
      const remembered = memo?.links.get(id, now());
      if (remembered) return [id, remembered];
      const timeoutMs = timeoutWithin(DETAIL_TIMEOUT_MS);
      if (timeoutMs <= 0) {
        failures.push(new EventsFeedError('No time was left in the refresh for this event detail', 'timeout'));
        return [id, null];
      }
      try {
        const links = parseScreenShortLinks(await fetchJson(`/events/${encodeURIComponent(id)}`, { timeoutMs }));
        memo?.links.set(id, links, now());
        return [id, links];
      } catch (err) {
        failures.push(err);
        return [id, null];
      }
    }),
  );
  if (failures.length > 0) {
    report?.(
      'events-feed:details',
      new Error(
        `${failures.length} of ${ids.length} event detail lookups failed, so those events use the id link. First failure: ${messageOf(failures[0])}`,
      ),
    );
  }
  const linksById = new Map(linkEntries);

  return {
    fetchedAt: new Date(selectedAt).toISOString(),
    events: selection.events.map((event) => toScreenEvent(event, linksById.get(event.id) ?? null)),
    bingoNights: selection.bingoNights.map((event) => toScreenEvent(event, linksById.get(event.id) ?? null)),
  };
}

// ---------------------------------------------------------------------------
// One refresh at a time, and a pause after a failure (testable: the fetcher,
// the clock and the reporter are injected).
// ---------------------------------------------------------------------------

export interface ProjectionRefresherDeps {
  fetchJson: FetchJson;
  /** Today's date in London, YYYY-MM-DD, read at the start of each refresh. */
  todayIso: () => string;
  /** Defaults to Date.now. */
  now?: () => number;
  memo?: ProjectionMemo;
  /**
   * Non-fatal problems, and each failed refresh once as 'events-feed:refresh'.
   * A refresh that fails fast is not reported again.
   */
  report?: ReportFn;
  /** Defaults to REFRESH_FAIL_FAST_MS. */
  failFastMs?: number;
}

/**
 * Wraps buildEventsProjection so that, per server instance:
 *   - concurrent callers share the one refresh in flight;
 *   - for `failFastMs` after a failure, a call rejects at once with that
 *     failure, without touching the management app or reporting it again.
 */
export function createProjectionRefresher(deps: ProjectionRefresherDeps): () => Promise<CachedEventsProjection> {
  const now = deps.now ?? Date.now;
  const failFastMs = deps.failFastMs ?? REFRESH_FAIL_FAST_MS;
  let inFlight: Promise<CachedEventsProjection> | null = null;
  let lastFailure: { atMs: number; error: unknown } | null = null;

  const refresh = async (): Promise<CachedEventsProjection> => {
    try {
      const projection = await buildEventsProjection({
        fetchJson: deps.fetchJson,
        todayIso: deps.todayIso(),
        now,
        memo: deps.memo,
        report: deps.report,
      });
      lastFailure = null;
      return projection;
    } catch (err) {
      lastFailure = { atMs: now(), error: err };
      deps.report?.('events-feed:refresh', err);
      throw err;
    }
  };

  return () => {
    if (inFlight) return inFlight;
    if (lastFailure) {
      const elapsed = now() - lastFailure.atMs;
      if (elapsed >= 0 && elapsed < failFastMs) return Promise.reject(lastFailure.error);
    }
    const run = refresh().finally(() => {
      inFlight = null;
    });
    inFlight = run;
    return run;
  };
}

// ---------------------------------------------------------------------------
// Serving a projection (testable: the loader and the clock are injected).
// ---------------------------------------------------------------------------

function emptyProjection(status: EventsProjectionStatus): EventsProjection {
  return { status, fetchedAt: null, events: [], bingoNights: [] };
}

export interface ResolveProjectionOptions {
  /** False when ANCHOR_API_KEY is not set. */
  configured: boolean;
  /** Returns the cached (or freshly built) projection; throws on a cold failure. */
  load: () => Promise<CachedEventsProjection>;
  now?: () => number;
  report?: ReportFn;
  /** True for an error the loader has already reported. */
  alreadyReported?: (err: unknown) => boolean;
}

/**
 * Turns the cache's answer into what a screen receives: 'missing_config'
 * without a key, 'error' on a cold failure or a projection over 24 hours old,
 * otherwise the events that have not started yet.
 */
export async function resolveEventsProjection(options: ResolveProjectionOptions): Promise<EventsProjection> {
  if (!options.configured) return emptyProjection('missing_config');

  let cached: CachedEventsProjection;
  try {
    cached = await options.load();
  } catch (err) {
    if (!options.alreadyReported?.(err)) options.report?.('events-feed:refresh', err);
    return emptyProjection('error');
  }

  const nowMs = (options.now ?? Date.now)();
  const fetchedMs = Date.parse(cached.fetchedAt);
  if (!Number.isFinite(fetchedMs) || nowMs - fetchedMs > MAX_PROJECTION_AGE_MS) {
    // Every failed refresh behind this has been reported as it happened.
    return emptyProjection('error');
  }

  // The cache can be up to five minutes old, so drop anything that has started since.
  const events = dropStarted(cached.events, nowMs);
  const bingoNights = dropStarted(cached.bingoNights, nowMs);
  return {
    status: events.length > 0 || bingoNights.length > 0 ? 'ok' : 'no_events',
    fetchedAt: cached.fetchedAt,
    events,
    bingoNights,
  };
}

// ---------------------------------------------------------------------------
// The real thing: Next's cache, the management API and reportError.
// ---------------------------------------------------------------------------

/**
 * Hands a failure to reportError without waiting for it; never throws.
 *
 * The promise form of `after()` is used rather than a callback: it goes
 * straight to the platform's waitUntil, which also holds when this runs in a
 * background refresh after the response has already been sent. reportError
 * never rejects, and nothing awaits it, so no response waits on the sink.
 */
function scheduleReport(scope: string, err: unknown): void {
  const reporting = reportError({ scope }, err);
  try {
    after(reporting);
  } catch {
    // Outside a request scope (a script, say): it still runs, just untracked.
  }
}

const reportedErrors = new WeakSet<object>();

function markReported(err: unknown): void {
  if (typeof err === 'object' && err !== null) reportedErrors.add(err);
}

function wasReported(err: unknown): boolean {
  return typeof err === 'object' && err !== null && reportedErrors.has(err);
}

// One per server instance: the shared in-flight refresh and the pause after a
// failure live here. A failed refresh is reported by the refresher as it
// happens, because Next swallows a failed background refresh and keeps
// serving the old entry; marking it means resolveEventsProjection does not
// report it a second time on a cold start.
const refreshProjection = createProjectionRefresher({
  fetchJson: (path, { timeoutMs }) => fetchManagementJson(path, { timeoutMs }),
  todayIso: () => getTodayIsoDateInLondon(),
  memo: createProjectionMemo(),
  report: (scope, err) => {
    scheduleReport(scope, err);
    markReported(err);
  },
});

const loadCachedProjection = unstable_cache(
  (): Promise<CachedEventsProjection> => refreshProjection(),
  // Bump the version when CachedEventsProjection changes shape, so a new
  // release never reads an entry written by an old one. v2: ScreenEvent
  // gained qrInGame (events during a break).
  ['events-feed', 'projection', 'v2'],
  { revalidate: EVENTS_REVALIDATE_SECONDS, tags: [EVENTS_PROJECTION_TAG] },
);

/**
 * Upcoming events for the public screens. Server only. Never throws.
 */
export async function getEventsProjection(): Promise<EventsProjection> {
  return resolveEventsProjection({
    configured: getEventsFeedConfig() !== null,
    load: loadCachedProjection,
    report: scheduleReport,
    alreadyReported: wasReported,
  });
}
