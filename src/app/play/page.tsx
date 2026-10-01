import React from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ChevronRight } from 'lucide-react';
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
import { buttonClass } from '@/components/ui/button';
import { cardClass } from '@/components/ui/card';
import { Kicker } from '@/components/ui/kicker';
import { AnchorLogo } from '@/components/ui/logo';

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
        <ul className="mt-2 flex w-full flex-col gap-2 text-left">
          {choices.map((session) => (
            <li key={session.id}>
              <Link
                href={`/play?s=${encodeURIComponent(session.id)}`}
                className="flex min-h-14 items-center gap-3 rounded-card border border-line bg-anchor-green-raised px-4 py-2.5 transition-colors duration-150 hover:border-line-strong"
              >
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="font-display text-[20px] leading-[1.1] text-anchor-cream-text">{session.name}</span>
                  {session.start_date && (
                    <span className="text-sm text-anchor-sage">{formatDateInLondon(session.start_date)}</span>
                  )}
                </span>
                <ChevronRight aria-hidden="true" size={20} strokeWidth={2} className="shrink-0 text-anchor-gold-bright" />
              </Link>
            </li>
          ))}
        </ul>
      </PlayMessage>
    );
  }

  return (
    <PlayMessage
      title="No bingo running right now"
      body="Come back on the night and this page follows the numbers live."
      events={await eventsPromise}
    />
  );
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

/**
 * The /play page when it does not redirect: the wordmark, one accent card with
 * the message, then what is coming up. Top aligned in a phone-width column.
 */
function PlayMessage({ title, body, retry = false, events = null, children }: PlayMessageProps) {
  return (
    <main className="mx-auto flex min-h-screen-safe w-full max-w-md flex-col gap-4 bg-anchor-green-deep px-4 pb-10 pt-[calc(env(safe-area-inset-top)+16px)] text-anchor-cream-text">
      <div className="flex justify-center">
        <AnchorLogo height={64} priority />
      </div>
      <div
        className={cardClass({ accent: true, className: 'flex flex-col items-center gap-2 px-5 py-6 text-center' })}
        role={retry ? 'alert' : undefined}
      >
        <Kicker>Anchor Bingo</Kicker>
        <h1 className="text-[30px] leading-[1.05] text-anchor-cream-text">{title}</h1>
        {body && <p className="text-[15px] leading-normal text-anchor-sage">{body}</p>}
        {children}
        {retry && (
          <Link href="/play" className={buttonClass({ variant: 'outline', size: 'md', className: 'mt-2' })}>
            Try again
          </Link>
        )}
      </div>
      {events && <PhoneEvents projection={events} sessionDate={null} phase="idle" className="w-full" />}
    </main>
  );
}
