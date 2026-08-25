import { formatPounds } from '@/lib/snowball';

/**
 * Whether starting this game should ask the host for a cash jackpot amount.
 *
 * Decided by the game TYPE and nothing else.
 *
 * This used to fall back to `/\bjackpot\b/i.test(gameName)` for "backward
 * compatibility for existing sessions not yet typed as jackpot". That fallback
 * was destructive, because the caller then wrote the amount the host typed over
 * EVERY stage prize in `games.prizes`. A perfectly ordinary three-stage game
 * called "Game 5 - Mini Jackpot" would prompt for an amount and lose its Line
 * and Two Lines prizes permanently, with the pub TV and the host briefing then
 * advertising the full cash amount for all three stages.
 *
 * The compatibility it was protecting turned out not to exist: every game in
 * production carrying the word jackpot is already `type = 'jackpot'` with a
 * single Full House stage (checked against the live database on 2026-08-25, six
 * games across six sessions, no exceptions). So the fallback only ever had
 * false positives left to produce.
 *
 * A snowball game is explicitly not a cash jackpot game: its amount comes from
 * the pot, not from the host.
 */
export function isCashJackpotGame(gameType: string | null | undefined): boolean {
  return gameType === 'jackpot';
}

/**
 * Reads the amount the host typed into the cash jackpot prompt.
 *
 * Returns null for anything that is not a positive number, which the caller
 * turns into "Please enter a valid cash jackpot amount." Currency symbols,
 * spaces and thousands separators are stripped, so "£1,250" and "1250" are the
 * same answer. A minus sign is stripped too, so "-50" reads as 50 rather than
 * being accepted as a negative prize.
 */
export function parseCashJackpotAmount(input: string): number | null {
  const normalized = input.trim();
  if (!normalized) {
    return null;
  }

  const numeric = Number(normalized.replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }

  return numeric;
}

export function formatCashJackpotPrize(amount: number): string {
  return `£${formatPounds(amount)} Cash Jackpot`;
}
