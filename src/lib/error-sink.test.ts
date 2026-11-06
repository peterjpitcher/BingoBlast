// src/lib/error-sink.test.ts
//
// The sink is a public URL that writes to the database, so these check the
// three things that matter: it refuses what it should, it stores nothing that
// identifies anyone, and it never claims a report was stored when it was not.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_BODY_BYTES,
  clientKeyFrom,
  createRateLimiter,
  handleErrorReport,
  toAppErrorRow,
  errorReportSchema,
  type AppErrorInsert,
  type ErrorSinkDeps,
  type InsertResult,
  type SinkRequest,
} from './error-sink';
import { redact } from '@anchor-nights/kit/errors';

const TOKEN = 'test-token-0123456789abcdef';

function report(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    app: 'anchor-bingo',
    environment: 'production',
    scope: 'host:call_next_number',
    message: 'boom',
    code: 'P0001',
    at: '2026-11-06T20:15:00.000Z',
    ...overrides,
  };
}

function request(body: unknown, overrides: Partial<SinkRequest> = {}): SinkRequest {
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    authorization: `Bearer ${TOKEN}`,
    contentLength: String(Buffer.byteLength(raw, 'utf8')),
    clientKey: '203.0.113.7',
    userAgent: 'node',
    readBody: async () => raw,
    ...overrides,
  };
}

function deps(overrides: Partial<ErrorSinkDeps> = {}): ErrorSinkDeps & { rows: AppErrorInsert[] } {
  const rows: AppErrorInsert[] = [];
  return {
    rows,
    token: TOKEN,
    insert: async (row: AppErrorInsert): Promise<InsertResult> => {
      rows.push(row);
      return { ok: true, id: 'a1b2' };
    },
    allow: () => true,
    ...overrides,
  };
}

// The sink logs refusals to the console on purpose; keep test output readable.
function quietly<T>(run: () => Promise<T>): Promise<T> {
  const realError = console.error;
  console.error = () => {};
  return run().finally(() => {
    console.error = realError;
  });
}

// --- Accepting and storing -------------------------------------------------

test('a valid report is stored and answered 201 with the new id', async () => {
  const d = deps();
  const res = await handleErrorReport(request(report()), d);
  assert.equal(res.status, 201);
  assert.deepEqual(res.body, { ok: true, id: 'a1b2' });
  assert.equal(d.rows.length, 1);
  assert.equal(d.rows[0].source, 'host:call_next_number');
  assert.equal(d.rows[0].message, 'boom');
  assert.deepEqual(d.rows[0].context, {
    app: 'anchor-bingo',
    environment: 'production',
    code: 'P0001',
    reportedAt: '2026-11-06T20:15:00.000Z',
  });
  assert.equal(d.rows[0].user_agent, 'node');
});

test('the exact payload report-error.ts sends is accepted, including a missing correlationId', async () => {
  // JSON.stringify drops undefined, so correlationId is simply absent.
  const parsed = errorReportSchema.safeParse(JSON.parse(JSON.stringify(report({ correlationId: undefined }))));
  assert.equal(parsed.success, true);
});

test('unknown fields are dropped, never stored', async () => {
  const d = deps();
  await handleErrorReport(request(report({ details: 'Key (x)=(Margaret)', winner: 'Margaret' })), d);
  assert.doesNotMatch(JSON.stringify(d.rows[0]), /Margaret/);
});

// --- Validation -------------------------------------------------------------

test('a report without a scope is refused 400 and nothing is stored', async () => {
  const d = deps();
  const res = await handleErrorReport(request(report({ scope: undefined })), d);
  assert.equal(res.status, 400);
  assert.deepEqual(res.body, { ok: false, error: 'invalid_payload' });
  assert.equal(d.rows.length, 0);
});

test('an empty message, a non-string message and an over-long message are refused', async () => {
  for (const message of ['', '   ', 42, 'x'.repeat(2001)]) {
    const d = deps();
    const res = await handleErrorReport(request(report({ message })), d);
    assert.equal(res.status, 400, `message ${JSON.stringify(message).slice(0, 20)}`);
    assert.equal(d.rows.length, 0);
  }
});

test('an over-long optional field is refused rather than silently cut', async () => {
  const d = deps();
  const res = await handleErrorReport(request(report({ path: '/' + 'a'.repeat(600) })), d);
  assert.equal(res.status, 400);
  assert.equal(d.rows.length, 0);
});

test('a body that is not JSON is refused 400', async () => {
  const d = deps();
  const res = await handleErrorReport(request('not json'), d);
  assert.equal(res.status, 400);
  assert.deepEqual(res.body, { ok: false, error: 'invalid_json' });
});

test('a JSON array or string is refused 400', async () => {
  for (const body of ['[]', '"boom"', 'null']) {
    const res = await handleErrorReport(request(body), deps());
    assert.equal(res.status, 400, body);
  }
});

test('a body over 8 KB is refused 413 from the header, before it is read', async () => {
  let read = false;
  const res = await handleErrorReport(
    request(report(), { contentLength: String(MAX_BODY_BYTES + 1), readBody: async () => { read = true; return '{}'; } }),
    deps(),
  );
  assert.equal(res.status, 413);
  assert.equal(read, false);
});

test('a body over 8 KB is refused 413 even when the header understates it', async () => {
  const big = JSON.stringify(report({ message: 'x'.repeat(MAX_BODY_BYTES) }));
  const res = await handleErrorReport(request(big, { contentLength: '10' }), deps());
  assert.equal(res.status, 413);
});

// --- Who may post -----------------------------------------------------------

test('with no token configured the sink refuses everything 503 (fail closed)', async () => {
  const d = deps({ token: undefined });
  const res = await quietly(() => handleErrorReport(request(report()), d));
  assert.equal(res.status, 503);
  assert.equal(d.rows.length, 0);
});

test('with no database configured the sink refuses 503', async () => {
  const res = await quietly(() => handleErrorReport(request(report()), deps({ insert: undefined })));
  assert.equal(res.status, 503);
  assert.deepEqual(res.body, { ok: false, error: 'not_configured' });
});

test('a missing or wrong token is refused 401 and nothing is stored', async () => {
  for (const authorization of [null, '', 'Bearer', `Bearer ${TOKEN}x`, TOKEN, 'Basic abc']) {
    const d = deps();
    const res = await handleErrorReport(request(report(), { authorization }), d);
    assert.equal(res.status, 401, String(authorization));
    assert.equal(d.rows.length, 0);
  }
});

test('a rate-limited caller is refused 429 before the token is checked', async () => {
  const d = deps({ allow: () => false });
  const res = await handleErrorReport(request(report(), { authorization: 'Bearer wrong' }), d);
  assert.equal(res.status, 429);
  assert.equal(d.rows.length, 0);
});

test('the limiter allows the maximum per window, refuses the next, and resets', () => {
  let now = 0;
  const allow = createRateLimiter(3, 1000, () => now);
  assert.deepEqual([allow('a'), allow('a'), allow('a'), allow('a')], [true, true, true, false]);
  assert.equal(allow('b'), true, 'each IP has its own count');
  now = 1000;
  assert.equal(allow('a'), true, 'a new window starts fresh');
});

test('the client key is the first forwarded IP, then x-real-ip, then a fixed key', () => {
  assert.equal(clientKeyFrom('203.0.113.7, 10.0.0.1', '198.51.100.2'), '203.0.113.7');
  assert.equal(clientKeyFrom(null, '198.51.100.2'), '198.51.100.2');
  assert.equal(clientKeyFrom(null, null), 'unknown');
});

// --- Failing database: fail closed ------------------------------------------

test('a database that refuses the insert answers 503, never success', async () => {
  const res = await quietly(() =>
    handleErrorReport(request(report()), deps({ insert: async () => ({ ok: false, code: '42501' }) })),
  );
  assert.equal(res.status, 503);
  assert.deepEqual(res.body, { ok: false, error: 'not_stored' });
});

test('a database that throws answers 500 and the handler does not throw', async () => {
  const res = await quietly(() =>
    handleErrorReport(request(report()), deps({ insert: async () => { throw new Error('fetch failed'); } })),
  );
  assert.equal(res.status, 500);
  assert.deepEqual(res.body, { ok: false, error: 'internal_error' });
});

test('a body that cannot be read answers 500 and the handler does not throw', async () => {
  const res = await quietly(() =>
    handleErrorReport(request(report(), { readBody: async () => { throw new Error('aborted'); } }), deps()),
  );
  assert.equal(res.status, 500);
});

// --- Redaction, again, on the way in ----------------------------------------

test('uuids, emails, phone numbers and pound amounts are masked in every stored field', () => {
  const row = toAppErrorRow(
    {
      scope: 'recordWinner 7ef7d8b8-6fe1-4d71-80c9-44a7c3e73ba1',
      message: 'no profile for host@theanchor.pub, call 07700 900123 or +44 7700 900456 about £110 Cash Jackpot',
      correlationId: 'c0ffee00-0000-4000-8000-000000000001',
      code: '23505',
      digest: 'digest for a@b.co',
    },
    'Mozilla/5.0 (contact admin@example.com)',
  );
  const stored = JSON.stringify(row);
  for (const leaked of ['7ef7d8b8', 'theanchor', '900123', '900456', '110', 'c0ffee00', 'a@b.co', 'admin@example.com']) {
    assert.ok(!stored.includes(leaked), `${leaked} reached the row: ${stored}`);
  }
  assert.match(row.message, /\[email\]/);
  assert.match(row.message, /\[phone\]/);
  assert.match(row.message, /\[amount\]/);
  assert.match(row.source, /\[uuid\]/);
});

test('a path keeps its pathname only: the query string and fragment are dropped', () => {
  const row = toAppErrorRow(
    { scope: 's', message: 'm', path: '/player/7ef7d8b8-6fe1-4d71-80c9-44a7c3e73ba1?email=a@b.co#x' },
    null,
  );
  assert.equal(row.path, '/player/[uuid]');
  const full = toAppErrorRow({ scope: 's', message: 'm', path: 'https://bingo.example/host?s=1' }, null);
  assert.equal(full.path, '/host');
});

test('redaction leaves dates, times and ball numbers alone', () => {
  const text = 'game on 2026-11-06 at 20:15, balls 1, 2, 90 called, code 23505';
  assert.equal(redact(text), text);
});
