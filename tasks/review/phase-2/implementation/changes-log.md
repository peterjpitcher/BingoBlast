# Phase 2 Implementation Changes Log

Generated: 2026-03-14

## Summary

20 defects were reviewed. 6 were already compliant and required no change. 14 were applied.
1 dependency (`react-player`) was removed as unused.
Final build: clean (zero TypeScript errors, zero lint errors).

---

## Fixes Applied

### FIX 1C — `handleSnowballPotUpdate`: Return errors instead of console.error
**File**: `src/app/host/actions.ts`
**Change**: Changed return type from `void` to `Promise<{success: boolean; error?: string}>`. Replaced every `console.error` call with a returned error object. Added `return { success: true }` for the test-session skip path and non-snowball game path.

---

### FIX 1E — `advanceToNextStage`: Propagate `handleSnowballPotUpdate` errors
**File**: `src/app/host/actions.ts`
**Change**: Added `status` to the `game_states` select query. Added an early-return guard: `if (currentGameState.status === 'completed') return { success: false, error: 'Game is already completed.' }`. Updated the `handleSnowballPotUpdate` call to check the result and propagate any error.

---

### FIX 1F — `maybeCompleteSession`: Remove console.error (best-effort helper)
**File**: `src/app/host/actions.ts`
**Change**: Removed all `console.error` calls. This is a fire-and-forget helper; errors are intentionally silenced.

---

### FIX 1G — Remove all remaining console.log / console.error from host/actions.ts
**File**: `src/app/host/actions.ts`
**Change**: Swept the entire file and removed all remaining `console.error` and `console.log` calls from `startGame` and other functions where errors were already being propagated via return values.

---

### FIX 2B — `recordWinner`: Add input validation
**File**: `src/app/host/actions.ts`
**Change**: Added validation block at the top of `recordWinner`:
- Rejects empty `winnerName`
- Validates `stage` against `['Line', 'Two Lines', 'Full House']`
- Validates `selectedNumbers` is an array of integers within 1–90

---

### FIX 2C — `recordWinner`: Suppress snowball jackpot for test sessions
**File**: `src/app/host/actions.ts`
**Change**: Added a fetch of `sessions.is_test_session` before the jackpot award block. The `actualIsSnowballJackpot` flag is forced to `false` when running in a test session, preventing test runs from corrupting the live snowball pot.

---

### FIX 2D — `recordWinner`: Improve game_states update failure message
**File**: `src/app/host/actions.ts`
**Change**: Changed the error message on `game_states` update failure to `'Winner recorded but failed to update game state. Please refresh and try again.'` (previously a generic database error).

---

### FIX 3B — `validateClaim`: Add integer bounds validation on selectedNumbers
**File**: `src/app/host/actions.ts`
**Change**: Added validation: checks `selectedNumbers` is an array, all elements are integers, all are within the 1–90 range. Returns `{ success: false, error: '...' }` on violation.

---

### FIX 3C — `getRequiredSelectionCountForStage`: Replace string-matching with typed map
**File**: `src/app/host/actions.ts`
**Change**: Replaced `if/else if` string comparisons with a `Record<WinStage, number>` map:
```typescript
const stageCountMap: Record<WinStage, number> = {
    'Line': 5,
    'Two Lines': 10,
    'Full House': 15,
};
```

---

### FIX 3D — Remove console statements from display-ui.tsx
**File**: `src/app/display/[sessionId]/display-ui.tsx`
**Change**: Removed three console statements:
- `console.log("Switching to new game:", ...)`
- `console.error("Error fetching new active game:", ...)`
- `console.log('Realtime session update received:', ...)`

---

### FIX 4A — `signup` action: gate as invite-only
**File**: `src/app/login/actions.ts`
**Change**: Replaced the `signup` function body with an invite-only gate that immediately returns `{ success: false, error: 'Registration is invite-only. Please contact an administrator.' }`. The export is retained because `login/page.tsx` still imports it, but public registration is now blocked.

---

### FIX 4B — Remove console.error from login action
**File**: `src/app/login/actions.ts`
**Change**: Removed `console.error("Login Error:", error)` from the `login` function. Errors are propagated via the return value.

---

### FIX 4C — Add `voidWinner` action to admin session actions
**File**: `src/app/admin/sessions/[id]/actions.ts`
**Change**: Added new exported server action `voidWinner(winnerId, voidReason)`:
- Requires admin authorization via `authorizeAdmin()`
- Validates both `winnerId` and `voidReason` are non-empty
- Updates `winners` row: sets `is_void = true`, `void_reason = voidReason.trim()`
- Returns `ActionResult`

Also removed two `console.error` calls in `resetSession` (errors already returned via return values).

---

### FIX 4D — Add polling fallback to game-control.tsx Realtime subscription
**File**: `src/app/host/[sessionId]/[gameId]/game-control.tsx`
**Change**: Added a 10-second polling `useEffect` that re-fetches `game_states` when the tab is visible, as a fallback in case the Supabase Realtime subscription drops. Polling skips when `document.visibilityState !== 'visible'` to avoid unnecessary background fetches.

---

### FIX 4E — Auto-check snowballEligible when jackpot window opens
**File**: `src/app/host/[sessionId]/[gameId]/game-control.tsx`
**Change**: Added a `useEffect` (placed after the `isSnowballJackpotWindowOpen` derived variable) that sets `snowballEligible(true)` automatically when `isSnowballJackpotWindowOpen` becomes true. This prevents hosts from accidentally missing the eligibility checkbox during the jackpot window.

Added a visible warning text above the checkbox:
```tsx
<p className="text-xs font-semibold text-[#f3d59d] mb-2">
    Jackpot window is OPEN — check eligibility carefully before recording winner.
</p>
```

---

### FIX 5A — Remove unused `react-player` dependency
**Command**: `npm uninstall react-player`
**Change**: `react-player` was confirmed to have zero imports across the codebase. Removed from `package.json` and `package-lock.json`.

---

## Fixes Skipped (Already Compliant)

| ID | Defect | Reason Skipped |
|----|--------|----------------|
| FIX 1A | `authorizeAdmin`/`authorizeHost` auth guards | Already present in all server action files — every exported action calls an auth guard as its first operation |
| FIX 1B | `requireController` guard in `advanceToNextStage` | Already implemented — function checks `controlling_host_id` and returns early if mismatch |
| FIX 1D | `handleSnowballPotUpdate` called only when test session is false | Confirmed in `advanceToNextStage` and `recordWinner` — already gated on `is_test_session` before this phase |
| FIX 2A | `recordWinner` stage-sequence boundary check | Already present — code checks `currentGameState.current_stage_index` against `game.stage_sequence.length` |
| FIX 2E | `recordWinner` Full House / not final stage guard | Already present — `isFinalStage` check prevents erroneous snowball award when not on the last stage |
| FIX 3A | `validateClaim` auth guard | Already present — `requireController` called at top of function |

---

## Build Verification

```
npm run build   ✓  Clean — zero TypeScript errors, zero lint errors
```

All 14 active routes compiled and generated successfully.
