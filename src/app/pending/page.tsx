import { redirect } from 'next/navigation';

import { signout } from '@/app/login/actions';
import { BrandBackdrop } from '@/components/brand-backdrop';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Kicker } from '@/components/ui/kicker';
import { AnchorLogo } from '@/components/ui/logo';
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
    <div className="relative flex min-h-screen-safe flex-col overflow-hidden bg-anchor-green-deep">
      <BrandBackdrop />

      <div className="relative mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-7 px-5 pb-10 pt-[calc(env(safe-area-inset-top)+2rem)]">
        <div className="flex justify-center">
          <AnchorLogo height={80} priority />
        </div>

        <Card className="flex flex-col items-center gap-3.5 px-5 py-6 text-center">
          <Kicker>Nearly there</Kicker>
          <h1 className="text-[28px] leading-[1.05] text-anchor-cream-text">This account is not active yet</h1>
          <p className="text-[15px] leading-normal">
            You are signed in as <strong className="break-all font-semibold">{user.email}</strong>, but the account
            has not been given a role yet, so there is nothing for it to open.
          </p>
          <p className="text-sm leading-normal text-anchor-sage">
            Staff accounts are switched on by an administrator. Ask whoever set up your account,
            then sign in again.
          </p>
          <form action={signout} className="mt-1.5 w-full">
            <Button type="submit" variant="outline" block>
              Sign out
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
