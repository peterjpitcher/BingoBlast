// src/hooks/use-realtime-channel.ts
//
// React wrapper around createRealtimeConnector (src/lib/realtime-connector.ts).
// One connector per `key`: a new key disposes the old channel and opens a new
// one, and unmounting disposes it. `build` and `onStatus` are read through refs,
// so a new function identity on every render never reopens the channel.
//
// Pass stable callbacks (the destructured `markRealtimeStatus`, never the
// object from useConnectionHealth()), and guard payload handlers with the
// `isCurrent` argument that `build` receives.
'use client';

import { useCallback, useEffect, useRef } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { createRealtimeConnector, type RealtimeConnector } from '@/lib/realtime-connector';
import type { RealtimeStatus } from '@/lib/connection-health';

/** The part of a Supabase client this hook needs. */
export interface RealtimeCapableClient {
  channel(name: string): RealtimeChannel;
  removeChannel(channel: RealtimeChannel): Promise<unknown>;
}

export interface UseRealtimeChannelOptions {
  supabase: RealtimeCapableClient;
  /** Identifies the subscription, for example `game_state:<gameId>`. Used as the topic prefix. */
  key: string;
  /** False closes the channel and opens nothing. */
  enabled?: boolean;
  /** Attach the `.on(...)` handlers and return the channel. */
  build: (channel: RealtimeChannel, isCurrent: () => boolean) => RealtimeChannel;
  /** Status of the current channel only. Omit for channels that must not affect connection health. */
  onStatus?: (status: RealtimeStatus) => void;
}

export interface UseRealtimeChannelApi {
  /** Tear down and reopen now, for example when the page becomes visible again. */
  reconnect: () => void;
}

export function useRealtimeChannel({
  supabase,
  key,
  enabled = true,
  build,
  onStatus,
}: UseRealtimeChannelOptions): UseRealtimeChannelApi {
  const buildRef = useRef(build);
  const onStatusRef = useRef(onStatus);
  const connectorRef = useRef<RealtimeConnector | null>(null);

  // Latest callbacks, without making them effect dependencies.
  useEffect(() => {
    buildRef.current = build;
    onStatusRef.current = onStatus;
  });

  useEffect(() => {
    if (!enabled) return;
    const connector = createRealtimeConnector<RealtimeChannel, ReturnType<typeof setTimeout>>({
      client: supabase,
      topicPrefix: key,
      build: (channel, isCurrent) => buildRef.current(channel, isCurrent),
      onStatus: (status) => onStatusRef.current?.(status),
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (handle) => clearTimeout(handle),
    });
    connectorRef.current = connector;
    connector.connect();

    return () => {
      connector.dispose();
      if (connectorRef.current === connector) connectorRef.current = null;
    };
  }, [supabase, key, enabled]);

  const reconnect = useCallback(() => {
    connectorRef.current?.reconnect();
  }, []);

  return { reconnect };
}
