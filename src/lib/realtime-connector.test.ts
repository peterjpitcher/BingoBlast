// src/lib/realtime-connector.test.ts
//
// The fake client below reproduces the realtime-js 2.91.0 behaviour that broke
// the hand-rolled channel code: removeChannel() fires CLOSED on the channel
// being removed synchronously, from inside the call, whenever the socket cannot
// push the leave message. The old code treated that CLOSED as a failure of the
// live channel, scheduled a reconnect, and a late CLOSED from an old channel
// could tear down its own replacement.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createRealtimeConnector,
  realtimeBackoffMs,
  type RealtimeConnectorOptions,
} from './realtime-connector';
import type { RealtimeStatus } from './connection-health';

type SubscribeCallback = (status: string, err?: Error) => void;

class FakeChannel {
  topic: string;
  callback: SubscribeCallback | null = null;
  subscribeCount = 0;

  constructor(topic: string) {
    this.topic = topic;
  }

  subscribe(callback: SubscribeCallback): this {
    this.callback = callback;
    this.subscribeCount += 1;
    return this;
  }

  emit(status: string): void {
    this.callback?.(status);
  }
}

class FakeClient {
  created: FakeChannel[] = [];
  removed: FakeChannel[] = [];
  /** realtime-js fires CLOSED synchronously when the socket cannot push. */
  closeSynchronouslyOnRemove = true;

  channel(topic: string): FakeChannel {
    const channel = new FakeChannel(topic);
    this.created.push(channel);
    return channel;
  }

  removeChannel(channel: FakeChannel): Promise<string> {
    this.removed.push(channel);
    if (this.closeSynchronouslyOnRemove) channel.emit('CLOSED');
    return Promise.resolve('ok');
  }

  get latest(): FakeChannel {
    const channel = this.created[this.created.length - 1];
    assert.ok(channel, 'expected a channel to have been created');
    return channel;
  }
}

class FakeTimers {
  private nextId = 1;
  pending = new Map<number, { fn: () => void; ms: number }>();
  scheduled: number[] = [];

  setTimer = (fn: () => void, ms: number): number => {
    const id = this.nextId++;
    this.pending.set(id, { fn, ms });
    this.scheduled.push(ms);
    return id;
  };

  clearTimer = (id: number): void => {
    this.pending.delete(id);
  };

  /** Fires the single pending timer, failing if there is not exactly one. */
  fireOnly(): number {
    assert.equal(this.pending.size, 1, 'expected exactly one pending timer');
    const [id, timer] = [...this.pending.entries()][0];
    this.pending.delete(id);
    timer.fn();
    return timer.ms;
  }
}

function setup(overrides: Partial<RealtimeConnectorOptions<FakeChannel, number>> = {}) {
  const client = new FakeClient();
  const timers = new FakeTimers();
  const statuses: RealtimeStatus[] = [];
  const builtWith: Array<() => boolean> = [];
  const connector = createRealtimeConnector<FakeChannel, number>({
    client,
    topicPrefix: 'game_state:abc',
    build: (channel, isCurrent) => {
      builtWith.push(isCurrent);
      return channel;
    },
    onStatus: (status) => statuses.push(status),
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    ...overrides,
  });
  return { client, timers, statuses, builtWith, connector };
}

test('connect opens one channel on a unique topic under the prefix', () => {
  const { client, connector } = setup();
  connector.connect();
  // A second connect while one is live is a no-op, not a second channel.
  connector.connect();
  assert.equal(client.created.length, 1);
  assert.match(client.latest.topic, /^game_state:abc:/);
  assert.equal(client.latest.subscribeCount, 1);
});

test('1. a synchronous CLOSED from removeChannel does not re-enter and leaves at most one timer', () => {
  const { client, timers, statuses, connector } = setup();
  connector.connect();
  const first = client.latest;
  first.emit('SUBSCRIBED');

  // The live channel errors. The connector removes it, which fires CLOSED on it
  // synchronously; that CLOSED must be ignored, not treated as a second failure.
  first.emit('CHANNEL_ERROR');

  assert.deepEqual(client.removed, [first]);
  assert.equal(timers.pending.size, 1, 'exactly one reconnect timer');
  assert.deepEqual(statuses, ['SUBSCRIBED', 'CHANNEL_ERROR'], 'the self-inflicted CLOSED is not reported');
  assert.equal(client.created.length, 1, 'no channel is opened until the timer fires');

  // A manual reconnect of a live channel removes it with the same synchronous
  // CLOSED, and must not schedule anything either.
  timers.fireOnly();
  const second = client.latest;
  second.emit('SUBSCRIBED');
  connector.reconnect();
  assert.equal(client.removed[client.removed.length - 1], second);
  assert.equal(timers.pending.size, 0, 'a reconnect of a live channel schedules no timer');
  assert.equal(client.created.length, 3);
});

test('2. an old channel CLOSED arriving after the new one subscribed is ignored', () => {
  const { client, timers, statuses, connector } = setup();
  client.closeSynchronouslyOnRemove = false;
  connector.connect();
  const oldChannel = client.latest;
  oldChannel.emit('SUBSCRIBED');

  connector.reconnect();
  const newChannel = client.latest;
  assert.notEqual(newChannel, oldChannel);
  newChannel.emit('SUBSCRIBED');

  // The late CLOSED from the channel we already removed.
  oldChannel.emit('CLOSED');
  oldChannel.emit('CHANNEL_ERROR');

  assert.deepEqual(client.removed, [oldChannel], 'the new channel is not removed');
  assert.equal(timers.pending.size, 0, 'no reconnect timer is set');
  assert.deepEqual(statuses, ['SUBSCRIBED', 'SUBSCRIBED']);
});

test('2b. a payload handler built for an old channel reports itself as stale', () => {
  const { builtWith, connector } = setup();
  connector.connect();
  const oldIsCurrent = builtWith[0];
  assert.equal(oldIsCurrent(), true);
  connector.reconnect();
  assert.equal(oldIsCurrent(), false);
  assert.equal(builtWith[1](), true);
  connector.dispose();
  assert.equal(builtWith[1](), false);
});

test('3. dispose cancels a pending timer and removes the channel', () => {
  const { client, timers, statuses, connector } = setup();
  connector.connect();
  client.latest.emit('TIMED_OUT');
  assert.equal(timers.pending.size, 1);

  connector.dispose();
  assert.equal(timers.pending.size, 0, 'the pending reconnect is cancelled');

  // Disposing a live channel removes it, and its synchronous CLOSED is silent.
  const live = setup();
  live.connector.connect();
  const channel = live.client.latest;
  channel.emit('SUBSCRIBED');
  live.connector.dispose();
  assert.deepEqual(live.client.removed, [channel]);
  assert.equal(live.timers.pending.size, 0);
  assert.deepEqual(live.statuses, ['SUBSCRIBED']);

  // Nothing comes back to life after dispose.
  live.connector.connect();
  live.connector.reconnect();
  assert.equal(live.client.created.length, 1);
  assert.equal(statuses.length, 1);
});

test('4. reconnect during a pending timer replaces it rather than adding a second', () => {
  const { client, timers, connector } = setup();
  connector.connect();
  client.latest.emit('CHANNEL_ERROR');
  assert.equal(timers.pending.size, 1);

  connector.reconnect();
  assert.equal(timers.pending.size, 0, 'the pending timer is cancelled');
  assert.equal(client.created.length, 2, 'the reconnect opened a channel straight away');

  client.latest.emit('CHANNEL_ERROR');
  assert.equal(timers.pending.size, 1, 'never more than one pending timer');
});

test('5. backoff grows 1s, 2s, 4s up to 30s, and resets on SUBSCRIBED', () => {
  const { client, timers, connector } = setup();
  connector.connect();

  const delays: number[] = [];
  for (let i = 0; i < 7; i += 1) {
    client.latest.emit('CHANNEL_ERROR');
    delays.push(timers.fireOnly());
  }
  assert.deepEqual(delays, [1000, 2000, 4000, 8000, 16000, 30000, 30000]);

  client.latest.emit('SUBSCRIBED');
  client.latest.emit('CLOSED');
  assert.equal(timers.fireOnly(), 1000, 'a successful subscribe resets the backoff');
});

test('realtimeBackoffMs caps at thirty seconds', () => {
  assert.equal(realtimeBackoffMs(0), 1000);
  assert.equal(realtimeBackoffMs(4), 16000);
  assert.equal(realtimeBackoffMs(5), 30000);
  assert.equal(realtimeBackoffMs(50), 30000);
});

test('onGiveUp fires once the attempt budget is spent, and no timer is left behind', () => {
  let gaveUp = 0;
  const { client, timers, connector } = setup({ maxAttempts: 2, onGiveUp: () => { gaveUp += 1; } });
  connector.connect();
  client.latest.emit('CHANNEL_ERROR');
  timers.fireOnly();
  client.latest.emit('CHANNEL_ERROR');
  timers.fireOnly();
  client.latest.emit('CHANNEL_ERROR');
  assert.equal(gaveUp, 1);
  assert.equal(timers.pending.size, 0);

  // A manual reconnect still works after giving up.
  connector.reconnect();
  assert.equal(client.created.length, 4);
});

test('a build that throws is retried on the backoff rather than killing the connector', () => {
  let calls = 0;
  const { client, timers, connector } = setup({
    build: (channel) => {
      calls += 1;
      if (calls === 1) throw new Error('boom');
      return channel;
    },
  });
  connector.connect();
  assert.equal(timers.pending.size, 1);
  timers.fireOnly();
  assert.equal(client.created.length, 2);
  assert.equal(client.latest.subscribeCount, 1);
});
