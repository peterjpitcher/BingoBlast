# Business Rules Auditor Report — OJ-CashBingo

## [BR-01] SEVERITY: Critical
**Rule:** Winner name is required — every winner record must have a name.
**Reality:** `winners.winner_name` is `NOT NULL` in the DB schema, but `recordWinner()` server action performs no server-side trim/length check. Client UI has a text input but no enforced `required` validation before calling the server action. An empty string `""` would pass the DB `NOT NULL` constraint and create a nameless winner record.
**Location:** `src/app/host/actions.ts` → `recordWinner()`
**Impact:** Leaderboard shows blank winner names; admin history is meaningless.

---

## [BR-02] SEVERITY: High
**Rule:** Snowball jackpot display text must always show a valid pound amount, e.g. "FULL HOUSE + SNOWBALL £250!".
**Reality:** `snowballJackpotAmount` is computed from `snowball_pots.current_jackpot_amount` but if the pot lookup fails or returns null, `snowballJackpotAmount` remains `null`. The display text becomes: `"FULL HOUSE + SNOWBALL £null!"` (string interpolation of null).
**Location:** `src/app/host/actions.ts` → `recordWinner()` — `formatPounds(snowballJackpotAmount)` called where `snowballJackpotAmount` can be null.
**Impact:** TV display shows "£null" during jackpot win — unprofessional and confusing.

---

## [BR-03] SEVERITY: High
**Rule:** `is_snowball_jackpot` (jackpot won) and `is_snowball_eligible` (player attended the right week) are distinct concepts. Jackpot is won server-side based on call count. Eligibility is a host checkbox on the claim form.
**Reality:** Both fields exist on the `winners` table correctly. However, the host UI shows a single "snowball eligible" checkbox that gates BOTH: `snowballEligible` controls whether the jackpot is awarded at all, even if call count qualifies. This conflates attendance eligibility with jackpot win — a player who was eligible AND within the call window only wins if the host checks the box. If the host forgets to check it, the jackpot is missed silently.
**Location:** `src/app/host/[sessionId]/[gameId]/game-control.tsx` → snowball eligible checkbox; `src/app/host/actions.ts` → `recordWinner()`
**Impact:** Jackpot can be incorrectly skipped if host forgets checkbox, even when all conditions are met. No warning or default-checked behavior.

---

## [BR-04] SEVERITY: High
**Rule:** On advanceToNextStage reaching the final stage, game status must become 'completed' with no further progression possible.
**Reality:** Code correctly sets `newGameStatus = 'completed'` when `newStageIndex >= stageSequence.length`. However, there is no guard at function entry preventing `advanceToNextStage` from running on an already-completed game. On a completed game: it re-reads stage index (still at max), re-caps at max, re-sets status to 'completed', and re-calls `updateSnowballPotOnGameEnd()` — potentially double-rolling the pot.
**Location:** `src/app/host/actions.ts` → `advanceToNextStage()`
**Impact:** Double pot rollover on same game. Snowball pot incremented twice for one game end.

---

## [BR-05] SEVERITY: High
**Rule:** Jackpot games must be Full House only (single stage). Non-jackpot game behavior should not apply.
**Reality:** No server-side validation that `type = 'jackpot'` games have `stage_sequence = ['Full House']`. The admin UI shows a hint but doesn't enforce it. A jackpot game created with multi-stage sequence would attempt jackpot logic on Line/Two Lines stages.
**Location:** `src/app/admin/sessions/[id]/actions.ts` → `addGame()` / `editGame()`
**Impact:** Jackpot prize potentially shown on Line stage; jackpot logic runs at wrong stage.

---

## [BR-06] SEVERITY: Medium
**Rule:** Test sessions skip snowball pot updates. Snowball records in winners table should also not reflect real jackpot state for test games.
**Reality:** `is_test_session` is only checked inside `updateSnowballPotOnGameEnd()` (pot mutation skipped). But `recordWinner()` still calculates `actualIsSnowballJackpot = true` and `snowballJackpotAmount` from the live pot, then inserts these values into the `winners` table — even for test sessions. Winners from test sessions show jackpot amounts as if real.
**Location:** `src/app/host/actions.ts` → `recordWinner()` — no test session guard before jackpot calculation.
**Impact:** Test session winner history shows fake jackpot wins with real pot amounts. History view polluted.

---

## [BR-07] SEVERITY: Medium
**Rule:** Claim validation ticket count: Line=5, Two Lines=10, Full House=15. These counts must match exactly.
**Reality:** `getRequiredSelectionCountForStage()` uses string matching to determine count. Stage names are flexible (stored as enum `WinStage` but could vary). The function uses `toLowerCase().includes()` pattern matching. If a custom stage name is ever used or the stage_sequence JSON contains a variant, count falls back to 5 (line count), silently accepting wrong claim counts for other stages.
**Location:** `src/app/host/actions.ts` → `getRequiredSelectionCountForStage()`
**Impact:** Wrong ticket count validated; cheating opportunity or false rejections.

---

## [BR-08] SEVERITY: Medium
**Rule:** `updateSnowballPotOnGameEnd()` should only run once per game end.
**Reality:** Both `recordWinner()` AND `advanceToNextStage()` independently call `updateSnowballPotOnGameEnd(gameId)`. In the normal snowball game flow: host records winner (triggers pot update #1), then host calls advanceToNextStage (triggers pot update #2). The same game gets two pot updates.
**Location:** `src/app/host/actions.ts` — both `recordWinner()` and `advanceToNextStage()` call `updateSnowballPotOnGameEnd(gameId)`
**Impact:** Pot incremented twice per game if no jackpot; pot reset twice if jackpot (likely idempotent on second reset but wasteful and fragile).

---

## [BR-09] SEVERITY: Low
**Rule:** Void functionality should exist for mis-claimed or erroneous winners.
**Reality:** `winners` table has `is_void` and `void_reason` columns in the schema, but no server action to void a winner is visible in the reviewed code. The host/admin UI may lack the ability to void a winner record.
**Location:** `src/types/database.ts` → `winners.Row` has `is_void`, `void_reason` — but no `voidWinner` action found in `host/actions.ts` or `admin/actions.ts`.
**Impact:** Mis-claimed winners cannot be voided; admin must edit DB directly.

---

## [BR-10] SEVERITY: Low
**Rule:** `display_winner_name` on game_states shows the current winner's name on the TV display.
**Reality:** `display_winner_name` is set when `recordWinner()` announces the win. On `advanceToNextStage()`, it is NOT cleared. If a new stage begins (e.g., from Line to Two Lines), the previous winner's name may persist in `display_winner_name` until a new win is announced. Display continues showing last winner during the break/next stage.
**Location:** `src/app/host/actions.ts` → `advanceToNextStage()` — no reset of `display_win_type`, `display_win_text`, `display_winner_name`.
**Impact:** TV display shows stale win announcement at start of next stage until numbers resume.
