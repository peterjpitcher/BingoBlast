import React from 'react';
import { createClient } from '@/utils/supabase/server';
import { redirect, notFound } from 'next/navigation';
import SessionDetail from './session-detail';
import type { Database } from '@/types/database';
import { isUuid } from '@/lib/utils';

interface PageProps {
  params: Promise<{ id: string }>;
}

type WinnerWithGame = Database['public']['Tables']['winners']['Row'] & {
  game: Pick<Database['public']['Tables']['games']['Row'], 'name' | 'game_index'> | null;
};

export default async function SessionDetailPage({ params }: PageProps) {
  const { id } = await params;

  if (!isUuid(id)) {
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

  if (profile?.role !== 'admin') {
    redirect('/host');
  }

  // Fetch Session
  const { data: session, error: sessionError } = await supabase
    .from('sessions')
    .select('*')
    .eq('id', id)
    .single<Database['public']['Tables']['sessions']['Row']>();

  if (sessionError || !session) {
    notFound();
  }

  // Fetch Games for this session (including game_states so UI can gate actions on status)
  const { data: games, error: gamesError } = await supabase
    .from('games')
    .select('*, game_states(*)')
    .eq('session_id', id)
    .order('game_index', { ascending: true });
  if (gamesError) {
    console.error('Error fetching games', gamesError.message);
  }

  // Fetch Snowball Pots (for dropdowns). Archived pots are excluded: a new game
  // must not be linked to a retired pot, and the reverse (an already-linked game
  // keeping its pot) is exactly what archiving preserves.
  const { data: snowballPots } = await supabase
    .from('snowball_pots')
    .select('id, name, current_jackpot_amount, current_max_calls')
    .is('archived_at', null)
    .order('name');

  // Fetch winners for this session so admins can review prize status after game completion
  const { data: winnersRaw, error: winnersError } = await supabase
    .from('winners')
    .select(`
      *,
      game:games (name, game_index)
    `)
    .eq('session_id', id)
    .order('created_at', { ascending: false });

  const winners: WinnerWithGame[] = (winnersRaw ?? []) as WinnerWithGame[];

  if (winnersError) {
    console.error('Error fetching winners', winnersError.message);
  }

  // The admin layout draws the header, the footer and the page container. The
  // page header (back link, name, status, actions) is drawn by SessionDetail,
  // because its actions are client-side.
  return (
    <SessionDetail
      session={session}
      initialGames={games || []}
      snowballPots={snowballPots || []}
      winners={winners}
    />
  );
}
