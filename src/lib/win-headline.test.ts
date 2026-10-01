// src/lib/win-headline.test.ts
//
// The database's win text is in capitals. The screens show it in sentence
// case, with the stage names keeping their capitals.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatWinHeadline } from './win-headline';

test('each stage win is set in sentence case', () => {
  assert.equal(formatWinHeadline('LINE WINNER!'), 'Line winner!');
  assert.equal(formatWinHeadline('TWO LINES WINNER!'), 'Two Lines winner!');
  assert.equal(formatWinHeadline('FULL HOUSE WINNER!'), 'Full House winner!');
  assert.equal(formatWinHeadline('WINNER!'), 'Winner!');
  assert.equal(formatWinHeadline('BINGO!'), 'Bingo!');
});

test('the snowball win keeps the stage name and the amount', () => {
  assert.equal(formatWinHeadline('FULL HOUSE + SNOWBALL £180!'), 'Full House + snowball £180!');
  assert.equal(formatWinHeadline('FULL HOUSE + SNOWBALL JACKPOT!'), 'Full House + snowball jackpot!');
});

test('missing or blank text gives an empty headline, never "undefined"', () => {
  assert.equal(formatWinHeadline(null), '');
  assert.equal(formatWinHeadline(undefined), '');
  assert.equal(formatWinHeadline('   '), '');
});

test('text that is already in sentence case is left as it reads', () => {
  assert.equal(formatWinHeadline('Line winner!'), 'Line winner!');
});
