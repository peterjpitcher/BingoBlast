# Bingo Live Event Reliability - Reviewed Design Spec

- **Status:** Reviewed and corrected after code discovery
- **Date:** 2026-04-30
- **Original author:** Peter Pitcher with Claude Code
- **Review author:** Codex
- **Scope:** Live-event reliability, timing, anonymous winner display, prize correctness, destructive-action safety, and supporting polish

## 0. Critical Review Feedback

Do not implement the original draft as written. Discovery against the current repo found several spec-level mistakes that would create regressions:

1. **Do not use `updated_at` as a staleness guard.** `game_states.updated_at` exists, but there is no update trigger maintaining it. A poll-vs-realtime ordering fix based on `updated_at` would be false confidence. The proper fix is a `state_version` column bumped by a database trigger and copied to `game_states_public`.
2. **Do not add a unique winner-per-stage index.** The app and PRD support multiple winners sharing a prize, and the host UI has a "Validate Another Winner" flow. A unique index on `(game_id, stage)` would break legitimate ties.
3. **Do not create a new root `middleware.ts`.** This Next.js 16 app already has `src/proxy.ts` wired to `src/utils/supabase/middleware.ts`. The issue is that the proxy matcher is too broad and docs are stale, not that the auth-refresh helper is absent.
4. **Do not require admin-entered prizes for `jackpot` games.** Jackpot games intentionally ask the host for the cash amount when the game starts. Prize validation must require standard and snowball prizes, but treat `type = 'jackpot'` as host-start-time prize entry.
5. **Do not put `BINGO!` into `display_winner_name`.** Current display markup labels that field as "Winner". Storing `BINGO!` there produces "Winner: BINGO!". Store `winner_name = 'Anonymous'` in the `winners` table and use `display_win_text` for the public celebratory message.
6. **Remove stale items from the draft.** `display-ui.tsx` already updates `currentGameStateRef` in an effect. The real cleanup is that `currentGameStateRef` appears unused in both display and player code.
7. **The original one-PR scope is too broad for a junior developer unless split into waves.** The implementation should be planned as critical reliability first, then polish/docs. This spec keeps one document but labels what must ship together.

## 1. Current Product Reality

This repository is a 90-ball pub bingo control system for The Anchor. It is not the generic digital-card BingoBlast app described in parts of `AGENTS.md` and `CLAUDE.md`.

Current routes:

- `/admin` - admin/session/game setup, authenticated admin only
- `/host` and `/host/[sessionId]/[gameId]` - live host control, authenticated host/admin
- `/display` and `/display/[sessionId]` - public TV display
- `/player/[sessionId]` - public mobile follower screen, not a playable bingo ticket

Current live state model:

- Private host state is stored in `game_states`.
- Public display/player state is copied to `game_states_public` by the `sync_game_states_public()` trigger.
- Host, display, and player all combine Supabase Realtime with polling fallback.
- `src/proxy.ts` currently runs auth/session refresh very broadly.

## 2. Goals

- Host sees the called number immediately from the server action response.
- Display/player reveal called numbers 2 seconds after `last_call_at`.
- Realtime and polling updates cannot roll the UI back to an older game-state snapshot.
- Host can record a winner without entering a name; public screens show a generic celebration, not a person name.
- Prize fields are enforced where the admin is responsible for the prize, while jackpot games keep their start-time cash amount flow.
- The misleading host LIVE/OFFLINE pill is replaced with an outage-only reconnecting banner.
- Destructive admin actions are blocked or strongly confirmed server-side.
- Stale documentation and public auth/signup affordances are cleaned up so future implementers are not misled.

## 3. Non-Goals

- Digital bingo tickets, player card marking, card generation, QR join-code mechanics, or leaderboards.
- Player registration or a pre-game player roster.
- Audio/video number announcements or `react-player`.
- Multi-host simultaneous control of one game.
- Full big-screen redesign.
- Replacing all host actions with PL/pgSQL RPCs in this pass.
- Changing snowball pot business rules beyond preserving current behaviour.

## 4. Implementation Waves

The work should be planned in this order:

1. **Wave A - State correctness and timing.** Add `state_version`, update client reconciliation, change call delay to 2 seconds, and make host update from the action response.
2. **Wave B - Winner and prize correctness.** Anonymous winner flow, prize validation/fallbacks, jackpot exception, and destructive-action guards.
3. **Wave C - Connection UX and proxy cleanup.** Reconnecting banner, online/offline handling, visibility handling, channel cleanup, and proxy matcher tightening.
4. **Wave D - Polish and documentation.** Modal accessibility, button sizing, initial loading states, login/signup UI cleanup, console/logging cleanup, `.env.example`, `AGENTS.md`, `CLAUDE.md`, and architecture docs.

Wave A and Wave B are the live-event safety work. Wave C should ship with them if possible. Wave D can be a follow-up if time is tight.

## 5. State Ordering: Add `state_version`

### Problem

Polling and Realtime currently apply whole DB snapshots directly. That is void-safe, but it allows a slow poll or delayed Realtime payload to overwrite a newer snapshot. The prior idea of comparing `updated_at` is invalid because `updated_at` is not maintained on update.

### Required database migration

Create a migration before any client changes that:

```sql
alter table public.game_states
  add column if not exists state_version bigint not null default 0;

alter table public.game_states_public
  add column if not exists state_version bigint not null default 0;

create or replace function public.bump_game_state_version()
returns trigger as $$
begin
  if tg_op = 'UPDATE' then
    new.state_version = coalesce(old.state_version, 0) + 1;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists bump_game_state_version on public.game_states;
create trigger bump_game_state_version
before update on public.game_states
for each row execute function public.bump_game_state_version();
```

Then update `sync_game_states_public()` in the same migration to include `state_version` in its insert and update column lists. Finish with:

```sql
update public.game_states_public gsp
set state_version = gs.state_version
from public.game_states gs
where gs.game_id = gsp.game_id;
```

Update `docs/schema.sql` and `src/types/database.ts` for both `game_states` and `game_states_public`.

### Required client rule

Add a small helper, for example `src/lib/game-state-version.ts`:

```ts
export function isFreshGameState(
  current: { state_version: number } | null | undefined,
  incoming: { state_version: number } | null | undefined
) {
  if (!incoming) return false;
  if (!current) return true;
  return incoming.state_version >= current.state_version;
}
```

Use this for every host/display/player Realtime payload and polling response before setting game state. Do **not** compare `numbers_called_count`; voiding a number legitimately decreases that count.

Polling also needs a local request-order guard:

- Keep a monotonically increasing request id in a ref.
- Capture it when a poll starts.
- If a newer poll or Realtime event has applied before the request finishes, discard the old result.
- Avoid overlapping interval polls with an `inFlight` ref.

## 6. Number-Call Timing

### Current problem

The host waits for its own Realtime event, while display/player may receive the broadcast first. All surfaces then apply the same reveal timer, so public screens can appear to beat the host.

### Required behaviour

1. `callNextNumber` returns the updated `game_states` row and `nextNumber`:

   ```ts
   ActionResult<{ nextNumber: number; gameState: GameState }>
   ```

2. Host `handleCallNextNumber` immediately applies `result.data.gameState` using the `state_version` freshness helper.
3. Display/player continue using `last_call_at + call_delay_seconds * 1000` for reveal timing.
4. Change default delay from 1 second to 2 seconds on both tables:

   ```sql
   alter table public.game_states alter column call_delay_seconds set default 2;
   alter table public.game_states_public alter column call_delay_seconds set default 2;

   update public.game_states
   set call_delay_seconds = 2
   where call_delay_seconds = 1;

   update public.game_states_public
   set call_delay_seconds = 2
   where call_delay_seconds = 1;
   ```

5. Update `startGame()` so new rows use `2` when there is no existing `call_delay_seconds`. The current code explicitly falls back to `1`, which bypasses the database default.
6. Remove the host client display-sync lockout:
   - Delete `DISPLAY_SYNC_BUFFER_MS`.
   - Delete `displaySyncRemainingMs`.
   - Delete `isDisplaySyncLocked` from the Next Number disabled condition.
   - Disable Next Number only while the request is in flight, not while display/player are catching up.
7. Keep server-side gap enforcement in `callNextNumber`:
   - Reject if `last_call_at` is less than `call_delay_seconds` ago.
   - Remove the extra 200ms buffer from the server error.
   - Keep the existing compare-and-set guard using `.eq('numbers_called_count', oldCount)` so double submissions cannot both commit.
8. Add a passive host label near the current ball: `Players see this in 2s`.

## 7. Anonymous Winner Flow

### Required behaviour

- Remove the "Winner Name" input from the regular Record Winner modal.
- Remove the winner-name input from the Manual Snowball Award modal as well.
- `recordWinner()` no longer accepts `winnerName` or `callCountAtWin` from the client. It re-reads live state and uses the current `numbers_called_count`, as it already does today.
- Persist `winner_name = 'Anonymous'` in `winners`.
- Set `display_winner_name = null`.
- For normal Line / Two Lines / Full House wins, set `display_win_text = 'BINGO!'`.
- For snowball jackpot wins, keep the current jackpot-specific text, for example `FULL HOUSE + SNOWBALL £250!`, because hiding the jackpot amount would be worse UX.
- Keep `display_win_type` stage-specific so existing styling still works.

### Multiple winners

Multiple winners per stage are valid. Do not add a unique `(game_id, stage)` index. Instead:

- Add an `isRecordingWinner` client state so the Confirm Winner button cannot be double-tapped while the request is in flight.
- Keep the existing "Validate Another Winner" flow.
- If the business later decides only one winner per stage is allowed, that is a product change and must remove the multi-winner UI at the same time.

### Files

- `src/app/host/actions.ts`
- `src/app/host/[sessionId]/[gameId]/game-control.tsx`
- `src/app/display/[sessionId]/display-ui.tsx` only if any label assumes `display_winner_name` is present
- `src/app/player/[sessionId]/player-ui.tsx` only if any label assumes `display_winner_name` is present

## 8. Connection Reliability

### Host UX

- Remove the persistent LIVE/OFFLINE pill from the host control.
- Add a small "Reconnecting..." banner only after the connection has been unhealthy for at least 10 continuous seconds.
- Include a manual Refresh button in the banner.
- Auto-refresh after 30 continuous unhealthy seconds.

### Health definition

Connection is unhealthy when any of these persists:

- `navigator.onLine === false`
- Most recent poll failed or timed out
- Realtime channel reports `CHANNEL_ERROR`, `TIMED_OUT`, or `CLOSED`
- No successful poll or Realtime payload has applied for more than 10 seconds while the document is visible

Do not use `updated_at` for this.

### Shared implementation

Create a testable pure reducer plus a hook:

- `src/lib/connection-health.ts` - pure state machine, covered by Node tests
- `src/hooks/use-connection-health.ts` - React hook wrapper

The hook should expose:

```ts
{
  healthy: boolean;
  unhealthyForMs: number;
  shouldShowBanner: boolean;
  shouldAutoRefresh: boolean;
  markPollSuccess(): void;
  markPollFailure(): void;
  markRealtimeStatus(status: string): void;
}
```

### Realtime and polling rules

Apply these to host, display, and player:

- Reconnect Realtime with exponential backoff: 1s, 2s, 4s, 8s, capped at 30s.
- Await `supabase.removeChannel(channel)` before creating a replacement channel when reconnecting.
- Add `online` and `offline` listeners. On `online`, rebuild the channel and force an immediate poll. On `offline`, mark health degraded immediately.
- Add host `visibilitychange` handling. When hidden, pause polling and stop heartbeats. When visible, force a poll, restart heartbeat if controller, and rebuild the channel.
- Existing display/player visibility polling can stay, but must be folded into the same health/reconnect pattern.
- All poll queries must use explicit select lists, not `select('*')`, on public routes.

## 9. Prize Handling

### Validation

Create a pure helper, for example `src/lib/prize-validation.ts`, used by both admin actions and admin UI:

- `standard` games: every stage in `stage_sequence` needs a non-empty trimmed prize.
- `snowball` games: `Full House` prize is required.
- `jackpot` games: admin prize is allowed to be empty because `startGame()` prompts for the cash jackpot amount and writes the prize before the game starts.
- All server-side validation must run even if the client has already shown inline errors.

Client UI:

- Red border and inline message beside each missing required prize.
- Disable submit while client validation fails.
- Keep server error display for bypassed or stale forms.

Server actions:

- `createGame()` and `updateGame()` trim prizes before saving.
- Missing required prize returns a specific error: `<game name>: prize required for <stage>`.
- `startGame()` must continue requiring a positive cash amount for jackpot games before setting the game in progress.

### Lock once started

Use per-game state, not session-level status:

- Games with `game_states.status = 'not_started'` can still have prize text edited, even while the session is running. This is useful for correcting upcoming games during the night.
- Games with `status = 'in_progress'` or `status = 'completed'` render prize fields read-only and show `Locked: game already started`.
- Server-side `updateGame()` rejects changes to `prizes`, `type`, `snowball_pot_id`, and `stage_sequence` for started games.
- The current UI disables all editing when the session is running. Replace that with per-game gating.

### Defensive fallback

Replace all `Standard Prize` fallbacks with a red `Prize not set` warning:

- `src/app/host/[sessionId]/[gameId]/game-control.tsx`
- `src/app/display/[sessionId]/display-ui.tsx`

Do not use a plausible placeholder for missing money. If validation is bypassed, the problem should be obvious.

### Audit

Do not add a read-only `SELECT` migration and assume the output will be noticed. Instead, add a manual SQL audit file or PR checklist query:

```sql
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

Run it before deployment and fix flagged rows manually.

## 10. Destructive Actions

Server-side enforcement matters more than UI confirmation. Window `confirm()` is not enough.

### Game deletion

`deleteGame(gameId, sessionId)`:

- Allow deletion only when the game has no state row or `game_states.status = 'not_started'`.
- Reject `in_progress` and `completed`.
- If a game has winners, reject deletion regardless of game state.

Admin UI:

- Replace one-click delete with a modal.
- Show game name and status.
- Require typed confirmation for deletion.

### Session deletion

`deleteSession(sessionId)` in `src/app/admin/actions.ts`:

- Allow deletion only for draft/ready sessions with no started/completed game states and no winners.
- Reject running and completed sessions.
- Require typed confirmation in the UI.

### Reset session

`resetSession(sessionId)` is intentionally destructive but useful after tests. Keep it, but make it safer:

- Change the server action signature to require a confirmation string.
- Require the admin to type the session name or `RESET`.
- Show exactly what will be deleted: game states, called numbers, winners.
- Keep server-side authorization as the first operation.

## 11. Auth Proxy And Public Data

### Proxy

`src/proxy.ts` already exists and calls `updateSession()`. Do not add a duplicate root `middleware.ts`.

Update `src/proxy.ts` so the matcher is limited to:

- `/admin/:path*`
- `/host/:path*`
- `/login`

Public routes `/display/:path*`, `/player/:path*`, `/api/setup`, Next internals, and static assets should not pay for auth refresh or role lookup.

### Public selects

The public `sessions` RLS policy currently allows all columns. Do not broaden this further in browser code.

Update display/player page loads and polling to use explicit select lists:

- `sessions`: `id, name, status, active_game_id`
- `games`: only fields used by UI (`id, session_id, game_index, name, type, stage_sequence, background_colour, prizes, snowball_pot_id`)
- `game_states_public`: explicit list including `state_version`

This does not fully solve column-level public exposure, but it stops the app from habitually over-fetching sensitive or irrelevant fields.

## 12. Claim Validation

`getRequiredSelectionCountForStage()` currently returns `5` for unknown stages. That silently treats misconfigured stages as Line claims.

Required change:

- Move the stage-to-count map into a shared helper:

  ```ts
  export const REQUIRED_SELECTION_COUNT_BY_STAGE: Record<WinStage, number> = {
    Line: 5,
    'Two Lines': 10,
    'Full House': 15,
  };
  ```

- Server helper returns `number | null`.
- `validateClaim()` rejects `null` with `Stage not valid for this game`.
- Client `game-control.tsx` uses the same helper instead of string matching.

## 13. Polish And Documentation

### Console/log cleanup

Remove noisy production `console.error` / `console.warn` paths that log every poll failure or leak identifiers. Where logging is still useful, route through:

- `src/lib/log-error.ts`

The helper should accept a scope string and unknown error, strip obvious identifiers, and no-op in production unless explicitly enabled.

### Modal accessibility

`src/components/ui/modal.tsx`:

- Add focus trap.
- Return focus to the triggering element on close.
- Escape closes.
- Close button at least 44px square with `aria-label="Close"`.
- Add `aria-labelledby` linked to the title.
- Keep `role="dialog"` and `aria-modal="true"`.

### Button small size

`src/components/ui/button.tsx`:

- Change `sm` from `h-8 px-3 text-xs` to at least `h-10 px-3 text-sm`.
- Remove per-call-site `className="h-8"` overrides where they keep the touch target below 40px.

### Initial loading state

Add a clear initial state to player and display:

- `Connecting to game...`
- subtle pulse/spinner
- no blank screen while first poll or Realtime subscription is pending

### Login/signup UI

`signup()` already returns "invite-only", but `/login` still shows a Sign Up mode. Remove the signup toggle from the UI. Keeping a dead signup path confuses staff and future developers.

### Unused refs

`currentGameStateRef` appears unused in both:

- `src/app/display/[sessionId]/display-ui.tsx`
- `src/app/player/[sessionId]/player-ui.tsx`

Remove it if it remains unused after the state-version work. Do not describe this as a stale-render bug.

### Documentation drift

Update:

- `AGENTS.md`
- `CLAUDE.md`
- `README.md`
- `docs/architecture/routes.md`
- `docs/architecture/overview.md`
- `docs/architecture/relationships.md`
- `docs/architecture/data-model.md`
- `.env.example`

Corrections:

- This is a 90-ball host/display/player-follower app, not a digital card app.
- No `react-player` dependency or audio announcement implementation exists.
- `src/proxy.ts` exists and is the auth/session proxy for Next.js 16.
- README says Bootstrap/React-Bootstrap, but the app uses Tailwind classes and local UI components.
- `.env.example` needs `NEXT_PUBLIC_SITE_URL` with a comment explaining it is a fallback for production join URLs when request headers are unavailable.

## 14. Tests

The current test suite only covers two utility tests. Do not try to unit-test server actions by hitting Supabase directly in Node tests. Extract pure helpers and test those.

Add Node native tests for:

- `isFreshGameState()` accepts higher/equal `state_version`, rejects lower version, and allows a lower `numbers_called_count` when the version is higher.
- Connection-health reducer: healthy, 10s degraded, recovery, 30s auto-refresh.
- Prize validation helper: standard/snowball missing prizes fail, complete prizes pass, jackpot empty prize passes.
- Required selection count helper: known stages return 5/10/15, unknown returns `null`.
- Cash jackpot parsing still rejects empty, zero, negative, and non-numeric amounts.

Manual smoke tests on preview:

1. **Timing:** Host phone and display laptop. Press Next Number. Host updates immediately; display/player reveal about 2 seconds later.
2. **State ordering:** Throttle network, call two numbers, void the last, then force poll/realtime reconnect. Host/display/player must accept the lower count only when `state_version` is newer.
3. **Short outage:** Disable network for 12 seconds. Banner appears around 10 seconds. Re-enable network; banner clears after successful poll/realtime.
4. **Long outage:** Disable network for 35 seconds. Auto-refresh occurs after 30 seconds unhealthy.
5. **Anonymous winner:** Validate a claim and record winner. No name input appears. Public screen shows generic celebration with no "Winner: BINGO!" label.
6. **Multiple winners:** Use "Validate Another Winner" on the same stage. A second winner row can be recorded.
7. **Prize validation:** Standard/snowball missing prize is blocked in UI and server. Jackpot game can save without admin prize but must prompt host for cash amount before start.
8. **Prize lock:** Running session, not-started future game prize remains editable. Started game prize is read-only and server rejects tampered updates.
9. **Delete/reset guards:** In-progress and completed games cannot be deleted. Session reset requires typed confirmation.
10. **Proxy:** `/admin` and `/host` still redirect unauthenticated users. `/display` and `/player` remain public.

Run:

```bash
npm run lint
npm test
npm run build
```

If local shell `PATH` is broken, run with a normal PATH, for example:

```bash
/usr/bin/env PATH=/bin:/usr/bin:/usr/local/bin:/opt/homebrew/bin npm test
```

## 15. Migration Ordering

1. Add `state_version`, trigger, public sync updates, and type/schema docs updates.
2. Set `call_delay_seconds` default to 2 and update existing `1` rows to `2`.
3. No winner uniqueness migration. Multiple winners are valid.
4. No read-only audit migration. Use the manual missing-prize audit query before deployment.

Use the next timestamp after the existing `20260218190500` migration.

## 16. Rollout

1. Open PR for Wave A/B/C only unless Wave D is small enough to include safely.
2. Run lint, tests, and build.
3. Deploy preview.
4. Run the manual smoke tests above on two devices.
5. Before promoting, check no real session is currently mid-game:

   ```sql
   select s.id, s.name, gs.status
   from public.sessions s
   join public.games g on g.session_id = s.id
   join public.game_states gs on gs.game_id = g.id
   where s.status = 'running'
     and gs.status = 'in_progress';
   ```

6. Promote only if no live event is in progress.
7. Watch the next live session for timing, reconnect banner, anonymous winner, and jackpot prize entry.

## 17. Risks And Mitigations

| Risk | Mitigation | Rollback |
|---|---|---|
| `state_version` trigger increments on heartbeat-only updates | This is acceptable; it provides ordering for every snapshot. | Drop trigger and columns only if the client changes are reverted first. |
| Public display/player discard legitimate older count after void | Version-based helper allows lower count when version is newer. Test void path manually. | Revert helper use, but expect stale-overwrite risk to return. |
| Jackpot prize validation blocks host-start flow | Explicitly exempt `type = 'jackpot'` in admin validation and test host prompt. | Revert prize validation for jackpot only. |
| Removing LIVE/OFFLINE pill makes host miss status | Reconnecting banner appears only for actionable unhealthy state. | Add a small non-blocking status line later if requested. |
| Proxy matcher change misses a protected route | Keep page-level auth checks. Manual test `/admin`, `/admin/sessions/[id]`, `/host`, `/host/[sessionId]/[gameId]`. | Restore the protected-route matcher: `/admin/:path*`, `/host/:path*`, `/login`. |

## 18. Corrected Discovery Findings

| # | Finding | Required action |
|---|---|---|
| 1 | Host updates from Realtime, allowing public clients to reveal first | Host applies `callNextNumber` response immediately |
| 2 | `call_delay_seconds` is explicitly defaulted to 1 in code and DB | Change DB defaults and `startGame()` fallback to 2 |
| 3 | `updated_at` is not a real freshness marker | Add `state_version` trigger and client freshness helper |
| 4 | Host LIVE/OFFLINE pill is driven by Realtime status only | Replace with health-based reconnect banner |
| 5 | Player/display lack explicit Realtime reconnect strategy | Add reconnect backoff and channel rebuilds |
| 6 | No online/offline listeners on live surfaces | Add listeners and immediate poll/reconnect behaviour |
| 7 | Polling can clobber newer Realtime state | Use `state_version`, request-order guard, and no overlapping polls |
| 8 | Winner name required today | Store `Anonymous`; no public winner-name display |
| 9 | Manual snowball flow also requires name | Remove name field there too |
| 10 | Winner uniqueness per stage would break multiple winners | Do not add unique index |
| 11 | `Standard Prize` fallback looks real | Replace with red `Prize not set` |
| 12 | Admin prize validation missing for standard/snowball | Add client and server validation helper |
| 13 | Jackpot games set prize at host start | Exempt jackpot from admin prize-required validation |
| 14 | Admin UI locks entire running session | Replace with per-game started/not-started gating |
| 15 | Game/session deletion and reset rely on weak confirms | Add server guards and typed-confirm modals |
| 16 | Unknown stage maps to 5 selections | Return `null` and reject invalid stages |
| 17 | `src/proxy.ts` exists but matcher is broad | Tighten matcher, do not add `middleware.ts` |
| 18 | Public routes over-fetch `sessions` rows | Use explicit select lists |
| 19 | Login page exposes dead Sign Up mode | Remove signup toggle from UI |
| 20 | Docs describe non-existent digital cards, `react-player`, and no proxy | Update project docs and `.env.example` |
| 21 | Modal and small buttons miss accessibility/touch details | Fix modal focus/labels and 40px small buttons |
| 22 | Player/display can show blank initial state | Add connecting skeleton |
