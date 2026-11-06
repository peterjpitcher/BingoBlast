import { createAuthProxy } from '@anchor-nights/kit/auth/proxy'
import { getPublicSupabaseEnv } from '@/lib/env'
import { HOME_FOR_ROLE } from '@/lib/auth/routes'

// The kit's session adapter (auth standard sections 2 and 3). It refreshes the
// session with getUser() and carries the rotated cookies onto every response,
// redirects included (the mid-shift log-out lesson), routes by the role from
// current_staff_role() (pending, deactivated, banned or no profile all go to
// /pending), and fails closed with a 503 when Auth or the role lookup is down.
const { url, anonKey } = getPublicSupabaseEnv()

export const proxy = createAuthProxy({
  supabaseUrl: url,
  supabaseKey: anonKey,
  routes: [
    { prefix: '/admin', roles: ['admin'] },
    { prefix: '/host', roles: ['admin', 'host'] },
    { prefix: '/account', roles: ['admin', 'host'] },
  ],
  homeForRole: HOME_FOR_ROLE,
})

// Only staff and auth pages. The public pages (/, /display, /player, /play)
// stay off the matcher on purpose: every TV and phone refresh would otherwise
// pay a Supabase round trip (CLAUDE.md, Gotchas).
export const config = {
  matcher: [
    '/admin/:path*',
    '/host/:path*',
    '/account',
    '/login',
    '/pending',
    '/forgot-password',
    '/auth/:path*',
    '/invite',
  ],
}
