# Review Pack: live-event-reliability

**Generated:** 2026-04-30
**Mode:** B (A=Adversarial / B=Code / C=Spec Compliance)
**Project root:** `/Users/peterpitcher/Cursor/OJ-CashBingo`
**Base ref:** `ea505e1`
**HEAD:** `c5cffbe`
**Diff range:** `ea505e1...HEAD`
**Stats:**  32 files changed, 2139 insertions(+), 744 deletions(-)

> This pack is the sole input for reviewers. Do NOT read files outside it unless a specific finding requires verification. If a file not in the pack is needed, mark the finding `Needs verification` and describe what would resolve it.

## Changed Files

```
docs/schema.sql
src/app/admin/actions.ts
src/app/admin/dashboard.tsx
src/app/admin/sessions/[id]/actions.ts
src/app/admin/sessions/[id]/session-detail.tsx
src/app/display/[sessionId]/display-ui.tsx
src/app/display/[sessionId]/page.tsx
src/app/host/[sessionId]/[gameId]/game-control.tsx
src/app/host/actions.ts
src/app/login/actions.ts
src/app/login/page.tsx
src/app/player/[sessionId]/page.tsx
src/app/player/[sessionId]/player-ui.tsx
src/components/connection-banner.tsx
src/components/ui/button.tsx
src/components/ui/modal.tsx
src/hooks/use-connection-health.ts
src/lib/connection-health.test.ts
src/lib/connection-health.ts
src/lib/game-state-version.test.ts
src/lib/game-state-version.ts
src/lib/log-error.test.ts
src/lib/log-error.ts
src/lib/prize-validation.test.ts
src/lib/prize-validation.ts
src/lib/win-stages.test.ts
src/lib/win-stages.ts
src/proxy.ts
src/types/database.ts
supabase/migrations/20260430120000_add_state_version.sql
supabase/migrations/20260430120100_set_call_delay_default_2.sql
supabase/migrations/20260430120200_backfill_call_delay_to_2.sql
```

## User Concerns

Verify host-instant timing, state_version freshness, anonymous winner flow, connection banner Date.now purity, admin per-game prize lock, multi-winner support (NO unique constraint), proxy matcher safety, and migration safety. Find anything that could break the next live event.

## Diff (`ea505e1...HEAD`)

```diff
diff --git a/docs/schema.sql b/docs/schema.sql
index 9fa78f8..d229d4b 100644
--- a/docs/schema.sql
+++ b/docs/schema.sql
@@ -107,7 +107,7 @@ create table public.game_states (
   numbers_called_count int default 0,
   current_stage_index int default 0,
   status game_status default 'not_started'::game_status,
-  call_delay_seconds int default 1,
+  call_delay_seconds int default 2,
   on_break boolean default false,
   paused_for_validation boolean default false,
   display_win_type text default null, -- 'line', 'two_lines', 'full_house', 'snowball'
@@ -118,7 +118,8 @@ create table public.game_states (
   started_at timestamptz,
   ended_at timestamptz,
   last_call_at timestamptz,
-  updated_at timestamptz default now()
+  updated_at timestamptz default now(),
+  state_version bigint not null default 0 -- Monotonic counter bumped on every update; used to order Realtime/polling snapshots
 );
 alter table public.game_states enable row level security;
 create policy "Hosts/Admins can read game state" on public.game_states for select using (
@@ -144,7 +145,7 @@ create table public.game_states_public (
   numbers_called_count int default 0,
   current_stage_index int default 0,
   status game_status default 'not_started'::game_status,
-  call_delay_seconds int default 1,
+  call_delay_seconds int default 2,
   on_break boolean default false,
   paused_for_validation boolean default false,
   display_win_type text default null,
@@ -153,7 +154,8 @@ create table public.game_states_public (
   started_at timestamptz,
   ended_at timestamptz,
   last_call_at timestamptz,
-  updated_at timestamptz default now()
+  updated_at timestamptz default now(),
+  state_version bigint not null default 0 -- Mirror of game_states.state_version; copied by sync trigger
 );
 alter table public.game_states_public enable row level security;
 create policy "Read access for all" on public.game_states_public for select using (true);
@@ -181,7 +183,8 @@ begin
     started_at,
     ended_at,
     last_call_at,
-    updated_at
+    updated_at,
+    state_version
   ) values (
     new.game_id,
     new.called_numbers,
@@ -197,7 +200,8 @@ begin
     new.started_at,
     new.ended_at,
     new.last_call_at,
-    new.updated_at
+    new.updated_at,
+    new.state_version
   )
   on conflict (game_id) do update set
     called_numbers = excluded.called_numbers,
@@ -213,7 +217,8 @@ begin
     started_at = excluded.started_at,
     ended_at = excluded.ended_at,
     last_call_at = excluded.last_call_at,
-    updated_at = excluded.updated_at;
+    updated_at = excluded.updated_at,
+    state_version = excluded.state_version;
 
   return new;
 end;
@@ -227,6 +232,22 @@ create trigger on_game_states_delete
 after delete on public.game_states
 for each row execute procedure public.sync_game_states_public();
 
+-- Bump state_version on every update to game_states so consumers can order
+-- realtime/polling snapshots (updated_at is not reliably maintained).
+create or replace function public.bump_game_state_version()
+returns trigger as $$
+begin
+  if tg_op = 'UPDATE' then
+    new.state_version := coalesce(old.state_version, 0) + 1;
+  end if;
+  return new;
+end;
+$$ language plpgsql;
+
+create trigger bump_game_state_version
+before update on public.game_states
+for each row execute function public.bump_game_state_version();
+
 -- Enable Realtime for game_states_public (public display/player sync)
 alter publication supabase_realtime add table public.game_states_public;
 
diff --git a/src/app/admin/actions.ts b/src/app/admin/actions.ts
index 1d90504..7835a91 100644
--- a/src/app/admin/actions.ts
+++ b/src/app/admin/actions.ts
@@ -2,7 +2,7 @@
 
 import { createClient } from '@/utils/supabase/server'
 import { revalidatePath } from 'next/cache'
-import type { Database, SessionStatus, UserRole } from '@/types/database'
+import type { Database, GameStatus, UserRole } from '@/types/database'
 import type { ActionResult } from '@/types/actions'
 import type { SupabaseClient, User } from '@supabase/supabase-js'
 
@@ -110,15 +110,52 @@ export async function deleteSession(sessionId: string): Promise<ActionResult> {
   const authResult = await authorizeAdmin(supabase)
   if (!authResult.authorized) return { success: false, error: authResult.error }
 
-  // Check if session is running
-  const { data: session } = await supabase
+  // Reject deletion if any game in this session has been started. We look up
+  // the game ids first, then check their game_states rows for any status
+  // other than 'not_started'.
+  const { data: gamesInSession, error: gamesError } = await supabase
     .from('sessions')
-    .select('status')
+    .select('id, games(id)')
     .eq('id', sessionId)
-    .single<{ status: SessionStatus }>()
+    .single<{ id: string; games: { id: string }[] | null }>()
 
-  if (session?.status === 'running') {
-    return { success: false, error: "Cannot delete a running session. Please end the session first." }
+  if (gamesError || !gamesInSession) {
+    return { success: false, error: gamesError?.message || 'Session not found.' }
+  }
+
+  const gameIds = (gamesInSession.games ?? []).map((g) => g.id)
+
+  if (gameIds.length > 0) {
+    const { data: startedStates, error: startedError } = await supabase
+      .from('game_states')
+      .select('status')
+      .in('game_id', gameIds)
+      .neq('status', 'not_started')
+      .limit(1)
+
+    if (startedError) {
+      return { success: false, error: startedError.message }
+    }
+    if (startedStates && startedStates.length > 0) {
+      const status = (startedStates[0] as { status: GameStatus }).status
+      return {
+        success: false,
+        error: `Cannot delete a session containing a ${status} game.`,
+      }
+    }
+  }
+
+  // Reject deletion if there are any winners recorded against this session.
+  const { count: winnerCount, error: winnerCountError } = await supabase
+    .from('winners')
+    .select('id', { count: 'exact', head: true })
+    .eq('session_id', sessionId)
+
+  if (winnerCountError) {
+    return { success: false, error: winnerCountError.message }
+  }
+  if ((winnerCount ?? 0) > 0) {
+    return { success: false, error: 'Cannot delete a session that has recorded winners.' }
   }
 
   const { error } = await supabase
diff --git a/src/app/admin/dashboard.tsx b/src/app/admin/dashboard.tsx
index 391746b..2396e9c 100644
--- a/src/app/admin/dashboard.tsx
+++ b/src/app/admin/dashboard.tsx
@@ -24,6 +24,12 @@ export default function AdminDashboard({ sessions }: AdminDashboardProps) {
   const [isSubmitting, setIsSubmitting] = useState(false);
   const [actionError, setActionError] = useState<string | null>(null);
 
+  // Typed-confirm delete-session modal state
+  const [deleteTarget, setDeleteTarget] = useState<Session | null>(null);
+  const [deleteTyped, setDeleteTyped] = useState('');
+  const [isDeleting, setIsDeleting] = useState(false);
+  const [deleteError, setDeleteError] = useState<string | null>(null);
+
   const handleClose = () => {
     setShowSessionModal(false);
     setEditingSession(null);
@@ -62,15 +68,31 @@ export default function AdminDashboard({ sessions }: AdminDashboardProps) {
     }
   }
 
-  async function handleDelete(id: string) {
-    if (confirm('Are you sure you want to delete this session? This cannot be undone.')) {
-        const result = await deleteSession(id);
-        if (!result?.success) {
-            setActionError(result?.error || "Failed to delete session.");
-        } else {
-            router.refresh();
-        }
+  function handleShowDelete(session: Session) {
+    setDeleteTarget(session);
+    setDeleteTyped('');
+    setDeleteError(null);
+  }
+
+  function handleCloseDelete() {
+    setDeleteTarget(null);
+    setDeleteTyped('');
+    setDeleteError(null);
+    setIsDeleting(false);
+  }
+
+  async function handleConfirmDelete() {
+    if (!deleteTarget) return;
+    setIsDeleting(true);
+    setDeleteError(null);
+    const result = await deleteSession(deleteTarget.id);
+    setIsDeleting(false);
+    if (!result?.success) {
+      setDeleteError(result?.error || "Failed to delete session.");
+      return;
     }
+    handleCloseDelete();
+    router.refresh();
   }
 
   async function handleDuplicate(id: string) {
@@ -94,6 +116,8 @@ export default function AdminDashboard({ sessions }: AdminDashboardProps) {
     return cn("px-2.5 py-0.5 rounded-full text-xs font-medium border border-transparent", styles[status as keyof typeof styles] || styles.draft);
   };
 
+  const isDeleteConfirmed = deleteTarget !== null && deleteTyped === deleteTarget.name;
+
   return (
     <>
       <Card className="bg-slate-900 border-slate-800">
@@ -144,17 +168,17 @@ export default function AdminDashboard({ sessions }: AdminDashboardProps) {
                       </td>
                       <td className="p-4 text-right space-x-2">
                         <Link href={`/admin/sessions/${session.id}`}>
-                          <Button variant="outline" size="sm" className="h-8">
+                          <Button variant="outline" size="sm">
                             Manage
                           </Button>
                         </Link>
-                        <Button variant="ghost" size="sm" className="h-8" onClick={() => handleShowEdit(session)}>
+                        <Button variant="ghost" size="sm" onClick={() => handleShowEdit(session)}>
                           Edit
                         </Button>
-                        <Button variant="secondary" size="sm" className="h-8" onClick={() => handleDuplicate(session.id)}>
+                        <Button variant="secondary" size="sm" onClick={() => handleDuplicate(session.id)}>
                           Copy
                         </Button>
-                        <Button variant="danger" size="sm" className="h-8" onClick={() => handleDelete(session.id)}>
+                        <Button variant="danger" size="sm" onClick={() => handleShowDelete(session)}>
                           Delete
                         </Button>
                       </td>
@@ -167,9 +191,9 @@ export default function AdminDashboard({ sessions }: AdminDashboardProps) {
         </CardContent>
       </Card>
 
-      <Modal 
-        isOpen={showSessionModal} 
-        onClose={handleClose} 
+      <Modal
+        isOpen={showSessionModal}
+        onClose={handleClose}
         title={editingSession ? "Edit Session" : "Create New Session"}
         footer={
             <>
@@ -193,23 +217,23 @@ export default function AdminDashboard({ sessions }: AdminDashboardProps) {
               {actionError}
             </div>
           )}
-          
+
           <div className="space-y-2">
             <label htmlFor="sessionName" className="text-sm font-medium text-slate-300">Session Name</label>
-            <Input 
+            <Input
               id="sessionName"
-              type="text" 
+              type="text"
               name="name"
-              placeholder="e.g. Friday Cash Bingo" 
+              placeholder="e.g. Friday Cash Bingo"
               defaultValue={editingSession?.name || ""}
-              required 
+              required
               autoFocus
             />
           </div>
 
           <div className="space-y-2">
             <label htmlFor="sessionNotes" className="text-sm font-medium text-slate-300">Notes (Optional)</label>
-            <textarea 
+            <textarea
               id="sessionNotes"
               name="notes"
               defaultValue={editingSession?.notes || ""}
@@ -219,9 +243,9 @@ export default function AdminDashboard({ sessions }: AdminDashboardProps) {
           </div>
 
           <div className="flex items-center space-x-2">
-            <input 
-                type="checkbox" 
-                id="isTestSession" 
+            <input
+                type="checkbox"
+                id="isTestSession"
                 name="is_test_session"
                 defaultChecked={editingSession?.is_test_session || false}
                 className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-bingo-primary focus:ring-bingo-primary"
@@ -232,6 +256,56 @@ export default function AdminDashboard({ sessions }: AdminDashboardProps) {
           </div>
         </form>
       </Modal>
+
+      {/* Typed-confirm delete-session modal */}
+      <Modal
+        isOpen={deleteTarget !== null}
+        onClose={handleCloseDelete}
+        title={deleteTarget ? `Delete session "${deleteTarget.name}"?` : 'Delete session?'}
+        footer={
+          <>
+            <Button variant="ghost" onClick={handleCloseDelete} disabled={isDeleting}>
+              Cancel
+            </Button>
+            <Button
+              variant="danger"
+              onClick={handleConfirmDelete}
+              disabled={!isDeleteConfirmed || isDeleting}
+            >
+              {isDeleting ? 'Deleting…' : 'Delete'}
+            </Button>
+          </>
+        }
+      >
+        {deleteTarget && (
+          <div className="space-y-4">
+            {deleteError && (
+              <div className="p-3 text-sm text-red-200 bg-red-900/50 border border-red-800 rounded-md">
+                {deleteError}
+              </div>
+            )}
+            <p className="text-sm text-white/85">
+              This will permanently delete the session and all of its games. This action cannot be undone.
+            </p>
+            <p className="text-sm text-white/85">
+              Sessions with started or completed games, or with recorded winners, cannot be deleted.
+            </p>
+            <div className="space-y-2">
+              <label htmlFor="confirmDeleteSession" className="text-sm font-medium text-white/85">
+                Type the session name <span className="font-mono text-white">{deleteTarget.name}</span> to confirm:
+              </label>
+              <Input
+                id="confirmDeleteSession"
+                type="text"
+                value={deleteTyped}
+                onChange={(e) => setDeleteTyped(e.target.value)}
+                placeholder={deleteTarget.name}
+                autoFocus
+              />
+            </div>
+          </div>
+        )}
+      </Modal>
     </>
   );
 }
diff --git a/src/app/admin/sessions/[id]/actions.ts b/src/app/admin/sessions/[id]/actions.ts
index 96000f1..48e8453 100644
--- a/src/app/admin/sessions/[id]/actions.ts
+++ b/src/app/admin/sessions/[id]/actions.ts
@@ -2,9 +2,10 @@
 
 import { createClient } from '@/utils/supabase/server'
 import { revalidatePath } from 'next/cache'
-import type { Database, GameType, WinStage, GameStatus, SessionStatus, UserRole } from '@/types/database'
+import type { Database, GameType, WinStage, GameStatus, UserRole } from '@/types/database'
 import type { ActionResult } from '@/types/actions'
 import type { SupabaseClient, User } from '@supabase/supabase-js'
+import { validateGamePrizes } from '@/lib/prize-validation'
 
 type GameInsert = Database['public']['Tables']['games']['Insert']
 
@@ -80,12 +81,25 @@ export async function createGame(sessionId: string, _prevState: unknown, formDat
     return { success: false, error: 'Snowball games must be linked to a snowball pot.' }
   }
 
-  const prizes: Record<string, string> = {}
+  // Trim every prize before saving. Empty/whitespace-only values are dropped
+  // so the validation helper sees a clean view.
+  const prizes: Partial<Record<WinStage, string>> = {}
   stage_sequence.forEach((stage) => {
-    const prize = formData.get(`prize_${stage}`) as string
-    if (prize) prizes[stage] = prize
+    const raw = formData.get(`prize_${stage}`)
+    if (typeof raw === 'string') {
+      const trimmed = raw.trim()
+      if (trimmed.length > 0) prizes[stage] = trimmed
+    }
   })
 
+  const validation = validateGamePrizes({ type, stage_sequence, prizes })
+  if (!validation.valid) {
+    return {
+      success: false,
+      error: `${name}: prize required for ${validation.missingStages.join(', ')}`,
+    }
+  }
+
   const newGame: GameInsert = {
     session_id: sessionId,
     name,
@@ -115,27 +129,31 @@ export async function updateGame(gameId: string, sessionId: string, _prevState:
   const authResult = await authorizeAdmin(supabase)
   if (!authResult.authorized) return { success: false, error: authResult.error }
 
-  // 1. Fetch original game and session status
+  // 1. Fetch original game and the per-game live status. The lock is
+  // per-game (game_states.status), not session-level, so future not_started
+  // games inside a running session remain editable.
   const { data: originalGame, error: fetchGameError } = await supabase
     .from('games')
-    .select('type, snowball_pot_id, stage_sequence')
+    .select('type, snowball_pot_id, stage_sequence, prizes')
     .eq('id', gameId)
-    .single<Pick<Database['public']['Tables']['games']['Row'], 'type' | 'snowball_pot_id' | 'stage_sequence'>>()
+    .single<Pick<Database['public']['Tables']['games']['Row'], 'type' | 'snowball_pot_id' | 'stage_sequence' | 'prizes'>>()
 
   if (fetchGameError || !originalGame) {
     return { success: false, error: fetchGameError?.message || "Original game not found." }
   }
 
-  const { data: session, error: fetchSessionError } = await supabase
-    .from('sessions')
+  const { data: gameStateRow, error: gameStateError } = await supabase
+    .from('game_states')
     .select('status')
-    .eq('id', sessionId)
-    .single<{ status: SessionStatus }>()
+    .eq('game_id', gameId)
+    .maybeSingle<{ status: GameStatus }>()
 
-  if (fetchSessionError || !session) {
-    return { success: false, error: fetchSessionError?.message || "Session not found." }
+  if (gameStateError) {
+    return { success: false, error: gameStateError.message }
   }
 
+  const isLocked = gameStateRow ? gameStateRow.status !== 'not_started' : false
+
   const name = (formData.get('name') as string)?.trim()
   const game_index = Number.parseInt(formData.get('game_index') as string, 10)
   const background_colour = formData.get('background_colour') as string
@@ -162,25 +180,49 @@ export async function updateGame(gameId: string, sessionId: string, _prevState:
     return { success: false, error: 'Snowball games must be linked to a snowball pot.' }
   }
 
-  // 2. Enforce rules if session is running
-  if (session.status === 'running') {
-    if (type !== originalGame.type) {
-      return { success: false, error: "Cannot change game type while session is running." }
-    }
-    if ((type === 'snowball' ? snowball_pot_id : null) !== originalGame.snowball_pot_id) {
-      return { success: false, error: "Cannot change snowball pot while session is running." }
+  // Trim prizes before saving and validation.
+  const prizes: Partial<Record<WinStage, string>> = {}
+  stage_sequence.forEach((stage) => {
+    const raw = formData.get(`prize_${stage}`)
+    if (typeof raw === 'string') {
+      const trimmed = raw.trim()
+      if (trimmed.length > 0) prizes[stage] = trimmed
     }
-    // Compare stage_sequence as JSON strings or deep equality
+  })
+
+  // 2. If the game has already started, lock the structural and prize fields.
+  // Reject any attempt to edit prizes, type, snowball_pot_id, or stage_sequence.
+  if (isLocked) {
+    const desiredSnowballPotId = type === 'snowball' ? snowball_pot_id : null
+    const originalPrizes = (originalGame.prizes as Partial<Record<WinStage, string>> | null) ?? {}
+
+    const lockedFields: string[] = []
+    if (type !== originalGame.type) lockedFields.push('type')
+    if (desiredSnowballPotId !== originalGame.snowball_pot_id) lockedFields.push('snowball_pot_id')
     if (JSON.stringify(stage_sequence) !== JSON.stringify(originalGame.stage_sequence)) {
-      return { success: false, error: "Cannot change stage sequence while session is running." }
+      lockedFields.push('stage_sequence')
+    }
+    if (JSON.stringify(prizes) !== JSON.stringify(originalPrizes)) {
+      lockedFields.push('prizes')
+    }
+
+    if (lockedFields.length > 0) {
+      return {
+        success: false,
+        error: `Cannot edit ${lockedFields.join(', ')} on a started game`,
+      }
     }
   }
 
-  const prizes: Record<string, string> = {}
-  stage_sequence.forEach((stage) => {
-    const prize = formData.get(`prize_${stage}`) as string
-    if (prize) prizes[stage] = prize
-  })
+  // 3. Validate prizes after the lock check (so the error message is the
+  // lock message, not a missing-prize message, when both apply).
+  const validation = validateGamePrizes({ type, stage_sequence, prizes })
+  if (!validation.valid) {
+    return {
+      success: false,
+      error: `${name}: prize required for ${validation.missingStages.join(', ')}`,
+    }
+  }
 
   const { data: updatedGame, error } = await supabase
     .from('games')
@@ -189,9 +231,9 @@ export async function updateGame(gameId: string, sessionId: string, _prevState:
       game_index,
       background_colour,
       notes,
-      type, // Will be same as original if running
-      snowball_pot_id: type === 'snowball' ? snowball_pot_id : null, // Will be same as original if running
-      stage_sequence, // Will be same as original if running
+      type,
+      snowball_pot_id: type === 'snowball' ? snowball_pot_id : null,
+      stage_sequence,
       prizes,
     })
     .eq('id', gameId)
@@ -263,19 +305,38 @@ export async function deleteGame(gameId: string, sessionId: string): Promise<Act
   const authResult = await authorizeAdmin(supabase)
   if (!authResult.authorized) return { success: false, error: authResult.error }
 
-  // Check if game is in progress
-  const { data: gameState } = await supabase
+  // Allow deletion only when the game has no state row, OR the state row is
+  // 'not_started'. A missing row means the game has never been started.
+  const { data: gameState, error: gameStateError } = await supabase
     .from('game_states')
     .select('status')
     .eq('game_id', gameId)
-    .single<{ status: GameStatus }>()
+    .maybeSingle<{ status: GameStatus }>()
+
+  if (gameStateError) {
+    return { success: false, error: gameStateError.message }
+  }
+
+  if (gameState && gameState.status !== 'not_started') {
+    return {
+      success: false,
+      error: `Cannot delete a game with status ${gameState.status}.`,
+    }
+  }
+
+  // Reject deletion if the game has any recorded winners. This protects
+  // historical results even when the live state has been reset.
+  const { count: winnerCount, error: winnerCountError } = await supabase
+    .from('winners')
+    .select('id', { count: 'exact', head: true })
+    .eq('game_id', gameId)
 
-  if (gameState?.status === 'in_progress') {
-    return { success: false, error: "Cannot delete a game that is currently in progress." }
+  if (winnerCountError) {
+    return { success: false, error: winnerCountError.message }
   }
 
-  if (gameState?.status === 'completed') {
-    return { success: false, error: "Cannot delete a completed game." }
+  if ((winnerCount ?? 0) > 0) {
+    return { success: false, error: 'Cannot delete a game that has recorded winners.' }
   }
 
   const { error } = await supabase
@@ -309,15 +370,27 @@ export async function updateSessionStatus(sessionId: string, status: 'ready' | '
   return { success: true }
 }
 
-export async function resetSession(sessionId: string): Promise<ActionResult> {
+export async function resetSession(sessionId: string, confirmationText: string): Promise<ActionResult> {
   const supabase = await createClient()
   const authResult = await authorizeAdmin(supabase)
   if (!authResult.authorized) return { success: false, error: authResult.error }
 
-  // Check if session is running
+  // Read the session so we can validate the typed confirmation against the
+  // session's name. Either 'RESET' or the session name is accepted.
+  const { data: session, error: sessionError } = await supabase
+    .from('sessions')
+    .select('id, name')
+    .eq('id', sessionId)
+    .single<{ id: string; name: string }>()
 
+  if (sessionError || !session) {
+    return { success: false, error: sessionError?.message || 'Session not found.' }
+  }
 
-  // Removed blocking check for running session to allow "Unlock" functionality
+  const typed = (confirmationText ?? '').trim()
+  if (typed !== 'RESET' && typed !== session.name) {
+    return { success: false, error: 'Type RESET or the session name to confirm.' }
+  }
 
   // 1. Get all game IDs for this session to clean up game_states
   const { data: games } = await supabase
@@ -328,7 +401,7 @@ export async function resetSession(sessionId: string): Promise<ActionResult> {
   if (games && games.length > 0) {
     const gameIds = games.map((g: { id: string }) => g.id)
 
-    // 2. Delete game_states
+    // 2. Delete game_states (idempotent: a missing row is fine).
     const { error: deleteStatesError } = await supabase
       .from('game_states')
       .delete()
@@ -339,7 +412,7 @@ export async function resetSession(sessionId: string): Promise<ActionResult> {
     }
   }
 
-  // 3. Delete winners
+  // 3. Delete winners (idempotent).
   const { error: deleteWinnersError } = await supabase
     .from('winners')
     .delete()
diff --git a/src/app/admin/sessions/[id]/session-detail.tsx b/src/app/admin/sessions/[id]/session-detail.tsx
index 2418f01..52e913f 100644
--- a/src/app/admin/sessions/[id]/session-detail.tsx
+++ b/src/app/admin/sessions/[id]/session-detail.tsx
@@ -1,13 +1,14 @@
 "use client";
 
-import React, { useState, useEffect } from 'react';
-import { Database, GameType } from '@/types/database';
+import React, { useState, useEffect, useMemo } from 'react';
+import { Database, GameType, WinStage, GameStatus } from '@/types/database';
 import { createGame, deleteGame, duplicateGame, updateSessionStatus, updateGame, resetSession } from './actions';
 import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
 import { Button } from '@/components/ui/button';
 import { Modal } from '@/components/ui/modal';
 import { Input } from '@/components/ui/input';
-import { useRouter } from 'next/navigation'; // Import useRouter
+import { useRouter } from 'next/navigation';
+import { validateGamePrizes } from '@/lib/prize-validation';
 
 type Session = Database['public']['Tables']['sessions']['Row'];
 type GameState = Database['public']['Tables']['game_states']['Row'];
@@ -26,6 +27,16 @@ interface SessionDetailProps {
   winners: WinnerWithGame[];
 }
 
+/** Read the `game_states.status` off a game row, regardless of join shape. */
+function readGameStatus(game: Game): GameStatus | null {
+  const gs = game.game_states;
+  if (!gs) return null;
+  if (Array.isArray(gs)) return gs[0]?.status ?? null;
+  return gs.status;
+}
+
+const STANDARD_STAGES: WinStage[] = ['Line', 'Two Lines', 'Full House'];
+
 export default function SessionDetail({ session, initialGames, snowballPots, winners }: SessionDetailProps) {
   const [games, setGames] = useState<Game[]>(initialGames);
   const [showGameModal, setShowGameModal] = useState(false);
@@ -33,12 +44,26 @@ export default function SessionDetail({ session, initialGames, snowballPots, win
   const [isSubmitting, setIsSubmitting] = useState(false);
   const [actionError, setActionError] = useState<string | null>(null);
   const [backgroundColor, setBackgroundColor] = useState<string>('#ffffff');
-  
-  // Form State
+
+  // Form state
   const [selectedGameType, setSelectedGameType] = useState<GameType>('standard');
-  const [selectedStages, setSelectedStages] = useState<string[]>(['Line', 'Two Lines', 'Full House']);
+  const [selectedStages, setSelectedStages] = useState<WinStage[]>(['Line', 'Two Lines', 'Full House']);
+  const [prizeDraft, setPrizeDraft] = useState<Partial<Record<WinStage, string>>>({});
+  const [missingPrizeStages, setMissingPrizeStages] = useState<WinStage[]>([]);
 
-  const router = useRouter(); // Initialize useRouter
+  // Typed-confirm delete-game modal state
+  const [deleteGameTarget, setDeleteGameTarget] = useState<Game | null>(null);
+  const [deleteGameTyped, setDeleteGameTyped] = useState('');
+  const [isDeletingGame, setIsDeletingGame] = useState(false);
+  const [deleteGameError, setDeleteGameError] = useState<string | null>(null);
+
+  // Typed-confirm reset-session modal state
+  const [showResetModal, setShowResetModal] = useState(false);
+  const [resetTyped, setResetTyped] = useState('');
+  const [isResetting, setIsResetting] = useState(false);
+  const [resetError, setResetError] = useState<string | null>(null);
+
+  const router = useRouter();
 
   useEffect(() => {
     setGames(initialGames);
@@ -50,6 +75,18 @@ export default function SessionDetail({ session, initialGames, snowballPots, win
 
   const nextIndex = games.length > 0 ? Math.max(...games.map(g => g.game_index)) + 1 : 1;
 
+  // Per-game lock: a game is locked once it has started (in_progress) or
+  // completed. Prize/structural fields cannot be edited; deletion is blocked.
+  const editingGameStatus = editingGame ? readGameStatus(editingGame) : null;
+  const isGameLocked =
+    editingGameStatus === 'in_progress' || editingGameStatus === 'completed';
+
+  // Stages that need a prize for the current draft. Reused for inline validation.
+  const requiredStages: WinStage[] = useMemo(() => {
+    if (selectedGameType === 'jackpot') return [];
+    if (selectedGameType === 'snowball') return ['Full House'];
+    return selectedStages;
+  }, [selectedGameType, selectedStages]);
 
   const handleClose = () => {
     setShowGameModal(false);
@@ -58,42 +95,77 @@ export default function SessionDetail({ session, initialGames, snowballPots, win
     setSelectedGameType('standard');
     setSelectedStages(['Line', 'Two Lines', 'Full House']);
     setBackgroundColor('#ffffff');
+    setPrizeDraft({});
+    setMissingPrizeStages([]);
   };
 
   const handleShowAdd = () => {
-      setEditingGame(null);
-      setSelectedGameType('standard');
-      setSelectedStages(['Line', 'Two Lines', 'Full House']);
-      setBackgroundColor('#ffffff');
-      setShowGameModal(true);
+    setEditingGame(null);
+    setSelectedGameType('standard');
+    setSelectedStages(['Line', 'Two Lines', 'Full House']);
+    setBackgroundColor('#ffffff');
+    setPrizeDraft({});
+    setMissingPrizeStages([]);
+    setShowGameModal(true);
   };
 
   const handleShowEdit = (game: Game) => {
-      setEditingGame(game);
-      setSelectedGameType(game.type);
-      setSelectedStages(game.stage_sequence);
-      setBackgroundColor(game.background_colour || '#ffffff');
-      setShowGameModal(true);
+    setEditingGame(game);
+    setSelectedGameType(game.type);
+    setSelectedStages(game.stage_sequence);
+    setBackgroundColor(game.background_colour || '#ffffff');
+    const initialPrizes: Partial<Record<WinStage, string>> = {};
+    game.stage_sequence.forEach((stage) => {
+      const value = game.prizes?.[stage];
+      if (typeof value === 'string') initialPrizes[stage] = value;
+    });
+    setPrizeDraft(initialPrizes);
+    setMissingPrizeStages([]);
+    setShowGameModal(true);
   };
 
-  const handleStageChange = (stage: string) => {
-      setSelectedStages(prev => 
-          prev.includes(stage) ? prev.filter(s => s !== stage) : [...prev, stage]
-      );
+  const handleStageChange = (stage: WinStage) => {
+    setSelectedStages((prev) =>
+      prev.includes(stage) ? prev.filter((s) => s !== stage) : [...prev, stage]
+    );
+    // Clear any stale prize-missing badge for the toggled stage.
+    setMissingPrizeStages((prev) => prev.filter((s) => s !== stage));
+  };
+
+  const handlePrizeChange = (stage: WinStage, value: string) => {
+    setPrizeDraft((prev) => ({ ...prev, [stage]: value }));
+    if (value.trim().length > 0) {
+      setMissingPrizeStages((prev) => prev.filter((s) => s !== stage));
+    }
   };
 
   async function handleGameSubmit(event: React.FormEvent<HTMLFormElement>) {
     event.preventDefault();
+
+    // Inline prize validation. Mirrors the server-side check and surfaces
+    // missing stages on the form so the user does not have to round-trip.
+    const validation = validateGamePrizes({
+      type: selectedGameType,
+      stage_sequence: selectedStages,
+      prizes: prizeDraft,
+    });
+    if (!validation.valid) {
+      setMissingPrizeStages(validation.missingStages);
+      setActionError(`Prize required for ${validation.missingStages.join(', ')}.`);
+      return;
+    }
+    setMissingPrizeStages([]);
+
     setIsSubmitting(true);
     setActionError(null);
 
     const formData = new FormData(event.currentTarget);
-    
+
     let result;
     if (editingGame) {
-        result = await updateGame(editingGame.id, session.id, null, formData);
+      result = await updateGame(editingGame.id, session.id, null, formData);
     } else {
-        result = await createGame(session.id, null, formData);
+      result = await createGame(session.id, null, formData);
     }
 
     setIsSubmitting(false);
@@ -102,70 +174,104 @@ export default function SessionDetail({ session, initialGames, snowballPots, win
       setActionError(result?.error || "Failed to save game.");
     } else {
       handleClose();
-      router.refresh(); // Refresh after game changes
+      router.refresh();
     }
   }
 
-  async function handleDeleteGame(gameId: string) {
-      if (confirm("Delete this game?")) {
-          setActionError(null);
-          const result = await deleteGame(gameId, session.id);
-          if (!result?.success) {
-            setActionError(result?.error || "Failed to delete game.");
-            return;
-          }
-          router.refresh(); // Refresh after deleting game
-      }
+  function handleShowDeleteGame(game: Game) {
+    setDeleteGameTarget(game);
+    setDeleteGameTyped('');
+    setDeleteGameError(null);
+  }
+
+  function handleCloseDeleteGame() {
+    setDeleteGameTarget(null);
+    setDeleteGameTyped('');
+    setDeleteGameError(null);
+    setIsDeletingGame(false);
+  }
+
+  async function handleConfirmDeleteGame() {
+    if (!deleteGameTarget) return;
+    setIsDeletingGame(true);
+    setDeleteGameError(null);
+    const result = await deleteGame(deleteGameTarget.id, session.id);
+    setIsDeletingGame(false);
+    if (!result?.success) {
+      setDeleteGameError(result?.error || "Failed to delete game.");
+      return;
+    }
+    handleCloseDeleteGame();
+    router.refresh();
   }
 
   async function handleDuplicateGame(gameId: string) {
+    setActionError(null);
+    const result = await duplicateGame(gameId, session.id);
+    if (!result?.success) {
+      setActionError(result?.error || "Failed to clone game.");
+      return;
+    }
+    router.refresh();
+  }
+
+  async function handleMarkAsReady() {
+    if (confirm("Mark this session as Ready? It will be visible to hosts.")) {
       setActionError(null);
-      const result = await duplicateGame(gameId, session.id);
+      const result = await updateSessionStatus(session.id, 'ready');
       if (!result?.success) {
-        setActionError(result?.error || "Failed to clone game.");
+        setActionError(result?.error || "Failed to update session status.");
         return;
       }
-      router.refresh(); // Refresh after duplicating game
+      router.refresh();
+    }
   }
 
-  async function handleMarkAsReady() {
-      if (confirm("Mark this session as Ready? It will be visible to hosts.")) {
-          setActionError(null);
-          const result = await updateSessionStatus(session.id, 'ready');
-          if (!result?.success) {
-            setActionError(result?.error || "Failed to update session status.");
-            return;
-          }
-          router.refresh(); // Refresh after status change
+  async function handleStartSession() {
+    if (confirm("Ready to start this session? This will open it for the Host.")) {
+      setActionError(null);
+      const result = await updateSessionStatus(session.id, 'running');
+      if (!result?.success) {
+        setActionError(result?.error || "Failed to start session.");
+        return;
       }
+      router.refresh();
+    }
   }
 
-  async function handleStartSession() {
-      if (confirm("Ready to start this session? This will open it for the Host.")) {
-          setActionError(null);
-          const result = await updateSessionStatus(session.id, 'running');
-          if (!result?.success) {
-            setActionError(result?.error || "Failed to start session.");
-            return;
-          }
-          router.refresh(); // Refresh after status change
-      }
+  function handleShowReset() {
+    setShowResetModal(true);
+    setResetTyped('');
+    setResetError(null);
   }
 
-  async function handleResetSession() {
-      if (confirm("Reset session to Ready? This will WIPE ALL HISTORY (winners, calls) for this session. Use with caution!")) {
-          setActionError(null);
-          const result = await resetSession(session.id);
-          if (!result?.success) {
-              setActionError(result?.error || "Failed to reset session.");
-          } else {
-              router.refresh(); // Refresh after reset
-          }
-      }
+  function handleCloseReset() {
+    setShowResetModal(false);
+    setResetTyped('');
+    setResetError(null);
+    setIsResetting(false);
+  }
+
+  async function handleConfirmReset() {
+    setIsResetting(true);
+    setResetError(null);
+    const result = await resetSession(session.id, resetTyped);
+    setIsResetting(false);
+    if (!result?.success) {
+      setResetError(result?.error || "Failed to reset session.");
+      return;
+    }
+    handleCloseReset();
+    router.refresh();
   }
 
   const isSessionLocked = session.status === 'running' || session.status === 'completed';
 
+  const isDeleteGameConfirmed =
+    deleteGameTarget !== null && deleteGameTyped === deleteGameTarget.name;
+
+  const isResetConfirmed = resetTyped === 'RESET' || resetTyped === session.name;
+
   return (
     <>
       {actionError && !showGameModal && (
@@ -190,7 +296,7 @@ export default function SessionDetail({ session, initialGames, snowballPots, win
 
                         <dt className="text-slate-400">Notes</dt>
                         <dd className="col-span-2 text-slate-300">{session.notes || '-'}</dd>
-                        
+
                         <dt className="text-slate-400">Test Mode</dt>
                         <dd className="col-span-2 text-white">{session.is_test_session ? 'Yes' : 'No'}</dd>
                     </dl>
@@ -205,22 +311,22 @@ export default function SessionDetail({ session, initialGames, snowballPots, win
                                 Mark as Ready
                             </Button>
                         )}
-                        <Button 
-                            variant="primary" 
-                            size="lg" 
-                            className="w-full" 
-                            disabled={isSessionLocked || session.status === 'draft'} 
+                        <Button
+                            variant="primary"
+                            size="lg"
+                            className="w-full"
+                            disabled={isSessionLocked || session.status === 'draft'}
                             onClick={handleStartSession}
                         >
                             Start Session
                         </Button>
-                        
+
                         {isSessionLocked && (
-                            <Button variant="secondary" size="sm" className="w-full border-yellow-600 text-yellow-500 hover:bg-yellow-950" onClick={handleResetSession}>
+                            <Button variant="secondary" size="sm" className="w-full border-yellow-600 text-yellow-500 hover:bg-yellow-950" onClick={handleShowReset}>
                                 Reset to Ready (Unlock)
                             </Button>
                         )}
-                        
+
                         <p className="text-xs text-slate-500 text-center mt-2">
                             {session.status === 'running' && 'Session is live!'}
                             {session.status === 'ready' && 'Session is ready for hosts.'}
@@ -328,43 +434,51 @@ export default function SessionDetail({ session, initialGames, snowballPots, win
                   </tr>
                 </thead>
                 <tbody className="divide-y divide-slate-800/50">
-                  {games.map((game) => (
-                    <tr key={game.id} className="hover:bg-slate-800/30 transition-colors">
-                      <td className="px-4 py-3 text-center font-bold text-white">{game.game_index}</td>
-                      <td className="px-4 py-3">
-                          <div className="font-medium text-white">{game.name}</div>
-                          {game.notes && <div className="text-xs text-slate-500">{game.notes}</div>}
-                      </td>
-                      <td className="px-4 py-3">
-                          {game.type === 'snowball' ? (
-                              <span className="px-2 py-0.5 bg-indigo-900/50 text-indigo-300 rounded border border-indigo-800 text-xs font-bold">Snowball</span>
-                          ) : game.type === 'jackpot' ? (
-                              <span className="px-2 py-0.5 bg-amber-900/40 text-amber-300 rounded border border-amber-700 text-xs font-bold">Jackpot</span>
-                          ) : (
-                              <span className="px-2 py-0.5 bg-slate-800 text-slate-300 rounded border border-slate-700 text-xs">Standard</span>
-                          )}
-                      </td>
-                      <td className="px-4 py-3">
-                          <div className="flex gap-1">
-                            {game.stage_sequence.map((stage, i) => (
-                                <span key={i} className="px-2 py-0.5 bg-slate-800 text-slate-400 rounded text-xs border border-slate-700">{stage}</span>
-                            ))}
-                          </div>
-                      </td>
-                      <td className="px-4 py-3">
-                          <div 
-                              className="w-6 h-6 rounded border border-white/10 shadow-sm"
-                              style={{ backgroundColor: game.background_colour }} 
-                              title={game.background_colour}
-                          />
-                      </td>
-                      <td className="px-4 py-3 text-right space-x-2">
-                        <Button variant="ghost" size="sm" className="h-8 px-2 text-slate-400 hover:text-white" onClick={() => handleDuplicateGame(game.id)} disabled={isSessionLocked}>Clone</Button>
-                        <Button variant="ghost" size="sm" className="h-8 px-2 text-slate-400 hover:text-white" onClick={() => handleShowEdit(game)} disabled={isSessionLocked}>Edit</Button>
-                        <Button variant="ghost" size="sm" className="h-8 px-2 text-red-500 hover:text-red-400 hover:bg-red-900/20" onClick={() => handleDeleteGame(game.id)} disabled={isSessionLocked || (Array.isArray(game.game_states) ? game.game_states[0]?.status : game.game_states?.status) === 'completed'} title={(Array.isArray(game.game_states) ? game.game_states[0]?.status : game.game_states?.status) === 'completed' ? 'Cannot delete a completed game' : undefined}>Delete</Button>
-                      </td>
-                    </tr>
-                  ))}
+                  {games.map((game) => {
+                    const status = readGameStatus(game);
+                    const gameLocked = status === 'in_progress' || status === 'completed';
+                    const deleteDisabled = gameLocked;
+                    const deleteTitle = gameLocked
+                      ? `Cannot delete a ${status} game`
+                      : undefined;
+                    return (
+                      <tr key={game.id} className="hover:bg-slate-800/30 transition-colors">
+                        <td className="px-4 py-3 text-center font-bold text-white">{game.game_index}</td>
+                        <td className="px-4 py-3">
+                            <div className="font-medium text-white">{game.name}</div>
+                            {game.notes && <div className="text-xs text-slate-500">{game.notes}</div>}
+                        </td>
+                        <td className="px-4 py-3">
+                            {game.type === 'snowball' ? (
+                                <span className="px-2 py-0.5 bg-indigo-900/50 text-indigo-300 rounded border border-indigo-800 text-xs font-bold">Snowball</span>
+                            ) : game.type === 'jackpot' ? (
+                                <span className="px-2 py-0.5 bg-amber-900/40 text-amber-300 rounded border border-amber-700 text-xs font-bold">Jackpot</span>
+                            ) : (
+                                <span className="px-2 py-0.5 bg-slate-800 text-slate-300 rounded border border-slate-700 text-xs">Standard</span>
+                            )}
+                        </td>
+                        <td className="px-4 py-3">
+                            <div className="flex gap-1">
+                              {game.stage_sequence.map((stage, i) => (
+                                  <span key={i} className="px-2 py-0.5 bg-slate-800 text-slate-400 rounded text-xs border border-slate-700">{stage}</span>
+                              ))}
+                            </div>
+                        </td>
+                        <td className="px-4 py-3">
+                            <div
+                                className="w-6 h-6 rounded border border-white/10 shadow-sm"
+                                style={{ backgroundColor: game.background_colour }}
+                                title={game.background_colour}
+                            />
+                        </td>
+                        <td className="px-4 py-3 text-right space-x-2">
+                          <Button variant="ghost" size="sm" className="px-2 text-slate-400 hover:text-white" onClick={() => handleDuplicateGame(game.id)}>Clone</Button>
+                          <Button variant="ghost" size="sm" className="px-2 text-slate-400 hover:text-white" onClick={() => handleShowEdit(game)}>Edit</Button>
+                          <Button variant="ghost" size="sm" className="px-2 text-red-500 hover:text-red-400 hover:bg-red-900/20" onClick={() => handleShowDeleteGame(game)} disabled={deleteDisabled} title={deleteTitle}>Delete</Button>
+                        </td>
+                      </tr>
+                    );
+                  })}
                 </tbody>
               </table>
             </div>
@@ -373,152 +487,193 @@ export default function SessionDetail({ session, initialGames, snowballPots, win
       </Card>
 
       {/* Add/Edit Game Modal */}
-      <Modal 
-        isOpen={showGameModal} 
-        onClose={handleClose} 
+      <Modal
+        isOpen={showGameModal}
+        onClose={handleClose}
         title={editingGame ? 'Edit Game' : 'Add Game'}
         className="max-w-2xl"
       >
         <form key={editingGame?.id || 'new-game'} onSubmit={handleGameSubmit} className="space-y-4">
             {actionError && <div className="p-3 bg-red-900/50 text-red-200 rounded border border-red-800 text-sm">{actionError}</div>}
-            
+
+            {isGameLocked && (
+              <div className="p-3 rounded border border-yellow-800 bg-yellow-900/30 text-sm text-yellow-200">
+                This game has already started. Prize, type, snowball pot, and stage configuration are locked.
+              </div>
+            )}
+
             <div className="flex gap-4">
                 <div className="w-1/4">
                     <label className="text-sm font-medium text-slate-300 mb-1 block">Order</label>
-                    <Input 
-                        type="number" 
+                    <Input
+                        type="number"
                         name="game_index"
                         defaultValue={editingGame ? editingGame.game_index : nextIndex}
-                        required 
+                        required
                     />
                 </div>
                 <div className="w-3/4">
                     <label className="text-sm font-medium text-slate-300 mb-1 block">Game Name</label>
-                    <Input 
-                        type="text" 
+                    <Input
+                        type="text"
                         name="name"
                         defaultValue={editingGame?.name}
-                        placeholder="e.g. Game 1 - The Warm Up" 
-                        required 
+                        placeholder="e.g. Game 1 - The Warm Up"
+                        required
                         autoFocus
                     />
                 </div>
             </div>
 
-            <div>
-              <label className="text-sm font-medium text-slate-300 mb-1 block">Game Type</label>
-              <select 
-                name="type" 
-                value={selectedGameType}
-                onChange={(e) => {
-                    const newType = e.target.value as GameType;
-                    setSelectedGameType(newType);
-                    if (newType === 'snowball' || newType === 'jackpot') {
-                        setSelectedStages(['Full House']);
-                    } else {
-                         if (editingGame && editingGame.type === 'standard') {
-                             setSelectedStages(editingGame.stage_sequence);
-                         } else {
-                             setSelectedStages(['Line', 'Two Lines', 'Full House']);
-                         }
-                    }
-                }}
-                className="flex h-10 w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bingo-primary"
-              >
-                  <option value="standard">Standard Game</option>
-                  <option value="jackpot">Jackpot Game</option>
-                  <option value="snowball">Snowball Game</option>
-              </select>
-            </div>
+            {/* Structural fields (type, stages, snowball pot, prizes) are
+                locked once the game has started. We render them inside a
+                fieldset so the entire group is disabled in one place. */}
+            <fieldset disabled={isGameLocked} aria-disabled={isGameLocked} className="space-y-4 disabled:opacity-70">
+
+              <div>
+                <label className="text-sm font-medium text-slate-300 mb-1 block">Game Type</label>
+                <select
+                  name="type"
+                  value={selectedGameType}
+                  onChange={(e) => {
+                      const newType = e.target.value as GameType;
+                      setSelectedGameType(newType);
+                      if (newType === 'snowball' || newType === 'jackpot') {
+                          setSelectedStages(['Full House']);
+                      } else {
+                           if (editingGame && editingGame.type === 'standard') {
+                               setSelectedStages(editingGame.stage_sequence);
+                           } else {
+                               setSelectedStages(['Line', 'Two Lines', 'Full House']);
+                           }
+                      }
+                      setMissingPrizeStages([]);
+                  }}
+                  className="flex h-10 w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bingo-primary disabled:cursor-not-allowed disabled:opacity-50"
+                >
+                    <option value="standard">Standard Game</option>
+                    <option value="jackpot">Jackpot Game</option>
+                    <option value="snowball">Snowball Game</option>
+                </select>
+                {isGameLocked && (
+                  <p className="text-xs text-muted-foreground mt-1 text-yellow-200/80">Locked: game already started</p>
+                )}
+              </div>
 
-            {selectedGameType === 'standard' && (
-                <div>
-                    <label className="text-sm font-medium text-slate-300 mb-2 block">Stages (Winners)</label>
-                    <div className="flex gap-4 p-3 bg-slate-950/50 rounded-lg border border-slate-800">
-                        {['Line', 'Two Lines', 'Full House'].map(stage => (
-                            <label key={stage} className="flex items-center gap-2 cursor-pointer">
-                                <input 
-                                    type="checkbox" 
-                                    name="stages" 
-                                    value={stage} 
-                                    checked={selectedStages.includes(stage)}
-                                    onChange={() => handleStageChange(stage)}
-                                    className="rounded border-slate-700 bg-slate-900 text-bingo-primary focus:ring-bingo-primary"
+              {selectedGameType === 'standard' && (
+                  <div>
+                      <label className="text-sm font-medium text-slate-300 mb-2 block">Stages (Winners)</label>
+                      <div className="flex gap-4 p-3 bg-slate-950/50 rounded-lg border border-slate-800">
+                          {STANDARD_STAGES.map(stage => (
+                              <label key={stage} className="flex items-center gap-2 cursor-pointer">
+                                  <input
+                                      type="checkbox"
+                                      name="stages"
+                                      value={stage}
+                                      checked={selectedStages.includes(stage)}
+                                      onChange={() => handleStageChange(stage)}
+                                      className="rounded border-slate-700 bg-slate-900 text-bingo-primary focus:ring-bingo-primary"
+                                  />
+                                  <span className="text-sm text-slate-300">{stage}</span>
+                              </label>
+                          ))}
+                      </div>
+                      {selectedStages.length === 0 && <p className="text-xs text-red-400 mt-1">Select at least one stage.</p>}
+                      {isGameLocked && (
+                        <p className="text-xs text-muted-foreground mt-1 text-yellow-200/80">Locked: game already started</p>
+                      )}
+                  </div>
+              )}
+
+              {selectedGameType === 'snowball' && (
+                  <div className="p-4 bg-indigo-900/20 border border-indigo-900 rounded-lg space-y-3">
+                      <div>
+                          <label className="text-sm font-medium text-indigo-200 mb-1 block">Link Snowball Pot</label>
+                          <select
+                              name="snowball_pot_id"
+                              defaultValue={editingGame?.snowball_pot_id || ""}
+                              required
+                              className="flex h-10 w-full rounded-md border border-indigo-700 bg-slate-900 px-3 py-2 text-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
+                          >
+                              <option value="">Select a Pot...</option>
+                              {snowballPots.map(pot => (
+                                  <option key={pot.id} value={pot.id}>
+                                      {pot.name} (Jackpot: £{pot.current_jackpot_amount} / Calls: {pot.current_max_calls})
+                                  </option>
+                              ))}
+                          </select>
+                          {snowballPots.length === 0 && (
+                              <p className="text-xs text-red-400 mt-1">
+                                  No Snowball Pots found. Create one in the Snowball menu first.
+                              </p>
+                          )}
+                          {isGameLocked && (
+                            <p className="text-xs text-muted-foreground mt-1 text-yellow-200/80">Locked: game already started</p>
+                          )}
+                      </div>
+                      <input type="hidden" name="stages" value="Full House" />
+                      <p className="text-xs text-indigo-300 flex items-center gap-2">Snowball games are Full House only.</p>
+                  </div>
+              )}
+
+              {selectedGameType === 'jackpot' && (
+                  <div className="p-4 bg-amber-900/20 border border-amber-800 rounded-lg space-y-3">
+                      <input type="hidden" name="stages" value="Full House" />
+                      <p className="text-xs text-amber-200">
+                          Jackpot games are configured as Full House only. The cash jackpot amount is entered by host when starting this game.
+                      </p>
+                  </div>
+              )}
+
+              <div>
+                  <label className="text-sm font-medium text-slate-300 mb-2 block">Prizes</label>
+                  <div className="space-y-2">
+                      {selectedStages.map(stage => {
+                          const isMissing = missingPrizeStages.includes(stage);
+                          const isRequired = requiredStages.includes(stage);
+                          return (
+                            <div key={stage}>
+                              <div className="flex items-center gap-3">
+                                <label className="text-xs text-slate-400 w-24 uppercase tracking-wide font-bold text-right" htmlFor={`prize_${stage}`}>{stage}{isRequired ? '' : ' (optional)'}:</label>
+                                <Input
+                                    id={`prize_${stage}`}
+                                    type="text"
+                                    name={`prize_${stage}`}
+                                    value={prizeDraft[stage] ?? ''}
+                                    onChange={(e) => handlePrizeChange(stage, e.target.value)}
+                                    placeholder={selectedGameType === 'snowball' ? "e.g. £20" : selectedGameType === 'jackpot' ? "Set at game start" : "e.g. £10"}
+                                    className={isMissing ? 'h-9 border-destructive border-red-500' : 'h-9'}
+                                    aria-invalid={isMissing}
+                                    aria-describedby={isMissing ? `prize_${stage}_error` : undefined}
                                 />
-                                <span className="text-sm text-slate-300">{stage}</span>
-                            </label>
-                        ))}
-                    </div>
-                    {selectedStages.length === 0 && <p className="text-xs text-red-400 mt-1">Select at least one stage.</p>}
-                </div>
-            )}
+                              </div>
+                              {isMissing && (
+                                <p id={`prize_${stage}_error`} className="text-xs text-red-400 mt-1 ml-[6.5rem]">
+                                  Prize required for {stage}.
+                                </p>
+                              )}
+                            </div>
+                          );
+                      })}
+                  </div>
+                  {isGameLocked && (
+                    <p className="text-xs text-muted-foreground mt-1 text-yellow-200/80">Locked: game already started</p>
+                  )}
+              </div>
 
-            {selectedGameType === 'snowball' && (
-                <div className="p-4 bg-indigo-900/20 border border-indigo-900 rounded-lg space-y-3">
-                    <div>
-                        <label className="text-sm font-medium text-indigo-200 mb-1 block">Link Snowball Pot</label>
-                        <select 
-                            name="snowball_pot_id" 
-                            defaultValue={editingGame?.snowball_pot_id || ""} 
-                            required
-                            className="flex h-10 w-full rounded-md border border-indigo-700 bg-slate-900 px-3 py-2 text-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
-                        >
-                            <option value="">Select a Pot...</option>
-                            {snowballPots.map(pot => (
-                                <option key={pot.id} value={pot.id}>
-                                    {pot.name} (Jackpot: £{pot.current_jackpot_amount} / Calls: {pot.current_max_calls})
-                                </option>
-                            ))}
-                        </select>
-                        {snowballPots.length === 0 && (
-                            <p className="text-xs text-red-400 mt-1">
-                                No Snowball Pots found. Create one in the Snowball menu first.
-                            </p>
-                        )}
-                    </div>
-                    <input type="hidden" name="stages" value="Full House" />
-                    <p className="text-xs text-indigo-300 flex items-center gap-2">ℹ️ Snowball games are Full House only.</p>
-                </div>
-            )}
-
-            {selectedGameType === 'jackpot' && (
-                <div className="p-4 bg-amber-900/20 border border-amber-800 rounded-lg space-y-3">
-                    <input type="hidden" name="stages" value="Full House" />
-                    <p className="text-xs text-amber-200">
-                        Jackpot games are configured as Full House only. The cash jackpot amount is entered by host when starting this game.
-                    </p>
-                </div>
-            )}
-            
-            <div>
-                <label className="text-sm font-medium text-slate-300 mb-2 block">Prizes</label>
-                <div className="space-y-2">
-                    {selectedStages.map(stage => (
-                        <div key={stage} className="flex items-center gap-3">
-                            <label className="text-xs text-slate-400 w-24 uppercase tracking-wide font-bold text-right">{stage}:</label>
-                            <Input 
-                                type="text" 
-                                name={`prize_${stage}`} 
-                                defaultValue={editingGame?.prizes?.[stage] || ''} 
-                                placeholder={selectedGameType === 'snowball' ? "e.g. £20" : selectedGameType === 'jackpot' ? "Set at game start" : "e.g. £10"}
-                                className="h-9"
-                            />
-                        </div>
-                    ))}
-                </div>
-            </div>
+            </fieldset>
 
             <div>
               <label className="text-sm font-medium text-slate-300 mb-1 block">Background Colour</label>
               <div className="flex gap-2">
-                <input 
-                    type="color" 
+                <input
+                    type="color"
                     value={backgroundColor}
                     onChange={(e) => setBackgroundColor(e.target.value)}
                     className="h-10 w-16 p-1 bg-slate-900 border border-slate-700 rounded cursor-pointer"
                 />
-                <Input 
-                    type="text" 
+                <Input
+                    type="text"
                     name="background_colour"
                     placeholder="#ffffff"
                     value={backgroundColor}
@@ -531,10 +686,10 @@ export default function SessionDetail({ session, initialGames, snowballPots, win
 
             <div>
               <label className="text-sm font-medium text-slate-300 mb-1 block">Notes</label>
-              <textarea 
+              <textarea
                 name="notes"
                 defaultValue={editingGame?.notes || ""}
-                rows={2} 
+                rows={2}
                 className="flex w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bingo-primary"
               />
             </div>
@@ -543,12 +698,115 @@ export default function SessionDetail({ session, initialGames, snowballPots, win
                 <Button variant="secondary" type="button" onClick={handleClose} disabled={isSubmitting}>
                 Cancel
                 </Button>
-                <Button variant="primary" type="submit" disabled={isSubmitting}>
+                <Button variant="primary" type="submit" disabled={isSubmitting || missingPrizeStages.length > 0}>
                 {editingGame ? 'Save Changes' : 'Add Game'}
                 </Button>
             </div>
         </form>
       </Modal>
+
+      {/* Typed-confirm delete-game modal */}
+      <Modal
+        isOpen={deleteGameTarget !== null}
+        onClose={handleCloseDeleteGame}
+        title={deleteGameTarget ? `Delete game "${deleteGameTarget.name}"?` : 'Delete game?'}
+        footer={
+          <>
+            <Button variant="ghost" onClick={handleCloseDeleteGame} disabled={isDeletingGame}>
+              Cancel
+            </Button>
+            <Button
+              variant="danger"
+              onClick={handleConfirmDeleteGame}
+              disabled={!isDeleteGameConfirmed || isDeletingGame}
+            >
+              {isDeletingGame ? 'Deleting…' : 'Delete'}
+            </Button>
+          </>
+        }
+      >
+        {deleteGameTarget && (
+          <div className="space-y-4">
+            {deleteGameError && (
+              <div className="p-3 text-sm text-red-200 bg-red-900/50 border border-red-800 rounded-md">
+                {deleteGameError}
+              </div>
+            )}
+            <p className="text-sm text-white/85">
+              This will permanently delete the game from this session. This action cannot be undone.
+            </p>
+            <p className="text-sm text-white/85">
+              Started, completed, or already-won games cannot be deleted.
+            </p>
+            <div className="space-y-2">
+              <label htmlFor="confirmDeleteGame" className="text-sm font-medium text-white/85">
+                Type the game name <span className="font-mono text-white">{deleteGameTarget.name}</span> to confirm:
+              </label>
+              <Input
+                id="confirmDeleteGame"
+                type="text"
+                value={deleteGameTyped}
+                onChange={(e) => setDeleteGameTyped(e.target.value)}
+                placeholder={deleteGameTarget.name}
+                autoFocus
+              />
+            </div>
+          </div>
+        )}
+      </Modal>
+
+      {/* Typed-confirm reset-session modal */}
+      <Modal
+        isOpen={showResetModal}
+        onClose={handleCloseReset}
+        title={`Reset session "${session.name}" to Ready?`}
+        footer={
+          <>
+            <Button variant="ghost" onClick={handleCloseReset} disabled={isResetting}>
+              Cancel
+            </Button>
+            <Button
+              variant="danger"
+              onClick={handleConfirmReset}
+              disabled={!isResetConfirmed || isResetting}
+            >
+              {isResetting ? 'Resetting…' : 'Reset Session'}
+            </Button>
+          </>
+        }
+      >
+        <div className="space-y-4">
+          {resetError && (
+            <div className="p-3 text-sm text-red-200 bg-red-900/50 border border-red-800 rounded-md">
+              {resetError}
+            </div>
+          )}
+          <p className="text-sm text-white/85">
+            This will wipe all live history for this session and put it back into the Ready state. The following will be permanently deleted:
+          </p>
+          <ul className="list-disc list-inside text-sm text-white/85 space-y-1 pl-2">

[diff truncated at line 1500 — total was 4400 lines. Consider scoping the review to fewer files.]
```

## Changed File Contents

### `docs/schema.sql`

```
-- Anchor Bingo Database Schema
-- Run this in the Supabase SQL Editor

-- 1. ENUMS
create type user_role as enum ('admin', 'host');
create type session_status as enum ('draft', 'ready', 'running', 'completed');
create type game_type as enum ('standard', 'snowball', 'jackpot');
create type game_status as enum ('not_started', 'in_progress', 'completed');
create type win_stage as enum ('Line', 'Two Lines', 'Full House');

-- 2. PROFILES (Extends auth.users)
create table public.profiles (
  id uuid references auth.users on delete cascade not null primary key,
  email text,
  role user_role default 'host'::user_role,
  created_at timestamptz default now()
);
-- Secure the profiles table
alter table public.profiles enable row level security;
create policy "Public profiles are viewable by everyone." on public.profiles for select using (true);
create policy "Users can insert their own profile." on public.profiles for insert with check (auth.uid() = id);
create policy "Admins can update profiles." on public.profiles for update using (
  exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
);

-- Trigger to auto-create profile on signup
create or replace function public.handle_new_user() 
returns trigger as $$
begin
  insert into public.profiles (id, email, role)
  values (new.id, new.email, 'host'); -- Default to host, manually upgrade to admin later
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();


-- 3. SNOWBALL POTS
create table public.snowball_pots (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  base_max_calls int not null default 48,
  base_jackpot_amount decimal(10,2) not null default 200.00,
  calls_increment int not null default 2,
  jackpot_increment decimal(10,2) not null default 20.00,
  current_max_calls int not null,
  current_jackpot_amount decimal(10,2) not null,
  last_awarded_at timestamptz,
  created_at timestamptz default now()
);
alter table public.snowball_pots enable row level security;
create policy "Read access for all authenticated users" on public.snowball_pots for select using (auth.role() = 'authenticated' or auth.role() = 'anon'); -- anon needed for display?
create policy "Admins can update pots" on public.snowball_pots for all using (
  exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
);

-- 4. SESSIONS
create table public.sessions (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  start_date date default current_date,
  notes text,
  status session_status default 'draft'::session_status,
  is_test_session boolean default false,
  created_by uuid references public.profiles(id),
  active_game_id uuid references public.games(id), -- New: ID of the game currently active on display
  created_at timestamptz default now()
);
alter table public.sessions enable row level security;
create policy "Read access for all" on public.sessions for select using (true);
create policy "Admins can manage sessions" on public.sessions for all using (
  exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
);
create policy "Hosts can update sessions" on public.sessions for update using (
  exists (select 1 from public.profiles where id = auth.uid() and role = 'host')
);

-- 5. GAMES
create table public.games (
  id uuid default gen_random_uuid() primary key,
  session_id uuid references public.sessions(id) on delete cascade not null,
  game_index int not null, -- order 1, 2, 3
  name text not null,
  type game_type default 'standard'::game_type,
  stage_sequence jsonb not null default '["Line", "Two Lines", "Full House"]'::jsonb,
  background_colour text default '#ffffff',
  prizes jsonb default '{}'::jsonb, -- {"Line": "£10", "Full House": "£50"}
  notes text,
  snowball_pot_id uuid references public.snowball_pots(id),
  created_at timestamptz default now()
);
alter table public.games enable row level security;
create policy "Read access for all" on public.games for select using (true);
create policy "Admins can manage games" on public.games for all using (
  exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
);

-- 6. GAME STATE (Realtime frequent updates)
create table public.game_states (
  id uuid default gen_random_uuid() primary key,
  game_id uuid references public.games(id) on delete cascade unique not null,
  number_sequence jsonb, -- The shuffled 1-90 array [5, 89, 12...]
  called_numbers jsonb default '[]'::jsonb, -- Array of numbers called so far [5, 89]
  numbers_called_count int default 0,
  current_stage_index int default 0,
  status game_status default 'not_started'::game_status,
  call_delay_seconds int default 2,
  on_break boolean default false,
  paused_for_validation boolean default false,
  display_win_type text default null, -- 'line', 'two_lines', 'full_house', 'snowball'
  display_win_text text default null, -- e.g., "Line Winner!"
  display_winner_name text default null, -- Optional: "Dave - Table 6"
  controlling_host_id uuid references auth.users(id), -- New: ID of the host controlling the game
  controller_last_seen_at timestamptz, -- New: Timestamp of last heartbeat
  started_at timestamptz,
  ended_at timestamptz,
  last_call_at timestamptz,
  updated_at timestamptz default now(),
  state_version bigint not null default 0 -- Monotonic counter bumped on every update; used to order Realtime/polling snapshots
);
alter table public.game_states enable row level security;
create policy "Hosts/Admins can read game state" on public.game_states for select using (
  exists (select 1 from public.profiles where id = auth.uid() and (role = 'admin' or role = 'host'))
);
create policy "Hosts/Admins can update game state" on public.game_states for update using (
  exists (select 1 from public.profiles where id = auth.uid() and (role = 'admin' or role = 'host'))
);
create policy "Hosts/Admins can insert game state" on public.game_states for insert with check (
  exists (select 1 from public.profiles where id = auth.uid() and (role = 'admin' or role = 'host'))
);
create policy "Admins can delete game state" on public.game_states for delete using (
  exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
);

-- Enable Realtime for game_states (Crucial for Display/Host sync)
alter publication supabase_realtime add table public.game_states;

-- 6b. GAME STATE PUBLIC (No number_sequence, safe for public display/player)
create table public.game_states_public (
  game_id uuid references public.games(id) on delete cascade primary key,
  called_numbers jsonb default '[]'::jsonb,
  numbers_called_count int default 0,
  current_stage_index int default 0,
  status game_status default 'not_started'::game_status,
  call_delay_seconds int default 2,
  on_break boolean default false,
  paused_for_validation boolean default false,
  display_win_type text default null,
  display_win_text text default null,
  display_winner_name text default null,
  started_at timestamptz,
  ended_at timestamptz,
  last_call_at timestamptz,
  updated_at timestamptz default now(),
  state_version bigint not null default 0 -- Mirror of game_states.state_version; copied by sync trigger
);
alter table public.game_states_public enable row level security;
create policy "Read access for all" on public.game_states_public for select using (true);

create or replace function public.sync_game_states_public()
returns trigger as $$
begin
  if (tg_op = 'DELETE') then
    delete from public.game_states_public where game_id = old.game_id;
    return old;
  end if;

  insert into public.game_states_public (
    game_id,
    called_numbers,
    numbers_called_count,
    current_stage_index,
    status,
    call_delay_seconds,
    on_break,
    paused_for_validation,
    display_win_type,
    display_win_text,
    display_winner_name,
    started_at,
    ended_at,
    last_call_at,
    updated_at,
    state_version
  ) values (
    new.game_id,
    new.called_numbers,
    new.numbers_called_count,
    new.current_stage_index,
    new.status,
    new.call_delay_seconds,
    new.on_break,
    new.paused_for_validation,
    new.display_win_type,
    new.display_win_text,
    new.display_winner_name,
    new.started_at,

[truncated at line 200 — original has 294 lines]
```

### `src/app/admin/actions.ts`

```
'use server'

import { createClient } from '@/utils/supabase/server'
import { revalidatePath } from 'next/cache'
import type { Database, GameStatus, UserRole } from '@/types/database'
import type { ActionResult } from '@/types/actions'
import type { SupabaseClient, User } from '@supabase/supabase-js'

type SessionInsert = Database['public']['Tables']['sessions']['Insert']
type SessionUpdate = Database['public']['Tables']['sessions']['Update']
type GameRow = Database['public']['Tables']['games']['Row']
type GameInsert = Database['public']['Tables']['games']['Insert']

type AdminAuthResult =
  | { authorized: false; error: string }
  | { authorized: true; user: User; role: UserRole }

async function authorizeAdmin(
  supabase: SupabaseClient<Database>
): Promise<AdminAuthResult> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { authorized: false, error: "Not authenticated" }
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single<{ role: UserRole }>()

  if (profileError || !profile || profile.role !== 'admin') {
    return { authorized: false, error: "Unauthorized: Admin access required" }
  }
  
  return { authorized: true, user, role: profile.role }
}

export async function createSession(_prevState: unknown, formData: FormData): Promise<ActionResult> {
  const supabase = await createClient()
  const authResult = await authorizeAdmin(supabase)
  if (!authResult.authorized) return { success: false, error: authResult.error }

  const name = ((formData.get('name') as string) || '').trim()
  const notesRaw = (formData.get('notes') as string) || ''
  const notes = notesRaw.trim() || null
  const is_test_session = formData.get('is_test_session') === 'on'

  if (!name) return { success: false, error: 'Session name is required' }

  const newSession: SessionInsert = {
    name,
    notes,
    is_test_session,
    created_by: authResult.user!.id,
    status: 'draft',
  }

  const { error } = await supabase
    .from('sessions')
    .insert(newSession)

  if (error) {
    return { success: false, error: error.message }
  }

  revalidatePath('/admin')
  return { success: true, redirectTo: '/admin' }
}

export async function updateSession(sessionId: string, _prevState: unknown, formData: FormData): Promise<ActionResult> {
  const supabase = await createClient()
  const authResult = await authorizeAdmin(supabase)
  if (!authResult.authorized) return { success: false, error: authResult.error }

  const name = ((formData.get('name') as string) || '').trim()
  const notesRaw = (formData.get('notes') as string) || ''
  const notes = notesRaw.trim() || null
  const is_test_session = formData.get('is_test_session') === 'on'

  if (!name) return { success: false, error: 'Session name is required' }

  const updates: SessionUpdate = {
    name,
    notes,
    is_test_session,
  }

  const { data: updatedSession, error } = await supabase
    .from('sessions')
    .update(updates)
    .eq('id', sessionId)
    .select('id')
    .single<{ id: string }>()

  if (error) {
    return { success: false, error: error.message }
  }
  if (!updatedSession) {
    return { success: false, error: 'Session update did not apply.' }
  }

  revalidatePath('/admin')
  revalidatePath(`/admin/sessions/${sessionId}`)
  return { success: true, redirectTo: '/admin' }
}

export async function deleteSession(sessionId: string): Promise<ActionResult> {
  const supabase = await createClient()
  const authResult = await authorizeAdmin(supabase)
  if (!authResult.authorized) return { success: false, error: authResult.error }

  // Reject deletion if any game in this session has been started. We look up
  // the game ids first, then check their game_states rows for any status
  // other than 'not_started'.
  const { data: gamesInSession, error: gamesError } = await supabase
    .from('sessions')
    .select('id, games(id)')
    .eq('id', sessionId)
    .single<{ id: string; games: { id: string }[] | null }>()

  if (gamesError || !gamesInSession) {
    return { success: false, error: gamesError?.message || 'Session not found.' }
  }

  const gameIds = (gamesInSession.games ?? []).map((g) => g.id)

  if (gameIds.length > 0) {
    const { data: startedStates, error: startedError } = await supabase
      .from('game_states')
      .select('status')
      .in('game_id', gameIds)
      .neq('status', 'not_started')
      .limit(1)

    if (startedError) {
      return { success: false, error: startedError.message }
    }
    if (startedStates && startedStates.length > 0) {
      const status = (startedStates[0] as { status: GameStatus }).status
      return {
        success: false,
        error: `Cannot delete a session containing a ${status} game.`,
      }
    }
  }

  // Reject deletion if there are any winners recorded against this session.
  const { count: winnerCount, error: winnerCountError } = await supabase
    .from('winners')
    .select('id', { count: 'exact', head: true })
    .eq('session_id', sessionId)

  if (winnerCountError) {
    return { success: false, error: winnerCountError.message }
  }
  if ((winnerCount ?? 0) > 0) {
    return { success: false, error: 'Cannot delete a session that has recorded winners.' }
  }

  const { error } = await supabase
    .from('sessions')
    .delete()
    .eq('id', sessionId)

  if (error) {
    return { success: false, error: error.message }
  }

  revalidatePath('/admin')
  return { success: true, redirectTo: '/admin' }
}

export async function duplicateSession(sessionId: string): Promise<ActionResult> {
  const supabase = await createClient()
  const authResult = await authorizeAdmin(supabase)
  if (!authResult.authorized) return { success: false, error: authResult.error }

  // 1. Fetch original session
  const { data: originalSession, error: sessionError } = await supabase
    .from('sessions')
    .select('*')
    .eq('id', sessionId)
    .single<Database['public']['Tables']['sessions']['Row']>()

  if (sessionError || !originalSession) {
    return { success: false, error: "Session not found" }
  }

  // 2. Create new session
  const { data: newSessionData, error: createError } = await supabase
    .from('sessions')
    .insert({
      name: `${originalSession.name} (Copy)`,
      start_date: new Date().toISOString().split('T')[0],
      notes: originalSession.notes,
      status: 'draft',
      is_test_session: originalSession.is_test_session,
      created_by: authResult.user!.id,
    } satisfies SessionInsert)

[truncated at line 200 — original has 240 lines]
```

### `src/app/admin/dashboard.tsx`

```
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

[truncated at line 200 — original has 311 lines]
```

### `src/app/admin/sessions/[id]/actions.ts`

```
'use server'

import { createClient } from '@/utils/supabase/server'
import { revalidatePath } from 'next/cache'
import type { Database, GameType, WinStage, GameStatus, UserRole } from '@/types/database'
import type { ActionResult } from '@/types/actions'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import { validateGamePrizes } from '@/lib/prize-validation'

type GameInsert = Database['public']['Tables']['games']['Insert']

type AdminAuthResult =
  | { authorized: false; error: string }
  | { authorized: true; user: User; role: UserRole }

const stageOrder: Record<WinStage, number> = {
  'Line': 1,
  'Two Lines': 2,
  'Full House': 3,
}

const sortStages = (stages: WinStage[]) => stages.sort((a, b) => stageOrder[a] - stageOrder[b])

const getDefaultStagesForType = (type: GameType): WinStage[] => {
  if (type === 'snowball' || type === 'jackpot') {
    return ['Full House'];
  }

  return ['Line', 'Two Lines', 'Full House'];
}

async function authorizeAdmin(
  supabase: SupabaseClient<Database>
): Promise<AdminAuthResult> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { authorized: false, error: "Not authenticated" }
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single<{ role: UserRole }>()

  if (profileError || !profile || profile.role !== 'admin') {
    return { authorized: false, error: "Unauthorized: Admin access required" }
  }

  return { authorized: true, user, role: profile.role }
}

export async function createGame(sessionId: string, _prevState: unknown, formData: FormData): Promise<ActionResult> {
  const supabase = await createClient()
  const authResult = await authorizeAdmin(supabase)
  if (!authResult.authorized) return { success: false, error: authResult.error }

  const name = (formData.get('name') as string)?.trim()
  const type = formData.get('type') as GameType
  const game_index = Number.parseInt(formData.get('game_index') as string, 10)
  const background_colour = formData.get('background_colour') as string
  const notes = formData.get('notes') as string
  const snowball_pot_id = (formData.get('snowball_pot_id') as string) || null

  if (!name) {
    return { success: false, error: 'Game name is required.' }
  }

  if (!Number.isFinite(game_index) || game_index < 1) {
    return { success: false, error: 'Game order must be a positive number.' }
  }

  const selectedStages = formData.getAll('stages') as WinStage[]
  const stage_sequence: WinStage[] = type === 'snowball' || type === 'jackpot'
    ? ['Full House']
    : selectedStages.length > 0
      ? sortStages([...selectedStages])
      : getDefaultStagesForType(type)

  if (type === 'snowball' && !snowball_pot_id) {
    return { success: false, error: 'Snowball games must be linked to a snowball pot.' }
  }

  // Trim every prize before saving. Empty/whitespace-only values are dropped
  // so the validation helper sees a clean view.
  const prizes: Partial<Record<WinStage, string>> = {}
  stage_sequence.forEach((stage) => {
    const raw = formData.get(`prize_${stage}`)
    if (typeof raw === 'string') {
      const trimmed = raw.trim()
      if (trimmed.length > 0) prizes[stage] = trimmed
    }
  })

  const validation = validateGamePrizes({ type, stage_sequence, prizes })
  if (!validation.valid) {
    return {
      success: false,
      error: `${name}: prize required for ${validation.missingStages.join(', ')}`,
    }
  }

  const newGame: GameInsert = {
    session_id: sessionId,
    name,
    game_index,
    type,
    background_colour,
    notes,
    stage_sequence,
    snowball_pot_id: type === 'snowball' ? snowball_pot_id : null,
    prizes,
  }

  const { error } = await supabase
    .from('games')
    .insert(newGame)

  if (error) {
    return { success: false, error: error.message }
  }

  revalidatePath(`/admin/sessions/${sessionId}`)
  return { success: true }
}

export async function updateGame(gameId: string, sessionId: string, _prevState: unknown, formData: FormData): Promise<ActionResult> {
  const supabase = await createClient()
  const authResult = await authorizeAdmin(supabase)
  if (!authResult.authorized) return { success: false, error: authResult.error }

  // 1. Fetch original game and the per-game live status. The lock is
  // per-game (game_states.status), not session-level, so future not_started
  // games inside a running session remain editable.
  const { data: originalGame, error: fetchGameError } = await supabase
    .from('games')
    .select('type, snowball_pot_id, stage_sequence, prizes')
    .eq('id', gameId)
    .single<Pick<Database['public']['Tables']['games']['Row'], 'type' | 'snowball_pot_id' | 'stage_sequence' | 'prizes'>>()

  if (fetchGameError || !originalGame) {
    return { success: false, error: fetchGameError?.message || "Original game not found." }
  }

  const { data: gameStateRow, error: gameStateError } = await supabase
    .from('game_states')
    .select('status')
    .eq('game_id', gameId)
    .maybeSingle<{ status: GameStatus }>()

  if (gameStateError) {
    return { success: false, error: gameStateError.message }
  }

  const isLocked = gameStateRow ? gameStateRow.status !== 'not_started' : false

  const name = (formData.get('name') as string)?.trim()
  const game_index = Number.parseInt(formData.get('game_index') as string, 10)
  const background_colour = formData.get('background_colour') as string
  const notes = formData.get('notes') as string
  const type = formData.get('type') as GameType
  const snowball_pot_id = (formData.get('snowball_pot_id') as string) || null

  if (!name) {
    return { success: false, error: 'Game name is required.' }
  }

  if (!Number.isFinite(game_index) || game_index < 1) {
    return { success: false, error: 'Game order must be a positive number.' }
  }

  const selectedStages = formData.getAll('stages') as WinStage[]
  const stage_sequence: WinStage[] = type === 'snowball' || type === 'jackpot'
    ? ['Full House']
    : selectedStages.length > 0
      ? sortStages([...selectedStages])
      : getDefaultStagesForType(type)

  if (type === 'snowball' && !snowball_pot_id) {
    return { success: false, error: 'Snowball games must be linked to a snowball pot.' }
  }

  // Trim prizes before saving and validation.
  const prizes: Partial<Record<WinStage, string>> = {}
  stage_sequence.forEach((stage) => {
    const raw = formData.get(`prize_${stage}`)
    if (typeof raw === 'string') {
      const trimmed = raw.trim()
      if (trimmed.length > 0) prizes[stage] = trimmed
    }
  })

  // 2. If the game has already started, lock the structural and prize fields.
  // Reject any attempt to edit prizes, type, snowball_pot_id, or stage_sequence.
  if (isLocked) {
    const desiredSnowballPotId = type === 'snowball' ? snowball_pot_id : null
    const originalPrizes = (originalGame.prizes as Partial<Record<WinStage, string>> | null) ?? {}

    const lockedFields: string[] = []
    if (type !== originalGame.type) lockedFields.push('type')

[truncated at line 200 — original has 461 lines]
```

### `src/app/admin/sessions/[id]/session-detail.tsx`

```
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

[truncated at line 200 — original has 812 lines]
```

### `src/app/display/[sessionId]/display-ui.tsx`

```
"use client";

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Database } from '@/types/database';
import { createClient } from '@/utils/supabase/client';
import { cn } from '@/lib/utils';
import Image from 'next/image';
import { QRCodeSVG } from 'qrcode.react';
import { formatPounds, getSnowballCallsLabel, getSnowballCallsRemaining } from '@/lib/snowball';
import { isFreshGameState } from '@/lib/game-state-version';
import { useConnectionHealth } from '@/hooks/use-connection-health';
import { ConnectionBanner } from '@/components/connection-banner';
import type { RealtimeStatus } from '@/lib/connection-health';
import { logError } from '@/lib/log-error';

// Define types for props
type Session = Database['public']['Tables']['sessions']['Row'];
type Game = Database['public']['Tables']['games']['Row'];
type GameState = Database['public']['Tables']['game_states_public']['Row'];
type SnowballPot = Database['public']['Tables']['snowball_pots']['Row'];

interface DisplayUIProps {
  session: Session;
  activeGame: Game | null;
  initialGameState: GameState | null;
  initialPrizeText: string;
  isWaitingState: boolean;
  playerJoinUrl: string;
}

const formatStageLabel = (stage: string | undefined) => {
  if (!stage) return '-';

  return stage
    .replace(/[_-]+/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
};

// Explicit narrow column lists keep public surfaces from leaking unintended
// fields and document exactly what the UI consumes from each table.
const SESSION_SELECT = 'id, name, status, active_game_id';
const GAME_SELECT =
  'id, session_id, game_index, name, type, stage_sequence, background_colour, prizes, snowball_pot_id';
const GAME_STATE_PUBLIC_SELECT =
  'game_id, called_numbers, numbers_called_count, current_stage_index, status, call_delay_seconds, on_break, paused_for_validation, display_win_type, display_win_text, display_winner_name, started_at, ended_at, last_call_at, updated_at, state_version';

const POLL_INTERVAL_MS = 3000;

export default function DisplayUI({
  session,
  activeGame: initialActiveGame,
  initialGameState: initialActiveGameState,
  initialPrizeText,
  isWaitingState: initialWaitingState,
  playerJoinUrl,
}: DisplayUIProps) {
  const supabase = useRef(createClient());

  const [currentSession, setCurrentSession] = useState<Session>(session);
  const [currentActiveGame, setCurrentActiveGame] = useState<Game | null>(initialActiveGame);
  const [currentGameState, setCurrentGameState] = useState<GameState | null>(initialActiveGameState);
  const [currentPrizeText, setCurrentPrizeText] = useState<string>(initialPrizeText);
  const [isWaitingState, setIsWaitingState] = useState<boolean>(initialWaitingState);
  const [currentNumberDelayed, setCurrentNumberDelayed] = useState<number | null>(null);
  const [delayedNumbers, setDelayedNumbers] = useState<number[]>([]);
  const [currentSnowballPot, setCurrentSnowballPot] = useState<SnowballPot | null>(null);
  // Tracks whether we have applied any usable game state (initial render or
  // first poll/realtime payload). Used to gate the "Connecting to game…" skeleton.
  const [hasLoaded, setHasLoaded] = useState<boolean>(initialActiveGameState != null);

  const numberCallTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Connection health: drives the reconnecting banner + auto-refresh.
  const health = useConnectionHealth();
  const { markPollSuccess, markPollFailure, markRealtimeStatus } = health;

  // Polling guards: monotonic sequence + in-flight flag prevent stale poll
  // results from clobbering newer state when responses arrive out-of-order.
  const pollSeqRef = useRef(0);
  const pollInFlightRef = useRef(false);

  // Stable refs for fields that the polling effect reads but should not retrigger
  // its setup. Pairs with the `currentActiveGame?.id` dependency below.
  const currentActiveGameRef = useRef(currentActiveGame);
  useEffect(() => {
    currentActiveGameRef.current = currentActiveGame;
  }, [currentActiveGame]);

  const refreshActiveGame = useCallback(async (newActiveGameId: string | null) => {
      if (newActiveGameId === currentActiveGame?.id) return;

      if (newActiveGameId) {
          const { data: newGame } = await supabase.current
          .from('games')
          .select(GAME_SELECT)
          .eq('id', newActiveGameId)
          .single<Database['public']['Tables']['games']['Row']>();

        if (newGame) {
          setCurrentActiveGame(newGame);
          const { data: newGameState } = await supabase.current
            .from('game_states_public')
            .select(GAME_STATE_PUBLIC_SELECT)
            .eq('game_id', newGame.id)
            .single<Database['public']['Tables']['game_states_public']['Row']>();

          if (newGameState) {
            setCurrentGameState(newGameState);
            setHasLoaded(true);
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
      setIsWaitingState(!newActiveGameId);
  }, [currentActiveGame?.id]);

  // Session-level realtime: track changes to active_game_id / status.
  useEffect(() => {
    const supabaseClient = supabase.current;

    const sessionChannel = supabaseClient
      .channel(`session_updates:${session.id}`)
      .on<Session>(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'sessions', filter: `id=eq.${session.id}` },
        async (payload) => {
          setCurrentSession(payload.new);
          await refreshActiveGame(payload.new.active_game_id);
        }
      )
      .subscribe();

    return () => {
      supabaseClient.removeChannel(sessionChannel);
    };
  }, [session.id, refreshActiveGame]);

  // Game state realtime with exponential-backoff auto-reconnect.
  // Each reconnect tears down the previous channel before creating the next
  // (ordering matters — Supabase rejects subscribe() against a torn channel).
  useEffect(() => {
    const supabaseClient = supabase.current;
    const activeGameId = currentActiveGame?.id;
    if (!activeGameId) return;

    let isMounted = true;
    let activeChannel: ReturnType<typeof supabaseClient.channel> | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let attemptCount = 0;

    const connect = async () => {
      if (!isMounted) return;
      if (activeChannel) {
        await supabaseClient.removeChannel(activeChannel);
        activeChannel = null;
      }
      if (!isMounted) return;

      const channel = supabaseClient
        .channel(`game_state_public_updates:${activeGameId}:${Date.now()}`)
        .on<GameState>(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'game_states_public', filter: `game_id=eq.${activeGameId}` },
          (payload) => {
            if (!isMounted) return;
            const incoming = payload.new as GameState;
            // Freshness gate: ignore older snapshots that may arrive after a
            // reconnect or out-of-order broadcast (state_version is monotonic).
            setCurrentGameState((current) => (isFreshGameState(current, incoming) ? incoming : current));
            setHasLoaded(true);
            const game = currentActiveGameRef.current;
            if (game) {
              const stageKey = game.stage_sequence[incoming.current_stage_index];
              setCurrentPrizeText(game.prizes?.[stageKey as keyof typeof game.prizes] || '');
            }
          }
        )
        .subscribe((status) => {
          if (!isMounted) return;
          markRealtimeStatus(status as RealtimeStatus);
          if (status === 'SUBSCRIBED') {
            attemptCount = 0;
            return;
          }
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            if (reconnectTimer) clearTimeout(reconnectTimer);
            // Exponential backoff: 1s, 2s, 4s … capped at 30s.
            const delay = Math.min(1000 * Math.pow(2, attemptCount), 30000);
            attemptCount += 1;
            reconnectTimer = setTimeout(() => { void connect(); }, delay);
          }

[truncated at line 200 — original has 745 lines]
```

### `src/app/display/[sessionId]/page.tsx`

```
import React from 'react';
import { createClient } from '@/utils/supabase/server';
import { notFound } from 'next/navigation';
import { headers } from 'next/headers';
import DisplayUI from './display-ui';
import { Database } from '@/types/database';
import { isUuid } from '@/lib/utils';
import { logError } from '@/lib/log-error';

interface PageProps {
  params: Promise<{ sessionId: string }>;
}

// Explicit narrow column lists keep public surfaces from leaking unintended
// fields and document exactly what the UI consumes from each table.
const SESSION_SELECT = 'id, name, status, active_game_id';
const GAME_SELECT =
  'id, session_id, game_index, name, type, stage_sequence, background_colour, prizes, snowball_pot_id';
const GAME_STATE_PUBLIC_SELECT =
  'game_id, called_numbers, numbers_called_count, current_stage_index, status, call_delay_seconds, on_break, paused_for_validation, display_win_type, display_win_text, display_winner_name, started_at, ended_at, last_call_at, updated_at, state_version';

export default async function DisplayPage({ params }: PageProps) {
  const { sessionId } = await params;

  if (!isUuid(sessionId)) {
    notFound();
  }

  const supabase = await createClient();

  // Fetch session details
  const { data: session, error: sessionError } = await supabase
    .from('sessions')
    .select(SESSION_SELECT)
    .eq('id', sessionId)
    .single<Database['public']['Tables']['sessions']['Row']>();

  if (sessionError || !session) {
    logError('display', sessionError ?? new Error('Session not found'));
    notFound();
  }

  const requestHeaders = await headers();
  const forwardedHost = requestHeaders.get('x-forwarded-host');
  const host = forwardedHost || requestHeaders.get('host');
  const forwardedProto = requestHeaders.get('x-forwarded-proto');
  const protocol = forwardedProto || (host?.includes('localhost') ? 'http' : 'https');
  const origin = host
    ? `${protocol}://${host}`
    : (process.env.NEXT_PUBLIC_SITE_URL || '').replace(/\/$/, '');
  const playerJoinUrl = origin
    ? `${origin}/player/${session.id}`
    : `/player/${session.id}`;

  let activeGame: Database['public']['Tables']['games']['Row'] | null = null;
  let initialGameState: Database['public']['Tables']['game_states_public']['Row'] | null = null;
  let prizeText: string = ''; // To pass to display

  if (session.active_game_id) {
    // Fetch the active game details
    const { data: game, error: gameError } = await supabase
      .from('games')
      .select(GAME_SELECT)
      .eq('id', session.active_game_id)
      .single<Database['public']['Tables']['games']['Row']>();

    if (gameError || !game) {
      logError('display', gameError ?? new Error('No active game found for session'));
      // Continue to render, display will show "waiting" state
    } else {
      activeGame = game;
      // Fetch the initial game state for the active game
      const { data: gameState, error: gameStateError } = await supabase
        .from('game_states_public')
        .select(GAME_STATE_PUBLIC_SELECT)
        .eq('game_id', game.id)
        .single<Database['public']['Tables']['game_states_public']['Row']>();

      if (gameStateError || !gameState) {
        logError('display', gameStateError ?? new Error('No game state found for active game'));
      } else {
        initialGameState = gameState;
        // Determine initial prize text
        if (game.prizes && game.stage_sequence && gameState.current_stage_index !== undefined) {
          const currentStage = game.stage_sequence[gameState.current_stage_index];
          prizeText = game.prizes[currentStage as keyof typeof game.prizes] || '';
        }
      }
    }
  }

  // A basic check: If there's no active game and session is not running, show waiting
  const isWaitingState = !session.active_game_id && session.status !== 'running';

  return (
    <DisplayUI
      session={session}
      activeGame={activeGame}
      initialGameState={initialGameState}
      initialPrizeText={prizeText}
      isWaitingState={isWaitingState}
      playerJoinUrl={playerJoinUrl}
    />
  );
}
```

### `src/app/host/[sessionId]/[gameId]/game-control.tsx`

```
"use client";

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Database, UserRole } from '@/types/database';
import { createClient } from '@/utils/supabase/client';
import { callNextNumber, toggleBreak, validateClaim, recordWinner, skipStage, voidLastNumber, pauseForValidation, resumeGame, announceWin, toggleWinnerPrizeGiven, takeControl, sendHeartbeat, moveToNextGameOnBreak, moveToNextGameAfterWin, advanceToNextStage } from '@/app/host/actions';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Modal } from '@/components/ui/modal';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { BingoBall } from '@/components/ui/bingo-ball';
import { useWakeLock } from '@/hooks/wake-lock';
import { useConnectionHealth } from '@/hooks/use-connection-health';
import { ConnectionBanner } from '@/components/connection-banner';
import { formatPounds, getSnowballCallsLabel, getSnowballCallsRemaining, isSnowballJackpotEligible } from '@/lib/snowball';
import { isFreshGameState } from '@/lib/game-state-version';
import { getRequiredSelectionCountForStage } from '@/lib/win-stages';
import { logError } from '@/lib/log-error';

type Game = Database['public']['Tables']['games']['Row'];
type GameState = Database['public']['Tables']['game_states']['Row'];
type SnowballPot = Database['public']['Tables']['snowball_pots']['Row'];
type Winner = Database['public']['Tables']['winners']['Row'];
type SessionWinner = Winner & {
    game: Pick<Game, 'id' | 'name' | 'game_index'> | null;
};

interface GameControlProps {
    sessionId: string;
    gameId: string;
    game: Game;
    initialGameState: GameState;
    currentUserId: string;
    currentUserRole: UserRole;
}

// Hardcoded for now (same as before)
const NUMBER_NICKNAMES: { [key: number]: string } = {
    1: "Kelly's Eye",
    2: "One Little Duck",
    3: "Debbie McGee",
    4: "Knock at the Door",
    5: "Man Alive",
    6: "Half Dozen",
    7: "Lucky For Some",
    8: "Garden Gate",
    9: "Doctor's Orders",
    10: "Starmers Den",
    11: "Legs Eleven",
    12: "One Dozen",
    13: "Unlucky For Some",
    14: "Valentines Day",
    15: "Young And Keen",
    16: "Sweet Sixteen",
    17: "Dancing Queen",
    20: "Blind Twenty",
    22: "Two Little Ducks",
    25: "Duck And Dive",
    26: "Pick And Mix",
    27: "Gateway To Heaven",
    28: "In A State",
    29: "Rise And Shine",
    30: "Dirty Gertie",
    31: "Get Up And Run",
    32: "Buckle My Shoe",
    33: "All The Threes",
    34: "Ask For More",
    36: "Three Dozen",
    40: "Naughty Forty",
    42: "Winnie The Pooh",
    44: "Droopy Drawers",
    45: "Halfway There",
    46: "Up To Tricks",
    47: "Four And Seven",
    48: "Four Dozen",
    51: "Tweak Of The Thumb",
    52: "Danny La Rue",
    53: "Stuck In The Tree",
    54: "Clean The Floor",
    55: "All The Fives",
    57: "Heinz Varieties",
    58: "Make Them Wait",
    59: "Brighton Line",
    61: "Bakers Bun",
    62: "Tickety Boo",
    63: "Tickle Me",
    66: "Clickety Click",
    67: "Made In Heaven",
    69: "Any Way Up",
    73: "Queen B",
    77: "All The Sevens",
    81: "Stop And Run",
    83: "Time For Tea",
    85: "Staying Alive",
    88: "Two Fat Ladies",
    90: "Top Of The Shop"
};

export default function GameControl({ sessionId, gameId, game, initialGameState, currentUserId, currentUserRole }: GameControlProps) {
    const router = useRouter();
    const [currentGameState, setCurrentGameState] = useState<GameState>(initialGameState);
    const [currentSnowballPot, setCurrentSnowballPot] = useState<SnowballPot | null>(null);
    const [isCallingNumber, setIsCallingNumber] = useState(false);
    const [actionError, setActionError] = useState<string | null>(null);
    const [showValidationModal, setShowValidationModal] = useState(false);
    const [selectedNumbers, setSelectedNumbers] = useState<number[]>([]);
    const [validationResult, setValidationResult] = useState<{ valid: boolean; invalidNumbers?: number[] } | null>(null);
    const [showWinnerModal, setShowWinnerModal] = useState(false);
    const [showManualSnowballModal, setShowManualSnowballModal] = useState(false);
    const [showPostWinModal, setShowPostWinModal] = useState(false);
    const [showSessionWinnersModal, setShowSessionWinnersModal] = useState(false);
    const [showCashJackpotModal, setShowCashJackpotModal] = useState(false);
    const [cashJackpotAmount, setCashJackpotAmount] = useState('');
    const [cashJackpotGameName, setCashJackpotGameName] = useState('Jackpot Game');
    const [cashJackpotMode, setCashJackpotMode] = useState<'next' | 'break'>('next');
    const [isSubmittingCashJackpot, setIsSubmittingCashJackpot] = useState(false);
    const [prizeGiven, setPrizeGiven] = useState(false);
    const [snowballEligible, setSnowballEligible] = useState(false);
    const [isRecordingWinner, setIsRecordingWinner] = useState(false);
    const [isRecordingSnowballWinner, setIsRecordingSnowballWinner] = useState(false);
    const [currentWinners, setCurrentWinners] = useState<Winner[]>([]);
    const [sessionWinners, setSessionWinners] = useState<SessionWinner[]>([]);

    // Singleton Supabase client — all subscriptions share one WebSocket connection
    const supabaseRef = useRef(createClient());

    // Connection health: drives the reconnecting banner + auto-refresh.
    const health = useConnectionHealth();

    // Polling guards: monotonic sequence + in-flight flag prevent stale poll
    // results from clobbering newer state when responses arrive out-of-order.
    const pollSeqRef = useRef(0);
    const pollInFlightRef = useRef(false);

  useWakeLock();

    // Controller Locking Logic
    const isController = currentGameState.controlling_host_id === currentUserId;
    const canTogglePrize = isController && (currentUserRole === 'admin' || currentUserRole === 'host');
    // Allow taking control if no one is controlling OR the last heartbeat was > 30s ago
    const canTakeControl = !currentGameState.controlling_host_id ||
        (currentGameState.controller_last_seen_at && (new Date().getTime() - new Date(currentGameState.controller_last_seen_at).getTime() > 30000));

    useEffect(() => {
        let interval: NodeJS.Timeout;
        if (isController) {
            interval = setInterval(async () => {
                await sendHeartbeat(gameId);
            }, 10000); // Send heartbeat every 10s
        }
        return () => clearInterval(interval);
    }, [isController, gameId]);

    const handleTakeControl = async () => {
        setActionError(null);
        const result = await takeControl(gameId);
        if (!result?.success) {
            setActionError(result?.error || "Failed to take control.");
        }
    };

    const getPlannedPrize = useCallback((stageIndex: number) => {
        const stage = game.stage_sequence[stageIndex];
        return game.prizes?.[stage as keyof typeof game.prizes] || '';
    }, [game]);

    const [prizeDescription, setPrizeDescription] = useState(getPlannedPrize(initialGameState.current_stage_index));

    // Winners Subscription
    useEffect(() => {
        const supabase = supabaseRef.current;
        const fetchWinners = async () => {
            const { data } = await supabase.from('winners').select('*').eq('game_id', gameId).order('created_at', { ascending: false });
            if (data) setCurrentWinners(data);
        };

        fetchWinners();

        const channel = supabase
            .channel(`winners:${gameId}`)
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'winners', filter: `game_id=eq.${gameId}` },
                () => {
                    fetchWinners();
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [gameId]);

    // Session-wide winners subscription so prize status can be managed after moving to later games
    useEffect(() => {
        const supabase = supabaseRef.current;
        const fetchSessionWinners = async () => {

[truncated at line 200 — original has 1332 lines]
```

### `src/app/host/actions.ts`

```
'use server'

import { createClient } from '@/utils/supabase/server'
import { revalidatePath } from 'next/cache'
import { GameStatus, WinStage, UserRole } from '@/types/database'
import type { Database } from '@/types/database'
import type { ActionResult } from '@/types/actions'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import { formatPounds, isSnowballJackpotEligible } from '@/lib/snowball'
import { formatCashJackpotPrize, isCashJackpotGame, parseCashJackpotAmount } from '@/lib/jackpot'
import { getRequiredSelectionCountForStage } from '@/lib/win-stages'

type HostAuthResult =
  | { authorized: false; error: string }
  | { authorized: true; user: User; role: UserRole }

async function authorizeHost(
  supabase: SupabaseClient<Database>
): Promise<HostAuthResult> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { authorized: false, error: "Not authenticated" };
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single<{ role: UserRole }>();

  if (profileError || !profile || (profile.role !== 'admin' && profile.role !== 'host')) {
    return { authorized: false, error: "Unauthorized: Host or Admin access required" };
  }
  
  return { authorized: true, user, role: profile.role };
}

async function requireController(
  supabase: SupabaseClient<Database>,
  gameId: string
): Promise<HostAuthResult> {
  const authResult = await authorizeHost(supabase)
  if (!authResult.authorized) {
    return { authorized: false, error: authResult.error }
  }

  const { data: gameState, error: gameStateError } = await supabase
    .from('game_states')
    .select('controlling_host_id')
    .eq('game_id', gameId)
    .single<Pick<Database['public']['Tables']['game_states']['Row'], 'controlling_host_id'>>()

  if (gameStateError || !gameState) {
    return { authorized: false, error: gameStateError?.message || "Game state not found." }
  }

  if (!gameState.controlling_host_id || gameState.controlling_host_id !== authResult.user!.id) {
    return { authorized: false, error: "Another host is currently controlling this game." }
  }

  return { authorized: true, user: authResult.user!, role: authResult.role }
}

function getServiceRoleClient() {
    if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
        return createSupabaseClient<Database>(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY,
            {
                auth: {
                    autoRefreshToken: false,
                    persistSession: false
                }
            }
        );
    }
    return null;
}

// Helper to generate a shuffled 1-90 array
function generateShuffledNumberSequence(): number[] {
  const numbers = Array.from({ length: 90 }, (_, i) => i + 1);
  for (let i = numbers.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [numbers[i], numbers[j]] = [numbers[j], numbers[i]]; // Swap
  }
  return numbers;
}

// Shared Snowball Logic Helper
async function handleSnowballPotUpdate(supabase: SupabaseClient<Database>, sessionId: string, gameId: string): Promise<{ success: boolean; error?: string }> {
    // 1. Check session type
    const { data: session, error: sessionError } = await supabase
        .from('sessions')
        .select('is_test_session')
        .eq('id', sessionId)
        .single<Pick<Database['public']['Tables']['sessions']['Row'], 'is_test_session'>>();

    if (sessionError) {
        return { success: false, error: "Error checking session type for snowball logic: " + sessionError.message };
    }

    if (session?.is_test_session) {
         return { success: true };
    }

    // 2. Check game type
    const { data: gameData } = await supabase
        .from('games')
        .select('type, snowball_pot_id')
        .eq('id', gameId)
        .single<Pick<Database['public']['Tables']['games']['Row'], 'type' | 'snowball_pot_id'>>();

    if (gameData?.type !== 'snowball' || !gameData.snowball_pot_id) return { success: true };

    // 3. Check for jackpot winner
    const { count } = await supabase
        .from('winners')
        .select('*', { count: 'exact', head: true })
        .eq('game_id', gameId)
        .eq('is_snowball_jackpot', true);

    const jackpotWon = count !== null && count > 0;

    const { data: potData } = await supabase
        .from('snowball_pots')
        .select('*')
        .eq('id', gameData.snowball_pot_id)
        .single<Database['public']['Tables']['snowball_pots']['Row']>();

    if (!potData) return { success: true };

    if (jackpotWon) {
        const resetUpdate: Database['public']['Tables']['snowball_pots']['Update'] = {
            current_max_calls: potData.base_max_calls,
            current_jackpot_amount: potData.base_jackpot_amount,
            last_awarded_at: new Date().toISOString()
        };
        const { error: potError } = await supabase
          .from('snowball_pots')
          .update(resetUpdate)
          .eq('id', potData.id);

        if (potError) {
            return { success: false, error: "Failed to reset snowball pot: " + potError.message };
        } else {
            const jackpotHistory: Database['public']['Tables']['snowball_pot_history']['Insert'] = {
                snowball_pot_id: potData.id,
                change_type: 'jackpot_won',
                old_val_max: potData.current_max_calls,
                new_val_max: potData.base_max_calls,
                old_val_jackpot: potData.current_jackpot_amount,
                new_val_jackpot: potData.base_jackpot_amount,
            };
            await supabase.from('snowball_pot_history').insert(jackpotHistory);
        }
    } else {
        // Rollover
        const newMaxCalls = potData.current_max_calls + potData.calls_increment;
        const newJackpot = Number(potData.current_jackpot_amount) + Number(potData.jackpot_increment);

        const rolloverUpdate: Database['public']['Tables']['snowball_pots']['Update'] = {
            current_max_calls: newMaxCalls,
            current_jackpot_amount: newJackpot
        };
        const { error: potError } = await supabase
          .from('snowball_pots')
          .update(rolloverUpdate)
          .eq('id', potData.id);

        if (potError) {
            return { success: false, error: "Failed to rollover snowball pot: " + potError.message };
        } else {
            const rolloverHistory: Database['public']['Tables']['snowball_pot_history']['Insert'] = {
                snowball_pot_id: potData.id,
                change_type: 'rollover',
                old_val_max: potData.current_max_calls,
                new_val_max: newMaxCalls,
                old_val_jackpot: potData.current_jackpot_amount,
                new_val_jackpot: newJackpot,
            };
            await supabase.from('snowball_pot_history').insert(rolloverHistory);
        }
    }
    return { success: true };
}

async function maybeCompleteSession(supabase: SupabaseClient<Database>, sessionId: string) {
    const { data: games, error } = await supabase
        .from('games')
        .select('id')
        .eq('session_id', sessionId)

    if (error || !games || games.length === 0) return;

    const gameIds = games.map((g: { id: string }) => g.id);
    const { data: completedStates, error: completedStatesError } = await supabase
        .from('game_states')
        .select('game_id')

[truncated at line 200 — original has 1433 lines]
```

### `src/app/login/actions.ts`

```
'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { createClient } from '@/utils/supabase/server'
import type { ActionResult } from '@/types/actions'

function sanitizeNextUrl(rawNext: string | null) {
  const nextUrl = rawNext || '/'
  if (!nextUrl.startsWith('/')) return '/'
  if (nextUrl.startsWith('//')) return '/'
  return nextUrl
}

export async function login(formData: FormData): Promise<ActionResult> {
  const supabase = await createClient()

  const email = formData.get('email') as string
  const password = formData.get('password') as string
  const nextUrl = sanitizeNextUrl(formData.get('next') as string | null)

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  })

  if (error) {
    return { success: false, error: error.message }
  }

  revalidatePath('/', 'layout')
  return { success: true, redirectTo: nextUrl }
}

// NOTE: Public sign-up is disabled — this project is invite-only.
// This action is gated to prevent unauthorized account creation; the login UI
// no longer surfaces a sign-up affordance, but the export is preserved so any
// internal/future invite flow has a stable hook to plug into.
export async function signup(): Promise<ActionResult> {
  return { success: false, error: 'Registration is invite-only. Please contact an administrator.' }
}

export async function signout() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  revalidatePath('/', 'layout')
  redirect('/login')
}
```

### `src/app/login/page.tsx`

```
'use client';

import React, { Suspense, useState, useTransition } from 'react';
import Image from 'next/image';
import { useSearchParams, useRouter } from 'next/navigation';
import { login } from './actions';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

function LoginPageContent() {
  const searchParams = useSearchParams();
  const next = searchParams.get('next') || '/';
  const router = useRouter();

  const [isPending, startTransition] = useTransition();
  const missingSupabaseConfig = !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const [error, setError] = useState<string | null>(
    missingSupabaseConfig
      ? "Configuration Error: Missing Supabase Environment Variables. Please check your .env.local file."
      : null
  );

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    const formData = new FormData(event.currentTarget);
    formData.append('next', next);

    startTransition(async () => {
      const result = await login(formData);
      if (!result?.success) {
        setError(result?.error || "Authentication failed. Please try again.");
      } else if (result.redirectTo) {
        router.push(result.redirectTo);
      }
    });
  };

  return (
    <div className="min-h-screen-safe flex flex-col items-center justify-center p-4 bg-gradient-to-b from-[#005131] to-[#003f27]">
      <div className="mb-8 relative w-56 h-24">
         <Image
          src="/the-anchor-pub-logo-white-transparent.png"
          alt="The Anchor"
          fill
          className="object-contain"
          priority
        />
      </div>

      <Card className="w-full max-w-md border-[#1f7c58] shadow-2xl shadow-black/30 bg-[#005131]/90 backdrop-blur-sm">
        <CardHeader>
          <CardTitle className="text-center text-2xl text-[#f5f1e6] font-bold">
            Welcome Back
          </CardTitle>
        </CardHeader>
        <CardContent>
          {error && (
            <div className="mb-4 p-3 text-sm text-red-200 bg-red-900/50 border border-red-800 rounded-md">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-emerald-50/90" htmlFor="email">
                Email address
              </label>
              <Input
                id="email"
                name="email"
                type="email"
                placeholder="Enter email"
                required
                className="bg-[#003f27]/70 border-[#2f8f6a] focus:border-[#a57626]"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-emerald-50/90" htmlFor="password">
                Password
              </label>
              <Input
                id="password"
                name="password"
                type="password"
                placeholder="Password"
                required
                className="bg-[#003f27]/70 border-[#2f8f6a] focus:border-[#a57626]"
              />
            </div>

            <div className="pt-2 space-y-3">
              <Button
                type="submit"
                className="w-full"
                size="lg"
                isLoading={isPending}
              >
                Sign In
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-[#f5f1e6] bg-[#005131]">Loading...</div>}>
      <LoginPageContent />
    </Suspense>
  );
}
```

### `src/app/player/[sessionId]/page.tsx`

```
import React from 'react';
import { createClient } from '@/utils/supabase/server';
import { notFound } from 'next/navigation';
import PlayerUI from './player-ui';
import { Database } from '@/types/database';
import { isUuid } from '@/lib/utils';
import { logError } from '@/lib/log-error';

interface PageProps {
  params: Promise<{ sessionId: string }>;
}

// Explicit narrow column lists keep public surfaces from leaking unintended
// fields and document exactly what the UI consumes from each table.
const SESSION_SELECT = 'id, name, status, active_game_id';
const GAME_SELECT =
  'id, session_id, game_index, name, type, stage_sequence, background_colour, prizes, snowball_pot_id';
const GAME_STATE_PUBLIC_SELECT =
  'game_id, called_numbers, numbers_called_count, current_stage_index, status, call_delay_seconds, on_break, paused_for_validation, display_win_type, display_win_text, display_winner_name, started_at, ended_at, last_call_at, updated_at, state_version';

export default async function PlayerPage({ params }: PageProps) {
  const { sessionId } = await params;

  if (!isUuid(sessionId)) {
    notFound();
  }

  const supabase = await createClient();

  // Fetch session details
  const { data: session, error: sessionError } = await supabase
    .from('sessions')
    .select(SESSION_SELECT)
    .eq('id', sessionId)
    .single<Database['public']['Tables']['sessions']['Row']>();

  if (sessionError || !session) {
    logError('player', sessionError ?? new Error('Session not found'));
    notFound();
  }

  let activeGame: Database['public']['Tables']['games']['Row'] | null = null;
  let initialGameState: Database['public']['Tables']['game_states_public']['Row'] | null = null;
  let prizeText: string = '';

  if (session.active_game_id) {
    // Fetch the active game details
    const { data: game, error: gameError } = await supabase
      .from('games')
      .select(GAME_SELECT)
      .eq('id', session.active_game_id)
      .single<Database['public']['Tables']['games']['Row']>();

    if (gameError || !game) {
      logError('player', gameError ?? new Error('No active game found for session'));
    } else {
      activeGame = game;
      // Fetch the initial game state for the active game
      const { data: gameState, error: gameStateError } = await supabase
        .from('game_states_public')
        .select(GAME_STATE_PUBLIC_SELECT)
        .eq('game_id', game.id)
        .single<Database['public']['Tables']['game_states_public']['Row']>();

      if (gameStateError || !gameState) {
        logError('player', gameStateError ?? new Error('No game state found for active game'));
      } else {
        initialGameState = gameState;
        if (game.prizes && game.stage_sequence && gameState.current_stage_index !== undefined) {
          const currentStage = game.stage_sequence[gameState.current_stage_index];
          prizeText = game.prizes[currentStage as keyof typeof game.prizes] || '';
        }
      }
    }
  }

  return (
    <PlayerUI
      session={session}
      activeGame={activeGame}
      initialGameState={initialGameState}
      initialPrizeText={prizeText}
    />
  );
}
```

### `src/app/player/[sessionId]/player-ui.tsx`

```
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
import { isFreshGameState } from '@/lib/game-state-version';
import { useConnectionHealth } from '@/hooks/use-connection-health';
import { ConnectionBanner } from '@/components/connection-banner';
import type { RealtimeStatus } from '@/lib/connection-health';
import { logError } from '@/lib/log-error';

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

// Explicit narrow column lists keep public surfaces from leaking unintended
// fields and document exactly what the UI consumes from each table.
const SESSION_SELECT = 'id, name, status, active_game_id';
const GAME_SELECT =
  'id, session_id, game_index, name, type, stage_sequence, background_colour, prizes, snowball_pot_id';
const GAME_STATE_PUBLIC_SELECT =
  'game_id, called_numbers, numbers_called_count, current_stage_index, status, call_delay_seconds, on_break, paused_for_validation, display_win_type, display_win_text, display_winner_name, started_at, ended_at, last_call_at, updated_at, state_version';

const POLL_INTERVAL_MS = 3000;

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
  // Tracks whether we have applied any usable game state (initial render or
  // first poll/realtime payload). Used to gate the "Connecting to game…" skeleton.
  const [hasLoaded, setHasLoaded] = useState<boolean>(initialActiveGameState != null);

  const numberCallTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Connection health: drives the reconnecting banner + auto-refresh.
  const health = useConnectionHealth();
  const { markPollSuccess, markPollFailure, markRealtimeStatus } = health;

  // Polling guards: monotonic sequence + in-flight flag prevent stale poll
  // results from clobbering newer state when responses arrive out-of-order.
  const pollSeqRef = useRef(0);
  const pollInFlightRef = useRef(false);

  // Stable ref so subscription callbacks can read the active game without
  // re-running this effect every time the game object identity changes.
  const currentActiveGameRef = useRef(currentActiveGame);
  useEffect(() => {
    currentActiveGameRef.current = currentActiveGame;
  }, [currentActiveGame]);

  const { isLocked: isWakeLockActive } = useWakeLock();


  // --- Data Fetching & Subscription Logic (Shared with Display) ---

  const refreshActiveGame = useCallback(async (newActiveGameId: string | null) => {
    if (newActiveGameId === currentActiveGame?.id) return;

    if (newActiveGameId) {
      const { data: newGame } = await supabase.current
        .from('games')
        .select(GAME_SELECT)
        .eq('id', newActiveGameId)
        .single<Database['public']['Tables']['games']['Row']>();

      if (newGame) {
        setCurrentActiveGame(newGame);
        const { data: newGameState } = await supabase.current
          .from('game_states_public')
          .select(GAME_STATE_PUBLIC_SELECT)
          .eq('game_id', newGame.id)
          .single<Database['public']['Tables']['game_states_public']['Row']>();

        if (newGameState) {
          setCurrentGameState(newGameState);
          setHasLoaded(true);
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
  }, [currentActiveGame?.id]);

  // Session-level realtime: track changes to active_game_id / status.
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

    return () => {
      supabaseClient.removeChannel(sessionChannel);
    };
  }, [session.id, refreshActiveGame]);

  // Game state realtime with exponential-backoff auto-reconnect.
  // Each reconnect tears down the previous channel before creating the next
  // (ordering matters — Supabase rejects subscribe() against a torn channel).
  useEffect(() => {
    const supabaseClient = supabase.current;
    const activeGameId = currentActiveGame?.id;
    if (!activeGameId) return;

    let isMounted = true;
    let activeChannel: ReturnType<typeof supabaseClient.channel> | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let attemptCount = 0;

    const connect = async () => {
      if (!isMounted) return;
      if (activeChannel) {
        await supabaseClient.removeChannel(activeChannel);
        activeChannel = null;
      }
      if (!isMounted) return;

      const channel = supabaseClient
        .channel(`game_state_public_updates_player:${activeGameId}:${Date.now()}`)
        .on<GameState>(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'game_states_public', filter: `game_id=eq.${activeGameId}` },
          (payload) => {
            if (!isMounted) return;
            const incoming = payload.new as GameState;
            // Freshness gate: ignore older snapshots that may arrive after a
            // reconnect or out-of-order broadcast (state_version is monotonic).
            setCurrentGameState((current) => (isFreshGameState(current, incoming) ? incoming : current));
            setHasLoaded(true);
            const game = currentActiveGameRef.current;
            if (game) {
              const stageKey = game.stage_sequence[incoming.current_stage_index];
              setCurrentPrizeText(game.prizes?.[stageKey as keyof typeof game.prizes] || '');
            }
          }
        )
        .subscribe((status) => {
          if (!isMounted) return;
          markRealtimeStatus(status as RealtimeStatus);
          if (status === 'SUBSCRIBED') {
            attemptCount = 0;
            return;
          }
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            if (reconnectTimer) clearTimeout(reconnectTimer);
            // Exponential backoff: 1s, 2s, 4s … capped at 30s.
            const delay = Math.min(1000 * Math.pow(2, attemptCount), 30000);
            attemptCount += 1;
            reconnectTimer = setTimeout(() => { void connect(); }, delay);
          }
        });

      activeChannel = channel;
    };


[truncated at line 200 — original has 649 lines]
```

### `src/components/connection-banner.tsx`

```
// src/components/connection-banner.tsx
'use client';
import { useEffect } from 'react';

interface ConnectionBannerProps {
  visible: boolean;
  shouldAutoRefresh: boolean;
}

export function ConnectionBanner({ visible, shouldAutoRefresh }: ConnectionBannerProps) {
  useEffect(() => {
    if (shouldAutoRefresh) {
      window.location.reload();
    }
  }, [shouldAutoRefresh]);

  if (!visible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed top-2 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-full bg-amber-500/90 px-4 py-2 text-sm text-white shadow"
    >
      <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-white" />
      <span>Reconnecting…</span>
      <button
        type="button"
        className="ml-2 rounded bg-white/20 px-2 py-1 text-xs hover:bg-white/30"
        onClick={() => window.location.reload()}
      >
        Refresh
      </button>
    </div>
  );
}
```

### `src/components/ui/button.tsx`

```
import * as React from "react";
import { cn } from "@/lib/utils";

// We need to install class-variance-authority for this pattern, or just write it manually. 
// For now, I'll write it manually to avoid extra deps if possible, but CVA is standard in shadcn/ui which is what I'm mimicking. 
// Actually, I'll just write a simple switch for now to save a dependency, or install it. 
// Installing class-variance-authority is better for long term.

// Let's stick to simple props for now to keep it light, but I'll structure it so it's easy to read.

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "outline" | "ghost" | "danger";
  size?: "sm" | "md" | "lg" | "xl";
  isLoading?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", isLoading, children, disabled, ...props }, ref) => {
    
    const baseStyles = "inline-flex items-center justify-center rounded-lg font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#a57626] disabled:pointer-events-none disabled:opacity-50 active:scale-95 transition-transform";
    
    const variants = {
      primary: "bg-gradient-to-r from-[#005131] to-[#0f6846] text-white hover:from-[#0f6846] hover:to-[#136f4b] shadow-lg shadow-black/20 border border-[#1f7c58]",
      secondary: "bg-[#0f6846] text-white hover:bg-[#136f4b] border border-[#1f7c58]",
      outline: "border-2 border-[#a57626] text-white hover:bg-[#a57626]/25 hover:text-white",
      ghost: "hover:bg-[#0f6846] text-white/85 hover:text-white",
      danger: "bg-red-600 text-white hover:bg-red-700",
    };

    const sizes = {
      sm: "h-10 px-3 text-sm",
      md: "h-10 px-4 py-2",
      lg: "h-12 px-8 text-lg",
      xl: "h-16 px-8 text-xl w-full", // Great for Host main buttons
    };

    return (
      <button
        className={cn(baseStyles, variants[variant], sizes[size], className)}
        ref={ref}
        disabled={disabled || isLoading}
        {...props}
      >
        {isLoading && (
          <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-current" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
        )}
        {children}
      </button>
    );
  }
);
Button.displayName = "Button";

export { Button };
```

### `src/components/ui/modal.tsx`

```
import React, { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  showCloseButton?: boolean;
}

/**
 * Trap keyboard focus inside the modal while open and return focus to the
 * previously-focused element when it closes. Forwards Escape to the modal's
 * close button so consumers don't have to wire it twice.
 */
function useFocusTrap(open: boolean, container: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    if (!open || !container.current) return;
    const root = container.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const focusable = () =>
      Array.from(
        root.querySelectorAll<HTMLElement>(
          'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );

    // Move focus inside the dialog. Prefer the close button so screen readers
    // announce the dialog title without trapping users on a destructive action.
    const initial =
      root.querySelector<HTMLButtonElement>('[data-modal-close]') ?? focusable()[0];
    initial?.focus();

    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        root.querySelector<HTMLButtonElement>('[data-modal-close]')?.click();
        return;
      }
      if (e.key !== 'Tab') return;
      const list = focusable();
      if (list.length === 0) return;
      const first = list[0];
      const last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handler);
    return () => {
      document.removeEventListener('keydown', handler);
      // Return focus to the element that opened the modal.
      previouslyFocused?.focus?.();
    };
  }, [open, container]);
}

export function Modal({
  isOpen,
  onClose,
  title,
  children,
  footer,
  className,
  showCloseButton = true,
}: ModalProps & { className?: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    }
    return () => {
      document.body.style.overflow = "unset";
    };
  }, [isOpen]);

  useFocusTrap(isOpen, containerRef);

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        ref={containerRef}
        className={cn(
          "relative w-full max-w-lg bg-[#003f27] border border-[#1f7c58] rounded-xl shadow-2xl animate-in zoom-in-95 duration-200 max-h-[90vh] flex flex-col text-white",
          className
        )}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="flex items-center justify-between p-4 border-b border-[#1f7c58] shrink-0">
          <h2 id={titleId} className="text-lg font-bold text-white">{title}</h2>
          {showCloseButton ? (
            <button
              type="button"
              data-modal-close
              aria-label="Close"
              onClick={onClose}
              className="p-2.5 rounded-md text-white/70 hover:text-white hover:bg-[#0f6846] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#a57626]"
            >
              ✕
            </button>
          ) : null}
        </div>

        <div className="p-4 overflow-y-auto">
          {children}
        </div>

        {footer && (
          <div className="flex items-center justify-end gap-2 p-4 border-t border-[#1f7c58] shrink-0 bg-[#003f27] rounded-b-xl">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
```

### `src/hooks/use-connection-health.ts`

```
// src/hooks/use-connection-health.ts
'use client';
import { useCallback, useEffect, useReducer, useState } from 'react';
import {
  HealthState,
  RealtimeStatus,
  initialHealthState,
  reduceHealth,
  selectShouldAutoRefresh,
  selectShouldShowBanner,
} from '@/lib/connection-health';

export interface UseConnectionHealthApi {
  healthy: boolean;
  shouldShowBanner: boolean;
  shouldAutoRefresh: boolean;
  unhealthyForMs: number;
  markPollSuccess: () => void;
  markPollFailure: () => void;
  markRealtimeStatus: (status: RealtimeStatus) => void;
}

export function useConnectionHealth(): UseConnectionHealthApi {
  const [state, dispatch] = useReducer(
    (s: HealthState, e: Parameters<typeof reduceHealth>[1]) => reduceHealth(s, e),
    null,
    () => initialHealthState(Date.now()),
  );
  const [now, setNow] = useState(() => Date.now());

  // Tick once a second so banner/auto-refresh thresholds re-evaluate without
  // requiring the host to dispatch an event for time to pass.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Wire window online/offline.
  useEffect(() => {
    const onOnline = () => dispatch({ type: 'browser-online', at: Date.now() });
    const onOffline = () => dispatch({ type: 'browser-offline', at: Date.now() });
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  const markPollSuccess = useCallback(() => {
    dispatch({ type: 'poll-success', at: Date.now() });
  }, []);
  const markPollFailure = useCallback(() => {
    dispatch({ type: 'poll-failure', at: Date.now() });
  }, []);
  const markRealtimeStatus = useCallback((status: RealtimeStatus) => {
    dispatch({ type: 'realtime-status', status, at: Date.now() });
  }, []);

  return {
    healthy: state.healthy,
    shouldShowBanner: selectShouldShowBanner(state, now),
    shouldAutoRefresh: selectShouldAutoRefresh(state, now),
    unhealthyForMs: state.unhealthySinceMs == null ? 0 : Math.max(0, now - state.unhealthySinceMs),
    markPollSuccess,
    markPollFailure,
    markRealtimeStatus,
  };
}
```

### `src/lib/connection-health.test.ts`

```
// src/lib/connection-health.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  initialHealthState,
  reduceHealth,
  selectShouldShowBanner,
  selectShouldAutoRefresh,
} from './connection-health';

const t0 = 1_700_000_000_000; // arbitrary fixed epoch ms

test('starts healthy', () => {
  const s = initialHealthState(t0);
  assert.equal(s.healthy, true);
  assert.equal(selectShouldShowBanner(s, t0), false);
  assert.equal(selectShouldAutoRefresh(s, t0), false);
});

test('poll failure flips to unhealthy at the moment of failure', () => {
  let s = initialHealthState(t0);
  s = reduceHealth(s, { type: 'poll-failure', at: t0 + 1000 });
  assert.equal(s.healthy, false);
  assert.equal(s.unhealthySinceMs, t0 + 1000);
});

test('does not show banner before 10s unhealthy', () => {
  let s = initialHealthState(t0);
  s = reduceHealth(s, { type: 'poll-failure', at: t0 + 1000 });
  assert.equal(selectShouldShowBanner(s, t0 + 5000), false); // 4s in
  assert.equal(selectShouldShowBanner(s, t0 + 11000), true); // 10s in
});

test('auto-refresh triggers at 30s unhealthy', () => {
  let s = initialHealthState(t0);
  s = reduceHealth(s, { type: 'poll-failure', at: t0 + 1000 });
  assert.equal(selectShouldAutoRefresh(s, t0 + 30000), false); // 29s
  assert.equal(selectShouldAutoRefresh(s, t0 + 31001), true);  // 30.001s
});

test('poll success while unhealthy returns to healthy and clears flags', () => {
  let s = initialHealthState(t0);
  s = reduceHealth(s, { type: 'poll-failure', at: t0 + 1000 });
  s = reduceHealth(s, { type: 'poll-success', at: t0 + 5000 });
  assert.equal(s.healthy, true);
  assert.equal(s.unhealthySinceMs, null);
});

test('navigator.onLine === false flips to unhealthy immediately', () => {
  let s = initialHealthState(t0);
  s = reduceHealth(s, { type: 'browser-offline', at: t0 + 100 });
  assert.equal(s.healthy, false);
  assert.equal(s.unhealthySinceMs, t0 + 100);
});

test('realtime CHANNEL_ERROR flips to unhealthy; SUBSCRIBED clears it', () => {
  let s = initialHealthState(t0);
  s = reduceHealth(s, { type: 'realtime-status', status: 'CHANNEL_ERROR', at: t0 + 100 });
  assert.equal(s.healthy, false);
  s = reduceHealth(s, { type: 'realtime-status', status: 'SUBSCRIBED', at: t0 + 200 });
  assert.equal(s.healthy, true);
});
```

### `src/lib/connection-health.ts`

```
// src/lib/connection-health.ts
export type RealtimeStatus = 'SUBSCRIBED' | 'CHANNEL_ERROR' | 'TIMED_OUT' | 'CLOSED' | 'JOINING';

export type HealthEvent =
  | { type: 'poll-success'; at: number }
  | { type: 'poll-failure'; at: number }
  | { type: 'browser-online'; at: number }
  | { type: 'browser-offline'; at: number }
  | { type: 'realtime-status'; status: RealtimeStatus; at: number };

export interface HealthState {
  healthy: boolean;
  unhealthySinceMs: number | null;
  lastSuccessAt: number;
  online: boolean;
  realtime: RealtimeStatus | null;
}

const BANNER_THRESHOLD_MS = 10_000;
const AUTO_REFRESH_THRESHOLD_MS = 30_000;

export function initialHealthState(now: number): HealthState {
  return {
    healthy: true,
    unhealthySinceMs: null,
    lastSuccessAt: now,
    online: true,
    realtime: null,
  };
}

function flipUnhealthy(state: HealthState, at: number): HealthState {
  if (!state.healthy) return state;
  return { ...state, healthy: false, unhealthySinceMs: at };
}

function flipHealthy(state: HealthState, at: number): HealthState {
  return { ...state, healthy: true, unhealthySinceMs: null, lastSuccessAt: at };
}

export function reduceHealth(state: HealthState, event: HealthEvent): HealthState {
  switch (event.type) {
    case 'poll-success':
      return flipHealthy(state, event.at);
    case 'poll-failure':
      return flipUnhealthy(state, event.at);
    case 'browser-online':
      return { ...state, online: true };
    case 'browser-offline':
      return flipUnhealthy({ ...state, online: false }, event.at);
    case 'realtime-status': {
      const next = { ...state, realtime: event.status };
      if (event.status === 'SUBSCRIBED') return flipHealthy(next, event.at);
      if (event.status === 'CHANNEL_ERROR' || event.status === 'TIMED_OUT' || event.status === 'CLOSED') {
        return flipUnhealthy(next, event.at);
      }
      return next;
    }
  }
}

export function selectShouldShowBanner(state: HealthState, now: number): boolean {
  if (state.healthy || state.unhealthySinceMs == null) return false;
  return now - state.unhealthySinceMs >= BANNER_THRESHOLD_MS;
}

export function selectShouldAutoRefresh(state: HealthState, now: number): boolean {
  if (state.healthy || state.unhealthySinceMs == null) return false;
  return now - state.unhealthySinceMs > AUTO_REFRESH_THRESHOLD_MS;
}
```

### `src/lib/game-state-version.test.ts`

```
// src/lib/game-state-version.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isFreshGameState } from './game-state-version';

test('isFreshGameState returns true when current is null', () => {
  assert.equal(
    isFreshGameState(null, { state_version: 5 }),
    true
  );
});

test('isFreshGameState returns false when incoming is null', () => {
  assert.equal(
    isFreshGameState({ state_version: 5 }, null),
    false
  );
});

test('isFreshGameState accepts higher version', () => {
  assert.equal(
    isFreshGameState({ state_version: 5 }, { state_version: 6 }),
    true
  );
});

test('isFreshGameState accepts equal version (idempotent reapply)', () => {
  assert.equal(
    isFreshGameState({ state_version: 5 }, { state_version: 5 }),
    true
  );
});

test('isFreshGameState rejects lower version', () => {
  assert.equal(
    isFreshGameState({ state_version: 5 }, { state_version: 4 }),
    false
  );
});

test('isFreshGameState ignores numbers_called_count when version is newer (void path)', () => {
  // Voiding a number legitimately decreases numbers_called_count.
  // The helper must not refuse a newer state just because the count is lower.
  const current = { state_version: 5, numbers_called_count: 10 };
  const incoming = { state_version: 6, numbers_called_count: 9 };
  assert.equal(isFreshGameState(current, incoming), true);
});
```

### `src/lib/game-state-version.ts`

```
// src/lib/game-state-version.ts
export interface HasStateVersion {
  state_version: number;
}

/**
 * Decide whether to apply an incoming game-state snapshot from realtime or polling.
 *
 * Rules:
 * - Always apply when no current state.
 * - Never apply when incoming is missing.
 * - Apply when incoming.state_version >= current.state_version.
 *   Equal versions are allowed because reapplying the same snapshot is idempotent
 *   and the trigger may produce duplicate broadcasts during reconnect.
 *
 * Do NOT compare numbers_called_count: voiding a number legitimately decreases it.
 */
export function isFreshGameState(
  current: HasStateVersion | null | undefined,
  incoming: HasStateVersion | null | undefined,
): boolean {
  if (!incoming) return false;
  if (!current) return true;
  return incoming.state_version >= current.state_version;
}
```

### `src/lib/log-error.test.ts`

```
// src/lib/log-error.test.ts
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { logError } from './log-error';

test('redacts UUIDs from messages', () => {
  const calls: unknown[][] = [];
  const spy = mock.method(console, 'error', (...args: unknown[]) => { calls.push(args); });
  process.env.LOG_ERRORS = 'true';
  logError('test', new Error('failed for user 7c2c1d6e-7e5b-4d9d-9f8c-2e8c5a2b1f30'));
  spy.mock.restore();
  assert.equal(calls.length, 1);
  const message = (calls[0][1] as Error).message;
  assert.match(message, /\[redacted-uuid\]/);
});

test('no-op in production unless LOG_ERRORS=true', () => {
  const calls: unknown[][] = [];
  const spy = mock.method(console, 'error', (...args: unknown[]) => { calls.push(args); });
  // Cast through Record to bypass the readonly NODE_ENV typing inherited from Next.js.
  (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
  delete process.env.LOG_ERRORS;
  logError('test', new Error('boom'));
  spy.mock.restore();
  assert.equal(calls.length, 0);
});
```

### `src/lib/log-error.ts`

```
// src/lib/log-error.ts
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

export function logError(scope: string, err: unknown): void {
  if (process.env.NODE_ENV === 'production' && process.env.LOG_ERRORS !== 'true') {
    return;
  }
  const safe = err instanceof Error ? new Error(err.message.replace(UUID_RE, '[redacted-uuid]')) : err;
  console.error(`[${scope}]`, safe);
}
```

### `src/lib/prize-validation.test.ts`

```
// src/lib/prize-validation.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateGamePrizes } from './prize-validation';

test('standard game with full prize map passes', () => {
  const r = validateGamePrizes({
    type: 'standard',
    stage_sequence: ['Line', 'Two Lines', 'Full House'],
    prizes: { Line: '£10', 'Two Lines': '£20', 'Full House': '£50' },
  });
  assert.deepEqual(r, { valid: true });
});

test('standard game with one missing stage prize fails', () => {
  const r = validateGamePrizes({
    type: 'standard',
    stage_sequence: ['Line', 'Two Lines', 'Full House'],
    prizes: { Line: '£10', 'Two Lines': '', 'Full House': '£50' },
  });
  assert.equal(r.valid, false);
  assert.deepEqual((r as { valid: false; missingStages: string[] }).missingStages, ['Two Lines']);
});

test('standard game with whitespace-only prize fails', () => {
  const r = validateGamePrizes({
    type: 'standard',
    stage_sequence: ['Line'],
    prizes: { Line: '   ' },
  });
  assert.equal(r.valid, false);
});

test('snowball game requires Full House prize', () => {
  const ok = validateGamePrizes({
    type: 'snowball',
    stage_sequence: ['Full House'],
    prizes: { 'Full House': '£100' },
  });
  assert.deepEqual(ok, { valid: true });

  const bad = validateGamePrizes({
    type: 'snowball',
    stage_sequence: ['Full House'],
    prizes: { 'Full House': '' },
  });
  assert.equal(bad.valid, false);
});

test('jackpot game with empty admin prizes is allowed (host enters at start)', () => {
  const r = validateGamePrizes({
    type: 'jackpot',
    stage_sequence: ['Full House'],
    prizes: {},
  });
  assert.deepEqual(r, { valid: true });
});
```

### `src/lib/prize-validation.ts`

```
// src/lib/prize-validation.ts
import type { GameType, WinStage } from '@/types/database';

export type PrizeValidationInput = {
  type: GameType;
  stage_sequence: WinStage[];
  prizes: Partial<Record<WinStage, string>>;
};

export type PrizeValidationResult =
  | { valid: true }
  | { valid: false; missingStages: WinStage[] };

/**
 * Validate that admin-entered prizes meet the requirements for a game.
 *
 * Rules:
 * - standard: every stage in stage_sequence has a non-empty trimmed prize.
 * - snowball: 'Full House' must have a non-empty trimmed prize. Other stages optional.
 * - jackpot: prizes are not required at admin time. The host enters the cash amount
 *            at game start via startGame().
 */
export function validateGamePrizes(input: PrizeValidationInput): PrizeValidationResult {
  const trim = (s: unknown) => (typeof s === 'string' ? s.trim() : '');

  if (input.type === 'jackpot') {
    return { valid: true };
  }

  const requiredStages: WinStage[] =
    input.type === 'snowball'
      ? ['Full House']
      : input.stage_sequence;

  const missingStages = requiredStages.filter(
    (stage) => trim(input.prizes[stage]).length === 0,
  );

  if (missingStages.length === 0) return { valid: true };
  return { valid: false, missingStages };
}
```

### `src/lib/win-stages.test.ts`

```
// src/lib/win-stages.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getRequiredSelectionCountForStage, REQUIRED_SELECTION_COUNT_BY_STAGE } from './win-stages';

test('Line returns 5', () => assert.equal(getRequiredSelectionCountForStage('Line'), 5));
test('Two Lines returns 10', () => assert.equal(getRequiredSelectionCountForStage('Two Lines'), 10));
test('Full House returns 15', () => assert.equal(getRequiredSelectionCountForStage('Full House'), 15));
test('unknown stage returns null', () => {
  assert.equal(getRequiredSelectionCountForStage('Bogus'), null);
});
test('map is exhaustive over WinStage', () => {
  // Compile-time check: extending WinStage without adding to the map will fail tsc.
  assert.equal(Object.keys(REQUIRED_SELECTION_COUNT_BY_STAGE).length, 3);
});
```

### `src/lib/win-stages.ts`

```
// src/lib/win-stages.ts
import type { WinStage } from '@/types/database';

export const REQUIRED_SELECTION_COUNT_BY_STAGE: Record<WinStage, number> = {
  Line: 5,
  'Two Lines': 10,
  'Full House': 15,
};

export function getRequiredSelectionCountForStage(stage: string): number | null {
  return Object.prototype.hasOwnProperty.call(REQUIRED_SELECTION_COUNT_BY_STAGE, stage)
    ? REQUIRED_SELECTION_COUNT_BY_STAGE[stage as WinStage]
    : null;
}
```

### `src/proxy.ts`

```
import { type NextRequest } from 'next/server'
import { updateSession } from '@/utils/supabase/middleware'

export async function proxy(request: NextRequest) {
  return updateSession(request)
}

export const config = {
  matcher: [
    '/admin/:path*',
    '/host/:path*',
    '/login',
  ],
}
```

### `src/types/database.ts`

```
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type UserRole = 'admin' | 'host'
export type SessionStatus = 'draft' | 'ready' | 'running' | 'completed'
export type GameType = 'standard' | 'snowball' | 'jackpot'
export type GameStatus = 'not_started' | 'in_progress' | 'completed'
export type WinStage = 'Line' | 'Two Lines' | 'Full House'

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          email: string | null
          role: UserRole
          created_at: string
        }
        Insert: {
          id: string
          email?: string | null
          role?: UserRole
          created_at?: string
        }
        Update: {
          id?: string
          email?: string | null
          role?: UserRole
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'profiles_id_fkey'
            columns: ['id']
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
        ]
      }
      sessions: {
        Row: {
          id: string
          name: string
          start_date: string
          notes: string | null
          status: SessionStatus
          is_test_session: boolean
          created_by: string | null
          active_game_id: string | null // New
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          start_date?: string
          notes?: string | null
          status?: SessionStatus
          is_test_session?: boolean
          created_by?: string | null
          active_game_id?: string | null // New
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          start_date?: string
          notes?: string | null
          status?: SessionStatus
          is_test_session?: boolean
          created_by?: string | null
          active_game_id?: string | null // New
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'sessions_created_by_fkey'
            columns: ['created_by']
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'sessions_active_game_id_fkey'
            columns: ['active_game_id']
            referencedRelation: 'games'
            referencedColumns: ['id']
          },
        ]
      }
      games: {
        Row: {
          id: string
          session_id: string
          game_index: number
          name: string
          type: GameType
          stage_sequence: WinStage[]
          background_colour: string
          prizes: { [key: string]: string }
          notes: string | null
          snowball_pot_id: string | null
          created_at: string
        }
        Insert: {
          id?: string
          session_id: string
          game_index: number
          name: string
          type?: GameType
          stage_sequence?: WinStage[]
          background_colour?: string
          prizes?: { [key: string]: string }
          notes?: string | null
          snowball_pot_id?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          session_id?: string
          game_index?: number
          name?: string
          type?: GameType
          stage_sequence?: WinStage[]
          background_colour?: string
          prizes?: { [key: string]: string }
          notes?: string | null
          snowball_pot_id?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'games_session_id_fkey'
            columns: ['session_id']
            referencedRelation: 'sessions'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'games_snowball_pot_id_fkey'
            columns: ['snowball_pot_id']
            referencedRelation: 'snowball_pots'
            referencedColumns: ['id']
          },
        ]
      }
      game_states: {
        Row: {
          id: string
          game_id: string
          number_sequence: number[] | null
          called_numbers: number[]
          numbers_called_count: number
          current_stage_index: number
          status: GameStatus
          call_delay_seconds: number
          on_break: boolean
          paused_for_validation: boolean
          display_win_type: string | null // 'line', 'two_lines', 'full_house', 'snowball'
          display_win_text: string | null // e.g., "Line Winner!"
          display_winner_name: string | null // Optional: "Dave - Table 6"
          controlling_host_id: string | null // New: ID of the host controlling the game
          controller_last_seen_at: string | null // New: Timestamp of last heartbeat
          started_at: string | null
          ended_at: string | null
          last_call_at: string | null
          updated_at: string
          state_version: number // Monotonic counter bumped on every update; used to order Realtime/polling snapshots
        }
        Insert: {
          id?: string
          game_id: string
          number_sequence?: number[] | null
          called_numbers?: number[]
          numbers_called_count?: number
          current_stage_index?: number
          status?: GameStatus
          call_delay_seconds?: number
          on_break?: boolean
          paused_for_validation?: boolean
          display_win_type?: string | null
          display_win_text?: string | null
          display_winner_name?: string | null
          controlling_host_id?: string | null
          controller_last_seen_at?: string | null
          started_at?: string | null
          ended_at?: string | null
          last_call_at?: string | null
          updated_at?: string
          state_version?: number
        }
        Update: {
          id?: string
          game_id?: string
          number_sequence?: number[] | null
          called_numbers?: number[]
          numbers_called_count?: number

[truncated at line 200 — original has 461 lines]
```

### `supabase/migrations/20260430120000_add_state_version.sql`

```
-- Migration: add state_version for ordering Realtime + polling payloads
-- Reason: updated_at is not maintained on every update; we need a monotonic
-- counter so host/display/player surfaces can detect stale snapshots.

alter table public.game_states
  add column if not exists state_version bigint not null default 0;

alter table public.game_states_public
  add column if not exists state_version bigint not null default 0;

-- Bump state_version on every update to game_states. The DELETE branch is left
-- alone; the row goes away anyway and the public mirror is cleared by the
-- existing sync trigger.
create or replace function public.bump_game_state_version()
returns trigger as $$
begin
  if tg_op = 'UPDATE' then
    new.state_version := coalesce(old.state_version, 0) + 1;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists bump_game_state_version on public.game_states;

create trigger bump_game_state_version
before update on public.game_states
for each row execute function public.bump_game_state_version();

-- The existing sync_game_states_public() copies fields from game_states to
-- game_states_public. It must include state_version so public clients see the
-- same ordering value as the host. Preserve the existing DELETE branch.
create or replace function public.sync_game_states_public()
returns trigger as $$
begin
  if (tg_op = 'DELETE') then
    delete from public.game_states_public where game_id = old.game_id;
    return old;
  end if;

  insert into public.game_states_public (
    game_id,
    called_numbers,
    numbers_called_count,
    current_stage_index,
    status,
    call_delay_seconds,
    on_break,
    paused_for_validation,
    display_win_type,
    display_win_text,
    display_winner_name,
    started_at,
    ended_at,
    last_call_at,
    updated_at,
    state_version
  ) values (
    new.game_id,
    new.called_numbers,
    new.numbers_called_count,
    new.current_stage_index,
    new.status,
    new.call_delay_seconds,
    new.on_break,
    new.paused_for_validation,
    new.display_win_type,
    new.display_win_text,
    new.display_winner_name,
    new.started_at,
    new.ended_at,
    new.last_call_at,
    new.updated_at,
    new.state_version
  )
  on conflict (game_id) do update set
    called_numbers = excluded.called_numbers,
    numbers_called_count = excluded.numbers_called_count,
    current_stage_index = excluded.current_stage_index,
    status = excluded.status,
    call_delay_seconds = excluded.call_delay_seconds,
    on_break = excluded.on_break,
    paused_for_validation = excluded.paused_for_validation,
    display_win_type = excluded.display_win_type,
    display_win_text = excluded.display_win_text,
    display_winner_name = excluded.display_winner_name,
    started_at = excluded.started_at,
    ended_at = excluded.ended_at,
    last_call_at = excluded.last_call_at,
    updated_at = excluded.updated_at,
    state_version = excluded.state_version;

  return new;
end;
$$ language plpgsql security definer;

-- Backfill state_version on existing public rows so they match host rows.
update public.game_states_public gsp
set state_version = gs.state_version
from public.game_states gs
where gs.game_id = gsp.game_id;
```

### `supabase/migrations/20260430120100_set_call_delay_default_2.sql`

```
-- Migration: set call_delay_seconds default to 2 to match new host-instant timing.
-- The host now applies the new ball immediately on action return; display/player
-- surfaces still wait call_delay_seconds before showing it. Two seconds is the
-- agreed gap.
alter table public.game_states alter column call_delay_seconds set default 2;
alter table public.game_states_public alter column call_delay_seconds set default 2;

update public.game_states
set call_delay_seconds = 2
where call_delay_seconds = 1;

update public.game_states_public
set call_delay_seconds = 2
where call_delay_seconds = 1;
```

### `supabase/migrations/20260430120200_backfill_call_delay_to_2.sql`

```
-- Migration: backfill remaining call_delay_seconds rows to 2
-- The previous 20260218190500 migration that set call_delay_seconds to 1 was
-- never applied to remote, so existing rows still hold the original default of 8.
-- The 20260430120100 migration only updated where call_delay_seconds = 1, so
-- those rows at 8 remained unchanged. Set them to 2 so the new default applies
-- to existing live game state rows as well.

update public.game_states
set call_delay_seconds = 2
where call_delay_seconds <> 2;

update public.game_states_public
set call_delay_seconds = 2
where call_delay_seconds <> 2;
```

## Related Files (grep hints)

These files reference the basenames of changed files. They are hints for verification — not included inline. Read them only if a specific finding requires it.

```
AGENTS.md
CLAUDE.md
README.md
docs/PRD.md
docs/architecture/README.md
docs/architecture/data-model.md
docs/architecture/overview.md
docs/architecture/relationships.md
docs/architecture/routes.md
docs/architecture/server-actions.md
```

## Workspace Conventions (`Cursor/CLAUDE.md`)

```markdown
# CLAUDE.md — Workspace Standards

Shared guidance for Claude Code across all projects. Project-level `CLAUDE.md` files take precedence over this one — always read them first.

## Default Stack

Next.js 15 App Router, React 19, TypeScript (strict), Tailwind CSS, Supabase (PostgreSQL + Auth + RLS), deployed on Vercel.

## Workspace Architecture

21 projects across three brands, plus shared tooling:

| Prefix | Brand | Examples |
|--------|-------|----------|
| `OJ-` | Orange Jelly | AnchorManagementTools, CheersAI2.0, Planner2.0, MusicBingo, CashBingo, QuizNight, The-Anchor.pub, DukesHeadLeatherhead.com, OrangeJelly.co.uk, WhatsAppVideoCreator |
| `GMI-` | GMI | MixerAI2.0 (canonical auth reference), TheCookbook, ThePantry |
| `BARONS-` | Barons | CareerHub, EventHub, BrunchLaunchAtTheStar, StPatricksDay, DigitalExperienceMockUp, WebsiteContent |
| (none) | Shared / test | Test, oj-planner-app |

## Core Principles

**How to think:**
- **Simplicity First** — make every change as simple as possible; minimal code impact
- **No Laziness** — find root causes; no temporary fixes; senior developer standards
- **Minimal Impact** — only touch what's necessary; avoid introducing bugs

**How to act:**
1. **Do ONLY what is asked** — no unsolicited improvements
2. **Ask ONE clarifying question maximum** — if unclear, proceed with safest minimal implementation
3. **Record EVERY assumption** — document in PR/commit messages
4. **One concern per changeset** — if a second concern emerges, park it
5. **Fail safely** — when in doubt, stop and request human approval

### Source of Truth Hierarchy

1. Project-level CLAUDE.md
2. Explicit task instructions
3. Existing code patterns in the project
4. This workspace CLAUDE.md
5. Industry best practices / framework defaults

## Ethics & Safety

AI MUST stop and request explicit approval before:
- Any operation that could DELETE user data or drop DB columns/tables
- Disabling authentication/authorisation or removing encryption
- Logging, sending, or storing PII in new locations
- Changes that could cause >1 minute downtime
- Using GPL/AGPL code in proprietary projects

## Communication

- When the user asks to "remove" or "clean up" something, clarify whether they mean a code change or a database/data cleanup before proceeding
- Ask ONE clarifying question maximum — if still unclear, proceed with the safest interpretation

## Debugging & Bug Fixes

- When fixing bugs, check the ENTIRE application for related issues, not just the reported area — ask: "Are there other places this same pattern exists?"
- When given a bug report: just fix it — don't ask for hand-holding
- Point at logs, errors, failing tests — then resolve them
- Zero context switching required from the user

## Code Changes

- Before suggesting new environment variables or database columns, check existing ones first — use `grep` to find existing env vars and inspect the current schema before proposing additions
- One logical change per commit; one concern per changeset

## Workflow Orchestration

### 1. Plan Mode Default
- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions)
- If something goes sideways, STOP and re-plan immediately

### 2. Subagent Strategy
- Use subagents liberally to keep main context window clean
- Offload research, exploration, and parallel analysis to subagents
- One task per subagent for focused execution

### 3. Task Tracking
- Write plan to `tasks/todo.md` with checkable items before starting
- Mark items complete as you go; document results when done

### 4. Self-Improvement Loop
- After ANY correction from the user: update `tasks/lessons.md` with the pattern
- Write rules that prevent the same mistake; review lessons at session start

### 5. Verification Before Done
- Never mark a task complete without proving it works
- Run tests, check logs, demonstrate correctness
- Ask yourself: "Would a staff engineer approve this?"
- For non-trivial changes: pause and ask "is there a more elegant way?"

### 6. Codex Integration Hook
Uses OpenAI Codex CLI to audit, test and simulate — catches what Claude misses.

```
when: "running tests OR auditing OR simulating"
do:
  - run_skill(codex-review, target=current_task)
  - compare_outputs(claude_result, codex_result)
  - flag_discrepancies(threshold=medium)
  - merge_best_solution()
```

The full multi-specialist QA review skill lives in `~/.claude/skills/codex-qa-review/`. Trigger with "QA review", "codex review", "second opinion", or "check my work". Deploys four specialist agents (Bug Hunter, Security Auditor, Performance Analyst, Standards Enforcer) into a single prioritised report.

## Common Commands

```bash
npm run dev       # Start development server
npm run build     # Production build
npm run lint      # ESLint (zero warnings enforced)
npm test          # Run tests (Vitest unless noted otherwise)
npm run typecheck # TypeScript type checking (npx tsc --noEmit)
npx supabase db push   # Apply pending migrations (Supabase projects)
```

## Coding Standards

### TypeScript
- No `any` types unless absolutely justified with a comment
- Explicit return types on all exported functions
- Props interfaces must be named (not inline anonymous objects for complex props)
- Use `Promise<{ success?: boolean; error?: string }>` for server action return types

### Frontend / Styling
- Use design tokens only — no hardcoded hex colours in components
- Always consider responsive breakpoints (`sm:`, `md:`, `lg:`)
- No conflicting or redundant class combinations
- Design tokens should live in `globals.css` via `@theme inline` (Tailwind v4) or `tailwind.config.ts`
- **Never use dynamic Tailwind class construction** (e.g., `bg-${color}-500`) — always use static, complete class names due to Tailwind's purge behaviour

### Date Handling
- Always use the project's `dateUtils` (typically `src/lib/dateUtils.ts`) for display
- Never use raw `new Date()` or `.toISOString()` for user-facing dates
- Default timezone: Europe/London
- Key utilities: `getTodayIsoDate()`, `toLocalIsoDate()`, `formatDateInLondon()`

### Phone Numbers
- Always normalise to E.164 format (`+44...`) using `libphonenumber-js`

## Server Actions Pattern

All mutations use `'use server'` functions (typically in `src/app/actions/` or `src/actions/`):

```typescript
'use server';
export async function doSomething(params): Promise<{ success?: boolean; error?: string }> {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Unauthorized' };
  // ... permission check, business logic, audit log ...
  revalidatePath('/path');
  return { success: true };
}
```

## Database / Supabase

See `.claude/rules/supabase.md` for detailed patterns. Key rules:
- DB columns are `snake_case`; TypeScript types are `camelCase`
- Always wrap DB results with a conversion helper (e.g. `fromDb<T>()`)
- RLS is always on — use service role client only for system/cron operations
- Two client patterns: cookie-based auth client and service-role admin client

### Before Any Database Work
Before making changes to queries, migrations, server actions, or any code that touches the database, query the live schema for all tables involved:
```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name IN ('relevant_table') ORDER BY ordinal_position;
```
Also check for views referencing those tables — they will break silently if columns change:
```sql
SELECT table_name FROM information_schema.view_table_usage
WHERE table_name IN ('relevant_table');
```

### Migrations
- Always verify migrations don't conflict with existing timestamps
- Test the connection string works before pushing
- PostgreSQL views freeze their column lists — if underlying tables change, views must be recreated
- Never run destructive migrations (DROP COLUMN/TABLE) without explicit approval

## Git Conventions

See `.claude/rules/pr-and-git-standards.md` for full PR templates, branch naming, and reviewer checklists. Key rules:
- Conventional commits: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`
- Never force-push to `main`
- One logical change per commit
- Meaningful commit messages explaining "why" not just "what"

## Rules Reference

Core rules (always loaded from `.claude/rules/`):

| File | Read when… |
|------|-----------|
| `ui-patterns.md` | Building or modifying UI components, forms, buttons, navigation, or accessibility |
| `testing.md` | Adding, modifying, or debugging tests; setting up test infrastructure |
| `definition-of-ready.md` | Starting any new feature — check requirements are clear before coding |
| `definition-of-done.md` | Finishing any feature — verify all quality gates pass |
| `complexity-and-incremental-dev.md` | Scoping a task that touches 4+ files or involves schema changes |
| `pr-and-git-standards.md` | Creating branches, writing commit messages, or opening PRs |
| `verification-pipeline.md` | Before pushing — run the full lint → typecheck → test → build pipeline |
| `supabase.md` | Any database query, migration, RLS policy, or client usage |

Domain rules (auto-injected from `.claude/docs/` when you edit relevant files):

| File | Domain |
|------|--------|
| `auth-standard.md` | Auth, sessions, middleware, RBAC, CSRF, password reset, invites |
| `background-jobs.md` | Async job queues, Vercel Cron, retry logic |
| `api-key-auth.md` | External API key generation, validation, rotation |
| `file-export.md` | PDF, DOCX, CSV generation and download |
| `rate-limiting.md` | Upstash rate limiting, 429 responses |
| `qr-codes.md` | QR code generation (client + server) |
| `toast-notifications.md` | Sonner toast patterns |
| `email-notifications.md` | Resend email, templates, audit logging |
| `ai-llm.md` | LLM client, prompts, token tracking, vision |
| `payment-processing.md` | Stripe/PayPal two-phase payment flows |
| `data-tables.md` | TanStack React Table v8 patterns |

## Quality Gates

A feature is only complete when it passes the full Definition of Done checklist (`.claude/rules/definition-of-done.md`). At minimum: builds, lints, type-checks, tests pass, no hardcoded secrets, auth checks in place, code commented where complex.
```

## Project Conventions (`CLAUDE.md`)

```markdown
# CLAUDE.md — Anchor Bingo

This file provides project-specific guidance. See the workspace-level `CLAUDE.md` one directory up for shared conventions.

## Quick Profile

- **Framework**: Next.js 16.1, React 19.2 (App Router)
- **Styling**: Tailwind CSS v4 with local UI primitives in `src/components/ui/`
- **Test runner**: Node.js native test runner (see `npm test`)
- **Database**: Supabase (PostgreSQL + RLS + Realtime)
- **Key integrations**: `@supabase/ssr` (cookie-based SSR), `qrcode.react` (display QR for player follower URL), `nosleep.js` (screen-keep-awake on host/display), `zod` (server-action input validation)
- **Size**: ~43 files in `src/`

## Commands

```bash
npm run dev              # Start development server
npm run build            # Production build
npm run start            # Start production server
npm run lint             # ESLint check
npm test                 # Node.js native test runner (node --test --import tsx)
```

Note: Uses native Node.js test runner (no Jest/Vitest). Tests cover the shared lib helpers — UI is not unit-tested.

## What This Application Is

A **90-ball pub bingo control system** for The Anchor. There are no digital cards, no per-player marking, and no QR-driven join into a card. Players use physical paper bingo books at the table. The app exists to:

1. Help the host call numbers and pace the game.
2. Manage the snowball jackpot across sessions.
3. Validate winners on demand.
4. Drive a public big-screen TV display showing the live game state.
5. Drive a public mobile follower screen for guests at the table.

Three classes of user:

| User | Routes | Auth |
|------|--------|------|
| Admin / host (staff) | `/admin/*`, `/host/*` | Supabase Auth (cookie session) |
| Big-screen pub TV | `/display`, `/display/[sessionId]` | Public |
| Guest mobile follower | `/player/[sessionId]` | Public, guest-friendly |

## Architecture

**Route structure** (App Router):

| URL | Purpose |
|-----|---------|
| `/` | Public landing page |
| `/login` | Staff login (invite-only — no public sign-up) |
| `/admin` | Sessions list |
| `/admin/sessions/[id]` | Session detail / game CRUD |
| `/admin/snowball` | Snowball pot management |
| `/admin/history` | Past sessions / winners |
| `/admin/backup` | Export tool |
| `/host` | Host dashboard |
| `/host/[sessionId]/[gameId]` | Live host control |
| `/display` | Auto-redirects to active session's display |
| `/display/[sessionId]` | Big-screen TV view |
| `/player/[sessionId]` | Mobile follower view |

**Auth proxy**: `src/proxy.ts` registers Next.js middleware via `proxy()` and a tightly scoped matcher running `updateSession()` (in `src/utils/supabase/middleware.ts`) only on `/admin/:path*`, `/host/:path*`, and `/login`. Public routes (`/display/*`, `/player/*`, `/`) bypass the middleware entirely. Defence in depth: every protected `page.tsx` server component also calls `supabase.auth.getUser()` and redirects to `/login` if absent.

**Database**: Supabase PostgreSQL. Core tables: `sessions`, `games`, `game_states`, `game_states_public`, `winners`, `snowball_pots`, `snowball_pot_history`, `profiles`. Both `game_states` and `game_states_public` carry a `state_version bigint` bumped by the `bump_game_state_version` BEFORE UPDATE trigger on every write; the `sync_game_states_public()` trigger keeps the public mirror in step.

**Data flow**: Admin defines a session and games. Host opens a game, calls numbers (server-side gap-enforced), pauses for validation, records winners. Display and player pages subscribe to `game_states_public` via Supabase Realtime with polling fallback, using `state_version` to discard stale payloads.

## Key Files

| Path | Purpose |
|------|---------|
| `src/types/` | Shared TS types incl. generated `Database` |
| `src/lib/` | Shared logic — `connection-health`, `game-state-version`, `prize-validation`, `win-stages`, `jackpot`, `snowball`, `log-error`, `utils` |
| `src/hooks/` | `use-connection-health`, `wake-lock` |
| `src/components/` | `connection-banner`, `header`, `layout-content`, `ui/*` |
| `src/app/` | Next.js routes (admin, host, display, player, login, api/setup) |
| `src/utils/supabase/` | Supabase client variants — `client.ts`, `server.ts`, `middleware.ts` |
| `src/proxy.ts` | Next.js middleware export — calls `updateSession()` on auth routes |
| `supabase/migrations/` | DB schema (sessions, games, game_states, winners, snowball_pots, etc.) |

## Environment Variables

| Var | Purpose |
|-----|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL (public) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key (public) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service-role key (server-only) |
| `SETUP_SECRET` | Secret for `/api/setup` admin bootstrap endpoint |
| `NEXT_PUBLIC_SITE_URL` | Public origin (e.g. `https://bingo.theanchor.pub`) — fallback for the player-follower QR URL when request headers are unavailable |

## Project-Specific Rules / Gotchas

### Game Flow

1. **Admin** creates a session, then defines games inside it (regular line / two lines / full house, optionally with a snowball jackpot).
2. **Host** picks a session/game from `/host`, starts it, and the host page takes the controller heartbeat lock.
3. **Host** clicks "Call next number". The server enforces a delay between calls (`call_delay_seconds`) and uses a compare-and-set guard against the previous `numbers_called_count` to prevent double-calls under contention.
4. When a punter shouts BINGO, the host pauses for validation, types the claimed numbers, and the server validates them against the called set including the most recent ball.
5. On a valid win, the host records the winner (anonymously — the app does not store player names) and the snowball pot updates if applicable.
6. After the final stage of the final game, the host ends the game/session.

### What This App Does NOT Do

- It does **not** generate digital bingo cards.
- It does **not** mark squares for players.
- It does **not** support a "join via QR" card-issue flow. The QR on the display goes to the read-only **follower** view of the session, which simply mirrors what's already on the big screen.
- It does **not** support 75-ball bingo. Only 90-ball.
- It does **not** broadcast number announcements with audio (no `react-player`).

### Win Detection (Server-Side Validation)

- The host pauses the game and types in the punter's claimed numbers from their paper book.
- `validateClaim` server action: confirms the claimed list includes the most recently called number, then checks every claimed number is in the called set. The required claim count comes from `getRequiredSelectionCountForStage` in `src/lib/win-stages.ts`.
- The action returns `{ valid: true }` or `{ valid: false, invalidNumbers }`. Multiple winners per stage are valid (tie scenario).

### Realtime Updates

- Supabase Realtime on `game_states_public` plus a polling fallback on a short interval. The "Reconnecting…" banner (`src/components/connection-banner.tsx`) is shown when both stall.
- **Use `state_version` for ordering, never `updated_at`.** `isFreshGameState()` in `src/lib/game-state-version.ts` is the canonical comparator for incoming payloads.

### Display QR

- The big-screen display renders a QR via `qrcode.react` pointing at `/player/[sessionId]` so a punter at the table can scan it on their phone and follow along.
- The QR URL is built from the `Host` header where available, falling back to `NEXT_PUBLIC_SITE_URL` in production.

### Mobile / Display Optimisation

- Host, display, and player game pages use `LayoutContent` (client component) to hide app chrome.
- `wake-lock.ts` (`nosleep.js`-backed) keeps the screen awake on host and display during a live game.

### Game State Management

- Server is the source of truth for `game_states` and the public mirror.
- `getCurrentGameState` and Realtime payloads return the full row including `state_version`.
- Host actions persist all changes through `game_states` writes; the trigger maintains `game_states_public` automatically.

### Database Schema

| Table | Purpose |
|-------|---------|
| `sessions` | Top-level container (status: ready / running / completed) |
| `games` | Games within a session (type, stages, prizes, snowball pot link) |
| `game_states` | Live state per game (host/admin readable, has `state_version`) |
| `game_states_public` | Public-readable mirror of `game_states` (has `state_version`, kept in sync by `sync_game_states_public()`) |
| `winners` | Audit row per recorded win (`winner_name = 'Anonymous'`) |
| `snowball_pots` / `snowball_pot_history` | Cross-session jackpot pots and audit trail |
| `profiles` | User role lookup (`'admin'` vs others) |

### Security

- Staff sign-up is **disabled** — the login page does not offer a sign-up toggle. New staff accounts are created out-of-band by an admin.
- RLS is on for all tables. Public clients only see `game_states_public`.
- Host actions re-verify auth and check `profiles.role`. `recordWinner` uses the service-role client for the privileged insert.
- Server-side number-call gap enforcement (don't move client-side).
- `validateClaim` re-reads the called-numbers list server-side; never trusts client input.
- Delete-protection: started/completed games cannot be deleted; sessions with non-`not_started` games or recorded winners cannot be deleted.
- `SETUP_SECRET` required for `/api/setup`.

### Performance

- Public routes deliberately bypass the proxy/middleware to keep the display + player pages fast.
- The `state_version`-based stale-payload check prevents UI thrash when Realtime and polling overlap.

### Anonymous Winners

- `winners.winner_name` is always `'Anonymous'`. There is no UI input for a winner name and no plan to add one.

### Accessibility

- Display has high-contrast number readout for the back of the room.
- All interactive elements have visible focus styles.
- "Reconnecting…" banner uses `aria-live="polite"`.

### Testing

- Native Node.js test runner. Tests live alongside source: `src/lib/*.test.ts`.
- Existing coverage: `connection-health`, `game-state-version`, `log-error`, `prize-validation`, `win-stages`, plus a handful of small utility tests.
- Mock Supabase — don't hit a real database from tests.

### Deployment

- Required env: Supabase URL + keys, `SETUP_SECRET`, `NEXT_PUBLIC_SITE_URL` (for the production join QR fallback).
- Enable Supabase Realtime on `game_states_public`.

### Common Patterns

- Admin → game CRUD → host flow → display + player follower views.
- Concurrent sessions are not supported in practice — a single live session at a time.

### Gotchas

- **Don't broaden the proxy matcher.** It is intentionally `/admin/:path*`, `/host/:path*`, `/login` only. Adding `/display/*` or `/player/*` makes a Supabase round-trip on every TV / phone refresh.
- **Don't reintroduce a sign-up affordance.** Staff are invite-only.
- **Don't trust `updated_at` for ordering.** Use `state_version`.
- **Don't store player-identifying info.** Winners are anonymised by policy.
- **Don't drop the server-side number-call gap.** It's the only thing preventing double-calls under contention.
```

## Rule: `/Users/peterpitcher/Cursor/.claude/rules/definition-of-done.md`

```markdown
# Definition of Done (DoD)

A feature is ONLY complete when ALL applicable items pass. This extends the Quality Gates in the root CLAUDE.md.

## Code Quality

- [ ] Builds successfully — `npm run build` with zero errors
- [ ] Linting passes — `npm run lint` with zero warnings
- [ ] Type checks pass — `npx tsc --noEmit` clean (or project equivalent)
- [ ] No `any` types unless justified with a comment
- [ ] No hardcoded secrets or API keys
- [ ] No hardcoded hex colours — use design tokens
- [ ] Server action return types explicitly typed

## Testing

- [ ] All existing tests pass
- [ ] New tests written for business logic (happy path + at least 1 error case)
- [ ] Coverage meets project minimum (default: 80% on business logic)
- [ ] External services mocked — never hit real APIs in tests
- [ ] If no test suite exists yet, note this in the PR as tech debt

## Security

- [ ] Auth checks in place — server actions re-verify server-side
- [ ] Permission checks present — RBAC enforced on both UI and server
- [ ] Input validation complete — all user inputs sanitised (Zod or equivalent)
- [ ] No new PII logging, sending, or storing without approval
- [ ] RLS verified (Supabase projects) — queries respect row-level security

## Accessibility

- [ ] Interactive elements have visible focus styles
- [ ] Colour is not the sole indicator of state
- [ ] Modal dialogs trap focus and close on Escape
- [ ] Tables have proper `<thead>`, `<th scope>` markup
- [ ] Images have meaningful `alt` text
- [ ] Keyboard navigation works for all interactive elements

## Documentation

- [ ] Complex logic commented — future developers can understand "why"
- [ ] README updated if new setup, config, or env vars are needed
- [ ] Environment variables documented in `.env.example`
- [ ] Breaking changes noted in PR description

## Deployment

- [ ] Database migrations tested locally before pushing
- [ ] Rollback plan documented for schema changes
- [ ] No console.log or debug statements left in production code
- [ ] Verification pipeline passes (see `verification-pipeline.md`)
```

## Rule: `/Users/peterpitcher/Cursor/.claude/rules/testing.md`

```markdown
# Testing Conventions

## Framework

- **Vitest** is the default test runner (not Jest)
- Test files live alongside source: `src/**/*.test.ts` or in a dedicated `tests/` directory
- **Playwright** for end-to-end testing where configured

## Commands

```bash
npm test              # Run tests once
npm run test:watch    # Watch mode (Vitest)
npm run test:ci       # With coverage report
npx vitest run src/lib/some-module.test.ts  # Run a single test file
```

## Patterns

- Use `describe` blocks grouped by function/component
- Test naming: `it('should [expected behaviour] when [condition]')`
- Prefer testing behaviour over implementation details
- Mock external services (Supabase, OpenAI, Twilio) — never hit real APIs in tests
- Use factories or fixtures for test data, not inline object literals

## Test Prioritisation

When adding tests to a feature, prioritise in this order:
1. **Server actions and business logic** — highest value, most likely to catch real bugs
2. **Data transformation utilities** — date formatting, snake_case conversion, parsers
3. **API route handlers** — input validation, error responses, auth checks
4. **Complex UI interactions** — forms, multi-step flows, conditional rendering
5. **Simple UI wrappers** — lowest priority, skip if time-constrained

Minimum per feature: happy path + at least 1 error/edge case.

## Mock Strategy

- **Always mock**: Supabase client, OpenAI/Azure OpenAI, Twilio, Stripe, PayPal, Microsoft Graph, external HTTP
- **Never mock**: Internal utility functions, date formatting, type conversion helpers
- **Use `vi.mock()`** for module-level mocks; `vi.spyOn()` for targeted function mocks
- Reset mocks between tests: `beforeEach(() => { vi.clearAllMocks() })`

## Coverage

- Business logic and server actions: target 90%
- API routes and data layers: target 80%
- UI components: target 70% (focus on interactive behaviour, not rendering)
- Don't chase coverage on trivial wrappers, type definitions, or config files

## Playwright (E2E)

- Local dev: uses native browser
- Production/CI: uses `BROWSERLESS_URL` env var for remote browser
- E2E tests should be independent (no shared state between tests)
- Use page object models for complex flows
```

## Rule: `/Users/peterpitcher/Cursor/.claude/rules/ui-patterns.md`

```markdown
# UI Patterns & Component Standards

## Server vs Client Components

- Default to **Server Components** — only add `'use client'` when you need interactivity, hooks, or browser APIs
- Server Components can fetch data directly (no useEffect/useState for data loading)
- Client Components should receive data as props from server parents where possible

## Data Fetching & Display

Every data-driven UI must handle all three states:
1. **Loading** — skeleton loaders or spinners (not blank screens)
2. **Error** — user-facing error message or error boundary
3. **Empty** — meaningful empty state component (not just no content)

## Forms

- Use React Hook Form + Zod for validation where configured
- Validation errors displayed inline, not just console logs
- Required field indicators visible
- Loading/disabled state during submission (prevent double-submit)
- Server action errors surfaced to user via toast or inline message
- Form reset after successful submission where appropriate

## Buttons

Check every button for:
- Consistent variant usage (primary, secondary, destructive, ghost) — no ad-hoc Tailwind-only buttons
- Loading states on async actions (spinner/disabled during server action calls)
- Disabled states when form is invalid or submission in progress
- `type="button"` to prevent accidental form submission (use `type="submit"` only on submit buttons)
- Confirmation dialogs on destructive actions (delete, archive, bulk operations)
- `aria-label` on icon-only buttons

## Navigation

- Breadcrumbs on nested pages
- Active state on current nav item
- Back/cancel navigation returns to correct parent page
- New sections added to project navigation with correct permission gating
- Mobile responsiveness of all nav elements

## Permissions (RBAC)

- Every authenticated page must check permissions via the project's permission helper
- UI elements (edit, delete, create buttons) conditionally rendered based on permissions
- Server actions must re-check permissions server-side (never rely on UI hiding alone)

## Accessibility Baseline

These items are also enforced in the Definition of Done (`definition-of-done.md`):

- Interactive elements have visible focus styles
- Colour is not the only indicator of state
- Modal dialogs trap focus and close on Escape
- Tables use proper `<thead>`, `<th scope>` markup
- Images have meaningful `alt` text
- Keyboard navigation works for all interactive elements
```

---

_End of pack._
