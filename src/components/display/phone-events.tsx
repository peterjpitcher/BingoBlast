// src/components/display/phone-events.tsx
//
// Upcoming events on a phone (spec 5.5, D5): at the start and end of the
// night, under the break card and between games on /player, and on /play when
// no bingo is running. The same events as the TV, next bingo night first, each with a
// "View event" link that opens in a new tab. Also the review button (spec
// 5.6), shown only when switched on.
//
// The labels ("Tonight", "7pm") need the phone's clock, so the list appears
// once the page is running in the browser; the server render leaves it out
// rather than guess.
'use client';

import React, { useState } from 'react';
import Image from 'next/image';
import { useMinuteClock } from './screen-hooks';
import { buttonClass } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Kicker } from '@/components/ui/kicker';
import { cn } from '@/lib/utils';
import {
  eventLinkForPhase,
  getPhoneEventList,
  type EventsProjection,
  type PlaylistPhase,
  type ScreenEventImage,
} from '@/lib/playlist';
import { formatEventWhenAndTime } from '@/lib/dates';
import type { InGameSubState } from '@/lib/night-phase';
import { REVIEW_URL, isReviewInviteEnabled } from '@/lib/venue-links';

// The 72px photo tile: a gold hairline and the card's 3px corners.
const THUMBNAIL_CLASS = 'h-[72px] w-[72px] shrink-0 rounded-card border border-line bg-anchor-green-raised';

function EventThumbnail({ image }: { image: ScreenEventImage | null }) {
  const [failed, setFailed] = useState(false);
  if (!image || failed) return null;
  return (
    <Image
      src={image.url}
      alt={image.alt}
      width={72}
      height={72}
      className={cn(THUMBNAIL_CLASS, image.square ? 'object-contain' : 'object-cover')}
      onError={() => setFailed(true)}
    />
  );
}

interface PhoneEventsProps {
  projection: EventsProjection | null;
  /** The phone's session date, so tonight's own bingo night is left out; null on /play. */
  sessionDate: string | null;
  /**
   * With `inGameSubState`, picks the link (eventLinkForPhase): pre-event at
   * before_start, in-game on a break and between games, post-event at
   * night_over and when idle on /play.
   */
  phase: PlaylistPhase;
  /** For the in_game phase: 'break' is the only sub-state that lists events. */
  inGameSubState?: InGameSubState | null;
  className?: string;
}

export function PhoneEvents({ projection, sessionDate, phase, inGameSubState = null, className }: PhoneEventsProps) {
  const minuteMs = useMinuteClock();
  if (minuteMs === 0) return null;
  const items = getPhoneEventList(projection, new Date(minuteMs), sessionDate);
  if (items.length === 0) return null;

  return (
    <Card className={cn('flex flex-col gap-3.5 p-5 text-left', className)}>
      <h2 className="text-2xl leading-[1.1] text-anchor-cream-text">Coming up at The Anchor</h2>
      <ul className="flex flex-col gap-3.5">
        {items.map(({ event, isNextBingo }) => {
          const whenLine = formatEventWhenAndTime(event.startsAt, minuteMs);
          return (
            <li key={event.id} className="flex gap-3.5 border-t border-line pt-3.5">
              <EventThumbnail key={event.image?.url ?? 'none'} image={event.image} />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                {isNextBingo && (
                  <Kicker as="p" className="text-[11px]">Next bingo night</Kicker>
                )}
                <p className="font-display text-[22px] leading-[1.1] text-anchor-cream-text">{event.title}</p>
                {whenLine && <p className="text-[15px] leading-normal text-anchor-sage">{whenLine}</p>}
                <a
                  href={eventLinkForPhase(event, phase, inGameSubState)}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`View event: ${event.title} (opens in a new tab)`}
                  className={buttonClass({ variant: 'outline', size: 'sm', className: 'mt-1.5 self-start px-[18px]' })}
                >
                  View event
                </a>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/**
 * "Tell us how we did", to the feedback page (spec 5.6). Renders nothing while
 * switched off. It is the one primary action on the end-of-night view, the
 * only place it is shown.
 */
export function PhoneReviewButton() {
  if (!isReviewInviteEnabled()) return null;
  return (
    <a
      href={REVIEW_URL}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Tell us how we did (opens in a new tab)"
      className={buttonClass({ variant: 'primary', size: 'md', block: true })}
    >
      Tell us how we did
    </a>
  );
}
