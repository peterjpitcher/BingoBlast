// src/lib/events-feed.test.ts
//
// Cash Bingo's events feed (the kit's, set up for 'bingo-night' and
// 'anchor-bingo') against a fake management app: no network, the clock
// injected, so it runs the same under TZ=Europe/London and TZ=UTC. The point
// of these tests is the public write path's opposite number: when the
// management app fails, the TV must still show a sensible end of night (the
// review card and "See what's on"), never an error and never a typed date.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

// `server-only` throws outside a React Server Components build. Node's test
// runner is not one, so stand in an empty module for it (as the kit's own
// tests do) before the feed is imported.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'server-only') return { url: 'data:text/javascript,', shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

const { createBingoEventsFeed, EVENTS_APP, BINGO_CATEGORY_SLUG } = await import('./events-feed');
const { buildPlaylist } = await import('./playlist');
const fixtures = await import('@anchor-nights/kit/events/fixtures');

const NOW_MS = Date.parse('2026-11-18T12:00:00Z');
const BASE = 'https://management.test/api';

type Handler = (path: string, url: URL) => unknown;

/** A fake management app: `undefined` from the handler is a 404, `down` a network failure, `status` an HTTP error. */
function fakeManagement(handler: Handler, mode: { down?: boolean; status?: number } = {}) {
  const calls: string[] = [];
  const fetchImpl = (async (input: string | URL) => {
    const url = new URL(String(input));
    const path = url.pathname.replace(/^\/api/, '');
    calls.push(path);
    if (mode.down) throw new TypeError('fetch failed');
    if (mode.status) return new Response('{"success":false}', { status: mode.status });
    const body = handler(path, url);
    if (body === undefined) return new Response('not found', { status: 404 });
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

const ALL_EVENTS = [fixtures.QUIZ_NOV_18, fixtures.MUSIC_BINGO_NOV_20, fixtures.BINGO_NOV_25];

const healthy: Handler = (path, url) => {
  if (path === '/event-categories') return fixtures.categoriesResponse();
  if (path === '/events') {
    // The format list asks by category id, as the management app filters it.
    const categoryId = url.searchParams.get('category_id');
    const inCategory = (e: Record<string, unknown>) => (e.category as { id: string } | null)?.id === categoryId;
    return fixtures.listResponse(categoryId ? ALL_EVENTS.filter(inCategory) : ALL_EVENTS);
  }
  if (path.startsWith('/events/')) return fixtures.detailResponse(path.slice('/events/'.length));
  return undefined;
};

function feedWith(fetchImpl: typeof fetch, apiKey: string | null = 'anch_testkey') {
  const reports: string[] = [];
  const feed = createBingoEventsFeed({
    apiKey,
    baseUrl: BASE,
    env: {},
    fetchImpl,
    nextRevalidate: false,
    now: () => NOW_MS,
    report: (scope) => reports.push(scope),
  });
  return { feed, reports };
}

test('the feed is set up as Cash Bingo: bingo-night nights, anchor-bingo links', async () => {
  assert.equal(EVENTS_APP, 'anchor-bingo');
  assert.equal(BINGO_CATEGORY_SLUG, 'bingo-night');
  const { fetchImpl } = fakeManagement(healthy);
  const { feed } = feedWith(fetchImpl);
  const result = await feed.getFeed();
  assert.equal(result.status, 'ok');
  assert.equal(result.categorySlug, 'bingo-night');
  assert.ok(result.nights.length > 0);
  assert.ok(result.nights.every((night) => night.category === 'bingo-night'));
  assert.ok(result.events.every((e) => e.category !== 'bingo-night'));
  // With no short link, the QR falls back to the website's page, tagged with this app.
  for (const e of [...result.events, ...result.nights]) {
    assert.match(e.links.post_event_screen, /^https:\/\/www\.the-anchor\.pub\/events\/.+\?utm_source=anchor-bingo&utm_medium=screen$/);
  }
});

for (const [name, mode] of [
  ['down (network failure)', { down: true }],
  ['answering 500', { status: 500 }],
] as const) {
  test(`a management app that is ${name}: 'error', reported, and the end of night shows the fallback`, async () => {
    const { fetchImpl } = fakeManagement(healthy, mode);
    const { feed, reports } = feedWith(fetchImpl);
    const result = await feed.getFeed();
    assert.equal(result.status, 'error');
    assert.deepEqual(result.events, []);
    assert.deepEqual(result.nights, []);
    assert.ok(reports.length > 0, 'the failure is reported');

    const slides = buildPlaylist('night_over', result, NOW_MS, '2026-11-18');
    assert.equal(slides.length, 1);
    const [thanks] = slides;
    if (thanks.kind !== 'thank_you') throw new Error('expected the thank-you slide');
    // Review us stays; What's on next becomes "See what's on" (no next night, not hidden).
    assert.equal(thanks.reviewUrl, 'https://l.the-anchor.pub/cvf4k7');
    assert.equal(thanks.nextNight, null);
    assert.equal(thanks.hideNext, false);
  });
}

test('without ANCHOR_API_KEY the feed answers missing_config and never calls the management app', async () => {
  const { calls, fetchImpl } = fakeManagement(healthy);
  const { feed } = feedWith(fetchImpl, null);
  const result = await feed.getFeed();
  assert.equal(result.status, 'missing_config');
  assert.deepEqual(calls, []);
});
