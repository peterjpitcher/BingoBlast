// Tonight's session for a paired /tv (row C-6), by London date. The suite
// runs under TZ=Europe/London (npm test) and TZ=UTC (npm run test:utc), so
// each instant below is checked in both zones.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { TvDevice } from '@anchor-nights/kit/pairing/shared';
import { createFindTonight, pickTonight } from './tv-tonight';
import type { ResolvableSession } from './session-resolution';

const DEVICE: TvDevice = { id: '00000000-0000-4000-8000-000000000001', name: 'Bar TV', createdAt: '2026-11-01T18:00:00Z', lastSeenAt: null };

function session(overrides: Partial<ResolvableSession> & { id: string }): ResolvableSession {
  return { status: 'ready', start_date: null, is_test_session: false, ...overrides };
}

function find(sessions: ResolvableSession[]) {
  return createFindTonight(async () => ({ data: sessions, error: null }));
}

async function tonightAt(iso: string, sessions: ResolvableSession[], rehearsal = false) {
  return find(sessions)({ device: DEVICE, now: new Date(iso), rehearsal });
}

test('a ready session dated tomorrow waits for London midnight, in winter (GMT)', async () => {
  const sessions = [session({ id: 'friday', start_date: '2026-11-13' })];
  assert.equal(await tonightAt('2026-11-12T23:59:59Z', sessions), null);
  assert.deepEqual(await tonightAt('2026-11-13T00:00:00Z', sessions), { id: 'friday' });
});

test('in summer (BST) the London date turns at 23:00 UTC, not at UTC midnight', async () => {
  const sessions = [session({ id: 'summer', start_date: '2026-07-03' })];
  assert.equal(await tonightAt('2026-07-02T22:59:59Z', sessions), null);
  // 00:00 on 3 July in London, still 2 July in UTC.
  assert.deepEqual(await tonightAt('2026-07-02T23:00:00Z', sessions), { id: 'summer' });
});

test('the night the clocks go forward and the night they go back', async () => {
  // 29 March 2026: London is GMT until 01:00 UTC. Its midnight is 00:00 UTC.
  const spring = [session({ id: 'spring', start_date: '2026-03-29' })];
  assert.equal(await tonightAt('2026-03-28T23:59:59Z', spring), null);
  assert.deepEqual(await tonightAt('2026-03-29T00:00:00Z', spring), { id: 'spring' });
  // 25 October 2026: London is BST until 01:00 UTC. Its midnight is 23:00 UTC the day before.
  const autumn = [session({ id: 'autumn', start_date: '2026-10-25' })];
  assert.equal(await tonightAt('2026-10-24T22:59:59Z', autumn), null);
  assert.deepEqual(await tonightAt('2026-10-24T23:00:00Z', autumn), { id: 'autumn' });
});

test('a running session shows whatever its date, and a past ready one still counts', async () => {
  assert.deepEqual(await tonightAt('2026-11-07T20:00:00Z', [session({ id: 'live', status: 'running', start_date: '2026-12-01' })]), { id: 'live' });
  assert.deepEqual(await tonightAt('2026-11-07T20:00:00Z', [session({ id: 'late', start_date: '2026-11-06' })]), { id: 'late' });
});

test('a test session shows only in rehearsal', async () => {
  const sessions = [session({ id: 'rehearsal', status: 'running', is_test_session: true })];
  assert.equal(await tonightAt('2026-11-07T20:00:00Z', sessions), null);
  assert.deepEqual(await tonightAt('2026-11-07T20:00:00Z', sessions, true), { id: 'rehearsal' });
});

test('with several, a running session beats a ready one, and otherwise the first (newest) is taken', () => {
  const today = '2026-11-07';
  assert.deepEqual(
    pickTonight([session({ id: 'ready', start_date: today }), session({ id: 'running', status: 'running' })], today, false),
    { id: 'running' },
  );
  assert.deepEqual(
    pickTonight([session({ id: 'newer', start_date: today }), session({ id: 'older', start_date: '2026-11-01' })], today, false),
    { id: 'newer' },
  );
});

test('no qualifying session is the idle loop', async () => {
  assert.equal(await tonightAt('2026-11-07T20:00:00Z', []), null);
  assert.equal(await tonightAt('2026-11-07T20:00:00Z', [session({ id: 'next-week', start_date: '2026-11-14' })]), null);
});

test('a failed read throws (the TV shows Reconnecting), never "nothing tonight"', async () => {
  const failing = createFindTonight(async () => ({ data: null, error: { message: 'connection refused' } }));
  await assert.rejects(failing({ device: DEVICE, now: new Date(), rehearsal: false }));
  const empty = createFindTonight(async () => ({ data: null, error: null }));
  await assert.rejects(empty({ device: DEVICE, now: new Date(), rehearsal: false }));
});
