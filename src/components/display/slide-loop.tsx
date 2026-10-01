// src/components/display/slide-loop.tsx
//
// Plays a playlist (src/lib/playlist.ts): each slide for its duration, then
// the next, round and round.
//   - It pauses while the page is hidden, and the current slide starts its
//     time again when the page comes back.
//   - With prefers-reduced-motion set there is no transition at all; otherwise
//     each slide fades in.
//   - A new playlist (a different signature) starts again from its first
//     slide. The same playlist rebuilt on a re-render keeps its place: the TV
//     re-renders every second, so the timer depends only on primitives.
//
// The events slice (S4) adds slide kinds; this component does not care what a
// slide is, it only asks `renderSlide` to draw it.
'use client';

import React, { useEffect, useRef, useState } from 'react';
import { playlistSignature, type Slide } from '@/lib/playlist';
import { useDocumentVisible } from './screen-hooks';

export interface SlideLoopProps {
  slides: ReadonlyArray<Slide>;
  renderSlide: (slide: Slide) => React.ReactNode;
  className?: string;
}

const FADE_MS = 600;

function SlideLoopRun({ slides, renderSlide, className }: SlideLoopProps) {
  const [index, setIndex] = useState(0);
  const visible = useDocumentVisible();
  const containerRef = useRef<HTMLDivElement | null>(null);

  const count = slides.length;
  const position = count > 0 ? index % count : 0;
  const slide = count > 0 ? slides[position] : null;
  const durationMs = slide?.durationMs ?? 0;

  useEffect(() => {
    if (!visible || count <= 1 || durationMs <= 0) return;
    const timer = setTimeout(() => setIndex((current) => (current + 1) % count), durationMs);
    return () => clearTimeout(timer);
  }, [visible, count, durationMs, position]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element || typeof element.animate !== 'function') return;
    if (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    element.animate([{ opacity: 0 }, { opacity: 1 }], { duration: FADE_MS, easing: 'ease-out' });
  }, [position]);

  if (!slide) return null;
  return (
    <div ref={containerRef} className={className} data-slide-kind={slide.kind}>
      {renderSlide(slide)}
    </div>
  );
}

export function SlideLoop(props: SlideLoopProps) {
  // Keyed by the playlist's content, so a new playlist starts from slide one.
  return <SlideLoopRun key={playlistSignature(props.slides)} {...props} />;
}
