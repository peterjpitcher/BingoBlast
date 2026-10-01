// src/components/display/event-slide.tsx
//
// One upcoming event as a pub TV slide (spec 5.5): the artwork, the title, when
// it is, and a QR code to its page.
//   - A square image is shown whole, beside the text; a landscape one above it.
//   - An image that fails to load turns the slide into a text-only card.
//   - The title is clamped to two lines.
//   - "Tonight" and "7pm" are worked out here, at render time, from the
//     screen's clock (src/lib/dates.ts), never sent by the server (R10).
//   - The QR is level M and at least 40% of the screen height; the playlist
//     has already picked the pre- or post-event link for the phase.
'use client';

import React, { useState } from 'react';
import Image, { getImageProps } from 'next/image';
import { preload } from 'react-dom';
import { QRCodeSVG } from 'qrcode.react';
import { cn } from '@/lib/utils';
import { formatEventWhenAndTime } from '@/lib/dates';
import type { ScreenEvent, ScreenEventImage } from '@/lib/playlist';
import { eventImageLoader, eventImageSizes } from './event-image';
import { tvText } from './tv-text';

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

  const renderImage = (img: ScreenEventImage, boxClass: string) => (
    <div className={cn('relative shrink-0 overflow-hidden rounded-3xl', boxClass)}>
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

  return (
    <section
      aria-label={event.title}
      className="mx-auto flex h-full w-full max-w-[1800px] items-center gap-[3vw] overflow-hidden text-white"
    >
      {image?.square && renderImage(image, 'aspect-square h-[40vh]')}

      <div className="flex min-w-0 flex-1 flex-col gap-[1.6vh] text-left">
        {image && !image.square && renderImage(image, 'aspect-video h-[40vh] max-w-full self-start')}
        <p className={tvText('xs', 'font-semibold uppercase tracking-[0.2em] text-white/85')}>{eyebrow}</p>
        {/* leading-[1.15]: the clamp hides overflow, and the title size's
            tighter 1.05 line shaved the bottoms off descenders such as "g". */}
        <h2 className={tvText('lg', 'line-clamp-2 font-black leading-[1.15]')}>{event.title}</h2>
        {whenLine && <p className={tvText('base', 'font-bold text-[#f3d59d]')}>{whenLine}</p>}
      </div>

      <div className="flex shrink-0 flex-col items-center gap-[1.2vh]">
        <div className="rounded-3xl bg-white p-[1.5vh]">
          <QRCodeSVG
            value={qrUrl}
            level="M"
            marginSize={2}
            size={432}
            title={`QR code: details of ${event.title}`}
            fgColor="#005131"
            bgColor="#FFFFFF"
            style={{ display: 'block', width: EVENT_QR_SIZE, height: EVENT_QR_SIZE }}
          />
        </div>
        <p className={tvText('xs', 'font-bold')}>Scan for details</p>
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
