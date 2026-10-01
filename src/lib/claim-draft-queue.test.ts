// src/lib/claim-draft-queue.test.ts
//
// The live claim draft (spec 5.2, D1). Every tap sends the whole ordered list
// to set_claim_draft so the TV and phones show the claim as it is read out.
// One request at a time, the newest list always wins, the sequence only ever
// goes up, and a failed send retries by itself while the host keeps tapping.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CLAIM_DRAFT_MAX_BACKOFF_MS,
  claimDraftBackoffMs,
  createClaimDraftQueue,
  type ClaimDraftQueueState,
  type ClaimDraftSendOutcome,
} from './claim-draft-queue';

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

  delays(): number[] {
    return [...this.pending.values()].map((t) => t.ms);
  }

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

/** Lets every settled promise run its handlers. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

interface Call {
  numbers: number[];
  seq: number;
  reply: Deferred<ClaimDraftSendOutcome>;
}

function harness(initialSeq = 0) {
  const timers = new FakeTimers();
  const calls: Call[] = [];
  const states: ClaimDraftQueueState[] = [];
  const queue = createClaimDraftQueue<number>({
    initialSeq,
    send: (numbers, seq) => {
      const reply = deferred<ClaimDraftSendOutcome>();
      calls.push({ numbers: [...numbers], seq, reply });
      return reply.promise;
    },
    onStateChange: (state) => states.push(state),
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });
  return { queue, calls, states, timers };
}

test('a tap is sent at once, with the next sequence number', () => {
  const { queue, calls } = harness(0);
  queue.push([45]);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].numbers, [45]);
  assert.equal(calls[0].seq, 1);
  assert.equal(queue.state, 'sending');
});

test('an adopted attempt continues its sequence from the stored one', () => {
  const { queue, calls } = harness(7);
  queue.push([3, 9]);
  assert.equal(calls[0].seq, 8);
});

test('one request at a time, and only the newest list waiting goes next', async () => {
  const { queue, calls } = harness();
  queue.push([1]);
  queue.push([1, 2]);
  queue.push([1, 2, 3]);
  assert.equal(calls.length, 1, 'nothing else is sent while the first is in flight');

  calls[0].reply.resolve('ok');
  await settle();

  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].numbers, [1, 2, 3], 'the intermediate list is skipped');
  assert.equal(calls[1].seq, 2);

  calls[1].reply.resolve('ok');
  await settle();
  assert.equal(calls.length, 2);
  assert.equal(queue.state, 'idle');
});

test('the list is sent in tap order, never sorted', () => {
  const { queue, calls } = harness();
  queue.push([61, 4, 33]);
  assert.deepEqual(calls[0].numbers, [61, 4, 33]);
});

test('the queue keeps its own copy, so a later change to the caller array is not sent', () => {
  const { queue, calls } = harness();
  const list = [5, 6];
  queue.push(list);
  queue.push([5, 6, 7]);
  list.push(99);
  calls[0].reply.resolve('ok');
  return settle().then(() => {
    assert.deepEqual(calls[1].numbers, [5, 6, 7]);
  });
});

test('a failed send reports retrying and retries the newest list with a higher sequence', async () => {
  const { queue, calls, states, timers } = harness();
  queue.push([10]);
  calls[0].reply.resolve('error');
  await settle();

  assert.equal(queue.state, 'retrying');
  assert.ok(states.includes('retrying'));
  assert.equal(calls.length, 1, 'the retry waits for its backoff');
  assert.deepEqual(timers.delays(), [claimDraftBackoffMs(1)]);

  // A tap during the wait replaces what the retry will send.
  queue.push([10, 20]);
  assert.equal(calls.length, 1, 'a tap while retrying does not jump the backoff');

  timers.fireAll();
  await settle();
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].numbers, [10, 20]);
  assert.ok(calls[1].seq > calls[0].seq, 'the sequence only goes up');

  calls[1].reply.resolve('ok');
  await settle();
  assert.equal(queue.state, 'idle');
  assert.equal(states[states.length - 1], 'idle');
});

test('a thrown send (a dropped connection) is retried like a failed one', async () => {
  const { queue, calls, timers } = harness();
  queue.push([8]);
  calls[0].reply.reject(new Error('network down'));
  await settle();
  assert.equal(queue.state, 'retrying');

  timers.fireAll();
  await settle();
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].numbers, [8]);
});

test('the backoff grows with each failure, is capped, and resets after a success', async () => {
  const { queue, calls, timers } = harness();
  queue.push([1]);

  const seen: number[] = [];
  for (let i = 0; i < 6; i += 1) {
    calls[calls.length - 1].reply.resolve('error');
    await settle();
    seen.push(...timers.delays());
    timers.fireAll();
    await settle();
  }
  for (let i = 1; i < seen.length; i += 1) {
    assert.ok(seen[i] >= seen[i - 1], 'never shrinks while failing');
  }
  assert.ok(seen.every((ms) => ms <= CLAIM_DRAFT_MAX_BACKOFF_MS));
  assert.equal(seen[seen.length - 1], CLAIM_DRAFT_MAX_BACKOFF_MS);

  calls[calls.length - 1].reply.resolve('ok');
  await settle();
  queue.push([1, 2]);
  calls[calls.length - 1].reply.resolve('error');
  await settle();
  assert.deepEqual(timers.delays(), [claimDraftBackoffMs(1)], 'back to the first step');
});

test('a permanent refusal stops the queue and later taps are not sent', async () => {
  const { queue, calls, timers } = harness();
  queue.push([1]);
  queue.push([1, 2]);
  calls[0].reply.resolve('stop');
  await settle();

  assert.equal(queue.state, 'stopped');
  assert.equal(calls.length, 1, 'the waiting list is dropped');
  queue.push([1, 2, 3]);
  assert.equal(calls.length, 1);
  assert.equal(timers.pending.size, 0);
});

test('flush sends a waiting retry now and resolves once the queue is idle', async () => {
  const { queue, calls, timers } = harness();
  queue.push([4]);
  calls[0].reply.resolve('error');
  await settle();
  assert.equal(timers.pending.size, 1);

  let flushed = false;
  const done = queue.flush().then(() => {
    flushed = true;
  });
  await settle();
  assert.equal(timers.pending.size, 0, 'the backoff wait is cancelled');
  assert.equal(calls.length, 2, 'the waiting list goes at once');
  assert.equal(flushed, false);

  calls[1].reply.resolve('ok');
  await done;
  assert.equal(flushed, true);
  assert.equal(queue.state, 'idle');
});

test('flush resolves after one more failed attempt instead of waiting for ever', async () => {
  const { queue, calls } = harness();
  queue.push([4]);
  const done = queue.flush();
  calls[0].reply.resolve('error');
  await done;
  assert.equal(queue.state, 'retrying');
});

test('flush on an idle queue resolves straight away', async () => {
  const { queue, calls } = harness();
  await queue.flush();
  assert.equal(calls.length, 0);
});

test('dispose cancels a pending retry and ignores a late answer', async () => {
  const { queue, calls, timers, states } = harness();
  queue.push([2]);
  calls[0].reply.resolve('error');
  await settle();
  assert.equal(timers.pending.size, 1);

  queue.dispose();
  assert.equal(timers.pending.size, 0);
  const before = states.length;
  queue.push([2, 3]);
  assert.equal(calls.length, 1);
  assert.equal(states.length, before, 'no state changes after dispose');
});

test('an answer that lands after dispose sends nothing more', async () => {
  const { queue, calls } = harness();
  queue.push([2]);
  queue.push([2, 3]);
  queue.dispose();
  calls[0].reply.resolve('ok');
  await settle();
  assert.equal(calls.length, 1);
});
