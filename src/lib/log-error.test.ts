// src/lib/log-error.test.ts
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { logError } from './log-error';

test('redacts UUIDs from messages', () => {
  const calls: unknown[][] = [];
  const spy = mock.method(console, 'error', (...args: unknown[]) => { calls.push(args); });
  process.env.LOG_ERRORS = 'true';
  logError('test', new Error('failed for user 7c2c1d6e-7e5b-4d9d-9f8c-2e8c5a2b1f30'));
  spy.mock.restore();
  assert.equal(calls.length, 1);
  const message = (calls[0][1] as Error).message;
  assert.match(message, /\[redacted-uuid\]/);
});

test('no-op in production unless LOG_ERRORS=true', () => {
  const calls: unknown[][] = [];
  const spy = mock.method(console, 'error', (...args: unknown[]) => { calls.push(args); });
  // Cast through Record to bypass the readonly NODE_ENV typing inherited from Next.js.
  (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
  delete process.env.LOG_ERRORS;
  logError('test', new Error('boom'));
  spy.mock.restore();
  assert.equal(calls.length, 0);
});
