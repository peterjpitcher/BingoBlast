// src/lib/playlist.test.ts
//
// Which kit loop each phase of a bingo night uses, which of bingo's own
// slides lead it, and which link the QR codes carry. The kit's own tests
// cover the playlist builders in detail; these pin Cash Bingo's use of them.
// The clock is injected, so the file runs the same under TZ=Europe/London and
// TZ=UTC.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ScreenEvent, ScreenFeed } from '@anchor-nights/kit/events/shared';
import {
  buildPlaylist,
  channelForPhase,
  eventLinkForPhase,
  getPhoneEventList,
  isBingoSlide,
  slideAllowsCornerQr,
  slideCarriesQr,
  slideShowsStatusInTopBar,
  type Slide,
} from './playlist';
import { REVIEW_URL } from './venue-links';

const NOW_MS = Date.parse('2026-11-18T18:30:00Z');
const SESSION_DATE = '2026-11-18';

const event = (id: string, startsAt: string, category: string | null = 'music-bingo'): ScreenEvent => ({
  id,
  slug: `event-${id}`,
  title: `Event ${id}`,
  startsAt,
  category,
  image: null,
  links: {
    pre_event_screen: `https://l.the-anchor.pub/pre${id}`,
    in_game_screen: `https://l.the-anchor.pub/game${id}`,
    post_event_screen: `https://l.the-anchor.pub/post${id}`,
    venue_screen: `https://www.the-anchor.pub/events/event-${id}?utm_source=anchor-bingo&utm_medium=screen`,
    event_host_slide: `https://www.the-anchor.pub/events/event-${id}?utm_source=anchor-bingo&utm_medium=screen`,
  },
});

const bingo = (id: string, startsAt: string): ScreenEvent => event(id, startsAt, 'bingo-night');

const feed = (overrides: Partial<ScreenFeed> = {}): ScreenFeed => ({
  status: 'ok',
  fetchedAt: '2026-11-18T18:00:00Z',
  categorySlug: 'bingo-night',
  events: [],
  nights: [],
  ...overrides,
});

const FOUR_EVENTS = [
  event('e1', '2026-11-20T19:00:00Z'),
  event('e2', '2026-11-21T19:00:00Z'),
  event('e3', '2026-11-22T19:00:00Z'),
  event('e4', '2026-11-23T19:00:00Z'),
];
const NEXT_BINGO = bingo('b2', '2026-12-16T19:00:00Z');
const FULL = feed({ events: FOUR_EVENTS, nights: [NEXT_BINGO] });

/** A readable picture of a loop: bingo slides by id, kit slides by kind, events by id. */
const shape = (slides: Slide[]): string[] =>
  slides.map((slide) => {
    if (slide.kind === 'app') return slide.id;
    if (slide.kind === 'event') return slide.event.id;
    if (slide.kind === 'next_night') return `next:${slide.event.id}`;
    return slide.kind;
  });

const FAILED_FEEDS: Array<[string, ScreenFeed | null]> = [
  ['no feed yet', null],
  ['no events', feed({ status: 'no_events' })],
  ['the management API failing', feed({ status: 'error' })],
  ['no key', feed({ status: 'missing_config' })],
];

// ---- Channels ---------------------------------------------------------------

test('each phase uses its own screen channel for event links', () => {
  assert.equal(channelForPhase('before_start'), 'pre_event_screen');
  assert.equal(channelForPhase('between_games'), 'in_game_screen');
  assert.equal(channelForPhase('in_game', 'break'), 'in_game_screen');
  assert.equal(channelForPhase('in_game', 'calling'), 'post_event_screen');
  assert.equal(channelForPhase('night_over'), 'post_event_screen');
  assert.equal(channelForPhase('idle'), 'post_event_screen');
  const e = FOUR_EVENTS[0];
  assert.equal(eventLinkForPhase(e, 'before_start'), 'https://l.the-anchor.pub/pree1');
  assert.equal(eventLinkForPhase(e, 'in_game', 'break'), 'https://l.the-anchor.pub/gamee1');
  assert.equal(eventLinkForPhase(e, 'night_over'), 'https://l.the-anchor.pub/poste1');
});

// ---- Before the start -------------------------------------------------------

test('before the start: follow-along leads, then the kit loop, and the rules once a loop, last', () => {
  const slides = buildPlaylist('before_start', FULL, NOW_MS, SESSION_DATE);
  assert.deepEqual(shape(slides), [
    'follow_along', 'next:b2', 'e1', 'e2',
    'follow_along', 'whats_on', 'e3', 'e4',
    'rules',
  ]);
});

test('before the start the event QR codes are the pre-event links', () => {
  const slides = buildPlaylist('before_start', FULL, NOW_MS, SESSION_DATE);
  for (const slide of slides) {
    if (slide.kind === 'event' || slide.kind === 'next_night') {
      assert.equal(slide.qrUrl, slide.event.links.pre_event_screen);
    }
  }
});

for (const [name, value] of FAILED_FEEDS) {
  test(`before the start with ${name}: follow-along, what's on and the rules, never an error`, () => {
    assert.deepEqual(shape(buildPlaylist('before_start', value, NOW_MS, SESSION_DATE)), ['follow_along', 'whats_on', 'rules']);
  });
}

test("tonight's own bingo night is never the next one, judged by London date", () => {
  const tonight = bingo('b1', '2026-11-18T19:00:00Z');
  const slides = buildPlaylist('before_start', feed({ nights: [tonight] }), NOW_MS, SESSION_DATE);
  assert.deepEqual(shape(slides), ['follow_along', 'whats_on', 'rules']);
  const withNext = buildPlaylist('before_start', feed({ nights: [tonight, NEXT_BINGO] }), NOW_MS, SESSION_DATE);
  assert.ok(shape(withNext).includes('next:b2'));
  assert.ok(!shape(withNext).includes('next:b1'));
});

test('events that have started drop out at render time', () => {
  const started = event('old', '2026-11-18T18:00:00Z');
  const slides = buildPlaylist('before_start', feed({ events: [started, FOUR_EVENTS[0]] }), NOW_MS, SESSION_DATE);
  assert.ok(!shape(slides).includes('old'));
  assert.ok(shape(slides).includes('e1'));
});

// ---- A break and between games ---------------------------------------------

test('a break: the break screen leads, the in-game links, and the rules last', () => {
  const slides = buildPlaylist('in_game', FULL, NOW_MS, SESSION_DATE, { inGameSubState: 'break' });
  assert.deepEqual(shape(slides), ['break', 'next:b2', 'e1', 'e2', 'break', 'whats_on', 'e3', 'e4', 'rules']);
  for (const slide of slides) {
    if (slide.kind === 'event' || slide.kind === 'next_night') {
      assert.equal(slide.qrUrl, slide.event.links.in_game_screen);
    }
  }
});

test('between games: the next game screen leads the same loop', () => {
  const slides = buildPlaylist('between_games', FULL, NOW_MS, SESSION_DATE);
  assert.deepEqual(shape(slides), ['next_game', 'next:b2', 'e1', 'e2', 'next_game', 'whats_on', 'e3', 'e4', 'rules']);
});

test('a break with nothing to show: the break screen, what is on and the rules', () => {
  for (const [, value] of FAILED_FEEDS) {
    assert.deepEqual(shape(buildPlaylist('in_game', value, NOW_MS, SESSION_DATE, { inGameSubState: 'break' })), [
      'break',
      'whats_on',
      'rules',
    ]);
  }
});

test('a game being called, a claim or a win has no loop', () => {
  for (const sub of ['calling', 'claim_check', 'win'] as const) {
    assert.deepEqual(buildPlaylist('in_game', FULL, NOW_MS, SESSION_DATE, { inGameSubState: sub }), []);
  }
});

test('the break loop has unique keys and preloads the next image, wrapping round', () => {
  const withImage: ScreenEvent = {
    ...FOUR_EVENTS[0],
    image: { url: 'https://example.invalid/a.png', alt: 'A', square: false },
  };
  const slides = buildPlaylist('in_game', feed({ events: [withImage] }), NOW_MS, SESSION_DATE, { inGameSubState: 'break' });
  assert.equal(new Set(slides.map((s) => s.key)).size, slides.length);
  const before = slides[slides.findIndex((s) => s.kind === 'event') - 1];
  assert.equal(before.preloadImage?.url, 'https://example.invalid/a.png');
  assert.equal(slides.at(-1)?.preloadImage ?? null, null);
});

// ---- The end of the night ---------------------------------------------------

test("after the night: the thank-you with Cash Bingo's own review link and the next bingo night, then two events", () => {
  const slides = buildPlaylist('night_over', FULL, NOW_MS, SESSION_DATE);
  assert.deepEqual(shape(slides), ['thank_you', 'e1', 'e2']);
  const thanks = slides[0];
  assert.equal(thanks.kind, 'thank_you');
  if (thanks.kind !== 'thank_you') return;
  assert.equal(thanks.reviewUrl, REVIEW_URL);
  assert.equal(thanks.reviewUrl, 'https://l.the-anchor.pub/cvf4k7');
  assert.equal(thanks.nextNight?.id, 'b2');
  assert.equal(thanks.nextNightQr, NEXT_BINGO.links.post_event_screen);
});

for (const [name, value] of FAILED_FEEDS) {
  test(`after the night with ${name}: the review card stays and What's on next falls back to See what's on`, () => {
    const slides = buildPlaylist('night_over', value, NOW_MS, SESSION_DATE);
    assert.deepEqual(shape(slides), ['thank_you']);
    const thanks = slides[0];
    if (thanks.kind !== 'thank_you') throw new Error('expected the thank-you');
    assert.equal(thanks.reviewUrl, REVIEW_URL);
    // No next night and not hidden: the kit's ThankYouSlide draws "See what's on".
    assert.equal(thanks.nextNight, null);
    assert.equal(thanks.nextNightQr, null);
    assert.equal(thanks.hideNext, false);
  });
}

// ---- Idle /display ----------------------------------------------------------

test('idle: what is on leads, then the next bingo night and the events two at a time', () => {
  const slides = buildPlaylist('idle', FULL, NOW_MS, null);
  assert.deepEqual(shape(slides), ['whats_on', 'next:b2', 'e1', 'e2', 'whats_on', 'e3', 'e4']);
  for (const slide of slides) {
    if (slide.kind === 'event' || slide.kind === 'next_night') {
      assert.equal(slide.qrUrl, slide.event.links.post_event_screen);
    }
  }
});

test('idle with nothing to show is the what is on slide alone', () => {
  for (const [, value] of FAILED_FEEDS) {
    assert.deepEqual(shape(buildPlaylist('idle', value, NOW_MS, null)), ['whats_on']);
  }
});

// ---- Timings (Anchor Nights S7.4) ------------------------------------------

test('events and the next bingo night run 12 seconds, every other slide 20', () => {
  const slides = [
    ...buildPlaylist('before_start', FULL, NOW_MS, SESSION_DATE),
    ...buildPlaylist('night_over', FULL, NOW_MS, SESSION_DATE),
  ];
  for (const slide of slides) {
    const expected = slide.kind === 'event' || slide.kind === 'next_night' ? 12_000 : 20_000;
    assert.equal(slide.durationMs, expected, slide.key);
  }
});

// ---- Phones -----------------------------------------------------------------

test('a phone lists the next bingo night first, then the events, never tonight', () => {
  const tonight = bingo('b1', '2026-11-18T19:00:00Z');
  const items = getPhoneEventList(feed({ events: FOUR_EVENTS.slice(0, 2), nights: [tonight, NEXT_BINGO] }), NOW_MS, SESSION_DATE);
  assert.deepEqual(
    items.map((item) => [item.event.id, item.isNextBingo]),
    [['b2', true], ['e1', false], ['e2', false]]
  );
  assert.deepEqual(getPhoneEventList(feed({ status: 'error' }), NOW_MS, SESSION_DATE), []);
  assert.deepEqual(getPhoneEventList(null, NOW_MS, SESSION_DATE), []);
});

// ---- One QR code at a time --------------------------------------------------

test('only one QR code at a time: which slides carry their own', () => {
  const app = (id: string): Slide => ({ key: id, kind: 'app', id, durationMs: 20_000 });
  const [whatsOn] = buildPlaylist('idle', null, NOW_MS, null);
  const [thanks] = buildPlaylist('night_over', null, NOW_MS, SESSION_DATE);
  const eventSlide = buildPlaylist('idle', FULL, NOW_MS, null).find((s) => s.kind === 'event');
  assert.ok(eventSlide);

  assert.equal(slideCarriesQr(app('follow_along')), true);
  assert.equal(slideCarriesQr(app('rules')), false);
  assert.equal(slideCarriesQr(app('break')), false);
  assert.equal(slideCarriesQr(app('next_game')), false);
  assert.equal(slideCarriesQr(whatsOn), true);
  assert.equal(slideCarriesQr(thanks), true);
  assert.equal(slideCarriesQr(eventSlide), true);

  // The corner card: beside the rules and the next game screen only.
  assert.equal(slideAllowsCornerQr(app('rules')), true);
  assert.equal(slideAllowsCornerQr(app('next_game')), true);
  assert.equal(slideAllowsCornerQr(app('break')), false);
  assert.equal(slideAllowsCornerQr(app('follow_along')), false);
  assert.equal(slideAllowsCornerQr(whatsOn), false);
  assert.equal(slideAllowsCornerQr(eventSlide), false);

  // The top bar's status label: over slides about something else.
  assert.equal(slideShowsStatusInTopBar(eventSlide), true);
  assert.equal(slideShowsStatusInTopBar(whatsOn), true);
  assert.equal(slideShowsStatusInTopBar(app('rules')), false);
  assert.equal(slideShowsStatusInTopBar(app('break')), false);

  assert.equal(isBingoSlide(app('break'), 'break'), true);
  assert.equal(isBingoSlide(whatsOn, 'break'), false);
  assert.equal(isBingoSlide(null, 'break'), false);
});
