'use server'

import { redirect } from 'next/navigation'
import type { AuthFormState } from '@anchor-nights/kit/auth/shared'
import { authActions, runAuthAction } from '@/lib/auth/server'

// The kit's sign-in flows as this app's Server Actions (Next needs the
// 'use server' directive in the app). Each one runs on the server only and
// fails closed: src/lib/auth/server.ts. There is deliberately no sign-up
// action: accounts are created only by accepting an admin's invite.

export async function signIn(previous: AuthFormState, formData: FormData): Promise<AuthFormState> {
  return runAuthAction('signIn', () => authActions().signIn(previous, formData))
}

export async function signOut(): Promise<AuthFormState> {
  return runAuthAction('signOut', () => authActions().signOut())
}

/**
 * Sign out from a plain form (the admin header, the host console's icon
 * button), so those keep their look. On success it redirects to sign-in; on
 * failure it throws, so the person sees the error screen rather than a sign
 * out that did not happen.
 */
export async function signOutFromForm(): Promise<void> {
  const result = await signOut()
  if (result.status === 'ok') redirect(result.redirectTo ?? '/login')
  throw new Error(result.status === 'error' ? result.error : 'We could not sign you out. Please try again.')
}

export async function requestPasswordReset(previous: AuthFormState, formData: FormData): Promise<AuthFormState> {
  return runAuthAction('requestPasswordReset', () => authActions().requestPasswordReset(previous, formData))
}

export async function confirmRecovery(previous: AuthFormState, formData: FormData): Promise<AuthFormState> {
  return runAuthAction('confirmRecovery', () => authActions().confirmRecovery(previous, formData))
}

export async function resetPassword(previous: AuthFormState, formData: FormData): Promise<AuthFormState> {
  return runAuthAction('resetPassword', () => authActions().resetPassword(previous, formData))
}

export async function changePassword(previous: AuthFormState, formData: FormData): Promise<AuthFormState> {
  return runAuthAction('changePassword', () => authActions().changePassword(previous, formData))
}

export async function acceptInvite(previous: AuthFormState, formData: FormData): Promise<AuthFormState> {
  return runAuthAction('acceptInvite', () => authActions().acceptInvite(previous, formData))
}
