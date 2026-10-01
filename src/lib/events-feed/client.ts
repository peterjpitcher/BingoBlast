// src/lib/events-feed/client.ts
//
// SERVER ONLY. Reads the management app's API with the events key.
//
// The `server-only` package is not installed in this project, so the guard is
// by convention plus the check below: only projection.ts imports this file,
// and projection.ts is only imported by server code (route handlers and server
// components). The key is read from ANCHOR_API_KEY, which is never inlined
// into a browser bundle because it has no NEXT_PUBLIC_ prefix.
//
// Nothing here logs. Errors carry a message written here (the status code and
// the path, never the response body), and the caller decides what to report.

import { EventsFeedError } from './errors';

if (typeof window !== 'undefined') {
  throw new Error('src/lib/events-feed/client.ts is server-only: it sends the management API key.');
}

export const DEFAULT_ANCHOR_API_BASE_URL = 'https://management.orangejelly.co.uk/api';

export interface EventsFeedConfig {
  /** No trailing slash. */
  baseUrl: string;
  apiKey: string;
}

/** The management API settings, or null when ANCHOR_API_KEY is not set. */
export function getEventsFeedConfig(
  env: Record<string, string | undefined> = process.env,
): EventsFeedConfig | null {
  const apiKey = env.ANCHOR_API_KEY?.trim();
  if (!apiKey) return null;
  const baseUrl = (env.ANCHOR_API_BASE_URL?.trim() || DEFAULT_ANCHOR_API_BASE_URL).replace(/\/+$/, '');
  return { baseUrl, apiKey };
}

export interface FetchManagementJsonOptions {
  timeoutMs: number;
  /** Defaults to getEventsFeedConfig(); for tests. */
  config?: EventsFeedConfig | null;
  /** Defaults to the global fetch; for tests. */
  fetchImpl?: typeof fetch;
}

function isTimeout(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const name = (err as { name?: unknown }).name;
  return name === 'TimeoutError' || name === 'AbortError';
}

/** Frees the connection without reading (or keeping) the body. */
function discardBody(response: Response): void {
  try {
    response.body?.cancel().catch(() => {});
  } catch {
    // Nothing to free.
  }
}

/**
 * GETs `path` (for example '/events?status=scheduled') from the management
 * API and returns the parsed JSON.
 *
 * Throws an EventsFeedError on a missing key, a timeout, a network failure, a
 * non-2xx status or a body that is not JSON.
 */
export async function fetchManagementJson(
  path: string,
  options: FetchManagementJsonOptions,
): Promise<unknown> {
  const config = options.config === undefined ? getEventsFeedConfig() : options.config;
  if (!config) {
    throw new EventsFeedError('ANCHOR_API_KEY is not set, so the events feed cannot be read', 'missing_config');
  }
  if (!path.startsWith('/')) {
    throw new Error(`fetchManagementJson needs a path starting with "/" (got "${path}").`);
  }

  // The path without its query, for messages. Event ids in it are uuids, which
  // reportError redacts.
  const label = path.split('?')[0];
  const fetchImpl = options.fetchImpl ?? fetch;

  let response: Response;
  try {
    response = await fetchImpl(`${config.baseUrl}${path}`, {
      method: 'GET',
      headers: { 'X-API-Key': config.apiKey, Accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(Math.max(1, Math.floor(options.timeoutMs))),
    });
  } catch (err) {
    if (isTimeout(err)) {
      throw new EventsFeedError(`The management API did not answer ${label} within ${options.timeoutMs}ms`, 'timeout');
    }
    throw new EventsFeedError(`The management API could not be reached for ${label}`, 'network');
  }

  if (!response.ok) {
    discardBody(response);
    throw new EventsFeedError(`The management API answered HTTP ${response.status} for ${label}`, 'http');
  }

  try {
    return await response.json();
  } catch (err) {
    if (isTimeout(err)) {
      throw new EventsFeedError(`The management API did not finish sending ${label} within ${options.timeoutMs}ms`, 'timeout');
    }
    throw new EventsFeedError(`The management API sent ${label} as something other than JSON`, 'parse');
  }
}
