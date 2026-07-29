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
export type ActionFailureCode = 'winner_on_ball'

export type ActionResult<T = void> =
  | { success: true; data?: T; redirectTo?: string }
  | { success: false; error: string; conflict?: true; code?: ActionFailureCode }
