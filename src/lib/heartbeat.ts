// src/lib/heartbeat.ts
//
// The controller heartbeat's write (spec S4.3, S4.4, row C-6). The host's
// phone sends one every 10 seconds while it holds control, and another host
// may take over after 30 seconds without one.
//
// The update binds the controller, so it touches no row once another host has
// taken over. Without .select() that answered "no error" and the action said
// success: the phone went on believing it was in control. Now zero rows is
// lost control, reported as a conflict so the screen re-reads the game.

export const LOST_CONTROL_ERROR = 'Another host has taken control of this game.';

export interface HeartbeatClient {
  from(table: 'game_states'): {
    update(values: { controller_last_seen_at: string }): {
      eq(column: 'game_id', value: string): {
        eq(column: 'controlling_host_id', value: string): {
          select(columns: 'game_id'): PromiseLike<{ data: unknown[] | null; error: unknown }>;
        };
      };
    };
  };
}

export type HeartbeatOutcome =
  | { kind: 'ok' }
  | { kind: 'lost_control' }
  | { kind: 'error'; error: unknown };

export async function writeHeartbeat(
  client: HeartbeatClient,
  gameId: string,
  hostId: string,
  now: Date = new Date()
): Promise<HeartbeatOutcome> {
  const { data, error } = await client
    .from('game_states')
    .update({ controller_last_seen_at: now.toISOString() })
    .eq('game_id', gameId)
    .eq('controlling_host_id', hostId)
    .select('game_id');
  if (error) return { kind: 'error', error };
  if (!data || data.length === 0) return { kind: 'lost_control' };
  return { kind: 'ok' };
}
