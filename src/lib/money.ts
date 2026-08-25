// src/lib/money.ts
//
// Money is held as integer pence everywhere it is stored or added up. Pounds as
// a float is how you end up paying somebody £4.999999, and how a column of
// numbers stops adding to the total printed underneath it.
//
// This is separate from formatPounds in snowball.ts, which formats a pounds
// NUMBER that came from a Postgres numeric column (the pot). These functions
// take pence integers, which is what winners.prize_share_pence holds.

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
