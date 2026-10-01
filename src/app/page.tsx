import Link from 'next/link';
import { ChevronRight, Mic, Settings, Tv } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { BrandBackdrop } from '@/components/brand-backdrop';
import { CopyrightLine } from '@/components/copyright-line';
import { cardClass } from '@/components/ui/card';
import { AnchorLogo } from '@/components/ui/logo';

interface RoleLink {
  href: string;
  label: string;
  hint: string;
  icon: LucideIcon;
}

const ROLES: RoleLink[] = [
  { href: '/host', label: 'Host console', hint: "Run tonight's games", icon: Mic },
  { href: '/display', label: 'Pub TV', hint: 'Open the big screen on this device', icon: Tv },
  { href: '/admin', label: 'Admin', hint: 'Sessions, pots and winners', icon: Settings },
];

export default function Home() {
  return (
    <div className="relative flex flex-1 flex-col overflow-hidden bg-anchor-green-deep">
      <BrandBackdrop />

      <div className="relative mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-5 pb-7 pt-[calc(env(safe-area-inset-top)+3rem)]">
        <div className="flex flex-col items-center gap-3.5 text-center">
          <AnchorLogo height={92} priority />
          <span className="font-script text-[34px] text-anchor-gold-bright">Where everyone&apos;s welcome</span>
          <h1 className="text-[40px] leading-none text-anchor-cream-text">Bingo night</h1>
          <p className="max-w-[30ch] text-[15px] text-anchor-cream-text/85">
            Staff tools for running the night. Pick where you are heading.
          </p>
        </div>

        <nav aria-label="Where to go" className="mt-auto flex flex-col gap-2.5">
          {ROLES.map(({ href, label, hint, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={cardClass({ hover: true, className: 'flex items-center gap-3.5 p-4' })}
            >
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-card border border-line-gold bg-anchor-gold-bright/[0.12] text-anchor-gold-bright">
                <Icon aria-hidden="true" size={24} strokeWidth={2} />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="font-display text-[22px] leading-[1.1]">{label}</span>
                <span className="text-[13px] text-anchor-sage">{hint}</span>
              </span>
              <ChevronRight aria-hidden="true" size={20} strokeWidth={2} className="shrink-0 text-anchor-gold-bright" />
            </Link>
          ))}
          <CopyrightLine className="mt-2.5 text-center text-xs text-anchor-sage" />
        </nav>
      </div>
    </div>
  );
}
