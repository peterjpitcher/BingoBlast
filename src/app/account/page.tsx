import React from 'react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { ChangePasswordForm, SignOutButton } from '@anchor-nights/kit/auth/screens'
import { AnchorLogo, Kicker } from '@anchor-nights/kit/ui'
import { changePassword, signOut } from '@/app/auth/actions'
import { authHelpers, HOME_FOR_ROLE, turnstileSiteKey } from '@/lib/auth/server'

export const metadata: Metadata = { title: 'Your account', robots: { index: false } }

// Per request, never prerendered: the kit's helpers turn any error, Next's own
// "this page reads cookies" signal included, into "sign-in is unavailable", so
// without this the build tries to prerender the page and fails.
export const dynamic = 'force-dynamic'

/** Change your password (current password checked on the server) or sign out. Any active staff member. */
export default async function AccountPage(): Promise<React.ReactElement> {
  const { user, role } = await authHelpers().requireRole(['admin', 'host'])
  return (
    <div className="relative flex min-h-screen-safe flex-col bg-anchor-green-deep text-anchor-cream-text">
      <div className="relative mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-5 pb-10 pt-[calc(env(safe-area-inset-top)+2rem)]">
        <div className="flex justify-center">
          <AnchorLogo height={64} priority />
        </div>
        <div className="flex flex-col gap-1.5">
          <Kicker>Your account</Kicker>
          <p className="break-all text-[15px] text-anchor-sage">{user.email}</p>
        </div>
        <ChangePasswordForm action={changePassword} turnstileSiteKey={turnstileSiteKey()} />
        <SignOutButton action={signOut} block />
        <Link href={HOME_FOR_ROLE[role]} className="self-center text-sm text-anchor-gold-bright underline underline-offset-4">
          Back
        </Link>
      </div>
    </div>
  )
}
