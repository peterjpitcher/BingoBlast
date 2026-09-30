// src/lib/poll-runner.test.ts
//
// The public screens poll every 3 seconds. Before the runner a poll had no
// deadline, so a request that never answered held the in-flight flag for ever
// and every later poll returned early: an unattended TV quietly stopped
// polling. And a slow poll could land after a newer Realtime event and put the
// older state back on screen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPollRunner, PollDeadlineError, POLL_DEADLINE_MS } from './poll-runner';

class FakeTimers {
  private nextId = 1;
  pending = new Map<number, { fn: () => void; ms: number }>();

  setTimer = (fn: () => void, ms: number): number => {
    const id = this.nextId++;
    this.pending.set(id, { fn, ms });
    return id;
  };

  clearTimer = (id: number): void => {
    this.pending.delete(id);
  };

  fireAll(): void {
    const timers = [...this.pending.values()];
    this.pending.clear();
    timers.forEach((timer) => timer.fn());
  }
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test('the default deadline is eight seconds', () => {
  assert.equal(POLL_DEADLINE_MS, 8000);
  const timers = new FakeTimers();
  const runner = createPollRunner<string, number>({
    run: () => new Promise<string>(() => undefined),
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });
  runner.start();
  assert.deepEqual([...timers.pending.values()].map((t) => t.ms), [8000]);
});

test('a successful run resolves, clears its deadline and releases the flag', async () => {
  const timers = new FakeTimers();
  const runner = createPollRunner<string, number>({
    run: async () => 'fresh',
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });
  const started = runner.start();
  assert.ok(started);
  assert.equal(await started.promise, 'fresh');
  assert.equal(runner.isCurrent(started.seq), true);
  assert.equal(timers.pending.size, 0, 'the deadline timer is cleared');
  assert.equal(runner.isInFlight(), false);
});

test('a second start while one is in flight is refused', () => {
  const timers = new FakeTimers();
  const runner = createPollRunner<string, number>({
    run: () => new Promise<string>(() => undefined),
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });
  assert.ok(runner.start());
  assert.equal(runner.start(), null);
});

test('the deadline aborts the run and releases the in-flight flag even if the request never answers', async () => {
  const timers = new FakeTimers();
  let seenSignal: AbortSignal | null = null;
  const runner = createPollRunner<string, number>({
    run: (signal) => {
      seenSignal = signal;
      // A request that ignores its signal and never settles: the worst case.
      return new Promise<string>(() => undefined);
    },
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });

  const started = runner.start();
  assert.ok(started);
  assert.equal(runner.start(), null, 'still in flight before the deadline');

  timers.fireAll();
  await assert.rejects(started.promise, PollDeadlineError);
  assert.equal((seenSignal as AbortSignal | null)?.aborted, true, 'the request was told to abort');
  assert.equal(runner.isInFlight(), false);
  assert.ok(runner.start(), 'later polls continue');
});

test('a stale response that lands after a newer poll started is discarded', async () => {
  const timers = new FakeTimers();
  const runs: Array<Deferred<string>> = [];
  const runner = createPollRunner<string, number>({
    run: () => {
      const d = deferred<string>();
      runs.push(d);
      return d.promise;
    },
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });

  const first = runner.start();
  assert.ok(first);
  timers.fireAll(); // the first hangs past its deadline
  await assert.rejects(first.promise, PollDeadlineError);

  const second = runner.start();
  assert.ok(second);
  // The hung first request finally answers, after the second has started.
  runs[0].resolve('old');
  runs[1].resolve('new');
  assert.equal(await second.promise, 'new');
  assert.equal(runner.isCurrent(first.seq), false, 'the older poll is not current');
  assert.equal(runner.isCurrent(second.seq), true);
});

test('invalidate after a Realtime event discards the poll that was in flight', async () => {
  const timers = new FakeTimers();
  const run = deferred<string>();
  const runner = createPollRunner<string, number>({
    run: () => run.promise,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });

  const started = runner.start();
  assert.ok(started);
  // A Realtime payload arrives and is applied. Whatever the poll read was
  // requested before it, so it may be older.
  runner.invalidate();
  run.resolve('read before the event');
  assert.equal(await started.promise, 'read before the event');
  assert.equal(runner.isCurrent(started.seq), false);

  // The next poll is current again.
  const next = runner.start();
  assert.ok(next);
  assert.equal(runner.isCurrent(next.seq), true);
});

test('a run that throws synchronously rejects and releases the flag', async () => {
  const timers = new FakeTimers();
  const runner = createPollRunner<string, number>({
    run: () => {
      throw new Error('boom');
    },
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });
  const started = runner.start();
  assert.ok(started);
  await assert.rejects(started.promise, /boom/);
  assert.equal(runner.isInFlight(), false);
  assert.equal(timers.pending.size, 0);
});
