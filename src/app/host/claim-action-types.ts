// Payload shapes for the host claim and lifecycle actions in ./actions.ts.
//
// Kept out of the 'use server' module, which may only export async functions,
// so the host screen can import the types without importing server code.

import type { BeginClaimCheckCode, ClaimResult, Database } from '@/types/database';

type GameStateRow = Database['public']['Tables']['game_states']['Row'];

/** The claim as the server holds it after a call, for the host screen to adopt. */
export interface ClaimSnapshot {
  /** The attempt on the row after the call. On 'attempt_mismatch', the one to adopt. */
  attemptId: string | null;
  /** The stored claim, in tap order. */
  claimNumbers: number[];
  claimResult: ClaimResult | null;
  /** The stored draft sequence. A phone adopting an attempt continues from here. */
  claimDraftSeq: number;
  gameState: GameStateRow;
}

/**
 * begin_claim_check's answer. 'attempt_mismatch' is not a failure for the
 * host: another attempt is already being checked, nothing was written, and
 * the phone adopts that attempt and its draft.
 */
export interface BeginClaimCheckData extends ClaimSnapshot {
  code: BeginClaimCheckCode;
}

/** check_claim's verdict, or 'missing_last_ball' when the host must decide (A1). */
export type CheckClaimOutcome = ClaimResult | 'missing_last_ball';

export interface CheckClaimData extends ClaimSnapshot {
  code: CheckClaimOutcome;
  /** The claimed numbers that have not been called, in tap order. */
  invalidNumbers: number[];
  /** The last ball called, or null when none has been. */
  lastNumber: number | null;
}

export interface SetClaimDraftData {
  /** 'stale_seq' means the server already held a newer draft and ignored this one. */
  code: 'saved' | 'stale_seq';
  claimDraftSeq: number;
}

/**
 * What every path that finishes a game returns (X6, X9). The game has finished
 * whenever this arrives; `snowballPotDidNotSettle` says the pot did not move,
 * so the host screen must offer the retry before it navigates anywhere.
 */
export interface FinishedGameData {
  gameState: GameStateRow;
  /** The session is completed after this call. */
  sessionCompleted: boolean;
  snowballPotDidNotSettle?: true;
}
