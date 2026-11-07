'use server'

import { revalidatePath } from 'next/cache'
import type { PairingFormState } from '@anchor-nights/kit/pairing/shared'
import { runAuthAction } from '@/lib/auth/server'
import { tvPairing } from '@/lib/tv-pairing'

// The kit's pairing actions (spec S3.1). Each re-checks on the server that the
// caller is active staff: host or admin to pair a TV, admin to remove one.
// runAuthAction fails closed ("sign-in is unavailable") when the config is
// missing or the kit throws, and reports the failure.

export async function pairTv(previous: PairingFormState, formData: FormData): Promise<PairingFormState> {
  const result = await runAuthAction('pairTv', () => tvPairing().actions.pairTv(previous, formData))
  if (result.status === 'ok') revalidatePath('/admin')
  return result
}

export async function revokeTv(previous: PairingFormState, formData: FormData): Promise<PairingFormState> {
  const result = await runAuthAction('revokeTv', () => tvPairing().actions.revokeTv(previous, formData))
  if (result.status === 'ok') revalidatePath('/admin')
  return result
}
