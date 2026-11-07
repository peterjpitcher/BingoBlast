import { createHash, timingSafeEqual } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { authMaintenance } from '@/lib/auth/server'
import { reportError } from '@/lib/report-error'
import { tvPairing } from '@/lib/tv-pairing'

// The daily sign-in clean-up (kit README step 6), run by Vercel Cron
// (vercel.json, once a day, inside the free tier):
//   * pruneAuthData: sign-in telemetry older than 12 months, other audit
//     events older than 6 years, spent recovery grants, finished invites
//     older than 12 months.
//   * reconcileInvites: invite acceptances stuck half way (a crash between
//     creating the banned user and switching it on) are failed and the
//     still-banned user deleted.
//   * prunePairing (TV pairing, kit README step 6): pairing codes after a
//     day, pairing attempts (with their IP addresses) after 30 days, removed
//     TVs 12 months after removal.
//
// Never callable from a browser: Vercel sends `Authorization: Bearer
// <CRON_SECRET>`. With CRON_SECRET unset the route refuses everything (503),
// so a missing secret cannot leave it open.

export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store' }

function bearerMatches(header: string | null, secret: string): boolean {
  const provided = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : ''
  const a = createHash('sha256').update(provided, 'utf8').digest()
  const b = createHash('sha256').update(secret, 'utf8').digest()
  return timingSafeEqual(a, b)
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET?.trim()
  if (!secret) {
    return NextResponse.json({ error: 'not_configured' }, { status: 503, headers: NO_STORE })
  }
  if (!bearerMatches(request.headers.get('authorization'), secret)) {
    return NextResponse.json({ error: 'unauthorised' }, { status: 401, headers: NO_STORE })
  }

  try {
    const maintenance = authMaintenance()
    const pruned = await maintenance.pruneAuthData()
    const invites = await maintenance.reconcileInvites()
    const pairing = await tvPairing().maintenance.prunePairing()
    return NextResponse.json({ ok: true, pruned, invites, pairing }, { headers: NO_STORE })
  } catch (error) {
    // Fails loudly: Vercel shows the 500 on the cron run and the report lands
    // on /admin/errors.
    await reportError({ scope: 'cron:auth-maintenance' }, error)
    return NextResponse.json({ error: 'maintenance_failed' }, { status: 500, headers: NO_STORE })
  }
}
