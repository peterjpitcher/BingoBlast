// src/components/display/tv-text.ts
//
// Text sizes for elements added to the pub TV in the guest display slices.
// They meet the spec 5.7 floors on their own: 3vh is 32px at 1920x1080 and
// 21.6px (floored to 22px) at 1280x720; 4.1vh is 44px and 30px. Existing TV
// text keeps its sizes until the size pass (S5), which replaces these with
// named `text-tv-*` tokens in tailwind.config.ts.
//
// Whole class names only: Tailwind cannot see a class built at runtime.

/** Minimum body text: 32px at 1080p, 22px at 720p. */
export const TV_TEXT_BODY = 'text-[clamp(22px,3vh,56px)] leading-[1.25]';

/** Key information (verdicts, game and colour, the follow-along address): 44px and 30px. */
export const TV_TEXT_KEY = 'text-[clamp(30px,4.1vh,80px)] leading-[1.15]';

/** Slide headlines. */
export const TV_TEXT_TITLE = 'text-[clamp(36px,5.2vh,96px)] leading-[1.05]';
