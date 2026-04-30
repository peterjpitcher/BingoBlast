"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { Database, GameType, WinStage, GameStatus } from '@/types/database';
import { createGame, deleteGame, duplicateGame, updateSessionStatus, updateGame, resetSession } from './actions';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { Input } from '@/components/ui/input';
import { useRouter } from 'next/navigation';
import { validateGamePrizes } from '@/lib/prize-validation';

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

  // Typed-confirm reset-session modal state
  const [showResetModal, setShowResetModal] = useState(false);
  const [resetTyped, setResetTyped] = useState('');
  const [isResetting, setIsResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  const router = useRouter();

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

  return (
    <>
      {actionError && !showGameModal && (
        <div className="mb-6 rounded border border-red-800 bg-red-900/40 p-3 text-sm text-red-200">
          {actionError}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
          <div className="md:col-span-2">
            <Card className="bg-slate-900 border-slate-800 h-full">
                <CardHeader>
                    <CardTitle>Session Details</CardTitle>
                </CardHeader>
                <CardContent>
                    <dl className="grid grid-cols-3 gap-4 text-sm">
                        <dt className="text-slate-400">Date</dt>
                        <dd className="col-span-2 text-white font-medium">{session.start_date}</dd>

                        <dt className="text-slate-400">Status</dt>
                        <dd className="col-span-2 text-white uppercase font-bold tracking-wider">{session.status}</dd>

                        <dt className="text-slate-400">Notes</dt>
                        <dd className="col-span-2 text-slate-300">{session.notes || '-'}</dd>

                        <dt className="text-slate-400">Test Mode</dt>
                        <dd className="col-span-2 text-white">{session.is_test_session ? 'Yes' : 'No'}</dd>
                    </dl>
                </CardContent>
            </Card>
          </div>
          <div className="md:col-span-1">
              <Card className="bg-slate-900 border-slate-800 h-full">
                  <CardContent className="flex flex-col justify-center h-full p-6 space-y-3">
                        {session.status === 'draft' && (
                            <Button variant="secondary" className="w-full border-blue-500 text-blue-400 hover:bg-blue-950" onClick={handleMarkAsReady}>
                                Mark as Ready
                            </Button>
                        )}
                        <Button
                            variant="primary"
                            size="lg"
                            className="w-full"
                            disabled={isSessionLocked || session.status === 'draft'}
                            onClick={handleStartSession}
                        >
                            Start Session
                        </Button>

                        {isSessionLocked && (
                            <Button variant="secondary" size="sm" className="w-full border-yellow-600 text-yellow-500 hover:bg-yellow-950" onClick={handleShowReset}>
                                Reset to Ready (Unlock)
                            </Button>
                        )}

                        <p className="text-xs text-slate-500 text-center mt-2">
                            {session.status === 'running' && 'Session is live!'}
                            {session.status === 'ready' && 'Session is ready for hosts.'}
                            {session.status === 'draft' && 'Draft mode.'}
                            {session.status === 'completed' && 'Session completed.'}
                        </p>
                  </CardContent>
              </Card>
          </div>
      </div>

      <Card className="bg-slate-900 border-slate-800 mb-6">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Winners ({winners.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {winners.length === 0 ? (
            <div className="p-6 text-sm text-slate-500">No winners recorded for this session yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-slate-800/50 text-slate-400">
                  <tr>
                    <th className="px-4 py-3 font-medium">Time</th>
                    <th className="px-4 py-3 font-medium">Game</th>
                    <th className="px-4 py-3 font-medium">Winner</th>
                    <th className="px-4 py-3 font-medium">Stage</th>
                    <th className="px-4 py-3 font-medium">Prize</th>
                    <th className="px-4 py-3 font-medium text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/50">
                  {winners.map((winner) => (
                    <tr key={winner.id} className="hover:bg-slate-800/30 transition-colors">
                      <td className="px-4 py-3 text-slate-400 whitespace-nowrap">
                        {new Date(winner.created_at).toLocaleString()}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-white">
                          {winner.game ? `Game ${winner.game.game_index}: ${winner.game.name}` : 'Unknown game'}
                        </div>
                      </td>
                      <td className="px-4 py-3 font-bold text-white">{winner.winner_name}</td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 text-xs border border-slate-700">
                          {winner.stage}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-300">
                        {winner.prize_description || '-'}
                        {winner.is_snowball_jackpot && (
                          <span className="ml-2 px-1.5 py-0.5 rounded text-xs font-bold bg-yellow-900/30 text-yellow-500 border border-yellow-800">
                            JACKPOT
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {winner.is_void ? (
                          <span className="px-2 py-0.5 rounded-full border border-red-700 text-red-300 bg-red-900/20 text-xs font-semibold">
                            VOID
                          </span>
                        ) : winner.prize_given ? (
                          <span className="px-2 py-0.5 rounded-full border border-green-700 text-green-300 bg-green-900/20 text-xs font-semibold">
                            Prize Given
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full border border-yellow-700 text-yellow-300 bg-yellow-900/20 text-xs font-semibold">
                            Outstanding
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="bg-slate-900 border-slate-800">
        <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Games ({games.length})</CardTitle>
            <Button variant="primary" onClick={handleShowAdd} disabled={isSessionLocked}>
              + Add Game
            </Button>
        </CardHeader>
        <CardContent className="p-0">
          {games.length === 0 ? (
            <div className="text-center py-12 text-slate-500">
                <p className="mb-4">No games configured for this session yet.</p>
                <Button variant="secondary" onClick={handleShowAdd} disabled={isSessionLocked}>Add Your First Game</Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-slate-800/50 text-slate-400">
                  <tr>
                    <th className="px-4 py-3 w-16 text-center">#</th>
                    <th className="px-4 py-3">Name</th>
                    <th className="px-4 py-3">Type</th>
                    <th className="px-4 py-3">Stages</th>
                    <th className="px-4 py-3">Colour</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/50">
                  {games.map((game) => {
                    const status = readGameStatus(game);
                    const gameLocked = status === 'in_progress' || status === 'completed';
                    const deleteDisabled = gameLocked;
                    const deleteTitle = gameLocked
                      ? `Cannot delete a ${status} game`
                      : undefined;
                    return (
                      <tr key={game.id} className="hover:bg-slate-800/30 transition-colors">
                        <td className="px-4 py-3 text-center font-bold text-white">{game.game_index}</td>
                        <td className="px-4 py-3">
                            <div className="font-medium text-white">{game.name}</div>
                            {game.notes && <div className="text-xs text-slate-500">{game.notes}</div>}
                        </td>
                        <td className="px-4 py-3">
                            {game.type === 'snowball' ? (
                                <span className="px-2 py-0.5 bg-indigo-900/50 text-indigo-300 rounded border border-indigo-800 text-xs font-bold">Snowball</span>
                            ) : game.type === 'jackpot' ? (
                                <span className="px-2 py-0.5 bg-amber-900/40 text-amber-300 rounded border border-amber-700 text-xs font-bold">Jackpot</span>
                            ) : (
                                <span className="px-2 py-0.5 bg-slate-800 text-slate-300 rounded border border-slate-700 text-xs">Standard</span>
                            )}
                        </td>
                        <td className="px-4 py-3">
                            <div className="flex gap-1">
                              {game.stage_sequence.map((stage, i) => (
                                  <span key={i} className="px-2 py-0.5 bg-slate-800 text-slate-400 rounded text-xs border border-slate-700">{stage}</span>
                              ))}
                            </div>
                        </td>
                        <td className="px-4 py-3">
                            <div
                                className="w-6 h-6 rounded border border-white/10 shadow-sm"
                                style={{ backgroundColor: game.background_colour }}
                                title={game.background_colour}
                            />
                        </td>
                        <td className="px-4 py-3 text-right space-x-2">
                          <Button variant="ghost" size="sm" className="px-2 text-slate-400 hover:text-white" onClick={() => handleDuplicateGame(game.id)}>Clone</Button>
                          <Button variant="ghost" size="sm" className="px-2 text-slate-400 hover:text-white" onClick={() => handleShowEdit(game)}>Edit</Button>
                          <Button variant="ghost" size="sm" className="px-2 text-red-500 hover:text-red-400 hover:bg-red-900/20" onClick={() => handleShowDeleteGame(game)} disabled={deleteDisabled} title={deleteTitle}>Delete</Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add/Edit Game Modal */}
      <Modal
        isOpen={showGameModal}
        onClose={handleClose}
        title={editingGame ? 'Edit Game' : 'Add Game'}
        className="max-w-2xl"
      >
        <form key={editingGame?.id || 'new-game'} onSubmit={handleGameSubmit} className="space-y-4">
            {actionError && <div className="p-3 bg-red-900/50 text-red-200 rounded border border-red-800 text-sm">{actionError}</div>}

            {isGameLocked && (
              <div className="p-3 rounded border border-yellow-800 bg-yellow-900/30 text-sm text-yellow-200">
                This game has already started. Prize, type, snowball pot, and stage configuration are locked.
              </div>
            )}

            <div className="flex gap-4">
                <div className="w-1/4">
                    <label className="text-sm font-medium text-slate-300 mb-1 block">Order</label>
                    <Input
                        type="number"
                        name="game_index"
                        defaultValue={editingGame ? editingGame.game_index : nextIndex}
                        required
                    />
                </div>
                <div className="w-3/4">
                    <label className="text-sm font-medium text-slate-300 mb-1 block">Game Name</label>
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
                fieldset so the entire group is disabled in one place. */}
            <fieldset disabled={isGameLocked} aria-disabled={isGameLocked} className="space-y-4 disabled:opacity-70">

              <div>
                <label className="text-sm font-medium text-slate-300 mb-1 block">Game Type</label>
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
                  className="flex h-10 w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bingo-primary disabled:cursor-not-allowed disabled:opacity-50"
                >
                    <option value="standard">Standard Game</option>
                    <option value="jackpot">Jackpot Game</option>
                    <option value="snowball">Snowball Game</option>
                </select>
                {isGameLocked && (
                  <p className="text-xs text-muted-foreground mt-1 text-yellow-200/80">Locked: game already started</p>
                )}
              </div>

              {selectedGameType === 'standard' && (
                  <div>
                      <label className="text-sm font-medium text-slate-300 mb-2 block">Stages (Winners)</label>
                      <div className="flex gap-4 p-3 bg-slate-950/50 rounded-lg border border-slate-800">
                          {STANDARD_STAGES.map(stage => (
                              <label key={stage} className="flex items-center gap-2 cursor-pointer">
                                  <input
                                      type="checkbox"
                                      name="stages"
                                      value={stage}
                                      checked={selectedStages.includes(stage)}
                                      onChange={() => handleStageChange(stage)}
                                      className="rounded border-slate-700 bg-slate-900 text-bingo-primary focus:ring-bingo-primary"
                                  />
                                  <span className="text-sm text-slate-300">{stage}</span>
                              </label>
                          ))}
                      </div>
                      {selectedStages.length === 0 && <p className="text-xs text-red-400 mt-1">Select at least one stage.</p>}
                      {isGameLocked && (
                        <p className="text-xs text-muted-foreground mt-1 text-yellow-200/80">Locked: game already started</p>
                      )}
                  </div>
              )}

              {selectedGameType === 'snowball' && (
                  <div className="p-4 bg-indigo-900/20 border border-indigo-900 rounded-lg space-y-3">
                      <div>
                          <label className="text-sm font-medium text-indigo-200 mb-1 block">Link Snowball Pot</label>
                          <select
                              name="snowball_pot_id"
                              defaultValue={editingGame?.snowball_pot_id || ""}
                              required
                              className="flex h-10 w-full rounded-md border border-indigo-700 bg-slate-900 px-3 py-2 text-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                              <option value="">Select a Pot...</option>
                              {snowballPots.map(pot => (
                                  <option key={pot.id} value={pot.id}>
                                      {pot.name} (Jackpot: £{pot.current_jackpot_amount} / Calls: {pot.current_max_calls})
                                  </option>
                              ))}
                          </select>
                          {snowballPots.length === 0 && (
                              <p className="text-xs text-red-400 mt-1">
                                  No Snowball Pots found. Create one in the Snowball menu first.
                              </p>
                          )}
                          {isGameLocked && (
                            <p className="text-xs text-muted-foreground mt-1 text-yellow-200/80">Locked: game already started</p>
                          )}
                      </div>
                      <input type="hidden" name="stages" value="Full House" />
                      <p className="text-xs text-indigo-300 flex items-center gap-2">Snowball games are Full House only.</p>
                  </div>
              )}

              {selectedGameType === 'jackpot' && (
                  <div className="p-4 bg-amber-900/20 border border-amber-800 rounded-lg space-y-3">
                      <input type="hidden" name="stages" value="Full House" />
                      <p className="text-xs text-amber-200">
                          Jackpot games are configured as Full House only. The cash jackpot amount is entered by host when starting this game.
                      </p>
                  </div>
              )}

              <div>
                  <label className="text-sm font-medium text-slate-300 mb-2 block">Prizes</label>
                  <div className="space-y-2">
                      {selectedStages.map(stage => {
                          const isMissing = missingPrizeStages.includes(stage);
                          const isRequired = requiredStages.includes(stage);
                          return (
                            <div key={stage}>
                              <div className="flex items-center gap-3">
                                <label className="text-xs text-slate-400 w-24 uppercase tracking-wide font-bold text-right" htmlFor={`prize_${stage}`}>{stage}{isRequired ? '' : ' (optional)'}:</label>
                                <Input
                                    id={`prize_${stage}`}
                                    type="text"
                                    name={`prize_${stage}`}
                                    value={prizeDraft[stage] ?? ''}
                                    onChange={(e) => handlePrizeChange(stage, e.target.value)}
                                    placeholder={selectedGameType === 'snowball' ? "e.g. £20" : selectedGameType === 'jackpot' ? "Set at game start" : "e.g. £10"}
                                    className={isMissing ? 'h-9 border-destructive border-red-500' : 'h-9'}
                                    aria-invalid={isMissing}
                                    aria-describedby={isMissing ? `prize_${stage}_error` : undefined}
                                />
                              </div>
                              {isMissing && (
                                <p id={`prize_${stage}_error`} className="text-xs text-red-400 mt-1 ml-[6.5rem]">
                                  Prize required for {stage}.
                                </p>
                              )}
                            </div>
                          );
                      })}
                  </div>
                  {isGameLocked && (
                    <p className="text-xs text-muted-foreground mt-1 text-yellow-200/80">Locked: game already started</p>
                  )}
              </div>

            </fieldset>

            <div>
              <label className="text-sm font-medium text-slate-300 mb-1 block">Background Colour</label>
              <div className="flex gap-2">
                <input
                    type="color"
                    value={backgroundColor}
                    onChange={(e) => setBackgroundColor(e.target.value)}
                    className="h-10 w-16 p-1 bg-slate-900 border border-slate-700 rounded cursor-pointer"
                />
                <Input
                    type="text"
                    name="background_colour"
                    placeholder="#ffffff"
                    value={backgroundColor}
                    pattern="^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$"
                    className="w-32 font-mono uppercase"
                    onChange={(e) => setBackgroundColor(e.target.value)}
                />
              </div>
            </div>

            <div>
              <label className="text-sm font-medium text-slate-300 mb-1 block">Notes</label>
              <textarea
                name="notes"
                defaultValue={editingGame?.notes || ""}
                rows={2}
                className="flex w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bingo-primary"
              />
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t border-slate-800 mt-6">
                <Button variant="secondary" type="button" onClick={handleClose} disabled={isSubmitting}>
                Cancel
                </Button>
                <Button variant="primary" type="submit" disabled={isSubmitting || missingPrizeStages.length > 0}>
                {editingGame ? 'Save Changes' : 'Add Game'}
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
            <Button variant="ghost" onClick={handleCloseDeleteGame} disabled={isDeletingGame}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={handleConfirmDeleteGame}
              disabled={!isDeleteGameConfirmed || isDeletingGame}
            >
              {isDeletingGame ? 'Deleting…' : 'Delete'}
            </Button>
          </>
        }
      >
        {deleteGameTarget && (
          <div className="space-y-4">
            {deleteGameError && (
              <div className="p-3 text-sm text-red-200 bg-red-900/50 border border-red-800 rounded-md">
                {deleteGameError}
              </div>
            )}
            <p className="text-sm text-white/85">
              This will permanently delete the game from this session. This action cannot be undone.
            </p>
            <p className="text-sm text-white/85">
              Started, completed, or already-won games cannot be deleted.
            </p>
            <div className="space-y-2">
              <label htmlFor="confirmDeleteGame" className="text-sm font-medium text-white/85">
                Type the game name <span className="font-mono text-white">{deleteGameTarget.name}</span> to confirm:
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
        isOpen={showResetModal}
        onClose={handleCloseReset}
        title={`Reset session "${session.name}" to Ready?`}
        footer={
          <>
            <Button variant="ghost" onClick={handleCloseReset} disabled={isResetting}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={handleConfirmReset}
              disabled={!isResetConfirmed || isResetting}
            >
              {isResetting ? 'Resetting…' : 'Reset Session'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {resetError && (
            <div className="p-3 text-sm text-red-200 bg-red-900/50 border border-red-800 rounded-md">
              {resetError}
            </div>
          )}
          <p className="text-sm text-white/85">
            This will wipe all live history for this session and put it back into the Ready state. The following will be permanently deleted:
          </p>
          <ul className="list-disc list-inside text-sm text-white/85 space-y-1 pl-2">
            <li>All game states (called numbers, current stage, current pattern)</li>
            <li>All recorded winners for this session</li>
            <li>Any snowball jackpot history captured against winners in this session</li>
          </ul>
          <p className="text-sm text-yellow-200/85">
            Snowball pot balances and the underlying game configuration are not touched.
          </p>
          <div className="space-y-2">
            <label htmlFor="confirmReset" className="text-sm font-medium text-white/85">
              Type <span className="font-mono text-white">RESET</span> or the session name <span className="font-mono text-white">{session.name}</span> to confirm:
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
