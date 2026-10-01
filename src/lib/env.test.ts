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
  'ANCHOR_API_BASE_URL',
] as const;

// The shape the management app issues: "anch_" then 32 random bytes in
// base64url. Not a real key.
const VALID_KEY = `anch_${'Ab3-_xYz'.repeat(5)}abc`;

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

test('the events feed is required, so a production build without ANCHOR_API_KEY fails', () => {
  assert.equal(EVENTS_FEED_REQUIRED, true);
  process.env.VERCEL_ENV = 'production';
  assert.throws(() => validateBuildEnv(), /ANCHOR_API_KEY/);
  process.env.ANCHOR_API_KEY = VALID_KEY;
  assert.doesNotThrow(() => validateBuildEnv());
});

test('preview and local builds do not need ANCHOR_API_KEY', () => {
  process.env.VERCEL_ENV = 'preview';
  assert.doesNotThrow(() => validateBuildEnv());
  delete process.env.VERCEL_ENV;
  assert.doesNotThrow(() => validateBuildEnv(), 'a local build has no VERCEL_ENV');
});

test('a production build needs ANCHOR_API_KEY when the feed is required, and a preview does not', () => {
  process.env.VERCEL_ENV = 'production';
  assert.throws(() => validateBuildEnv({ eventsFeedRequired: true }), /ANCHOR_API_KEY/);
  process.env.ANCHOR_API_KEY = VALID_KEY;
  assert.doesNotThrow(() => validateBuildEnv({ eventsFeedRequired: true }));

  delete process.env.ANCHOR_API_KEY;
  process.env.VERCEL_ENV = 'preview';
  assert.doesNotThrow(() => validateBuildEnv({ eventsFeedRequired: true }));
});

test('a production build treats an ANCHOR_API_KEY of only spaces as not set', () => {
  process.env.VERCEL_ENV = 'production';
  process.env.ANCHOR_API_KEY = '   ';
  assert.throws(() => validateBuildEnv(), /ANCHOR_API_KEY/);
  process.env.ANCHOR_API_KEY = '\t\n';
  assert.throws(() => validateBuildEnv(), /ANCHOR_API_KEY/);
  process.env.ANCHOR_API_KEY = ` ${VALID_KEY} `;
  assert.doesNotThrow(() => validateBuildEnv());
});

test('an ANCHOR_API_KEY that is not shaped like a management key fails the build, in any environment', () => {
  // What production held on 1 October 2026: the CLI command pasted as the
  // value. It passed the "is it set" check, and the feed then answered 401.
  for (const bad of [
    'vercel env add ANCHOR_API_KEY production',
    'key',
    'Bearer ' + VALID_KEY,
    VALID_KEY.replace('anch_', 'ANCH_'),
    'anch_short',
    VALID_KEY.slice(0, 20) + ' ' + VALID_KEY.slice(20),
  ]) {
    for (const env of ['production', 'preview', undefined]) {
      if (env) process.env.VERCEL_ENV = env;
      else delete process.env.VERCEL_ENV;
      process.env.ANCHOR_API_KEY = bad;
      assert.throws(() => validateBuildEnv(), /ANCHOR_API_KEY does not look like a management API key/, `${bad} in ${env}`);
    }
  }
});

test('the key check never prints the value', () => {
  process.env.VERCEL_ENV = 'production';
  process.env.ANCHOR_API_KEY = 'anch_not-a-real-key but secret-looking';
  assert.throws(
    () => validateBuildEnv(),
    (err: unknown) => err instanceof Error && !err.message.includes('secret-looking') && !err.message.includes('anch_not'),
  );
});

test('a key shaped like a management key passes, with or without surrounding spaces', () => {
  process.env.VERCEL_ENV = 'production';
  process.env.ANCHOR_API_KEY = VALID_KEY;
  assert.doesNotThrow(() => validateBuildEnv());
  process.env.ANCHOR_API_KEY = `\n${VALID_KEY}  `;
  assert.doesNotThrow(() => validateBuildEnv());
});

test('ANCHOR_API_BASE_URL is optional', () => {
  process.env.VERCEL_ENV = 'production';
  process.env.ANCHOR_API_KEY = VALID_KEY;
  assert.doesNotThrow(() => validateBuildEnv());
  process.env.ANCHOR_API_BASE_URL = '   ';
  assert.doesNotThrow(() => validateBuildEnv(), 'blank means the default');
});

test('ANCHOR_API_BASE_URL must use https when set, since the key travels to it', () => {
  process.env.ANCHOR_API_BASE_URL = 'https://management.orangejelly.co.uk/api';
  assert.doesNotThrow(() => validateBuildEnv());
  process.env.ANCHOR_API_BASE_URL = 'https://management.orangejelly.co.uk/api/';
  assert.doesNotThrow(() => validateBuildEnv());

  for (const bad of [
    'http://management.orangejelly.co.uk/api',
    'management.orangejelly.co.uk/api',
    'ftp://management.orangejelly.co.uk/api',
    'https://user:pass@management.orangejelly.co.uk/api',
    'https://management.orangejelly.co.uk/api?x=1',
  ]) {
    process.env.ANCHOR_API_BASE_URL = bad;
    assert.throws(() => validateBuildEnv(), /ANCHOR_API_BASE_URL/, bad);
  }
});

test('ANCHOR_API_BASE_URL may be local http outside production only', () => {
  for (const local of ['http://localhost:3000/api', 'http://127.0.0.1:3000/api', 'http://[::1]:3000/api']) {
    process.env.ANCHOR_API_BASE_URL = local;
    delete process.env.VERCEL_ENV;
    assert.doesNotThrow(() => validateBuildEnv(), local);
    process.env.VERCEL_ENV = 'preview';
    assert.doesNotThrow(() => validateBuildEnv(), local);
    process.env.VERCEL_ENV = 'production';
    process.env.ANCHOR_API_KEY = VALID_KEY;
    assert.throws(() => validateBuildEnv(), /ANCHOR_API_BASE_URL/, local);
    delete process.env.ANCHOR_API_KEY;
  }
  process.env.VERCEL_ENV = 'preview';
  process.env.ANCHOR_API_BASE_URL = 'http://management.local/api';
  assert.throws(() => validateBuildEnv(), /ANCHOR_API_BASE_URL/, 'only loopback hosts may use http');
});
