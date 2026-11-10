import React from 'react';
import type { Metadata } from 'next';
import { isRehearsalRequest, TvPageShell } from '@anchor-nights/kit/pairing';
import DisplayUI from '@/app/display/[sessionId]/display-ui';
import { loadDisplay } from '@/app/display/[sessionId]/load-display';
import { DisplayLobby } from '@/components/display/display-lobby';
import { getEventsFeed } from '@/lib/events-feed';
import { resolveTvPageView } from '@/lib/tv-pairing';

export const metadata: Metadata = { title: 'Pub TV', robots: { index: false } };

// Per request, never cached: the device cookie decides what this shows.
export const dynamic = 'force-dynamic';

interface TvPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * The paired pub TV (spec S3.1, S3.2, row C-6). Unpaired, it shows a 6-digit
 * code for a host to type into the host console. Paired, it finds tonight's
 * session by itself (src/lib/tv-tonight.ts, the same rule as /display) and
 * draws exactly the /display screen for it, or the idle loop when there is
 * none. An outage shows "Reconnecting" and retries: never a game, never a code.
 * /display stays public and unchanged; the per-session links keep working.
 */
export default async function TvPage({ searchParams }: TvPageProps) {
  const rehearsal = isRehearsalRequest(await searchParams);
  const view = await resolveTvPageView(rehearsal);

  return (
    <TvPageShell
      view={view}
      pairing={{ appName: 'Anchor Bingo' }}
      renderGame={(game) => <TvSession sessionId={game.id} rehearsal={rehearsal} />}
      renderIdle={() => <TvIdle rehearsal={rehearsal} />}
    />
  );
}

/** Tonight's session, drawn by the same loader and screen as /display/[sessionId]. */
async function TvSession({ sessionId, rehearsal }: { sessionId: string; rehearsal: boolean }) {
  const loaded = await loadDisplay(sessionId, { rehearsal, tv: true });
  // Deleted between the lookup and this read: the idle loop, never a 404 page
  // (a static 404 has no poll and would strand the TV for the night).
  if (loaded.kind === 'not_found') return <TvIdle rehearsal={rehearsal} />;
  return <DisplayUI {...loaded.props} />;
}

/** No session tonight: /display's idle loop, which re-renders /tv once one qualifies. */
async function TvIdle({ rehearsal }: { rehearsal: boolean }) {
  return <DisplayLobby initial={{ kind: 'none' }} rehearsal={rehearsal} initialEvents={await getEventsFeed()} tv />;
}
