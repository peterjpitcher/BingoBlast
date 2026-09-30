// src/lib/clock-offset.ts
//
// How far this device's clock is from the server's.
//
// WHY THIS EXISTS
//   The public screens hold each new ball back for `call_delay_seconds` after
//   `last_call_at`, which is a SERVER timestamp, compared against the device
//   clock. A pub TV whose clock ran fast saw every ball as already old, so the
//   delay vanished and the ball appeared before the host had read it out.
//
// HOW
//   GET /api/time returns the server's Date.now(). For each request we note the
//   device time before (t0) and after (t1). The server read its clock somewhere
//   between the two, so the best estimate is the midpoint, and the sample with
//   the smallest round trip has the smallest error. Three samples on load and
//   every ten minutes; the last good offset is kept when a round fails, and the
//   offset is 0 until the first round succeeds.
//
//   correctedNow = Date.now() + offset

export const CLOCK_OFFSET_SAMPLES_PER_ROUND = 3;
export const CLOCK_OFFSET_RESAMPLE_MS = 10 * 60 * 1000;

export interface ClockSample {
  /** Device Date.now() just before the request. */
  t0: number;
  /** Device Date.now() just after the response. */
  t1: number;
  /** The server's Date.now() from the response. */
  server: number;
}

export function isUsableClockSample(sample: ClockSample): boolean {
  return (
    Number.isFinite(sample.t0) &&
    Number.isFinite(sample.t1) &&
    Number.isFinite(sample.server) &&
    sample.t1 >= sample.t0
  );
}

/**
 * `server - (t0 + t1) / 2` for the usable sample with the lowest round trip.
 * Returns 0 (no correction) when there is no usable sample.
 */
export function computeClockOffset(samples: ClockSample[]): number {
  let best: ClockSample | null = null;
  for (const sample of samples) {
    if (!isUsableClockSample(sample)) continue;
    if (!best || sample.t1 - sample.t0 < best.t1 - best.t0) best = sample;
  }
  if (!best) return 0;
  return Math.round(best.server - (best.t0 + best.t1) / 2);
}

export interface ClockOffsetSamplerOptions<H> {
  samplesPerRound?: number;
  resampleMs?: number;
  now?: () => number;
  setInterval?: (fn: () => void, ms: number) => H;
  clearInterval?: (handle: H) => void;
}

export interface ClockOffsetSampler {
  /** The last good offset in ms, 0 before the first successful round. */
  getOffset(): number;
  /** One round of samples. Joins the round in progress if there is one. */
  sample(): Promise<number>;
  /** Samples now and every `resampleMs`. */
  start(): void;
  stop(): void;
  /** Called whenever a round produces an offset. Returns an unsubscribe. */
  onChange(listener: (offset: number) => void): () => void;
}

export function createClockOffsetSampler<H = ReturnType<typeof setInterval>>(
  fetchServerNow: () => Promise<number>,
  options: ClockOffsetSamplerOptions<H> = {},
): ClockOffsetSampler {
  const samplesPerRound = options.samplesPerRound ?? CLOCK_OFFSET_SAMPLES_PER_ROUND;
  const resampleMs = options.resampleMs ?? CLOCK_OFFSET_RESAMPLE_MS;
  const now = options.now ?? (() => Date.now());
  const startInterval =
    options.setInterval ?? ((fn: () => void, ms: number) => setInterval(fn, ms) as unknown as H);
  const stopInterval =
    options.clearInterval ??
    ((handle: H) => clearInterval(handle as unknown as ReturnType<typeof setInterval>));

  let offset = 0;
  let round: Promise<number> | null = null;
  let interval: H | null = null;
  const listeners = new Set<(offset: number) => void>();

  const runRound = async (): Promise<number> => {
    const samples: ClockSample[] = [];
    // One after another, not in parallel: parallel requests queue behind each
    // other on the same connection and every round trip looks slow.
    for (let i = 0; i < samplesPerRound; i += 1) {
      try {
        const t0 = now();
        const server = await fetchServerNow();
        const t1 = now();
        samples.push({ t0, t1, server });
      } catch {
        // A failed sample is simply not counted.
      }
    }
    const usable = samples.filter(isUsableClockSample);
    if (usable.length > 0) {
      offset = computeClockOffset(usable);
      listeners.forEach((listener) => listener(offset));
    }
    return offset;
  };

  const sample = () => {
    if (!round) {
      round = runRound().finally(() => {
        round = null;
      });
    }
    return round;
  };

  return {
    getOffset: () => offset,
    sample,
    start() {
      if (interval !== null) return;
      void sample();
      interval = startInterval(() => {
        void sample();
      }, resampleMs);
    },
    stop() {
      if (interval !== null) {
        stopInterval(interval);
        interval = null;
      }
    },
    onChange(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
