// src/lib/realtime-connector.ts
//
// One guarded Supabase Realtime channel with an exponential-backoff reconnect.
// Framework-free, so it is tested without React: see realtime-connector.test.ts.
//
// WHY THIS EXISTS
//   The host, TV and phone each hand-rolled this, three times over, and all of
//   them could churn. In realtime-js 2.91.0, `removeChannel()` fires CLOSED on
//   the channel being removed synchronously, from inside the call, whenever the
//   socket cannot push the leave message (RealtimeChannel.js, `unsubscribe`).
//   The old code listened for CLOSED on that same channel, so tearing a channel
//   down looked like the channel failing: it scheduled another reconnect, and a
//   late CLOSED from an old channel could tear down the replacement that had
//   just subscribed. After a phone lock or a wifi blip that piled up timers and
//   left the live-calls channel flapping.
//
// THE RULES
//   - A generation counter. Every subscribe callback (and every payload handler,
//     through `isCurrent`) captures the generation it was built for and does
//     nothing once that generation is no longer current.
//   - Before `removeChannel(old)` the reference is cleared and the generation is
//     bumped, so the synchronous CLOSED it fires is already stale.
//   - At most one timer is ever pending.
//   - Backoff runs 1s, 2s, 4s and so on up to 30s, and resets on SUBSCRIBED.
//   - Every channel gets a unique topic. realtime-js returns the EXISTING channel
//     for a topic it already holds, including one that is still leaving, so a
//     reused topic can hand back a channel that is about to close.

import type { RealtimeStatus } from './connection-health';

export const REALTIME_BACKOFF_BASE_MS = 1000;
export const REALTIME_BACKOFF_MAX_MS = 30_000;

/** Delay before reconnect attempt `attempt` (0-based): 1s, 2s, 4s ... 30s. */
export function realtimeBackoffMs(attempt: number): number {
  return Math.min(REALTIME_BACKOFF_BASE_MS * 2 ** Math.max(0, attempt), REALTIME_BACKOFF_MAX_MS);
}

/** The part of a realtime-js channel the connector touches. */
export interface ConnectorChannel {
  subscribe(callback: (status: string, err?: Error) => void): unknown;
}

/** The part of a Supabase client the connector touches. */
export interface ConnectorClient<C extends ConnectorChannel> {
  channel(topic: string): C;
  removeChannel(channel: C): unknown;
}

export interface RealtimeConnectorOptions<C extends ConnectorChannel, H> {
  client: ConnectorClient<C>;
  /** Readable prefix for the topic; a unique suffix is added per channel. */
  topicPrefix: string;
  /**
   * Attaches the `.on(...)` handlers to a fresh channel and returns it. Payload
   * handlers should return early when `isCurrent()` is false: that is the same
   * generation guard the subscribe callback uses.
   */
  build: (channel: C, isCurrent: () => boolean) => C;
  /** Every status of the CURRENT channel. Stale channels are never reported. */
  onStatus: (status: RealtimeStatus) => void;
  /** Called once when `maxAttempts` consecutive failures have been used up. */
  onGiveUp?: () => void;
  /** Consecutive failed attempts before giving up. Defaults to never. */
  maxAttempts?: number;
  setTimer: (fn: () => void, ms: number) => H;
  clearTimer: (handle: H) => void;
}

export interface RealtimeConnector {
  /** Opens the channel if none is open or pending. Otherwise a no-op. */
  connect(): void;
  /** Tears down whatever is there, cancels any pending retry, and opens now. */
  reconnect(): void;
  /** Cancels the timer and removes the channel. Nothing reopens afterwards. */
  dispose(): void;
}

const FAILURE_STATUSES = new Set(['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED']);

// Distinguishes connectors in the same page, so two instances with the same
// prefix (React Strict Mode mounts effects twice) never share a topic.
let connectorSerial = 0;

export function createRealtimeConnector<C extends ConnectorChannel, H>(
  options: RealtimeConnectorOptions<C, H>,
): RealtimeConnector {
  const { client, topicPrefix, build, onStatus, onGiveUp, setTimer, clearTimer } = options;
  const maxAttempts = options.maxAttempts ?? Number.POSITIVE_INFINITY;

  connectorSerial += 1;
  const instanceTag = `${connectorSerial.toString(36)}${Math.random().toString(36).slice(2, 7)}`;

  let generation = 0;
  let channelSerial = 0;
  let current: C | null = null;
  let timer: { handle: H } | null = null;
  let attempts = 0;
  let disposed = false;

  const cancelTimer = () => {
    if (timer) {
      clearTimer(timer.handle);
      timer = null;
    }
  };

  const remove = (channel: C) => {
    try {
      const result = client.removeChannel(channel);
      // A rejected removal must not surface as an unhandled rejection: the
      // channel is already forgotten either way.
      if (result && typeof (result as Promise<unknown>).catch === 'function') {
        (result as Promise<unknown>).catch(() => undefined);
      }
    } catch {
      // Same reasoning as above.
    }
  };

  /**
   * Forget the current channel, THEN remove it. Order matters: the generation
   * moves first, so the CLOSED that removeChannel fires synchronously arrives
   * at a callback that already knows it is stale.
   */
  const teardown = () => {
    const old = current;
    current = null;
    generation += 1;
    if (old) remove(old);
  };

  const scheduleReconnect = () => {
    if (disposed) return;
    cancelTimer();
    if (attempts >= maxAttempts) {
      onGiveUp?.();
      return;
    }
    const delay = realtimeBackoffMs(attempts);
    attempts += 1;
    timer = {
      handle: setTimer(() => {
        timer = null;
        open();
      }, delay),
    };
  };

  const open = () => {
    if (disposed) return;
    cancelTimer();
    teardown();

    const myGeneration = generation;
    const isCurrent = () => !disposed && myGeneration === generation;

    channelSerial += 1;
    const raw = client.channel(`${topicPrefix}:${instanceTag}:${channelSerial}`);
    let channel: C;
    try {
      channel = build(raw, isCurrent);
    } catch {
      // A throwing build is a failed attempt like any other: drop the half-made
      // channel and retry on the backoff.
      generation += 1;
      remove(raw);
      scheduleReconnect();
      return;
    }
    current = channel;

    try {
      channel.subscribe((status) => {
        if (!isCurrent()) return;
        onStatus(status as RealtimeStatus);
        if (status === 'SUBSCRIBED') {
          attempts = 0;
          return;
        }
        if (FAILURE_STATUSES.has(status)) {
          teardown();
          scheduleReconnect();
        }
      });
    } catch {
      if (!isCurrent()) return;
      teardown();
      scheduleReconnect();
    }
  };

  return {
    connect() {
      if (disposed || current || timer) return;
      open();
    },
    reconnect() {
      open();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelTimer();
      teardown();
    },
  };
}
