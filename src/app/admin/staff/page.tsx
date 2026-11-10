import React from 'react'
import type { Metadata } from 'next'
import { InvitePanel, StaffPanel } from '@anchor-nights/kit/auth/screens'
import { Kicker } from '@anchor-nights/kit/ui'
import { adminActions, authHelpers } from '@/lib/auth/server'
import {
  cancelInvite,
  changeRole,
  deactivateUser,
  issueInvite,
  reactivateUser,
  revokeSessions,
} from './actions'

export const metadata: Metadata = { title: 'Staff', robots: { index: false } }

// Per request, never prerendered: the kit's helpers turn any error, Next's own
// "this page reads cookies" signal included, into "sign-in is unavailable", so
// without this the build tries to prerender the page and fails.
export const dynamic = 'force-dynamic'

/**
 * Staff accounts: invite someone (the admin copies the link and sends it by
 * text or WhatsApp), change a role, deactivate a leaver, rehire, or sign
 * someone out everywhere. Admin only: the proxy, this page and every action
 * each check it on the server.
 */
export default async function StaffPage(): Promise<React.ReactElement> {
  const { user } = await authHelpers().requireRole(['admin'])
  const [invites, staff] = await Promise.all([adminActions().listInvites(), adminActions().listStaff()])

  return (
    <>
      <div className="flex flex-col gap-1.5">
        <Kicker>Admin</Kicker>
        <h1 className="text-[44px] leading-none text-anchor-cream-text">Staff</h1>
        <p className="max-w-[70ch] text-base text-anchor-sage">
          Accounts are invite only. An invite link lasts 7 days and works once; sending a new one
          cancels the old one.
        </p>
      </div>

      {invites === null || staff === null ? (
        // Fail closed: an unreadable list is not an empty one.
        <p role="alert" className="text-[15px] text-anchor-danger-text">
          The staff list could not be loaded. Refresh to try again; if it keeps failing, check
          /admin/errors.
        </p>
      ) : (
        <div className="grid gap-7 lg:grid-cols-2">
          <InvitePanel issueAction={issueInvite} cancelAction={cancelInvite} invites={invites} />
          <StaffPanel
            staff={staff}
            currentUserId={user.id}
            changeRoleAction={changeRole}
            deactivateAction={deactivateUser}
            reactivateAction={reactivateUser}
            revokeSessionsAction={revokeSessions}
          />
        </div>
      )}
    </>
  )
}
