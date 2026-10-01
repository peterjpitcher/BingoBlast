"use client";

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Database } from '@/types/database';
import { archiveSnowballPot, createSnowballPot, resetSnowballPot, updateSnowballPot } from './actions';
import { formatPounds } from '@/lib/snowball';
import { formatPoundsAmount } from '@/lib/money';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Kicker } from '@/components/ui/kicker';
import { Modal } from '@/components/ui/modal';
import { Input, fieldLabelClass } from '@/components/ui/input';

type SnowballPot = Database['public']['Tables']['snowball_pots']['Row'];

interface SnowballListProps {
  pots: SnowballPot[];
}

// The pot card's four figures sit side by side on a laptop, divided by gold
// hairlines, and stack on a narrower screen.
const POT_CELL = "flex flex-col gap-1.5 lg:border-l lg:border-line-gold lg:pl-8";
const POT_FIGURE = "font-display text-[34px] leading-none";
const POT_HINT = "text-[13px] text-anchor-sage";

// Form and dialog pieces shared by the modals below.
const ERROR_PANEL = "rounded-card border border-anchor-danger bg-anchor-danger/[0.12] px-4 py-3 text-sm text-anchor-danger-text";
const FIELD_GROUP = "flex flex-col gap-4 rounded-card border border-line bg-anchor-green-raised p-4";
const FIELD = "flex flex-col gap-1.5";

export default function SnowballList({ pots }: SnowballListProps) {
  const router = useRouter();
  const [showModal, setShowModal] = useState(false);
  const [editingPot, setEditingPot] = useState<SnowballPot | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // These two used to be window.confirm(). They are the most money-sensitive
  // controls in the app, and everywhere else that touches real money (deleting a
  // game, resetting a session) already uses a typed confirmation. Resetting a
  // pot throws away a jackpot that has been building across sessions, so it asks
  // for the pot's name to be typed. Archiving is reversible and keeps
  // everything, so a plain confirmation is enough for it.
  const [archiveTarget, setArchiveTarget] = useState<SnowballPot | null>(null);
  const [isArchiving, setIsArchiving] = useState(false);
  const [resetTarget, setResetTarget] = useState<SnowballPot | null>(null);
  const [resetTyped, setResetTyped] = useState('');
  const [isResetting, setIsResetting] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

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

    if (!result?.success) {
      setActionError(result?.error || "Failed to save snowball pot.");
    } else {
      handleClose();
      router.refresh();
    }
  }

  function handleShowArchive(pot: SnowballPot) {
    setArchiveTarget(pot);
    setModalError(null);
  }

  function handleShowReset(pot: SnowballPot) {
    setResetTarget(pot);
    setResetTyped('');
    setModalError(null);
  }

  async function handleConfirmArchive() {
    if (!archiveTarget || isArchiving) return;
    setIsArchiving(true);
    setModalError(null);
    try {
      const result = await archiveSnowballPot(archiveTarget.id);
      if (!result?.success) {
        setModalError(result?.error || 'Failed to archive that pot.');
        return;
      }
      setArchiveTarget(null);
      router.refresh();
    } catch {
      setModalError('Could not reach the server. Check the connection and try again.');
    } finally {
      setIsArchiving(false);
    }
  }

  async function handleConfirmReset() {
    if (!resetTarget || isResetting) return;
    if (resetTyped.trim() !== resetTarget.name) {
      setModalError('Type the pot name exactly to confirm.');
      return;
    }
    setIsResetting(true);
    setModalError(null);
    try {
      const result = await resetSnowballPot(resetTarget.id);
      if (!result?.success) {
        setModalError(result?.error || 'Failed to reset that pot.');
        return;
      }
      setResetTarget(null);
      setResetTyped('');
      router.refresh();
    } catch {
      setModalError('Could not reach the server. Check the connection and try again.');
    } finally {
      setIsResetting(false);
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="flex flex-col gap-1.5">
          <Kicker>Admin</Kicker>
          <h1 className="text-[44px] leading-none text-anchor-cream-text">Snowball pots</h1>
          <p className="text-base text-anchor-sage">
            The jackpot that builds across nights. A won jackpot resets itself when the game ends.
          </p>
        </div>
        <Button variant="primary" size="md" onClick={handleShowCreate}>
          New pot
        </Button>
      </div>

      {actionError && (
        <div className={ERROR_PANEL}>
          {actionError}
        </div>
      )}

      {pots.length === 0 ? (
        <Card accent>
          <p className="px-5 py-8 text-[15px] text-anchor-sage">No snowball pots defined.</p>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {pots.map((pot) => (
            <Card
              key={pot.id}
              accent
              className="grid grid-cols-1 gap-6 px-5 py-6 sm:grid-cols-2 sm:px-8 sm:py-7 lg:grid-cols-[1.2fr_1fr_1fr_1fr_auto] lg:items-center lg:gap-8"
            >
              <div className="flex flex-col gap-1.5">
                <Kicker>{pot.name}</Kicker>
                <span className="font-display text-[64px] leading-[0.95] text-anchor-gold-bright">
                  {formatPoundsAmount(Number(pot.current_jackpot_amount))}
                </span>
                <span className="text-sm text-anchor-sage">Current jackpot</span>
              </div>
              <div className={POT_CELL}>
                <Kicker className="text-[11px]">Within</Kicker>
                <span className={POT_FIGURE}>{pot.current_max_calls} calls</span>
                <span className={POT_HINT}>Base {pot.base_max_calls} calls</span>
              </div>
              <div className={POT_CELL}>
                <Kicker className="text-[11px]">If not won</Kicker>
                <span className={POT_FIGURE}>+{formatPoundsAmount(Number(pot.jackpot_increment))}</span>
                <span className={POT_HINT}>and +{pot.calls_increment} calls</span>
              </div>
              <div className={POT_CELL}>
                <Kicker className="text-[11px]">Resets to</Kicker>
                <span className={POT_FIGURE}>{formatPoundsAmount(Number(pot.base_jackpot_amount))}</span>
                <span className={POT_HINT}>Base jackpot</span>
              </div>
              <div className="flex flex-row flex-wrap gap-2 sm:col-span-2 lg:col-span-1 lg:flex-col">
                <Button variant="outline" size="sm" onClick={() => handleShowEdit(pot)}>Edit</Button>
                <Button variant="ghost" tone="quiet" size="sm" onClick={() => handleShowReset(pot)}>Reset</Button>
                <Button variant="ghost" tone="quiet" size="sm" onClick={() => handleShowArchive(pot)}>Archive</Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal
        isOpen={showModal}
        onClose={handleClose}
        title={editingPot ? 'Edit snowball pot' : 'New snowball pot'}
        className="max-w-3xl"
      >
        <form id="snowballForm" onSubmit={handleSubmit} className="flex flex-col gap-5">
          {actionError && (
             <div className={ERROR_PANEL}>{actionError}</div>
          )}

          <div className={FIELD}>
            <label className={fieldLabelClass}>Pot name</label>
            <Input
              type="text"
              name="name"
              defaultValue={editingPot?.name}
              placeholder="e.g. Friday Night Snowball"
              required
              autoFocus
            />
          </div>

          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              <div className={FIELD_GROUP}>
                  <Kicker as="p">Current status</Kicker>
                  <div className={FIELD}>
                    <label className={fieldLabelClass}>Current jackpot (£)</label>
                    <Input
                        type="number"
                        step="0.01"
                        name="current_jackpot_amount"
                        defaultValue={editingPot?.current_jackpot_amount || 200}
                        required
                    />
                  </div>
                  <div className={FIELD}>
                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                        <label className={fieldLabelClass}>Current max calls</label>
                        <button
                            type="button"
                            className="text-[13px] font-semibold text-anchor-gold-bright underline underline-offset-2 transition-colors duration-150 hover:text-anchor-cream-text"
                            onClick={() => {
                                const input = document.querySelector('input[name="current_max_calls"]') as HTMLInputElement;
                                if (input) input.value = "90";
                            }}
                        >
                            Set to must go (90)
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

              <div className={FIELD_GROUP}>
                  <Kicker as="p">Base configuration</Kicker>
                  <div className={FIELD}>
                    <label className={fieldLabelClass}>Base jackpot (£)</label>
                    <Input
                        type="number"
                        step="0.01"
                        name="base_jackpot_amount"
                        defaultValue={editingPot?.base_jackpot_amount || 200}
                        required
                    />
                  </div>
                  <div className={FIELD}>
                    <label className={fieldLabelClass}>Base max calls</label>
                    <Input
                        type="number"
                        name="base_max_calls"
                        defaultValue={editingPot?.base_max_calls || 48}
                        required
                    />
                  </div>
              </div>
          </div>

          <div className={FIELD_GROUP}>
             <Kicker as="p">Rollover rules</Kicker>
             <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                <div className={FIELD}>
                    <label className={fieldLabelClass}>Jackpot increment (£)</label>
                    <Input
                        type="number"
                        step="0.01"
                        name="jackpot_increment"
                        defaultValue={editingPot?.jackpot_increment || 20}
                        required
                    />
                    <p className={POT_HINT}>Added if not won.</p>
                </div>
                <div className={FIELD}>
                    <label className={fieldLabelClass}>Calls increment</label>
                    <Input
                        type="number"
                        name="calls_increment"
                        defaultValue={editingPot?.calls_increment || 2}
                        required
                    />
                    <p className={POT_HINT}>Added if not won.</p>
                </div>
             </div>
          </div>

          <div className="flex flex-wrap justify-end gap-2 border-t border-line-gold pt-4">
            <Button variant="ghost" size="sm" type="button" onClick={handleClose} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving...' : (editingPot ? 'Save changes' : 'Create pot')}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Archive. Reversible and keeps everything, so a plain confirmation. */}
      <Modal
        isOpen={archiveTarget !== null}
        onClose={() => { if (!isArchiving) { setArchiveTarget(null); setModalError(null); } }}
        title={archiveTarget ? `Archive "${archiveTarget.name}"?` : 'Archive pot'}
      >
        <div className="flex flex-col gap-4">
          <p>
            The pot is hidden from this list and cannot be linked to a new game. Nothing is deleted:
            its history and the games that played for it are kept exactly as they are.
          </p>
          <p className="text-sm text-anchor-sage">
            It will refuse if a game using this pot has not finished yet.
          </p>
          {modalError && (
            <div role="alert" className={ERROR_PANEL}>
              {modalError}
            </div>
          )}
          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <Button variant="ghost" size="sm" type="button" onClick={() => setArchiveTarget(null)} disabled={isArchiving}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" type="button" onClick={handleConfirmArchive} disabled={isArchiving}>
              {isArchiving ? 'Archiving…' : 'Archive pot'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Reset. Throws away a jackpot built across sessions, so it is typed. */}
      <Modal
        isOpen={resetTarget !== null}
        onClose={() => { if (!isResetting) { setResetTarget(null); setResetTyped(''); setModalError(null); } }}
        title={resetTarget ? `Reset "${resetTarget.name}" to base?` : 'Reset pot'}
      >
        <div className="flex flex-col gap-4">
          {resetTarget && (
            <div className="rounded-card border border-line-gold bg-anchor-green-raised px-4 py-3">
              <p className="font-semibold tabular-nums text-anchor-gold-bright">
                £{formatPounds(Number(resetTarget.current_jackpot_amount))} at {resetTarget.current_max_calls} calls
                {' → '}
                £{formatPounds(Number(resetTarget.base_jackpot_amount))} at {resetTarget.base_max_calls} calls
              </p>
              <p className="mt-1.5 text-sm">
                This is the pot that has been building across sessions. Resetting it here is a manual
                correction, not a normal part of a game night: a won jackpot resets by itself when the
                game ends.
              </p>
            </div>
          )}
          <div className={FIELD}>
            <label htmlFor="reset-pot-confirm" className={fieldLabelClass}>
              Type <span className="text-anchor-gold-bright">{resetTarget?.name}</span> to confirm
            </label>
            <Input
              id="reset-pot-confirm"
              value={resetTyped}
              onChange={(e) => setResetTyped(e.target.value)}
              autoComplete="off"
              disabled={isResetting}
            />
          </div>
          {modalError && (
            <div role="alert" className={ERROR_PANEL}>
              {modalError}
            </div>
          )}
          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <Button variant="ghost" size="sm" type="button" onClick={() => { setResetTarget(null); setResetTyped(''); }} disabled={isResetting}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              type="button"
              onClick={handleConfirmReset}
              disabled={isResetting || resetTyped.trim() !== (resetTarget?.name ?? '')}
            >
              {isResetting ? 'Resetting…' : 'Reset pot'}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
