// src/lib/house-rules.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HOUSE_RULES,
  HOW_TO_WIN,
  CALL_RESPONSES,
  PHONE_FOLLOW_ONLY_NOTE,
  buildSnowballRule,
  getHouseRules,
  formatGameIdentity,
  formatHowToWin,
  getGamePosition,
} from './house-rules';
import { REQUIRED_SELECTION_COUNT_BY_STAGE } from './win-stages';

const POT = {
  current_max_calls: 58,
  current_jackpot_amount: 180,
  calls_increment: 2,
  jackpot_increment: 20,
};

test('rules 1 to 7 are the approved wording, word for word (spec 5.3, D2)', () => {
  assert.deepEqual(HOUSE_RULES, [
    'Over 18s only.',
    'Pay for your books before the game starts. Maximum stake £5 per person per game.',
    'Play the book colour shown on the screen.',
    'Shout as soon as you win. Your claim must include the last number called; once the next number is called, it is too late.',
    'Winners on the same number share the prize.',
    'If a claim is wrong, the game carries on.',
    "The caller's decision is final.",
  ]);
});

test('rule 8 is built from the live pot values', () => {
  assert.equal(
    buildSnowballRule(POT),
    'Snowball: a Full House within 58 calls wins £180. If nobody wins it, it grows by £20 and 2 calls. You must have played the last three games to qualify.'
  );
});

test('rule 8 shows pence properly and groups thousands', () => {
  assert.equal(
    buildSnowballRule({ ...POT, current_jackpot_amount: 1212.5, jackpot_increment: 12.5 }),
    'Snowball: a Full House within 58 calls wins £1,212.50. If nobody wins it, it grows by £12.50 and 2 calls. You must have played the last three games to qualify.'
  );
});

test('rule 8 says "1 call", not "1 calls"', () => {
  assert.match(buildSnowballRule({ ...POT, calls_increment: 1 }) ?? '', /grows by £20 and 1 call\. /);
});

test('rule 8 is withheld when a pot value is unusable', () => {
  assert.equal(buildSnowballRule({ ...POT, current_max_calls: Number.NaN }), null);
  assert.equal(buildSnowballRule({ ...POT, current_jackpot_amount: 0 }), null);
  assert.equal(buildSnowballRule({ ...POT, jackpot_increment: Number.NaN }), null);
});

test('the full list has eight rules with a pot and seven without', () => {
  const withPot = getHouseRules(POT);
  assert.equal(withPot.length, 8);
  assert.equal(withPot[7], buildSnowballRule(POT));
  assert.deepEqual(getHouseRules(null), [...HOUSE_RULES]);
});

test('how to win covers every stage the game plays, in order, word for word', () => {
  assert.deepEqual(HOW_TO_WIN.map(formatHowToWin), [
    'Line: one full row on a ticket.',
    'Two Lines: two full rows on the same ticket.',
    'Full House: all 15 numbers on one ticket.',
  ]);
  assert.deepEqual(
    HOW_TO_WIN.map((line) => line.stage),
    Object.keys(REQUIRED_SELECTION_COUNT_BY_STAGE)
  );
});

test('the phone note is the spec wording', () => {
  assert.equal(PHONE_FOLLOW_ONLY_NOTE, 'This follows the paper game. You cannot enter or claim here.');
});

test('the game identity reads "Game 3 of 10 · Blue book"', () => {
  assert.equal(formatGameIdentity({ number: 3, total: 10, colourHex: '#2563eb' }), 'Game 3 of 10 · Blue book');
});

test('the game identity leaves out what it does not know', () => {
  assert.equal(formatGameIdentity({ number: 3, total: null, colourHex: '#2563eb' }), 'Game 3 · Blue book');
  assert.equal(formatGameIdentity({ number: 3, total: 10, colourHex: 'not a colour' }), 'Game 3 of 10');
  assert.equal(formatGameIdentity({ number: null, total: 10, colourHex: '#dc2626' }), 'Red book');
  assert.equal(formatGameIdentity({ number: 11, total: 10, colourHex: null }), 'Game 11');
});

test('a game position counts from 1 in game order, ignoring gaps', () => {
  const games = [
    { id: 'c', game_index: 5 },
    { id: 'a', game_index: 1 },
    { id: 'b', game_index: 3 },
  ];
  assert.deepEqual(getGamePosition(games, 'b'), { number: 2, total: 3 });
  assert.deepEqual(getGamePosition(games, 'c'), { number: 3, total: 3 });
  assert.equal(getGamePosition(games, 'missing'), null);
  assert.equal(getGamePosition(games, null), null);
});

test('CALL_RESPONSES holds the six agreed numbers, in ascending order', () => {
  const numbers = CALL_RESPONSES.map((entry) => entry.number);
  assert.deepEqual(numbers, [2, 11, 22, 59, 69, 88]);
});

test('every call response is a non-empty string on a valid ball', () => {
  for (const entry of CALL_RESPONSES) {
    assert.ok(Number.isInteger(entry.number), `${entry.number} is not an integer`);
    assert.ok(entry.number >= 1 && entry.number <= 90, `${entry.number} is outside 1 to 90`);
    assert.ok(entry.response.trim().length > 0, `${entry.number} has no response`);
  }
});
