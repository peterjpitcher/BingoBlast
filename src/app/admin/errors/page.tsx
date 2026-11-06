import React from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import { Badge, Card, Kicker } from '@anchor-nights/kit/ui';
import { cn } from '@/lib/utils';
import { formatShortDateTimeInLondon } from '@/lib/dates';
import type { Database } from '@/types/database';

type AppErrorRow = Database['public']['Tables']['app_errors']['Row'];

// How many reports the page shows. list_app_errors_safe caps it at 200.
const LIMIT = 100;

// The admin table, as on the Winners page.
const TH = "whitespace-nowrap border-b border-line-gold px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-[0.1em] text-anchor-sage";
const TD = "px-5 py-4 align-top text-[15px]";
const ROW = "border-b border-line transition-colors duration-150 last:border-b-0 hover:bg-anchor-gold-bright/[0.05]";

function contextText(row: AppErrorRow, key: string): string | null {
  const value = row.context?.[key];
  return typeof value === 'string' && value ? value : null;
}

/**
 * The newest technical failures reported by src/lib/report-error.ts and stored
 * by /api/errors. Read only. Admin only, twice over: this page checks the role,
 * and list_app_errors_safe refuses anyone who is not an admin.
 */
export default async function ErrorsPage(): Promise<React.ReactElement> {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    redirect('/login');
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single<{ role: Database['public']['Tables']['profiles']['Row']['role'] }>();

  if (profile?.role !== 'admin') {
    redirect('/');
  }

  const { data, error } = await supabase.rpc('list_app_errors_safe', { p_limit: LIMIT });
  const rows: AppErrorRow[] = data ?? [];

  if (error) {
    console.error('[admin:errors] list_app_errors_safe failed', { code: error.code });
  }

  return (
    <>
      <div className="flex flex-col gap-1.5">
        <Kicker>Admin</Kicker>
        <h1 className="text-[44px] leading-none text-anchor-cream-text">Errors</h1>
        <p className="max-w-[70ch] text-base text-anchor-sage">
          Technical failures the app reported, newest first, up to {LIMIT}. Personal details are
          masked before they are stored. Times are UK time.
        </p>
      </div>

      <Card className="overflow-hidden">
        {error ? (
          // Fail closed: an unreadable list is not an empty one.
          <p role="alert" className="px-5 py-8 text-[15px] text-anchor-danger-text">
            The error reports could not be loaded. Refresh to try again; if it keeps failing, check
            the Vercel logs for &ldquo;admin:errors&rdquo;.
          </p>
        ) : rows.length === 0 ? (
          <p className="px-5 py-8 text-[15px] text-anchor-sage">No errors reported.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] border-collapse text-left">
              <thead>
                <tr>
                  <th className={TH}>When</th>
                  <th className={TH}>Where</th>
                  <th className={TH}>Message</th>
                  <th className={cn(TH, "text-right")}>Environment</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const code = contextText(row, 'code');
                  const environment = contextText(row, 'environment');
                  return (
                    <tr key={row.id} className={ROW}>
                      <td className={cn(TD, "whitespace-nowrap text-anchor-sage")}>
                        {formatShortDateTimeInLondon(row.created_at)}
                      </td>
                      <td className={TD}>
                        <div className="font-semibold">{row.source}</div>
                        {row.path && <div className="text-[13px] text-anchor-sage">{row.path}</div>}
                      </td>
                      <td className={cn(TD, "break-words")}>
                        {row.message}
                        {code && <Badge variant="outline" className="ml-2">{code}</Badge>}
                        {row.digest && (
                          <div className="text-[13px] text-anchor-sage">Digest {row.digest}</div>
                        )}
                      </td>
                      <td className={cn(TD, "text-right")}>
                        {environment && (
                          <Badge variant={environment === 'production' ? 'danger' : 'outline'}>
                            {environment}
                          </Badge>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
