import React from 'react';
import { createClient } from '@/utils/supabase/server';
import { notFound } from 'next/navigation';
import { headers } from 'next/headers';
import DisplayUI from './display-ui';
import type { InitialLoadStatus } from './display-ui';
import { Database } from '@/types/database';
import { isUuid } from '@/lib/utils';
import { logError } from '@/lib/log-error';
import { getTodayIsoDateInLondon } from '@/lib/dates';
import { getEventsProjection } from '@/lib/events-feed/projection';
import { getRequestOrigin, getSiteOrigin } from '@/lib/site-origin';
import {
  CANDIDATE_SESSION_STATUSES,
  resolveDisplaySession,
  type ResolvableSession,
} from '@/lib/session-resolution';
import {
  PUBLIC_GAME_COLUMNS,
  PUBLIC_GAME_STATE_COLUMNS,
  PUBLIC_SESSION_COLUMNS,
} from '@/lib/public-selectors';

interface PageProps {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * PostgREST's "no rows returned by .single()". Anything else is an outage.
 *
 * This distinction is the difference between a 404 and a screen that recovers.
 * Both public pages used to call notFound() on ANY error reading the session, so
 * a two minute Supabase blip during the display's own auto-reload put the pub TV
 * on the static "This page could not be found" page: no JavaScript, no poll, no
 * banner, no reload timer. Supabase came back a minute later and the TV was
 * still showing a 404 for the rest of the night.
 */
const NO_ROWS_RETURNED = 'PGRST116';

export default async function DisplayPage({ params, searchParams }: PageProps) {
  const { sessionId } = await params;
  const rehearsal = (await searchParams).rehearsal === '1';

  if (!isUuid(sessionId)) {
    notFound();
  }

  // Upcoming events for the start and end of the night (spec 5.5), read
  // alongside the session rather than after it. Cached, and never throws, so
  // a management app outage can never stop the TV loading; at worst it waits
  // for the projection's own 8 second refresh limit on a cold cache.
  const eventsPromise = getEventsProjection();

  const supabase = await createClient();

  // Fetch session details
  const { data: sessionRow, error: sessionError } = await supabase
    .from('sessions')
    .select(PUBLIC_SESSION_COLUMNS)
    .eq('id', sessionId)
    .single<Database['public']['Tables']['sessions']['Row']>();

  // A session that genuinely does not exist is a 404. A session we could not
  // read is not: it is an outage, and the screen must be able to come back from
  // it on its own.
  if (sessionError && sessionError.code === NO_ROWS_RETURNED) {
    notFound();
  }

  let sessionLoadFailed = false;
  let session = sessionRow;

  if (!session) {
    logError('display', sessionError ?? new Error('Session read returned no row and no error'));
    sessionLoadFailed = true;
    // A shell carrying the real id, so the client's poll re-reads the session
    // and replaces this the moment the database answers again. The name is
    // deliberately neutral rather than alarming: it is on a pub TV.
    // state_version -1 lets the first real snapshot replace it.
    session = {
      id: sessionId,
      name: 'Bingo',
      status: 'running',
      active_game_id: null,
      start_date: getTodayIsoDateInLondon(),
      started_at: null,
      completed_at: null,
      state_version: -1,
    } as Database['public']['Tables']['sessions']['Row'];
  }

  // The follow-along QR (spec 5.4). The origin never comes from request
  // headers on Vercel (getSiteOrigin), so a spoofed Host header cannot turn
  // the pub TV's QR into someone else's link. The QR is the short `/play` when
  // this is the one session /play would pick by itself, and `/play?s=<id>`
  // otherwise; the TV re-checks that once a minute (useDisplayLifecycle).
  const requestHeaders = await headers();
  const followOrigin = getSiteOrigin({
    env: process.env,
    requestOrigin: getRequestOrigin((name) => requestHeaders.get(name)),
  });
  let initialIsUniqueSession = false;
  if (!sessionLoadFailed) {
    const { data: candidates, error: candidatesError } = await supabase
      .from('sessions')
      .select('id, status, start_date, is_test_session')
      .in('status', CANDIDATE_SESSION_STATUSES)
      .returns<ResolvableSession[]>();
    if (candidatesError || !candidates) {
      // Not worth failing the page for: the id-carrying QR is always correct.
      logError('display', candidatesError ?? new Error('Candidate sessions lookup returned nothing'));
    } else {
      const resolution = resolveDisplaySession(candidates, getTodayIsoDateInLondon(), { includeTest: false });
      initialIsUniqueSession = resolution.kind === 'one' && resolution.id === session.id;
    }
  }

  let activeGame: Database['public']['Tables']['games']['Row'] | null = null;
  let initialGameState: Database['public']['Tables']['game_states_public']['Row'] | null = null;
  let prizeText: string = ''; // To pass to display
  // A failed read is reported to the client as its own load status. It must
  // never be presented to guests as "the host has not started yet": the screen
  // shows a recoverable panel and recovers on the next successful poll.
  let initialLoadStatus: InitialLoadStatus = sessionLoadFailed ? 'failed' : 'ready';

  if (!sessionLoadFailed && session.active_game_id) {
    // Fetch the active game details
    const { data: game, error: gameError } = await supabase
      .from('games')
      .select(PUBLIC_GAME_COLUMNS)
      .eq('id', session.active_game_id)
      .single<Database['public']['Tables']['games']['Row']>();

    if (gameError || !game) {
      logError('display', gameError ?? new Error('No active game found for session'));
      initialLoadStatus = 'failed';
    } else {
      activeGame = game;
      // Fetch the initial game state for the active game
      const { data: gameState, error: gameStateError } = await supabase
        .from('game_states_public')
        .select(PUBLIC_GAME_STATE_COLUMNS)
        .eq('game_id', game.id)
        .single<Database['public']['Tables']['game_states_public']['Row']>();

      if (gameStateError || !gameState) {
        logError('display', gameStateError ?? new Error('No game state found for active game'));
        initialLoadStatus = 'failed';
      } else {
        initialGameState = gameState;
        // Determine initial prize text
        if (game.prizes && game.stage_sequence && gameState.current_stage_index !== undefined) {
          const currentStage = game.stage_sequence[gameState.current_stage_index];
          prizeText = game.prizes[currentStage as keyof typeof game.prizes] || '';
        }
      }
    }
  }

  // The screen for each part of the night is decided in DisplayUI from the
  // session and the active game's state (getNightPhase), so it follows the
  // night live rather than from this first read.
  const initialEvents = await eventsPromise;

  return (
    <DisplayUI
      session={session}
      activeGame={activeGame}
      initialGameState={initialGameState}
      initialPrizeText={prizeText}
      initialLoadStatus={initialLoadStatus}
      followOrigin={followOrigin}
      initialIsUniqueSession={initialIsUniqueSession}
      rehearsal={rehearsal}
      initialEvents={initialEvents}
    />
  );
}
