import { createBrowserClient } from '@supabase/ssr'
import { Database } from '@/types/database'
import { getPublicSupabaseEnv } from '@/lib/env'

export function createClient() {
  const { url, anonKey } = getPublicSupabaseEnv()
  return createBrowserClient<Database>(url, anonKey)
}
