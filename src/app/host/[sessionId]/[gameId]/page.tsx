import React from 'react';
import { createClient } from '@/utils/supabase/server';
import { redirect, notFound } from 'next/navigation';
import { signout } from '@/app/login/actions';
import GameControl from './game-control';
import { Database } from '@/types/database';
import { getCurrentGameState } from '@/app/host/actions';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

interface PageProps {
  params: Promise<{ sessionId: string; gameId: string }>;
}

export default async function GameControlPage({ params }: PageProps) {
  const { sessionId, gameId } = await params;
  const supabase = await createClient();
  
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  // Fetch game details
  const { data: game, error: gameError } = await supabase
    .from('games')
    .select('*')
    .eq('id', gameId)
    .single<Database['public']['Tables']['games']['Row']>();

  if (gameError || !game) {
    console.error("Error fetching game details:", gameError);
    notFound();
  }

  // Fetch session details (needed for context, e.g., session name)
  const { data: session, error: sessionError } = await supabase
    .from('sessions')
    .select('name, status')
    .eq('id', sessionId)
    .single<Pick<Database['public']['Tables']['sessions']['Row'], 'name' | 'status'>>();

  if (sessionError || !session) {
    console.error("Error fetching session details:", sessionError);
    notFound();
  }

  // Fetch initial game state
  const { data: initialGameState, error: gameStateError } = await getCurrentGameState(gameId);

  if (gameStateError || !initialGameState) {
    console.warn(`Game ${gameId} in session ${sessionId} has no initial game state. Redirecting to host dashboard.`);
    redirect('/host'); 
  }

  return (
    <div className="min-h-screen-safe bg-slate-950 text-white">
       <header className="p-3 bg-slate-900 border-b border-slate-800 flex justify-between items-center sticky top-0 z-20 shadow-md">
        <div className="flex items-center gap-3">
            <Link href="/host">
              <Button variant="secondary" size="sm" className="h-8 px-2 border-slate-700 bg-slate-800 hover:bg-slate-700">
                &larr;
              </Button>
            </Link>
            <div className="leading-tight">
              <h1 className="text-sm font-bold text-white">{session.name}</h1>
              <p className="text-xs text-slate-400">{game.name}</p>
            </div>
        </div>
        <div className="flex items-center gap-3">
          <form action={signout}>
            <Button variant="ghost" size="sm" className="text-xs h-8 text-red-400 hover:text-red-300 hover:bg-red-900/20">Sign Out</Button>
          </form>
        </div>
      </header>

      <GameControl
        sessionId={sessionId}
        gameId={gameId}
        game={game}
        initialGameState={initialGameState as Database['public']['Tables']['game_states']['Row']}
        currentUserId={user.id}
      />
    </div>
  );
}