'use client';

// The phone follower's error boundary (/player/[sessionId]). A guest should
// never be left on Next's error page: this shows a calm holding card and gets
// itself back (src/hooks/use-error-recovery.ts).

import { RefreshCw } from 'lucide-react';
import { cardClass } from '@/components/ui/card';
import { useErrorRecovery } from '@/hooks/use-error-recovery';

interface PlayerErrorProps {
  error: unknown;
  retry: () => void;
}

export default function PlayerError({ error, retry }: PlayerErrorProps) {
  useErrorRecovery('player-error', error, retry);

  return (
    <div className="flex min-h-screen-safe items-center justify-center bg-anchor-green-deep p-4 text-anchor-cream-text">
      <div
        role="status"
        aria-live="polite"
        className={cardClass({ className: 'flex w-full max-w-md flex-col items-center gap-2 px-5 py-6 text-center' })}
      >
        <RefreshCw aria-hidden="true" size={36} strokeWidth={2} className="text-anchor-gold-bright" />
        <h1 className="text-[28px] leading-[1.05] text-anchor-cream-text">Reconnecting to the game…</h1>
        <p className="text-[15px] leading-normal text-anchor-sage">
          Hold on to your tickets, this screen will be back in a moment.
        </p>
      </div>
    </div>
  );
}
