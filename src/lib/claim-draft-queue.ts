// src/lib/claim-draft-queue.ts
//
// Sends the host's live claim draft to set_claim_draft (spec 5.2, D1): the TV
// and the phones show each claimed number as the host taps it.
//
// THE RULES
//   - One request in flight at a time. While one is out, only the newest list
//     waits; intermediate lists are never sent, because the server would only
//     overwrite them.
//   - Every send carries a sequence number one higher than the last, starting
//     from the stored claim_draft_seq when a phone adopts an attempt. The server
//     ignores a sequence that is not above the one it holds, so a stale or
//     out-of-order write can never replace a newer draft.
//   - A failed send (a refusal the caller calls transient, or a dropped
//     connection) reports 'retrying' and tries again with backoff, sending the
//     newest list with a fresh sequence number. The host screen shows "TV not
//     updated, retrying" while it does.
//   - A permanent refusal ('stop': the claim ended, the attempt was replaced, a
//     verdict was given) stops the queue. Nothing more is sent for this attempt.
//
// Correctness never depends on the draft: Check Win sends the full list to
// check_claim. The draft only keeps the room informed.

export type ClaimDraftSendOutcome = 'ok' | 'error' | 'stop';

export type ClaimDraftQueueState = 'idle' | 'sending' | 'retrying' | 'stopped';

/** The first retry waits a second; each later one doubles, up to this ceiling. */
export const CLAIM_DRAFT_MAX_BACKOFF_MS = 8000;

/** Wait before the retry that follows the given number of consecutive failures (1 or more). */
export function claimDraftBackoffMs(failures: number): number {
  const step = Math.max(1, Math.floor(failures));
  return Math.min(1000 * 2 ** (step - 1), CLAIM_DRAFT_MAX_BACKOFF_MS);
}

export interface ClaimDraftQueueOptions<H> {
  /** Sends one draft. Resolve 'ok', 'error' (retry) or 'stop' (give up); a throw counts as 'error'. */
  send: (numbers: readonly number[], seq: number) => Promise<ClaimDraftSendOutcome>;
  /** The stored claim_draft_seq; the first send uses one more than this. */
  initialSeq?: number;
  onStateChange?: (state: ClaimDraftQueueState) => void;
  setTimer?: (fn: () => void, ms: number) => H;
  clearTimer?: (handle: H) => void;
}

export interface ClaimDraftQueue {
  /** Queues the whole ordered list. Sent at once when nothing is in flight. */
  push(numbers: readonly number[]): void;
  /**
   * Sends anything waiting now, skipping a backoff wait, and resolves once the
   * queue is idle, stopped, or has failed that attempt. It never waits through
   * more than one failure.
   */
  flush(): Promise<void>;
  readonly state: ClaimDraftQueueState;
  /** Stops everything: cancels a pending retry and ignores any answer still to come. */
  dispose(): void;
}

export function createClaimDraftQueue<H = ReturnType<typeof setTimeout>>(
  options: ClaimDraftQueueOptions<H>,
): ClaimDraftQueue {
  const { send, onStateChange } = options;
  const setTimer =
    options.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms) as unknown as H);
  const clearTimer =
    options.clearTimer ?? ((handle: H) => clearTimeout(handle as unknown as ReturnType<typeof setTimeout>));

  let seq = Math.max(0, Math.floor(options.initialSeq ?? 0));
  let state: ClaimDraftQueueState = 'idle';
  let pending: number[] | null = null;
  let inFlight = false;
  let failures = 0;
  let retryTimer: H | null = null;
  let disposed = false;
  // Resolved whenever an attempt finishes and nothing is left to send at once.
  let waiters: Array<() => void> = [];

  const setState = (next: ClaimDraftQueueState) => {
    if (disposed || state === next) return;
    state = next;
    onStateChange?.(next);
  };

  const releaseWaiters = () => {
    const toRelease = waiters;
    waiters = [];
    toRelease.forEach((resolve) => resolve());
  };

  const cancelRetry = () => {
    if (retryTimer !== null) {
      clearTimer(retryTimer);
      retryTimer = null;
    }
  };

  const sendNext = () => {
    if (disposed || inFlight || state === 'stopped' || pending === null) return;
    cancelRetry();

    const numbers = pending;
    pending = null;
    seq += 1;
    inFlight = true;
    if (failures === 0) setState('sending');

    let outcome: Promise<ClaimDraftSendOutcome>;
    try {
      outcome = send(numbers, seq);
    } catch {
      outcome = Promise.resolve<ClaimDraftSendOutcome>('error');
    }

    outcome
      .catch((): ClaimDraftSendOutcome => 'error')
      .then((result) => {
        inFlight = false;
        if (disposed) return;

        if (result === 'stop') {
          pending = null;
          failures = 0;
          setState('stopped');
          releaseWaiters();
          return;
        }

        if (result === 'error') {
          failures += 1;
          // The newest list is what the retry sends. A tap made while this one
          // was out is already newer; otherwise resend this list.
          if (pending === null) pending = numbers;
          setState('retrying');
          retryTimer = setTimer(() => {
            retryTimer = null;
            sendNext();
          }, claimDraftBackoffMs(failures));
          releaseWaiters();
          return;
        }

        failures = 0;
        if (pending !== null) {
          sendNext();
          return;
        }
        setState('idle');
        releaseWaiters();
      });
  };

  return {
    push(numbers) {
      if (disposed || state === 'stopped') return;
      pending = [...numbers];
      // While retrying, the tap waits for the backoff rather than hammering a
      // server that has just failed; flush() is how a caller skips the wait.
      if (retryTimer === null) sendNext();
    },

    flush() {
      if (disposed || state === 'stopped') return Promise.resolve();
      if (!inFlight && pending === null) return Promise.resolve();
      const done = new Promise<void>((resolve) => {
        waiters.push(resolve);
      });
      if (!inFlight) sendNext();
      return done;
    },

    get state() {
      return state;
    },

    dispose() {
      disposed = true;
      cancelRetry();
      pending = null;
      releaseWaiters();
    },
  };
}
