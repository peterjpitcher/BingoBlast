// src/lib/error-recovery.ts
//
// How an error boundary on an unattended screen gets itself back (the pub TV,
// the phones, and the root layout). Pure: the hook in
// src/hooks/use-error-recovery.ts reads and writes the history and runs the
// timers.
//
// Without this, a render exception left the TV on Next's error page until
// somebody walked over to it. The rule:
//   - the first error retries the segment in place after a few seconds (Next's
//     retry(), which fetches the page again and re-renders it);
//   - an error again within a few minutes means the retry did not cure it, so
//     the page reloads instead, waiting longer each time it repeats (up to a
//     minute), so a page that fails on every load never hammers the server;
//   - an error long after the last one starts again with a retry.
//
// The history lives in sessionStorage, so the waits keep growing across the
// reloads themselves.

/** The wait before the first retry, and before the first reload. */
export const ERROR_RETRY_DELAY_MS = 5_000;

/** The longest wait between reloads while the error keeps coming back. */
export const ERROR_RELOAD_MAX_DELAY_MS = 60_000;

/**
 * An error within this long of the previous one counts as the same trouble.
 * Longer than the longest reload wait, so a page failing on every load keeps
 * backing off rather than starting again from a retry.
 */
export const ERROR_REPEAT_WINDOW_MS = 5 * 60_000;

/** The sessionStorage key the hook keeps the history under. */
export const ERROR_HISTORY_KEY = 'anchor-bingo:error-recovery';

export interface ErrorHistory {
  /** Errors in a row, each within ERROR_REPEAT_WINDOW_MS of the one before. */
  count: number;
  /** Date.now() of the latest one. */
  lastAtMs: number;
}

export interface ErrorRecovery {
  action: 'retry' | 'reload';
  delayMs: number;
}

/** The history after one more error at `nowMs`. */
export function recordError(previous: ErrorHistory | null, nowMs: number): ErrorHistory {
  const elapsed = previous ? nowMs - previous.lastAtMs : Number.POSITIVE_INFINITY;
  // A clock that went backwards is treated as a fresh start, never a repeat.
  if (!previous || elapsed < 0 || elapsed > ERROR_REPEAT_WINDOW_MS) {
    return { count: 1, lastAtMs: nowMs };
  }
  return { count: previous.count + 1, lastAtMs: nowMs };
}

/** What to do about the latest error, and how long to wait first. */
export function decideErrorRecovery(history: ErrorHistory): ErrorRecovery {
  if (history.count <= 1) return { action: 'retry', delayMs: ERROR_RETRY_DELAY_MS };
  const doublings = Math.min(history.count - 2, 10);
  return {
    action: 'reload',
    delayMs: Math.min(ERROR_RETRY_DELAY_MS * 2 ** doublings, ERROR_RELOAD_MAX_DELAY_MS),
  };
}

/** The stored history, or null when there is none or it is not readable. */
export function parseErrorHistory(raw: string | null | undefined): ErrorHistory | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return null;
    const { count, lastAtMs } = value as { count?: unknown; lastAtMs?: unknown };
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 1) return null;
    if (typeof lastAtMs !== 'number' || !Number.isFinite(lastAtMs)) return null;
    return { count, lastAtMs };
  } catch {
    return null;
  }
}

export function serialiseErrorHistory(history: ErrorHistory): string {
  return JSON.stringify({ count: history.count, lastAtMs: history.lastAtMs });
}
