// src/lib/env.ts
//
// Environment variables, checked in one place.
//
// `validateBuildEnv()` is called from next.config.ts, so it runs when the app
// is built (and when `next dev` starts): a missing or malformed variable fails
// the build with a message naming it, instead of shipping and failing on a pub
// night. `getPublicSupabaseEnv()` is what the Supabase clients use at runtime.
//
// next.config.ts imports this file directly, so it must stay free of path
// aliases, imports and TypeScript-only runtime syntax (enums, namespaces).
//
// Deliberately NOT required: NEXT_PUBLIC_SITE_URL (the QR origin falls back to
// the request headers) and SUPABASE_SERVICE_ROLE_KEY (production does not set
// it; startGame falls back without it until a later slice removes that path).

/**
 * Whether production builds need the management API key for the events feed.
 * True since the events feed shipped (slice S4). Only a Vercel production build
 * needs it: previews and local builds run without it and the screens show the
 * no-events loop (the feed reports `missing_config`).
 */
export const EVENTS_FEED_REQUIRED = true;

export interface PublicSupabaseEnv {
  url: string;
  anonKey: string;
}

/**
 * The public Supabase URL and anon key. Throws a clear error naming whatever is
 * missing. Each variable is read by its literal name so Next.js can inline it
 * into the browser bundle.
 */
export function getPublicSupabaseEnv(): PublicSupabaseEnv {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const missing: string[] = [];
  if (!url) missing.push('NEXT_PUBLIC_SUPABASE_URL');
  if (!anonKey) missing.push('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  if (!url || !anonKey) {
    throw new Error(
      `Missing environment variable ${missing.join(' and ')}. ` +
        'Set it in .env.local for local runs, or in the Vercel project settings.',
    );
  }
  return { url, anonKey };
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * Why a NEXT_PUBLIC_SITE_URL value is not usable as the QR origin, or null
 * when it is fine. It must be a bare https origin; plain http is accepted only
 * for a loopback host outside production, so a local run can point at itself.
 */
function siteUrlProblem(value: string, isProduction: boolean): string | null {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return 'is not a URL';
  }
  const isLocalHttp = parsed.protocol === 'http:' && LOOPBACK_HOSTS.has(parsed.hostname) && !isProduction;
  if (parsed.protocol !== 'https:' && !isLocalHttp) return 'must use https';
  if (parsed.username || parsed.password) return 'must not contain a username or password';
  if (parsed.pathname !== '/' || parsed.search || parsed.hash) {
    return 'must be an origin only, with no path, query or fragment';
  }
  return null;
}

export interface ValidateBuildEnvOptions {
  /** Overrides EVENTS_FEED_REQUIRED; for tests. */
  eventsFeedRequired?: boolean;
}

/**
 * Checks the environment a build needs, and throws one error listing every
 * problem. Called from next.config.ts.
 */
export function validateBuildEnv(options: ValidateBuildEnvOptions = {}): void {
  const eventsFeedRequired = options.eventsFeedRequired ?? EVENTS_FEED_REQUIRED;
  const isProduction = process.env.VERCEL_ENV === 'production';
  const problems: string[] = [];

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) {
    problems.push('NEXT_PUBLIC_SUPABASE_URL is not set.');
  } else if (!isHttpUrl(supabaseUrl)) {
    problems.push('NEXT_PUBLIC_SUPABASE_URL is not a URL.');
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    problems.push('NEXT_PUBLIC_SUPABASE_ANON_KEY is not set.');
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (siteUrl) {
    const problem = siteUrlProblem(siteUrl, isProduction);
    if (problem) problems.push(`NEXT_PUBLIC_SITE_URL ${problem} (got "${siteUrl}").`);
  }

  if (eventsFeedRequired && isProduction && !process.env.ANCHOR_API_KEY) {
    problems.push('ANCHOR_API_KEY is not set, and production builds need it for the events feed.');
  }

  if (problems.length > 0) {
    throw new Error(`Environment check failed:\n  - ${problems.join('\n  - ')}`);
  }
}
