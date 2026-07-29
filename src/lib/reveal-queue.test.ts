// src/lib/reveal-queue.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planReveal, type RevealPlanInput } from './reveal-queue';

const PUBLIC_DELAY_MS = 3000;
const MIN_DWELL_MS = 1200;
/** An arbitrary but realistic epoch reading, so clock-skew maths is meaningful. */
const SERVER_NOW = 1_700_000_000_000;

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
    ...overrides,
  };
}

test('caught up returns no tick', () => {
  const plan = planReveal(makeInput({ serverCount: 12, revealedCount: 12 }));
  assert.deepEqual(plan, { revealCount: 12, nextTickInMs: null });
});

test('a single new ball is held until the public delay, then revealed', () => {
  const held = planReveal(
    makeInput({ serverCount: 5, revealedCount: 4, lastRevealAtMs: SERVER_NOW - 9000 })
  );
  assert.deepEqual(held, { revealCount: 4, nextTickInMs: PUBLIC_DELAY_MS });

  // Part way through the window it is still held, and the tick shrinks.
  const stillHeld = planReveal(
    makeInput({
      serverCount: 5,
      revealedCount: 4,
      lastRevealAtMs: SERVER_NOW - 9000,
      nowMs: SERVER_NOW + 1000,
    })
  );
  assert.deepEqual(stillHeld, { revealCount: 4, nextTickInMs: 2000 });

  const revealed = planReveal(
    makeInput({
      serverCount: 5,
      revealedCount: 4,
      lastRevealAtMs: SERVER_NOW - 9000,
      nowMs: SERVER_NOW + PUBLIC_DELAY_MS,
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
  const seen: number[] = [];

  for (let step = 0; step < 4; step += 1) {
    const plan = planReveal(
      makeInput({ serverCount: 4, revealedCount, lastRevealAtMs, nowMs })
    );
    // Never more than one extra ball per decision: no ball is skipped.
    assert.equal(plan.revealCount, revealedCount + 1);
    seen.push(plan.revealCount);

    // The reveal happens at the current clock reading, then we wait out the tick.
    lastRevealAtMs = nowMs;
    revealedCount = plan.revealCount;

    if (plan.revealCount < 4) {
      assert.equal(plan.nextTickInMs, MIN_DWELL_MS);
      nowMs += MIN_DWELL_MS;
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
      lastRevealAtMs: SERVER_NOW,
      nowMs: SERVER_NOW,
    })
  );
  assert.deepEqual(plan, { revealCount: 9, nextTickInMs: null });
});

test('a browser clock ten minutes behind still reveals within the public delay', () => {
  const skewMs = 10 * 60 * 1000;
  // The client last advanced 100ms ago on its own (slow) clock.
  const browserNow = SERVER_NOW - skewMs;
  const lastRevealAtMs = browserNow - 100;

  const held = planReveal(
    makeInput({ serverCount: 5, revealedCount: 4, lastRevealAtMs, nowMs: browserNow })
  );
  assert.equal(held.revealCount, 4);
  // Clamped: never the naive 603000ms, and never beyond the public delay.
  assert.ok(held.nextTickInMs !== null && held.nextTickInMs <= PUBLIC_DELAY_MS);
  assert.equal(held.nextTickInMs, PUBLIC_DELAY_MS - 100);

  const revealed = planReveal(
    makeInput({
      serverCount: 5,
      revealedCount: 4,
      lastRevealAtMs,
      nowMs: browserNow + (held.nextTickInMs ?? 0),
    })
  );
  assert.deepEqual(revealed, { revealCount: 5, nextTickInMs: null });
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
      lastRevealAtMs: SERVER_NOW + PUBLIC_DELAY_MS - 200,
    })
  );
  assert.deepEqual(plan, { revealCount: 4, nextTickInMs: MIN_DWELL_MS - 200 });
});
