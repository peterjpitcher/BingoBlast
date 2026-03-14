# Technical Architect Report — OJ-CashBingo

## [TA-01] SEVERITY: Critical
**Category:** Transaction Safety
**Problem:** `recordWinner()` performs 3 sequential independent DB writes: (1) INSERT into winners, (2) UPDATE game_states display fields, (3) UPDATE snowball_pots via `updateSnowballPotOnGameEnd()`. No transaction wrapper. Each is a separate Supabase client call.
**Partial Failure Path:** Step 1 succeeds (winner recorded) → Step 2 fails → game_states display fields never updated → player/display shows no win announcement → snowball pot never touched. Winner exists in DB but game is visually stuck.
**Location:** `src/app/host/actions.ts` → `recordWinner()`
**Fix Direction:** Extract into a Supabase RPC (PL/pgSQL function) that performs all writes atomically, or use a PostgreSQL transaction via a single RPC call.

---

## [TA-02] SEVERITY: Critical
**Category:** Transaction Safety
**Problem:** `advanceToNextStage()` updates `game_states` first, then calls `updateSnowballPotOnGameEnd()` as a separate async call. If the pot update fails (network, constraint), game is marked completed but pot is not rolled over/reset.
**Partial Failure Path:** `game_states.status = 'completed'` committed → `updateSnowballPotOnGameEnd()` fails silently (errors are `console.error` only, not returned) → snowball pot unchanged → next week's game starts with wrong pot values.
**Location:** `src/app/host/actions.ts` → `advanceToNextStage()`
**Fix Direction:** Return/throw error from `updateSnowballPotOnGameEnd()` and surface it to the caller; consider combining into single RPC.

---

## [TA-03] SEVERITY: High
**Category:** Race Condition
**Problem:** `callNextNumber()` reads `number_sequence[numbers_called_count]` then writes `numbers_called_count + 1` in two separate operations. Two concurrent calls from different tabs/hosts can read the same index before either write completes.
**Partial Failure Path:** Host A and Host B both call concurrently with `numbers_called_count = 45`. Both read number at index 45. Both increment to 46. Same number called twice; both commits succeed. `called_numbers` array contains a duplicate.
**Location:** `src/app/host/actions.ts` → `callNextNumber()`
**Fix Direction:** Move fetch-and-increment into a single atomic PL/pgSQL function (advisory lock or `UPDATE ... RETURNING` pattern).

---

## [TA-04] SEVERITY: High
**Category:** Race Condition
**Problem:** `takeControl()` reads current `controller_heartbeat_at`, checks if expired, then writes new `controller_id`. Read and write are separate operations. Two hosts can both pass the expiry check before either write completes.
**Partial Failure Path:** Both hosts pass the "is controller expired?" check. Both write their `controller_id`. Last write wins in DB, but first host proceeds believing they have control. `requireController()` on first host's next action will fail with confusing "not controller" error.
**Location:** `src/app/host/actions.ts` → `takeControl()`
**Fix Direction:** Use `UPDATE game_states SET controller_id = $newHost WHERE controller_id = $oldHost OR controller_heartbeat_at < $expiry` (conditional update) and check `rowsAffected = 1`.

---

## [TA-05] SEVERITY: High
**Category:** Trigger Reliability
**Problem:** All player/display updates depend on the `sync_game_states_public()` trigger. If the trigger fails (column type mismatch after migration, PL/pgSQL exception), `game_states` updates successfully but `game_states_public` is never updated. No application-layer error or retry.
**Partial Failure Path:** Host calls a number → `game_states.called_numbers` updated → trigger throws → `game_states_public` unchanged → player sees stale numbers forever. Host sees the new number (reads private table); players don't. No error shown to anyone.
**Location:** `supabase/migrations/20251221101438_add_game_states_public.sql` → `sync_game_states_public()`
**Fix Direction:** Add trigger EXCEPTION handler that logs to an error table; add application-level check by reading `game_states_public` after critical updates and alerting if out of sync.

---

## [TA-06] SEVERITY: High
**Category:** Input Validation
**Problem:** Zero Zod validation on any host server action inputs. `gameId`, `sessionId`, `winnerName`, `claimedNumbers`, `callCountAtWin`, `stage` — all accepted as-is. Supabase parameterised queries prevent SQL injection, but business logic accepts any value including empty strings, negative numbers, invalid UUIDs.
**Partial Failure Path:** `winnerName = ""` → winner recorded with blank name. `stage = "invalid"` → switch statement falls through to default displayWinText → incorrect display state. `callCountAtWin = -999` → invalid winner record.
**Location:** `src/app/host/actions.ts` (all exported functions)
**Fix Direction:** Add Zod schemas at the top of each exported action; validate before any DB read/write.

---

## [TA-07] SEVERITY: High
**Category:** Transaction Safety
**Problem:** `moveToNextGameAfterWin()` writes to `sessions.active_game_id` first, then separately updates `game_states` for the old game (marks it completed). If second write fails, session points to new game but old game_state not cleaned up. `moveToNextGameOnBreak()` same pattern.
**Partial Failure Path:** `sessions.active_game_id = newGameId` committed → `game_states.status = 'completed'` for old game fails → old game state remains `in_progress` → display/player subscribed to old game's channel still see it as running.
**Location:** `src/app/host/actions.ts` → `moveToNextGameAfterWin()`, `moveToNextGameOnBreak()`
**Fix Direction:** Wrap both writes in RPC or reorder (mark old game completed first, then update session pointer).

---

## [TA-08] SEVERITY: Medium
**Category:** Auth Gap
**Problem:** `updateSnowballPotOnGameEnd()` is an internal function that calls `createSupabaseClient()` (service-role) internally rather than receiving the authed client from its caller. This bypasses RLS for pot reads/writes. Worse: `requireController()` is not called on it — it's callable from any context that imports host actions.
**Partial Failure Path:** Not directly exploitable from client, but the service-role pattern inside a server action creates maintenance risk — anyone extending this function could inadvertently expose admin operations.
**Location:** `src/app/host/actions.ts` → `updateSnowballPotOnGameEnd()` (uses `createClient as createSupabaseClient`)
**Fix Direction:** Pass `supabase` client down from caller; avoid creating fresh client instances inside internal functions.

---

## [TA-09] SEVERITY: Medium
**Category:** Error Handling
**Problem:** `updateSnowballPotOnGameEnd()` has multiple `console.error()` calls but returns `void` — errors are silently swallowed. Its callers (`recordWinner`, `advanceToNextStage`) do not check its result.
**Partial Failure Path:** Pot reset/rollover fails → `console.error` logged → caller continues returning `{ success: true }` to host UI → host sees success but pot is wrong.
**Location:** `src/app/host/actions.ts` → `updateSnowballPotOnGameEnd()`
**Fix Direction:** Change return type to `Promise<{ success: boolean; error?: string }>` and propagate errors to callers.

---

## [TA-10] SEVERITY: Medium
**Category:** Code Quality
**Problem:** 35+ `console.log()` / `console.error()` calls in production server-side code. `console.log("Test session: Snowball pot updates skipped.")`, `console.log("Switching to new game: ...")`, etc. These log to Vercel function logs, polluting monitoring and potentially leaking session/game IDs.
**Location:** `src/app/host/actions.ts`, `src/app/display/[sessionId]/display-ui.tsx`, `src/app/host/[sessionId]/[gameId]/game-control.tsx`
**Fix Direction:** Remove debug console.logs; replace console.error calls with structured error returns or audit events.

---

## [TA-11] SEVERITY: Medium
**Category:** Type Safety
**Problem:** JSON DB columns cast with `as` assertions without runtime validation: `gameDetails.stage_sequence as WinStage[]`, `calledNumbers as number[]`, `game.prizes as Record<string, string>`. If DB data is corrupted or has unexpected shape, code silently proceeds with wrong types.
**Location:** `src/app/host/actions.ts` (multiple locations)
**Fix Direction:** Parse JSON columns with Zod schemas at DB read time rather than `as` assertions.

---

## [TA-12] SEVERITY: Medium
**Category:** Auth Gap
**Problem:** `validateClaim()` uses `authorizeHost` (any host/admin can validate any game). `toggleWinnerPrizeGiven()` also uses `authorizeHost`. Neither checks that the host is associated with the specific session/game. A host assigned to Session A could validate claims for Session B.
**Location:** `src/app/host/actions.ts` → `validateClaim()`, `toggleWinnerPrizeGiven()`
**Fix Direction:** Add session/game ownership check or require `requireController` for validation actions.

---

## [TA-13] SEVERITY: Low
**Category:** Code Quality
**Problem:** `react-player` imported as dependency (package.json) but not used in any active component. Dead dependency adds bundle weight.
**Location:** `package.json`
**Fix Direction:** Remove `react-player` from dependencies.

---

## [TA-14] SEVERITY: Low
**Category:** Code Quality
**Problem:** `signup` action exists in `src/app/login/actions.ts` but per the PRD sign-up is invite-only/admin-only. If `/login` page exposes a signup form, it creates an unintended public registration pathway.
**Location:** `src/app/login/actions.ts` → `signup()`
**Fix Direction:** Verify no public signup UI exists; if signup is admin-only, move action to admin actions and remove from login page.

---

## [TA-15] SEVERITY: Low
**Category:** Real-time Reliability
**Problem:** `game-control.tsx` (host UI) has no polling fallback for its private `game_states` Realtime subscription. If the Realtime connection drops, the host's displayed call count and game state become stale. Player/display have 5-second polling fallbacks; host does not.
**Location:** `src/app/host/[sessionId]/[gameId]/game-control.tsx`
**Fix Direction:** Add equivalent polling fallback (5-10 second interval) to refresh `game_states` for the host view.
