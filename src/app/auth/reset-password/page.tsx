import type { Metadata } from 'next'
import { ResetPasswordScreen } from '@anchor-nights/kit/auth/screens'
import { resetPassword } from '@/app/auth/actions'

export const metadata: Metadata = { title: 'Choose a new password', robots: { index: false } }

/** Needs the 10-minute recovery grant cookie that /auth/confirm sets; without it the action refuses. */
export default function ResetPasswordPage() {
  return <ResetPasswordScreen action={resetPassword} />
}
