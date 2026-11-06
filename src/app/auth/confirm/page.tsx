import type { Metadata } from 'next'
import { ConfirmRecoveryScreen } from '@anchor-nights/kit/auth/screens'
import { confirmRecovery } from '@/app/auth/actions'

export const metadata: Metadata = { title: 'Reset your password', robots: { index: false } }

/**
 * The emailed reset link lands here. Opening it does nothing (mail scanners
 * open links too): Continue POSTs, and only type=recovery is accepted.
 */
export default async function ConfirmPage({
  searchParams,
}: {
  searchParams: Promise<{ token_hash?: string | string[]; type?: string | string[] }>
}) {
  const params = await searchParams
  const tokenHash = typeof params.token_hash === 'string' ? params.token_hash : undefined
  const type = typeof params.type === 'string' ? params.type : undefined
  return <ConfirmRecoveryScreen action={confirmRecovery} tokenHash={tokenHash} type={type} />
}
