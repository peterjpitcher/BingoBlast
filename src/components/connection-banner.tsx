// src/components/connection-banner.tsx
'use client';
import { useEffect } from 'react';

interface ConnectionBannerProps {
  visible: boolean;
  shouldAutoRefresh: boolean;
}

export function ConnectionBanner({ visible, shouldAutoRefresh }: ConnectionBannerProps) {
  useEffect(() => {
    if (shouldAutoRefresh) {
      window.location.reload();
    }
  }, [shouldAutoRefresh]);

  if (!visible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed top-2 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-full bg-amber-500/90 px-4 py-2 text-sm text-white shadow"
    >
      <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-white" />
      <span>Reconnecting…</span>
      <button
        type="button"
        className="ml-2 rounded bg-white/20 px-2 py-1 text-xs hover:bg-white/30"
        onClick={() => window.location.reload()}
      >
        Refresh
      </button>
    </div>
  );
}
