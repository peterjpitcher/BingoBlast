import { NextResponse } from 'next/server'

/**
 * The deployment this server is running, for the build check
 * (src/lib/build-check.ts). A pub TV stays on one page all night and for days
 * at a time; comparing this with the id baked into its bundle
 * (NEXT_PUBLIC_BUILD_ID, set in next.config.ts) is how it learns a new release
 * is out.
 *
 * 'dev' outside Vercel, which the client never treats as a new release.
 */
export const dynamic = 'force-dynamic'

export function GET(): NextResponse {
  return NextResponse.json(
    { build: process.env.VERCEL_GIT_COMMIT_SHA ?? 'dev' },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}
