# Review Pack: bingoblast-tonight

**Generated:** 2026-04-29
**Mode:** B (A=Adversarial / B=Code / C=Spec Compliance)
**Project root:** `/Users/peterpitcher/Cursor/OJ-CashBingo`
**Base ref:** `HEAD`
**HEAD:** `47e7752`
**Diff range:** `HEAD`
**Stats:**  6 files changed, 211 insertions(+), 165 deletions(-)

> This pack is the sole input for reviewers. Do NOT read files outside it unless a specific finding requires verification. If a file not in the pack is needed, mark the finding `Needs verification` and describe what would resolve it.

## Changed Files

```
.claude/changes-manifest.log
AGENTS.md
src/app/api/setup/route.ts
src/app/display/[sessionId]/display-ui.tsx
src/app/host/[sessionId]/[gameId]/game-control.tsx
src/app/host/actions.ts
src/app/player/[sessionId]/player-ui.tsx
tasks/review/phase-1/remediation-plan.md
```

## User Concerns

Live cash bingo game tonight; verify 5 fixes don't introduce regressions; check void-safety, polling cleanup, timing-safe secret, live-stage validation paths

## Diff (`HEAD`)

```diff
diff --git a/src/app/api/setup/route.ts b/src/app/api/setup/route.ts
index da594fc..19b2599 100644
--- a/src/app/api/setup/route.ts
+++ b/src/app/api/setup/route.ts
@@ -1,3 +1,4 @@
+import { createHash, timingSafeEqual } from 'node:crypto'
 import { createClient } from '@supabase/supabase-js'
 import { NextRequest, NextResponse } from 'next/server'
 
@@ -11,6 +12,17 @@ function getSetupSecret() {
   return process.env.SETUP_SECRET
 }
 
+function isSetupSecretValid(providedSecret: string | null, setupSecret: string): boolean {
+  const providedDigest = createHash('sha256')
+    .update(providedSecret ?? '', 'utf8')
+    .digest()
+  const expectedDigest = createHash('sha256')
+    .update(setupSecret, 'utf8')
+    .digest()
+
+  return timingSafeEqual(providedDigest, expectedDigest)
+}
+
 export async function GET() {
   return NextResponse.json(
     { error: 'Method not allowed. Use POST.' },
@@ -25,7 +37,7 @@ export async function POST(request: NextRequest) {
   }
 
   const providedSecret = request.headers.get('x-setup-secret')
-  if (!providedSecret || providedSecret !== setupSecret) {
+  if (!isSetupSecretValid(providedSecret, setupSecret)) {
     return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
   }
 
diff --git a/src/app/display/[sessionId]/display-ui.tsx b/src/app/display/[sessionId]/display-ui.tsx
index c0e7960..b487fdf 100644
--- a/src/app/display/[sessionId]/display-ui.tsx
+++ b/src/app/display/[sessionId]/display-ui.tsx
@@ -32,6 +32,8 @@ const formatStageLabel = (stage: string | undefined) => {
     .replace(/\b\w/g, (char) => char.toUpperCase());
 };
 
+const POLL_INTERVAL_MS = 3000;
+
 export default function DisplayUI({
   session,
   activeGame: initialActiveGame,
@@ -136,36 +138,66 @@ export default function DisplayUI({
   }, [session.id, currentActiveGame, refreshActiveGame]);
 
   useEffect(() => {
-      const interval = setInterval(async () => {
-          if (document.visibilityState !== 'visible') {
-              return;
-          }
-          const { data: freshSession } = await supabase.current
-              .from('sessions')
-              .select('active_game_id, status') 
-              .eq('id', session.id)
-              .single<Pick<Session, 'active_game_id' | 'status'>>();
-          
-          if (freshSession) {
-              if (freshSession.active_game_id !== currentActiveGame?.id) {
-                  await refreshActiveGame(freshSession.active_game_id);
-              } else if (currentActiveGame?.id) {
-                  // Poll game state to ensure sync
-                  const { data: freshState } = await supabase.current
-                    .from('game_states_public')
-                    .select('*')
-                    .eq('game_id', currentActiveGame.id)
-                    .single<Database['public']['Tables']['game_states_public']['Row']>();
-                  
-                  if (freshState) {
-                      setCurrentGameState(freshState);
-                  }
-              }
-          }
-      }, 10000);
+    let cancelled = false;
+    let interval: NodeJS.Timeout | null = null;
+
+    const poll = async () => {
+      if (cancelled) return;
+      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
+
+      const { data: freshSession } = await supabase.current
+        .from('sessions')
+        .select('*')
+        .eq('id', session.id)
+        .single<Session>();
+      if (cancelled || !freshSession) return;
+
+      setCurrentSession(freshSession);
+      setIsWaitingState(!freshSession.active_game_id && freshSession.status !== 'running');
+
+      if (freshSession.active_game_id !== currentActiveGame?.id) {
+        await refreshActiveGame(freshSession.active_game_id);
+        return;
+      }
 
-      return () => clearInterval(interval);
-  }, [currentActiveGame, session.id, refreshActiveGame]);
+      if (currentActiveGame?.id) {
+        const { data: freshState } = await supabase.current
+          .from('game_states_public')
+          .select('*')
+          .eq('game_id', currentActiveGame.id)
+          .single<GameState>();
+        if (cancelled || !freshState) return;
+
+        setCurrentGameState(freshState);
+        const stageKey = currentActiveGame.stage_sequence[freshState.current_stage_index];
+        setCurrentPrizeText(
+          currentActiveGame.prizes?.[stageKey as keyof typeof currentActiveGame.prizes] || ''
+        );
+      }
+    };
+
+    void poll();
+    interval = setInterval(() => { void poll(); }, POLL_INTERVAL_MS);
+
+    const handleVisibility = () => {
+      if (document.visibilityState === 'visible') {
+        void poll();
+      }
+    };
+    document.addEventListener('visibilitychange', handleVisibility);
+
+    return () => {
+      cancelled = true;
+      if (interval) clearInterval(interval);
+      document.removeEventListener('visibilitychange', handleVisibility);
+    };
+  }, [
+    session.id,
+    currentActiveGame?.id,
+    currentActiveGame?.prizes,
+    currentActiveGame?.stage_sequence,
+    refreshActiveGame,
+  ]);
 
   useEffect(() => {
     const supabaseClient = supabase.current;
diff --git a/src/app/host/[sessionId]/[gameId]/game-control.tsx b/src/app/host/[sessionId]/[gameId]/game-control.tsx
index f9b2ed2..4a0ce52 100644
--- a/src/app/host/[sessionId]/[gameId]/game-control.tsx
+++ b/src/app/host/[sessionId]/[gameId]/game-control.tsx
@@ -391,13 +391,7 @@ export default function GameControl({ sessionId, gameId, game, initialGameState,
                     },
                     (payload) => {
                         if (!isMounted) return;
-                        // Guard: never regress called_numbers — a heartbeat UPDATE carries
-                        // the old called_numbers and must not overwrite a newer optimistic state.
-                        setCurrentGameState(prev =>
-                            payload.new.numbers_called_count >= prev.numbers_called_count
-                                ? payload.new
-                                : { ...payload.new, called_numbers: prev.called_numbers, numbers_called_count: prev.numbers_called_count }
-                        );
+                        setCurrentGameState(payload.new);
                     }
                 )
                 .subscribe((status) => {
@@ -439,12 +433,7 @@ export default function GameControl({ sessionId, gameId, game, initialGameState,
                 .eq('game_id', gameId)
                 .single<GameState>();
             if (freshState) {
-                // Apply same guard as Realtime: never regress called numbers
-                setCurrentGameState(prev =>
-                    freshState.numbers_called_count >= prev.numbers_called_count
-                        ? freshState
-                        : prev
-                );
+                setCurrentGameState(freshState);
             }
         }, 3000);
         return () => clearInterval(interval);
diff --git a/src/app/host/actions.ts b/src/app/host/actions.ts
index e750fb3..01dbbdb 100644
--- a/src/app/host/actions.ts
+++ b/src/app/host/actions.ts
@@ -948,6 +948,40 @@ export async function announceWin(gameId: string, stage: WinStage | 'snowball'):
     const controlResult = await requireController(supabase, gameId)
     if (!controlResult.authorized) return { success: false, error: controlResult.error }
 
+    const { data: gameState, error: gameStateError } = await supabase
+        .from('game_states')
+        .select('current_stage_index, status')
+        .eq('game_id', gameId)
+        .single<Pick<Database['public']['Tables']['game_states']['Row'], 'current_stage_index' | 'status'>>();
+    if (gameStateError || !gameState) {
+        return { success: false, error: gameStateError?.message || "Game state not found." };
+    }
+    if (gameState.status !== 'in_progress') {
+        return { success: false, error: "Cannot announce a winner unless the game is in progress." };
+    }
+
+    const { data: gameRow, error: gameRowError } = await supabase
+        .from('games')
+        .select('type, stage_sequence')
+        .eq('id', gameId)
+        .single<Pick<Database['public']['Tables']['games']['Row'], 'type' | 'stage_sequence'>>();
+    if (gameRowError || !gameRow) {
+        return { success: false, error: gameRowError?.message || "Game details not found." };
+    }
+
+    const expectedStage = (gameRow.stage_sequence as string[] | null)?.[gameState.current_stage_index];
+    if (!expectedStage) {
+        return { success: false, error: "Current stage is not configured for this game." };
+    }
+
+    if (stage === 'snowball') {
+        if (gameRow.type !== 'snowball' || expectedStage !== 'Full House') {
+            return { success: false, error: "Snowball announcement is only valid during Full House of a snowball game." };
+        }
+    } else if (stage !== expectedStage) {
+        return { success: false, error: `Stage mismatch: live stage is ${expectedStage}.` };
+    }
+
     let displayWinText: string;
     let displayWinType: string;
 
@@ -1089,16 +1123,41 @@ export async function recordWinner(
     const controlResult = await requireController(supabase, gameId)
     if (!controlResult.authorized) return { success: false, error: controlResult.error }
 
-    let resolvedCallCountAtWin = callCountAtWin;
-    const { data: liveGameState } = await supabase
+    void callCountAtWin;
+
+    const { data: liveGameRow, error: liveGameRowError } = await supabase
+        .from('games')
+        .select('session_id, type, snowball_pot_id, stage_sequence')
+        .eq('id', gameId)
+        .single<Pick<Database['public']['Tables']['games']['Row'], 'session_id' | 'type' | 'snowball_pot_id' | 'stage_sequence'>>();
+    if (liveGameRowError || !liveGameRow) {
+        return { success: false, error: liveGameRowError?.message || "Game details not found." };
+    }
+    if (liveGameRow.session_id !== sessionId) {
+        return { success: false, error: "Game does not belong to this session." };
+    }
+
+    const { data: liveStateRow, error: liveStateRowError } = await supabase
         .from('game_states')
-        .select('numbers_called_count')
+        .select('numbers_called_count, current_stage_index, status')
         .eq('game_id', gameId)
-        .single<Pick<Database['public']['Tables']['game_states']['Row'], 'numbers_called_count'>>();
+        .single<Pick<Database['public']['Tables']['game_states']['Row'], 'numbers_called_count' | 'current_stage_index' | 'status'>>();
+    if (liveStateRowError || !liveStateRow) {
+        return { success: false, error: liveStateRowError?.message || "Game state not found." };
+    }
+    if (liveStateRow.status !== 'in_progress') {
+        return { success: false, error: "Cannot record a winner unless the game is in progress." };
+    }
 
-    if (liveGameState) {
-        resolvedCallCountAtWin = liveGameState.numbers_called_count;
+    const expectedStage = (liveGameRow.stage_sequence as string[] | null)?.[liveStateRow.current_stage_index];
+    if (!expectedStage) {
+        return { success: false, error: "Current stage is not configured for this game." };
     }
+    if (stage !== expectedStage) {
+        return { success: false, error: `Stage mismatch: live stage is ${expectedStage}.` };
+    }
+
+    const resolvedCallCountAtWin = liveStateRow.numbers_called_count;
 
     // Check if this is a test session — suppress snowball jackpot for test sessions
     const { data: sessionData } = await supabase
@@ -1114,13 +1173,9 @@ export async function recordWinner(
     let snowballJackpotAmount: number | null = null;
     let isSnowballFullHouseStage = false;
     let snowballWindowOpen = false;
-    const { data: game } = await supabase
-        .from('games')
-        .select('type, snowball_pot_id')
-        .eq('id', gameId)
-        .single<Pick<Database['public']['Tables']['games']['Row'], 'type' | 'snowball_pot_id'>>();
+    const game = liveGameRow;
 
-    if (!isTestSession && game && game.type === 'snowball' && stage === 'Full House' && game.snowball_pot_id) {
+    if (!isTestSession && game.type === 'snowball' && stage === 'Full House' && game.snowball_pot_id) {
         isSnowballFullHouseStage = true;
         const { data: snowballPot } = await supabase
             .from('snowball_pots')
@@ -1154,7 +1209,7 @@ export async function recordWinner(
         session_id: sessionId,
         game_id: gameId,
         stage,
-        winner_name: winnerName,
+        winner_name: winnerName.trim(),
         prize_description: finalPrizeDescription,
         call_count_at_win: resolvedCallCountAtWin,
         is_snowball_eligible: snowballEligible,
diff --git a/src/app/player/[sessionId]/player-ui.tsx b/src/app/player/[sessionId]/player-ui.tsx
index bdb6ddb..d17a156 100644
--- a/src/app/player/[sessionId]/player-ui.tsx
+++ b/src/app/player/[sessionId]/player-ui.tsx
@@ -24,6 +24,8 @@ interface PlayerUIProps {
   initialPrizeText: string;
 }
 
+const POLL_INTERVAL_MS = 3000;
+
 export default function PlayerUI({
   session,
   activeGame: initialActiveGame,
@@ -163,6 +165,67 @@ export default function PlayerUI({
     };
   }, [currentActiveGame]);
 
+  useEffect(() => {
+    let cancelled = false;
+    let interval: NodeJS.Timeout | null = null;
+
+    const poll = async () => {
+      if (cancelled) return;
+      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
+
+      const { data: freshSession } = await supabase.current
+        .from('sessions')
+        .select('*')
+        .eq('id', session.id)
+        .single<Session>();
+      if (cancelled || !freshSession) return;
+
+      setCurrentSession(freshSession);
+
+      if (freshSession.active_game_id !== currentActiveGame?.id) {
+        await refreshActiveGame(freshSession.active_game_id);
+        return;
+      }
+
+      if (currentActiveGame?.id) {
+        const { data: freshState } = await supabase.current
+          .from('game_states_public')
+          .select('*')
+          .eq('game_id', currentActiveGame.id)
+          .single<GameState>();
+        if (cancelled || !freshState) return;
+
+        setCurrentGameState(freshState);
+        const stageKey = currentActiveGame.stage_sequence[freshState.current_stage_index];
+        setCurrentPrizeText(
+          currentActiveGame.prizes?.[stageKey as keyof typeof currentActiveGame.prizes] || ''
+        );
+      }
+    };
+
+    void poll();
+    interval = setInterval(() => { void poll(); }, POLL_INTERVAL_MS);
+
+    const handleVisibility = () => {
+      if (document.visibilityState === 'visible') {
+        void poll();
+      }
+    };
+    document.addEventListener('visibilitychange', handleVisibility);
+
+    return () => {
+      cancelled = true;
+      if (interval) clearInterval(interval);
+      document.removeEventListener('visibilitychange', handleVisibility);
+    };
+  }, [
+    session.id,
+    currentActiveGame?.id,
+    currentActiveGame?.prizes,
+    currentActiveGame?.stage_sequence,
+    refreshActiveGame,
+  ]);
+
   // --- Delay Logic (Same as Display) ---
   /* eslint-disable react-hooks/set-state-in-effect */
   useEffect(() => {
diff --git a/tasks/review/phase-1/remediation-plan.md b/tasks/review/phase-1/remediation-plan.md
index b349331..69b14c8 100644
--- a/tasks/review/phase-1/remediation-plan.md
+++ b/tasks/review/phase-1/remediation-plan.md
@@ -1,112 +1,7 @@
-# Remediation Plan — OJ-CashBingo
+# Remediation Plan - Superseded
 
-## Group 1: Critical — Fix immediately (active data corruption / security)
+This older Phase 1 remediation plan is superseded by:
 
-### Fix 1A: Add auth checks to all session detail server actions [DL-03]
-**File:** `src/app/admin/sessions/[id]/actions.ts`
-**Change:** Add `requireAdmin(supabase)` check at the top of every exported action (`setActiveGame`, `endSession`, `addGame`, `editGame`, `deleteGame`, `resetSession`, `duplicateGame`). Reuse the same admin-check helper pattern from `src/app/admin/actions.ts`.
-**Dependency:** None — standalone fix.
+`docs/superpowers/specs/2026-04-29-bingoblast-design.md`
 
-### Fix 1B: Remove `updateSnowballPotOnGameEnd` call from `recordWinner` [DL-01]
-**File:** `src/app/host/actions.ts`
-**Change:** `recordWinner()` should NOT call `updateSnowballPotOnGameEnd()`. Only `advanceToNextStage()` should call it. Pot update should happen once, when the stage advances — not when the winner is recorded. This is safe because `advanceToNextStage()` is always called after winner recording.
-**Dependency:** Must verify game flow: winner recorded → host advances stage → pot updates. Confirm `advanceToNextStage` is always called after a winner is recorded.
-
-### Fix 1C: Add guard to `advanceToNextStage` for completed games [DL-05]
-**File:** `src/app/host/actions.ts`
-**Change:** At function entry, after fetching `currentGameState`, add: `if (currentGameState.status === 'completed') return { success: false, error: 'Game is already completed.' };`
-**Dependency:** Fix 1B first (removes double pot update risk before this guard is in place).
-
-### Fix 1D: Make `recordWinner` atomic — wrap multi-step writes [DL-02]
-**File:** `src/app/host/actions.ts`
-**Change:** Ensure that if `game_states` update fails after `winners` INSERT, the function returns an error. Consider wrapping the winner insert and game_states update together. Full DB transactions require a Supabase RPC, but the minimum fix is: if `game_states` update fails, return error so host knows to retry, rather than silently succeeding.
-**Note on race condition (DL-04):** A full atomic number-call requires a PL/pgSQL function. For now, document the risk. The practical risk is low in a single-venue app where only one host operates at a time, but the architecture is fragile.
-
----
-
-## Group 2: High — Fix before next bingo night
-
-### Fix 2A: `sendHeartbeat` must verify sender is current controller [DL-07]
-**File:** `src/app/host/actions.ts`
-**Change:** Add `.eq('controller_id', user.id)` filter to the UPDATE query in `sendHeartbeat()`. Only the current controller can refresh the heartbeat.
-
-### Fix 2B: Add error propagation from `updateSnowballPotOnGameEnd` [DL-08]
-**File:** `src/app/host/actions.ts`
-**Change:** Change return type to `Promise<{ success: boolean; error?: string }>`. Return errors from both the jackpot reset and rollover branches. Have callers (`advanceToNextStage`) check the result and surface failure.
-
-### Fix 2C: Add input validation to critical server actions [DL-09]
-**File:** `src/app/host/actions.ts`
-**Change:** Add lightweight validation (can use simple checks rather than full Zod for now) to:
-- `recordWinner`: `winnerName.trim().length > 0` check; stage must be a valid `WinStage` value
-- `validateClaim`: `claimedNumbers` must be an array of integers in 1-90 range
-- `callNextNumber`: no additional inputs needed beyond game/session IDs
-**Note:** Use `isUuid()` (already exists in `src/lib/utils.ts`) for all gameId/sessionId params.
-
-### Fix 2D: Suppress test session jackpot recording [DL-10]
-**File:** `src/app/host/actions.ts` → `recordWinner()`
-**Change:** When `is_test_session = true`, set `actualIsSnowballJackpot = false` and `snowballJackpotAmount = null` before the winner INSERT. Pot mutation is already skipped by `updateSnowballPotOnGameEnd` — this ensures the winner record also doesn't show a fake jackpot.
-
-### Fix 2E: `moveToNextGame*` — reorder writes to fail safely [DL-06]
-**File:** `src/app/host/actions.ts`
-**Change:** In both `moveToNextGameAfterWin()` and `moveToNextGameOnBreak()`, mark the old game as completed FIRST, then update `sessions.active_game_id`. If the first write fails, the session still points to the old game (recoverable). The current order (session pointer first) leaves an orphaned in-progress game if step 2 fails.
-
----
-
-## Group 3: Medium — Fix within a week
-
-### Fix 3A: Clear win display fields on stage advance [DL-11]
-**File:** `src/app/host/actions.ts` → `advanceToNextStage()`
-**Change:** Include `display_win_type: null, display_win_text: null, display_winner_name: null` in the `game_states` update when advancing to a new stage.
-
-### Fix 3B: Auto-check or warn snowball_eligible when jackpot window is open [DL-12]
-**File:** `src/app/host/[sessionId]/[gameId]/game-control.tsx`
-**Change:** When `isSnowballJackpotWindowOpen = true` (calls ≤ max_calls), auto-check the `snowballEligible` checkbox and show a prominent warning: "Jackpot window is OPEN — check eligibility carefully." Don't prevent unchecking, but make the default safe.
-
-### Fix 3C: Replace string matching in `getRequiredSelectionCountForStage` with enum lookup [DL-13]
-**File:** `src/app/host/actions.ts`
-**Change:** Replace string `.includes()` matching with a `Map<WinStage, number>` or `switch` on the `WinStage` enum values. Throw an error for unknown stages.
-
-### Fix 3D: Add Realtime polling fallback for host game-control [DL-14]
-**File:** `src/app/host/[sessionId]/[gameId]/game-control.tsx`
-**Change:** Add a 10-second setInterval that refreshes `game_states` from DB (same pattern as player-ui and display-ui). Cancel interval when Realtime subscription confirms a recent event.
-
-### Fix 3E: Remove 35+ console.log/error from production code [DL-16]
-**Files:** `src/app/host/actions.ts`, `src/app/host/[sessionId]/[gameId]/game-control.tsx`, `src/app/display/[sessionId]/display-ui.tsx`
-**Change:** Remove debug `console.log` calls entirely. Convert `console.error` calls that represent real failures into returned errors or structured log entries.
-
----
-
-## Group 4: Low — Background cleanup
-
-### Fix 4A: Remove `react-player` dead dependency [DL-19]
-**Change:** `npm uninstall react-player`
-
-### Fix 4B: Verify/remove `signup` action or gate it admin-only [DL-20]
-**File:** `src/app/login/actions.ts`
-**Change:** If no public signup UI exists, remove the `signup` export. If it's used for admin user creation, move it to `src/app/admin/actions.ts` with admin role check.
-
-### Fix 4C: Add void winner capability [DL-18]
-**File:** `src/app/host/actions.ts` and admin session detail
-**Change:** Add `voidWinner(winnerId, voidReason)` server action that sets `is_void = true, void_reason = $reason`. Surface in admin session detail UI alongside existing winner list.
-
----
-
-## Implementation Order (dependency-safe)
-
-```
-1A (auth) → standalone
-1B (remove double pot call) → 1C depends on 1B
-1C (completed game guard) → after 1B
-1D (atomic winner record) → after 1B and 1C
-2A (heartbeat sender check) → standalone
-2B (pot update error propagation) → after 1B
-2C (input validation) → standalone
-2D (test session jackpot suppression) → standalone
-2E (reorder moveToNextGame writes) → standalone
-3A (clear win display on advance) → standalone
-3B (snowball eligible warning) → standalone
-3C (stage count enum lookup) → standalone
-3D (host polling fallback) → standalone
-3E (remove console.logs) → standalone, do last
-4A, 4B, 4C → standalone, any order
-```
+Do not implement from the old plan. It references function names and behaviors that no longer match the current code, and it predates the code-reviewed void-safe polling requirements.
```

## Changed File Contents

### `.claude/changes-manifest.log`

```
# manifest-version: 1
2026-04-29T16:23:29Z|EDIT|src/app/api/setup/route.ts|route|structure,docs
2026-04-29T16:23:35Z|EDIT|src/app/api/setup/route.ts|route|structure,docs
2026-04-29T16:23:41Z|EDIT|src/app/api/setup/route.ts|route|structure,docs
```

### `AGENTS.md`

```
# AGENTS.md — BingoBlast

This file provides project-specific guidance. See the workspace-level `AGENTS.md` one directory up for shared conventions.

## Quick Profile

- **Framework**: Next.js 16.1, React 19.2
- **Test runner**: Node.js native test runner (see `npm test`)
- **Database**: Supabase (PostgreSQL + RLS)
- **Key integrations**: QR codes (qrcode.react), Video player (react-player), No-sleep library (prevent screen dimming), Bingo game logic
- **Size**: ~43 files in src/

## Commands

```bash
npm run dev              # Start development server
npm run build            # Production build
npm run start            # Start production server
npm run lint             # ESLint check
npm test                 # Node.js native test runner (node --test --import tsx)
```

Note: Uses native Node.js test runner (no Jest/Vitest). Tests are minimal.

## Architecture

**Route Structure**: App Router optimized for mobile bingo gameplay. Key sections:
- `/` — Bingo lobby and game selection
- `/game/[id]` — Live bingo game (real-time card marking)
- `/admin` — Host view (manage games, call numbers)
- `/api/` — Real-time game state and number calling

**Auth**: Supabase Auth optional (guest mode supported). Players can join without creating account. Hosts use Supabase Auth.

**Database**: Supabase PostgreSQL. Minimal schema: games, cards, called_numbers, scores.

**Key Integrations**:
- **QR Codes**: Share game codes and join links via QR
- **react-player**: Optional video/audio for game theme or number announcements
- **nosleep.js**: Prevent device screen from dimming during gameplay
- **Real-time**: Supabase Realtime or polling for number updates

**Data Flow**: Host creates game → players join via code/QR → host calls numbers → player cards update in real-time → first player to complete card wins.

## Key Files

| Path | Purpose |
|------|---------|
| `src/types/` | TypeScript definitions (game, card, player, number) |
| `src/lib/` | Bingo logic, game state, validation |
| `src/app/` | Next.js routes (lobby, game, admin) |
| `src/components/` | Bingo card, number announcer, leaderboard |
| `src/hooks/` | Custom hooks (useGameState, useCard) |
| `src/utils/` | Utilities (QR generation, card generation, scoring) |
| `src/proxy.ts` | Supabase client initialization |
| `supabase/migrations/` | Database schema (games, cards, numbers) |

## Environment Variables

| Var | Purpose |
|-----|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL (public) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key (public) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service-role key (server-only) |
| `SETUP_SECRET` | Secret key for admin setup endpoint (prevent unauthorized game creation) |

## Project-Specific Rules / Gotchas

### Game Flow
1. **Host creates game**: Game ID generated, empty card deck created
2. **Players join**: Scan QR code or enter code → bingo card generated (randomized 75-ball or 90-ball UK)
3. **Host calls numbers**: Host interface shows random number generator → number broadcast to all players in real-time
4. **Player marks card**: Tap number on card to mark (tap again to unmark)
5. **Win detection**: System detects horizontal, vertical, diagonal line (regular) or all squares (coverall)
6. **Winner confirmation**: Host confirms winner → game ends → leaderboard shown

### Bingo Card Generation
- Standard 75-ball (5x5) or 90-ball (UK) format
- Numbers randomly distributed (no duplicates on single card)
- Each column has range: B (1-15), I (16-30), N (31-45), G (46-60), O (61-75)
- Center square always FREE in 75-ball
- Store card state (marked/unmarked squares) in Supabase or browser state

### Win Detection
- Check for: horizontal line, vertical line, diagonal, four corners, coverall
- Validate win before awarding points
- Support multiple winners (tie scenario)
- Log timestamp of win for leaderboard sorting

### Real-Time Updates
- Use Supabase Realtime subscriptions or polling (2-3 second intervals)
- Broadcast number call to all players in game
- Update called_numbers table with timestamp
- Cards update optimistically (tap to mark, sync with server)

### QR Codes
- Generate QR for game join URL: `yourdomain.com/game/[game-id]?join=true`
- Display QR on host screen for players to scan
- Also provide text code (e.g., "BINGO123") for manual entry
- QR size: 200x200px or larger on mobile

### Mobile Optimization
- Full-screen game view (no navigation bar during play)
- Landscape and portrait orientation support
- Large touch targets for number marking (min 40x40px)
- No hover states (use active/focus instead)

### Screen Keep-Awake
- Use `nosleep.js` library to prevent screen dimming
- Enable on game start: `enable()` when player joins
- Disable on game end or pause
- Graceful fallback if feature not supported

### react-player Integration
- Optional audio/video for number announcements
- Mute by default (user-controlled)
- Support YouTube, MP3, or local video URLs
- Stream or embed announcements (e.g., "Number 47: Three and four, 44")

### Game State Management
- Minimal server state (just called numbers)
- Card state can be client-side (localStorage) or server-side (Supabase)
- Host view needs list of all cards for current game
- Player count and join status tracked in Supabase

### Database Schema
- `games`: id, host_id, code, started_at, ended_at, winner_id, game_type (75-ball/90-ball)
- `cards`: id, game_id, player_id, numbers (JSON array), marked (JSON boolean array), created_at
- `called_numbers`: id, game_id, number, called_at
- `leaderboard`: id, game_id, player_id, position, marked_at (win timestamp)

### Security
- Validate game code before allowing join
- RLS: players can only see own card and public game info
- Host authentication required to call numbers
- Rate limit number calling (prevent spam)
- SETUP_SECRET required for admin endpoints (set in env, validate on server)

### Performance
- Load only current game data (not all games)
- Lazy-load leaderboard/results
- Preload next game when host presses "continue"
- QR generation fast (< 100ms)
- Keep game state compact (avoid sending full card to players repeatedly)

### Guest Mode
- Allow players to join without auth (optional)
- Store player name as session data
- Use session ID as player_id (not user_id)
- Clear session data when game ends or browser closes

### Accessibility
- Bingo card has clear grid layout
- Number marking toggles (not keyboard-only)
- Color not sole indicator (use checkmarks)
- Win announcements audible (if using react-player)
- Focus visible on all buttons

### Testing
- Native Node.js test runner (no Jest/Vitest)
- Test card generation logic (randomness, no duplicates)
- Test win detection (all patterns)
- Test QR code generation
- Minimal test coverage (business logic only)

### Deployment
- Environment variables required: Supabase URL/keys, SETUP_SECRET
- Enable Supabase Realtime for live number updates
- Consider CDN caching for static assets (QR generators, player avatars)
- Monitor real-time connection performance

### Common Patterns
- Game creation: host enters name → game_id generated → display QR → wait for players
- Player join: scan QR or enter code → card generated → card displayed
- Game play: host calls number → players mark cards → check for wins → leaderboard
- Multiple games: support multiple concurrent games with different hosts

### Gotchas
- QR code URL must include full domain (not relative path)
- Card marking state must sync with server (prevent cheating)
- Win detection must be fast (<500ms) to feel responsive
- Nosleep.js doesn't work on all devices/browsers (graceful fallback)
- Real-time updates may lag on poor network (show loading indicator)
- Bingo card numbers are randomized per card (standard behavior)

### Guest Session Management
- Use anonymous Supabase auth or custom session ID
- Store in `player_sessions` table with expiry
- Clean up expired sessions periodically
- Allow guest to convert to registered account after game
```

### `src/app/api/setup/route.ts`

```
import { createHash, timingSafeEqual } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

import { Database } from '@/types/database'

type SetupPayload = {
  email?: string
}

function getSetupSecret() {
  return process.env.SETUP_SECRET
}

function isSetupSecretValid(providedSecret: string | null, setupSecret: string): boolean {
  const providedDigest = createHash('sha256')
    .update(providedSecret ?? '', 'utf8')
    .digest()
  const expectedDigest = createHash('sha256')
    .update(setupSecret, 'utf8')
    .digest()

  return timingSafeEqual(providedDigest, expectedDigest)
}

export async function GET() {
  return NextResponse.json(
    { error: 'Method not allowed. Use POST.' },
    { status: 405 }
  )
}

export async function POST(request: NextRequest) {
  const setupSecret = getSetupSecret()
  if (!setupSecret) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const providedSecret = request.headers.get('x-setup-secret')
  if (!isSetupSecretValid(providedSecret, setupSecret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let payload: SetupPayload = {}
  try {
    payload = (await request.json()) as SetupPayload
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const email = payload.email?.trim()
  if (!email) {
    return NextResponse.json({ error: 'Email required' }, { status: 400 })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseServiceKey) {
    return NextResponse.json(
      { error: 'Service key not configured' },
      { status: 500 }
    )
  }

  const supabase = createClient<Database>(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })

  const { data, error: userError } = await supabase.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  })

  if (userError || !data.users) {
    return NextResponse.json(
      { error: 'Failed to list users: ' + userError?.message },
      { status: 500 }
    )
  }

  const user = data.users.find((candidate) => candidate.email === email)

  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  const { error: updateError } = await supabase
    .from('profiles')
    .update({ role: 'admin' })
    .eq('id', user.id)

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, user: user.email, role: 'admin' })
}
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
  
  const numberCallTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const currentGameStateRef = useRef<GameState | null>(currentGameState);

  useEffect(() => {
    currentGameStateRef.current = currentGameState;
  }, [currentGameState]);

  const refreshActiveGame = useCallback(async (newActiveGameId: string | null) => {
      if (newActiveGameId === currentActiveGame?.id) return;

      if (newActiveGameId) {
          const { data: newGame, error: gameError } = await supabase.current
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
      setIsWaitingState(!newActiveGameId);
  }, [currentActiveGame?.id]);

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

    let gameStateChannel: ReturnType<typeof supabaseClient.channel> | null = null;
    if (currentActiveGame?.id) {
      gameStateChannel = supabaseClient
        .channel(`game_state_public_updates:${currentActiveGame.id}`)
        .on<GameState>(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'game_states_public', filter: `game_id=eq.${currentActiveGame.id}` },
          (payload) => {
            const newState = payload.new;
            
            // No audio here anymore

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
    let cancelled = false;
    let interval: NodeJS.Timeout | null = null;

    const poll = async () => {
      if (cancelled) return;
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;

      const { data: freshSession } = await supabase.current
        .from('sessions')
        .select('*')
        .eq('id', session.id)
        .single<Session>();
      if (cancelled || !freshSession) return;

      setCurrentSession(freshSession);
      setIsWaitingState(!freshSession.active_game_id && freshSession.status !== 'running');

      if (freshSession.active_game_id !== currentActiveGame?.id) {
        await refreshActiveGame(freshSession.active_game_id);
        return;
      }

      if (currentActiveGame?.id) {
        const { data: freshState } = await supabase.current
          .from('game_states_public')
          .select('*')
          .eq('game_id', currentActiveGame.id)
          .single<GameState>();
        if (cancelled || !freshState) return;

        setCurrentGameState(freshState);
        const stageKey = currentActiveGame.stage_sequence[freshState.current_stage_index];
        setCurrentPrizeText(
          currentActiveGame.prizes?.[stageKey as keyof typeof currentActiveGame.prizes] || ''
        );
      }
    };

    void poll();
    interval = setInterval(() => { void poll(); }, POLL_INTERVAL_MS);

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void poll();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [
    session.id,
    currentActiveGame?.id,
    currentActiveGame?.prizes,
    currentActiveGame?.stage_sequence,
    refreshActiveGame,
  ]);

[truncated at line 200 — original has 622 lines]
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
import { formatPounds, getSnowballCallsLabel, getSnowballCallsRemaining, isSnowballJackpotEligible } from '@/lib/snowball';

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

const DISPLAY_SYNC_BUFFER_MS = 200;

const getRequiredSelectionCount = (stage: string | undefined): number => {
    if (!stage) return 5;
    const normalized = stage.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

    if (normalized.includes('full') || normalized.includes('house')) return 15;
    const isTwoLineStage =
        (normalized.includes('two') || normalized.includes('2') || normalized.includes('double')) &&
        normalized.includes('line');
    if (isTwoLineStage) return 10;
    if (normalized.includes('line')) return 5;
    return 5;
};


export default function GameControl({ sessionId, gameId, game, initialGameState, currentUserId, currentUserRole }: GameControlProps) {
    const router = useRouter();
    const [currentGameState, setCurrentGameState] = useState<GameState>(initialGameState);
    const [currentSnowballPot, setCurrentSnowballPot] = useState<SnowballPot | null>(null);
    const [isCallingNumber, setIsCallingNumber] = useState(false);
    const [actionError, setActionError] = useState<string | null>(null);
    const [isConnected, setIsConnected] = useState(true);
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
    const [displaySyncRemainingMs, setDisplaySyncRemainingMs] = useState(0);
    const [winnerName, setWinnerName] = useState('');
    const [prizeGiven, setPrizeGiven] = useState(false);
    const [snowballEligible, setSnowballEligible] = useState(false);
    const [currentWinners, setCurrentWinners] = useState<Winner[]>([]);
    const [sessionWinners, setSessionWinners] = useState<SessionWinner[]>([]);

    // Singleton Supabase client — all subscriptions share one WebSocket connection
    const supabaseRef = useRef(createClient());

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


[truncated at line 200 — original has 1319 lines]
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

function getRequiredSelectionCountForStage(stage: string | undefined): number {
    if (!stage) return 5;
    const stageCountMap: Record<WinStage, number> = {
        'Line': 5,
        'Two Lines': 10,
        'Full House': 15,
    };
    if (stage in stageCountMap) {
        return stageCountMap[stage as WinStage];
    }
    // Unknown stage — warn and fall back to 5
    return 5;
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

[truncated at line 200 — original has 1424 lines]
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

  useEffect(() => {
    let cancelled = false;
    let interval: NodeJS.Timeout | null = null;

    const poll = async () => {
      if (cancelled) return;
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;

      const { data: freshSession } = await supabase.current
        .from('sessions')
        .select('*')
        .eq('id', session.id)
        .single<Session>();
      if (cancelled || !freshSession) return;

      setCurrentSession(freshSession);

      if (freshSession.active_game_id !== currentActiveGame?.id) {
        await refreshActiveGame(freshSession.active_game_id);
        return;
      }

      if (currentActiveGame?.id) {
        const { data: freshState } = await supabase.current
          .from('game_states_public')
          .select('*')
          .eq('game_id', currentActiveGame.id)
          .single<GameState>();
        if (cancelled || !freshState) return;

        setCurrentGameState(freshState);
        const stageKey = currentActiveGame.stage_sequence[freshState.current_stage_index];
        setCurrentPrizeText(

[truncated at line 200 — original has 532 lines]
```

### `tasks/review/phase-1/remediation-plan.md`

```
# Remediation Plan - Superseded

This older Phase 1 remediation plan is superseded by:

`docs/superpowers/specs/2026-04-29-bingoblast-design.md`

Do not implement from the old plan. It references function names and behaviors that no longer match the current code, and it predates the code-reviewed void-safe polling requirements.
```

## Related Files (grep hints)

These files reference the basenames of changed files. They are hints for verification — not included inline. Read them only if a specific finding requires it.

```
CLAUDE.md
docs/PRD.md
src/app/admin/actions.ts
src/app/admin/dashboard.tsx
src/app/admin/history/page.tsx
src/app/admin/page.tsx
src/app/admin/sessions/[id]/actions.ts
src/app/admin/sessions/[id]/page.tsx
src/app/admin/sessions/[id]/session-detail.tsx
src/app/admin/snowball/actions.ts
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
# CLAUDE.md — BingoBlast

This file provides project-specific guidance. See the workspace-level `CLAUDE.md` one directory up for shared conventions.

## Quick Profile

- **Framework**: Next.js 16.1, React 19.2
- **Test runner**: Node.js native test runner (see `npm test`)
- **Database**: Supabase (PostgreSQL + RLS)
- **Key integrations**: QR codes (qrcode.react), Video player (react-player), No-sleep library (prevent screen dimming), Bingo game logic
- **Size**: ~43 files in src/

## Commands

```bash
npm run dev              # Start development server
npm run build            # Production build
npm run start            # Start production server
npm run lint             # ESLint check
npm test                 # Node.js native test runner (node --test --import tsx)
```

Note: Uses native Node.js test runner (no Jest/Vitest). Tests are minimal.

## Architecture

**Route Structure**: App Router optimized for mobile bingo gameplay. Key sections:
- `/` — Bingo lobby and game selection
- `/game/[id]` — Live bingo game (real-time card marking)
- `/admin` — Host view (manage games, call numbers)
- `/api/` — Real-time game state and number calling

**Auth**: Supabase Auth optional (guest mode supported). Players can join without creating account. Hosts use Supabase Auth.

**Database**: Supabase PostgreSQL. Minimal schema: games, cards, called_numbers, scores.

**Key Integrations**:
- **QR Codes**: Share game codes and join links via QR
- **react-player**: Optional video/audio for game theme or number announcements
- **nosleep.js**: Prevent device screen from dimming during gameplay
- **Real-time**: Supabase Realtime or polling for number updates

**Data Flow**: Host creates game → players join via code/QR → host calls numbers → player cards update in real-time → first player to complete card wins.

## Key Files

| Path | Purpose |
|------|---------|
| `src/types/` | TypeScript definitions (game, card, player, number) |
| `src/lib/` | Bingo logic, game state, validation |
| `src/app/` | Next.js routes (lobby, game, admin) |
| `src/components/` | Bingo card, number announcer, leaderboard |
| `src/hooks/` | Custom hooks (useGameState, useCard) |
| `src/utils/` | Utilities (QR generation, card generation, scoring) |
| `src/proxy.ts` | Supabase client initialization |
| `supabase/migrations/` | Database schema (games, cards, numbers) |

## Environment Variables

| Var | Purpose |
|-----|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL (public) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key (public) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service-role key (server-only) |
| `SETUP_SECRET` | Secret key for admin setup endpoint (prevent unauthorized game creation) |

## Project-Specific Rules / Gotchas

### Game Flow
1. **Host creates game**: Game ID generated, empty card deck created
2. **Players join**: Scan QR code or enter code → bingo card generated (randomized 75-ball or 90-ball UK)
3. **Host calls numbers**: Host interface shows random number generator → number broadcast to all players in real-time
4. **Player marks card**: Tap number on card to mark (tap again to unmark)
5. **Win detection**: System detects horizontal, vertical, diagonal line (regular) or all squares (coverall)
6. **Winner confirmation**: Host confirms winner → game ends → leaderboard shown

### Bingo Card Generation
- Standard 75-ball (5x5) or 90-ball (UK) format
- Numbers randomly distributed (no duplicates on single card)
- Each column has range: B (1-15), I (16-30), N (31-45), G (46-60), O (61-75)
- Center square always FREE in 75-ball
- Store card state (marked/unmarked squares) in Supabase or browser state

### Win Detection
- Check for: horizontal line, vertical line, diagonal, four corners, coverall
- Validate win before awarding points
- Support multiple winners (tie scenario)
- Log timestamp of win for leaderboard sorting

### Real-Time Updates
- Use Supabase Realtime subscriptions or polling (2-3 second intervals)
- Broadcast number call to all players in game
- Update called_numbers table with timestamp
- Cards update optimistically (tap to mark, sync with server)

### QR Codes
- Generate QR for game join URL: `yourdomain.com/game/[game-id]?join=true`
- Display QR on host screen for players to scan
- Also provide text code (e.g., "BINGO123") for manual entry
- QR size: 200x200px or larger on mobile

### Mobile Optimization
- Full-screen game view (no navigation bar during play)
- Landscape and portrait orientation support
- Large touch targets for number marking (min 40x40px)
- No hover states (use active/focus instead)

### Screen Keep-Awake
- Use `nosleep.js` library to prevent screen dimming
- Enable on game start: `enable()` when player joins
- Disable on game end or pause
- Graceful fallback if feature not supported

### react-player Integration
- Optional audio/video for number announcements
- Mute by default (user-controlled)
- Support YouTube, MP3, or local video URLs
- Stream or embed announcements (e.g., "Number 47: Three and four, 44")

### Game State Management
- Minimal server state (just called numbers)
- Card state can be client-side (localStorage) or server-side (Supabase)
- Host view needs list of all cards for current game
- Player count and join status tracked in Supabase

### Database Schema
- `games`: id, host_id, code, started_at, ended_at, winner_id, game_type (75-ball/90-ball)
- `cards`: id, game_id, player_id, numbers (JSON array), marked (JSON boolean array), created_at
- `called_numbers`: id, game_id, number, called_at
- `leaderboard`: id, game_id, player_id, position, marked_at (win timestamp)

### Security
- Validate game code before allowing join
- RLS: players can only see own card and public game info
- Host authentication required to call numbers
- Rate limit number calling (prevent spam)
- SETUP_SECRET required for admin endpoints (set in env, validate on server)

### Performance
- Load only current game data (not all games)
- Lazy-load leaderboard/results
- Preload next game when host presses "continue"
- QR generation fast (< 100ms)
- Keep game state compact (avoid sending full card to players repeatedly)

### Guest Mode
- Allow players to join without auth (optional)
- Store player name as session data
- Use session ID as player_id (not user_id)
- Clear session data when game ends or browser closes

### Accessibility
- Bingo card has clear grid layout
- Number marking toggles (not keyboard-only)
- Color not sole indicator (use checkmarks)
- Win announcements audible (if using react-player)
- Focus visible on all buttons

### Testing
- Native Node.js test runner (no Jest/Vitest)
- Test card generation logic (randomness, no duplicates)
- Test win detection (all patterns)
- Test QR code generation
- Minimal test coverage (business logic only)

### Deployment
- Environment variables required: Supabase URL/keys, SETUP_SECRET
- Enable Supabase Realtime for live number updates
- Consider CDN caching for static assets (QR generators, player avatars)
- Monitor real-time connection performance

### Common Patterns
- Game creation: host enters name → game_id generated → display QR → wait for players
- Player join: scan QR or enter code → card generated → card displayed
- Game play: host calls number → players mark cards → check for wins → leaderboard
- Multiple games: support multiple concurrent games with different hosts

### Gotchas
- QR code URL must include full domain (not relative path)
- Card marking state must sync with server (prevent cheating)
- Win detection must be fast (<500ms) to feel responsive
- Nosleep.js doesn't work on all devices/browsers (graceful fallback)
- Real-time updates may lag on poor network (show loading indicator)
- Bingo card numbers are randomized per card (standard behavior)

### Guest Session Management
- Use anonymous Supabase auth or custom session ID
- Store in `player_sessions` table with expiry
- Clean up expired sessions periodically
- Allow guest to convert to registered account after game
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

## Rule: `/Users/peterpitcher/Cursor/.claude/rules/supabase.md`

```markdown
# Supabase Conventions

## Client Patterns

Two Supabase client patterns — always use the correct one:

```typescript
// Server-side auth (anon key + cookie session) — use for auth checks:
const supabase = await getSupabaseServerClient();
const { data: { user } } = await supabase.auth.getUser();

// Server-side data (service-role, bypasses RLS) — use for system/cron operations:
const db = await getDb(); // or createClient() with service role
const { data } = await db.from("table").select("*").eq("id", id).single();

// Browser-only (client components):
const supabase = getSupabaseBrowserClient();
```

ESLint rules should prevent importing the admin/service-role client in client components.

## snake_case ↔ camelCase Conversion

DB columns are always `snake_case`; TypeScript types are `camelCase` with Date objects. Always wrap DB results:

```typescript
import { fromDb } from "@/lib/utils";
const record = fromDb<MyType>(dbRow); // converts snake_case keys + ISO strings → Date
```

All type definitions should live in a central types file (e.g. `src/types/database.ts`).

## Row Level Security (RLS)

- RLS is always enabled on all tables
- Use the anon-key client for user-scoped operations (respects RLS)
- Use the service-role client only for system operations, crons, and webhooks
- Never disable RLS "temporarily" — create a proper service-role path instead

## Migrations

```bash
npx supabase db push          # Apply pending migrations
npx supabase migration new    # Create a new migration file
```

- Migrations live in `supabase/migrations/`
- Full schema reference in `supabase/schema.sql` (paste into SQL Editor for fresh setup)
- Never run destructive migrations (DROP COLUMN/TABLE) without explicit approval
- Test migrations locally with `npx supabase db push --dry-run` before pushing (see `verification-pipeline.md`)

### Dropping columns or tables — mandatory function audit

When a migration drops a column or table, you MUST search for every function and trigger that references it and update them in the same migration. Failing to do so leaves silent breakage: PL/pgSQL functions that reference a dropped column/table throw an exception at runtime, and if any of those functions have an `EXCEPTION WHEN OTHERS THEN` handler, the error is swallowed and returned as a generic blocked/failure state — making the bug invisible until someone notices the feature is broken.

**Before writing any `DROP COLUMN` or `DROP TABLE`:**

```sql
-- Find all functions that reference the column or table
SELECT routine_name, routine_definition
FROM information_schema.routines
WHERE routine_definition ILIKE '%column_or_table_name%'
  AND routine_type = 'FUNCTION';
```

Or search the migrations directory:
```bash
grep -r "column_or_table_name" supabase/migrations/ --include="*.sql" -l
```

For each function found: update it in the same migration to remove or replace the reference. Never leave a function referencing infrastructure that no longer exists.

This also applies to **triggers** — check trigger functions separately:
```bash
grep -r "column_or_table_name" supabase/migrations/ --include="*.sql" -n
```

## Auth

- Supabase Auth with JWT + HTTP-only cookies
- Auth checks happen in layout files or middleware
- Server actions must always re-verify auth server-side (never rely on UI hiding)
- Public routes must be explicitly allowlisted

## Audit Logging

All mutations (create, update, delete) in server actions must call `logAuditEvent()`:

```typescript
await logAuditEvent({
  user_id: user.id,
  operation_type: 'update',
  resource_type: 'thing',
  operation_status: 'success'
});
```
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
