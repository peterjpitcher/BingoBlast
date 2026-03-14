# OJ-CashBingo — End-to-End Review Brief

## Application Overview
A live Cash Bingo game management system for pub/venue bingo nights. Not a player-facing digital ticket app — players follow along on `/player/[sessionId]` on their phones while the host runs the game from `/host`, and a TV shows `/display/[sessionId]`.

## Tech Stack
- Next.js 16.1 App Router, React 19.2, TypeScript strict
- Supabase (PostgreSQL + Auth + RLS + Realtime)
- No external payment processing (out of scope v1)

## Routes
- `/` — Root (redirects based on auth state)
- `/login` — Auth page
- `/admin` — Admin dashboard (admin role only): create/edit sessions, configure snowball pots
- `/admin/sessions/[id]` — Session detail: add/edit games within a session
- `/admin/snowball` — Snowball pot management
- `/admin/history` — Past sessions
- `/host` — Host dashboard: pick active session/game
- `/host/[sessionId]/[gameId]` — Live game control (call numbers, validate wins, record winners)
- `/player/[sessionId]` — Public-facing player follower screen (no auth)
- `/display/[sessionId]` — TV display screen (no auth)
- `/api/setup` — One-time setup endpoint (SETUP_SECRET protected)

## Core File Inventory
```
src/
├── types/
│   ├── database.ts          — Full Supabase DB type definitions
│   └── actions.ts           — ActionResult type
├── lib/
│   ├── utils.ts             — cn(), isUuid(), formatDate()
│   ├── jackpot.ts           — isCashJackpotGame(), parseCashJackpotAmount(), formatCashJackpotPrize()
│   └── snowball.ts          — formatPounds(), isSnowballJackpotEligible(), getSnowballCallsLabel(), getSnowballCallsRemaining()
├── utils/supabase/
│   ├── client.ts            — Browser Supabase client
│   ├── server.ts            — Server Supabase client (cookie-based)
│   └── middleware.ts        — Session refresh + route protection (auth guard)
├── hooks/
│   └── wake-lock.ts         — Screen wake lock hook
├── components/
│   ├── header.tsx
│   ├── layout-content.tsx
│   └── ui/                  — button, card, input, modal, bingo-ball
├── app/
│   ├── layout.tsx           — Root layout
│   ├── page.tsx             — Root page
│   ├── admin/
│   │   ├── actions.ts       — Server actions: createSession, updateSession, deleteSession, duplicateSession, createGame, updateGame, deleteGame
│   │   ├── page.tsx         — Admin page (server component)
│   │   ├── dashboard.tsx    — Admin dashboard (client, session/game CRUD)
│   │   ├── history/page.tsx
│   │   ├── sessions/[id]/
│   │   │   ├── actions.ts   — Session-scoped actions: addGame, editGame, deleteGame, setActiveGame, endSession, duplicateGame
│   │   │   ├── page.tsx
│   │   │   └── session-detail.tsx
│   │   └── snowball/
│   │       ├── actions.ts   — Snowball pot CRUD + manual adjustments
│   │       ├── page.tsx
│   │       └── snowball-list.tsx
│   ├── host/
│   │   ├── actions.ts       — ALL game control actions (callNextNumber, toggleBreak, validateClaim, recordWinner, skipStage, voidLastNumber, pauseForValidation, resumeGame, announceWin, toggleWinnerPrizeGiven, takeControl, sendHeartbeat, moveToNextGameOnBreak, moveToNextGameAfterWin, advanceToNextStage)
│   │   ├── page.tsx
│   │   └── dashboard.tsx
│   │   └── [sessionId]/[gameId]/
│   │       ├── page.tsx
│   │       └── game-control.tsx — Main host UI (huge client component)
│   ├── player/[sessionId]/
│   │   ├── page.tsx
│   │   └── player-ui.tsx
│   ├── display/[sessionId]/
│   │   ├── page.tsx
│   │   └── display-ui.tsx
│   ├── login/
│   │   ├── actions.ts
│   │   └── page.tsx
│   └── api/setup/route.ts
├── proxy.ts                  — Supabase admin client (service role)
└── supabase/migrations/      — DB schema + RLS policies
```

## Database Tables (key)
- `sessions` — id, name, start_date, status (ready/running/completed), active_game_id, is_test_session
- `games` — id, session_id, name, game_index, type (standard/snowball/jackpot), stage_sequence (JSON array of WinStage), prizes (JSON), background_colour, snowball_pot_id, jackpot_amount
- `game_states` — Private table: game_id, called_numbers, numbers_called_count, current_stage_index, status (not_started/in_progress/completed), call_delay_seconds, on_break, paused_for_validation, display_win_type, display_win_text, display_winner_name, started_at, ended_at, last_call_at, updated_at, controller_id, controller_heartbeat_at
- `game_states_public` — Synced from game_states via trigger (excludes controller fields). Realtime-enabled for players/display.
- `winners` — id, game_id, session_id, stage, winner_name, prize_description, call_count_at_win, is_snowball_jackpot, snowball_jackpot_amount, prize_given
- `snowball_pots` — id, name, base_max_calls, current_max_calls, base_jackpot_amount, current_jackpot_amount, jackpot_increment, max_calls_increment, last_awarded_at
- `snowball_pot_history` — Audit trail for pot changes
- `profiles` — id (FK auth.users), role (admin/host)

## Game Types
- **standard** — Multi-stage (e.g., Line → Two Lines → Full House). Each stage has a prize.
- **snowball** — Full House only. Linked to a snowball_pot. Jackpot window: if called ≤ current_max_calls, jackpot won + pot resets. Else rollover (increments added).
- **jackpot** — Full House only. Fixed cash prize displayed prominently.

## Key Business Rules
1. Host must "take control" of a game before calling numbers (controller_id + heartbeat system)
2. Only one game active per session at a time (sessions.active_game_id)
3. Number calling is locked during: on_break=true, paused_for_validation=true, display sync window
4. Claim validation: claimedNumbers must all be in calledNumbers; last called number must be included; exact count required per stage
5. Snowball jackpot determined server-side only (not trusted from client)
6. Test sessions skip snowball pot updates
7. Players/display are public (no auth) — they read game_states_public via Realtime
8. After last stage completes, game status → 'completed', session advances
9. call_delay_seconds = 1 (recently set to 1 second)

## Known Architecture Concerns (from recon)
- `recordWinner` does sequential DB writes (winners insert → game_state update → snowball pot update) with no transaction
- `updateSnowballPotOnGameEnd` called from `advanceToNextStage` (separate call) — partial failure risk
- Abundant console.log/console.error in production code
- `game_states_public` sync relies on DB trigger — trigger failure means player/display see stale state
- No Zod validation on server action inputs
- `requireController` uses service role client for controller check
