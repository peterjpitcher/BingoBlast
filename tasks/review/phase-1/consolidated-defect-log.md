# Consolidated Defect Log — OJ-CashBingo Phase 1

## Cross-Reference Notes

**QA-02 CORRECTED to PASS** — Verification confirmed `validateClaim()` DOES check `!claimedNumbers.includes(lastCalledNumber)` at lines 948-950. This check is present and working.

**BR-02 CORRECTED to LOW** — `formatPounds()` returns `'0'` for non-finite values; display text uses conditional `snowballJackpotAmount !== null ? '£X' : 'JACKPOT!'`. Display shows plain "JACKPOT" not "£null". Still confusing but not broken.

**NEW CRITICAL FINDING (DL-03)** — Direct grep of `src/app/admin/sessions/[id]/actions.ts` returned ZERO matches for any auth check (`requireAdmin`, `authorizeHost`, `auth.getUser`, role check). All 7 session-mutating server actions (`setActiveGame`, `endSession`, `addGame`, `editGame`, `deleteGame`, `resetSession`, `duplicateGame`) have no server-side authorization. Middleware protects the `/admin` route UI but server actions are callable directly via POST from any client.

---

## Master Defect Log

### CRITICAL — Actively harmful, data corruption risk

---

**[DL-01] Double snowball pot update on same game**
- **Found by:** BR-08, QA-08 (2 agents, high confidence)
- **Summary:** Both `recordWinner()` and `advanceToNextStage()` independently call `updateSnowballPotOnGameEnd(gameId)`. In the normal snowball game flow the host records the winner then advances the stage — the pot is updated TWICE: once on winner record, once on stage advance.
- **Business Impact:** Pot increments by 2× jackpot_increment and 2× max_calls_increment per game. Jackpot amount and call limit grow faster than configured. Incorrect pot shown on display the following week.
- **Affected Files:** `src/app/host/actions.ts` → `recordWinner()`, `advanceToNextStage()`
- **Test Cases:** TC-D03, TC-D04, TC-F06

---

**[DL-02] No transaction on `recordWinner()` — partial failure risk**
- **Found by:** TA-01, QA-01 (2 agents, high confidence)
- **Summary:** Three sequential DB writes: (1) INSERT winners, (2) UPDATE game_states display fields (win announcement), (3) UPDATE snowball_pots. No transaction. Any step can fail after prior steps commit.
- **Partial Failure Path:** Step 1 succeeds → winner recorded in DB → Step 2 fails → game_states never shows win announcement → display/player never see the win → game is stuck.
- **Business Impact:** Winner recorded but game never progresses. Host must manually intervene. Display stays on wrong state for the audience.
- **Affected Files:** `src/app/host/actions.ts` → `recordWinner()`
- **Test Cases:** TC-D01, TC-D02, TC-D03

---

**[DL-03] Session detail server actions have NO server-side auth check**
- **Found by:** Orchestrator verification (no prior agent caught this)
- **Summary:** All 7 server actions in `src/app/admin/sessions/[id]/actions.ts` (`setActiveGame`, `endSession`, `addGame`, `editGame`, `deleteGame`, `resetSession`, `duplicateGame`) have zero auth checks. The `/admin` middleware route guard blocks the UI, but Next.js server actions are callable directly via POST from any authenticated (or potentially unauthenticated) client.
- **Business Impact:** Any logged-in host (or unauthenticated user with the action hash) can: end sessions mid-game, change which game is active, delete games, reset sessions. This is a significant security gap for a live venue application.
- **Affected Files:** `src/app/admin/sessions/[id]/actions.ts` (all exports)
- **Test Cases:** TC-A04, TC-I06

---

**[DL-04] `callNextNumber()` race condition — duplicate numbers possible**
- **Found by:** TA-03, QA-04 (2 agents, high confidence)
- **Summary:** `callNextNumber()` reads `numbers_called_count` from DB, uses it as an array index, increments it in a separate write. If two concurrent calls read the same count before either write completes, both call the same number.
- **Partial Failure Path:** Host A and B both in the game (two tabs, or brief stale controller state). Both read count=45, both call number_sequence[45], both commit count=46. Same number appears twice in called_numbers.
- **Business Impact:** Duplicate number called — bingo rules violation. Players with that number would see it called twice, creating confusion and potential false wins.
- **Affected Files:** `src/app/host/actions.ts` → `callNextNumber()`
- **Test Cases:** TC-B05

---

### HIGH — Fragile, will break under realistic edge cases

---

**[DL-05] `advanceToNextStage()` on completed game has no guard — re-triggers pot update**
- **Found by:** BR-04, QA-07 (2 agents, confirmed)
- **Summary:** No early return when `game_states.status === 'completed'`. Host can call `advanceToNextStage` on a finished game. It re-runs the full function, re-sets status to 'completed', and re-calls `updateSnowballPotOnGameEnd()` — triggering a second pot update.
- **Business Impact:** Combined with DL-01: in worst case, pot gets updated 3× for one game (recordWinner + advanceToNextStage normal flow + erroneous second advanceToNextStage call).
- **Affected Files:** `src/app/host/actions.ts` → `advanceToNextStage()`
- **Test Cases:** TC-E03

---

**[DL-06] `moveToNextGame*` partial failure — session pointer updated, old game not cleaned up**
- **Found by:** TA-07 (1 agent — confirmed by structural mapper's multi-step table)
- **Summary:** Both `moveToNextGameAfterWin()` and `moveToNextGameOnBreak()` write `sessions.active_game_id = newGameId` first, then mark old game_states as completed. If second write fails, session points to new game but old game state remains `in_progress`. Realtime subscribers still see old game as running.
- **Business Impact:** Display and player screens show conflicting states. Host sees new game, display may show old game still running.
- **Affected Files:** `src/app/host/actions.ts` → `moveToNextGameAfterWin()`, `moveToNextGameOnBreak()`
- **Test Cases:** TC-A02

---

**[DL-07] `sendHeartbeat()` doesn't verify sender is still controller — old host can reclaim**
- **Found by:** QA-09 (1 agent — plausible, medium confidence)
- **Summary:** `sendHeartbeat()` updates `controller_heartbeat_at` without verifying the sender's user ID matches `controller_id`. If Host A loses control to Host B, Host A's still-running tab can send heartbeats and keep resetting the timestamp — preventing Host B from confirming they have stable control.
- **Business Impact:** Two hosts fighting over control; game calling becomes unpredictable.
- **Affected Files:** `src/app/host/actions.ts` → `sendHeartbeat()`
- **Test Cases:** TC-H02

---

**[DL-08] `updateSnowballPotOnGameEnd()` errors silently swallowed — pot state wrong with no indication**
- **Found by:** TA-09 (1 agent — confirmed by code pattern)
- **Summary:** Function returns `void`. All errors caught with `console.error` only. Callers (`recordWinner`, `advanceToNextStage`) do not check its success. If pot update fails, both callers return `{ success: true }` to the host UI.
- **Business Impact:** Host sees "success" but pot is wrong. No retry, no indication. Discovered next week when pot shows incorrect amount.
- **Affected Files:** `src/app/host/actions.ts` → `updateSnowballPotOnGameEnd()`
- **Test Cases:** TC-F01, TC-F02

---

**[DL-09] Zero input validation on host server actions**
- **Found by:** TA-06, BR-01, QA-05 (3 agents converge)
- **Summary:** No Zod validation on any host action. `winnerName` accepts empty string. `stage` accepts any string including values not in `WinStage` enum. `claimedNumbers` not checked to be positive integers in 1-90 range.
- **Business Impact:** Empty winner names in history/display. Invalid stage values cause incorrect display text. Negative call counts possible.
- **Affected Files:** `src/app/host/actions.ts` (all exported functions)
- **Test Cases:** TC-D07, TC-D08

---

**[DL-10] Test session guard missing from jackpot calculation in `recordWinner()`**
- **Found by:** BR-06 (1 agent — confirmed by code logic)
- **Summary:** `updateSnowballPotOnGameEnd()` correctly skips pot mutations for test sessions. But `recordWinner()` calculates `actualIsSnowballJackpot = true` and stores `snowball_jackpot_amount` in the winners table even for test sessions. Winner history shows test games won jackpots with real pot amounts.
- **Business Impact:** Admin history is polluted with fake jackpot wins. Could confuse pot accounting.
- **Affected Files:** `src/app/host/actions.ts` → `recordWinner()`
- **Test Cases:** TC-A05, TC-D06

---

### MEDIUM — Should exist, degrades experience or creates operational risk

---

**[DL-11] `display_winner_name` and win fields not cleared when stage advances**
- **Found by:** BR-10 (1 agent — confirmed)
- **Summary:** `advanceToNextStage()` does not reset `display_win_type`, `display_win_text`, or `display_winner_name` on game_states. TV display continues showing the previous stage's winner announcement while the host sets up the next stage.
- **Business Impact:** TV shows stale "LINE WINNER: Dave" during Two Lines stage. Confusing for audience.
- **Affected Files:** `src/app/host/actions.ts` → `advanceToNextStage()`
- **Test Cases:** TC-E01

---

**[DL-12] `snowball_eligible` checkbox has no default/warning when jackpot window is open**
- **Found by:** BR-03 (1 agent — confirmed by UI code)
- **Summary:** When the snowball jackpot window is open (calls ≤ max_calls), the host must remember to check the "snowball eligible" checkbox to award the jackpot. No default, no visual warning, no auto-check. If host forgets the checkbox, jackpot is silently skipped even though conditions are met.
- **Business Impact:** Jackpot not awarded when it should be. Player and venue lose out. No error — just wrong outcome.
- **Affected Files:** `src/app/host/[sessionId]/[gameId]/game-control.tsx` → snowball eligible checkbox
- **Test Cases:** TC-D03

---

**[DL-13] `getRequiredSelectionCountForStage()` uses fragile string matching**
- **Found by:** BR-07 (1 agent — confirmed)
- **Summary:** Uses `toLowerCase().includes('two')` and similar patterns to determine ticket count. Reliable for current stage names (Line, Two Lines, Full House) but fragile — any future stage rename or typo would silently return wrong count (falls back to 5).
- **Business Impact:** Wrong ticket count accepted for claim validation. Low current risk but a maintenance trap.
- **Affected Files:** `src/app/host/actions.ts` → `getRequiredSelectionCountForStage()`
- **Test Cases:** TC-C05, TC-C07

---

**[DL-14] Host game-control has no Realtime polling fallback**
- **Found by:** TA-15 (1 agent — confirmed)
- **Summary:** Player and display UIs have 5-second polling fallbacks. Host game-control relies purely on Realtime subscription for private `game_states`. If connection drops, host's displayed call count and state become stale — they may call numbers they think are fresh but the state is out of date.
- **Business Impact:** Host operating on stale state. Game called incorrectly until they refresh page.
- **Affected Files:** `src/app/host/[sessionId]/[gameId]/game-control.tsx`

---

**[DL-15] `validateClaim`/`toggleWinnerPrizeGiven` don't verify session/game ownership**
- **Found by:** TA-12 (1 agent — confirmed)
- **Summary:** Both use `authorizeHost` (any host/admin) without checking the session/game belongs to the caller's scope. A host assigned to one session could validate claims or toggle prizes for another session's game.
- **Business Impact:** Low exploitation risk in a single-venue app but violates separation of concern.
- **Affected Files:** `src/app/host/actions.ts` → `validateClaim()`, `toggleWinnerPrizeGiven()`

---

**[DL-16] 35+ `console.log`/`console.error` in production server-side code**
- **Found by:** TA-10 (1 agent — confirmed)
- **Summary:** Debug logging throughout `host/actions.ts`, `display-ui.tsx`, `game-control.tsx`. Includes session IDs, game state, winner names, and operation status. No structured logging or audit trail.
- **Business Impact:** Server logs polluted; PII (winner names) potentially exposed in log aggregation systems.
- **Affected Files:** `src/app/host/actions.ts`, `src/app/host/[sessionId]/[gameId]/game-control.tsx`, `src/app/display/[sessionId]/display-ui.tsx`

---

**[DL-17] JSON column `as` type assertions — no runtime validation**
- **Found by:** TA-11 (1 agent — confirmed)
- **Summary:** `stage_sequence as WinStage[]`, `calledNumbers as number[]`, `prizes as Record<string,string>` — all cast without `JSON.parse()` + Zod validation. Corrupt DB data produces silent type violations.
- **Affected Files:** `src/app/host/actions.ts` (multiple)

---

### LOW — Cleanup, minor polish, future-proofing

---

**[DL-18] `void` winner action missing from UI despite schema support**
- **Found by:** BR-09 — `is_void` and `void_reason` columns exist in `winners` table but no action to set them.
- **Affected Files:** No `voidWinner` action anywhere in codebase.

---

**[DL-19] `react-player` is a dead dependency**
- **Found by:** TA-13 — imported in package.json, not used in any active component.
- **Affected Files:** `package.json`

---

**[DL-20] `signup` action exists despite invite-only policy**
- **Found by:** TA-14 — `src/app/login/actions.ts` exports `signup`. PRD states invite-only. If a signup form exists in the UI, public registration is possible.
- **Affected Files:** `src/app/login/actions.ts`

---

## Summary

| Severity | Count |
|----------|-------|
| Critical | 4 |
| High | 6 |
| Medium | 7 |
| Low | 3 |
| **Total** | **20** |

**Highest immediate risk:** DL-01 (double pot update on every snowball game), DL-03 (no auth on session actions), DL-02 (non-atomic winner recording).
