// src/lib/env.ts
//
// Cash Bingo's environment rules, on top of the shared kit's checks
// (@anchor-nights/kit/env).
//
// `validateBuildEnv()` is called from next.config.ts, so it runs when the app
// is built (and when `next dev` starts): a missing or malformed variable fails
// the build with a message naming it, instead of shipping and failing on a pub
// night. The kit checks the Supabase pair, NEXT_PUBLIC_SITE_URL and the
// management API key; the error sink rules below are this app's own, because
// they tie three variables together and the kit's rules are one variable each.
//
// next.config.ts imports this file directly, so it must stay free of path
// aliases and TypeScript-only runtime syntax (enums, namespaces). The kit's
// env module is plain JavaScript with no imports, so importing it here is safe.
//
// Deliberately NOT required: NEXT_PUBLIC_SITE_URL (the QR origin falls back to
// Vercel's own production or preview address, @anchor-nights/kit/qr) and
// SUPABASE_SERVICE_ROLE_KEY on its own (only /api/setup and /api/errors use
// it). Once ERROR_SINK_URL is set, though, the sink needs a token and, on
// Vercel production, the service role key to store anything, so those become
// required together.

import {
  ANCHOR_API_ENV,
  SITE_URL_ENV,
  SUPABASE_PUBLIC_ENV,
  checkEnv,
  getPublicSupabaseEnv,
  type EnvRule,
  type PublicSupabaseEnv,
} from '@anchor-nights/kit/env';

export { getPublicSupabaseEnv, type PublicSupabaseEnv };

/**
 * Whether production builds need the management API key for the events feed.
 * True since the events feed shipped (slice S4). Only a Vercel production build
 * needs it: previews and local builds run without it and the screens show the
 * no-events loop (the feed reports `missing_config`).
 */
export const EVENTS_FEED_REQUIRED = true;

/** The shortest ERROR_SINK_TOKEN accepted: long enough that guessing it is hopeless. */
export const ERROR_SINK_TOKEN_MIN_LENGTH = 32;

/**
 * The sink URL may be local http outside production (a local run posting to
 * itself), like ANCHOR_API_BASE_URL, so it takes the kit's api-base-url check
 * rather than its https-only ERROR_SINK_ENV preset.
 */
const ERROR_SINK_URL_RULE: EnvRule = { name: 'ERROR_SINK_URL', kind: 'api-base-url' };

export interface ValidateBuildEnvOptions {
  /** Overrides EVENTS_FEED_REQUIRED; for tests. */
  eventsFeedRequired?: boolean;
}

/** The kit's rules this app uses, with the events key optional when the feed is not required. */
function buildEnvRules(eventsFeedRequired: boolean): EnvRule[] {
  const anchorApi = eventsFeedRequired
    ? ANCHOR_API_ENV
    : ANCHOR_API_ENV.map((rule) => ({ ...rule, required: undefined }));
  return [...SUPABASE_PUBLIC_ENV, ...SITE_URL_ENV, ...anchorApi];
}

/**
 * The error sink (src/app/api/errors/route.ts) refuses every report without
 * a matching bearer token, and cannot store one without the service role.
 * Setting the URL without them would ship reporting that records nothing,
 * which is the state this replaced. Values are never put in the message.
 */
function errorSinkProblems(): string[] {
  if (!process.env.ERROR_SINK_URL?.trim()) return [];
  // The kit quotes a bad URL back; this app never has, so the value is cut.
  const problems = checkEnv([ERROR_SINK_URL_RULE]).map((problem) => problem.replace(/ \(got ".*"\)\.$/, '.'));
  const sinkToken = process.env.ERROR_SINK_TOKEN?.trim() ?? '';
  if (sinkToken.length < ERROR_SINK_TOKEN_MIN_LENGTH) {
    problems.push(
      `ERROR_SINK_TOKEN must be set to a random value of at least ${ERROR_SINK_TOKEN_MIN_LENGTH} characters when ERROR_SINK_URL is set.`,
    );
  }
  if (process.env.VERCEL_ENV === 'production' && !process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
    problems.push('SUPABASE_SERVICE_ROLE_KEY is not set, and production needs it to store error reports when ERROR_SINK_URL is set.');
  }
  return problems;
}

/**
 * Checks the environment a build needs, and throws one error listing every
 * problem. Called from next.config.ts.
 */
export function validateBuildEnv(options: ValidateBuildEnvOptions = {}): void {
  const eventsFeedRequired = options.eventsFeedRequired ?? EVENTS_FEED_REQUIRED;
  const problems = [...checkEnv(buildEnvRules(eventsFeedRequired)), ...errorSinkProblems()];
  if (problems.length > 0) {
    throw new Error(`Environment check failed:\n  - ${problems.join('\n  - ')}`);
  }
}
