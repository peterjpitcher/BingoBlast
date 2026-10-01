"use client";

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Database } from '@/types/database';
import { createSession, deleteSession, duplicateSession, updateSession } from './actions';
import { formatDateInLondon } from '@/lib/dates';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button, buttonClass } from '@/components/ui/button';
import { Kicker } from '@/components/ui/kicker';
import { Modal } from '@/components/ui/modal';
import { Input, fieldClass, fieldLabelClass } from '@/components/ui/input';
import Link from 'next/link';
import { cn } from '@/lib/utils';

type Session = Database['public']['Tables']['sessions']['Row'];

// The admin table (design handoff, section 6): small sage column heads over a
// gold hairline, 15px cream cells, a hairline between rows and a faint gold
// wash on hover.
const TH = "whitespace-nowrap border-b border-line-gold px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-[0.1em] text-anchor-sage";
const TD = "px-5 py-4 align-middle text-[15px]";
const ROW = "border-b border-line transition-colors duration-150 last:border-b-0 hover:bg-anchor-gold-bright/[0.05]";
const ERROR_PANEL = "rounded-card border border-anchor-danger bg-anchor-danger/[0.12] px-4 py-3 text-sm text-anchor-danger-text";

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  ready: 'Ready',
  running: 'Running',
  completed: 'Completed',
};

interface AdminDashboardProps {
  sessions: Session[];
}

export default function AdminDashboard({ sessions }: AdminDashboardProps) {
  const router = useRouter();
  const [showSessionModal, setShowSessionModal] = useState(false);
  const [editingSession, setEditingSession] = useState<Session | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Typed-confirm delete-session modal state
  const [deleteTarget, setDeleteTarget] = useState<Session | null>(null);
  const [deleteTyped, setDeleteTyped] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleClose = () => {
    setShowSessionModal(false);
    setEditingSession(null);
    setActionError(null);
  };

  const handleShowCreate = () => {
    setEditingSession(null);
    setActionError(null);
    setShowSessionModal(true);
  };

  const handleShowEdit = (session: Session) => {
    setEditingSession(session);
    setActionError(null);
    setShowSessionModal(true);
  };

  async function handleSessionSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setActionError(null);

    const formData = new FormData(event.currentTarget);
    const result = editingSession
      ? await updateSession(editingSession.id, null, formData)
      : await createSession(null, formData);

    setIsSubmitting(false);

    if (!result?.success) {
      setActionError(result?.error || "Failed to save session.");
    } else {
      handleClose();
      router.refresh();
    }
  }

  function handleShowDelete(session: Session) {
    setDeleteTarget(session);
    setDeleteTyped('');
    setDeleteError(null);
  }

  function handleCloseDelete() {
    setDeleteTarget(null);
    setDeleteTyped('');
    setDeleteError(null);
    setIsDeleting(false);
  }

  async function handleConfirmDelete() {
    if (!deleteTarget) return;
    setIsDeleting(true);
    setDeleteError(null);
    const result = await deleteSession(deleteTarget.id);
    setIsDeleting(false);
    if (!result?.success) {
      setDeleteError(result?.error || "Failed to delete session.");
      return;
    }
    handleCloseDelete();
    router.refresh();
  }

  async function handleDuplicate(id: string) {
      if (confirm('Duplicate this session?')) {
          const result = await duplicateSession(id);
          if (!result?.success) {
              setActionError(result?.error || "Failed to duplicate session.");
          } else {
              router.refresh();
          }
      }
  }

  // Running is the one live state, so it alone takes the green badge and dot.
  const getStatusBadge = (status: string) =>
    status === 'running' ? (
      <Badge variant="success" dot>Running</Badge>
    ) : (
      <Badge variant="outline">{STATUS_LABELS[status] ?? status}</Badge>
    );

  const isDeleteConfirmed = deleteTarget !== null && deleteTyped === deleteTarget.name;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="flex flex-col gap-1.5">
          <Kicker>Admin</Kicker>
          <h1 className="text-[44px] leading-none text-anchor-cream-text">Sessions</h1>
          <p className="text-base text-anchor-sage">
            A session is one bingo night. Set it up here, hand it to the host, settle it after.
          </p>
        </div>
        <Button variant="primary" size="md" onClick={handleShowCreate}>
          New session
        </Button>
      </div>

      {actionError && !showSessionModal && (
        <div className={ERROR_PANEL}>
          {actionError}
        </div>
      )}

      <Card accent className="overflow-hidden">
        {sessions.length === 0 ? (
          <p className="px-5 py-8 text-[15px] text-anchor-sage">No sessions found. Create one to get started.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-left">
              <thead>
                <tr>
                  <th className={TH}>Session</th>
                  <th className={TH}>Date</th>
                  <th className={TH}>Status</th>
                  <th className={cn(TH, "text-right")}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((session) => (
                  <tr key={session.id} className={ROW}>
                    <td className={TD}>
                      <div className="flex items-center gap-2.5">
                        <span className="font-display text-xl leading-tight">{session.name}</span>
                        {session.is_test_session && (
                          <Badge variant="outline">Test</Badge>
                        )}
                      </div>
                    </td>
                    <td className={cn(TD, "whitespace-nowrap text-anchor-sage")}>{formatDateInLondon(session.start_date)}</td>
                    <td className={TD}>
                      {getStatusBadge(session.status)}
                    </td>
                    <td className={cn(TD, "text-right")}>
                      <div className="inline-flex items-center gap-1.5">
                        <Link
                          href={`/admin/sessions/${session.id}`}
                          className={buttonClass({ variant: 'outline', size: 'sm', className: 'px-[18px]' })}
                        >
                          Manage
                        </Link>
                        <Button variant="ghost" size="sm" className="px-3.5" onClick={() => handleShowEdit(session)}>
                          Edit
                        </Button>
                        <Button variant="ghost" size="sm" className="px-3.5" onClick={() => handleDuplicate(session.id)}>
                          Duplicate
                        </Button>
                        <Button variant="ghost" tone="quiet" size="sm" className="px-3.5" onClick={() => handleShowDelete(session)}>
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        isOpen={showSessionModal}
        onClose={handleClose}
        title={editingSession ? "Edit session" : "New session"}
        footer={
            <>
                <Button variant="ghost" size="sm" onClick={handleClose} disabled={isSubmitting}>
                  Cancel
                </Button>
                <Button variant="primary" size="sm" form="sessionForm" type="submit" disabled={isSubmitting}>
                  {isSubmitting ? 'Saving...' : (editingSession ? 'Save changes' : 'Create session')}
                </Button>
            </>
        }
      >
        <form
          key={editingSession?.id || 'new-session'}
          id="sessionForm"
          onSubmit={handleSessionSubmit}
          className="flex flex-col gap-4"
        >
          {actionError && (
            <div className={ERROR_PANEL}>
              {actionError}
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <label htmlFor="sessionName" className={fieldLabelClass}>Session name</label>
            <Input
              id="sessionName"
              type="text"
              name="name"
              placeholder="e.g. Friday Cash Bingo"
              defaultValue={editingSession?.name || ""}
              required
              autoFocus
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="sessionNotes" className={fieldLabelClass}>Notes (optional)</label>
            <textarea
              id="sessionNotes"
              name="notes"
              defaultValue={editingSession?.notes || ""}
              rows={3}
              className={fieldClass}
            />
          </div>

          <div className="flex items-center gap-2.5">
            <input
                type="checkbox"
                id="isTestSession"
                name="is_test_session"
                defaultChecked={editingSession?.is_test_session || false}
                className="h-5 w-5 shrink-0 accent-anchor-gold-bright"
            />
            <label htmlFor="isTestSession" className={fieldLabelClass}>
                This is a test session
            </label>
          </div>
        </form>
      </Modal>

      {/* Typed-confirm delete-session modal */}
      <Modal
        isOpen={deleteTarget !== null}
        onClose={handleCloseDelete}
        title={deleteTarget ? `Delete session "${deleteTarget.name}"?` : 'Delete session?'}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={handleCloseDelete} disabled={isDeleting}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleConfirmDelete}
              disabled={!isDeleteConfirmed || isDeleting}
            >
              {isDeleting ? 'Deleting…' : 'Delete'}
            </Button>
          </>
        }
      >
        {deleteTarget && (
          <div className="flex flex-col gap-4">
            {deleteError && (
              <div className={ERROR_PANEL}>
                {deleteError}
              </div>
            )}
            <p>
              This will permanently delete the session and all of its games. This action cannot be undone.
            </p>
            <p className="text-sm text-anchor-sage">
              Sessions with started or completed games, or with recorded winners, cannot be deleted.
            </p>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="confirmDeleteSession" className={fieldLabelClass}>
                Type the session name <span className="text-anchor-gold-bright">{deleteTarget.name}</span> to confirm:
              </label>
              <Input
                id="confirmDeleteSession"
                type="text"
                value={deleteTyped}
                onChange={(e) => setDeleteTyped(e.target.value)}
                placeholder={deleteTarget.name}
                autoFocus
              />
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
