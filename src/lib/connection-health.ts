// Connection health reducer.
//
// Tracks polling, realtime, and browser-online state independently and surfaces
// "unhealthy" only when nothing is delivering data — not when a single transport
// has a transient blip.
//
// Rule: healthy when at least one transport is healthy AND the browser is online.
// "Healthy" for a transport means most recently observed succeeding (poll
// success, realtime SUBSCRIBED). A transport that has never reported is treated
// as unknown — at session start both are unknown and the page is treated as
// healthy until something actively fails.

export type RealtimeStatus = 'SUBSCRIBED' | 'CHANNEL_ERROR' | 'TIMED_OUT' | 'CLOSED' | 'JOINING';

export type TransportState = 'unknown' | 'healthy' | 'failing';

export type HealthEvent =
  | { type: 'poll-success'; at: number }
  | { type: 'poll-failure'; at: number }
  | { type: 'browser-online'; at: number }
  | { type: 'browser-offline'; at: number }
  | { type: 'realtime-status'; status: RealtimeStatus; at: number };

export interface HealthState {
  pollState: TransportState;
  realtimeState: TransportState;
  online: boolean;
  realtime: RealtimeStatus | null;
  unhealthySinceMs: number | null;
  lastSuccessAt: number;
}

const BANNER_THRESHOLD_MS = 10_000;
const AUTO_REFRESH_THRESHOLD_MS = 30_000;

export function initialHealthState(now: number): HealthState {
  return {
    pollState: 'unknown',
    realtimeState: 'unknown',
    online: true,
    realtime: null,
    unhealthySinceMs: null,
    lastSuccessAt: now,
  };
}

function effectiveHealthy(state: HealthState): boolean {
  if (!state.online) return false;
  if (state.pollState === 'healthy' || state.realtimeState === 'healthy') return true;
  if (state.pollState === 'failing' || state.realtimeState === 'failing') return false;
  return true;
}

export function reduceHealth(state: HealthState, event: HealthEvent): HealthState {
  const next: HealthState = { ...state };

  switch (event.type) {
    case 'poll-success':
      next.pollState = 'healthy';
      next.lastSuccessAt = event.at;
      break;
    case 'poll-failure':
      next.pollState = 'failing';
      break;
    case 'browser-online':
      next.online = true;
      break;
    case 'browser-offline':
      next.online = false;
      break;
    case 'realtime-status': {
      next.realtime = event.status;
      if (event.status === 'SUBSCRIBED') {
        next.realtimeState = 'healthy';
        next.lastSuccessAt = event.at;
      } else if (event.status === 'CHANNEL_ERROR' || event.status === 'TIMED_OUT' || event.status === 'CLOSED') {
        next.realtimeState = 'failing';
      }
      break;
    }
  }

  const wasHealthy = effectiveHealthy(state);
  const isHealthy = effectiveHealthy(next);
  if (wasHealthy && !isHealthy) {
    next.unhealthySinceMs = event.at;
  } else if (!wasHealthy && isHealthy) {
    next.unhealthySinceMs = null;
  }
  return next;
}

export function selectHealthy(state: HealthState): boolean {
  return effectiveHealthy(state);
}

export function selectShouldShowBanner(state: HealthState, now: number): boolean {
  if (selectHealthy(state) || state.unhealthySinceMs == null) return false;
  return now - state.unhealthySinceMs >= BANNER_THRESHOLD_MS;
}

export function selectShouldAutoRefresh(state: HealthState, now: number): boolean {
  if (selectHealthy(state) || state.unhealthySinceMs == null) return false;
  return now - state.unhealthySinceMs > AUTO_REFRESH_THRESHOLD_MS;
}
