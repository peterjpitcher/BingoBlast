import React from 'react';
import { createClient } from '@/utils/supabase/server';
import { redirect, notFound } from 'next/navigation';
import { signout } from '@/app/login/actions';
import SessionDetail from './session-detail';
import type { Database } from '@/types/database';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function SessionDetailPage({ params }: PageProps) {
  const { id } = await params;
  const supabase = await createClient();
  
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  // Check role (Optional: middleware handles this generally, but good for double safety)
  
  // Fetch Session
  const { data: session, error: sessionError } = await supabase
    .from('sessions')
    .select('*')
    .eq('id', id)
    .single<Database['public']['Tables']['sessions']['Row']>();

  if (sessionError || !session) {
    notFound();
  }

  // Fetch Games for this session
  const { data: games, error: gamesError } = await supabase
    .from('games')
    .select('*')
    .eq('session_id', id)
    .order('game_index', { ascending: true });
  if (gamesError) {
    console.error('Error fetching games', gamesError.message);
  }

  // Fetch Snowball Pots (for dropdowns)
  const { data: snowballPots } = await supabase
    .from('snowball_pots')
    .select('id, name, current_jackpot_amount, current_max_calls')
    .order('name');

  return (
    <div className="container py-4">
       <div className="d-flex justify-content-between align-items-center mb-4">
        <div className="d-flex align-items-baseline gap-3">
            <a href="/admin" className="btn btn-outline-secondary btn-sm">&larr; Back</a>
            <h1 className="h3 m-0">{session.name}</h1>
            <span className="badge bg-secondary">{session.status}</span>
        </div>
        <div className="d-flex align-items-center gap-3">
          <span className="text-muted small">{user.email}</span>
          <form action={signout}>
            <button className="btn btn-outline-danger btn-sm">Sign Out</button>
          </form>
        </div>
      </div>

      <SessionDetail 
        session={session} 
        initialGames={games || []} 
        snowballPots={snowballPots || []} 
      />
    </div>
  );
}
