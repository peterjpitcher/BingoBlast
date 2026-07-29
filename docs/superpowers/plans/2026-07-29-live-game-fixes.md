# Implementation plan: live game fixes

Spec: `docs/superpowers/specs/2026-07-29-live-game-fixes-design.md` (v2)
Review: `docs/superpowers/reviews/2026-07-29-live-game-fixes-design-review.md`
Branch: `fix/live-game-host-and-public-screens`
Target: merged to `main`, pushed, migrations applied to Supabase

## Work streams and file ownership

Streams are grouped by **file ownership** so parallel work never touches the same file. Order matters only where stated.

| Stream | Owns these files | Depends on |
|--------|------------------|-----------|
| **S1 shared libs** | `src/lib/reveal-queue.ts`, `src/lib/call-timing.ts`, `src/lib/number-nicknames.ts`, `src/lib/house-rules.ts`, `src/lib/log-action-failure.ts`, all four new `*.test.ts`, `src/types/actions.ts`, `src/components/ui/bingo-ball.tsx` | nothing. **Runs first** |
| **S2 database** | the three files in `supabase/migrations/`, `docs/superpowers/plans/2026-07-29-rollback.sql` | nothing. Runs alongside S1 |
| **S3 server actions** | `src/app/host/actions.ts`, `src/app/admin/sessions/[id]/actions.ts`, `src/types/database.ts` | S1 (types), S2 (function signatures) |
| **S4 host UI** | `src/app/host/[sessionId]/[gameId]/game-control.tsx`, `src/components/host/pre-game-briefing.tsx`, `src/hooks/use-connection-health.ts` | S1, and the S3 signatures listed in section 3 below |
| **S5 public UI** | `src/app/display/[sessionId]/display-ui.tsx`, `src/app/display/[sessionId]/page.tsx`, `src/app/player/[sessionId]/player-ui.tsx`, `src/app/player/[sessionId]/page.tsx` | S1 |
| **S6 docs** | `CLAUDE.md`, `AGENTS.md`, `docs/architecture/data-model.md`, `docs/architecture/server-actions.md`, `docs/architecture/overview.md` | nothing |

Run order: **S1 + S2 + S6 in parallel**, then **S3**, then **S4 + S5 in parallel**.

---

## 1. S1: shared libraries and types

### T1.1 `src/lib/call-timing.ts` (new)

```ts
/**
 * Timing constants for the call pipeline.
 *
 * The host gap and the public reveal delay are DIFFERENT things and must never
 * be conflated again:
 *   - HOST_MIN_CALL_GAP_MS is a server-side anti-double-tap window only.
 *   - call_delay_seconds (per game_states row) is how long the public surfaces
 *     wait before revealing a ball. It is NOT a host gap.
 */
export const HOST_MIN_CALL_GAP_MS = 400;
export const DEFAULT_PUBLIC_CALL_DELAY_SECONDS = 3;
/** Minimum time a backlogged ball stays on screen before the next one. */
export const PUBLIC_MIN_DWELL_MS = 1200;
```

Test `call-timing.test.ts`: assert the three values, so a silent change trips a test.

### T1.2 `src/lib/reveal-queue.ts` (new, pure)

```ts
export interface RevealPlanInput {
  serverCount: number;        // called_numbers.length from the server
  revealedCount: number;      // how many this client currently shows
  lastCallAtMs: number | null;// server timestamp of the newest call
  publicDelayMs: number;
  minDwellMs: number;
  lastRevealAtMs: number | null;
  snapImmediately: boolean;   // paused_for_validation or status === 'completed'
  nowMs: number;
}
export interface RevealPlan {
  revealCount: number;            // how many balls the client should show now
  nextTickInMs: number | null;    // when to re-evaluate, null when caught up
}
export function planReveal(input: RevealPlanInput): RevealPlan;
```

Rules, applied in this order:

1. `serverCount < revealedCount` → `{ revealCount: serverCount, nextTickInMs: null }` (undo snap-down).
2. `snapImmediately` → `{ revealCount: serverCount, nextTickInMs: null }`.
3. `serverCount === revealedCount` → `{ revealCount: revealedCount, nextTickInMs: null }`.
4. Backlog (`serverCount - revealedCount > 1`): the next ball is not the newest, so gate on dwell only.
   `waitMs = max(0, minDwellMs - (nowMs - (lastRevealAtMs ?? 0)))`.
   If `waitMs === 0` → reveal one more (`revealedCount + 1`) and `nextTickInMs = minDwellMs`.
   Else → `{ revealCount: revealedCount, nextTickInMs: waitMs }`.
5. Exactly one outstanding ball, and it is the newest: gate on the public delay.
   `dueAt = (lastCallAtMs ?? 0) + publicDelayMs`; `waitMs = clamp(dueAt - nowMs, 0, publicDelayMs)`.
   Also respect dwell: `waitMs = max(waitMs, max(0, minDwellMs - (nowMs - (lastRevealAtMs ?? 0))))`.
   If `waitMs === 0` → reveal it, `nextTickInMs = null`. Else → hold, `nextTickInMs = waitMs`.
6. `lastCallAtMs === null` with an outstanding newest ball → reveal immediately (no timestamp to wait on).

The clamp in rule 5 is the clock-skew guard: a browser clock far behind the server can never postpone a ball by more than `publicDelayMs`.

Test `reveal-queue.test.ts`, minimum cases:
- caught up returns no tick;
- single new ball held until `publicDelayMs`, then revealed;
- backlog of four reveals one at a time at `minDwellMs`, never skipping;
- undo snaps down;
- `snapImmediately` reveals everything even inside the delay window;
- browser clock 10 minutes behind still reveals within `publicDelayMs`;
- `lastCallAtMs === null` reveals at once.

### T1.3 `src/lib/number-nicknames.ts` (new)

Move the map verbatim from `game-control.tsx:42-101`, with one change: `10: "Andys Den"` (exactly that spelling, no apostrophe, as written by the host). Export `NUMBER_NICKNAMES` and `getNumberNickname(n: number): string | null`.

Test: `10` returns `Andys Den`, no entry anywhere contains `Starmer`, every key is 1 to 90, and every value is non-empty.

### T1.4 `src/lib/house-rules.ts` (edit)

Append, leaving `HOUSE_RULES` untouched:

```ts
export type CallResponse = { number: number; response: string };

/**
 * Call-and-response prompts. Shown on the host pre-game briefing and on the
 * public display's House Rules panel. Numeric order for scanability.
 */
export const CALL_RESPONSES: ReadonlyArray<CallResponse> = [
  { number: 2,  response: 'a quack' },
  { number: 11, response: 'a wolf whistle' },
  { number: 22, response: 'a double quack' },
  { number: 59, response: 'tap your pen on your glass' },
  { number: 69, response: 'an ooooooooo' },
  { number: 88, response: 'wobble wobble' },
];
```

Test `house-rules.test.ts`: `HOUSE_RULES` still has 4 entries with exactly one `closing`, and `CALL_RESPONSES` has the six numbers above in ascending order with non-empty responses.

### T1.5 `src/lib/log-action-failure.ts` (new, server only)

```ts
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** Always logs, including production. Server-only: never import into a client component. */
export function logActionFailure(action: string, err: unknown): void { ... }

/** Logs slow actions so call latency is observable in Vercel logs. */
export function logActionLatency(action: string, startedAtMs: number, thresholdMs = 800): void { ... }
```

Redact UUIDs the same way `logError` does. Never log a user id, a session name or a prize value.

### T1.6 `src/types/actions.ts` (edit)

```ts
export type ActionResult<T = void> =
  | { success: true; data?: T; redirectTo?: string }
  | { success: false; error: string; conflict?: true }
```

### T1.7 `src/components/ui/bingo-ball.tsx` (edit)

Add `shrink-0` to the shared class list so balls overflow rather than squash as flex children (review F-18). Do not change any variant sizes.

### T1.8 Verification for S1

`npm test`, `npx tsc --noEmit`, `npm run lint`. All four new test files must pass.

---

## 2. S2: migrations

Three files. `number_sequence` and `called_numbers` are **jsonb**, not arrays: use `->`, `jsonb_array_length`, `||` and `jsonb - int`. `status` is the `game_status` enum. `numbers_called_count` is nullable with default 0, so `coalesce` it.

### T2.1 `supabase/migrations/20260729120000_atomic_host_mutations.sql`

Follow the conventions in `20260430120300_atomic_admin_mutations.sql`: `security definer`, `set search_path = public`, `revoke all ... from public`, `grant execute ... to authenticated`, row lock via `for update`.

```sql
-- Helper: assert the caller is a host or admin.
create or replace function public.assert_is_host()
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from public.profiles
     where id = auth.uid() and role in ('admin', 'host')
  ) then
    raise exception 'unauthorized: host or admin role required';
  end if;
end; $$;
revoke all on function public.assert_is_host from public;
grant execute on function public.assert_is_host to authenticated;
```

`call_next_number(p_game_id uuid, p_min_gap_ms int default 400) returns public.game_states`:

1. `perform public.assert_is_host();`
2. `select * into v_state from public.game_states where game_id = p_game_id for update;`
3. raise `game_state_not_found` when `v_state.game_id is null`.
4. raise `not_controller` unless `v_state.controlling_host_id = auth.uid()`.
5. raise `not_in_progress`, `on_break`, `paused_for_validation` as applicable.
6. raise `no_more_numbers` when `v_state.number_sequence is null or coalesce(v_state.numbers_called_count,0) >= jsonb_array_length(v_state.number_sequence)`.
7. gap: when `last_call_at is not null and coalesce(numbers_called_count,0) > 0`, compute `v_remaining := p_min_gap_ms - extract(epoch from (now() - v_state.last_call_at)) * 1000;` and raise `too_soon` when positive.
8. `v_next := (v_state.number_sequence -> coalesce(v_state.numbers_called_count,0))::int;` (jsonb `->` is 0-indexed, which matches `numbers_called_count` as the next index).
9. `update public.game_states set called_numbers = coalesce(called_numbers,'[]'::jsonb) || to_jsonb(v_next), numbers_called_count = coalesce(numbers_called_count,0) + 1, last_call_at = now() where game_id = p_game_id returning * into v_state;`
10. `return v_state;`

`void_last_number(p_game_id uuid) returns public.game_states`:

1. `assert_is_host`, lock the row `for update`.
2. raise `game_state_not_found`, `not_controller`, `not_in_progress` as above.
3. raise `nothing_to_void` when `coalesce(numbers_called_count,0) = 0`.
4. **Inside the same transaction and under the same lock**, count blocking winners:
   `select count(*) into v_winners from public.winners where game_id = p_game_id and call_count_at_win = coalesce(v_state.numbers_called_count,0) and is_void = false;`
   raise `winner_on_ball` when greater than zero. This is the fix for review F-03 and U5.
5. `update public.game_states set called_numbers = coalesce(called_numbers,'[]'::jsonb) - (coalesce(numbers_called_count,0) - 1), numbers_called_count = coalesce(numbers_called_count,0) - 1, display_win_type = null, display_win_text = null, display_winner_name = null where game_id = p_game_id returning * into v_state;`
   Do **not** touch `last_call_at` (see spec 4.1).
6. `return v_state;`

`record_winner_atomic(p_session_id uuid, p_game_id uuid, p_stage public.win_stage, p_prize_description text, p_prize_given boolean, p_force_snowball_jackpot boolean, p_snowball_eligible boolean) returns public.game_states`:

1. `assert_is_host`, lock the `game_states` row `for update`.
2. raise `not_controller`, `not_in_progress`.
3. read the game: raise `game_not_found`, and `wrong_session` when `games.session_id <> p_session_id`.
4. derive `v_expected_stage := games.stage_sequence -> current_stage_index` (jsonb) and raise `stage_mismatch` unless it equals `p_stage`.
5. `v_call_count := coalesce(numbers_called_count, 0)` read from the locked row, never from the client.
6. snowball: when the session is not a test session, `games.type = 'snowball'`, `p_stage = 'Full House'` and `snowball_pot_id is not null`, lock the pot row `for update`, compute `v_window_open := v_call_count <= current_max_calls`, and set `v_is_jackpot := p_force_snowball_jackpot or (v_window_open and p_snowball_eligible)`.
7. insert into `winners` with `winner_name = 'Anonymous'`, the derived prize description, `call_count_at_win = v_call_count`, `is_snowball_eligible = p_snowball_eligible`, `is_snowball_jackpot = v_is_jackpot`, `prize_given = p_prize_given`.
8. update `game_states` display state (`paused_for_validation = true`, win type and text per the existing rules in `host/actions.ts:1252-1289`) and `returning * into v_state`.
9. `return v_state;`

Because 7 and 8 are one transaction, a failure on the display update rolls the winner back, so a retry cannot duplicate it (review F-05).

Grants: `revoke all` then `grant execute to authenticated` for each function, with the full argument list in the signature.

### T2.2 `supabase/migrations/20260729120100_public_reveal_delay.sql`

```sql
alter table public.game_states        alter column call_delay_seconds set default 3;
alter table public.game_states_public alter column call_delay_seconds set default 3;
update public.game_states        set call_delay_seconds = 3 where call_delay_seconds is distinct from 3;
update public.game_states_public set call_delay_seconds = 3 where call_delay_seconds is distinct from 3;

comment on column public.game_states.call_delay_seconds is
  'Public reveal delay in seconds: how long /display and /player wait after last_call_at before showing a ball. NOT a host call gap - the host gap is HOST_MIN_CALL_GAP_MS in src/lib/call-timing.ts.';
comment on column public.game_states_public.call_delay_seconds is
  'Mirror of game_states.call_delay_seconds. Public reveal delay in seconds, not a host call gap.';
```

Note: updating `game_states` fires `bump_game_state_version` and `sync_game_states_public`, so the public mirror is updated twice (once by the trigger, once directly). Harmless and idempotent, but the direct `game_states_public` update must run **after** the `game_states` one so the mirror is not left behind. Keep that order.

### T2.3 `supabase/migrations/20260729120200_ensure_realtime_publication.sql`

Idempotent `do $$ ... $$` blocks asserting `sessions`, `game_states` and `game_states_public` are all in `supabase_realtime`, replacing the commented-out statements in `20251221101437`. Add a comment saying host Realtime depends on `game_states` being present.

### T2.4 `docs/superpowers/plans/2026-07-29-rollback.sql`

```sql
-- Run ONLY if the application is rolled back to the pre-2026-07-29 code, which
-- reads call_delay_seconds as the host call gap.
update public.game_states        set call_delay_seconds = 2;
update public.game_states_public set call_delay_seconds = 2;
-- The atomic host functions are additive; the old code does not call them and
-- they can be left in place. To remove them:
-- drop function if exists public.record_winner_atomic(uuid,uuid,public.win_stage,text,boolean,boolean,boolean);
-- drop function if exists public.void_last_number(uuid);
-- drop function if exists public.call_next_number(uuid,int);
-- drop function if exists public.assert_is_host();
```

### T2.5 Verification for S2

`npx supabase db push --dry-run`. Do not apply to production in this stream; application is section 6.

---

## 3. S3: server actions

Contract that S4 codes against, so the two streams can run in parallel:

```ts
type GameStateRow = Database['public']['Tables']['game_states']['Row'];

callNextNumber(gameId): ActionResult<{ nextNumber: number; gameState: GameStateRow }>   // unchanged shape
voidLastNumber(gameId): ActionResult<{ gameState: GameStateRow }>                       // CHANGED: now returns state
toggleBreak(gameId, onBreak): ActionResult<{ gameState: GameStateRow }>                  // CHANGED
pauseForValidation(gameId): ActionResult<{ gameState: GameStateRow }>                    // CHANGED
resumeGame(gameId): ActionResult<{ gameState: GameStateRow }>                            // CHANGED
advanceToNextStage(gameId): ActionResult<{ gameState: GameStateRow }>                    // CHANGED
skipStage(gameId): ActionResult<{ gameState: GameStateRow }>                             // CHANGED: drops 2 args
announceWin(gameId, stage): ActionResult<{ gameState: GameStateRow }>                    // CHANGED
endGame(gameId, sessionId): ActionResult<{ gameState: GameStateRow }>                    // CHANGED
takeControl(gameId): ActionResult<{ gameState: GameStateRow }>                           // CHANGED
recordWinner(sessionId, gameId, stage, prizeDescription, prizeGiven, forceSnowballJackpot, snowballEligible): ActionResult<{ gameState: GameStateRow }>  // CHANGED
toggleWinnerPrizeGiven(sessionId, gameId, winnerId, prizeGiven): ActionResult            // unchanged
voidWinnerFromHost(sessionId, gameId, winnerId, reason): ActionResult                    // NEW
sendHeartbeat(gameId): ActionResult                                                      // unchanged
getCurrentGameState(gameId): ActionResult<GameStateRow>                                  // unchanged
startGame / moveToNextGameOnBreak / moveToNextGameAfterWin                                // unchanged shapes
```

Failures may now carry `conflict: true`. The client treats a conflict as "refresh and tell me why", not as a hard error.

### T3.1 RPC wrappers

Rewrite `callNextNumber`, `voidLastNumber` and `recordWinner` to call the new functions via `supabase.rpc(...)`. Map the raised exception messages to host-facing text:

| Raised | Host message | conflict |
|--------|--------------|----------|
| `not_controller` | Another host is now controlling this game. | yes |
| `not_in_progress` | This game is not in progress. | yes |
| `on_break` | The game is on a break. Resume before calling. | yes |
| `paused_for_validation` | The game is paused for a claim check. | yes |
| `too_soon` | Just a moment, that was too quick. | no |
| `no_more_numbers` | All 90 balls have been called. | no |
| `nothing_to_void` | There is no ball to undo. | no |
| `winner_on_ball` | Cannot undo because a winner was recorded on this ball. Void that winner in the Winners and Prizes list, with a reason, then undo. | no |
| `stage_mismatch` | The live stage has moved on. Refreshing now. | yes |
| `wrong_session` / `game_not_found` / `game_state_not_found` | Could not read this game. Please reload. | no |
| `unauthorized` | You do not have permission to do that. | no |

Anything unmapped falls back to a generic message with the raw message logged through `logActionFailure`. Never surface a raw Postgres error to the host.

`callNextNumber` passes `HOST_MIN_CALL_GAP_MS`. Keep the `nextNumber` in the response by reading it from the returned row (`called_numbers` last element), so the client contract does not change.

### T3.2 Bound updates for the rest

For `toggleBreak`, `pauseForValidation`, `resumeGame`, `advanceToNextStage`, `skipStage`, `announceWin`, `endGame`, `takeControl`: keep the existing prechecks, then make the update filter bind everything asserted, and return the row.

Pattern:

```ts
const { data: rows, error } = await supabase
  .from('game_states')
  .update(patch)
  .eq('game_id', gameId)
  .eq('controlling_host_id', controlResult.user!.id)
  .eq('status', 'in_progress')          // where the action asserted it
  .select('*')
if (error) { logActionFailure('toggleBreak', error); return { success: false, error: '…' } }
if (!rows || rows.length === 0) {
  return { success: false, error: 'The game changed while you were acting. Refreshed now.', conflict: true }
}
return { success: true, data: { gameState: rows[0] } }
```

Specifics:
- `toggleBreak`: bind `status = 'in_progress'`.
- `pauseForValidation`: bind `status = 'in_progress'`, `on_break = false`.
- `resumeGame`: bind `status = 'in_progress'`.
- `advanceToNextStage`: bind `current_stage_index = <the value read>` so a double tap cannot skip two stages.
- `skipStage`: **drop the `currentStageIndex` and `totalStages` parameters**; derive both server-side from `game_states.current_stage_index` and `games.stage_sequence`, then bind on the read index. Update the one call site in `game-control.tsx`.
- `announceWin`: bind `status = 'in_progress'`.
- `endGame`: bind `status = 'in_progress'`.
- `takeControl`: replace read-then-write with one conditional update. Take control when `controlling_host_id is null`, or already ours, or `controller_last_seen_at < now() - interval '30 seconds'`. Express as two attempts (`.is('controlling_host_id', null)` then `.lt('controller_last_seen_at', threshold)`) or a single `.or(...)` filter, and return the row. Zero rows means someone else holds a live lock.

### T3.3 `voidWinnerFromHost` (new)

In `src/app/host/actions.ts`. Requires the **admin** role (reuse the admin check, since `voidWinner` is admin-gated and D6 keeps that boundary). Validates that the winner belongs to `sessionId`, requires a non-empty trimmed reason, sets `is_void = true` and `void_reason`, revalidates `/host/${sessionId}/${gameId}`. A non-admin host gets: "Only an admin can void a winner. Ask an admin to void it, then undo."

### T3.4 `is_void` filters

- `handleSnowballPotUpdate` jackpot-winner count gains `.eq('is_void', false)` (spec E2, financial).
- Any other `winners` count used for a decision gains the same filter. Audit the file for `from('winners')`.

### T3.5 `revalidatePath` cleanup

Remove every `revalidatePath('/host/${gameId}')`. Keep `revalidatePath('/host')`. Add `revalidatePath('/host/${sessionId}/${gameId}')` only in actions that already hold `sessionId`: `startGame`, `endGame`, `recordWinner`, `toggleWinnerPrizeGiven`, `voidWinnerFromHost`, `moveToNextGameOnBreak`, `moveToNextGameAfterWin`. Do not add a session lookup anywhere.

### T3.6 Logging

Every failure return path calls `logActionFailure('<actionName>', errOrMessage)`. `callNextNumber`, `voidLastNumber` and `recordWinner` also call `logActionLatency` with their start time.

### T3.7 `src/types/database.ts`

Add the four functions to a `Functions` block (or extend the existing one) with argument and return types, and update the `call_delay_seconds` comment to say "public reveal delay in seconds, not a host gap".

### T3.8 Verification for S3

`npx tsc --noEmit` and `npm run lint`. Confirm no call site still passes the old `skipStage` arguments.

---

## 4. S4: host UI

### T4.1 The root fix (do this first, commit separately)

In `use-connection-health.ts`, wrap the returned object in `useMemo` keyed on its actual values, and add a header comment: *never put the returned object in a dependency array; destructure the callbacks*.

In `game-control.tsx`:
- `const { markPollSuccess, markPollFailure, markRealtimeStatus } = health;`
- `pollGameState` depends on `[gameId, markPollSuccess, markPollFailure]`, not `health`.
- the Realtime effect depends on `[gameId, markRealtimeStatus]`, not `health`.
- keep `health.shouldShowBanner` and `health.shouldAutoRefresh` read inline in JSX.
- add a comment at each site explaining why.

Verify by hand before moving on: the poll must actually fire every 3 seconds and the channel must subscribe once. Add a temporary `console.debug` if needed, then remove it.

### T4.2 Apply returned state everywhere

Add a typed helper inside the component:

```ts
const applyMutation = (result: ActionResult<{ gameState: GameState }> | undefined, fallback: string) => {
  if (!result?.success) {
    setActionError(result?.error || fallback);
    if (result && 'conflict' in result && result.conflict) void pollGameState();
    return false;
  }
  if (result.data?.gameState) {
    const incoming = result.data.gameState;
    setCurrentGameState((current) => (isFreshGameState(current, incoming) ? incoming : current));
  }
  return true;
};
```

Route every mutation handler through it. Add an in-flight boolean per action (`isTogglingBreak`, `isVoiding`, `isAdvancing`, `isSkipping`, `isResuming`, `isTakingControl`) and disable the matching control while set.

### T4.3 Undo flow

Replace `confirm()` with a `Modal`:

- title "Undo last call";
- body naming the ball, for example "This will take ball 47 off the board.";
- an explicit line: "The next call will draw ball 47 again. It goes back in the bag, it is not skipped.";
- buttons Cancel and "Undo ball 47", the latter disabled while `isVoiding`;
- errors rendered inside the modal with `role="alert"`.

On success, apply the returned state and close. On `winner_on_ball`, keep the modal open and show the message with a "Open Winners and Prizes" button that closes this modal and opens the winners modal.

### T4.4 Post Win modal

Implement the state table in spec 4.3 exactly. Specifically:

- `onClose` closes the modal (no more no-op), and `showCloseButton` stays true so the ✕ and Escape work.
- add a "Close and stay paused" button with a one-line explanation of the resulting state.
- render `actionError` **inside** the modal with `role="alert"`.
- "Validate Another Winner" clears the win display server-side. Reuse `pauseForValidation`, which already nulls the display fields, before reopening the validation modal.
- every button is in-flight guarded and re-enabled on failure.

### T4.5 Validation modal

- live counter above the grid: `{selectedNumbers.length}/{requiredSelectionCount}`, `aria-live="polite"`, large enough to read at arm's length, turning gold when equal.
- a tick or cross line: "Includes last ball (N)".
- selection-count parity: `getRequiredSelectionCountForStage(currentStageName)` with no `?? 5`. When null, disable Check Win and show "This stage is not valid for claim checking."

### T4.6 Snowball eligibility (D7)

In the Record Winner modal, when `isSnowballEligibilityStage && isSnowballJackpotWindowOpen`:

- remove the auto-tick effect at `game-control.tsx:279-284` and the reset at `654-656`;
- replace the checkbox with two required buttons, "Eligible for jackpot" and "Not eligible", as a tri-state (`null | true | false`) held in component state;
- "Confirm Winner" stays disabled while the choice is `null`, with helper text "Choose eligibility before recording.";
- pass the chosen boolean as `snowballEligible`. The RPC treats a jackpot award as valid only when the window is open.

Outside a snowball Full House with an open window, behaviour is unchanged and no choice is required.

### T4.7 Void winner control

In the Session Winners modal, per non-void winner: a "Void" button that opens a small confirm with a required reason textarea, calls `voidWinnerFromHost`, is in-flight guarded, and refreshes the winner lists on success. Non-admins see the button disabled with the explanatory message from T3.3.

### T4.8 Host snowball panel centring

`game-control.tsx:840-859`: container becomes `flex flex-col items-center text-center gap-2 md:flex-row md:items-center md:justify-between md:text-left`, and the countdown paragraph becomes `text-center md:text-right`.

### T4.9 Nicknames

Delete the local `NUMBER_NICKNAMES` and import `getNumberNickname` from `src/lib/number-nicknames`.

### T4.10 Pre-game briefing

`pre-game-briefing.tsx`: add a "Remind the room" block after House Rules, first game only, listing `CALL_RESPONSES` as `number` then `response`, styled like the prize ladder rows so it reads at a glance on a phone.

### T4.11 Verification for S4

`npm run lint`, `npx tsc --noEmit`, `npm run build`.

---

## 5. S5: public UI

Apply to `display-ui.tsx` first, then mirror in `player-ui.tsx`. They are near-duplicates; keep the shared logic identical so they cannot drift.

### T5.1 Load phases (replaces `hasLoaded`)

```ts
type LoadPhase = 'loading' | 'waiting' | 'active' | 'completed' | 'failed';
```

- initial value derived from the server props: `active` when an initial game state exists, `completed` when the session is completed, otherwise `loading`.
- `refreshActiveGame` returns `{ ok: true, hasGame: boolean } | { ok: false }` instead of silently nulling state, and its query errors set `failed` and call `logError`.
- after any successful session poll with no active game state: `waiting`.
- any session, game or game-state query error: `failed`, keep polling, recover to `waiting`/`active` on the next success.
- `waiting` is derived as **session not completed and no active game state**, so the gap between games is covered and the TV is never blank.
- `failed` renders a recoverable panel ("Reconnecting to the game", pub-appropriate wording, no technical detail) rather than the waiting screen.
- remove the `!hasLoaded` early return; render per phase.

### T5.2 Reveal queue

Replace both delay effects with `planReveal`. Keep a `revealedCountRef` and a `lastRevealAtRef`. Derive `delayedNumbers = serverNumbers.slice(0, revealCount)` and `currentNumberDelayed = delayedNumbers.at(-1) ?? null`. Schedule a single timer from `nextTickInMs`, clearing on re-run. `snapImmediately = paused_for_validation || status === 'completed'`.

### T5.3 Realtime lifecycle

- add `visibilitychange` force-reconnect for the game-state channel on both surfaces, matching `game-control.tsx:446-454`;
- add exponential backoff to the session channel, matching the game-state channel;
- **only** the game-state channel calls `markRealtimeStatus`. Add a comment at the session and pot channels stating they are deliberately non-critical because polling covers them, so a pot-channel failure can never put a "Reconnecting" banner on the pub TV.

### T5.4 Revealed-count counters

Every public snowball counter and call counter reads the revealed count, never `currentGameState.numbers_called_count`. Sites: `player-ui.tsx:568`, `display-ui.tsx:735`, plus the new badge.

### T5.5 TV geometry and recent calls (display only)

Coupled, change together:
- footer `h-32` → `h-40`;
- main ball size calc `calc(100vh - 16rem)` → `calc(100vh - 18rem)`;
- QR badge `bottom-36` → `bottom-44`;
- lead ball `w-16 h-16 text-[36px]` → `w-[5.6rem] h-[5.6rem] text-[50px]`, keeping `border-4 border-white`;
- trailing balls `w-12 h-12 text-[27px]` → `w-[4.2rem] h-[4.2rem] text-[38px]`.

### T5.6 TV snowball badge

Top right of the main content area, only when `isSnowballGame` and a game is active. Numeral at `clamp(3rem,6vw,5.5rem)` with a "CALLS LEFT" caption, jackpot amount beneath at `clamp(1.1rem,1.8vw,1.6rem)`. On last call or closed, show that wording at the numeral size. Positioned so it cannot collide with the bottom-left QR. Honour `prefers-reduced-motion` for any animation. Shorten the footer snowball line to the jackpot amount only.

### T5.7 Last ball during a claim check

- display: add the ball to the "Checking Claim" overlay under a "Claim must include" caption, sized `clamp(4rem,12vw,10rem)`.
- player: add a "Claim must include: N" line to the "Checking Claim" card, and keep the ball visible.

### T5.8 "Join in" grid on the TV

Inside `renderHouseRulesPanel`, below the rules: a heading "Join in" and a two column grid of `CALL_RESPONSES`, entries at `clamp(1.1rem,1.6vw,1.7rem)`, number bold in `#f3d59d`. Tighten the rules list `space-y-4` → `space-y-3`.

### T5.9 Phone equivalents (player only)

- recent calls: lead `w-[4.9rem] h-[4.9rem] text-[1.75rem]`, trailing `w-[4.2rem] h-[4.2rem] text-[1.575rem]`, five balls, `overflow-x-auto` retained;
- snowball panel: jackpot left, `text-6xl` countdown right with a small "CALLS LEFT" caption, detail line beneath.

### T5.10 Verification for S5

`npm run lint`, `npx tsc --noEmit`, `npm run build`. Then the screenshot and small-screen checks from spec section 9 items 14 and 15.

---

## 6. S6: documentation

- `CLAUDE.md`: add a gotcha, "never put the `useConnectionHealth` return object in a dependency array; destructure the callbacks". Update the timing gotcha to say `call_delay_seconds` is the public reveal delay and the host gap is `HOST_MIN_CALL_GAP_MS`. Note the new atomic host RPCs.
- `AGENTS.md` lines 61, 100 and 134: same timing correction.
- `docs/architecture/data-model.md`: `call_delay_seconds` semantics, the new functions.
- `docs/architecture/server-actions.md`: the action contract table from spec section 5.
- `docs/architecture/overview.md`: the reveal model in one paragraph.

---

## 7. Release

1. All streams merged into the branch. Run the full pipeline: `npm run lint`, `npx tsc --noEmit`, `npm test`, `npm run build`. Every one must pass.
2. Commit per stream, conventional messages, one logical change each.
3. Merge the branch into `main` and push to `origin`.
4. Wait for the Vercel deployment to go live and confirm it is serving the new code.
5. **Then** apply the three migrations to Supabase in order: atomic host mutations, public reveal delay, publication assertion.
6. Run the post-deploy SQL checks in spec section 9 and record the output.
7. Leave the manual evidence checklist for the host to run against a test session.

Order is deliberate: with the new database and the old app, the host would face a 3 second gap between calls. Code first means the only intermediate state is a 2 second public reveal instead of 3, which is harmless.
