// src/hooks/use-build-check.ts
//
// Checks GET /api/build every 5 minutes and whenever the page becomes visible,
// and acts on src/lib/build-check.ts:
//   - mode 'auto' (TV, phone): reloads by itself once it is safe, and online;
//   - mode 'prompt' (host): never reloads, returns showPrompt for a banner.
'use client';

import { useCallback, useEffect, useState } from 'react';
import { decideBuildAction, DEV_BUILD_ID, type BuildAction, type BuildCheckMode } from '@/lib/build-check';

export const BUILD_CHECK_INTERVAL_MS = 5 * 60 * 1000;
const BUILD_CHECK_TIMEOUT_MS = 8000;
// After the connection comes back, how long to wait before a reload that was
// held back while offline. A network that has only just returned often drops
// again within a second or two.
const ONLINE_SETTLE_MS = 3000;
// Remembers which release this tab already reloaded for. If the reload still
// comes back on the old bundle (a stale cache in front of the page), the tab
// does not reload again for that same release every five minutes.
const RELOADED_FOR_KEY = 'anchor-bingo:build-reloaded-for';

// Inlined at build time by next.config.ts. Referenced literally so the bundler
// can replace it.
const CLIENT_BUILD = process.env.NEXT_PUBLIC_BUILD_ID || DEV_BUILD_ID;

export interface UseBuildCheckOptions {
  mode: BuildCheckMode;
  /** TV and phone: isPublicReloadSafe(). Host: no claim open. */
  safe: boolean;
}

export interface UseBuildCheckApi {
  action: BuildAction;
  /** Host only: show "A new version is ready" with a Reload button. */
  showPrompt: boolean;
  reload: () => void;
}

async function fetchServerBuild(): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BUILD_CHECK_TIMEOUT_MS);
  try {
    const response = await fetch('/api/build', { cache: 'no-store', signal: controller.signal });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    const build = (body as { build?: unknown } | null)?.build;
    return typeof build === 'string' ? build : null;
  } catch {
    // Offline or timed out: the next check will try again.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function claimAutoReload(serverBuild: string): boolean {
  try {
    if (window.sessionStorage.getItem(RELOADED_FOR_KEY) === serverBuild) return false;
    window.sessionStorage.setItem(RELOADED_FOR_KEY, serverBuild);
  } catch {
    // Storage unavailable: allow the reload. The check only runs every five
    // minutes, so the worst case is bounded.
  }
  return true;
}

export function useBuildCheck({ mode, safe }: UseBuildCheckOptions): UseBuildCheckApi {
  const [serverBuild, setServerBuild] = useState<string | null>(null);

  useEffect(() => {
    // A local build can never be told to reload, so do not even ask.
    if (CLIENT_BUILD === DEV_BUILD_ID) return;

    let cancelled = false;
    const check = async () => {
      const build = await fetchServerBuild();
      if (!cancelled && build) setServerBuild(build);
    };

    void check();
    const interval = setInterval(() => {
      void check();
    }, BUILD_CHECK_INTERVAL_MS);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void check();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  const action = decideBuildAction({ clientBuild: CLIENT_BUILD, serverBuild, mode, safe });

  useEffect(() => {
    if (action !== 'reload' || !serverBuild) return;
    const reloadNow = () => {
      if (!claimAutoReload(serverBuild)) return;
      window.location.reload();
    };
    // Reloading with no network lands on the browser's offline page, which on
    // an unattended TV stays up until somebody walks over to it. So wait for
    // the connection to come back, give it a moment to settle, and reload
    // then. Nothing else would retry: the next check reports the same release,
    // which changes no state. If the moment stops being safe first, this
    // effect is cleaned up and the listener and timer go with it.
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      let settleTimer: ReturnType<typeof setTimeout> | null = null;
      const onOnline = () => {
        if (settleTimer !== null) clearTimeout(settleTimer);
        settleTimer = setTimeout(() => {
          settleTimer = null;
          if (navigator.onLine) reloadNow();
        }, ONLINE_SETTLE_MS);
      };
      window.addEventListener('online', onOnline);
      return () => {
        window.removeEventListener('online', onOnline);
        if (settleTimer !== null) clearTimeout(settleTimer);
      };
    }
    reloadNow();
  }, [action, serverBuild]);

  const reload = useCallback(() => {
    window.location.reload();
  }, []);

  return { action, showPrompt: action === 'prompt', reload };
}
