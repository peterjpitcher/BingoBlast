"use client";

import React, { useState, useEffect } from 'react';
import { Database } from '@/types/database';
import { createGame, deleteGame, duplicateGame, updateSessionStatus, updateGame, resetSession } from './actions';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { Input } from '@/components/ui/input';
import { useRouter } from 'next/navigation'; // Import useRouter

type Session = Database['public']['Tables']['sessions']['Row'];
type Game = Database['public']['Tables']['games']['Row'];
type SnowballPot = Pick<Database['public']['Tables']['snowball_pots']['Row'], 'id' | 'name' | 'current_jackpot_amount' | 'current_max_calls'>;

interface SessionDetailProps {
  session: Session;
  initialGames: Game[];
  snowballPots: SnowballPot[];
}

export default function SessionDetail({ session, initialGames, snowballPots }: SessionDetailProps) {
  const [games, setGames] = useState<Game[]>(initialGames);
  const [showGameModal, setShowGameModal] = useState(false);
  const [editingGame, setEditingGame] = useState<Game | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [backgroundColor, setBackgroundColor] = useState<string>('#ffffff');
  
  // Form State
  const [selectedGameType, setSelectedGameType] = useState<'standard' | 'snowball'>('standard');
  const [selectedStages, setSelectedStages] = useState<string[]>(['Line', 'Two Lines', 'Full House']);

  const router = useRouter(); // Initialize useRouter

  useEffect(() => {
    setGames(initialGames);
  }, [initialGames]);

  useEffect(() => {
    setBackgroundColor(editingGame?.background_colour || '#ffffff');
  }, [editingGame]);

  const nextIndex = games.length > 0 ? Math.max(...games.map(g => g.game_index)) + 1 : 1;


  const handleClose = () => {
    setShowGameModal(false);
    setEditingGame(null);
    setActionError(null);
    setSelectedGameType('standard');
    setSelectedStages(['Line', 'Two Lines', 'Full House']);
    setBackgroundColor('#ffffff');
  };

  const handleShowAdd = () => {
      setEditingGame(null);
      setSelectedGameType('standard');
      setSelectedStages(['Line', 'Two Lines', 'Full House']);
      setBackgroundColor('#ffffff');
      setShowGameModal(true);
  };

  const handleShowEdit = (game: Game) => {
      setEditingGame(game);
      setSelectedGameType(game.type);
      setSelectedStages(game.stage_sequence);
      setBackgroundColor(game.background_colour || '#ffffff');
      setShowGameModal(true);
  };

  const handleStageChange = (stage: string) => {
      setSelectedStages(prev => 
          prev.includes(stage) ? prev.filter(s => s !== stage) : [...prev, stage]
      );
  };

  async function handleGameSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
      router.refresh(); // Refresh after game changes
    }
  }

  async function handleDeleteGame(gameId: string) {
      if (confirm("Delete this game?")) {
          await deleteGame(gameId, session.id);
          router.refresh(); // Refresh after deleting game
      }
  }

  async function handleDuplicateGame(gameId: string) {
      await duplicateGame(gameId, session.id);
      router.refresh(); // Refresh after duplicating game
  }

  async function handleMarkAsReady() {
      if (confirm("Mark this session as Ready? It will be visible to hosts.")) {
          await updateSessionStatus(session.id, 'ready');
          router.refresh(); // Refresh after status change
      }
  }

  async function handleStartSession() {
      if (confirm("Ready to start this session? This will open it for the Host.")) {
          await updateSessionStatus(session.id, 'running');
          router.refresh(); // Refresh after status change
      }
  }

  async function handleResetSession() {
      if (confirm("Reset session to Ready? This will WIPE ALL HISTORY (winners, calls) for this session. Use with caution!")) {
          const result = await resetSession(session.id);
          if (!result?.success) {
              setActionError(result?.error || "Failed to reset session.");
          } else {
              router.refresh(); // Refresh after reset
          }
      }
  }

  const isSessionLocked = session.status === 'running' || session.status === 'completed';

  return (
    <>
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
                            <Button variant="secondary" size="sm" className="w-full border-yellow-600 text-yellow-500 hover:bg-yellow-950" onClick={handleResetSession}>
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
                  {games.map((game) => (
                    <tr key={game.id} className="hover:bg-slate-800/30 transition-colors">
                      <td className="px-4 py-3 text-center font-bold text-white">{game.game_index}</td>
                      <td className="px-4 py-3">
                          <div className="font-medium text-white">{game.name}</div>
                          {game.notes && <div className="text-xs text-slate-500">{game.notes}</div>}
                      </td>
                      <td className="px-4 py-3">
                          {game.type === 'snowball' ? 
                              <span className="px-2 py-0.5 bg-indigo-900/50 text-indigo-300 rounded border border-indigo-800 text-xs font-bold">Snowball</span> : 
                              <span className="px-2 py-0.5 bg-slate-800 text-slate-300 rounded border border-slate-700 text-xs">Standard</span>
                          }
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
                        <Button variant="ghost" size="sm" className="h-8 px-2 text-slate-400 hover:text-white" onClick={() => handleDuplicateGame(game.id)} disabled={isSessionLocked}>Clone</Button>
                        <Button variant="ghost" size="sm" className="h-8 px-2 text-slate-400 hover:text-white" onClick={() => handleShowEdit(game)} disabled={isSessionLocked}>Edit</Button>
                        <Button variant="ghost" size="sm" className="h-8 px-2 text-red-500 hover:text-red-400 hover:bg-red-900/20" onClick={() => handleDeleteGame(game.id)} disabled={isSessionLocked}>Delete</Button>
                      </td>
                    </tr>
                  ))}
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
        <form onSubmit={handleGameSubmit} className="space-y-4">
            {actionError && <div className="p-3 bg-red-900/50 text-red-200 rounded border border-red-800 text-sm">{actionError}</div>}
            
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

            <div>
              <label className="text-sm font-medium text-slate-300 mb-1 block">Game Type</label>
              <select 
                name="type" 
                value={selectedGameType}
                onChange={(e) => {
                    const newType = e.target.value as 'standard' | 'snowball';
                    setSelectedGameType(newType);
                    if (newType === 'snowball') {
                        setSelectedStages(['Full House']);
                    } else {
                         if (editingGame && editingGame.type === 'standard') {
                             setSelectedStages(editingGame.stage_sequence);
                         } else {
                             setSelectedStages(['Line', 'Two Lines', 'Full House']);
                         }
                    }
                }}
                className="flex h-10 w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bingo-primary"
              >
                  <option value="standard">Standard Game</option>
                  <option value="snowball">Snowball Game</option>
              </select>
            </div>

            {selectedGameType === 'standard' && (
                <div>
                    <label className="text-sm font-medium text-slate-300 mb-2 block">Stages (Winners)</label>
                    <div className="flex gap-4 p-3 bg-slate-950/50 rounded-lg border border-slate-800">
                        {['Line', 'Two Lines', 'Full House'].map(stage => (
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
                            className="flex h-10 w-full rounded-md border border-indigo-700 bg-slate-900 px-3 py-2 text-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
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
                    </div>
                    <input type="hidden" name="stages" value="Full House" />
                    <p className="text-xs text-indigo-300 flex items-center gap-2">ℹ️ Snowball games are Full House only.</p>
                </div>
            )}
            
            <div>
                <label className="text-sm font-medium text-slate-300 mb-2 block">Prizes</label>
                <div className="space-y-2">
                    {selectedStages.map(stage => (
                        <div key={stage} className="flex items-center gap-3">
                            <label className="text-xs text-slate-400 w-24 uppercase tracking-wide font-bold text-right">{stage}:</label>
                            <Input 
                                type="text" 
                                name={`prize_${stage}`} 
                                defaultValue={editingGame?.prizes?.[stage] || ''} 
                                placeholder={selectedGameType === 'snowball' ? "e.g. £20" : "e.g. £10"}
                                className="h-9"
                            />
                        </div>
                    ))}
                </div>
            </div>

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
                <Button variant="primary" type="submit" disabled={isSubmitting}>
                {editingGame ? 'Save Changes' : 'Add Game'}
                </Button>
            </div>
        </form>
      </Modal>
    </>
  );
}
