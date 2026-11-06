import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { PendingScreen } from '@anchor-nights/kit/auth/screens'
import { signOut } from '@/app/auth/actions'
import { authHelpers, HOME_FOR_ROLE } from '@/lib/auth/server'

export const metadata: Metadata = { title: 'Waiting for access', robots: { index: false } }

// Per request, never prerendered: the kit's helpers turn any error, Next's own
// "this page reads cookies" signal included, into "sign-in is unavailable", so
// without this the build tries to prerender the page and fails.
export const dynamic = 'force-dynamic'

/**
 * Where a signed-in account with no role lands: pending, deactivated, banned
 * or with no profile row. Someone promoted since is sent to their own screen.
 * The proxy does the same routing first; this repeats it on the server.
 */
export default async function PendingPage() {
  const session = await authHelpers().getSessionState()
  if (session.status === 'signed_out') redirect('/login')
  if (session.status === 'signed_in' && session.role) redirect(HOME_FOR_ROLE[session.role])
  const email = session.status === 'signed_in' ? session.user.email : null
  return <PendingScreen email={email} signOutAction={signOut} />
}
