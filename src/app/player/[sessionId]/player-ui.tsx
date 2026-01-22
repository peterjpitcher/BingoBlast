"use client";

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Database } from '@/types/database';
import { createClient } from '@/utils/supabase/client';
import { cn, getContrastColor } from '@/lib/utils';
import { BingoBall } from '@/components/ui/bingo-ball';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Modal } from '@/components/ui/modal';
import { useWakeLock } from '@/hooks/wake-lock';

// Define types for props
type Session = Database['public']['Tables']['sessions']['Row'];
type Game = Database['public']['Tables']['games']['Row'];
type GameState = Database['public']['Tables']['game_states_public']['Row'];
type SnowballPot = Database['public']['Tables']['snowball_pots']['Row'];

interface PlayerUIProps {
  session: Session;
  activeGame: Game | null;
  initialGameState: GameState | null;
  initialPrizeText: string;
}

export default function PlayerUI({
  session,
  activeGame: initialActiveGame,
  initialGameState: initialActiveGameState,
  initialPrizeText,
}: PlayerUIProps) {
  const supabase = useRef(createClient());

  const [currentSession, setCurrentSession] = useState<Session>(session);
  const [currentActiveGame, setCurrentActiveGame] = useState<Game | null>(initialActiveGame);
  const [currentGameState, setCurrentGameState] = useState<GameState | null>(initialActiveGameState);
  const [currentPrizeText, setCurrentPrizeText] = useState<string>(initialPrizeText);
  const [currentSnowballPot, setCurrentSnowballPot] = useState<SnowballPot | null>(null);

  const [currentNumberDelayed, setCurrentNumberDelayed] = useState<number | null>(null);
  const [delayedNumbers, setDelayedNumbers] = useState<number[]>([]);
  const [showFullHistory, setShowFullHistory] = useState(false);

  const numberCallTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const currentGameStateRef = useRef<GameState | null>(currentGameState);

  useEffect(() => {
    currentGameStateRef.current = currentGameState;
  }, [currentGameState]);

  // Wake Lock
  useWakeLock();

  // Wake Lock


  // --- Data Fetching & Subscription Logic (Shared with Display) ---

  const refreshActiveGame = useCallback(async (newActiveGameId: string | null) => {
    if (newActiveGameId === currentActiveGame?.id) return;

    if (newActiveGameId) {
      const { data: newGame } = await supabase.current
        .from('games')
        .select('*')
        .eq('id', newActiveGameId)
        .single<Database['public']['Tables']['games']['Row']>();

      if (newGame) {
        setCurrentActiveGame(newGame);
        const { data: newGameState } = await supabase.current
          .from('game_states_public')
          .select('*')
          .eq('game_id', newGame.id)
          .single<Database['public']['Tables']['game_states_public']['Row']>();

        if (newGameState) {
          setCurrentGameState(newGameState);
          setCurrentPrizeText(newGame.prizes?.[newGame.stage_sequence[newGameState.current_stage_index] as keyof typeof newGame.prizes] || '');
        } else {
          setCurrentGameState(null);
        }
      } else {
        setCurrentActiveGame(null);
        setCurrentGameState(null);
      }
    } else {
      setCurrentActiveGame(null);
      setCurrentGameState(null);
    }
  }, [currentActiveGame]);

  useEffect(() => {
    const supabaseClient = supabase.current;

    const sessionChannel = supabaseClient
      .channel(`session_updates_player:${session.id}`)
      .on<Session>(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'sessions', filter: `id=eq.${session.id}` },
        async (payload) => {
          setCurrentSession(payload.new);
          await refreshActiveGame(payload.new.active_game_id);
        }
      )
      .subscribe();

    let gameStateChannel: ReturnType<typeof supabaseClient.channel> | null = null;
    if (currentActiveGame?.id) {
      // Listen for BOTH broadcast events from Host AND direct table changes (backup)
      gameStateChannel = supabaseClient
        .channel(`game_state_public_updates_player:${currentActiveGame.id}`)
        .on<GameState>(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'game_states_public', filter: `game_id=eq.${currentActiveGame.id}` },
          (payload) => {
            const newState = payload.new;
            setCurrentGameState(newState);
            setCurrentPrizeText(currentActiveGame?.prizes?.[currentActiveGame.stage_sequence[newState.current_stage_index] as keyof typeof currentActiveGame.prizes] || '');
          }
        )
        // Add Broadcast Listener
        .on(
          'broadcast',
          { event: 'game_update' },
          async () => {
            // Re-fetch game state on broadcast signal
            const { data: newGameState } = await supabaseClient
              .from('game_states_public')
              .select('*')
              .eq('game_id', currentActiveGame.id)
              .single<Database['public']['Tables']['game_states_public']['Row']>();

            if (newGameState) {
              setCurrentGameState(newGameState);
              setCurrentPrizeText(currentActiveGame?.prizes?.[currentActiveGame.stage_sequence[newGameState.current_stage_index] as keyof typeof currentActiveGame.prizes] || '');
            }
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
  }, [session.id, currentActiveGame, refreshActiveGame]);

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
          .channel(`pot_updates_player:${currentActiveGame.snowball_pot_id}`)
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

  // --- Delay Logic (Same as Display) ---
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (numberCallTimeoutRef.current) {
      clearTimeout(numberCallTimeoutRef.current);
    }

    if (currentActiveGame && currentGameState) {
      const serverCalledNumbers = currentGameState.called_numbers as number[];

      // Immediate sync
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


  // --- UI States ---
  const isWaiting = !currentActiveGame || (currentGameState?.status !== 'in_progress' && currentGameState?.status !== 'completed');
  const isOnBreak = currentGameState?.on_break;
  const isCompleted = currentGameState?.status === 'completed';
  const isValidating = currentGameState?.paused_for_validation;
  const isWin = !!currentGameState?.display_win_type;

  const backgroundColor = currentActiveGame?.background_colour || '#0F172A';
  const contrastTextColor = useMemo(() => getContrastColor(backgroundColor), [backgroundColor]);
  const isSnowballGame = currentActiveGame?.type === 'snowball';

  return (
    <div
      className={cn(
        "min-h-screen pb-8",
        contrastTextColor
      )}
      style={{ backgroundColor: backgroundColor }}
    >
      {/* Header */}
      <div className="bg-slate-900 p-4 border-b border-slate-800 flex items-center justify-between sticky top-0 z-20 shadow-md">
        <div>
          <h1 className="font-bold text-lg leading-none text-white">{currentSession.name}</h1>
          {currentActiveGame && <p className="text-sm text-slate-400">{currentActiveGame.name}</p>}
        </div>
        {currentGameState && (
          <div className="bg-slate-800 px-3 py-1 rounded border border-slate-700">
            <span className="text-xs text-slate-400 uppercase block">Calls</span>
            <span className="font-mono font-bold text-xl leading-none">{delayedNumbers.length}</span>
          </div>
        )}
      </div>

      {/* Main Status Content */}
      <div className="p-4 space-y-4">

        {/* Status Banners */}
        {isWaiting && (
          <Card className="bg-slate-900 border-slate-700">
            <CardContent className="p-6 text-center">
              <div className="text-4xl mb-2">⏳</div>
              <h2 className="text-xl font-bold text-white">Waiting for Host</h2>
              <p className="text-slate-400">Game will start soon...</p>
            </CardContent>
          </Card>
        )}

        {isOnBreak && !isCompleted && (
          <Card className="bg-yellow-900/20 border-yellow-600">
            <CardContent className="p-6 text-center">
              <div className="text-4xl mb-2 animate-bounce">☕️</div>
              <h2 className="text-2xl font-bold text-yellow-500">On Break</h2>
              <p className="text-yellow-200/70">We will resume shortly</p>
            </CardContent>
          </Card>
        )}

        {isCompleted && (
          <Card className="bg-green-900/20 border-green-600">
            <CardContent className="p-6 text-center">
              <div className="text-4xl mb-2">🏁</div>
              <h2 className="text-2xl font-bold text-green-500">Game Over</h2>
              <p className="text-green-200/70">Thanks for playing!</p>
            </CardContent>
          </Card>
        )}

        {isValidating && !isWin && (
          <Card className="bg-blue-900/20 border-blue-500 animate-pulse">
            <CardContent className="p-6 text-center">
              <div className="text-4xl mb-2">🎫</div>
              <h2 className="text-2xl font-bold text-blue-400">Checking Claim</h2>
              <p className="text-blue-200/70">Please wait...</p>
            </CardContent>
          </Card>
        )}

        {isWin && (
          <Card className="bg-green-600 border-green-400 shadow-[0_0_30px_rgba(34,197,94,0.4)]">
            <CardContent className="p-6 text-center text-white">
              <div className="text-6xl mb-2">🎉</div>
              <h2 className="text-3xl font-black uppercase">{currentGameState?.display_win_text}</h2>
              {currentGameState?.display_winner_name && (
                <p className="text-xl mt-2 font-medium">{currentGameState.display_winner_name}</p>
              )}
            </CardContent>
          </Card>
        )}

        {/* Active Game Display */}
        {!isWaiting && !isCompleted && !isOnBreak && (
          <>
            {/* Info Cards */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-slate-900 p-3 rounded-lg border border-slate-800">
                <span className="text-xs text-slate-500 uppercase block">Playing For</span>
                <span className="font-bold text-yellow-500 text-lg leading-tight">
                  {currentActiveGame?.stage_sequence[currentGameState?.current_stage_index || 0]}
                </span>
              </div>
              <div className="bg-slate-900 p-3 rounded-lg border border-slate-800">
                <span className="text-xs text-slate-500 uppercase block">Prize</span>
                <span className="font-bold text-white text-lg leading-tight">
                  {currentPrizeText || '-'}
                </span>
              </div>
            </div>

            {isSnowballGame && currentSnowballPot && (
              <div className="bg-indigo-950 p-3 rounded-lg border border-indigo-500/50 flex justify-between items-center shadow-lg shadow-indigo-900/20">
                <div>
                  <span className="text-indigo-300 text-xs font-bold uppercase block">Snowball Jackpot</span>
                  <span className="text-2xl font-bold text-white">£{currentSnowballPot.current_jackpot_amount}</span>
                </div>
                <div className="text-right">
                  <span className="text-indigo-300 text-xs block">Win in</span>
                  <span className="text-xl font-bold text-white">{currentSnowballPot.current_max_calls} calls</span>
                </div>
              </div>
            )}

            {/* Current Number */}
            <div className="flex justify-center py-4">
              {currentNumberDelayed ? (
                <div className="relative">
                  <div className="w-48 h-48 bg-white rounded-full flex items-center justify-center shadow-2xl border-8 border-slate-200">
                    <span className="text-8xl font-black text-slate-900 tracking-tighter">
                      {currentNumberDelayed}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="w-48 h-48 rounded-full border-4 border-slate-800 border-dashed flex items-center justify-center">
                  <span className="text-slate-600 font-bold">READY</span>
                </div>
              )}
            </div>

            {/* Recent History */}
            <div>
              <div className="flex justify-between items-end mb-2">
                <span className="text-sm text-slate-400 font-medium">Recent Calls</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-bingo-primary h-auto p-0 hover:bg-transparent"
                  onClick={() => setShowFullHistory(true)}
                >
                  View All Numbers
                </Button>
              </div>
              <div className="flex gap-2 overflow-x-auto pb-2 mask-linear-fade-right">
                {delayedNumbers.slice(-5).reverse().map((num, i) => (
                  <BingoBall
                    key={i}
                    number={num}
                    variant={i === 0 ? "active" : "called"}
                    className={i === 0 ? "w-14 h-14 text-xl" : "w-12 h-12 text-lg opacity-80"}
                  />
                ))}
                {delayedNumbers.length === 0 && <p className="text-slate-600 italic text-sm">No numbers called yet</p>}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Full History Modal */}
      <Modal
        isOpen={showFullHistory}
        onClose={() => setShowFullHistory(false)}
        title="Called Numbers"
        className="h-[80vh] flex flex-col"
      >
        <div className="flex-1 overflow-y-auto p-1">
          <div className="grid grid-cols-10 gap-1">
            {Array.from({ length: 90 }, (_, i) => i + 1).map(num => {
              const isCalled = delayedNumbers.includes(num);
              return (
                <div
                  key={num}
                  className={cn(
                    "aspect-square flex items-center justify-center text-sm font-bold rounded",
                    isCalled ? "bg-green-600 text-white" : "bg-slate-800 text-slate-600"
                  )}
                >
                  {num}
                </div>
              );
            })}
          </div>
        </div>
        <div className="mt-4 text-center">
          <Button variant="secondary" className="w-full" onClick={() => setShowFullHistory(false)}>Close</Button>
        </div>
      </Modal>

    </div>
  );
}
