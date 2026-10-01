// src/lib/reveal-queue.ts
/**
 * Decides how many called balls a public surface (/display, /player) may show
 * right now, and when it should next re-evaluate.
 *
 * Pure by design: no clocks, no timers, no Supabase. The caller passes the
 * clock readings and schedules a single timer from `nextTickInMs`. Because the
 * answer depends only on the current snapshot, the reveal state is fully
 * derivable after a poll, a reload or a Realtime reconnect.
 *
 * Guarantees:
 *   - no ball is ever skipped;
 *   - the newest ball is never revealed before its own call time plus the
 *     public delay;
 *   - a backlogged ball stays on screen for at least `minDwellMs`;
 *   - during a claim check and at game end the screens snap to the server
 *     state at once, because a claim is validated against the last called ball.
 *
 * Two clocks, deliberately:
 *   - `nowMs` is the device clock corrected by the server clock offset
 *     (src/lib/clock-offset.ts), and is only ever compared with `lastCallAtMs`,
 *     which is a server timestamp. Uncorrected, a TV clock running fast made
 *     every ball look old and removed the delay (X12d).
 *   - `monotonicNowMs`, `lastRevealAtMs` and `newestSeenAtMs` are
 *     performance.now() readings. The dwell and the "since we first saw it"
 *     clamp run on that clock, which a wall clock change cannot move.
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
  /** Monotonic timestamp (performance.now()) of this client's last advance, or null. */
  lastRevealAtMs: number | null;
  /** True when `paused_for_validation`, or the game status is 'completed'. */
  snapImmediately: boolean;
  /** Corrected server-time estimate: Date.now() plus the clock offset. */
  nowMs: number;
  /** Monotonic clock reading (performance.now()). */
  monotonicNowMs: number;
  /**
   * Monotonic time at which this client first saw the current newest ball, or
   * null for "just now".
   */
  newestSeenAtMs: number | null;
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
    monotonicNowMs,
    newestSeenAtMs,
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

  // Dwell is measured wholly on the monotonic clock, so it is immune to clock
  // skew and to the wall clock being changed. No previous reveal means no
  // dwell: performance.now() starts near zero at page load, so treating null as
  // time zero would hold a ball that is already due.
  const dwellWaitMs =
    lastRevealAtMs === null
      ? 0
      : Math.max(0, minDwellMs - (monotonicNowMs - lastRevealAtMs));

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
  //
  //    Clamped in both directions:
  //    - The ball has been outstanding on this device for at least
  //      `sinceSeenMs`, so at least that long has passed since it was called.
  //      A call time in the future (a small offset error, or a slow clock whose
  //      offset could not be measured) is therefore treated as just called when
  //      first seen, and the wait can never exceed the public delay after that.
  //      Without this a clock ten minutes slow would hold the ball ten minutes.
  //    - The wait is never negative.
  const sinceSeenMs = Math.max(0, monotonicNowMs - (newestSeenAtMs ?? monotonicNowMs));
  const elapsedSinceCallMs = Math.max(nowMs - lastCallAtMs, sinceSeenMs);
  const delayWaitMs = Math.max(0, publicDelayMs - elapsedSinceCallMs);

  const waitMs = Math.max(delayWaitMs, dwellWaitMs);

  if (waitMs === 0) {
    return { revealCount: serverCount, nextTickInMs: null };
  }
  return { revealCount: revealedCount, nextTickInMs: waitMs };
}
