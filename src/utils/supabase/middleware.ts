import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
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

  // Fetch user role if logged in
  let userRole: string | null = null
  if (user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()
    userRole = profile?.role || null
  }

  // Protected routes
  if (request.nextUrl.pathname.startsWith('/admin')) {
    if (!user || userRole !== 'admin') {
      const url = request.nextUrl.clone()
      if (user) {
        // User is logged in but not admin -> redirect to host dashboard
        url.pathname = '/host'
      } else {
        // User is not logged in -> redirect to login
        url.pathname = '/login'
        url.searchParams.set('next', request.nextUrl.pathname)
      }
      return NextResponse.redirect(url)
    }
  }

  if (request.nextUrl.pathname.startsWith('/host')) {
    if (!user) {
      const url = request.nextUrl.clone()
      url.pathname = '/login'
      url.searchParams.set('next', request.nextUrl.pathname)
      return NextResponse.redirect(url)
    }
  }

  // Redirect logged-in users away from /login
  if (request.nextUrl.pathname === '/login') {
    if (user) {
      const url = request.nextUrl.clone()
      url.pathname = '/' // Or default dashboard
      return NextResponse.redirect(url)
    }
  }

  return response
}
