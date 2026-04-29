# OJ-CashBingo - Code-Reviewed Remediation Spec

**Date:** 2026-04-29  
**Project:** OJ-CashBingo / Anchor Bingo  
**Base commit reviewed:** `47e7752`  
**Purpose:** Implementation-ready defect spec for the next developer. This document supersedes older Phase 1 remediation notes.

## 1. Product Boundary

This repository is a 90-ball pub bingo control system. It is not the generic BingoBlast digital-ticket app described in some project guidance.

Do not implement 75-ball cards, player card marking, player scoreboards, online payment flows, or QR/game-code join mechanics as part of this remediation. The existing public `/player/[sessionId]` route is a follower screen, not a playable bingo ticket.

Primary routes in the current code:

| Route | Current purpose |
|---|---|
| `/admin` | Admin session/game/snowball setup |
| `/admin/sessions/[id]` | Session game configuration and history |
| `/host/[sessionId]/[gameId]` | Live host controller |
| `/display/[sessionId]` | TV display |
| `/player/[sessionId]` | Public mobile follower screen |
| `/api/setup` | SETUP_SECRET-protected admin promotion endpoint |

## 2. Critique Of Previous Spec

The previous spec correctly identified four real issues: player has no polling fallback, display polling is too slow, `/api/setup` uses direct string comparison, and `recordWinner` does not prove the requested stage matches the live stage.

It was incomplete in these ways:

1. It told the implementer to copy a "do not regress called numbers" guard into player polling. That is wrong for this codebase because `voidLastNumber()` intentionally decreases `numbers_called_count`.
2. It missed that the host already has this bad monotonic guard, so the host UI can fail to reflect a successful void.
3. It only mentioned `recordWinner`, but `announceWin` can also display the wrong stage if called with stale/tampered client state.
4. It did not say player/display polling must refresh both `sessions.active_game_id/status` and `game_states_public`; without session polling, missed active-game changes remain missed.
5. It did not specify prize-text refresh on polling. If Realtime misses a stage advance, `currentPrizeText` can remain stale even when `currentGameState` catches up.
6. It left too much room around the secret comparison implementation. Use fixed-length digests with `timingSafeEqual` so there is no Buffer length exception path.

## 3. Current Code Facts

These facts were checked against the code at `47e7752`.

| Fact | Evidence |
|---|---|
| Host has 3s polling fallback | `src/app/host/[sessionId]/[gameId]/game-control.tsx`, lines 431-451 |
| Host rejects lower call counts | `game-control.tsx`, lines 396-400 and 443-447 |
| Player has Realtime only, no polling fallback | `src/app/player/[sessionId]/player-ui.tsx`, lines 91-164 |
| Display has polling fallback, but 10s | `src/app/display/[sessionId]/display-ui.tsx`, lines 138-168 |
| Display/player state reads public table | `game_states_public` via `src/types/database.ts`, lines 230-291 |
| `voidLastNumber` decreases count | `src/app/host/actions.ts`, lines 1347-1354 |
| `/api/setup` compares strings directly | `src/app/api/setup/route.ts`, lines 27-29 |
| `recordWinner` validates enum but not live stage | `src/app/host/actions.ts`, lines 1076-1083 |
| `announceWin` accepts a stage and does not validate it against live state | `src/app/host/actions.ts`, lines 946-995 |

## 4. Required Fixes

Implement all five fixes below in one PR. No database migration is required.

### Fix A - Make Client State Reconciliation Void-Safe

**Severity:** Critical operational bug  
**File:** `src/app/host/[sessionId]/[gameId]/game-control.tsx`

The current host Realtime and polling guards reject any lower `numbers_called_count`. That blocks legitimate state after `voidLastNumber()`.

Required changes:

1. Replace the Realtime state update at lines 396-400 with direct application of the DB snapshot:

```ts
setCurrentGameState(payload.new);
```

2. Replace the polling state update at lines 441-447 with direct application of the fresh DB snapshot:

```ts
setCurrentGameState(freshState);
```

3. Do not add a new monotonic `numbers_called_count` guard anywhere in host, display, or player code.

Reasoning: there is no `state_version` column and `updated_at` is not maintained by an update trigger, so the current code has no reliable monotonic freshness marker. Count-only freshness is invalid because voiding is a first-class feature. If stronger anti-stale ordering is needed later, add a `state_version` migration in a separate PR.

Acceptance criteria:

- Call two numbers on the host.
- Click "void last number".
- Within one Realtime event or one 3s poll, host shows the previous number and `numbers_called_count` is decremented by 1.
- The Next Number button still calls according to the server's current `numbers_called_count`, not the stale pre-void count.

### Fix B - Add Player Polling Fallback

**Severity:** Critical for pub WiFi reliability  
**File:** `src/app/player/[sessionId]/player-ui.tsx`

Player currently relies only on Supabase Realtime. Add a polling fallback equivalent to display/host, but void-safe.

Required behavior:

1. Add a constant near the type definitions:

```ts
const POLL_INTERVAL_MS = 3000;
```

2. Add a `useEffect` after the existing session/game-state Realtime effect.

3. The effect must:
   - Poll only when `document.visibilityState === 'visible'`.
   - Run once immediately on mount.
   - Run every 3 seconds while mounted.
   - Add a `visibilitychange` listener that polls immediately when the tab becomes visible again.
   - Clean up the interval and event listener on unmount.

4. Each poll must fetch the full current session row from `sessions`:

```ts
.from('sessions')
.select('*')
.eq('id', session.id)
.single<Session>()
```

5. If a fresh session row is returned:
   - Call `setCurrentSession(freshSession)`.
   - If `freshSession.active_game_id !== currentActiveGame?.id`, call `await refreshActiveGame(freshSession.active_game_id)` and stop that poll.
   - Else, if `currentActiveGame?.id` exists, fetch `game_states_public` for that game and apply it directly with `setCurrentGameState(freshState)`.
   - After applying `freshState`, update `currentPrizeText` from `currentActiveGame.prizes` and `currentActiveGame.stage_sequence[freshState.current_stage_index]`.

6. Do not reject fresh rows just because `freshState.numbers_called_count` is lower than the current local count. A lower count is valid after `voidLastNumber()`.

Implementation notes:

- Use a local `cancelled` boolean in the effect to avoid setting state after unmount if an async poll returns late.
- Dependencies should include `session.id`, `currentActiveGame?.id`, `currentActiveGame?.prizes`, `currentActiveGame?.stage_sequence`, and `refreshActiveGame`.
- Do not introduce user-visible error UI for transient poll failures in this PR. Failed polls can be ignored; the next poll should retry.

Acceptance criteria:

- With player open, block or interrupt Realtime/network for 5 seconds, call at least one number from host, restore network, and confirm player catches up within 3 seconds without refresh.
- Start a different game in the same session while player Realtime is interrupted. Player must switch to the new active game after polling resumes.
- Void the last number. Player must show the decremented count and previous current number.
- Stage advance without Realtime must update both stage and prize text.

### Fix C - Tighten Display Polling Fallback

**Severity:** High visibility issue  
**File:** `src/app/display/[sessionId]/display-ui.tsx`

Display has polling but waits up to 10 seconds. It also does not refresh `currentSession` or `currentPrizeText` during polling.

Required changes:

1. Add or reuse the same constant:

```ts
const POLL_INTERVAL_MS = 3000;
```

2. Change the interval from `10000` to `POLL_INTERVAL_MS`.

3. As with player, the polling effect must:
   - Poll only when the tab is visible.
   - Run immediately on mount.
   - Poll every 3 seconds.
   - Poll immediately on `visibilitychange` back to visible.
   - Clean up on unmount.

4. Fetch the full session row (`select('*')`) rather than only `active_game_id,status`, then:
   - `setCurrentSession(freshSession)`.
   - `setIsWaitingState(!freshSession.active_game_id && freshSession.status !== 'running')`.
   - If active game changed, call `await refreshActiveGame(freshSession.active_game_id)`.
   - Else fetch `game_states_public` for the current game and apply it directly.
   - After applying `freshState`, update `currentPrizeText` from the current game and stage index.

5. Do not add a monotonic count guard; display must reflect voids.

Acceptance criteria:

- If Realtime drops, display catches up within 3 seconds.
- If a session completes while Realtime is missed, display reflects completed service state after polling.
- If stage advances while Realtime is missed, display stage and prize both update after polling.
- If the last number is voided, display shows the previous current number and decremented count.

### Fix D - Constant-Time Setup Secret Check

**Severity:** Medium defensive hardening  
**File:** `src/app/api/setup/route.ts`

Replace direct string comparison with a helper based on fixed-length SHA-256 digests and `timingSafeEqual`.

Required implementation:

```ts
import { createHash, timingSafeEqual } from 'node:crypto'

function isSetupSecretValid(providedSecret: string | null, setupSecret: string): boolean {
  const providedDigest = createHash('sha256')
    .update(providedSecret ?? '', 'utf8')
    .digest()
  const expectedDigest = createHash('sha256')
    .update(setupSecret, 'utf8')
    .digest()

  return timingSafeEqual(providedDigest, expectedDigest)
}
```

Then replace:

```ts
if (!providedSecret || providedSecret !== setupSecret) {
```

with:

```ts
if (!isSetupSecretValid(providedSecret, setupSecret)) {
```

Do not return a different error for missing, wrong-length, or wrong-value secrets. All invalid secrets must return the existing `401` response.

Acceptance criteria:

- Missing `SETUP_SECRET` still returns `404`.
- Missing `x-setup-secret` returns `401`.
- Incorrect secret returns `401`.
- Correct secret proceeds to JSON body parsing exactly as before.

### Fix E - Validate Live Stage Before Announcing Or Recording Winners

**Severity:** Medium integrity issue  
**File:** `src/app/host/actions.ts`

`recordWinner` and `announceWin` must reject stale/tampered stage inputs. The server must derive the current stage from `games.stage_sequence[game_states.current_stage_index]`.

#### Shared validation behavior

For both `announceWin(gameId, stage)` and `recordWinner(sessionId, gameId, stage, ...)`, fetch:

- `game_states`: `numbers_called_count`, `current_stage_index`, `status`
- `games`: `session_id`, `type`, `snowball_pot_id`, `stage_sequence`

Validation rules:

1. If either row is missing, return `{ success: false, error: "Game state not found." }` or `{ success: false, error: "Game details not found." }`.
2. If `game_states.status !== 'in_progress'`, reject with `"Cannot record or announce a winner unless the game is in progress."` Adjust wording per function if needed.
3. Resolve `expectedStage = game.stage_sequence[gameState.current_stage_index]`.
4. If `expectedStage` is missing, reject with `"Current stage is not configured for this game."`.
5. For normal stages, require `stage === expectedStage`.
6. For `announceWin(..., 'snowball')`, allow it only when `game.type === 'snowball'` and `expectedStage === 'Full House'`.
7. For `recordWinner`, also require `game.session_id === sessionId`; reject mismatches with `"Game does not belong to this session."`.

#### `recordWinner` specifics

Required changes inside `recordWinner`:

1. Keep the existing `winnerName` and enum validation.
2. Use the live `gameState.numbers_called_count` as `resolvedCallCountAtWin`; ignore the client-supplied `callCountAtWin` except as a backwards-compatible parameter.
3. Reuse the fetched `game` row for snowball calculation instead of fetching `games` a second time.
4. Insert `winner_name: winnerName.trim()` rather than the raw string.
5. Preserve test-session behavior: if `is_test_session` is true, never set `actualIsSnowballJackpot`.
6. Preserve manual snowball award behavior, but only when the live current stage is `Full House` in a snowball game.

#### `announceWin` specifics

Add the same live-stage validation before calculating `displayWinType` and writing `game_states`.

Acceptance criteria:

- A stale client cannot announce or record a `Line` winner while the live stage is `Two Lines`.
- A stale client cannot record a winner for a `gameId` using a different `sessionId`.
- Manual snowball award still works during a snowball game's live `Full House` stage.
- Normal Line, Two Lines, and Full House winner flows still work from the host UI.

## 5. Verification Required Before Handoff

Run:

```bash
npm run lint
npm test
npm run build
```

Manual smoke tests:

1. Host/display/player happy path: start a session game, call 3 numbers, confirm all three surfaces update.
2. Player polling: interrupt player network/Realtime, call a number, restore, confirm catch-up within 3 seconds.
3. Display polling: interrupt display network/Realtime, call a number, restore, confirm catch-up within 3 seconds.
4. Void path: call two numbers, void the last, confirm host/display/player all show the previous number and decremented count.
5. Stage/prize polling: with display/player Realtime interrupted, record a Line winner and advance to Two Lines. On reconnect/poll, both stage and prize text must update.
6. Stage tampering guard: directly call or temporarily instrument `recordWinner`/`announceWin` with a wrong stage for the live game and confirm it rejects without DB writes.
7. `/api/setup`: verify missing, wrong, and correct secrets return the expected statuses.

If any command cannot run because local environment variables are missing, record that explicitly in the PR notes and still run `npm run lint` and `npm test`.

## 6. Explicit Non-Goals For This PR

Do not include these in the same PR unless separately requested:

1. PL/pgSQL transaction/RPC for `recordWinner`, `advanceToNextStage`, or move-to-next-game transitions.
2. `state_version` or `updated_at` trigger migration.
3. Cryptographic shuffle replacement for `Math.random()`.
4. Unique winner constraints.
5. Zod validation for every JSON column.
6. Timezone/date formatting cleanup.
7. Audit-log table for host actions.
8. Player digital tickets or card marking.

## 7. Post-PR Follow-Up List

These are real but outside this remediation:

1. Add a `state_version bigint not null default 0` column to `game_states` and increment it in every state-changing action, then use it for stale Realtime rejection.
2. Move winner insert + game state update into a Supabase RPC transaction.
3. Add a partial uniqueness or idempotency strategy for accidental duplicate winners.
4. Add Zod schemas for `stage_sequence`, `prizes`, `called_numbers`, and `number_sequence`.
5. Add structured audit logging for start/call/void/validate/record/advance/end actions.
