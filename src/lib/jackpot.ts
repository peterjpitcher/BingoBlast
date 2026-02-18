import { formatPounds } from '@/lib/snowball';

export function isCashJackpotGame(gameName: string, gameType?: string): boolean {
  if (gameType === 'jackpot') {
    return true;
  }

  if (gameType === 'snowball') {
    return false;
  }

  // Backward compatibility for existing sessions not yet typed as jackpot.
  return /\bjackpot\b/i.test(gameName);
}

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
