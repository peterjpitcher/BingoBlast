import 'server-only'

import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js'
import { getPublicSupabaseEnv } from '@/lib/env'
import type { Database } from '@/types/database'

/**
 * The admin client: the service-role key, server only (auth standard section 2).
 *
 * It bypasses RLS, so it is for system operations only: the kit's sign-in
 * plumbing (the auth audit, the login limiter, invites, recovery grants), the
 * staff admin actions after they have checked the caller is an active admin,
 * the daily auth clean-up, /api/setup and the error sink. Never for a user's
 * own reads, and never for the host or admin money functions: those read
 * auth.uid(), which is null under the service role.
 *
 * Throws when the key is missing, so a caller fails closed with a visible
 * error rather than quietly running as someone else.
 */
export function createAdminClient(): SupabaseClient<Database> {
  if (typeof window !== 'undefined') {
    throw new Error('The admin Supabase client must never run in a browser.')
  }
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!serviceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set, so the admin client cannot be made.')
  }
  const { url } = getPublicSupabaseEnv()
  return createSupabaseClient<Database>(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
