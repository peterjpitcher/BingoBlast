// src/lib/dates.test.ts
//
// The bug these pin: on Vercel the runtime is UTC, so a win recorded at 00:30
// London time on a summer night rendered as the previous day, and everything
// rendered in en-US order. The tests below would have failed before the fix and
// would fail again if anyone reaches for toLocaleDateString().
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatDateInLondon,
  formatDateTimeInLondon,
  formatShortDateTimeInLondon,
  getTodayIsoDateInLondon,
  getLondonIsoDate,
  nextLondonFourAm,
} from './dates';

test('a summer timestamp is rendered in British Summer Time, not UTC', () => {
  // 23:30 UTC on 29 July is 00:30 on 30 July in London. Formatting in UTC would
  // print the 29th, which is the fault this replaces.
  assert.equal(formatDateInLondon('2026-07-29T23:30:00Z'), '30 July 2026');
  assert.equal(formatDateTimeInLondon('2026-07-29T23:30:00Z'), '30 July 2026, 00:30');
});

test('a winter timestamp is rendered in GMT', () => {
  assert.equal(formatDateInLondon('2026-01-15T23:30:00Z'), '15 January 2026');
  assert.equal(formatDateTimeInLondon('2026-01-15T23:30:00Z'), '15 January 2026, 23:30');
});

test('day comes before month, because this is a British pub', () => {
  assert.equal(formatDateInLondon('2026-07-04T12:00:00Z'), '4 July 2026');
  assert.match(formatShortDateTimeInLondon('2026-07-04T12:00:00Z'), /^4 Jul 2026, 13:00$/);
});

test('a bare date column is taken at face value and not shifted by a timezone', () => {
  // sessions.start_date is a `date`: it has no time and no zone, so converting
  // it would be the bug rather than the fix.
  assert.equal(formatDateInLondon('2026-07-29'), '29 July 2026');
  assert.equal(formatDateInLondon('2026-01-01'), '1 January 2026');
});

test('times are 24 hour, so 13:00 is not shown as 1:00', () => {
  assert.equal(formatDateTimeInLondon('2026-01-15T13:00:00Z'), '15 January 2026, 13:00');
});

test('null, undefined and rubbish render as empty rather than as Invalid Date', () => {
  assert.equal(formatDateInLondon(null), '');
  assert.equal(formatDateInLondon(undefined), '');
  assert.equal(formatDateInLondon(''), '');
  assert.equal(formatDateInLondon('not a date'), '');
  assert.equal(formatDateTimeInLondon('not a date'), '');
  assert.equal(formatShortDateTimeInLondon(null), '');
});

test("today's date is produced in the shape a Postgres date column wants", () => {
  assert.match(getTodayIsoDateInLondon(), /^\d{4}-\d{2}-\d{2}$/);
});

// getLondonIsoDate and nextLondonFourAm. Every expectation here is a fixed
// instant, so the same assertions must hold under TZ=Europe/London and TZ=UTC.

test('the London date of an instant rolls over at London midnight, not UTC midnight', () => {
  // 23:30 UTC on 29 July is 00:30 BST on 30 July.
  assert.equal(getLondonIsoDate('2026-07-29T23:30:00Z'), '2026-07-30');
  // In winter London is on UTC.
  assert.equal(getLondonIsoDate('2026-12-29T23:30:00Z'), '2026-12-29');
  assert.equal(getLondonIsoDate('not a date'), '');
});

test("today's London date can be taken for a given instant", () => {
  assert.equal(getTodayIsoDateInLondon(new Date('2026-10-24T23:30:00Z')), '2026-10-25');
});

test('a night ending at 21:37 BST holds until 04:00 BST the next morning', () => {
  // Friday 23 October 2026, BST.
  assert.equal(nextLondonFourAm('2026-10-23T20:37:00Z'), '2026-10-24T03:00:00.000Z');
});

test('a night ending on the eve of the clock change holds until 04:00 GMT', () => {
  // Saturday 24 October 21:37 BST. The clocks go back at 02:00 BST on Sunday
  // 25 October, so 04:00 that morning is 04:00 UTC, 7 hours 23 minutes later
  // on the wall clock but 8 hours 23 minutes of real time.
  assert.equal(nextLondonFourAm('2026-10-24T20:37:00Z'), '2026-10-25T04:00:00.000Z');
});

test('a night ending after midnight but before the change holds until 04:00 the same morning', () => {
  // 01:30 BST on Sunday 25 October, before the clocks go back.
  assert.equal(nextLondonFourAm('2026-10-25T00:30:00Z'), '2026-10-25T04:00:00.000Z');
});

test('a night ending the day after the clock change holds until 04:00 GMT', () => {
  // Sunday 25 October 20:00 GMT.
  assert.equal(nextLondonFourAm('2026-10-25T20:00:00Z'), '2026-10-26T04:00:00.000Z');
});

test('exactly 04:00 London time moves on to the next morning', () => {
  assert.equal(nextLondonFourAm('2026-10-24T03:00:00Z'), '2026-10-25T04:00:00.000Z');
});

test('one millisecond before 04:00 London time is still that morning', () => {
  assert.equal(nextLondonFourAm('2026-10-24T02:59:59.999Z'), '2026-10-24T03:00:00.000Z');
});

test('the spring clock change is handled the same way', () => {
  // Saturday 27 March 2027 21:00 GMT; the clocks go forward at 01:00 GMT on
  // Sunday 28 March, so 04:00 that morning is 03:00 UTC.
  assert.equal(nextLondonFourAm('2027-03-27T21:00:00Z'), '2027-03-28T03:00:00.000Z');
});

test('the next 04:00 rolls over the end of a month and a year', () => {
  assert.equal(nextLondonFourAm('2026-12-31T22:00:00Z'), '2027-01-01T04:00:00.000Z');
});

test('rubbish in gives null rather than Invalid Date', () => {
  assert.equal(nextLondonFourAm('not a date'), null);
  assert.equal(nextLondonFourAm(''), null);
});
