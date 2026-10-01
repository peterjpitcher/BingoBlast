// src/components/display/phone-events.tsx
//
// Upcoming events on a phone (spec 5.5, D5): at the start and end of the
// night on /player, and on /play when no bingo is running. The same events as
// the TV, next bingo night first, each with a "View event" link that opens in
// a new tab. Also the review button (spec 5.6), shown only when switched on.
//
// The labels ("Tonight", "7pm") need the phone's clock, so the list appears
// once the page is running in the browser; the server render leaves it out
// rather than guess.
'use client';

import React, { useState } from 'react';
import Image from 'next/image';
import { useMinuteClock } from './screen-hooks';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import {
  eventLinkForPhase,
  getPhoneEventList,
  type EventsProjection,
  type PlaylistPhase,
  type ScreenEventImage,
} from '@/lib/playlist';
import { formatEventWhenAndTime } from '@/lib/dates';
import { REVIEW_URL, isReviewInviteEnabled } from '@/lib/venue-links';

const LINK_CLASS =
  'inline-flex min-h-[44px] items-center justify-center rounded-md border border-[#a57626] px-4 text-base font-semibold text-white hover:bg-[#0f6846]';

function EventThumbnail({ image }: { image: ScreenEventImage | null }) {
  const [failed, setFailed] = useState(false);
  if (!image || failed) return null;
  return (
    <Image
      src={image.url}
      alt={image.alt}
      width={64}
      height={64}
      className={image.square ? 'h-16 w-16 shrink-0 rounded-md object-contain' : 'h-16 w-16 shrink-0 rounded-md object-cover'}
      onError={() => setFailed(true)}
    />
  );
}

interface PhoneEventsProps {
  projection: EventsProjection | null;
  /** The phone's session date, so tonight's own bingo night is left out; null on /play. */
  sessionDate: string | null;
  /** Picks the pre- or post-event link: before_start, night_over, or idle on /play. */
  phase: PlaylistPhase;
  className?: string;
}

export function PhoneEvents({ projection, sessionDate, phase, className }: PhoneEventsProps) {
  const minuteMs = useMinuteClock();
  if (minuteMs === 0) return null;
  const items = getPhoneEventList(projection, new Date(minuteMs), sessionDate);
  if (items.length === 0) return null;

  return (
    <Card className={cn('bg-[#003f27] border-[#1f7c58]', className)}>
      <CardContent className="p-5 text-left">
        <h2 className="mb-3 text-xl font-bold text-white">Coming up at The Anchor</h2>
        <ul className="space-y-3">
          {items.map(({ event, isNextBingo }) => {
            const whenLine = formatEventWhenAndTime(event.startsAt, minuteMs);
            return (
              <li key={event.id} className="flex gap-3 rounded-lg border border-[#1f7c58] bg-[#005131] p-3">
                <EventThumbnail key={event.image?.url ?? 'none'} image={event.image} />
                <div className="min-w-0 flex-1">
                  {isNextBingo && (
                    <p className="text-sm font-bold uppercase tracking-wide text-[#f3d59d]">Next bingo night</p>
                  )}
                  <p className="text-base font-bold leading-snug text-white">{event.title}</p>
                  {whenLine && <p className="text-base text-white">{whenLine}</p>}
                  <a
                    href={eventLinkForPhase(event, phase)}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`View event: ${event.title} (opens in a new tab)`}
                    className={`mt-2 ${LINK_CLASS}`}
                  >
                    View event
                  </a>
                </div>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

/** "Tell us how we did", to the feedback page (spec 5.6). Renders nothing while switched off. */
export function PhoneReviewButton() {
  if (!isReviewInviteEnabled()) return null;
  return (
    <a
      href={REVIEW_URL}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Tell us how we did (opens in a new tab)"
      className="flex min-h-[48px] w-full items-center justify-center rounded-xl border border-[#a57626] bg-[#003f27] px-5 text-lg font-bold text-white hover:bg-[#0f6846]"
    >
      Tell us how we did
    </a>
  );
}
