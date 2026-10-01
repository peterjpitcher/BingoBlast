import React from 'react';
import { createClient } from '@/utils/supabase/server';
import { redirect } from 'next/navigation';
import SnowballList from './snowball-list';
import { PotHistory } from './pot-history';
import type { Database } from '@/types/database';

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

  // The admin layout draws the header, the footer and the page container. The
  // page header sits in SnowballList, because its New pot action is
  // client-side.
  return (
    <>
      <SnowballList pots={pots || []} />

      <PotHistory rows={(history ?? []) as React.ComponentProps<typeof PotHistory>['rows']} />
    </>
  );
}
