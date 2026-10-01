// src/components/display/follow-qr.tsx
//
// The follow-along QR codes on the TV (spec 5.4), both built on the same
// payload (buildFollowUrl): the corner badge during the night, and the big
// before_start slide. Level M, with a two-module quiet zone inside a white
// card so a phone can read it from across the room.
import React from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { cn } from '@/lib/utils';
import { stripScheme } from '@/lib/follow-link';
import { KITCHEN_OPEN_UNTIL } from '@/lib/venue-links';
import { TV_TEXT_BODY, TV_TEXT_KEY, TV_TEXT_TITLE } from './tv-text';

const QR_TITLE = 'QR code: follow the numbers on your phone';

// 206px with a two-module margin leaves the code itself at least 180px
// (spec 5.4); 22vh grows it to about 238px at 1080p.
const CORNER_QR_SIZE = 'clamp(206px, 22vh, 260px)';
// At least half the screen height: 540px at 1080p (spec 5.4).
const SLIDE_QR_SIZE = 'max(50vh, 360px)';

/** The corner badge, laid out in its own column so it never covers content. */
export function FollowQrBadge({ url }: { url: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-white/30 bg-[#005131] p-3">
      <div className="rounded-lg bg-white p-1.5">
        <QRCodeSVG
          value={url}
          level="M"
          marginSize={2}
          size={260}
          title={QR_TITLE}
          fgColor="#005131"
          bgColor="#FFFFFF"
          style={{ display: 'block', width: CORNER_QR_SIZE, height: CORNER_QR_SIZE }}
        />
      </div>
      <p className={cn(TV_TEXT_BODY, 'whitespace-nowrap font-bold text-white')}>Follow along</p>
    </div>
  );
}

/** The before_start follow-along slide: the big QR and how to use it. */
export function FollowAlongSlide({ url }: { url: string }) {
  return (
    <section
      aria-label="Follow the numbers on your phone"
      className="mx-auto flex h-full w-full max-w-[1700px] items-center justify-center gap-[4vw] text-white"
    >
      <div className="shrink-0 rounded-3xl bg-white p-[1.5vh]">
        <QRCodeSVG
          value={url}
          level="M"
          marginSize={2}
          size={540}
          title={QR_TITLE}
          fgColor="#005131"
          bgColor="#FFFFFF"
          style={{ display: 'block', width: SLIDE_QR_SIZE, height: SLIDE_QR_SIZE }}
        />
      </div>
      <div className="flex min-w-0 flex-col gap-[2.4vh] text-left">
        <p className={cn(TV_TEXT_BODY, 'font-semibold uppercase tracking-[0.2em] text-white/85')}>Anchor Bingo Night</p>
        <h1 className={cn(TV_TEXT_TITLE, 'font-black uppercase tracking-[0.05em]')}>Follow the numbers on your phone</h1>
        <p className={cn(TV_TEXT_KEY, 'font-semibold')}>Point your camera at the code</p>
        <p className={cn(TV_TEXT_KEY, 'break-all font-bold text-[#f3d59d]')}>{stripScheme(url)}</p>
        <div className="mt-[1vh] rounded-3xl border border-[#a57626] bg-[#005131]/90 p-[2vh]">
          <p className={cn(TV_TEXT_KEY, 'font-black uppercase tracking-[0.06em]')}>Kitchen Open Until {KITCHEN_OPEN_UNTIL}</p>
          <p className={cn(TV_TEXT_BODY, 'mt-1 font-medium')}>Get your drinks and order food at the bar!</p>
        </div>
      </div>
    </section>
  );
}
