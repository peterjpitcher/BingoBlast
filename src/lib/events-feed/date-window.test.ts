// src/lib/events-feed/date-window.test.ts
//
// The date ranges the feed asks for. Calendar arithmetic only, so the answers
// must not move with the server's time zone or a clock change.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDaysToIsoDate, eventsDateWindows } from './date-window';

test('the general list runs 60 days ahead and the bingo query 120', () => {
  assert.deepEqual(eventsDateWindows('2026-10-01'), {
    from: '2026-10-01',
    generalTo: '2026-11-30',
    bingoTo: '2027-01-29',
  });
});

test('adding days crosses month and year ends', () => {
  assert.equal(addDaysToIsoDate('2026-10-31', 1), '2026-11-01');
  assert.equal(addDaysToIsoDate('2026-12-31', 1), '2027-01-01');
  assert.equal(addDaysToIsoDate('2026-11-01', -1), '2026-10-31');
  assert.equal(addDaysToIsoDate('2026-10-01', 0), '2026-10-01');
});

test('clock changes do not shift the date (25 October 2026 and 28 March 2027)', () => {
  assert.equal(addDaysToIsoDate('2026-10-24', 1), '2026-10-25');
  assert.equal(addDaysToIsoDate('2026-10-25', 1), '2026-10-26');
  assert.equal(addDaysToIsoDate('2027-03-27', 2), '2027-03-29');
});

test('leap years are handled', () => {
  assert.equal(addDaysToIsoDate('2028-02-28', 1), '2028-02-29');
  assert.equal(addDaysToIsoDate('2027-02-28', 1), '2027-03-01');
});

test('a malformed or impossible date, or part of a day, throws', () => {
  assert.throws(() => addDaysToIsoDate('2026-02-30', 1));
  assert.throws(() => addDaysToIsoDate('2026-1-1', 1));
  assert.throws(() => addDaysToIsoDate('2026-10-01T00:00:00Z', 1));
  assert.throws(() => addDaysToIsoDate('2026-10-01', 1.5));
});
