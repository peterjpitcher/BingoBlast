import { toAppRole, type AppRole } from '@anchor-nights/kit/auth/shared'

/** The one call this needs: Supabase's rpc on the app's cookie client. */
interface StaffRoleClient {
  rpc(fn: 'current_staff_role'): PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }>
}

export interface StaffProfileResult {
  /** The caller's role when they are active staff right now; null otherwise. */
  data: { role: AppRole } | null
  /** Set only when the lookup itself failed, which is not an answer about the role. */
  error: { code?: string; message: string } | null
}

/**
 * The signed-in caller's role, through the kit's current_staff_role(): their
 * stored role only while they are active staff (admin or host, not
 * deactivated, Auth user not banned or deleted). A pending, deactivated,
 * banned or profile-less account gets `data: null`, so a page or action that
 * checks the role refuses it. Same result shape as the profiles read it
 * replaces, so each caller keeps its own redirect and error handling.
 */
export async function readStaffProfile(supabase: StaffRoleClient): Promise<StaffProfileResult> {
  const { data, error } = await supabase.rpc('current_staff_role')
  if (error) return { data: null, error }
  const role = toAppRole(data)
  return { data: role ? { role } : null, error: null }
}
