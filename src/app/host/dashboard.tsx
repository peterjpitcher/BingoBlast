"use client";

import React, { useState } from 'react';
import { Database } from '@/types/database';
import { startGame } from './actions';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type SessionWithGames = Database['public']['Tables']['sessions']['Row'] & {
  games: Database['public']['Tables']['games']['Row'][];
};

interface HostDashboardProps {
  sessions: SessionWithGames[];
}

export default function HostDashboard({ sessions }: HostDashboardProps) {
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);

  const toggleSession = (sessionId: string) => {
    setExpandedSessionId(expandedSessionId === sessionId ? null : sessionId);
  };

  return (
    <div className="space-y-6">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-white">Available Sessions</h2>
        <p className="text-slate-400 text-sm">Tap a session to view games</p>
      </div>

      {sessions.length === 0 ? (
        <Card className="bg-slate-900/50 border-slate-800 text-center p-8">
          <CardContent>
            <p className="text-slate-400 mb-4">No sessions available.</p>
            <p className="text-sm text-slate-500">Please check the Admin page to create or activate sessions.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {sessions.map((session) => (
            <Card 
              key={session.id} 
              className={cn(
                "bg-slate-800 border-slate-700 transition-all duration-200",
                expandedSessionId === session.id ? "ring-2 ring-bingo-primary" : "hover:bg-slate-750"
              )}
            >
              <div
                onClick={() => toggleSession(session.id)} 
                className="p-4 flex items-center justify-between cursor-pointer"
              >
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-lg font-bold text-white">{session.name}</h3>
                    {session.is_test_session && (
                      <span className="px-2 py-0.5 text-xs font-bold bg-cyan-900 text-cyan-300 rounded-full">TEST</span>
                    )}
                  </div>
                  <p className="text-sm text-slate-400">{session.start_date}</p>
                </div>
                <div className="flex items-center gap-3">
                  {session.status === 'running' && (
                    <span className="px-2 py-1 text-xs font-bold bg-green-900/50 text-green-400 rounded-full border border-green-800 animate-pulse">RUNNING</span>
                  )}
                  {session.status === 'ready' && (
                    <span className="px-2 py-1 text-xs font-bold bg-blue-900/50 text-blue-400 rounded-full border border-blue-800">READY</span>
                  )}
                  <div className={cn("transform transition-transform text-slate-500", expandedSessionId === session.id ? "rotate-180" : "")}>
                    ▼
                  </div>
                </div>
              </div>
              
              {expandedSessionId === session.id && (
                <div className="border-t border-slate-700 bg-slate-900/50 p-4">
                  {session.games.length === 0 ? (
                    <p className="text-slate-500 text-center py-4">No games configured for this session.</p>
                  ) : (
                    <div className="space-y-3">
                      {session.games.map((game) => (
                        <div key={game.id} className="flex items-center justify-between p-3 rounded-lg bg-slate-800 border border-slate-700">
                          <div>
                            <h4 className="font-bold text-white">Game {game.game_index}: {game.name}</h4>
                            <p className="text-xs text-slate-400 uppercase tracking-wider">{game.type}</p>
                          </div>
                          <div>
                            <form action={async () => { await startGame(session.id, game.id); }}>
                              <Button 
                                type="submit" 
                                size="sm" 
                                variant={session.status === 'running' ? "primary" : "secondary"}
                                className={session.status === 'running' ? "bg-green-600 hover:bg-green-700 shadow-green-900/20" : ""}
                              >
                                {session.status === 'running' ? 'Resume' : 'Start'}
                              </Button>
                            </form>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}