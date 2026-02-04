"use client";

import { Header } from "@/components/header";
import { usePathname } from 'next/navigation';

export function LayoutContent({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const showHeader = pathname !== '/' && !pathname.startsWith('/display') && !pathname.startsWith('/player');

  return (
    <div className="flex flex-col min-h-screen">
      {showHeader && <Header />}
      <main className="flex-1 flex flex-col">
        {children}
      </main>
      {!pathname.startsWith('/display') && !pathname.startsWith('/player') && (
        <footer className="w-full py-4 text-center text-xs text-slate-500 bg-slate-950 border-t border-slate-800">
          © 2025 Orange Jelly Limited. All rights reserved.
        </footer>
      )}
    </div>
  );
}
