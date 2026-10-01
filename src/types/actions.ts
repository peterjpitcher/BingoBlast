/**
 * Shared server-action result shape.
 *
 * `conflict: true` means the state moved under the caller (another host took
 * control, the stage advanced, the game ended). The client should refresh and
 * explain, not treat it as a hard error.
 *
 * `code` is a stable machine-readable key for failures the UI needs to branch
 * on, so it never has to pattern-match the host-facing wording. Add a key here
 * rather than matching on `error` text, which is copy and will be reworded.
 */
export type ActionFailureCode =
  | 'winner_on_ball'
  // Night lifecycle: start_game, finish_game, end_night
  // (supabase/migrations/20261001075034_night_lifecycle.sql).
  | 'night_ended'
  | 'other_game_in_progress'
  | 'invalid_sequence'
  | 'session_not_found'
  | 'game_in_progress'
  // Claims: begin_claim_check, set_claim_draft, check_claim, the bound undo in
  // void_last_number (20261001075215_claim_attempts.sql) and the enforcement in
  // record_winner_atomic (20261001075456_claim_enforcement.sql).
  | 'stage_already_won'
  | 'attempt_required'
  | 'unknown_stage'
  | 'attempt_mismatch'
  | 'stale_attempt'
  | 'verdict_already_given'
  | 'already_undone'
  | 'not_paused'
  | 'number_out_of_range'
  | 'duplicate_numbers'
  | 'too_many_numbers'
  | 'wrong_count'
  | 'claim_fields_protected'
  | 'claim_not_checked'
  | 'claim_not_valid'
  // Money (20261001075401_jackpot_components.sql).
  | 'game_not_completed'
  | 'winner_void'

export type ActionResult<T = void> =
  | { success: true; data?: T; redirectTo?: string }
  | { success: false; error: string; conflict?: true; code?: ActionFailureCode }
