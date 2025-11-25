# Product Requirements Document

**Product:** Anchor Bingo Web App  
**Owner:** Pete  
**Version:** 1.1 (Integrated Refinements)  
**Date:** 24 November 2025

## 1. Overview

Anchor Bingo is a web app used to run 90‑ball bingo nights at the pub.

There are three main UIs:

1.  **Admin / Setup screen (laptop – `/admin`)**
    *   Configure sessions and games in advance.
    *   Set prizes, colours, snowball rules, defaults.
    *   View history and manage snowball pots.

2.  **Host screen (mobile‑optimised – `/host`)**
    *   Used on your phone during the night.
    *   Calls numbers, manages stages, handles breaks.
    *   Validates win claims and records winners.

3.  **Guest display (TV – `/display`)**
    *   Shown via laptop → HDMI to TV.
    *   Displays current number, last few numbers, prize, what you’re playing for.
    *   Shows breaks and big “WIN!” / “JACKPOT!” callouts.

The system uses **Next.js** for the front end and **Supabase** for auth, data, and realtime state synchronization.

## 2. Goals & Success Criteria

### 2.1 Goals

*   Make bingo nights smooth, fast and reliable.
*   Give guests a clear, attractive TV display.
*   Let you configure a whole night up front and clone it for future nights.
*   Track results and snowball pots robustly.
*   Cope with patchy internet without wrecking the night.

### 2.2 Success criteria

*   You can run a full 10‑game night (including a snowball game) using:
    *   Phone for `/host`.
    *   Laptop for `/admin` and `/display` → TV.
*   No pen‑and‑paper tracking of numbers or snowball state is required.
*   Multiple winners, mis‑claims, snowball rollovers and breaks are all handled in‑app.
*   If Wi‑Fi drops, the host can keep calling and the display can catch up later.

## 3. Scope

### 3.1 In scope (v1)

*   90‑ball bingo only (numbers 1–90).
*   Single venue (The Anchor).
*   Supabase email/password authentication.
*   Three routes: `/admin`, `/host`, `/display`.
*   Sessions (bingo nights) with a list of games.
*   Games with one or more stages:
    *   Line
    *   Two Lines
    *   Full House
*   Special Snowball game type (full house within X calls for jackpot).
*   Pre‑configuration of:
    *   Stage order per game.
    *   Prize text per stage.
    *   Background colour per game.
*   Adjustable number‑calling delay between host view and guest display.
*   Number nicknames hard‑coded (Kelly’s Eye, Two Little Ducks, etc.).
*   Win validation via 1–90 grid:
    *   Numbers tapped on host.
    *   Shown on display.
    *   System checks if they’ve all been called.
*   Multiple winners per stage.
*   Ability to skip/close a stage with no winner.
*   Winner recording (name, prize, prize given?).
*   Snowball pot logic and rollovers.
*   History of sessions, games, and winners.
*   Simple roles: Admin vs Host.
*   Offline resilience for host; display catch‑up.
*   **Correction/Void capability** for accidentally called numbers.
*   **Re-open game capability** for false wins after game closure.
*   **Sound effects** for the display client (Win, Break, Start).

### 3.2 Out of scope (v1)

*   75‑ball or other bingo variants.
*   Player‑side app, digital tickets, or QR codes.
*   Taking payments or tracking ticket sales.
*   Audio callouts (host will speak the numbers).
*   Multi‑venue / multi‑tenant setup.
*   Detailed analytics or exports beyond simple history views.
*   Multi‑language support.

## 4. Users & Roles

### 4.1 Users

*   **Admin**
    *   Usually you.
    *   Configures sessions, games, snowball pots.
    *   Manages history and can delete/duplicate sessions.
*   **Host**
    *   Staff member running the game.
    *   Uses `/host` to call numbers and validate wins.
    *   Cannot change deep configuration.
*   **Guests**
    *   Players in the pub.
    *   Only see `/display` on the TVs.

### 4.2 Roles (Supabase)

Role is stored in the user profile.

*   **Admin capabilities:**
    *   Access `/admin` and `/host`.
    *   Create/edit/delete/duplicate sessions and games.
    *   Configure snowball pots.
    *   Mark sessions as test/real.
    *   Edit winners and mark prizes given.
*   **Host capabilities:**
    *   Access `/host`.
    *   Run sessions/games (call numbers, validate wins, mark prizes given).
    *   Cannot change session/game structure or snowball pot configuration.

## 5. Core Concepts

*   **Session:** A bingo night, e.g. “Friday Cash Bingo – 12 Dec 2025”.
*   **Game:** A single bingo game within a session (Game 1, Game 2, … Game 10).
*   **Stage:** A prize stage within a game: Line, Two Lines, Full House.
*   **Snowball game:** Special game (usually Game 9) where you only play for Full House, and if someone gets a Full House within X numbers, they win the snowball jackpot.
*   **Snowball pot:** Tracks current max calls allowed, current jackpot amount, and increments if not won.
*   **Active game:** The game currently being shown on `/display` for a session.

## 6. Functional Requirements

### 6.1 Routes & app structure

**FR‑1 – Web app & primary routes**
The product is a web app with at least:
*   `/admin` – admin/setup UI (requires login).
*   `/host` – host control UI (requires login).
*   `/display` – guest display UI (no login).

*Constraint:* The `/display` and `/host` routes must utilize **WebSockets (via Supabase Realtime)** for sub-second state synchronization to ensure smooth gameplay.

**FR‑2 – Typical device usage**
*   `/admin`: Optimised for laptop/desktop.
*   `/host`: Optimised for mobile (touch‑friendly, big buttons).
*   `/display`: Optimised for 16:9 TV via laptop + HDMI (full‑screen browser).

### 6.2 Auth & roles

**FR‑3 – Authentication**
*   Use Supabase Auth (email + password).
*   Must support Login, Logout, Basic password reset.

**FR‑4 – Authorisation & roles**
*   Every user has role `admin` or `host`.
*   Route access:
    *   `/admin` → Admin only.
    *   `/host` → Admin + Host.
    *   `/display` → public (no auth).
*   Backend must enforce role restrictions for data modification.

### 6.3 Sessions & games

**FR‑5 – Create sessions**
In `/admin`, Admin can create a Session with:
*   Name (string, required).
*   Date (optional; default today).
*   Notes (optional).
*   Flag: `is_test_session` (true/false; default false).

**FR‑6 – Session statuses**
*   `draft` – being set up.
*   `ready` – configured and ready to run.
*   `running` – at least one game is in progress.
*   `completed` – all games completed.
*   Transitions: draft → ready → running → completed.
*   Once running, structural fields are locked.

**FR‑7 – Games in a session**
Admin can add ordered games to a session:
*   Game index (1, 2, 3, …).
*   Game name (string).
*   Game type: `standard`, `snowball`.
*   Stage sequence (see FR‑8).
*   Per‑stage prize text.
*   Background colour (hex code or colour picker).
*   Optional notes.

**FR‑8 – Allowed stage sequences**
For v1: `[Line]`, `[FullHouse]`, `[Line, TwoLines, FullHouse]`, `[Line, FullHouse]`, `[TwoLines, FullHouse]`.

**FR‑9 – Game templates (defaults)**
Admin can define game templates (e.g. “Standard 3‑stage”, “Snowball FH only”) to pre‑populate structure, colours, prizes.

**FR‑10 – Duplicate and Reset sessions**
*   **Duplicate session:** Copy all games and settings into a new session. No state copied.
*   **Duplicate game:** Copy a game as a new game in the same session.
*   **Reset Session:** Admin allows resetting a session (e.g. after a test run). This clears all calls, winners, and game statuses, reverting the session to `ready` state, while preserving configuration.

**FR‑11 – Session editing rules**
*   Draft/Ready: Fully editable.
*   Running: Locked stage sequences and game types for started games. Editable prize text and notes.

### 6.4 Snowball pots & snowball games

**FR‑12 – Snowball pot entity**
Tracks: Name, base/current max calls, base/current jackpot amount, increments, last awarded date.

**FR‑13 – Snowball game configuration**
*   Linked to one Snowball pot.
*   Must have stage sequence `[FullHouse]` only.
*   Can display snowball info on host and display.

**FR‑14 – Snowball win logic**
On valid Full House win:
*   If `numbers_called_count` <= `current_max_calls`:
    *   Snowball won (`is_snowball_jackpot = true`).
    *   Pot resets to base values.
    *   Display shows "JACKPOT WIN!".
*   Else:
    *   Pot rolls over (increments added).
    *   Standard Full House win recorded.
*   Split wins logic: Multiple winners on same call share the status.

**FR‑15 – Snowball management view**
Admin view to list pots, manually adjust values (logged), and reset to base.

### 6.5 Admin UI & history

**FR‑16 – Sessions list & test mode**
*   List sessions with filters (All, Test, Non-test).
*   Mark session as Test (should not update real snowball pots).

**FR‑17 – Session archive & deletion**
*   Archive: Hide from default list.
*   Delete: Permanently remove (Admin only, strong confirmation).

**FR‑18 – Session detail & game list**
*   View session info and game list with statuses.
*   View basic stats (calls, stages completed).

### 6.6 Host UI – game control

**FR‑19 – Host session & game selection**
*   List sessions (recent first).
*   Select game to start (if not started) or continue (if running).

**FR‑20 – Starting a game & number sequence**
*   Generates random 1–90 sequence server-side.
*   Initializes empty call list.

**FR‑21 – Host main layout**
*   Session/Game info, Type, Current Stage, Prize.
*   **Snowball Teasing:** Even for non-snowball games, optionally show "Tonight's Snowball: £X" in a footer or specific area to build anticipation.
*   For Snowball games: Show detailed pot info and "Jackpot if within X calls".
*   Current Number (large) + Nickname.
*   Numbers called count.
*   Last N numbers list.
*   Connection status.
*   Controls: Next Number, Break, Validate, Move Stage, End Game.

**FR‑22 – Next Number behaviour & correction**
*   **Next Number:** Selects next in sequence. Updates state immediately. Triggers display update after delay.
*   **Void/Correction (The "Fat Finger" Fix):** Host can "Void" the most recently called number.
    *   Removes it from `called_numbers`.
    *   Updates display to show the *previous* number again.
    *   Ensures integrity if a button is tapped by mistake.

**FR‑23 – Call delay configuration**
*   `callDelaySeconds` setting (e.g., 8s).
*   Applied to Display updates only. Host updates immediately.

**FR‑24 – Break control**
*   Toggle Break start/end.
*   Display shows specific Break screen.

**FR‑25 – Host connection status & wake lock**
*   Indicator: Connected / Offline.
*   Wake Lock API to prevent sleep.

**FR‑26 – Host controller lock**
*   Only one active controller per game.
*   Others see read-only view with "Take control" option.

### 6.7 Guest display (/display)

**FR‑27 – Display attachment**
*   Attach via session code/link.
*   Automatically follows the "Active Game".

**FR‑28 – Multiple displays**
*   Support multiple synced clients via Supabase Realtime.

**FR‑29 – Display states & Sound Effects**
*   **States:** Waiting, Active Game, Break, Paused (Validation), WIN!, JACKPOT, Game Finished.
*   **Sound Effects (SFX):**
    *   Game Start (Attention chime).
    *   Line / Full House Win (Celebration).
    *   False Alarm (Sad sound - optional).
    *   Break start.

**FR‑30 – Display content details**
*   Top: Logo, Session/Game Name.
*   Main: Current Number (Large), Nickname.
*   Info: Stage, Prize, Last N numbers.
*   **Snowball Teaser:** Visible footer showing current jackpot (FR-21 refinement).
*   **Accessibility:** High contrast, clear fonts.

**FR‑31 – Configurable “last N” numbers**
*   Setting `lastNumbersDisplayed` (default 10).

**FR‑32 – Display connection loss**
*   Reconnects automatically.
*   Fetches latest state immediately (no delay replay).

**FR‑33 – No preview of upcoming numbers**
*   Future numbers strictly hidden.

### 6.8 Gameplay & validation

**FR‑34 – Auto pause & fast-forward during validation**
*   "Validate ticket" pauses game.
*   **Validation Delay Logic:** If the Host hits "Validate" before the display delay has finished showing the winning number, the display must **fast-forward** to show the current number immediately, then show the "Checking claim" overlay.

**FR‑35 – Validation UI (host)**
*   1–90 grid to select claimed numbers.
*   Check Win / Cancel.

**FR‑36 – Validation display behaviour**
*   Shows "Checking a claim".
*   (Optional) Shows numbers being checked.

**FR‑37 – Win checking logic**
*   Checks if all claimed numbers are in `called_numbers`.
*   Does *not* validate ticket patterns (manual check required).

**FR‑38 – Valid win flow**
*   Display shows WIN/JACKPOT.
*   Host enters Winner details (Name, Prize, Prize Given).

**FR‑39 – Multiple winners per stage**
*   Support adding multiple winners before closing stage.

**FR‑40 – Invalid claim**
*   Host notified. Display returns to game.

**FR‑41 – Editing winners**
*   Admin can edit/void winners in history.
*   If all winners voided, stage can be reopened.

**FR‑42 – Stage closure with no winner**
*   Manual "Close stage" option (with confirmation).

**FR‑43 – Game completion & recovery**
*   End Game closes the game.
*   **Re-open Game (The "False Win" Recovery):** Admin/Host can "Re-open" the most recently finished game.
    *   Sets status back to `in_progress`.
    *   Clears the "Game Over" state.
    *   Allows host to resume calling.

### 6.9 History & reporting

**FR‑44 – Game history**
*   Stores sequence, calls, timestamps, outcomes.

**FR‑45 – Winner history**
*   Stores winner details, stage, call count, void status.

**FR‑46 – Test sessions**
*   Filtered from history, no impact on real pots.

### 6.10 Offline & resilience

**FR‑47 – Host local caching**
*   Cache state locally to allow calling/validating while offline.

**FR‑48 – Reconnect resolution**
*   Sync local state to server if host is ahead.
*   Server wins if server is ahead.

**FR‑49 – Display catch‑up**
*   Immediate state render on reconnect.

**FR‑50 – Backup call sheet**
*   Admin-only view of full sequence for emergencies.

### 6.11 Safety & destructive actions

**FR‑51 – Confirmations**
*   Required for: End game, Close stage (no winner), Delete session, Reset pot, Revert/Void actions.

## 7. Data Model (High‑level)

*   **users:** `id`, `email`, `role` (admin/host)
*   **sessions:** `id`, `name`, `date`, `status`, `is_test_session`
*   **games:** `id`, `session_id`, `index`, `type`, `stage_sequence` (JSON), `prizes` (JSON or separate table), `snowball_pot_id`
    *   *Refinement:* Consider making `prizes` a separate table or structured JSONB for better reporting.
*   **game_state:** `id`, `game_id`, `number_sequence`, `called_numbers`, `status`, `current_stage_index`, `on_break`
*   **winners:** `id`, `game_id`, `stage`, `winner_name`, `prize`, `is_snowball_jackpot`, `is_void`
*   **snowball_pots:** `id`, `name`, `current_values`...
*   **snowball_pot_history:** (New) Audit log for pot changes (who changed it, old value, new value).
*   **settings:** Global config (`default_call_delay`, `safe_zone_margins`, etc.).

## 8. Non‑functional Requirements

### 8.1 Performance
*   Host/Display updates < 1s (via Realtime).
*   Responsive UI.

### 8.2 Reliability
*   Offline mode support.
*   Zero data loss.

### 8.3 Security
*   HTTPS.
*   Role-based access control.
*   Unguessable session codes for Display.

### 8.4 Accessibility & Legibility
*   High contrast.
*   Large fonts for TV.
*   **TV Safe Zones:** Critical info must be within the 'Title Safe' area (inset 5-10% from edges) to account for overscan.

### 8.5 Browser support
*   Modern Chrome, Safari, Edge.
