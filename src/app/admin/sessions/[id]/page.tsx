import React from 'react';
import { createClient } from '@/utils/supabase/server';
import { redirect, notFound } from 'next/navigation';
import { signout } from '@/app/login/actions';
import SessionDetail from './session-detail';
import type { Database } from '@/types/database';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
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

  // Fetch Snowball Pots (for dropdowns)
  const { data: snowballPots } = await supabase
    .from('snowball_pots')
    .select('id, name, current_jackpot_amount, current_max_calls')
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

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="container mx-auto p-6 space-y-8">
        {/* Header Section */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-6 border-b border-slate-800">
          <div className="flex items-center gap-4">
            <Link href="/admin">
              <Button variant="secondary" size="sm" className="gap-2">
                ← Back
              </Button>
            </Link>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight">{session.name}</h1>
              <span className="px-2.5 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-xs font-medium uppercase tracking-wider text-slate-300">
                {session.status}
              </span>
            </div>
          </div>
          
          <div className="flex items-center gap-4 bg-slate-900/50 p-2 pr-4 rounded-full border border-slate-800">
            <div className="h-8 w-8 rounded-full bg-indigo-500/20 flex items-center justify-center border border-indigo-500/30">
              <span className="text-xs font-bold text-indigo-400">
                {user.email?.charAt(0).toUpperCase()}
              </span>
            </div>
            <span className="text-sm text-slate-400 hidden sm:inline-block">{user.email}</span>
            <form action={signout}>
              <Button variant="ghost" size="sm" className="h-8 text-red-400 hover:text-red-300 hover:bg-red-950/30">
                Sign Out
              </Button>
            </form>
          </div>
        </div>

        <SessionDetail 
          session={session} 
          initialGames={games || []} 
          snowballPots={snowballPots || []} 
          winners={winners}
        />
      </div>
    </div>
  );
}
