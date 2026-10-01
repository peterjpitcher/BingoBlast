// src/components/display/screen-hooks.ts
//
// Small browser subscriptions for the public screens, read through
// useSyncExternalStore so render stays pure and no effect sets state.
'use client';

import { useSyncExternalStore } from 'react';

function subscribeVisibility(onChange: () => void): () => void {
  document.addEventListener('visibilitychange', onChange);
  return () => document.removeEventListener('visibilitychange', onChange);
}

/** True while the page is visible. The server render assumes visible. */
export function useDocumentVisible(): boolean {
  return useSyncExternalStore(
    subscribeVisibility,
    () => document.visibilityState === 'visible',
    () => true
  );
}

const MINUTE_MS = 60_000;

function subscribeMinute(onChange: () => void): () => void {
  const timer = setInterval(onChange, MINUTE_MS);
  return () => clearInterval(timer);
}

/**
 * The current time, floored to the minute, as epoch milliseconds: enough for
 * playlists and labels, and stable between renders within a minute. 0 during
 * the server render.
 */
export function useMinuteClock(): number {
  return useSyncExternalStore(
    subscribeMinute,
    () => Math.floor(Date.now() / MINUTE_MS) * MINUTE_MS,
    () => 0
  );
}

function subscribeNothing(): () => void {
  return () => {};
}

/** The page's own origin in the browser, '' during the server render. */
export function useWindowOrigin(): string {
  return useSyncExternalStore(
    subscribeNothing,
    () => window.location.origin,
    () => ''
  );
}
