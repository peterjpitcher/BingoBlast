import type { Metadata } from 'next'
import { AcceptInviteScreen } from '@anchor-nights/kit/auth/screens'
import { acceptInvite } from '@/app/auth/actions'
import { turnstileSiteKey } from '@/lib/auth/server'

export const metadata: Metadata = { title: 'Accept your invite', robots: { index: false } }

/** The invite link is /invite#t=<token>: the token stays in the fragment, so it never reaches a server log. */
export default function InvitePage() {
  return <AcceptInviteScreen action={acceptInvite} turnstileSiteKey={turnstileSiteKey()} />
}
