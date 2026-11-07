// src/components/display/tv-text.ts
//
// Text sizes for the pub TV (spec 5.7). The `text-tv-*` sizes and tvText()
// come from the shared kit (@anchor-nights/kit/tv and its tokens.css);
// tvText() merges the other classes and adds the size afterwards, so the size
// is always present whatever else is passed. Re-exported here beside the
// sizes that are Cash Bingo's own (TV_SIZE), so the TV's files keep one import.
//
// Whole class names only: Tailwind cannot see a class built at runtime.
import { TV_KICKER_CLASS } from '@anchor-nights/kit/tv';

export { TV_KICKER_CLASS, tvText, type TvTextSize } from '@anchor-nights/kit/tv';

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
 * The label that keeps the part of the night in view on a slide that is about
 * something else, for example "Break time" on the rules or on an event. One
 * treatment, so the room reads it the same way wherever it appears: the
 * kicker.
 */
export const TV_STATUS_LABEL_CLASS = TV_KICKER_CLASS;
