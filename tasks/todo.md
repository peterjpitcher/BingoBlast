# Guest display, claims, lifecycle and events: implementation plan

> **For agentic workers:** execute task by task, in order. Each task is done by one subagent and then checked by the orchestrator. Steps use checkboxes for tracking.

**Goal:** Build spec version 2 (slices S0, S1, S2, S6, S3, S4, S5) on the branch `feat/guest-display`, with one or more commits per task. Production migrations and deployment are out of scope; they need the owner's explicit yes.

**Architecture:**
- Database invariants (lifecycle, claims, money) live in `security definer` RPCs, called with the cookie client, with locks taken in session-then-game-state order.
- The public screens derive everything from public rows through pure, tested helpers in `src/lib`.
- Events come from one cached server-side projection of the management API.

**Tech stack:** Next.js 16.3 (the `proxy.ts` convention), React 19.2, Tailwind v4, Supabase (`@supabase/ssr`), zod, `qrcode.react`, and the Node test runner (`node --test --import tsx`).

**Spec:** `tasks/spec-2026-09-30-guest-display-and-events-design.md`. It is the source of truth; read the section named in each task before starting.

## Global constraints

- **Project rules.** Read `CLAUDE.md` in full first. It covers the business and security rules, the gotchas, `ActionResult<T>` and the cookie-client rule.
- **No em dashes** (U+2014) anywhere: code, comments, copy, commit messages. British English in all UI copy.
- **Dates:** only through `src/lib/dates.ts`, in Europe/London. Never bare `toLocale*`, `getDay`, `getHours` or `toISOString().slice` for user-facing dates.
- **Updates must be proved to land.** Every `.update()` needs `.select()`, and zero rows is an error, unless it is replaced by an RPC.
- **Every new function:**
  - `security definer`, with `set search_path = public, pg_catalog`
  - a role guard (`assert_is_host()` or `assert_is_admin()`)
  - `revoke all on function ... from public, anon;` then `grant execute on function ... to authenticated, service_role;`
  - added to the function allowlist in `supabase/tests/replay.test.sql`
- **Migration files:** named `supabase/migrations/2026100100XXXX_<name>.sql`, with increasing timestamps. Never use an enum value in the migration that adds it. Update `supabase/tests/harness-schema.sql` wherever it copies the changed schema. Add a function rollback script under `supabase/rollback/<same name>.rollback.sql`.
- **Types:** `src/types/database.ts` is hand-written. Update Row, Insert and Update for every new column, and `Functions` for every new RPC.
- **Tests:** new pure logic gets `src/lib/*.test.ts`. They must pass under `npm test` (London time) and `npm run test:utc` (UTC).
- **Gate for every task:** `npm run lint`, `npm run typecheck`, `npm test` and `npm run test:utc`. Tasks that touch SQL also run `npm run test:db` (Docker is running; the harness is `supabase/tests/run.sh`). The slice's last task also runs `npm run build`.
- **Never** hit the production database, deploy, or push. The orchestrator pushes.
- **Never** put the object from `useConnectionHealth()` in a dependency array. Destructure its functions.
- **Copy** is exactly as written in the spec, where the spec gives it.


## Execution waves (orchestrator)

**Migration order is M1, M2a, M3, M2b** (spec 7). M1, M2a and M3 are compatible with the live host screen; M2b goes last.

- **Wave 1, in parallel:**
  - **A1 reliability:** S0.1 to S0.7. Owns `src/**` except `src/types/database.ts`, plus `next.config.ts` and `.env.example`.
  - **A2 database:** S1.1, S2.1, S6.1, then S2.2, in that order. Owns `supabase/**` and `src/types/database.ts`.
  - **A3 local stack:** a scratchpad Supabase project plus seed data. Owns the scratchpad and `.claude/launch.json` only.
- **Wave 2, in parallel:**
  - **B1 host side:** S1.2, S1.4 (host part), S2.3, S2.4 and S6.2. Owns `src/app/host/**`, `src/app/admin/**`, `src/lib/claim-draft-queue*` and `src/lib/money*`.
  - **B2 public side:** S1.3, S1.4 (display part), S2.5, S3.1 and S3.2. Owns `src/app/{display,player,play}/**`, `src/components/display/**`, and the listed new `src/lib` files plus `house-rules` and `dates`.
- **Wave 3:** S4.1 and S4.2 (events and review).
- **Wave 4:** S5.1 (text sizes and readability).

---

## S0 Reliability (no schema)

### Task S0.1: shared realtime connector (X1, X12c)
- [x] Create `src/lib/realtime-connector.ts`, a framework-free controller: `createRealtimeConnector({ client, topicPrefix, build, onStatus, onGiveUp?, setTimer, clearTimer })` returns `{ connect(), reconnect(), dispose() }`. It keeps a generation counter; every subscribe callback captures its generation and returns early if that generation is not current. Before `client.removeChannel(old)` it clears the reference and bumps the generation. At most one timer is pending. Backoff runs 1s, 2s, 4s up to 30s, and resets on `SUBSCRIBED`.
- [x] Create `src/hooks/use-realtime-channel.ts`: `useRealtimeChannel({ supabase, key, enabled, build, onStatus })` returns `{ reconnect }`, and disposes on unmount or key change.
- [x] Tests in `src/lib/realtime-connector.test.ts`, with a fake client:
  1. `removeChannel` fires CLOSED **synchronously**; there is no re-entry and at most one timer.
  2. The old channel's CLOSED arrives **after** the new one subscribes; the new channel is not removed and no timer is set.
  3. `dispose()` cancels the timer and removes the channel.
  4. `reconnect()` during a pending timer replaces the timer.
  5. Backoff grows and resets.
- [x] Replace the hand-rolled channel code in:
  - `game-control.tsx` (~533-578)
  - `display-ui.tsx` (sessions ~225-268, `game_states_public` ~292-339, pot ~484-523)
  - `player-ui.tsx` (the matching blocks, including the pot at ~360-399)

  Keep the existing `markRealtimeStatus` wiring and the reconnect-on-visible behaviour. Pot subscriptions check the pot id.
- [x] Commit `fix(realtime): one guarded connector so channels stop churning after a reconnect`.

### Task S0.2: public poll robustness and coherent snapshots (X12a, X12b, X12g, spec 5.8)
- [x] Create `src/lib/poll-runner.ts`: `createPollRunner({ run: (signal) => Promise<T>, deadlineMs = 8000 })` returns `{ start(): { seq, promise }, isCurrent(seq), invalidate() }`.
  - Every run gets an AbortController aborted at the deadline, and the in-flight flag is released on abort.
  - `invalidate()` bumps the sequence so older responses are discarded.
  - Tests cover: the deadline releases the flag, a stale response is discarded, and `invalidate` after a Realtime event discards the in-flight poll.
- [x] On the TV and phone polls, use the runner. A Realtime payload calls `invalidate()` before applying.
- [x] A game switch fetches the new game's state **before** setting the new game (both screens).
- [x] A single failed poll no longer switches a pre-game screen to the full-screen reconnecting state. The full-screen failed state needs the same 10-second unhealthy window as `ConnectionBanner` (reuse `connection-health.ts` thresholds). Apply to both screens.
- [x] Commit `fix(public): bounded polls, stale-response guard and switch-safe game changes on TV and phone`.

### Task S0.3: clock offset for the reveal delay (X12d)
- [x] Create `src/app/api/time/route.ts`: `GET` returns `{ now: Date.now() }` with `Cache-Control: no-store` and `dynamic = 'force-dynamic'`.
- [x] Create `src/lib/clock-offset.ts`:
  - `computeClockOffset(samples: { t0: number; t1: number; server: number }[]): number` uses the sample with the lowest `t1 - t0` and returns `offset = server - (t0 + t1) / 2`.
  - `createClockOffsetSampler(fetchNow)` takes 3 samples on load and every 10 minutes, and keeps the last good offset (0 before the first).
  - Test both.
- [x] `reveal-queue.ts`: take `nowMs` from `Date.now() + offset`, and clamp both directions: a ball whose `last_call_at` is in the future relative to corrected now is treated as just called. The reveal pause uses `performance.now()`. Update `reveal-queue.test.ts` with fast and slow clock cases.
- [x] Wire the sampler into the TV and phone.
- [x] Commit `fix(reveal): correct the public reveal delay for TV clocks that run fast`.

### Task S0.4: build check and self-reload (X12h, spec 5.8)
- [x] `next.config.ts`: `env: { NEXT_PUBLIC_BUILD_ID: process.env.VERCEL_GIT_COMMIT_SHA ?? 'dev' }`.
- [x] Create `src/app/api/build/route.ts`: `GET` returns `{ build: process.env.VERCEL_GIT_COMMIT_SHA ?? 'dev' }`, with no-store.
- [x] Create `src/lib/build-check.ts`: `decideBuildAction({ clientBuild, serverBuild, mode: 'auto' | 'prompt', safe: boolean }): 'none' | 'reload' | 'prompt' | 'wait'`. The `'dev'` build never triggers anything. Tests.
- [x] Create `src/hooks/use-build-check.ts`: checks every 5 minutes and on `visibilitychange` to visible.
  - **TV and phone:** `mode 'auto'`. Safe means not `paused_for_validation` and no `display_win_type`.
  - **Host:** `mode 'prompt'`. Shows a banner, "A new version is ready" with a **Reload** button, and never reloads itself. The banner is held back while a claim modal is open.
- [x] Commit `feat: long-lived screens pick up new releases at a safe moment`.

### Task S0.5: environment validation (X21)
- [x] Create `src/lib/env.ts`:
  - `getPublicSupabaseEnv()` returns `{ url, anonKey }` and throws a clear error if either is missing.
  - `validateBuildEnv()` checks the Supabase variables; checks `NEXT_PUBLIC_SITE_URL` is an https origin when set; and, when `process.env.VERCEL_ENV === 'production'` and `EVENTS_FEED_REQUIRED` is true (a module constant, **false in S0**, set true in S4), requires `ANCHOR_API_KEY`.
  - Tests with a stubbed `process.env`.
- [x] Call `validateBuildEnv()` from `next.config.ts` so it runs at build.
- [x] Use `getPublicSupabaseEnv()` in `src/utils/supabase/{client,server,middleware}.ts`.
- [x] Add `LOG_ERRORS`, `ANCHOR_API_KEY`, `ANCHOR_API_BASE_URL` and `NEXT_PUBLIC_REVIEW_INVITE_ENABLED` to `.env.example`, with comments.
- [x] Commit `chore: validate environment at build time`.

### Task S0.6: host fixes (X2, X8, X15, X18)
- [x] **X2:** capture the expected stage index when the Post Win or skip modal opens (a `useRef` set on open), and use it for every retry until a definite success or refusal. Remove the copy that says retrying is safe if it is no longer accurate.
- [x] **X8:** in `src/app/host/[sessionId]/[gameId]/page.tsx`, only PGRST116 (no rows) returns `notFound()`. Any other read error renders a retry screen ("Could not load the game. Retry"), like the public pages. It never redirects to `/host` or `/pending` on a transient error.
- [x] **X15:** reset the manual snowball prefill on cancel and whenever Record Winner opens.
- [x] **X18:** in `src/app/host/dashboard.tsx`, Start, Resume and Re-open get a busy state ("Starting…") with double-tap protection. Replace `alert()` and `confirm()` with in-app error text and the existing `Modal`.
- [x] Commit `fix(host): stage retries keep their expectation, no 404 on a blip, no double start`.

### Task S0.7: public and money fixes (X12e, X12f, X13 TypeScript part, X19, X20)
- [x] **X13:** `src/lib/money.ts` gets `formatPoundsAmount(value: number): string`, returning "£212.50", "£1,250", "£1,250.50" and "£0".
  - `formatPounds` in `snowball.ts` delegates to it.
  - Update `snowball.test.ts:67` and add cases.
  - Route the raw values at `snowball-list.tsx:166`, `:172`, `:175` and `session-detail.tsx:701` through it.
- [x] **X12e:** "Prize not set" only on the host screen. The TV and phone hide the prize line when it is empty.
- [x] **X12f:** truncate the TV top bar names to one line (`truncate` with `min-w-0`).
- [x] **X19:** create `src/lib/venue-links.ts` with `export const KITCHEN_OPEN_UNTIL = '9pm'` and a comment naming the source ("owner, 30 September 2026"). The TV reads it.
- [x] **X20:** in `src/app/admin/actions.ts:147`, use `getTodayIsoDateInLondon()`.
- [x] Run `npm run build`.
- [x] Commit `fix: money shows pence properly, tidy public copy, London date for copies`.

---

## S1 Lifecycle (migration M1)

### Task S1.1: migration M1 and database tests
- [x] Create `supabase/migrations/20261001075034_night_lifecycle.sql`:
  - **Session columns:** `sessions.started_at timestamptz`, `completed_at timestamptz`, `state_version bigint not null default 0`.
  - **Session trigger:** `sessions_lifecycle_stamp` (`before update`):
    - bumps `state_version`;
    - on a transition to `completed`, sets `completed_at = coalesce(new.completed_at, now())`;
    - on a transition away from `completed`, sets `completed_at = null`.
  - **Backfill:** `update sessions s set started_at = x.min_started from (select g.session_id, min(gs.started_at) min_started from games g join game_states gs on gs.game_id = g.id group by 1) x where s.id = x.session_id and s.started_at is null;` Record the row count in a `raise notice`.
  - **`start_game(p_game_id uuid, p_number_sequence integer[] default null) returns public.game_states`**, per spec 5.1:
    - lock the session `for update` first, then `game_states` `for update`;
    - errors (`raise exception` with a stable message key mapped in TypeScript): `night_ended`, `other_game_in_progress`, `invalid_sequence` (not a permutation of 1 to 90), `not_authorised`;
    - on a new state row, `controlling_host_id = auth.uid()`;
    - a takeover sets the controller to `auth.uid()`;
    - a re-open sets `status = 'in_progress'`, `ended_at = null`, clears the pause, break, win and claim fields, and keeps the stage;
    - then sets the session to `running`, sets `active_game_id`, and sets `started_at = coalesce(started_at, now())`.
  - **`finish_game(p_game_id uuid) returns jsonb`**, returning `{ game_state, session_completed }`, per spec 5.1. Idempotent.
  - **`end_night(p_session_id uuid) returns public.sessions`**, per spec 5.1. Idempotent. Refuses with `game_in_progress`.
  - **`reset_session_safe`:** redefine with `started_at = null` added. Copy the current body from its latest migration exactly.
  - Grants per the global constraints.
- [x] Rollback script (drop the three functions, restore the previous `reset_session_safe` body).
- [x] Harness: add the columns and trigger to `harness-schema.sql` if it models `sessions`, and the functions to the replay allowlist.
- [x] SQL tests following the existing suite style in `supabase/tests/`:
  - start on a completed night is refused;
  - a second game cannot start while one is in progress;
  - the first start sets `started_at` and a re-open keeps it;
  - reset clears `started_at` and `completed_at`;
  - finishing the last game completes the session and stamps `completed_at`;
  - a repeated `end_night` keeps the first `completed_at`;
  - `end_night` refuses while a game is in progress;
  - anon and pending cannot execute any of the three functions;
  - the backfill is safe to rerun.

  Add a two-connection race test if the harness allows it: psql in the background holding the session lock with `pg_sleep`, then assert the second call waits and then refuses. Otherwise document why not.
- [x] Commit `feat(db): night lifecycle functions with session-first locking`.

### Task S1.2: host and admin actions use the lifecycle RPCs (X9, X10, X11)
- [x] `startGame` keeps its checks and the cash-jackpot prize logic. It generates the sequence in TypeScript and calls `start_game` with the **cookie client**. Remove the service-role write client and its silent fallback.
- [x] `endGame`, the final-stage paths of `advanceToNextStage` and `skipStage`, `moveToNextGameAfterWin` and `moveToNextGameOnBreak` use `finish_game`. Snowball settlement stays after it. Remove `maybeCompleteSession`.
- [x] Add `endNight(sessionId)`, which calls `end_night`.
- [x] Map the new error keys to codes in `ActionResult`.
- [x] Admin `updateSessionStatus` gets `.select()` with zero rows treated as an error.
- [x] Update `src/types/database.ts`.
- [x] Update `CLAUDE.md`: the service role is now only for `/api/setup`, plus the lifecycle functions.
- [x] Commit `refactor(host): lifecycle writes go through start_game, finish_game and end_night`.

### Task S1.3: night phase, session selectors and phase copy
- [x] Create `src/lib/night-phase.ts`, `getNightPhase({ session, activeGameState }): 'night_over' | 'in_game' | 'before_start' | 'between_games'`, with the precedence from spec 5.1, plus an `inGameSubState` helper. Tests cover every row of the precedence table and the edge cases (an empty completed session, completed with unplayed games, "Start Session" with no game).
- [x] Create `src/lib/public-selectors.ts` with `PUBLIC_SESSION_COLUMNS` and `PUBLIC_GAME_STATE_COLUMNS`. Replace the four copies of each.
- [x] Session snapshots apply only if `state_version >= current` on both screens (a helper `isFreshSession`, tested).
- [x] TV and phone copy by phase. `between_games` shows "Next game coming up", with the next game's name and colour when known; the phone says the same.
- [x] Commit `feat(public): screens know the phase of the night`.

### Task S1.4: `/display` routing, end of night, wake lock, End the night (5.8, A3)
- [x] Create `src/lib/session-resolution.ts`, `resolveDisplaySession(sessions, nowLondonDate, { includeTest })`: `{ kind: 'one', id } | { kind: 'none' } | { kind: 'many', ids }`. A session qualifies if `running`, or `ready` with `start_date <= today` in London. Test sessions only count when `includeTest`. Tests.
- [x] `display/page.tsx` uses it:
  - `?rehearsal=1` includes test sessions.
  - `none` renders an idle client component that re-checks every 60 seconds and navigates when one appears. The idle content is a placeholder "Bingo nights at The Anchor" until S4.
  - `many` renders a list that refreshes itself.
  - A read error renders a retrying state.
- [x] `/display/[id]` at `night_over`: stays until 04:00 London time the next morning (`src/lib/dates.ts` gets a helper, `nextLondonFourAm(fromIso)`, tested either side of 25 October), or until a different session is `running`. Then `router.replace('/display')`.
- [x] The TV calls `useWakeLock()`.
- [x] `src/app/host/dashboard.tsx` gets an **End the night** button, with a `Modal` listing unplayed games, calling `endNight`. The final-game button in the host game screen calls `finish_game` and then `end_night`.
- [x] Run `npm run build`.
- [x] Commit `feat(display): the TV follows the night and the next session by itself`.

---

## S2 Claims (migrations M2a and M2b)

### Task S2.1: migration M2a (additive claims)
- [x] Create `supabase/migrations/20261001075215_claim_attempts.sql`, per spec 5.2:
  - **Columns** on `game_states`: `claim_attempt_id uuid`, `claim_stage_index integer`, `claim_call_count integer`, `claim_draft_seq integer not null default 0`, `claim_undo_used boolean not null default false`, `claim_numbers jsonb`, and `claim_result text` with a check that it is `valid`, `invalid` or `late`.
  - **Public mirror:** `claim_numbers` and `claim_result` on `game_states_public`. Redefine `sync_game_states_public()` including them, and restate its search path and revokes.
  - **`guard_claim_fields()`** (`before update` on `game_states`):
    - when `new.paused_for_validation = false`: clear every claim field (numbers, result and attempt set to null, sequence 0, undo false, snapshots null);
    - otherwise, if any claim field differs from old and `current_setting('bingo.claim_write', true) is distinct from 'on'`, raise `claim_fields_protected`.

    Name it so it fires in the right order relative to `bump_game_state_version`; either order is fine as long as both run.
  - **`begin_claim_check`, `set_claim_draft`, `check_claim`**, exactly as spec 5.2. Each sets `perform set_config('bingo.claim_write', 'on', true)` before writing. The stage counts come from a SQL helper, `required_claim_count(stage text)` (Line 5, Two Lines 10, Full House 15). The current stage name is `games.stage_sequence ->> current_stage_index`.
  - **`void_last_number(p_game_id uuid, p_attempt_id uuid default null, p_expected_count integer default null)`:** keep the existing body for the unpaused case, and add the bound paused case with `already_undone`.
  - `record_winner_atomic` is **unchanged**.
- [x] Rollback script. Update the harness, the replay allowlist and `src/types/database.ts`.
- [x] SQL tests:
  - every code of every function;
  - a same-attempt retry is a no-op;
  - `attempt_mismatch` returns the current attempt;
  - `p_new_claimant` replaces the attempt;
  - out-of-order draft sequences are ignored;
  - duplicates are refused;
  - a verdict retry is idempotent, and `verdict_already_given` when the numbers differ;
  - `stale_attempt` after a stage change;
  - a direct update of `claim_result` is refused;
  - an unpause clears the claim;
  - the bound undo happens once;
  - the public mirror carries both new columns;
  - the SQL stage counts equal `win-stages.ts`: a test file checks the SQL helper values against a constant copied in the test, with a comment pointing at `win-stages.ts`, plus a Node test that asserts the same constant against `REQUIRED_SELECTION_COUNT_BY_STAGE`.
- [x] Commit `feat(db): claim attempts, live drafts and server verdicts`.

### Task S2.2: migration M2b (enforcement)
- [x] Create `supabase/migrations/20261001075456_claim_enforcement.sql`. It is applied **last**, after M3. Redefine `record_winner_atomic` from the **M3** body (`20261001075401_jackpot_components.sql`):
  1. the idempotency lookup stays first;
  2. for a new winner, require the valid attempt (`claim_attempt_id = p_client_request_id`, `claim_result = 'valid'`, `claim_stage_index = current_stage_index`) and re-check `claim_numbers` against `called_numbers`, including the last ball;
  3. the manual exemption needs `p_force_snowball_jackpot` and a snowball-type game and Full House and the window open;
  4. the win text is stage-specific: `LINE WINNER!`, `TWO LINES WINNER!`, `FULL HOUSE WINNER!`, or the existing snowball text;
  5. money text uses `to_char(amount, 'FM999G999G990D00')` with the trailing `.00` removed when there are no pence (match `formatPoundsAmount`).

  Keep every other behaviour: the tie split, `prize_share_pence`, the snowball window and eligibility, anonymity, and the grants.
- [x] The rollback script restores the M3 definition.
- [x] SQL tests:
  - a new winner without a valid attempt is refused;
  - with one, it is recorded;
  - an idempotent retry after the stage has advanced returns the existing row;
  - a forged manual flag on a standard game is refused;
  - a genuine manual snowball succeeds;
  - the win text per stage;
  - £212.50 formatting;
  - all existing prize and anonymity tests still pass.
- [x] Commit `feat(db): record a winner only from a checked claim`.

### Task S2.3: host actions (X4, X5, X16, X17)
- [x] New actions in `src/app/host/actions.ts`: `beginClaimCheck(gameId, attemptId, newClaimant)`, `setClaimDraft(gameId, attemptId, numbers, seq)`, `checkClaim(gameId, attemptId, numbers, rejectAsLate)` and `undoLastNumberForClaim(gameId, attemptId, expectedCount)`. All use the cookie client and return `ActionResult` with codes.
- [x] `recordWinner` takes the attempt id as `p_client_request_id`.
- [x] `resumeGame` refuses with code `stage_already_won` when a non-void winner exists at the current stage.
- [x] Delete `validateClaim` and stop calling `announceWin` from the claim path. Delete `announceWin` if it is unused.
- [x] Map the new error keys in `HOST_RPC_ERRORS`.
- [x] Commit `feat(host): claim actions built on attempts`.

### Task S2.4: host claim UI
- [x] Create `src/lib/claim-draft-queue.ts`, `createClaimDraftQueue({ send: (numbers, seq) => Promise<ok|error> })`, returning `{ push(numbers), flush(), state }`.
  - One request in flight at a time; the latest pending list wins.
  - The sequence increases monotonically; on error it retries with backoff and reports `retrying`.
  - Tests.
- [x] `game-control.tsx`:
  - **Check Claim:** mints an attempt with `crypto.randomUUID()`, calls `beginClaimCheck`, and on `attempt_mismatch` adopts the returned attempt.
  - **Taps:** push to the queue, with the claim grid in tap order.
  - **"TV not updated, retrying"** while the queue is retrying.
  - **Check Win:** calls `checkClaim`.
  - **`missing_last_ball` dialog**, with copy per spec 5.2: Yes calls `undoLastNumberForClaim`, then re-runs `checkClaim`; No calls `checkClaim` with `rejectAsLate = true`.
  - **`valid`** opens Record Winner using the attempt id.
  - **"Check another claimant"** replaces "Validate Another Winner" and calls `beginClaimCheck` with `newClaimant = true` and a fresh attempt.
  - **When `stage_already_won` is possible** (paused with a recorded winner at this stage), the pad shows **Continue to [next stage]**, calling `advanceToNextStage`, instead of Resume calling.
  - **Recovery:** on mount, or when state arrives while paused with a `claim_attempt_id`, reopen the claim modal with that attempt and `claim_numbers`.
- [x] Remove `claimRequestIdRef`: the attempt replaces it. Update the `CLAUDE.md` gotcha about the claim key to describe the attempt.
- [x] Update `docs/runbooks/live-night.md` (claims, ties, late claims, continue after a win).
- [x] Commit `feat(host): live claim entry with durable attempts`.

### Task S2.5: public claim panel
- [x] Create `src/lib/claim-panel.ts`, `getClaimPanelState({ paused, claimNumbers, claimResult, calledNumbers, stageName, requiredCount })`, returning `{ kind: 'waiting' | 'draft' | 'valid' | 'invalid' | 'late', balls: { n, called, isLast }[], headline, detail, invalidNumbers, lastNumber }`. Copy exactly per spec 5.2. Tests for every state.
- [x] Create `src/components/display/claim-panel.tsx`, used by the TV (replacing the "Checking Claim" overlay body) and the phone (replacing its claim card). Ticks and crosses are shapes (an SVG or text glyph with an aria-label), not colour only. At most 5 columns; balls at least 120px at 1920x1080 and 80px at 1280x720 on the TV.
- [x] The win overlay keeps showing the balls.
- [x] Run `npm run build`.
- [x] Commit `feat(public): the room sees each claimed number and the verdict`.

---

## S6 Money (migration M3)

### Task S6.1: migration M3
- [x] Create `supabase/migrations/20261001075401_jackpot_components.sql`, per spec 7 (M3). It sits between M2a and M2b, and must work with today's live host screen:
  - `winners.jackpot_pool_pence integer`, `jackpot_share_pence integer`;
  - `record_winner_atomic` redefined from its current body (`20260825080608_prize_amounts_and_tie_shares.sql`): the ordinary pool is parsed from the ordinary prize text before the jackpot text is appended, and the jackpot pool is set from the pot amount;
  - the recompute function or trigger shares both components (the jackpot only among non-void eligible jackpot winners at that stage; the odd penny to the earliest by `created_at`, then `id`);
  - `settle_snowball_pot` requires the game `completed` (code `game_not_completed`);
  - `set_winner_prize_given` refuses voided winners (`winner_void`);
  - the historic backfill of the jackpot pool only from settlement history rows that record the amount for that game; otherwise the value is left null.
- [x] The rollback script restores the previous bodies.
- [x] SQL tests, per spec 11: one winner, two eligible, eligible plus ineligible, jackpot only, an odd penny, a void and its recompute, the settle guard, the void guard, and an idempotent retry still working.
- [x] Commit `feat(db): jackpot money tracked as its own component`.

### Task S6.2: money screens and settlement recovery (X6, X14, X22)
- [x] Totals add both components: `src/lib/money.ts` gets the helper `winnerTotalPence(w)`, used by `admin/history/page.tsx`, `session-detail.tsx` and the host winners card. Where the jackpot is unknown, show "jackpot amount not recorded".
- [x] **X6:** every finishing path returns success plus `snowballPotDidNotSettle`. The host sees the retry banner before navigating. `src/app/host/dashboard.tsx` lists completed snowball games whose settlement is missing (use the same record `settle_snowball_pot` checks for `already_settled`), each with a **Settle** button.
- [x] **X14:** the host winners card shows a VOID badge and hides Give Prize for voided winners.
- [x] Run `npm run build`.
- [x] Commit `fix(money): jackpot totals, voided winners and a settlement retry that survives a reload`.

---

## S3 Rules and follow-along

### Task S3.1: house rules and game identity
- [x] `src/lib/house-rules.ts`: the approved rules 1 to 8 (spec 5.3); `buildSnowballRule(pot)` using `formatPoundsAmount`; `HOW_TO_WIN`. Remove the stale comment. Tests for the snowball rule text.
- [x] Show the rules on the TV (`before_start` rules slide, break, `between_games`) and in the host briefing.
- [x] The phone gets a **Rules** button (it opens a `Modal`) available in every phase. At `before_start` the rules show inline, with the line "This follows the paper game. You cannot enter or claim here."
- [x] Game identity on the TV and phone during play: "Game {n} of {total}, {Colour} book", using `getColourName`. The total comes from a count of games in the session, fetched with the game list.
- [x] Commit `feat: approved house rules everywhere and the game colour on screen`.

### Task S3.2: `/play`, site origin and the follow-along QR
- [x] Create `src/lib/site-origin.ts`, `getSiteOrigin({ env, requestOrigin })`, per spec 5.4 (explicit https override, production uses `VERCEL_PROJECT_PRODUCTION_URL`, preview uses `VERCEL_BRANCH_URL` or `VERCEL_URL`, development uses the request origin). Tests.
- [x] Create `src/lib/follow-link.ts`, `buildFollowUrl({ origin, sessionId, isUniqueSession })`, returning `${origin}/play` or `${origin}/play?s=${id}`. Tests.
- [x] Create `src/app/play/page.tsx`:
  - `?s=` must be a uuid of an existing session, then `redirect('/player/<id>')`;
  - otherwise use `resolveDisplaySession`: `one` redirects; `none` or `many` renders "No bingo running right now" (a placeholder for the events list until S4).

  It is not added to the proxy matcher.
- [x] TV:
  - the corner QR uses `buildFollowUrl`, at level M and at least 180px, with no overlap at 1280x720;
  - it is hidden at `night_over`;
  - the `before_start` screen gets the follow-along slide: QR at least 50vh, "Follow the numbers on your phone", "Point your camera at the code", and the address without the scheme.

  Create `src/lib/playlist.ts`, `buildPlaylist(phase, projection | null, now, sessionDate, opts)`, now covering the follow-along and rules slides only (events added in S4), with tests. Create `src/components/display/slide-loop.tsx`, which shows slides for their durations, pauses when hidden, and respects reduced motion.
- [x] Run `npm run build`.
- [x] Commit `feat: a permanent follow-along link and a big QR before the night`.

---

## S4 Events and review

### Task S4.1: events feed
- [x] Create `src/lib/events-feed/`:
  - `schema.ts`: zod schemas for only the fields used.
  - `client.ts`: `fetchJson(path, { timeoutMs })` with `X-API-Key`, base `ANCHOR_API_BASE_URL ?? 'https://management.orangejelly.co.uk/api'`. It throws on non-2xx, timeout or parse failure, and never logs bodies.
  - `projection.ts`: `getEventsProjection()`, per spec 5.5: the general list plus the bingo category query plus parallel details; bounded to 8 seconds; cached with `unstable_cache` (`revalidate: 300`, tag `events-projection`); a throw on failure keeps the last good value; the outer wrapper returns `{ status: 'missing_config' | 'error' }` on a cold failure and reports through `after(() => reportError(...))`.
  - `select.ts`: pure selection (drop started, dedupe by name, cap at 8, split out bingo nights).
  - `links.ts`: `eventQr(event, channel)` returns the short link when present, otherwise the id link with `utm_source` and `utm_medium`.
  - Tests for `select`, `links` and schema tolerance (a bad event is dropped alone).
- [x] Create `src/app/api/screen/events/route.ts`: no parameters; returns the projection with `Cache-Control: public, s-maxage=60, stale-while-revalidate=300`.
- [x] `next.config.ts`: `images.remotePatterns` for the bucket path only.
- [x] Set `EVENTS_FEED_REQUIRED = true` in `env.ts`, so a production build needs the key.
- [x] `src/lib/dates.ts`: `formatEventWhen(startsAtIso, nowIso)` ("Tonight", "Tomorrow", a weekday within 6 days, else "Fri 16 Oct") and `formatEventTime(startsAtIso)` ("7pm", "7:30pm"), both in Europe/London. Tests either side of 25 October.
- [x] Commit `feat(events): cached projection of upcoming events from the management app`.

### Task S4.2: carousel, phone list and review
- [x] `src/lib/venue-links.ts`: `REVIEW_URL = 'https://l.the-anchor.pub/cvf4k7'`, `WHATS_ON_URL = 'https://www.the-anchor.pub/whats-on'`, and `isReviewInviteEnabled()`, which reads `NEXT_PUBLIC_REVIEW_INVITE_ENABLED === 'true'`.
- [x] `buildPlaylist` gains the event slides, next bingo, thanks, review (only when enabled) and idle loops, per the spec 5.5 table, with tests. Clients drop started events and the bingo on their own session's date at render time, and choose `qrPre` or `qrPost` by phase.
- [x] Create `src/components/display/event-slide.tsx`: `next/image`, square images whole beside the text, a text-only fallback on error, the title clamped to 2 lines, the QR at level M and at least 40vh, and the next image preloaded. Also `review-slide.tsx`, `thanks-slide.tsx` and `next-bingo-slide.tsx`.
- [x] The TV at `before_start`, `night_over` and the idle `/display` use the slide loop. It refreshes the projection from `/api/screen/events` every 10 minutes.
- [x] Phone: at `before_start` and `night_over`, an events list ("View event" opens in a new tab with `rel="noopener noreferrer"`), plus the review button when enabled. `/play` with no session shows the list too.
- [x] Run `npm run build`.
- [x] Commit `feat: upcoming events carousel, phone list and a switchable review invitation`.

---

## S5 Readable text

### Task S5.1: size pass and readability fixes
- [x] `tailwind.config.ts`: `fontSize` tokens `tv-xs` through `tv-5xl` as `clamp()` values with pixel floors, meeting spec 5.7 (1920x1080: 32px minimum, 44px for key information; 1280x720: 22px and 30px).
- [x] Apply the tokens across `display-ui.tsx` and the display components; replace the fixed px sizes.
- [x] Phone: nothing below 14px, body 16px, values 20px.
- [x] Host: nothing below 14px, money and closing decisions 16px, buttons at least 44px.
- [x] `Input` to `text-base`; `Button` `sm` and `md` to `h-11`.
- [x] The readability fixes listed in spec 5.7: player cards, TV backing panels, reconnect banner, red host errors, claim grid marks.
- [x] In `globals.css`: a `@media (prefers-reduced-motion: reduce)` rule disabling animation and transition, and no `animate-pulse` on text blocks.
- [x] Create `scripts/check-render.js`, a function that runs in the page: it walks visible text nodes and reports any computed font size below a floor passed in, overlapping bounding boxes among elements marked `data-check-overlap`, and text containing `undefined`, `NaN` or `Invalid Date`. It is used by the orchestrator through the browser tool.
- [x] Run `npm run build`.
- [x] Commit `feat: bigger text on the TV, phones and host screen`.

---

## Orchestrator checks (not subagent tasks)

- [x] After each task: read the diff, and run the gate plus `test:db` where there is SQL.
- [x] After S1, S2 and S4: browser run-through on the local Supabase stack (`scratchpad/localstack`) with every migration applied.
- [x] At the end: stacked slice branches at the commit boundaries, pushed, with PRs opened (docs, then S0, S1, S2, S6, S3, S4, S5).
- [x] Report to the owner.

## Results (1 October 2026)

**All seven slices are built on `feat/guest-display`.** Production migrations and deployment have not happened; they wait for the owner's yes (spec section 12).

### Verification

The branch tip was checked in a clean worktree:
- `npm run lint` (zero warnings) and `npm run typecheck`: clean.
- `npm test` and `npm run test:utc`: 430 tests, 429 pass, 1 skipped (the live anon check, which needs a database URL).
- Production build with CI's placeholder env: passes.
- `npm run test:db`: ALL PASS, run twice. Suite A, 71 grant assertions, 317 + 317 replay assertions over 49 migrations under production and current Supabase defaults, and 24 staged release and rollback assertions.
- S0 checked alone at `43af9b7`: lint, types, 180 tests, build, and test:db over the original 45 migrations all pass.

### Browser run-through

On a local Supabase stack with all four migrations applied, signed in as a host (not an admin):
- The TV before the start showed the follow-along QR at 540px, half the screen, with no text under 32px at 1920x1080.
- A live claim appeared on the TV as each number was tapped, including a mis-tap and its correction.
- The valid verdict showed "All 5 numbers have been called. The caller is checking the ticket."
- Recording the win showed LINE WINNER! with the balls.
- A second claimant with an uncalled number showed "Not a winner this time: 61 has not been called."
- After a win, Resume is replaced by Finish this game, or Continue to Two Lines.
- Move to Next Game worked.
- The missing-last-number dialog's single undo worked: calls went from 6 to 5, the claim re-checked as valid, and the TV showed no verdict in between.
- A reload mid-claim reopened the same attempt, and the win recorded once.
- Between games showed "Next game coming up, Game 3 of 10, Teal book".
- End the night listed the eight unplayed games and moved the TV to the end-of-night loop.
- The database afterwards: session completed with both timestamps, winners keyed by attempt, claim fields cleared, and the snowball pot untouched (58 calls, GBP 180).
- The phone through `/play` reached tonight's session with the rules inline, no text under 14px and no sideways scroll.
- The events slides were checked with fixture data by the wave 3 agent. Locally the feed reports `missing_config`, because no key exists.

### Independent review

A fresh reviewer read the committed diff and found no blockers or high-severity issues. All of its medium findings and most low ones are fixed (commits `0d44cd1`, `52ab666`, `aff94dc`):
- re-opening a settled snowball game;
- the order for rolling back;
- Check Win hanging on a stuck draft save;
- the TV reloading mid-game;
- error screens;
- the events feed's single-flight and back-off;
- an all-malformed events response replacing good data;
- the deadlock lock mode;
- tied jackpot winners with different pools;
- the Manual Snowball Win duplicate guard;
- the `toggleBreak` stage check;
- the environment and `/play` small items.

### Deviations from the plan, all recorded in commits

- One release outside play replaces staged enforcement (review option two).
- The migration order is M1, M2a, M3, M2b.
- `start_game` takes the cash jackpot amount.
- A host-callable `list_unsettled_snowball_games` was added.
- The error screens use `retry()`.
- A `tvText()` helper is used, plus a tailwind-merge registration for the `tv-*` sizes.
- `toggleBreak` is bound to the stage and pause it read.

### Open items

The owner decides these; they are listed in the PR:
- confirm assumptions A1 to A6;
- issue the events key;
- the management feedback page change;
- the rehearsal on the pub TV;
- approve migrations and deploy.

The local stack is in `scratchpad/localstack` and can be stopped with `supabase stop`.

## Release (1 October 2026)

- The owner confirmed assumptions A1 to A6 and approved the release and the four migrations.
- **PRs #16 and #17 merged.** The reliability slice went live as deployment `dpl_HD6VoCiYRdRBAqA4uEzECcJ138PB`, commit `0d5faf3`; `/api/build` reported that commit.
- **Migrations applied** through the Supabase migration tool, in order, each verified against its file by function-body hash:
  - `night_lifecycle` as `20261001075034`
  - `claim_attempts` as `20261001075215`
  - `jackpot_components` as `20261001075401`
  - `claim_enforcement` as `20261001075456`
- **Data check:** the winners' money snapshot was identical before and after (115 winners, total GBP 955.00), `started_at` was backfilled on 8 of 8 sessions, and no new function is executable by anon.
- **Production smoke test** in a transaction that rolled back, as an admin identity with the authenticated role: start, five calls, claim attempt and retry, draft and stale draft, wrong count, invalid, new claimant, valid, public mirror, forged write refused, wrong key refused, record (LINE WINNER!, Anonymous, one row on retry), finish and session completion, end night again, start after end refused. Nothing persisted.
- **PR #18 merged** and live as deployment `dpl_FwYnHWHVhTPuXVVwh75ztZeaFdD2`, commit `677ddca`. `/api/build` reported that commit, and the TV, phone, `/play` and login pages loaded with no application error.
- **Events key:** the first value stored in Vercel as `ANCHOR_API_KEY` was not an API key (40 characters with spaces, no `anch_` prefix), so the management API answered 401 and the TV showed its fallback slides. The owner stored the real key, and the redeploy that came with PR #19 (deployment `dpl_7mpm39g5HQnYdmRkTsHMKEB6dHpb`, commit `04481f0`) picked it up. `/api/screen/events` then answered `ok` with 6 events and 2 bingo nights, every one with an image and a management short link. The live idle TV rotated the event slides with no text under 32px and a 432px QR, and `/play` listed the events with the next bingo night first. The build now refuses a value that is set but not shaped like a management key.
- The migration files were renamed to the applied versions afterwards (PR #19), contents unchanged.


## Events during breaks (1 October 2026)

Asked for after the release: "We should also show the events during breaks".

- [x] `ScreenEvent.qrInGame`: the management app's `in_game_screen` short link, with the same id-link fallback as the other two. A cached response from before the field existed falls back to the pre-event link; the cache key moved to `v2`.
- [x] `eventLinkForPhase(event, phase, inGameSubState)` is the one place that picks the link: pre-event before the night, in-game on a break, post-event after it and on the idle screen.
- [x] TV break loop: break screen (20 s), next bingo night (12 s), events two at a time (12 s each) with the break screen back after every two, rules (20 s) once a loop. With no usable events it is the break screen and the rules, exactly as before.
- [x] Event slides on a break carry the "Break time" label, and the corner follow-along QR goes while a slide with its own QR is up, so there is never more than one code to scan.
- [x] Phone: the events list sits under the "On Break" card with the in-game links.
- [x] Between games: left unchanged in this piece; the owner said yes the same day, see "Events between games" below.

**Found in the browser, not by the tests:** the event slides are white text drawn for the green screen before and after the night. On a break the screen is the game's book colour, so on a white book the title, eyebrow and "Scan for details" were white on white. They now sit on the rules slide's dark panel whenever the night is paused. `scripts/check-render.js` gained a `lowContrast` result (ratio under 3 against the background colours behind the text) so the render check catches this next time. The phone header was an 80 percent tint, and the list's text showed through it while scrolling; it is solid now.

**Verified locally** (local Supabase, a stand-in for the management API fed from the public website's events, the real host flow: start game 1, call a ball, Take Break):
- 1920x1080 and 1280x720, one whole loop each (208 s): the order above, one QR on screen at a time (432 px and 288 px on event slides), no text under 32 px and 22 px, no overlaps, no low contrast, nothing clipped (509 px of 545 px used by a two-line title at 720p). The QR on the next bingo slide encoded the `in_game_screen` short link.
- 375x812 phone: nine events under the break card, each "View event" on the in-game link (short link where one exists, the id link otherwise), 44 px targets, no sideways scroll.
- Resume Session mid-slide: the TV went straight back to the ball with the corner QR.

**Assumptions:** break screen first and again after every two events, so a late look at the TV still says the game is paused within about 24 seconds; the same 12 s per event as before the night.

**Released:** PR #21, production deployment `dpl_CbuQggPzBoZGwm2u1pmfsU5EYq8X`, commit `1828a6f`. `/api/build` reported that commit, and the live feed answered `ok` with an `in_game_screen` short link on all 8 events. The break screen itself was not exercised on production (it needs a running game).

## Events between games (1 October 2026)

The owner said yes to showing events in the gap between games too.

- [x] `buildPlaylist('between_games')` now passes the usable events to the same pause loop as a break: next game screen (20 s), next bingo night (12 s), events two at a time (12 s each) with the next game screen back after every two, rules (20 s) once a loop. With no usable events it is the next game screen and the rules, exactly as before.
- [x] Event slides carry the "Next game coming up" label and the in-game links; the corner QR goes while a slide with its own QR is up.
- [x] Phone: the events list sits under the "Next game coming up" card, with the in-game links.

**Verified locally** through the real host flow (start game 1, call a ball, End Game): a whole loop at 1280x720 and the first slides at 1920x1080 with no small text, overlaps, low contrast or clipping and one QR at a time; the phone at 375x812 with nine in-game links and 44 px targets; starting game 2 mid-slide took the TV straight to the game with the corner QR back.

**Test trap:** a background tab in the browser pane does not paint, so a slide's image looked blank in a capture although it had loaded. Front the tab before trusting a screenshot.

