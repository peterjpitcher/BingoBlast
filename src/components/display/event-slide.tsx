// src/components/display/event-slide.tsx
//
// One upcoming event as a pub TV slide (spec 5.5): the artwork, the title, when
// it is, and a QR code to its page.
//   - The artwork is the hero. A landscape image takes all the height the
//     slide has, with the title and the date tucked under it; a square one
//     stands full height beside the text. Either is shown whole, never cropped.
//   - An image that fails to load turns the slide into a text-only card.
//   - The title is clamped: the artwork usually carries the title too.
//   - "Tonight" and "7pm" are worked out here, at render time, from the
//     screen's clock (src/lib/dates.ts), never sent by the server (R10).
//   - The QR is level M and at least 40% of the screen height; the playlist
//     has already picked the pre-event, in-game or post-event link.
//   - On a break or between games the TV's top bar says where the night is
//     ("Break time", "Next game coming up") while this slide is up, so the
//     slide itself carries no label and keeps its room for the artwork.
//   - The QR code stands in from the right edge of the slide.
'use client';

import React, { useState } from 'react';
import Image, { getImageProps } from 'next/image';
import { preload } from 'react-dom';
import { QRCodeSVG } from 'qrcode.react';
import { QR_BACKGROUND, QR_FOREGROUND } from '@/lib/brand';
import { cn } from '@/lib/utils';
import { formatEventWhenAndTime } from '@/lib/dates';
import type { ScreenEvent, ScreenEventImage } from '@/lib/playlist';
import { eventImageLoader, eventImageSizes } from './event-image';
import { TV_KICKER_CLASS, tvText } from './tv-text';

// At least 40% of the screen height: 432px at 1080p, 288px at 720p.
const EVENT_QR_SIZE = 'max(40vh, 288px)';

// Images that failed on this screen, by URL, with when (the screen's clock).
// Each pass of the loop draws a slide afresh, so without this a missing image
// would flash an empty box on every pass before the text-only card. Tried
// again after half an hour, in case the failure was a passing network fault.
const failedImages = new Map<string, number>();
const IMAGE_RETRY_MS = 30 * 60_000;

function isKnownFailed(url: string, nowMs: number): boolean {
  const failedAt = failedImages.get(url);
  return failedAt !== undefined && nowMs - failedAt < IMAGE_RETRY_MS;
}

export interface EventSlideProps {
  event: ScreenEvent;
  /** The QR target, chosen by the playlist for the phase. */
  qrUrl: string;
  /** The screen's clock (epoch milliseconds), for "Tonight" and the like. */
  nowMs: number;
  /** The line above the title, for example "Coming up at The Anchor". */
  eyebrow: string;
}

export function EventSlide({ event, qrUrl, nowMs, eyebrow }: EventSlideProps) {
  // Remembered by URL, so a failure never carries over to another event's image.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const image =
    event.image && event.image.url !== failedUrl && !isKnownFailed(event.image.url, nowMs) ? event.image : null;
  const whenLine = formatEventWhenAndTime(event.startsAt, nowMs);

  // The artwork is shown whole, so the tile has no scrim over it; its own
  // surface shows behind an image that does not quite fill the box. The deep
  // shadow lifts it off the screen, as a poster on a wall.
  const renderImage = (img: ScreenEventImage, boxClass: string) => (
    <div
      className={cn(
        'overflow-hidden rounded-card border border-line-gold bg-anchor-green-raised shadow-[0_2.2vh_7vh_rgba(0,0,0,0.55)]',
        boxClass
      )}
    >
      <Image
        src={img.url}
        alt={img.alt}
        fill
        sizes={eventImageSizes(img)}
        loader={eventImageLoader}
        // The slide is on screen whenever it is drawn: no lazy loading.
        loading="eager"
        className="object-contain"
        onError={() => {
          failedImages.set(img.url, nowMs);
          setFailedUrl(img.url);
        }}
      />
    </div>
  );

  // The words. The title takes the slide-title size, not the headline size:
  // the artwork is the headline now, and a smaller title leaves it more room.
  const renderText = (titleClampClass: string) => (
    <div className="flex shrink-0 flex-col gap-[0.8vh]">
      <p className={TV_KICKER_CLASS}>{eyebrow}</p>
      {/* leading-[1.15]: the clamp hides overflow, and the title size's
          tighter 1.05 line shaved the bottoms off descenders such as "g". */}
      <h2 className={tvText('lg', titleClampClass, 'leading-[1.15]')}>{event.title}</h2>
      {whenLine && <p className={tvText('base', 'font-semibold text-anchor-gold-bright')}>{whenLine}</p>}
    </div>
  );

  return (
    <section
      aria-label={event.title}
      className="mx-auto flex h-full w-full max-w-[1800px] items-stretch gap-[3vw] overflow-hidden text-anchor-cream-text"
    >
      {image?.square ? (
        <>
          {/* Square artwork: as tall as the slide, capped at 36vw so the text
              beside it keeps a readable column. That column is narrow, so the
              title may run to four lines before it is cut. */}
          <div className="flex shrink-0 items-center">
            {renderImage(image, 'relative aspect-square h-full max-h-[36vw]')}
          </div>
          <div className="flex min-w-0 flex-1 flex-col justify-center gap-[1.6vh] text-left">
            {renderText('line-clamp-4')}
          </div>
        </>
      ) : (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col justify-center gap-[1.6vh] text-left">
          {/* Landscape artwork: it takes whatever room the words below leave,
              so it is as large as each screen allows (about 1210 by 680 at
              1920x1080, where it used to be 768 by 432). The stretch is a
              size container, and
              the frame is the largest 16:9 box that fits it (cqh and cqw are
              the stretch's own height and width), so the frame always hugs
              the artwork. It sits at the bottom of the stretch, next to its
              caption. */}
          {image && (
            <div className="flex min-h-0 flex-1 items-end [container-type:size]">
              {renderImage(image, 'relative aspect-video h-[min(100cqh,56.25cqw)]')}
            </div>
          )}
          {renderText('line-clamp-2')}
        </div>
      )}

      {/* pr-[3vw]: the code stands in from the edge of the slide, about as
          far as it stands from the artwork, rather than sitting on the edge. */}
      <div className="flex shrink-0 flex-col items-center justify-center gap-[1.5vh] pr-[3vw]">
        <div className="rounded-card border border-line-gold bg-white p-[clamp(13px,1.85vh,20px)]">
          <QRCodeSVG
            value={qrUrl}
            level="M"
            marginSize={2}
            size={432}
            title={`QR code: details of ${event.title}`}
            fgColor={QR_FOREGROUND}
            bgColor={QR_BACKGROUND}
            style={{ display: 'block', width: EVENT_QR_SIZE, height: EVENT_QR_SIZE }}
          />
        </div>
        <p className={tvText('xs', 'font-semibold')}>Scan for details</p>
      </div>
    </section>
  );
}

/**
 * Starts loading an image the loop is about to show, at exactly the size the
 * slide will ask for, so the next slide does not appear with an empty box.
 * Renders nothing.
 */
export function PreloadEventImage({ image, nowMs }: { image: ScreenEventImage | null | undefined; nowMs: number }) {
  if (!image || isKnownFailed(image.url, nowMs)) return null;
  const { props } = getImageProps({
    src: image.url,
    alt: '',
    fill: true,
    sizes: eventImageSizes(image),
    loader: eventImageLoader,
  });
  if (typeof props.src === 'string') {
    preload(props.src, {
      as: 'image',
      imageSrcSet: props.srcSet,
      imageSizes: props.sizes,
      fetchPriority: 'low',
    });
  }
  return null;
}
