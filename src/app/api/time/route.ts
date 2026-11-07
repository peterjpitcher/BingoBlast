import { NextResponse } from 'next/server'

/**
 * The server's clock, for the public screens' clock offset
 * (useClockOffset in @anchor-nights/kit/tv). A TV whose own clock runs fast would otherwise
 * see every ball as already old and skip the public reveal delay.
 *
 * Never cached: a cached reading is a wrong reading.
 */
export const dynamic = 'force-dynamic'

export function GET(): NextResponse {
  return NextResponse.json(
    { now: Date.now() },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}
