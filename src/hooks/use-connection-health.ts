// src/hooks/use-connection-health.ts
'use client';
import { useCallback, useEffect, useReducer, useState } from 'react';
import {
  HealthState,
  RealtimeStatus,
  initialHealthState,
  reduceHealth,
  selectShouldAutoRefresh,
  selectShouldShowBanner,
} from '@/lib/connection-health';

export interface UseConnectionHealthApi {
  healthy: boolean;
  shouldShowBanner: boolean;
  shouldAutoRefresh: boolean;
  unhealthyForMs: number;
  markPollSuccess: () => void;
  markPollFailure: () => void;
  markRealtimeStatus: (status: RealtimeStatus) => void;
}

export function useConnectionHealth(): UseConnectionHealthApi {
  const [state, dispatch] = useReducer(
    (s: HealthState, e: Parameters<typeof reduceHealth>[1]) => reduceHealth(s, e),
    null,
    () => initialHealthState(Date.now()),
  );
  const [now, setNow] = useState(() => Date.now());

  // Tick once a second so banner/auto-refresh thresholds re-evaluate without
  // requiring the host to dispatch an event for time to pass.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Wire window online/offline.
  useEffect(() => {
    const onOnline = () => dispatch({ type: 'browser-online', at: Date.now() });
    const onOffline = () => dispatch({ type: 'browser-offline', at: Date.now() });
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  const markPollSuccess = useCallback(() => {
    dispatch({ type: 'poll-success', at: Date.now() });
  }, []);
  const markPollFailure = useCallback(() => {
    dispatch({ type: 'poll-failure', at: Date.now() });
  }, []);
  const markRealtimeStatus = useCallback((status: RealtimeStatus) => {
    dispatch({ type: 'realtime-status', status, at: Date.now() });
  }, []);

  return {
    healthy: state.healthy,
    shouldShowBanner: selectShouldShowBanner(state, now),
    shouldAutoRefresh: selectShouldAutoRefresh(state, now),
    unhealthyForMs: state.unhealthySinceMs == null ? 0 : Math.max(0, now - state.unhealthySinceMs),
    markPollSuccess,
    markPollFailure,
    markRealtimeStatus,
  };
}
