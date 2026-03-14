'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { createClient } from '@/utils/supabase/server'
import type { ActionResult } from '@/types/actions'

function sanitizeNextUrl(rawNext: string | null) {
  const nextUrl = rawNext || '/'
  if (!nextUrl.startsWith('/')) return '/'
  if (nextUrl.startsWith('//')) return '/'
  return nextUrl
}

export async function login(formData: FormData): Promise<ActionResult> {
  const supabase = await createClient()

  const email = formData.get('email') as string
  const password = formData.get('password') as string
  const nextUrl = sanitizeNextUrl(formData.get('next') as string | null)

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  })

  if (error) {
    return { success: false, error: error.message }
  }

  revalidatePath('/', 'layout')
  return { success: true, redirectTo: nextUrl }
}

// NOTE: Public sign-up is disabled — this project is invite-only.
// This action is gated to prevent unauthorized account creation.
export async function signup(_formData: FormData): Promise<ActionResult> {
    return { success: false, error: 'Registration is invite-only. Please contact an administrator.' }
  }

export async function signout() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  revalidatePath('/', 'layout')
  redirect('/login')
}
