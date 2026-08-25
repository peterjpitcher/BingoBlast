import React from 'react';
import { createClient } from '@/utils/supabase/server';
import { redirect } from 'next/navigation';
import { signout } from '@/app/login/actions';
import SnowballList from './snowball-list';
import { PotHistory } from './pot-history';
import type { Database } from '@/types/database';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default async function SnowballAdminPage() {
  const supabase = await createClient();
  
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  // Check role
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single<{ role: Database['public']['Tables']['profiles']['Row']['role'] }>();
    
  if (profile?.role !== 'admin') {
    redirect('/');
  }

  // Live pots only. An archived pot is retired, not deleted: its history and
  // its links from played games are kept, but it has no business appearing in a
  // list of things you can edit, reset or attach to tonight's game.
  const { data: pots } = await supabase
    .from('snowball_pots')
    .select('*')
    .is('archived_at', null)
    .order('created_at', { ascending: false });

  // The pot's audit trail. Written since 29 July and, until now, read by
  // nothing at all, so "how did the jackpot get to its current figure?" had no
  // answer in the app even though the rows to answer it existed.
  const { data: history } = await supabase
    .from('snowball_pot_history')
    .select('*, pot:snowball_pots (name)')
    .order('created_at', { ascending: false })
    .limit(100);

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="container mx-auto p-6 space-y-8">
        {/* Header Section */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-6 border-b border-slate-800">
          <div className="flex items-center gap-4">
            <Link href="/admin">
              <Button variant="secondary" size="sm" className="gap-2">
                ← Dashboard
              </Button>
            </Link>
            <h1 className="text-2xl font-bold tracking-tight text-white">Snowball Management</h1>
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
      
        <SnowballList pots={pots || []} />

        <PotHistory rows={(history ?? []) as React.ComponentProps<typeof PotHistory>['rows']} />
      </div>
    </div>
  );
}
