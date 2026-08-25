import React from 'react';
import { createClient } from '@/utils/supabase/server';
import { notFound } from 'next/navigation';
import PlayerUI from './player-ui';
import type { InitialLoadStatus } from './player-ui';
import { Database } from '@/types/database';
import { isUuid } from '@/lib/utils';
import { logError } from '@/lib/log-error';

interface PageProps {
  params: Promise<{ sessionId: string }>;
}

// Explicit narrow column lists keep public surfaces from leaking unintended
// fields and document exactly what the UI consumes from each table.
const SESSION_SELECT = 'id, name, status, active_game_id';
const GAME_SELECT =
  'id, session_id, game_index, name, type, stage_sequence, background_colour, prizes, snowball_pot_id';
const GAME_STATE_PUBLIC_SELECT =
  'game_id, called_numbers, numbers_called_count, current_stage_index, status, call_delay_seconds, on_break, paused_for_validation, display_win_type, display_win_text, display_winner_name, started_at, ended_at, last_call_at, updated_at, state_version';

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

export default async function PlayerPage({ params }: PageProps) {
  const { sessionId } = await params;

  if (!isUuid(sessionId)) {
    notFound();
  }

  const supabase = await createClient();

  // Fetch session details
  const { data: sessionRow, error: sessionError } = await supabase
    .from('sessions')
    .select(SESSION_SELECT)
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
    logError('player', sessionError ?? new Error('Session read returned no row and no error'));
    sessionLoadFailed = true;
    // A shell carrying the real id, so the client's poll re-reads the session
    // and replaces this the moment the database answers again. The name is
    // deliberately neutral rather than alarming: it is on a pub TV.
    session = {
      id: sessionId,
      name: 'Bingo',
      status: 'running',
      active_game_id: null,
    } as Database['public']['Tables']['sessions']['Row'];
  }

  let activeGame: Database['public']['Tables']['games']['Row'] | null = null;
  let initialGameState: Database['public']['Tables']['game_states_public']['Row'] | null = null;
  let prizeText: string = '';
  // A failed read is reported to the client as its own load status. It must
  // never be presented to guests as "the host has not started yet": the screen
  // shows a recoverable panel and recovers on the next successful poll.
  let initialLoadStatus: InitialLoadStatus = sessionLoadFailed ? 'failed' : 'ready';

  if (!sessionLoadFailed && session.active_game_id) {
    // Fetch the active game details
    const { data: game, error: gameError } = await supabase
      .from('games')
      .select(GAME_SELECT)
      .eq('id', session.active_game_id)
      .single<Database['public']['Tables']['games']['Row']>();

    if (gameError || !game) {
      logError('player', gameError ?? new Error('No active game found for session'));
      initialLoadStatus = 'failed';
    } else {
      activeGame = game;
      // Fetch the initial game state for the active game
      const { data: gameState, error: gameStateError } = await supabase
        .from('game_states_public')
        .select(GAME_STATE_PUBLIC_SELECT)
        .eq('game_id', game.id)
        .single<Database['public']['Tables']['game_states_public']['Row']>();

      if (gameStateError || !gameState) {
        logError('player', gameStateError ?? new Error('No game state found for active game'));
        initialLoadStatus = 'failed';
      } else {
        initialGameState = gameState;
        if (game.prizes && game.stage_sequence && gameState.current_stage_index !== undefined) {
          const currentStage = game.stage_sequence[gameState.current_stage_index];
          prizeText = game.prizes[currentStage as keyof typeof game.prizes] || '';
        }
      }
    }
  }

  return (
    <PlayerUI
      session={session}
      activeGame={activeGame}
      initialGameState={initialGameState}
      initialPrizeText={prizeText}
      initialLoadStatus={initialLoadStatus}
    />
  );
}
