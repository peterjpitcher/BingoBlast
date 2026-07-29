// src/lib/reveal-queue.ts
/**
 * Decides how many called balls a public surface (/display, /player) may show
 * right now, and when it should next re-evaluate.
 *
 * Pure by design: no clocks, no timers, no Supabase. The caller passes `nowMs`
 * and schedules a single timer from `nextTickInMs`. Because the answer depends
 * only on the current snapshot, the reveal state is fully derivable after a
 * poll, a reload or a Realtime reconnect.
 *
 * Guarantees:
 *   - no ball is ever skipped;
 *   - the newest ball is never revealed before its own call time plus the
 *     public delay;
 *   - a backlogged ball stays on screen for at least `minDwellMs`;
 *   - during a claim check and at game end the screens snap to the server
 *     state at once, because a claim is validated against the last called ball.
 *
 * Honest limitation: earlier balls have no stored timestamp, so a backlog is
 * paced rather than individually timed.
 */

export interface RevealPlanInput {
  /** `called_numbers.length` from the server snapshot. */
  serverCount: number;
  /** How many balls this client currently shows. */
  revealedCount: number;
  /** Server timestamp (ms) of the newest call, or null when nothing is timed. */
  lastCallAtMs: number | null;
  /** `call_delay_seconds * 1000`. */
  publicDelayMs: number;
  /** Minimum time a backlogged ball stays on screen. */
  minDwellMs: number;
  /** Browser timestamp (ms) of this client's last advance, or null. */
  lastRevealAtMs: number | null;
  /** True when `paused_for_validation`, or the game status is 'completed'. */
  snapImmediately: boolean;
  /** Browser clock reading, passed in so this helper stays pure. */
  nowMs: number;
}

export interface RevealPlan {
  /** How many balls the client should show now. */
  revealCount: number;
  /** When to re-evaluate, or null when caught up. */
  nextTickInMs: number | null;
}

export function planReveal(input: RevealPlanInput): RevealPlan {
  const {
    serverCount,
    revealedCount,
    lastCallAtMs,
    publicDelayMs,
    minDwellMs,
    lastRevealAtMs,
    snapImmediately,
    nowMs,
  } = input;

  // 1. The server has fewer balls than we show: a ball was voided. Snap down.
  if (serverCount < revealedCount) {
    return { revealCount: serverCount, nextTickInMs: null };
  }

  // 2. Claim check or game end: the screens must agree with the host at once.
  if (snapImmediately) {
    return { revealCount: serverCount, nextTickInMs: null };
  }

  // 3. Caught up: nothing to schedule.
  if (serverCount === revealedCount) {
    return { revealCount: revealedCount, nextTickInMs: null };
  }

  // Dwell is measured wholly in browser time, so it is immune to clock skew.
  const dwellWaitMs = Math.max(0, minDwellMs - (nowMs - (lastRevealAtMs ?? 0)));

  // 4. Backlog: the next ball is not the newest, so it has no timestamp of its
  //    own to wait on. Pace it on dwell alone and never skip ahead.
  if (serverCount - revealedCount > 1) {
    if (dwellWaitMs === 0) {
      return { revealCount: revealedCount + 1, nextTickInMs: minDwellMs };
    }
    return { revealCount: revealedCount, nextTickInMs: dwellWaitMs };
  }

  // 6. Exactly one outstanding ball but no call timestamp: nothing to wait on.
  if (lastCallAtMs === null) {
    return { revealCount: serverCount, nextTickInMs: null };
  }

  // 5. Exactly one outstanding ball and it is the newest: gate on the public
  //    delay, then respect dwell as a floor.
  const dueAtMs = lastCallAtMs + publicDelayMs;
  const rawWaitMs = dueAtMs - nowMs;

  // Clock-skew guard. With sane clocks `rawWaitMs` can never exceed
  // publicDelayMs, because the call already happened. When it does, the browser
  // clock is behind the server and `lastCallAtMs` looks like it is in the
  // future. Fall back to pacing from this client's own last reveal, which is
  // browser time throughout, so the wait stays inside [0, publicDelayMs] and a
  // skewed clock can never postpone a ball indefinitely.
  const delayWaitMs =
    rawWaitMs > publicDelayMs
      ? Math.max(0, publicDelayMs - (nowMs - (lastRevealAtMs ?? 0)))
      : Math.max(0, rawWaitMs);

  const waitMs = Math.max(delayWaitMs, dwellWaitMs);

  if (waitMs === 0) {
    return { revealCount: serverCount, nextTickInMs: null };
  }
  return { revealCount: revealedCount, nextTickInMs: waitMs };
}
