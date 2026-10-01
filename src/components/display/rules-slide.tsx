// src/components/display/rules-slide.tsx
//
// The house rules as a full TV slide (spec 5.3): the before_start loop, once
// a loop on a break, and alternating with the between-games screen. All eight rules, how
// to win, and the call-and-response prompts when the screen is tall enough.
//
// Sized against the TV's height: at 1280x720 the main area is 576px once the
// footer is hidden, so the "Join in" block only shows from 800px tall up. The
// rules and how to win always fit.
import React from 'react';
import { CALL_RESPONSES, HOW_TO_WIN } from '@/lib/house-rules';
import { TV_STATUS_LABEL_CLASS, tvText } from './tv-text';

interface RulesSlideProps {
  /** From getHouseRules(pot): seven rules, or eight with a known snowball pot. */
  rules: ReadonlyArray<string>;
  /** Keeps the phase visible while the rules are up, for example "Break time". */
  statusLabel?: string | null;
}

export function RulesSlide({ rules, statusLabel }: RulesSlideProps) {
  return (
    <section
      aria-label="House rules"
      className="mx-auto flex h-full w-full max-w-[1500px] flex-col justify-center gap-[2vh] overflow-hidden rounded-3xl border border-[#1f7c58] bg-[#003f27]/90 p-[2.5vh] text-left text-white"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-[#1f7c58] pb-[1vh]">
        <h2 className={tvText('base', 'font-black uppercase tracking-[0.06em]')}>House rules</h2>
        {statusLabel && (
          <p className={TV_STATUS_LABEL_CLASS}>{statusLabel}</p>
        )}
      </div>

      <ol className={tvText('xs', 'columns-2 gap-x-[3vw]')}>
        {rules.map((rule, index) => (
          <li key={index} className="mb-[1.1vh] flex break-inside-avoid gap-[0.8vw]">
            <span className="shrink-0 font-bold text-[#f3d59d]" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {index + 1}.
            </span>
            <span>{rule}</span>
          </li>
        ))}
      </ol>

      <div className="border-t border-[#1f7c58] pt-[1vh]">
        <h3 className={tvText('xs', 'mb-[0.6vh] font-bold uppercase tracking-[0.12em] text-[#f3d59d]')}>How to win</h3>
        <ul className={tvText('xs', 'grid grid-cols-3 gap-x-[2vw]')}>
          {HOW_TO_WIN.map((line) => (
            <li key={line.stage}>
              <span className="font-bold">{line.stage}:</span> {line.text}
            </li>
          ))}
        </ul>
      </div>

      {/* Only where there is room for it: hidden below 800px tall, so 1280x720
          never clips a rule to make space for it. */}
      <div className="hidden border-t border-[#1f7c58] pt-[1vh] [@media(min-height:800px)]:block">
        <h3 className={tvText('xs', 'mb-[0.6vh] font-bold uppercase tracking-[0.12em] text-[#f3d59d]')}>Join in</h3>
        <ul className={tvText('xs', 'grid grid-cols-3 gap-x-[2vw] gap-y-[0.4vh]')}>
          {CALL_RESPONSES.map((item) => (
            <li key={item.number}>
              <span className="font-bold text-[#f3d59d]">{item.number}</span> {item.response}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
