import 'server-only'

import { cookies, headers } from 'next/headers'
import { redirect, unstable_rethrow } from 'next/navigation'
import {
  AUTH_MESSAGES,
  createAdminActions,
  createAuthActions,
  createAuthHelpers,
  createAuthMaintenance,
  defineAuthConfig,
  readAuthEnv,
  type AdminActions,
  type AuthActions,
  type AuthAlert,
  type AuthConfig,
  type AuthFormState,
  type AuthHelpers,
} from '@anchor-nights/kit/auth'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { reportError } from '@/lib/report-error'
import { HOME_FOR_ROLE } from '@/lib/auth/routes'

// Cash Bingo's wiring of the kit's sign-in (@anchor-nights/kit/auth v2,
// auth-standard.md v2.3, spec S1 and row C-5). The kit never makes a client
// or reads a key: this file hands it the app's own server client (cookie
// session, public key), the admin client (service role, server only) and
// Next's cookies and headers. The 'use server' wrappers live in
// src/app/auth/actions.ts and src/app/admin/staff/actions.ts.
//
// Built lazily, on first use, not at import: a Vercel preview may be built
// without the auth variables (src/lib/env.ts), and every page that imports a
// Server Action would otherwise fail to build there. Without them every auth
// action fails closed with "sign-in is unavailable", never a silent success.

export const APP_NAME = 'anchor-bingo'

export { HOME_FOR_ROLE }

/**
 * Every alert is reported (it lands in app_errors and on /admin/errors).
 * Cash Bingo has no paging service, so a 'high' alert reaches a person only
 * when an admin reads that page; see the PR and CLAUDE.md.
 */
async function alert(a: AuthAlert): Promise<void> {
  await reportError({ scope: `auth:${a.severity}:${a.kind}` }, new Error(a.message))
}

let cachedConfig: AuthConfig | null = null

/** The checked auth config. Throws (naming the variables, never their values) when the env is incomplete. */
export function authConfig(): AuthConfig {
  if (cachedConfig) return cachedConfig
  const env = readAuthEnv()
  cachedConfig = defineAuthConfig({
    app: APP_NAME,
    environment: process.env.VERCEL_ENV ?? 'development',
    appUrl: env.NEXT_PUBLIC_APP_URL,
    auditHmacKey: env.AUDIT_HMAC_KEY,
    homeForRole: HOME_FOR_ROLE,
    alert,
  })
  return cachedConfig
}

const deps = () => ({
  config: authConfig(),
  serverClient: createClient,
  adminClient: createAdminClient,
  cookies,
  headers,
})

let cachedActions: AuthActions | null = null
let cachedAdmin: AdminActions | null = null
let cachedHelpers: AuthHelpers | null = null

export function authActions(): AuthActions {
  cachedActions ??= createAuthActions(deps())
  return cachedActions
}

export function adminActions(): AdminActions {
  cachedAdmin ??= createAdminActions({
    ...deps(),
    profileIdColumn: 'id',
  })
  return cachedAdmin
}

/** Verified user and role for pages and Server Actions (re-read on the server every time). */
export function authHelpers(): AuthHelpers {
  cachedHelpers ??= createAuthHelpers({ config: authConfig(), serverClient: createClient, redirect })
  return cachedHelpers
}

export function authMaintenance(): ReturnType<typeof createAuthMaintenance> {
  return createAuthMaintenance({ config: authConfig(), adminClient: createAdminClient })
}

/** The answer every auth action gives when the auth config cannot be built. */
export const AUTH_UNAVAILABLE: AuthFormState = Object.freeze({
  status: 'error',
  code: 'service_unavailable',
  error: AUTH_MESSAGES.serviceUnavailable,
})

/**
 * Runs an auth action, failing closed when the config is missing or the kit
 * throws. The failure is reported so it shows on /admin/errors.
 */
export async function runAuthAction(scope: string, run: () => Promise<AuthFormState>): Promise<AuthFormState> {
  try {
    return await run()
  } catch (error) {
    // Next's redirect and other control-flow signals must pass through.
    unstable_rethrow(error)
    await reportError({ scope: `auth:${scope}` }, error)
    return AUTH_UNAVAILABLE
  }
}

/** The public Turnstile site key for the screens ('' when unset, in which case sign-in fails closed). */
export function turnstileSiteKey(): string {
  return process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() ?? ''
}
