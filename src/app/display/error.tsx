'use client';

// The pub TV's error boundary (the lobby and /display/[sessionId]). The TV is
// unattended, so a render exception must never leave it on Next's error page:
// it shows a calm holding screen and gets itself back (src/hooks/use-error-recovery.ts).
// Every size is a TV token, so nothing is below the 32px / 22px floor.

import { tvText } from '@/components/display/tv-text';
import { useErrorRecovery } from '@/hooks/use-error-recovery';

interface DisplayErrorProps {
  error: unknown;
  retry: () => void;
}

export default function DisplayError({ error, retry }: DisplayErrorProps) {
  useErrorRecovery('display-error', error, retry);

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex h-screen flex-col items-center justify-center gap-5 bg-[var(--anchor-green)] px-10 text-center text-white"
    >
      <p className={tvText('xs', 'uppercase tracking-[0.2em] font-semibold text-white/85')}>Anchor Bingo Night</p>
      <h1 className={tvText('2xl', 'font-black')}>Reconnecting to the game…</h1>
      <p className={tvText('sm', 'text-white/90')}>Hold on to your tickets, the screen will be back in a moment.</p>
      <span className="inline-block h-[1.5vh] w-[1.5vh] min-h-3 min-w-3 animate-pulse rounded-full bg-white" />
    </div>
  );
}
