// src/lib/playlist.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPlaylist,
  getUsableEvents,
  playlistSignature,
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

test('the end of the night and the idle page keep their own screens until the events slice', () => {
  assert.deepEqual(buildPlaylist('night_over', null, NOW, SESSION_DATE), []);
  assert.deepEqual(buildPlaylist('idle', null, NOW, null), []);
});

test('slide keys are unique within a loop', () => {
  for (const slides of [
    buildPlaylist('before_start', null, NOW, SESSION_DATE),
    buildPlaylist('between_games', null, NOW, SESSION_DATE),
    buildPlaylist('in_game', null, NOW, SESSION_DATE, { inGameSubState: 'break' }),
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
