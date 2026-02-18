import React from 'react';
import { createClient } from '@/utils/supabase/server';
import { redirect } from 'next/navigation';
import { signout } from '@/app/login/actions';
import HostDashboard from './dashboard';
import { Database } from '@/types/database';
import { Button } from '@/components/ui/button';
import Image from 'next/image';

type SessionWithGames = Database['public']['Tables']['sessions']['Row'] & {
  games: (Database['public']['Tables']['games']['Row'] & {
    game_states: Database['public']['Tables']['game_states']['Row'] | null;
  })[];
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
      games:games!games_session_id_fkey (
        *,
        game_states:game_states (*)
      )
    `)
    .in('status', ['ready', 'running'])
    .order('created_at', { ascending: false });

  if (sessionsError) {
    console.error("Error fetching sessions for host:", sessionsError.message);
    return (
        <div className="min-h-screen-safe flex flex-col items-center justify-center p-4 text-center bg-[#003f27] text-white">
            <h1 className="text-2xl font-bold text-white mb-4">Error Loading Sessions</h1>
            <p className="text-white/85 mb-6">Could not retrieve sessions. Please try again later.</p>
             <form action={signout}>
                <Button variant="secondary">Sign Out</Button>
             </form>
        </div>
    );
  }

  const sessions: SessionWithGames[] = (sessionsData || []) as SessionWithGames[];

  return (
    <div className="min-h-screen-safe anchor-theme bg-[#003f27] text-white pb-20">
       <header className="p-4 flex justify-between items-center border-b border-[#1f7c58] bg-[#005131]/95 backdrop-blur-sm sticky top-0 z-10">
          <div className="flex items-center gap-3">
            <div className="relative w-32 h-10">
              <Image src="/the-anchor-pub-logo-white-transparent.png" alt="The Anchor" fill className="object-contain object-left" />
            </div>
            <h1 className="font-bold text-lg text-white">Host Console</h1>
          </div>
          <div className="flex items-center gap-4">
             <span className="text-xs text-white/80 hidden sm:inline-block">{user.email}</span>
             <form action={signout}>
                <Button variant="ghost" size="sm" className="text-white hover:bg-[#0f6846]">Sign Out</Button>
             </form>
          </div>
       </header>
      <main className="p-4">
        <HostDashboard sessions={sessions} />
      </main>
    </div>
  );
}
