// src/lib/jackpot.test.ts
//
// isCashJackpotGame decides whether starting a game prompts the host for a cash
// amount, and the caller then writes that amount into games.prizes. A false
// positive is therefore destructive, not cosmetic: it overwrote a game's
// configured prizes permanently. The first three tests exist to keep the old
// name-matching behaviour from coming back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatCashJackpotPrize, isCashJackpotGame, parseCashJackpotAmount } from './jackpot';

test('a game typed jackpot is a cash jackpot game', () => {
  assert.equal(isCashJackpotGame('jackpot'), true);
});

test('a standard game is not, whatever it is called', () => {
  // The regression. "Game 5 - Mini Jackpot" used to match on its name and lose
  // its Line and Two Lines prizes on start.
  assert.equal(isCashJackpotGame('standard'), false);
});

test('a snowball game is not a cash jackpot game: its amount comes from the pot', () => {
  assert.equal(isCashJackpotGame('snowball'), false);
});

test('a missing or unknown type is not a cash jackpot game', () => {
  assert.equal(isCashJackpotGame(undefined), false);
  assert.equal(isCashJackpotGame(null), false);
  assert.equal(isCashJackpotGame(''), false);
});

test('a plain amount parses', () => {
  assert.equal(parseCashJackpotAmount('50'), 50);
  assert.equal(parseCashJackpotAmount('  75  '), 75);
});

test('a currency symbol and thousands separator are ignored', () => {
  assert.equal(parseCashJackpotAmount('£1,250'), 1250);
  assert.equal(parseCashJackpotAmount('£70'), 70);
});

test('pence survive', () => {
  assert.equal(parseCashJackpotAmount('12.50'), 12.5);
});

test('empty, zero and rubbish are refused rather than guessed at', () => {
  assert.equal(parseCashJackpotAmount(''), null);
  assert.equal(parseCashJackpotAmount('   '), null);
  assert.equal(parseCashJackpotAmount('0'), null);
  assert.equal(parseCashJackpotAmount('free'), null);
  assert.equal(parseCashJackpotAmount('12.5.3'), null);
});

test('a negative reads as its positive value rather than being accepted as negative', () => {
  // The minus is stripped with the other non-numeric characters. Recorded here
  // as the deliberate behaviour: a prize can never be negative, and refusing
  // "-50" outright would be equally defensible if the host ever complains.
  assert.equal(parseCashJackpotAmount('-50'), 50);
});

test('the prize text is what the pub TV and the winner row both show', () => {
  assert.equal(formatCashJackpotPrize(70), '£70 Cash Jackpot');
  assert.equal(formatCashJackpotPrize(12.5), '£12.5 Cash Jackpot');
});
