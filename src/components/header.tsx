"use client";

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signout } from '@/app/login/actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AnchorLogo } from '@/components/ui/logo';
import { cn } from '@/lib/utils';

interface HeaderProps {
  /** The signed-in user's email. Left out when the layout could not read it. */
  email: string | null;
  /** Shows the "Night running" badge. */
  isNightRunning: boolean;
}

const NAV_ITEMS = [
  { href: '/admin', label: 'Sessions' },
  { href: '/admin/snowball', label: 'Snowball' },
  { href: '/admin/history', label: 'Winners' },
  { href: '/host', label: 'Host console' },
];

/** Sessions covers the list and every session's own page; the rest match their own path. */
function isNavItemActive(href: string, pathname: string): boolean {
  if (href === '/admin') {
    return pathname === '/admin' || pathname.startsWith('/admin/sessions');
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * The admin header: the wordmark, the section links, and on the right the
 * "Night running" badge, the signed-in email and sign out. It is 76px tall on
 * a laptop and wraps onto a second row on a tablet rather than overflowing.
 * It sticks from tablet width up; on a phone it wraps to several rows, so it
 * scrolls away with the page instead of covering it.
 */
export function Header({ email, isNightRunning }: HeaderProps): React.ReactElement {
  const pathname = usePathname();

  return (
    <header className="relative z-40 w-full border-b border-line-gold bg-anchor-green-deep/[0.88] backdrop-blur-md md:sticky md:top-0">
      <div className="mx-auto flex min-h-[76px] w-full max-w-[1280px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2 sm:px-6 lg:px-10">
        <Link href="/" className="flex shrink-0 items-center gap-6">
          <AnchorLogo height={40} priority />
          <span className="pl-1 font-display text-[22px] leading-none text-anchor-cream-text">Bingo</span>
        </Link>

        <nav aria-label="Admin" className="flex flex-wrap items-center gap-1 lg:ml-4">
          {NAV_ITEMS.map((item) => {
            const isActive = isNavItemActive(item.href, pathname);

            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  "whitespace-nowrap rounded-full px-4 py-2 text-[15px] font-semibold leading-tight transition-colors duration-150",
                  isActive
                    ? "bg-anchor-gold-bright/[0.14] text-anchor-gold-bright"
                    : "text-anchor-cream-text hover:text-anchor-gold-bright"
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-3.5">
          {isNightRunning ? <Badge variant="success" dot>Night running</Badge> : null}
          {email ? (
            <span className="hidden max-w-[28ch] truncate text-sm text-anchor-sage xl:inline">{email}</span>
          ) : null}
          <form action={signout}>
            <Button type="submit" variant="ghost" size="sm" tone="quiet" className="px-3.5">
              Sign out
            </Button>
          </form>
        </div>
      </div>
    </header>
  );
}
