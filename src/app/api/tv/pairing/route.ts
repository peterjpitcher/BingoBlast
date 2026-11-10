import { tvPairing } from '@/lib/tv-pairing'
import { reportError } from '@/lib/report-error'

// The TV's pairing endpoint (kit README "TV pairing adoption", step 3): POST
// asks for a 6-digit code, GET polls until a host has typed it in. Public on
// purpose (the TV is not signed in) and outside the auth proxy: a code alone
// does nothing until active staff type it, and the device cookie only lands
// in the browser holding the matching pairing secret. The kit rate limits
// both. When the pairing cannot be built (a preview without the sign-in
// variables) it answers 503, never a code.

export const dynamic = 'force-dynamic'

const UNAVAILABLE = (): Response =>
  new Response(JSON.stringify({ status: 'unavailable' }), {
    status: 503,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })

async function run(scope: string, handle: () => Promise<Response>): Promise<Response> {
  try {
    return await handle()
  } catch (error) {
    await reportError({ scope: `tv:pairing:${scope}` }, error)
    return UNAVAILABLE()
  }
}

export async function POST(request: Request): Promise<Response> {
  return run('post', () => tvPairing().routes.POST(request))
}

export async function GET(request: Request): Promise<Response> {
  return run('get', () => tvPairing().routes.GET(request))
}
