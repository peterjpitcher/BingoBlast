// src/components/display/tv-text.ts
//
// Text sizes for the pub TV (spec 5.7). The sizes themselves are the
// `text-tv-*` tokens in tailwind.config.ts, so the overhaul can restyle them
// in one place; this file is how the TV uses them.
//
// Always through tvText(), never cn('text-tv-base', ...): tailwind-merge does
// not know the token names and reads `text-tv-*` as a text colour, so
// cn('text-tv-base', 'text-white') keeps text-white and silently drops the
// size. tvText() merges the other classes and adds the size afterwards.
//
// Whole class names only: Tailwind cannot see a class built at runtime.
import { type ClassValue } from 'clsx';
import { cn } from '@/lib/utils';

export type TvTextSize = 'xs' | 'sm' | 'base' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl';

const TV_TEXT_CLASS: Record<TvTextSize, string> = {
  // Any text: 32px at 1920x1080, 22px at 1280x720.
  xs: 'text-tv-xs',
  // Second lines under a headline or title: 38px and 26px.
  sm: 'text-tv-sm',
  // Key information (prize, stage, snowball, game and colour, verdicts): 44px and 30px.
  base: 'text-tv-base',
  // Slide and card titles: 56px and 37px.
  lg: 'text-tv-lg',
  // Screen headlines: 70px and 47px.
  xl: 'text-tv-xl',
  // A headline that is the whole slide: 86px and 58px.
  '2xl': 'text-tv-2xl',
  // The snowball countdown and the win over its claimed balls: 119px and 79px.
  '3xl': 'text-tv-3xl',
  // The win on its own: 144px and 128px.
  '4xl': 'text-tv-4xl',
};

/** A TV text size plus any other classes, merged safely. */
export function tvText(size: TvTextSize, ...classes: ClassValue[]): string {
  const rest = cn(...classes);
  return rest ? `${TV_TEXT_CLASS[size]} ${rest}` : TV_TEXT_CLASS[size];
}
