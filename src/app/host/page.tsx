import React from 'react';
import { createClient } from '@/utils/supabase/server';
import { redirect } from 'next/navigation';
import { signout } from '@/app/login/actions';
import HostDashboard, { type UnsettledSnowballGame } from './dashboard';
import { Database } from '@/types/database';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Button } from '@/components/ui/button';
import Image from 'next/image';
import Link from 'next/link';

type SessionWithGames = Database['public']['Tables']['sessions']['Row'] & {
  games: (Database['public']['Tables']['games']['Row'] & {
    game_states: Database['public']['Tables']['game_states']['Row'] | null;
  })[];
};

/**
 * Snowball games finished from this date on are checked for a settlement
 * record. Earlier ones are not: before the lifecycle and money changes of
 * 1 October 2026 a failed settlement was often put right by a manual pot
 * correction, which leaves no per-game record, so an earlier game with no
 * record may well be settled already, and settling it again would move the
 * pot twice.
 */
const SETTLEMENT_CHECK_FROM_ISO = '2026-10-01T00:00:00Z';

/**
 * Finished snowball games whose pot never settled (X6), so the retry survives
 * a reload or leaving the game page.
 *
 * "Settled" is exactly what settle_snowball_pot checks for already_settled: a
 * snowball_pot_history row for this game and its pot (the partial unique index
 * snowball_pot_history_pot_game_unique). Test sessions never settle, so they
 * are left out.
 *
 * snowball_pot_history is readable by admins only (RLS), so this runs for an
 * admin only. For a host the history reads as empty, which would list every
 * finished snowball game as unsettled. Returns null when a read failed, so the
 * dashboard can say it could not check rather than show an empty list.
 */
async function findUnsettledSnowballGames(
  supabase: SupabaseClient<Database>
): Promise<UnsettledSnowballGame[] | null> {
  const { data: games, error: gamesError } = await supabase
    .from('games')
    .select('id, name, game_index, session_id, snowball_pot_id')
    .eq('type', 'snowball')
    .not('snowball_pot_id', 'is', null)
    .returns<Pick<Database['public']['Tables']['games']['Row'], 'id' | 'name' | 'game_index' | 'session_id' | 'snowball_pot_id'>[]>();
  if (gamesError) return null;
  if (!games || games.length === 0) return [];

  const { data: finishedStates, error: statesError } = await supabase
    .from('game_states')
    .select('game_id, ended_at')
    .in('game_id', games.map((g) => g.id))
    .eq('status', 'completed')
    .gte('ended_at', SETTLEMENT_CHECK_FROM_ISO)
    .returns<Pick<Database['public']['Tables']['game_states']['Row'], 'game_id' | 'ended_at'>[]>();
  if (statesError) return null;
  if (!finishedStates || finishedStates.length === 0) return [];

  const endedAtByGame = new Map(finishedStates.map((s) => [s.game_id, s.ended_at]));
  const finishedGames = games.filter((g) => endedAtByGame.has(g.id));

  const { data: sessions, error: sessionsError } = await supabase
    .from('sessions')
    .select('id, name, start_date, is_test_session')
    .in('id', [...new Set(finishedGames.map((g) => g.session_id))])
    .returns<Pick<Database['public']['Tables']['sessions']['Row'], 'id' | 'name' | 'start_date' | 'is_test_session'>[]>();
  if (sessionsError) return null;

  const { data: history, error: historyError } = await supabase
    .from('snowball_pot_history')
    .select('game_id, snowball_pot_id')
    .in('game_id', finishedGames.map((g) => g.id))
    .returns<{ game_id: string | null; snowball_pot_id: string }[]>();
  if (historyError) return null;

  const sessionById = new Map((sessions ?? []).map((s) => [s.id, s]));
  const settled = new Set((history ?? []).map((h) => `${h.snowball_pot_id}:${h.game_id}`));

  return finishedGames
    .filter((g) => {
      const session = sessionById.get(g.session_id);
      return !!session && session.is_test_session !== true && !settled.has(`${g.snowball_pot_id}:${g.id}`);
    })
    .map((g) => {
      const session = sessionById.get(g.session_id)!;
      return {
        gameId: g.id,
        gameName: g.name,
        gameIndex: g.game_index,
        sessionName: session.name,
        sessionStartDate: session.start_date,
        endedAt: endedAtByGame.get(g.id) ?? null,
      };
    })
    .sort((a, b) => (b.endedAt ?? '').localeCompare(a.endedAt ?? ''));
}

export default async function HostPage() {
  const supabase = await createClient();
  
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  // Authentication is not authorisation. This used to be `if (!user)` alone,
  // which was safe only while every account that could exist was already staff.
  // New accounts land as 'pending', so a signed-in stranger would otherwise
  // render the whole host console and every button on it, and be refused only
  // once they pressed something. RLS and assert_is_host() would still deny the
  // data, but a screen that looks live and does nothing is worse than a screen
  // that says why.
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single<Pick<Database['public']['Tables']['profiles']['Row'], 'role'>>();

  if (profile?.role !== 'admin' && profile?.role !== 'host') {
    redirect('/pending');
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

  // Admin only: see findUnsettledSnowballGames. null means the check failed.
  const unsettledSnowballGames = profile?.role === 'admin'
    ? await findUnsettledSnowballGames(supabase)
    : [];

  return (
    <div className="min-h-screen-safe anchor-theme bg-[#003f27] text-white pb-20">
       <header className="p-4 flex justify-between items-center border-b border-[#1f7c58] bg-[#005131]/95 backdrop-blur-sm sticky top-0 z-10">
          <div className="flex items-center gap-3">
            <Link href="/" className="relative w-32 h-10 block opacity-100 hover:opacity-70 transition-opacity">
              <Image src="/the-anchor-pub-logo-white-transparent.png" alt="The Anchor" fill className="object-contain object-left" />
            </Link>
            <h1 className="font-bold text-lg text-white">Host Console</h1>
          </div>
          <div className="flex items-center gap-4">
             <Link href="/" className="text-sm text-white/70 hover:text-white">← Home</Link>
             <span className="text-xs text-white/80 hidden sm:inline-block">{user.email}</span>
             <form action={signout}>
                <Button variant="ghost" size="sm" className="text-white hover:bg-[#0f6846]">Sign Out</Button>
             </form>
          </div>
       </header>
      <main className="p-4">
        <HostDashboard
          sessions={sessions}
          unsettledSnowballGames={unsettledSnowballGames ?? []}
          settlementCheckFailed={unsettledSnowballGames === null}
        />
      </main>
    </div>
  );
}
