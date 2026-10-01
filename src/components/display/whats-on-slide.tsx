// src/components/display/whats-on-slide.tsx
//
// "Bingo nights at The Anchor" for the idle pub TV (spec 5.5): it opens the
// idle loop, and is the whole loop when there are no events to show. The QR
// and the printed address go to the website's what's-on page.
import React from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { WHATS_ON_URL } from '@/lib/venue-links';
import { tvText } from './tv-text';

// At least 40% of the screen height, like the event QR codes.
const WHATS_ON_QR_SIZE = 'max(40vh, 288px)';

/** "the-anchor.pub/whats-on": the address as printed under the QR. */
export const WHATS_ON_ADDRESS = WHATS_ON_URL.replace(/^https?:\/\/(www\.)?/i, '');

export function WhatsOnSlide() {
  return (
    <section
      aria-label="Bingo nights at The Anchor"
      className="mx-auto flex h-full w-full max-w-[1700px] items-center justify-center gap-[4vw] text-white"
    >
      <div className="shrink-0 rounded-3xl bg-white p-[1.5vh]">
        <QRCodeSVG
          value={WHATS_ON_URL}
          level="M"
          marginSize={2}
          size={432}
          title="QR code: what's on at The Anchor"
          fgColor="#005131"
          bgColor="#FFFFFF"
          style={{ display: 'block', width: WHATS_ON_QR_SIZE, height: WHATS_ON_QR_SIZE }}
        />
      </div>
      <div className="flex min-w-0 flex-col gap-[2.4vh] text-left">
        <h1 className={tvText('lg', 'font-black uppercase tracking-[0.05em]')}>Bingo nights at The Anchor</h1>
        <p className={tvText('base', 'font-semibold')}>See what&apos;s on</p>
        <p className={tvText('base', 'break-all font-bold text-[#f3d59d]')}>{WHATS_ON_ADDRESS}</p>
      </div>
    </section>
  );
}
