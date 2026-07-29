// src/lib/log-action-failure.ts
/**
 * Server-only diagnostics for host and admin server actions.
 *
 * Unlike `logError`, this ALWAYS logs, including in production, because a
 * failed call during a live game has to be diagnosable from the Vercel logs
 * after the fact. That makes redaction the important part: UUIDs are stripped,
 * and only the error's own message fields are logged. Never pass a user id, a
 * session name or a prize value to either function.
 *
 * Never import this into a client component.
 */
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** Fields worth keeping from a Supabase or Postgres error object. */
const SAFE_ERROR_FIELDS = ['message', 'code', 'details', 'hint'] as const;

function redact(value: string): string {
  return value.replace(UUID_RE, '[redacted-uuid]');
}

function toSafeError(err: unknown): unknown {
  if (err instanceof Error) {
    return new Error(redact(err.message));
  }
  if (typeof err === 'string') {
    return redact(err);
  }
  if (err !== null && typeof err === 'object') {
    // Supabase returns plain objects, not Error instances, so pick the known
    // message fields rather than logging the whole object.
    const source = err as Record<string, unknown>;
    const safe: Record<string, string> = {};
    for (const field of SAFE_ERROR_FIELDS) {
      const value = source[field];
      if (typeof value === 'string' && value.length > 0) {
        safe[field] = redact(value);
      }
    }
    if (Object.keys(safe).length > 0) {
      return safe;
    }
  }
  return '[unloggable error]';
}

/** Always logs, including production. Server-only: never import into a client component. */
export function logActionFailure(action: string, err: unknown): void {
  console.error(`[action:${action}]`, toSafeError(err));
}

/** Logs slow actions so call latency is observable in Vercel logs. */
export function logActionLatency(action: string, startedAtMs: number, thresholdMs = 800): void {
  const elapsedMs = Date.now() - startedAtMs;
  if (elapsedMs < thresholdMs) {
    return;
  }
  console.warn(`[action:${action}] slow: ${elapsedMs}ms (threshold ${thresholdMs}ms)`);
}
