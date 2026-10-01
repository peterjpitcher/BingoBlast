import { formatPoundsAmount } from './money';

export type SnowballWindowStatus = 'open' | 'last_call' | 'closed';

export function getSnowballCallsRemaining(numbersCalledCount: number, maxCalls: number): number {
  return Math.max(maxCalls - numbersCalledCount, 0);
}

export function getSnowballWindowStatus(numbersCalledCount: number, maxCalls: number): SnowballWindowStatus {
  if (numbersCalledCount > maxCalls) {
    return 'closed';
  }
  if (numbersCalledCount === maxCalls) {
    return 'last_call';
  }
  return 'open';
}

export function isSnowballJackpotEligible(numbersCalledCount: number, maxCalls: number): boolean {
  return numbersCalledCount <= maxCalls;
}

export function getSnowballCallsLabel(numbersCalledCount: number, maxCalls: number): string {
  const status = getSnowballWindowStatus(numbersCalledCount, maxCalls);
  if (status === 'closed') {
    return 'Jackpot closed';
  }
  if (status === 'last_call') {
    return 'Last qualifying call';
  }

  const remainingCalls = getSnowballCallsRemaining(numbersCalledCount, maxCalls);
  return `${remainingCalls} ${remainingCalls === 1 ? 'call' : 'calls'} left`;
}

/**
 * A pounds amount without the pound sign, for copy that supplies its own:
 * "212.50", "1,250", "0". Delegates to formatPoundsAmount so the two can never
 * disagree.
 */
export function formatPounds(value: number): string {
  return formatPoundsAmount(value).replace('£', '');
}
