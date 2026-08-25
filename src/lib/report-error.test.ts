// src/lib/report-error.test.ts
//
// The thing these guard is not "does it post", it is "does it post anything it
// should not". This app deliberately does not identify players, and an error
// reporter is the easiest place in a codebase to undo that by accident.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reportError } from './report-error';

type Captured = { url: string; body: Record<string, unknown> };

function withCapturedSink(run: () => Promise<void>): Promise<Captured[]> {
  const captured: Captured[] = [];
  const realFetch = globalThis.fetch;
  const realUrl = process.env.ERROR_SINK_URL;

  process.env.ERROR_SINK_URL = 'https://sink.invalid/errors';
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    captured.push({ url: String(url), body: JSON.parse(String(init?.body ?? '{}')) });
    return new Response('{}', { status: 200 });
  }) as typeof fetch;

  return run().then(() => {
    globalThis.fetch = realFetch;
    if (realUrl === undefined) delete process.env.ERROR_SINK_URL;
    else process.env.ERROR_SINK_URL = realUrl;
    return captured;
  });
}

test('uuids never reach the sink', async () => {
  const sent = await withCapturedSink(async () => {
    await reportError({ scope: 'test' }, new Error('winner 7ef7d8b8-6fe1-4d71-80c9-44a7c3e73ba1 failed'));
  });
  assert.equal(sent.length, 1);
  assert.match(String(sent[0].body.message), /\[uuid\]/);
  assert.doesNotMatch(String(sent[0].body.message), /7ef7d8b8/);
});

test('money amounts never reach the sink', async () => {
  const sent = await withCapturedSink(async () => {
    await reportError({ scope: 'test' }, new Error('failed to award £110 Cash Jackpot'));
  });
  assert.match(String(sent[0].body.message), /\[amount\]/);
  assert.doesNotMatch(String(sent[0].body.message), /110/);
});

test('email addresses never reach the sink', async () => {
  const sent = await withCapturedSink(async () => {
    await reportError({ scope: 'test' }, new Error('no profile for host@theanchor.pub'));
  });
  assert.match(String(sent[0].body.message), /\[email\]/);
  assert.doesNotMatch(String(sent[0].body.message), /theanchor/);
});

test('Postgres detail and hint are dropped, because DETAIL carries the failing row', async () => {
  const sent = await withCapturedSink(async () => {
    await reportError({ scope: 'test' }, {
      message: 'duplicate key value violates unique constraint',
      code: '23505',
      details: 'Key (prize_description)=(£110 Cash Jackpot) already exists.',
      hint: 'Perhaps you meant Margaret',
    });
  });
  const body = JSON.stringify(sent[0].body);
  assert.doesNotMatch(body, /Margaret/);
  assert.doesNotMatch(body, /already exists/);
  assert.equal(sent[0].body.code, '23505');
});

test('nothing is posted when no sink is configured', async () => {
  const realUrl = process.env.ERROR_SINK_URL;
  delete process.env.ERROR_SINK_URL;
  const realFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = (async () => { called = true; return new Response('{}'); }) as typeof fetch;

  await reportError({ scope: 'test' }, new Error('boom'));

  globalThis.fetch = realFetch;
  if (realUrl !== undefined) process.env.ERROR_SINK_URL = realUrl;
  assert.equal(called, false, 'must be a no-op until a provider is chosen');
});

test('a sink that is down does not become the failure', async () => {
  const realUrl = process.env.ERROR_SINK_URL;
  const realFetch = globalThis.fetch;
  process.env.ERROR_SINK_URL = 'https://sink.invalid/errors';
  globalThis.fetch = (async () => { throw new Error('network down'); }) as typeof fetch;

  // The assertion is that this resolves rather than rejecting. A failure to
  // report a failure must never interrupt a game.
  await reportError({ scope: 'test' }, new Error('original problem'));

  globalThis.fetch = realFetch;
  if (realUrl === undefined) delete process.env.ERROR_SINK_URL;
  else process.env.ERROR_SINK_URL = realUrl;
});

test('the scope and environment are sent so a line can be placed', async () => {
  const sent = await withCapturedSink(async () => {
    await reportError({ scope: 'recordWinner', correlationId: 'abc' }, new Error('boom'));
  });
  assert.equal(sent[0].body.scope, 'recordWinner');
  assert.equal(sent[0].body.correlationId, 'abc');
  assert.equal(sent[0].body.app, 'anchor-bingo');
  assert.ok(typeof sent[0].body.at === 'string');
});
