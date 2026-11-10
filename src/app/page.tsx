import type { ReactElement } from 'react';
import Link from 'next/link';
import { FrontPage } from '@anchor-nights/kit/front';
import { getEventsFeed, scheduleReport } from '@/lib/events-feed';
import { loadOtherNights, readOtherNightUrls } from '@/lib/other-nights';

// The front page every night shares (spec S2.3, row C-7): the kit's three
// tiles and the "Other nights" row. The row needs the events feed, so the page
// renders per request and the build never calls the management app; the feed
// itself is cached for five minutes by the kit (src/lib/events-feed.ts).
export const dynamic = 'force-dynamic';

export default async function Home(): Promise<ReactElement> {
  const otherNights = await loadOtherNights({
    getFeed: getEventsFeed,
    urls: readOtherNightUrls(),
    report: scheduleReport,
  });

  return (
    <FrontPage
      appName="Bingo night"
      tiles={{ tv: { href: '/tv' }, admin: { href: '/admin', hint: 'Sessions, pots and winners' } }}
      otherNights={otherNights}
      backdropSrc="/the-anchor-bar.jpg"
      linkComponent={Link}
    />
  );
}
