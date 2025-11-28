"use client";

import React, { useState } from 'react';
import { Database } from '@/types/database';
import { startGame } from './actions';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type SessionWithGames = Database['public']['Tables']['sessions']['Row'] & {
  games: (Database['public']['Tables']['games']['Row'] & {
    game_states: Database['public']['Tables']['game_states']['Row'] | null;
  })[];
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
          {sessions.map((session) => {
            // Sort games by index
            const sortedGames = [...session.games].sort((a, b) => a.game_index - b.game_index);
            
            // Find the first game that is NOT completed. This is our active or next game.
            // If all are completed, this will be undefined.
            const activeOrNextGame = sortedGames.find(g => g.game_states?.status !== 'completed');

            return (
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
                    {sortedGames.length === 0 ? (
                      <p className="text-slate-500 text-center py-4">No games configured for this session.</p>
                    ) : (
                      <div className="space-y-3">
                        {sortedGames.map((game) => {
                          const status = game.game_states?.status || 'not_started';
                          const isCompleted = status === 'completed';
                          const isInProgress = status === 'in_progress';
                          
                          const isPlayable = activeOrNextGame?.id === game.id || isCompleted;
                          
                          // It is locked if it is NOT playable (which means it's a future game)
                          const isLocked = !isPlayable;

                          return (
                            <div 
                              key={game.id} 
                              className={cn(
                                "flex items-center justify-between p-3 rounded-lg border transition-colors",
                                isInProgress ? "bg-green-900/20 border-green-800/50" : 
                                isCompleted ? "bg-slate-800/50 border-slate-700" : 
                                isLocked ? "bg-slate-800/30 border-slate-700/50 opacity-50" :
                                "bg-slate-800 border-slate-700"
                              )}
                            >
                              <div className="flex items-center gap-3">
                                <div className={cn(
                                  "w-2 h-2 rounded-full",
                                  isInProgress ? "bg-green-500 animate-pulse" :
                                  isCompleted ? "bg-slate-500" :
                                  "bg-slate-700"
                                )}></div>
                                <div>
                                  <h4 className={cn("font-bold", isCompleted ? "text-slate-400" : "text-white")}>
                                    Game {game.game_index}: {game.name}
                                  </h4>
                                  <div className="flex gap-2 text-xs">
                                    <span className="text-slate-400 uppercase tracking-wider">{game.type}</span>
                                    {status === 'not_started' && <span className="text-slate-500">Not Started</span>}
                                    {status === 'in_progress' && <span className="text-green-400 font-bold">In Progress</span>}
                                    {status === 'completed' && <span className="text-slate-500">Completed</span>}
                                  </div>
                                </div>
                              </div>
                              
                              <div>
                                {isPlayable ? (
                                  <Button 
                                    size="sm" 
                                    variant={isInProgress ? "primary" : isCompleted ? "outline" : "secondary"}
                                    className={
                                      isInProgress ? "bg-green-600 hover:bg-green-700 shadow-green-900/20" : 
                                      isCompleted ? "border-yellow-600 text-yellow-500 hover:bg-yellow-900/20" : ""
                                    }
                                    onClick={async (e) => {
                                        e.preventDefault();
                                        if (isCompleted && !confirm("⚠️ Are you sure you want to RE-OPEN this finished game?\n\nThis will resume calling and allow you to correct mistakes.")) {
                                            return;
                                        }
                                        
                                        try {
                                            const result = await startGame(session.id, game.id);
                                            if (result?.error) {
                                                alert("Error starting game: " + result.error);
                                            }
                                        } catch (err) {
                                            console.error(err);
                                            alert("An unexpected error occurred: " + (err instanceof Error ? err.message : String(err)));
                                        }
                                    }}
                                  >
                                    {isInProgress ? 'Resume' : isCompleted ? 'Re-open' : 'Start'}
                                  </Button>
                                ) : (
                                  <Button 
                                    size="sm" 
                                    variant="ghost" 
                                    disabled 
                                    className="text-slate-500"
                                  >
                                    Locked
                                  </Button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
