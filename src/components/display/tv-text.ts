// src/components/display/tv-text.ts
//
// Text sizes for the pub TV (spec 5.7). The sizes themselves are the
// `text-tv-*` tokens in tailwind.config.ts, so the overhaul can restyle them
// in one place; this file is how the TV uses them.
//
// Use tvText(). cn() in src/lib/utils.ts now knows the `text-tv-*` sizes
// (TV_FONT_SIZES), so cn('text-tv-base', 'text-anchor-cream-text') keeps both,
// but before that fix tailwind-merge read them as text colours and silently
// dropped the size. tvText() merges the other classes and adds the size
// afterwards, so the size is always present whatever else is passed.
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
  // A long headline that is the whole screen ("Next game coming up"): 119px and 79px.
  '3xl': 'text-tv-3xl',
  // The one width-based size: 144px and 128px. Not used since the Anchor
  // restyle: the win takes TV_SIZE.win, which is sized by height like the rest.
  '4xl': 'text-tv-4xl',
};

/** A TV text size plus any other classes, merged safely. */
export function tvText(size: TvTextSize, ...classes: ClassValue[]): string {
  const rest = cn(...classes);
  return rest ? `${TV_TEXT_CLASS[size]} ${rest}` : TV_TEXT_CLASS[size];
}

/**
 * Sizes the Anchor design asks for that are not on the token scale. Each is
 * clamp(size at 1280x720, a vh term that lands on the 1920x1080 size, cap),
 * like the tokens, so the floors hold on both. The `length:` hint tells
 * tailwind-merge it is a size, not a colour. Use them with cn(), never inside
 * tvText() (which would add a second size).
 *
 * The three `bar*` sizes stop growing at 1080p, like tv-xs to tv-base: they
 * sit in the top bar and the footer, whose heights stop there too.
 */
export const TV_SIZE = {
  /** 52px (35px): the session name in the top bar. */
  barTitle: 'text-[length:clamp(35px,4.8vh,52px)]',
  /** 56px (37px): the stage being played for, in the footer. */
  barValue: 'text-[length:clamp(37px,5.2vh,56px)]',
  /** 64px (43px): the prize and the snowball jackpot, in the footer. */
  barPrize: 'text-[length:clamp(43px,5.93vh,64px)]',
  /** 52px (35px): the printed follow-along address. */
  url: 'text-[length:clamp(35px,4.8vh,78px)]',
  /** 64px (43px): the kitchen line on a break, and the script lines. */
  callout: 'text-[length:clamp(43px,5.93vh,96px)]',
  /** 80px (53px): the script line at the end of the night. */
  scriptLg: 'text-[length:clamp(53px,7.4vh,120px)]',
  /** 88px (58px): "Well played" over a win. */
  scriptXl: 'text-[length:clamp(58px,8.15vh,132px)]',
  /** 150px (100px): the snowball countdown, and the win over two rows of balls. */
  count: 'text-[length:clamp(100px,13.9vh,225px)]',
  /** 168px (110px): a headline that is the whole screen (break, thanks). */
  hero: 'text-[length:clamp(110px,15.6vh,252px)]',
  /** 200px (133px): the win. */
  win: 'text-[length:clamp(133px,18.5vh,300px)]',
} as const;

/**
 * The kicker (section label) on the TV: the `.kicker` treatment from
 * globals.css (Outfit 600, tracked, gold, in capitals through CSS) at the TV
 * floor size instead of its 12px.
 */
export const TV_KICKER_CLASS = tvText('xs', 'kicker');

/**
 * The label that keeps the part of the night in view on a slide that is about
 * something else, for example "Break time" on the rules or on an event. One
 * treatment, so the room reads it the same way wherever it appears: the
 * kicker.
 */
export const TV_STATUS_LABEL_CLASS = TV_KICKER_CLASS;
