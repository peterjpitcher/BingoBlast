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
  
    // Fetch old pot data for audit trail
    const { data: oldPot, error: fetchOldPotError } = await supabase
        .from('snowball_pots')
        .select('current_max_calls, current_jackpot_amount')
        .eq('id', id)
        .single<{ current_max_calls: number; current_jackpot_amount: number }>()

    if (fetchOldPotError || !oldPot) {
        return { success: false, error: fetchOldPotError?.message || "Pot not found for audit." }
    }
    
    const { error } = await supabase
      .from('snowball_pots')
      .update(parsed.data)
      .eq('id', id)
  
    if (error) {
      return { success: false, error: error.message }
    }

    // Insert audit record
    const { error: auditError } = await supabase.from('snowball_pot_history').insert({
        snowball_pot_id: id,
        change_type: 'manual_update',
        old_val_max: oldPot.current_max_calls,
        new_val_max: parsed.data.current_max_calls,
        old_val_jackpot: oldPot.current_jackpot_amount,
        new_val_jackpot: parsed.data.current_jackpot_amount,
        changed_by: authResult.user!.id,
    });
    if (auditError) {
        console.error("Error logging snowball pot update history:", auditError.message);
        // Continue despite error, not critical to block action
    }
  
    revalidatePath('/admin/snowball')
    return { success: true }
}

export async function deleteSnowballPot(id: string): Promise<ActionResult> {
    const supabase = await createClient()
    const authResult = await authorizeAdmin(supabase)
    if (!authResult.authorized) return { success: false, error: authResult.error }

    // Check if linked to any in_progress games
    const { data: activeGames } = await supabase
        .from('games')
        .select('id, game_states!inner(status)')
        .eq('snowball_pot_id', id)
        .eq('game_states.status', 'in_progress')
    
    if (activeGames && activeGames.length > 0) {
        return { success: false, error: "Cannot delete pot: It is currently in use by an active game." }
    }
    
    const { error } = await supabase
      .from('snowball_pots')
      .delete()
      .eq('id', id)
  
    if (error) {
      return { success: false, error: error.message }
    }
  
    revalidatePath('/admin/snowball')
    return { success: true }
}

export async function resetSnowballPot(id: string): Promise<ActionResult> {
    const supabase = await createClient()
    const authResult = await authorizeAdmin(supabase)
    if (!authResult.authorized) return { success: false, error: authResult.error }

    // Check if linked to any in_progress games
    const { data: activeGames } = await supabase
        .from('games')
        .select('id, game_states!inner(status)')
        .eq('snowball_pot_id', id)
        .eq('game_states.status', 'in_progress')
    
    if (activeGames && activeGames.length > 0) {
        return { success: false, error: "Cannot reset pot: It is currently in use by an active game." }
    }

    // Fetch old pot data for audit trail
    const { data: oldPot, error: fetchOldPotError } = await supabase
        .from('snowball_pots')
        .select('base_max_calls, base_jackpot_amount, current_max_calls, current_jackpot_amount')
        .eq('id', id)
        .single<{ base_max_calls: number; base_jackpot_amount: number, current_max_calls: number; current_jackpot_amount: number }>()
    
    if (fetchOldPotError || !oldPot) {
        return { success: false, error: fetchOldPotError?.message || "Pot not found for audit." }
    }

    // Fetch base values
    const { data: pot, error: fetchError } = await supabase
        .from('snowball_pots')
        .select('base_max_calls, base_jackpot_amount')
        .eq('id', id)
        .single<{ base_max_calls: number; base_jackpot_amount: number }>()
    
    if (fetchError || !pot) {
        return { success: false, error: "Pot not found" }
    }

    const { error } = await supabase
        .from('snowball_pots')
        .update({
            current_max_calls: pot.base_max_calls,
            current_jackpot_amount: pot.base_jackpot_amount,
            last_awarded_at: null // Optional: reset this or keep history
        })
        .eq('id', id)

    if (error) {
        return { success: false, error: error.message }
    }

    // Insert audit record
    const { error: auditError } = await supabase.from('snowball_pot_history').insert({
        snowball_pot_id: id,
        change_type: 'manual_reset',
        old_val_max: oldPot.current_max_calls,
        new_val_max: oldPot.base_max_calls,
        old_val_jackpot: oldPot.current_jackpot_amount,
        new_val_jackpot: oldPot.base_jackpot_amount,
        changed_by: authResult.user!.id,
    });
    if (auditError) {
        console.error("Error logging snowball pot reset history:", auditError.message);
        // Continue despite error
    }

    revalidatePath('/admin/snowball')
    return { success: true }
}
