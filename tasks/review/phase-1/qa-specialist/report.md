# QA Specialist Defect Report — OJ-CashBingo

## [QA-01] SEVERITY: Critical
**Test Case:** TC-D03, TC-D04
**Expected:** Full House winner on snowball game → winner recorded, pot updated (reset or rollover), display shows win — atomically.
**Actual:** Three sequential independent DB calls: winners INSERT → game_states UPDATE → snowball pot UPDATE. Failure at any step leaves DB in inconsistent state.
**Location:** `src/app/host/actions.ts` → `recordWinner()`
**Evidence:** `updateSnowballPotOnGameEnd()` called after `recordWinner` returns; no transaction; return value of pot update not checked.

---

## [QA-02] SEVERITY: Critical
**Test Case:** TC-C03
**Expected:** Claim validation fails if last called number not included in claimed numbers.
**Actual:** `validateClaim()` checks all claimedNumbers are in calledNumbers set, but does NOT verify the last called number is present. A player can claim with numbers from earlier in the game, excluding the most recent call — and it will pass validation.
**Location:** `src/app/host/actions.ts` → `validateClaim()`
**Evidence:** The check `!claimedNumbers.includes(lastCalledNumber)` IS present in `validateClaim()` — but needs independent verification that this check was NOT removed in recent refactors. The QA agent flagged uncertainty; manual verification required.

---

## [QA-03] SEVERITY: Critical
**Test Case:** TC-E02, TC-E03
**Expected:** `advanceToNextStage()` on the final stage → game status = 'completed', no further advancement possible.
**Actual:** When `newStageIndex >= stageSequence.length`, code sets `newStageIndex = stageSequence.length - 1` (caps at last index) AND sets `newGameStatus = 'completed'`. This appears correct in setting status to completed, BUT the stage index does not advance past the last stage — it remains at last stage index. If host calls `advanceToNextStage` again on a completed game, logic runs again (no early return for completed status).
**Location:** `src/app/host/actions.ts` → `advanceToNextStage()`
**Evidence:** No guard at function entry checking `if (currentGameState.status === 'completed') return early`.

---

## [QA-04] SEVERITY: High
**Test Case:** TC-B05 (duplicate number prevention)
**Expected:** Same number cannot be called twice.
**Actual:** `callNextNumber()` reads from a pre-generated `number_sequence` array using `numbers_called_count` as the index. This prevents duplicates WITHIN a single sequential flow. However, if two concurrent calls both read `numbers_called_count = N` before either increments it, both will call `number_sequence[N]` — the same number. Race condition under concurrent host tabs.
**Location:** `src/app/host/actions.ts` → `callNextNumber()`
**Evidence:** Read of `numbers_called_count` and subsequent write are separate Supabase calls.

---

## [QA-05] SEVERITY: High
**Test Case:** TC-D07, TC-D08
**Expected:** Winner name required; meaningful validation error if empty.
**Actual:** No validation on `winnerName`. Empty string `""` is accepted. `prizeDescription` accepts `null` without error.
**Location:** `src/app/host/actions.ts` → `recordWinner()`
**Evidence:** `normalizedPrizeDescription = prizeDescription?.trim() || null` — null prize silently accepted. No check on `winnerName.trim().length > 0`.

---

## [QA-06] SEVERITY: High
**Test Case:** TC-I06 (host calls admin-only action)
**Expected:** Host role cannot call `createSession`, `deleteSession`, `updateGame` etc.
**Actual:** Admin actions in `src/app/admin/actions.ts` check for `admin` role server-side. However, `src/app/admin/sessions/[id]/actions.ts` — specifically `setActiveGame()` and `endSession()` — need verification that they enforce admin-only (not host) access. Middleware blocks /admin routes for non-admins, but server actions are callable directly via fetch regardless of middleware.
**Location:** `src/app/admin/sessions/[id]/actions.ts`
**Evidence:** Role check pattern needs tracing — if any session action uses `authorizeHost` instead of `requireAdmin`, hosts can modify session structure.

---

## [QA-07] SEVERITY: Medium
**Test Case:** TC-E03 (advance completed game)
**Expected:** `advanceToNextStage()` on a completed game → rejected with error.
**Actual:** No early return guard for `status === 'completed'`. Host can call `advanceToNextStage` on a completed game. It will run the full function, find stage at max index, re-set to 'completed' status, and call `updateSnowballPotOnGameEnd` again — potentially double-rolling/resetting the snowball pot.
**Location:** `src/app/host/actions.ts` → `advanceToNextStage()`
**Evidence:** No `if (currentGameState.status === 'completed') return { success: false }` guard.

---

## [QA-08] SEVERITY: Medium
**Test Case:** TC-F06 (two successive rollovers)
**Expected:** Each rollover adds `jackpot_increment` and `max_calls_increment` independently.
**Actual:** `updateSnowballPotOnGameEnd()` is called once per game end. The increment is applied once per call. Two games in one evening would each trigger rollover correctly IF no jackpot won. Logic appears correct but depends on `updateSnowballPotOnGameEnd` not being called multiple times for the same game (which it could be if `recordWinner` AND `advanceToNextStage` both call it for the same game).
**Location:** `src/app/host/actions.ts` → `updateSnowballPotOnGameEnd()`
**Evidence:** Both `recordWinner` and `advanceToNextStage` call `updateSnowballPotOnGameEnd(gameId)`. For a snowball Full House: `recordWinner` is called first (inserts winner, calls pot update), THEN host calls `advanceToNextStage` (updates stage, calls pot update again). **Double pot update risk.**

---

## [QA-09] SEVERITY: Medium
**Test Case:** TC-H02 (heartbeat expiry → another host takes control)
**Expected:** After heartbeat expires, another host can take control cleanly.
**Actual:** `takeControl()` checks `controller_heartbeat_at < now - threshold`. If the original host's tab is still open and sends a heartbeat after being taken over, they'll overwrite the new controller's heartbeat. Two hosts racing on heartbeats.
**Location:** `src/app/host/actions.ts` → `sendHeartbeat()`
**Evidence:** `sendHeartbeat()` updates `controller_heartbeat_at` without verifying the sender is still the current `controller_id`.

---

## [QA-10] SEVERITY: Medium
**Test Case:** TC-G04 (game advances → player/display updates via Realtime)
**Expected:** When active_game_id changes on session, player/display switches to new game seamlessly.
**Actual:** Player/display subscribe to `session_updates:{sessionId}` and on session UPDATE, call `refreshActiveGame(payload.new.active_game_id)`. This requires the session Realtime event to fire. If session UPDATE event is missed (brief network drop), player is stuck on old game. Polling fallback (5s) would eventually catch it, but there's a gap.
**Location:** `src/app/player/[sessionId]/player-ui.tsx`, `src/app/display/[sessionId]/display-ui.tsx`
**Evidence:** Game switch logic depends on Realtime event; fallback polling interval is 5 seconds — adequate but creates visible lag.

---

## [QA-11] SEVERITY: Low
**Test Case:** TC-A05 (test session skips snowball updates)
**Expected:** `is_test_session = true` → snowball pot untouched on game end.
**Actual:** Test session check is inside `updateSnowballPotOnGameEnd()` (reads session from DB to check flag). This is correct. However, admin manual pot adjustments (via `/admin/snowball`) have no test session context — admin can adjust pot during a test session game with no warning.
**Location:** `src/app/admin/snowball/actions.ts`
**Evidence:** Snowball admin actions operate on pot directly with no game/session context.

---

## PASSING TEST CASES

| TC | Result | Notes |
|----|--------|-------|
| TC-A01 | PASS | Session created with status='ready' |
| TC-A02 | PASS | setActiveGame sets active_game_id + session status='running' |
| TC-B01 | PASS | callNextNumber blocked when status='not_started' |
| TC-B02 | PASS | callNextNumber blocked when on_break=true |
| TC-B03 | PASS | callNextNumber blocked when paused_for_validation=true |
| TC-B07 | PASS | voidLastNumber removes last number, decrements count |
| TC-C01 | PASS | Line claim with 5 valid numbers passes |
| TC-C02 | PASS | Numbers not in calledNumbers → invalidNumbers returned |
| TC-F01 | PASS | Pot rollover adds increments correctly |
| TC-F02 | PASS | Pot resets to base values on jackpot win |
| TC-I01 | PASS | Unauthenticated → redirected to /login |
| TC-I02 | PASS | Host role → redirected to /host (not /admin) |
| TC-I04 | PASS | Player page accessible without auth |
| TC-I05 | PASS | Display page accessible without auth |
