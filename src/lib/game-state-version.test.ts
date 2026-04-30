// src/lib/game-state-version.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isFreshGameState } from './game-state-version';

test('isFreshGameState returns true when current is null', () => {
  assert.equal(
    isFreshGameState(null, { state_version: 5 }),
    true
  );
});

test('isFreshGameState returns false when incoming is null', () => {
  assert.equal(
    isFreshGameState({ state_version: 5 }, null),
    false
  );
});

test('isFreshGameState accepts higher version', () => {
  assert.equal(
    isFreshGameState({ state_version: 5 }, { state_version: 6 }),
    true
  );
});

test('isFreshGameState accepts equal version (idempotent reapply)', () => {
  assert.equal(
    isFreshGameState({ state_version: 5 }, { state_version: 5 }),
    true
  );
});

test('isFreshGameState rejects lower version', () => {
  assert.equal(
    isFreshGameState({ state_version: 5 }, { state_version: 4 }),
    false
  );
});

test('isFreshGameState ignores numbers_called_count when version is newer (void path)', () => {
  // Voiding a number legitimately decreases numbers_called_count.
  // The helper must not refuse a newer state just because the count is lower.
  const current = { state_version: 5, numbers_called_count: 10 };
  const incoming = { state_version: 6, numbers_called_count: 9 };
  assert.equal(isFreshGameState(current, incoming), true);
});
