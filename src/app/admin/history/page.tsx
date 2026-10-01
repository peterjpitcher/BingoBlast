import React from 'react';
import { createClient } from '@/utils/supabase/server';
import { redirect } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Kicker } from '@/components/ui/kicker';
import { cn } from '@/lib/utils';
import type { Database } from '@/types/database';
import { formatShortDateTimeInLondon } from '@/lib/dates';
import { describeWinnerTotal, formatPence, JACKPOT_NOT_RECORDED, totalPaidOutPence, winnerTotalPence } from '@/lib/money';

type WinnerWithRelations = Database['public']['Tables']['winners']['Row'] & {
  session: Pick<Database['public']['Tables']['sessions']['Row'], 'name' | 'start_date'> | null;
  game: Pick<Database['public']['Tables']['games']['Row'], 'name' | 'type'> | null;
};

// The admin table (design handoff, section 6): small sage column heads over a
// gold hairline, 15px cream cells, a hairline between rows and a faint gold
// wash on hover. A voided winner's row is dimmed instead.
const TH = "whitespace-nowrap border-b border-line-gold px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-[0.1em] text-anchor-sage";
const TD = "px-5 py-4 align-middle text-[15px]";
const ROW_BASE = "border-b border-line transition-colors duration-150 last:border-b-0";
const ROW = `${ROW_BASE} hover:bg-anchor-gold-bright/[0.05]`;
const ROW_VOID = `${ROW_BASE} opacity-[0.55]`;

const STAT_CARD = "flex flex-col gap-1.5 px-6 py-5";
const STAT_VALUE = "font-display text-5xl leading-none";
const STAT_HINT = "text-[13px] text-anchor-sage";

export default async function HistoryPage() {
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

  const { data: winnersRaw, error } = await supabase
    .from('winners')
    .select(`
      *,
      session:sessions (name, start_date),
      game:games (name, type)
    `)
    .order('created_at', { ascending: false });

  const winners: WinnerWithRelations[] = (winnersRaw ?? []) as WinnerWithRelations[];

  // Totals the SHARES, never the amounts. On a tied stage the amount is the
  // whole prize and appears on every tied row, so totalling it counts one £10
  // prize as £20. Ten ties already exist in the data, two of them cash
  // jackpots, so this is the difference between a real figure and one that
  // overstates what the pub paid. Voided wins carry no share and drop out.
  // Each winner's share is the ordinary share plus the snowball jackpot share
  // (X22): the jackpot used to be missing from this total altogether.
  const payout = totalPaidOutPence(winners.filter((w) => w.is_void !== true));

  if (error) {
      console.error("Error fetching history:", error);
  }

  // The admin layout draws the header, the footer and the page container.
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <Kicker>Admin</Kicker>
        <h1 className="text-[44px] leading-none text-anchor-cream-text">Winners</h1>
        <p className="max-w-[70ch] text-base text-anchor-sage">
          Every win, every night. Voided wins are excluded from the total; a shared prize counts once.
        </p>
      </div>

      <div
        className={cn(
          "grid grid-cols-1 gap-4 sm:grid-cols-3",
          payout.jackpotNotRecordedRows > 0 && "sm:grid-cols-2 lg:grid-cols-4"
        )}
      >
        <Card accent className={STAT_CARD}>
          <Kicker className="text-[11px]">Total paid out</Kicker>
          <span className={cn(STAT_VALUE, "text-anchor-gold-bright")}>
            {formatPence(payout.totalPence)}
          </span>
          <span className={STAT_HINT}>Voided wins are not counted</span>
        </Card>
        <Card className={STAT_CARD}>
          <Kicker className="text-[11px]">Cash prizes</Kicker>
          <span className={STAT_VALUE}>{payout.countedRows}</span>
          <span className={STAT_HINT}>Counted in the total</span>
        </Card>
        <Card className={STAT_CARD}>
          <Kicker className="text-[11px]">Not cash</Kicker>
          <span className={STAT_VALUE}>{payout.uncountedRows}</span>
          <span className={STAT_HINT}>Prizes that are not cash</span>
        </Card>
        {payout.jackpotNotRecordedRows > 0 && (
          <Card className={STAT_CARD}>
            <Kicker className="text-[11px]">Jackpots not recorded</Kicker>
            <span className={STAT_VALUE}>{payout.jackpotNotRecordedRows}</span>
            <span className={STAT_HINT}>Jackpots missing from the total</span>
          </Card>
        )}
      </div>

      <p className="max-w-[90ch] text-[13px] text-anchor-sage">
        Each winner&rsquo;s share is added, not the whole prize per winner, and a snowball jackpot
        share is added to the stage prize. Shares on wins recorded before 25 August 2026 are the
        current sharing rule applied to older records. Where a jackpot win says
        &ldquo;{JACKPOT_NOT_RECORDED}&rdquo;, the jackpot is not in the total.
      </p>

      <Card className="overflow-hidden">
        {!winners || winners.length === 0 ? (
            <p className="px-5 py-8 text-[15px] text-anchor-sage">No winners recorded yet.</p>
        ) : (
            <div className="overflow-x-auto">
                <table className="w-full min-w-[980px] border-collapse text-left">
                    <thead>
                        <tr>
                            <th className={TH}>Date</th>
                            <th className={TH}>Session · Game</th>
                            <th className={TH}>Stage</th>
                            <th className={TH}>Prize</th>
                            <th className={TH}>Paid</th>
                            <th className={TH}>Call</th>
                            <th className={cn(TH, "text-right")}>Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        {winners.map((winner) => {
                            // A voided win is not a payout, and this screen
                            // is the permanent record of who was paid. It
                            // used to render voided rows identically to
                            // real ones: same prize, same JACKPOT badge,
                            // nothing saying it had been reversed. Anyone
                            // reconciling a night against the till was
                            // reading a number that was never handed over.
                            const isVoid = winner.is_void === true;
                            const total = winnerTotalPence(winner);
                            const totalLine = describeWinnerTotal(total);
                            // A share differs from its pool on a tie. Only
                            // the ordinary share can be compared here: a
                            // jackpot winner's total adds the jackpot.
                            const showShareOf = winner.prize_amount_pence !== null
                              && winner.prize_amount_pence !== winner.prize_share_pence
                              && winner.prize_share_pence !== null;
                            return (
                            <tr key={winner.id} className={isVoid ? ROW_VOID : ROW}>
                                <td className={cn(TD, "whitespace-nowrap text-anchor-sage")}>{formatShortDateTimeInLondon(winner.created_at)}</td>
                                <td className={TD}>
                                    <div className="font-semibold">{winner.session?.name}</div>
                                    <div className="text-[13px] text-anchor-sage">{winner.game?.name}</div>
                                </td>
                                <td className={TD}>
                                    <Badge variant="outline">{winner.stage}</Badge>
                                </td>
                                <td className={TD}>
                                    <span className={cn(isVoid && "line-through")}>
                                        {winner.prize_description}
                                    </span>
                                    {winner.is_snowball_jackpot && (
                                        <Badge variant="gold" className="ml-2">Jackpot</Badge>
                                    )}
                                </td>
                                <td className={cn(TD, "whitespace-nowrap")}>
                                    {isVoid ? (
                                        <span className="text-anchor-sage">-</span>
                                    ) : totalLine !== null ? (
                                        <>
                                            <span
                                              className={
                                                total.totalPence !== null && !total.jackpotNotRecorded
                                                  ? "font-display text-xl leading-tight text-anchor-gold-bright"
                                                  : "text-sm"
                                              }
                                            >
                                                {totalLine}
                                            </span>
                                            {showShareOf && (
                                                <span className="block text-[13px] text-anchor-sage">
                                                    prize share of {formatPence(winner.prize_amount_pence)}
                                                </span>
                                            )}
                                        </>
                                    ) : (
                                        <span className="text-[13px] text-anchor-sage">Not cash</span>
                                    )}
                                </td>
                                <td className={cn(TD, "tabular-nums text-anchor-sage")}>{winner.call_count_at_win}</td>
                                <td className={cn(TD, "text-right")}>
                                    {isVoid ? (
                                        <div className="inline-flex flex-col items-end gap-1">
                                            <Badge variant="danger">Void</Badge>
                                            {winner.void_reason && (
                                                <div className="max-w-[16rem] text-right text-[13px]">{winner.void_reason}</div>
                                            )}
                                        </div>
                                    ) : winner.prize_given ? (
                                        <Badge variant="success">Given</Badge>
                                    ) : (
                                        <Badge variant="gold">Outstanding</Badge>
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
