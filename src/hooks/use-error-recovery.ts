// src/hooks/use-error-recovery.ts
//
// Used by the error boundaries (src/app/display/error.tsx,
// src/app/player/error.tsx and src/app/global-error.tsx) so an unattended
// screen recovers by itself: a retry first, then reloads with a growing wait
// (src/lib/error-recovery.ts). A reload is held back while the device is
// offline, because reloading with no network lands on the browser's offline
// page, which on the TV would stay up until somebody walked over to it.
'use client';

import { useEffect } from 'react';
import {
  ERROR_HISTORY_KEY,
  decideErrorRecovery,
  parseErrorHistory,
  recordError,
  serialiseErrorHistory,
  type ErrorHistory,
} from '@/lib/error-recovery';
import { logError } from '@/lib/log-error';

/** After the connection comes back, the wait before a held-back reload. */
const ONLINE_SETTLE_MS = 3_000;

// The error last counted. React may run the effect twice for one error (Strict
// Mode in development), which must not count as a repeat.
let lastCountedError: unknown = undefined;

function readHistory(): ErrorHistory | null {
  try {
    return parseErrorHistory(window.sessionStorage.getItem(ERROR_HISTORY_KEY));
  } catch {
    return null;
  }
}

function writeHistory(history: ErrorHistory): void {
  try {
    window.sessionStorage.setItem(ERROR_HISTORY_KEY, serialiseErrorHistory(history));
  } catch {
    // Storage unavailable: every error then counts as the first, so the screen
    // keeps retrying every few seconds, which still recovers it.
  }
}

/**
 * Logs the error, then retries or reloads on the schedule in
 * src/lib/error-recovery.ts. `retry` is Next's: it fetches the segment again
 * and re-renders it, which also cures an error thrown while rendering on the
 * server.
 */
export function useErrorRecovery(scope: string, error: unknown, retry: () => void): void {
  useEffect(() => {
    let history = readHistory();
    if (error !== lastCountedError || history === null) {
      lastCountedError = error;
      logError(scope, error);
      history = recordError(history, Date.now());
      writeHistory(history);
    }
    const recovery = decideErrorRecovery(history);

    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    const reloadWhenOnline = () => {
      if (cancelled) return;
      if (!navigator.onLine) {
        window.addEventListener('online', onOnline);
        return;
      }
      window.location.reload();
    };

    function onOnline() {
      window.removeEventListener('online', onOnline);
      timer = setTimeout(reloadWhenOnline, ONLINE_SETTLE_MS);
    }

    timer = setTimeout(() => {
      if (cancelled) return;
      if (recovery.action === 'retry') retry();
      else reloadWhenOnline();
    }, recovery.delayMs);

    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
      window.removeEventListener('online', onOnline);
    };
  }, [scope, error, retry]);
}
