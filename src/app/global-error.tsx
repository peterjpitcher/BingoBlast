'use client';

// The last-resort boundary, for an error in the root layout itself, where the
// segment boundaries cannot help. It replaces the whole document, so it brings
// its own <html>, <body> and stylesheet. The TV and the phones are unattended,
// so it recovers by itself like the others (src/hooks/use-error-recovery.ts).
// Sizes stay at or above the TV floor (22px on a 720p screen), since this can
// be what the pub TV shows.

import './globals.css';
import { useErrorRecovery } from '@/hooks/use-error-recovery';

interface GlobalErrorProps {
  error: unknown;
  retry: () => void;
}

export default function GlobalError({ error, retry }: GlobalErrorProps) {
  useErrorRecovery('global-error', error, retry);

  return (
    <html lang="en">
      <body>
        <title>Anchor Bingo</title>
        <main
          role="status"
          aria-live="polite"
          className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[var(--anchor-green)] p-6 text-center text-white"
        >
          <h1 className="text-[clamp(30px,4.1vh,44px)] font-bold">Reconnecting…</h1>
          <p className="text-[clamp(22px,3vh,32px)]">This page will be back in a moment.</p>
        </main>
      </body>
    </html>
  );
}
