"use client";

import Link from 'next/link';
import Image from 'next/image';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export default function Home() {
  return (
    <div className="flex-1 w-full flex flex-col items-center justify-center p-4 bg-gradient-to-b from-slate-950 to-slate-900 text-white relative overflow-hidden">
      {/* Ambient Background Effects */}
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-bingo-primary/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-bingo-secondary/10 rounded-full blur-3xl pointer-events-none" />

      <div className="z-10 flex flex-col items-center w-full max-w-md gap-8">
        {/* Hero Logo */}
        <div className="relative w-80 h-80 md:w-96 md:h-96 animate-in zoom-in duration-700">
          <Image 
            src="/BingoBlast.png" 
            alt="Bingo Blast" 
            fill
            className="object-contain drop-shadow-[0_0_25px_rgba(236,72,153,0.3)]"
            priority
          />
        </div>
        
        <Card className="w-full bg-slate-900/80 border-slate-800 backdrop-blur-sm shadow-2xl animate-in slide-in-from-bottom duration-700 delay-200">
          <CardContent className="grid gap-4 p-6">
            <div className="space-y-2 text-center mb-2">
              <h2 className="text-slate-200 font-semibold tracking-wide uppercase text-sm">Select Your Role</h2>
            </div>

            <Link href="/admin" className="w-full group">
              <Button variant="outline" className="w-full h-16 text-lg justify-between px-6 border-slate-700 bg-slate-900/50 hover:bg-slate-800 hover:border-bingo-accent hover:text-bingo-accent transition-all duration-300">
                <span className="font-bold">Admin Dashboard</span>
                <span className="text-2xl group-hover:scale-110 transition-transform">🛠️</span>
              </Button>
            </Link>
            
            <Link href="/host" className="w-full group">
              <Button variant="outline" className="w-full h-16 text-lg justify-between px-6 border-slate-700 bg-slate-900/50 hover:bg-slate-800 hover:border-bingo-primary hover:text-bingo-primary transition-all duration-300">
                <span className="font-bold">Host Controller</span>
                <span className="text-2xl group-hover:scale-110 transition-transform">🎤</span>
              </Button>
            </Link>
            
            <Link href="/display" className="w-full group">
              <Button variant="outline" className="w-full h-16 text-lg justify-between px-6 border-slate-700 bg-slate-900/50 hover:bg-slate-800 hover:border-bingo-secondary hover:text-bingo-secondary transition-all duration-300">
                <span className="font-bold">Guest Display</span>
                <span className="text-2xl group-hover:scale-110 transition-transform">📺</span>
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}