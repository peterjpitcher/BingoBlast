import React from 'react';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { signOutFromForm } from '@/app/auth/actions';
import AdminDashboard from './dashboard';
import { Button, Card, Kicker } from '@anchor-nights/kit/ui';
import { readStaffProfile } from '@/lib/auth/staff-role';
import { TvDevicesPanel } from '@anchor-nights/kit/pairing/screens';
import { revokeTv } from '@/app/tv/actions';
import { tvPairing } from '@/lib/tv-pairing';
import { reportError } from '@/lib/report-error';

/** The paired TVs, or null when they could not be read (shown as an error, never as "no TVs"). */
async function listPairedTvs() {
  try {
    return await tvPairing().actions.listTvDevices();
  } catch (error) {
    await reportError({ scope: 'admin:listTvDevices' }, error);
    return null;
  }
}

export default async function AdminPage() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  // Check role
  const { data: profile } = await readStaffProfile(supabase);

  if (profile?.role !== 'admin') {
    return (
      <div className="flex flex-1 flex-col items-center justify-center">
        <Card className="flex w-full max-w-md flex-col items-center gap-3.5 px-5 py-6 text-center">
          <Kicker>Admin</Kicker>
          <h1 className="text-[28px] leading-[1.05] text-anchor-cream-text">Access denied</h1>
          <p className="text-[15px] leading-normal text-anchor-sage">You do not have administrator privileges.</p>
          <form action={signOutFromForm} className="mt-2 w-full">
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

  // Paired pub TVs (spec S3.1): admin only. listTvDevices re-checks the
  // caller is an active admin and answers null otherwise or on an outage.
  const tvs = await listPairedTvs();

  // The header, the footer and the page container come from the admin layout.
  return (
    <>
      <AdminDashboard sessions={sessions || []} />
      {tvs === null ? (
        <p role="alert" className="text-[15px] text-anchor-danger-text">
          The paired TVs could not be loaded. Refresh to try again; if it keeps failing, check /admin/errors.
        </p>
      ) : (
        <TvDevicesPanel devices={tvs} revokeAction={revokeTv} />
      )}
    </>
  );
}
