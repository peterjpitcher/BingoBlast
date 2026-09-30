// src/lib/events-feed/client.test.ts
//
// The management API client. No network: fetch is injected. The key must go
// in the X-API-Key header, and no error may carry the response body.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_ANCHOR_API_BASE_URL, fetchManagementJson, getEventsFeedConfig } from './client';
import { EventsFeedError } from './errors';

const CONFIG = { baseUrl: 'https://management.example/api', apiKey: 'test-key' };

test('the config needs a key; the base URL defaults and loses its trailing slash', () => {
  assert.equal(getEventsFeedConfig({}), null);
  assert.equal(getEventsFeedConfig({ ANCHOR_API_KEY: '   ' }), null);
  assert.deepEqual(getEventsFeedConfig({ ANCHOR_API_KEY: 'k' }), { baseUrl: DEFAULT_ANCHOR_API_BASE_URL, apiKey: 'k' });
  assert.equal(DEFAULT_ANCHOR_API_BASE_URL, 'https://management.orangejelly.co.uk/api');
  assert.deepEqual(getEventsFeedConfig({ ANCHOR_API_KEY: 'k', ANCHOR_API_BASE_URL: 'https://staging.example/api/' }), {
    baseUrl: 'https://staging.example/api',
    apiKey: 'k',
  });
});

test('a GET goes to the base URL with the key in X-API-Key, and returns the JSON', async () => {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ success: true, data: { events: [] } }), { status: 200 });
  }) as unknown as typeof fetch;

  const json = await fetchManagementJson('/events?status=scheduled', { timeoutMs: 5000, config: CONFIG, fetchImpl });
  assert.deepEqual(json, { success: true, data: { events: [] } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://management.example/api/events?status=scheduled');
  const headers = calls[0].init?.headers as Record<string, string>;
  assert.equal(headers['X-API-Key'], 'test-key');
  assert.equal(calls[0].init?.method, 'GET');
  assert.ok(calls[0].init?.signal, 'every call has a timeout signal');
});

test('a non-2xx status throws with the status, never the body or the key', async () => {
  const fetchImpl = (async () =>
    new Response('{"error":{"message":"SECRET-BODY-TEXT"}}', { status: 429 })) as unknown as typeof fetch;
  await assert.rejects(
    fetchManagementJson('/events?category_id=abc', { timeoutMs: 5000, config: CONFIG, fetchImpl }),
    (err: unknown) => {
      assert.ok(err instanceof EventsFeedError);
      assert.equal(err.code, 'http');
      assert.match(err.message, /HTTP 429/);
      assert.match(err.message, /\/events\b/);
      assert.doesNotMatch(err.message, /SECRET-BODY-TEXT|test-key|category_id/);
      return true;
    },
  );
});

test('a body that is not JSON throws a parse error without the body', async () => {
  const fetchImpl = (async () => new Response('<html>SECRET-BODY-TEXT</html>', { status: 200 })) as unknown as typeof fetch;
  await assert.rejects(
    fetchManagementJson('/event-categories', { timeoutMs: 5000, config: CONFIG, fetchImpl }),
    (err: unknown) => err instanceof EventsFeedError && err.code === 'parse' && !err.message.includes('SECRET'),
  );
});

test('a timeout and a network failure are told apart', async () => {
  const timingOut = (async () => {
    throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
  }) as unknown as typeof fetch;
  await assert.rejects(
    fetchManagementJson('/events', { timeoutMs: 5000, config: CONFIG, fetchImpl: timingOut }),
    (err: unknown) => err instanceof EventsFeedError && err.code === 'timeout',
  );

  const offline = (async () => {
    throw new TypeError('fetch failed');
  }) as unknown as typeof fetch;
  await assert.rejects(
    fetchManagementJson('/events', { timeoutMs: 5000, config: CONFIG, fetchImpl: offline }),
    (err: unknown) => err instanceof EventsFeedError && err.code === 'network',
  );
});

test('the timeout really aborts a call that hangs', async () => {
  const hanging = ((_url: string, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
    })) as unknown as typeof fetch;
  await assert.rejects(
    fetchManagementJson('/events', { timeoutMs: 20, config: CONFIG, fetchImpl: hanging }),
    (err: unknown) => err instanceof EventsFeedError && err.code === 'timeout',
  );
});

test('without a key nothing is fetched', async () => {
  let called = false;
  const fetchImpl = (async () => {
    called = true;
    return new Response('{}');
  }) as unknown as typeof fetch;
  await assert.rejects(
    fetchManagementJson('/events', { timeoutMs: 5000, config: null, fetchImpl }),
    (err: unknown) => err instanceof EventsFeedError && err.code === 'missing_config',
  );
  assert.equal(called, false);
});
