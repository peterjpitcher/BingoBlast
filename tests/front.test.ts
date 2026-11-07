// tests/front.test.ts
//
// The front page and its "Other nights" row (spec S2.3, row C-7):
//   * the kit's three tiles, pointing at this app's own pages;
//   * the other nights come from the events feed and the environment, never
//     from a list in the code: a night shows only while the feed has an
//     upcoming event in its category and it has an address;
//   * an empty or failing feed hides the row, and a failing one is reported.
// The management app is faked (no network) and the clock is fixed, so this
// runs the same under TZ=Europe/London and TZ=UTC.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FrontPage } from '@anchor-nights/kit/front';
import * as fixtures from '@anchor-nights/kit/events/fixtures';
import type { ScreenEvent, ScreenFeed } from '@anchor-nights/kit/events';
import { createBingoEventsFeed } from '../src/lib/events-feed';
import {
  loadOtherNights,
  OTHER_NIGHTS_REPORT_SCOPE,
  readOtherNightUrls,
  selectOtherNights,
  type OtherNightUrls,
} from '../src/lib/other-nights';
import { OTHER_NIGHT_URL_ENV } from '../src/lib/env';

const NOW_MS = Date.parse('2026-11-18T12:00:00Z');
const BASE = 'https://management.test/api';

const URLS: OtherNightUrls = {
  quiz: 'https://quiz.example.test',
  music: 'https://musicbingo.example.test',
  tasting: 'https://tastingnight.example.test',
};

const realConsoleError = console.error;
const realConsoleWarn = console.warn;
before(() => {
  console.error = () => {};
  console.warn = () => {};
});
after(() => {
  console.error = realConsoleError;
  console.warn = realConsoleWarn;
});

function screenEvent(id: string, category: string | null): ScreenEvent {
  const link = `https://www.the-anchor.pub/events/${id}`;
  return {
    id,
    slug: id,
    title: id,
    startsAt: '2026-11-25T19:00:00.000Z',
    category,
    image: null,
    links: {
      pre_event_screen: link,
      in_game_screen: link,
      post_event_screen: link,
      venue_screen: link,
      event_host_slide: link,
    },
  };
}

function feed(status: ScreenFeed['status'], events: ScreenEvent[] = [], nights: ScreenEvent[] = []): ScreenFeed {
  return { status, fetchedAt: status === 'ok' ? new Date(NOW_MS).toISOString() : null, categorySlug: 'bingo-night', events, nights };
}

/** A fake management app holding the given events; `down` fails every call. */
function fakeManagement(events: ReturnType<typeof fixtures.fixtureEvent>[], down = false): typeof fetch {
  return (async (input: string | URL) => {
    if (down) throw new TypeError('fetch failed');
    const url = new URL(String(input));
    const path = url.pathname.replace(/^\/api/, '');
    let body: unknown;
    if (path === '/event-categories') body = fixtures.categoriesResponse();
    else if (path === '/events') {
      const categoryId = url.searchParams.get('category_id');
      const inCategory = (e: Record<string, unknown>) => (e.category as { id: string } | null)?.id === categoryId;
      body = fixtures.listResponse(categoryId ? events.filter(inCategory) : events);
    } else if (path.startsWith('/events/')) body = fixtures.detailResponse(path.slice('/events/'.length));
    if (body === undefined) return new Response('not found', { status: 404 });
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof fetch;
}

function realFeed(fetchImpl: typeof fetch) {
  return createBingoEventsFeed({
    apiKey: 'anch_testkey',
    baseUrl: BASE,
    env: {},
    fetchImpl,
    nextRevalidate: false,
    now: () => NOW_MS,
    report: () => {},
  });
}

function render(nights: Parameters<typeof FrontPage>[0]['otherNights']): string {
  return renderToStaticMarkup(
    React.createElement(FrontPage, {
      appName: 'Bingo night',
      tiles: { tv: { href: '/tv' }, admin: { href: '/admin', hint: 'Sessions, pots and winners' } },
      otherNights: nights,
    }),
  );
}

test('the front page shows the three tiles: Host console, Pub TV and Admin, at this app\'s own pages', async () => {
  // Home with no ANCHOR_API_KEY: the feed is not configured, so no row.
  const saved = process.env.ANCHOR_API_KEY;
  delete process.env.ANCHOR_API_KEY;
  try {
    const { default: Home } = await import('../src/app/page');
    const html = renderToStaticMarkup(await Home());
    for (const label of ['Host console', 'Pub TV', 'Admin', 'Bingo night', 'Sessions, pots and winners']) {
      assert.ok(html.includes(label), `missing "${label}"`);
    }
    for (const href of ['/host', '/tv', '/admin']) assert.ok(html.includes(`href="${href}"`), `missing link to ${href}`);
    assert.ok(!html.includes('Other nights'), 'no row without a feed');
    assert.ok(!/vercel\.app|the-anchor\.pub/.test(html.replace(/the-anchor-bar\.jpg/g, '')), 'no hostname in the page');
  } finally {
    if (saved !== undefined) process.env.ANCHOR_API_KEY = saved;
  }
});

test('the row lists only the nights the feed has coming up, in the usual order, never this one', () => {
  const result = selectOtherNights(
    feed('ok', [screenEvent('music', 'music-bingo'), screenEvent('quiz', 'quiz-night-stanwell-moor'), screenEvent('party', 'parties')], [
      screenEvent('bingo', 'bingo-night'),
    ]),
    URLS,
  );
  assert.equal(result.failure, null);
  assert.deepEqual(
    result.nights.map((night) => [night.key, night.name, night.href]),
    [
      ['quiz', 'Quiz Night', 'https://quiz.example.test/'],
      ['music', 'Music Bingo', 'https://musicbingo.example.test/'],
    ],
  );

  const html = render(result.nights);
  assert.ok(html.includes('aria-label="Other nights"'));
  assert.ok(html.includes('href="https://quiz.example.test/"'));
  assert.ok(html.includes('href="https://musicbingo.example.test/"'));
  assert.ok(!html.includes('Tasting Night'), 'no Tasting Night without an event in the feed');
  assert.ok(!html.includes('>Cash Bingo<'), 'never a link to this night');
});

test('a night with no address, or a non-https one, is left out even when the feed has it', () => {
  const events = [screenEvent('quiz', 'quiz-night-stanwell-moor'), screenEvent('music', 'music-bingo'), screenEvent('tasting', 'tasting-nights')];
  const result = selectOtherNights(feed('ok', events), { quiz: undefined, music: 'http://musicbingo.example.test', tasting: URLS.tasting });
  assert.deepEqual(result.nights.map((night) => night.key), ['tasting']);
  assert.deepEqual(selectOtherNights(feed('ok', events), {}).nights, []);
});

test('the addresses come from the environment variables named in env.ts', () => {
  assert.deepEqual(
    readOtherNightUrls({
      [OTHER_NIGHT_URL_ENV.quiz]: 'https://q.example.test',
      [OTHER_NIGHT_URL_ENV.music]: 'https://m.example.test',
      [OTHER_NIGHT_URL_ENV.tasting]: 'https://t.example.test',
    }),
    { quiz: 'https://q.example.test', music: 'https://m.example.test', tasting: 'https://t.example.test' },
  );
});

test('an empty feed hides the row and reports nothing', async () => {
  const reports: string[] = [];
  const nights = await loadOtherNights({ getFeed: async () => feed('no_events'), urls: URLS, report: (scope) => reports.push(scope) });
  assert.deepEqual(nights, []);
  assert.deepEqual(reports, []);
  assert.ok(!render(nights).includes('Other nights'));
});

test('a feed with no other nights in it hides the row', async () => {
  const nights = await loadOtherNights({
    getFeed: async () => feed('ok', [screenEvent('party', 'parties')], [screenEvent('bingo', 'bingo-night')]),
    urls: URLS,
    report: () => assert.fail('nothing to report'),
  });
  assert.deepEqual(nights, []);
});

test('a feed that is not configured (a preview or local run) hides the row without a report', async () => {
  const reports: string[] = [];
  const nights = await loadOtherNights({ getFeed: async () => feed('missing_config'), urls: URLS, report: (scope) => reports.push(scope) });
  assert.deepEqual(nights, []);
  assert.deepEqual(reports, []);
});

test('a failing feed hides the row and the failure is reported', async () => {
  const reports: [string, unknown][] = [];
  const nights = await loadOtherNights({ getFeed: async () => feed('error'), urls: URLS, report: (scope, err) => reports.push([scope, err]) });
  assert.deepEqual(nights, []);
  assert.equal(reports.length, 1);
  assert.equal(reports[0][0], OTHER_NIGHTS_REPORT_SCOPE);
  assert.match(String((reports[0][1] as Error).message), /events feed is down/);
  assert.ok(!render(nights).includes('Other nights'));
});

test('a feed read that throws hides the row and is reported, never breaking the page', async () => {
  const reports: string[] = [];
  const nights = await loadOtherNights({
    getFeed: async () => {
      throw new Error('boom');
    },
    urls: URLS,
    report: (scope) => reports.push(scope),
  });
  assert.deepEqual(nights, []);
  assert.deepEqual(reports, [OTHER_NIGHTS_REPORT_SCOPE]);
});

test('end to end with the real feed: a healthy management app shows the nights it lists', async () => {
  const eventsFeed = realFeed(fakeManagement([fixtures.QUIZ_DEC_2, fixtures.MUSIC_BINGO_NOV_20, fixtures.BINGO_NOV_25, fixtures.PARTY_NOV_28]));
  const nights = await loadOtherNights({ getFeed: () => eventsFeed.getFeed(), urls: URLS, report: () => assert.fail('nothing to report') });
  assert.deepEqual(nights.map((night) => night.key), ['quiz', 'music']);
});

test('end to end with the real feed: a management app that is down hides the row and reports it', async () => {
  const eventsFeed = realFeed(fakeManagement([], true));
  const reports: string[] = [];
  const nights = await loadOtherNights({ getFeed: () => eventsFeed.getFeed(), urls: URLS, report: (scope) => reports.push(scope) });
  assert.deepEqual(nights, []);
  assert.deepEqual(reports, [OTHER_NIGHTS_REPORT_SCOPE]);
});
