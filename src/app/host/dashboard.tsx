"use client";

import React, { useRef, useState } from 'react';
import { formatDateInLondon } from '@/lib/dates';
import { useRouter } from 'next/navigation';
import { Database } from '@/types/database';
import { startGame } from './actions';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Modal } from '@/components/ui/modal';
import { Input } from '@/components/ui/input';

type SessionWithGames = Database['public']['Tables']['sessions']['Row'] & {
  games: (Database['public']['Tables']['games']['Row'] & {
    game_states: Database['public']['Tables']['game_states']['Row'] | null;
  })[];
};

interface HostDashboardProps {
  sessions: SessionWithGames[];
}

/** What one tap on Start, Resume or Re-open came to. 'busy' means another start was already in flight. */
type StartOutcome =
  | { status: 'started' }
  | { status: 'needs-cash-jackpot' }
  | { status: 'busy' }
  | { status: 'failed'; message: string };

export default function HostDashboard({ sessions }: HostDashboardProps) {
  const router = useRouter();
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);
  const [cashJackpotPrompt, setCashJackpotPrompt] = useState<{ sessionId: string; gameId: string; gameName: string } | null>(null);
  const [cashJackpotAmount, setCashJackpotAmount] = useState('');
  const [isSubmittingCashJackpot, setIsSubmittingCashJackpot] = useState(false);
  const [cashJackpotError, setCashJackpotError] = useState<string | null>(null);

  // Start, Resume and Re-open (X18). The game being started shows "Starting…",
  // and every start button is disabled while one is in flight. The ref is the
  // real double-tap guard: two taps inside one render both read the same state,
  // so state alone would let a second start through.
  const startInFlightRef = useRef(false);
  const [startingGameId, setStartingGameId] = useState<string | null>(null);
  // In-app error text in place of alert(), shown under the game it belongs to.
  const [startError, setStartError] = useState<{ gameId: string; message: string } | null>(null);
  // In-app confirmation in place of confirm() before re-opening a finished game.
  const [reopenTarget, setReopenTarget] = useState<{ sessionId: string; gameId: string; gameName: string } | null>(null);

  const toggleSession = (sessionId: string) => {
    setExpandedSessionId(expandedSessionId === sessionId ? null : sessionId);
  };

  /**
   * Starts (or resumes, or re-opens) a game. Holds the in-flight guard for the
   * whole request, and on success leaves the busy state up while the page
   * navigates away, so a second tap cannot start anything in the meantime.
   */
  const startSelectedGame = async (
    sessionId: string,
    gameId: string,
    cashJackpotInput?: string
  ): Promise<StartOutcome> => {
    if (startInFlightRef.current) return { status: 'busy' };
    startInFlightRef.current = true;
    setStartingGameId(gameId);
    setStartError(null);

    let navigating = false;
    try {
      const result = await startGame(sessionId, gameId, cashJackpotInput);
      if (!result?.success) {
        return { status: 'failed', message: result?.error || 'Could not start the game. Try again.' };
      }

      if (result.data?.requiresCashJackpotAmount) {
        setCashJackpotPrompt({
          sessionId,
          gameId,
          gameName: result.data.gameName || 'Jackpot Game',
        });
        setCashJackpotAmount('');
        setCashJackpotError(null);
        return { status: 'needs-cash-jackpot' };
      }

      if (result.redirectTo) {
        navigating = true;
        router.push(result.redirectTo);
      }
      return { status: 'started' };
    } catch (err) {
      console.error(err);
      return {
        status: 'failed',
        message: 'Could not reach the server to start the game. Check the connection and try again.',
      };
    } finally {
      if (!navigating) {
        startInFlightRef.current = false;
        setStartingGameId(null);
      }
    }
  };

  const handleStartFromList = async (sessionId: string, gameId: string) => {
    const outcome = await startSelectedGame(sessionId, gameId);
    if (outcome.status === 'failed') {
      setStartError({ gameId, message: outcome.message });
    }
  };

  const handleConfirmReopen = async () => {
    if (!reopenTarget) return;
    const { sessionId, gameId } = reopenTarget;
    setReopenTarget(null);
    await handleStartFromList(sessionId, gameId);
  };

  const closeCashJackpotPrompt = () => {
    if (isSubmittingCashJackpot) return;
    setCashJackpotPrompt(null);
    setCashJackpotAmount('');
    setCashJackpotError(null);
  };

  return (
    <div className="space-y-6">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-white">Available Sessions</h2>
        <p className="text-white/80 text-sm">Tap a session to view games</p>
      </div>

      {sessions.length === 0 ? (
        <Card className="bg-[#003f27]/85 border-[#1f7c58] text-center p-8">
          <CardContent>
            <p className="text-white/85 mb-4">No sessions available.</p>
            <p className="text-sm text-white/75">Please check the Admin page to create or activate sessions.</p>
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
                  "bg-[#005131]/88 border-[#1f7c58] transition-all duration-200",
                  expandedSessionId === session.id ? "ring-2 ring-[#a57626]" : "hover:bg-[#0f6846]/90"
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
                        <span className="px-2 py-0.5 text-xs font-bold bg-[#a57626]/25 text-white rounded-full border border-[#a57626]">TEST</span>
                      )}
                    </div>
                    <p className="text-sm text-white/80">{formatDateInLondon(session.start_date)}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    {session.status === 'running' && (
                      <span className="px-2 py-1 text-xs font-bold bg-[#a57626]/25 text-white rounded-full border border-[#a57626] animate-pulse">RUNNING</span>
                    )}
                    {session.status === 'ready' && (
                      <span className="px-2 py-1 text-xs font-bold bg-[#0f6846] text-white rounded-full border border-[#1f7c58]">READY</span>
                    )}
                    <div className={cn("transform transition-transform text-white/75", expandedSessionId === session.id ? "rotate-180" : "")}>
                      ▼
                    </div>
                  </div>
                </div>
                
                {expandedSessionId === session.id && (
                  <div className="border-t border-[#1f7c58] bg-[#003f27]/82 p-4">
                    {sortedGames.length === 0 ? (
                      <p className="text-white/75 text-center py-4">No games configured for this session.</p>
                    ) : (
                      <div className="space-y-3">
                        {sortedGames.map((game) => {
                          const status = game.game_states?.status || 'not_started';
                          const isCompleted = status === 'completed';
                          const isInProgress = status === 'in_progress';
                          
                          const isPlayable = activeOrNextGame?.id === game.id || isCompleted;
                          const isStartingThis = startingGameId === game.id;
                          const gameStartError = startError?.gameId === game.id ? startError.message : null;
                          
                          // It is locked if it is NOT playable (which means it's a future game)
                          const isLocked = !isPlayable;

                          return (
                            <div 
                              key={game.id} 
                              className={cn(
                                "flex items-center justify-between p-3 rounded-lg border transition-colors",
                                isInProgress ? "bg-[#a57626]/20 border-[#a57626]/70" : 
                                isCompleted ? "bg-[#005131]/60 border-[#1f7c58]" : 
                                isLocked ? "bg-[#005131]/45 border-[#1f7c58]/60 opacity-50" :
                                "bg-[#0f6846] border-[#1f7c58]"
                              )}
                            >
                              <div className="flex items-center gap-3">
                                <div className={cn(
                                  "w-2 h-2 rounded-full",
                                  isInProgress ? "bg-[#a57626] animate-pulse" :
                                  isCompleted ? "bg-white/70" :
                                  "bg-white/60"
                                )}></div>
                                <div>
                                  <h4 className={cn("font-bold", isCompleted ? "text-white/80" : "text-white")}>
                                    Game {game.game_index}: {game.name}
                                  </h4>
                                  <div className="flex gap-2 text-xs">
                                    <span className="text-white/80 uppercase tracking-wider">{game.type}</span>
                                    {status === 'not_started' && <span className="text-white/70">Not Started</span>}
                                    {status === 'in_progress' && <span className="text-white font-bold">In Progress</span>}
                                    {status === 'completed' && <span className="text-white/70">Completed</span>}
                                  </div>
                                </div>
                              </div>
                              
                              <div className="flex flex-col items-end gap-1">
                                {isPlayable ? (
                                  <Button 
                                    size="sm" 
                                    variant={isInProgress ? "primary" : isCompleted ? "outline" : "secondary"}
                                    className={
                                      isInProgress ? "bg-[#a57626] hover:bg-[#8f6621] border-[#a57626] text-white" :
                                      isCompleted ? "border-[#a57626] text-white hover:bg-[#a57626]/20" : ""
                                    }
                                    disabled={startingGameId !== null}
                                    onClick={(e) => {
                                        e.preventDefault();
                                        if (isCompleted) {
                                            setStartError(null);
                                            setReopenTarget({ sessionId: session.id, gameId: game.id, gameName: game.name });
                                            return;
                                        }
                                        void handleStartFromList(session.id, game.id);
                                    }}
                                  >
                                    {isStartingThis ? 'Starting…' : isInProgress ? 'Resume' : isCompleted ? 'Re-open' : 'Start'}
                                  </Button>
                                ) : (
                                  <Button 
                                    size="sm" 
                                    variant="ghost" 
                                    disabled 
                                    className="text-white/60"
                                  >
                                    Locked
                                  </Button>
                                )}
                                {gameStartError && (
                                  <p role="alert" className="max-w-[16rem] text-right text-xs text-white">
                                    {gameStartError}
                                  </p>
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

      <Modal
        isOpen={!!reopenTarget}
        onClose={() => setReopenTarget(null)}
        title="Re-open this finished game?"
        className="max-w-md bg-[#003f27] border border-[#1f7c58]"
      >
        <div className="space-y-4">
          <p className="text-sm text-white/90">
            <span className="font-bold text-white">{reopenTarget?.gameName}</span> has finished.
            Re-opening it resumes calling so you can correct a mistake.
          </p>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="secondary" className="min-h-[44px]" onClick={() => setReopenTarget(null)}>
            Keep it finished
          </Button>
          <Button
            variant="primary"
            className="min-h-[44px] bg-[#a57626] hover:bg-[#8f6621] border border-[#a57626]"
            onClick={() => { void handleConfirmReopen(); }}
            disabled={startingGameId !== null}
          >
            Re-open
          </Button>
        </div>
      </Modal>

      <Modal
        isOpen={!!cashJackpotPrompt}
        onClose={closeCashJackpotPrompt}
        title="Set Cash Jackpot"
        className="max-w-md bg-[#003f27] border border-[#1f7c58]"
      >
        <div className="space-y-4">
          {cashJackpotError && (
            <div role="alert" className="p-3 bg-[#a57626]/20 border border-[#a57626] text-white rounded">
              {cashJackpotError}
            </div>
          )}
          <p className="text-sm text-white/85">
            Enter tonight&apos;s cash jackpot for <span className="font-bold text-white">{cashJackpotPrompt?.gameName}</span>. This will be shown as the game prize.
          </p>
          <div>
            <label className="text-sm text-white/90 block mb-1">Cash Jackpot Amount</label>
            <Input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              placeholder="e.g. 250"
              value={cashJackpotAmount}
              onChange={(event) => setCashJackpotAmount(event.target.value)}
              autoFocus
            />
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <Button
            variant="secondary"
            onClick={closeCashJackpotPrompt}
            disabled={isSubmittingCashJackpot}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            className="bg-[#005131] hover:bg-[#0f6846] border border-[#a57626]"
            onClick={async () => {
              if (!cashJackpotPrompt || isSubmittingCashJackpot) return;
              if (!cashJackpotAmount.trim()) {
                setCashJackpotError('Enter a cash jackpot amount first.');
                return;
              }

              setCashJackpotError(null);
              setIsSubmittingCashJackpot(true);
              try {
                const outcome = await startSelectedGame(cashJackpotPrompt.sessionId, cashJackpotPrompt.gameId, cashJackpotAmount);
                if (outcome.status === 'started') {
                  setCashJackpotPrompt(null);
                  setCashJackpotAmount('');
                } else if (outcome.status === 'failed') {
                  setCashJackpotError(outcome.message);
                }
              } finally {
                setIsSubmittingCashJackpot(false);
              }
            }}
            // Disabled on an empty field as well as refused after the tap.
            disabled={isSubmittingCashJackpot || cashJackpotAmount.trim().length === 0}
          >
            {isSubmittingCashJackpot ? 'Starting...' : 'Set Amount & Start'}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
