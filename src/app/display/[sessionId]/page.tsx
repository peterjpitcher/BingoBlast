import React from 'react';
import { createClient } from '@/utils/supabase/server';
import { notFound } from 'next/navigation';
import { headers } from 'next/headers';
import DisplayUI from './display-ui';
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

export default async function DisplayPage({ params }: PageProps) {
  const { sessionId } = await params;

  if (!isUuid(sessionId)) {
    notFound();
  }

  const supabase = await createClient();

  // Fetch session details
  const { data: session, error: sessionError } = await supabase
    .from('sessions')
    .select(SESSION_SELECT)
    .eq('id', sessionId)
    .single<Database['public']['Tables']['sessions']['Row']>();

  if (sessionError || !session) {
    logError('display', sessionError ?? new Error('Session not found'));
    notFound();
  }

  // Trusted origin for the join QR. Prefer the configured public origin
  // (set in production via NEXT_PUBLIC_SITE_URL) over the incoming request
  // headers — Vercel passes x-forwarded-host through unmodified, so an
  // attacker who can reach the deployment with a spoofed Host header could
  // otherwise turn the pub display QR into a phishing redirect.
  const configuredOrigin = (process.env.NEXT_PUBLIC_SITE_URL || '').replace(/\/$/, '');
  const requestHeaders = await headers();
  const forwardedHost = requestHeaders.get('x-forwarded-host');
  const host = forwardedHost || requestHeaders.get('host');
  const forwardedProto = requestHeaders.get('x-forwarded-proto');
  const protocol = forwardedProto || (host?.includes('localhost') ? 'http' : 'https');
  const headerOrigin = host ? `${protocol}://${host}` : '';
  const origin = configuredOrigin || headerOrigin;
  const playerJoinUrl = origin
    ? `${origin}/player/${session.id}`
    : `/player/${session.id}`;

  let activeGame: Database['public']['Tables']['games']['Row'] | null = null;
  let initialGameState: Database['public']['Tables']['game_states_public']['Row'] | null = null;
  let prizeText: string = ''; // To pass to display

  if (session.active_game_id) {
    // Fetch the active game details
    const { data: game, error: gameError } = await supabase
      .from('games')
      .select(GAME_SELECT)
      .eq('id', session.active_game_id)
      .single<Database['public']['Tables']['games']['Row']>();

    if (gameError || !game) {
      logError('display', gameError ?? new Error('No active game found for session'));
      // Continue to render, display will show "waiting" state
    } else {
      activeGame = game;
      // Fetch the initial game state for the active game
      const { data: gameState, error: gameStateError } = await supabase
        .from('game_states_public')
        .select(GAME_STATE_PUBLIC_SELECT)
        .eq('game_id', game.id)
        .single<Database['public']['Tables']['game_states_public']['Row']>();

      if (gameStateError || !gameState) {
        logError('display', gameStateError ?? new Error('No game state found for active game'));
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

  // A basic check: If there's no active game and session is not running, show waiting
  const isWaitingState = !session.active_game_id && session.status !== 'running';

  return (
    <DisplayUI
      session={session}
      activeGame={activeGame}
      initialGameState={initialGameState}
      initialPrizeText={prizeText}
      isWaitingState={isWaitingState}
      playerJoinUrl={playerJoinUrl}
    />
  );
}
