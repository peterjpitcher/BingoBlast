/**
 * Whether a snowball pot read by the 3 second poll may replace the pot a public
 * screen (/display, /player) is showing.
 *
 * The pot reaches those screens two ways: the Realtime pot channel, and the
 * poll, which is the fallback for a Realtime event that never arrives (a
 * dropped socket, or the first change after Realtime starts). The pot row has
 * no version column, so a polled row can be wrong by the time it lands in two
 * ways, and both are dropped rather than shown:
 *
 *   - the active game moved to another pot, or to no snowball game, while the
 *     request was in flight;
 *   - a Realtime UPDATE for the pot arrived after the poll was sent, so the poll
 *     may have read the row before that change committed.
 *
 * Dropping is always safe: the next poll, three seconds later, reads again.
 */
export interface PolledPotCheck {
  /** id of the row the poll returned. */
  polledPotId: string;
  /** Pot of the game the screen shows now, read when the response lands. */
  activePotId: string | null | undefined;
  /** Date.now() taken just before the poll request was sent. */
  pollStartedAt: number;
  /** Date.now() of the last Realtime pot event applied, or null if none yet. */
  lastRealtimeAt: number | null;
}

export function shouldApplyPolledPot({
  polledPotId,
  activePotId,
  pollStartedAt,
  lastRealtimeAt,
}: PolledPotCheck): boolean {
  if (!activePotId || polledPotId !== activePotId) return false;
  if (lastRealtimeAt !== null && lastRealtimeAt >= pollStartedAt) return false;
  return true;
}
