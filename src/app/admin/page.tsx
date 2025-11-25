import React from 'react';
import { createClient } from '@/utils/supabase/server';
import { redirect } from 'next/navigation';
import { signout } from '@/app/login/actions';
import AdminDashboard from './dashboard';
import type { Database } from '@/types/database';
import { Button } from '@/components/ui/button';

export default async function AdminPage() {
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
    return (
      <div className="min-h-screen-safe flex flex-col items-center justify-center text-center bg-slate-950 text-white p-4">
        <h1 className="text-3xl font-bold text-red-500 mb-2">Access Denied</h1>
        <p className="text-slate-400 mb-6">You do not have administrator privileges.</p>
        <form action={signout}>
          <Button variant="secondary">Sign Out</Button>
        </form>
      </div>
    )
  }

  // Fetch Sessions
  const { data: sessions } = await supabase
    .from('sessions')
    .select('*')
    .order('created_at', { ascending: false });

  return (
    <div className="min-h-screen-safe bg-slate-950 text-white pb-20">
      <header className="bg-slate-900 border-b border-slate-800 p-4 mb-6">
        <div className="container mx-auto flex justify-between items-center">
          <div className="flex items-center gap-6">
            <h1 className="text-xl font-bold text-bingo-primary">Admin Dashboard</h1>
            <a href="/admin/snowball">
              <Button variant="secondary" size="sm" className="text-indigo-300 border-indigo-500/30 hover:bg-indigo-900/20">
                ❄️ Manage Snowballs
              </Button>
            </a>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-slate-400 hidden sm:inline-block">{user.email}</span>
            <form action={signout}>
              <Button variant="ghost" size="sm" className="text-red-400 hover:bg-red-900/20 hover:text-red-300">Sign Out</Button>
            </form>
          </div>
        </div>
      </header>
      
      <main className="container mx-auto px-4">
        <AdminDashboard sessions={sessions || []} />
      </main>
    </div>
  );
}