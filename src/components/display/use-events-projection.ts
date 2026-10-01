// src/components/display/use-events-projection.ts
//
// Keeps a pub TV's events list fresh (spec 5.5). The server page passes the
// first projection in; this re-reads GET /api/screen/events every 10 minutes
// and whenever `refreshKey` changes (the TV passes its phase of the night).
//
// Nothing here is ever shown: a failed refresh is logged and the TV keeps the
// list it has, and an 'error' answer never replaces a good list
// (chooseEventsProjection). The route takes no parameters and is cached by the
// CDN, so a room full of screens cannot add load on the management app.
'use client';

import { useEffect, useRef, useState } from 'react';
import { chooseEventsProjection, readEventsProjection, type EventsProjection } from '@/lib/playlist';
import { logError } from '@/lib/log-error';

export const EVENTS_REFRESH_MS = 10 * 60_000;
const EVENTS_REQUEST_TIMEOUT_MS = 8_000;
const EVENTS_PATH = '/api/screen/events';

async function fetchEventsProjection(signal: AbortSignal): Promise<EventsProjection> {
  const response = await fetch(EVENTS_PATH, { signal });
  if (!response.ok) throw new Error(`GET ${EVENTS_PATH} answered ${response.status}`);
  const projection = readEventsProjection(await response.json());
  if (!projection) throw new Error(`GET ${EVENTS_PATH} returned no projection`);
  return projection;
}

export interface UseEventsProjectionOptions {
  /** A change refetches straight away, for example the phase of the night. */
  refreshKey: string;
  logScope: string;
}

export function useEventsProjection(
  initial: EventsProjection | null,
  { refreshKey, logScope }: UseEventsProjectionOptions
): EventsProjection | null {
  const [projection, setProjection] = useState<EventsProjection | null>(initial);
  // The server page's projection is fresh on mount, so the first run does not
  // refetch it. Without one, the first run fetches straight away.
  const skipNextRunRef = useRef(initial !== null);

  useEffect(() => {
    let cancelled = false;
    const inFlight = new Set<AbortController>();

    const refresh = () => {
      const controller = new AbortController();
      inFlight.add(controller);
      const timer = setTimeout(() => controller.abort(), EVENTS_REQUEST_TIMEOUT_MS);
      fetchEventsProjection(controller.signal)
        .then((next) => {
          if (!cancelled) setProjection((current) => chooseEventsProjection(current, next));
        })
        .catch((err: unknown) => {
          if (!cancelled) logError(logScope, err);
        })
        .finally(() => {
          clearTimeout(timer);
          inFlight.delete(controller);
        });
    };

    if (skipNextRunRef.current) skipNextRunRef.current = false;
    else refresh();
    const interval = setInterval(refresh, EVENTS_REFRESH_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
      inFlight.forEach((controller) => controller.abort());
    };
  }, [refreshKey, logScope]);

  return projection;
}
