// src/components/display/rules-slide.tsx
//
// The house rules as a full TV slide (spec 5.3): the before_start loop, once
// a loop on a break, and alternating with the between-games screen. All eight rules, how
// to win, and the call-and-response prompts when the screen has room for them.
//
// Sized against the TV's height. At 1280x720 the main area is about 590px once
// the footer is hidden, so there "How to win" is one row of three and the
// "Join in" block is left out. On a screen at least 800px tall and about 16:9
// or wider the two sit side by side under the rules, as the design draws them
// (a narrower screen wraps the rules onto more lines, so it keeps the compact
// layout). The rules and how to win always fit.
import React from 'react';
import { CALL_RESPONSES, HOW_TO_WIN } from '@/lib/house-rules';
import { cn } from '@/lib/utils';
import { cardClass } from '@/components/ui/card';
import { TV_KICKER_CLASS, TV_STATUS_LABEL_CLASS, tvText } from './tv-text';

interface RulesSlideProps {
  /** From getHouseRules(pot): seven rules, or eight with a known snowball pot. */
  rules: ReadonlyArray<string>;
  /** Keeps the phase visible while the rules are up, for example "Break time". */
  statusLabel?: string | null;
}

// Gold serif numerals, a size up from the text beside them (40px on 33px in
// the design). Their line is no taller than the text's, so they add no height.
const NUMERAL_CLASS = tvText('sm', 'font-display leading-[1.05] text-anchor-gold-bright tabular-nums');
const BLOCK_LABEL_CLASS = cn(TV_KICKER_CLASS, 'mb-[clamp(4px,0.7vh,10px)]');

// The card's own spacing. Each is tight at 720p, where every pixel is needed,
// and opens up to the design's figure at 1080p (40px padding, 26px between
// the parts, 14px between rules), which a plain vh term cannot do.
const CARD_SPACING_CLASS =
  'gap-[clamp(12px,calc(4vh_-_17px),32px)] px-[clamp(24px,2.5vw,48px)] py-[clamp(16px,calc(6.7vh_-_32px),48px)]';
const RULE_GAP_CLASS = 'mb-[clamp(6px,calc(2.4vh_-_12px),18px)]';

export function RulesSlide({ rules, statusLabel }: RulesSlideProps) {
  return (
    <section
      aria-label="House rules"
      className={cardClass({
        className: cn('mx-auto flex h-full w-full max-w-[1600px] flex-col justify-center overflow-hidden text-left', CARD_SPACING_CLASS),
      })}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-line-gold pb-[clamp(8px,1.5vh,20px)]">
        <h2 className={tvText('xl', 'leading-none')}>House rules</h2>
        {/* With no status to keep in view the slide is in the loop before the
            night starts (src/lib/playlist.ts), so it says what comes next. */}
        <p className={TV_STATUS_LABEL_CLASS}>{statusLabel ?? 'Eyes down shortly'}</p>
      </div>

      <ol className={tvText('xs', 'columns-2 gap-x-[3.3vw]')}>
        {rules.map((rule, index) => (
          <li key={index} className={cn('flex break-inside-avoid gap-[0.9vw]', RULE_GAP_CLASS)}>
            <span className={cn(NUMERAL_CLASS, 'min-w-[1.05em] shrink-0')}>{index + 1}</span>
            <span>{rule}</span>
          </li>
        ))}
      </ol>

      <div className="grid grid-cols-1 gap-x-[2.5vw] border-t border-line-gold pt-[clamp(8px,1.85vh,24px)] [@media(min-height:800px)_and_(min-aspect-ratio:1.7)]:grid-cols-2">
        <div>
          <p className={BLOCK_LABEL_CLASS}>How to win</p>
          <ul
            className={tvText(
              'xs',
              'grid grid-cols-3 gap-x-[2vw] gap-y-[0.4vh] [@media(min-height:800px)_and_(min-aspect-ratio:1.7)]:grid-cols-1'
            )}
          >
            {HOW_TO_WIN.map((line) => (
              <li key={line.stage}>
                <span className="font-bold">{line.stage}:</span> {line.text}
              </li>
            ))}
          </ul>
        </div>

        {/* Only where there is room for it: hidden on a screen under 800px
            tall or narrower than about 16:9, so 1280x720 never clips a rule to
            make space for it. */}
        <div className="hidden [@media(min-height:800px)_and_(min-aspect-ratio:1.7)]:block">
          <p className={BLOCK_LABEL_CLASS}>Join in</p>
          <ul className={tvText('xs', 'grid grid-cols-2 gap-x-[1.25vw] gap-y-[0.4vh]')}>
            {CALL_RESPONSES.map((item) => (
              <li key={item.number}>
                <span className={NUMERAL_CLASS}>{item.number}</span> {item.response}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
