import React from 'react';
import { createClient } from '@/utils/supabase/server';
import { redirect } from 'next/navigation';
import { signout } from '@/app/login/actions';
import SnowballList from './snowball-list';
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

  // Fetch Snowball Pots
  const { data: pots } = await supabase
    .from('snowball_pots')
    .select('*')
    .order('created_at', { ascending: false });

  return (
    <div className="container py-4">
      <div className="d-flex justify-content-between align-items-center mb-4">
        <div className="d-flex align-items-baseline gap-3">
            <a href="/admin" className="btn btn-outline-secondary btn-sm">&larr; Dashboard</a>
            <h1 className="h3 m-0">Snowball Management</h1>
        </div>
        <div className="d-flex align-items-center gap-3">
          <span className="text-muted small">{user.email}</span>
          <form action={signout}>
            <button className="btn btn-outline-danger btn-sm">Sign Out</button>
          </form>
        </div>
      </div>
      
      <SnowballList pots={pots || []} />
    </div>
  );
}
