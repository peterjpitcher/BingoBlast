// src/components/display/thanks-slide.tsx
//
// The end-of-night thank-you as a pub TV slide (spec 5.5). It opens the
// night_over loop and comes back after every two events, so the booking
// prompt itself is left to the event and next-bingo slides and their QR codes.
import React from 'react';
import { cn } from '@/lib/utils';
import { TV_KICKER_CLASS, TV_SIZE, tvText } from './tv-text';

export function ThanksSlide() {
  return (
    <section
      aria-label="Thanks for coming"
      className="mx-auto flex h-full w-full max-w-[1500px] flex-col items-center justify-center gap-[clamp(16px,2.6vh,40px)] text-center text-anchor-cream-text"
    >
      <p className={TV_KICKER_CLASS}>Anchor Bingo Night</p>
      {/* The biggest headline: this is the whole slide. */}
      <h1 className={cn(TV_SIZE.hero, 'leading-[0.9]')}>Thanks for coming</h1>
      <p className={cn(TV_SIZE.scriptLg, 'font-script text-anchor-gold-bright')}>Where everyone&apos;s welcome</p>
      <p className={tvText('base', 'mt-[1.5vh] max-w-[30ch] font-medium')}>
        Book your table for the next bingo night at the bar before you leave.
      </p>
    </section>
  );
}
