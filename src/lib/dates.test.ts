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
