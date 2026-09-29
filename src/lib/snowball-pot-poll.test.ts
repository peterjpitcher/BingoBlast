// src/lib/snowball-pot-poll.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldApplyPolledPot } from './snowball-pot-poll';

const POT = 'pot-a';

test('applies a polled pot when Realtime has never delivered (the fallback case)', () => {
  assert.equal(
    shouldApplyPolledPot({ polledPotId: POT, activePotId: POT, pollStartedAt: 1000, lastRealtimeAt: null }),
    true
  );
});

test('applies a polled pot sent after the last Realtime event', () => {
  assert.equal(
    shouldApplyPolledPot({ polledPotId: POT, activePotId: POT, pollStartedAt: 2000, lastRealtimeAt: 1500 }),
    true
  );
});

test('drops a polled pot when a Realtime event landed while the poll was in flight', () => {
  assert.equal(
    shouldApplyPolledPot({ polledPotId: POT, activePotId: POT, pollStartedAt: 2000, lastRealtimeAt: 2500 }),
    false
  );
});

test('drops a polled pot when a Realtime event landed in the same millisecond', () => {
  assert.equal(
    shouldApplyPolledPot({ polledPotId: POT, activePotId: POT, pollStartedAt: 2000, lastRealtimeAt: 2000 }),
    false
  );
});

test('drops a polled pot once the active game has moved to a different pot', () => {
  assert.equal(
    shouldApplyPolledPot({ polledPotId: POT, activePotId: 'pot-b', pollStartedAt: 2000, lastRealtimeAt: null }),
    false
  );
});

test('drops a polled pot once the active game is no longer a snowball game', () => {
  assert.equal(
    shouldApplyPolledPot({ polledPotId: POT, activePotId: null, pollStartedAt: 2000, lastRealtimeAt: null }),
    false
  );
  assert.equal(
    shouldApplyPolledPot({ polledPotId: POT, activePotId: undefined, pollStartedAt: 2000, lastRealtimeAt: null }),
    false
  );
});
