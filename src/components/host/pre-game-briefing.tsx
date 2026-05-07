import React from 'react';
import { Database } from '@/types/database';
import { HOUSE_RULES } from '@/lib/house-rules';
import { getColourName } from '@/lib/colour-name';
import { formatPounds } from '@/lib/snowball';
import { cn } from '@/lib/utils';

type Game = Database['public']['Tables']['games']['Row'];
type SnowballPot = Database['public']['Tables']['snowball_pots']['Row'];

interface PreGameBriefingProps {
  game: Game;
  currentSnowballPot: SnowballPot | null;
  isFirstGameOfSession: boolean;
}

export function PreGameBriefing({
  game,
  currentSnowballPot,
  isFirstGameOfSession,
}: PreGameBriefingProps) {
  const colourName = getColourName(game.background_colour ?? '');
  const isSnowball = game.type === 'snowball';
  const stages = (game.stage_sequence ?? []) as string[];
  const prizes = (game.prizes ?? {}) as Record<string, string>;

  return (
    <div className="w-full text-left">
      {/* Header strip */}
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-[#1f7c58] pb-3 mb-4">
        <span className="text-2xl font-bold text-white">GAME {game.game_index}</span>
        <span className="text-sm font-semibold uppercase tracking-wider text-white/85">
          · {(game.type ?? 'standard').toUpperCase()}
        </span>
        <span className="ml-auto flex items-center gap-2 text-sm text-white/90">
          <span
            aria-hidden
            className="inline-block w-3 h-3 rounded-full border border-white/40"
            style={{ backgroundColor: game.background_colour ?? '#000000' }}
          />
          <span className="font-semibold">{colourName}</span>
          <span className="text-white/70">·</span>
          <span className="font-semibold">{game.name}</span>
        </span>
      </div>

      {/* Prize ladder */}
      <div className="mb-4">
        <p className="text-xs uppercase tracking-[0.18em] text-[#f3d59d] font-semibold mb-2">
          Tonight you can win
        </p>
        <ul className="space-y-1.5">
          {stages.map((stage, i) => {
            const prize = prizes[stage];
            return (
              <li
                key={stage}
                className="flex items-center justify-between bg-[#003f27]/70 border border-[#1f7c58] rounded-lg px-3 py-2"
              >
                <span className="text-sm font-bold text-white">
                  Stage {i + 1}: {stage}
                </span>
                <span
                  className={cn(
                    'text-sm font-semibold ml-3 text-right',
                    prize ? 'text-[#f3d59d]' : 'text-destructive'
                  )}
                >
                  {prize || '⚠️ Prize not set'}
                </span>
              </li>
            );
          })}
        </ul>
        {isSnowball && currentSnowballPot && (
          <p className="text-xs text-white/85 mt-2">
            Snowball jackpot: £{formatPounds(Number(currentSnowballPot.current_jackpot_amount))}
            {' '}(within first {currentSnowballPot.current_max_calls} calls).
          </p>
        )}
      </div>

      {/* House rules — first game only */}
      {isFirstGameOfSession && (
        <div className="border-t border-[#1f7c58] pt-3">
          <p className="text-xs uppercase tracking-[0.18em] text-[#f3d59d] font-semibold mb-2">
            House rules
          </p>
          <ul className="space-y-1.5">
            {HOUSE_RULES.map((rule, i) => (
              <li
                key={i}
                className={cn(
                  'flex gap-2 items-start text-xs leading-snug text-white/95',
                  rule.variant === 'closing' && 'pt-1'
                )}
              >
                <span aria-hidden className="text-white shrink-0">
                  {rule.icon}
                </span>
                {rule.variant === 'closing' ? (
                  <span className="font-bold italic">
                    {rule.segments.map((seg, j) =>
                      seg.bold ? (
                        <span key={j} className="font-bold">{seg.text}</span>
                      ) : (
                        <React.Fragment key={j}>{seg.text}</React.Fragment>
                      )
                    )}
                  </span>
                ) : (
                  <span>
                    {rule.segments.map((seg, j) =>
                      seg.bold ? (
                        <span key={j} className="font-bold">{seg.text}</span>
                      ) : (
                        <React.Fragment key={j}>{seg.text}</React.Fragment>
                      )
                    )}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
