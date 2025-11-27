import React from 'react';
import { createClient } from '@/utils/supabase/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Database } from '@/types/database';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export default async function DisplayPage() {
  const supabase = await createClient();

  // Find sessions that are ready or running
  const { data: sessions } = await supabase
    .from('sessions')
    .select('id, name, status, start_date')
    .in('status', ['ready', 'running'])
    .eq('is_test_session', false) // Exclude test sessions from display
    .order('created_at', { ascending: false })
    .returns<Pick<Database['public']['Tables']['sessions']['Row'], 'id' | 'name' | 'status' | 'start_date'>[]>();

  // If exactly one active session, redirect immediately
  if (sessions && sessions.length === 1) {
    redirect(`/display/${sessions[0].id}`);
  }

  return (
    <div className="min-h-screen-safe flex flex-col items-center justify-center p-4 bg-slate-950 text-white">
      <h1 className="mb-8 text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-bingo-primary to-bingo-secondary">
        Anchor Bingo
      </h1>
      
      <Card className="w-full max-w-md bg-slate-900 border-slate-800">
        <CardHeader>
            <CardTitle className="text-center text-slate-400 text-lg uppercase tracking-widest">
                {sessions && sessions.length > 0 ? 'Select Active Game' : 'No Active Games'}
            </CardTitle>
        </CardHeader>
        <CardContent>
          {sessions && sessions.length > 0 ? (
            <div className="space-y-3">
              {sessions.map(session => (
                <Link 
                  key={session.id} 
                  href={`/display/${session.id}`}
                  className="block"
                >
                  <div className="flex items-center justify-between p-4 rounded-lg bg-slate-800 border border-slate-700 hover:border-bingo-primary hover:bg-slate-800/80 transition-all cursor-pointer group">
                    <div>
                      <h5 className="font-bold text-lg group-hover:text-bingo-primary transition-colors">{session.name}</h5>
                      <p className="text-sm text-slate-500">Started: {new Date(session.start_date).toLocaleDateString()}</p>
                    </div>
                    <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold border ${
                        session.status === 'running' 
                            ? 'bg-green-900/30 text-green-400 border-green-800 animate-pulse' 
                            : 'bg-yellow-900/30 text-yellow-400 border-yellow-800'
                    }`}>
                      {session.status.toUpperCase()}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="text-center py-8">
              <div className="w-16 h-16 bg-slate-800 rounded-full flex items-center justify-center mx-auto mb-4 text-3xl opacity-50">
                  📺
              </div>
              <p className="text-slate-400 mb-6">Waiting for the next game to start...</p>
              <Link href="/display">
                 <Button variant="outline" className="w-full">Refresh</Button>
              </Link>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
