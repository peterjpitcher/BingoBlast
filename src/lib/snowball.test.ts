// src/lib/snowball.test.ts
//
// The jackpot window is a money decision, and its boundary is an off-by-one
// waiting to happen: "within X calls" has to include call X itself. These tests
// pin that boundary, in both the eligibility answer and the words the host and
// the pub TV read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatPounds,
  getSnowballCallsLabel,
  getSnowballCallsRemaining,
  getSnowballWindowStatus,
  isSnowballJackpotEligible,
} from './snowball';

test('the window is open before the last qualifying call', () => {
  assert.equal(getSnowballWindowStatus(41, 42), 'open');
  assert.equal(isSnowballJackpotEligible(41, 42), true);
});

test('call number X itself still qualifies: X calls means within X, not before X', () => {
  assert.equal(getSnowballWindowStatus(42, 42), 'last_call');
  assert.equal(isSnowballJackpotEligible(42, 42), true);
});

test('one call past the window closes it', () => {
  assert.equal(getSnowballWindowStatus(43, 42), 'closed');
  assert.equal(isSnowballJackpotEligible(43, 42), false);
});

test('no calls yet is open, not closed', () => {
  assert.equal(getSnowballWindowStatus(0, 42), 'open');
  assert.equal(isSnowballJackpotEligible(0, 42), true);
  assert.equal(getSnowballCallsRemaining(0, 42), 42);
});

test('calls remaining never goes negative once the window has closed', () => {
  assert.equal(getSnowballCallsRemaining(50, 42), 0);
  assert.equal(getSnowballCallsRemaining(42, 42), 0);
  assert.equal(getSnowballCallsRemaining(41, 42), 1);
});

test('the label reads as a countdown, then as a warning, then as closed', () => {
  assert.equal(getSnowballCallsLabel(40, 42), '2 calls left');
  assert.equal(getSnowballCallsLabel(41, 42), '1 call left');
  assert.equal(getSnowballCallsLabel(42, 42), 'Last qualifying call');
  assert.equal(getSnowballCallsLabel(43, 42), 'Jackpot closed');
});

test('the label uses the singular for exactly one call', () => {
  // Read at arm's length from behind a bar, so "1 calls left" would be noticed.
  assert.match(getSnowballCallsLabel(41, 42), /^1 call left$/);
});

test('a pot of zero max calls is closed from the first ball, not open for ever', () => {
  assert.equal(getSnowballWindowStatus(0, 0), 'last_call');
  assert.equal(getSnowballWindowStatus(1, 0), 'closed');
});

test('whole pounds render without a decimal point', () => {
  assert.equal(formatPounds(140), '140');
  assert.equal(formatPounds(0), '0');
});

test('pence are kept when they are there', () => {
  assert.equal(formatPounds(212.5), '212.5');
  assert.equal(formatPounds(212.25), '212.25');
});

test('a non-finite amount renders as zero rather than as NaN on the pub TV', () => {
  assert.equal(formatPounds(Number.NaN), '0');
  assert.equal(formatPounds(Number.POSITIVE_INFINITY), '0');
});
