"use client";

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { Database, GameType, WinStage, GameStatus } from '@/types/database';
import { createGame, deleteGame, duplicateGame, updateSessionStatus, updateGame, resetSession, voidWinner } from './actions';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Kicker } from '@/components/ui/kicker';
import { Modal } from '@/components/ui/modal';
import { Input, fieldClass, fieldLabelClass } from '@/components/ui/input';
import { useRouter } from 'next/navigation';
import { validateGamePrizes } from '@/lib/prize-validation';
import { formatDateInLondon, formatDateTimeInLondon } from '@/lib/dates';
import { describeWinnerTotal, formatPence, formatPoundsAmount, totalPaidOutPence, winnerTotalPence } from '@/lib/money';
import { getColourName } from '@/lib/colour-name';
import { cn } from '@/lib/utils';

type Session = Database['public']['Tables']['sessions']['Row'];
type GameState = Database['public']['Tables']['game_states']['Row'];
type Game = Database['public']['Tables']['games']['Row'] & {
  game_states?: GameState | GameState[] | null;
};
type SnowballPot = Pick<Database['public']['Tables']['snowball_pots']['Row'], 'id' | 'name' | 'current_jackpot_amount' | 'current_max_calls'>;
type WinnerWithGame = Database['public']['Tables']['winners']['Row'] & {
  game: Pick<Database['public']['Tables']['games']['Row'], 'name' | 'game_index'> | null;
};

interface SessionDetailProps {
  session: Session;
  initialGames: Game[];
  snowballPots: SnowballPot[];
  winners: WinnerWithGame[];
}

/** Read the `game_states.status` off a game row, regardless of join shape. */
function readGameStatus(game: Game): GameStatus | null {
  const gs = game.game_states;
  if (!gs) return null;
  if (Array.isArray(gs)) return gs[0]?.status ?? null;
  return gs.status;
}

const STANDARD_STAGES: WinStage[] = ['Line', 'Two Lines', 'Full House'];

// The admin table (design handoff, section 6): small sage column heads over a
// gold hairline, 15px cream cells, a hairline between rows and a faint gold
// wash on hover. A voided winner's row is dimmed instead.
const TH = "whitespace-nowrap border-b border-line-gold px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-[0.1em] text-anchor-sage";
const TD = "px-5 py-4 align-middle text-[15px]";
const ROW_BASE = "border-b border-line transition-colors duration-150 last:border-b-0";
const ROW = `${ROW_BASE} hover:bg-anchor-gold-bright/[0.05]`;
const ROW_VOID = `${ROW_BASE} opacity-[0.55]`;

// Form and dialog pieces shared by the modals below.
const LABEL = cn(fieldLabelClass, "mb-1.5 block");
const ERROR_PANEL = "rounded-card border border-anchor-danger bg-anchor-danger/[0.12] px-4 py-3 text-sm text-anchor-danger-text";
const NOTE_PANEL = "rounded-card border border-line-gold bg-anchor-green-raised px-4 py-3 text-sm text-anchor-gold-bright";
const LOCKED_NOTE = "mt-1.5 text-[13px] text-anchor-gold-bright";
const CHECKBOX = "h-5 w-5 shrink-0 accent-anchor-gold-bright";
const STAT_CARD = "flex flex-col gap-1.5 px-5 py-[18px]";
const STAT_VALUE = "font-display text-[34px] leading-none";
const STAT_HINT = "text-[13px] text-anchor-sage";

const SESSION_STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  ready: 'Ready',
  running: 'Running',
  completed: 'Completed',
};

export default function SessionDetail({ session, initialGames, snowballPots, winners }: SessionDetailProps) {
  const [games, setGames] = useState<Game[]>(initialGames);
  const [showGameModal, setShowGameModal] = useState(false);
  const [editingGame, setEditingGame] = useState<Game | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [backgroundColor, setBackgroundColor] = useState<string>('#ffffff');

  // Form state
  const [selectedGameType, setSelectedGameType] = useState<GameType>('standard');
  const [selectedStages, setSelectedStages] = useState<WinStage[]>(['Line', 'Two Lines', 'Full House']);
  const [prizeDraft, setPrizeDraft] = useState<Partial<Record<WinStage, string>>>({});
  const [missingPrizeStages, setMissingPrizeStages] = useState<WinStage[]>([]);

  // Typed-confirm delete-game modal state
  const [deleteGameTarget, setDeleteGameTarget] = useState<Game | null>(null);
  const [deleteGameTyped, setDeleteGameTyped] = useState('');
  const [isDeletingGame, setIsDeletingGame] = useState(false);
  const [deleteGameError, setDeleteGameError] = useState<string | null>(null);

  // Void-a-winner modal state. voidWinner has been exported from ./actions and
  // called by nothing at all, so an admin reviewing a finished night had no way
  // to void a wrongly recorded win: the only route was the live host screen,
  // during the game, which is exactly when nobody is reviewing anything.
  const [voidTarget, setVoidTarget] = useState<WinnerWithGame | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [isVoiding, setIsVoiding] = useState(false);
  const [voidError, setVoidError] = useState<string | null>(null);

  // Typed-confirm reset-session modal state
  const [showResetModal, setShowResetModal] = useState(false);
  const [resetTyped, setResetTyped] = useState('');
  const [isResetting, setIsResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  const router = useRouter();

  // Excludes voided wins, and sums each winner's share rather than the whole
  // prize, so a tie is counted once. A share is the ordinary share plus the
  // snowball jackpot share (X22).
  const sessionPayout = useMemo(
    () => totalPaidOutPence(winners.filter((w) => w.is_void !== true)),
    [winners]
  );

  useEffect(() => {
    setGames(initialGames);
  }, [initialGames]);

  useEffect(() => {
    setBackgroundColor(editingGame?.background_colour || '#ffffff');
  }, [editingGame]);

  const nextIndex = games.length > 0 ? Math.max(...games.map(g => g.game_index)) + 1 : 1;

  // Per-game lock: a game is locked once it has started (in_progress) or
  // completed. Prize/structural fields cannot be edited; deletion is blocked.
  const editingGameStatus = editingGame ? readGameStatus(editingGame) : null;
  const isGameLocked =
    editingGameStatus === 'in_progress' || editingGameStatus === 'completed';

  // Stages that need a prize for the current draft. Reused for inline validation.
  const requiredStages: WinStage[] = useMemo(() => {
    if (selectedGameType === 'jackpot') return [];
    if (selectedGameType === 'snowball') return ['Full House'];
    return selectedStages;
  }, [selectedGameType, selectedStages]);

  const handleClose = () => {
    setShowGameModal(false);
    setEditingGame(null);
    setActionError(null);
    setSelectedGameType('standard');
    setSelectedStages(['Line', 'Two Lines', 'Full House']);
    setBackgroundColor('#ffffff');
    setPrizeDraft({});
    setMissingPrizeStages([]);
  };

  const handleShowAdd = () => {
    setEditingGame(null);
    setSelectedGameType('standard');
    setSelectedStages(['Line', 'Two Lines', 'Full House']);
    setBackgroundColor('#ffffff');
    setPrizeDraft({});
    setMissingPrizeStages([]);
    setShowGameModal(true);
  };

  const handleShowEdit = (game: Game) => {
    setEditingGame(game);
    setSelectedGameType(game.type);
    setSelectedStages(game.stage_sequence);
    setBackgroundColor(game.background_colour || '#ffffff');
    const initialPrizes: Partial<Record<WinStage, string>> = {};
    game.stage_sequence.forEach((stage) => {
      const value = game.prizes?.[stage];
      if (typeof value === 'string') initialPrizes[stage] = value;
    });
    setPrizeDraft(initialPrizes);
    setMissingPrizeStages([]);
    setShowGameModal(true);
  };

  const handleStageChange = (stage: WinStage) => {
    setSelectedStages((prev) =>
      prev.includes(stage) ? prev.filter((s) => s !== stage) : [...prev, stage]
    );
    // Clear any stale prize-missing badge for the toggled stage.
    setMissingPrizeStages((prev) => prev.filter((s) => s !== stage));
  };

  const handlePrizeChange = (stage: WinStage, value: string) => {
    setPrizeDraft((prev) => ({ ...prev, [stage]: value }));
    if (value.trim().length > 0) {
      setMissingPrizeStages((prev) => prev.filter((s) => s !== stage));
    }
  };

  async function handleGameSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    // Inline prize validation. Mirrors the server-side check and surfaces
    // missing stages on the form so the user does not have to round-trip.
    const validation = validateGamePrizes({
      type: selectedGameType,
      stage_sequence: selectedStages,
      prizes: prizeDraft,
    });
    if (!validation.valid) {
      setMissingPrizeStages(validation.missingStages);
      setActionError(`Prize required for ${validation.missingStages.join(', ')}.`);
      return;
    }
    setMissingPrizeStages([]);

    setIsSubmitting(true);
    setActionError(null);

    const formData = new FormData(event.currentTarget);

    let result;
    if (editingGame) {
      result = await updateGame(editingGame.id, session.id, null, formData);
    } else {
      result = await createGame(session.id, null, formData);
    }

    setIsSubmitting(false);

    if (!result?.success) {
      setActionError(result?.error || "Failed to save game.");
    } else {
      handleClose();
      router.refresh();
    }
  }

  async function handleConfirmVoidWinner() {
    if (!voidTarget || isVoiding) return;
    const reason = voidReason.trim();
    if (reason.length === 0) {
      setVoidError('Give a reason before voiding this winner.');
      return;
    }
    setIsVoiding(true);
    setVoidError(null);
    try {
      const result = await voidWinner(voidTarget.id, reason);
      if (!result?.success) {
        setVoidError(result?.error || 'Failed to void that winner.');
        return;
      }
      setVoidTarget(null);
      setVoidReason('');
      router.refresh();
    } catch {
      setVoidError('Could not reach the server. Check the connection and try again.');
    } finally {
      setIsVoiding(false);
    }
  }

  function handleShowDeleteGame(game: Game) {
    setDeleteGameTarget(game);
    setDeleteGameTyped('');
    setDeleteGameError(null);
  }

  function handleCloseDeleteGame() {
    setDeleteGameTarget(null);
    setDeleteGameTyped('');
    setDeleteGameError(null);
    setIsDeletingGame(false);
  }

  async function handleConfirmDeleteGame() {
    if (!deleteGameTarget) return;
    setIsDeletingGame(true);
    setDeleteGameError(null);
    const result = await deleteGame(deleteGameTarget.id, session.id);
    setIsDeletingGame(false);
    if (!result?.success) {
      setDeleteGameError(result?.error || "Failed to delete game.");
      return;
    }
    handleCloseDeleteGame();
    router.refresh();
  }

  async function handleDuplicateGame(gameId: string) {
    setActionError(null);
    const result = await duplicateGame(gameId, session.id);
    if (!result?.success) {
      setActionError(result?.error || "Failed to clone game.");
      return;
    }
    router.refresh();
  }

  async function handleMarkAsReady() {
    if (confirm("Mark this session as Ready? It will be visible to hosts.")) {
      setActionError(null);
      const result = await updateSessionStatus(session.id, 'ready');
      if (!result?.success) {
        setActionError(result?.error || "Failed to update session status.");
        return;
      }
      router.refresh();
    }
  }

  async function handleStartSession() {
    if (confirm("Ready to start this session? This will open it for the Host.")) {
      setActionError(null);
      const result = await updateSessionStatus(session.id, 'running');
      if (!result?.success) {
        setActionError(result?.error || "Failed to start session.");
        return;
      }
      router.refresh();
    }
  }

  function handleShowReset() {
    setShowResetModal(true);
    setResetTyped('');
    setResetError(null);
  }

  function handleCloseReset() {
    setShowResetModal(false);
    setResetTyped('');
    setResetError(null);
    setIsResetting(false);
  }

  async function handleConfirmReset() {
    setIsResetting(true);
    setResetError(null);
    const result = await resetSession(session.id, resetTyped);
    setIsResetting(false);
    if (!result?.success) {
      setResetError(result?.error || "Failed to reset session.");
      return;
    }
    handleCloseReset();
    router.refresh();
  }

  const isSessionLocked = session.status === 'running' || session.status === 'completed';

  const isDeleteGameConfirmed =
    deleteGameTarget !== null && deleteGameTyped === deleteGameTarget.name;

  const isResetConfirmed = resetTyped === 'RESET' || resetTyped === session.name;

  // Read-only figures for the stat cards, worked out from the props already
  // on the page. Nothing here is stored or sent anywhere.
  const completedGamesCount = games.filter((g) => readGameStatus(g) === 'completed').length;
  const gameInProgress = games.find((g) => readGameStatus(g) === 'in_progress') ?? null;
  const liveWinners = winners.filter((w) => w.is_void !== true);
  const outstandingPrizeCount = liveWinners.filter((w) => !w.prize_given).length;
  const voidedWinnerCount = winners.length - liveWinners.length;
  const snowballGame = games.find((g) => g.type === 'snowball') ?? null;
  const snowballPot = snowballGame
    ? snowballPots.find((p) => p.id === snowballGame.snowball_pot_id) ?? null
    : null;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          <Link
            href="/admin"
            className="inline-flex items-center gap-1.5 self-start text-sm font-semibold text-anchor-gold-bright transition-colors duration-150 hover:text-anchor-cream-text"
          >
            <ChevronLeft aria-hidden="true" size={16} strokeWidth={2} />
            All sessions
          </Link>
          <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2">
            <h1 className="text-[44px] leading-none text-anchor-cream-text">{session.name}</h1>
            {session.status === 'running' ? (
              <Badge variant="success" dot className="text-[13px]">Running</Badge>
            ) : (
              <Badge variant="outline" className="text-[13px]">
                {SESSION_STATUS_LABELS[session.status] ?? session.status}
              </Badge>
            )}
            {session.is_test_session && <Badge variant="outline" className="text-[13px]">Test</Badge>}
          </div>
          <p className="text-base text-anchor-sage">
            {formatDateInLondon(session.start_date)} · {games.length} {games.length === 1 ? 'game' : 'games'}
            {session.notes ? ` · ${session.notes}` : ''}
          </p>
        </div>

        <div className="flex flex-col items-start gap-2 sm:items-end">
          <div className="flex flex-wrap gap-2">
            {session.status === 'draft' && (
              <Button variant="outline" size="md" onClick={handleMarkAsReady}>
                Mark as ready
              </Button>
            )}
            {isSessionLocked && (
              <Button variant="outline" size="md" onClick={handleShowReset}>
                Reset to ready
              </Button>
            )}
            <Button
              variant="primary"
              size="md"
              disabled={isSessionLocked || session.status === 'draft'}
              onClick={handleStartSession}
            >
              Start session
            </Button>
          </div>
          <p className={STAT_HINT}>
            {session.status === 'running' && 'Session is live.'}
            {session.status === 'ready' && 'Session is ready for hosts.'}
            {session.status === 'draft' && 'Draft mode.'}
            {session.status === 'completed' && 'Session completed.'}
          </p>
        </div>
      </div>

      {actionError && !showGameModal && (
        <div className={ERROR_PANEL}>
          {actionError}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className={STAT_CARD}>
          <Kicker className="text-[11px]">Games played</Kicker>
          <span className={STAT_VALUE}>{completedGamesCount} of {games.length}</span>
          <span className={STAT_HINT}>
            {gameInProgress ? `${gameInProgress.name} now calling` : 'No game in progress'}
          </span>
        </Card>

        <Card className={STAT_CARD}>
          <Kicker className="text-[11px]">Winners</Kicker>
          <span className={STAT_VALUE}>{liveWinners.length}</span>
          <span className={STAT_HINT}>
            {liveWinners.length === 0
              ? 'None recorded yet'
              : outstandingPrizeCount === 0
                ? 'All prizes given'
                : `${outstandingPrizeCount} outstanding`}
            {voidedWinnerCount > 0 && `, ${voidedWinnerCount} voided`}
          </span>
        </Card>

        {/* Sums the shares, never the amounts: on a tied stage the amount is
            the whole prize and sits on every tied row, so totalling it would
            count one £10 prize as £20. Voided wins are excluded. */}
        <Card className={STAT_CARD}>
          <Kicker className="text-[11px]">Paid out</Kicker>
          <span className={cn(STAT_VALUE, "text-anchor-gold-bright")}>
            {formatPence(sessionPayout.totalPence)}
          </span>
          <span className={STAT_HINT}>Voided wins are not counted</span>
          {sessionPayout.uncountedRows > 0 && (
            <span className={STAT_HINT}>
              plus {sessionPayout.uncountedRows} non-cash
            </span>
          )}
          {sessionPayout.jackpotNotRecordedRows > 0 && (
            <span className={STAT_HINT}>
              {sessionPayout.jackpotNotRecordedRows === 1
                ? '1 jackpot amount not recorded, so not in this total'
                : `${sessionPayout.jackpotNotRecordedRows} jackpot amounts not recorded, so not in this total`}
            </span>
          )}
        </Card>

        {/* The pot as it stands now, read from the live pot row. On a finished
            night that is no longer the figure that was played for, so the hint
            says so rather than implying it. */}
        <Card className={STAT_CARD}>
          <Kicker className="text-[11px]">Snowball</Kicker>
          {snowballGame === null ? (
            <>
              <span className={STAT_VALUE}>None</span>
              <span className={STAT_HINT}>No snowball game in this session</span>
            </>
          ) : snowballPot === null ? (
            <>
              <span className={STAT_VALUE}>Not shown</span>
              <span className={STAT_HINT}>
                Game {snowballGame.game_index} · its pot is not in the live list
              </span>
            </>
          ) : (
            <>
              <span className={cn(STAT_VALUE, "text-anchor-gold-bright")}>
                {formatPoundsAmount(Number(snowballPot.current_jackpot_amount))}
              </span>
              <span className={STAT_HINT}>
                {session.status === 'completed'
                  ? `Game ${snowballGame.game_index} · the pot as it stands now`
                  : `Game ${snowballGame.game_index} · within ${snowballPot.current_max_calls} calls`}
              </span>
            </>
          )}
        </Card>
      </div>

      <Card accent className="overflow-hidden">
        <div className="flex items-center justify-between gap-4 border-b border-line-gold px-5 py-[18px]">
          <h2 className="text-[26px] leading-none text-anchor-cream-text">Games</h2>
          <Button variant="outline" size="sm" onClick={handleShowAdd} disabled={isSessionLocked}>
            Add game
          </Button>
        </div>
        {games.length === 0 ? (
          <div className="flex flex-col items-start gap-4 px-5 py-8">
            <p className="text-[15px] text-anchor-sage">No games configured for this session yet.</p>
            <Button variant="outline" size="sm" onClick={handleShowAdd} disabled={isSessionLocked}>Add your first game</Button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] border-collapse text-left">
              <thead>
                <tr>
                  <th className={cn(TH, "w-16")}>#</th>
                  <th className={TH}>Game</th>
                  <th className={TH}>Type</th>
                  <th className={TH}>Book</th>
                  <th className={TH}>Prizes</th>
                  <th className={TH}>Status</th>
                  <th className={cn(TH, "text-right")}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {games.map((game) => {
                  const status = readGameStatus(game);
                  const gameLocked = status === 'in_progress' || status === 'completed';
                  const deleteDisabled = gameLocked;
                  const deleteTitle = gameLocked
                    ? `Cannot delete a ${status} game`
                    : undefined;
                  return (
                    <tr key={game.id} className={ROW}>
                      <td className={TD}>
                        <span className="font-display text-[22px] leading-none text-anchor-gold-bright">{game.game_index}</span>
                      </td>
                      <td className={TD}>
                          <div className="text-base font-semibold">{game.name}</div>
                          {game.notes && <div className="text-[13px] text-anchor-sage">{game.notes}</div>}
                      </td>
                      <td className={TD}>
                          {game.type === 'snowball' ? (
                              <Badge variant="gold">Snowball</Badge>
                          ) : game.type === 'jackpot' ? (
                              <Badge variant="gold">Jackpot</Badge>
                          ) : (
                              <Badge variant="outline">Standard</Badge>
                          )}
                      </td>
                      <td className={TD}>
                          {/* The book colour is the one data colour on the page. */}
                          <span className="inline-flex items-center gap-2 whitespace-nowrap">
                            <span
                                className="inline-block h-[18px] w-[18px] shrink-0 rounded-full border border-anchor-cream-text"
                                style={{ backgroundColor: game.background_colour }}
                                title={game.background_colour}
                            />
                            {getColourName(game.background_colour)}
                          </span>
                      </td>
                      <td className={TD}>
                        <div className="flex flex-wrap gap-x-3.5 gap-y-2">
                          {game.stage_sequence.map((stage) => {
                            const prize = game.prizes?.[stage]?.trim();
                            return (
                              <span key={stage} className="inline-flex flex-col gap-px">
                                <span className="whitespace-nowrap text-[11px] font-semibold uppercase tracking-[0.1em] text-anchor-sage">{stage}</span>
                                <span
                                  className={
                                    prize
                                      ? 'whitespace-nowrap font-display text-lg leading-tight text-anchor-gold-bright'
                                      : game.type === 'jackpot'
                                        ? 'whitespace-nowrap text-sm text-anchor-sage'
                                        : 'whitespace-nowrap text-sm text-anchor-danger-text'
                                  }
                                >
                                  {prize || (game.type === 'jackpot' ? 'Set at start' : 'Not set')}
                                </span>
                              </span>
                            );
                          })}
                        </div>
                      </td>
                      <td className={TD}>
                        {status === 'in_progress' ? (
                          <Badge variant="success">In progress</Badge>
                        ) : (
                          <Badge variant="outline">{status === 'completed' ? 'Completed' : 'Not started'}</Badge>
                        )}
                      </td>
                      <td className={cn(TD, "text-right")}>
                        <div className="inline-flex items-center gap-1">
                          <Button variant="ghost" size="sm" className="px-3" onClick={() => handleDuplicateGame(game.id)}>Clone</Button>
                          <Button variant="ghost" size="sm" className="px-3" onClick={() => handleShowEdit(game)}>Edit</Button>
                          <Button variant="ghost" tone="quiet" size="sm" className="px-3" onClick={() => handleShowDeleteGame(game)} disabled={deleteDisabled} title={deleteTitle}>Delete</Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-line-gold px-5 py-[18px]">
          <h2 className="text-[26px] leading-none text-anchor-cream-text">Winners</h2>
          <span className="text-sm text-anchor-sage">Winners are recorded anonymously</span>
        </div>
        {winners.length === 0 ? (
          <p className="px-5 py-8 text-[15px] text-anchor-sage">No winners recorded for this session yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] border-collapse text-left">
              <thead>
                <tr>
                  <th className={TH}>Time</th>
                  <th className={TH}>Game</th>
                  <th className={TH}>Stage</th>
                  <th className={TH}>Prize</th>
                  <th className={TH}>Paid</th>
                  <th className={cn(TH, "text-right")}>Status</th>
                </tr>
              </thead>
              <tbody>
                {winners.map((winner) => (
                  <tr key={winner.id} className={winner.is_void ? ROW_VOID : ROW}>
                    <td className={cn(TD, "whitespace-nowrap text-anchor-sage")}>
                      {formatDateTimeInLondon(winner.created_at)}
                    </td>
                    <td className={cn(TD, "font-semibold")}>
                      {winner.game ? `Game ${winner.game.game_index} · ${winner.game.name}` : 'Unknown game'}
                    </td>
                    <td className={TD}>
                      <Badge variant="outline">{winner.stage}</Badge>
                    </td>
                    <td className={TD}>
                      <span className={cn(winner.is_void && "line-through")}>
                        {winner.prize_description || '-'}
                      </span>
                      {winner.is_snowball_jackpot && (
                        <Badge variant="gold" className="ml-2">Jackpot</Badge>
                      )}
                    </td>
                    <td className={cn(TD, "whitespace-nowrap")}>
                      {(() => {
                        // X22: the ordinary share plus the jackpot share, or
                        // "jackpot amount not recorded" where it is unknown.
                        const total = winnerTotalPence(winner);
                        const totalLine = describeWinnerTotal(total);
                        if (totalLine === null) {
                          return <span className="text-anchor-sage">{winner.is_void ? '-' : 'Not cash'}</span>;
                        }
                        const showShareOf = winner.prize_amount_pence !== null
                          && winner.prize_share_pence !== null
                          && winner.prize_amount_pence !== winner.prize_share_pence;
                        return (
                          <>
                            <span
                              className={
                                total.totalPence !== null && !total.jackpotNotRecorded
                                  ? 'font-display text-xl leading-tight text-anchor-gold-bright'
                                  : 'text-sm'
                              }
                            >
                              {totalLine}
                            </span>
                            {showShareOf && (
                              <span className="block text-[13px] text-anchor-sage">
                                prize share of {formatPence(winner.prize_amount_pence)}
                              </span>
                            )}
                          </>
                        );
                      })()}
                    </td>
                    <td className={cn(TD, "text-right")}>
                      {winner.is_void ? (
                        <div className="inline-flex flex-col items-end gap-1">
                          <Badge variant="danger">Void</Badge>
                          {winner.void_reason && (
                            <span className="max-w-[14rem] text-right text-[13px]">{winner.void_reason}</span>
                          )}
                        </div>
                      ) : (
                        <div className="inline-flex items-center gap-2">
                          {winner.prize_given ? (
                            <Badge variant="success">Given</Badge>
                          ) : (
                            <Badge variant="gold">Outstanding</Badge>
                          )}
                          <Button
                            variant="ghost"
                            tone="quiet"
                            size="sm"
                            className="px-3"
                            onClick={() => { setVoidTarget(winner); setVoidReason(''); setVoidError(null); }}
                          >
                            Void
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Add/Edit Game Modal */}
      <Modal
        isOpen={showGameModal}
        onClose={handleClose}
        title={editingGame ? 'Edit game' : 'Add game'}
        className="max-w-2xl"
      >
        <form key={editingGame?.id || 'new-game'} onSubmit={handleGameSubmit} className="flex flex-col gap-4">
            {actionError && <div className={ERROR_PANEL}>{actionError}</div>}

            {isGameLocked && (
              <div className={NOTE_PANEL}>
                This game has already started. Prize, type, snowball pot, and stage configuration are locked.
              </div>
            )}

            <div className="flex gap-4">
                <div className="w-1/4">
                    <label className={LABEL}>Order</label>
                    <Input
                        type="number"
                        name="game_index"
                        defaultValue={editingGame ? editingGame.game_index : nextIndex}
                        required
                    />
                </div>
                <div className="w-3/4">
                    <label className={LABEL}>Game name</label>
                    <Input
                        type="text"
                        name="name"
                        defaultValue={editingGame?.name}
                        placeholder="e.g. Game 1 - The Warm Up"
                        required
                        autoFocus
                    />
                </div>
            </div>

            {/* Structural fields (type, stages, snowball pot, prizes) are
                locked once the game has started. We render them inside a
                fieldset so the entire group is disabled in one place. Each
                field dims itself when disabled. */}
            <fieldset disabled={isGameLocked} aria-disabled={isGameLocked} className="flex min-w-0 flex-col gap-4">

              <div>
                <label className={LABEL}>Game type</label>
                <select
                  name="type"
                  value={selectedGameType}
                  onChange={(e) => {
                      const newType = e.target.value as GameType;
                      setSelectedGameType(newType);
                      if (newType === 'snowball' || newType === 'jackpot') {
                          setSelectedStages(['Full House']);
                      } else {
                           if (editingGame && editingGame.type === 'standard') {
                               setSelectedStages(editingGame.stage_sequence);
                           } else {
                               setSelectedStages(['Line', 'Two Lines', 'Full House']);
                           }
                      }
                      setMissingPrizeStages([]);
                  }}
                  className={fieldClass}
                >
                    <option value="standard">Standard game</option>
                    <option value="jackpot">Jackpot game</option>
                    <option value="snowball">Snowball game</option>
                </select>
                {isGameLocked && (
                  <p className={LOCKED_NOTE}>Locked: game already started</p>
                )}
              </div>

              {selectedGameType === 'standard' && (
                  <div>
                      <label className={LABEL}>Stages (winners)</label>
                      <div className="flex flex-wrap gap-x-5 gap-y-1 rounded-card border border-line bg-anchor-green-raised px-4 py-1.5">
                          {STANDARD_STAGES.map(stage => (
                              <label key={stage} className="flex min-h-11 cursor-pointer items-center gap-2.5">
                                  <input
                                      type="checkbox"
                                      name="stages"
                                      value={stage}
                                      checked={selectedStages.includes(stage)}
                                      onChange={() => handleStageChange(stage)}
                                      className={CHECKBOX}
                                  />
                                  <span className="text-[15px]">{stage}</span>
                              </label>
                          ))}
                      </div>
                      {selectedStages.length === 0 && <p className="mt-1.5 text-sm text-anchor-danger-text">Select at least one stage.</p>}
                      {isGameLocked && (
                        <p className={LOCKED_NOTE}>Locked: game already started</p>
                      )}
                  </div>
              )}

              {selectedGameType === 'snowball' && (
                  <div className="flex flex-col gap-3 rounded-card border border-line-gold bg-anchor-green-raised p-4">
                      <div>
                          <label className={LABEL}>Link snowball pot</label>
                          <select
                              name="snowball_pot_id"
                              defaultValue={editingGame?.snowball_pot_id || ""}
                              required
                              className={fieldClass}
                          >
                              <option value="">Select a pot...</option>
                              {snowballPots.map(pot => (
                                  <option key={pot.id} value={pot.id}>
                                      {pot.name} (Jackpot: {formatPoundsAmount(Number(pot.current_jackpot_amount))} / Calls: {pot.current_max_calls})
                                  </option>
                              ))}
                          </select>
                          {snowballPots.length === 0 && (
                              <p className="mt-1.5 text-sm text-anchor-danger-text">
                                  No snowball pots found. Create one on the Snowball page first.
                              </p>
                          )}
                          {isGameLocked && (
                            <p className={LOCKED_NOTE}>Locked: game already started</p>
                          )}
                      </div>
                      <input type="hidden" name="stages" value="Full House" />
                      <p className="text-sm text-anchor-sage">Snowball games are Full House only.</p>
                  </div>
              )}

              {selectedGameType === 'jackpot' && (
                  <div className="flex flex-col gap-3 rounded-card border border-line-gold bg-anchor-green-raised p-4">
                      <input type="hidden" name="stages" value="Full House" />
                      <p className="text-sm text-anchor-sage">
                          Jackpot games are configured as Full House only. The cash jackpot amount is entered by the host when starting this game.
                      </p>
                  </div>
              )}

              <div>
                  <label className={LABEL}>Prizes</label>
                  <div className="flex flex-col gap-2">
                      {selectedStages.map(stage => {
                          const isMissing = missingPrizeStages.includes(stage);
                          const isRequired = requiredStages.includes(stage);
                          return (
                            <div key={stage}>
                              <div className="flex items-center gap-3">
                                <label className="w-28 shrink-0 text-right text-xs font-semibold uppercase tracking-[0.1em] text-anchor-sage" htmlFor={`prize_${stage}`}>{stage}{isRequired ? '' : ' (optional)'}:</label>
                                <Input
                                    id={`prize_${stage}`}
                                    type="text"
                                    name={`prize_${stage}`}
                                    value={prizeDraft[stage] ?? ''}
                                    onChange={(e) => handlePrizeChange(stage, e.target.value)}
                                    placeholder={selectedGameType === 'snowball' ? "e.g. £20" : selectedGameType === 'jackpot' ? "Set at game start" : "e.g. £10"}
                                    aria-invalid={isMissing}
                                    aria-describedby={isMissing ? `prize_${stage}_error` : undefined}
                                />
                              </div>
                              {isMissing && (
                                <p id={`prize_${stage}_error`} className="ml-[7.75rem] mt-1.5 text-sm text-anchor-danger-text">
                                  Prize required for {stage}.
                                </p>
                              )}
                            </div>
                          );
                      })}
                  </div>
                  {isGameLocked && (
                    <p className={LOCKED_NOTE}>Locked: game already started</p>
                  )}
              </div>

            </fieldset>

            <div>
              <label className={LABEL}>Book colour</label>
              <div className="flex gap-2">
                <input
                    type="color"
                    value={backgroundColor}
                    onChange={(e) => setBackgroundColor(e.target.value)}
                    className="h-[52px] w-16 shrink-0 cursor-pointer rounded-input border border-line-strong bg-anchor-green-deep p-1"
                />
                <Input
                    type="text"
                    name="background_colour"
                    placeholder="#ffffff"
                    value={backgroundColor}
                    pattern="^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$"
                    className="w-36 uppercase tabular-nums"
                    onChange={(e) => setBackgroundColor(e.target.value)}
                />
              </div>
            </div>

            <div>
              <label className={LABEL}>Notes</label>
              <textarea
                name="notes"
                defaultValue={editingGame?.notes || ""}
                rows={2}
                className={fieldClass}
              />
            </div>

            <div className="flex flex-wrap justify-end gap-2 border-t border-line-gold pt-4">
                <Button variant="ghost" size="sm" type="button" onClick={handleClose} disabled={isSubmitting}>
                Cancel
                </Button>
                <Button variant="primary" size="sm" type="submit" disabled={isSubmitting || missingPrizeStages.length > 0}>
                {editingGame ? 'Save changes' : 'Add game'}
                </Button>
            </div>
        </form>
      </Modal>

      {/* Typed-confirm delete-game modal */}
      <Modal
        isOpen={deleteGameTarget !== null}
        onClose={handleCloseDeleteGame}
        title={deleteGameTarget ? `Delete game "${deleteGameTarget.name}"?` : 'Delete game?'}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={handleCloseDeleteGame} disabled={isDeletingGame}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleConfirmDeleteGame}
              disabled={!isDeleteGameConfirmed || isDeletingGame}
            >
              {isDeletingGame ? 'Deleting…' : 'Delete'}
            </Button>
          </>
        }
      >
        {deleteGameTarget && (
          <div className="flex flex-col gap-4">
            {deleteGameError && (
              <div className={ERROR_PANEL}>
                {deleteGameError}
              </div>
            )}
            <p>
              This will permanently delete the game from this session. This action cannot be undone.
            </p>
            <p className="text-sm text-anchor-sage">
              Started, completed, or already-won games cannot be deleted.
            </p>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="confirmDeleteGame" className={fieldLabelClass}>
                Type the game name <span className="text-anchor-gold-bright">{deleteGameTarget.name}</span> to confirm:
              </label>
              <Input
                id="confirmDeleteGame"
                type="text"
                value={deleteGameTyped}
                onChange={(e) => setDeleteGameTyped(e.target.value)}
                placeholder={deleteGameTarget.name}
                autoFocus
              />
            </div>
          </div>
        )}
      </Modal>

      {/* Typed-confirm reset-session modal */}
      <Modal
        isOpen={voidTarget !== null}
        onClose={() => { if (!isVoiding) { setVoidTarget(null); setVoidReason(''); setVoidError(null); } }}
        title="Void this winner?"
      >
        <div className="flex flex-col gap-4">
          {voidTarget && (
            <div className="rounded-card border border-line bg-anchor-green-raised px-4 py-3">
              <p className="font-semibold">
                {voidTarget.stage} on {voidTarget.game ? `Game ${voidTarget.game.game_index}: ${voidTarget.game.name}` : 'an unknown game'}
              </p>
              <p className="text-sm text-anchor-sage">{voidTarget.prize_description || 'No prize recorded'}</p>
            </div>
          )}
          <p>
            The win is kept and marked void, with your reason against it. Nothing is deleted, and
            the row stays visible here and on the Winners page so the correction is on the record.
          </p>
          <p className="text-sm text-anchor-gold-bright">
            If this was a snowball jackpot that has already settled, voiding it here does not move
            the pot back. Correct the pot on the Snowball page as well.
          </p>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="voidReason" className={fieldLabelClass}>
              Reason (required)
            </label>
            <Input
              id="voidReason"
              type="text"
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
              placeholder="Why is this being voided?"
              autoComplete="off"
              disabled={isVoiding}
            />
            <p className="text-[13px] text-anchor-sage">
              Do not put a customer&rsquo;s name here. Winners are recorded anonymously on purpose.
            </p>
          </div>
          {voidError && (
            <div role="alert" className={ERROR_PANEL}>
              {voidError}
            </div>
          )}
          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <Button variant="ghost" size="sm" type="button" onClick={() => setVoidTarget(null)} disabled={isVoiding}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              type="button"
              onClick={handleConfirmVoidWinner}
              disabled={isVoiding || voidReason.trim().length === 0}
            >
              {isVoiding ? 'Voiding…' : 'Void winner'}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={showResetModal}
        onClose={handleCloseReset}
        title={`Reset session "${session.name}" to ready?`}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={handleCloseReset} disabled={isResetting}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleConfirmReset}
              disabled={!isResetConfirmed || isResetting}
            >
              {isResetting ? 'Resetting…' : 'Reset session'}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {resetError && (
            <div className={ERROR_PANEL}>
              {resetError}
            </div>
          )}
          <p>
            This wipes the live record of this session and puts it back into the Ready state.
            The following are deleted:
          </p>
          <ul className="flex list-inside list-disc flex-col gap-1 pl-2">
            <li>All game states (called numbers, current stage, current pattern)</li>
            <li>All recorded winners for this session, including voided ones</li>
          </ul>
          <p className="text-sm text-anchor-sage">
            Snowball pot balances, the pot&rsquo;s own history and the game configuration are not
            touched. The list above used to claim it deleted snowball history; it never did.
          </p>
          <p className="text-sm text-anchor-success-text">
            A record of exactly what was deleted, including the winners, is kept so this can be
            checked afterwards.
          </p>
          <p className="text-sm text-anchor-gold-bright">
            If this session&rsquo;s snowball game has already settled the pot, the reset will be
            refused: the pot has moved and cannot be safely rewound. Correct the pot on the
            Snowball page first.
          </p>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="confirmReset" className={fieldLabelClass}>
              Type <span className="text-anchor-gold-bright">RESET</span> or the session name <span className="text-anchor-gold-bright">{session.name}</span> to confirm:
            </label>
            <Input
              id="confirmReset"
              type="text"
              value={resetTyped}
              onChange={(e) => setResetTyped(e.target.value)}
              placeholder="RESET"
              autoFocus
            />
          </div>
        </div>
      </Modal>
    </>
  );
}
