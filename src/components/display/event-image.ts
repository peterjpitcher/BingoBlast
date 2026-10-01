// src/components/display/event-image.ts
//
// How the pub TV loads event artwork through next/image (spec 5.5: "at no
// more than 1280px wide"). next/image alone cannot promise that: with a
// `sizes` hint it offers every configured width up to 3840, and a TV browser
// that reports a device pixel ratio of 2 would take the 1920 or 3840 one.
// This loader asks Next's own image optimiser for the same widths, capped at
// 1200, the largest of Next's default widths that is not over 1280. A TV
// showing the image wider than that scales it up slightly; nobody can tell at
// pub distance, and the TV never downloads a 4K poster.
import type { ImageLoader } from 'next/image';
import type { ScreenEventImage } from '@/lib/playlist';

/** The widest image the TV asks for. */
export const MAX_EVENT_IMAGE_WIDTH = 1200;

// Next's default `images.deviceSizes` and `images.imageSizes` (next.config.ts
// leaves both alone). The optimiser refuses any width not in these lists.
const OPTIMISER_WIDTHS = [32, 48, 64, 96, 128, 256, 384, 640, 750, 828, 1080, 1200];

// The optimiser's default path and its only default quality (Next 16 refuses
// any quality not in `images.qualities`, which defaults to [75]).
const OPTIMISER_PATH = '/_next/image';
const OPTIMISER_QUALITY = 75;

/** The smallest optimiser width that covers `width`, never above the cap. */
export function cappedOptimiserWidth(width: number): number {
  const wanted = Math.min(width, MAX_EVENT_IMAGE_WIDTH);
  return OPTIMISER_WIDTHS.find((candidate) => candidate >= wanted) ?? MAX_EVENT_IMAGE_WIDTH;
}

/**
 * next/image loader for event artwork. The optimiser still checks the URL
 * against `images.remotePatterns`, so this widens nothing.
 */
export const eventImageLoader: ImageLoader = ({ src, width }) =>
  `${OPTIMISER_PATH}?url=${encodeURIComponent(src)}&w=${cappedOptimiserWidth(width)}&q=${OPTIMISER_QUALITY}`;

/**
 * The `sizes` hint for an event image on a TV slide, matching the boxes in
 * event-slide.tsx: a square is 40vh wide, a landscape box 16:9 at 40vh tall.
 */
export function eventImageSizes(image: ScreenEventImage): string {
  return image.square ? '40vh' : '72vh';
}
