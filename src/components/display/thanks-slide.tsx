// src/components/display/thanks-slide.tsx
//
// The end-of-night thank-you as a pub TV slide (spec 5.5). It opens the
// night_over loop and comes back after every two events, so the booking
// prompt itself is left to the event and next-bingo slides and their QR codes.
import React from 'react';
import { cn } from '@/lib/utils';
import { TV_TEXT_BODY, TV_TEXT_KEY } from './tv-text';

// Bigger than the slide titles: this is the whole slide. 44px at 720p, 86px
// at 1080p.
const THANKS_HEADLINE = 'text-[clamp(44px,8vh,140px)] leading-[1.05]';

export function ThanksSlide() {
  return (
    <section
      aria-label="Thanks for coming"
      className="mx-auto flex h-full w-full max-w-[1500px] flex-col items-center justify-center gap-[3vh] text-center text-white"
    >
      <p className={cn(TV_TEXT_BODY, 'font-semibold uppercase tracking-[0.2em] text-white/85')}>Anchor Bingo Night</p>
      <h1 className={cn(THANKS_HEADLINE, 'font-black uppercase tracking-[0.06em]')}>Thanks for coming!</h1>
      <p className={cn(TV_TEXT_KEY, 'font-semibold')}>Please book your table for our next bingo event before you leave.</p>
    </section>
  );
}
