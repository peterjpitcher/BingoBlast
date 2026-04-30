"use client";

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Database } from '@/types/database';
import { createSession, deleteSession, duplicateSession, updateSession } from './actions';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { Input } from '@/components/ui/input';
import Link from 'next/link';
import { cn } from '@/lib/utils';

type Session = Database['public']['Tables']['sessions']['Row'];

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

  const getStatusBadge = (status: string) => {
    const styles = {
      draft: "bg-slate-700 text-slate-300",
      ready: "bg-blue-900/50 text-blue-300 border-blue-800",
      running: "bg-green-900/50 text-green-300 border-green-800 animate-pulse",
      completed: "bg-slate-800 text-slate-500",
    };
    return cn("px-2.5 py-0.5 rounded-full text-xs font-medium border border-transparent", styles[status as keyof typeof styles] || styles.draft);
  };

  const isDeleteConfirmed = deleteTarget !== null && deleteTyped === deleteTarget.name;

  return (
    <>
      <Card className="bg-slate-900 border-slate-800">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Sessions</CardTitle>
          <Button onClick={handleShowCreate}>
            + New Session
          </Button>
        </CardHeader>
        <CardContent>
          {actionError && !showSessionModal && (
            <div className="mb-4 rounded border border-red-800 bg-red-900/40 p-3 text-sm text-red-200">
              {actionError}
            </div>
          )}
          {sessions.length === 0 ? (
            <div className="text-center py-12 text-slate-500">
              <p>No sessions found. Create one to get started.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400">
                    <th className="h-12 px-4 font-medium">Name</th>
                    <th className="h-12 px-4 font-medium">Date</th>
                    <th className="h-12 px-4 font-medium">Status</th>
                    <th className="h-12 px-4 font-medium">Type</th>
                    <th className="h-12 px-4 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((session) => (
                    <tr key={session.id} className="border-b border-slate-800/50 hover:bg-slate-800/50 transition-colors">
                      <td className="p-4 font-medium text-white">{session.name}</td>
                      <td className="p-4 text-slate-300">{session.start_date}</td>
                      <td className="p-4">
                        <span className={getStatusBadge(session.status)}>
                          {session.status.toUpperCase()}
                        </span>
                      </td>
                      <td className="p-4">
                        {session.is_test_session && (
                          <span className="px-2 py-0.5 rounded-full bg-cyan-900/30 text-cyan-300 text-xs border border-cyan-800">
                            TEST
                          </span>
                        )}
                      </td>
                      <td className="p-4 text-right space-x-2">
                        <Link href={`/admin/sessions/${session.id}`}>
                          <Button variant="outline" size="sm">
                            Manage
                          </Button>
                        </Link>
                        <Button variant="ghost" size="sm" onClick={() => handleShowEdit(session)}>
                          Edit
                        </Button>
                        <Button variant="secondary" size="sm" onClick={() => handleDuplicate(session.id)}>
                          Copy
                        </Button>
                        <Button variant="danger" size="sm" onClick={() => handleShowDelete(session)}>
                          Delete
                        </Button>
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
        isOpen={showSessionModal}
        onClose={handleClose}
        title={editingSession ? "Edit Session" : "Create New Session"}
        footer={
            <>
                <Button variant="ghost" onClick={handleClose} disabled={isSubmitting}>
                  Cancel
                </Button>
                <Button form="sessionForm" type="submit" disabled={isSubmitting}>
                  {isSubmitting ? 'Saving...' : (editingSession ? 'Save Changes' : 'Create Session')}
                </Button>
            </>
        }
      >
        <form
          key={editingSession?.id || 'new-session'}
          id="sessionForm"
          onSubmit={handleSessionSubmit}
          className="space-y-4"
        >
          {actionError && (
            <div className="p-3 text-sm text-red-200 bg-red-900/50 border border-red-800 rounded-md">
              {actionError}
            </div>
          )}

          <div className="space-y-2">
            <label htmlFor="sessionName" className="text-sm font-medium text-slate-300">Session Name</label>
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

          <div className="space-y-2">
            <label htmlFor="sessionNotes" className="text-sm font-medium text-slate-300">Notes (Optional)</label>
            <textarea
              id="sessionNotes"
              name="notes"
              defaultValue={editingSession?.notes || ""}
              rows={3}
              className="flex w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bingo-primary disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>

          <div className="flex items-center space-x-2">
            <input
                type="checkbox"
                id="isTestSession"
                name="is_test_session"
                defaultChecked={editingSession?.is_test_session || false}
                className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-bingo-primary focus:ring-bingo-primary"
            />
            <label htmlFor="isTestSession" className="text-sm font-medium text-slate-300">
                This is a Test Session
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
            <Button variant="ghost" onClick={handleCloseDelete} disabled={isDeleting}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={handleConfirmDelete}
              disabled={!isDeleteConfirmed || isDeleting}
            >
              {isDeleting ? 'Deleting…' : 'Delete'}
            </Button>
          </>
        }
      >
        {deleteTarget && (
          <div className="space-y-4">
            {deleteError && (
              <div className="p-3 text-sm text-red-200 bg-red-900/50 border border-red-800 rounded-md">
                {deleteError}
              </div>
            )}
            <p className="text-sm text-white/85">
              This will permanently delete the session and all of its games. This action cannot be undone.
            </p>
            <p className="text-sm text-white/85">
              Sessions with started or completed games, or with recorded winners, cannot be deleted.
            </p>
            <div className="space-y-2">
              <label htmlFor="confirmDeleteSession" className="text-sm font-medium text-white/85">
                Type the session name <span className="font-mono text-white">{deleteTarget.name}</span> to confirm:
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
