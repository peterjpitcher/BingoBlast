import React from 'react';
import { createClient } from '@/utils/supabase/server';
import { redirect } from 'next/navigation';
import { signout } from '@/app/login/actions';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import type { Database } from '@/types/database';

type WinnerWithRelations = Database['public']['Tables']['winners']['Row'] & {
  session: Pick<Database['public']['Tables']['sessions']['Row'], 'name' | 'start_date'> | null;
  game: Pick<Database['public']['Tables']['games']['Row'], 'name' | 'type'> | null;
};

export default async function HistoryPage() {
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
    redirect('/');
  }

  const { data: winnersRaw, error } = await supabase
    .from('winners')
    .select(`
      *,
      session:sessions (name, start_date),
      game:games (name, type)
    `)
    .order('created_at', { ascending: false });

  const winners: WinnerWithRelations[] = (winnersRaw ?? []) as WinnerWithRelations[];

  if (error) {
      console.error("Error fetching history:", error);
  }

  return (
    <div className="min-h-screen-safe bg-slate-950 text-white">
      <header className="bg-slate-900 border-b border-slate-800 p-4 sticky top-0 z-10">
        <div className="container mx-auto flex justify-between items-center">
           <div className="flex items-center gap-4">
              <Link href="/admin">
                <Button variant="secondary" size="sm" className="bg-slate-800 border-slate-700">&larr;</Button>
              </Link>
              <h1 className="text-xl font-bold text-white">Winner History</h1>
           </div>
           <div className="flex items-center gap-4">
              <span className="text-sm text-slate-400 hidden sm:inline-block">{user.email}</span>
              <form action={signout}>
                 <Button variant="ghost" size="sm" className="text-red-400 hover:bg-red-900/20 hover:text-red-300">Sign Out</Button>
              </form>
           </div>
        </div>
      </header>
      
      <main className="container mx-auto p-4">
          <Card className="bg-slate-900 border-slate-800">
            <CardContent className="p-0">
              {!winners || winners.length === 0 ? (
                  <div className="p-8 text-center text-slate-500">
                      <p>No winners recorded yet.</p>
                  </div>
              ) : (
                  <div className="overflow-x-auto">
                      <table className="w-full text-sm text-left">
                          <thead className="bg-slate-800/50 text-slate-400">
                              <tr>
                                  <th className="px-4 py-3 font-medium">Date</th>
                                  <th className="px-4 py-3 font-medium">Session / Game</th>
                                  <th className="px-4 py-3 font-medium">Winner</th>
                                  <th className="px-4 py-3 font-medium">Prize</th>
                                  <th className="px-4 py-3 font-medium">Stage</th>
                                  <th className="px-4 py-3 font-medium text-right">Call #</th>
                              </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-800/50">
                              {winners.map((winner) => (
                                  <tr key={winner.id} className="hover:bg-slate-800/30 transition-colors">
                                      <td className="px-4 py-3 text-slate-400">{new Date(winner.created_at).toLocaleDateString()}</td>
                                      <td className="px-4 py-3">
                                          <div className="font-medium text-white">{winner.session?.name}</div>
                                          <div className="text-xs text-slate-500">{winner.game?.name}</div>
                                      </td>
                                      <td className="px-4 py-3 font-bold text-white">{winner.winner_name}</td>
                                      <td className="px-4 py-3 text-slate-300">
                                          {winner.prize_description}
                                          {winner.is_snowball_jackpot && (
                                              <span className="ml-2 px-1.5 py-0.5 rounded text-xs font-bold bg-yellow-900/30 text-yellow-500 border border-yellow-800">JACKPOT</span>
                                          )}
                                      </td>
                                      <td className="px-4 py-3">
                                          <span className="px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 text-xs border border-slate-700">{winner.stage}</span>
                                      </td>
                                      <td className="px-4 py-3 text-right font-mono text-slate-400">{winner.call_count_at_win}</td>
                                  </tr>
                              ))}
                          </tbody>
                      </table>
                  </div>
              )}
            </CardContent>
          </Card>
      </main>
    </div>
  );
}