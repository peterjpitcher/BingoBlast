import React from 'react';
import { createClient } from '@/utils/supabase/server';
import { notFound } from 'next/navigation';
import DisplayUI from './display-ui';
import { Database } from '@/types/database';

interface PageProps {
  params: Promise<{ sessionId: string }>;
}

export default async function DisplayPage({ params }: PageProps) {
  const { sessionId } = await params;
  const supabase = await createClient();

  // Fetch session details
  const { data: session, error: sessionError } = await supabase
    .from('sessions')
    .select('*, active_game_id, status')
    .eq('id', sessionId)
    .single<Database['public']['Tables']['sessions']['Row']>();

  if (sessionError || !session) {
    console.error("Error fetching session for display:", sessionError?.message);
    notFound();
  }

  let activeGame: Database['public']['Tables']['games']['Row'] | null = null;
  let initialGameState: Database['public']['Tables']['game_states_public']['Row'] | null = null;
  let prizeText: string = ''; // To pass to display

  if (session.active_game_id) {
    // Fetch the active game details
    const { data: game, error: gameError } = await supabase
      .from('games')
      .select('*')
      .eq('id', session.active_game_id)
      .single<Database['public']['Tables']['games']['Row']>();

    if (gameError || !game) {
      console.warn("No active game found for session, or error fetching:", gameError?.message);
      // Continue to render, display will show "waiting" state
    } else {
      activeGame = game;
      // Fetch the initial game state for the active game
      const { data: gameState, error: gameStateError } = await supabase
        .from('game_states_public')
        .select('*')
        .eq('game_id', game.id)
        .single<Database['public']['Tables']['game_states_public']['Row']>();

      if (gameStateError || !gameState) {
        console.warn("No game state found for active game:", gameStateError?.message);
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
    />
  );
}
