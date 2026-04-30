import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  initialHealthState,
  reduceHealth,
  selectHealthy,
  selectShouldShowBanner,
  selectShouldAutoRefresh,
} from './connection-health';

const t0 = 1_700_000_000_000;

test('starts healthy with both transports unknown', () => {
  const s = initialHealthState(t0);
  assert.equal(selectHealthy(s), true);
  assert.equal(selectShouldShowBanner(s, t0), false);
  assert.equal(selectShouldAutoRefresh(s, t0), false);
});

test('poll failure alone does NOT flip unhealthy when realtime is healthy', () => {
  let s = initialHealthState(t0);
  s = reduceHealth(s, { type: 'realtime-status', status: 'SUBSCRIBED', at: t0 + 100 });
  s = reduceHealth(s, { type: 'poll-failure', at: t0 + 1000 });
  assert.equal(selectHealthy(s), true, 'realtime healthy keeps page healthy despite poll failure');
});

test('realtime failure alone does NOT flip unhealthy when polling is healthy', () => {
  let s = initialHealthState(t0);
  s = reduceHealth(s, { type: 'poll-success', at: t0 + 100 });
  s = reduceHealth(s, { type: 'realtime-status', status: 'CHANNEL_ERROR', at: t0 + 1000 });
  assert.equal(selectHealthy(s), true, 'poll healthy keeps page healthy despite realtime error');
});

test('both transports failing flips unhealthy', () => {
  let s = initialHealthState(t0);
  s = reduceHealth(s, { type: 'poll-success', at: t0 + 100 });
  s = reduceHealth(s, { type: 'realtime-status', status: 'SUBSCRIBED', at: t0 + 100 });
  s = reduceHealth(s, { type: 'poll-failure', at: t0 + 1000 });
  s = reduceHealth(s, { type: 'realtime-status', status: 'CHANNEL_ERROR', at: t0 + 2000 });
  assert.equal(selectHealthy(s), false);
  assert.equal(s.unhealthySinceMs, t0 + 2000);
});

test('browser offline flips unhealthy regardless of transports', () => {
  let s = initialHealthState(t0);
  s = reduceHealth(s, { type: 'poll-success', at: t0 + 100 });
  s = reduceHealth(s, { type: 'browser-offline', at: t0 + 200 });
  assert.equal(selectHealthy(s), false);
  assert.equal(s.unhealthySinceMs, t0 + 200);
});

test('browser online clears unhealthy if no transport is failing', () => {
  let s = initialHealthState(t0);
  s = reduceHealth(s, { type: 'browser-offline', at: t0 + 100 });
  s = reduceHealth(s, { type: 'browser-online', at: t0 + 500 });
  assert.equal(selectHealthy(s), true);
  assert.equal(s.unhealthySinceMs, null);
});

test('does not show banner before 10s of continuous unhealth', () => {
  let s = initialHealthState(t0);
  s = reduceHealth(s, { type: 'browser-offline', at: t0 + 100 });
  assert.equal(selectShouldShowBanner(s, t0 + 5000), false);
  assert.equal(selectShouldShowBanner(s, t0 + 10101), true);
});

test('auto-refresh fires after 30s of continuous unhealth', () => {
  let s = initialHealthState(t0);
  s = reduceHealth(s, { type: 'browser-offline', at: t0 + 100 });
  assert.equal(selectShouldAutoRefresh(s, t0 + 29000), false);
  assert.equal(selectShouldAutoRefresh(s, t0 + 30200), true);
});

test('one transport failing while the other is unknown flips unhealthy', () => {
  let s = initialHealthState(t0);
  s = reduceHealth(s, { type: 'poll-failure', at: t0 + 1000 });
  assert.equal(selectHealthy(s), false);
  s = reduceHealth(s, { type: 'realtime-status', status: 'SUBSCRIBED', at: t0 + 2000 });
  assert.equal(selectHealthy(s), true);
});

test('realtime CHANNEL_ERROR with poll unknown flips unhealthy', () => {
  let s = initialHealthState(t0);
  s = reduceHealth(s, { type: 'realtime-status', status: 'CHANNEL_ERROR', at: t0 + 100 });
  assert.equal(selectHealthy(s), false);
});

test('JOINING realtime status leaves transport state unchanged', () => {
  let s = initialHealthState(t0);
  s = reduceHealth(s, { type: 'realtime-status', status: 'SUBSCRIBED', at: t0 + 100 });
  assert.equal(selectHealthy(s), true);
  s = reduceHealth(s, { type: 'realtime-status', status: 'JOINING', at: t0 + 200 });
  assert.equal(s.realtimeState, 'healthy');
  assert.equal(selectHealthy(s), true);
});

test('unhealthySinceMs uses the moment health flipped, not the latest event', () => {
  let s = initialHealthState(t0);
  s = reduceHealth(s, { type: 'poll-success', at: t0 + 100 });
  s = reduceHealth(s, { type: 'realtime-status', status: 'SUBSCRIBED', at: t0 + 100 });
  s = reduceHealth(s, { type: 'poll-failure', at: t0 + 1000 });
  s = reduceHealth(s, { type: 'realtime-status', status: 'CHANNEL_ERROR', at: t0 + 2000 });
  // Flipped unhealthy when realtime joined polling in failure at t0 + 2000.
  assert.equal(s.unhealthySinceMs, t0 + 2000);
  s = reduceHealth(s, { type: 'realtime-status', status: 'CLOSED', at: t0 + 3000 });
  // Already unhealthy → stays at original timestamp.
  assert.equal(s.unhealthySinceMs, t0 + 2000);
});
