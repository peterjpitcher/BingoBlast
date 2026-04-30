// src/lib/prize-validation.ts
import type { GameType, WinStage } from '@/types/database';

export type PrizeValidationInput = {
  type: GameType;
  stage_sequence: WinStage[];
  prizes: Partial<Record<WinStage, string>>;
};

export type PrizeValidationResult =
  | { valid: true }
  | { valid: false; missingStages: WinStage[] };

/**
 * Validate that admin-entered prizes meet the requirements for a game.
 *
 * Rules:
 * - standard: every stage in stage_sequence has a non-empty trimmed prize.
 * - snowball: 'Full House' must have a non-empty trimmed prize. Other stages optional.
 * - jackpot: prizes are not required at admin time. The host enters the cash amount
 *            at game start via startGame().
 */
export function validateGamePrizes(input: PrizeValidationInput): PrizeValidationResult {
  const trim = (s: unknown) => (typeof s === 'string' ? s.trim() : '');

  if (input.type === 'jackpot') {
    return { valid: true };
  }

  const requiredStages: WinStage[] =
    input.type === 'snowball'
      ? ['Full House']
      : input.stage_sequence;

  const missingStages = requiredStages.filter(
    (stage) => trim(input.prizes[stage]).length === 0,
  );

  if (missingStages.length === 0) return { valid: true };
  return { valid: false, missingStages };
}
