// src/components/display/promo-slide.tsx
//
// Draws the slides the events slice added to the playlist (spec 5.5, 5.6):
// events, the next bingo night, thanks, the review invitation and the idle
// "Bingo nights at The Anchor". Shared by the session TV and the idle
// /display, so both draw them the same way. Also starts loading the next
// slide's image while this one shows.
'use client';

import React from 'react';
import type { Slide } from '@/lib/playlist';
import { EventSlide, PreloadEventImage } from './event-slide';
import { NextBingoSlide } from './next-bingo-slide';
import { ReviewSlide } from './review-slide';
import { ThanksSlide } from './thanks-slide';
import { WhatsOnSlide } from './whats-on-slide';

interface PromoSlideProps {
  slide: Slide;
  /** The screen's clock (epoch milliseconds), for "Tonight" and the like. */
  nowMs: number;
}

/** The slide itself; null for kinds the screen draws on its own (follow-along, rules, break, next game). */
export function PromoSlide({ slide, nowMs }: PromoSlideProps) {
  switch (slide.kind) {
    case 'event':
      return (
        <EventSlide
          key={slide.key}
          event={slide.event}
          qrUrl={slide.qrUrl}
          nowMs={nowMs}
          eyebrow="Coming up at The Anchor"
        />
      );
    case 'next_bingo':
      return (
        <NextBingoSlide key={slide.key} event={slide.event} qrUrl={slide.qrUrl} nowMs={nowMs} />
      );
    case 'thanks':
      return <ThanksSlide />;
    case 'review':
      return <ReviewSlide />;
    case 'idle_bingo':
      return <WhatsOnSlide />;
    default:
      return null;
  }
}

/** Preloads the image of the slide after `slide`, whatever kind `slide` is. */
export function SlidePreload({ slide, nowMs }: { slide: Slide; nowMs: number }) {
  return <PreloadEventImage image={slide.preloadImage} nowMs={nowMs} />;
}
