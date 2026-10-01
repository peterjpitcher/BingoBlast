// src/components/display/phone-rules.tsx
//
// The house rules on the phone follower (spec 5.3): inline before the first
// game, and behind a Rules button for the rest of the night. Both open with
// the note that the phone only follows the paper game.
import React from 'react';
import { HOW_TO_WIN, PHONE_FOLLOW_ONLY_NOTE } from '@/lib/house-rules';

interface PhoneRulesProps {
  /** From getHouseRules(pot). */
  rules: ReadonlyArray<string>;
}

export function PhoneRules({ rules }: PhoneRulesProps) {
  return (
    <div className="flex flex-col gap-3 text-left">
      <p className="text-sm font-semibold leading-normal text-anchor-sage">{PHONE_FOLLOW_ONLY_NOTE}</p>
      <ol className="flex flex-col gap-2">
        {rules.map((rule, index) => (
          <li key={index} className="flex gap-2.5 text-[15px] leading-[1.45] text-anchor-cream-text">
            <span className="min-w-[18px] shrink-0 font-display text-lg leading-[1.2] text-anchor-gold-bright tabular-nums">
              {index + 1}
            </span>
            <span>{rule}</span>
          </li>
        ))}
      </ol>
      <div className="border-t border-line pt-3">
        {/* A heading for screen readers, set as a kicker: the kicker class
            puts it back in the body face. */}
        <h3 className="kicker mb-2">How to win</h3>
        <ul className="flex flex-col gap-1 text-[15px] leading-[1.45] text-anchor-cream-text">
          {HOW_TO_WIN.map((line) => (
            <li key={line.stage}>
              <strong className="font-bold">{line.stage}:</strong> {line.text}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
