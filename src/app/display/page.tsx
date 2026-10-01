import React from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import { getTodayIsoDateInLondon } from '@/lib/dates';
import { getEventsProjection } from '@/lib/events-feed/projection';
import {
  CANDIDATE_SESSION_STATUSES,
  RESOLVABLE_SESSION_COLUMNS,
  displayPathFor,
  pickSessionsByIds,
  resolveDisplaySession,
} from '@/lib/session-resolution';
import { logError } from '@/lib/log-error';
import { DisplayLobby, type LobbySession } from '@/components/display/display-lobby';

interface DisplayIndexPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * The pub TV's home (spec 5.8, A3). It joins the one session that qualifies
 * (running, or ready and dated today or earlier in London); otherwise it shows
 * the idle loop of upcoming events (spec 5.5) or a list, both of which keep
 * checking by themselves.
 * `?rehearsal=1` also counts test sessions (A4).
 */
export default async function DisplayIndexPage({ searchParams }: DisplayIndexPageProps) {
  const params = await searchParams;
  const rehearsal = params.rehearsal === '1';
  // The idle loop's events (spec 5.5), read alongside the sessions. Cached,
  // and never throws.
  const eventsPromise = getEventsProjection();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('sessions')
    .select(RESOLVABLE_SESSION_COLUMNS)
    .in('status', CANDIDATE_SESSION_STATUSES)
    .order('start_date', { ascending: false })
    .returns<LobbySession[]>();

  if (error || !data) {
    // An outage is never shown as "no bingo tonight": the lobby retries.
    logError('display', error ?? new Error('Display lobby lookup returned nothing'));
    return <DisplayLobby initial={{ kind: 'error' }} rehearsal={rehearsal} initialEvents={await eventsPromise} />;
  }

  const resolution = resolveDisplaySession(data, getTodayIsoDateInLondon(), { includeTest: rehearsal });
  if (resolution.kind === 'one') {
    redirect(displayPathFor(resolution.id, { rehearsal }));
  }

  return (
    <DisplayLobby
      initial={
        resolution.kind === 'many'
          ? { kind: 'many', sessions: pickSessionsByIds(data, resolution.ids) }
          : { kind: 'none' }
      }
      rehearsal={rehearsal}
      initialEvents={await eventsPromise}
    />
  );
}
