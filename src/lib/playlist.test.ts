// src/lib/playlist.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPlaylist,
  chooseEventsProjection,
  eventLinkForPhase,
  getPhoneEventList,
  getUsableEvents,
  playlistSignature,
  readEventsProjection,
  slideAllowsCornerQr,
  slideCarriesQr,
  slideShowsStatusInTopBar,
  type Slide,
} from './playlist';
import type { EventsProjection, ScreenEvent } from './events-feed/types';

const NOW = new Date('2026-11-18T18:30:00Z');
const SESSION_DATE = '2026-11-18';

const event = (id: string, startsAt: string, category: string | null = 'music'): ScreenEvent => ({
  id,
  title: `Event ${id}`,
  startsAt,
  category,
  image: null,
  qrPre: `https://www.the-anchor.pub/events/${id}?utm_source=pre&utm_medium=screen`,
  qrInGame: `https://www.the-anchor.pub/events/${id}?utm_source=in_game&utm_medium=screen`,
  qrPost: `https://www.the-anchor.pub/events/${id}?utm_source=post&utm_medium=screen`,
});

const projection = (overrides: Partial<EventsProjection> = {}): EventsProjection => ({
  status: 'ok',
  fetchedAt: '2026-11-18T18:00:00Z',
  events: [],
  bingoNights: [],
  ...overrides,
});

const kinds = (slides: { kind: string }[]) => slides.map((slide) => slide.kind);

const BUCKET = 'https://tfcasgxopxegwrabvwat.supabase.co/storage/v1/object/public/event-images/events';

/** E1 to E`count`, a day apart from 20 November, each with a landscape image. */
const upcomingEvents = (count: number): ScreenEvent[] =>
  Array.from({ length: count }, (_, i) => ({
    ...event(`e${i + 1}`, `2026-11-${String(20 + i).padStart(2, '0')}T19:00:00Z`),
    image: { url: `${BUCKET}/e${i + 1}/landscape.png`, alt: `Event e${i + 1}`, square: false },
  }));

const TONIGHTS_BINGO = event('bingo-tonight', '2026-11-18T19:30:00Z', 'bingo-night');
const NEXT_BINGO: ScreenEvent = {
  ...event('bingo-next', '2026-12-16T19:30:00Z', 'bingo-night'),
  image: { url: `${BUCKET}/bingo-next/square.png`, alt: 'Cash Bingo', square: true },
};

const fullProjection = (count = 8): EventsProjection =>
  projection({ events: upcomingEvents(count), bingoNights: [TONIGHTS_BINGO, NEXT_BINGO] });

/** A readable picture of a loop: kinds, with the event id for event slides. */
const outline = (slides: Slide[]) =>
  slides.map((slide) => ('event' in slide ? `${slide.kind}:${slide.event.id}` : slide.kind));

const durations = (slides: Slide[]) => slides.map((slide) => slide.durationMs);

test('before the start with no events: follow-along for 30 seconds, then the rules for 20', () => {
  const slides = buildPlaylist('before_start', null, NOW, SESSION_DATE);
  assert.deepEqual(kinds(slides), ['follow_along', 'rules']);
  assert.deepEqual(slides.map((slide) => slide.durationMs), [30_000, 20_000]);
});

test('an events error gives the same fallback loop, never an error slide', () => {
  const slides = buildPlaylist('before_start', projection({ status: 'error', events: [event('a', '2026-11-20T19:00:00Z')] }), NOW, SESSION_DATE);
  assert.deepEqual(slides.map((slide) => slide.durationMs), [30_000, 20_000]);
  assert.deepEqual(kinds(slides), ['follow_along', 'rules']);
});

test('with events to show the follow-along runs 20 seconds', () => {
  const slides = buildPlaylist('before_start', projection({ events: [event('a', '2026-11-20T19:00:00Z')] }), NOW, SESSION_DATE);
  assert.equal(slides[0].kind, 'follow_along');
  assert.equal(slides[0].durationMs, 20_000);
});

test('events that have all started count as no events', () => {
  const slides = buildPlaylist('before_start', projection({ events: [event('a', '2026-11-18T18:00:00Z')] }), NOW, SESSION_DATE);
  assert.equal(slides[0].durationMs, 30_000);
});

test('between games: the next game, then the rules', () => {
  assert.deepEqual(kinds(buildPlaylist('between_games', null, NOW, SESSION_DATE)), ['next_game', 'rules']);
});

test('a break: the break screen, then the rules', () => {
  assert.deepEqual(
    kinds(buildPlaylist('in_game', null, NOW, SESSION_DATE, { inGameSubState: 'break' })),
    ['break', 'rules']
  );
});

test('a game being called, a claim or a win has no loop', () => {
  for (const sub of ['calling', 'claim_check', 'win'] as const) {
    assert.deepEqual(buildPlaylist('in_game', null, NOW, SESSION_DATE, { inGameSubState: sub }), []);
  }
  assert.deepEqual(buildPlaylist('in_game', null, NOW, SESSION_DATE), []);
});

test('slide keys are unique within a loop', () => {
  const full = fullProjection();
  for (const slides of [
    buildPlaylist('before_start', null, NOW, SESSION_DATE),
    buildPlaylist('between_games', null, NOW, SESSION_DATE),
    buildPlaylist('in_game', null, NOW, SESSION_DATE, { inGameSubState: 'break' }),
    buildPlaylist('before_start', full, NOW, SESSION_DATE),
    buildPlaylist('night_over', full, NOW, SESSION_DATE, { reviewEnabled: true }),
    buildPlaylist('night_over', full, NOW, SESSION_DATE),
    buildPlaylist('idle', full, NOW, null),
  ]) {
    assert.equal(new Set(slides.map((slide) => slide.key)).size, slides.length);
  }
});

test('the signature changes with the slides and not otherwise', () => {
  const a = buildPlaylist('before_start', null, NOW, SESSION_DATE);
  const b = buildPlaylist('before_start', null, new Date('2026-11-18T18:31:00Z'), SESSION_DATE);
  const c = buildPlaylist('between_games', null, NOW, SESSION_DATE);
  assert.equal(playlistSignature(a), playlistSignature(b));
  assert.notEqual(playlistSignature(a), playlistSignature(c));
});

test('usable events drop anything that has started', () => {
  const usable = getUsableEvents(
    projection({ events: [event('past', '2026-11-18T18:00:00Z'), event('soon', '2026-11-18T19:00:00Z')] }),
    NOW,
    SESSION_DATE
  );
  assert.deepEqual(usable.events.map((e) => e.id), ['soon']);
});

test("the next bingo skips tonight's own bingo night, judged by London date", () => {
  const usable = getUsableEvents(
    projection({
      bingoNights: [
        event('tonight', '2026-11-18T19:30:00Z', 'bingo-night'),
        event('next', '2026-12-16T19:30:00Z', 'bingo-night'),
      ],
    }),
    NOW,
    SESSION_DATE
  );
  assert.equal(usable.nextBingo?.id, 'next');
});

test('the London date decides "tonight" either side of the clock change', () => {
  // 23:30 UTC on 24 October is 00:30 BST on 25 October: a different night.
  const late = event('late', '2026-10-24T23:30:00Z', 'bingo-night');
  assert.equal(
    getUsableEvents(projection({ bingoNights: [late] }), new Date('2026-10-24T18:00:00Z'), '2026-10-24').nextBingo?.id,
    'late'
  );
  assert.equal(
    getUsableEvents(projection({ bingoNights: [late] }), new Date('2026-10-24T18:00:00Z'), '2026-10-25').nextBingo,
    null
  );
});

test('a missing, empty or failed projection gives nothing to show', () => {
  assert.deepEqual(getUsableEvents(null, NOW, SESSION_DATE), { events: [], nextBingo: null });
  assert.deepEqual(getUsableEvents(projection({ status: 'no_events' }), NOW, SESSION_DATE), {
    events: [],
    nextBingo: null,
  });
  assert.deepEqual(getUsableEvents(projection({ status: 'missing_config' }), NOW, SESSION_DATE), {
    events: [],
    nextBingo: null,
  });
});

// ---- before_start (spec 5.5) -------------------------------------------------

test('before the start: follow-along, next bingo, two events, follow-along, rules, two more, and so on', () => {
  const slides = buildPlaylist('before_start', fullProjection(), NOW, SESSION_DATE);
  assert.deepEqual(outline(slides), [
    'follow_along', 'next_bingo:bingo-next', 'event:e1', 'event:e2',
    'follow_along', 'rules', 'event:e3', 'event:e4',
    'follow_along', 'next_bingo:bingo-next', 'event:e5', 'event:e6',
    'follow_along', 'rules', 'event:e7', 'event:e8',
  ]);
  assert.deepEqual(durations(slides).slice(0, 8), [20_000, 12_000, 12_000, 12_000, 20_000, 20_000, 12_000, 12_000]);
});

test('before the start the event QR codes are the pre-event links', () => {
  const slides = buildPlaylist('before_start', fullProjection(2), NOW, SESSION_DATE);
  for (const slide of slides) {
    if ('event' in slide) assert.equal(slide.qrUrl, slide.event.qrPre);
  }
  assert.ok(slides.some((slide) => 'event' in slide));
});

test('before the start with one event the rules still show once a loop', () => {
  const slides = buildPlaylist('before_start', fullProjection(1), NOW, SESSION_DATE);
  assert.deepEqual(outline(slides), ['follow_along', 'next_bingo:bingo-next', 'event:e1', 'follow_along', 'rules']);
});

test('before the start with no next bingo night its slot is skipped, not filled', () => {
  const slides = buildPlaylist('before_start', projection({ events: upcomingEvents(4) }), NOW, SESSION_DATE);
  assert.deepEqual(outline(slides), [
    'follow_along', 'event:e1', 'event:e2',
    'follow_along', 'rules', 'event:e3', 'event:e4',
  ]);
});

test('before the start with only a next bingo night: follow-along, next bingo, follow-along, rules', () => {
  const slides = buildPlaylist('before_start', projection({ bingoNights: [NEXT_BINGO] }), NOW, SESSION_DATE);
  assert.deepEqual(outline(slides), ['follow_along', 'next_bingo:bingo-next', 'follow_along', 'rules']);
  assert.deepEqual(durations(slides), [20_000, 12_000, 20_000, 20_000]);
});

test("tonight's own bingo night alone counts as nothing to show before the start", () => {
  const slides = buildPlaylist('before_start', projection({ bingoNights: [TONIGHTS_BINGO] }), NOW, SESSION_DATE);
  assert.deepEqual(outline(slides), ['follow_along', 'rules']);
  assert.deepEqual(durations(slides), [30_000, 20_000]);
});

test('before the start, no events, an error and no key all give the fallback loop', () => {
  for (const status of ['no_events', 'error', 'missing_config'] as const) {
    const slides = buildPlaylist('before_start', projection({ status, events: upcomingEvents(2) }), NOW, SESSION_DATE);
    assert.deepEqual(outline(slides), ['follow_along', 'rules'], status);
    assert.deepEqual(durations(slides), [30_000, 20_000], status);
  }
});

// ---- night_over (spec 5.5, 5.6) ----------------------------------------------

test('after the night with review off: thanks, next bingo, events, and thanks again after every two', () => {
  const slides = buildPlaylist('night_over', fullProjection(), NOW, SESSION_DATE);
  assert.deepEqual(outline(slides), [
    'thanks', 'next_bingo:bingo-next', 'event:e1', 'event:e2',
    'thanks', 'event:e3', 'event:e4',
    'thanks', 'event:e5', 'event:e6',
    'thanks', 'event:e7', 'event:e8',
  ]);
  assert.deepEqual(durations(slides).slice(0, 5), [15_000, 12_000, 12_000, 12_000, 15_000]);
});

test('after the night with review on: thanks, review, next bingo, events, then thanks and review take turns', () => {
  const slides = buildPlaylist('night_over', fullProjection(), NOW, SESSION_DATE, { reviewEnabled: true });
  assert.deepEqual(outline(slides), [
    'thanks', 'review', 'next_bingo:bingo-next', 'event:e1', 'event:e2',
    'thanks', 'event:e3', 'event:e4',
    'review', 'event:e5', 'event:e6',
    'thanks', 'event:e7', 'event:e8',
  ]);
  assert.deepEqual(durations(slides).slice(0, 2), [15_000, 20_000]);
});

test('after the night the event QR codes are the post-event links', () => {
  const slides = buildPlaylist('night_over', fullProjection(2), NOW, SESSION_DATE);
  const eventSlides = slides.filter((slide) => 'event' in slide);
  assert.equal(eventSlides.length, 3);
  for (const slide of eventSlides) {
    if ('event' in slide) assert.equal(slide.qrUrl, slide.event.qrPost);
  }
});

test('after the night with nothing to show: thanks, then review only when it is on', () => {
  for (const proj of [null, projection({ status: 'error' }), projection({ status: 'missing_config' }), projection({ status: 'no_events' })]) {
    assert.deepEqual(outline(buildPlaylist('night_over', proj, NOW, SESSION_DATE)), ['thanks']);
    assert.deepEqual(outline(buildPlaylist('night_over', proj, NOW, SESSION_DATE, { reviewEnabled: true })), ['thanks', 'review']);
  }
});

test("after the night tonight's own bingo night is never the next one", () => {
  const slides = buildPlaylist('night_over', projection({ bingoNights: [TONIGHTS_BINGO, NEXT_BINGO] }), NOW, SESSION_DATE);
  assert.deepEqual(outline(slides), ['thanks', 'next_bingo:bingo-next']);
});

test('the review slide appears in no loop unless it is switched on', () => {
  const full = fullProjection();
  for (const phase of ['before_start', 'between_games', 'in_game', 'night_over', 'idle'] as const) {
    for (const opts of [{}, { reviewEnabled: false }]) {
      const slides = buildPlaylist(phase, full, NOW, phase === 'idle' ? null : SESSION_DATE, opts);
      assert.equal(slides.some((slide) => slide.kind === 'review'), false, phase);
    }
  }
  // And only ever after the night, even when it is on.
  for (const phase of ['before_start', 'between_games', 'idle'] as const) {
    const slides = buildPlaylist(phase, full, NOW, phase === 'idle' ? null : SESSION_DATE, { reviewEnabled: true });
    assert.equal(slides.some((slide) => slide.kind === 'review'), false, phase);
  }
});

// ---- a break in a game: events while the game is paused -------------------------

const onBreak = { inGameSubState: 'break' } as const;
const breakLoop = (proj: EventsProjection | null) => buildPlaylist('in_game', proj, NOW, SESSION_DATE, onBreak);

/** Exactly what a break looped through before events were added to it. */
const BREAK_FALLBACK = [
  { key: 'break-0', kind: 'break', durationMs: 20_000 },
  { key: 'rules-0', kind: 'rules', durationMs: 20_000 },
];

test('a break with nothing to show is exactly the break screen and the rules, as before', () => {
  for (const proj of [
    null,
    projection(),
    projection({ status: 'error', events: upcomingEvents(2), bingoNights: [NEXT_BINGO] }),
    projection({ status: 'missing_config', events: upcomingEvents(2), bingoNights: [NEXT_BINGO] }),
    projection({ status: 'no_events', events: upcomingEvents(2), bingoNights: [NEXT_BINGO] }),
    // Only events that have started, and only tonight's own bingo night.
    projection({ events: [event('past', '2026-11-18T18:00:00Z')], bingoNights: [TONIGHTS_BINGO] }),
  ]) {
    assert.deepEqual(breakLoop(proj), BREAK_FALLBACK, proj?.status ?? 'null');
  }
});

test('a break with one event: break, next bingo, the event, then the rules', () => {
  assert.deepEqual(outline(breakLoop(fullProjection(1))), ['break', 'next_bingo:bingo-next', 'event:e1', 'rules']);
  assert.deepEqual(durations(breakLoop(fullProjection(1))), [20_000, 12_000, 12_000, 20_000]);
  const withoutBingo = breakLoop(projection({ events: upcomingEvents(1) }));
  assert.deepEqual(outline(withoutBingo), ['break', 'event:e1', 'rules']);
  assert.deepEqual(durations(withoutBingo), [20_000, 12_000, 20_000]);
});

test('a break with three events: the break screen comes back after every two', () => {
  assert.deepEqual(outline(breakLoop(fullProjection(3))), [
    'break', 'next_bingo:bingo-next', 'event:e1', 'event:e2',
    'break', 'event:e3',
    'rules',
  ]);
  assert.deepEqual(durations(breakLoop(fullProjection(3))), [20_000, 12_000, 12_000, 12_000, 20_000, 12_000, 20_000]);
  assert.deepEqual(outline(breakLoop(projection({ events: upcomingEvents(3) }))), [
    'break', 'event:e1', 'event:e2',
    'break', 'event:e3',
    'rules',
  ]);
});

test('a break with six events: break, next bingo, two events, break, two more, and the rules once a loop', () => {
  const slides = breakLoop(fullProjection(6));
  assert.deepEqual(outline(slides), [
    'break', 'next_bingo:bingo-next', 'event:e1', 'event:e2',
    'break', 'event:e3', 'event:e4',
    'break', 'event:e5', 'event:e6',
    'rules',
  ]);
  assert.deepEqual(durations(slides), [
    20_000, 12_000, 12_000, 12_000,
    20_000, 12_000, 12_000,
    20_000, 12_000, 12_000,
    20_000,
  ]);
  assert.equal(kinds(slides).filter((kind) => kind === 'rules').length, 1);
  assert.deepEqual(outline(breakLoop(projection({ events: upcomingEvents(6) }))), [
    'break', 'event:e1', 'event:e2',
    'break', 'event:e3', 'event:e4',
    'break', 'event:e5', 'event:e6',
    'rules',
  ]);
});

test('a break with only a next bingo night: break, next bingo, rules', () => {
  const slides = breakLoop(projection({ bingoNights: [TONIGHTS_BINGO, NEXT_BINGO] }));
  assert.deepEqual(outline(slides), ['break', 'next_bingo:bingo-next', 'rules']);
  assert.deepEqual(durations(slides), [20_000, 12_000, 20_000]);
});

test('on a break the event QR codes are the in-game links', () => {
  const eventSlides = breakLoop(fullProjection(3)).filter((slide) => 'event' in slide);
  assert.equal(eventSlides.length, 4);
  for (const slide of eventSlides) {
    if ('event' in slide) assert.equal(slide.qrUrl, slide.event.qrInGame);
  }
});

test('the break loop has unique keys and preloads the next image, wrapping to the break screen', () => {
  const slides = breakLoop(fullProjection(6));
  assert.equal(new Set(slides.map((slide) => slide.key)).size, slides.length);
  // break -> next bingo (square) -> e1 -> e2 -> break.
  assert.equal(slides[0].preloadImage?.url, NEXT_BINGO.image?.url);
  assert.equal(slides[1].preloadImage?.url, `${BUCKET}/e1/landscape.png`);
  assert.equal(slides[3].preloadImage, null);
  // The rules wrap round to the break screen, which has no image.
  assert.equal(slides[slides.length - 1].preloadImage, null);
});

test('an event that starts during a break drops out of the loop', () => {
  const proj = fullProjection(3);
  const later = buildPlaylist('in_game', proj, new Date('2026-11-20T19:01:00Z'), SESSION_DATE, onBreak);
  assert.deepEqual(outline(later), ['break', 'next_bingo:bingo-next', 'event:e2', 'event:e3', 'rules']);
  assert.notEqual(playlistSignature(breakLoop(proj)), playlistSignature(later));
});

test('events are for a break only: a game being called, a claim or a win still has no loop', () => {
  for (const sub of ['calling', 'claim_check', 'win'] as const) {
    assert.deepEqual(buildPlaylist('in_game', fullProjection(), NOW, SESSION_DATE, { inGameSubState: sub }), []);
  }
  assert.deepEqual(buildPlaylist('in_game', fullProjection(), NOW, SESSION_DATE), []);
});

test('between games with nothing to show is the next game and the rules, as before', () => {
  const expected = [
    { key: 'next_game-0', kind: 'next_game', durationMs: 20_000 },
    { key: 'rules-0', kind: 'rules', durationMs: 20_000 },
  ];
  for (const proj of [
    null,
    projection(),
    projection({ status: 'error', events: upcomingEvents(2), bingoNights: [NEXT_BINGO] }),
    projection({ status: 'missing_config', events: upcomingEvents(2), bingoNights: [NEXT_BINGO] }),
    projection({ events: [event('past', '2026-11-18T18:00:00Z')], bingoNights: [TONIGHTS_BINGO] }),
  ]) {
    assert.deepEqual(buildPlaylist('between_games', proj, NOW, SESSION_DATE), expected, proj?.status ?? 'null');
  }
});

test('between games shows the events as a break does, around the next game screen', () => {
  const slides = buildPlaylist('between_games', fullProjection(3), NOW, SESSION_DATE);
  assert.deepEqual(outline(slides), [
    'next_game', 'next_bingo:bingo-next', 'event:e1', 'event:e2',
    'next_game', 'event:e3',
    'rules',
  ]);
  assert.deepEqual(durations(slides), [20_000, 12_000, 12_000, 12_000, 20_000, 12_000, 20_000]);
  assert.equal(new Set(slides.map((slide) => slide.key)).size, slides.length);
  assert.equal(slides.some((slide) => slide.kind === 'break'), false);
  // The break option belongs to a game: it changes nothing between games.
  assert.deepEqual(buildPlaylist('between_games', fullProjection(3), NOW, SESSION_DATE, onBreak), slides);
});

test('between games the event QR codes are the in-game links', () => {
  const eventSlides = buildPlaylist('between_games', fullProjection(3), NOW, SESSION_DATE).filter((slide) => 'event' in slide);
  assert.equal(eventSlides.length, 4);
  for (const slide of eventSlides) {
    if ('event' in slide) assert.equal(slide.qrUrl, slide.event.qrInGame);
  }
});

test('the break option changes nothing before the start, after the night or when idle', () => {
  const full = fullProjection();
  for (const phase of ['before_start', 'night_over', 'idle'] as const) {
    const date = phase === 'idle' ? null : SESSION_DATE;
    assert.deepEqual(buildPlaylist(phase, full, NOW, date, onBreak), buildPlaylist(phase, full, NOW, date), phase);
    const slides = buildPlaylist(phase, full, NOW, date, onBreak);
    assert.equal(slides.some((slide) => slide.kind === 'break'), false, phase);
    for (const slide of slides) {
      if ('event' in slide) assert.notEqual(slide.qrUrl, slide.event.qrInGame, phase);
    }
  }
});

test('only one QR code at a time: which slides carry their own', () => {
  for (const kind of ['event', 'next_bingo', 'follow_along', 'review', 'idle_bingo'] as const) {
    assert.equal(slideCarriesQr(kind), true, kind);
  }
  for (const kind of ['break', 'rules', 'next_game', 'thanks'] as const) {
    assert.equal(slideCarriesQr(kind), false, kind);
  }
});

test('the corner follow-along card stays off the Break time card and off any slide with its own code', () => {
  // The Break time card stands alone, centred, although it has no code of its own.
  assert.equal(slideAllowsCornerQr('break'), false);
  for (const kind of ['event', 'next_bingo', 'follow_along', 'review', 'idle_bingo'] as const) {
    assert.equal(slideAllowsCornerQr(kind), false, kind);
  }
  // The rules and the next game keep it, so a late arrival can still join in.
  for (const kind of ['rules', 'next_game', 'thanks'] as const) {
    assert.equal(slideAllowsCornerQr(kind), true, kind);
  }
});

test('only the event and next-bingo slides hand their status label to the top bar', () => {
  for (const kind of ['event', 'next_bingo'] as const) {
    assert.equal(slideShowsStatusInTopBar(kind), true, kind);
  }
  // The break card and the next-game card say it themselves; the rules slide
  // carries its own label; the rest are shown outside a break.
  for (const kind of ['break', 'next_game', 'rules', 'follow_along', 'review', 'idle_bingo', 'thanks'] as const) {
    assert.equal(slideShowsStatusInTopBar(kind), false, kind);
  }
});

// ---- idle /display (spec 5.5) --------------------------------------------------

test('the idle screen: "Bingo nights at The Anchor", the next bingo night, then the events', () => {
  const slides = buildPlaylist('idle', fullProjection(3), NOW, null);
  assert.deepEqual(outline(slides), [
    'idle_bingo', 'next_bingo:bingo-tonight', 'event:e1', 'event:e2', 'event:e3',
  ]);
  assert.deepEqual(durations(slides), [20_000, 12_000, 12_000, 12_000, 12_000]);
  for (const slide of slides) {
    if ('event' in slide) assert.equal(slide.qrUrl, slide.event.qrPost);
  }
});

test('the idle screen with nothing to show is the "Bingo nights at The Anchor" slide alone', () => {
  for (const proj of [null, projection({ status: 'error' }), projection({ status: 'missing_config' }), projection()]) {
    assert.deepEqual(outline(buildPlaylist('idle', proj, NOW, null)), ['idle_bingo']);
  }
});

// ---- Preloading and stability --------------------------------------------------

test("every slide carries the next slide's image, wrapping round to the first", () => {
  const slides = buildPlaylist('idle', projection({ events: upcomingEvents(2), bingoNights: [NEXT_BINGO] }), NOW, null);
  // idle_bingo, next_bingo (square), e1, e2.
  assert.equal(slides[0].preloadImage?.url, NEXT_BINGO.image?.url);
  assert.equal(slides[1].preloadImage?.url, `${BUCKET}/e1/landscape.png`);
  assert.equal(slides[2].preloadImage?.url, `${BUCKET}/e2/landscape.png`);
  // The last slide wraps to idle_bingo, which has no image.
  assert.equal(slides[3].preloadImage, null);
});

test('a single-slide loop preloads nothing', () => {
  const [only] = buildPlaylist('night_over', null, NOW, SESSION_DATE);
  assert.equal(only.preloadImage, null);
});

test('an event that starts drops out at render time and changes the signature', () => {
  const proj = fullProjection(2);
  const before = buildPlaylist('before_start', proj, NOW, SESSION_DATE);
  const afterE1 = buildPlaylist('before_start', proj, new Date('2026-11-20T19:01:00Z'), SESSION_DATE);
  assert.ok(outline(before).includes('event:e1'));
  assert.equal(outline(afterE1).includes('event:e1'), false);
  assert.notEqual(playlistSignature(before), playlistSignature(afterE1));
});

test('a refreshed projection with the same events keeps the loop in place', () => {
  const a = buildPlaylist('before_start', fullProjection(), NOW, SESSION_DATE);
  const b = buildPlaylist('before_start', fullProjection(), new Date('2026-11-18T18:35:00Z'), SESSION_DATE);
  assert.equal(playlistSignature(a), playlistSignature(b));
});

// ---- Links, the phone list and reading the route -------------------------------

test('the link for a phase: pre-event before the start, post-event after it and when idle', () => {
  const e = event('x', '2026-11-20T19:00:00Z');
  assert.equal(eventLinkForPhase(e, 'before_start'), e.qrPre);
  assert.equal(eventLinkForPhase(e, 'night_over'), e.qrPost);
  assert.equal(eventLinkForPhase(e, 'idle'), e.qrPost);
});

test('the link on a break in a game is the in-game one', () => {
  const e = event('x', '2026-11-20T19:00:00Z');
  assert.equal(eventLinkForPhase(e, 'in_game', 'break'), e.qrInGame);
});

test('the link for every phase and sub-state', () => {
  const e = event('x', '2026-11-20T19:00:00Z');
  const subStates = [null, 'calling', 'claim_check', 'win', 'break'] as const;
  // The sub-state only matters inside a game: the other phases ignore it.
  for (const sub of subStates) {
    assert.equal(eventLinkForPhase(e, 'before_start', sub), e.qrPre, `before_start ${sub}`);
    assert.equal(eventLinkForPhase(e, 'night_over', sub), e.qrPost, `night_over ${sub}`);
    assert.equal(eventLinkForPhase(e, 'idle', sub), e.qrPost, `idle ${sub}`);
    // Not shown today; the in-game link is ready for when events show between games.
    assert.equal(eventLinkForPhase(e, 'between_games', sub), e.qrInGame, `between_games ${sub}`);
  }
  // In a game, only a break shows events; anything else keeps the old answer.
  assert.equal(eventLinkForPhase(e, 'in_game', 'break'), e.qrInGame);
  for (const sub of [null, 'calling', 'claim_check', 'win'] as const) {
    assert.equal(eventLinkForPhase(e, 'in_game', sub), e.qrPost, `in_game ${sub}`);
  }
  assert.equal(eventLinkForPhase(e, 'in_game'), e.qrPost);
});

test('the phone list puts the next bingo night first and leaves out tonight and started events', () => {
  const proj = projection({
    events: [event('past', '2026-11-18T18:00:00Z'), ...upcomingEvents(2)],
    bingoNights: [TONIGHTS_BINGO, NEXT_BINGO],
  });
  const list = getPhoneEventList(proj, NOW, SESSION_DATE);
  assert.deepEqual(list.map((item) => item.event.id), ['bingo-next', 'e1', 'e2']);
  assert.deepEqual(list.map((item) => item.isNextBingo), [true, false, false]);
  // With no session (/play), tonight's bingo is the next one.
  assert.deepEqual(getPhoneEventList(proj, NOW, null).map((item) => item.event.id), ['bingo-tonight', 'e1', 'e2']);
  // No bingo night to come: just the events, none marked as bingo.
  assert.deepEqual(
    getPhoneEventList(projection({ events: upcomingEvents(1) }), NOW, null).map((item) => item.isNextBingo),
    [false]
  );
  assert.deepEqual(getPhoneEventList(projection({ status: 'error' }), NOW, null), []);
  assert.deepEqual(getPhoneEventList(null, NOW, null), []);
});

test('the route body is read back into a projection, dropping a malformed event alone', () => {
  const good = upcomingEvents(1)[0];
  const read = readEventsProjection({
    status: 'ok',
    fetchedAt: '2026-11-18T18:00:00Z',
    events: [good, { id: 'bad', title: 42 }, null],
    bingoNights: 'not a list',
  });
  assert.deepEqual(read, { status: 'ok', fetchedAt: '2026-11-18T18:00:00Z', events: [good], bingoNights: [] });
});

test('a response from before qrInGame existed is still read: the in-game link falls back to qrPre', () => {
  const current = upcomingEvents(2);
  const { qrInGame: _dropped, ...older } = current[0];
  void _dropped;
  const { qrInGame: _droppedBingo, ...olderBingo } = NEXT_BINGO;
  void _droppedBingo;
  const read = readEventsProjection({
    status: 'ok',
    fetchedAt: '2026-11-18T18:00:00Z',
    // An older event, a current one, and one whose qrInGame is not a string.
    events: [older, current[1], { ...current[1], id: 'odd', qrInGame: 42 }],
    bingoNights: [olderBingo],
  });
  assert.equal(read?.status, 'ok');
  assert.deepEqual(read?.events.map((e) => e.id), ['e1', 'e2', 'odd'], 'no event is dropped');
  assert.equal(read?.events[0].qrInGame, current[0].qrPre);
  assert.equal(read?.events[1].qrInGame, current[1].qrInGame);
  assert.equal(read?.events[2].qrInGame, current[1].qrPre);
  assert.equal(read?.bingoNights[0].qrInGame, NEXT_BINGO.qrPre);
  // So a break still gets its events from an older response.
  assert.deepEqual(outline(buildPlaylist('in_game', read ?? null, NOW, SESSION_DATE, { inGameSubState: 'break' })), [
    'break', 'next_bingo:bingo-next', 'event:e1', 'event:e2',
    'break', 'event:odd',
    'rules',
  ]);
});

test('a body that is not a projection reads as nothing', () => {
  assert.equal(readEventsProjection(null), null);
  assert.equal(readEventsProjection('<html>'), null);
  assert.equal(readEventsProjection({ status: 'teapot', events: [] }), null);
});

test('a malformed image becomes a text-only card rather than dropping the event', () => {
  const read = readEventsProjection({
    status: 'ok',
    fetchedAt: null,
    events: [{ ...event('a', '2026-11-20T19:00:00Z'), image: { url: 7 } }],
    bingoNights: [],
  });
  assert.equal(read?.events[0].image, null);
});

test('an error refresh never replaces a good list; anything else does', () => {
  const good = fullProjection(2);
  assert.equal(chooseEventsProjection(good, projection({ status: 'error' })), good);
  const empty = projection({ status: 'no_events' });
  assert.equal(chooseEventsProjection(good, empty), empty);
  const missing = projection({ status: 'missing_config' });
  assert.equal(chooseEventsProjection(good, missing), missing);
  const error = projection({ status: 'error' });
  assert.equal(chooseEventsProjection(null, error), error);
  assert.equal(chooseEventsProjection(missing, error), error);
});
