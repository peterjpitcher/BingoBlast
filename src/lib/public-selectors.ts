// src/lib/public-selectors.ts
//
// The columns the public screens (the pub TV and the phone follower) read.
// Explicit, narrow lists keep public surfaces from leaking unintended fields
// and document exactly what the UI consumes. There used to be four copies of
// each (both page.tsx files and both UI files); these replace them.

/** Sessions: the lifecycle fields drive the night phase (src/lib/night-phase.ts). */
export const PUBLIC_SESSION_COLUMNS =
  'id, name, status, active_game_id, start_date, started_at, completed_at, state_version';

/** Games: everything but the host notes. */
export const PUBLIC_GAME_COLUMNS =
  'id, session_id, game_index, name, type, stage_sequence, background_colour, prizes, snowball_pot_id';

/** The public mirror of a game's state, including the live claim (spec 5.2). */
export const PUBLIC_GAME_STATE_COLUMNS =
  'game_id, called_numbers, numbers_called_count, current_stage_index, status, call_delay_seconds, on_break, paused_for_validation, display_win_type, display_win_text, display_winner_name, started_at, ended_at, last_call_at, updated_at, state_version, claim_numbers, claim_result';

export interface HasSessionVersion {
  state_version?: number | null;
}

/**
 * Whether to apply an incoming session snapshot (from Realtime or a poll).
 *
 * `sessions.state_version` is bumped by trigger on every update, so a snapshot
 * with a lower version is older than the one held and is dropped (R09). Equal
 * versions apply, as reapplying the same row is harmless. A version that cannot
 * be compared (a shell row built after a failed read) is applied rather than
 * leaving the screen stuck on the shell.
 */
export function isFreshSession(
  current: HasSessionVersion | null | undefined,
  incoming: HasSessionVersion | null | undefined
): boolean {
  if (!incoming) return false;
  if (!current) return true;
  const held = current.state_version;
  const next = incoming.state_version;
  if (typeof held !== 'number' || !Number.isFinite(held)) return true;
  if (typeof next !== 'number' || !Number.isFinite(next)) return true;
  return next >= held;
}
