// src/lib/site-origin.ts
//
// The public origin every QR code is built on (spec 5.4). First match wins:
//   1. NEXT_PUBLIC_SITE_URL, when it is an https origin (never on a preview);
//   2. production: https:// plus VERCEL_PROJECT_PRODUCTION_URL (then VERCEL_URL);
//   3. preview: https:// plus VERCEL_BRANCH_URL, or VERCEL_URL;
//   4. anywhere else (a local run): the request origin.
//
// A preview never points at production, even when NEXT_PUBLIC_SITE_URL is set
// for every environment, so a rehearsal QR cannot send phones to the live app.
// On Vercel the request headers are never used: a spoofed Host header must not
// be able to turn the pub TV's QR into someone else's link.

export interface SiteOriginEnv {
  NEXT_PUBLIC_SITE_URL?: string;
  VERCEL_ENV?: string;
  VERCEL_PROJECT_PRODUCTION_URL?: string;
  VERCEL_BRANCH_URL?: string;
  VERCEL_URL?: string;
  NODE_ENV?: string;
}

export interface GetSiteOriginInput {
  env: SiteOriginEnv;
  /** The origin the request arrived on (getRequestOrigin); used only off Vercel. */
  requestOrigin: string | null;
}

/** "https://host" from a bare Vercel host such as "bingo-blast-ten.vercel.app". */
function originFromHost(host: string | undefined): string | null {
  const trimmed = host?.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  if (!trimmed) return null;
  return parseOrigin(`https://${trimmed}`, ['https:']);
}

/** The origin of `value`, or null unless it is a bare origin with an allowed scheme. */
function parseOrigin(value: string, protocols: string[]): string | null {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (!protocols.includes(parsed.protocol)) return null;
  if (parsed.username || parsed.password) return null;
  if (parsed.pathname !== '/' || parsed.search || parsed.hash) return null;
  return parsed.origin;
}

export function getSiteOrigin({ env, requestOrigin }: GetSiteOriginInput): string | null {
  const vercelEnv = env.VERCEL_ENV;

  if (vercelEnv !== 'preview' && env.NEXT_PUBLIC_SITE_URL) {
    const explicit = parseOrigin(env.NEXT_PUBLIC_SITE_URL.trim(), ['https:']);
    if (explicit) return explicit;
  }

  if (vercelEnv === 'production') {
    return originFromHost(env.VERCEL_PROJECT_PRODUCTION_URL) ?? originFromHost(env.VERCEL_URL);
  }

  if (vercelEnv === 'preview') {
    return originFromHost(env.VERCEL_BRANCH_URL) ?? originFromHost(env.VERCEL_URL);
  }

  if (!requestOrigin) return null;
  return parseOrigin(requestOrigin.trim().replace(/\/+$/, '') || '', ['https:', 'http:']);
}

/**
 * The origin a request arrived on, from its headers: `x-forwarded-host` (then
 * `host`) and `x-forwarded-proto`, defaulting to http on localhost and https
 * elsewhere. Only trusted by getSiteOrigin for local runs.
 */
export function getRequestOrigin(getHeader: (name: string) => string | null): string | null {
  const host = getHeader('x-forwarded-host') || getHeader('host');
  if (!host) return null;
  const forwardedProto = getHeader('x-forwarded-proto');
  const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host);
  const protocol = forwardedProto === 'http' || forwardedProto === 'https' ? forwardedProto : isLocal ? 'http' : 'https';
  return `${protocol}://${host}`;
}
