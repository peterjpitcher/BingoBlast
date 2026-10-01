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
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';
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
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { AnchorLogo, Grain } from '@/components/ui/logo';
import { PromoSlide, SlidePreload } from './promo-slide';
import { useMinuteClock } from './screen-hooks';
import { SlideLoop } from './slide-loop';
import { TV_KICKER_CLASS, TV_SIZE, tvText } from './tv-text';
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
      <div className="relative flex min-h-screen-safe flex-col items-center justify-center gap-[clamp(18px,3vh,40px)] bg-anchor-green-deep px-[5vw] py-[4vh] text-anchor-cream-text">
        <Grain />
        <AnchorLogo height={120} priority className="h-[clamp(64px,9vh,120px)]" />
        <div className="text-center">
          <p className={TV_KICKER_CLASS}>Anchor Bingo</p>
          <h1 className={tvText('xl')}>Select active game</h1>
        </div>
        <Card accent className="w-full max-w-[1200px] p-[clamp(14px,2.2vh,28px)]">
          <ul className="flex flex-col gap-[clamp(8px,1.2vh,16px)]">
            {state.sessions.map((session) => (
              <li key={session.id}>
                <Link
                  href={displayPathFor(session.id, { rehearsal })}
                  className="flex items-center justify-between gap-[2vw] rounded-card border border-line bg-anchor-green-raised px-[clamp(16px,1.7vw,32px)] py-[clamp(10px,1.6vh,20px)] transition-colors duration-150 ease-anchor hover:border-anchor-gold-bright"
                >
                  <div className="min-w-0">
                    <h2 className={tvText('lg', 'leading-[1.15]')}>
                      {session.name}
                      {session.is_test_session && (
                        <Badge className={tvText('xs', 'ml-[0.5em] px-[0.6em] py-[0.15em] align-middle')}>Test</Badge>
                      )}
                    </h2>
                    <p className={tvText('xs', 'text-anchor-sage')}>{formatDateInLondon(session.start_date)}</p>
                  </div>
                  <Badge
                    variant={session.status === 'running' ? 'success' : 'outline'}
                    dot={session.status === 'running'}
                    className={tvText('xs', 'shrink-0 px-[0.6em] py-[0.15em]')}
                  >
                    {session.status}
                  </Badge>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    );
  }

  if (state.kind === 'error') {
    return (
      <div
        className="relative flex h-screen flex-col items-center justify-center gap-[clamp(16px,2.6vh,40px)] bg-anchor-green-deep px-[6vw] text-center text-anchor-cream-text"
        role="status"
        aria-live="polite"
      >
        <Grain />
        <AnchorLogo height={120} priority className="h-[clamp(80px,11.1vh,120px)]" />
        <h1 className={tvText('2xl')}>Reconnecting</h1>
        <p className={tvText('sm', 'font-medium')}>Trying again in a moment.</p>
      </div>
    );
  }

  // No session to join: the idle loop under the logo, with the brand line at
  // the foot of the screen. The loop area is what is left between them, so the
  // slides size against it as on the session TV: about 790px at 1080p and
  // 525px at 720p (the bottom padding is the brand line's height plus its
  // 28px offset and a little air).
  return (
    <div className="relative flex h-screen flex-col overflow-hidden bg-anchor-green-deep text-anchor-cream-text">
      <Grain />
      <div className="flex shrink-0 justify-center pt-[clamp(24px,3.7vh,40px)]">
        <AnchorLogo height={120} priority className="h-[clamp(80px,11.1vh,120px)]" />
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center px-[5vw] pb-[clamp(72px,10vh,108px)] pt-[clamp(14px,2.2vh,24px)]">
        <SlideLoop className="h-full w-full" slides={idlePlaylist} renderSlide={renderIdleSlide} />
      </div>
      <p
        className={cn(
          TV_SIZE.callout,
          'absolute inset-x-0 bottom-[clamp(18px,2.6vh,28px)] text-center font-script text-anchor-gold-bright'
        )}
      >
        Where everyone&apos;s welcome
      </p>
    </div>
  );
}
