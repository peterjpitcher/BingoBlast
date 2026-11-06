import type { Metadata } from 'next'
import { ForgotPasswordScreen } from '@anchor-nights/kit/auth/screens'
import { requestPasswordReset } from '@/app/auth/actions'
import { turnstileSiteKey } from '@/lib/auth/server'

export const metadata: Metadata = { title: 'Reset your password', robots: { index: false } }

export default function ForgotPasswordPage() {
  return <ForgotPasswordScreen action={requestPasswordReset} turnstileSiteKey={turnstileSiteKey()} />
}
