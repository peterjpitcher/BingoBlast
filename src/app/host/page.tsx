import React from 'react';
import { createClient } from '@/utils/supabase/server';
import { redirect } from 'next/navigation';
import { signout } from '@/app/login/actions';
import HostDashboard from './dashboard';
import { listUnsettledSnowballGames } from './actions';
import { Database } from '@/types/database';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Kicker } from '@/components/ui/kicker';
import { HostHeader } from '@/components/host/host-header';

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
        <div className="flex min-h-screen-safe flex-col items-center justify-center bg-anchor-green-deep p-4 text-anchor-cream-text">
            <Card className="flex w-full max-w-md flex-col items-center gap-3.5 px-5 py-6 text-center">
                <Kicker>Host console</Kicker>
                <h1 className="text-[28px] leading-[1.05] text-anchor-cream-text">Error loading sessions</h1>
                <p className="text-[15px] leading-normal text-anchor-sage">Could not retrieve sessions. Please try again later.</p>
                <form action={signout} className="mt-1.5 w-full">
                    <Button type="submit" variant="outline" block>Sign out</Button>
                </form>
            </Card>
        </div>
    );
  }

  const sessions: SessionWithGames[] = (sessionsData || []) as SessionWithGames[];

  // Finished snowball games whose pot never settled (X6), for hosts and admins
  // alike: see listUnsettledSnowballGames. A failed read shows a warning rather
  // than an empty list, which would read as "every pot has settled".
  const unsettled = await listUnsettledSnowballGames();

  return (
    <div className="min-h-screen-safe bg-anchor-green-deep pb-[60px] text-anchor-cream-text">
      <HostHeader title="Host console">
        <span className="truncate text-xs text-anchor-sage">{user.email}</span>
      </HostHeader>
      {/* The design is a phone: one 16px-gutter column. On a tablet or laptop
          the column keeps its proportions and sits centred. */}
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4">
        <HostDashboard
          sessions={sessions}
          unsettledSnowballGames={unsettled.success ? (unsettled.data ?? []) : []}
          settlementCheckFailed={!unsettled.success}
        />
      </main>
    </div>
  );
}
