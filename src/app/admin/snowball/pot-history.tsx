import React from 'react';

import { Card } from '@/components/ui/card';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { formatPounds } from '@/lib/snowball';
import { formatShortDateTimeInLondon } from '@/lib/dates';
import type { Database } from '@/types/database';

type PotHistoryRow = Database['public']['Tables']['snowball_pot_history']['Row'] & {
  pot: Pick<Database['public']['Tables']['snowball_pots']['Row'], 'name'> | null;
};

interface PotHistoryProps {
  rows: PotHistoryRow[];
}

// The admin table (design handoff, section 6): small sage column heads over a
// gold hairline, 15px cream cells, a hairline between rows and a faint gold
// wash on hover.
const TH = "whitespace-nowrap border-b border-line-gold px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-[0.1em] text-anchor-sage";
const TD = "px-5 py-4 align-middle text-[15px]";
const ROW = "border-b border-line transition-colors duration-150 last:border-b-0 hover:bg-anchor-gold-bright/[0.05]";

interface ChangeLabel {
  text: string;
  variant: BadgeVariant;
  className?: string;
}

/**
 * The pot's own audit trail, on screen.
 *
 * snowball_pot_history has been written since July and read by nothing. So the
 * question "how did the jackpot get to £140?" had no answer anywhere in the app,
 * even though the rows to answer it were being created. This is the whole reason
 * the table exists.
 */
const CHANGE_LABEL: Record<string, ChangeLabel> = {
  rollover: { text: 'Rolled over', variant: 'outline' },
  jackpot_won: { text: 'Jackpot won', variant: 'gold' },
  manual_update: { text: 'Manual correction', variant: 'outline' },
  manual_reset: { text: 'Manual reset', variant: 'danger' },
  // Derived from the pot's own arithmetic long after the fact, not observed at
  // the time. Rendered differently on purpose: a reconstructed row must never
  // read as a recorded one.
  reconstructed_rollover: { text: 'Rolled over (reconstructed)', variant: 'outline', className: 'border-dashed text-anchor-sage' },
};

export function PotHistory({ rows }: PotHistoryProps) {
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-2 border-b border-line-gold px-5 py-[18px]">
        <h2 className="text-[26px] leading-none text-anchor-cream-text">Pot history</h2>
        <p className="max-w-2xl text-[13px] text-anchor-sage">
          Rows marked <span className="text-anchor-cream-text">reconstructed</span> were worked out from the
          pot&rsquo;s own base and increment figures after the fact, because nothing was recording
          movements before 29 July 2026. They explain how the pot reached its current figure; they
          are not a record made on the night.
        </p>
      </div>
      {rows.length === 0 ? (
        <div className="flex flex-col gap-1.5 px-5 py-8">
          <p className="text-[15px] text-anchor-sage">No pot movements recorded yet.</p>
          <p className="max-w-lg text-[13px] text-anchor-sage">
            Movements have only been recorded since 29 July 2026, when the audit table was added.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-left">
            <thead>
              <tr>
                <th className={TH}>When</th>
                <th className={TH}>Pot</th>
                <th className={TH}>What happened</th>
                <th className={TH}>Jackpot</th>
                <th className={TH}>Calls</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const label: ChangeLabel = CHANGE_LABEL[row.change_type ?? ''] ?? {
                  text: row.change_type ?? 'Unknown',
                  variant: 'outline',
                };
                return (
                  <tr key={row.id} className={ROW}>
                    <td className={`${TD} whitespace-nowrap text-anchor-sage`}>
                      {formatShortDateTimeInLondon(row.created_at)}
                    </td>
                    <td className={`${TD} font-semibold`}>{row.pot?.name ?? 'Unknown pot'}</td>
                    <td className={TD}>
                      <Badge variant={label.variant} className={label.className}>
                        {label.text}
                      </Badge>
                    </td>
                    <td className={`${TD} whitespace-nowrap tabular-nums`}>
                      {row.old_val_jackpot !== null && row.new_val_jackpot !== null ? (
                        <>£{formatPounds(Number(row.old_val_jackpot))} → £{formatPounds(Number(row.new_val_jackpot))}</>
                      ) : (
                        <span className="text-anchor-sage">Not recorded</span>
                      )}
                    </td>
                    <td className={`${TD} whitespace-nowrap tabular-nums`}>
                      {row.old_val_max !== null && row.new_val_max !== null ? (
                        <>{row.old_val_max} → {row.new_val_max} calls</>
                      ) : (
                        <span className="text-anchor-sage">Not recorded</span>
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
  );
}
