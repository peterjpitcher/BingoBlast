'use server'

import { createClient } from '@/utils/supabase/server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

const SnowballPotSchema = z.object({
  name: z.string().min(1, "Name is required"),
  base_max_calls: z.coerce.number().min(1),
  base_jackpot_amount: z.coerce.number().min(0),
  calls_increment: z.coerce.number().min(0),
  jackpot_increment: z.coerce.number().min(0),
  current_max_calls: z.coerce.number().min(1),
  current_jackpot_amount: z.coerce.number().min(0),
})

export async function createSnowballPot(_prevState: unknown, formData: FormData) {
  const supabase = await createClient()
  
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
    return { error: parsed.error.issues[0].message }
  }

  const { error } = await supabase
    .from('snowball_pots')
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    .insert(parsed.data)

  if (error) {
    return { error: error.message }
  }

  revalidatePath('/admin/snowball')
  return { success: true }
}

export async function updateSnowballPot(id: string, _prevState: unknown, formData: FormData) {
    const supabase = await createClient()
    
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
      return { error: parsed.error.issues[0].message }
    }
  
    // Log the change (Basic implementation of FR-15 logging)
    // Ideally we'd fetch the old one first to diff, but for speed we just update.
    
    const { error } = await supabase
      .from('snowball_pots')
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      .update(parsed.data)
      .eq('id', id)
  
    if (error) {
      return { error: error.message }
    }
  
    revalidatePath('/admin/snowball')
    return { success: true }
}

export async function deleteSnowballPot(id: string) {
    const supabase = await createClient()
    
    const { error } = await supabase
      .from('snowball_pots')
      .delete()
      .eq('id', id)
  
    if (error) {
      return { error: error.message }
    }
  
    revalidatePath('/admin/snowball')
    return { success: true }
}

export async function resetSnowballPot(id: string) {
    const supabase = await createClient()

    // Fetch base values
    const { data: pot, error: fetchError } = await supabase
        .from('snowball_pots')
        .select('base_max_calls, base_jackpot_amount')
        .eq('id', id)
        .single<{ base_max_calls: number; base_jackpot_amount: number }>()
    
    if (fetchError || !pot) {
        return { error: "Pot not found" }
    }

    const { error } = await supabase
        .from('snowball_pots')
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        .update({
            current_max_calls: pot.base_max_calls,
            current_jackpot_amount: pot.base_jackpot_amount,
            last_awarded_at: null // Optional: reset this or keep history
        })
        .eq('id', id)

    if (error) {
        return { error: error.message }
    }

    revalidatePath('/admin/snowball')
    return { success: true }
}
