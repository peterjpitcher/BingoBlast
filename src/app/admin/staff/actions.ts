'use server'

import { revalidatePath } from 'next/cache'
import type { AuthFormState } from '@anchor-nights/kit/auth/shared'
import { adminActions, runAuthAction } from '@/lib/auth/server'

// The kit's staff admin actions (invites, roles, leaver, rehire, sign out
// everywhere). Each one re-checks on the server that the caller is an active
// admin before it touches anything; the screen only collects the request.

async function run(scope: string, action: () => Promise<AuthFormState>): Promise<AuthFormState> {
  const result = await runAuthAction(scope, action)
  if (result.status === 'ok') revalidatePath('/admin/staff')
  return result
}

export async function issueInvite(previous: AuthFormState, formData: FormData): Promise<AuthFormState> {
  return run('issueInvite', () => adminActions().issueInvite(previous, formData))
}

export async function cancelInvite(previous: AuthFormState, formData: FormData): Promise<AuthFormState> {
  return run('cancelInvite', () => adminActions().cancelInvite(previous, formData))
}

export async function changeRole(previous: AuthFormState, formData: FormData): Promise<AuthFormState> {
  return run('changeRole', () => adminActions().changeRole(previous, formData))
}

export async function deactivateUser(previous: AuthFormState, formData: FormData): Promise<AuthFormState> {
  return run('deactivateUser', () => adminActions().deactivateUser(previous, formData))
}

export async function reactivateUser(previous: AuthFormState, formData: FormData): Promise<AuthFormState> {
  return run('reactivateUser', () => adminActions().reactivateUser(previous, formData))
}

export async function revokeSessions(previous: AuthFormState, formData: FormData): Promise<AuthFormState> {
  return run('revokeSessions', () => adminActions().revokeSessions(previous, formData))
}
