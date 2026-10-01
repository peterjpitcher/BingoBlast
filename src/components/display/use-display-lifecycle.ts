// src/components/display/use-display-lifecycle.ts
//
// Keeps an unattended pub TV on the right session (spec 5.8, A3):
//   - Once a minute it re-reads the candidate sessions, to know whether its
//     session is still the unique one /play would pick (the QR is then the
//     short `/play`; otherwise `/play?s=<id>`, R12).
//   - At night_over it stays on the end-of-night screen until 04:00 London time
//     the next morning (from completed_at, or from when this screen first saw
//     the night end if the row has no completed_at), or until a different
//     session is running, and then goes back to /display to find the next one.
'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { createClient } from '@/utils/supabase/client';
import type { NightPhase } from '@/lib/night-phase';
import { getTodayIsoDateInLondon, nextLondonFourAm } from '@/lib/dates';
import {
  CANDIDATE_SESSION_STATUSES,
  displayLobbyPath,
  resolveDisplaySession,
  type ResolvableSession,
} from '@/lib/session-resolution';
import { logError } from '@/lib/log-error';

const CHECK_INTERVAL_MS = 60_000;

type PublicClient = ReturnType<typeof createClient>;

export interface UseDisplayLifecycleOptions {
  supabase: PublicClient;
  sessionId: string;
  /** Rehearsal mode (`?rehearsal=1`): test sessions count, and the TV returns to the rehearsal lobby. */
  rehearsal: boolean;
  /** Null while the screen is still loading. */
  nightPhase: NightPhase | null;
  completedAt: string | null;
  /** From useClockOffset: corrects a TV clock that runs fast or slow. */
  clockOffsetMs: number;
  /** Worked out by the server page, until the first check here. */
  initialIsUniqueSession: boolean;
  logScope: string;
}

export function useDisplayLifecycle({
  supabase,
  sessionId,
  rehearsal,
  nightPhase,
  completedAt,
  clockOffsetMs,
  initialIsUniqueSession,
  logScope,
}: UseDisplayLifecycleOptions): { isUniqueSession: boolean } {
  const router = useRouter();
  const [isUniqueSession, setIsUniqueSession] = useState(initialIsUniqueSession);
  const offsetRef = useRef(clockOffsetMs);
  const nightOverSinceRef = useRef<string | null>(null);
  const leavingRef = useRef(false);
  const isNightOver = nightPhase === 'night_over';

  useEffect(() => {
    offsetRef.current = clockOffsetMs;
  }, [clockOffsetMs]);

  useEffect(() => {
    let cancelled = false;
    if (!isNightOver) nightOverSinceRef.current = null;

    const correctedNow = () => Date.now() + offsetRef.current;

    const leave = () => {
      if (leavingRef.current) return;
      leavingRef.current = true;
      router.replace(displayLobbyPath({ rehearsal }));
    };

    const check = async () => {
      if (cancelled || leavingRef.current) return;

      if (isNightOver) {
        if (!nightOverSinceRef.current) nightOverSinceRef.current = new Date(correctedNow()).toISOString();
        const leaveAt = nextLondonFourAm(completedAt ?? nightOverSinceRef.current);
        if (leaveAt && correctedNow() >= new Date(leaveAt).getTime()) {
          leave();
          return;
        }
      }

      const { data, error } = await supabase
        .from('sessions')
        .select('id, status, start_date, is_test_session')
        .in('status', CANDIDATE_SESSION_STATUSES)
        .returns<ResolvableSession[]>();
      if (cancelled) return;
      if (error || !data) {
        // Keep what we had: the QR stays as it was, and the next check retries.
        logError(logScope, error ?? new Error('Candidate sessions lookup returned nothing'));
        return;
      }

      const today = getTodayIsoDateInLondon(new Date(correctedNow()));
      // Test sessions are never the unique match: /play without an id ignores
      // them, so a rehearsal QR always carries its id.
      const resolution = resolveDisplaySession(data, today, { includeTest: false });
      setIsUniqueSession(resolution.kind === 'one' && resolution.id === sessionId);

      if (isNightOver) {
        const anotherIsRunning = data.some(
          (row) => row.id !== sessionId && row.status === 'running' && (rehearsal || !row.is_test_session)
        );
        if (anotherIsRunning) leave();
      }
    };

    const run = () => {
      check().catch((err) => {
        if (!cancelled) logError(logScope, err);
      });
    };

    run();
    const interval = setInterval(run, CHECK_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') run();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [supabase, sessionId, rehearsal, isNightOver, completedAt, router, logScope]);

  return { isUniqueSession };
}
