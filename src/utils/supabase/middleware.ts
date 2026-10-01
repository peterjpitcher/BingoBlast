import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { getPublicSupabaseEnv } from '@/lib/env'

/**
 * Roles that may reach a staff route at all.
 *
 * Authentication is not authorisation. `/host` used to admit anyone with a
 * session, which was fine only while every account that could exist was already
 * staff. It is not fine now: a new account lands as `pending` and holds a real
 * JWT, so the route check has to name the roles it accepts rather than checking
 * that somebody is signed in. A missing profile row is treated as pending too,
 * because "no role" must never mean "any role".
 */
const STAFF_ROLES = new Set(['admin', 'host'])

/**
 * Carries the refreshed Supabase auth cookies onto a redirect.
 *
 * `supabase.auth.getUser()` rotates an expired refresh token and writes the new
 * pair through the `setAll` hook onto `response`. Every redirect below used to
 * return a fresh `NextResponse.redirect(url)`, which carries none of them, so
 * the browser kept a refresh token that had already been consumed and the very
 * next request failed to refresh. In practice that logged a host out from behind
 * the bar an hour into a shift. Anything that returns instead of returning
 * `response` has to come through here.
 */
function redirectPreservingSession(url: URL, response: NextResponse): NextResponse {
  const redirect = NextResponse.redirect(url)
  response.cookies.getAll().forEach((cookie) => {
    redirect.cookies.set(cookie)
  })
  return redirect
}

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  })

  const { url, anonKey } = getPublicSupabaseEnv()
  const supabase = createServerClient(
    url,
    anonKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value)
          })
          response = NextResponse.next({
            request: {
              headers: request.headers,
            },
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl

  // The role is only needed to route a signed-in user, so it is only read for
  // one. An anonymous request costs no database round trip.
  let userRole: string | null = null
  if (user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()
    userRole = profile?.role ?? null
  }

  const isStaff = userRole !== null && STAFF_ROLES.has(userRole)

  const toLogin = () => {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.searchParams.set('next', pathname)
    return redirectPreservingSession(url, response)
  }

  const toPending = () => {
    const url = request.nextUrl.clone()
    url.pathname = '/pending'
    url.search = ''
    return redirectPreservingSession(url, response)
  }

  const toPath = (target: string) => {
    const url = request.nextUrl.clone()
    url.pathname = target
    url.search = ''
    return redirectPreservingSession(url, response)
  }

  if (pathname.startsWith('/admin')) {
    if (!user) return toLogin()
    if (userRole !== 'admin') {
      // A host is sent to the screen they can actually use. Anyone without a
      // staff role has no screen to be sent to, so they are told why.
      return isStaff ? toPath('/host') : toPending()
    }
  }

  if (pathname.startsWith('/host')) {
    if (!user) return toLogin()
    if (!isStaff) return toPending()
  }

  // A signed-in member of staff has no reason to see the login form. A
  // signed-in account with no staff role is sent to the explanation instead of
  // to the landing page, so it does not look like the sign-in silently failed.
  if (pathname === '/login' && user) {
    return isStaff ? toPath('/') : toPending()
  }

  return response
}
