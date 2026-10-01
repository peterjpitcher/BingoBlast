// src/lib/money.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  describeWinnerTotal,
  formatPence,
  formatPoundsAmount,
  JACKPOT_NOT_RECORDED,
  totalPaidOutPence,
  winnerTotalPence,
} from './money';

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

// formatPoundsAmount takes POUNDS (a Postgres numeric, such as the snowball pot)
// rather than pence. "£212.5" is how the pot used to read on the pub TV.
test('pounds with pence always show two decimals', () => {
  assert.equal(formatPoundsAmount(212.5), '£212.50');
  assert.equal(formatPoundsAmount(212.25), '£212.25');
  assert.equal(formatPoundsAmount(0.05), '£0.05');
});

test('whole pounds have no decimal point, and thousands are grouped', () => {
  assert.equal(formatPoundsAmount(140), '£140');
  assert.equal(formatPoundsAmount(1250), '£1,250');
  assert.equal(formatPoundsAmount(1250.5), '£1,250.50');
  assert.equal(formatPoundsAmount(0), '£0');
});

test('a float that is a penny short of a whole number still rounds to it', () => {
  assert.equal(formatPoundsAmount(0.1 + 0.2), '£0.30');
  assert.equal(formatPoundsAmount(19.999), '£20');
});

test('a non-finite amount reads as £0, never £NaN on the pub TV', () => {
  assert.equal(formatPoundsAmount(Number.NaN), '£0');
  assert.equal(formatPoundsAmount(Number.POSITIVE_INFINITY), '£0');
});

// winnerTotalPence (X22, spec 7 M3). prize_share_pence is now the ORDINARY
// share only; a snowball jackpot winner's jackpot is jackpot_share_pence. The
// history page used to total the first and miss the second, so a £140 jackpot
// vanished from the night's payout.
test('an ordinary winner totals their ordinary share', () => {
  const total = winnerTotalPence({ prize_share_pence: 1000 });
  assert.equal(total.totalPence, 1000);
  assert.equal(total.ordinaryPence, 1000);
  assert.equal(total.jackpotPence, null);
  assert.equal(total.jackpotNotRecorded, false);
});

test('a jackpot winner totals the ordinary share plus the jackpot share', () => {
  const total = winnerTotalPence({
    prize_share_pence: 1000,
    jackpot_share_pence: 14000,
    is_snowball_jackpot: true,
  });
  assert.equal(total.totalPence, 15000);
  assert.equal(total.jackpotPence, 14000);
  assert.equal(total.jackpotNotRecorded, false);
});

test('a jackpot-only win (ordinary pool 0) totals the jackpot', () => {
  const total = winnerTotalPence({
    prize_share_pence: 0,
    jackpot_share_pence: 21250,
    is_snowball_jackpot: true,
  });
  assert.equal(total.totalPence, 21250);
});

test('a tied jackpot adds each winner\'s share, never the whole pot twice', () => {
  const tied = [
    { prize_share_pence: 500, jackpot_share_pence: 7000, is_snowball_jackpot: true },
    { prize_share_pence: 500, jackpot_share_pence: 7000, is_snowball_jackpot: true },
  ];
  assert.equal(totalPaidOutPence(tied).totalPence, 15000);
});

test('a jackpot winner with no recorded jackpot says so and totals only what is known', () => {
  const total = winnerTotalPence({
    prize_share_pence: 1000,
    jackpot_share_pence: null,
    is_snowball_jackpot: true,
  });
  assert.equal(total.totalPence, 1000);
  assert.equal(total.jackpotPence, null);
  assert.equal(total.jackpotNotRecorded, true);
  assert.equal(describeWinnerTotal(total), `£10 + ${JACKPOT_NOT_RECORDED}`);
});

test('a jackpot winner with nothing recorded at all has no total but still says why', () => {
  const total = winnerTotalPence({
    prize_share_pence: null,
    jackpot_share_pence: null,
    is_snowball_jackpot: true,
  });
  assert.equal(total.totalPence, null);
  assert.equal(total.jackpotNotRecorded, true);
  assert.equal(describeWinnerTotal(total), JACKPOT_NOT_RECORDED);
});

test('the phrase for an unknown jackpot is exactly as the spec words it', () => {
  assert.equal(JACKPOT_NOT_RECORDED, 'jackpot amount not recorded');
});

test('a prize that is not money has no total and no jackpot note', () => {
  const total = winnerTotalPence({ prize_share_pence: null });
  assert.equal(total.totalPence, null);
  assert.equal(total.jackpotNotRecorded, false);
  assert.equal(describeWinnerTotal(total), null);
});

test('a voided winner totals nothing, jackpot or not', () => {
  const total = winnerTotalPence({
    prize_share_pence: 1000,
    jackpot_share_pence: 14000,
    is_snowball_jackpot: true,
    is_void: true,
  });
  assert.equal(total.totalPence, null);
  assert.equal(total.jackpotPence, null);
  assert.equal(total.jackpotNotRecorded, false);
  assert.equal(describeWinnerTotal(total), null);
});

test('a known total reads as pounds', () => {
  assert.equal(describeWinnerTotal(winnerTotalPence({ prize_share_pence: 21250 })), '£212.50');
});

test('a night total counts both components and the rows whose jackpot is unknown', () => {
  const night = [
    { prize_share_pence: 1000 },
    { prize_share_pence: 1000, jackpot_share_pence: 14000, is_snowball_jackpot: true },
    { prize_share_pence: 500, jackpot_share_pence: null, is_snowball_jackpot: true },
    { prize_share_pence: null },
  ];
  const result = totalPaidOutPence(night);
  assert.equal(result.totalPence, 16500);
  assert.equal(result.countedRows, 3);
  assert.equal(result.uncountedRows, 1);
  assert.equal(result.jackpotNotRecordedRows, 1);
});
