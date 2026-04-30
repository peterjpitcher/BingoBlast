# Live Event Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the corrections from the 2026-04-30 live-event reliability spec — host-instant timing, anonymous winner, outage-only reconnect banner, hard-blocked prize entry (with jackpot exemption), destructive-action guards, and supporting cleanup — without regressing multi-winner ties or jackpot start-time prize entry.

**Architecture:** Four sequenced waves. Wave A introduces a `state_version` column + trigger so realtime/poll cannot roll the UI back to a stale snapshot, then flips the host to apply the server-action response directly. Wave B reshapes winner + prize handling: `winner_name = 'Anonymous'`, `display_win_text = 'BINGO!'`, hard-block prize entry for standard/snowball games (jackpot exempt), per-game lock once started. Wave C replaces the misleading LIVE/OFFLINE pill with an outage-only reconnecting banner backed by a shared health reducer, and tightens `src/proxy.ts`. Wave D handles polish, accessibility, claim-validation, deletion guards, and documentation drift.

**Tech Stack:** Next.js 16 App Router, React 19, Supabase (Postgres + Auth + RLS + Realtime), TypeScript, Tailwind, Node native test runner.

**Reference spec:** [docs/superpowers/specs/2026-04-30-live-event-reliability-design.md](../specs/2026-04-30-live-event-reliability-design.md)

---

## File Structure

### New files

| Path | Responsibility |
|---|---|
| `src/lib/game-state-version.ts` | Pure freshness helper `isFreshGameState()` |
| `src/lib/game-state-version.test.ts` | Node tests for freshness helper |
| `src/lib/connection-health.ts` | Pure connection-health reducer |
| `src/lib/connection-health.test.ts` | Node tests for reducer |
| `src/hooks/use-connection-health.ts` | React hook wrapping the reducer |
| `src/lib/prize-validation.ts` | Pure prize-validation helper |
| `src/lib/prize-validation.test.ts` | Node tests for prize-validation |
| `src/lib/win-stages.ts` | `REQUIRED_SELECTION_COUNT_BY_STAGE` map + helper |
| `src/lib/win-stages.test.ts` | Node tests for required selection count |
| `src/lib/log-error.ts` | Identifier-stripping error logger |
| `src/lib/log-error.test.ts` | Node tests for log-error |
| `supabase/migrations/20260430120000_add_state_version.sql` | `state_version` column + trigger + sync update |
| `supabase/migrations/20260430120100_set_call_delay_default_2.sql` | Default change + backfill |
| `scripts/audit-missing-prizes.sql` | Manual pre-deploy SQL audit |

### Modified files

| Path | Changes |
|---|---|
| `src/types/database.ts` | Add `state_version: number` on `GameState` and `GameStatePublic` |
| `docs/schema.sql` | Mirror migration changes (new column, trigger, default) |
| `src/app/host/actions.ts` | `callNextNumber` returns full `gameState`; remove 200ms buffer; gap-check via `last_call_at`; `recordWinner` simplified; `validateClaim` uses new helper; `startGame` defaults to 2; `recordSnowballWin` simplified |
| `src/app/host/[sessionId]/[gameId]/game-control.tsx` | Apply `result.data.gameState` immediately; freshness helper on realtime/poll; remove `DISPLAY_SYNC_BUFFER_MS`/`displaySyncRemainingMs`/`isDisplaySyncLocked`; remove LIVE/OFFLINE pill; reconnect banner; online/offline + visibility handlers; record-winner modal: no name input, double-tap guard; manual-snowball-award modal: no name input; "Players see this in 2s" label; "Prize not set" fallback |
| `src/app/display/[sessionId]/display-ui.tsx` | Freshness helper; explicit select lists; realtime reconnect with backoff + channel cleanup; online/offline + visibility; reconnect banner; remove unused `currentGameStateRef`; loading skeleton; "Prize not set" fallback |
| `src/app/player/[sessionId]/player-ui.tsx` | Same as display except not the host control |
| `src/app/admin/sessions/[id]/actions.ts` | `createGame`/`updateGame` validate via prize helper, trim prizes, reject `prizes`/`type`/`snowball_pot_id`/`stage_sequence` edits on started games; per-game lock; `deleteGame` guards |
| `src/app/admin/sessions/[id]/session-detail.tsx` | Inline prize errors; per-game lock UI; typed-confirm delete-game modal |
| `src/app/admin/actions.ts` | `deleteSession`, `resetSession` typed-confirm + server guards |
| `src/app/admin/page.tsx` (or admin session list) | Typed-confirm delete-session modal |
| `src/app/login/page.tsx` (or login form component) | Remove signup mode toggle |
| `src/proxy.ts` | Tighten matcher to `/admin/:path*`, `/host/:path*`, `/login` |
| `src/components/ui/modal.tsx` | Focus trap, focus return, Escape handler, 44px close button, `aria-labelledby` |
| `src/components/ui/button.tsx` | `sm` → `h-10 px-3 text-sm` |
| `.env.example` | `NEXT_PUBLIC_SITE_URL` with comment |
| `AGENTS.md` | Correct architecture description |
| `CLAUDE.md` | Same; remove `react-player`/audio claims |
| `README.md` | Replace Bootstrap mention; reflect actual stack |
| `docs/architecture/overview.md` | Reflect host/display/player-follower model |
| `docs/architecture/routes.md` | Public vs auth route accuracy |
| `docs/architecture/relationships.md` | Reflect proxy + new helpers |
| `docs/architecture/data-model.md` | Add `state_version` |

---

## Wave A — State correctness and timing

### Task A1: Add `state_version` migration

**Files:**
- Create: `supabase/migrations/20260430120000_add_state_version.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- Migration: add state_version for ordering Realtime + polling payloads
-- Reason: updated_at is not maintained on update; we need a monotonic counter

alter table public.game_states
  add column if not exists state_version bigint not null default 0;

alter table public.game_states_public
  add column if not exists state_version bigint not null default 0;

create or replace function public.bump_game_state_version()
returns trigger as $$
begin
  if tg_op = 'UPDATE' then
    new.state_version := coalesce(old.state_version, 0) + 1;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists bump_game_state_version on public.game_states;

create trigger bump_game_state_version
before update on public.game_states
for each row execute function public.bump_game_state_version();

-- The existing sync_game_states_public() copies fields from game_states to
-- game_states_public. It must include state_version so public clients see the
-- same ordering value as the host.
create or replace function public.sync_game_states_public()
returns trigger as $$
begin
  insert into public.game_states_public (
    game_id,
    called_numbers,
    numbers_called_count,
    current_stage_index,
    status,
    call_delay_seconds,
    on_break,
    paused_for_validation,
    display_win_type,
    display_win_text,
    display_winner_name,
    started_at,
    ended_at,
    last_call_at,
    updated_at,
    state_version
  )
  values (
    new.game_id,
    new.called_numbers,
    new.numbers_called_count,
    new.current_stage_index,
    new.status,
    new.call_delay_seconds,
    new.on_break,
    new.paused_for_validation,
    new.display_win_type,
    new.display_win_text,
    new.display_winner_name,
    new.started_at,
    new.ended_at,
    new.last_call_at,
    new.updated_at,
    new.state_version
  )
  on conflict (game_id) do update set
    called_numbers = excluded.called_numbers,
    numbers_called_count = excluded.numbers_called_count,
    current_stage_index = excluded.current_stage_index,
    status = excluded.status,
    call_delay_seconds = excluded.call_delay_seconds,
    on_break = excluded.on_break,
    paused_for_validation = excluded.paused_for_validation,
    display_win_type = excluded.display_win_type,
    display_win_text = excluded.display_win_text,
    display_winner_name = excluded.display_winner_name,
    started_at = excluded.started_at,
    ended_at = excluded.ended_at,
    last_call_at = excluded.last_call_at,
    updated_at = excluded.updated_at,
    state_version = excluded.state_version;

  return new;
end;
$$ language plpgsql security definer;

-- Backfill state_version on existing public rows
update public.game_states_public gsp
set state_version = gs.state_version
from public.game_states gs
where gs.game_id = gsp.game_id;
```

> Note: the existing body of `sync_game_states_public()` may differ slightly. Read the previous definition first (search `supabase/migrations/` for `sync_game_states_public`) and preserve any extra columns it copies. Only the addition of `state_version` is required by this task.

- [ ] **Step 2: Apply migration to local Supabase**

Run: `npx supabase db push --include-roles` (or follow the project's migration command in `package.json` if different).
Expected: migration applies without error. Verify with:
```sql
\d public.game_states
\d public.game_states_public
select tgname from pg_trigger where tgrelid = 'public.game_states'::regclass;
```
Both tables should show the `state_version bigint not null default 0` column; `bump_game_state_version` trigger should be listed.

- [ ] **Step 3: Mirror change in `docs/schema.sql`**

Open `docs/schema.sql`, locate the `game_states` and `game_states_public` table definitions, and add `state_version bigint not null default 0` to both. Update the `sync_game_states_public()` body to match the migration. Update the trigger declaration block.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260430120000_add_state_version.sql docs/schema.sql
git commit -m "feat: add state_version column + trigger for snapshot ordering"
```

---

### Task A2: Update TypeScript types

**Files:**
- Modify: `src/types/database.ts`

- [ ] **Step 1: Add `state_version` to both row types**

Find the `GameState` (or `Database['public']['Tables']['game_states']`) interface and add `state_version: number`. Do the same for `GameStatePublic`. If types are auto-generated via `npx supabase gen types`, run that and commit the generated diff instead.

- [ ] **Step 2: Verify type check passes**

Run: `npx tsc --noEmit`
Expected: no errors. If callers reference `GameState` and now require `state_version`, follow the chain — they should be DB-fed shapes that already include the column.

- [ ] **Step 3: Commit**

```bash
git add src/types/database.ts
git commit -m "feat: add state_version to GameState types"
```

---

### Task A3: Create `isFreshGameState` helper (TDD)

**Files:**
- Create: `src/lib/game-state-version.ts`
- Test: `src/lib/game-state-version.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/game-state-version.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isFreshGameState } from './game-state-version.ts';

test('isFreshGameState returns true when current is null', () => {
  assert.equal(
    isFreshGameState(null, { state_version: 5 }),
    true
  );
});

test('isFreshGameState returns false when incoming is null', () => {
  assert.equal(
    isFreshGameState({ state_version: 5 }, null),
    false
  );
});

test('isFreshGameState accepts higher version', () => {
  assert.equal(
    isFreshGameState({ state_version: 5 }, { state_version: 6 }),
    true
  );
});

test('isFreshGameState accepts equal version (idempotent reapply)', () => {
  assert.equal(
    isFreshGameState({ state_version: 5 }, { state_version: 5 }),
    true
  );
});

test('isFreshGameState rejects lower version', () => {
  assert.equal(
    isFreshGameState({ state_version: 5 }, { state_version: 4 }),
    false
  );
});

test('isFreshGameState ignores numbers_called_count when version is newer (void path)', () => {
  // Voiding a number legitimately decreases numbers_called_count.
  // The helper must not refuse a newer state just because the count is lower.
  const current = { state_version: 5, numbers_called_count: 10 };
  const incoming = { state_version: 6, numbers_called_count: 9 };
  assert.equal(isFreshGameState(current, incoming), true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/game-state-version.test.ts`
Expected: FAIL — module not found / `isFreshGameState` undefined.

- [ ] **Step 3: Implement the helper**

```ts
// src/lib/game-state-version.ts
export interface HasStateVersion {
  state_version: number;
}

/**
 * Decide whether to apply an incoming game-state snapshot from realtime or polling.
 *
 * Rules:
 * - Always apply when no current state.
 * - Never apply when incoming is missing.
 * - Apply when incoming.state_version >= current.state_version.
 *   Equal versions are allowed because reapplying the same snapshot is idempotent
 *   and the trigger may produce duplicate broadcasts during reconnect.
 *
 * Do NOT compare numbers_called_count: voiding a number legitimately decreases it.
 */
export function isFreshGameState(
  current: HasStateVersion | null | undefined,
  incoming: HasStateVersion | null | undefined,
): boolean {
  if (!incoming) return false;
  if (!current) return true;
  return incoming.state_version >= current.state_version;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/lib/game-state-version.test.ts`
Expected: 6 passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/game-state-version.ts src/lib/game-state-version.test.ts
git commit -m "feat: add isFreshGameState helper with state_version ordering"
```

---

### Task A4: Apply freshness helper on host realtime + polling

**Files:**
- Modify: `src/app/host/[sessionId]/[gameId]/game-control.tsx`

- [ ] **Step 1: Import the helper**

Add at the top of `game-control.tsx`:
```ts
import { isFreshGameState } from '@/lib/game-state-version';
```

- [ ] **Step 2: Wrap every `setCurrentGameState(...)` for realtime payloads with the freshness check**

Find the realtime subscription (`postgres_changes` UPDATE handler around `game-control.tsx:394`). Replace the direct `setCurrentGameState(payload.new)` with:

```ts
setCurrentGameState((current) => {
  return isFreshGameState(current, payload.new as GameState) ? (payload.new as GameState) : current;
});
```

- [ ] **Step 3: Wrap polling fallback the same way**

Find the polling fallback (around `game-control.tsx:438`). Replace its `setCurrentGameState(freshState)` call with the same `isFreshGameState`-gated update.

- [ ] **Step 4: Add a polling request-order guard**

Inside the polling effect, add a `useRef<number>(0)` that increments before each fetch and is captured locally. After the fetch resolves, only apply the result if no later request has already started. Guard against overlapping intervals with an `inFlightRef`.

```ts
const pollSeqRef = useRef(0);
const pollInFlightRef = useRef(false);

const poll = useCallback(async () => {
  if (pollInFlightRef.current) return;
  pollInFlightRef.current = true;
  const seq = ++pollSeqRef.current;
  try {
    const { data, error } = await supabase
      .from('game_states')
      .select('*')
      .eq('game_id', gameId)
      .single();
    if (error || !data) return;
    if (seq !== pollSeqRef.current) return; // a newer poll has started
    setCurrentGameState((current) => (isFreshGameState(current, data) ? data : current));
  } finally {
    pollInFlightRef.current = false;
  }
}, [gameId]);
```

- [ ] **Step 5: Manually verify**

Run `npm run dev`, open the host, call a number, and confirm the host shows the new ball within ~100ms (no regressions yet — Task A8 makes this instant via response).

- [ ] **Step 6: Commit**

```bash
git add src/app/host/[sessionId]/[gameId]/game-control.tsx
git commit -m "feat: gate host realtime/poll updates by state_version"
```

---

### Task A5: Apply freshness helper on display-ui

**Files:**
- Modify: `src/app/display/[sessionId]/display-ui.tsx`

- [ ] **Step 1: Import the helper**

```ts
import { isFreshGameState } from '@/lib/game-state-version';
```

- [ ] **Step 2: Replace realtime payload application**

Find the `postgres_changes` UPDATE handler for `game_state_public_updates` (around `display-ui.tsx:125`). Wrap the state setter with `isFreshGameState`. Same pattern as Task A4 Step 2.

- [ ] **Step 3: Replace polling-fallback application + add request-order guard**

Same pattern as Task A4 Step 3 + Step 4. The polling source is `game_states_public` here, not `game_states`. Use:

```ts
const { data, error } = await supabase
  .from('game_states_public')
  .select('game_id, called_numbers, numbers_called_count, current_stage_index, status, call_delay_seconds, on_break, paused_for_validation, display_win_type, display_win_text, display_winner_name, started_at, ended_at, last_call_at, updated_at, state_version')
  .eq('game_id', currentActiveGame.id)
  .single();
```

This also satisfies the "explicit select lists" requirement from the spec.

- [ ] **Step 4: Manually verify**

Run dev server, open `/display/<sessionId>`, call a number from host, verify display still updates.

- [ ] **Step 5: Commit**

```bash
git add src/app/display/[sessionId]/display-ui.tsx
git commit -m "feat: gate display realtime/poll updates by state_version + explicit selects"
```

---

### Task A6: Apply freshness helper on player-ui

**Files:**
- Modify: `src/app/player/[sessionId]/player-ui.tsx`

- [ ] **Step 1–3: Same as Task A5 but in `player-ui.tsx`.**

The polling source is `game_states_public`. Use the same explicit select list. Mirror the import + realtime gate + polling gate.

- [ ] **Step 4: Manually verify**

Open `/player/<sessionId>` and confirm number reveals still work.

- [ ] **Step 5: Commit**

```bash
git add src/app/player/[sessionId]/player-ui.tsx
git commit -m "feat: gate player realtime/poll updates by state_version + explicit selects"
```

---

### Task A7: Set `call_delay_seconds` default to 2

**Files:**
- Create: `supabase/migrations/20260430120100_set_call_delay_default_2.sql`
- Modify: `docs/schema.sql`
- Modify: `src/app/host/actions.ts`

- [ ] **Step 1: Create migration**

```sql
-- Migration: set call_delay_seconds default to 2 to match new host-instant timing
alter table public.game_states alter column call_delay_seconds set default 2;
alter table public.game_states_public alter column call_delay_seconds set default 2;

update public.game_states
set call_delay_seconds = 2
where call_delay_seconds = 1;

update public.game_states_public
set call_delay_seconds = 2
where call_delay_seconds = 1;
```

- [ ] **Step 2: Apply migration**

Run: `npx supabase db push`
Expected: applies cleanly. Verify with:
```sql
select column_default from information_schema.columns
where table_schema='public' and table_name='game_states' and column_name='call_delay_seconds';
```
Output: `2`.

- [ ] **Step 3: Mirror in `docs/schema.sql`**

Update both table definitions to `call_delay_seconds integer default 2`.

- [ ] **Step 4: Update `startGame()` fallback**

Open `src/app/host/actions.ts`. Locate `startGame` (~line 343 where the previous discovery noted `call_delay_seconds` defaults to 1). Change the fallback so a new row inserts with `2` when `call_delay_seconds` is not already set:

```ts
const callDelaySeconds = existing?.call_delay_seconds ?? 2;
```

If the previous code was `?? 1` or a literal `1`, replace with `2`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260430120100_set_call_delay_default_2.sql docs/schema.sql src/app/host/actions.ts
git commit -m "feat: bump call_delay_seconds default to 2 seconds"
```

---

### Task A8: `callNextNumber` returns full `gameState`; host applies it immediately

**Files:**
- Modify: `src/app/host/actions.ts`
- Modify: `src/app/host/[sessionId]/[gameId]/game-control.tsx`

- [ ] **Step 1: Update `callNextNumber` return type and body in `src/app/host/actions.ts`**

Current shape returns `{ nextNumber }`. Change to return the full updated game-state row:

```ts
type CallNextNumberResult =
  | { success: true; data: { nextNumber: number; gameState: GameState } }
  | { success: false; error: string };

export async function callNextNumber(gameId: string): Promise<CallNextNumberResult> {
  // ...existing auth + validation...

  // Server-side gap enforcement (no client-side 200ms buffer)
  const nowMs = Date.now();
  if (gameState.last_call_at) {
    const gapMs = nowMs - new Date(gameState.last_call_at).getTime();
    const minGapMs = (gameState.call_delay_seconds ?? 2) * 1000;
    if (gapMs < minGapMs) {
      return { success: false, error: 'Please wait before calling the next number' };
    }
  }

  // ...existing compare-and-set update via .eq('numbers_called_count', oldCount)...

  // Re-read the updated row so the host applies the fully-synced state
  const { data: updated, error: fetchError } = await supabaseAdmin
    .from('game_states')
    .select('*')
    .eq('game_id', gameId)
    .single();
  if (fetchError || !updated) {
    return { success: false, error: 'Failed to read updated game state' };
  }

  revalidatePath(`/host/${updated.session_id ?? ''}/${gameId}`);
  return { success: true, data: { nextNumber, gameState: updated as GameState } };
}
```

> Match the existing project conventions for `ActionResult<T>` if a generic exists. The exact discriminator is `success: true|false`. Preserve all existing pre-call validations (game must be `in_progress`, not on break, not paused for validation, not exceeding `stage_sequence`).

- [ ] **Step 2: Update host `handleCallNextNumber` in `game-control.tsx`**

Find `handleCallNextNumber` (around `game-control.tsx:442`). After awaiting the action, apply the response:

```ts
const result = await callNextNumber(gameId);
if (!result.success) {
  toast.error(result.error);
  return;
}
const incoming = result.data.gameState;
setCurrentGameState((current) => (isFreshGameState(current, incoming) ? incoming : current));
```

- [ ] **Step 3: Verify host shows ball without waiting for realtime**

Run dev server, open host, throttle network in devtools to "Slow 3G", call a number. The host ball updates as soon as the action returns; display/player still wait `call_delay_seconds`.

- [ ] **Step 4: Commit**

```bash
git add src/app/host/actions.ts src/app/host/[sessionId]/[gameId]/game-control.tsx
git commit -m "feat: host applies callNextNumber response directly + server-side gap check"
```

---

### Task A9: Remove host display-sync lockout

**Files:**
- Modify: `src/app/host/[sessionId]/[gameId]/game-control.tsx`

- [ ] **Step 1: Delete `DISPLAY_SYNC_BUFFER_MS` constant**

Search for `DISPLAY_SYNC_BUFFER_MS` (around `game-control.tsx:96`) and remove the `const DISPLAY_SYNC_BUFFER_MS = 200;` line.

- [ ] **Step 2: Delete `displaySyncRemainingMs` state and its updating effect**

Search for `displaySyncRemainingMs` (around `game-control.tsx:293-335`). Delete:
- The `useState` declaration.
- The `useEffect` that ticks the countdown every 100ms.
- Any code computing `lockDurationMs`.

- [ ] **Step 3: Update Next Number button disabled condition**

Find the Next Number `<button>` (around `game-control.tsx:781-787`). Replace `disabled={... || isDisplaySyncLocked || ...}` with the existing in-flight loading flag only — typically `disabled={isCallingNextNumber}` (or the project's existing in-flight ref). Keep all other disabled conditions (game not in progress, on break, etc.).

- [ ] **Step 4: Verify the Next Number button re-enables as soon as the action returns**

Run dev server. Call a number. The button is disabled briefly during the request, then re-enables — there is no additional client-side cooldown.

- [ ] **Step 5: Commit**

```bash
git add src/app/host/[sessionId]/[gameId]/game-control.tsx
git commit -m "refactor: remove client-side display sync lockout in favour of server gap check"
```

---

### Task A10: "Players see this in 2s" host label

**Files:**
- Modify: `src/app/host/[sessionId]/[gameId]/game-control.tsx`

- [ ] **Step 1: Add the passive label below the current ball**

Locate the host's "current ball" rendering (around `game-control.tsx:781`). Below the ball, render:

```tsx
{currentGameState?.last_call_at && (
  <p className="mt-2 text-xs text-muted-foreground">
    Players see this in {currentGameState.call_delay_seconds ?? 2}s
  </p>
)}
```

- [ ] **Step 2: Verify label is visible and accurate**

Open host. After calling a number, the label appears beneath the ball with the current delay. Hide it again on game break / paused state if the existing UI hides the ball — keep parity with the existing ball visibility condition.

- [ ] **Step 3: Commit**

```bash
git add src/app/host/[sessionId]/[gameId]/game-control.tsx
git commit -m "feat: show 'Players see this in Ns' label on host"
```

---

## Wave B — Winner and prize correctness

### Task B1: Prize-validation helper (TDD)

**Files:**
- Create: `src/lib/prize-validation.ts`
- Test: `src/lib/prize-validation.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/prize-validation.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateGamePrizes } from './prize-validation.ts';

test('standard game with full prize map passes', () => {
  const r = validateGamePrizes({
    type: 'standard',
    stage_sequence: ['Line', 'Two Lines', 'Full House'],
    prizes: { Line: '£10', 'Two Lines': '£20', 'Full House': '£50' },
  });
  assert.deepEqual(r, { valid: true });
});

test('standard game with one missing stage prize fails', () => {
  const r = validateGamePrizes({
    type: 'standard',
    stage_sequence: ['Line', 'Two Lines', 'Full House'],
    prizes: { Line: '£10', 'Two Lines': '', 'Full House': '£50' },
  });
  assert.equal(r.valid, false);
  assert.deepEqual((r as { valid: false; missingStages: string[] }).missingStages, ['Two Lines']);
});

test('standard game with whitespace-only prize fails', () => {
  const r = validateGamePrizes({
    type: 'standard',
    stage_sequence: ['Line'],
    prizes: { Line: '   ' },
  });
  assert.equal(r.valid, false);
});

test('snowball game requires Full House prize', () => {
  const ok = validateGamePrizes({
    type: 'snowball',
    stage_sequence: ['Full House'],
    prizes: { 'Full House': '£100' },
  });
  assert.deepEqual(ok, { valid: true });

  const bad = validateGamePrizes({
    type: 'snowball',
    stage_sequence: ['Full House'],
    prizes: { 'Full House': '' },
  });
  assert.equal(bad.valid, false);
});

test('jackpot game with empty admin prizes is allowed (host enters at start)', () => {
  const r = validateGamePrizes({
    type: 'jackpot',
    stage_sequence: ['Full House'],
    prizes: {},
  });
  assert.deepEqual(r, { valid: true });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- src/lib/prize-validation.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper**

```ts
// src/lib/prize-validation.ts
import type { GameType, WinStage } from '@/types/database';

export type PrizeValidationInput = {
  type: GameType;
  stage_sequence: WinStage[];
  prizes: Partial<Record<WinStage, string>>;
};

export type PrizeValidationResult =
  | { valid: true }
  | { valid: false; missingStages: WinStage[] };

/**
 * Validate that admin-entered prizes meet the requirements for a game.
 *
 * Rules:
 * - standard: every stage in stage_sequence has a non-empty trimmed prize.
 * - snowball: 'Full House' must have a non-empty trimmed prize. Other stages optional.
 * - jackpot: prizes are not required at admin time. The host enters the cash amount
 *            at game start via startGame().
 */
export function validateGamePrizes(input: PrizeValidationInput): PrizeValidationResult {
  const trim = (s: unknown) => (typeof s === 'string' ? s.trim() : '');

  if (input.type === 'jackpot') {
    return { valid: true };
  }

  const requiredStages: WinStage[] =
    input.type === 'snowball'
      ? ['Full House']
      : input.stage_sequence;

  const missingStages = requiredStages.filter(
    (stage) => trim(input.prizes[stage]).length === 0,
  );

  if (missingStages.length === 0) return { valid: true };
  return { valid: false, missingStages };
}
```

> If `GameType` / `WinStage` aren't yet exported from `src/types/database.ts`, export them so this module can import them. They are existing enum types per the schema.

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- src/lib/prize-validation.test.ts`
Expected: 5 passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/prize-validation.ts src/lib/prize-validation.test.ts
git commit -m "feat: add prize validation helper with jackpot exemption"
```

---

### Task B2: Server-side prize validation in admin actions

**Files:**
- Modify: `src/app/admin/sessions/[id]/actions.ts`

- [ ] **Step 1: Import the helper**

```ts
import { validateGamePrizes } from '@/lib/prize-validation';
```

- [ ] **Step 2: Trim prizes and validate inside `createGame()` and `updateGame()`**

For each action that accepts a `games` payload, after parsing input:

```ts
const trimmedPrizes: Record<string, string> = {};
for (const [stage, value] of Object.entries(input.prizes ?? {})) {
  if (typeof value === 'string') {
    const t = value.trim();
    if (t.length > 0) trimmedPrizes[stage] = t;
  }
}

const validation = validateGamePrizes({
  type: input.type,
  stage_sequence: input.stage_sequence,
  prizes: trimmedPrizes,
});

if (!validation.valid) {
  return {
    error: `${input.name}: prize required for ${validation.missingStages.join(', ')}`,
  };
}
```

Save `trimmedPrizes` to the DB, not the raw input.

- [ ] **Step 3: Reject edits to locked games in `updateGame()`**

Read the existing `game_states.status` for the target game. If `status` is `'in_progress'` or `'completed'`, reject changes to `prizes`, `type`, `snowball_pot_id`, and `stage_sequence`:

```ts
const { data: gameStateRow } = await supabase
  .from('game_states')
  .select('status')
  .eq('game_id', input.id)
  .maybeSingle();

if (gameStateRow && gameStateRow.status !== 'not_started') {
  const lockedFields = ['prizes', 'type', 'snowball_pot_id', 'stage_sequence'];
  const attemptedLocked = lockedFields.filter((f) => f in input.changes);
  if (attemptedLocked.length > 0) {
    return { error: `Cannot edit ${attemptedLocked.join(', ')} on a started game` };
  }
}
```

> Match the project's existing `input` shape; the keys in the example may need to align with the action's actual parameter names.

- [ ] **Step 4: Verify**

Try saving a standard game in admin with one prize blank — server returns the missing-prize error.

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/sessions/[id]/actions.ts
git commit -m "feat: server-side prize validation + lock once started"
```

---

### Task B3: Client-side prize validation + per-game lock UI

**Files:**
- Modify: `src/app/admin/sessions/[id]/session-detail.tsx`

- [ ] **Step 1: Import helper**

```ts
import { validateGamePrizes } from '@/lib/prize-validation';
```

- [ ] **Step 2: Run validation on submit and inline**

Before invoking the server action, validate locally:

```tsx
const validation = validateGamePrizes({
  type: editingGame.type,
  stage_sequence: editingGame.stage_sequence,
  prizes: prizesDraft,
});
if (!validation.valid) {
  setMissingPrizeStages(validation.missingStages);
  return;
}
```

Render red borders + inline messages on each prize input that appears in `missingPrizeStages`. Disable the submit button while `missingPrizeStages.length > 0`.

- [ ] **Step 3: Per-game lock UI**

Replace the existing "session is running, all editing disabled" treatment with per-game gating. For each game row in the editor:

```tsx
const isLocked = game.gameStateStatus === 'in_progress' || game.gameStateStatus === 'completed';

return (
  <fieldset disabled={isLocked} aria-disabled={isLocked}>
    {/* prize inputs */}
    {isLocked && (
      <p className="text-xs text-muted-foreground mt-1">
        Locked: game already started
      </p>
    )}
  </fieldset>
);
```

Source `gameStateStatus` from the existing data fetch — load the `game_states.status` for each game in the session. If the page does not currently fetch it, add the join.

- [ ] **Step 4: Visually verify**

Start a game from host, return to admin session detail, confirm that game's prize fields are locked while not-started future games remain editable.

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/sessions/[id]/session-detail.tsx
git commit -m "feat: inline prize validation + per-game lock once started"
```

---

### Task B4: Replace "Standard Prize" with "Prize not set"

**Files:**
- Modify: `src/app/host/[sessionId]/[gameId]/game-control.tsx`
- Modify: `src/app/display/[sessionId]/display-ui.tsx`

- [ ] **Step 1: Replace host fallback**

Find `'Standard Prize'` in `game-control.tsx:260`:

```tsx
const currentStagePrize = getPlannedPrize(currentGameState.current_stage_index) || (
  <span className="text-destructive">⚠️ Prize not set</span>
);
```

If `currentStagePrize` is rendered as plain text elsewhere, change the rendering site to handle a JSX fallback or keep it a string and apply a `text-destructive` class when the value is the placeholder. Choose whichever pattern fits the surrounding code; the user-visible result must be red text reading exactly `⚠️ Prize not set`.

- [ ] **Step 2: Replace display fallbacks**

`display-ui.tsx:572` and `:346`:

```tsx
{currentPrizeText ? (
  currentPrizeText
) : (
  <span className="text-destructive">⚠️ Prize not set</span>
)}
```

- [ ] **Step 3: Search for any remaining string literal**

```bash
grep -rn "Standard Prize" src/
```

Expected: no remaining matches.

- [ ] **Step 4: Commit**

```bash
git add src/app/host/[sessionId]/[gameId]/game-control.tsx src/app/display/[sessionId]/display-ui.tsx
git commit -m "feat: replace 'Standard Prize' fallback with explicit warning"
```

---

### Task B5: Manual prize-audit SQL script

**Files:**
- Create: `scripts/audit-missing-prizes.sql`

- [ ] **Step 1: Write the audit query**

```sql
-- Pre-deploy audit: list non-jackpot games with missing or blank stage prizes.
-- Run before promoting; manually fix any flagged rows in admin.
select
  g.id,
  g.name,
  g.type,
  stage
from public.games g
cross join lateral jsonb_array_elements_text(g.stage_sequence::jsonb) as stage
where g.type <> 'jackpot'
  and nullif(trim(coalesce(g.prizes ->> stage, '')), '') is null;
```

- [ ] **Step 2: Add a one-line usage note at the top of the file**

```sql
-- Usage: paste into Supabase SQL editor before each release. Empty result = ready.
```

- [ ] **Step 3: Commit**

```bash
git add scripts/audit-missing-prizes.sql
git commit -m "chore: add manual missing-prize audit SQL script"
```

---

### Task B6: Anonymous winner — Record Winner modal

**Files:**
- Modify: `src/app/host/[sessionId]/[gameId]/game-control.tsx`
- Modify: `src/app/host/actions.ts`

- [ ] **Step 1: Remove the `winnerName` input from the Record Winner modal**

In `game-control.tsx`, find the Record Winner modal (around the `recordWinner` invocation, line ~661). Remove:
- The `<input>` / textbox for the winner name.
- The `winnerName` `useState`.
- Any `onChange` / form-validation referencing the name.

- [ ] **Step 2: Add `isRecordingWinner` double-tap guard**

```tsx
const [isRecordingWinner, setIsRecordingWinner] = useState(false);

const handleConfirmWinner = async () => {
  if (isRecordingWinner) return;
  setIsRecordingWinner(true);
  try {
    const result = await recordWinner({ gameId, stage });
    if (!result.success) toast.error(result.error);
    else closeModal();
  } finally {
    setIsRecordingWinner(false);
  }
};
```

The Confirm button: `disabled={isRecordingWinner}`.

- [ ] **Step 3: Update `recordWinner()` server action**

In `src/app/host/actions.ts`, remove `winnerName` and `callCountAtWin` from the parameter list. The action re-reads live state and uses the current `numbers_called_count`:

```ts
export async function recordWinner(params: {
  gameId: string;
  stage: WinStage;
}): Promise<{ success: true; data: { winnerId: string } } | { success: false; error: string }> {
  // ...auth + permission check...

  const { data: gameStateRow } = await supabaseAdmin
    .from('game_states')
    .select('numbers_called_count, status, current_stage_index')
    .eq('game_id', params.gameId)
    .single();

  if (!gameStateRow) return { success: false, error: 'Game state not found' };

  const insertResult = await supabaseAdmin
    .from('winners')
    .insert({
      game_id: params.gameId,
      session_id: /* derive */,
      stage: params.stage,
      winner_name: 'Anonymous',
      call_count_at_win: gameStateRow.numbers_called_count,
      // is_snowball_eligible: ...existing logic...
    })
    .select('id')
    .single();

  if (insertResult.error || !insertResult.data) {
    return { success: false, error: 'Failed to record winner' };
  }

  // Update display state for the public banner.
  await supabaseAdmin
    .from('game_states')
    .update({
      display_winner_name: null,
      display_win_text: 'BINGO!',
      display_win_type: params.stage,
    })
    .eq('game_id', params.gameId);

  return { success: true, data: { winnerId: insertResult.data.id } };
}
```

> Preserve all existing snowball-eligibility logic and the multi-winner "Validate Another Winner" path. Do not add a unique constraint.

- [ ] **Step 4: Verify display banner reads "BINGO!"**

Run dev. Record a winner. Big screen shows the celebratory banner with text "BINGO!" and no "Winner: " prefix containing a name.

- [ ] **Step 5: Commit**

```bash
git add src/app/host/[sessionId]/[gameId]/game-control.tsx src/app/host/actions.ts
git commit -m "feat: anonymous winner flow — remove name input, write display_win_text"
```

---

### Task B7: Anonymous winner — Manual Snowball Award modal

**Files:**
- Modify: `src/app/host/[sessionId]/[gameId]/game-control.tsx`
- Modify: `src/app/host/actions.ts`

- [ ] **Step 1: Remove the name input from the Manual Snowball Award modal**

Find the snowball-award modal (search `recordSnowballWin` or "Manual Snowball" in `game-control.tsx`). Remove the name input and its state.

- [ ] **Step 2: Update `recordSnowballWin` action**

Remove `winnerName` from the parameter list. Persist `winner_name = 'Anonymous'`. Keep the existing snowball-specific celebratory text — for example `FULL HOUSE + SNOWBALL £250!` — written to `display_win_text` so the jackpot amount is still visible to the room.

- [ ] **Step 3: Verify**

Trigger a manual snowball award; big screen shows the snowball text without a person name.

- [ ] **Step 4: Commit**

```bash
git add src/app/host/[sessionId]/[gameId]/game-control.tsx src/app/host/actions.ts
git commit -m "feat: anonymous snowball winner — remove name input"
```

---

## Wave C — Connection UX and proxy

### Task C1: Connection-health reducer (TDD)

**Files:**
- Create: `src/lib/connection-health.ts`
- Test: `src/lib/connection-health.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/connection-health.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  initialHealthState,
  reduceHealth,
  selectShouldShowBanner,
  selectShouldAutoRefresh,
} from './connection-health.ts';

const t0 = 1_700_000_000_000; // arbitrary fixed epoch ms

test('starts healthy', () => {
  const s = initialHealthState(t0);
  assert.equal(s.healthy, true);
  assert.equal(selectShouldShowBanner(s, t0), false);
  assert.equal(selectShouldAutoRefresh(s, t0), false);
});

test('poll failure flips to unhealthy at the moment of failure', () => {
  let s = initialHealthState(t0);
  s = reduceHealth(s, { type: 'poll-failure', at: t0 + 1000 });
  assert.equal(s.healthy, false);
  assert.equal(s.unhealthySinceMs, t0 + 1000);
});

test('does not show banner before 10s unhealthy', () => {
  let s = initialHealthState(t0);
  s = reduceHealth(s, { type: 'poll-failure', at: t0 + 1000 });
  assert.equal(selectShouldShowBanner(s, t0 + 5000), false); // 4s in
  assert.equal(selectShouldShowBanner(s, t0 + 11000), true); // 10s in
});

test('auto-refresh triggers at 30s unhealthy', () => {
  let s = initialHealthState(t0);
  s = reduceHealth(s, { type: 'poll-failure', at: t0 + 1000 });
  assert.equal(selectShouldAutoRefresh(s, t0 + 30000), false); // 29s
  assert.equal(selectShouldAutoRefresh(s, t0 + 31001), true);  // 30.001s
});

test('poll success while unhealthy returns to healthy and clears flags', () => {
  let s = initialHealthState(t0);
  s = reduceHealth(s, { type: 'poll-failure', at: t0 + 1000 });
  s = reduceHealth(s, { type: 'poll-success', at: t0 + 5000 });
  assert.equal(s.healthy, true);
  assert.equal(s.unhealthySinceMs, null);
});

test('navigator.onLine === false flips to unhealthy immediately', () => {
  let s = initialHealthState(t0);
  s = reduceHealth(s, { type: 'browser-offline', at: t0 + 100 });
  assert.equal(s.healthy, false);
  assert.equal(s.unhealthySinceMs, t0 + 100);
});

test('realtime CHANNEL_ERROR flips to unhealthy; SUBSCRIBED clears it', () => {
  let s = initialHealthState(t0);
  s = reduceHealth(s, { type: 'realtime-status', status: 'CHANNEL_ERROR', at: t0 + 100 });
  assert.equal(s.healthy, false);
  s = reduceHealth(s, { type: 'realtime-status', status: 'SUBSCRIBED', at: t0 + 200 });
  assert.equal(s.healthy, true);
});
```

- [ ] **Step 2: Run to verify failure**

`npm test -- src/lib/connection-health.test.ts` → FAIL, module not found.

- [ ] **Step 3: Implement the reducer**

```ts
// src/lib/connection-health.ts
export type RealtimeStatus = 'SUBSCRIBED' | 'CHANNEL_ERROR' | 'TIMED_OUT' | 'CLOSED' | 'JOINING';

export type HealthEvent =
  | { type: 'poll-success'; at: number }
  | { type: 'poll-failure'; at: number }
  | { type: 'browser-online'; at: number }
  | { type: 'browser-offline'; at: number }
  | { type: 'realtime-status'; status: RealtimeStatus; at: number };

export interface HealthState {
  healthy: boolean;
  unhealthySinceMs: number | null;
  lastSuccessAt: number;
  online: boolean;
  realtime: RealtimeStatus | null;
}

const BANNER_THRESHOLD_MS = 10_000;
const AUTO_REFRESH_THRESHOLD_MS = 30_000;

export function initialHealthState(now: number): HealthState {
  return {
    healthy: true,
    unhealthySinceMs: null,
    lastSuccessAt: now,
    online: true,
    realtime: null,
  };
}

function flipUnhealthy(state: HealthState, at: number): HealthState {
  if (!state.healthy) return state;
  return { ...state, healthy: false, unhealthySinceMs: at };
}

function flipHealthy(state: HealthState, at: number): HealthState {
  return { ...state, healthy: true, unhealthySinceMs: null, lastSuccessAt: at };
}

export function reduceHealth(state: HealthState, event: HealthEvent): HealthState {
  switch (event.type) {
    case 'poll-success':
      return flipHealthy(state, event.at);
    case 'poll-failure':
      return flipUnhealthy(state, event.at);
    case 'browser-online':
      return { ...state, online: true };
    case 'browser-offline':
      return flipUnhealthy({ ...state, online: false }, event.at);
    case 'realtime-status': {
      const next = { ...state, realtime: event.status };
      if (event.status === 'SUBSCRIBED') return flipHealthy(next, event.at);
      if (event.status === 'CHANNEL_ERROR' || event.status === 'TIMED_OUT' || event.status === 'CLOSED') {
        return flipUnhealthy(next, event.at);
      }
      return next;
    }
  }
}

export function selectShouldShowBanner(state: HealthState, now: number): boolean {
  if (state.healthy || state.unhealthySinceMs == null) return false;
  return now - state.unhealthySinceMs >= BANNER_THRESHOLD_MS;
}

export function selectShouldAutoRefresh(state: HealthState, now: number): boolean {
  if (state.healthy || state.unhealthySinceMs == null) return false;
  return now - state.unhealthySinceMs > AUTO_REFRESH_THRESHOLD_MS;
}
```

- [ ] **Step 4: Run to verify pass**

`npm test -- src/lib/connection-health.test.ts` → 7 passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/connection-health.ts src/lib/connection-health.test.ts
git commit -m "feat: connection-health reducer with banner + auto-refresh thresholds"
```

---

### Task C2: `useConnectionHealth` hook

**Files:**
- Create: `src/hooks/use-connection-health.ts`

- [ ] **Step 1: Implement the hook**

```ts
// src/hooks/use-connection-health.ts
'use client';
import { useCallback, useEffect, useReducer, useState } from 'react';
import {
  HealthState,
  RealtimeStatus,
  initialHealthState,
  reduceHealth,
  selectShouldAutoRefresh,
  selectShouldShowBanner,
} from '@/lib/connection-health';

export interface UseConnectionHealthApi {
  healthy: boolean;
  shouldShowBanner: boolean;
  shouldAutoRefresh: boolean;
  unhealthyForMs: number;
  markPollSuccess: () => void;
  markPollFailure: () => void;
  markRealtimeStatus: (status: RealtimeStatus) => void;
}

export function useConnectionHealth(): UseConnectionHealthApi {
  const [state, dispatch] = useReducer(
    (s: HealthState, e: Parameters<typeof reduceHealth>[1]) => reduceHealth(s, e),
    Date.now(),
    initialHealthState,
  );
  const [now, setNow] = useState(() => Date.now());

  // Tick once a second so banner/auto-refresh thresholds re-evaluate without
  // requiring the host to dispatch an event for time to pass.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Wire window online/offline.
  useEffect(() => {
    const onOnline = () => dispatch({ type: 'browser-online', at: Date.now() });
    const onOffline = () => dispatch({ type: 'browser-offline', at: Date.now() });
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  const markPollSuccess = useCallback(() => {
    dispatch({ type: 'poll-success', at: Date.now() });
  }, []);
  const markPollFailure = useCallback(() => {
    dispatch({ type: 'poll-failure', at: Date.now() });
  }, []);
  const markRealtimeStatus = useCallback((status: RealtimeStatus) => {
    dispatch({ type: 'realtime-status', status, at: Date.now() });
  }, []);

  return {
    healthy: state.healthy,
    shouldShowBanner: selectShouldShowBanner(state, now),
    shouldAutoRefresh: selectShouldAutoRefresh(state, now),
    unhealthyForMs: state.unhealthySinceMs == null ? 0 : Math.max(0, now - state.unhealthySinceMs),
    markPollSuccess,
    markPollFailure,
    markRealtimeStatus,
  };
}
```

- [ ] **Step 2: Verify type check**

Run `npx tsc --noEmit`. Expect clean.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/use-connection-health.ts
git commit -m "feat: useConnectionHealth hook backing the reconnect banner"
```

---

### Task C3: Reconnecting banner component

**Files:**
- Create: `src/components/connection-banner.tsx`

- [ ] **Step 1: Implement the component**

```tsx
// src/components/connection-banner.tsx
'use client';
import { useEffect } from 'react';

interface ConnectionBannerProps {
  visible: boolean;
  shouldAutoRefresh: boolean;
}

export function ConnectionBanner({ visible, shouldAutoRefresh }: ConnectionBannerProps) {
  useEffect(() => {
    if (shouldAutoRefresh) {
      window.location.reload();
    }
  }, [shouldAutoRefresh]);

  if (!visible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed top-2 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-full bg-amber-500/90 px-4 py-2 text-sm text-white shadow"
    >
      <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-white" />
      <span>Reconnecting…</span>
      <button
        type="button"
        className="ml-2 rounded bg-white/20 px-2 py-1 text-xs hover:bg-white/30"
        onClick={() => window.location.reload()}
      >
        Refresh
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/connection-banner.tsx
git commit -m "feat: ConnectionBanner component for outage-only UX"
```

---

### Task C4: Wire host to use connection health

**Files:**
- Modify: `src/app/host/[sessionId]/[gameId]/game-control.tsx`

- [ ] **Step 1: Import and use the hook**

```tsx
import { useConnectionHealth } from '@/hooks/use-connection-health';
import { ConnectionBanner } from '@/components/connection-banner';
```

Inside the component:
```tsx
const health = useConnectionHealth();
```

- [ ] **Step 2: Hook into realtime status callback**

In the realtime subscription (around `game-control.tsx:372-423`), the `subscribe` callback already receives a status string. Inside it, call:

```ts
health.markRealtimeStatus(status);
```

- [ ] **Step 3: Hook into polling success/failure**

In the polling effect (around `game-control.tsx:426-440`), after a successful fetch call `health.markPollSuccess()`; on error or rejected `data` call `health.markPollFailure()`.

- [ ] **Step 4: Render banner**

Near the top of the component's returned JSX:

```tsx
<ConnectionBanner
  visible={health.shouldShowBanner}
  shouldAutoRefresh={health.shouldAutoRefresh}
/>
```

- [ ] **Step 5: Remove the LIVE / OFFLINE pill**

Find the pill (around `game-control.tsx:759-768`) and remove it along with the `isConnected` `useState` (line 118) and the conditional rendering. The connection banner is the new UI.

- [ ] **Step 6: Add host visibilitychange handler**

```tsx
useEffect(() => {
  const onVis = () => {
    if (document.visibilityState === 'visible') {
      // Force-rebuild realtime channel and run a poll.
      forceReconnect();
      void poll();
    }
  };
  document.addEventListener('visibilitychange', onVis);
  return () => document.removeEventListener('visibilitychange', onVis);
}, [forceReconnect, poll]);
```

`forceReconnect` is the function that tears down and rebuilds the channel — extract it from the existing reconnect logic if not already named. While hidden, the existing polling guard (`document.visibilityState !== 'visible'` early return) already pauses polling.

- [ ] **Step 7: Verify**

Open host, toggle network in devtools off for 12s — banner appears at ~10s with Refresh button. Re-enable network — banner clears. Toggle off for 35s — page auto-refreshes at the 30s mark.

- [ ] **Step 8: Commit**

```bash
git add src/app/host/[sessionId]/[gameId]/game-control.tsx
git commit -m "feat: host connection banner replaces LIVE/OFFLINE pill"
```

---

### Task C5: Wire display + player to use connection health (and add realtime auto-reconnect)

**Files:**
- Modify: `src/app/display/[sessionId]/display-ui.tsx`
- Modify: `src/app/player/[sessionId]/player-ui.tsx`

- [ ] **Step 1: Add realtime auto-reconnect to display-ui**

In `display-ui.tsx` around the `subscribe` callback (line ~115-129), add the same exponential-backoff reconnect pattern the host already has:

```tsx
let attemptCount = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let activeChannel: ReturnType<typeof supabase.channel> | null = null;

const connect = async () => {
  if (activeChannel) {
    await supabase.removeChannel(activeChannel);
    activeChannel = null;
  }
  const channel = supabase
    .channel(`game_state_public_updates:${currentActiveGame.id}:${Date.now()}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'game_states_public',
        filter: `game_id=eq.${currentActiveGame.id}`,
      },
      (payload) => {
        // existing freshness-gated setCurrentGameState
      },
    )
    .subscribe((status) => {
      health.markRealtimeStatus(status as RealtimeStatus);
      if (status === 'SUBSCRIBED') {
        attemptCount = 0;
        return;
      }
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        if (reconnectTimer) clearTimeout(reconnectTimer);
        const delay = Math.min(1000 * Math.pow(2, attemptCount), 30000);
        attemptCount += 1;
        reconnectTimer = setTimeout(() => { void connect(); }, delay);
      }
    });
  activeChannel = channel;
};

void connect();

return () => {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (activeChannel) void supabase.removeChannel(activeChannel);
};
```

- [ ] **Step 2: Use connection-health on display-ui**

```tsx
import { useConnectionHealth } from '@/hooks/use-connection-health';
import { ConnectionBanner } from '@/components/connection-banner';

const health = useConnectionHealth();
```

In the polling success path call `health.markPollSuccess()`; on error call `health.markPollFailure()`. Render `<ConnectionBanner visible={health.shouldShowBanner} shouldAutoRefresh={health.shouldAutoRefresh} />` near the top of the JSX.

- [ ] **Step 3: Repeat for player-ui**

`player-ui.tsx` mirrors display. Use `session_updates_player` and `game_state_public_updates_player` channel names that match the existing convention.

- [ ] **Step 4: Verify**

Open `/display/<sessionId>` and `/player/<sessionId>`, toggle network for 12s — banner appears, clears on reconnect. Toggle for 35s — auto-refresh fires.

- [ ] **Step 5: Commit**

```bash
git add src/app/display/[sessionId]/display-ui.tsx src/app/player/[sessionId]/player-ui.tsx
git commit -m "feat: realtime auto-reconnect + connection banner on display/player"
```

---

### Task C6: Remove unused `currentGameStateRef`

**Files:**
- Modify: `src/app/display/[sessionId]/display-ui.tsx`
- Modify: `src/app/player/[sessionId]/player-ui.tsx`

- [ ] **Step 1: Confirm unused, then remove**

In each file, search for `currentGameStateRef`. Trace every use: today the spec says it is unused after the freshness work. If `grep` shows no readers (no `currentGameStateRef.current` access on the read side), delete the `useRef` declaration and the assignment.

If a remaining reader exists, replace the reader with the freshness-gated state value directly (the freshness helper in Wave A already handles ordering).

- [ ] **Step 2: Verify type check + tests**

```bash
npx tsc --noEmit && npm test
```

- [ ] **Step 3: Commit**

```bash
git add src/app/display/[sessionId]/display-ui.tsx src/app/player/[sessionId]/player-ui.tsx
git commit -m "refactor: remove unused currentGameStateRef from display/player"
```

---

### Task C7: Explicit select lists for `sessions` and `games` on public routes

**Files:**
- Modify: `src/app/display/[sessionId]/page.tsx` (server component that loads initial data)
- Modify: `src/app/player/[sessionId]/page.tsx`
- Modify: `src/app/display/[sessionId]/display-ui.tsx` (any client polling that re-reads sessions/games)
- Modify: `src/app/player/[sessionId]/player-ui.tsx`

- [ ] **Step 1: Replace `select('*')` on `sessions` queries**

Use:
```ts
.select('id, name, status, active_game_id')
```

- [ ] **Step 2: Replace `select('*')` on `games` queries**

Use:
```ts
.select('id, session_id, game_index, name, type, stage_sequence, background_colour, prizes, snowball_pot_id')
```

- [ ] **Step 3: Confirm no other public-route query uses `select('*')`**

```bash
grep -rn "select('\*')\|select(\"\*\")" src/app/display src/app/player
```

Expected: empty.

- [ ] **Step 4: Verify display/player still render the same fields**

Run dev. Open `/display/<sessionId>` and `/player/<sessionId>`. No regression — same fields visible.

- [ ] **Step 5: Commit**

```bash
git add src/app/display src/app/player
git commit -m "refactor: explicit select lists on sessions/games for public routes"
```

---

### Task C8: Tighten `src/proxy.ts` matcher

**Files:**
- Modify: `src/proxy.ts`

- [ ] **Step 1: Replace the matcher config**

```ts
// src/proxy.ts (matcher block at the bottom)
export const config = {
  matcher: [
    '/admin/:path*',
    '/host/:path*',
    '/login',
  ],
};
```

Public routes — `/display/:path*`, `/player/:path*`, `/api/setup`, Next internals (`/_next/:path*`), and static assets — are now excluded. Keep the rest of the file (the `updateSession()` invocation) unchanged.

- [ ] **Step 2: Verify auth still works on protected routes**

Run dev. In a private window, navigate to:
- `/admin` → redirected to `/login`.
- `/host` → redirected to `/login`.
- `/display/<sessionId>` → loads without redirect (public).
- `/player/<sessionId>` → loads without redirect.

- [ ] **Step 3: Commit**

```bash
git add src/proxy.ts
git commit -m "refactor: limit auth-refresh proxy to admin/host/login routes"
```

---

## Wave D — Polish, accessibility, and documentation

### Task D1: Strict claim-validation stage check (TDD)

**Files:**
- Create: `src/lib/win-stages.ts`
- Test: `src/lib/win-stages.test.ts`
- Modify: `src/app/host/actions.ts`
- Modify: `src/app/host/[sessionId]/[gameId]/game-control.tsx`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/win-stages.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getRequiredSelectionCountForStage, REQUIRED_SELECTION_COUNT_BY_STAGE } from './win-stages.ts';

test('Line returns 5', () => assert.equal(getRequiredSelectionCountForStage('Line'), 5));
test('Two Lines returns 10', () => assert.equal(getRequiredSelectionCountForStage('Two Lines'), 10));
test('Full House returns 15', () => assert.equal(getRequiredSelectionCountForStage('Full House'), 15));
test('unknown stage returns null', () => {
  // @ts-expect-error - intentionally invalid input
  assert.equal(getRequiredSelectionCountForStage('Bogus'), null);
});
test('map is exhaustive over WinStage', () => {
  // Compile-time check: extending WinStage without adding to the map will fail tsc.
  assert.equal(Object.keys(REQUIRED_SELECTION_COUNT_BY_STAGE).length, 3);
});
```

- [ ] **Step 2: Run to verify failure**

`npm test -- src/lib/win-stages.test.ts` → FAIL.

- [ ] **Step 3: Implement the helper**

```ts
// src/lib/win-stages.ts
import type { WinStage } from '@/types/database';

export const REQUIRED_SELECTION_COUNT_BY_STAGE: Record<WinStage, number> = {
  Line: 5,
  'Two Lines': 10,
  'Full House': 15,
};

export function getRequiredSelectionCountForStage(stage: string): number | null {
  return Object.prototype.hasOwnProperty.call(REQUIRED_SELECTION_COUNT_BY_STAGE, stage)
    ? REQUIRED_SELECTION_COUNT_BY_STAGE[stage as WinStage]
    : null;
}
```

- [ ] **Step 4: Replace existing helper usage**

In `src/app/host/actions.ts` find the existing `getRequiredSelectionCountForStage` (or inline 5-fallback) and replace with the import from `@/lib/win-stages`. In `validateClaim`, when the helper returns `null`, return `{ success: false, error: 'Stage not valid for this game' }`.

In `game-control.tsx` replace any local stage→count map with the same import.

- [ ] **Step 5: Run tests + manual verify**

```bash
npm test
```

Manually inject a claim for an unknown stage via devtools and confirm the rejection.

- [ ] **Step 6: Commit**

```bash
git add src/lib/win-stages.ts src/lib/win-stages.test.ts src/app/host/actions.ts src/app/host/[sessionId]/[gameId]/game-control.tsx
git commit -m "feat: strict stage validation in claim helper"
```

---

### Task D2: `log-error` helper (TDD)

**Files:**
- Create: `src/lib/log-error.ts`
- Test: `src/lib/log-error.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/log-error.test.ts
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { logError } from './log-error.ts';

test('redacts UUIDs from messages', () => {
  const calls: unknown[][] = [];
  const spy = mock.method(console, 'error', (...args: unknown[]) => { calls.push(args); });
  process.env.LOG_ERRORS = 'true';
  logError('test', new Error('failed for user 7c2c1d6e-7e5b-4d9d-9f8c-2e8c5a2b1f30'));
  spy.mock.restore();
  assert.equal(calls.length, 1);
  const message = (calls[0][1] as Error).message;
  assert.match(message, /\[redacted-uuid\]/);
});

test('no-op in production unless LOG_ERRORS=true', () => {
  const calls: unknown[][] = [];
  const spy = mock.method(console, 'error', (...args: unknown[]) => { calls.push(args); });
  process.env.NODE_ENV = 'production';
  delete process.env.LOG_ERRORS;
  logError('test', new Error('boom'));
  spy.mock.restore();
  assert.equal(calls.length, 0);
});
```

- [ ] **Step 2: Run, expect failure**

`npm test -- src/lib/log-error.test.ts` → FAIL.

- [ ] **Step 3: Implement**

```ts
// src/lib/log-error.ts
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

export function logError(scope: string, err: unknown): void {
  if (process.env.NODE_ENV === 'production' && process.env.LOG_ERRORS !== 'true') {
    return;
  }
  const safe = err instanceof Error ? new Error(err.message.replace(UUID_RE, '[redacted-uuid]')) : err;
  console.error(`[${scope}]`, safe);
}
```

- [ ] **Step 4: Pass tests + replace noisy console calls**

```bash
npm test -- src/lib/log-error.test.ts
```

Then sweep production code paths and replace `console.error(...)` / `console.warn(...)` with `logError('scope', err)`:
- `src/app/host/dashboard.tsx`
- `src/app/host/[sessionId]/[gameId]/page.tsx`
- `src/app/admin/snowball/actions.ts`
- Player + display poll-timeout warns.

Run `grep -rn "console.error\|console.warn" src/app/` after the sweep — anything remaining should be a deliberate development aid (rare).

- [ ] **Step 5: Commit**

```bash
git add src/lib/log-error.ts src/lib/log-error.test.ts src/app/
git commit -m "feat: add log-error helper and sweep noisy console calls"
```

---

### Task D3: Modal accessibility

**Files:**
- Modify: `src/components/ui/modal.tsx`

- [ ] **Step 1: Add focus trap and focus return**

```tsx
import { useEffect, useRef } from 'react';

function useFocusTrap(open: boolean, container: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    if (!open || !container.current) return;
    const root = container.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const focusable = () =>
      Array.from(
        root.querySelectorAll<HTMLElement>(
          'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
    const items = focusable();
    items[0]?.focus();
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        (root.querySelector<HTMLButtonElement>('[data-modal-close]'))?.click();
        return;
      }
      if (e.key !== 'Tab') return;
      const list = focusable();
      if (list.length === 0) return;
      const first = list[0];
      const last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handler);
    return () => {
      document.removeEventListener('keydown', handler);
      previouslyFocused?.focus?.();
    };
  }, [open, container]);
}
```

- [ ] **Step 2: Apply to the modal container**

In `Modal`, ensure:
- Wrapper has `role="dialog"`, `aria-modal="true"`, `aria-labelledby={titleId}` (use `useId()` if not already present).
- The close button is `<button type="button" data-modal-close aria-label="Close" className="p-2.5 ...">…`.
- The component invokes `useFocusTrap(isOpen, containerRef)`.

- [ ] **Step 3: Verify**

Open any modal in dev. Tab cycles through the modal's focusable elements only. Escape closes. Close button is at least 44px tall.

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/modal.tsx
git commit -m "feat: focus trap, escape close, and 44px close button on Modal"
```

---

### Task D4: Button `sm` size to 40px

**Files:**
- Modify: `src/components/ui/button.tsx`

- [ ] **Step 1: Bump `sm` size**

Replace the `sm` variant token from `h-8 px-3 text-xs` to `h-10 px-3 text-sm`.

- [ ] **Step 2: Sweep call sites for `className="h-8"` overrides on buttons**

```bash
grep -rn "h-8" src/ --include="*.tsx"
```

For each match where the parent is a `<Button size="sm">` (or similar), remove the override unless the size is intentionally below 40px for non-touch contexts.

- [ ] **Step 3: Verify**

Open a page with sm buttons; visually confirm they are at least 40px tall on mobile widths.

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/button.tsx src/
git commit -m "fix: bump sm button to 40px to meet touch target rule"
```

---

### Task D5: Initial loading skeletons (player + display)

**Files:**
- Modify: `src/app/player/[sessionId]/player-ui.tsx`
- Modify: `src/app/display/[sessionId]/display-ui.tsx`

- [ ] **Step 1: Track first-load state**

Add `const [hasLoaded, setHasLoaded] = useState(false);`. Set to `true` after the first successful realtime payload OR poll response that yields a usable game state.

- [ ] **Step 2: Render skeleton until first load**

```tsx
if (!hasLoaded) {
  return (
    <div className="flex h-screen items-center justify-center text-muted-foreground">
      <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-current mr-3" />
      Connecting to game…
    </div>
  );
}
```

- [ ] **Step 3: Verify**

Hard-reload the page on slow throttling. The "Connecting to game…" indicator appears for the first 1–2 seconds, then the live UI replaces it.

- [ ] **Step 4: Commit**

```bash
git add src/app/player/[sessionId]/player-ui.tsx src/app/display/[sessionId]/display-ui.tsx
git commit -m "feat: connecting skeleton on player + display first load"
```

---

### Task D6: Remove signup mode from login UI

**Files:**
- Modify: `src/app/login/page.tsx` (or the file containing the login form)

- [ ] **Step 1: Find the file**

```bash
grep -rln "Sign Up\|signUp\|signup" src/app/login/
```

- [ ] **Step 2: Remove the toggle and signup form**

Delete the segmented control / link that switches to "Sign Up". Remove the signup form JSX and any state controlling the mode. Keep the password reset link if present.

- [ ] **Step 3: Server-side cleanup**

If `signup()` server action is exported and unused after this change, leave it in place — staff invites may still depend on it. Do not remove the action.

- [ ] **Step 4: Verify**

Navigate to `/login`. Only the sign-in form is visible. No "Sign Up" link or button.

- [ ] **Step 5: Commit**

```bash
git add src/app/login/page.tsx
git commit -m "refactor: remove dead Sign Up mode from login UI"
```

---

### Task D7: Game deletion guards + typed-confirm modal

**Files:**
- Modify: `src/app/admin/sessions/[id]/actions.ts`
- Modify: `src/app/admin/sessions/[id]/session-detail.tsx`

- [ ] **Step 1: Server-side guard in `deleteGame`**

```ts
export async function deleteGame(input: { gameId: string; sessionId: string }) {
  // ...auth + role check...
  const { data: gs } = await supabaseAdmin
    .from('game_states')
    .select('status')
    .eq('game_id', input.gameId)
    .maybeSingle();

  if (gs && gs.status !== 'not_started') {
    return { error: `Cannot delete a game with status ${gs.status}` };
  }

  const { count } = await supabaseAdmin
    .from('winners')
    .select('id', { count: 'exact', head: true })
    .eq('game_id', input.gameId);

  if ((count ?? 0) > 0) {
    return { error: 'Cannot delete a game that has recorded winners' };
  }

  // ...existing delete...
}
```

- [ ] **Step 2: Client typed-confirm modal**

Wrap the existing one-click delete with a Modal that:
- Shows `Delete game "<name>"?` and a typed-confirmation input requiring the game name.
- Disables the Delete button until the typed value matches.
- Calls `deleteGame` only on confirm.

- [ ] **Step 3: Verify**

Try deleting a not-started game with the wrong typed name → button stays disabled. Type the exact name → delete succeeds. In-progress and completed games show an inline "Cannot delete" state from the server.

- [ ] **Step 4: Commit**

```bash
git add src/app/admin/sessions/[id]/actions.ts src/app/admin/sessions/[id]/session-detail.tsx
git commit -m "feat: typed-confirm + server guard on game deletion"
```

---

### Task D8: Session deletion guards + typed-confirm modal

**Files:**
- Modify: `src/app/admin/actions.ts`
- Modify: `src/app/admin/page.tsx` (or the session-list page that exposes delete)

- [ ] **Step 1: Server guard in `deleteSession`**

Reject deletion if any game in the session has a `game_states.status` other than `not_started`, OR if any winner row references the session:

```ts
const { data: bad } = await supabaseAdmin
  .from('game_states')
  .select('status, games!inner(session_id)')
  .eq('games.session_id', input.sessionId)
  .neq('status', 'not_started')
  .limit(1);

if (bad && bad.length > 0) {
  return { error: 'Cannot delete a session with started or completed games' };
}

const { count: winnerCount } = await supabaseAdmin
  .from('winners')
  .select('id', { count: 'exact', head: true })
  .eq('session_id', input.sessionId);

if ((winnerCount ?? 0) > 0) {
  return { error: 'Cannot delete a session that has recorded winners' };
}
```

- [ ] **Step 2: Typed-confirm modal**

Same pattern as Task D7 but for session name.

- [ ] **Step 3: Verify + commit**

```bash
git add src/app/admin/actions.ts src/app/admin/page.tsx
git commit -m "feat: typed-confirm + server guard on session deletion"
```

---

### Task D9: Reset session typed-confirm

**Files:**
- Modify: `src/app/admin/actions.ts`
- Modify: the admin page that exposes `resetSession`.

- [ ] **Step 1: Update the action signature**

```ts
export async function resetSession(input: { sessionId: string; confirmationText: string }) {
  // ...auth + role check...
  const { data: session } = await supabaseAdmin
    .from('sessions')
    .select('id, name')
    .eq('id', input.sessionId)
    .single();
  if (!session) return { error: 'Session not found' };

  if (input.confirmationText !== 'RESET' && input.confirmationText !== session.name) {
    return { error: 'Type RESET or the session name to confirm' };
  }
  // ...existing destructive deletes (game_states, called_numbers if any, winners)...
}
```

- [ ] **Step 2: UI prompt**

Modal listing exactly what will be deleted ("game states, winners, snowball history if any") with a typed-confirmation input. Button is disabled until the input matches `RESET` or the session name.

- [ ] **Step 3: Verify + commit**

```bash
git add src/app/admin/actions.ts src/app/admin/page.tsx
git commit -m "feat: typed-confirm reset session"
```

---

### Task D10: Documentation drift

**Files:**
- Modify: `AGENTS.md`
- Modify: `CLAUDE.md`
- Modify: `README.md`
- Modify: `docs/architecture/overview.md`
- Modify: `docs/architecture/routes.md`
- Modify: `docs/architecture/relationships.md`
- Modify: `docs/architecture/data-model.md`
- Modify: `.env.example`

- [ ] **Step 1: Correct app description**

In `AGENTS.md`, `CLAUDE.md`, and `README.md`, replace any "BingoBlast / digital cards / 75-ball / QR join / nosleep / react-player / audio announcements" content with the actual model:

- 90-ball pub bingo control system for The Anchor.
- Roles: admin (`/admin`), host (`/host`, `/host/[sessionId]/[gameId]`), public TV display (`/display`, `/display/[sessionId]`), public mobile follower (`/player/[sessionId]`).
- No digital tickets or card marking.
- Auth proxy is `src/proxy.ts` (Next.js 16), not `middleware.ts`.

In `README.md`, replace any Bootstrap / React-Bootstrap mention with the actual stack: Tailwind CSS + local UI components in `src/components/ui/`.

- [ ] **Step 2: Architecture docs**

Update `docs/architecture/overview.md`, `routes.md`, `relationships.md`, `data-model.md` to reflect:
- `state_version` column on `game_states` and `game_states_public`.
- `src/proxy.ts` matcher list.
- Public vs auth route split.
- New helpers (`isFreshGameState`, `useConnectionHealth`, `validateGamePrizes`, `getRequiredSelectionCountForStage`, `logError`).

- [ ] **Step 3: `.env.example`**

Add at the bottom:

```
# Used as a fallback for production join URLs when request headers are unavailable.
# Set to the public origin, e.g. https://bingo.theanchor.pub
NEXT_PUBLIC_SITE_URL=
```

- [ ] **Step 4: Commit**

```bash
git add AGENTS.md CLAUDE.md README.md docs/architecture/ .env.example
git commit -m "docs: correct app description, architecture, and env example"
```

---

## Final verification

### Task V1: Full lint + tests + build

- [ ] **Step 1: Run the verification pipeline**

```bash
npm run lint
npm test
npm run build
```

Expected: zero lint errors, all tests passing, successful production build. If `PATH` is broken locally, prepend `/usr/bin/env PATH=/bin:/usr/bin:/usr/local/bin:/opt/homebrew/bin`.

- [ ] **Step 2: Run the manual smoke test from the spec**

Execute the 10-step manual test in `docs/superpowers/specs/2026-04-30-live-event-reliability-design.md` §14 against a local dev server (or Vercel preview if a PR is open). Document any failures and resolve before promoting.

- [ ] **Step 3: Run the prize audit**

```bash
psql "$SUPABASE_DB_URL" -f scripts/audit-missing-prizes.sql
```

(Or paste the file contents into the Supabase SQL editor.) Expected: empty result. Fix flagged rows in admin if any.

- [ ] **Step 4: Pre-promote check**

```sql
select s.id, s.name, gs.status
from public.sessions s
join public.games g on g.session_id = s.id
join public.game_states gs on gs.game_id = g.id
where s.status = 'running' and gs.status = 'in_progress';
```

Expected: empty. If a live event is in progress, do not promote — wait for it to finish.

- [ ] **Step 5: Open PR and ship**

Create a PR with a body summarising waves A–D, link to the spec, and list the manual smoke-test results. Do not force-push to main.
