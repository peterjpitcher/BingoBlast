// src/lib/connection-health.ts
export type RealtimeStatus = 'SUBSCRIBED' | 'CHANNEL_ERROR' | 'TIMED_OUT' | 'CLOSED' | 'JOINING';

export type HealthEvent =
  | { type: 'poll-success'; at: number }
  | { type: 'poll-failure'; at: number }
  | { type: 'browser-online'; at: number }
  | { type: 'browser-offline'; at: number }
  | { type: 'realtime-status'; status: RealtimeStatus; at: number };

export interface HealthState {
  healthy: boolean;
  unhealthySinceMs: number | null;
  lastSuccessAt: number;
  online: boolean;
  realtime: RealtimeStatus | null;
}

const BANNER_THRESHOLD_MS = 10_000;
const AUTO_REFRESH_THRESHOLD_MS = 30_000;

export function initialHealthState(now: number): HealthState {
  return {
    healthy: true,
    unhealthySinceMs: null,
    lastSuccessAt: now,
    online: true,
    realtime: null,
  };
}

function flipUnhealthy(state: HealthState, at: number): HealthState {
  if (!state.healthy) return state;
  return { ...state, healthy: false, unhealthySinceMs: at };
}

function flipHealthy(state: HealthState, at: number): HealthState {
  return { ...state, healthy: true, unhealthySinceMs: null, lastSuccessAt: at };
}

export function reduceHealth(state: HealthState, event: HealthEvent): HealthState {
  switch (event.type) {
    case 'poll-success':
      return flipHealthy(state, event.at);
    case 'poll-failure':
      return flipUnhealthy(state, event.at);
    case 'browser-online':
      return { ...state, online: true };
    case 'browser-offline':
      return flipUnhealthy({ ...state, online: false }, event.at);
    case 'realtime-status': {
      const next = { ...state, realtime: event.status };
      if (event.status === 'SUBSCRIBED') return flipHealthy(next, event.at);
      if (event.status === 'CHANNEL_ERROR' || event.status === 'TIMED_OUT' || event.status === 'CLOSED') {
        return flipUnhealthy(next, event.at);
      }
      return next;
    }
  }
}

export function selectShouldShowBanner(state: HealthState, now: number): boolean {
  if (state.healthy || state.unhealthySinceMs == null) return false;
  return now - state.unhealthySinceMs >= BANNER_THRESHOLD_MS;
}

export function selectShouldAutoRefresh(state: HealthState, now: number): boolean {
  if (state.healthy || state.unhealthySinceMs == null) return false;
  return now - state.unhealthySinceMs > AUTO_REFRESH_THRESHOLD_MS;
}
