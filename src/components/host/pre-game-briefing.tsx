import React from 'react';
import { TriangleAlert } from 'lucide-react';
import { Database } from '@/types/database';
import { CALL_RESPONSES, HOW_TO_WIN, getHouseRules } from '@/lib/house-rules';
import { getColourName } from '@/lib/colour-name';
import { formatPounds } from '@/lib/snowball';
import { Kicker } from '@/components/ui/kicker';

type Game = Database['public']['Tables']['games']['Row'];
type SnowballPot = Database['public']['Tables']['snowball_pots']['Row'];

interface PreGameBriefingProps {
  game: Game;
  currentSnowballPot: SnowballPot | null;
  isFirstGameOfSession: boolean;
}

// A row on the raised green: a prize in the ladder, a call-and-response tile.
const RAISED_ROW = 'rounded-card border border-line bg-anchor-green-raised';

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
    <div className="flex w-full flex-col gap-[18px] text-left">
      {/* Which game this is. The colour word is there as well as the dot: the
          host cannot be asked to tell books apart by colour alone. */}
      <div className="flex flex-col gap-1.5 border-b border-line-gold pb-3.5">
        <Kicker>
          Game {game.game_index} · {game.type ?? 'standard'}
        </Kicker>
        <h2 className="text-[30px] leading-[1.05] text-anchor-cream-text">{game.name}</h2>
        <span className="inline-flex items-center gap-2 text-[15px] font-semibold">
          <span
            aria-hidden
            className="inline-block h-3.5 w-3.5 shrink-0 rounded-full border border-anchor-cream-text"
            style={{ backgroundColor: game.background_colour ?? 'transparent' }}
          />
          {colourName} book
        </span>
      </div>

      {/* Prize ladder */}
      <div>
        <Kicker as="p" className="mb-2.5">
          Tonight you can win
        </Kicker>
        <ul className="flex flex-col gap-1.5">
          {stages.map((stage, i) => {
            const prize = prizes[stage];
            return (
              <li
                key={stage}
                className={`flex items-center justify-between gap-3 px-3.5 py-2.5 ${RAISED_ROW}`}
              >
                <span className="text-base font-semibold">
                  <span className="font-medium text-anchor-sage">{i + 1}.</span> {stage}
                </span>
                {prize ? (
                  <span className="text-right font-display text-[22px] leading-tight text-anchor-gold-bright">
                    {prize}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-right text-[15px] font-semibold text-anchor-danger-text">
                    <TriangleAlert aria-hidden="true" size={18} className="shrink-0" />
                    Prize not set
                  </span>
                )}
              </li>
            );
          })}
        </ul>
        {isSnowball && currentSnowballPot && (
          <div className="mt-1.5 flex items-center justify-between gap-3 rounded-card border border-line-gold bg-anchor-green-raised px-3.5 py-2.5">
            <span className="flex flex-col gap-0.5">
              <span className="text-base font-semibold">Snowball jackpot</span>
              <span className="text-[13px] text-anchor-sage">
                Full House within the first {currentSnowballPot.current_max_calls} calls
              </span>
            </span>
            <span className="text-right font-display text-[22px] leading-tight text-anchor-gold-bright">
              £{formatPounds(Number(currentSnowballPot.current_jackpot_amount))}
            </span>
          </div>
        )}
      </div>

      {/* House rules and how to win, first game only. The approved wording
          (spec 5.3); rule 8 appears when this game's snowball pot is known. */}
      {isFirstGameOfSession && (
        <>
          <div className="border-t border-line-gold pt-3.5">
            <Kicker as="p" className="mb-2.5">
              House rules
            </Kicker>
            <ol className="flex flex-col gap-2">
              {houseRules.map((rule, i) => (
                <li key={i} className="flex gap-2.5 text-[15px] leading-[1.45]">
                  <span
                    aria-hidden
                    className="min-w-[18px] shrink-0 font-display text-lg leading-[1.2] text-anchor-gold-bright"
                  >
                    {i + 1}
                  </span>
                  <span>{rule}</span>
                </li>
              ))}
            </ol>
          </div>
          <div className="border-t border-line-gold pt-3.5">
            <Kicker as="p" className="mb-2.5">
              How to win
            </Kicker>
            <ul className="flex flex-col gap-1.5 text-[15px] leading-[1.45]">
              {HOW_TO_WIN.map((line) => (
                <li key={line.stage}>
                  <strong className="font-bold">{line.stage}:</strong> {line.text}
                </li>
              ))}
            </ul>
          </div>
        </>
      )}

      {/* Call and response prompts, first game only */}
      {isFirstGameOfSession && (
        <div className="border-t border-line-gold pt-3.5">
          <Kicker as="p" className="mb-2.5">
            Remind the room
          </Kicker>
          <ul className="grid grid-cols-2 gap-1.5">
            {CALL_RESPONSES.map((call) => (
              <li key={call.number} className={`flex flex-col gap-0.5 px-3 py-2.5 ${RAISED_ROW}`}>
                <span className="font-display text-2xl leading-none text-anchor-gold-bright">{call.number}</span>
                <span className="text-sm font-medium">{call.response}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
