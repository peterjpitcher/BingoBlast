# Validation Report

## Fix Validation Results

| Fix | Defect | TC | Result | Evidence |
|-----|--------|----|--------|----------|
| 1A | DL-03 | TC-I06 | PARTIAL | `authorizeAdmin()` helper called at top of `createGame`, `updateGame`, `duplicateGame`, `deleteGame`, `updateSessionStatus`, `resetSession`, `voidWinner`. HOWEVER: original defect listed `setActiveGame`, `endSession`, `addGame`, `editGame` — none of those function names exist in the file. The file exports `updateSessionStatus` (covers set-status / end-session semantics) and `createGame`/`updateGame` (covers add/edit semantics). All exports present are auth-gated. |
| 1B | DL-01 | TC-G02 | PASS | `recordWinner()` (lines 1064–1227) does NOT call `updateSnowballPotOnGameEnd` / `handleSnowballPotUpdate`. `advanceToNextStage()` (lines 1047–1058) calls `handleSnowballPotUpdate` only when `newGameStatus === 'completed'`. Pot updated exactly once. |
| 1C | DL-05 | TC-G05 | PASS | `advanceToNextStage()` line 1012: `if (currentGameState.status === 'completed') { return { success: false, error: 'Game is already completed.' }; }` |
| 1D | DL-02 | TC-G03 | PASS | `recordWinner()` line 1221: `if (gameStateUpdateError) { return { success: false, error: '...' }; }`. Winner insert error also checked at line 1168 with early return. |
| 2A | DL-07 | TC-H02 | PASS | `sendHeartbeat()` (lines 463–480): UPDATE query includes `.eq('controlling_host_id', controlResult.user!.id)` at line 475. |
| 2B | DL-08 | TC-S04 | PASS | `handleSnowballPotUpdate()` returns `{ success: boolean; error?: string }`. In `advanceToNextStage()` lines 1053–1056: `const potResult = await handleSnowballPotUpdate(...); if (!potResult.success) { return { success: false, error: potResult.error ... }; }`. Caller checks result. |
| 2C | DL-09 | TC-G01 | PASS | `recordWinner()` lines 1077–1086: checks `winnerName.trim().length === 0`, validates `stage` against `validStages: WinStage[]` array with `.includes()`, validates `sessionId`/`gameId` non-empty. `validateClaim()` lines 877–882: checks `Array.isArray(claimedNumbers)` and `claimedNumbers.some(n => !Number.isInteger(n) \|\| n < 1 \|\| n > 90)`. All required validations present. |
| 2D | DL-10 | TC-T01 | PASS | `recordWinner()` lines 1110, 1123: `const isTestSession = sessionData?.is_test_session ?? false;` gates the snowball jackpot block — `actualIsSnowballJackpot` remains `false` and `snowballJackpotAmount` remains `null` when `isTestSession` is true because the jackpot computation block is wrapped in `if (!isTestSession && ...)`. |
| 2E | DL-06 | TC-G07 | PASS | Both `moveToNextGameOnBreak()` (lines 769–774) and `moveToNextGameAfterWin()` (lines 841–846): `if (currentGameState.status !== 'completed') { const endResult = await endGame(...); }` — old game completed first. `startGame()` (which sets `sessions.active_game_id`) is only called after, at lines 779 and 852. Write order is correct. |
| 3A | DL-11 | TC-D03 | PASS | `advanceToNextStage()` stageUpdate (lines 1034–1041) explicitly sets `display_win_type: null, display_win_text: null, display_winner_name: null`. |
| 3B | DL-12 | TC-H05 | PARTIAL | `useEffect` at line 273–277 auto-sets `snowballEligible` to `true` when `isSnowballJackpotWindowOpen` is truthy. A descriptive label and hint text are rendered near the checkbox (lines 1136–1146). However, no standalone warning/alert message is displayed to the host to draw attention — the auto-check is silent. The spirit of the fix is present but lacks a visible warning notice. |
| 3C | DL-13 | TC-G08 | PARTIAL | Server-side `getRequiredSelectionCountForStage()` in `actions.ts` (lines 90–102) uses a `Record<WinStage, number>` map — no string matching. HOWEVER, the client-side `getRequiredSelectionCount()` in `game-control.tsx` (lines 97–108) still uses `.includes('two')` / `.includes('line')` string matching. The server-side fix is correct, but the client copy was not updated. The server is authoritative for validation, so this is low-severity, but it represents drift between client and server logic. |
| 3D | DL-14 | TC-H04 | PASS | `useEffect` at lines 397–412 with `setInterval(..., 10000)`: polls `game_states` from Supabase every 10 seconds when tab is visible. Cleaned up on unmount. |
| 3E | DL-16 | TC-X02 | PASS | `grep console.log` across `host/actions.ts`, `game-control.tsx`, and `display-ui.tsx` returns zero matches. No console.log statements remain in any of the three files. |
| 4A | DL-19 | TC-X01 | PASS | `grep react-player package.json` returns no match. `react-player` is not in dependencies. |
| 4B | DL-20 | TC-A03 | PASS | `signup()` in `login/actions.ts` (line 38–40) returns `{ success: false, error: 'Registration is invite-only. Please contact an administrator.' }` immediately — registration is effectively disabled. |
| 4C | DL-18 | TC-I07 | PASS | `voidWinner(winnerId, voidReason)` exists at line 362 in `sessions/[id]/actions.ts`. Auth via `authorizeAdmin()` at line 364. Validates `winnerId` and `voidReason` non-empty at lines 367–372. |

---

## Regression Check Results

### 1. Normal game win flow: `recordWinner` → `advanceToNextStage`

Trace: Host calls `recordWinner(sessionId, gameId, stage, ...)`. The function validates inputs, checks controller, inserts a winner record, then updates `game_states` to set `display_winner_name` and `paused_for_validation: true`. It does NOT call `handleSnowballPotUpdate`. Host then calls `advanceToNextStage(gameId)`. That function increments `current_stage_index`, sets `display_win_type: null`, `display_win_text: null`, `display_winner_name: null`. If the game is now `completed`, it calls `handleSnowballPotUpdate` exactly once. Result: pot updated exactly once, in `advanceToNextStage`. No double-update. Both functions return `{ success: true }` on the happy path.

**PASS — no regression. Pot update happens exactly once.**

### 2. Claim validation: `validateClaim` with valid input

Trace: `validateClaim(gameId, claimedNumbers)` validates `gameId` non-empty, `claimedNumbers` is an array, and each number is an integer 1–90. Then checks controller auth. Fetches `game_states` and `games` to get stage. Calls `getRequiredSelectionCountForStage(currentStageName)` using the Record map — returns 5/10/15 correctly. Checks count matches. Verifies last called number is in claim. Checks all numbers are in `called_numbers` set. Returns `{ success: true, data: { valid: true } }`.

**PASS — new input validation does not break the happy path.**

### 3. Controller takeover: `takeControl` → `sendHeartbeat`

Trace: `takeControl(gameId)` checks `authorizeHost`, reads `controlling_host_id` and `controller_last_seen_at`. If the current controller is a different user AND was seen within 30 seconds, returns error. Otherwise writes `controlling_host_id: authResult.user.id`. `sendHeartbeat(gameId)` calls `requireController` which re-reads `controlling_host_id` from DB and confirms it matches the calling user. Then UPDATE uses `.eq('controlling_host_id', controlResult.user.id)` ensuring only the correct controller can update.

**PASS — new controller can take over and send heartbeats normally after stale period elapses.**

---

## Summary

PASS count: 13
PARTIAL count: 3 (1A, 3B, 3C)
FAIL count: 0
SKIPPED count: 0

---

## Go/No-Go Decision

**GO** — All critical defects (DL-01, DL-02, DL-03, DL-05, DL-06, DL-07, DL-08, DL-09, DL-10, DL-18, DL-19, DL-20) are correctly fixed. No regressions found. Three PARTIAL findings are low-severity:

1. **1A (DL-03):** Function names differ from original spec (`setActiveGame`/`endSession` vs `updateSessionStatus`) but every exported action in the file is auth-gated. No unprotected writes exist.
2. **3B (DL-12):** Snowball eligible is auto-checked when the window opens, but no distinct warning banner is displayed to alert the host. Functional safety is intact — the checkbox will be checked automatically. UX improvement only.
3. **3C (DL-13):** Server-side validation uses the correct Record map. Client-side `getRequiredSelectionCount` in `game-control.tsx` still uses string matching. Since the server is authoritative, this does not cause incorrect data to be accepted; it only means the client UI count hint could theoretically diverge if a non-standard stage name was used. No such stage names exist in the current schema.

---

## Outstanding Issues

| # | Fix | Severity | Recommended Action |
|---|-----|----------|--------------------|
| 1 | 3C (DL-13) | Low | Update `getRequiredSelectionCount` in `game-control.tsx` to use the same `Record<WinStage, number>` map as `actions.ts` to keep client and server logic in sync. |
| 2 | 3B (DL-12) | Low | Add a visible warning notice (e.g. yellow banner text: "Jackpot window is open — snowball eligible has been auto-checked") when `isSnowballJackpotWindowOpen` becomes true, so the host is explicitly alerted rather than relying on silent auto-check. |
