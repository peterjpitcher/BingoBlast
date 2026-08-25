// src/lib/report-error.ts
//
// Where a technical failure goes so somebody can find it the morning after.
//
// WHY THIS IS NOT A DATABASE TABLE
//   The obvious design is an errors table. It is the wrong one: the failures
//   that matter most on a bingo night are Supabase being unreachable, and a sink
//   that lives inside the thing that broke records nothing at exactly the moment
//   you need it. The business audit trail belongs in the database, because it is
//   a record of what the pub did. Technical failures belong outside it, because
//   they are a record of the database not answering.
//
// WHY A GENERIC ENDPOINT RATHER THAN AN SDK
//   Installing an error-tracking SDK changes the build, adds a large dependency
//   and pins the project to one vendor, and the review of this work was explicit
//   that a dependency change deserves its own changeset with its own regression
//   testing. This is a fifty-line boundary with no dependency that posts a
//   redacted JSON payload to whatever URL is configured. Sentry, Logtail, Axiom,
//   BetterStack and a plain Slack or Make webhook all accept that shape. If the
//   volume ever justifies a real SDK, this is the seam to swap.
//
// WITH NO URL CONFIGURED IT IS A NO-OP BEYOND THE EXISTING CONSOLE LOGGING, so
// this is safe to ship before anyone has chosen a provider.
//
// REDACTION IS THE POINT, NOT AN EXTRA
//   This app deliberately does not identify players. An error reporter that
//   ships raw Postgres detail undoes that in one line: Postgres puts the failing
//   ROW into DETAIL on a constraint violation, so an un-redacted winners insert
//   failure would post prize amounts, and once upon a time customer names, to a
//   third party. Only the message and code are ever sent, uuids are stripped,
//   and anything that looks like a pound amount is masked.

import { logActionFailure } from '@/lib/log-action-failure';

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const MONEY_RE = /£\s?\d[\d,]*(\.\d{1,2})?/g;
const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/g;

/** How long to wait before giving up on the sink. A slow sink must never slow a game. */
const SINK_TIMEOUT_MS = 2000;

function redact(value: string): string {
  return value
    .replace(UUID_RE, '[uuid]')
    .replace(EMAIL_RE, '[email]')
    .replace(MONEY_RE, '[amount]');
}

/**
 * Pulls the safe fields off an unknown thrown value.
 *
 * `details` and `hint` are dropped deliberately, matching log-action-failure.ts:
 * Postgres puts the failing row into DETAIL on a check or unique violation, so
 * keeping them would post the contents of a winners row to a third party.
 */
function toSafePayload(err: unknown): { message: string; code?: string } {
  if (err instanceof Error) {
    return { message: redact(err.message) };
  }
  if (typeof err === 'string') {
    return { message: redact(err) };
  }
  if (err !== null && typeof err === 'object') {
    const source = err as Record<string, unknown>;
    const message = typeof source.message === 'string' ? redact(source.message) : '[unloggable error]';
    const code = typeof source.code === 'string' ? redact(source.code) : undefined;
    return code ? { message, code } : { message };
  }
  return { message: '[unloggable error]' };
}

export interface ErrorContext {
  /** Where it happened, e.g. 'recordWinner' or 'display:poll'. Never a value. */
  scope: string;
  /** Correlates this technical failure with a business audit row, if there is one. */
  correlationId?: string;
}

/**
 * Reports a technical failure.
 *
 * Always logs to the server console, which is what Vercel captures. Additionally
 * posts to ERROR_SINK_URL when one is configured, so the record outlives Vercel's
 * retention.
 *
 * Never throws and never rejects. A failure to report a failure must not become
 * the failure: if the sink is down mid-game, the game carries on.
 */
export async function reportError(context: ErrorContext, err: unknown): Promise<void> {
  const safe = toSafePayload(err);

  // The console line goes out first and unconditionally, so nothing depends on
  // the sink being reachable or configured.
  logActionFailure(context.scope, err);

  const sinkUrl = process.env.ERROR_SINK_URL;
  if (!sinkUrl) return;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SINK_TIMEOUT_MS);

    await fetch(sinkUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(process.env.ERROR_SINK_TOKEN
          ? { authorization: `Bearer ${process.env.ERROR_SINK_TOKEN}` }
          : {}),
      },
      body: JSON.stringify({
        app: 'anchor-bingo',
        environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'unknown',
        scope: context.scope,
        correlationId: context.correlationId,
        message: safe.message,
        code: safe.code,
        at: new Date().toISOString(),
      }),
      signal: controller.signal,
      // Never let a reporting call hold up a response the host is waiting on.
      keepalive: true,
      cache: 'no-store',
    });

    clearTimeout(timer);
  } catch {
    // Deliberately silent. The console line above already recorded the original
    // failure, and a sink outage is not something the host can act on mid-game.
  }
}
