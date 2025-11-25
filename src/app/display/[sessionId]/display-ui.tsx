"use client";

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Database } from '@/types/database';
import { createClient } from '@/utils/supabase/client';
import { cn, getContrastColor } from '@/lib/utils';
import Image from 'next/image';
import { QRCodeSVG } from 'qrcode.react';

// Define types for props
type Session = Database['public']['Tables']['sessions']['Row'];
type Game = Database['public']['Tables']['games']['Row'];
type GameState = Database['public']['Tables']['game_states']['Row'];
type SnowballPot = Database['public']['Tables']['snowball_pots']['Row'];

interface DisplayUIProps {
  session: Session;
  activeGame: Game | null;
  initialGameState: GameState | null;
  initialPrizeText: string;
  isWaitingState: boolean;
}

const TextShadow = "2px 2px 4px rgba(0,0,0,0.9)";

export default function DisplayUI({
  session,
  activeGame: initialActiveGame,
  initialGameState: initialActiveGameState,
  initialPrizeText,
  isWaitingState: initialWaitingState,
}: DisplayUIProps) {
  const supabase = useRef(createClient());

  const [currentSession, setCurrentSession] = useState<Session>(session);
  const [currentActiveGame, setCurrentActiveGame] = useState<Game | null>(initialActiveGame);
  const [currentGameState, setCurrentGameState] = useState<GameState | null>(initialActiveGameState);
  const [currentPrizeText, setCurrentPrizeText] = useState<string>(initialPrizeText);
  const [isWaitingState, setIsWaitingState] = useState<boolean>(initialWaitingState);
  const [isGameFinishedState, setIsGameFinishedState] = useState(false);
  const [currentNumberDelayed, setCurrentNumberDelayed] = useState<number | null>(null);
  const [delayedNumbers, setDelayedNumbers] = useState<number[]>([]);
  const [currentSnowballPot, setCurrentSnowballPot] = useState<SnowballPot | null>(null);
  
  const numberCallTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const currentGameStateRef = useRef<GameState | null>(currentGameState);

  useEffect(() => {
    currentGameStateRef.current = currentGameState;
  }, [currentGameState]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const refreshActiveGame = async (newActiveGameId: string | null) => {
      if (newActiveGameId === currentActiveGame?.id) return;

      if (newActiveGameId) {
        console.log("Switching to new game:", newActiveGameId);
        
        const { data: newGame, error: gameError } = await supabase.current
          .from('games')
          .select('*')
          .eq('id', newActiveGameId)
          .single<Database['public']['Tables']['games']['Row']>();
        
        if (newGame) {
          setCurrentActiveGame(newGame);
          const { data: newGameState, error: gameStateError } = await supabase.current
            .from('game_states')
            .select('*')
            .eq('game_id', newGame.id)
            .single<Database['public']['Tables']['game_states']['Row']>();
          
          if (newGameState) {
            setCurrentGameState(newGameState);
            setIsGameFinishedState(newGameState.status === 'completed');
            setCurrentPrizeText(newGame.prizes?.[newGame.stage_sequence[newGameState.current_stage_index] as keyof typeof newGame.prizes] || '');
          } else {
            setCurrentGameState(null);
            setIsGameFinishedState(false);
          }
        } else {
          console.error("Error fetching new active game:", gameError?.message);
          setCurrentActiveGame(null);
          setCurrentGameState(null);
        }
      } else {
        setCurrentActiveGame(null);
        setCurrentGameState(null);
        setIsGameFinishedState(false);
      }
      setIsWaitingState(!newActiveGameId);
  };

  useEffect(() => {
    const supabaseClient = supabase.current;

    const sessionChannel = supabaseClient
      .channel(`session_updates:${session.id}`)
      .on<Session>(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'sessions', filter: `id=eq.${session.id}` },
        async (payload) => {
          console.log('Realtime session update received:', payload.new);
          setCurrentSession(payload.new);
          await refreshActiveGame(payload.new.active_game_id);
        }
      )
      .subscribe();

    let gameStateChannel: ReturnType<typeof supabaseClient.channel> | null = null;
    if (currentActiveGame?.id) {
      gameStateChannel = supabaseClient
        .channel(`game_state_updates:${currentActiveGame.id}`)
        .on<GameState>(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'game_states', filter: `game_id=eq.${currentActiveGame.id}` },
          (payload) => {
            const newState = payload.new;
            
            // No audio here anymore

            setCurrentGameState(newState);
            setIsGameFinishedState(newState.status === 'completed');
            setCurrentPrizeText(currentActiveGame?.prizes?.[currentActiveGame.stage_sequence[newState.current_stage_index] as keyof typeof currentActiveGame.prizes] || '');
          }
        )
        .subscribe();
    }

    return () => {
      supabaseClient.removeChannel(sessionChannel);
      if (gameStateChannel) {
        supabaseClient.removeChannel(gameStateChannel);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id, currentActiveGame]);

  useEffect(() => {
      const interval = setInterval(async () => {
          const { data: freshSession } = await supabase.current
              .from('sessions')
              .select('active_game_id, status') 
              .eq('id', session.id)
              .single<Pick<Session, 'active_game_id' | 'status'>>();
          
          if (freshSession) {
              if (freshSession.active_game_id !== currentActiveGame?.id) {
                  await refreshActiveGame(freshSession.active_game_id);
              } else if (currentActiveGame?.id) {
                  // Poll game state to ensure sync
                  const { data: freshState } = await supabase.current
                    .from('game_states')
                    .select('*')
                    .eq('game_id', currentActiveGame.id)
                    .single<Database['public']['Tables']['game_states']['Row']>();
                  
                  if (freshState) {
                      setCurrentGameState(freshState);
                      setIsGameFinishedState(freshState.status === 'completed');
                  }
              }
          }
      }, 5000);

      return () => clearInterval(interval);
  }, [currentActiveGame, session.id]);

  useEffect(() => {
    const supabaseClient = supabase.current;
    let potChannel: ReturnType<typeof supabaseClient.channel> | null = null;

    const fetchAndSubscribePot = async () => {
        if (currentActiveGame?.type === 'snowball' && currentActiveGame.snowball_pot_id) {
            const { data } = await supabaseClient
            .from('snowball_pots')
            .select('*')
            .eq('id', currentActiveGame.snowball_pot_id)
            .single();
            if (data) setCurrentSnowballPot(data);

            potChannel = supabaseClient
            .channel(`pot_updates:${currentActiveGame.snowball_pot_id}`)
            .on<SnowballPot>(
                'postgres_changes',
                { event: 'UPDATE', schema: 'public', table: 'snowball_pots', filter: `id=eq.${currentActiveGame.snowball_pot_id}` },
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
        if (potChannel) supabaseClient.removeChannel(potChannel);
    };
  }, [currentActiveGame]);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (numberCallTimeoutRef.current) {
      clearTimeout(numberCallTimeoutRef.current);
    }

    if (currentActiveGame && currentGameState) {
      const serverCalledNumbers = currentGameState.called_numbers as number[];
      
      // Force immediate sync if paused or completed (FR-34: Fast-forward)
      if (currentGameState.paused_for_validation || currentGameState.status === 'completed') {
          setDelayedNumbers(serverCalledNumbers);
          const newLastNumber = serverCalledNumbers.length > 0 ? serverCalledNumbers[serverCalledNumbers.length - 1] : null;
          setCurrentNumberDelayed(newLastNumber);
          return;
      }
      
      if (serverCalledNumbers.length < delayedNumbers.length) {
          setDelayedNumbers(serverCalledNumbers);
          const newLastNumber = serverCalledNumbers.length > 0 ? serverCalledNumbers[serverCalledNumbers.length - 1] : null;
          setCurrentNumberDelayed(newLastNumber);
          return;
      }

      if (currentGameState.numbers_called_count > 0) {
        const lastCalledNumber = serverCalledNumbers[currentGameState.numbers_called_count - 1];
        const lastCallTimestamp = currentGameState.last_call_at ? new Date(currentGameState.last_call_at).getTime() : 0;
        const callDelay = currentGameState.call_delay_seconds * 1000;

        const now = Date.now();
        const timeSinceLastCall = now - lastCallTimestamp;

        if (currentNumberDelayed === lastCalledNumber) {
            if (delayedNumbers.length !== serverCalledNumbers.length) {
                 if (!delayedNumbers.includes(lastCalledNumber)) {
                     setDelayedNumbers(prev => [...prev, lastCalledNumber]);
                 }
            }
            return; 
        }
        
        if (timeSinceLastCall >= callDelay) {
            setCurrentNumberDelayed(lastCalledNumber);
            setDelayedNumbers(serverCalledNumbers);
        } else {
            numberCallTimeoutRef.current = setTimeout(() => {
            setCurrentNumberDelayed(lastCalledNumber);
            setDelayedNumbers(serverCalledNumbers);
            }, callDelay - timeSinceLastCall);
        }
      } else {
        setCurrentNumberDelayed(null);
        setDelayedNumbers([]);
      }
    } else {
      setCurrentNumberDelayed(null);
      setDelayedNumbers([]);
    }

    return () => {
      if (numberCallTimeoutRef.current) {
        clearTimeout(numberCallTimeoutRef.current);
      }
    };
  }, [currentActiveGame, currentGameState, currentNumberDelayed, delayedNumbers]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const showActiveGame = currentActiveGame && currentGameState && currentGameState.status === 'in_progress' && !currentGameState.on_break && !isGameFinishedState && !currentGameState.display_win_type && !currentGameState.paused_for_validation;
  const showBreak = currentActiveGame && currentGameState?.on_break && !isGameFinishedState;
  const showPausedForValidation = currentActiveGame && currentGameState?.paused_for_validation && !isGameFinishedState && !currentGameState.display_win_type; 
  const showWinState = !!currentGameState?.display_win_type;
  
  const displayBackgroundColor = currentActiveGame?.background_colour || '#0F172A'; 
  const contrastTextColor = useMemo(() => getContrastColor(displayBackgroundColor), [displayBackgroundColor]);
  const dimTextColor = contrastTextColor === 'text-white' ? 'text-white/70' : 'text-slate-900/70';

  return (
    <div 
      className={cn(
          "min-h-screen w-full flex flex-col transition-colors duration-1000 ease-in-out overflow-hidden relative",
          contrastTextColor
      )}
      style={{ backgroundColor: displayBackgroundColor }}
    >
      {/* Top Bar */}
      <div className="h-24 px-8 flex items-center justify-between bg-black/10 backdrop-blur-sm z-10">
         <div className="flex items-center gap-4">
             <div className="relative w-64 h-24">
                 <Image src="/BingoBlast.png" alt="Bingo Blast" fill className="object-contain object-left" />
             </div>
         </div>
         <div className="text-right" style={{ textShadow: TextShadow }}>
             <h2 className="text-2xl font-bold tracking-tight">{currentSession.name}</h2>
             {currentActiveGame && <p className={cn("text-lg font-medium uppercase tracking-wider", dimTextColor)}>{currentActiveGame.name}</p>}
         </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex items-center justify-center relative p-8">
          
          {isWaitingState && (
            <div className="text-center animate-in fade-in duration-700" style={{ textShadow: TextShadow }}>
              <h1 className="text-6xl font-black mb-4 opacity-90">WAITING FOR HOST...</h1>
              <p className="text-3xl opacity-60">Grab a drink and get ready!</p>
            </div>
          )}

          {showBreak && (
            <div className="text-center animate-in zoom-in duration-500" style={{ textShadow: TextShadow }}>
              <h1 className="text-8xl font-black text-yellow-400 mb-6 animate-pulse">BREAK TIME</h1>
              <p className="text-4xl">We will resume shortly</p>
            </div>
          )}

          {isGameFinishedState && (
            <div className="text-center animate-in fade-in duration-500" style={{ textShadow: TextShadow }}>
              <h1 className="text-8xl font-black text-green-400 mb-6">GAME OVER</h1>
              <p className="text-4xl">Thank you for playing!</p>
            </div>
          )}

          {showPausedForValidation && (
            <div className="text-center animate-in slide-in-from-bottom duration-500" style={{ textShadow: TextShadow }}>
                <div className="inline-block px-8 py-4 bg-blue-600/20 border-2 border-blue-500 rounded-full mb-8 animate-pulse">
                    <h2 className="text-4xl font-bold text-blue-300 uppercase tracking-widest">Checking Ticket</h2>
                </div>
                <h1 className="text-7xl font-black">PLEASE WAIT...</h1>
            </div>
          )}

          {showActiveGame && (
            <div className="flex flex-col items-center justify-center h-full w-full">
              {currentNumberDelayed ? (
                <div className="relative animate-in zoom-in duration-300">
                  <div className="absolute inset-0 bg-current blur-3xl rounded-full transform scale-150 opacity-20"></div>
                   {/* Massive Main Number */}
                  <div 
                    className="relative bg-white rounded-full flex items-center justify-center shadow-2xl"
                    style={{ width: '35vh', height: '35vh', minWidth: '300px', minHeight: '300px' }}
                  >
                      <span className="text-[20vh] font-black text-slate-900 leading-none tracking-tighter">
                          {currentNumberDelayed}
                      </span>
                  </div>
                </div>
              ) : (
                 <h1 className="text-5xl font-bold opacity-40 animate-pulse">READY...</h1>
              )}
            </div>
          )}

          {/* WIN OVERLAY */}
          {showWinState && currentGameState && (
            <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black/90 backdrop-blur-md animate-in fade-in zoom-in duration-500 p-8 text-center">
              <h1 
                className={cn(
                    "text-9xl font-black mb-8 animate-bounce",
                    currentGameState.display_win_type === 'snowball' ? "text-yellow-400 drop-shadow-[0_0_30px_rgba(250,204,21,0.8)]" : "text-green-500 drop-shadow-[0_0_30px_rgba(34,197,94,0.8)]"
                )}
              >
                  {currentGameState.display_win_text}
              </h1>
              {currentGameState.display_winner_name && (
                  <div className="bg-white/10 px-12 py-6 rounded-2xl border border-white/20 backdrop-blur-xl animate-in slide-in-from-bottom duration-700 delay-200">
                      <p className="text-2xl text-white/60 uppercase tracking-widest mb-2">Winner</p>
                      <h2 className="text-6xl font-bold text-white">{currentGameState.display_winner_name}</h2>
                  </div>
              )}
            </div>
          )}
      </div>

      {/* Footer Info Bar */}
      <div className="h-32 bg-black/10 border-t border-white/10 backdrop-blur-md grid grid-cols-2 px-8 z-10">
          <div className="flex flex-col justify-center border-r border-white/10 pr-8">
             {(showActiveGame || showPausedForValidation) && (
                <>
                   <div className="flex items-baseline gap-4 mb-1">
                      <span className={cn("text-sm uppercase tracking-widest font-bold", dimTextColor)}>Current Stage</span>
                      <span className="text-3xl font-bold text-yellow-400" style={{ textShadow: TextShadow }}>{currentActiveGame?.stage_sequence[currentGameState?.current_stage_index || 0]}</span>
                   </div>
                   
                   {currentActiveGame?.type === 'snowball' && currentSnowballPot ? (
                        <div className="flex items-center gap-4 bg-indigo-900/80 p-2 px-4 rounded-lg border border-indigo-500/30 self-start shadow-lg">
                            <span className="text-indigo-300 text-sm font-bold uppercase">Snowball</span>
                            <span className="text-2xl font-bold text-white">£{currentSnowballPot.current_jackpot_amount}</span>
                            <span className="text-indigo-300 text-sm">in {currentSnowballPot.current_max_calls} calls</span>
                        </div>
                   ) : (
                        <div className="text-xl font-medium">
                            <span className={cn("mr-2", dimTextColor)}>Prize:</span>
                            <span style={{ textShadow: TextShadow }}>{currentPrizeText || 'Standard Prize'}</span>
                        </div>
                   )}
                </>
             )}
          </div>

          <div className="flex flex-col justify-center pl-8 overflow-hidden">
              {(showActiveGame || showPausedForValidation) && delayedNumbers.length > 0 && (
                  <>
                    <div className="flex justify-between items-end mb-2">
                        <span className={cn("text-xs uppercase tracking-widest font-bold", dimTextColor)}>Recent Calls</span>
                        <span className={cn("text-xs uppercase tracking-widest font-bold", dimTextColor)}>Total Calls: {delayedNumbers.length}</span>
                    </div>
                    <div className="flex items-center gap-3 overflow-hidden mask-linear-fade">
                        {delayedNumbers.slice().reverse().map((num, idx) => (
                            <div key={idx} className={cn(
                                "flex items-center justify-center rounded-full bg-white font-bold text-slate-900 shadow-lg shrink-0",
                                idx === 0 ? "w-16 h-16 text-2xl border-4 border-bingo-primary" : "w-12 h-12 text-lg opacity-70"
                            )}>
                                {num}
                            </div>
                        ))}
                    </div>
                  </>
              )}
          </div>
      </div>

      {/* Player Join QR Code */}
      <div className="absolute bottom-36 left-8 bg-white p-4 rounded-xl shadow-2xl flex flex-col items-center gap-2 animate-in slide-in-from-left duration-1000 z-40">
          <div className="bg-slate-900 p-2 rounded-lg">
             <QRCodeSVG 
                value={`${typeof window !== 'undefined' ? window.location.origin : ''}/player/${session.id}`} 
                size={100}
                level="H"
                fgColor="#FFFFFF"
                bgColor="#0F172A"
             />
          </div>
          <p className="text-slate-900 font-bold text-sm uppercase tracking-wider">Play Along</p>
      </div>
    </div>
  );
}