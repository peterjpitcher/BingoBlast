# CLAUDE.md: Anchor Bingo

Workspace standards live in `/Users/peterpitcher/Cursor/CLAUDE.md`: read that first. `AGENTS.md` here is a symlink to this file, so Codex and Cursor read the same rules. This file holds only what is unique to this repo.

## Stack (deviations from the workspace default)

- **Next.js 16.3**, React 19.2. Middleware is the Next 16 `proxy()` export in `src/proxy.ts`, not `middleware.ts`.
- **Tailwind v4** (`@import "tailwindcss"` plus `@config` pointing at `tailwind.config.ts`, where the `bingo.*` tokens live).
- **Tests use Node's native runner** (`node --test --import tsx`), not Jest or Vitest: `src/lib/*.test.ts`, pure helpers only. Mock Supabase; never hit a real database.
- Supabase via `@supabase/ssr`; `zod`, `qrcode.react`, `nosleep.js`. Vercel. Linked Supabase project ref `bcmorqsgeumtmhvctvgu`.
- Server actions return `ActionResult<T>` (`src/types/actions.ts`): `conflict: true` means the state moved under the caller, so refresh rather than fail. Branch on `code`, never on `error` text.

## Commands

```bash
npm run dev / build / start / lint / typecheck / test
npm run test:db          # supabase/tests/run.sh: migration replay + Postgres assertions
npm run verify           # lint, typecheck, test, build
```

`test:db` needs Docker and `psql` (throwaway `postgres:17`, never a real project). Docker works on the dev machine (confirmed 29 Sep 2026), so run it locally before pushing any migration; CI runs it too (`.github/workflows/ci.yml`). Without Docker, `run.sh` falls back to a temporary local Postgres 17 cluster. ESLint ignores `.claude/**` (worktrees).

## What this app is

A **90-ball pub bingo control system** for The Anchor. Players use paper books: no digital cards, no per-player marking, no "join a card" QR flow, no 75-ball mode, no audio.

- Admin (`profiles.role = 'admin'`): `/admin/*` (sessions, snowball, history, backup). Host (`admin` or `host`): `/host`, `/host/[sessionId]/[gameId]`.
- Public: `/display[/sessionId]` (pub TV; the root joins the one session that is running, or ready and dated today or earlier; `?rehearsal=1` also lists test sessions), `/player/[sessionId]` (read-only phone follower), `/play` (permanent follow-along link for QR codes and table cards).
- Also `/login` (sign-in only), `/pending` (signed in, no staff role), `/api/setup`.

## Architecture

**Auth.** `src/proxy.ts` runs `updateSession()` (`src/utils/supabase/middleware.ts`) only on `/admin/:path*`, `/host/:path*` and `/login`. It refreshes the session and routes by role: anonymous to `/login`, `pending` or no profile row to `/pending`, a host on `/admin` to `/host`. Every redirect must go through `redirectPreservingSession()`: a bare `NextResponse.redirect` drops the rotated refresh cookies, which logged a host out mid-shift. Protected pages also call `getUser()` themselves.

**Data.** Tables: `sessions`, `games`, `game_states`, `game_states_public` (trigger-synced public mirror), `winners`, `snowball_pots`, `snowball_pot_history`, `profiles`. Both state tables carry `state_version`, bumped by trigger on every write. Public pages subscribe to `game_states_public` over Realtime with a polling fallback and drop stale payloads with `isFreshGameState()`. Order by `state_version`, never `updated_at`. Action contract: `docs/architecture/server-actions.md`.

## Environment variables

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`: public.
- `SUPABASE_SERVICE_ROLE_KEY`: server only; used by `/api/setup` and nothing else. `startGame` no longer has a service-role write client: it calls `start_game` with the cookie client.
- `SETUP_SECRET`: gates `/api/setup`, which promotes an existing auth user to admin. Unset it once the first admin exists; the route then 404s.
- `NEXT_PUBLIC_SITE_URL`: optional override for the QR origin (`src/lib/site-origin.ts`); must be an https origin, and is ignored on Vercel previews so a preview QR never points at production. Without it, production uses `VERCEL_PROJECT_PRODUCTION_URL`, previews `VERCEL_BRANCH_URL`, development the request origin. QR codes point at `/play` (or `/play?s=<id>` when the TV's session is not the unique match), which redirects to `/player/[sessionId]`.
- `ANCHOR_API_KEY` (server only, required for Vercel production builds), `ANCHOR_API_BASE_URL` (optional): the management app's `read:events` key for the upcoming-events feed (`src/lib/events-feed/`). Previews and local builds without it show `missing_config` and the TV falls back to its non-event slides.
- `NEXT_PUBLIC_REVIEW_INVITE_ENABLED`: `true` shows the end-of-night review QR and phone button. Leave unset until the management feedback page offers the Google review to every visitor.
- `ERROR_SINK_URL`, `ERROR_SINK_TOKEN`: optional. `src/lib/report-error.ts` posts redacted failures (message and code only) so they outlive Vercel's logs. Unset means no-op.
- `LOG_ERRORS`: `logError()` is silent in production unless `true`.

## Business and security rules

- **Staff are invite-only.** No sign-up on `/login` (`signup()` only returns an error). An admin creates the user in the Supabase dashboard, `handle_new_user` makes the profile `pending`, and an admin promotes it by SQL (`docs/runbooks/staff-accounts.md`). Never default `profiles.role` to a role that can act; never re-enable public sign-up.
- **Winners are anonymous.** `winners.winner_name` is always the literal `'Anonymous'` (written by `record_winner_atomic`; no input exists). Historic names were anonymised and the archive dropped on 25 Aug 2026. `display_winner_name` is always `null`. Store no player-identifying data.
- **Admin vs host is a money boundary.** Hosts run the night; admins set up sessions and games, manage the pot, void winners and reset sessions. In RLS, `winners` UPDATE, `snowball_pots` UPDATE and `snowball_pot_history` INSERT are admin only. Hosts reach them only through `security definer` functions guarded by `assert_is_host()`: `set_winner_prize_given` (one column) and `settle_snowball_pot` (takes a game id, derives every value from the locked pot row). Never widen those policies: a host holds a real JWT and could `PATCH /rest/v1/...` any value. Call these and `call_next_number`, `void_last_number`, `record_winner_atomic`, `start_game`, `finish_game`, `end_night`, `begin_claim_check`, `set_claim_draft` and `check_claim` with the **cookie client, never the service role**: they read `auth.uid()`, null under `service_role`, and write it to audit columns or check the controller with it.
- **Number calling is atomic.** `call_next_number` locks the `game_states` row `for update`, checks controller, status and count, and enforces the host gap `HOST_MIN_CALL_GAP_MS` (`src/lib/call-timing.ts`) passed in as a parameter. With the lock, that gap is what prevents double-calls: never move it client-side or drop it. `call_delay_seconds` is the **public reveal delay**, not the host gap. `void_last_number` takes the same lock, refuses if a non-void winner sits on that ball, and returns the ball to the bag. While paused for a claim it is only the one undo that claim attempt may make: it needs the attempt, no verdict yet, and the ball count the host saw, so a repeated tap refuses with `already_undone` instead of taking a second ball off.
- **Claims are checked server-side, one attempt per claimant** (spec 5.2). The host's phone mints a claim attempt id on Check Claim or Check another claimant; `begin_claim_check` stores it and pauses. Taps go to `set_claim_draft` through `src/lib/claim-draft-queue.ts` (one request at a time, newest list wins, the sequence only goes up) so the TV and phones show the claim live. `check_claim` gives the verdict under the lock: `invalid` (a number not called), `missing_last_ball` (every number called but not the last ball: the host decides, A1: the bound undo then a re-check, or reject as `late`), else `valid`. Duplicates and the wrong count are refused. The stage counts in `required_claim_count()` must equal `win-stages.ts` (tested). Ties are separate attempts. The claim fields are written only by these functions: `guard_claim_fields()` refuses any other write while paused and clears them all when the pause ends. After a reload or takeover the host screen reopens the claim from those fields. Nothing is announced at Check Win: the TV shows the win only once it is recorded.
- **Recording a winner is idempotent on the claim attempt id** (`winners.client_request_id`, unique where not null): `recordWinner` passes the attempt as `p_client_request_id`. A retry with the same attempt inserts nothing and returns current state, even after a reload, the next stage or a takeover; a tie is a separate attempt. From M2b (`20261001075456_claim_enforcement.sql`) a new winner needs that attempt checked `valid` at the current stage, re-checked against the board; the only exemption is Manual Snowball Win (`p_force_snowball_jackpot`, a snowball Full House inside the open window, checked under the lock). Never key on `(game_id, stage)` or `call_count_at_win`.
- **A stage with a live winner cannot be resumed.** `resumeGame` refuses with code `stage_already_won` when a non-void winner exists at the current stage; the host screen offers Continue to the next stage and Check another claimant instead (X4).
- **A snowball Full House inside an open jackpot window needs an explicit eligible or not-eligible choice** from the host, no default; the window is re-checked inside `record_winner_atomic`.
- `validateGamePrizes()` runs in `createGame` and `updateGame`; `updateGame` refuses changes to `prizes`, `type`, `snowball_pot_id` and `stage_sequence` once `game_states.status` is not `'not_started'`. Started or completed games, and sessions with started games or recorded winners, cannot be deleted. Reset Session requires typing `RESET` or the session name. One live session at a time in practice.
- **The night lifecycle goes through three functions that lock the session row first, then `game_states`** (`20261001075034_night_lifecycle.sql`): `start_game` (fresh start with a crypto-shuffled sequence it checks is a permutation, re-open of a completed game, or takeover; refuses `night_ended` and `other_game_in_progress`), `finish_game` (every finishing path: End Game, final-stage advance or skip, the next-game moves; completes the session when every game is completed; idempotent) and `end_night` (host **End the night**; refuses `game_in_progress`; idempotent). No trigger on `game_states` may write `sessions`: that reverses the lock order. Snowball settlement stays a separate call after `finish_game`, refuses `game_not_completed`, and a pot that did not move comes back as success plus `snowballPotDidNotSettle`, never as a failure; the admin host console lists finished snowball games with no settlement record, with a Settle button.
- **A winner's money is two components** (`20261001075401_jackpot_components.sql`): `prize_share_pence` is the ordinary share, `jackpot_share_pence` the snowball jackpot share. Total with `winnerTotalPence()` (`src/lib/money.ts`), which says "jackpot amount not recorded" where the jackpot is unknown. Voided winners show VOID and get no Give Prize; `set_winner_prize_given` refuses them.

## Gotchas (each of these has bitten us)

- **Don't broaden the proxy matcher** to `/display/*` or `/player/*`: that adds a Supabase round trip to every TV and phone refresh.
- **Never put the object from `useConnectionHealth()` in a dependency array.** It is new on every render and re-renders once a second, so dependent effects were torn down every second: the 3 s poll never fired, the Realtime channel never subscribed, and live updates on the host screen died silently. Destructure `markPollSuccess`, `markPollFailure` and `markRealtimeStatus`; read `shouldShowBanner` and `shouldAutoRefresh` inline in JSX.
- **Don't mint a fresh claim attempt for a retry.** The attempt id is minted once, when the host taps Check Claim or Check another claimant, and every draft, the check, the bound undo and Confirm Winner reuse it, retries included. On `attempt_mismatch` the phone must ADOPT the returned attempt and continue its draft sequence from `claim_draft_seq`, not mint another. Minting per tap or per save, or clearing it in `catch`, silently removes duplicate-winner protection. Only Manual Snowball Win keeps a separate key.
- **Never report success on an update you have not proved landed.** A `.update()` without `.select()` that RLS filters out returns no error and no rows, so the action reported success while nothing was written (the "prize given" tick, and earlier the snowball pot). Every direct `.update()` must `.select()` and treat zero rows as an error, or use an RPC that returns the persisted value.
- **Don't split snowball settlement into two round trips.** The audit claim and pot move share one transaction under one `for update` lock in `settle_snowball_pot`; when they did not, a stranded claim blocked every retry and the pot was fixed by hand.
- **Don't compute pot values client-side.** The function derives reset-vs-rollover from `winners` and both new values from the pot row's `base_max_calls`, `calls_increment`, `base_jackpot_amount` and `jackpot_increment`.
- **A voided jackpot winner must not reset the pot.** `is_void` is nullable, so the check is `coalesce(is_void, false) = false`; a plain `= false` skips NULL rows.
- **`ALTER DEFAULT PRIVILEGES IN SCHEMA ...` cannot revoke PUBLIC's EXECUTE on functions.** Per-schema defaults only add to the global ones, and PUBLIC EXECUTE is a built-in global default, so 20260905053040's `REVOKE ... FROM PUBLIC` did nothing and new functions stayed anon-callable. Only the global form (no `IN SCHEMA`) works: 20260929103001. Still write `revoke ... from public, anon` on every restricted function.
- **An enum value cannot be used in the migration that adds it.** `supabase db push` wraps each migration in a transaction; production rejected the combined migration (SQLSTATE 55P04, 25 Aug 2026). Use a later migration file.
