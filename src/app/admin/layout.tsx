import React from 'react';
import { unstable_rethrow } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import { Header } from '@/components/header';
import { copyrightText } from '@/components/copyright-line';
import { Grain } from '@/components/ui/logo';

interface AdminHeaderState {
  email: string | null;
  isNightRunning: boolean;
}

/**
 * What the admin header shows about the signed-in user and tonight: the email
 * and whether a session is running. Both are decoration. A read that fails or
 * finds nothing leaves its part of the header out; it never redirects and
 * never throws, because each admin page does its own auth check and redirect.
 */
async function readHeaderState(): Promise<AdminHeaderState> {
  const state: AdminHeaderState = { email: null, isNightRunning: false };

  try {
    const supabase = await createClient();

    const { data: { user } } = await supabase.auth.getUser();
    state.email = user?.email ?? null;

    const { data: running } = await supabase
      .from('sessions')
      .select('id')
      .eq('status', 'running')
      .limit(1);
    state.isNightRunning = (running?.length ?? 0) > 0;
  } catch (error) {
    // Next's own control-flow signals (dynamic rendering, redirects) are not
    // failures and must pass through.
    unstable_rethrow(error);
  }

  return state;
}

/**
 * The admin shell: the dark page with film grain, the sticky admin header, the
 * page in a centred 1280px container, and the footer. The global page shell
 * draws no header or footer, so this is where the admin's live.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<React.ReactElement> {
  const { email, isNightRunning } = await readHeaderState();

  return (
    <div className="relative flex flex-1 flex-col bg-anchor-green-deep text-anchor-cream-text">
      <Grain />
      <Header email={email} isNightRunning={isNightRunning} />

      <div className="relative mx-auto flex w-full max-w-[1280px] flex-1 flex-col gap-7 px-4 pb-16 pt-9 sm:px-6 lg:px-10">
        {children}
      </div>

      <footer className="relative border-t border-line-gold">
        <div className="mx-auto flex w-full max-w-[1280px] flex-wrap justify-between gap-x-6 gap-y-1 px-4 py-5 text-xs text-anchor-sage sm:px-6 lg:px-10">
          <span suppressHydrationWarning>{copyrightText()}</span>
          <span>The Anchor, Stanwell Moor · since 1751</span>
        </div>
      </footer>
    </div>
  );
}
