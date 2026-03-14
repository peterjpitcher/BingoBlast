# Remediation Plan — OJ-CashBingo

## Group 1: Critical — Fix immediately (active data corruption / security)

### Fix 1A: Add auth checks to all session detail server actions [DL-03]
**File:** `src/app/admin/sessions/[id]/actions.ts`
**Change:** Add `requireAdmin(supabase)` check at the top of every exported action (`setActiveGame`, `endSession`, `addGame`, `editGame`, `deleteGame`, `resetSession`, `duplicateGame`). Reuse the same admin-check helper pattern from `src/app/admin/actions.ts`.
**Dependency:** None — standalone fix.

### Fix 1B: Remove `updateSnowballPotOnGameEnd` call from `recordWinner` [DL-01]
**File:** `src/app/host/actions.ts`
**Change:** `recordWinner()` should NOT call `updateSnowballPotOnGameEnd()`. Only `advanceToNextStage()` should call it. Pot update should happen once, when the stage advances — not when the winner is recorded. This is safe because `advanceToNextStage()` is always called after winner recording.
**Dependency:** Must verify game flow: winner recorded → host advances stage → pot updates. Confirm `advanceToNextStage` is always called after a winner is recorded.

### Fix 1C: Add guard to `advanceToNextStage` for completed games [DL-05]
**File:** `src/app/host/actions.ts`
**Change:** At function entry, after fetching `currentGameState`, add: `if (currentGameState.status === 'completed') return { success: false, error: 'Game is already completed.' };`
**Dependency:** Fix 1B first (removes double pot update risk before this guard is in place).

### Fix 1D: Make `recordWinner` atomic — wrap multi-step writes [DL-02]
**File:** `src/app/host/actions.ts`
**Change:** Ensure that if `game_states` update fails after `winners` INSERT, the function returns an error. Consider wrapping the winner insert and game_states update together. Full DB transactions require a Supabase RPC, but the minimum fix is: if `game_states` update fails, return error so host knows to retry, rather than silently succeeding.
**Note on race condition (DL-04):** A full atomic number-call requires a PL/pgSQL function. For now, document the risk. The practical risk is low in a single-venue app where only one host operates at a time, but the architecture is fragile.

---

## Group 2: High — Fix before next bingo night

### Fix 2A: `sendHeartbeat` must verify sender is current controller [DL-07]
**File:** `src/app/host/actions.ts`
**Change:** Add `.eq('controller_id', user.id)` filter to the UPDATE query in `sendHeartbeat()`. Only the current controller can refresh the heartbeat.

### Fix 2B: Add error propagation from `updateSnowballPotOnGameEnd` [DL-08]
**File:** `src/app/host/actions.ts`
**Change:** Change return type to `Promise<{ success: boolean; error?: string }>`. Return errors from both the jackpot reset and rollover branches. Have callers (`advanceToNextStage`) check the result and surface failure.

### Fix 2C: Add input validation to critical server actions [DL-09]
**File:** `src/app/host/actions.ts`
**Change:** Add lightweight validation (can use simple checks rather than full Zod for now) to:
- `recordWinner`: `winnerName.trim().length > 0` check; stage must be a valid `WinStage` value
- `validateClaim`: `claimedNumbers` must be an array of integers in 1-90 range
- `callNextNumber`: no additional inputs needed beyond game/session IDs
**Note:** Use `isUuid()` (already exists in `src/lib/utils.ts`) for all gameId/sessionId params.

### Fix 2D: Suppress test session jackpot recording [DL-10]
**File:** `src/app/host/actions.ts` → `recordWinner()`
**Change:** When `is_test_session = true`, set `actualIsSnowballJackpot = false` and `snowballJackpotAmount = null` before the winner INSERT. Pot mutation is already skipped by `updateSnowballPotOnGameEnd` — this ensures the winner record also doesn't show a fake jackpot.

### Fix 2E: `moveToNextGame*` — reorder writes to fail safely [DL-06]
**File:** `src/app/host/actions.ts`
**Change:** In both `moveToNextGameAfterWin()` and `moveToNextGameOnBreak()`, mark the old game as completed FIRST, then update `sessions.active_game_id`. If the first write fails, the session still points to the old game (recoverable). The current order (session pointer first) leaves an orphaned in-progress game if step 2 fails.

---

## Group 3: Medium — Fix within a week

### Fix 3A: Clear win display fields on stage advance [DL-11]
**File:** `src/app/host/actions.ts` → `advanceToNextStage()`
**Change:** Include `display_win_type: null, display_win_text: null, display_winner_name: null` in the `game_states` update when advancing to a new stage.

### Fix 3B: Auto-check or warn snowball_eligible when jackpot window is open [DL-12]
**File:** `src/app/host/[sessionId]/[gameId]/game-control.tsx`
**Change:** When `isSnowballJackpotWindowOpen = true` (calls ≤ max_calls), auto-check the `snowballEligible` checkbox and show a prominent warning: "Jackpot window is OPEN — check eligibility carefully." Don't prevent unchecking, but make the default safe.

### Fix 3C: Replace string matching in `getRequiredSelectionCountForStage` with enum lookup [DL-13]
**File:** `src/app/host/actions.ts`
**Change:** Replace string `.includes()` matching with a `Map<WinStage, number>` or `switch` on the `WinStage` enum values. Throw an error for unknown stages.

### Fix 3D: Add Realtime polling fallback for host game-control [DL-14]
**File:** `src/app/host/[sessionId]/[gameId]/game-control.tsx`
**Change:** Add a 10-second setInterval that refreshes `game_states` from DB (same pattern as player-ui and display-ui). Cancel interval when Realtime subscription confirms a recent event.

### Fix 3E: Remove 35+ console.log/error from production code [DL-16]
**Files:** `src/app/host/actions.ts`, `src/app/host/[sessionId]/[gameId]/game-control.tsx`, `src/app/display/[sessionId]/display-ui.tsx`
**Change:** Remove debug `console.log` calls entirely. Convert `console.error` calls that represent real failures into returned errors or structured log entries.

---

## Group 4: Low — Background cleanup

### Fix 4A: Remove `react-player` dead dependency [DL-19]
**Change:** `npm uninstall react-player`

### Fix 4B: Verify/remove `signup` action or gate it admin-only [DL-20]
**File:** `src/app/login/actions.ts`
**Change:** If no public signup UI exists, remove the `signup` export. If it's used for admin user creation, move it to `src/app/admin/actions.ts` with admin role check.

### Fix 4C: Add void winner capability [DL-18]
**File:** `src/app/host/actions.ts` and admin session detail
**Change:** Add `voidWinner(winnerId, voidReason)` server action that sets `is_void = true, void_reason = $reason`. Surface in admin session detail UI alongside existing winner list.

---

## Implementation Order (dependency-safe)

```
1A (auth) → standalone
1B (remove double pot call) → 1C depends on 1B
1C (completed game guard) → after 1B
1D (atomic winner record) → after 1B and 1C
2A (heartbeat sender check) → standalone
2B (pot update error propagation) → after 1B
2C (input validation) → standalone
2D (test session jackpot suppression) → standalone
2E (reorder moveToNextGame writes) → standalone
3A (clear win display on advance) → standalone
3B (snowball eligible warning) → standalone
3C (stage count enum lookup) → standalone
3D (host polling fallback) → standalone
3E (remove console.logs) → standalone, do last
4A, 4B, 4C → standalone, any order
```
