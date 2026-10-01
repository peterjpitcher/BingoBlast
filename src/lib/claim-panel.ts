// src/lib/claim-panel.ts
//
// What the TV and the phones show while the host checks a claim (spec 5.2, D1).
// Everything comes from public fields: the claimed numbers in tap order and the
// server's verdict (`claim_numbers`, `claim_result`), checked against the
// public `called_numbers`. Pausing snaps the reveal queue to the server, so the
// called list here is the true one.
//
// The public wording never says the ticket itself is valid: the caller still
// checks the paper ticket (R08). Copy is the spec's, word for word.
import type { ClaimResult } from '@/types/database';

export type ClaimPanelKind = 'waiting' | 'draft' | 'valid' | 'invalid' | 'late';

export interface ClaimBall {
  n: number;
  /** Ticked when it has been called, crossed when it has not. */
  called: boolean;
  /** The last number called: a claim must include it. */
  isLast: boolean;
}

export interface ClaimPanelState {
  kind: ClaimPanelKind;
  /** The claimed numbers in the order the host tapped them. */
  balls: ClaimBall[];
  headline: string;
  detail: string;
  /** Claimed numbers that have not been called, in tap order. */
  invalidNumbers: number[];
  lastNumber: number | null;
  /**
   * "Last number called: 45" while the claim is being read out (waiting and
   * draft). Null once there is a verdict, when it adds nothing (and would not
   * fit under three rows of balls at 1280x720), and before any call.
   */
  lastNumberLine: string | null;
}

export interface ClaimPanelInput {
  paused: boolean;
  claimNumbers: ReadonlyArray<number> | null | undefined;
  claimResult: ClaimResult | null | undefined;
  /** The public called numbers, in call order. */
  calledNumbers: ReadonlyArray<number>;
  /** The stage being claimed: 'Line', 'Two Lines' or 'Full House'. */
  stageName: string | null | undefined;
  /** How many numbers the stage needs (win-stages.ts), or null if unknown. */
  requiredCount: number | null | undefined;
}

/** "61", "61 and 72", "61, 72 and 80". */
function listNumbers(numbers: number[]): string {
  if (numbers.length <= 1) return numbers.join('');
  return `${numbers.slice(0, -1).join(', ')} and ${numbers[numbers.length - 1]}`;
}

function isBallNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

/** Null when the game is not paused for a claim: there is nothing to show. */
export function getClaimPanelState(input: ClaimPanelInput): ClaimPanelState | null {
  if (!input.paused) return null;

  const called = new Set(input.calledNumbers);
  const lastNumber = input.calledNumbers.length > 0 ? input.calledNumbers[input.calledNumbers.length - 1] : null;
  const balls: ClaimBall[] = (input.claimNumbers ?? []).filter(isBallNumber).map((n) => ({
    n,
    called: called.has(n),
    isLast: n === lastNumber,
  }));
  const invalidNumbers = balls.filter((ball) => !ball.called).map((ball) => ball.n);
  const stage = input.stageName?.trim() ?? '';
  const checkingHeadline = stage ? `Checking a ${stage} claim` : 'Checking a claim';
  const verdictHeadline = stage ? `${stage} claim` : 'Claim';
  const lastNumberLine = lastNumber === null ? null : `Last number called: ${lastNumber}`;

  const base = { balls, invalidNumbers, lastNumber, lastNumberLine: null };

  if (input.claimResult === 'valid') {
    return {
      ...base,
      kind: 'valid',
      headline: checkingHeadline,
      detail: `All ${balls.length} numbers have been called. The caller is checking the ticket.`,
    };
  }

  if (input.claimResult === 'invalid') {
    const detail =
      invalidNumbers.length === 0
        ? 'Not a winner this time. The game carries on.'
        : `Not a winner this time: ${listNumbers(invalidNumbers)} ${invalidNumbers.length === 1 ? 'has' : 'have'} not been called. The game carries on.`;
    return { ...base, kind: 'invalid', headline: verdictHeadline, detail };
  }

  if (input.claimResult === 'late') {
    const detail =
      lastNumber === null
        ? 'Too late: the claim missed the last number called. The game carries on.'
        : `Too late: the claim had to include ${lastNumber}. The game carries on.`;
    return { ...base, kind: 'late', headline: verdictHeadline, detail };
  }

  if (balls.length === 0) {
    return {
      ...base,
      kind: 'waiting',
      headline: checkingHeadline,
      detail: 'Numbers appear as the caller reads them',
      lastNumberLine,
    };
  }

  const required = typeof input.requiredCount === 'number' && input.requiredCount > 0 ? input.requiredCount : null;
  const detail =
    required === null
      ? `${balls.length} ${balls.length === 1 ? 'number' : 'numbers'} read out`
      : `${balls.length} of ${required} numbers read out`;
  return { ...base, kind: 'draft', headline: checkingHeadline, detail, lastNumberLine };
}
