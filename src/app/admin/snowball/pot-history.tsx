import React from 'react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatPounds } from '@/lib/snowball';
import { formatShortDateTimeInLondon } from '@/lib/dates';
import type { Database } from '@/types/database';

type PotHistoryRow = Database['public']['Tables']['snowball_pot_history']['Row'] & {
  pot: Pick<Database['public']['Tables']['snowball_pots']['Row'], 'name'> | null;
};

interface PotHistoryProps {
  rows: PotHistoryRow[];
}

/**
 * The pot's own audit trail, on screen.
 *
 * snowball_pot_history has been written since July and read by nothing. So the
 * question "how did the jackpot get to £140?" had no answer anywhere in the app,
 * even though the rows to answer it were being created. This is the whole reason
 * the table exists.
 */
const CHANGE_LABEL: Record<string, { text: string; className: string }> = {
  rollover: { text: 'Rolled over', className: 'bg-slate-800 text-slate-300 border-slate-700' },
  jackpot_won: { text: 'Jackpot won', className: 'bg-yellow-900/40 text-yellow-300 border-yellow-800' },
  manual_update: { text: 'Manual correction', className: 'bg-blue-900/40 text-blue-300 border-blue-800' },
  manual_reset: { text: 'Manual reset', className: 'bg-red-900/40 text-red-300 border-red-800' },
  // Derived from the pot's own arithmetic long after the fact, not observed at
  // the time. Rendered differently on purpose: a reconstructed row must never
  // read as a recorded one.
  reconstructed_rollover: { text: 'Rolled over (reconstructed)', className: 'bg-slate-800 text-slate-400 border-dashed border-slate-600' },
};

export function PotHistory({ rows }: PotHistoryProps) {
  return (
    <Card className="bg-slate-900 border-slate-800">
      <CardHeader>
        <CardTitle>Pot history</CardTitle>
        <p className="text-xs text-slate-500 max-w-2xl">
          Rows marked <span className="text-slate-400">reconstructed</span> were worked out from the
          pot&rsquo;s own base and increment figures after the fact, because nothing was recording
          movements before 29 July 2026. They explain how the pot reached its current figure; they
          are not a record made on the night.
        </p>
      </CardHeader>
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <div className="p-8 text-center text-slate-500">
            <p>No pot movements recorded yet.</p>
            <p className="mt-2 text-xs text-slate-600 max-w-lg mx-auto">
              Movements have only been recorded since 29 July 2026, when the audit table was added.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-800/50 text-slate-400">
                <tr>
                  <th className="px-4 py-3 font-medium">When</th>
                  <th className="px-4 py-3 font-medium">Pot</th>
                  <th className="px-4 py-3 font-medium">What happened</th>
                  <th className="px-4 py-3 font-medium">Jackpot</th>
                  <th className="px-4 py-3 font-medium">Window</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {rows.map((row) => {
                  const label = CHANGE_LABEL[row.change_type ?? ''] ?? {
                    text: row.change_type ?? 'Unknown',
                    className: 'bg-slate-800 text-slate-300 border-slate-700',
                  };
                  return (
                    <tr key={row.id} className="hover:bg-slate-800/30 transition-colors">
                      <td className="px-4 py-3 text-slate-400 whitespace-nowrap">
                        {formatShortDateTimeInLondon(row.created_at)}
                      </td>
                      <td className="px-4 py-3 text-white">{row.pot?.name ?? 'Unknown pot'}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-bold border ${label.className}`}>
                          {label.text}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-slate-300 whitespace-nowrap">
                        {row.old_val_jackpot !== null && row.new_val_jackpot !== null ? (
                          <>£{formatPounds(Number(row.old_val_jackpot))} → £{formatPounds(Number(row.new_val_jackpot))}</>
                        ) : (
                          <span className="text-slate-600">not recorded</span>
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono text-slate-400 whitespace-nowrap">
                        {row.old_val_max !== null && row.new_val_max !== null ? (
                          <>{row.old_val_max} → {row.new_val_max} calls</>
                        ) : (
                          <span className="text-slate-600">not recorded</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
