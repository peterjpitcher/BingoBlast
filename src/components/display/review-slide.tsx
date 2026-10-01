// src/components/display/review-slide.tsx
//
// The review invitation as a pub TV slide (spec 5.6). The QR is made in the
// app, level M, at least half the screen height. The copy is exactly as
// approved: no rating request, no reward, no pressure.
//
// Switched off unless NEXT_PUBLIC_REVIEW_INVITE_ENABLED is 'true' (A5). The
// playlist leaves the slide out when it is off; this component checks again,
// so it can never render while the switch is off.
import React from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { REVIEW_URL, isReviewInviteEnabled } from '@/lib/venue-links';
import { tvText } from './tv-text';

// At least half the screen height: 540px at 1080p, 360px at 720p.
const REVIEW_QR_SIZE = 'max(50vh, 360px)';

export function ReviewSlide() {
  if (!isReviewInviteEnabled()) return null;
  return (
    <section
      aria-label="Tell us how we did"
      className="mx-auto flex h-full w-full max-w-[1700px] items-center justify-center gap-[4vw] text-white"
    >
      <div className="shrink-0 rounded-3xl bg-white p-[1.5vh]">
        <QRCodeSVG
          value={REVIEW_URL}
          level="M"
          marginSize={2}
          size={540}
          title="QR code: leave feedback"
          fgColor="#005131"
          bgColor="#FFFFFF"
          style={{ display: 'block', width: REVIEW_QR_SIZE, height: REVIEW_QR_SIZE }}
        />
      </div>
      <div className="flex min-w-0 flex-col gap-[2.4vh] text-left">
        <h1 className={tvText('lg', 'font-black')}>Enjoyed tonight? Tell us how we did</h1>
        <p className={tvText('base', 'font-semibold text-[#f3d59d]')}>Scan to leave feedback</p>
      </div>
    </section>
  );
}
