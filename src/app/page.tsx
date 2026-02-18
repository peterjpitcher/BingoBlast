"use client";

import Link from 'next/link';
import Image from 'next/image';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export default function Home() {
  return (
    <div className="flex-1 w-full flex flex-col items-center justify-center p-4 bg-gradient-to-b from-[#005131] to-[#003f27] text-white relative overflow-hidden">
      {/* Ambient Background Effects */}
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-white/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-[#a57626]/20 rounded-full blur-3xl pointer-events-none" />

      <div className="z-10 flex flex-col items-center w-full max-w-md gap-8">
        {/* Hero Logo */}
        <div className="relative w-80 h-80 md:w-96 md:h-96 animate-in zoom-in duration-700 rounded-full bg-[#005131] border border-[#1f7c58] p-8 shadow-2xl shadow-black/30">
          <Image 
            src="/the-anchor-pub-logo-white-transparent.png" 
            alt="The Anchor" 
            fill
            className="object-contain p-6"
            priority
          />
        </div>
        
        <Card className="w-full bg-[#005131]/90 border-[#1f7c58] backdrop-blur-sm shadow-2xl animate-in slide-in-from-bottom duration-700 delay-200">
          <CardContent className="grid gap-4 p-6">
            <div className="space-y-2 text-center mb-2">
              <h2 className="text-emerald-50 font-semibold tracking-wide uppercase text-sm">Select Your Role</h2>
            </div>

            <Link href="/admin" className="w-full group">
              <Button variant="outline" className="w-full h-16 text-lg justify-between px-6 border-[#2f8f6a] bg-[#0f6846]/70 hover:bg-[#0f6846] hover:border-[#a57626] hover:text-[#a57626] transition-all duration-300">
                <span className="font-bold">Admin Dashboard</span>
                <span className="text-2xl group-hover:scale-110 transition-transform">🛠️</span>
              </Button>
            </Link>
            
            <Link href="/host" className="w-full group">
              <Button variant="outline" className="w-full h-16 text-lg justify-between px-6 border-[#2f8f6a] bg-[#0f6846]/70 hover:bg-[#0f6846] hover:border-[#a57626] hover:text-[#a57626] transition-all duration-300">
                <span className="font-bold">Host Controller</span>
                <span className="text-2xl group-hover:scale-110 transition-transform">🎤</span>
              </Button>
            </Link>
            
            <Link href="/display" className="w-full group">
              <Button variant="outline" className="w-full h-16 text-lg justify-between px-6 border-[#2f8f6a] bg-[#0f6846]/70 hover:bg-[#0f6846] hover:border-[#a57626] hover:text-[#a57626] transition-all duration-300">
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
