// src/lib/log-error.ts
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

export function logError(scope: string, err: unknown): void {
  if (process.env.NODE_ENV === 'production' && process.env.LOG_ERRORS !== 'true') {
    return;
  }
  const safe = err instanceof Error ? new Error(err.message.replace(UUID_RE, '[redacted-uuid]')) : err;
  console.error(`[${scope}]`, safe);
}
