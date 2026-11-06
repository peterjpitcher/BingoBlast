import { NextRequest, NextResponse } from 'next/server'

import {
  clientKeyFrom,
  createRateLimiter,
  handleErrorReport,
  type AppErrorInsert,
  type InsertResult,
} from '@/lib/error-sink'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Where src/lib/report-error.ts sends a report: set ERROR_SINK_URL to this
 * route's production address and ERROR_SINK_TOKEN to a long random value. The
 * rules (bearer token, size and rate limits, redaction, fail closed) live in
 * src/lib/error-sink.ts; this file only connects them to the service-role
 * client, which is the only role that can write public.app_errors.
 */
export const dynamic = 'force-dynamic'

// One limiter per serverless instance; see createRateLimiter.
const allow = createRateLimiter()

async function insertWithServiceRole(row: AppErrorInsert): Promise<InsertResult> {
  // The shared admin client (auth standard section 2); it throws without the key.
  let supabase: ReturnType<typeof createAdminClient>
  try {
    supabase = createAdminClient()
  } catch {
    return { ok: false, code: 'not_configured' }
  }

  // .select() so a write that stored nothing is a failure, not a success.
  const { data, error } = await supabase.from('app_errors').insert(row).select('id').single()
  if (error) return { ok: false, code: error.code }
  if (!data?.id) return { ok: false, code: 'no_row' }
  return { ok: true, id: data.id }
}

export function GET(): NextResponse {
  return NextResponse.json({ ok: false, error: 'method_not_allowed' }, { status: 405 })
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const hasServiceRole = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)

  const result = await handleErrorReport(
    {
      authorization: request.headers.get('authorization'),
      contentLength: request.headers.get('content-length'),
      clientKey: clientKeyFrom(request.headers.get('x-forwarded-for'), request.headers.get('x-real-ip')),
      userAgent: request.headers.get('user-agent'),
      readBody: () => request.text(),
    },
    {
      token: process.env.ERROR_SINK_TOKEN?.trim() || undefined,
      insert: hasServiceRole ? insertWithServiceRole : undefined,
      allow,
    },
  )

  return NextResponse.json(result.body, {
    status: result.status,
    headers: { 'Cache-Control': 'no-store' },
  })
}
