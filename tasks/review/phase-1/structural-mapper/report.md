# Structural Mapper Report — OJ-CashBingo

## 1. Route & Page Inventory

| Route | Type | Auth | Server Data Fetched | Client State | Realtime Subs |
|-------|------|------|---------------------|--------------|----------------|
| `/` | Server | None | session + redirect logic | — | — |
| `/login` | Client | None (redirects logged-in) | — | email/password form | — |
| `/admin` | Server | admin role | profiles (via middleware) | — | — |
| `/admin` dashboard | Client | admin role | sessions + games (via server action) | sessions list, modal state | — |
| `/admin/sessions/[id]` | Server | admin role | session + games + snowball pots | — | — |
| `/admin/sessions/[id]` detail | Client | admin role | — | games list, modals | — |
| `/admin/snowball` | Server | admin role | snowball pots | — | — |
| `/admin/history` | Server | admin role | completed sessions | — | — |
| `/host` | Server | host or admin | sessions | — | — |
| `/host` dashboard | Client | host or admin | — | session/game selection | game_states (via controller poll) |
| `/host/[sessionId]/[gameId]` | Server | host or admin | session + game + game_state + winners | — | — |
| `/host/[sessionId]/[gameId]` control | Client | host or admin | — | full game state, winners, snowball pot | game_states (private), snowball_pots |
| `/player/[sessionId]` | Server | **none (public)** | session + active game + game_state_public | — | — |
| `/player/[sessionId]` UI | Client | none | — | game state, called numbers, delayed display | game_states_public + sessions |
| `/display/[sessionId]` | Server | **none (public)** | session + active game + game_state_public | — | — |
| `/display/[sessionId]` UI | Client | none | — | game state, QR, win display | game_states_public + sessions |
| `/api/setup` | API Route | SETUP_SECRET header | — | — | — |

## 2. Server Action Inventory

### `src/app/admin/actions.ts`
| Action | Auth | Reads | Writes | Returns |
|--------|------|-------|--------|---------|
| `createSession` | admin | — | sessions | ActionResult |
| `updateSession` | admin | sessions | sessions | ActionResult |
| `deleteSession` | admin | — | sessions (delete, cascade) | ActionResult |
| `duplicateSession` | admin | sessions + games | sessions + games | ActionResult |
| `createGame` | admin | — | games + game_states | ActionResult |
| `updateGame` | admin | games | games | ActionResult |
| `deleteGame` | admin | — | games (delete, cascade) | ActionResult |

### `src/app/admin/sessions/[id]/actions.ts`
| Action | Auth | Reads | Writes | Returns |
|--------|------|-------|--------|---------|
| `addGame` | admin | — | games + game_states | ActionResult |
| `editGame` | admin | games | games | ActionResult |
| `deleteGame` | admin | — | games (cascade) | ActionResult |
| `setActiveGame` | admin | sessions, games | sessions (active_game_id), game_states (status→in_progress) | ActionResult |
| `endSession` | admin | games | sessions (status→completed) + game_states (status→completed for all in-progress) | ActionResult |
| `resetSession` | admin | sessions, games | sessions + game_states | ActionResult |
| `duplicateGame` | admin | games + game_states | games + game_states | ActionResult |

### `src/app/admin/snowball/actions.ts`
| Action | Auth | Reads | Writes | Returns |
|--------|------|-------|--------|---------|
| `createSnowballPot` | admin | — | snowball_pots | ActionResult |
| `updateSnowballPot` | admin | snowball_pots | snowball_pots + snowball_pot_history | ActionResult |
| `deleteSnowballPot` | admin | games (unlink) | games (null snowball_pot_id) + snowball_pot_history (delete) + snowball_pots (delete) | ActionResult |
| `resetSnowballPot` | admin | snowball_pots | snowball_pots + snowball_pot_history | ActionResult |
| `adjustSnowballPot` | admin | snowball_pots | snowball_pots + snowball_pot_history | ActionResult |

### `src/app/host/actions.ts`
| Action | Auth | Reads | Writes | Returns |
|--------|------|-------|--------|---------|
| `callNextNumber` | requireController | game_states | game_states (+ trigger → game_states_public) | ActionResult |
| `voidLastNumber` | requireController | game_states | game_states | ActionResult |
| `toggleBreak` | requireController | game_states | game_states | ActionResult |
| `pauseForValidation` | requireController | game_states | game_states | ActionResult |
| `resumeGame` | requireController | game_states | game_states | ActionResult |
| `validateClaim` | authorizeHost | game_states | — (read-only validation) | ActionResult with valid/invalidNumbers |
| `recordWinner` | requireController | game_states + games + snowball_pots | winners + game_states + [snowball pot via updateSnowballPotOnGameEnd] | ActionResult |
| `announceWin` | requireController | — | game_states | ActionResult |
| `toggleWinnerPrizeGiven` | authorizeHost | — | winners | ActionResult |
| `skipStage` | requireController | game_states + games | game_states | ActionResult |
| `advanceToNextStage` | requireController | game_states + games | game_states + [snowball pot via updateSnowballPotOnGameEnd] | ActionResult |
| `moveToNextGameOnBreak` | requireController | sessions + games | sessions (active_game_id) + game_states (status) | ActionResult |
| `moveToNextGameAfterWin` | requireController | sessions + games | sessions (active_game_id) + game_states | ActionResult |
| `takeControl` | authorizeHost | game_states | game_states (controller_id + heartbeat) | ActionResult |
| `sendHeartbeat` | authorizeHost | — | game_states (controller_heartbeat_at) | ActionResult |
| `updateSnowballPotOnGameEnd` (internal) | — | sessions + games + winners + snowball_pots | snowball_pots + snowball_pot_history | void |

### `src/app/login/actions.ts`
| Action | Auth | Reads | Writes | Returns |
|--------|------|-------|--------|---------|
| `login` | None | — | Supabase auth session | redirect |
| `signup` | None | — | Supabase auth + profiles | redirect |
| `signout` | Required | — | Supabase auth session (destroy) | redirect |

## 3. State Machines

### Session Lifecycle
```
ready ──(setActiveGame)──→ running ──(endSession)──→ completed
                                   ←──(resetSession)──
```
- `ready`: created, no active game or game was ended
- `running`: active_game_id is set and game is running
- `completed`: all games finished, player sees thank-you screen
- Missing: no `paused` state; no explicit transition if session has no games

### Game Lifecycle
```
not_started ──(setActiveGame/startGame)──→ in_progress ──(last stage completes)──→ completed
                 on_break: false → true → false (toggleBreak)
                 paused_for_validation: false → true → false (pauseForValidation/resumeGame)
```

### Snowball Pot Lifecycle
```
base values ──(game ends, jackpot won)──→ reset to base (+ last_awarded_at)
            ──(game ends, no jackpot)──→ rollover (current += increment)
            ──(admin manual adjust)──→ any values (logged in history)
            ──(admin reset)──→ base values (logged in history)
```
Trigger condition: `updateSnowballPotOnGameEnd(gameId)` called from `advanceToNextStage` and `recordWinner`

## 4. Real-time Architecture

### Realtime-enabled Tables
- `game_states_public` — enabled via migration (`ALTER PUBLICATION supabase_realtime ADD TABLE`)
- `sessions` — enabled (players/display subscribe to session updates)
- `snowball_pots` — enabled (host subscribes for live pot display)

### Subscription Channels
| Channel Pattern | Component | Events | Trigger |
|-----------------|-----------|--------|---------|
| `session_updates:{sessionId}` | player-ui, display-ui | UPDATE on sessions | session changes |
| `game_state_public_updates:{gameId}` | player-ui, display-ui | UPDATE on game_states_public | trigger sync |
| `pot_updates_host:{potId}` | game-control | UPDATE on snowball_pots | direct updates |
| `game_state_host_updates:{gameId}` | game-control | UPDATE on game_states | direct updates (private) |

### game_states → game_states_public Sync
Trigger function `sync_game_states_public()` fires AFTER INSERT/UPDATE/DELETE on `game_states`. Syncs all columns EXCEPT `controller_id` and `controller_heartbeat_at`. If trigger fails: players/display see stale data indefinitely with no error surfaced.

### Polling Fallback
- Player UI: 5-second setInterval polling fallback (fetches session + game_state if Realtime subscription is silent)
- Display UI: 5-second setInterval polling fallback
- Host game control: No polling fallback — depends purely on Realtime subscription for game_states

## 5. Data Model Relationships

```
sessions
  ├── active_game_id → games.id (nullable FK)
  └── games (1:N)
        ├── game_states (1:1, game_id FK, ON DELETE CASCADE)
        ├── game_states_public (1:1, synced via trigger)
        ├── winners (1:N, game_id FK)
        └── snowball_pot_id → snowball_pots.id (nullable FK)

snowball_pots
  └── snowball_pot_history (1:N)

profiles
  └── id → auth.users.id (FK)
```

**Orphan Risks:**
- `deleteSession`: cascades to games → cascades to game_states and game_states_public. Winners table FK to game_id — if no cascade on winners, deletion will fail or leave orphans (need to verify)
- `deleteSnowballPot`: manually unlinks games first (sets snowball_pot_id = null), then deletes. If game unlink fails, pot deletion fails (acceptable)

## 6. Multi-step Operations (Partial Failure Risk)

| Operation | Step 1 | Step 2 | Step 3 | Step 4 | Risk if Step N fails |
|-----------|--------|--------|--------|--------|---------------------|
| `recordWinner` | Read live call count | Fetch game + pot | INSERT winners | UPDATE game_states display fields | Winner inserted but display not updated |
| `advanceToNextStage` | Fetch game_state | Fetch game details | UPDATE game_states | Call `updateSnowballPotOnGameEnd` | Stage advanced but pot not updated |
| `updateSnowballPotOnGameEnd` | Check test session | Check game type | Check jackpot winners | UPDATE snowball_pots | Partial: pot state wrong |
| `moveToNextGameAfterWin` | Fetch session + games | Find next game | UPDATE sessions (active_game_id) | UPDATE game_states | Session points to new game but old game state not cleaned |
| `endSession` | Fetch in-progress games | UPDATE game_states (completed) | UPDATE sessions (completed) | — | Games ended but session still shows 'running' |
| `deleteSnowballPot` | UPDATE games (unlink) | DELETE snowball_pot_history | DELETE snowball_pots | — | Games unlinked but pot not deleted |
| `setActiveGame` | Fetch game | UPDATE game_states (in_progress) | UPDATE sessions (active_game_id + status) | — | Game started but session not updated |

## 7. External Dependencies

| Dependency | Purpose | Version | Required Env Vars |
|-----------|---------|---------|-------------------|
| @supabase/ssr | Auth + DB client | ^0.8.0 | NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY |
| @supabase/supabase-js | Admin client | ^2.91.0 | SUPABASE_SERVICE_ROLE_KEY |
| qrcode.react | QR code display | ^4.2.0 | — |
| nosleep.js | Wake lock fallback | ^0.12.0 | — |
| react-player | Video (not in use) | ^3.4.0 | — |
| zod | Validation (snowball only) | ^4.3.5 | — |
| next | Framework | 16.1.4 | — |
| Supabase Realtime | Live updates | — | Realtime enabled on project |
| Supabase RLS | Row-level security | — | All tables have RLS |
| DB Triggers | game_states → public sync | — | Migration applied |
| SETUP_SECRET | API setup protection | — | SETUP_SECRET |

## 8. What's Missing

- **No Zod validation** on any server action inputs (callNextNumber, recordWinner, validateClaim etc.) — only snowball pot actions use Zod
- **No DB transactions** — all multi-table writes are sequential separate calls
- **react-player imported** but not actively used in any visible game flow
- **signup action** in login/actions.ts — no public sign-up route; this is a potential vulnerability if signup isn't properly disabled
- **No audit trail** for winner edits (toggleWinnerPrizeGiven, admin winner editing)
- **No rate limiting** on any server action
- **Test suite**: tests/ directory exists but minimal coverage (native Node runner, not Vitest)
- **controller expiry logic**: heartbeat timeout threshold not found in middleware — appears to be checked in `requireController` but exact expiry value unclear
- **No error boundary** in player-ui or display-ui — JS error crashes entire screen with no recovery UI
