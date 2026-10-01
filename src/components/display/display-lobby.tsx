// src/components/display/display-lobby.tsx
//
// /display when there is not exactly one session to join (spec 5.8, A3). The
// server page redirects straight to a single qualifying session; this covers
// the rest and keeps checking, so a TV left on /display joins the night by
// itself:
//   - none:  the idle loop (spec 5.5: "Bingo nights at The Anchor", the next
//            bingo night and the upcoming events), re-checked every 60 seconds;
//   - many:  a list for staff to choose from, refreshed every 30 seconds;
//   - error: a retrying screen, re-checked every 15 seconds.
// A failed re-check keeps the last good screen rather than flashing an error.
'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';
import { cn } from '@/lib/utils';
import { formatDateInLondon, getTodayIsoDateInLondon } from '@/lib/dates';
import {
  CANDIDATE_SESSION_STATUSES,
  RESOLVABLE_SESSION_COLUMNS,
  displayPathFor,
  pickSessionsByIds,
  resolveDisplaySession,
  type ResolvableSession,
} from '@/lib/session-resolution';
import { logError } from '@/lib/log-error';
import { buildPlaylist, type EventsProjection, type Slide } from '@/lib/playlist';
import { useBuildCheck } from '@/hooks/use-build-check';
import { useWakeLock } from '@/hooks/wake-lock';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PromoSlide, SlidePreload } from './promo-slide';
import { useMinuteClock } from './screen-hooks';
import { SlideLoop } from './slide-loop';
import { TV_TEXT_BODY, TV_TEXT_TITLE } from './tv-text';
import { useEventsProjection } from './use-events-projection';

export interface LobbySession extends ResolvableSession {
  name: string;
}

export type LobbyState =
  | { kind: 'none' }
  | { kind: 'many'; sessions: LobbySession[] }
  | { kind: 'error' };

const RECHECK_MS: Record<LobbyState['kind'], number> = {
  none: 60_000,
  many: 30_000,
  error: 15_000,
};

interface DisplayLobbyProps {
  initial: LobbyState;
  rehearsal: boolean;
  /** The upcoming events as the server page read them (getEventsProjection); refreshed here. */
  initialEvents: EventsProjection | null;
}

export function DisplayLobby({ initial, rehearsal, initialEvents }: DisplayLobbyProps) {
  const [supabase] = useState(createClient);
  const [state, setState] = useState<LobbyState>(initial);
  const router = useRouter();

  // A TV can sit here for days: keep it awake and on the current release.
  useWakeLock();
  useBuildCheck({ mode: 'auto', safe: true });

  const delayMs = RECHECK_MS[state.kind];

  // The idle loop: refreshed every 10 minutes, never shown as an error. The
  // idle screen has no session of its own, so tonight's bingo night counts
  // as the next one until a session for it is ready.
  const events = useEventsProjection(initialEvents, { refreshKey: 'idle', logScope: 'display' });
  const minuteMs = useMinuteClock();
  const idlePlaylist = useMemo(() => buildPlaylist('idle', events, new Date(minuteMs), null), [events, minuteMs]);
  const renderIdleSlide = (slide: Slide) => (
    <>
      <SlidePreload slide={slide} nowMs={minuteMs} />
      <PromoSlide slide={slide} nowMs={minuteMs} />
    </>
  );

  useEffect(() => {
    let cancelled = false;
    const recheck = async () => {
      const { data, error } = await supabase
        .from('sessions')
        .select(RESOLVABLE_SESSION_COLUMNS)
        .in('status', CANDIDATE_SESSION_STATUSES)
        .order('start_date', { ascending: false })
        .returns<LobbySession[]>();
      if (cancelled) return;
      if (error || !data) {
        logError('display', error ?? new Error('Display lobby lookup returned nothing'));
        return;
      }
      const resolution = resolveDisplaySession(data, getTodayIsoDateInLondon(), { includeTest: rehearsal });
      if (resolution.kind === 'one') {
        router.replace(displayPathFor(resolution.id, { rehearsal }));
      } else if (resolution.kind === 'none') {
        setState({ kind: 'none' });
      } else {
        setState({ kind: 'many', sessions: pickSessionsByIds(data, resolution.ids) });
      }
    };
    const run = () => {
      recheck().catch((err) => {
        if (!cancelled) logError('display', err);
      });
    };
    const interval = setInterval(run, delayMs);
    const onVisible = () => {
      if (document.visibilityState === 'visible') run();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [supabase, delayMs, rehearsal, router]);

  if (state.kind === 'many') {
    return (
      <div className="min-h-screen-safe flex flex-col items-center justify-center p-4 bg-slate-950 text-white">
        <h1 className="mb-8 text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-bingo-primary to-bingo-secondary">
          Anchor Bingo
        </h1>
        <Card className="w-full max-w-md bg-slate-900 border-slate-800">
          <CardHeader>
            <CardTitle className="text-center text-slate-400 text-lg uppercase tracking-widest">Select Active Game</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {state.sessions.map((session) => (
                <Link key={session.id} href={displayPathFor(session.id, { rehearsal })} className="block">
                  <div className="flex items-center justify-between p-4 rounded-lg bg-slate-800 border border-slate-700 hover:border-bingo-primary hover:bg-slate-800/80 transition-all cursor-pointer group">
                    <div>
                      <h5 className="font-bold text-lg group-hover:text-bingo-primary transition-colors">
                        {session.name}
                        {session.is_test_session && <span className="ml-2 text-sm font-semibold text-yellow-400">(test)</span>}
                      </h5>
                      <p className="text-sm text-slate-400">{formatDateInLondon(session.start_date)}</p>
                    </div>
                    <span
                      className={cn(
                        'px-2.5 py-0.5 rounded-full text-xs font-bold border',
                        session.status === 'running'
                          ? 'bg-green-900/30 text-green-400 border-green-800'
                          : 'bg-yellow-900/30 text-yellow-400 border-yellow-800'
                      )}
                    >
                      {session.status.toUpperCase()}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (state.kind === 'error') {
    return (
      <div
        className="flex h-screen flex-col items-center justify-center gap-[4vh] px-[6vw] text-center text-white"
        style={{ backgroundColor: '#005131' }}
        role="status"
        aria-live="polite"
      >
        <div className="relative h-[16vh] w-[60vh] max-w-full">
          <Image src="/the-anchor-pub-logo-white-transparent.png" alt="The Anchor" fill className="object-contain" priority />
        </div>
        <h1 className={cn(TV_TEXT_TITLE, 'font-black uppercase tracking-[0.06em]')}>Reconnecting</h1>
        <p className={cn(TV_TEXT_BODY, 'text-white/90')}>Trying again in a moment.</p>
      </div>
    );
  }

  // No session to join: the idle loop under the logo. The loop area is what
  // is left of the screen, so the slides size against it as on the session TV.
  return (
    <div className="flex h-screen flex-col overflow-hidden text-white" style={{ backgroundColor: '#005131' }}>
      <div className="flex shrink-0 justify-center pt-[3vh]">
        <div className="relative h-[12vh] w-[45vh] max-w-full">
          <Image src="/the-anchor-pub-logo-white-transparent.png" alt="The Anchor" fill className="object-contain" priority />
        </div>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center px-[4vw] pb-[4vh] pt-[2vh]">
        <SlideLoop className="h-full w-full" slides={idlePlaylist} renderSlide={renderIdleSlide} />
      </div>
    </div>
  );
}
