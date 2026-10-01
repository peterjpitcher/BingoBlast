'use client';

// The pub TV's error boundary (the lobby and /display/[sessionId]). The TV is
// unattended, so a render exception must never leave it on Next's error page:
// it shows a calm holding screen and gets itself back (src/hooks/use-error-recovery.ts).
// Every size is a TV token, so nothing is below the 32px / 22px floor.

import { Grain } from '@/components/ui/logo';
import { TV_KICKER_CLASS, tvText } from '@/components/display/tv-text';
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
      className="relative flex h-screen flex-col items-center justify-center gap-[clamp(16px,2.6vh,40px)] bg-anchor-green-deep px-[5vw] text-center text-anchor-cream-text"
    >
      <Grain />
      <p className={TV_KICKER_CLASS}>Anchor Bingo Night</p>
      <h1 className={tvText('2xl')}>Reconnecting to the game…</h1>
      <p className={tvText('sm', 'font-medium')}>Hold on to your tickets, the screen will be back in a moment.</p>
    </div>
  );
}
