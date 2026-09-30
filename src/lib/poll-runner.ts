// src/lib/poll-runner.ts
//
// Sequencing and a deadline for the public screens' 3 second poll.
//
// WHY THIS EXISTS
//   - A poll had no deadline. A request that never answered (a TV on flaky
//     wifi, a half-open socket) kept the in-flight flag set for ever, and every
//     later poll returned early, so an unattended TV silently stopped polling.
//     Now every run gets an AbortController that fires at the deadline, and the
//     flag is released at that moment whether or not the request ever settles.
//   - A slow poll could land after a newer Realtime event and put older state
//     back on screen. Every run carries a sequence number; `invalidate()` moves
//     the sequence on when a Realtime payload is applied, and a caller applies a
//     response only while `isCurrent(seq)` is still true.

export const POLL_DEADLINE_MS = 8000;

/** The rejection a run gets when it passes its deadline. */
export class PollDeadlineError extends Error {
  constructor(deadlineMs: number) {
    super(`Poll did not answer within ${deadlineMs}ms`);
    this.name = 'PollDeadlineError';
  }
}

export interface PollRunnerOptions<T, H> {
  /** One poll. Pass `signal` to every request so an abort really cancels it. */
  run: (signal: AbortSignal) => Promise<T>;
  deadlineMs?: number;
  setTimer?: (fn: () => void, ms: number) => H;
  clearTimer?: (handle: H) => void;
}

export interface PollStart<T> {
  seq: number;
  promise: Promise<T>;
}

export interface PollRunner<T> {
  /** Starts a run, or returns null while one is still in flight. */
  start(): PollStart<T> | null;
  /** True while no newer run has started and nothing has invalidated `seq`. */
  isCurrent(seq: number): boolean;
  /** Discards whatever is in flight. Call it before applying a Realtime payload. */
  invalidate(): void;
  isInFlight(): boolean;
}

export function createPollRunner<T, H = ReturnType<typeof setTimeout>>(
  options: PollRunnerOptions<T, H>,
): PollRunner<T> {
  const { run } = options;
  const deadlineMs = options.deadlineMs ?? POLL_DEADLINE_MS;
  const setTimer =
    options.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms) as unknown as H);
  const clearTimer =
    options.clearTimer ?? ((handle: H) => clearTimeout(handle as unknown as ReturnType<typeof setTimeout>));

  let sequence = 0;
  // The sequence number of the run holding the in-flight flag, or null.
  let inFlight: number | null = null;

  return {
    start() {
      if (inFlight !== null) return null;
      sequence += 1;
      const seq = sequence;
      inFlight = seq;

      const controller = new AbortController();
      let timer: H | null = null;

      const promise = new Promise<T>((resolve, reject) => {
        timer = setTimer(() => {
          timer = null;
          const reason = new PollDeadlineError(deadlineMs);
          controller.abort(reason);
          // Reject here rather than waiting on the request: a request that
          // ignores its signal must still free the flag.
          reject(reason);
        }, deadlineMs);

        try {
          run(controller.signal).then(resolve, reject);
        } catch (err) {
          reject(err);
        }
      });

      const release = () => {
        if (timer !== null) {
          clearTimer(timer);
          timer = null;
        }
        if (inFlight === seq) inFlight = null;
      };
      // Registered before the caller's own handlers, so the flag is already
      // free by the time the caller sees the outcome.
      promise.then(release, release);

      return { seq, promise };
    },

    isCurrent(seq) {
      return seq === sequence;
    },

    invalidate() {
      sequence += 1;
    },

    isInFlight() {
      return inFlight !== null;
    },
  };
}
