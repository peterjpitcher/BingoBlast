// src/lib/clock-offset.test.ts
//
// A pub TV whose clock runs fast made every ball look older than it was, so
// the public reveal delay vanished and the TV showed the ball before the host
// had finished reading it out. The offset corrects the device clock against the
// server's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CLOCK_OFFSET_RESAMPLE_MS,
  CLOCK_OFFSET_SAMPLES_PER_ROUND,
  computeClockOffset,
  createClockOffsetSampler,
} from './clock-offset';

test('the offset is the server reading minus the midpoint of the request', () => {
  // Sent at 1000, answered at 1100 on the device clock; the server said 6050.
  // The midpoint is 1050, so the device is 5000ms behind the server.
  assert.equal(computeClockOffset([{ t0: 1000, t1: 1100, server: 6050 }]), 5000);
});

test('a fast device clock gives a negative offset', () => {
  assert.equal(computeClockOffset([{ t0: 10_000, t1: 10_040, server: 7_020 }]), -3000);
});

test('the sample with the lowest round trip wins', () => {
  const offset = computeClockOffset([
    { t0: 0, t1: 900, server: 5_000 }, // slow: midpoint 450, offset 4550
    { t0: 1000, t1: 1020, server: 6_010 }, // fastest: midpoint 1010, offset 5000
    { t0: 2000, t1: 2300, server: 7_400 }, // midpoint 2150, offset 5250
  ]);
  assert.equal(offset, 5000);
});

test('unusable samples are ignored, and no usable sample means no correction', () => {
  assert.equal(
    computeClockOffset([
      { t0: 100, t1: 50, server: 1000 }, // answered before it was sent
      { t0: 0, t1: 10, server: Number.NaN },
    ]),
    0,
  );
  assert.equal(computeClockOffset([]), 0);
});

function makeSampler(
  replies: Array<number | Error>,
  options: { now?: () => number } = {},
) {
  let clock = 0;
  const now = options.now ?? (() => {
    clock += 10; // every reading is 10ms after the last, so each request takes 10ms
    return clock;
  });
  const intervals: Array<{ fn: () => void; ms: number }> = [];
  let cleared = 0;
  let calls = 0;
  const sampler = createClockOffsetSampler(
    async () => {
      const reply = replies[Math.min(calls, replies.length - 1)];
      calls += 1;
      if (reply instanceof Error) throw reply;
      return reply;
    },
    {
      now,
      setInterval: (fn, ms) => {
        intervals.push({ fn, ms });
        return intervals.length;
      },
      clearInterval: () => {
        cleared += 1;
      },
    },
  );
  return { sampler, intervals, getCalls: () => calls, getCleared: () => cleared };
}

test('the sampler holds 0 before its first round', () => {
  const { sampler } = makeSampler([5000]);
  assert.equal(sampler.getOffset(), 0);
});

test('a round takes three samples and keeps the best offset', async () => {
  // Readings go 10, 20 | 30, 40 | 50, 60. Midpoints 15, 35, 55.
  const { sampler, getCalls } = makeSampler([5015, 5035, 5055]);
  const offset = await sampler.sample();
  assert.equal(CLOCK_OFFSET_SAMPLES_PER_ROUND, 3);
  assert.equal(getCalls(), 3);
  assert.equal(offset, 5000);
  assert.equal(sampler.getOffset(), 5000);
});

test('a round where every request fails keeps the last good offset', async () => {
  const { sampler } = makeSampler([5015, 5035, 5055, new Error('offline')]);
  await sampler.sample();
  assert.equal(sampler.getOffset(), 5000);
  await sampler.sample();
  assert.equal(sampler.getOffset(), 5000, 'a failed round never resets the offset to 0');
});

test('start samples at once and every ten minutes; stop clears the interval', async () => {
  const { sampler, intervals, getCalls, getCleared } = makeSampler([5015, 5035, 5055]);
  sampler.start();
  assert.equal(CLOCK_OFFSET_RESAMPLE_MS, 10 * 60 * 1000);
  assert.deepEqual(intervals.map((i) => i.ms), [CLOCK_OFFSET_RESAMPLE_MS]);
  await sampler.sample(); // let the load-time round finish alongside this one
  assert.ok(getCalls() >= 3);

  const before = getCalls();
  intervals[0].fn();
  await sampler.sample();
  assert.ok(getCalls() > before, 'the interval takes another round');

  sampler.stop();
  assert.equal(getCleared(), 1);
});

test('onChange hears about a new offset', async () => {
  const seen: number[] = [];
  const { sampler } = makeSampler([5015, 5035, 5055]);
  sampler.onChange((offset) => seen.push(offset));
  await sampler.sample();
  assert.deepEqual(seen, [5000]);
});
