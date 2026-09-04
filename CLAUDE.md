# CLAUDE.md: Anchor Bingo

Workspace standards live in `/Users/peterpitcher/Cursor/CLAUDE.md`: read that first. `AGENTS.md` here is a symlink to this file, so Codex and Cursor read the same rules. This file holds only what is unique to this repo.

## Stack (deviations from the workspace default)

- **Next.js 16.1**, React 19.2. Middleware is the Next 16 `proxy()` export in `src/proxy.ts`, not `middleware.ts`.
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

`test:db` needs Docker and `psql` (throwaway `postgres:17`, never a real project). Docker is not on the dev machine, so it runs only in CI (`.github/workflows/ci.yml`). ESLint ignores `.claude/**` (worktrees).

## What this app is

A **90-ball pub bingo control system** for The Anchor. Players use paper books: no digital cards, no per-player marking, no "join a card" QR flow, no 75-ball mode, no audio.

- Admin (`profiles.role = 'admin'`): `/admin/*` (sessions, snowball, history, backup). Host (`admin` or `host`): `/host`, `/host/[sessionId]/[gameId]`.
- Public: `/display[/sessionId]` (pub TV; the root redirects only when exactly one session is ready or running), `/player/[sessionId]` (read-only phone follower).
- Also `/login` (sign-in only), `/pending` (signed in, no staff role), `/api/setup`.

## Architecture

**Auth.** `src/proxy.ts` runs `updateSession()` (`src/utils/supabase/middleware.ts`) only on `/admin/:path*`, `/host/:path*` and `/login`. It refreshes the session and routes by role: anonymous to `/login`, `pending` or no profile row to `/pending`, a host on `/admin` to `/host`. Every redirect must go through `redirectPreservingSession()`: a bare `NextResponse.redirect` drops the rotated refresh cookies, which logged a host out mid-shift. Protected pages also call `getUser()` themselves.

**Data.** Tables: `sessions`, `games`, `game_states`, `game_states_public` (trigger-synced public mirror), `winners`, `snowball_pots`, `snowball_pot_history`, `profiles`. Both state tables carry `state_version`, bumped by trigger on every write. Public pages subscribe to `game_states_public` over Realtime with a polling fallback and drop stale payloads with `isFreshGameState()`. Order by `state_version`, never `updated_at`. Action contract: `docs/architecture/server-actions.md`.

## Environment variables

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`: public.
- `SUPABASE_SERVICE_ROLE_KEY`: server only; `/api/setup` and the write client in `startGame`.
- `SETUP_SECRET`: gates `/api/setup`, which promotes an existing auth user to admin. Unset it once the first admin exists; the route then 404s.
- `NEXT_PUBLIC_SITE_URL`: public origin, the fallback for the display QR link to `/player/[sessionId]` when request headers are missing.
- `ERROR_SINK_URL`, `ERROR_SINK_TOKEN`: optional. `src/lib/report-error.ts` posts redacted failures (message and code only) so they outlive Vercel's logs. Unset means no-op.
- `LOG_ERRORS`: `logError()` is silent in production unless `true`.

## Business and security rules

- **Staff are invite-only.** No sign-up on `/login` (`signup()` only returns an error). An admin creates the user in the Supabase dashboard, `handle_new_user` makes the profile `pending`, and an admin promotes it by SQL (`docs/runbooks/staff-accounts.md`). Never default `profiles.role` to a role that can act; never re-enable public sign-up.
- **Winners are anonymous.** `winners.winner_name` is always the literal `'Anonymous'` (written by `record_winner_atomic`; no input exists). Historic names were anonymised and the archive dropped on 25 Aug 2026. `display_winner_name` is always `null`. Store no player-identifying data.
- **Admin vs host is a money boundary.** Hosts run the night; admins set up sessions and games, manage the pot, void winners and reset sessions. In RLS, `winners` UPDATE, `snowball_pots` UPDATE and `snowball_pot_history` INSERT are admin only. Hosts reach them only through `security definer` functions guarded by `assert_is_host()`: `set_winner_prize_given` (one column) and `settle_snowball_pot` (takes a game id, derives every value from the locked pot row). Never widen those policies: a host holds a real JWT and could `PATCH /rest/v1/...` any value. Call these and `call_next_number`, `void_last_number`, `record_winner_atomic` with the **cookie client, never the service role**: they read `auth.uid()`, null under `service_role`, and write it to audit columns.
- **Number calling is atomic.** `call_next_number` locks the `game_states` row `for update`, checks controller, status and count, and enforces the host gap `HOST_MIN_CALL_GAP_MS` (`src/lib/call-timing.ts`) passed in as a parameter. With the lock, that gap is what prevents double-calls: never move it client-side or drop it. `call_delay_seconds` is the **public reveal delay**, not the host gap. `void_last_number` takes the same lock, refuses if a non-void winner sits on that ball, and returns the ball to the bag.
- **Claims are validated server-side.** `validateClaim` re-reads the called numbers, requires the most recent ball, and takes the count from `getRequiredSelectionCountForStage`. Ties are valid.
- **Recording a winner is idempotent on a client-minted claim key** (`winners.client_request_id`, unique where not null). A retry with the same key inserts nothing and returns current state; a tie is a separate key. Never key on `(game_id, stage)` or `call_count_at_win`.
- **A snowball Full House inside an open jackpot window needs an explicit eligible or not-eligible choice** from the host, no default; the window is re-checked inside `record_winner_atomic`.
- `validateGamePrizes()` runs in `createGame` and `updateGame`; `updateGame` refuses changes to `prizes`, `type`, `snowball_pot_id` and `stage_sequence` once `game_states.status` is not `'not_started'`. Started or completed games, and sessions with started games or recorded winners, cannot be deleted. Reset Session requires typing `RESET` or the session name. One live session at a time in practice.

## Gotchas (each of these has bitten us)

- **Don't broaden the proxy matcher** to `/display/*` or `/player/*`: that adds a Supabase round trip to every TV and phone refresh.
- **Never put the object from `useConnectionHealth()` in a dependency array.** It is new on every render and re-renders once a second, so dependent effects were torn down every second: the 3 s poll never fired, the Realtime channel never subscribed, and live updates on the host screen died silently. Destructure `markPollSuccess`, `markPollFailure` and `markRealtimeStatus`; read `shouldShowBanner` and `shouldAutoRefresh` inline in JSX.
- **Don't mint a fresh claim key per attempt.** `claimRequestIdRef` is set when the Record Winner modal opens and must stay for every tap, retries included. Regenerating it on submit or clearing it in `catch` silently removes duplicate-winner protection.
- **Never report success on an update you have not proved landed.** A `.update()` without `.select()` that RLS filters out returns no error and no rows, so the action reported success while nothing was written (the "prize given" tick, and earlier the snowball pot). Every direct `.update()` must `.select()` and treat zero rows as an error, or use an RPC that returns the persisted value.
- **Don't split snowball settlement into two round trips.** The audit claim and pot move share one transaction under one `for update` lock in `settle_snowball_pot`; when they did not, a stranded claim blocked every retry and the pot was fixed by hand.
- **Don't compute pot values client-side.** The function derives reset-vs-rollover from `winners` and both new values from the pot row's `base_max_calls`, `calls_increment`, `base_jackpot_amount` and `jackpot_increment`.
- **A voided jackpot winner must not reset the pot.** `is_void` is nullable, so the check is `coalesce(is_void, false) = false`; a plain `= false` skips NULL rows.
- **An enum value cannot be used in the migration that adds it.** `supabase db push` wraps each migration in a transaction; production rejected the combined migration (SQLSTATE 55P04, 25 Aug 2026). Use a later migration file.
