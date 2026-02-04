import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

import { Database } from '@/types/database'

type SetupPayload = {
  email?: string
}

function getSetupSecret() {
  return process.env.SETUP_SECRET
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
  if (!providedSecret || providedSecret !== setupSecret) {
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

  const { error: updateError } = await supabase
    .from('profiles')
    .update({ role: 'admin' })
    .eq('id', user.id)

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, user: user.email, role: 'admin' })
}
