// src/components/display/follow-qr.tsx
//
// The follow-along QR codes on the TV (spec 5.4), both built on the same
// payload (buildFollowUrl): the corner card during the night, and the big
// before_start slide. Level M, with a two-module quiet zone inside a white
// tile so a phone can read it from across the room.
import React from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { QR_BACKGROUND, QR_FOREGROUND } from '@/lib/brand';
import { stripScheme } from '@/lib/follow-link';
import { cn } from '@/lib/utils';
import { KITCHEN_OPEN_UNTIL } from '@/lib/venue-links';
import { cardClass } from '@/components/ui/card';
import { TV_KICKER_CLASS, TV_SIZE, tvText } from './tv-text';

const QR_TITLE = 'QR code: follow the numbers on your phone';

// 206px with a two-module margin leaves the code itself at least 180px
// (spec 5.4); 22vh grows it to about 238px at 1080p.
const CORNER_QR_SIZE = 'clamp(206px, 22vh, 260px)';
// The white tile's padding and the card's: 10px and 16px at 1080p.
const CORNER_TILE_PAD = 'clamp(6px, 0.93vh, 10px)';
const CORNER_CARD_PAD = 'clamp(10px, 1.48vh, 16px)';
/**
 * The corner card's whole width (code, both paddings and the 1px border each
 * side): 292px at 1080p, 242px at 720p. The screen uses it to keep the ball
 * clear of the snowball card (display-ui.tsx).
 */
export const CORNER_QR_CARD_WIDTH = `calc(${CORNER_QR_SIZE} + 2 * ${CORNER_TILE_PAD} + 2 * ${CORNER_CARD_PAD} + 2px)`;
// At least half the screen height: 540px at 1080p (spec 5.4).
const SLIDE_QR_SIZE = 'max(50vh, 360px)';

/** The corner card, laid out in its own column so it never covers content. */
export function FollowQrBadge({ url }: { url: string }) {
  return (
    <div
      className={cardClass({ className: 'flex flex-col items-center gap-[clamp(9px,1.3vh,14px)]' })}
      style={{ width: CORNER_QR_CARD_WIDTH, padding: CORNER_CARD_PAD }}
    >
      <div className="rounded-card bg-white" style={{ padding: CORNER_TILE_PAD }}>
        <QRCodeSVG
          value={url}
          level="M"
          marginSize={2}
          size={260}
          title={QR_TITLE}
          fgColor={QR_FOREGROUND}
          bgColor={QR_BACKGROUND}
          style={{ display: 'block', width: CORNER_QR_SIZE, height: CORNER_QR_SIZE }}
        />
      </div>
      <p className={tvText('xs', 'text-balance text-center font-semibold leading-[1.15]')}>Follow along on your phone</p>
    </div>
  );
}

/** The before_start follow-along slide: the big QR and how to use it. */
export function FollowAlongSlide({ url }: { url: string }) {
  return (
    <section
      aria-label="Follow the numbers on your phone"
      className="mx-auto flex h-full w-full max-w-[1700px] items-center justify-center gap-[4.6vw] text-anchor-cream-text"
    >
      <div className="shrink-0 rounded-card border border-line-gold bg-white p-[clamp(14px,2.2vh,24px)]">
        <QRCodeSVG
          value={url}
          level="M"
          marginSize={2}
          size={540}
          title={QR_TITLE}
          fgColor={QR_FOREGROUND}
          bgColor={QR_BACKGROUND}
          style={{ display: 'block', width: SLIDE_QR_SIZE, height: SLIDE_QR_SIZE }}
        />
      </div>
      {/* The column is capped so a long address (one that carries the session
          id) wraps under the headline instead of pushing the code off centre. */}
      <div className="flex min-w-0 max-w-[clamp(620px,86vh,930px)] flex-col gap-[clamp(14px,2.6vh,28px)] text-left">
        <p className={TV_KICKER_CLASS}>Anchor Bingo Night</p>
        <h1 className={tvText('2xl', 'max-w-[12ch] leading-[0.98]')}>Follow the numbers on your phone</h1>
        <p className={tvText('base', 'font-medium')}>Point your camera at the code, or go to</p>
        <p className={cn(TV_SIZE.url, 'break-all font-bold leading-[1.05] text-anchor-gold-bright')}>{stripScheme(url)}</p>
        <div
          className={cardClass({
            accent: true,
            className: 'mt-[0.7vh] flex flex-col gap-[0.6vh] px-[clamp(18px,2.6vh,28px)] py-[clamp(14px,2.2vh,24px)]',
          })}
        >
          <p className={tvText('lg', 'font-display leading-none')}>Kitchen open until {KITCHEN_OPEN_UNTIL}</p>
          <p className={tvText('xs', 'font-medium')}>Order food and drinks at the bar.</p>
        </div>
      </div>
    </section>
  );
}
