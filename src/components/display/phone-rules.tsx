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
    <div className="space-y-4 text-left">
      <p className="text-base font-semibold text-white">{PHONE_FOLLOW_ONLY_NOTE}</p>
      <ol className="space-y-2">
        {rules.map((rule, index) => (
          <li key={index} className="flex gap-2 text-base leading-snug text-white">
            <span className="shrink-0 font-bold text-[#f3d59d]">{index + 1}.</span>
            <span>{rule}</span>
          </li>
        ))}
      </ol>
      <div>
        <h3 className="mb-1 text-sm font-bold uppercase tracking-wide text-[#f3d59d]">How to win</h3>
        <ul className="space-y-1">
          {HOW_TO_WIN.map((line) => (
            <li key={line.stage} className="text-base leading-snug text-white">
              <span className="font-bold">{line.stage}:</span> {line.text}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
