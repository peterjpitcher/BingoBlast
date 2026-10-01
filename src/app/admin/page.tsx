import React from 'react';
import { createClient } from '@/utils/supabase/server';
import { redirect } from 'next/navigation';
import { signout } from '@/app/login/actions';
import AdminDashboard from './dashboard';
import type { Database } from '@/types/database';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Kicker } from '@/components/ui/kicker';

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
      <div className="flex flex-1 flex-col items-center justify-center">
        <Card className="flex w-full max-w-md flex-col items-center gap-3.5 px-5 py-6 text-center">
          <Kicker>Admin</Kicker>
          <h1 className="text-[28px] leading-[1.05] text-anchor-cream-text">Access denied</h1>
          <p className="text-[15px] leading-normal text-anchor-sage">You do not have administrator privileges.</p>
          <form action={signout} className="mt-2 w-full">
            <Button variant="outline" size="md" block>Sign out</Button>
          </form>
        </Card>
      </div>
    )
  }

  // Fetch Sessions
  const { data: sessions } = await supabase
    .from('sessions')
    .select('*')
    .order('created_at', { ascending: false });

  // The header, the footer and the page container come from the admin layout.
  return <AdminDashboard sessions={sessions || []} />;
}
