# W2A — Server Actions: Handoff

## Status: complete (staged, not committed)

## Files modified and staged

| Path | Action |
|------|--------|
| `src/app/host/actions.ts` | MODIFIED |
| `src/app/admin/sessions/[id]/actions.ts` | MODIFIED |
| `src/app/admin/actions.ts` | MODIFIED |
| `src/app/host/[sessionId]/[gameId]/game-control.tsx` | MODIFIED (mechanical callsite-only) |
| `src/app/admin/sessions/[id]/session-detail.tsx` | MODIFIED (mechanical callsite-only) |
| `tasks/review/live-event-fixes/wave-2/W2A-handoff.md` | NEW (this file) |

## Verification

- `npx tsc --noEmit` — clean (exit 0).
- `npm test` — 27/27 passing (no regressions vs. Wave 1).
- `npm run lint` on the five W2A-edited files only — zero errors, zero warnings.
- `npm run lint` on the whole repo — 4 pre-existing warnings + 1 pre-existing error all in non-W2A files (see "Pre-existing lint issues" below). No new lint output from W2A.

## Function-by-function changes

### `src/app/host/actions.ts`

#### Removed: local `getRequiredSelectionCountForStage`
- Deleted the local helper. Replaced with `import { getRequiredSelectionCountForStage } from '@/lib/win-stages'` (Wave 1 deliverable). The shared helper returns `number | null`; the previous local helper silently fell back to `5` for unknown stages.

#### `startGame()` — A7
- New rows now insert with `call_delay_seconds = 2` (was `1`). Existing rows with a value already set are still respected via the `existingGameState?.call_delay_seconds ?? 2` fallback.
- All other behaviour (auth check, cash-jackpot prompt, controller heartbeat re-take logic, completed-game restart path, session.active_game_id sync, revalidatePath calls) preserved verbatim.

#### `callNextNumber()` — A8
- **New return type:** `ActionResult<{ nextNumber: number; gameState: Database['public']['Tables']['game_states']['Row'] }>`. Adds `gameState` so the host can apply the response immediately without waiting for Realtime.
- **Removed the 200ms `displaySyncBufferMs`** from the gap check. The new gap is exactly `call_delay_seconds * 1000`. No client-side display-sync lockout — Wave 3 owns removing the corresponding host-UI lock.
- **Server-side gap enforcement preserved** using `last_call_at` + `call_delay_seconds`. Rejects with a clear "wait Ns before calling the next number" message if the gap has not elapsed.
- **Compare-and-set guard preserved** verbatim: `.eq('numbers_called_count', oldCount)` + `.select('numbers_called_count')` to detect concurrent calls.
- **After the update, the row is re-read** with `select('*')` so the response includes the newly-incremented `state_version` (the BEFORE UPDATE trigger from Wave 1 has already bumped it). Returns the row as `gameState`.
- All pre-call validations preserved: status must be `'in_progress'`, not `on_break`, not `paused_for_validation`, sequence must not be exhausted.
- `requireController` auth check preserved as the first operation.

#### `validateClaim()` — D1 (server portion only)
- Now uses `getRequiredSelectionCountForStage` from `@/lib/win-stages`. When the helper returns `null` (unknown stage), the action rejects with `'Stage not valid for this game'`.
- All other behaviour preserved: claim must include the last called number, called-numbers set check, returns `{ valid: false; invalidNumbers }` for unmarked numbers, `{ valid: true }` otherwise.

#### `recordWinner()` — B6 (server portion)
- **Removed parameters:** `winnerName: string` and `callCountAtWin: number`. The action signature is now:
  ```ts
  recordWinner(
    sessionId: string,
    gameId: string,
    stage: WinStage,
    prizeDescription: string | null,
    prizeGiven: boolean = false,
    forceSnowballJackpot: boolean = false,
    snowballEligible: boolean = false
  ): Promise<ActionResult>
  ```
- **Always re-reads `numbers_called_count`** server-side from `game_states`; never trusts a client value (this was already the case via `liveStateRow.numbers_called_count`, but the parameter is now removed entirely).
- **Persists `winner_name = 'Anonymous'`** in the `winners` table.
- **Sets `display_winner_name = null`** on the game-state display update.
- **Display win text:** Regular Line / Two Lines / Full House wins all set `display_win_text = 'BINGO!'`. The snowball-jackpot path retains the existing celebratory text including the cash amount (e.g. `'FULL HOUSE + SNOWBALL £250!'`) — hiding the jackpot amount would be worse UX per spec §7. The two snowball-Full-House non-jackpot branches (window-still-open-but-ineligible, window-closed) now also write `'BINGO!'` so the public wording matches the regular wins.
- **Preserved verbatim:** auth check (`requireController`), session/game cross-check, in-progress check, stage-mismatch check, snowball-eligibility computation (test-session suppression, `isSnowballJackpotEligible`, `forceSnowballJackpot` handling), prize-description normalization with snowball-jackpot description merging, audit-style winner-row insert, `paused_for_validation = true` after the update, `revalidatePath` call.
- **No unique constraint added.** Multiple winners per stage remain valid (spec §7).

#### `recordSnowballWin` — B7
- **No separate function exists.** The "Manual Snowball Award" code path goes through `recordWinner` with `forceSnowballJackpot = true`. The signature change above covers both paths. The dedicated callsite in `game-control.tsx` (line ~1290) has been adapted mechanically (see below).

### `src/app/admin/sessions/[id]/actions.ts`

#### `createGame()` — B2
- Imports `validateGamePrizes` from `@/lib/prize-validation`.
- Trims every `formData` prize value before saving; whitespace-only values are dropped from the `prizes` map.
- Calls `validateGamePrizes({ type, stage_sequence, prizes })` before insert. On failure, returns `{ success: false, error: '<game name>: prize required for <stages joined>' }`.
- All existing behaviour preserved: admin auth check, name/index validation, snowball pot requirement, stage_sequence derivation for snowball/jackpot, `revalidatePath`.

#### `updateGame()` — B2 + lock-once-started
- Now reads `game_states.status` (via `maybeSingle`) for the target game and computes `isLocked = gameStateRow ? status !== 'not_started' : false`. The session-status-based lock has been removed entirely; the new gate is per-game, so future not-started games inside a running session remain editable.
- When locked, rejects any change to `prizes`, `type`, `snowball_pot_id`, or `stage_sequence` with a single error `'Cannot edit <fields>: on a started game'`. The comparison treats trimmed prize maps and `JSON.stringify` of stage arrays as the canonical form.
- Trims every prize before saving.
- Calls `validateGamePrizes` after the lock check (so the lock error message wins when both apply).
- Removed the unused `SessionStatus` type import.
- All existing behaviour preserved: admin auth check, name/index validation, snowball pot requirement, stage_sequence derivation, revalidatePath.

#### `deleteGame()` — D7 step 1
- Replaces the previous "in_progress / completed" dual-check with a single guard: allows deletion only when the game has no `game_states` row OR `game_states.status === 'not_started'`. Otherwise returns `'Cannot delete a game with status <status>.'`.
- Adds a new winner-count check: if any rows in `winners` reference this `game_id`, returns `'Cannot delete a game that has recorded winners.'`. This protects historical results even if the live state has been reset.
- Admin auth check still runs FIRST.
- `revalidatePath` preserved.

#### `resetSession()` — D9 step 1
- **New signature:** `resetSession(sessionId: string, confirmationText: string): Promise<ActionResult>`.
- After auth, reads the session's `name`. Accepts `confirmationText` equal to the literal `'RESET'` OR the session's name. Otherwise returns `'Type RESET or the session name to confirm.'`.
- All existing destructive deletes preserved verbatim and remain idempotent: `game_states` rows for this session's games, `winners` rows for this session, then `sessions.status = 'ready'` + `active_game_id = null`.
- `revalidatePath` preserved.

### `src/app/admin/actions.ts`

#### `deleteSession()` — D8 step 1
- Replaces the previous `status === 'running'` reject with two server-side guards:
  1. Reads the session's child `games` ids, then queries `game_states` for any row with `status != 'not_started'`. If found, rejects with `'Cannot delete a session containing a <status> game.'`.
  2. Counts `winners` for the session. If non-zero, rejects with `'Cannot delete a session that has recorded winners.'`.
- Replaced `SessionStatus` import with `GameStatus` to type the rejection message.
- Admin auth check still runs FIRST.
- `revalidatePath('/admin')` and `redirectTo: '/admin'` preserved.

## Mechanical callsite adaptations (UI behaviour unchanged)

### `src/app/host/[sessionId]/[gameId]/game-control.tsx`

- **`handleRecordWinner` (line ~648):** Removed the `winnerName.trim()` empty-check (the action no longer accepts a name) and dropped `winnerName` and `currentGameState.numbers_called_count` from the `recordWinner(...)` call. The new arg order is `(sessionId, gameId, currentStage, prizeDescription, prizeGiven, false, snowballEligible)`.
- **Manual Snowball Award onClick (line ~1284):** Same mechanical drop: removed the local `winnerName.trim()` empty-check and dropped `winnerName` + `currentGameState.numbers_called_count` from the `recordWinner(...)` call. The args are now `('Full House', prizeDescription, true, true, true)` (with `sessionId, gameId` first).
- **No UI changes.** The "Winner Name" `<Input>` and `winnerName` state are STILL present in both modals — Wave 3 (W3A) owns removing the input fields. Wave 3 also owns adding the `isRecordingWinner` double-tap guard. The brief explicitly stated mechanical edits MUST NOT change UI behaviour.
- **`handleCallNextNumber` was NOT changed.** The new `callNextNumber` return shape is structurally compatible with the old one (still has `success`/`error` and `result.data.nextNumber` if accessed). The host today does not read `result.data` at all — it just checks `result.success` and lets Realtime drive the UI. Wave 3 owns wiring `result.data.gameState` into `setCurrentGameState` via `isFreshGameState`.

### `src/app/admin/sessions/[id]/session-detail.tsx`

- **`handleResetSession` (line ~158):** The action now requires a confirmation string. Added `'RESET'` as the literal second argument so the existing `window.confirm()`-driven flow continues to work and tsc stays clean. Wave 3 (W3C) will replace this with a typed-confirm modal.

## Pre-existing lint issues (NOT introduced by W2A)

Repo-wide `npm run lint` reports the following — all in files I did NOT touch:

| File | Issue | Notes |
|---|---|---|
| `src/app/display/[sessionId]/display-ui.tsx:67` | `'gameError' is assigned a value but never used` | Pre-existing; Wave 3 territory |
| `src/app/display/[sessionId]/display-ui.tsx:194` | `react-hooks/exhaustive-deps` (currentActiveGame) | Pre-existing |
| `src/app/login/actions.ts:38` | `'_formData' is defined but never used` | Pre-existing |
| `src/app/player/[sessionId]/player-ui.tsx:221` | `react-hooks/exhaustive-deps` (currentActiveGame) | Pre-existing |
| `src/hooks/use-connection-health.ts:26` | ERROR: `react-hooks/purity` — `Date.now()` in `useReducer` initializer | W1B deliverable; flag for Wave 3 to clean up. The fix is to defer `Date.now()` into the initializer function rather than passing it as the initialArg. |

## Open questions / things for Wave 3 to handle

1. **Wire `callNextNumber` response into the host.** The action now returns `gameState` alongside `nextNumber`. Wave 3 should call `setCurrentGameState((current) => isFreshGameState(current, result.data.gameState) ? result.data.gameState : current)` after a successful `callNextNumber` so the host shows the new ball instantly. (Plan task A8 step 2.)
2. **Remove the host display-sync lockout.** `DISPLAY_SYNC_BUFFER_MS`, `displaySyncRemainingMs`, `isDisplaySyncLocked` still exist in `game-control.tsx` (around lines 96, 293-335, 781-787). The server side no longer enforces the 200ms buffer; the client lockout is now redundant and should be removed (plan task A9).
3. **Remove the "Winner Name" inputs.** Both the regular Record Winner modal and the Manual Snowball Award modal still have `<Input value={winnerName} ...>`. The action doesn't read it; Wave 3 (W3A) should remove the input + `winnerName` state.
4. **Add `isRecordingWinner` double-tap guard.** Spec §7 explicitly requires this; the brief says it's W3A's responsibility.
5. **Replace the `confirm()` reset flow with a typed-confirm modal.** I passed `'RESET'` as a placeholder so the existing flow keeps working. Wave 3 (W3C) should add a modal that captures the typed string and passes it through.
6. **`react-hooks/purity` error in `use-connection-health.ts`.** Wave 1 deliverable; the fix is one-line. Either Wave 3 picks this up or W1B should be asked to follow up.
7. **`recordWinner` in test sessions.** Test sessions still use `'Anonymous'` as the winner name. If reporting on test sessions ever needs to identify the test winner separately, that's a future product decision.

## What downstream agents can rely on

- `callNextNumber` returns `{ success: true; data: { nextNumber, gameState } }` on success. `gameState` includes the newly-bumped `state_version`.
- `recordWinner` no longer accepts `winnerName` or `callCountAtWin`. `winner_name` in the `winners` table is always `'Anonymous'`. `display_winner_name` is `null`. `display_win_text` is `'BINGO!'` for regular wins and the snowball-celebratory text for jackpot wins.
- `validateClaim` rejects unknown stages with `'Stage not valid for this game'`.
- `createGame` and `updateGame` validate prizes server-side via `@/lib/prize-validation` and trim values before saving.
- `updateGame` rejects edits to `prizes`, `type`, `snowball_pot_id`, `stage_sequence` for any game whose `game_states.status !== 'not_started'`.
- `deleteGame` rejects games not in `not_started` AND games with any winner rows.
- `deleteSession` rejects sessions with any non-`not_started` games AND sessions with any winners.
- `resetSession(sessionId, confirmationText)` requires the typed `'RESET'` or the session's name.

## Files staged via git add (NOT committed)

```
src/app/host/actions.ts
src/app/admin/sessions/[id]/actions.ts
src/app/admin/actions.ts
src/app/host/[sessionId]/[gameId]/game-control.tsx
src/app/admin/sessions/[id]/session-detail.tsx
```

The handoff file itself is in the working tree but not yet `git add`-ed — orchestrator can add it as part of the Wave 2 commit.
