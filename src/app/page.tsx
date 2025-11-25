"use client";

import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export default function Home() {
  return (
    <div className="min-h-screen-safe flex flex-col items-center justify-center p-4 bg-slate-950 text-white">
      <h1 className="mb-8 text-4xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-bingo-primary to-bingo-secondary">
        Anchor Bingo
      </h1>
      
      <Card className="w-full max-w-md bg-slate-900 border-slate-800">
        <CardHeader>
          <CardTitle className="text-center text-slate-400 text-lg uppercase tracking-widest">Portal</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <Link href="/admin" className="w-full">
            <Button variant="secondary" className="w-full h-14 text-lg justify-start pl-6 hover:border-bingo-accent transition-all">
              🛠️ Admin Dashboard
            </Button>
          </Link>
          <Link href="/host" className="w-full">
            <Button variant="secondary" className="w-full h-14 text-lg justify-start pl-6 hover:border-bingo-primary transition-all">
              🎤 Host Controller
            </Button>
          </Link>
          <Link href="/display" className="w-full">
            <Button variant="secondary" className="w-full h-14 text-lg justify-start pl-6 hover:border-bingo-secondary transition-all">
              📺 Guest Display
            </Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
