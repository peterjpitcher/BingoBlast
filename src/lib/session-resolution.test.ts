// src/lib/session-resolution.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveDisplaySession,
  sessionQualifies,
  displayPathFor,
  displayLobbyPath,
  pickSessionsByIds,
  type ResolvableSession,
} from './session-resolution';

const TODAY = '2026-11-18';

const s = (id: string, overrides: Partial<ResolvableSession> = {}): ResolvableSession => ({
  id,
  status: 'ready',
  start_date: TODAY,
  is_test_session: false,
  ...overrides,
});

test('a running session qualifies whatever its date', () => {
  assert.equal(sessionQualifies(s('a', { status: 'running', start_date: '2026-12-25' }), TODAY), true);
});

test('a ready session dated today qualifies', () => {
  assert.equal(sessionQualifies(s('a'), TODAY), true);
});

test('a ready session dated before today qualifies', () => {
  assert.equal(sessionQualifies(s('a', { start_date: '2026-11-17' }), TODAY), true);
});

test('a ready session dated in the future waits for its date', () => {
  assert.equal(sessionQualifies(s('a', { start_date: '2026-11-19' }), TODAY), false);
});

test('draft and completed sessions never qualify', () => {
  assert.equal(sessionQualifies(s('a', { status: 'draft' }), TODAY), false);
  assert.equal(sessionQualifies(s('a', { status: 'completed' }), TODAY), false);
});

test('a test session only qualifies in rehearsal', () => {
  const rehearsal = s('a', { is_test_session: true });
  assert.equal(sessionQualifies(rehearsal, TODAY), false);
  assert.equal(sessionQualifies(rehearsal, TODAY, { includeTest: true }), true);
});

test('a missing or malformed start date does not qualify a ready session', () => {
  assert.equal(sessionQualifies(s('a', { start_date: '' }), TODAY), false);
  assert.equal(sessionQualifies(s('a', { start_date: null }), TODAY), false);
});

test('one qualifying session resolves to it', () => {
  assert.deepEqual(
    resolveDisplaySession([s('a'), s('b', { status: 'draft' })], TODAY, { includeTest: false }),
    { kind: 'one', id: 'a' }
  );
});

test('no qualifying session resolves to none', () => {
  assert.deepEqual(
    resolveDisplaySession([s('a', { start_date: '2026-11-25' })], TODAY, { includeTest: false }),
    { kind: 'none' }
  );
  assert.deepEqual(resolveDisplaySession([], TODAY, { includeTest: false }), { kind: 'none' });
});

test('several qualifying sessions resolve to many, running ones first', () => {
  assert.deepEqual(
    resolveDisplaySession([s('a'), s('b', { status: 'running' }), s('c', { start_date: '2026-11-01' })], TODAY, {
      includeTest: false,
    }),
    { kind: 'many', ids: ['b', 'a', 'c'] }
  );
});

test('a future ready session does not take over from tonight during night over', () => {
  // Tonight is completed, next week's is ready: nothing qualifies (spec 10).
  assert.deepEqual(
    resolveDisplaySession(
      [s('tonight', { status: 'completed' }), s('next', { start_date: '2026-11-25' })],
      TODAY,
      { includeTest: false }
    ),
    { kind: 'none' }
  );
});

test('rehearsal includes test sessions alongside real ones', () => {
  const sessions = [s('real'), s('test', { is_test_session: true })];
  assert.deepEqual(resolveDisplaySession(sessions, TODAY, { includeTest: false }), { kind: 'one', id: 'real' });
  assert.deepEqual(resolveDisplaySession(sessions, TODAY, { includeTest: true }), {
    kind: 'many',
    ids: ['real', 'test'],
  });
});

test('display paths keep rehearsal mode', () => {
  assert.equal(displayPathFor('abc'), '/display/abc');
  assert.equal(displayPathFor('abc', { rehearsal: true }), '/display/abc?rehearsal=1');
  assert.equal(displayLobbyPath(), '/display');
  assert.equal(displayLobbyPath({ rehearsal: true }), '/display?rehearsal=1');
});

test('sessions are picked in the resolution order, skipping unknown ids', () => {
  const sessions = [s('a'), s('b'), s('c')];
  assert.deepEqual(pickSessionsByIds(sessions, ['c', 'x', 'a']).map((row) => row.id), ['c', 'a']);
});
