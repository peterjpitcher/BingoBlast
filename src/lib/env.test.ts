// src/lib/env.test.ts
//
// A missing Supabase variable used to surface as a confusing runtime failure
// (a non-null assertion passing `undefined` to the client). validateBuildEnv
// runs from next.config.ts, so the build itself fails with a clear message.
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { EVENTS_FEED_REQUIRED, getPublicSupabaseEnv, validateBuildEnv } from './env';

const KEYS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'NEXT_PUBLIC_SITE_URL',
  'VERCEL_ENV',
  'ANCHOR_API_KEY',
] as const;

let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = {};
  for (const key of KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
});

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

test('getPublicSupabaseEnv returns the URL and anon key', () => {
  assert.deepEqual(getPublicSupabaseEnv(), {
    url: 'https://example.supabase.co',
    anonKey: 'anon-key',
  });
});

test('getPublicSupabaseEnv names the missing variable', () => {
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  assert.throws(() => getPublicSupabaseEnv(), /NEXT_PUBLIC_SUPABASE_ANON_KEY/);

  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
  process.env.NEXT_PUBLIC_SUPABASE_URL = '';
  assert.throws(() => getPublicSupabaseEnv(), /NEXT_PUBLIC_SUPABASE_URL/);
});

test('a complete environment validates', () => {
  assert.doesNotThrow(() => validateBuildEnv());
});

test('the build fails when a Supabase variable is missing, naming every problem', () => {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  assert.throws(
    () => validateBuildEnv(),
    (err: unknown) =>
      err instanceof Error &&
      err.message.includes('NEXT_PUBLIC_SUPABASE_URL') &&
      err.message.includes('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
  );
});

test('the Supabase URL must be a URL', () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'your-project-url';
  assert.throws(() => validateBuildEnv(), /NEXT_PUBLIC_SUPABASE_URL/);
});

test('NEXT_PUBLIC_SITE_URL is optional', () => {
  process.env.NEXT_PUBLIC_SITE_URL = '';
  assert.doesNotThrow(() => validateBuildEnv());
});

test('NEXT_PUBLIC_SITE_URL must be an https origin when set', () => {
  process.env.NEXT_PUBLIC_SITE_URL = 'https://bingo.theanchor.pub';
  assert.doesNotThrow(() => validateBuildEnv());
  process.env.NEXT_PUBLIC_SITE_URL = 'https://bingo.theanchor.pub/';
  assert.doesNotThrow(() => validateBuildEnv(), 'a trailing slash is still an origin');

  for (const bad of [
    'http://bingo.theanchor.pub',
    'https://bingo.theanchor.pub/player',
    'https://bingo.theanchor.pub?x=1',
    'bingo.theanchor.pub',
    'https://user:pass@bingo.theanchor.pub',
  ]) {
    process.env.NEXT_PUBLIC_SITE_URL = bad;
    assert.throws(() => validateBuildEnv(), /NEXT_PUBLIC_SITE_URL/, bad);
  }
});

test('a local http origin is allowed outside production, for local runs only', () => {
  process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3000';
  assert.doesNotThrow(() => validateBuildEnv());
  process.env.VERCEL_ENV = 'production';
  assert.throws(() => validateBuildEnv(), /NEXT_PUBLIC_SITE_URL/);
});

test('the events feed key is not required in this slice', () => {
  assert.equal(EVENTS_FEED_REQUIRED, false);
  process.env.VERCEL_ENV = 'production';
  assert.doesNotThrow(() => validateBuildEnv());
});

test('once the events feed is required, a production build needs ANCHOR_API_KEY and a preview does not', () => {
  process.env.VERCEL_ENV = 'production';
  assert.throws(() => validateBuildEnv({ eventsFeedRequired: true }), /ANCHOR_API_KEY/);
  process.env.ANCHOR_API_KEY = 'key';
  assert.doesNotThrow(() => validateBuildEnv({ eventsFeedRequired: true }));

  delete process.env.ANCHOR_API_KEY;
  process.env.VERCEL_ENV = 'preview';
  assert.doesNotThrow(() => validateBuildEnv({ eventsFeedRequired: true }));
});
