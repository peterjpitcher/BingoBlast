"use client";

import { Header } from "@/components/header";
import { cn } from "@/lib/utils";
import { usePathname } from 'next/navigation';

export function LayoutContent({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const pathSegments = pathname.split('/').filter(Boolean);
  const isHostGamePage = pathSegments[0] === 'host' && pathSegments.length === 3;
  const isDisplayGamePage = pathSegments[0] === 'display' && pathSegments.length === 2;
  const isPlayerGamePage = pathSegments[0] === 'player' && pathSegments.length === 2;
  const isGamePage = isHostGamePage || isDisplayGamePage || isPlayerGamePage;
  const showHeader = pathname === '/' || pathname.startsWith('/admin');
  const currentYear = new Date().getFullYear();

  return (
    <div className={cn("flex flex-col min-h-screen", !isGamePage && "anchor-theme")}>
      {showHeader && <Header />}
      <main className="flex-1 flex flex-col">
        {children}
      </main>
      {!pathname.startsWith('/display') && !pathname.startsWith('/player') && !isHostGamePage && (
        <footer className="w-full py-4 text-center text-xs text-emerald-100/75 bg-[#003c25] border-t border-[#1f7c58]">
          © {currentYear} Orange Jelly Limited. All rights reserved.
        </footer>
      )}
    </div>
  );
}
