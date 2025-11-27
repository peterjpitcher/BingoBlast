"use client";

import React, { useState } from 'react';
import { Database } from '@/types/database';
import { createSnowballPot, deleteSnowballPot, resetSnowballPot, updateSnowballPot } from './actions';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { Input } from '@/components/ui/input';

type SnowballPot = Database['public']['Tables']['snowball_pots']['Row'];

interface SnowballListProps {
  pots: SnowballPot[];
}

export default function SnowballList({ pots }: SnowballListProps) {
  const [showModal, setShowModal] = useState(false);
  const [editingPot, setEditingPot] = useState<SnowballPot | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const handleClose = () => {
    setShowModal(false);
    setEditingPot(null);
    setActionError(null);
  };
  const handleShowCreate = () => setShowModal(true);
  
  const handleShowEdit = (pot: SnowballPot) => {
      setEditingPot(pot);
      setShowModal(true);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setActionError(null);

    const formData = new FormData(event.currentTarget);
    
    let result;
    if (editingPot) {
        result = await updateSnowballPot(editingPot.id, null, formData);
    } else {
        result = await createSnowballPot(null, formData);
    }

    setIsSubmitting(false);

    if (result?.error) {
      setActionError(result.error);
    } else {
      handleClose();
    }
  }

  async function handleDelete(id: string) {
    if (confirm('Delete this snowball pot? This will unlink any games using it.')) {
        await deleteSnowballPot(id);
    }
  }

  async function handleReset(id: string) {
      if (confirm('Reset this pot to its BASE values? This clears the current jackpot.')) {
          await resetSnowballPot(id);
      }
  }

  return (
    <>
      <Card className="bg-slate-900 border-slate-800">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Snowball Pots</CardTitle>
          <Button onClick={handleShowCreate}>
            + New Pot
          </Button>
        </CardHeader>
        <CardContent>
          {pots.length === 0 ? (
            <div className="p-8 text-center text-slate-500">
                <p>No snowball pots defined.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-slate-800/50 text-slate-400">
                  <tr>
                    <th className="px-4 py-3 font-medium">Name</th>
                    <th className="px-4 py-3 font-medium">Current Jackpot</th>
                    <th className="px-4 py-3 font-medium">Current Calls</th>
                    <th className="px-4 py-3 font-medium">Increments</th>
                    <th className="px-4 py-3 font-medium">Base Values</th>
                    <th className="px-4 py-3 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/50">
                  {pots.map((pot) => (
                    <tr key={pot.id} className="hover:bg-slate-800/30 transition-colors">
                      <td className="px-4 py-3 font-medium text-white">{pot.name}</td>
                      <td className="px-4 py-3">
                          <span className="text-green-400 font-bold text-lg">£{pot.current_jackpot_amount}</span>
                      </td>
                      <td className="px-4 py-3">
                          <span className="px-2 py-0.5 bg-indigo-900/50 text-indigo-300 rounded border border-indigo-800 font-medium">{pot.current_max_calls}</span>
                      </td>
                      <td className="px-4 py-3 text-slate-400 text-xs">
                          +£{pot.jackpot_increment} / +{pot.calls_increment} calls
                      </td>
                      <td className="px-4 py-3 text-slate-400 text-xs">
                          £{pot.base_jackpot_amount} / {pot.base_max_calls} calls
                      </td>
                      <td className="px-4 py-3 text-right space-x-2">
                        <Button variant="ghost" size="sm" className="text-yellow-500 hover:text-yellow-400 hover:bg-yellow-900/20 h-8 px-2" onClick={() => handleReset(pot.id)}>Reset</Button>
                        <Button variant="ghost" size="sm" className="text-slate-300 hover:text-white hover:bg-slate-800 h-8 px-2" onClick={() => handleShowEdit(pot)}>Edit</Button>
                        <Button variant="ghost" size="sm" className="text-red-500 hover:text-red-400 hover:bg-red-900/20 h-8 px-2" onClick={() => handleDelete(pot.id)}>Delete</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Modal 
        isOpen={showModal} 
        onClose={handleClose} 
        title={editingPot ? 'Edit Snowball Pot' : 'Create Snowball Pot'}
        className="max-w-3xl"
      >
        <form id="snowballForm" onSubmit={handleSubmit} className="space-y-6">
          {actionError && (
             <div className="p-3 bg-red-900/50 text-red-200 rounded border border-red-800 text-sm">{actionError}</div>
          )}
          
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-300">Pot Name</label>
            <Input 
              type="text" 
              name="name"
              defaultValue={editingPot?.name}
              placeholder="e.g. Friday Night Snowball" 
              required 
              autoFocus
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-4 p-4 bg-slate-950/50 rounded-lg border border-slate-800">
                  <h3 className="font-bold text-bingo-primary text-sm uppercase tracking-wide">Current Status</h3>
                  <div className="space-y-2">
                    <label className="text-xs text-slate-400">Current Jackpot (£)</label>
                    <Input 
                        type="number" 
                        step="0.01"
                        name="current_jackpot_amount"
                        defaultValue={editingPot?.current_jackpot_amount || 200}
                        required 
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                        <label className="text-xs text-slate-400">Current Max Calls</label>
                        <button 
                            type="button"
                            className="text-[10px] text-indigo-400 hover:text-indigo-300 underline"
                            onClick={() => {
                                const input = document.querySelector('input[name="current_max_calls"]') as HTMLInputElement;
                                if (input) input.value = "90";
                            }}
                        >
                            Set to Must Go (90)
                        </button>
                    </div>
                    <Input 
                        type="number" 
                        name="current_max_calls"
                        defaultValue={editingPot?.current_max_calls || 48}
                        required 
                    />
                  </div>
              </div>
              
              <div className="space-y-4 p-4 bg-slate-950/50 rounded-lg border border-slate-800">
                  <h3 className="font-bold text-slate-400 text-sm uppercase tracking-wide">Base Configuration</h3>
                  <div className="space-y-2">
                    <label className="text-xs text-slate-400">Base Jackpot (£)</label>
                    <Input 
                        type="number" 
                        step="0.01"
                        name="base_jackpot_amount"
                        defaultValue={editingPot?.base_jackpot_amount || 200}
                        required 
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs text-slate-400">Base Max Calls</label>
                    <Input 
                        type="number" 
                        name="base_max_calls"
                        defaultValue={editingPot?.base_max_calls || 48}
                        required 
                    />
                  </div>
              </div>
          </div>

          <div className="p-4 bg-slate-950/50 rounded-lg border border-slate-800">
             <h3 className="font-bold text-slate-400 text-sm uppercase tracking-wide mb-4">Rollover Rules</h3>
             <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                    <label className="text-xs text-slate-400">Jackpot Increment (£)</label>
                    <Input 
                        type="number" 
                        step="0.01"
                        name="jackpot_increment"
                        defaultValue={editingPot?.jackpot_increment || 20}
                        required 
                    />
                    <p className="text-[10px] text-slate-500">Added if not won.</p>
                </div>
                <div className="space-y-2">
                    <label className="text-xs text-slate-400">Calls Increment</label>
                    <Input 
                        type="number" 
                        name="calls_increment"
                        defaultValue={editingPot?.calls_increment || 2}
                        required 
                    />
                    <p className="text-[10px] text-slate-500">Added if not won.</p>
                </div>
             </div>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-slate-800">
            <Button variant="ghost" type="button" onClick={handleClose} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving...' : (editingPot ? 'Save Changes' : 'Create Pot')}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}