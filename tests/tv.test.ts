// tests/tv.test.ts
//
// App-level proofs for the paired /tv and the console safety of row C-6:
//   * /tv fails closed: a database outage on the resolver path shows
//     "Reconnecting", never a game and never a pairing code (workspace rule
//     "public write paths fail closed", kit README step 4);
//   * /tv and the pairing endpoint stay outside the auth proxy;
//   * the three destructive host steps (end the night, undo the last ball,
//     end the game) run only from a hold-to-confirm, never from a tap.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createTvPairing, TvPageShell, tvDeviceCookieName, type TvView } from '@anchor-nights/kit/pairing';
import { resolveTvPageView } from '../src/lib/tv-pairing';
import { createFindTonight, type TonightSession } from '../src/lib/tv-tonight';

const ROOT = join(import.meta.dirname, '..');
const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8');

const DEVICE_TOKEN = 'a'.repeat(43);
const DEVICE_ROW = { id: '00000000-0000-4000-8000-000000000001', name: 'Bar TV', created_at: '2026-11-01T18:00:00Z', last_seen_at: null };
const SESSION_ID = '11111111-1111-4111-8111-111111111111';

const realConsoleError = console.error;
const realFetch = globalThis.fetch;
before(() => {
  console.error = () => {};
  globalThis.fetch = (async () => {
    throw new TypeError('fetch failed (no network in this test)');
  }) as typeof fetch;
});
after(() => {
  console.error = realConsoleError;
  globalThis.fetch = realFetch;
});

/** The kit's pairing over fakes: this TV holds a device cookie the database knows. */
function pairedTv(options: { deviceLookupFails?: boolean } = {}) {
  const reports: string[] = [];
  const pairing = createTvPairing({
    config: { secureCookies: true },
    serverClient: async () => {
      throw new Error('no session client in this test');
    },
    adminClient: () =>
      ({
        rpc: async (fn: string) => {
          if (fn !== 'kit_tv_device_seen') throw new Error(`unexpected rpc ${fn}`);
          if (options.deviceLookupFails) return { data: null, error: { message: 'connection refused' } };
          return { data: [DEVICE_ROW], error: null };
        },
      }) as never,
    cookies: async () => ({
      get: (name: string) => (name === tvDeviceCookieName(true) ? { value: DEVICE_TOKEN } : undefined),
    }),
    headers: async () => new Headers(),
    report: (scope) => reports.push(scope),
  });
  return { pairing, reports };
}

const failingDatabase = createFindTonight(async () => ({ data: null, error: { message: 'connection refused', code: '08006' } }));
const tonightIs = (id: string | null) =>
  createFindTonight(async () => ({
    data: id ? [{ id, status: 'running' as const, start_date: '2026-11-07', is_test_session: false }] : [],
    error: null,
  }));

function renderTv(view: TvView<TonightSession>): { html: string; drew: string[] } {
  const drew: string[] = [];
  const html = renderToStaticMarkup(
    React.createElement(TvPageShell<TonightSession>, {
      view,
      pairing: { appName: 'Anchor Bingo' },
      renderGame: (game) => {
        drew.push(`game:${game.id}`);
        return React.createElement('main', null, `GAME ${game.id}`);
      },
      renderIdle: () => {
        drew.push('idle');
        return React.createElement('main', null, 'IDLE LOOP');
      },
    }),
  );
  return { html, drew };
}

test('/tv shows Reconnecting, not a game or a code, when the database fails on the resolver path', async () => {
  const { pairing, reports } = pairedTv();
  const view = await resolveTvPageView(false, { pairing: () => pairing, resolveTonight: failingDatabase });
  assert.deepEqual(view, { kind: 'unavailable', reason: 'resolver' });
  assert.ok(reports.length > 0, 'the outage is reported');

  const { html, drew } = renderTv(view);
  assert.match(html, /Reconnecting/);
  assert.deepEqual(drew, [], 'neither the game nor the idle loop is drawn');
  assert.doesNotMatch(html, /GAME|IDLE LOOP/);
  assert.doesNotMatch(html, /pairing code|Getting a pairing code|\b\d{3}\s?\d{3}\b/i, 'no pairing code screen');
});

test('an unpaired TV shows the pairing screen (so the checks above would see one)', async () => {
  const pairing = createTvPairing({
    config: { secureCookies: true },
    serverClient: async () => {
      throw new Error('unused');
    },
    adminClient: () => {
      throw new Error('an unpaired TV never reaches the database');
    },
    cookies: async () => ({ get: () => undefined }),
    headers: async () => new Headers(),
  });
  const view = await resolveTvPageView(false, { pairing: () => pairing, resolveTonight: failingDatabase });
  assert.deepEqual(view, { kind: 'unpaired' });
  const { html, drew } = renderTv(view);
  assert.match(html, /Getting a pairing code/);
  assert.doesNotMatch(html, /Reconnecting/);
  assert.deepEqual(drew, []);
});

test('/tv shows Reconnecting when the device lookup fails, never the pairing code', async () => {
  const { pairing } = pairedTv({ deviceLookupFails: true });
  const view = await resolveTvPageView(false, { pairing: () => pairing, resolveTonight: tonightIs(SESSION_ID) });
  assert.deepEqual(view, { kind: 'unavailable', reason: 'device_lookup' });
  assert.match(renderTv(view).html, /Reconnecting/);
});

test('/tv shows Reconnecting when the pairing cannot be built (sign-in config missing)', async () => {
  const view = await resolveTvPageView(false, {
    pairing: () => {
      throw new Error('NEXT_PUBLIC_APP_URL is not set');
    },
    resolveTonight: tonightIs(SESSION_ID),
  });
  assert.equal(view.kind, 'unavailable');
  assert.match(renderTv(view).html, /Reconnecting/);
});

test('a paired /tv draws tonight\'s session, or the idle loop when there is none', async () => {
  const { pairing } = pairedTv();
  const game = await resolveTvPageView(false, { pairing: () => pairing, resolveTonight: tonightIs(SESSION_ID) });
  assert.equal(game.kind, 'game');
  assert.deepEqual(renderTv(game).drew, [`game:${SESSION_ID}`]);

  const idle = await resolveTvPageView(false, { pairing: () => pairing, resolveTonight: tonightIs(null) });
  assert.equal(idle.kind, 'idle');
  assert.deepEqual(renderTv(idle).drew, ['idle']);
});

test('/tv draws the /display screen through the same loader', () => {
  const page = read('src/app/tv/page.tsx');
  assert.match(page, /loadDisplay\(sessionId, \{ rehearsal, tv: true \}\)/);
  assert.match(page, /<DisplayUI \{\.\.\.loaded\.props\} \/>/);
  assert.match(read('src/app/display/[sessionId]/page.tsx'), /loadDisplay\(sessionId, \{ rehearsal \}\)/);
});

test('/tv and the pairing endpoint stay outside the auth proxy, and /display stays public', async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'https://example-project.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'anon-key-for-tests-only-0000';
  const { config } = await import('../src/proxy');
  for (const entry of config.matcher) {
    assert.ok(!entry.startsWith('/tv') && !entry.startsWith('/api/tv') && !entry.startsWith('/display'), `${entry} must not cover the TV`);
  }
});

// The three destructive steps of row C-6. Each confirm handler may be wired
// only to a HoldButton's onDone, never to a tap (onClick).
const HOLD_ONLY: ReadonlyArray<{ file: string; handler: string }> = [
  { file: 'src/app/host/dashboard.tsx', handler: 'handleConfirmEndNight' },
  { file: 'src/app/host/[sessionId]/[gameId]/game-control.tsx', handler: 'handleConfirmVoidLastNumber' },
  { file: 'src/app/host/[sessionId]/[gameId]/game-control.tsx', handler: 'handleConfirmEndGame' },
];

for (const { file, handler } of HOLD_ONLY) {
  test(`${handler} needs a hold-to-confirm`, () => {
    const source = read(file);
    const uses = [...source.matchAll(new RegExp(`\\b${handler}\\b`, 'g'))].map((m) => m.index ?? 0);
    const definition = source.indexOf(`const ${handler} = async`);
    assert.ok(definition >= 0, `${handler} is defined`);
    const wiring = uses.filter((index) => index !== definition + 'const '.length);
    assert.ok(wiring.length > 0, `${handler} is wired to something`);
    for (const index of wiring) {
      const before = source.slice(Math.max(0, index - 40), index);
      assert.match(before, /onDone=\{\s*$/, `${handler} is only ever a HoldButton's onDone`);
      const element = source.slice(source.lastIndexOf('<', index), index);
      assert.match(element, /^<HoldButton\b/, `${handler} sits on a HoldButton`);
    }
    // The handler reports refusal, so a refused step never shows the check mark.
    assert.match(source, new RegExp(`const ${handler} = async \\(\\): Promise<boolean>`));
  });
}

test('the heartbeat proves it landed: sendHeartbeat writes through writeHeartbeat and answers lost_control', () => {
  const actions = read('src/app/host/actions.ts');
  const body = actions.slice(actions.indexOf('export async function sendHeartbeat'), actions.indexOf('/**\n * Draws the next ball.'));
  assert.match(body, /writeHeartbeat\(/);
  assert.match(body, /code: 'lost_control'/);
  assert.doesNotMatch(body, /\.update\(/, 'no bare update without a select');
});
