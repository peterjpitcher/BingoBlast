import React from 'react';
import { createClient } from '@/utils/supabase/server';
import { redirect } from 'next/navigation';
import { signout } from '@/app/login/actions';
import HostDashboard from './dashboard';
import { Database } from '@/types/database';
import { Button } from '@/components/ui/button';

type SessionWithGames = Database['public']['Tables']['sessions']['Row'] & {
  games: Database['public']['Tables']['games']['Row'][];
};

export default async function HostPage() {
  const supabase = await createClient();
  
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const { data: sessionsData, error: sessionsError } = await supabase
    .from('sessions')
    .select(`
      *,
      games:games!games_session_id_fkey (*)
    `)
    .in('status', ['ready', 'running'])
    .order('created_at', { ascending: false });

  if (sessionsError) {
    console.error("Error fetching sessions for host:", sessionsError.message);
    return (
        <div className="min-h-screen-safe flex flex-col items-center justify-center p-4 text-center bg-slate-950 text-white">
            <h1 className="text-2xl font-bold text-red-500 mb-4">Error Loading Sessions</h1>
            <p className="text-slate-400 mb-6">Could not retrieve sessions. Please try again later.</p>
             <form action={signout}>
                <Button variant="secondary">Sign Out</Button>
             </form>
        </div>
    );
  }

  const sessions: SessionWithGames[] = (sessionsData || []) as SessionWithGames[];

  return (
    <div className="min-h-screen-safe bg-slate-950 text-white pb-20">
       <header className="p-4 flex justify-between items-center border-b border-slate-800 bg-slate-900/50 backdrop-blur-sm sticky top-0 z-10">
          <h1 className="font-bold text-lg text-bingo-secondary">Host Console</h1>
          <div className="flex items-center gap-4">
             <span className="text-xs text-slate-400 hidden sm:inline-block">{user.email}</span>
             <form action={signout}>
                <Button variant="ghost" size="sm" className="text-red-400 hover:bg-red-900/20 hover:text-red-300">Sign Out</Button>
             </form>
          </div>
       </header>
      <main className="p-4">
        <HostDashboard sessions={sessions} />
      </main>
    </div>
  );
}