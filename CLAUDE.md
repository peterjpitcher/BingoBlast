# CLAUDE.md — Anchor Bingo

This file provides project-specific guidance. See the workspace-level `CLAUDE.md` one directory up for shared conventions.

## Quick Profile

- **Framework**: Next.js 16.1, React 19.2 (App Router)
- **Styling**: Tailwind CSS v4 with local UI primitives in `src/components/ui/`
- **Test runner**: Node.js native test runner (see `npm test`)
- **Database**: Supabase (PostgreSQL + RLS + Realtime)
- **Key integrations**: `@supabase/ssr` (cookie-based SSR), `qrcode.react` (display QR for player follower URL), `nosleep.js` (screen-keep-awake on host/display), `zod` (server-action input validation)
- **Size**: ~43 files in `src/`

## Commands

```bash
npm run dev              # Start development server
npm run build            # Production build
npm run start            # Start production server
npm run lint             # ESLint check
npm test                 # Node.js native test runner (node --test --import tsx)
```

Note: Uses native Node.js test runner (no Jest/Vitest). Tests cover the shared lib helpers — UI is not unit-tested.

## What This Application Is

A **90-ball pub bingo control system** for The Anchor. There are no digital cards, no per-player marking, and no QR-driven join into a card. Players use physical paper bingo books at the table. The app exists to:

1. Help the host call numbers and pace the game.
2. Manage the snowball jackpot across sessions.
3. Validate winners on demand.
4. Drive a public big-screen TV display showing the live game state.
5. Drive a public mobile follower screen for guests at the table.

Three classes of user:

| User | Routes | Auth |
|------|--------|------|
| Admin / host (staff) | `/admin/*`, `/host/*` | Supabase Auth (cookie session) |
| Big-screen pub TV | `/display`, `/display/[sessionId]` | Public |
| Guest mobile follower | `/player/[sessionId]` | Public, guest-friendly |

## Architecture

**Route structure** (App Router):

| URL | Purpose |
|-----|---------|
| `/` | Public landing page |
| `/login` | Staff login (invite-only — no public sign-up) |
| `/admin` | Sessions list |
| `/admin/sessions/[id]` | Session detail / game CRUD |
| `/admin/snowball` | Snowball pot management |
| `/admin/history` | Past sessions / winners |
| `/admin/backup` | Export tool |
| `/host` | Host dashboard |
| `/host/[sessionId]/[gameId]` | Live host control |
| `/display` | Auto-redirects to active session's display |
| `/display/[sessionId]` | Big-screen TV view |
| `/player/[sessionId]` | Mobile follower view |

**Auth proxy**: `src/proxy.ts` registers Next.js middleware via `proxy()` and a tightly scoped matcher running `updateSession()` (in `src/utils/supabase/middleware.ts`) only on `/admin/:path*`, `/host/:path*`, and `/login`. Public routes (`/display/*`, `/player/*`, `/`) bypass the middleware entirely. Defence in depth: every protected `page.tsx` server component also calls `supabase.auth.getUser()` and redirects to `/login` if absent.

**Database**: Supabase PostgreSQL. Core tables: `sessions`, `games`, `game_states`, `game_states_public`, `winners`, `snowball_pots`, `snowball_pot_history`, `profiles`. Both `game_states` and `game_states_public` carry a `state_version bigint` bumped by the `bump_game_state_version` BEFORE UPDATE trigger on every write; the `sync_game_states_public()` trigger keeps the public mirror in step.

**Data flow**: Admin defines a session and games. Host opens a game, calls numbers (server-side gap-enforced), pauses for validation, records winners. Display and player pages subscribe to `game_states_public` via Supabase Realtime with polling fallback, using `state_version` to discard stale payloads.

## Key Files

| Path | Purpose |
|------|---------|
| `src/types/` | Shared TS types incl. generated `Database` |
| `src/lib/` | Shared logic — `connection-health`, `game-state-version`, `prize-validation`, `win-stages`, `jackpot`, `snowball`, `log-error`, `utils` |
| `src/hooks/` | `use-connection-health`, `wake-lock` |
| `src/components/` | `connection-banner`, `header`, `layout-content`, `ui/*` |
| `src/app/` | Next.js routes (admin, host, display, player, login, api/setup) |
| `src/utils/supabase/` | Supabase client variants — `client.ts`, `server.ts`, `middleware.ts` |
| `src/proxy.ts` | Next.js middleware export — calls `updateSession()` on auth routes |
| `supabase/migrations/` | DB schema (sessions, games, game_states, winners, snowball_pots, etc.) |

## Environment Variables

| Var | Purpose |
|-----|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL (public) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key (public) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service-role key (server-only) |
| `SETUP_SECRET` | Secret for `/api/setup` admin bootstrap endpoint |
| `NEXT_PUBLIC_SITE_URL` | Public origin (e.g. `https://bingo.theanchor.pub`) — fallback for the player-follower QR URL when request headers are unavailable |

## Project-Specific Rules / Gotchas

### Game Flow

1. **Admin** creates a session, then defines games inside it (regular line / two lines / full house, optionally with a snowball jackpot).
2. **Host** picks a session/game from `/host`, starts it, and the host page takes the controller heartbeat lock.
3. **Host** clicks "Call next number". The server enforces a delay between calls (`call_delay_seconds`) and uses a compare-and-set guard against the previous `numbers_called_count` to prevent double-calls under contention.
4. When a punter shouts BINGO, the host pauses for validation, types the claimed numbers, and the server validates them against the called set including the most recent ball.
5. On a valid win, the host records the winner (anonymously — the app does not store player names) and the snowball pot updates if applicable.
6. After the final stage of the final game, the host ends the game/session.

### What This App Does NOT Do

- It does **not** generate digital bingo cards.
- It does **not** mark squares for players.
- It does **not** support a "join via QR" card-issue flow. The QR on the display goes to the read-only **follower** view of the session, which simply mirrors what's already on the big screen.
- It does **not** support 75-ball bingo. Only 90-ball.
- It does **not** broadcast number announcements with audio (no `react-player`).

### Win Detection (Server-Side Validation)

- The host pauses the game and types in the punter's claimed numbers from their paper book.
- `validateClaim` server action: confirms the claimed list includes the most recently called number, then checks every claimed number is in the called set. The required claim count comes from `getRequiredSelectionCountForStage` in `src/lib/win-stages.ts`.
- The action returns `{ valid: true }` or `{ valid: false, invalidNumbers }`. Multiple winners per stage are valid (tie scenario).

### Realtime Updates

- Supabase Realtime on `game_states_public` plus a polling fallback on a short interval. The "Reconnecting…" banner (`src/components/connection-banner.tsx`) is shown when both stall.
- **Use `state_version` for ordering, never `updated_at`.** `isFreshGameState()` in `src/lib/game-state-version.ts` is the canonical comparator for incoming payloads.

### Display QR

- The big-screen display renders a QR via `qrcode.react` pointing at `/player/[sessionId]` so a punter at the table can scan it on their phone and follow along.
- The QR URL is built from the `Host` header where available, falling back to `NEXT_PUBLIC_SITE_URL` in production.

### Mobile / Display Optimisation

- Host, display, and player game pages use `LayoutContent` (client component) to hide app chrome.
- `wake-lock.ts` (`nosleep.js`-backed) keeps the screen awake on host and display during a live game.

### Game State Management

- Server is the source of truth for `game_states` and the public mirror.
- `getCurrentGameState` and Realtime payloads return the full row including `state_version`.
- Host actions persist all changes through `game_states` writes; the trigger maintains `game_states_public` automatically.

### Database Schema

| Table | Purpose |
|-------|---------|
| `sessions` | Top-level container (status: ready / running / completed) |
| `games` | Games within a session (type, stages, prizes, snowball pot link) |
| `game_states` | Live state per game (host/admin readable, has `state_version`) |
| `game_states_public` | Public-readable mirror of `game_states` (has `state_version`, kept in sync by `sync_game_states_public()`) |
| `winners` | Audit row per recorded win (`winner_name = 'Anonymous'`) |
| `snowball_pots` / `snowball_pot_history` | Cross-session jackpot pots and audit trail |
| `profiles` | User role lookup (`'admin'` vs others) |

### Security

- Staff sign-up is **disabled** — the login page does not offer a sign-up toggle. New staff accounts are created out-of-band by an admin.
- RLS is on for all tables. Public clients only see `game_states_public`.
- Host actions re-verify auth and check `profiles.role`. `recordWinner` uses the service-role client for the privileged insert.
- Server-side number-call gap enforcement (don't move client-side).
- `validateClaim` re-reads the called-numbers list server-side; never trusts client input.
- Delete-protection: started/completed games cannot be deleted; sessions with non-`not_started` games or recorded winners cannot be deleted.
- `SETUP_SECRET` required for `/api/setup`.

### Performance

- Public routes deliberately bypass the proxy/middleware to keep the display + player pages fast.
- The `state_version`-based stale-payload check prevents UI thrash when Realtime and polling overlap.

### Anonymous Winners

- `winners.winner_name` is always `'Anonymous'`. There is no UI input for a winner name and no plan to add one.

### Accessibility

- Display has high-contrast number readout for the back of the room.
- All interactive elements have visible focus styles.
- "Reconnecting…" banner uses `aria-live="polite"`.

### Testing

- Native Node.js test runner. Tests live alongside source: `src/lib/*.test.ts`.
- Existing coverage: `connection-health`, `game-state-version`, `log-error`, `prize-validation`, `win-stages`, plus a handful of small utility tests.
- Mock Supabase — don't hit a real database from tests.

### Deployment

- Required env: Supabase URL + keys, `SETUP_SECRET`, `NEXT_PUBLIC_SITE_URL` (for the production join QR fallback).
- Enable Supabase Realtime on `game_states_public`.

### Common Patterns

- Admin → game CRUD → host flow → display + player follower views.
- Concurrent sessions are not supported in practice — a single live session at a time.

### Gotchas

- **Don't broaden the proxy matcher.** It is intentionally `/admin/:path*`, `/host/:path*`, `/login` only. Adding `/display/*` or `/player/*` makes a Supabase round-trip on every TV / phone refresh.
- **Don't reintroduce a sign-up affordance.** Staff are invite-only.
- **Don't trust `updated_at` for ordering.** Use `state_version`.
- **Don't store player-identifying info.** Winners are anonymised by policy.
- **Don't drop the server-side number-call gap.** It's the only thing preventing double-calls under contention.
