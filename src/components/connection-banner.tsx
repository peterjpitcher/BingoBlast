// src/components/connection-banner.tsx
'use client';
import { useEffect, useState } from 'react';
import { tvText } from '@/components/display/tv-text';

interface ConnectionBannerProps {
  visible: boolean;
  shouldAutoRefresh: boolean;
  /**
   * 'tv' sizes the banner for the pub TV's text floors (spec 5.7); the
   * default suits the phone and the host screen.
   */
  variant?: 'default' | 'tv';
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
export function ConnectionBanner({ visible, shouldAutoRefresh, hasUnsavedWork = false, variant = 'default' }: ConnectionBannerProps) {
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

  // Dark text on solid amber (about 8:1), where white on 90 percent amber was
  // about 2:1. The Refresh target is at least 44px tall.
  const barClass =
    'fixed top-2 left-1/2 -translate-x-1/2 z-50 flex max-w-[calc(100vw-1rem)] items-center gap-3 rounded-full bg-amber-500 px-4 py-1 font-semibold text-bingo-dark shadow';
  const buttonClass =
    'ml-2 min-h-11 shrink-0 rounded-full bg-white/40 px-4 font-bold text-bingo-dark hover:bg-white/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bingo-dark';

  return (
    <div
      role="status"
      aria-live="polite"
      className={variant === 'tv' ? tvText('xs', barClass, 'px-[1em]') : `${barClass} text-base`}
    >
      <span className="inline-block h-[0.5em] w-[0.5em] shrink-0 animate-pulse rounded-full bg-current" />
      <span>{isOffline ? 'No connection. Waiting to reconnect…' : 'Reconnecting…'}</span>
      <button
        type="button"
        className={variant === 'tv' ? tvText('xs', buttonClass, 'px-[0.8em]') : `${buttonClass} text-base`}
        onClick={handleManualRefresh}
      >
        Refresh
      </button>
    </div>
  );
}
