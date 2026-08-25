import { redirect } from 'next/navigation';

import { signout } from '@/app/login/actions';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { createClient } from '@/utils/supabase/server';
import type { Database } from '@/types/database';

/**
 * Where an account with no staff role lands.
 *
 * Accounts are created as `pending` and are inert until an admin promotes them.
 * Without this screen such an account would be bounced between `/login` and the
 * landing page with nothing explaining why, which reads as a broken sign-in
 * rather than as a deliberate refusal.
 *
 * Deliberately says nothing about who to contact through the app: there is no
 * in-app request flow, and inventing one here would imply a queue nobody reads.
 */
export default async function PendingPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single<Pick<Database['public']['Tables']['profiles']['Row'], 'role'>>();

  // Someone who has since been promoted should not be stranded here.
  if (profile?.role === 'admin') {
    redirect('/admin');
  }
  if (profile?.role === 'host') {
    redirect('/host');
  }

  return (
    <div className="min-h-screen-safe flex flex-col items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-center">This account is not active yet</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-center">
          <p className="text-white/85">
            You are signed in as <span className="font-semibold">{user.email}</span>, but the account
            has not been given a role yet, so there is nothing for it to open.
          </p>
          <p className="text-sm text-white/70">
            Staff accounts are activated by an administrator. Ask whoever set up your account to
            turn it on, then sign in again.
          </p>
          <form action={signout}>
            <Button type="submit" variant="outline" className="w-full">
              Sign out
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
