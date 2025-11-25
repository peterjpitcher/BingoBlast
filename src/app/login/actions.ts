'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { createClient } from '@/utils/supabase/server'

export async function login(formData: FormData) {
  const supabase = await createClient()

  const email = formData.get('email') as string
  const password = formData.get('password') as string
  const nextUrl = formData.get('next') as string || '/'

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  })

  if (error) {
    console.error("Login Error:", error.message)
    return { error: error.message }
  }

  revalidatePath('/', 'layout')
  return { success: true, redirectTo: nextUrl }
}

export async function signup(formData: FormData) {
    const supabase = await createClient()
  
    const email = formData.get('email') as string
    const password = formData.get('password') as string
    const nextUrl = formData.get('next') as string || '/'
  
    const { error } = await supabase.auth.signUp({
      email,
      password,
    })
  
    if (error) {
      console.error("Signup Error:", error.message)
      return { error: error.message }
    }
  
    revalidatePath('/', 'layout')
    return { success: true, redirectTo: nextUrl }
  }

export async function signout() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  revalidatePath('/', 'layout')
  redirect('/login')
}
