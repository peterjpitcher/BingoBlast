// src/components/connection-banner.tsx
'use client';
import { useEffect, useState } from 'react';

interface ConnectionBannerProps {
  visible: boolean;
  shouldAutoRefresh: boolean;
  /**
   * Set while the surface is holding state a reload would destroy: a host modal
   * that is open, numbers already tapped into a claim, a request in flight.
   * The auto-reload is skipped entirely while this is true, and the manual
   * Refresh button asks first.
   */
  hasUnsavedWork?: boolean;
}

/**
 * The "Reconnecting" banner, and the auto-reload of last resort.
 *
 * WHY THE RELOAD IS GATED
 *   This used to call window.location.reload() unconditionally as soon as the
 *   connection had been unhealthy for thirty seconds. Two things went wrong with
 *   that on a real night:
 *
 *   1. When the wifi drops, the device has no network, so the reload lands on
 *      the browser's offline page. The pub TV at the back of the room shows a
 *      Chrome error instead of the last ball, and stays that way until somebody
 *      physically walks over to it. Without the reload, every surface would have
 *      kept its last good render and recovered by itself: the three second poll
 *      and the realtime exponential backoff already do that.
 *
 *   2. On the host device the reload threw away whatever was on screen,
 *      including a claim the host was halfway through typing in.
 *
 *   So the reload now requires the browser to believe it is online, and requires
 *   the surface to say it is not holding anything. It is the last resort it was
 *   always meant to be, not the thirty second default.
 *
 *   navigator.onLine is a weak signal (it reports the link, not reachability),
 *   which is exactly right here: it is reliable when it says false, and false is
 *   the only answer that changes the behaviour.
 */
export function ConnectionBanner({ visible, shouldAutoRefresh, hasUnsavedWork = false }: ConnectionBannerProps) {
  const [isOffline, setIsOffline] = useState(false);

  useEffect(() => {
    const sync = () => setIsOffline(!navigator.onLine);
    sync();
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    return () => {
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
    };
  }, []);

  useEffect(() => {
    if (!shouldAutoRefresh) return;
    // Read navigator.onLine at the moment of the decision rather than trusting
    // the state, which may not have re-rendered yet.
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    if (hasUnsavedWork) return;
    window.location.reload();
  }, [shouldAutoRefresh, hasUnsavedWork]);

  if (!visible) return null;

  const handleManualRefresh = () => {
    if (hasUnsavedWork && !window.confirm('Reloading will clear what is on screen, including any numbers you have tapped in. Reload anyway?')) {
      return;
    }
    window.location.reload();
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed top-2 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-full bg-amber-500/90 px-4 py-2 text-sm text-white shadow"
    >
      <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-white" />
      <span>{isOffline ? 'No connection. Waiting to reconnect…' : 'Reconnecting…'}</span>
      <button
        type="button"
        className="ml-2 rounded bg-white/20 px-2 py-1 text-xs hover:bg-white/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
        onClick={handleManualRefresh}
      >
        Refresh
      </button>
    </div>
  );
}
