import 'server-only'

import { cookies, headers } from 'next/headers'
import { createTvPairing, type TvPairing, type TvView, type ResolveTonight } from '@anchor-nights/kit/pairing'
import { authConfig } from '@/lib/auth/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { reportError } from '@/lib/report-error'
import { findTonight, type TonightSession } from '@/lib/tv-tonight'

// Cash Bingo's wiring of the kit's TV pairing (@anchor-nights/kit/pairing,
// spec S3.1 and S3.2, row C-6). A TV opens /tv, shows a 6-digit code, a host
// or admin types it into the host console, and the TV then holds a device
// cookie (only its SHA-256 is stored, in tv_devices). An admin can remove a
// TV from /admin. /display stays public; /tv draws the same screen.
//
// Built lazily, like the auth wiring (src/lib/auth/server.ts): a Vercel
// preview may be built without the sign-in variables, and authConfig() throws
// then. Every caller below fails closed when it does.

let cached: TvPairing | null = null

export function tvPairing(): TvPairing {
  cached ??= createTvPairing({
    config: authConfig(),
    serverClient: createClient,
    adminClient: createAdminClient,
    cookies,
    headers,
    report: (scope, error) => void reportError({ scope }, error),
  })
  return cached
}

export interface TvPageDeps {
  pairing: () => TvPairing
  resolveTonight: ResolveTonight<TonightSession>
}

const DEFAULT_DEPS: TvPageDeps = { pairing: tvPairing, resolveTonight: findTonight }

/**
 * What /tv shows. Any failure, the pairing config included, is "unavailable":
 * the kit then shows "Reconnecting" and reloads, never a game and never a
 * pairing code (a paired TV must not look unpaired because something blinked).
 */
export async function resolveTvPageView(rehearsal: boolean, deps: TvPageDeps = DEFAULT_DEPS): Promise<TvView<TonightSession>> {
  try {
    return await deps.pairing().resolveTvView({ resolveTonight: deps.resolveTonight, rehearsal })
  } catch (error) {
    await reportError({ scope: 'tv:resolve' }, error)
    return { kind: 'unavailable', reason: 'device_lookup' }
  }
}
