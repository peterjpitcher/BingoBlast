// src/lib/events-feed/select.test.ts
//
// Which events reach the screens. Pure and clock-injected, so it gives the
// same answer under TZ=Europe/London and TZ=UTC (npm test and npm run test:utc).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_BINGO_NIGHTS,
  MAX_SCREEN_EVENTS,
  dropStarted,
  hasStarted,
  selectScreenEvents,
  type SelectableEvent,
} from './select';

const NOW = Date.parse('2026-10-07T12:00:00Z');

let nextId = 0;
function ev(title: string, startsAt: string, category: string | null = 'quiz-night-stanwell-moor', status: string | null = 'scheduled'): SelectableEvent {
  nextId += 1;
  return { id: `id-${String(nextId).padStart(3, '0')}`, title, startsAt, category, status };
}

test('an event that has started, or starts right now, is dropped', () => {
  const earlier = ev('Breakfast', '2026-10-07T09:00:00Z');
  const exactlyNow = ev('Lunch', '2026-10-07T12:00:00Z');
  const tonight = ev('Quiz', '2026-10-07T18:00:00Z');
  assert.equal(hasStarted(earlier, NOW), true);
  assert.equal(hasStarted(exactlyNow, NOW), true);
  assert.equal(hasStarted(tonight, NOW), false);
  assert.deepEqual(dropStarted([earlier, exactlyNow, tonight], NOW), [tonight]);

  const { events } = selectScreenEvents([earlier, exactlyNow, tonight], [], NOW);
  assert.deepEqual(events.map((e) => e.title), ['Quiz']);
});

test('an unparseable start counts as started, so it never shows', () => {
  assert.equal(hasStarted({ startsAt: 'soon' }, NOW), true);
});

test('one occurrence per name is kept, the earliest, whatever the input order', () => {
  const later = ev('Quiz Night', '2026-10-14T18:00:00Z');
  const earliest = ev('Quiz Night', '2026-10-07T18:00:00Z');
  const spacing = ev('  quiz   night ', '2026-10-21T18:00:00Z');
  const other = ev('Halloween Party', '2026-10-31T20:00:00Z', 'parties');
  const { events } = selectScreenEvents([later, other, spacing, earliest], [], NOW);
  assert.deepEqual(events.map((e) => e.id), [earliest.id, other.id]);
});

test('the general list is capped at 8, earliest first', () => {
  const many = Array.from({ length: 12 }, (_, i) =>
    ev(`Event ${i}`, `2026-10-${String(20 - i).padStart(2, '0')}T18:00:00Z`),
  );
  const { events } = selectScreenEvents(many, [], NOW);
  assert.equal(MAX_SCREEN_EVENTS, 8);
  assert.equal(events.length, 8);
  assert.deepEqual(
    events.map((e) => e.startsAt),
    ['09', '10', '11', '12', '13', '14', '15', '16'].map((d) => `2026-10-${d}T18:00:00Z`),
  );
});

test('bingo nights leave the general list and feed the next-bingo slot instead', () => {
  const quiz = ev('Quiz Night', '2026-10-07T18:00:00Z');
  const bingoInGeneral = ev('Snowball Showdown Cash Bingo', '2026-11-18T19:00:00Z', 'bingo-night');
  const { events, bingoNights } = selectScreenEvents([quiz, bingoInGeneral], [], NOW);
  assert.deepEqual(events.map((e) => e.id), [quiz.id]);
  assert.deepEqual(bingoNights.map((e) => e.id), [bingoInGeneral.id]);
});

test('Music Bingo is not a bingo night: it stays in the general list', () => {
  const musicBingo = ev('Screams & Soundtracks: Classic Horror Music Bingo', '2026-10-16T18:00:00Z', 'music-bingo');
  const { events, bingoNights } = selectScreenEvents([musicBingo], [], NOW);
  assert.deepEqual(events.map((e) => e.id), [musicBingo.id]);
  assert.deepEqual(bingoNights, []);
});

test('bingo nights are taken out before the cap, so eight other events still show', () => {
  const bingo = Array.from({ length: 4 }, (_, i) => ev(`Cash Bingo ${i}`, `2026-10-0${8 + i}T18:00:00Z`, 'bingo-night'));
  const others = Array.from({ length: 9 }, (_, i) => ev(`Other ${i}`, `2026-10-${12 + i}T18:00:00Z`));
  const { events } = selectScreenEvents([...bingo, ...others], [], NOW);
  assert.equal(events.length, 8);
  assert.ok(events.every((e) => e.category !== 'bingo-night'));
});

test('bingo nights keep every date under the same name, earliest first, merged by id and capped', () => {
  const tonight = ev('Cash Bingo', '2026-10-07T18:00:00Z', 'bingo-night');
  const next = ev('Cash Bingo', '2026-10-21T18:00:00Z', 'bingo-night');
  const started = ev('Cash Bingo', '2026-10-07T11:00:00Z', 'bingo-night');
  // The same event arriving from both queries appears once.
  const { bingoNights } = selectScreenEvents([next], [next, tonight, started], NOW);
  assert.deepEqual(bingoNights.map((e) => e.id), [tonight.id, next.id]);

  const lots = Array.from({ length: 7 }, (_, i) => ev('Cash Bingo', `2026-1${i % 2}-1${i}T18:00:00Z`, 'bingo-night'));
  assert.equal(selectScreenEvents([], lots, NOW).bingoNights.length, MAX_BINGO_NIGHTS);
});

test('an event that is not scheduled is dropped; a missing status counts as scheduled', () => {
  const cancelled = ev('Cancelled Quiz', '2026-10-08T18:00:00Z', 'quiz-night-stanwell-moor', 'cancelled');
  const noStatus = ev('Open Mic', '2026-10-09T18:00:00Z', null, null);
  const cancelledBingo = ev('Cash Bingo', '2026-10-10T18:00:00Z', 'bingo-night', 'cancelled');
  const { events, bingoNights } = selectScreenEvents([cancelled, noStatus], [cancelledBingo], NOW);
  assert.deepEqual(events.map((e) => e.id), [noStatus.id]);
  assert.deepEqual(bingoNights, []);
});

test('selection does not change its inputs', () => {
  const input = [ev('B', '2026-10-09T18:00:00Z'), ev('A', '2026-10-08T18:00:00Z')];
  const copy = input.map((e) => ({ ...e }));
  selectScreenEvents(input, [], NOW);
  assert.deepEqual(input, copy);
});
