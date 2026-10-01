// src/lib/public-selectors.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PUBLIC_SESSION_COLUMNS,
  PUBLIC_GAME_COLUMNS,
  PUBLIC_GAME_STATE_COLUMNS,
  isFreshSession,
} from './public-selectors';

const columns = (list: string) => list.split(',').map((c) => c.trim());

test('the public session columns carry the lifecycle fields the phase needs', () => {
  const cols = columns(PUBLIC_SESSION_COLUMNS);
  for (const needed of ['id', 'name', 'status', 'active_game_id', 'start_date', 'started_at', 'completed_at', 'state_version']) {
    assert.ok(cols.includes(needed), `missing ${needed}`);
  }
});

test('the public session columns never include staff-only fields', () => {
  const cols = columns(PUBLIC_SESSION_COLUMNS);
  for (const hidden of ['notes', 'created_by']) {
    assert.ok(!cols.includes(hidden), `${hidden} must not be read by a public screen`);
  }
});

test('the public game state columns carry the live claim', () => {
  const cols = columns(PUBLIC_GAME_STATE_COLUMNS);
  for (const needed of ['game_id', 'called_numbers', 'paused_for_validation', 'state_version', 'claim_numbers', 'claim_result']) {
    assert.ok(cols.includes(needed), `missing ${needed}`);
  }
});

test('the public game columns never include the host notes', () => {
  assert.ok(!columns(PUBLIC_GAME_COLUMNS).includes('notes'));
});

test('no column is listed twice', () => {
  for (const list of [PUBLIC_SESSION_COLUMNS, PUBLIC_GAME_COLUMNS, PUBLIC_GAME_STATE_COLUMNS]) {
    const cols = columns(list);
    assert.equal(new Set(cols).size, cols.length);
  }
});

test('a session snapshot applies when nothing is held yet', () => {
  assert.equal(isFreshSession(null, { state_version: 3 }), true);
});

test('a missing incoming snapshot never applies', () => {
  assert.equal(isFreshSession({ state_version: 3 }, null), false);
});

test('an older session snapshot is dropped', () => {
  assert.equal(isFreshSession({ state_version: 5 }, { state_version: 4 }), false);
});

test('the same version applies again, because reapplying it changes nothing', () => {
  assert.equal(isFreshSession({ state_version: 5 }, { state_version: 5 }), true);
});

test('a newer session snapshot applies', () => {
  assert.equal(isFreshSession({ state_version: 5 }, { state_version: 6 }), true);
});

test('a version that cannot be compared is applied rather than stranding the screen', () => {
  assert.equal(isFreshSession({ state_version: undefined }, { state_version: 1 }), true);
  assert.equal(isFreshSession({ state_version: 4 }, { state_version: Number.NaN }), true);
});
