"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { Database } from '@/types/database';
import { createClient } from '@/utils/supabase/client';
import { callNextNumber, toggleBreak, endGame, validateClaim, recordWinner, skipStage, voidLastNumber, pauseForValidation, resumeGame, announceWin, advanceToNextStage, toggleWinnerPrizeGiven } from '@/app/host/actions';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Modal } from '@/components/ui/modal';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { BingoBall } from '@/components/ui/bingo-ball';

type Game = Database['public']['Tables']['games']['Row'];
type GameState = Database['public']['Tables']['game_states']['Row'];
type SnowballPot = Database['public']['Tables']['snowball_pots']['Row'];
type Winner = Database['public']['Tables']['winners']['Row'];

interface GameControlProps {
  sessionId: string;
  gameId: string;
  game: Game;
  initialGameState: GameState;
}

// Hardcoded for now (same as before)
const NUMBER_NICKNAMES: { [key: number]: string } = {
  1: "Kelly's Eye", 2: "One Little Duck", 3: "Goodness Me", 4: "Knock at the Door",
  5: "Man Alive", 6: "Half Dozen", 7: "Lucky For Some", 8: "Garden Gate",
  9: "Doctor's Orders", 10: "Gandhi's Golden Years", 11: "Legs Eleven", 12: "One Dozen",
  13: "Unlucky For Some", 14: "Valentines Day", 15: "Young And Keen", 16: "Sweet Sixteen",
  17: "Dancing Queen", 18: "Voting Age", 19: "Goodbye Teens", 20: "Blind Twenty",
  21: "Key Of The Door", 22: "Two Little Ducks", 23: "Thee And Me", 24: "A Dozen Twos",
  25: "Duck And Dive", 26: "Pick And Mix", 27: "Gateway To Heaven", 28: "In A State",
  29: "Rise And Shine", 30: "Dirty Gertie", 31: "Get Up And Run", 32: "Buckle My Shoe",
  33: "All The Threes", 34: "Ask For More", 35: "Jumping Jack", 36: "Three Dozen",
  37: "A Flea In Heaven", 38: "Christmas Cake", 39: "All The Steps", 40: "Naughty Forty",
  41: "Life's Little Joke", 42: "Winnie The Pooh", 43: "Down On Your Knees", 44: "All The Fours",
  45: "Halfway There", 46: "Up To Tricks", 47: "Four And Seven", 48: "Four Dozen",
  49: "PC", 50: "Half A Century", 51: "Tweak Of The Thumb", 52: "Danny La Rue",
  53: "Stuck In The Tree", 54: "Clean The Floor", 55: "All The Fives", 56: "Shotts Bus",
  57: "Heinz Varieties", 58: "Make Them Wait", 59: "Brighton Line", 60: "Five Dozen",
  61: "Bakers Bun", 62: "Tickety Boo", 63: "Tickle Me", 64: "Red Hot Pokers",
  65: "Old Age Pension", 66: "Clickety Click", 67: "Made In Heaven", 68: "Saving Grace",
  69: "Any Way Up", 70: "Three Score And Ten", 71: "Bang On The Drum", 72: "A Crutch And A Tube",
  73: "Queen B", 74: "Candy Store", 75: "Strive And Strive", 76: "Trombones",
  77: "All The Sevens", 78: "Heaven's Gate", 79: "One More Time", 80: "Gandhi's Breakfast",
  81: "Stop And Run", 82: "Fat Lady Sings", 83: "Time For Tea", 84: "Last Four",
  85: "Staying Alive", 86: "Between The Sticks", 87: "Fat Lady And A Crutch", 88: "Two Fat Ladies",
  89: "All But One", 90: "Top Of The Shop"
};


export default function GameControl({ sessionId, gameId, game, initialGameState }: GameControlProps) {
  const [currentGameState, setCurrentGameState] = useState<GameState>(initialGameState);
  const [currentSnowballPot, setCurrentSnowballPot] = useState<SnowballPot | null>(null);
  const [isCallingNumber, setIsCallingNumber] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(true);
  const [showEndGameConfirm, setShowEndGameConfirm] = useState(false);
  const [showValidationModal, setShowValidationModal] = useState(false);
  const [selectedNumbers, setSelectedNumbers] = useState<number[]>([]);
  const [validationResult, setValidationResult] = useState<{ valid: boolean; invalidNumbers?: number[] } | null>(null);
  const [showWinnerModal, setShowWinnerModal] = useState(false);
  const [showManualSnowballModal, setShowManualSnowballModal] = useState(false);
  const [showPostWinModal, setShowPostWinModal] = useState(false);
  const [winnerName, setWinnerName] = useState('');
  const [prizeGiven, setPrizeGiven] = useState(false);
  const [currentWinners, setCurrentWinners] = useState<Winner[]>([]);
  const [isSnowballEligible, setIsSnowballEligible] = useState(false);
  
  const getPlannedPrize = useCallback((stageIndex: number) => {
    const stage = game.stage_sequence[stageIndex];
    return game.prizes?.[stage as keyof typeof game.prizes] || '';
  }, [game]);

  const [prizeDescription, setPrizeDescription] = useState(getPlannedPrize(initialGameState.current_stage_index));

  // Winners Subscription
  useEffect(() => {
    const supabase = createClient();
    const fetchWinners = async () => {
        const { data } = await supabase.from('winners').select('*').eq('game_id', gameId).order('created_at', { ascending: false });
        if (data) setCurrentWinners(data);
    };

    fetchWinners();

    const channel = supabase
      .channel(`winners:${gameId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'winners', filter: `game_id=eq.${gameId}` },
        () => {
            fetchWinners();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [gameId]);

  // Wake Lock
  useEffect(() => {
    let wakeLock: any = null;

    const requestWakeLock = async () => {
      try {
        if ('wakeLock' in navigator) {
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-ignore
          wakeLock = await navigator.wakeLock.request('screen');
          console.log('Wake Lock is active!');
        }
      } catch (err: any) {
        console.error(`Wake Lock error: ${err.name}, ${err.message}`);
      }
    };

    requestWakeLock();
    
    const handleVisibilityChange = async () => {
        if (wakeLock !== null && document.visibilityState === 'visible') {
             await requestWakeLock();
        }
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      if (wakeLock) wakeLock.release();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  const handleTogglePrize = async (winnerId: string, currentStatus: boolean) => {
      // Optimistic update
      setCurrentWinners(prev => prev.map(w => w.id === winnerId ? { ...w, prize_given: !currentStatus } : w));
      
      const result = await toggleWinnerPrizeGiven(sessionId, gameId, winnerId, !currentStatus);
      if (result?.error) {
          setActionError(result.error);
          // Revert
          setCurrentWinners(prev => prev.map(w => w.id === winnerId ? { ...w, prize_given: currentStatus } : w));
      }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPrizeDescription(getPlannedPrize(currentGameState.current_stage_index));
  }, [currentGameState.current_stage_index, getPlannedPrize]);

  const currentNumber = currentGameState.called_numbers?.[currentGameState.numbers_called_count - 1] || null;
  const currentNickname = currentNumber ? NUMBER_NICKNAMES[currentNumber] : null;
  const lastNNumbers = (currentGameState.called_numbers || []).slice(-10, -1);

  useEffect(() => {
    const supabase = createClient();
    let potChannel: ReturnType<typeof supabase.channel> | null = null;

    const fetchAndSubscribePot = async () => {
        if (game.type === 'snowball' && game.snowball_pot_id) {
            const { data } = await supabase
            .from('snowball_pots')
            .select('*')
            .eq('id', game.snowball_pot_id)
            .single();
            if (data) setCurrentSnowballPot(data);

            potChannel = supabase
            .channel(`pot_updates_host:${game.snowball_pot_id}`)
            .on<SnowballPot>(
                'postgres_changes',
                { event: 'UPDATE', schema: 'public', table: 'snowball_pots', filter: `id=eq.${game.snowball_pot_id}` },
                (payload) => {
                    setCurrentSnowballPot(payload.new);
                }
            )
            .subscribe();
        } else {
            setCurrentSnowballPot(null);
        }
    };

    fetchAndSubscribePot();

    return () => {
        if (potChannel) supabase.removeChannel(potChannel);
    };
  }, [game.type, game.snowball_pot_id]);

  useEffect(() => {
    const supabase = createClient();
    
    const channel = supabase
      .channel(`game_state:${gameId}`)
      .on<GameState>(
        'postgres_changes',
        { 
          event: 'UPDATE', 
          schema: 'public', 
          table: 'game_states', 
          filter: `game_id=eq.${gameId}` 
        },
        (payload) => {
            setCurrentGameState(payload.new);
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setIsConnected(true);
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          setIsConnected(false);
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [gameId]);

  const handleCallNextNumber = async () => {
    setIsCallingNumber(true);
    setActionError(null);

    const previousState = { ...currentGameState };
    
    if (currentGameState.number_sequence && currentGameState.numbers_called_count < currentGameState.number_sequence.length) {
        const nextNum = currentGameState.number_sequence[currentGameState.numbers_called_count];
        
        const optimisticState: GameState = {
            ...currentGameState,
            numbers_called_count: currentGameState.numbers_called_count + 1,
            called_numbers: [...(currentGameState.called_numbers as number[]), nextNum],
            last_call_at: new Date().toISOString()
        };
        setCurrentGameState(optimisticState);
    }

    const result = await callNextNumber(gameId);
    if (result?.error) {
      setActionError(result.error);
      setCurrentGameState(previousState);
    }
    setIsCallingNumber(false);
  };

  const handleToggleBreak = async () => {
    setActionError(null);
    const newOnBreakStatus = !currentGameState.on_break;
    const result = await toggleBreak(gameId, newOnBreakStatus);
    if (result?.error) {
      setActionError(result.error);
    }
  };

  const handleEndGame = async () => {
      setShowEndGameConfirm(false);
      setActionError(null);
      const result = await endGame(gameId, sessionId);
      if (result?.error) {
          setActionError(result.error);
      }
  };

  const handleToggleNumber = (num: number) => {
    setSelectedNumbers(prev => 
      prev.includes(num) ? prev.filter(n => n !== num) : [...prev, num].sort((a,b) => a-b)
    );
  };

  const handleClearSelection = () => {
    setSelectedNumbers([]);
    setValidationResult(null);
  };

  const handleCheckWin = async () => {
    setActionError(null);
    if (selectedNumbers.length === 0) {
        setActionError("Please select numbers to validate.");
        return;
    }

    const pauseResult = await pauseForValidation(gameId);
    if (pauseResult?.error) {
        setActionError("Failed to pause for validation: " + pauseResult.error);
        return; 
    }

    const result = await validateClaim(gameId, selectedNumbers);
    if (result?.error) {
        setActionError(result.error);
        setValidationResult(null);
    } else {
        setValidationResult(result as { valid: boolean; invalidNumbers?: number[] });
        if (result?.valid) {
            const currentStage = game.stage_sequence[currentGameState.current_stage_index];
            const isSnowballGame = game.type === 'snowball' && currentStage === 'Full House';
            const isJackpot = isSnowballGame && currentSnowballPot && currentGameState.numbers_called_count <= currentSnowballPot.current_max_calls;
            
            await announceWin(gameId, isJackpot ? 'snowball' : currentStage);
            setShowWinnerModal(true);
        }
    }
  };

  const handleRecordWinner = async () => {
    setActionError(null);
    if (!winnerName.trim()) {
        setActionError("Winner name cannot be empty.");
        return;
    }
    const currentStage = game.stage_sequence[currentGameState.current_stage_index];
    
    // Use the manual eligibility flag determined in the modal
    const isJackpot = isSnowballEligible;

    const result = await recordWinner(
        sessionId,
        gameId,
        currentStage,
        winnerName,
        prizeDescription,
        currentGameState.numbers_called_count,
        isJackpot,
        prizeGiven
    );

    if (result?.error) {
        setActionError(result.error);
    } else {
        setWinnerName('');
        setPrizeGiven(false);
        setIsSnowballEligible(false);
        setShowWinnerModal(false);
        setShowPostWinModal(true);
    }
  };
  
  const handleAdvanceStage = async () => {
      setActionError(null);
      const result = await advanceToNextStage(gameId);
      if (result?.error) {
          setActionError(result.error);
      } else {
          setShowPostWinModal(false);
          setShowValidationModal(false);
          handleClearSelection();
      }
  };

  const handleResumeAfterWin = async () => {
      setActionError(null);
      const result = await resumeGame(gameId);
      if (result?.error) {
          setActionError(result.error);
      } else {
          setShowPostWinModal(false);
          setShowValidationModal(false);
          handleClearSelection();
      }
  };

  const handleSkipStage = async () => {
    if (confirm("Are you sure you want to skip this stage without a winner?")) {
        setActionError(null);
        const result = await skipStage(gameId, currentGameState.current_stage_index, game.stage_sequence.length);
        if (result?.error) {
            setActionError(result.error);
        } else {
            setShowValidationModal(false);
        }
    }
  };

  const handleVoidLastNumber = async () => {
      if (!currentNumber) {
          setActionError("No numbers to void.");
          return;
      }
      if (confirm(`Are you sure you want to void the last called number (${currentNumber})?`)) {
          setActionError(null);
          const result = await voidLastNumber(gameId);
          if (result?.error) {
              setActionError(result.error);
          }
      }
  };

  const handleResumeGame = async () => {
      setActionError(null);
      if (currentGameState.paused_for_validation) {
          const result = await resumeGame(gameId);
          if (result?.error) {
              setActionError("Failed to resume game: " + result.error);
              return;
          }
      }
      setShowValidationModal(false);
      handleClearSelection();
  };

  const isGameCompleted = currentGameState.status === 'completed';
  const isGameNotInProgress = currentGameState.status !== 'in_progress';
  const isPausedForValidation = currentGameState.paused_for_validation;

  const isNextNumberDisabled = isCallingNumber || currentGameState.on_break || isGameNotInProgress || isGameCompleted || isPausedForValidation || currentGameState.numbers_called_count >= 90;
  const isBreakToggleDisabled = isGameNotInProgress || isGameCompleted || isPausedForValidation;
  const isValidateButtonDisabled = isGameNotInProgress || currentGameState.on_break || isGameCompleted || currentGameState.numbers_called_count === 0;
  const isEndGameDisabled = isGameNotInProgress || currentGameState.on_break || isGameCompleted || isPausedForValidation;
  const isVoidLastNumberDisabled = currentGameState.numbers_called_count === 0 || isGameCompleted || isPausedForValidation;


  return (
    <div className="p-4 pb-32 max-w-4xl mx-auto">
      {/* Connection Status */}
      <div className="flex justify-center mb-4">
          {isConnected ? (
             <div className="bg-green-500/20 text-green-400 text-xs font-bold px-3 py-1 rounded-full border border-green-500/50 flex items-center gap-2">
                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                LIVE
             </div>
          ) : (
             <div className="bg-red-500/20 text-red-400 text-xs font-bold px-3 py-1 rounded-full border border-red-500/50">
                OFFLINE
             </div>
          )}
      </div>

      {/* Alerts */}
      {actionError && <div className="mb-4 p-4 bg-red-900/50 border border-red-500 text-red-200 rounded-lg text-center">{actionError}</div>}
      {isGameCompleted && <div className="mb-4 p-4 bg-slate-800 border border-slate-600 text-slate-300 rounded-lg text-center">Game Completed</div>}
      {currentGameState.on_break && <div className="mb-4 p-4 bg-bingo-secondary/20 border border-bingo-secondary text-bingo-secondary rounded-lg text-center text-lg font-bold animate-pulse">ON BREAK</div>}
      {currentGameState.paused_for_validation && <div className="mb-4 p-4 bg-yellow-500/20 border border-yellow-500 text-yellow-300 rounded-lg text-center text-lg font-bold">CHECKING CLAIM...</div>}

      {/* Main Display Card */}
      <Card className="bg-slate-900 border-slate-800 mb-6 overflow-hidden">
        <CardContent className="p-8 flex flex-col items-center text-center">
          <div className="mb-6 relative">
             {currentNumber ? (
               <BingoBall number={currentNumber} variant="active" className="w-40 h-40 text-7xl shadow-[0_0_50px_rgba(236,72,153,0.3)]" />
             ) : (
               <div className="w-40 h-40 rounded-full bg-slate-800 border-4 border-slate-700 flex items-center justify-center text-slate-600 text-sm font-bold">
                  READY
               </div>
             )}
          </div>
          
          {currentNumber && (
            <h2 className="text-3xl font-bold text-white mb-4 animate-in fade-in slide-in-from-bottom-4">{currentNickname}</h2>
          )}
          
          <div className="flex items-center gap-6 text-sm text-slate-400 border-t border-slate-800 pt-4 w-full justify-center">
             <div>
                <span className="block text-slate-500 uppercase text-xs tracking-wider mb-1">Calls</span>
                <span className="text-xl font-mono text-white">{currentGameState.numbers_called_count}</span>
             </div>
             <div className="h-8 w-px bg-slate-800"></div>
             <div>
                <span className="block text-slate-500 uppercase text-xs tracking-wider mb-1">Playing For</span>
                <span className="text-xl font-bold text-bingo-primary">{game.stage_sequence[currentGameState.current_stage_index] || 'Finished'}</span>
             </div>
          </div>
        </CardContent>
      </Card>

      {/* Control Pad */}
      <div className="grid grid-cols-2 gap-4 mb-6">
         <Button 
           variant="primary" 
           size="xl" 
           className={cn("col-span-2 h-24 text-3xl shadow-xl shadow-bingo-primary/20", isCallingNumber && "opacity-80")}
           onClick={handleCallNextNumber} 
           disabled={isNextNumberDisabled}
         >
           {isCallingNumber ? "CALLING..." : currentGameState.numbers_called_count >= 90 ? "ALL NUMBERS CALLED" : "NEXT NUMBER"}
         </Button>

         <Button 
           variant={currentGameState.on_break ? 'secondary' : 'secondary'} 
           size="lg" 
           className={cn("h-16", currentGameState.on_break ? "bg-yellow-600 hover:bg-yellow-700 text-white border-yellow-500" : "")}
           onClick={handleToggleBreak} 
           disabled={isBreakToggleDisabled}
         >
           {currentGameState.on_break ? 'Resume Session' : 'Take Break'}
         </Button>

         <Button 
           variant="secondary" 
           size="lg" 
           className="h-16 bg-indigo-900/50 border-indigo-800 text-indigo-300 hover:bg-indigo-900 hover:text-indigo-200"
           onClick={() => setShowValidationModal(true)} 
           disabled={isValidateButtonDisabled}
         >
           Check Claim
         </Button>
      </div>

      {/* Secondary Controls */}
      <div className="flex justify-center gap-4 mb-8">
         <Button 
             variant="ghost" 
             size="sm" 
             className="text-slate-500 hover:text-yellow-500"
             onClick={handleVoidLastNumber} 
             disabled={isVoidLastNumberDisabled}
         >
           Undo Last Call
         </Button>
         <Button 
             variant="ghost" 
             size="sm" 
             className="text-slate-500 hover:text-red-500"
             onClick={() => setShowEndGameConfirm(true)} 
             disabled={isEndGameDisabled}
         >
           End Game
         </Button>
      </div>

      {/* Manual Snowball Win Button (Only for Snowball Games) */}
      {game.type === 'snowball' && currentSnowballPot && (
          <div className="flex justify-center mb-8">
              <Button 
                  variant="secondary" 
                  size="sm" 
                  className="bg-indigo-900/30 border-indigo-800/50 text-indigo-400 hover:bg-indigo-900/50 hover:text-indigo-300"
                  onClick={() => {
                      setWinnerName('');
                      setPrizeDescription(`£${currentSnowballPot.current_jackpot_amount} (Manual Snowball Win)`);
                      setShowManualSnowballModal(true);
                  }}
              >
                  🏆 Manual Snowball Win
              </Button>
          </div>
      )}

      {/* Last Numbers Strip */}
      <div className="overflow-x-auto pb-4 mb-6">
        <div className="flex gap-2 justify-center min-w-max px-4">
          {lastNNumbers.map((num, i) => (
             <BingoBall key={i} number={num} variant="called" className="w-12 h-12 text-lg" />
          ))}
          {lastNNumbers.length === 0 && <p className="text-slate-600 text-sm italic">No history yet</p>}
        </div>
      </div>

      {/* Winners List */}
      {currentWinners.length > 0 && (
          <Card className="bg-slate-900 border-slate-800 mb-8 mx-4 md:mx-0">
              <div className="p-4 border-b border-slate-800">
                  <h3 className="font-bold text-white">Winners</h3>
              </div>
              <div className="divide-y divide-slate-800">
                  {currentWinners.map(winner => (
                      <div key={winner.id} className="p-4 flex items-center justify-between gap-4">
                          <div>
                              <p className="font-bold text-white">{winner.winner_name}</p>
                              <p className="text-sm text-slate-400">{winner.stage} - {winner.prize_description}</p>
                          </div>
                          <Button 
                              size="sm" 
                              variant={winner.prize_given ? "outline" : "secondary"} 
                              className={cn(
                                  "min-w-[100px] shrink-0",
                                  winner.prize_given ? "text-green-400 border-green-900 hover:bg-green-900/20" : "bg-yellow-600 hover:bg-yellow-700 text-white"
                              )}
                              onClick={() => handleTogglePrize(winner.id, winner.prize_given || false)}
                          >
                              {winner.prize_given ? "Given ✅" : "Give Prize"}
                          </Button>
                      </div>
                  ))}
              </div>
          </Card>
      )}

      {/* End Game Modal */}
      <Modal isOpen={showEndGameConfirm} onClose={() => setShowEndGameConfirm(false)} title="End Game?">
         <div className="space-y-4">
            <p className="text-slate-300">Are you sure you want to end this game?</p>
            <div className="p-3 bg-red-900/20 border border-red-900/50 rounded text-red-200 text-sm">
               Warning: You will not be able to call more numbers or validate claims for this game once ended.
            </div>
         </div>
         <div className="mt-6 flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setShowEndGameConfirm(false)}>Cancel</Button>
            <Button variant="danger" onClick={handleEndGame}>Confirm End Game</Button>
         </div>
      </Modal>

      {/* Validation Modal */}
      <Modal 
        isOpen={showValidationModal} 
        onClose={() => {
            if (!currentGameState.paused_for_validation) setShowValidationModal(false);
        }} 
        title="Validate Ticket"
        className="max-w-4xl h-[80vh]"
      >
         <div className="flex flex-col h-full">
            <div className="shrink-0 mb-4">
                {actionError && <div className="p-3 bg-red-900/50 text-red-200 rounded mb-3">{actionError}</div>}
                
                {validationResult ? (
                    validationResult.valid ? (
                         <div className="p-4 bg-green-900/30 border border-green-800 rounded-lg flex items-center justify-between mb-4">
                            <span className="text-green-400 font-bold text-lg">✅ Valid Claim!</span>
                            <div className="flex gap-2">
                                <Button onClick={() => setShowWinnerModal(true)}>Record Winner</Button>
                                <Button variant="ghost" onClick={handleSkipStage} className="text-slate-400 hover:text-white">Skip (No Winner)</Button>
                            </div>
                         </div>
                    ) : (
                        <div className="p-4 bg-red-900/30 border border-red-800 rounded-lg mb-4">
                            <span className="text-red-400 font-bold text-lg block mb-1">❌ Invalid Claim</span>
                            <span className="text-slate-400 text-sm">Numbers not called: {validationResult.invalidNumbers?.join(', ')}</span>
                            <div className="mt-2">
                                <Button variant="outline" size="sm" onClick={handleResumeGame} className="text-red-300 border-red-800 hover:bg-red-900/50">Reject & Resume</Button>
                            </div>
                        </div>
                    )
                ) : (
                    <p className="text-slate-400 text-sm text-center">Tap the claimed numbers on the grid below.</p>
                )}
            </div>

            <div className="flex-1 overflow-y-auto bg-slate-950/50 rounded-lg p-2 border border-slate-800">
                <div className="grid grid-cols-10 gap-1 sm:gap-2">
                    {Array.from({ length: 90 }, (_, i) => i + 1).map(num => {
                        const isSelected = selectedNumbers.includes(num);
                        const isCalled = (currentGameState.called_numbers as number[]).includes(num);
                        
                        let buttonStyle = "bg-slate-800 text-slate-500 hover:bg-slate-700";
                        
                        if (isSelected) {
                            if (isCalled) {
                                buttonStyle = "bg-green-600 text-white shadow-lg shadow-green-900/50 scale-105 z-10 border border-green-500";
                            } else {
                                buttonStyle = "bg-red-600 text-white shadow-lg shadow-red-900/50 scale-105 z-10 border border-red-500";
                            }
                        } else if (isCalled) {
                            buttonStyle = "bg-slate-800 text-green-500 font-bold border border-green-500/30";
                        }

                        return (
                            <button
                                key={num}
                                onClick={() => handleToggleNumber(num)}
                                className={cn(
                                    "aspect-square flex items-center justify-center text-sm sm:text-base rounded transition-all active:scale-95",
                                    buttonStyle
                                )}
                            >
                                {num}
                            </button>
                        );
                    })}
                </div>
            </div>

            <div className="shrink-0 pt-4 mt-4 border-t border-slate-800 flex justify-between gap-3">
                <Button variant="secondary" onClick={handleResumeGame}>
                    {currentGameState.paused_for_validation ? 'Cancel & Resume' : 'Cancel'}
                </Button>
                <div className="flex gap-2">
                    <Button variant="ghost" onClick={handleClearSelection} disabled={selectedNumbers.length === 0}>Clear</Button>
                    <Button 
                        variant="primary" 
                        onClick={handleCheckWin} 
                        disabled={selectedNumbers.length === 0 || (currentGameState.paused_for_validation && !validationResult)}
                    >
                        Check Win
                    </Button>
                </div>
            </div>
         </div>
      </Modal>

      {/* Record Winner Modal */}
      <Modal isOpen={showWinnerModal} onClose={() => setShowWinnerModal(false)} title={`Winner: ${game.stage_sequence[currentGameState.current_stage_index]}`}>
         <div className="space-y-4">
            {/* Snowball Eligibility Check */}
            {game.type === 'snowball' && 
             game.stage_sequence[currentGameState.current_stage_index] === 'Full House' && 
             currentSnowballPot && 
             currentGameState.numbers_called_count <= currentSnowballPot.current_max_calls && (
                <div className="bg-indigo-900/30 p-4 rounded-lg border border-indigo-500/50 mb-4 animate-in slide-in-from-top-2">
                    <div className="flex items-start gap-3">
                        <input 
                            type="checkbox" 
                            id="snowballEligible"
                            checked={isSnowballEligible}
                            onChange={(e) => {
                                const eligible = e.target.checked;
                                setIsSnowballEligible(eligible);
                                const basePrize = getPlannedPrize(currentGameState.current_stage_index);
                                if (eligible && currentSnowballPot) {
                                    setPrizeDescription(`${basePrize} + £${currentSnowballPot.current_jackpot_amount} (Snowball)`);
                                } else {
                                    setPrizeDescription(basePrize);
                                }
                            }}
                            className="mt-1 w-5 h-5 rounded border-indigo-400 bg-indigo-900/50 text-indigo-400 focus:ring-indigo-400 accent-indigo-500 cursor-pointer"
                        />
                        <div>
                            <label htmlFor="snowballEligible" className="text-indigo-300 font-bold cursor-pointer block">
                                Winner Eligible for Snowball (£{currentSnowballPot.current_jackpot_amount})?
                            </label>
                            <p className="text-xs text-indigo-400/70 mt-1">Check if attendee has attended last 3 games.</p>
                        </div>
                    </div>
                </div>
            )}

            <div>
                <label className="text-sm text-slate-400 block mb-1">Winner Name</label>
                <Input 
                    value={winnerName} 
                    onChange={(e) => setWinnerName(e.target.value)} 
                    placeholder="e.g. Dave - Table 6" 
                    autoFocus
                />
            </div>
            <div>
                <label className="text-sm text-slate-400 block mb-1">Prize Description</label>
                <Input 
                    value={prizeDescription} 
                    onChange={(e) => setPrizeDescription(e.target.value)} 
                    placeholder="e.g. £10 Cash" 
                />
            </div>
            <div className="flex items-center gap-2 pt-2">
                <input 
                    type="checkbox" 
                    id="prizeGiven" 
                    checked={prizeGiven} 
                    onChange={(e) => setPrizeGiven(e.target.checked)} 
                    className="w-5 h-5 rounded border-slate-600 bg-slate-800 text-bingo-primary focus:ring-bingo-primary accent-bingo-primary cursor-pointer"
                />
                <label htmlFor="prizeGiven" className="text-sm text-slate-300 select-none cursor-pointer">Prize Given Immediately?</label>
            </div>
         </div>
         <div className="mt-6 flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setShowWinnerModal(false)}>Cancel</Button>
            <Button variant="primary" onClick={() => handleRecordWinner()}>Confirm Winner</Button>
         </div>
      </Modal>

      {/* Post Win Modal */}
      <Modal isOpen={showPostWinModal} onClose={() => {}} title="Winner Recorded!" className="border-green-900">
         <div className="space-y-6 text-center py-4">
             <div className="w-16 h-16 bg-green-900/20 text-green-500 rounded-full flex items-center justify-center mx-auto text-3xl border border-green-900/50">
                 🎉
             </div>
             <p className="text-slate-300">The winner has been announced. What&apos;s next?</p>
             
             <div className="flex flex-col gap-3">
                 {(() => {
                     const hasNextStage = currentGameState.current_stage_index < game.stage_sequence.length - 1;
                     const nextStageName = hasNextStage ? game.stage_sequence[currentGameState.current_stage_index + 1] : null;
                     
                     return hasNextStage ? (
                        <Button variant="primary" size="lg" className="w-full bg-green-600 hover:bg-green-700" onClick={handleAdvanceStage}>
                            Start {nextStageName}
                        </Button>
                     ) : (
                        <Button variant="primary" size="lg" className="w-full bg-red-600 hover:bg-red-700" onClick={handleAdvanceStage}>
                            End Game
                        </Button>
                     );
                 })()}
                 
                 <div className="grid grid-cols-1 gap-3">
                    <Button variant="secondary" onClick={() => {
                        setShowPostWinModal(false);
                        setWinnerName('');
                        setIsSnowballEligible(false);
                        setPrizeDescription(getPlannedPrize(currentGameState.current_stage_index));
                        setShowWinnerModal(true);
                    }}>
                        Record Another Winner (Split Pot)
                    </Button>
                    
                    <Button variant="secondary" className="border-yellow-900/50 text-yellow-500 hover:bg-yellow-900/20" onClick={async () => {
                        await handleToggleBreak();
                        setShowPostWinModal(false);
                        setShowValidationModal(false);
                    }}>
                        Take a Break
                    </Button>
                 </div>
             </div>
         </div>
      </Modal>

      {/* Manual Snowball Win Modal */}
      <Modal isOpen={showManualSnowballModal} onClose={() => setShowManualSnowballModal(false)} title="Manual Snowball Award">
         <div className="space-y-4">
            <div className="p-3 bg-indigo-900/20 border border-indigo-900/50 rounded text-indigo-200 text-sm">
               This will record a Snowball Jackpot win, display the celebration, and <strong>reset the pot</strong>.
               Use this if the automatic trigger was missed or for special circumstances.
            </div>
            <div>
                <label className="text-sm text-slate-400 block mb-1">Winner Name</label>
                <Input 
                    value={winnerName} 
                    onChange={(e) => setWinnerName(e.target.value)} 
                    placeholder="e.g. Lucky Winner" 
                    autoFocus
                />
            </div>
            <div>
                <label className="text-sm text-slate-400 block mb-1">Prize Description</label>
                <Input 
                    value={prizeDescription} 
                    onChange={(e) => setPrizeDescription(e.target.value)} 
                />
            </div>
         </div>
         <div className="mt-6 flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setShowManualSnowballModal(false)}>Cancel</Button>
            <Button 
                variant="primary" 
                onClick={async () => {
                    if (!winnerName.trim()) {
                        setActionError("Winner name required.");
                        return;
                    }
                    
                    // Force record as snowball jackpot
                    const result = await recordWinner(
                        sessionId,
                        gameId,
                        'Full House', // Assume Snowball is always FH
                        winnerName,
                        prizeDescription,
                        currentGameState.numbers_called_count,
                        true, // isJackpot = true
                        true // Prize given immediately? Assume yes for manual award or make optional. Let's default true for "Close out".
                    );

                    if (result?.error) {
                        setActionError(result.error);
                    } else {
                        setShowManualSnowballModal(false);
                        setWinnerName('');
                        setShowPostWinModal(true);
                    }
                }}
            >
                Confirm Snowball Win
            </Button>
         </div>
      </Modal>

    </div>
  );
}