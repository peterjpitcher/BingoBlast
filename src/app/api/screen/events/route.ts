import { NextResponse } from 'next/server'
import type { ScreenFeed } from '@anchor-nights/kit/events'
import { getEventsFeed } from '@/lib/events-feed'

/**
 * Upcoming events for the pub TV and phones (Anchor Nights standard S7.1).
 *
 * Takes no parameters, and ignores any query string, so there is one cached
 * answer for everybody and a phone cannot make the server call the management
 * app more often. The feed behind it is cached for five minutes by the shared
 * kit (src/lib/events-feed.ts); this response is cached by the CDN for a
 * minute on top.
 *
 * Dynamic so the build never calls the management app; the CDN caching comes
 * from the Cache-Control header instead.
 */
export const dynamic = 'force-dynamic'

export async function GET(): Promise<NextResponse<ScreenFeed>> {
  const feed = await getEventsFeed()
  return NextResponse.json(feed, {
    headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' },
  })
}
