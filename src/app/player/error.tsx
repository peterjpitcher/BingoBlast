'use client';

// The phone follower's error boundary (/player/[sessionId]). A guest should
// never be left on Next's error page: this shows a calm holding card and gets
// itself back (src/hooks/use-error-recovery.ts).

import { useErrorRecovery } from '@/hooks/use-error-recovery';

interface PlayerErrorProps {
  error: unknown;
  retry: () => void;
}

export default function PlayerError({ error, retry }: PlayerErrorProps) {
  useErrorRecovery('player-error', error, retry);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--anchor-green)] p-6 text-white">
      <div
        role="status"
        aria-live="polite"
        className="w-full max-w-sm rounded-xl border border-[var(--anchor-border)] bg-[var(--anchor-green-dark)] p-6 text-center"
      >
        <h1 className="text-xl font-bold text-white">Reconnecting to the game…</h1>
        <p className="mt-1 text-base text-white">Hold on to your tickets, this screen will be back in a moment.</p>
        <span className="mt-4 inline-block h-2 w-2 animate-pulse rounded-full bg-white" />
      </div>
    </div>
  );
}
