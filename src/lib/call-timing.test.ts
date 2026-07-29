// src/lib/call-timing.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HOST_MIN_CALL_GAP_MS,
  DEFAULT_PUBLIC_CALL_DELAY_SECONDS,
  PUBLIC_MIN_DWELL_MS,
} from './call-timing';

// These are pinned deliberately. A silent change to any of them changes how the
// pub screens pace, or how quickly the host may call, so it must trip a test.

test('HOST_MIN_CALL_GAP_MS is the anti-double-tap window only', () => {
  assert.equal(HOST_MIN_CALL_GAP_MS, 400);
});

test('DEFAULT_PUBLIC_CALL_DELAY_SECONDS is the public reveal delay', () => {
  assert.equal(DEFAULT_PUBLIC_CALL_DELAY_SECONDS, 3);
});

test('PUBLIC_MIN_DWELL_MS keeps a backlogged ball on screen', () => {
  assert.equal(PUBLIC_MIN_DWELL_MS, 1200);
});

test('the public reveal delay is far longer than the host gap', () => {
  // Guards against the two being conflated again: they are not the same thing.
  assert.ok(DEFAULT_PUBLIC_CALL_DELAY_SECONDS * 1000 > HOST_MIN_CALL_GAP_MS);
});
