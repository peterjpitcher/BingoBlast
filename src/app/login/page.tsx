import type { Metadata } from 'next'
import { SignInScreen } from '@anchor-nights/kit/auth/screens'
import { signIn } from '@/app/auth/actions'
import { turnstileSiteKey } from '@/lib/auth/server'

export const metadata: Metadata = { title: 'Staff sign in', robots: { index: false } }

/** Staff sign in (the kit's screen): email and password only, invite only. */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[]; notice?: string | string[] }>
}) {
  const params = await searchParams
  const next = typeof params.next === 'string' ? params.next : undefined
  return <SignInScreen action={signIn} turnstileSiteKey={turnstileSiteKey()} next={next} />
}
