// src/lib/reveal-queue.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planReveal, type RevealPlanInput } from './reveal-queue';

const PUBLIC_DELAY_MS = 3000;
const MIN_DWELL_MS = 1200;
/** An arbitrary but realistic epoch reading, so clock-skew maths is meaningful. */
const SERVER_NOW = 1_700_000_000_000;
/** performance.now() is small and unrelated to the epoch: time since page load. */
const MONO_NOW = 50_000;

function makeInput(overrides: Partial<RevealPlanInput> = {}): RevealPlanInput {
  return {
    serverCount: 1,
    revealedCount: 0,
    lastCallAtMs: SERVER_NOW,
    publicDelayMs: PUBLIC_DELAY_MS,
    minDwellMs: MIN_DWELL_MS,
    lastRevealAtMs: null,
    snapImmediately: false,
    nowMs: SERVER_NOW,
    monotonicNowMs: MONO_NOW,
    newestSeenAtMs: MONO_NOW,
    ...overrides,
  };
}

test('caught up returns no tick', () => {
  const plan = planReveal(makeInput({ serverCount: 12, revealedCount: 12 }));
  assert.deepEqual(plan, { revealCount: 12, nextTickInMs: null });
});

test('a single new ball is held until the public delay, then revealed', () => {
  const held = planReveal(
    makeInput({ serverCount: 5, revealedCount: 4, lastRevealAtMs: MONO_NOW - 9000 })
  );
  assert.deepEqual(held, { revealCount: 4, nextTickInMs: PUBLIC_DELAY_MS });

  // Part way through the window it is still held, and the tick shrinks.
  const stillHeld = planReveal(
    makeInput({
      serverCount: 5,
      revealedCount: 4,
      lastRevealAtMs: MONO_NOW - 9000,
      nowMs: SERVER_NOW + 1000,
      monotonicNowMs: MONO_NOW + 1000,
    })
  );
  assert.deepEqual(stillHeld, { revealCount: 4, nextTickInMs: 2000 });

  const revealed = planReveal(
    makeInput({
      serverCount: 5,
      revealedCount: 4,
      lastRevealAtMs: MONO_NOW - 9000,
      nowMs: SERVER_NOW + PUBLIC_DELAY_MS,
      monotonicNowMs: MONO_NOW + PUBLIC_DELAY_MS,
    })
  );
  assert.deepEqual(revealed, { revealCount: 5, nextTickInMs: null });
});

test('a backlog of four reveals one at a time at the dwell interval, never skipping', () => {
  // The host called four balls in quick succession; the newest was called at
  // SERVER_NOW. The client is showing none of them.
  let revealedCount = 0;
  let lastRevealAtMs: number | null = null;
  let nowMs = SERVER_NOW;
  let monotonicNowMs = MONO_NOW;
  const seen: number[] = [];

  for (let step = 0; step < 4; step += 1) {
    const plan = planReveal(
      makeInput({ serverCount: 4, revealedCount, lastRevealAtMs, nowMs, monotonicNowMs })
    );
    // Never more than one extra ball per decision: no ball is skipped.
    assert.equal(plan.revealCount, revealedCount + 1);
    seen.push(plan.revealCount);

    // The reveal happens at the current clock reading, then we wait out the tick.
    lastRevealAtMs = monotonicNowMs;
    revealedCount = plan.revealCount;

    if (plan.revealCount < 4) {
      assert.equal(plan.nextTickInMs, MIN_DWELL_MS);
      nowMs += MIN_DWELL_MS;
      monotonicNowMs += MIN_DWELL_MS;
    } else {
      // The last of the four is the newest ball. By now 3600ms have passed, so
      // its own public delay has already elapsed and it reveals with no tick.
      assert.equal(plan.nextTickInMs, null);
    }
  }

  assert.deepEqual(seen, [1, 2, 3, 4]);
});

test('an undo snaps the revealed count down at once', () => {
  const plan = planReveal(makeInput({ serverCount: 6, revealedCount: 7 }));
  assert.deepEqual(plan, { revealCount: 6, nextTickInMs: null });
});

test('snapImmediately reveals everything even inside the delay window', () => {
  const plan = planReveal(
    makeInput({
      serverCount: 9,
      revealedCount: 3,
      snapImmediately: true,
      lastRevealAtMs: MONO_NOW,
    })
  );
  assert.deepEqual(plan, { revealCount: 9, nextTickInMs: null });
});

test('a null lastCallAtMs reveals the outstanding ball at once', () => {
  const plan = planReveal(
    makeInput({ serverCount: 5, revealedCount: 4, lastCallAtMs: null })
  );
  assert.deepEqual(plan, { revealCount: 5, nextTickInMs: null });
});

test('dwell is respected as a floor when a ball was just revealed', () => {
  // The public delay has elapsed, but this client advanced 200ms ago, so the
  // previous ball has not had its 1.2s on screen yet.
  const plan = planReveal(
    makeInput({
      serverCount: 5,
      revealedCount: 4,
      nowMs: SERVER_NOW + PUBLIC_DELAY_MS,
      monotonicNowMs: MONO_NOW + PUBLIC_DELAY_MS,
      lastRevealAtMs: MONO_NOW + PUBLIC_DELAY_MS - 200,
    })
  );
  assert.deepEqual(plan, { revealCount: 4, nextTickInMs: MIN_DWELL_MS - 200 });
});

test('no previous reveal means no dwell, even just after page load', () => {
  // performance.now() is only 300ms here. Treating a null last reveal as time
  // zero would hold a ball that is already due for another 900ms.
  const plan = planReveal(
    makeInput({
      serverCount: 5,
      revealedCount: 4,
      lastCallAtMs: SERVER_NOW - 10_000,
      monotonicNowMs: 300,
      newestSeenAtMs: 300,
      lastRevealAtMs: null,
    })
  );
  assert.deepEqual(plan, { revealCount: 5, nextTickInMs: null });
});

// --- Clock skew -------------------------------------------------------------
//
// The caller passes nowMs = Date.now() + clock offset (src/lib/clock-offset.ts).

test('a TV clock five seconds FAST is corrected, so the delay is kept', () => {
  const deviceNow = SERVER_NOW + 5000; // the TV thinks it is five seconds later
  const offset = -5000; // measured by the clock-offset sampler

  const corrected = planReveal(
    makeInput({ serverCount: 5, revealedCount: 4, nowMs: deviceNow + offset })
  );
  assert.deepEqual(corrected, { revealCount: 4, nextTickInMs: PUBLIC_DELAY_MS });

  // Without the correction the ball looked five seconds old and came out at
  // once, before the host had read it out. This is the bug X12d.
  const uncorrected = planReveal(
    makeInput({ serverCount: 5, revealedCount: 4, nowMs: deviceNow })
  );
  assert.deepEqual(uncorrected, { revealCount: 5, nextTickInMs: null });
});

test('a TV clock five seconds SLOW is corrected, so the ball is not held late', () => {
  const deviceNow = SERVER_NOW - 5000;
  const offset = 5000;

  const held = planReveal(
    makeInput({ serverCount: 5, revealedCount: 4, nowMs: deviceNow + offset })
  );
  assert.deepEqual(held, { revealCount: 4, nextTickInMs: PUBLIC_DELAY_MS });

  const revealed = planReveal(
    makeInput({
      serverCount: 5,
      revealedCount: 4,
      nowMs: deviceNow + offset + PUBLIC_DELAY_MS,
      monotonicNowMs: MONO_NOW + PUBLIC_DELAY_MS,
    })
  );
  assert.deepEqual(revealed, { revealCount: 5, nextTickInMs: null });
});

test('a call time in the future is treated as just called, so a small offset error never shortens the delay', () => {
  // The corrected clock is 80ms behind the server: the ball looks like it was
  // called 80ms from now.
  const plan = planReveal(
    makeInput({ serverCount: 5, revealedCount: 4, nowMs: SERVER_NOW - 80 })
  );
  assert.deepEqual(plan, { revealCount: 4, nextTickInMs: PUBLIC_DELAY_MS });
});

test('an uncorrected clock ten minutes SLOW still reveals within the public delay of first seeing the ball', () => {
  // The offset could not be measured (every /api/time request failed), so
  // nowMs is the raw device clock and the ball looks ten minutes in the future.
  const browserNow = SERVER_NOW - 10 * 60 * 1000;

  const held = planReveal(
    makeInput({ serverCount: 5, revealedCount: 4, nowMs: browserNow, lastRevealAtMs: MONO_NOW - 100 })
  );
  assert.equal(held.revealCount, 4);
  // Clamped: never the naive 603000ms, and never beyond the public delay.
  assert.equal(held.nextTickInMs, PUBLIC_DELAY_MS);

  const revealed = planReveal(
    makeInput({
      serverCount: 5,
      revealedCount: 4,
      lastRevealAtMs: MONO_NOW - 100,
      nowMs: browserNow + PUBLIC_DELAY_MS,
      monotonicNowMs: MONO_NOW + PUBLIC_DELAY_MS,
    })
  );
  assert.deepEqual(revealed, { revealCount: 5, nextTickInMs: null });
});

test('the dwell runs on the monotonic clock, so a wall clock jump cannot stall a backlog', () => {
  // The device clock is corrected by an hour mid-backlog (an NTP sync). The
  // dwell only looks at performance.now(), so pacing carries on as normal.
  const plan = planReveal(
    makeInput({
      serverCount: 6,
      revealedCount: 2,
      nowMs: SERVER_NOW - 60 * 60 * 1000,
      monotonicNowMs: MONO_NOW + MIN_DWELL_MS,
      lastRevealAtMs: MONO_NOW,
    })
  );
  assert.deepEqual(plan, { revealCount: 3, nextTickInMs: MIN_DWELL_MS });
});
