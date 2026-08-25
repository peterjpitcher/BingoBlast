'use server'

import { createClient } from '@/utils/supabase/server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import { Database, UserRole } from '@/types/database'
import type { ActionResult } from '@/types/actions'

const SnowballPotSchema = z.object({
  name: z.string().min(1, "Name is required"),
  base_max_calls: z.coerce.number().min(1),
  base_jackpot_amount: z.coerce.number().min(0),
  calls_increment: z.coerce.number().min(0),
  jackpot_increment: z.coerce.number().min(0),
  current_max_calls: z.coerce.number().min(1),
  current_jackpot_amount: z.coerce.number().min(0),
})

type AdminAuthResult =
  | { authorized: false; error: string }
  | { authorized: true; user: User; role: UserRole }

async function authorizeAdmin(
  supabase: SupabaseClient<Database>
): Promise<AdminAuthResult> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { authorized: false, error: "Not authenticated" }
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single<{ role: UserRole }>()

  if (profileError || !profile || profile.role !== 'admin') {
    return { authorized: false, error: "Unauthorized: Admin access required" }
  }
  
  return { authorized: true, user, role: profile.role }
}

/**
 * Turns the short keys the pot functions raise into words an admin reads, and
 * keeps the raw Postgres message out of the UI.
 *
 * The other admin actions in this file still return `error.message` straight to
 * the screen, which is the inconsistency the review flagged. The money paths get
 * the host actions' treatment first.
 */
function mapPotRpcError(action: string, error: { code?: string; message?: string } | null, data: unknown): ActionResult | null {
  if (error) {
    const key = (error.message ?? '').trim().split(':')[0]
    const known: Record<string, string | undefined> = {
      pot_not_found: 'Could not find that pot. Please reload.',
      pot_archived: 'That pot has been archived, so it cannot be edited.',
      pot_in_use: 'Cannot do that while a game using this pot has not finished.',
      unauthorized: 'Only an admin can change a snowball pot.',
    }
    console.error(`[admin:${action}]`, { code: error.code, message: error.message })
    return { success: false, error: known[key] ?? 'Could not save that change. Please try again.' }
  }
  if (!data) {
    // The function returns the persisted row, so no row means nothing was
    // written, whatever the absence of an error suggests.
    console.error(`[admin:${action}] returned no row`)
    return { success: false, error: 'Could not save that change. Please reload and try again.' }
  }
  return null
}

export async function createSnowballPot(_prevState: unknown, formData: FormData): Promise<ActionResult> {
  const supabase = await createClient()
  const authResult = await authorizeAdmin(supabase)
  if (!authResult.authorized) return { success: false, error: authResult.error }
  
  const parsed = SnowballPotSchema.safeParse({
    name: formData.get('name'),
    base_max_calls: formData.get('base_max_calls'),
    base_jackpot_amount: formData.get('base_jackpot_amount'),
    calls_increment: formData.get('calls_increment'),
    jackpot_increment: formData.get('jackpot_increment'),
    current_max_calls: formData.get('current_max_calls'),
    current_jackpot_amount: formData.get('current_jackpot_amount'),
  })

  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message }
  }

  const { error } = await supabase
    .from('snowball_pots')
    .insert(parsed.data)

  if (error) {
    return { success: false, error: error.message }
  }

  revalidatePath('/admin/snowball')
  return { success: true }
}

export async function updateSnowballPot(id: string, _prevState: unknown, formData: FormData): Promise<ActionResult> {
    const supabase = await createClient()
    const authResult = await authorizeAdmin(supabase)
    if (!authResult.authorized) return { success: false, error: authResult.error }

    const parsed = SnowballPotSchema.safeParse({
        name: formData.get('name'),
        base_max_calls: formData.get('base_max_calls'),
        base_jackpot_amount: formData.get('base_jackpot_amount'),
        calls_increment: formData.get('calls_increment'),
        jackpot_increment: formData.get('jackpot_increment'),
        current_max_calls: formData.get('current_max_calls'),
        current_jackpot_amount: formData.get('current_jackpot_amount'),
    })

    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0].message }
    }

    // One RPC, one transaction. This used to be three round trips: read the old
    // values, write the new ones with a bare .update(), then insert the audit row
    // separately and swallow its failure with a console.error and a comment
    // saying it was "not critical to block action". So the pot could move with no
    // audit row, or an audit row could be written for a move that did not happen,
    // and because the update had no .select() a write RLS filtered out was
    // reported as success. On a table that holds real cash.
    const { data, error } = await supabase.rpc('update_snowball_pot_safe', {
      p_pot_id: id,
      p_name: parsed.data.name,
      p_base_max_calls: parsed.data.base_max_calls,
      p_base_jackpot_amount: parsed.data.base_jackpot_amount,
      p_calls_increment: parsed.data.calls_increment,
      p_jackpot_increment: parsed.data.jackpot_increment,
      p_current_max_calls: parsed.data.current_max_calls,
      p_current_jackpot_amount: parsed.data.current_jackpot_amount,
    })

    const failed = mapPotRpcError('updateSnowballPot', error, data)
    if (failed) return failed

    revalidatePath('/admin/snowball')
    return { success: true }
}

/**
 * Retires a pot. It is not deleted, and its history is not touched.
 *
 * The old deleteSnowballPot ran three separate, non-transactional statements:
 * unlink every game from the pot, delete the pot's entire history, then delete
 * the pot. The unlink committed on its own, so historical games silently stopped
 * being snowball games and the host screen said "this game is not linked to a
 * snowball pot" about games that had been played for a jackpot. The history
 * delete matched zero rows because snowball_pot_history has no DELETE policy,
 * returned no error, and then the pot delete failed on the foreign key. The
 * links were gone for good and the pot was still there.
 *
 * Even when it worked, it destroyed the only record of how a real cash pot
 * reached its figure. Money history is not something to delete, so a retired pot
 * is archived: hidden from the list, unavailable to new games, everything kept.
 *
 * One RPC, one transaction, one `for update` lock, and admin-only inside the
 * function rather than only in this action.
 */
export async function archiveSnowballPot(id: string): Promise<ActionResult> {
    const supabase = await createClient()
    const authResult = await authorizeAdmin(supabase)
    if (!authResult.authorized) return { success: false, error: authResult.error }

    const { data, error } = await supabase.rpc('archive_snowball_pot', { p_pot_id: id })

    if (error) {
        const key = (error.message ?? '').trim().split(':')[0]
        if (key === 'pot_in_use') {
            return { success: false, error: 'Cannot archive this pot: a game using it has not finished yet.' }
        }
        if (key === 'pot_not_found') {
            return { success: false, error: 'Could not find that pot. Please reload.' }
        }
        if (key === 'unauthorized') {
            return { success: false, error: 'Only an admin can archive a snowball pot.' }
        }
        console.error('[admin:archiveSnowballPot]', { code: error.code, message: error.message })
        return { success: false, error: 'Could not archive that pot. Please try again.' }
    }

    if (!data) {
        return { success: false, error: 'Could not archive that pot. Please reload and try again.' }
    }

    revalidatePath('/admin/snowball')
    return { success: true }
}

export async function resetSnowballPot(id: string): Promise<ActionResult> {
    const supabase = await createClient()
    const authResult = await authorizeAdmin(supabase)
    if (!authResult.authorized) return { success: false, error: authResult.error }

    // As updateSnowballPot: one transaction, and the audit row is no longer
    // optional. The refusal while a game is unfinished now lives inside the
    // function, under the same lock as the write, so it cannot be raced.
    //
    // This also stops clearing last_awarded_at, which erased the record of when
    // the jackpot was last actually won. A manual correction to the current
    // figures says nothing about that.
    const { data, error } = await supabase.rpc('reset_snowball_pot_safe', { p_pot_id: id })

    const failed = mapPotRpcError('resetSnowballPot', error, data)
    if (failed) return failed

    revalidatePath('/admin/snowball')
    return { success: true }
}
