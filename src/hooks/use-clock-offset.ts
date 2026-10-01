// src/hooks/use-clock-offset.ts
//
// The server clock offset for the public screens' reveal delay
// (src/lib/clock-offset.ts): sampled from GET /api/time on load and every ten
// minutes. Returns 0 until the first successful round, then the last good
// offset. Use as: correctedNow = Date.now() + offset.
'use client';

import { useEffect, useState } from 'react';
import { createClockOffsetSampler } from '@/lib/clock-offset';

const TIME_REQUEST_TIMEOUT_MS = 5000;

async function fetchServerNow(): Promise<number> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIME_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch('/api/time', { cache: 'no-store', signal: controller.signal });
    if (!response.ok) throw new Error(`GET /api/time answered ${response.status}`);
    const body: unknown = await response.json();
    const now = (body as { now?: unknown } | null)?.now;
    if (typeof now !== 'number' || !Number.isFinite(now)) {
      throw new Error('GET /api/time returned no usable time');
    }
    return now;
  } finally {
    clearTimeout(timer);
  }
}

export function useClockOffset(): number {
  const [offsetMs, setOffsetMs] = useState(0);

  useEffect(() => {
    const sampler = createClockOffsetSampler(fetchServerNow);
    const unsubscribe = sampler.onChange(setOffsetMs);
    sampler.start();
    return () => {
      unsubscribe();
      sampler.stop();
    };
  }, []);

  return offsetMs;
}
