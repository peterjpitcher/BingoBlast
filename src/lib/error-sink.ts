// src/lib/error-sink.ts
//
// The receiving end of src/lib/report-error.ts: validates a posted report,
// redacts it again, and stores it in public.app_errors. The route file
// (src/app/api/errors/route.ts) only wires this to the real service-role
// client, so everything that matters here is testable without a database.
//
// WHO POSTS HERE
//   Only this app's own server. reportError() runs in server actions, server
//   pages and the events-feed projection; nothing in the browser posts a
//   report. So the route is not a public form: every report must carry
//   `Authorization: Bearer <ERROR_SINK_TOKEN>`, the header reportError already
//   sends when that variable is set. With no token configured the route refuses
//   everything (fail closed) rather than opening a public write into the
//   database.
//
// FAIL CLOSED, NEVER THROW
//   Every path answers with a status that says what happened: 201 only after
//   the insert returned the new row's id, and 4xx or 5xx otherwise. The handler
//   never throws to its caller. reportError ignores the answer, so a failure
//   here costs a report, never a game.
//
// NEVER REPORT FROM HERE
//   A failure in this file is logged to the console only. Calling reportError
//   from the sink would post to the sink, which is a loop.

import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

import { redact } from '@anchor-nights/kit/errors';

/** The largest body accepted, in bytes. A real report is a few hundred. */
export const MAX_BODY_BYTES = 8 * 1024;

/** Per client IP, per window. Generous for one server's bursts, tight for abuse. */
export const RATE_LIMIT_MAX = 60;
export const RATE_LIMIT_WINDOW_MS = 60_000;

// Field caps. They match the CHECK constraints in
// supabase/migrations/20261106194703_app_errors.sql, so a payload that passes
// here can never be refused by the table for its length.
const SOURCE_MAX = 120;
const MESSAGE_MAX = 2000;
const DIGEST_MAX = 200;
const PATH_MAX = 500;
const USER_AGENT_MAX = 300;

const optionalText = (max: number) => z.string().max(max).nullish();

/**
 * What reportError() posts, plus `digest` and `path` for senders that have
 * them (a Next.js error boundary, the shared kit later). Unknown fields are
 * stripped, never stored.
 */
export const errorReportSchema = z.object({
  app: optionalText(40),
  environment: optionalText(40),
  scope: z.string().trim().min(1).max(SOURCE_MAX),
  correlationId: optionalText(120),
  message: z.string().trim().min(1).max(MESSAGE_MAX),
  code: optionalText(40),
  digest: optionalText(DIGEST_MAX),
  path: optionalText(PATH_MAX),
  at: optionalText(40),
});

export type ErrorReport = z.infer<typeof errorReportSchema>;

/** The row the sink inserts, already redacted and capped. */
export interface AppErrorInsert {
  source: string;
  message: string;
  digest: string | null;
  path: string | null;
  context: Record<string, string>;
  user_agent: string | null;
}

export type InsertResult = { ok: true; id: string } | { ok: false; code?: string };

export interface ErrorSinkDeps {
  /** The bearer token reports must carry. Unset means the sink refuses everything. */
  token: string | undefined;
  /** Inserts the row with the service role and returns its id, or a failure. Unset means not configured. */
  insert: ((row: AppErrorInsert) => Promise<InsertResult>) | undefined;
  /** Rate limiter: true when this key may make another request now. */
  allow: (key: string) => boolean;
}

export interface SinkResponse {
  status: number;
  body: { ok: true; id: string } | { ok: false; error: string };
}

function refuse(status: number, error: string): SinkResponse {
  return { status, body: { ok: false, error } };
}

function tokenMatches(provided: string, expected: string): boolean {
  // Hash both sides so the comparison is constant time whatever the lengths.
  const a = createHash('sha256').update(provided, 'utf8').digest();
  const b = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(a, b);
}

function clip(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

function redactOptional(value: string | null | undefined, max: number): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return clip(redact(trimmed), max);
}

/**
 * Keeps only the pathname of a path or URL: a query string can carry anything,
 * so it is dropped before redaction rather than redacted.
 */
function safePath(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  let pathname = trimmed;
  try {
    pathname = new URL(trimmed, 'https://placeholder.invalid').pathname;
  } catch {
    pathname = trimmed.split(/[?#]/)[0] ?? '';
  }
  return pathname ? clip(redact(pathname), PATH_MAX) : null;
}

/** Turns a validated report into the row to store, redacting every text field again. */
export function toAppErrorRow(report: ErrorReport, userAgent: string | null): AppErrorInsert {
  const context: Record<string, string> = {};
  const add = (key: string, value: string | null | undefined, max: number) => {
    const safe = redactOptional(value, max);
    if (safe) context[key] = safe;
  };
  add('app', report.app, 40);
  add('environment', report.environment, 40);
  add('code', report.code, 40);
  add('correlationId', report.correlationId, 120);
  add('reportedAt', report.at, 40);

  return {
    source: clip(redact(report.scope.trim()), SOURCE_MAX),
    message: clip(redact(report.message.trim()), MESSAGE_MAX),
    digest: redactOptional(report.digest, DIGEST_MAX),
    path: safePath(report.path),
    context,
    user_agent: redactOptional(userAgent, USER_AGENT_MAX),
  };
}

export interface SinkRequest {
  authorization: string | null;
  contentLength: string | null;
  clientKey: string;
  userAgent: string | null;
  /** Reads the raw body. Called at most once, after the cheap checks pass. */
  readBody: () => Promise<string>;
}

/**
 * Handles one posted report. Never throws: anything unexpected becomes a 500.
 */
export async function handleErrorReport(request: SinkRequest, deps: ErrorSinkDeps): Promise<SinkResponse> {
  try {
    if (!deps.token || !deps.insert) {
      console.error('[api:errors] refused: the sink is not configured (ERROR_SINK_TOKEN or SUPABASE_SERVICE_ROLE_KEY unset)');
      return refuse(503, 'not_configured');
    }

    // Counted before the token check, so guessing the token is rate limited too.
    if (!deps.allow(request.clientKey)) {
      return refuse(429, 'rate_limited');
    }

    const bearer = request.authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? '';
    if (!bearer || !tokenMatches(bearer, deps.token)) {
      return refuse(401, 'unauthorized');
    }

    const declared = Number(request.contentLength);
    if (request.contentLength !== null && Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      return refuse(413, 'too_large');
    }

    const raw = await request.readBody();
    // The header can be absent or wrong, so the real size is checked too.
    if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) {
      return refuse(413, 'too_large');
    }

    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return refuse(400, 'invalid_json');
    }

    const parsed = errorReportSchema.safeParse(json);
    if (!parsed.success) {
      return refuse(400, 'invalid_payload');
    }

    const row = toAppErrorRow(parsed.data, request.userAgent);
    const result = await deps.insert(row);
    if (!result.ok) {
      console.error('[api:errors] insert failed', { code: result.code ?? 'unknown' });
      return refuse(503, 'not_stored');
    }

    return { status: 201, body: { ok: true, id: result.id } };
  } catch (err) {
    console.error('[api:errors] unexpected failure', {
      message: err instanceof Error ? redact(err.message) : 'non-error thrown',
    });
    return refuse(500, 'internal_error');
  }
}

/**
 * A fixed-window limiter held in memory. Each serverless instance keeps its
 * own counts, so the real ceiling is RATE_LIMIT_MAX per instance; that is
 * enough to stop one caller flooding the table, which is the point. The repo
 * has no shared limiter to reuse.
 */
export function createRateLimiter(
  max: number = RATE_LIMIT_MAX,
  windowMs: number = RATE_LIMIT_WINDOW_MS,
  now: () => number = Date.now,
): (key: string) => boolean {
  const windows = new Map<string, { start: number; count: number }>();
  return (key: string) => {
    const at = now();
    const current = windows.get(key);
    if (!current || at - current.start >= windowMs) {
      // Drop expired windows now and then so the map cannot grow for ever.
      if (windows.size > 1000) {
        for (const [k, w] of windows) if (at - w.start >= windowMs) windows.delete(k);
      }
      windows.set(key, { start: at, count: 1 });
      return true;
    }
    if (current.count >= max) return false;
    current.count += 1;
    return true;
  };
}

/** The client IP Vercel reports, or a fixed key when there is none. */
export function clientKeyFrom(forwardedFor: string | null, realIp: string | null): string {
  const first = forwardedFor?.split(',')[0]?.trim();
  return first || realIp?.trim() || 'unknown';
}
