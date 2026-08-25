import { createHash, timingSafeEqual } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

import { Database } from '@/types/database'

type SetupPayload = {
  email?: string
}

/**
 * The bootstrap endpoint. Promotes an existing auth user to admin, given the
 * shared secret.
 *
 * OPERATIONAL EXPECTATION: this exists to create the FIRST admin on a fresh
 * deployment. Once that admin exists, unset SETUP_SECRET, which turns this route
 * into a 404. Leaving it armed means the whole security model reduces to one
 * environment variable, and there is no reason to keep that risk after the one
 * time it is needed. Since new accounts now land as 'pending', this is also the
 * only route that can create a working account without database access, so it is
 * worth being deliberate about when it is on.
 */
function getSetupSecret() {
  return process.env.SETUP_SECRET
}

function isSetupSecretValid(providedSecret: string | null, setupSecret: string): boolean {
  const providedDigest = createHash('sha256')
    .update(providedSecret ?? '', 'utf8')
    .digest()
  const expectedDigest = createHash('sha256')
    .update(setupSecret, 'utf8')
    .digest()

  return timingSafeEqual(providedDigest, expectedDigest)
}

export async function GET() {
  return NextResponse.json(
    { error: 'Method not allowed. Use POST.' },
    { status: 405 }
  )
}

export async function POST(request: NextRequest) {
  const setupSecret = getSetupSecret()
  if (!setupSecret) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const providedSecret = request.headers.get('x-setup-secret')
  if (!isSetupSecretValid(providedSecret, setupSecret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let payload: SetupPayload = {}
  try {
    payload = (await request.json()) as SetupPayload
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const email = payload.email?.trim()
  if (!email) {
    return NextResponse.json({ error: 'Email required' }, { status: 400 })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseServiceKey) {
    return NextResponse.json(
      { error: 'Service key not configured' },
      { status: 500 }
    )
  }

  const supabase = createClient<Database>(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })

  const { data, error: userError } = await supabase.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  })

  if (userError || !data.users) {
    return NextResponse.json(
      { error: 'Failed to list users: ' + userError?.message },
      { status: 500 }
    )
  }

  const user = data.users.find((candidate) => candidate.email === email)

  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  // .select() so a write that changed nothing is a failure rather than a lie.
  // Without it, promoting a user who has no profiles row at all returned
  // { success: true, role: 'admin' } while writing nothing, and whoever ran it
  // would then spend a while wondering why the account still had no access.
  const { data: promoted, error: updateError } = await supabase
    .from('profiles')
    .update({ role: 'admin' })
    .eq('id', user.id)
    .select('id, role')

  if (updateError) {
    console.error('[api:setup] promote failed', { code: updateError.code, message: updateError.message })
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  if (!promoted || promoted.length === 0) {
    console.error('[api:setup] promote matched no rows: the user exists in auth but has no profiles row')
    return NextResponse.json(
      { error: 'That user has no profile row, so there was nothing to promote.' },
      { status: 409 }
    )
  }

  // Granting the admin role is the most privileged thing this deployment can do
  // and it happened with no trace at all. This is not an audit trail, but it is
  // the difference between "we can see it happened" and "we cannot".
  console.warn(`[api:setup] granted admin role via the setup endpoint to a user id ending ${user.id.slice(-4)}`)

  return NextResponse.json({ success: true, user: user.email, role: 'admin' })
}
