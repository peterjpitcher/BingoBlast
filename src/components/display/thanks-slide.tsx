// src/components/display/thanks-slide.tsx
//
// The end-of-night thank-you as a pub TV slide (spec 5.5). It opens the
// night_over loop and comes back after every two events, so the booking
// prompt itself is left to the event and next-bingo slides and their QR codes.
import React from 'react';
import { tvText } from './tv-text';

export function ThanksSlide() {
  return (
    <section
      aria-label="Thanks for coming"
      className="mx-auto flex h-full w-full max-w-[1500px] flex-col items-center justify-center gap-[3vh] text-center text-white"
    >
      <p className={tvText('xs', 'font-semibold uppercase tracking-[0.2em] text-white/85')}>Anchor Bingo Night</p>
      {/* Bigger than the slide titles: this is the whole slide. */}
      <h1 className={tvText('2xl', 'font-black uppercase tracking-[0.06em]')}>Thanks for coming!</h1>
      <p className={tvText('base', 'font-semibold')}>Please book your table for our next bingo event before you leave.</p>
    </section>
  );
}
