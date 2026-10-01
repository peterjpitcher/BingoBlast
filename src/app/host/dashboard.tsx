"use client";

import React, { useRef, useState } from 'react';
import { formatDateInLondon } from '@/lib/dates';
import { useRouter } from 'next/navigation';
import { Database } from '@/types/database';
import { endNight, settleSnowballPotForGame, startGame } from './actions';
import type { UnsettledSnowballGame } from './claim-action-types';
import { ChevronDown } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Kicker } from '@/components/ui/kicker';
import { cn } from '@/lib/utils';
import { Modal } from '@/components/ui/modal';
import { Input, fieldLabelClass } from '@/components/ui/input';

type SessionWithGames = Database['public']['Tables']['sessions']['Row'] & {
  games: (Database['public']['Tables']['games']['Row'] & {
    game_states: Database['public']['Tables']['game_states']['Row'] | null;
  })[];
};

interface HostDashboardProps {
  sessions: SessionWithGames[];
  /**
   * Finished snowball games whose pot never settled (X6), across every night,
   * from listUnsettledSnowballGames. Hosts and admins alike.
   */
  unsettledSnowballGames?: UnsettledSnowballGame[];
  /** The settlement check itself failed to read, so the list above is not an answer. */
  settlementCheckFailed?: boolean;
}

/** End the night confirmation: the session, and the games that will stay unplayed. */
interface EndNightTarget {
  sessionId: string;
  sessionName: string;
  unplayedGames: string[];
}

/** What one tap on Start, Resume or Re-open came to. 'busy' means another start was already in flight. */
type StartOutcome =
  | { status: 'started' }
  | { status: 'needs-cash-jackpot' }
  | { status: 'busy' }
  | { status: 'failed'; message: string };

export default function HostDashboard({
  sessions,
  unsettledSnowballGames = [],
  settlementCheckFailed = false,
}: HostDashboardProps) {
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

  // End the night (spec 5.1). A modal, not confirm(), listing what stays unplayed.
  const [endNightTarget, setEndNightTarget] = useState<EndNightTarget | null>(null);
  const [isEndingNight, setIsEndingNight] = useState(false);
  const [endNightError, setEndNightError] = useState<string | null>(null);

  // Settle buttons for finished snowball games whose pot never moved (X6).
  const [settlingGameId, setSettlingGameId] = useState<string | null>(null);
  const [settledGameIds, setSettledGameIds] = useState<ReadonlySet<string>>(new Set());
  const [settleError, setSettleError] = useState<{ gameId: string; message: string } | null>(null);
  const visibleUnsettledGames = unsettledSnowballGames.filter((g) => !settledGameIds.has(g.gameId));

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

  const openEndNight = (session: SessionWithGames) => {
    const unplayedGames = [...session.games]
      .sort((a, b) => a.game_index - b.game_index)
      .filter((g) => (g.game_states?.status ?? 'not_started') === 'not_started')
      .map((g) => `Game ${g.game_index}: ${g.name}`);
    setEndNightError(null);
    setEndNightTarget({ sessionId: session.id, sessionName: session.name, unplayedGames });
  };

  const closeEndNight = () => {
    if (isEndingNight) return;
    setEndNightTarget(null);
    setEndNightError(null);
  };

  /**
   * Ends the night through end_night. Refused while a game is in progress;
   * unplayed games stay unplayed and their snowball pot is untouched. Safe to
   * repeat: a night that has already ended is returned as it is.
   */
  const handleConfirmEndNight = async () => {
    if (!endNightTarget || isEndingNight) return;
    setIsEndingNight(true);
    setEndNightError(null);
    try {
      const result = await endNight(endNightTarget.sessionId);
      if (!result?.success) {
        setEndNightError(result?.error || 'Could not end the night. Try again.');
        return;
      }
      setEndNightTarget(null);
      router.refresh();
    } catch (err) {
      console.error(err);
      setEndNightError('Could not reach the server to end the night. Check the connection and try again.');
    } finally {
      setIsEndingNight(false);
    }
  };

  /** Settles one finished snowball game's pot. Safe to repeat: a second settle changes nothing. */
  const handleSettleGame = async (gameId: string) => {
    if (settlingGameId !== null) return;
    setSettlingGameId(gameId);
    setSettleError(null);
    try {
      const result = await settleSnowballPotForGame(gameId);
      if (!result?.success) {
        setSettleError({ gameId, message: result?.error || 'The pot did not update. Try again.' });
        return;
      }
      setSettledGameIds((current) => new Set([...current, gameId]));
      router.refresh();
    } catch (err) {
      console.error(err);
      setSettleError({ gameId, message: 'Could not reach the server to settle the pot. Check the connection and try again.' });
    } finally {
      setSettlingGameId(null);
    }
  };

  const closeCashJackpotPrompt = () => {
    if (isSubmittingCashJackpot) return;
    setCashJackpotPrompt(null);
    setCashJackpotAmount('');
    setCashJackpotError(null);
  };

  return (
    <div className="flex flex-col gap-4">
      {/* X6: a finished snowball game whose pot never moved. The retry banner
          on the game screen is gone once the host leaves or reloads, so the
          dashboard keeps offering it until the pot is settled. */}
      {settlementCheckFailed && (
        <div role="alert" className="flex flex-col gap-1 rounded-card border border-anchor-danger bg-anchor-green-card p-4">
          <Kicker>Needs attention</Kicker>
          <p className="text-[15px] leading-normal text-anchor-danger-text">
            Could not check whether every snowball pot has settled. Reload to try again.
          </p>
        </div>
      )}
      {visibleUnsettledGames.length > 0 && (
        <Card accent className="flex flex-col gap-3 p-4">
          <div className="flex flex-col gap-1">
            <Kicker>Needs attention</Kicker>
            <h2 className="text-2xl leading-[1.05] text-anchor-cream-text">Snowball pot not settled</h2>
            <p className="text-sm leading-[1.45] text-anchor-sage">
              {visibleUnsettledGames.length === 1
                ? 'This snowball game finished but its pot never moved, so the jackpot still shows the old figure. Settle it once. If an admin already corrected it by hand, leave it.'
                : 'These snowball games finished but their pots never moved, so the jackpot still shows the old figure. Settle each one once. If an admin already corrected one by hand, leave it.'}
            </p>
          </div>
          <ul className="flex flex-col gap-3">
            {visibleUnsettledGames.map((g) => (
              <li key={g.gameId} className="flex flex-col gap-2 border-t border-line pt-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <p className="text-base font-semibold leading-tight">Game {g.gameIndex} · {g.gameName}</p>
                    <p className="text-[13px] leading-snug text-anchor-sage">
                      {g.sessionName}{g.sessionStartDate ? `, ${formatDateInLondon(g.sessionStartDate)}` : ''}
                    </p>
                  </div>
                  <Button
                    variant="primary"
                    size="sm"
                    className="shrink-0 px-5"
                    onClick={() => { void handleSettleGame(g.gameId); }}
                    disabled={settlingGameId !== null}
                  >
                    {settlingGameId === g.gameId ? 'Settling…' : 'Settle'}
                  </Button>
                </div>
                {settleError?.gameId === g.gameId && (
                  <p role="alert" className="text-sm leading-snug text-anchor-danger-text">{settleError.message}</p>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="flex flex-col gap-1">
        <Kicker>Tonight and upcoming</Kicker>
        <h2 className="text-[28px] leading-[1.05] text-anchor-cream-text">Sessions</h2>
      </div>

      {sessions.length === 0 ? (
        <Card className="flex flex-col gap-1.5 px-5 py-8 text-center">
          <p className="text-base text-anchor-cream-text">No sessions available.</p>
          <p className="text-sm leading-normal text-anchor-sage">Please check the Admin page to create or activate sessions.</p>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {sessions.map((session) => {
            // Sort games by index
            const sortedGames = [...session.games].sort((a, b) => a.game_index - b.game_index);
            
            // Find the first game that is NOT completed. This is our active or next game.
            // If all are completed, this will be undefined.
            const activeOrNextGame = sortedGames.find(g => g.game_states?.status !== 'completed');
            // X10: while one game is being played, no other game of the night can
            // be started or re-opened. start_game refuses it under the session
            // lock; hiding the button means the host is not offered it at all.
            const gameInProgress = sortedGames.find(g => g.game_states?.status === 'in_progress');

            return (
              <Card
                key={session.id}
                // The open session carries the gold top rule.
                accent={expandedSessionId === session.id}
                className="overflow-hidden"
              >
                <div
                  onClick={() => toggleSession(session.id)}
                  className="flex min-h-11 cursor-pointer items-center justify-between gap-3 p-4"
                >
                  <div className="flex min-w-0 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-[22px] leading-[1.05] text-anchor-cream-text">{session.name}</h3>
                      {session.is_test_session && (
                        <Badge variant="outline">Test</Badge>
                      )}
                    </div>
                    <p className="text-sm text-anchor-sage">
                      {[
                        formatDateInLondon(session.start_date),
                        `${sortedGames.length} ${sortedGames.length === 1 ? 'game' : 'games'}`,
                      ].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2.5">
                    {session.status === 'running' && (
                      <Badge variant="success" dot>Running</Badge>
                    )}
                    {session.status === 'ready' && (
                      <Badge variant="outline">Ready</Badge>
                    )}
                    <ChevronDown
                      aria-hidden="true"
                      size={20}
                      strokeWidth={2}
                      className={cn(
                        "text-anchor-sage transition-transform duration-200 ease-anchor",
                        expandedSessionId === session.id ? "rotate-180" : ""
                      )}
                    />
                  </div>
                </div>

                {expandedSessionId === session.id && (
                  <div className="flex animate-fade-in flex-col gap-2 border-t border-line-gold bg-anchor-green-raised px-4 pb-4 pt-3">
                    {sortedGames.length === 0 ? (
                      <p className="py-4 text-center text-sm text-anchor-sage">No games configured for this session.</p>
                    ) : (
                      <div className="flex flex-col gap-2">
                        {sortedGames.map((game) => {
                          const status = game.game_states?.status || 'not_started';
                          const isCompleted = status === 'completed';
                          const isInProgress = status === 'in_progress';
                          
                          const isBlockedByOtherGame = !!gameInProgress && gameInProgress.id !== game.id;
                          const isPlayable = (activeOrNextGame?.id === game.id || isCompleted) && !isBlockedByOtherGame;
                          const isStartingThis = startingGameId === game.id;
                          const gameStartError = startError?.gameId === game.id ? startError.message : null;
                          
                          // It is locked if it is NOT playable (which means it's a future game)
                          const isLocked = !isPlayable;

                          return (
                            <div
                              key={game.id}
                              className={cn(
                                "flex flex-col gap-2 rounded-card border px-3 py-2.5 transition-colors duration-200 ease-anchor",
                                isInProgress ? "border-anchor-gold-bright bg-anchor-gold-bright/[0.08]" :
                                isCompleted ? "border-line bg-anchor-green-card" :
                                isLocked ? "border-line bg-anchor-green-card opacity-50" :
                                "border-line bg-anchor-green-card"
                              )}
                            >
                              <div className="flex items-center justify-between gap-2.5">
                                <div className="flex min-w-0 items-center gap-3">
                                  {/* The number disc: gold for the game to play
                                      next (or the one being played), green for
                                      a finished game, a hairline for the rest. */}
                                  <span className={cn(
                                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-full font-display text-xl leading-none",
                                    isCompleted
                                      ? "bg-anchor-green text-white"
                                      : isPlayable
                                        ? "bg-anchor-gold-bright text-anchor-charcoal"
                                        : "border border-line-strong text-anchor-cream-text"
                                  )}>
                                    {game.game_index}
                                  </span>
                                  <div className="flex min-w-0 flex-col gap-0.5">
                                    <p className="text-base font-semibold leading-tight text-anchor-cream-text">
                                      {game.name}
                                    </p>
                                    <p className={cn(
                                      "text-[11px] font-semibold uppercase leading-snug tracking-[0.08em]",
                                      isInProgress ? "text-anchor-gold-bright" :
                                      isCompleted ? "text-anchor-success-text" :
                                      "text-anchor-sage"
                                    )}>
                                      {game.type}
                                      {status === 'not_started' && ' · Not started'}
                                      {status === 'in_progress' && ' · In progress'}
                                      {status === 'completed' && ' · Completed'}
                                    </p>
                                  </div>
                                </div>

                                {isPlayable ? (
                                  <Button
                                    size="sm"
                                    // Resume and Start are the row's call to
                                    // action. Re-open is the quieter one: it asks
                                    // first, and re-opens a finished game.
                                    variant={isCompleted ? "outline" : "primary"}
                                    className="shrink-0 px-4"
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
                                    tone="quiet"
                                    disabled
                                    // A locked row is already faded to half; the
                                    // button's own fade on top would make the
                                    // label unreadable.
                                    className={cn("shrink-0 px-4", !isInProgress && !isCompleted && "disabled:opacity-100")}
                                  >
                                    {isBlockedByOtherGame && isCompleted ? 'Finished' : 'Locked'}
                                  </Button>
                                )}
                              </div>
                              {gameStartError && (
                                <p role="alert" className="text-sm leading-snug text-anchor-danger-text">
                                  {gameStartError}
                                </p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* End the night (spec 5.1). Once a night is running, this is
                        how it finishes when games are left unplayed: finishing
                        the last game only completes the night when every game
                        has been played. */}
                    {session.status === 'running' && (
                      <div className="mt-2 flex items-center justify-between gap-3 border-t border-line pt-3">
                        <p className="text-[13px] leading-[1.4] text-anchor-sage">
                          {gameInProgress
                            ? `Finish Game ${gameInProgress.game_index} before ending the night.`
                            : 'Finished for tonight? End the night so the TV shows the end-of-night screen.'}
                        </p>
                        <Button
                          variant="outline"
                          size="sm"
                          className="shrink-0 px-4"
                          onClick={() => openEndNight(session)}
                          disabled={!!gameInProgress || startingGameId !== null}
                        >
                          End the night
                        </Button>
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
        kicker={reopenTarget?.gameName}
        className="max-w-md"
      >
        <div className="flex flex-col gap-4">
          <p>
            <strong className="font-semibold">{reopenTarget?.gameName}</strong> has finished.
            Re-opening it resumes calling so you can correct a mistake.
          </p>
        </div>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button variant="ghost" size="sm" className="px-4" onClick={() => setReopenTarget(null)}>
            Keep it finished
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => { void handleConfirmReopen(); }}
            disabled={startingGameId !== null}
          >
            Re-open
          </Button>
        </div>
      </Modal>

      <Modal
        isOpen={!!endNightTarget}
        onClose={closeEndNight}
        title="End the night?"
        kicker={endNightTarget?.sessionName}
        className="max-w-md"
      >
        <div className="flex flex-col gap-4">
          {endNightError && (
            <div role="alert" className="text-sm leading-snug text-anchor-danger-text">
              {endNightError}
            </div>
          )}
          <p>
            <strong className="font-semibold">{endNightTarget?.sessionName}</strong> will be marked as
            finished. The TV and the phones move to the end-of-night screen.
          </p>
          {endNightTarget && endNightTarget.unplayedGames.length > 0 ? (
            <div className="flex flex-col gap-2">
              <p className="font-semibold">These games have not been played and will stay unplayed:</p>
              <ul className="list-disc pl-5">
                {endNightTarget.unplayedGames.map((name) => (
                  <li key={name}>{name}</li>
                ))}
              </ul>
              <p className="text-anchor-sage">A snowball pot on an unplayed game does not move.</p>
            </div>
          ) : (
            <p className="text-anchor-sage">Every game has been played.</p>
          )}
          <p className="text-sm text-anchor-sage">Only an admin can open the night again once it has ended.</p>
        </div>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button variant="ghost" size="sm" className="px-4" onClick={closeEndNight} disabled={isEndingNight}>
            Keep the night open
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => { void handleConfirmEndNight(); }}
            disabled={isEndingNight}
          >
            {isEndingNight ? 'Ending…' : 'End the night'}
          </Button>
        </div>
      </Modal>

      <Modal
        isOpen={!!cashJackpotPrompt}
        onClose={closeCashJackpotPrompt}
        title="Set cash jackpot"
        kicker={cashJackpotPrompt?.gameName}
        className="max-w-md"
      >
        <div className="flex flex-col gap-4">
          {cashJackpotError && (
            <div role="alert" className="text-sm leading-snug text-anchor-danger-text">
              {cashJackpotError}
            </div>
          )}
          <p>
            Enter tonight&apos;s cash jackpot for <strong className="font-semibold">{cashJackpotPrompt?.gameName}</strong>. This will be shown as the game prize.
          </p>
          <label className="flex flex-col gap-1.5">
            <span className={fieldLabelClass}>Cash jackpot amount</span>
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
          </label>
        </div>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="px-4"
            onClick={closeCashJackpotPrompt}
            disabled={isSubmittingCashJackpot}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
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
            {isSubmittingCashJackpot ? 'Starting...' : 'Set amount and start'}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
