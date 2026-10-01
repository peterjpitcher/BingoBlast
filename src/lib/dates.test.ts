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
  formatEventTime,
  formatEventWhen,
  formatEventWhenAndTime,
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

// formatEventWhen and formatEventTime (spec 5.5). The clocks go back at 02:00
// BST on Sunday 25 October 2026; every case below is a fixed instant, so the
// same answers must hold under TZ=Europe/London and TZ=UTC.

test('an event later the same London day is "Tonight", before and after the clock change', () => {
  // Saturday 24 October: 18:00 BST now, 19:00 BST event.
  assert.equal(formatEventWhen('2026-10-24T18:00:00Z', '2026-10-24T17:00:00Z'), 'Tonight');
  // Monday 26 October: 17:00 GMT now, 19:00 GMT event.
  assert.equal(formatEventWhen('2026-10-26T19:00:00Z', '2026-10-26T17:00:00Z'), 'Tonight');
});

test('just after London midnight in BST is already the next day, though UTC has not rolled over', () => {
  // Now is 00:30 BST on Saturday 24 October (23:30 UTC on the 23rd); the
  // event is 19:00 BST the same Saturday. A UTC calendar would say "Tomorrow".
  assert.equal(formatEventWhen('2026-10-24T18:00:00Z', '2026-10-23T23:30:00Z'), 'Tonight');
  // And an event at 00:30 BST on Sunday 25 October, seen at 19:00 BST on the
  // Saturday, is "Tomorrow" even though UTC still calls it Saturday.
  assert.equal(formatEventWhen('2026-10-24T23:30:00Z', '2026-10-24T18:00:00Z'), 'Tomorrow');
});

test('across the clock change "Tomorrow" is the next London date, not 24 hours later', () => {
  // Saturday 24 October 21:00 BST to Sunday 25 October 19:00 GMT: 22 hours
  // on the wall clock, 23 hours of real time, one London day.
  assert.equal(formatEventWhen('2026-10-25T19:00:00Z', '2026-10-24T20:00:00Z'), 'Tomorrow');
  // Sunday 25 October 23:30 GMT to Monday 26 October 00:30 GMT.
  assert.equal(formatEventWhen('2026-10-26T00:30:00Z', '2026-10-25T23:30:00Z'), 'Tomorrow');
});

test('two to six days ahead is the weekday name', () => {
  // From Saturday 24 October.
  assert.equal(formatEventWhen('2026-10-26T19:00:00Z', '2026-10-24T17:00:00Z'), 'Monday');
  assert.equal(formatEventWhen('2026-10-30T19:00:00Z', '2026-10-24T17:00:00Z'), 'Friday');
});

test('a week or more ahead is the short date, with fixed month names', () => {
  // Saturday 31 October is seven days after Saturday 24 October: not "Saturday".
  assert.equal(formatEventWhen('2026-10-31T20:00:00Z', '2026-10-24T17:00:00Z'), 'Sat 31 Oct');
  assert.equal(formatEventWhen('2026-10-16T18:00:00Z', '2026-10-01T12:00:00Z'), 'Fri 16 Oct');
  // Some ICU builds say "Sept"; the TV always says "Sep".
  assert.equal(formatEventWhen('2027-09-17T18:00:00Z', '2026-10-01T12:00:00Z'), 'Fri 17 Sep');
});

test('an event dated before today gets its date rather than a relative word', () => {
  assert.equal(formatEventWhen('2026-10-20T18:00:00Z', '2026-10-24T17:00:00Z'), 'Tue 20 Oct');
});

test('the event time is London time, either side of the clock change', () => {
  // 18:00 UTC is 7pm BST on Saturday 24 October and 6pm GMT on Monday 26th.
  assert.equal(formatEventTime('2026-10-24T18:00:00Z'), '7pm');
  assert.equal(formatEventTime('2026-10-26T18:00:00Z'), '6pm');
  assert.equal(formatEventTime('2026-10-26T19:00:00Z'), '7pm');
  assert.equal(formatEventTime('2026-10-24T18:30:00Z'), '7:30pm');
  assert.equal(formatEventTime('2026-10-26T19:05:00Z'), '7:05pm');
});

test('noon, midnight and the morning read the way a poster says them', () => {
  assert.equal(formatEventTime('2026-12-05T12:00:00Z'), '12pm');
  assert.equal(formatEventTime('2026-12-05T00:00:00Z'), '12am');
  assert.equal(formatEventTime('2026-12-05T11:30:00Z'), '11:30am');
  // 00:30 BST on Sunday 25 October, before the clocks go back.
  assert.equal(formatEventTime('2026-10-24T23:30:00Z'), '12:30am');
});

test('event labels for rubbish are empty, never Invalid Date or NaN', () => {
  assert.equal(formatEventWhen('not a date', '2026-10-24T17:00:00Z'), '');
  assert.equal(formatEventWhen('2026-10-24T18:00:00Z', 'not a date'), '');
  assert.equal(formatEventTime('not a date'), '');
  assert.equal(formatEventTime(''), '');
});

test('the event clock can be passed as a Date or epoch milliseconds', () => {
  const now = new Date('2026-10-24T17:00:00Z');
  assert.equal(formatEventWhen('2026-10-24T18:00:00Z', now), 'Tonight');
  assert.equal(formatEventWhen('2026-10-25T18:00:00Z', now.getTime()), 'Tomorrow');
});

test('the event line reads as one phrase, and is empty rather than half a phrase', () => {
  assert.equal(formatEventWhenAndTime('2026-10-24T18:00:00Z', '2026-10-24T17:00:00Z'), 'Tonight at 7pm');
  assert.equal(formatEventWhenAndTime('2026-10-30T19:30:00Z', '2026-10-24T17:00:00Z'), 'Friday at 7:30pm');
  assert.equal(formatEventWhenAndTime('2026-10-16T18:00:00Z', '2026-10-01T12:00:00Z'), 'Fri 16 Oct at 7pm');
  assert.equal(formatEventWhenAndTime('not a date', '2026-10-01T12:00:00Z'), '');
  assert.equal(formatEventWhenAndTime('2026-10-16T18:00:00Z', 'not a date'), '');
});
