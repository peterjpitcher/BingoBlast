import React from 'react';
import { createClient } from '@/utils/supabase/server';
import { redirect, notFound } from 'next/navigation';
import { signout } from '@/app/login/actions';
import GameControl from './game-control';
import { Database } from '@/types/database';
import { getCurrentGameState } from '@/app/host/actions';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { isUuid } from '@/lib/utils';
import Image from 'next/image';

interface PageProps {
  params: Promise<{ sessionId: string; gameId: string }>;
}

export default async function GameControlPage({ params }: PageProps) {
  const { sessionId, gameId } = await params;

  if (!isUuid(sessionId) || !isUuid(gameId)) {
    notFound();
  }

  const supabase = await createClient();
  
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single<{ role: Database['public']['Tables']['profiles']['Row']['role'] }>();

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
  const gameStateResult = await getCurrentGameState(gameId);

  if (!gameStateResult.success || !gameStateResult.data) {
    console.warn(`Game ${gameId} in session ${sessionId} has no initial game state. Redirecting to host dashboard.`);
    redirect('/host'); 
  }

  return (
    <div className="min-h-screen-safe anchor-theme bg-[#003f27] text-white">
       <header className="p-3 bg-[#005131]/95 border-b border-[#1f7c58] flex justify-between items-center sticky top-0 z-20 shadow-md">
        <div className="flex items-center gap-3">
            <Link href="/host">
              <Button variant="secondary" size="sm" className="h-8 px-2 border-[#1f7c58] bg-[#0f6846] hover:bg-[#136f4b]">
                &larr;
              </Button>
            </Link>
            <div className="relative w-28 h-9">
              <Image src="/the-anchor-pub-logo-white-transparent.png" alt="The Anchor" fill className="object-contain object-left" />
            </div>
            <div className="leading-tight hidden sm:block">
              <h1 className="text-sm font-bold text-white">{session.name}</h1>
              <p className="text-xs text-white/80">{game.name}</p>
            </div>
        </div>
        <div className="flex items-center gap-3">
          <form action={signout}>
            <Button variant="ghost" size="sm" className="text-xs h-8 text-white hover:bg-[#0f6846]">Sign Out</Button>
          </form>
        </div>
      </header>

      <GameControl
        sessionId={sessionId}
        gameId={gameId}
        game={game}
        initialGameState={gameStateResult.data}
        currentUserId={user.id}
        currentUserRole={profile?.role || 'host'}
      />
    </div>
  );
}
