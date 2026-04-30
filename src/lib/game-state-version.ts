// src/lib/game-state-version.ts
export interface HasStateVersion {
  state_version: number;
}

/**
 * Decide whether to apply an incoming game-state snapshot from realtime or polling.
 *
 * Rules:
 * - Always apply when no current state.
 * - Never apply when incoming is missing.
 * - Apply when incoming.state_version >= current.state_version.
 *   Equal versions are allowed because reapplying the same snapshot is idempotent
 *   and the trigger may produce duplicate broadcasts during reconnect.
 *
 * Do NOT compare numbers_called_count: voiding a number legitimately decreases it.
 */
export function isFreshGameState(
  current: HasStateVersion | null | undefined,
  incoming: HasStateVersion | null | undefined,
): boolean {
  if (!incoming) return false;
  if (!current) return true;
  return incoming.state_version >= current.state_version;
}
