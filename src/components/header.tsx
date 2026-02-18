"use client";

import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

const NAV_ITEMS = [
  { href: '/', label: 'Home' },
  { href: '/admin', label: 'Sessions' },
  { href: '/admin/snowball', label: 'Snowballs' },
  { href: '/admin/history', label: 'Winners' },
];

export function Header() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-50 w-full border-b border-[#1f7c58] bg-[#005131] shadow-md">
      <div className="container mx-auto flex min-h-16 flex-wrap items-center justify-between gap-3 px-4 py-2">
        <Link href="/" className="flex items-center gap-3 hover:opacity-90 transition-opacity">
          <div className="relative h-10 w-40 shrink-0">
            <Image 
              src="/the-anchor-pub-logo-white-transparent.png" 
              alt="The Anchor Logo" 
              fill
              className="object-contain"
              priority
            />
          </div>
          <span className="text-xl font-bold text-white">
            The Anchor Bingo
          </span>
        </Link>

        <nav className="flex flex-wrap items-center gap-2">
          {NAV_ITEMS.map((item) => {
            const isActive = item.href === '/'
              ? pathname === item.href
              : pathname === item.href || pathname.startsWith(`${item.href}/`);

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "rounded-md border px-3 py-1.5 text-sm font-semibold transition-colors",
                  isActive
                    ? "border-[#a57626] bg-[#a57626] text-white"
                    : "border-[#1f7c58] text-white hover:bg-[#0f6846]"
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  )
}
