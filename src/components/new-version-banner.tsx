// src/components/new-version-banner.tsx
'use client';

import { Button } from '@/components/ui/button';

interface NewVersionBannerProps {
  visible: boolean;
  onReload: () => void;
}

/**
 * Host only. The host screen never reloads by itself (a reload mid-claim would
 * throw away what the host has tapped in), so a new release is offered here
 * instead, and the caller holds it back while a claim is open.
 */
export function NewVersionBanner({ visible, onReload }: NewVersionBannerProps) {
  if (!visible) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="mb-4 rounded-xl border border-[#a57626] bg-[#005131]/90 p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
    >
      <p className="font-bold text-white">A new version is ready</p>
      <Button variant="primary" size="lg" className="min-h-[48px] shrink-0" onClick={onReload}>
        Reload
      </Button>
    </div>
  );
}
