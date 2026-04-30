// src/lib/connection-health.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  initialHealthState,
  reduceHealth,
  selectShouldShowBanner,
  selectShouldAutoRefresh,
} from './connection-health';

const t0 = 1_700_000_000_000; // arbitrary fixed epoch ms

test('starts healthy', () => {
  const s = initialHealthState(t0);
  assert.equal(s.healthy, true);
  assert.equal(selectShouldShowBanner(s, t0), false);
  assert.equal(selectShouldAutoRefresh(s, t0), false);
});

test('poll failure flips to unhealthy at the moment of failure', () => {
  let s = initialHealthState(t0);
  s = reduceHealth(s, { type: 'poll-failure', at: t0 + 1000 });
  assert.equal(s.healthy, false);
  assert.equal(s.unhealthySinceMs, t0 + 1000);
});

test('does not show banner before 10s unhealthy', () => {
  let s = initialHealthState(t0);
  s = reduceHealth(s, { type: 'poll-failure', at: t0 + 1000 });
  assert.equal(selectShouldShowBanner(s, t0 + 5000), false); // 4s in
  assert.equal(selectShouldShowBanner(s, t0 + 11000), true); // 10s in
});

test('auto-refresh triggers at 30s unhealthy', () => {
  let s = initialHealthState(t0);
  s = reduceHealth(s, { type: 'poll-failure', at: t0 + 1000 });
  assert.equal(selectShouldAutoRefresh(s, t0 + 30000), false); // 29s
  assert.equal(selectShouldAutoRefresh(s, t0 + 31001), true);  // 30.001s
});

test('poll success while unhealthy returns to healthy and clears flags', () => {
  let s = initialHealthState(t0);
  s = reduceHealth(s, { type: 'poll-failure', at: t0 + 1000 });
  s = reduceHealth(s, { type: 'poll-success', at: t0 + 5000 });
  assert.equal(s.healthy, true);
  assert.equal(s.unhealthySinceMs, null);
});

test('navigator.onLine === false flips to unhealthy immediately', () => {
  let s = initialHealthState(t0);
  s = reduceHealth(s, { type: 'browser-offline', at: t0 + 100 });
  assert.equal(s.healthy, false);
  assert.equal(s.unhealthySinceMs, t0 + 100);
});

test('realtime CHANNEL_ERROR flips to unhealthy; SUBSCRIBED clears it', () => {
  let s = initialHealthState(t0);
  s = reduceHealth(s, { type: 'realtime-status', status: 'CHANNEL_ERROR', at: t0 + 100 });
  assert.equal(s.healthy, false);
  s = reduceHealth(s, { type: 'realtime-status', status: 'SUBSCRIBED', at: t0 + 200 });
  assert.equal(s.healthy, true);
});
