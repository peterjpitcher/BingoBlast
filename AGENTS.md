# AGENTS.md — Anchor Bingo

This file provides project-specific guidance. See the workspace-level `AGENTS.md` one directory up for shared conventions.

## Quick Profile

- **Framework**: Next.js 16.1, React 19.2 (App Router)
- **Styling**: Tailwind CSS v4 with local UI primitives in `src/components/ui/`
- **Test runner**: Node.js native test runner (see `npm test`)
- **Database**: Supabase (PostgreSQL + RLS + Realtime)
- **Key integrations**: `@supabase/ssr` (cookie-based SSR), `qrcode.react` (display URL QR), `zod` (server-action input validation)
- **Size**: ~43 files in `src/`

## Commands

```bash
npm run dev              # Start development server
npm run build            # Production build
npm run start            # Start production server
npm run lint             # ESLint check
npm test                 # Node.js native test runner (node --test --import tsx)
```

Note: Uses native Node.js test runner (no Jest/Vitest). Tests cover the shared lib helpers (`src/lib/*`) — UI is not unit-tested.

## What This Application Is

A **90-ball pub bingo control system** for The Anchor. There are no digital cards, no per-player marking, and no QR-code-driven join. Players use physical paper bingo books at the table. The app exists to help the host call numbers, manage the snowball jackpot, validate winners, and surface the live game state on a public big-screen TV display and on guest follower phones.

There are three classes of user:

| User | Route | Auth |
|------|-------|------|
| Admin / host (staff) | `/admin/*`, `/host/*` | Supabase Auth (cookie session) |
| Big-screen pub TV | `/display`, `/display/[sessionId]` | Public |
| Guest mobile follower | `/player/[sessionId]` | Public, guest-friendly |

## Architecture

**Route structure** (App Router):

| URL | Purpose |
|-----|---------|
| `/` | Public landing page with links into the three interfaces |
| `/login` | Staff login (invite-only — no public sign-up) |
| `/admin` | Sessions list, snowball pots, history, backup |
| `/admin/sessions/[id]` | Session detail / game CRUD |
| `/admin/snowball` | Snowball pot management |
| `/admin/history` | Past sessions and winners |
| `/admin/backup` | Export tool |
| `/host` | Host dashboard — start games |
| `/host/[sessionId]/[gameId]` | Live host control: call numbers, validate wins, advance stages |
| `/display` | Public display root — auto-redirects to active session |
| `/display/[sessionId]` | Big-screen TV view |
| `/player/[sessionId]` | Mobile follower view (guest-friendly, public) |

**Auth proxy**: `src/proxy.ts` registers Next.js middleware via the `proxy()` export and a tightly scoped matcher that runs `updateSession()` (in `src/utils/supabase/middleware.ts`) only on `/admin/:path*`, `/host/:path*`, and `/login`. The middleware handles session refresh AND redirects unauthenticated/unauthorised users for those routes. Public routes (`/display/*`, `/player/*`, `/`) bypass the middleware entirely.

Defence in depth: every protected `page.tsx` server component also calls `supabase.auth.getUser()` and redirects to `/login` if absent.

**Data flow**: Admin defines a session and its games (each with type, prizes, snowball settings). Host opens a game, calls numbers (server-side gap-enforced via `call_delay_seconds`), pauses for validation, records winners. The display and player pages subscribe via Supabase Realtime (with polling fallback) to `game_states_public` for the live ball count and announcement text.

## Key Files

| Path | Purpose |
|------|---------|
| `src/app/admin/`, `src/app/host/`, `src/app/display/`, `src/app/player/`, `src/app/login/` | Page routes |
| `src/app/api/setup/route.ts` | `SETUP_SECRET`-gated bootstrap endpoint |
| `src/components/connection-banner.tsx` | Shared "Reconnecting…" banner shown on display/player when Realtime + polling both stall |
| `src/components/ui/` | Local Tailwind-based UI primitives (Button, Card, Input, etc.) |
| `src/hooks/use-connection-health.ts` | Tracks whether display/player has had a recent successful update |
| `src/hooks/wake-lock.ts` | `nosleep.js`-backed screen-keep-awake for live game pages |
| `src/lib/connection-health.ts` | Pure logic for connection-health state machine |
| `src/lib/game-state-version.ts` | `isFreshGameState()` helper — compares `state_version` between current and incoming payloads to drop stale Realtime/polling responses |
| `src/lib/prize-validation.ts` | `validateGamePrizes()` — server-side prize completeness check |
| `src/lib/win-stages.ts` | Stage helpers (e.g. `getRequiredSelectionCountForStage`) |
| `src/lib/log-error.ts` | Shared error logging helper |
| `src/lib/jackpot.ts`, `src/lib/snowball.ts` | Snowball / jackpot eligibility logic |
| `src/lib/utils.ts` | `cn()` and other small utilities |
| `src/proxy.ts` | Next.js middleware export — calls `updateSession()` on auth routes |
| `src/utils/supabase/{client,server,middleware}.ts` | Supabase client variants |
| `supabase/migrations/` | Database schema (`sessions`, `games`, `game_states`, `game_states_public`, `winners`, `snowball_pots`, etc.) |

## Environment Variables

| Var | Purpose |
|-----|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL (public) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key (public) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service-role key (server-only — bypass RLS for privileged writes) |
| `SETUP_SECRET` | Secret key for `/api/setup` admin bootstrap endpoint |
| `NEXT_PUBLIC_SITE_URL` | Public origin used as a fallback when constructing the player join URL on the display QR (e.g. `https://bingo.theanchor.pub`) |

## Project-Specific Rules / Gotchas

### Game flow

1. **Admin** creates a session, then defines games inside it (regular line / two lines / full house, optionally with a snowball jackpot).
2. **Host** picks a session/game from `/host`, starts it, and takes the controller heartbeat lock.
3. **Host** clicks "Call next number" to draw a random unused ball. Each call enforces a server-side gap (`call_delay_seconds`) and a compare-and-set guard against the previous `numbers_called_count`.
4. When a punter shouts BINGO at the table, the host **pauses for validation**, types the punter's claimed numbers, and the server checks them against the called set (including the most recent ball).
5. On a valid win, the host **records the winner** (anonymously — the app does not store player names) and the snowball pot updates if applicable.
6. After the final stage of the final game, the host ends the game/session.

### Database schema highlights

| Table | Purpose |
|-------|---------|
| `sessions` | Top-level container for a night's bingo (status: ready / running / completed) |
| `games` | Games within a session (type, stages, prizes, snowball pot link) |
| `game_states` | Live state per game — only host/admin can read |
| `game_states_public` | Public-readable mirror of `game_states`, kept in sync by the `sync_game_states_public()` trigger |
| `winners` | Audit row per recorded win (anonymised: `winner_name = 'Anonymous'`) |
| `snowball_pots` | Persistent jackpot pots that roll across sessions |
| `snowball_pot_history` | Audit trail of pot changes |

`game_states` and `game_states_public` both carry a `state_version bigint` that is incremented by the `bump_game_state_version` BEFORE UPDATE trigger on every write. Clients use `isFreshGameState()` to drop out-of-order Realtime/polling payloads.

### Realtime + polling

- Display and player pages subscribe to `game_states_public` Realtime updates AND poll on a short interval as a safety net.
- The `state_version` column is the canonical ordering field — never trust `updated_at` for ordering purposes.
- `useConnectionHealth` shows the "Reconnecting…" banner if no fresh update has arrived for several seconds. After a longer threshold, it auto-refreshes the page.

### Auth model

- Staff sign-up is **disabled**. The login page only offers Sign In. New staff accounts are created out-of-band by an admin.
- `src/proxy.ts` matcher is **scoped to `/admin/:path*`, `/host/:path*`, and `/login` only**. Public routes are not session-refreshed.
- Server actions re-verify `getUser()` and check `profiles.role` before any write.
- `recordWinner` (in `src/app/host/actions.ts`) uses the service-role client for the privileged winner insert.

### Server-side rules to preserve

- **Number-call gap** is enforced server-side from `last_call_at` + `call_delay_seconds`. Don't move this to the client.
- **Winner validation** re-reads the called-numbers array from `game_states` server-side; never trust a client-supplied list.
- **Prize completeness** is validated by `validateGamePrizes()` in both `createGame` and `updateGame`.
- **Game lock-once-started**: `updateGame` rejects edits to `prizes`, `type`, `snowball_pot_id`, `stage_sequence` once a game's `game_states.status` is anything other than `'not_started'`.
- **Delete protection**: completed games cannot be deleted; sessions cannot be deleted while they contain non-`not_started` games or have recorded winners.

### Display QR

- The big-screen display renders a QR code via `qrcode.react` so guests can scan to load the **player follower** view of the same session. There is no QR-code "join a card" flow — the player view is read-only. The QR URL is built from the request `Host` header where available, falling back to `NEXT_PUBLIC_SITE_URL`.

### Mobile / display optimisation

- Host, display, and player game pages use the `LayoutContent` client component to hide app chrome.
- `wake-lock.ts` (nosleep.js) prevents screen dimming on host and display.
- Player view is intentionally low-traffic — it's a follower screen for a punter at the table, not a competitive client.

### Testing

- Native Node.js test runner. Tests live alongside source as `*.test.ts` (e.g. `src/lib/win-stages.test.ts`, `src/lib/prize-validation.test.ts`, `src/lib/connection-health.test.ts`, `src/lib/log-error.test.ts`, `src/lib/game-state-version.test.ts`).
- Mock Supabase. Don't hit the real DB from tests.

### Deployment

- Required env: Supabase URL/keys, `SETUP_SECRET`, and `NEXT_PUBLIC_SITE_URL` for production join QR fallback.
- Enable Supabase Realtime on `game_states_public` for live updates.

### Common gotchas

- **Don't run middleware on public routes.** The proxy matcher is intentionally narrow — broadening it adds latency and a Supabase round-trip to every public page hit.
- **Don't trust `updated_at` for client-side ordering.** Use `state_version`.
- **Don't store player-identifying info on `winners`.** The app is anonymised by policy.
- **The admin "Reset Session" flow requires a typed confirmation string** (`'RESET'` or the session name).
