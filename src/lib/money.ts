// src/lib/money.ts
//
// Money is held as integer pence everywhere it is stored or added up. Pounds as
// a float is how you end up paying somebody £4.999999, and how a column of
// numbers stops adding to the total printed underneath it.
//
// formatPence and totalPaidOutPence take pence integers, which is what
// winners.prize_share_pence holds. formatPoundsAmount takes a pounds NUMBER that
// came from a Postgres numeric column (the pot); formatPounds in snowball.ts is
// the same thing without the pound sign.

/** "£12.50", "£10", "£0.05". Pence in, a string a landlord can read out. */
export function formatPence(pence: number | null | undefined): string {
  if (pence === null || pence === undefined || !Number.isFinite(pence)) return '';
  const negative = pence < 0;
  const abs = Math.abs(Math.round(pence));
  const pounds = Math.floor(abs / 100);
  const remainder = abs % 100;
  const body = remainder === 0
    ? `£${pounds.toLocaleString('en-GB')}`
    : `£${pounds.toLocaleString('en-GB')}.${String(remainder).padStart(2, '0')}`;
  return negative ? `-${body}` : body;
}

/**
 * "£212.50", "£1,250", "£1,250.50", "£0". Pounds in (a Postgres numeric such as
 * the snowball pot, or a cash jackpot amount), en-GB out: two decimals when
 * there are pence, none when there are not, and thousands grouped. The pot used
 * to read "£212.5" on the pub TV (X13).
 *
 * Rounds to the nearest penny first, so a float such as 0.1 + 0.2 reads as
 * £0.30. Anything that is not a finite number reads as £0 rather than £NaN.
 */
export function formatPoundsAmount(value: number): string {
  if (!Number.isFinite(value)) return '£0';
  return formatPence(Math.round(value * 100));
}

/**
 * Totals what was actually paid out.
 *
 * Sums prize_share_pence, never prize_amount_pence. On a tied stage the amount
 * is the whole prize and appears on every tied row, so totalling it counts one
 * £10 prize as £20. The share is what each winner gets, so the shares add up to
 * the prize exactly once. Ten ties already exist in production, two of them cash
 * jackpots, so this is the difference between a correct total and one that
 * overstates the night.
 *
 * Rows with no share, a voided win or a prize that is not money, contribute
 * nothing. `countedRows` says how many rows the total actually covers, so a
 * screen can be honest that a night of chocolate bars totals £0 rather than
 * implying nothing was won.
 */
export function totalPaidOutPence(
  winners: ReadonlyArray<{ prize_share_pence?: number | null }>
): { totalPence: number; countedRows: number; uncountedRows: number } {
  let totalPence = 0;
  let countedRows = 0;
  let uncountedRows = 0;

  for (const w of winners) {
    const share = w.prize_share_pence;
    if (typeof share === 'number' && Number.isFinite(share)) {
      totalPence += share;
      countedRows += 1;
    } else {
      uncountedRows += 1;
    }
  }

  return { totalPence, countedRows, uncountedRows };
}
