// src/lib/events-feed/projection.test.ts
//
// Building and serving the events projection, with the management API faked
// out (no network) and the clock injected, so it runs the same under
// TZ=Europe/London and TZ=UTC.
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { EventsFeedError } from './errors';
import {
  ALL_CATEGORIES,
  BINGO_CATEGORY,
  BINGO_DEC_16,
  BINGO_NOV_18,
  MUSIC_BINGO_OCT_16,
  PARTY_OCT_31,
  QUIZ_OCT_7,
  categoriesResponse,
  detailResponse,
  listResponse,
} from './fixtures';
import { eventIdLink } from './links';
import {
  DETAIL_TIMEOUT_MS,
  LIST_TIMEOUT_MS,
  MAX_PROJECTION_AGE_MS,
  buildEventsProjection,
  createProjectionMemo,
  getEventsProjection,
  resolveEventsProjection,
  type CachedEventsProjection,
  type FetchJson,
} from './projection';
import type { ScreenEvent } from './types';

const TODAY = '2026-10-01';
const NOW = Date.parse('2026-10-01T09:00:00Z');
const id = (raw: Record<string, unknown>): string => raw.id as string;

const GENERAL_PATH = '/events?from_date=2026-10-01&to_date=2026-11-30&status=scheduled&limit=50';
const BINGO_PATH = `/events?category_id=${BINGO_CATEGORY.id}&status=scheduled&from_date=2026-10-01&to_date=2027-01-29&limit=5`;

const QUIZ_LINKS = {
  pre_event_screen: 'https://l.the-anchor.pub/ps7q1z',
  post_event_screen: 'https://l.the-anchor.pub/ns7q1z',
};

interface FakeCall {
  path: string;
  timeoutMs: number;
}

type Handler = (path: string) => unknown;

/** A management API that answers like the real one, unless a test overrides a path. */
function managementApi(overrides: Record<string, Handler> = {}): { fetchJson: FetchJson; calls: FakeCall[] } {
  const calls: FakeCall[] = [];
  const fetchJson: FetchJson = async (path, { timeoutMs }) => {
    calls.push({ path, timeoutMs });
    for (const [prefix, handler] of Object.entries(overrides)) {
      if (path.startsWith(prefix)) return handler(path);
    }
    if (path === '/event-categories') return categoriesResponse(ALL_CATEGORIES);
    if (path === GENERAL_PATH) return listResponse([QUIZ_OCT_7, MUSIC_BINGO_OCT_16, PARTY_OCT_31, BINGO_NOV_18]);
    if (path === BINGO_PATH) return listResponse([BINGO_NOV_18, BINGO_DEC_16]);
    if (path === `/events/${id(QUIZ_OCT_7)}`) return detailResponse(id(QUIZ_OCT_7), QUIZ_LINKS);
    if (path.startsWith('/events/')) return detailResponse(path.slice('/events/'.length));
    throw new Error(`Unexpected path in test: ${path}`);
  };
  return { fetchJson, calls };
}

function reports(): { report: (scope: string, err: unknown) => void; seen: Array<{ scope: string; message: string }> } {
  const seen: Array<{ scope: string; message: string }> = [];
  return {
    seen,
    report: (scope, err) => seen.push({ scope, message: err instanceof Error ? err.message : String(err) }),
  };
}

const failing = (code: 'http' | 'timeout' = 'http'): Handler => () => {
  throw new EventsFeedError('The management API answered HTTP 503 for /events', code);
};

test('a refresh builds the general list, the bingo nights and each QR target', async () => {
  const api = managementApi();
  const { report, seen } = reports();
  const projection = await buildEventsProjection({ fetchJson: api.fetchJson, todayIso: TODAY, now: () => NOW, report });

  assert.equal(projection.fetchedAt, '2026-10-01T09:00:00.000Z');
  assert.deepEqual(projection.events.map((e) => e.id), [id(QUIZ_OCT_7), id(MUSIC_BINGO_OCT_16), id(PARTY_OCT_31)]);
  assert.deepEqual(projection.bingoNights.map((e) => e.id), [id(BINGO_NOV_18), id(BINGO_DEC_16)]);

  const quiz = projection.events[0];
  assert.deepEqual(quiz, {
    id: id(QUIZ_OCT_7),
    title: 'A Hint of Halloween Quiz Night',
    startsAt: '2026-10-07T18:00:00.000Z',
    category: 'quiz-night-stanwell-moor',
    image: {
      url: QUIZ_OCT_7.landscapeImageUrl as string,
      alt: 'Quiz Night teams taking part in a pub quiz at The Anchor in Stanwell Moor',
      square: false,
    },
    qrPre: QUIZ_LINKS.pre_event_screen,
    qrPost: QUIZ_LINKS.post_event_screen,
  });

  // No short links on the others: the id link, never the API's url or offers.url.
  for (const event of [...projection.events.slice(1), ...projection.bingoNights]) {
    assert.equal(event.qrPre, eventIdLink(event.id, 'pre_event_screen'));
    assert.equal(event.qrPost, eventIdLink(event.id, 'post_event_screen'));
    assert.doesNotMatch(event.qrPre + event.qrPost, /orangejelly/);
  }

  assert.deepEqual(seen, []);
});

test('the list queries use London today, +60 and +120 days, scheduled only, with 5-second timeouts', async () => {
  const api = managementApi();
  await buildEventsProjection({ fetchJson: api.fetchJson, todayIso: TODAY, now: () => NOW });
  const byPath = new Map(api.calls.map((c) => [c.path, c.timeoutMs]));
  assert.equal(byPath.get(GENERAL_PATH), LIST_TIMEOUT_MS);
  assert.equal(byPath.get('/event-categories'), LIST_TIMEOUT_MS);
  assert.equal(byPath.get(BINGO_PATH), LIST_TIMEOUT_MS);
  // Details for the three general events and both bingo nights, 3 seconds each.
  const details = api.calls.filter((c) => /^\/events\/[0-9a-f-]+$/.test(c.path));
  assert.equal(details.length, 5);
  assert.ok(details.every((c) => c.timeoutMs === DETAIL_TIMEOUT_MS));
});

test('a failed detail falls back to the id link for that event only', async () => {
  const api = managementApi({ [`/events/${id(QUIZ_OCT_7)}`]: failing() });
  const second = managementApi({ [`/events/${id(MUSIC_BINGO_OCT_16)}`]: failing('timeout') });
  const { report, seen } = reports();

  const quizFailed = await buildEventsProjection({ fetchJson: api.fetchJson, todayIso: TODAY, now: () => NOW, report });
  assert.equal(quizFailed.events[0].qrPre, eventIdLink(id(QUIZ_OCT_7), 'pre_event_screen'));
  assert.equal(quizFailed.events.length, 3, 'the event still shows');

  const musicFailed = await buildEventsProjection({ fetchJson: second.fetchJson, todayIso: TODAY, now: () => NOW, report });
  assert.equal(musicFailed.events[0].qrPre, QUIZ_LINKS.pre_event_screen, 'the other events keep their short links');
  assert.equal(musicFailed.events[1].qrPost, eventIdLink(id(MUSIC_BINGO_OCT_16), 'post_event_screen'));

  assert.deepEqual(seen.map((r) => r.scope), ['events-feed:details', 'events-feed:details']);
  assert.match(seen[0].message, /^1 of 5 event detail lookups failed/);
});

test('a failed list or category call fails the whole refresh, so the cache keeps its last good value', async () => {
  for (const [prefix, what] of [
    [GENERAL_PATH, 'general list'],
    ['/event-categories', 'category lookup'],
    [BINGO_PATH, 'bingo-night list'],
  ] as const) {
    const api = managementApi({ [prefix]: failing() });
    await assert.rejects(
      buildEventsProjection({ fetchJson: api.fetchJson, todayIso: TODAY, now: () => NOW }),
      EventsFeedError,
      what,
    );
  }
  const garbled = managementApi({ [GENERAL_PATH]: () => ({ success: false }) });
  await assert.rejects(buildEventsProjection({ fetchJson: garbled.fetchJson, todayIso: TODAY, now: () => NOW }), EventsFeedError);
});

test('a malformed event is dropped alone and reported by count', async () => {
  const api = managementApi({
    [GENERAL_PATH]: () => listResponse([{ ...QUIZ_OCT_7, startDate: 'soon' }, MUSIC_BINGO_OCT_16]),
  });
  const { report, seen } = reports();
  const projection = await buildEventsProjection({ fetchJson: api.fetchJson, todayIso: TODAY, now: () => NOW, report });
  assert.deepEqual(projection.events.map((e) => e.id), [id(MUSIC_BINGO_OCT_16)]);
  assert.deepEqual(seen.map((r) => r.scope), ['events-feed:parse']);
  assert.doesNotMatch(seen[0].message, /soon/, 'the report carries a count, not the data');
});

test('without a bingo-night category, bingo nights come from the general list and it is reported', async () => {
  const api = managementApi({
    '/event-categories': () => categoriesResponse(ALL_CATEGORIES.filter((c) => c.slug !== 'bingo-night')),
  });
  const { report, seen } = reports();
  const projection = await buildEventsProjection({ fetchJson: api.fetchJson, todayIso: TODAY, now: () => NOW, report });
  assert.deepEqual(projection.bingoNights.map((e) => e.id), [id(BINGO_NOV_18)]);
  assert.ok(!api.calls.some((c) => c.path.includes('category_id')));
  assert.deepEqual(seen.map((r) => r.scope), ['events-feed:bingo-category']);
});

test('the memo keeps the category for a day and details for an hour, but never a failure', async () => {
  const memo = createProjectionMemo();
  let clock = NOW;
  const first = managementApi({ [`/events/${id(MUSIC_BINGO_OCT_16)}`]: failing() });
  await buildEventsProjection({ fetchJson: first.fetchJson, todayIso: TODAY, now: () => clock, memo });

  clock += 30 * 60 * 1000;
  const second = managementApi();
  const projection = await buildEventsProjection({ fetchJson: second.fetchJson, todayIso: TODAY, now: () => clock, memo });
  assert.deepEqual(
    second.calls.map((c) => c.path).filter((p) => !p.startsWith('/events?')),
    [`/events/${id(MUSIC_BINGO_OCT_16)}`],
    'only the failed detail is looked up again',
  );
  assert.equal(projection.events[0].qrPre, QUIZ_LINKS.pre_event_screen, 'the memoised short link is used');

  clock += 31 * 60 * 1000;
  const third = managementApi();
  await buildEventsProjection({ fetchJson: third.fetchJson, todayIso: TODAY, now: () => clock, memo });
  const thirdPaths = third.calls.map((c) => c.path);
  assert.ok(!thirdPaths.includes('/event-categories'), 'the category is still remembered');
  assert.equal(thirdPaths.filter((p) => p.startsWith('/events/')).length, 4, 'details older than an hour are looked up again');
});

test('the whole refresh is bounded to 8 seconds; details that no longer fit use the id link', async () => {
  let clock = NOW;
  const calls: FakeCall[] = [];
  const cost: Record<string, number> = { [GENERAL_PATH]: 1_000, '/event-categories': 5_000, [BINGO_PATH]: 3_000 };
  const inner = managementApi();
  const fetchJson: FetchJson = async (path, options) => {
    calls.push({ path, timeoutMs: options.timeoutMs });
    clock += cost[path] ?? 0;
    return inner.fetchJson(path, options);
  };
  const { report, seen } = reports();
  const projection = await buildEventsProjection({ fetchJson, todayIso: TODAY, now: () => clock, report });

  assert.equal(calls.find((c) => c.path === BINGO_PATH)?.timeoutMs, 2_000, 'the bingo list only gets what is left');
  assert.equal(calls.filter((c) => c.path.startsWith('/events/')).length, 0, 'no time left for details');
  assert.ok(projection.events.every((e) => e.qrPre === eventIdLink(e.id, 'pre_event_screen')));
  assert.deepEqual(seen.map((r) => r.scope), ['events-feed:details']);
});

// ---------------------------------------------------------------------------
// Serving
// ---------------------------------------------------------------------------

function screenEvent(eventId: string, startsAt: string): ScreenEvent {
  return {
    id: eventId,
    title: `Event ${eventId}`,
    startsAt,
    category: null,
    image: null,
    qrPre: eventIdLink(eventId, 'pre_event_screen'),
    qrPost: eventIdLink(eventId, 'post_event_screen'),
  };
}

const CACHED: CachedEventsProjection = {
  fetchedAt: '2026-10-01T09:00:00.000Z',
  events: [screenEvent('a', '2026-10-01T09:03:00.000Z'), screenEvent('b', '2026-10-07T18:00:00.000Z')],
  bingoNights: [screenEvent('c', '2026-10-01T18:00:00.000Z')],
};

test('without the key the answer is missing_config, and nothing is loaded', async () => {
  let loaded = false;
  const projection = await resolveEventsProjection({
    configured: false,
    load: async () => {
      loaded = true;
      return CACHED;
    },
  });
  assert.deepEqual(projection, { status: 'missing_config', fetchedAt: null, events: [], bingoNights: [] });
  assert.equal(loaded, false);
});

test('a cold failure answers error at once and reports it once', async () => {
  const { report, seen } = reports();
  const failure = new EventsFeedError('The management API answered HTTP 401 for /events', 'http');
  const projection = await resolveEventsProjection({
    configured: true,
    load: async () => {
      throw failure;
    },
    report,
  });
  assert.deepEqual(projection, { status: 'error', fetchedAt: null, events: [], bingoNights: [] });
  assert.deepEqual(seen.map((r) => r.scope), ['events-feed:refresh']);

  const again = reports();
  await resolveEventsProjection({
    configured: true,
    load: async () => {
      throw failure;
    },
    report: again.report,
    alreadyReported: (err) => err === failure,
  });
  assert.deepEqual(again.seen, [], 'an error the loader already reported is not reported twice');
});

test('a good projection is served, minus anything that has started since it was fetched', async () => {
  const projection = await resolveEventsProjection({
    configured: true,
    load: async () => CACHED,
    now: () => Date.parse('2026-10-01T09:04:00Z'),
  });
  assert.equal(projection.status, 'ok');
  assert.equal(projection.fetchedAt, CACHED.fetchedAt);
  assert.deepEqual(projection.events.map((e) => e.id), ['b']);
  assert.deepEqual(projection.bingoNights.map((e) => e.id), ['c']);
});

test('no_events when nothing upcoming is left', async () => {
  const todayOnly: CachedEventsProjection = { ...CACHED, events: CACHED.events.slice(0, 1) };
  const projection = await resolveEventsProjection({
    configured: true,
    load: async () => todayOnly,
    now: () => Date.parse('2026-10-01T20:00:00Z'),
  });
  assert.deepEqual(projection, { status: 'no_events', fetchedAt: CACHED.fetchedAt, events: [], bingoNights: [] });

  const emptyFeed = await resolveEventsProjection({
    configured: true,
    load: async () => ({ fetchedAt: CACHED.fetchedAt, events: [], bingoNights: [] }),
    now: () => NOW,
  });
  assert.equal(emptyFeed.status, 'no_events');
});

test('a projection more than 24 hours old is not served', async () => {
  const fetchedMs = Date.parse(CACHED.fetchedAt);
  const stillGood = await resolveEventsProjection({ configured: true, load: async () => CACHED, now: () => fetchedMs + MAX_PROJECTION_AGE_MS });
  assert.equal(stillGood.status, 'ok');
  const tooOld = await resolveEventsProjection({ configured: true, load: async () => CACHED, now: () => fetchedMs + MAX_PROJECTION_AGE_MS + 1 });
  assert.deepEqual(tooOld, { status: 'error', fetchedAt: null, events: [], bingoNights: [] });
});

let savedKey: string | undefined;
beforeEach(() => {
  savedKey = process.env.ANCHOR_API_KEY;
});
afterEach(() => {
  if (savedKey === undefined) delete process.env.ANCHOR_API_KEY;
  else process.env.ANCHOR_API_KEY = savedKey;
});

test('getEventsProjection answers missing_config when ANCHOR_API_KEY is not set', async () => {
  delete process.env.ANCHOR_API_KEY;
  assert.deepEqual(await getEventsProjection(), { status: 'missing_config', fetchedAt: null, events: [], bingoNights: [] });
});
