// The controller heartbeat must prove it landed (spec S4.4, row C-6).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeHeartbeat, type HeartbeatClient } from './heartbeat';

interface Call {
  table: string;
  values: unknown;
  filters: [string, string][];
  select: string;
}

function fakeClient(answer: { data: unknown[] | null; error: unknown }): { client: HeartbeatClient; calls: Call[] } {
  const calls: Call[] = [];
  const client: HeartbeatClient = {
    from(table) {
      return {
        update(values) {
          const call: Call = { table, values, filters: [], select: '' };
          calls.push(call);
          return {
            eq(column, value) {
              call.filters.push([column, value]);
              return {
                eq(column2, value2) {
                  call.filters.push([column2, value2]);
                  return {
                    select(columns) {
                      call.select = columns;
                      return Promise.resolve(answer);
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  };
  return { client, calls };
}

test('a heartbeat that updates no row is lost control, not success', async () => {
  const { client } = fakeClient({ data: [], error: null });
  assert.deepEqual(await writeHeartbeat(client, 'game-1', 'host-1'), { kind: 'lost_control' });
  const { client: nullClient } = fakeClient({ data: null, error: null });
  assert.deepEqual(await writeHeartbeat(nullClient, 'game-1', 'host-1'), { kind: 'lost_control' });
});

test('a heartbeat binds the game and the controller, and selects what it wrote', async () => {
  const { client, calls } = fakeClient({ data: [{ game_id: 'game-1' }], error: null });
  const now = new Date('2026-11-07T21:00:00Z');
  assert.deepEqual(await writeHeartbeat(client, 'game-1', 'host-1', now), { kind: 'ok' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].table, 'game_states');
  assert.deepEqual(calls[0].values, { controller_last_seen_at: '2026-11-07T21:00:00.000Z' });
  assert.deepEqual(calls[0].filters, [['game_id', 'game-1'], ['controlling_host_id', 'host-1']]);
  assert.equal(calls[0].select, 'game_id');
});

test('a database error is an error, not lost control', async () => {
  const error = { message: 'timeout' };
  const { client } = fakeClient({ data: null, error });
  assert.deepEqual(await writeHeartbeat(client, 'game-1', 'host-1'), { kind: 'error', error });
});
