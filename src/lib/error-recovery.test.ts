// src/lib/error-recovery.test.ts
//
// A render exception used to leave the unattended pub TV on Next's error page
// for good. The boundaries now retry once, then reload with a growing wait.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ERROR_RELOAD_MAX_DELAY_MS,
  ERROR_REPEAT_WINDOW_MS,
  ERROR_RETRY_DELAY_MS,
  decideErrorRecovery,
  parseErrorHistory,
  recordError,
  serialiseErrorHistory,
  type ErrorHistory,
} from './error-recovery';

const NOW = 1_000_000_000;

test('the first error retries in place after a few seconds', () => {
  const history = recordError(null, NOW);
  assert.deepEqual(history, { count: 1, lastAtMs: NOW });
  assert.deepEqual(decideErrorRecovery(history), { action: 'retry', delayMs: ERROR_RETRY_DELAY_MS });
  assert.ok(ERROR_RETRY_DELAY_MS >= 2_000 && ERROR_RETRY_DELAY_MS <= 10_000, 'a few seconds');
});

test('an error that comes back soon reloads the page instead', () => {
  const second = recordError(recordError(null, NOW), NOW + 6_000);
  assert.equal(second.count, 2);
  assert.deepEqual(decideErrorRecovery(second), { action: 'reload', delayMs: ERROR_RETRY_DELAY_MS });
});

test('the reload wait doubles while the error keeps coming back, up to a minute', () => {
  let history: ErrorHistory | null = null;
  let clock = NOW;
  const delays: number[] = [];
  for (let i = 0; i < 12; i += 1) {
    history = recordError(history, clock);
    const recovery = decideErrorRecovery(history);
    if (i > 0) assert.equal(recovery.action, 'reload');
    delays.push(recovery.delayMs);
    clock += recovery.delayMs + 2_000;
  }
  for (let i = 2; i < delays.length; i += 1) assert.ok(delays[i] >= delays[i - 1], 'never shrinks');
  assert.deepEqual(delays.slice(1, 5), [5_000, 10_000, 20_000, 40_000]);
  assert.equal(delays[delays.length - 1], ERROR_RELOAD_MAX_DELAY_MS);
  assert.ok(ERROR_REPEAT_WINDOW_MS > ERROR_RELOAD_MAX_DELAY_MS, 'the longest wait still counts as a repeat');
});

test('an error long after the last one starts again with a retry', () => {
  const earlier: ErrorHistory = { count: 5, lastAtMs: NOW };
  const later = recordError(earlier, NOW + ERROR_REPEAT_WINDOW_MS + 1);
  assert.deepEqual(later, { count: 1, lastAtMs: NOW + ERROR_REPEAT_WINDOW_MS + 1 });
  assert.equal(decideErrorRecovery(later).action, 'retry');
});

test('a clock that went backwards is a fresh start, not a repeat', () => {
  assert.equal(recordError({ count: 3, lastAtMs: NOW }, NOW - 1).count, 1);
});

test('the stored history round-trips, and junk is ignored', () => {
  const history: ErrorHistory = { count: 3, lastAtMs: NOW };
  assert.deepEqual(parseErrorHistory(serialiseErrorHistory(history)), history);
  for (const junk of [null, undefined, '', 'not json', '[]', '{}', '{"count":0,"lastAtMs":1}', '{"count":2,"lastAtMs":"x"}', '{"count":1.5,"lastAtMs":1}']) {
    assert.equal(parseErrorHistory(junk), null, String(junk));
  }
});
