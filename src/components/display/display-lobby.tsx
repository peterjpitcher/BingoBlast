// src/components/display/display-lobby.tsx
//
// /display when there is not exactly one session to join (spec 5.8, A3). The
// server page redirects straight to a single qualifying session; this covers
// the rest and keeps checking, so a TV left on /display joins the night by
// itself:
//   - none:  the idle screen, re-checked every 60 seconds;
//   - many:  a list for staff to choose from, refreshed every 30 seconds;
//   - error: a retrying screen, re-checked every 15 seconds.
// A failed re-check keeps the last good screen rather than flashing an error.
'use client';

import React, { useEffect, useState } from 'react';
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
import { useBuildCheck } from '@/hooks/use-build-check';
import { useWakeLock } from '@/hooks/wake-lock';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TV_TEXT_BODY, TV_TEXT_TITLE } from './tv-text';

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
}

export function DisplayLobby({ initial, rehearsal }: DisplayLobbyProps) {
  const [supabase] = useState(createClient);
  const [state, setState] = useState<LobbyState>(initial);
  const router = useRouter();

  // A TV can sit here for days: keep it awake and on the current release.
  useWakeLock();
  useBuildCheck({ mode: 'auto', safe: true });

  const delayMs = RECHECK_MS[state.kind];

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

  return (
    <div
      className="flex h-screen flex-col items-center justify-center gap-[4vh] px-[6vw] text-center text-white"
      style={{ backgroundColor: '#005131' }}
      role={state.kind === 'error' ? 'status' : undefined}
      aria-live={state.kind === 'error' ? 'polite' : undefined}
    >
      <div className="relative h-[16vh] w-[60vh] max-w-full">
        <Image src="/the-anchor-pub-logo-white-transparent.png" alt="The Anchor" fill className="object-contain" priority />
      </div>
      {state.kind === 'error' ? (
        <>
          <h1 className={cn(TV_TEXT_TITLE, 'font-black uppercase tracking-[0.06em]')}>Reconnecting</h1>
          <p className={cn(TV_TEXT_BODY, 'text-white/90')}>Trying again in a moment.</p>
        </>
      ) : (
        // Placeholder until the events slice (S4) fills the idle loop.
        <h1 className={cn(TV_TEXT_TITLE, 'font-black uppercase tracking-[0.06em]')}>Bingo nights at The Anchor</h1>
      )}
    </div>
  );
}
