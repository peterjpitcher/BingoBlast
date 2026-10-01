// src/components/display/next-bingo-slide.tsx
//
// The next bingo night as a pub TV slide (spec 5.5): the event slide, headed
// "Next bingo night". The playlist only adds it when there is one to come
// other than tonight's (getUsableEvents in src/lib/playlist.ts); with none in
// the next 120 days the idle loop falls back to "Bingo nights at The Anchor".
'use client';

import React from 'react';
import type { ScreenEvent } from '@/lib/playlist';
import { EventSlide } from './event-slide';

interface NextBingoSlideProps {
  event: ScreenEvent;
  qrUrl: string;
  nowMs: number;
  /** Keeps the phase visible while the slide is up, for example "Break time". */
  statusLabel?: string | null;
}

export function NextBingoSlide({ event, qrUrl, nowMs, statusLabel }: NextBingoSlideProps) {
  return <EventSlide event={event} qrUrl={qrUrl} nowMs={nowMs} eyebrow="Next bingo night" statusLabel={statusLabel} />;
}
