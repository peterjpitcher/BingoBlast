import { NextResponse } from 'next/server'
import { getEventsProjection } from '@/lib/events-feed/projection'
import type { EventsProjection } from '@/lib/events-feed/types'

/**
 * Upcoming events for the pub TV and phones (spec 5.5).
 *
 * Takes no parameters, and ignores any query string, so there is one cached
 * answer for everybody and a phone cannot make the server call the management
 * app more often. The projection behind it is cached for five minutes
 * (src/lib/events-feed/projection.ts); this response is cached by the CDN for
 * a minute on top.
 *
 * Dynamic so the build never calls the management app; the CDN caching comes
 * from the Cache-Control header instead.
 */
export const dynamic = 'force-dynamic'

export async function GET(): Promise<NextResponse<EventsProjection>> {
  const projection = await getEventsProjection()
  return NextResponse.json(projection, {
    headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' },
  })
}
