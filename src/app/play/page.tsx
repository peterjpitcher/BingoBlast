import React from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import { formatDateInLondon, getTodayIsoDateInLondon } from '@/lib/dates';
import { isUuid } from '@/lib/utils';
import {
  CANDIDATE_SESSION_STATUSES,
  RESOLVABLE_SESSION_COLUMNS,
  pickSessionsByIds,
  resolveDisplaySession,
  type ResolvableSession,
} from '@/lib/session-resolution';
import { logError } from '@/lib/log-error';
import { getEventsProjection } from '@/lib/events-feed/projection';
import type { EventsProjection } from '@/lib/playlist';
import { PhoneEvents } from '@/components/display/phone-events';

interface PlayPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** RESOLVABLE_SESSION_COLUMNS also reads the name, for the list of games. */
interface PlaySession extends ResolvableSession {
  name: string;
}

/**
 * The permanent follow-along link behind the TV's QR code (spec 5.4). Public,
 * and deliberately not in the proxy matcher, so a phone scanning it costs no
 * auth round trip.
 *
 * - `?s=<uuid>`: the phone follows that session. Only a well-formed uuid is
 *   ever put in the redirect, and only to /player on this site, so this can
 *   never become an open redirect. If the lookup itself fails, the phone is
 *   still sent there: the player page recovers from an outage, and 404s a
 *   session that does not exist.
 * - Otherwise the session rule the TV uses (A3): exactly one qualifying
 *   session redirects to it; several are listed, running first, each linking
 *   to /play?s=<id>; none shows "No bingo running right now". The upcoming
 *   events sit under either (spec 5.5).
 */
export default async function PlayPage({ searchParams }: PlayPageProps) {
  const params = await searchParams;
  const requested = typeof params.s === 'string' ? params.s.trim() : '';
  const supabase = await createClient();

  if (requested && isUuid(requested)) {
    const { data, error } = await supabase
      .from('sessions')
      .select('id')
      .eq('id', requested)
      .maybeSingle<{ id: string }>();
    if (error) logError('play', error);
    if (data || error) redirect(`/player/${requested}`);
  }

  // Read alongside the sessions; cached, and never throws.
  const eventsPromise = getEventsProjection();

  const { data: sessions, error: sessionsError } = await supabase
    .from('sessions')
    .select(RESOLVABLE_SESSION_COLUMNS)
    .in('status', CANDIDATE_SESSION_STATUSES)
    .order('start_date', { ascending: false })
    .returns<PlaySession[]>();

  if (sessionsError || !sessions) {
    logError('play', sessionsError ?? new Error('Play lookup returned nothing'));
    return (
      <PlayMessage
        title="We could not check for a game just now"
        body="Please try again in a moment."
        retry
      />
    );
  }

  const resolution = resolveDisplaySession(sessions, getTodayIsoDateInLondon(), { includeTest: false });
  if (resolution.kind === 'one') {
    redirect(`/player/${resolution.id}`);
  }

  if (resolution.kind === 'many') {
    const choices = pickSessionsByIds(sessions, resolution.ids);
    return (
      <PlayMessage
        title="Which bingo are you at?"
        body="More than one game is on. Tap yours to follow it."
        events={await eventsPromise}
      >
        <ul className="mt-4 space-y-2 text-left">
          {choices.map((session) => (
            <li key={session.id}>
              <Link
                href={`/play?s=${encodeURIComponent(session.id)}`}
                className="flex min-h-[44px] flex-col justify-center rounded-md border border-[var(--anchor-border)] px-4 py-2 text-white hover:bg-[var(--anchor-green-soft)]"
              >
                <span className="text-base font-semibold">{session.name}</span>
                {session.start_date && (
                  <span className="text-sm text-white/85">{formatDateInLondon(session.start_date)}</span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      </PlayMessage>
    );
  }

  return <PlayMessage title="No bingo running right now" events={await eventsPromise} />;
}

interface PlayMessageProps {
  title: string;
  body?: string;
  retry?: boolean;
  /** Listed under the message, next bingo night first; links to the post-event pages, as on the idle TV. */
  events?: EventsProjection | null;
  /** Inside the card, under the message (the list of games). */
  children?: React.ReactNode;
}

function PlayMessage({ title, body, retry = false, events = null, children }: PlayMessageProps) {
  return (
    <main
      className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-white"
      style={{ backgroundColor: '#005131' }}
    >
      <div
        className="w-full max-w-sm rounded-xl border border-[#1f7c58] bg-[#003f27] p-6 text-center"
        role={retry ? 'alert' : undefined}
      >
        <h1 className="text-xl font-bold text-white">{title}</h1>
        {body && <p className="mt-2 text-base text-white">{body}</p>}
        {children}
        {retry && (
          <Link
            href="/play"
            className="mt-4 inline-flex min-h-[44px] items-center justify-center rounded-md border border-[#a57626] px-5 text-base font-semibold text-white hover:bg-[#0f6846]"
          >
            Try again
          </Link>
        )}
      </div>
      {events && <PhoneEvents projection={events} sessionDate={null} phase="idle" className="w-full max-w-sm" />}
    </main>
  );
}
