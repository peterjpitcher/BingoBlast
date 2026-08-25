import React from 'react';
import { createClient } from '@/utils/supabase/server';
import { redirect } from 'next/navigation';
import { signout } from '@/app/login/actions';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { Database } from '@/types/database';
import { formatShortDateTimeInLondon } from '@/lib/dates';
import { formatPence, totalPaidOutPence } from '@/lib/money';

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

  // Totals the SHARES, never the amounts. On a tied stage the amount is the
  // whole prize and appears on every tied row, so totalling it counts one £10
  // prize as £20. Ten ties already exist in the data, two of them cash
  // jackpots, so this is the difference between a real figure and one that
  // overstates what the pub paid. Voided wins carry no share and drop out.
  const payout = totalPaidOutPence(winners.filter((w) => w.is_void !== true));

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
          <Card className="bg-slate-900 border-slate-800 mb-4">
            <CardContent className="p-4 flex flex-wrap items-baseline gap-x-8 gap-y-2">
              <div>
                <span className="block text-xs uppercase tracking-wider text-slate-500">Total paid out</span>
                <span className="text-2xl font-bold text-white font-mono tabular-nums">
                  {formatPence(payout.totalPence)}
                </span>
              </div>
              <div>
                <span className="block text-xs uppercase tracking-wider text-slate-500">Cash prizes</span>
                <span className="text-lg text-slate-300 font-mono tabular-nums">{payout.countedRows}</span>
              </div>
              <div>
                <span className="block text-xs uppercase tracking-wider text-slate-500">Prizes that are not cash</span>
                <span className="text-lg text-slate-300 font-mono tabular-nums">{payout.uncountedRows}</span>
              </div>
              <p className="text-xs text-slate-500 max-w-md">
                Voided wins are excluded. A shared prize counts once: each winner&rsquo;s share is
                added, not the whole prize per winner. Shares on wins recorded before 25 August 2026
                are the current sharing rule applied to older records.
              </p>
            </CardContent>
          </Card>

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
                                  <th className="px-4 py-3 font-medium text-right">Paid</th>
                                  <th className="px-4 py-3 font-medium">Stage</th>
                                  <th className="px-4 py-3 font-medium">Status</th>
                                  <th className="px-4 py-3 font-medium text-right">Call #</th>
                              </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-800/50">
                              {winners.map((winner) => {
                                  // A voided win is not a payout, and this screen
                                  // is the permanent record of who was paid. It
                                  // used to render voided rows identically to
                                  // real ones: same prize, same JACKPOT badge,
                                  // nothing saying it had been reversed. Anyone
                                  // reconciling a night against the till was
                                  // reading a number that was never handed over.
                                  const isVoid = winner.is_void === true;
                                  return (
                                  <tr key={winner.id} className={cn("transition-colors", isVoid ? "bg-red-950/20 text-slate-500" : "hover:bg-slate-800/30")}>
                                      <td className="px-4 py-3 text-slate-400">{formatShortDateTimeInLondon(winner.created_at)}</td>
                                      <td className="px-4 py-3">
                                          <div className={cn("font-medium", isVoid ? "text-slate-400" : "text-white")}>{winner.session?.name}</div>
                                          <div className="text-xs text-slate-500">{winner.game?.name}</div>
                                      </td>
                                      <td className={cn("px-4 py-3 font-bold", isVoid ? "text-slate-400" : "text-white")}>{winner.winner_name}</td>
                                      <td className="px-4 py-3 text-slate-300">
                                          <span className={cn(isVoid && "line-through decoration-red-500/70")}>
                                              {winner.prize_description}
                                          </span>
                                          {winner.is_snowball_jackpot && (
                                              <span className="ml-2 px-1.5 py-0.5 rounded text-xs font-bold bg-yellow-900/30 text-yellow-500 border border-yellow-800">JACKPOT</span>
                                          )}
                                      </td>
                                      <td className="px-4 py-3 text-right font-mono whitespace-nowrap">
                                          {isVoid ? (
                                              <span className="text-slate-600">-</span>
                                          ) : winner.prize_share_pence !== null && winner.prize_share_pence !== undefined ? (
                                              <span className="text-white">
                                                  {formatPence(winner.prize_share_pence)}
                                                  {winner.prize_amount_pence !== null
                                                    && winner.prize_amount_pence !== winner.prize_share_pence && (
                                                      <span className="block text-xs text-slate-500">
                                                          share of {formatPence(winner.prize_amount_pence)}
                                                      </span>
                                                  )}
                                              </span>
                                          ) : (
                                              <span className="text-slate-500 text-xs">not cash</span>
                                          )}
                                      </td>
                                      <td className="px-4 py-3">
                                          <span className="px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 text-xs border border-slate-700">{winner.stage}</span>
                                      </td>
                                      <td className="px-4 py-3">
                                          {isVoid ? (
                                              <div>
                                                  <span className="px-2 py-0.5 rounded-full bg-red-900/40 text-red-300 text-xs font-bold border border-red-800">VOID</span>
                                                  {winner.void_reason && (
                                                      <div className="text-xs text-slate-500 mt-1 max-w-[16rem]">{winner.void_reason}</div>
                                                  )}
                                              </div>
                                          ) : winner.prize_given ? (
                                              <span className="px-2 py-0.5 rounded-full bg-emerald-900/40 text-emerald-300 text-xs font-bold border border-emerald-800">PRIZE GIVEN</span>
                                          ) : (
                                              <span className="px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 text-xs border border-slate-700">Not handed over</span>
                                          )}
                                      </td>
                                      <td className="px-4 py-3 text-right font-mono text-slate-400">{winner.call_count_at_win}</td>
                                  </tr>
                                  );
                              })}
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