// src/components/display/whats-on-slide.tsx
//
// "Bingo nights at The Anchor" for the idle pub TV (spec 5.5): it opens the
// idle loop, and is the whole loop when there are no events to show. The QR
// and the printed address go to the website's what's-on page.
import React from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { QR_BACKGROUND, QR_FOREGROUND } from '@/lib/brand';
import { cn } from '@/lib/utils';
import { WHATS_ON_URL } from '@/lib/venue-links';
import { TV_SIZE, tvText } from './tv-text';

// At least 40% of the screen height, like the event QR codes.
const WHATS_ON_QR_SIZE = 'max(40vh, 288px)';

/** "the-anchor.pub/whats-on": the address as printed under the QR. */
export const WHATS_ON_ADDRESS = WHATS_ON_URL.replace(/^https?:\/\/(www\.)?/i, '');

export function WhatsOnSlide() {
  return (
    <section
      aria-label="Bingo nights at The Anchor"
      className="mx-auto flex h-full w-full max-w-[1700px] items-center justify-center gap-[4.6vw] text-anchor-cream-text"
    >
      <div className="shrink-0 rounded-card border border-line-gold bg-white p-[clamp(13px,1.85vh,20px)]">
        <QRCodeSVG
          value={WHATS_ON_URL}
          level="M"
          marginSize={2}
          size={432}
          title="QR code: what's on at The Anchor"
          fgColor={QR_FOREGROUND}
          bgColor={QR_BACKGROUND}
          style={{ display: 'block', width: WHATS_ON_QR_SIZE, height: WHATS_ON_QR_SIZE }}
        />
      </div>
      <div className="flex min-w-0 flex-col gap-[clamp(14px,2.6vh,28px)] text-left">
        <h1 className={tvText('2xl', 'max-w-[13ch] leading-[0.98]')}>Bingo nights at The Anchor</h1>
        <p className={tvText('base', 'font-medium')}>See what&apos;s on</p>
        <p className={cn(TV_SIZE.url, 'break-all font-bold leading-[1.05] text-anchor-gold-bright')}>{WHATS_ON_ADDRESS}</p>
      </div>
    </section>
  );
}
