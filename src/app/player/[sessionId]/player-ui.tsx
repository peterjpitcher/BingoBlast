"use client";

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Database } from '@/types/database';
import { createClient } from '@/utils/supabase/client';
import { cn } from '@/lib/utils';
import { BingoBall } from '@/components/ui/bingo-ball';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Modal } from '@/components/ui/modal';
import { useWakeLock } from '@/hooks/wake-lock';
import { formatPounds, getSnowballCallsLabel, getSnowballCallsRemaining } from '@/lib/snowball';

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

  const { isLocked: isWakeLockActive } = useWakeLock();


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
      // Listen for game state changes
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
  const isSessionCompleted = currentSession.status === 'completed';
  const isWaiting = !isSessionCompleted && (!currentActiveGame || (currentGameState?.status !== 'in_progress' && currentGameState?.status !== 'completed'));
  const isOnBreak = currentGameState?.on_break;
  const isCompleted = currentGameState?.status === 'completed';
  const isValidating = currentGameState?.paused_for_validation;
  const isWin = !!currentGameState?.display_win_type;

  const backgroundColor = currentActiveGame?.background_colour || '#005131';
  const isSnowballGame = currentActiveGame?.type === 'snowball';
  const snowballCallsLabel = currentSnowballPot && currentGameState
    ? getSnowballCallsLabel(currentGameState.numbers_called_count, currentSnowballPot.current_max_calls)
    : null;
  const snowballCallsRemaining = currentSnowballPot && currentGameState
    ? getSnowballCallsRemaining(currentGameState.numbers_called_count, currentSnowballPot.current_max_calls)
    : null;

  return (
    <div
      className={cn(
        "min-h-screen pb-8 text-white"
      )}
      style={{ backgroundColor: backgroundColor }}
    >
      {/* Header */}
      <div className="bg-[#003f27]/80 p-4 border-b border-[#1f7c58] flex items-center justify-between sticky top-0 z-20 shadow-md">
        <div>
          <h1 className="font-bold text-lg leading-none text-white">{currentSession.name}</h1>
          {currentActiveGame && <p className="text-sm text-white">{currentActiveGame.name}</p>}
        </div>
        {currentGameState && (
          <div className="bg-[#005131] px-3 py-1 rounded border border-[#1f7c58]">
            <span className="text-xs text-white uppercase block">Calls</span>
            <span className="font-mono font-bold text-xl leading-none">{delayedNumbers.length}</span>
          </div>
        )}
      </div>

      {!isWakeLockActive && (
        <div className="bg-[#a57626]/20 border-b border-[#a57626]/50 px-4 py-2 text-center text-xs font-semibold uppercase tracking-wide text-white">
          Tap once to keep this screen awake
        </div>
      )}

      {/* Main Status Content */}
      <div className="p-4 space-y-4">

        {/* Status Banners */}
        {isSessionCompleted && (
          <Card className="bg-[#003f27]/80 border-[#1f7c58]">
            <CardContent className="p-6 text-center">
              <div className="text-4xl mb-2">🙏</div>
              <h2 className="text-xl font-bold text-white">Thanks for coming!</h2>
              <p className="text-white">Please book for our next bingo event at the bar.</p>
            </CardContent>
          </Card>
        )}

        {isWaiting && (
          <Card className="bg-[#003f27]/80 border-[#1f7c58]">
            <CardContent className="p-6 text-center">
              <div className="text-4xl mb-2">⏳</div>
              <h2 className="text-xl font-bold text-white">Waiting for Host</h2>
              <p className="text-white">Game will start soon...</p>
            </CardContent>
          </Card>
        )}

        {isOnBreak && !isCompleted && (
          <Card className="bg-yellow-900/20 border-yellow-600">
            <CardContent className="p-6 text-center">
              <div className="text-4xl mb-2 animate-bounce">☕️</div>
              <h2 className="text-2xl font-bold text-white">On Break</h2>
              <p className="text-white">We will resume shortly</p>
            </CardContent>
          </Card>
        )}

        {isCompleted && !isSessionCompleted && (
          <Card className="bg-green-900/20 border-green-600">
            <CardContent className="p-6 text-center">
              <div className="text-4xl mb-2">🏁</div>
              <h2 className="text-2xl font-bold text-white">Game Over</h2>
              <p className="text-white">Thanks for playing!</p>
            </CardContent>
          </Card>
        )}

        {isValidating && !isWin && (
          <Card className="bg-blue-900/20 border-blue-500 animate-pulse">
            <CardContent className="p-6 text-center">
              <div className="text-4xl mb-2">🎫</div>
              <h2 className="text-2xl font-bold text-white">Checking Claim</h2>
              <p className="text-white">Please wait...</p>
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
        {!isSessionCompleted && !isWaiting && !isCompleted && !isOnBreak && (
          <>
            {/* Info Cards */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-[#003f27]/80 p-3 rounded-lg border border-[#1f7c58]">
                <span className="text-xs text-white uppercase block">Playing For</span>
                <span className="font-bold text-white text-lg leading-tight">
                  {currentActiveGame?.stage_sequence[currentGameState?.current_stage_index || 0]}
                </span>
              </div>
              <div className="bg-[#003f27]/80 p-3 rounded-lg border border-[#1f7c58]">
                <span className="text-xs text-white uppercase block">Prize</span>
                <span className="font-bold text-white text-lg leading-tight">
                  {currentPrizeText || '-'}
                </span>
              </div>
            </div>

            {isSnowballGame && (
              <div className="bg-[#a57626]/25 p-3 rounded-lg border border-[#a57626]/60 flex justify-between items-center shadow-lg shadow-black/25 gap-4">
                {currentSnowballPot && currentGameState ? (
                  <>
                    <div>
                      <span className="text-white text-xs font-bold uppercase block">Snowball Jackpot</span>
                      <span className="text-2xl font-bold text-white">£{formatPounds(Number(currentSnowballPot.current_jackpot_amount))}</span>
                    </div>
                    <div className="text-right">
                      <span className="text-white text-xs block">Status</span>
                      <span className="text-xl font-bold text-white">
                        {snowballCallsLabel}
                      </span>
                      <span className="text-xs text-white/90 block">
                        {currentGameState.numbers_called_count}/{currentSnowballPot.current_max_calls} calls
                        {typeof snowballCallsRemaining === 'number' ? ` • ${snowballCallsRemaining} left` : ''}
                      </span>
                    </div>
                  </>
                ) : (
                  <p className="text-white font-semibold">
                    Snowball countdown unavailable: this game is not linked to a snowball pot.
                  </p>
                )}
              </div>
            )}

            {/* Current Number */}
            <div className="flex justify-center py-4">
              {currentNumberDelayed ? (
                <div className="relative">
                <div className="w-48 h-48 bg-[#005131] rounded-full flex items-center justify-center shadow-2xl border-8 border-white">
                    <span className="text-8xl font-black text-white tracking-tighter">
                      {currentNumberDelayed}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="w-48 h-48 rounded-full border-4 border-[#1f7c58] border-dashed flex items-center justify-center">
                  <span className="text-white font-bold">READY</span>
                </div>
              )}
            </div>

            {/* Recent History */}
            <div>
              <div className="flex justify-between items-end mb-2">
                <span className="text-sm text-white font-medium">Recent Calls</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-white h-auto p-0 hover:bg-transparent"
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
                    className={i === 0 ? "w-14 h-14 text-xl bg-[#005131] text-white border-white/70" : "w-12 h-12 text-lg opacity-80 bg-[#005131] text-white border-white/50"}
                  />
                ))}
                {delayedNumbers.length === 0 && <p className="text-white italic text-sm">No numbers called yet</p>}
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
                    isCalled ? "bg-green-600 text-white" : "bg-[#003f27] text-white"
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
