// tests/auth.test.ts
//
// App-level proofs for the kit's sign-in in Cash Bingo (spec C-5, kit README
// "Negative proofs", workspace rule "public write paths fail closed"). The
// kit's own suite tests each flow against fakes; these test THIS app's wiring:
// its 'use server' wrappers, its config, its proxy matcher and its cron route.
//
// Nothing here reaches a network: global fetch is replaced with one that
// refuses every request, so Supabase, Have I Been Pwned and Turnstile are all
// "down", which is exactly the failure each public form must surface.
import { after, afterEach, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { AuthFormState } from '@anchor-nights/kit/auth/shared';

const ROOT = join(import.meta.dirname, '..');
const IDLE: AuthFormState = { status: 'idle' };

const AUTH_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://example-project.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key-for-tests-only-0000',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key-for-tests-only',
  NEXT_PUBLIC_APP_URL: 'https://bingo.example.test',
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
  TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA',
  AUDIT_HMAC_KEY: `v1:${'b'.repeat(48)}`,
} as const;
const KEYS = [...Object.keys(AUTH_ENV), 'CRON_SECRET', 'ERROR_SINK_URL'] as const;

let savedEnv: Record<string, string | undefined> = {};
const realFetch = globalThis.fetch;
const realConsoleError = console.error;
const fetched: string[] = [];

before(() => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    fetched.push(String(input instanceof Request ? input.url : input));
    throw new TypeError('fetch failed (every dependency is down in this test)');
  }) as typeof fetch;
  // The reporter and the kit write a console line for each failure; keep the
  // test output readable.
  console.error = () => {};
});

after(() => {
  globalThis.fetch = realFetch;
  console.error = realConsoleError;
});

beforeEach(() => {
  savedEnv = {};
  for (const key of KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  Object.assign(process.env, AUTH_ENV);
  fetched.length = 0;
});

afterEach(() => {
  for (const key of KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

function assertShownError(state: AuthFormState, label: string): void {
  assert.equal(state.status, 'error', `${label}: expected an error the person can see, got ${JSON.stringify(state)}`);
  if (state.status === 'error') assert.ok(state.error.length > 10, `${label}: the error has no words`);
}

// ---------------------------------------------------------------- no sign-up

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

test('there is no sign-up route: no register, signup or sign-up page or handler exists', () => {
  const routes = filesUnder(join(ROOT, 'src/app')).map((p) => p.slice(ROOT.length));
  const signUp = routes.filter((p) => /\/(register|sign-?up|join)(\/|$)/i.test(p));
  assert.deepEqual(signUp, []);
});

test('nothing in the app calls Supabase sign-up or a passwordless sign-in', () => {
  const offenders = filesUnder(join(ROOT, 'src'))
    .filter((p) => /\.(ts|tsx)$/.test(p) && !p.endsWith('.test.ts'))
    .filter((p) => /\.auth\.(signUp|signInWithOtp|signInAnonymously|signInWithOAuth)\s*\(/.test(readFileSync(p, 'utf8')));
  assert.deepEqual(offenders, []);
});

test('the auth Server Actions export no sign-up action', async () => {
  const actions = await import('../src/app/auth/actions');
  const names = Object.keys(actions);
  assert.ok(names.includes('signIn') && names.includes('acceptInvite'));
  assert.deepEqual(names.filter((n) => /sign.?up|register/i.test(n)), []);
});

// ---------------------------------------------------------------- fail closed

test('sign-in fails closed when the sign-in configuration is missing', async () => {
  delete process.env.AUDIT_HMAC_KEY;
  const { signIn } = await import('../src/app/auth/actions');
  const state = await signIn(IDLE, form({ email: 'host@example.test', password: 'a-password-long-enough' }));
  assertShownError(state, 'missing config');
  assert.equal(state.status === 'error' && state.code, 'service_unavailable');
});

test('sign-in shows an error, never a success, when Supabase is down', async () => {
  const { signIn } = await import('../src/app/auth/actions');
  const state = await signIn(IDLE, form({ email: 'host@example.test', password: 'a-password-long-enough', 'cf-turnstile-response': 'token' }));
  assertShownError(state, 'sign-in, Supabase down');
});

test('forgot password shows an error, not "we have sent it", when the reset cannot be sent', async () => {
  const { requestPasswordReset } = await import('../src/app/auth/actions');
  const state = await requestPasswordReset(IDLE, form({ email: 'host@example.test', 'cf-turnstile-response': 'token' }));
  assertShownError(state, 'forgot password, Supabase down');
});

test('/auth/confirm refuses a magic link: only type=recovery is accepted, and nothing is called', async () => {
  const { confirmRecovery } = await import('../src/app/auth/actions');
  for (const type of ['magiclink', 'signup', 'invite', 'email', '']) {
    const state = await confirmRecovery(IDLE, form({ token_hash: 'pkce_abcdefghijklmnop', type }));
    assertShownError(state, `confirm type=${type}`);
    assert.equal(state.status === 'error' && state.code, 'invalid_link');
  }
  assert.deepEqual(fetched, [], 'a refused link type must not reach Supabase');
});

test('/auth/confirm shows an error when the recovery cannot be verified', async () => {
  const { confirmRecovery } = await import('../src/app/auth/actions');
  const state = await confirmRecovery(IDLE, form({ token_hash: 'pkce_abcdefghijklmnop', type: 'recovery' }));
  assertShownError(state, 'confirm, Supabase down');
});

test('reset password refuses without a recovery grant', async () => {
  const { resetPassword } = await import('../src/app/auth/actions');
  const state = await resetPassword(IDLE, form({ password: 'correct horse battery staple', confirmPassword: 'correct horse battery staple' }));
  assertShownError(state, 'reset without grant');
});

test('accepting an invite shows an error when its link is malformed or the invite cannot be claimed', async () => {
  const { acceptInvite } = await import('../src/app/auth/actions');
  const malformed = await acceptInvite(IDLE, form({ token: 'not a token', password: 'x', confirmPassword: 'x' }));
  assertShownError(malformed, 'invite, malformed');
  const claimFails = await acceptInvite(IDLE, form({
    token: 'A'.repeat(43),
    password: 'correct horse battery staple',
    confirmPassword: 'correct horse battery staple',
    'cf-turnstile-response': 'token',
  }));
  assertShownError(claimFails, 'invite, claim fails');
});

test('the staff admin actions refuse when the caller cannot be checked', async () => {
  const { issueInvite } = await import('../src/app/admin/staff/actions');
  const state = await issueInvite(IDLE, form({ email: 'new@example.test', role: 'host' }));
  assertShownError(state, 'issue invite, no session');
});

// ---------------------------------------------------------------- proxy

test('the proxy covers the staff and auth pages and leaves the public pages alone', async () => {
  const { config } = await import('../src/proxy');
  const matcher = config.matcher;
  for (const path of ['/admin/:path*', '/host/:path*', '/login', '/pending', '/forgot-password', '/auth/:path*', '/invite', '/account']) {
    assert.ok(matcher.includes(path), `${path} is protected or no-store`);
  }
  // CLAUDE.md gotcha: a Supabase round trip on every TV and phone refresh.
  for (const entry of matcher) {
    assert.doesNotMatch(entry, /^\/(display|player|play)?($|\/|\()/, `${entry} would put a public page behind the proxy`);
  }
});

test('each role lands on its own home', async () => {
  const { HOME_FOR_ROLE } = await import('../src/lib/auth/routes');
  assert.deepEqual(HOME_FOR_ROLE, { admin: '/admin', host: '/host' });
});

// ---------------------------------------------------------------- daily clean-up

test('the auth clean-up cron refuses everything without CRON_SECRET, and a wrong bearer', async () => {
  const { GET } = await import('../src/app/api/cron/auth-maintenance/route');
  const { NextRequest } = await import('next/server');
  const call = (auth?: string) =>
    GET(new NextRequest('https://bingo.example.test/api/cron/auth-maintenance', { headers: auth ? { authorization: auth } : {} }));

  assert.equal((await call('Bearer anything')).status, 503);

  process.env.CRON_SECRET = 'cron-secret-for-tests-only-000000';
  assert.equal((await call()).status, 401);
  assert.equal((await call('Bearer wrong')).status, 401);
  assert.equal((await call('cron-secret-for-tests-only-000000')).status, 401);
  assert.deepEqual(fetched, [], 'a refused cron call must not reach Supabase');
});

test('the auth clean-up cron fails loudly (500) when the database is down', async () => {
  const { GET } = await import('../src/app/api/cron/auth-maintenance/route');
  const { NextRequest } = await import('next/server');
  process.env.CRON_SECRET = 'cron-secret-for-tests-only-000000';
  const response = await GET(new NextRequest('https://bingo.example.test/api/cron/auth-maintenance', {
    headers: { authorization: 'Bearer cron-secret-for-tests-only-000000' },
  }));
  assert.equal(response.status, 500);
});
