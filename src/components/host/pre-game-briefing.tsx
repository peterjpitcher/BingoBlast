import React from 'react';
import { Database } from '@/types/database';
import { CALL_RESPONSES, HOW_TO_WIN, getHouseRules } from '@/lib/house-rules';
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
  const houseRules = getHouseRules(currentSnowballPot);

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
        <p className="text-sm uppercase tracking-[0.18em] text-[#f3d59d] font-semibold mb-2">
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
                <span className="text-base font-bold text-white">
                  Stage {i + 1}: {stage}
                </span>
                <span
                  className={cn(
                    'text-base font-semibold ml-3 text-right',
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
          <p className="text-base text-white/85 mt-2">
            Snowball jackpot: £{formatPounds(Number(currentSnowballPot.current_jackpot_amount))}
            {' '}(within first {currentSnowballPot.current_max_calls} calls).
          </p>
        )}
      </div>

      {/* House rules and how to win, first game only. The approved wording
          (spec 5.3); rule 8 appears when this game's snowball pot is known. */}
      {isFirstGameOfSession && (
        <div className="border-t border-[#1f7c58] pt-3">
          <p className="text-sm uppercase tracking-[0.18em] text-[#f3d59d] font-semibold mb-2">
            House rules
          </p>
          <ol className="space-y-1.5">
            {houseRules.map((rule, i) => (
              <li key={i} className="flex gap-2 items-start text-sm leading-snug text-white/95">
                <span aria-hidden className="shrink-0 font-bold text-[#f3d59d]">
                  {i + 1}.
                </span>
                <span>{rule}</span>
              </li>
            ))}
          </ol>
          <p className="text-sm uppercase tracking-[0.18em] text-[#f3d59d] font-semibold mt-3 mb-2">
            How to win
          </p>
          <ul className="space-y-1">
            {HOW_TO_WIN.map((line) => (
              <li key={line.stage} className="text-sm leading-snug text-white/95">
                <span className="font-bold">{line.stage}:</span> {line.text}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Call and response prompts, first game only */}
      {isFirstGameOfSession && (
        <div className="border-t border-[#1f7c58] pt-3 mt-3">
          <p className="text-sm uppercase tracking-[0.18em] text-[#f3d59d] font-semibold mb-2">
            Remind the room
          </p>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {CALL_RESPONSES.map((call) => (
              <li
                key={call.number}
                className="flex items-center justify-between bg-[#003f27]/70 border border-[#1f7c58] rounded-lg px-3 py-2"
              >
                <span className="text-sm font-bold text-white">{call.number}</span>
                <span className="text-sm font-semibold ml-3 text-right text-[#f3d59d]">
                  {call.response}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
