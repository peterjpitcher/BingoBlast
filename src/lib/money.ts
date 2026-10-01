// src/lib/money.ts
//
// Money is held as integer pence everywhere it is stored or added up. Pounds as
// a float is how you end up paying somebody £4.999999, and how a column of
// numbers stops adding to the total printed underneath it.
//
// formatPence, winnerTotalPence and totalPaidOutPence take pence integers,
// which is what winners.prize_share_pence and jackpot_share_pence hold.
// formatPoundsAmount takes a pounds NUMBER that came from a Postgres numeric
// column (the pot); formatPounds in snowball.ts is the same thing without the
// pound sign.

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

/** Shown wherever a jackpot winner's jackpot money was never recorded (spec 7, M3). */
export const JACKPOT_NOT_RECORDED = 'jackpot amount not recorded';

/** The winner columns that carry money. Every field is optional so a partial select still fits. */
export interface WinnerMoneyFields {
  prize_share_pence?: number | null;
  jackpot_share_pence?: number | null;
  is_snowball_jackpot?: boolean | null;
  is_void?: boolean | null;
}

export interface WinnerTotal {
  /** Ordinary share plus jackpot share, in pence. Null when neither is money. */
  totalPence: number | null;
  /** The ordinary stage prize share (prize_share_pence). */
  ordinaryPence: number | null;
  /** The snowball jackpot share (jackpot_share_pence). */
  jackpotPence: number | null;
  /**
   * A jackpot winner whose jackpot amount was never recorded: a win from before
   * 1 October 2026 that no settlement record vouches for. The total leaves it
   * out rather than guessing from today's pot, and the screen must say so.
   */
  jackpotNotRecorded: boolean;
}

const isPence = (value: number | null | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/**
 * What one winner was paid, in pence (X22).
 *
 * Since 20261001000300_jackpot_components.sql a winner's money is two
 * components: prize_share_pence is the ORDINARY stage prize share only, and a
 * snowball jackpot winner's share of the pot is jackpot_share_pence. Totalling
 * the first alone is how a £140 jackpot used to vanish from the night's
 * payout. A voided winner was paid nothing.
 */
export function winnerTotalPence(winner: WinnerMoneyFields): WinnerTotal {
  if (winner.is_void === true) {
    return { totalPence: null, ordinaryPence: null, jackpotPence: null, jackpotNotRecorded: false };
  }

  const ordinaryPence = isPence(winner.prize_share_pence) ? winner.prize_share_pence : null;
  const jackpotPence = isPence(winner.jackpot_share_pence) ? winner.jackpot_share_pence : null;
  const jackpotNotRecorded = winner.is_snowball_jackpot === true && jackpotPence === null;

  const totalPence = ordinaryPence === null && jackpotPence === null
    ? null
    : (ordinaryPence ?? 0) + (jackpotPence ?? 0);

  return { totalPence, ordinaryPence, jackpotPence, jackpotNotRecorded };
}

/**
 * The total as a line a landlord can read: "£150", "£10 + jackpot amount not
 * recorded", "jackpot amount not recorded", or null when there is no money to
 * show (a prize that is not cash, or a voided win).
 */
export function describeWinnerTotal(total: WinnerTotal): string | null {
  if (total.totalPence !== null) {
    const amount = formatPence(total.totalPence);
    return total.jackpotNotRecorded ? `${amount} + ${JACKPOT_NOT_RECORDED}` : amount;
  }
  return total.jackpotNotRecorded ? JACKPOT_NOT_RECORDED : null;
}

/**
 * Totals what was actually paid out.
 *
 * Sums each winner's SHARES (winnerTotalPence: the ordinary share plus the
 * jackpot share), never prize_amount_pence. On a tied stage the amount is the
 * whole prize and appears on every tied row, so totalling it counts one £10
 * prize as £20. The shares add up to the prize exactly once. Ten ties already
 * exist in production, two of them cash jackpots, so this is the difference
 * between a correct total and one that overstates the night.
 *
 * Rows with no money, a voided win or a prize that is not cash, contribute
 * nothing. `countedRows` says how many rows the total actually covers, so a
 * screen can be honest that a night of chocolate bars totals £0 rather than
 * implying nothing was won. `jackpotNotRecordedRows` counts the jackpot winners
 * whose jackpot is missing from the total, so the screen can say so.
 */
export function totalPaidOutPence(
  winners: ReadonlyArray<WinnerMoneyFields>
): { totalPence: number; countedRows: number; uncountedRows: number; jackpotNotRecordedRows: number } {
  let totalPence = 0;
  let countedRows = 0;
  let uncountedRows = 0;
  let jackpotNotRecordedRows = 0;

  for (const w of winners) {
    const total = winnerTotalPence(w);
    if (total.totalPence !== null) {
      totalPence += total.totalPence;
      countedRows += 1;
    } else {
      uncountedRows += 1;
    }
    if (total.jackpotNotRecorded) jackpotNotRecordedRows += 1;
  }

  return { totalPence, countedRows, uncountedRows, jackpotNotRecordedRows };
}
