// src/lib/money.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatPence, totalPaidOutPence } from './money';

test('whole pounds have no decimal point', () => {
  assert.equal(formatPence(1000), '£10');
  assert.equal(formatPence(0), '£0');
  assert.equal(formatPence(14000), '£140');
});

test('pence are shown with two digits, so 5p is not 0.5', () => {
  assert.equal(formatPence(1250), '£12.50');
  assert.equal(formatPence(5), '£0.05');
  assert.equal(formatPence(1205), '£12.05');
});

test('thousands are grouped, because a jackpot could get there', () => {
  assert.equal(formatPence(125000), '£1,250');
});

test('nothing renders as empty rather than as £NaN', () => {
  assert.equal(formatPence(null), '');
  assert.equal(formatPence(undefined), '');
  assert.equal(formatPence(Number.NaN), '');
});

test('a total sums the SHARES, so a tie is not counted twice', () => {
  // The bug this exists to stop: two tied winners of one £10 prize. Totalling
  // the amount would say £20 was paid out of a £10 prize.
  const tied = [{ prize_share_pence: 500 }, { prize_share_pence: 500 }];
  assert.equal(totalPaidOutPence(tied).totalPence, 1000);
});

test('a three way split with an odd penny still adds up exactly', () => {
  const split = [{ prize_share_pence: 334 }, { prize_share_pence: 333 }, { prize_share_pence: 333 }];
  assert.equal(totalPaidOutPence(split).totalPence, 1000);
});

test('prizes that are not money are counted separately, not as zero pounds won', () => {
  const mixed = [
    { prize_share_pence: 1000 },
    { prize_share_pence: null },
    { prize_share_pence: undefined },
  ];
  const result = totalPaidOutPence(mixed);
  assert.equal(result.totalPence, 1000);
  assert.equal(result.countedRows, 1);
  assert.equal(result.uncountedRows, 2);
});

test('an empty night totals nothing and says so', () => {
  const result = totalPaidOutPence([]);
  assert.equal(result.totalPence, 0);
  assert.equal(result.countedRows, 0);
  assert.equal(result.uncountedRows, 0);
});
