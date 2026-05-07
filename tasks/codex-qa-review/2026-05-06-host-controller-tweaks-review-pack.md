# Review Pack: host-controller-tweaks

**Generated:** 2026-05-06
**Mode:** C (A=Adversarial / B=Code / C=Spec Compliance)
**Project root:** `/Users/peterpitcher/Cursor/OJ-CashBingo`
**Base ref:** `HEAD`
**HEAD:** `786eacd`
**Diff range:** `HEAD`
**Stats:**  8 files changed, 97 insertions(+), 134 deletions(-)

> This pack is the sole input for reviewers. Do NOT read files outside it unless a specific finding requires verification. If a file not in the pack is needed, mark the finding `Needs verification` and describe what would resolve it.

## Changed Files

```
.claude/changes-manifest.log
.gitignore
docs/architecture/data-model.md
docs/architecture/overview.md
docs/architecture/README.md
docs/architecture/relationships.md
docs/architecture/routes.md
docs/architecture/server-actions.md
tasks/host-controller-tweaks/SPEC.md
tasks/review/phase-1/remediation-plan.md
```

## User Concerns

Spec proposes UI tweaks to host controller: remove call-delay hint, move nickname above ball, add pre-game briefing (game header, prize ladder, optional house rules first-game-only), tighten spacing. New shared lib files: src/lib/colour-name.ts (hex->name) and src/lib/house-rules.ts. Display TV must remain visually unchanged. Host page gains one Supabase read for min(game_index). Briefing only renders when numbers_called_count===0. Validate the proposed approach against the live host controller and display code.

## Spec

Source: `/Users/peterpitcher/Cursor/OJ-CashBingo/tasks/host-controller-tweaks/SPEC.md`

```markdown
# Host Controller — Pre-Game Briefing & Layout Tightening

**Status:** Draft for review
**Author:** Claude
**Date:** 2026-04-30
**Scope:** Host control screen only (`/host/[sessionId]/[gameId]`). Display TV and player follower views are unchanged.

---

## Background

Host (the caller) operates the game from a phone-sized screen. Two friction points have surfaced in live use:

1. The pre-game state on the host doesn't tell the host what they need to read out — game number, prize ladder, and (for the first game of the night) the house rules. They currently have to guess or look at the big screen.
2. The "Players see this in 2s" hint is no longer useful and steals vertical space.
3. The number nickname is below the ball; eyes drop to it after the ball, when the host wants to call the nickname *while* the ball is being seen.
4. On a typical iPhone Safari viewport, "Take Break" and "Check Claim" are clipped at the bottom — the host has to scroll to reach them mid-game.

The display TV already implements the same pre-game pattern (rules + prize ladder); we should mirror that on the host screen so the host reads what the room sees.

## Goals

- Host knows what to say at the start of every game without leaving the controller.
- Host gets the rules in front of them once per session (first game only).
- Primary controls (Next Number, Take Break, Check Claim) all visible above the fold on iPhone-class viewports.
- No regression to the live-call surface or the public display/player views.

## Non-Goals

- No change to the public display TV (`/display/[sessionId]`) layout.
- No change to the player follower (`/player/[sessionId]`).
- No change to data model, server actions, or RLS.
- No change to the house-rules wording — we reuse the existing rules verbatim.
- No persistence change for the call-delay seconds (still on `game_states.call_delay_seconds`, just no longer surfaced on the host).

---

## Change 1 — Remove "Players see this in 2s" from host

**Current:** [src/app/host/[sessionId]/[gameId]/game-control.tsx:801-805](src/app/host/[sessionId]/[gameId]/game-control.tsx:801) renders a `<p>` between the nickname and the stats row reading `Players see this in {currentGameState.call_delay_seconds ?? 2}s`.

**Proposed:** Delete the paragraph entirely. The `call_delay_seconds` value is still used downstream for the public display delay; we just stop surfacing it on the host.

**Verification:** Snapshot the host screen with `numbers_called_count > 0`; the line is gone, no other change.

---

## Change 2 — Move number nickname above the ball

**Current order in the main card:**
1. Big bingo ball (or "READY" placeholder)
2. Nickname (e.g. "Stuck In The Tree")
3. (deleted) "Players see this in Xs"
4. Stats row (Calls / Playing For / Prize)

**Proposed order:**
1. Nickname (e.g. "Stuck In The Tree") — only when there is a current number
2. Big bingo ball (or "READY" placeholder when no current number)
3. Stats row (Calls / Playing For / Prize)

**Notes:**
- Nickname is conditional — if there is no current number, no slot is rendered.
- For numbers with no entry in `NUMBER_NICKNAMES`, the nickname slot stays empty (same as today). Do not render an empty heading element.
- Animation on the nickname (`animate-in fade-in slide-in-from-bottom-4`) becomes `slide-in-from-top-4` so it still feels like it is arriving with the new number.

**Verification:** Call a number with a known nickname (e.g. 53). Nickname renders above the ball. Call a number without a nickname (e.g. 18). Only the ball renders; no empty space where the nickname would be.

---

## Change 3 — Pre-game briefing on the host

**Trigger condition:** the briefing renders whenever `numbers_called_count === 0`. It applies to **every** game in the session — the host gets a fresh briefing before game 1, game 2, game 3, etc., so they can read out that game's prizes before kicking off.

**Rules sub-block trigger:** the HOUSE RULES portion of the briefing is only included when this is the first game of the session — `game.game_index === min(game_index)` across the session's games. Games 2+ get the briefing without the rules.

**What replaces the empty "READY" disc when the briefing is showing:**

```
┌─────────────────────────────────────────────┐
│  GAME 1 · STANDARD                          │   ← header strip
│  ● Green   Friday Night Bingo               │   ← colour dot + colour name + game name
├─────────────────────────────────────────────┤
│  TONIGHT YOU CAN WIN                        │
│  Stage 1: Line          —  £20             │
│  Stage 2: Two Lines     —  Bottle of Prosecco │
│  Stage 3: Full House    —  £50 + Snowball  │
├─────────────────────────────────────────────┤
│  HOUSE RULES                                │
│  ➤ Claims must be called on the number     │
│    they're won on — late claims invalid.    │
│  ➤ Multiple claims share the prize.         │
│  ➤ Snowball eligibility: must have been    │
│    here for the last three games.           │
│  🎉 Enjoy the night and best of luck!       │
└─────────────────────────────────────────────┘
        [        NEXT NUMBER        ]
        [  Take Break  ][ Check Claim ]
```

**Header strip fields:**
- `GAME {game.game_index}` — bold, large.
- `· {game.type.toUpperCase()}` — secondary, always shown. `STANDARD`, `SNOWBALL`, or `JACKPOT`.
- A 12 px round colour dot filled with `game.background_colour`, followed by the **colour name in words** (e.g. `Green`, `Red`), followed by the game name. Colour name is for accessibility — the host is colour-blind and needs the word, not just the dot.

**Colour-name resolution:**
- New helper `src/lib/colour-name.ts` exports `getColourName(hex: string): string`.
- Curated palette of 12 names: `White`, `Black`, `Grey`, `Red`, `Orange`, `Yellow`, `Green`, `Teal`, `Blue`, `Purple`, `Pink`, `Brown`.
- Returns the nearest palette label by Euclidean distance in RGB space.
- Returns an empty string if the input is not a valid `#rrggbb` hex; the briefing then falls back to showing the dot only.
- Tested in `src/lib/colour-name.test.ts` — happy path (`#ffffff` → "White", `#16a34a` → "Green") plus an invalid input case.

**Prize ladder block:**
- Title: `TONIGHT YOU CAN WIN`.
- One row per entry in `game.stage_sequence`, in order:
  - Left: `Stage {n}: {stage label}` — `Line` / `Two Lines` / `Full House` rendered verbatim (no extra formatting helper needed; the values are already the display labels).
  - Right: prize text from `game.prizes[stage]`. If missing, render `⚠️ Prize not set` in the destructive colour (matches the host stats row's existing missing-prize style).
- Snowball game: under the ladder, a single line — `Snowball jackpot: £{current_jackpot_amount} (within first {current_max_calls} calls).` Only when `game.type === 'snowball'` and `currentSnowballPot` is loaded.

**House rules block:**
- Shown only when the briefing is for the first game of the session (`isFirstGameOfSession === true`). Games 2+ render the briefing without this block.
- Content lives in **`src/lib/house-rules.ts`** (new file) as a single exported constant `HOUSE_RULES`. Shape: `{ items: Array<{ icon: string; text: string }> }`.
- Both the host briefing and the existing `renderHouseRulesPanel` in [display-ui.tsx:471-493](src/app/display/[sessionId]/display-ui.tsx:471) consume `HOUSE_RULES`. The display visual styling stays exactly as-is; only the data source changes from inline JSX to the shared constant.
- Title on the host briefing: `HOUSE RULES`.
- Read-only — no interactive elements.

**How the host page learns "first game":**
- Add one extra Supabase read in [src/app/host/[sessionId]/[gameId]/page.tsx](src/app/host/[sessionId]/[gameId]/page.tsx): `select('game_index').eq('session_id', sessionId).order('game_index', { ascending: true }).limit(1).single()`.
- Compare against the loaded `game.game_index`.
- Pass `isFirstGameOfSession: boolean` as a prop to `<GameControl>`.

**Behaviour after the first call:**
- The briefing disappears the moment `numbers_called_count` becomes `1` — replaced by the standard nickname → ball → stats layout.
- Calling "Undo Last Call" back to zero re-shows the briefing for that game. Acceptable; matches the public display behaviour.
- This applies on every game — game 2's briefing shows when game 2 is opened with zero calls, etc.

**Stats row visibility during the briefing:**
- The single-stage stats row (Calls / Playing For / Prize) is hidden while the briefing is showing. The ladder is the richer view; running both would duplicate the prize and read as noise.
- Snowball summary strip (`isSnowballGame` block, today at [game-control.tsx:827-846](src/app/host/[sessionId]/[gameId]/game-control.tsx:827)) is also hidden during the briefing — already covered by the snowball line inside the ladder.

**Verification:**
- Open game 1 of a fresh session, no calls. See full briefing (game header + colour dot + colour word + ladder + **rules**) + Next Number + Take Break + Check Claim — without scrolling on iPhone 14 Pro Safari.
- Open game 2, no calls. See briefing (game header + colour dot + colour word + ladder) + Next Number + Take Break + Check Claim — **no rules block**.
- Call number 1 on any game. Briefing disappears; standard ball view returns.
- Use "Undo Last Call" to drop back to zero on any game. Briefing for that game returns (with rules on game 1, without on games 2+).

---

## Change 4 — Tighten vertical spacing so primary controls fit above the fold

**Target:** iPhone 14 Pro Safari (390 × 664 viewport after URL bar) sees the bingo ball, stats row, Next Number, Take Break, and Check Claim without scroll, on a game with at least one number called.

**Spacing diet (proposed values, open to tweak):**

| Element | Current | Proposed |
|---|---|---|
| Main display card padding | `p-8` | `p-5` |
| Ball wrapper margin-bottom | `mb-6` | `mb-3` |
| Ball size | `w-40 h-40 text-7xl` | `w-32 h-32 text-6xl` |
| Nickname margin-bottom (now above ball) | `mb-4` | `mb-3` |
| (deleted) "Players see this in Xs" | `mb-4` | gone |
| Stats row top padding | `pt-4` | `pt-3` |
| Card margin-bottom | `mb-6` | `mb-4` |
| Control grid gap | `gap-4` | `gap-3` |
| Control grid margin-bottom | `mb-6` | `mb-4` |
| Next Number button height | `h-24 text-3xl` | `h-20 text-2xl` |
| Page wrapper bottom padding | `pb-32` | `pb-24` |

The Take Break / Check Claim buttons stay at `h-16` (44 px is the iOS tap-target floor; `h-16` is 64 px and still feels right at arm's length).

**Verification:** Take a screenshot at iPhone 14 Pro / Safari with one number called. The bottom edge of "Check Claim" sits inside the visible viewport — no scroll required.

**Safety check on display:** None — these classes are scoped to `game-control.tsx` and don't affect `/display` or `/player`.

---

## File-by-file impact

| File | Change |
|---|---|
| [src/app/host/[sessionId]/[gameId]/page.tsx](src/app/host/[sessionId]/[gameId]/page.tsx) | Add a query for the session's lowest `game_index`; pass `isFirstGameOfSession` to `GameControl`. |
| [src/app/host/[sessionId]/[gameId]/game-control.tsx](src/app/host/[sessionId]/[gameId]/game-control.tsx) | Accept `isFirstGameOfSession`. Render briefing component when first-game + zero-calls. Reorder nickname above ball. Delete "Players see this" line. Apply spacing diet. |
| (new) `src/components/host/pre-game-briefing.tsx` | New stateless component for the briefing (header + ladder + rules). Props: `game`, `currentSnowballPot`. Consumes `HOUSE_RULES` from the shared lib. |
| (new) `src/lib/house-rules.ts` | Single source of truth for the rule items. Exports `HOUSE_RULES` constant. |
| (new) `src/lib/colour-name.ts` | Exports `getColourName(hex)` — nearest-palette lookup against a 12-name curated list. Plus a `.test.ts` next to it. |
| [src/app/display/[sessionId]/display-ui.tsx](src/app/display/[sessionId]/display-ui.tsx) | Import `HOUSE_RULES` from the shared lib and render the same items inside the existing `renderHouseRulesPanel`. No visual change. |

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Extra Supabase read on every host page load to find min(game_index). | Single indexed read on `(session_id, game_index)`; effectively free. The host page is per-session-per-host, not high-traffic. |
| Spacing diet feels too tight on bigger phones (Plus / Max). | Spacing values listed are proposed, not final. Implement, screenshot on 14 Pro and 14 Pro Max, adjust before merging. |
| Pre-game block re-appears on "Undo Last Call" back to 0. | Accept — same behaviour as the public display. Gives a host a clean way to re-read the rules if needed. |
| Snowball calls window changes mid-game and the briefing copy goes stale. | Briefing is only shown when `numbers_called_count === 0`, before any window opens — copy can't go stale during play. |
| `formatStageLabel` helper not exported / not present. | If absent, copy the small lookup map directly into the briefing component. Confirm during planning. |

## Decisions (locked in)

1. **Game type wording.** Header always shows `GAME N · {TYPE}`. `STANDARD`, `SNOWBALL`, or `JACKPOT`. Standard games are not hidden.
2. **Colour identification.** Small coloured dot **and** the colour name in words (e.g. `Green`) — for accessibility (host is colour-blind). Not a tinted card.

[spec truncated at line 200 — original has 222 lines]
```

## Diff (`HEAD`)

```diff
diff --git a/.gitignore b/.gitignore
index 74f423f..6852c31 100644
--- a/.gitignore
+++ b/.gitignore
@@ -41,3 +41,4 @@ next-env.d.ts
 .env*
 !.env.example
 !.env.local.example
+.claude/session-context.md
diff --git a/docs/architecture/README.md b/docs/architecture/README.md
index f341e5a..936f53e 100644
--- a/docs/architecture/README.md
+++ b/docs/architecture/README.md
@@ -1,13 +1,13 @@
 ---
 generated: true
-last_updated: 2026-04-30T05:58:58Z
+last_updated: 2026-04-30T00:00:00Z
 source: session-setup
 project: anchor-bingo
 ---
 
 # Architecture Documentation Index
 
-> Auto-generated by session-setup. Manual edits will be overwritten.
+> Auto-generated by session-setup. Manual edits will be overwritten on next refresh.
 > For persistent notes, use `docs/architecture/NOTES.md`.
 
 ## Documents
@@ -25,6 +25,7 @@ project: anchor-bingo
 - **Project:** `anchor-bingo` (BingoBlast / OJ-CashBingo)
 - **Stack:** Next.js 16.1.4 + React 19.2.3 + TypeScript + Supabase + Tailwind v4
 - **Test runner:** Node.js native (`node --test --import tsx`)
+- **Code:** 12 pages, 1 layout, 1 API route, 5 server-action files (33 actions), 8 tables + 4 atomic RPCs, 13 migrations
 
 ## Regeneration
 
diff --git a/docs/architecture/data-model.md b/docs/architecture/data-model.md
index 4a4f0bf..287c24e 100644
--- a/docs/architecture/data-model.md
+++ b/docs/architecture/data-model.md
@@ -1,13 +1,13 @@
 ---
 generated: true
-last_updated: 2026-04-30T05:58:58Z
+last_updated: 2026-04-30T00:00:00Z
 source: session-setup
 project: anchor-bingo
 ---
 
 # Data Model
 
-> Auto-generated by session-setup. Manual edits will be overwritten.
+> Auto-generated by session-setup. Manual edits will be overwritten on next refresh.
 
 See `session-context.md` for the full schema. Populated separately by the database agent.
 
@@ -28,6 +28,35 @@ The following tables are written or read by server actions in `src/app/`. Full c
 
 See [[relationships]] for the inverse mapping (table → actions that touch it).
 
+## RPCs Called From Code
+
+| RPC | Caller | Purpose |
+|-----|--------|---------|
+| `delete_session_safe` | `deleteSession` | Atomic precheck + delete under row lock |
+| `delete_game_safe` | `deleteGame` | Atomic precheck + delete under row lock |
+| `update_game_safe` | `updateGame` | Atomic structural-update guard against `game_states.status` |
+| `reset_session_safe` | `resetSession` | Atomic: delete winners → delete game_states → reset session |
+
+Introduced by `supabase/migrations/20260430120300_atomic_admin_mutations.sql`.
+
+## Migrations Applied
+
+13 migrations under `supabase/migrations/`, latest 2026-04-30:
+
+- `20251221101434` — `add_active_game_id`
+- `20251221101435` — `add_controller_locking`
+- `20251221101436` — `fix_host_permissions`
+- `20251221101437` — `enable_realtime_sessions`
+- `20251221101438` — `add_game_states_public`
+- `20260218143000` — `add_jackpot_game_type`
+- `20260218170000` — `add_winner_snowball_eligibility`
+- `20260218190500` — `set_call_delay_to_1_second`
+- `20260430120000` — `add_state_version`
+- `20260430120100` — `set_call_delay_default_2`
+- `20260430120200` — `backfill_call_delay_to_2`
+- `20260430120300` — `atomic_admin_mutations`
+- `20260430120400` — `tighten_profiles_select`
+
 ## `state_version` — Live-State Ordering Field
 
 Both `game_states` and `game_states_public` carry a `state_version bigint not null default 0` column (added by `supabase/migrations/20260430120000_add_state_version.sql`).
diff --git a/docs/architecture/overview.md b/docs/architecture/overview.md
index 294a0d3..f1f4865 100644
--- a/docs/architecture/overview.md
+++ b/docs/architecture/overview.md
@@ -1,13 +1,13 @@
 ---
 generated: true
-last_updated: 2026-04-30T05:58:58Z
+last_updated: 2026-04-30T00:00:00Z
 source: session-setup
 project: anchor-bingo
 ---
 
 # Architecture Overview
 
-> Auto-generated by session-setup. Manual edits will be overwritten.
+> Auto-generated by session-setup. Manual edits will be overwritten on next refresh.
 
 ## Project Profile
 
@@ -76,6 +76,17 @@ No `react-player`, no Stripe, no Twilio, no OpenAI/Anthropic, no Resend, no Upst
 
 `game_states` and `game_states_public` both carry a `state_version bigint` column, bumped by the `bump_game_state_version` BEFORE UPDATE trigger on every write. The `sync_game_states_public()` trigger keeps the public mirror aligned. Clients use `isFreshGameState()` (in `src/lib/game-state-version.ts`) to drop out-of-order Realtime / polling payloads — never compare on `updated_at`.
 
+## Atomic Admin Mutations
+
+Recent migration `20260430120300_atomic_admin_mutations.sql` introduces four security-definer RPCs to close TOCTOU windows in admin destructive flows:
+
+- `delete_session_safe(p_session_id)` — used by `deleteSession`
+- `delete_game_safe(p_game_id)` — used by `deleteGame`
+- `update_game_safe(p_game_id, ...)` — used by `updateGame`
+- `reset_session_safe(p_session_id)` — used by `resetSession`
+
+Each performs precheck-and-mutate atomically under a row lock so a host cannot start a game (or insert a winner) between the application-layer check and the destructive write.
+
 ## Cross-references
 
 - Routes: see [[routes]]
diff --git a/docs/architecture/relationships.md b/docs/architecture/relationships.md
index b22b135..aeefdae 100644
--- a/docs/architecture/relationships.md
+++ b/docs/architecture/relationships.md
@@ -1,27 +1,44 @@
 ---
 generated: true
-last_updated: 2026-04-30T05:58:58Z
+last_updated: 2026-04-30T00:00:00Z
 source: session-setup
 project: anchor-bingo
 ---
 
 # Relationships
 
-> Auto-generated by session-setup. Manual edits will be overwritten.
+> Auto-generated by session-setup. Manual edits will be overwritten on next refresh.
 
 Cross-references between tables, actions, callers, and integrations.
 
+## Routes → Tables Read
+
+| Route | Tables Read |
+|-------|-------------|
+| `/admin` | `sessions`, `profiles` |
+| `/admin/sessions/[id]` | `sessions`, `games`, `snowball_pots`, `profiles` |
+| `/admin/snowball` | `snowball_pots`, `profiles` |
+| `/admin/history` | `winners`, `sessions`, `games`, `profiles` |
+| `/admin/backup` | `games`, `game_states`, `sessions`, `profiles` |
+| `/host` | `sessions`, `games`, `game_states`, `profiles` |
+| `/host/[sessionId]/[gameId]` | `sessions`, `games`, `game_states`, `winners`, `snowball_pots`, `profiles` |
+| `/display/[sessionId]` | `sessions`, `games`, `game_states_public` |
+| `/player/[sessionId]` | `sessions`, `games`, `game_states_public` |
+| `/login` | `auth.users` (via Supabase Auth) |
+| `/api/setup` | `auth.users`, `profiles` |
+
 ## Tables → Actions That Touch Them
 
 | Table | Actions |
 |-------|---------|
-| `sessions` | `createSession`, `updateSession`, `deleteSession`, `duplicateSession`, `createGame`, `updateGame`, `duplicateGame`, `updateSessionStatus`, `resetSession`, `startGame`, `endGame` |
-| `games` | `deleteSession`, `duplicateSession`, `createGame`, `updateGame`, `duplicateGame`, `deleteGame`, `resetSession`, `deleteSnowballPot`, `startGame`, `callNextNumber`, `endGame`, `moveToNextGameOnBreak`, `moveToNextGameAfterWin` |
-| `game_states` | `deleteGame`, `resetSession`, `startGame`, `takeControl`, `sendHeartbeat`, `getCurrentGameState`, `callNextNumber`, `toggleBreak`, `pauseForValidation`, `resumeGame`, `endGame`, `moveToNextGameOnBreak`, `moveToNextGameAfterWin`, `validateClaim`, `announceWin`, `advanceToNextStage`, `skipStage`, `voidLastNumber` |
-| `winners` | `resetSession`, `voidWinner`, `moveToNextGameAfterWin`, `announceWin`, `recordWinner`, `toggleWinnerPrizeGiven` |
-| `profiles` | All admin/host actions (role lookup), `utils/supabase/middleware.ts` (session refresh) |
+| `sessions` | `createSession`, `updateSession`, `deleteSession` (RPC), `duplicateSession`, `updateSessionStatus`, `resetSession` (RPC), `startGame`, `endGame`, `moveToNextGameOnBreak`, `moveToNextGameAfterWin` |
+| `games` | `createGame`, `updateGame` (RPC), `duplicateGame`, `deleteGame` (RPC), `duplicateSession`, `resetSession` (RPC, cascade) |
+| `game_states` | `startGame`, `takeControl`, `sendHeartbeat`, `getCurrentGameState`, `callNextNumber`, `toggleBreak`, `pauseForValidation`, `resumeGame`, `endGame`, `moveToNextGame*`, `validateClaim` (read-only), `announceWin`, `advanceToNextStage`, `skipStage`, `voidLastNumber`, `recordWinner` |
+| `game_states_public` | (none — populated by `sync_game_states_public()` trigger) |
+| `winners` | `recordWinner` (service-role insert), `voidWinner`, `toggleWinnerPrizeGiven`, `resetSession` (RPC, cascade) |
+| `profiles` | All admin/host action auth checks (role lookup), `utils/supabase/middleware.ts` (session refresh), `/api/setup` (admin promotion) |
 | `snowball_pots` | `createSnowballPot`, `updateSnowballPot`, `deleteSnowballPot`, `resetSnowballPot`, `recordWinner` |
-| `snowball_pot_history` | `updateSnowballPot`, `resetSnowballPot`, `recordWinner` |
+| `snowball_pot_history` | `updateSnowballPot`, `resetSnowballPot`, `recordWinner`, `deleteSnowballPot` (cascade) |
 
 ## Actions → Likely Callers
 
diff --git a/docs/architecture/routes.md b/docs/architecture/routes.md
index 2e1bd37..01e20b6 100644
--- a/docs/architecture/routes.md
+++ b/docs/architecture/routes.md
@@ -1,13 +1,13 @@
 ---
 generated: true
-last_updated: 2026-04-30T05:58:58Z
+last_updated: 2026-04-30T00:00:00Z
 source: session-setup
 project: anchor-bingo
 ---
 
 # Routes
 
-> Auto-generated by session-setup. Manual edits will be overwritten.
+> Auto-generated by session-setup. Manual edits will be overwritten on next refresh.
 
 App Router maps `src/app/<segments>/page.tsx` → URL paths. Dynamic segments use `[param]` notation.
 
@@ -32,7 +32,7 @@ App Router maps `src/app/<segments>/page.tsx` → URL paths. Dynamic segments us
 
 | URL | Method(s) | File | Auth |
 |-----|-----------|------|------|
-| `/api/setup` | `GET`, `POST` | `src/app/api/setup/route.ts` | `SETUP_SECRET` env-var check; uses `SUPABASE_SERVICE_ROLE_KEY` for privileged DB ops |
+| `/api/setup` | `GET` (returns 405), `POST` | `src/app/api/setup/route.ts` | `x-setup-secret` header validated against `SETUP_SECRET` with `timingSafeEqual`; uses `SUPABASE_SERVICE_ROLE_KEY` for privileged DB ops; returns 404 if `SETUP_SECRET` is unset |
 
 ## Layouts
 
diff --git a/docs/architecture/server-actions.md b/docs/architecture/server-actions.md
index 2606f2e..c4b3f85 100644
--- a/docs/architecture/server-actions.md
+++ b/docs/architecture/server-actions.md
@@ -1,13 +1,13 @@
 ---
 generated: true
-last_updated: 2026-04-30T05:58:58Z
+last_updated: 2026-04-30T00:00:00Z
 source: session-setup
 project: anchor-bingo
 ---
 
 # Server Actions
 
-> Auto-generated by session-setup. Manual edits will be overwritten.
+> Auto-generated by session-setup. Manual edits will be overwritten on next refresh.
 
 Five files contain `'use server'` directives. Auth is re-verified server-side in every mutation; `revalidatePath` is invoked after successful writes. Audit logging is not implemented (no `logAuditEvent` helper present).
 
@@ -16,7 +16,7 @@ Five files contain `'use server'` directives. Auth is re-verified server-side in
 | Action | Tables | Auth | Revalidates |
 |--------|--------|------|-------------|
 | `login(formData)` | — (Supabase Auth) | Public — establishes session | `'/', 'layout'` |
-| `signup(_formData)` | — (Supabase Auth) | Public | — |
+| `signup()` | — (always returns "invite-only" error; no DB writes) | Public | — |
 | `signout()` | — (Supabase Auth) | Authenticated | `'/', 'layout'` |
 
 ## `src/app/admin/actions.ts`
@@ -25,7 +25,7 @@ Five files contain `'use server'` directives. Auth is re-verified server-side in
 |--------|--------|------|-------------|
 | `createSession(_prev, formData)` | `sessions`, `profiles` | `getUser()` + role check | `/admin` |
 | `updateSession(sessionId, _prev, formData)` | `sessions`, `profiles` | `getUser()` + role check | `/admin`, `/admin/sessions/[id]` |
-| `deleteSession(sessionId)` | `sessions`, `games`, `profiles` | `getUser()` + role check | `/admin` |
+| `deleteSession(sessionId)` | RPC `delete_session_safe` (atomic precheck + delete under row lock) | `getUser()` + role check | `/admin` |
 | `duplicateSession(sessionId)` | `sessions`, `games`, `profiles` | `getUser()` + role check | `/admin` |
 
 ## `src/app/admin/sessions/[id]/actions.ts`
@@ -33,11 +33,11 @@ Five files contain `'use server'` directives. Auth is re-verified server-side in
 | Action | Tables | Auth | Revalidates |
 |--------|--------|------|-------------|
 | `createGame(sessionId, _prev, formData)` | `games`, `sessions`, `profiles` | `getUser()` + role check | session detail |
-| `updateGame(gameId, sessionId, _prev, formData)` | `games`, `sessions`, `profiles` | `getUser()` + role check | session detail |
+| `updateGame(gameId, sessionId, _prev, formData)` | RPC `update_game_safe` (atomic structural-update guard against `game_states.status`) | `getUser()` + role check + `validateGamePrizes` | session detail |
 | `duplicateGame(gameId, sessionId)` | `games`, `sessions`, `profiles` | `getUser()` + role check | session detail |
-| `deleteGame(gameId, sessionId)` | `games`, `game_states`, `profiles` | `getUser()` + role check (blocks delete on completed games — see commit `bf2425d`) | session detail |
+| `deleteGame(gameId, sessionId)` | RPC `delete_game_safe` (atomic precheck + delete under row lock; blocks delete on started/completed games) | `getUser()` + role check | session detail |
 | `updateSessionStatus(sessionId, status)` | `sessions`, `profiles` | `getUser()` + role check | session detail |
-| `resetSession(sessionId)` | `sessions`, `games`, `game_states`, `winners`, `profiles` | `getUser()` + role check | session detail |
+| `resetSession(sessionId, confirmationText)` | RPC `reset_session_safe` (deletes winners → game_states → resets session in one txn). Caller must type `RESET` or the session name. | `getUser()` + role check | session detail |
 | `voidWinner(winnerId, voidReason)` | `winners`, `profiles` | `getUser()` + role check | session detail |
 
 ## `src/app/admin/snowball/actions.ts`
@@ -74,6 +74,15 @@ The largest action file — orchestrates live game flow. Some actions construct
 | `skipStage(gameId, currentStageIndex, totalStages)` | `game_states` | host |
 | `voidLastNumber(gameId)` | `game_states` | host |
 
-All host actions wrap mutations in auth checks and call `revalidatePath` for the host/display/player views.
+All host actions wrap mutations in auth checks and call `revalidatePath` for the host/display/player views. Live-state mutations also require `requireController` (compares `game_states.controlling_host_id` to the caller's user id).
+
+## RPCs Used
+
+| RPC | Caller | Purpose |
+|-----|--------|---------|
+| `delete_session_safe` | `deleteSession` | Atomic precheck + delete under row lock |
+| `delete_game_safe` | `deleteGame` | Atomic precheck + delete under row lock |
+| `update_game_safe` | `updateGame` | Atomic structural-update guard against `game_states.status` |
+| `reset_session_safe` | `resetSession` | Atomic: delete winners → delete game_states → reset session |
 
 See [[relationships]] for the table → action and action → caller cross-reference.
diff --git a/tasks/review/phase-1/remediation-plan.md b/tasks/review/phase-1/remediation-plan.md
index b349331..69b14c8 100644
--- a/tasks/review/phase-1/remediation-plan.md
+++ b/tasks/review/phase-1/remediation-plan.md
@@ -1,112 +1,7 @@
-# Remediation Plan — OJ-CashBingo
+# Remediation Plan - Superseded
 
-## Group 1: Critical — Fix immediately (active data corruption / security)
+This older Phase 1 remediation plan is superseded by:
 
-### Fix 1A: Add auth checks to all session detail server actions [DL-03]
-**File:** `src/app/admin/sessions/[id]/actions.ts`
-**Change:** Add `requireAdmin(supabase)` check at the top of every exported action (`setActiveGame`, `endSession`, `addGame`, `editGame`, `deleteGame`, `resetSession`, `duplicateGame`). Reuse the same admin-check helper pattern from `src/app/admin/actions.ts`.
-**Dependency:** None — standalone fix.
+`docs/superpowers/specs/2026-04-29-bingoblast-design.md`
 
-### Fix 1B: Remove `updateSnowballPotOnGameEnd` call from `recordWinner` [DL-01]
-**File:** `src/app/host/actions.ts`
-**Change:** `recordWinner()` should NOT call `updateSnowballPotOnGameEnd()`. Only `advanceToNextStage()` should call it. Pot update should happen once, when the stage advances — not when the winner is recorded. This is safe because `advanceToNextStage()` is always called after winner recording.
-**Dependency:** Must verify game flow: winner recorded → host advances stage → pot updates. Confirm `advanceToNextStage` is always called after a winner is recorded.
-
-### Fix 1C: Add guard to `advanceToNextStage` for completed games [DL-05]
-**File:** `src/app/host/actions.ts`
-**Change:** At function entry, after fetching `currentGameState`, add: `if (currentGameState.status === 'completed') return { success: false, error: 'Game is already completed.' };`
-**Dependency:** Fix 1B first (removes double pot update risk before this guard is in place).
-
-### Fix 1D: Make `recordWinner` atomic — wrap multi-step writes [DL-02]
-**File:** `src/app/host/actions.ts`
-**Change:** Ensure that if `game_states` update fails after `winners` INSERT, the function returns an error. Consider wrapping the winner insert and game_states update together. Full DB transactions require a Supabase RPC, but the minimum fix is: if `game_states` update fails, return error so host knows to retry, rather than silently succeeding.
-**Note on race condition (DL-04):** A full atomic number-call requires a PL/pgSQL function. For now, document the risk. The practical risk is low in a single-venue app where only one host operates at a time, but the architecture is fragile.
-
----
-
-## Group 2: High — Fix before next bingo night
-
-### Fix 2A: `sendHeartbeat` must verify sender is current controller [DL-07]
-**File:** `src/app/host/actions.ts`
-**Change:** Add `.eq('controller_id', user.id)` filter to the UPDATE query in `sendHeartbeat()`. Only the current controller can refresh the heartbeat.
-
-### Fix 2B: Add error propagation from `updateSnowballPotOnGameEnd` [DL-08]
-**File:** `src/app/host/actions.ts`
-**Change:** Change return type to `Promise<{ success: boolean; error?: string }>`. Return errors from both the jackpot reset and rollover branches. Have callers (`advanceToNextStage`) check the result and surface failure.
-
-### Fix 2C: Add input validation to critical server actions [DL-09]
-**File:** `src/app/host/actions.ts`
-**Change:** Add lightweight validation (can use simple checks rather than full Zod for now) to:
-- `recordWinner`: `winnerName.trim().length > 0` check; stage must be a valid `WinStage` value
-- `validateClaim`: `claimedNumbers` must be an array of integers in 1-90 range
-- `callNextNumber`: no additional inputs needed beyond game/session IDs
-**Note:** Use `isUuid()` (already exists in `src/lib/utils.ts`) for all gameId/sessionId params.
-
-### Fix 2D: Suppress test session jackpot recording [DL-10]
-**File:** `src/app/host/actions.ts` → `recordWinner()`
-**Change:** When `is_test_session = true`, set `actualIsSnowballJackpot = false` and `snowballJackpotAmount = null` before the winner INSERT. Pot mutation is already skipped by `updateSnowballPotOnGameEnd` — this ensures the winner record also doesn't show a fake jackpot.
-
-### Fix 2E: `moveToNextGame*` — reorder writes to fail safely [DL-06]
-**File:** `src/app/host/actions.ts`
-**Change:** In both `moveToNextGameAfterWin()` and `moveToNextGameOnBreak()`, mark the old game as completed FIRST, then update `sessions.active_game_id`. If the first write fails, the session still points to the old game (recoverable). The current order (session pointer first) leaves an orphaned in-progress game if step 2 fails.
-
----
-
-## Group 3: Medium — Fix within a week
-
-### Fix 3A: Clear win display fields on stage advance [DL-11]
-**File:** `src/app/host/actions.ts` → `advanceToNextStage()`
-**Change:** Include `display_win_type: null, display_win_text: null, display_winner_name: null` in the `game_states` update when advancing to a new stage.
-
-### Fix 3B: Auto-check or warn snowball_eligible when jackpot window is open [DL-12]
-**File:** `src/app/host/[sessionId]/[gameId]/game-control.tsx`
-**Change:** When `isSnowballJackpotWindowOpen = true` (calls ≤ max_calls), auto-check the `snowballEligible` checkbox and show a prominent warning: "Jackpot window is OPEN — check eligibility carefully." Don't prevent unchecking, but make the default safe.
-
-### Fix 3C: Replace string matching in `getRequiredSelectionCountForStage` with enum lookup [DL-13]
-**File:** `src/app/host/actions.ts`
-**Change:** Replace string `.includes()` matching with a `Map<WinStage, number>` or `switch` on the `WinStage` enum values. Throw an error for unknown stages.
-
-### Fix 3D: Add Realtime polling fallback for host game-control [DL-14]
-**File:** `src/app/host/[sessionId]/[gameId]/game-control.tsx`
-**Change:** Add a 10-second setInterval that refreshes `game_states` from DB (same pattern as player-ui and display-ui). Cancel interval when Realtime subscription confirms a recent event.
-
-### Fix 3E: Remove 35+ console.log/error from production code [DL-16]
-**Files:** `src/app/host/actions.ts`, `src/app/host/[sessionId]/[gameId]/game-control.tsx`, `src/app/display/[sessionId]/display-ui.tsx`
-**Change:** Remove debug `console.log` calls entirely. Convert `console.error` calls that represent real failures into returned errors or structured log entries.
-
----
-
-## Group 4: Low — Background cleanup
-
-### Fix 4A: Remove `react-player` dead dependency [DL-19]
-**Change:** `npm uninstall react-player`
-
-### Fix 4B: Verify/remove `signup` action or gate it admin-only [DL-20]
-**File:** `src/app/login/actions.ts`
-**Change:** If no public signup UI exists, remove the `signup` export. If it's used for admin user creation, move it to `src/app/admin/actions.ts` with admin role check.
-
-### Fix 4C: Add void winner capability [DL-18]
-**File:** `src/app/host/actions.ts` and admin session detail
-**Change:** Add `voidWinner(winnerId, voidReason)` server action that sets `is_void = true, void_reason = $reason`. Surface in admin session detail UI alongside existing winner list.
-
----
-
-## Implementation Order (dependency-safe)
-
-```
-1A (auth) → standalone
-1B (remove double pot call) → 1C depends on 1B
-1C (completed game guard) → after 1B
-1D (atomic winner record) → after 1B and 1C
-2A (heartbeat sender check) → standalone
-2B (pot update error propagation) → after 1B
-2C (input validation) → standalone
-2D (test session jackpot suppression) → standalone
-2E (reorder moveToNextGame writes) → standalone
-3A (clear win display on advance) → standalone
-3B (snowball eligible warning) → standalone
-3C (stage count enum lookup) → standalone
-3D (host polling fallback) → standalone
-3E (remove console.logs) → standalone, do last
-4A, 4B, 4C → standalone, any order
-```
+Do not implement from the old plan. It references function names and behaviors that no longer match the current code, and it predates the code-reviewed void-safe polling requirements.
```

## Changed File Contents

### `.claude/changes-manifest.log`

```
# manifest-version: 1
2026-04-29T16:23:29Z|EDIT|src/app/api/setup/route.ts|route|structure,docs
2026-04-29T16:23:35Z|EDIT|src/app/api/setup/route.ts|route|structure,docs
2026-04-29T16:23:41Z|EDIT|src/app/api/setup/route.ts|route|structure,docs
2026-04-30T09:39:50Z|CREATE|src/lib/game-state-version.test.ts|utility|structure
2026-04-30T09:40:01Z|CREATE|src/lib/game-state-version.ts|utility|structure
2026-04-30T09:40:13Z|CREATE|src/lib/prize-validation.test.ts|utility|structure
2026-04-30T09:40:24Z|CREATE|supabase/migrations/20260430120000_add_state_version.sql|migration|database
2026-04-30T09:40:25Z|CREATE|src/lib/prize-validation.ts|utility|structure
2026-04-30T09:40:39Z|CREATE|src/lib/connection-health.test.ts|utility|structure
2026-04-30T09:40:50Z|CREATE|supabase/migrations/20260430120100_set_call_delay_default_2.sql|migration|database
2026-04-30T09:40:53Z|CREATE|src/lib/connection-health.ts|utility|structure
2026-04-30T09:41:01Z|CREATE|src/lib/win-stages.test.ts|utility|structure
2026-04-30T09:41:09Z|CREATE|src/lib/win-stages.ts|utility|structure
2026-04-30T09:41:18Z|CREATE|src/lib/log-error.test.ts|utility|structure
2026-04-30T09:41:26Z|CREATE|src/lib/log-error.ts|utility|structure
2026-04-30T09:41:45Z|CREATE|src/components/connection-banner.tsx|component|structure
2026-04-30T09:42:24Z|EDIT|src/types/database.ts|type|structure
2026-04-30T09:42:25Z|EDIT|src/lib/game-state-version.test.ts|utility|structure
2026-04-30T09:42:28Z|EDIT|src/lib/prize-validation.test.ts|utility|structure
2026-04-30T09:42:31Z|EDIT|src/lib/connection-health.test.ts|utility|structure
2026-04-30T09:42:34Z|EDIT|src/types/database.ts|type|structure
2026-04-30T09:42:35Z|EDIT|src/lib/win-stages.test.ts|utility|structure
2026-04-30T09:42:38Z|EDIT|src/lib/log-error.test.ts|utility|structure
2026-04-30T09:42:43Z|EDIT|src/lib/win-stages.test.ts|utility|structure
2026-04-30T09:42:51Z|EDIT|src/lib/log-error.test.ts|utility|structure
2026-04-30T09:45:12Z|CREATE|supabase/migrations/20260430120200_backfill_call_delay_to_2.sql|migration|database
2026-04-30T10:01:44Z|CREATE|src/app/display/[sessionId]/page.tsx|route|structure,docs
2026-04-30T10:01:56Z|CREATE|src/app/player/[sessionId]/page.tsx|route|structure,docs
2026-04-30T10:02:04Z|CREATE|src/components/ui/modal.tsx|component|structure
2026-04-30T10:02:09Z|EDIT|src/components/ui/button.tsx|component|structure
2026-04-30T10:02:11Z|CREATE|src/app/login/page.tsx|route|structure,docs
2026-04-30T10:02:24Z|CREATE|.env.example|env|docs
2026-04-30T10:05:24Z|CREATE|CLAUDE.md|documentation|docs
2026-04-30T12:35:34Z|CREATE|src/lib/connection-health.ts|utility|structure
2026-04-30T12:36:20Z|CREATE|src/lib/connection-health.test.ts|utility|structure
2026-04-30T12:38:56Z|EDIT|src/lib/connection-health.ts|utility|structure
2026-04-30T12:40:55Z|CREATE|supabase/migrations/20260430120300_atomic_admin_mutations.sql|migration|database
2026-04-30T12:42:12Z|EDIT|supabase/migrations/20260430120300_atomic_admin_mutations.sql|migration|database
2026-04-30T12:43:09Z|EDIT|src/types/database.ts|type|structure
2026-04-30T12:45:42Z|CREATE|supabase/migrations/20260430120400_tighten_profiles_select.sql|migration|database
2026-04-30T13:48:16Z|EDIT|src/app/display/[sessionId]/page.tsx|route|structure,docs
```

### `.gitignore`

```
# See https://help.github.com/articles/ignoring-files/ for more about ignoring files.

# dependencies
/node_modules
/.pnp
.pnp.*
.yarn/*
!.yarn/patches
!.yarn/plugins
!.yarn/releases
!.yarn/versions

# testing
/coverage

# next.js
/.next/
/out/

# production
/build

# misc
.DS_Store
*.pem

# debug
npm-debug.log*
yarn-debug.log*
yarn-error.log*
.pnpm-debug.log*

# vercel
.vercel

# typescript
*.tsbuildinfo
next-env.d.ts

# env
.env*
!.env.example
!.env.local.example
.claude/session-context.md
```

### `docs/architecture/data-model.md`

```
---
generated: true
last_updated: 2026-04-30T00:00:00Z
source: session-setup
project: anchor-bingo
---

# Data Model

> Auto-generated by session-setup. Manual edits will be overwritten on next refresh.

See `session-context.md` for the full schema. Populated separately by the database agent.

## Tables Referenced in Code

The following tables are written or read by server actions in `src/app/`. Full column definitions, RLS policies, and migrations live in `supabase/migrations/` — refer to the database agent's output for canonical schema details.

| Table | Touched by |
|-------|------------|
| `sessions` | `admin/actions.ts`, `admin/sessions/[id]/actions.ts`, `host/actions.ts` |
| `games` | `admin/actions.ts`, `admin/sessions/[id]/actions.ts`, `admin/snowball/actions.ts`, `host/actions.ts` |
| `game_states` | `admin/sessions/[id]/actions.ts`, `host/actions.ts` |
| `game_states_public` | Public-readable mirror of `game_states`, kept in sync by the `sync_game_states_public()` trigger. Read by `display/[sessionId]/page.tsx` (initial render) + `display-ui.tsx` / `player-ui.tsx` (Realtime + polling). |
| `winners` | `admin/sessions/[id]/actions.ts`, `host/actions.ts` |
| `profiles` | `admin/actions.ts`, `admin/sessions/[id]/actions.ts`, `admin/snowball/actions.ts`, `host/actions.ts`, `utils/supabase/middleware.ts` (role lookup) |
| `snowball_pots` | `admin/snowball/actions.ts`, `host/actions.ts` |
| `snowball_pot_history` | `admin/snowball/actions.ts`, `host/actions.ts` |

See [[relationships]] for the inverse mapping (table → actions that touch it).

## RPCs Called From Code

| RPC | Caller | Purpose |
|-----|--------|---------|
| `delete_session_safe` | `deleteSession` | Atomic precheck + delete under row lock |
| `delete_game_safe` | `deleteGame` | Atomic precheck + delete under row lock |
| `update_game_safe` | `updateGame` | Atomic structural-update guard against `game_states.status` |
| `reset_session_safe` | `resetSession` | Atomic: delete winners → delete game_states → reset session |

Introduced by `supabase/migrations/20260430120300_atomic_admin_mutations.sql`.

## Migrations Applied

13 migrations under `supabase/migrations/`, latest 2026-04-30:

- `20251221101434` — `add_active_game_id`
- `20251221101435` — `add_controller_locking`
- `20251221101436` — `fix_host_permissions`
- `20251221101437` — `enable_realtime_sessions`
- `20251221101438` — `add_game_states_public`
- `20260218143000` — `add_jackpot_game_type`
- `20260218170000` — `add_winner_snowball_eligibility`
- `20260218190500` — `set_call_delay_to_1_second`
- `20260430120000` — `add_state_version`
- `20260430120100` — `set_call_delay_default_2`
- `20260430120200` — `backfill_call_delay_to_2`
- `20260430120300` — `atomic_admin_mutations`
- `20260430120400` — `tighten_profiles_select`

## `state_version` — Live-State Ordering Field

Both `game_states` and `game_states_public` carry a `state_version bigint not null default 0` column (added by `supabase/migrations/20260430120000_add_state_version.sql`).

- The **`bump_game_state_version` BEFORE UPDATE trigger** on `game_states` increments `new.state_version` to `coalesce(old.state_version, 0) + 1` on every row update.
- The **`sync_game_states_public()` trigger** propagates the row (including the just-bumped `state_version`) into `game_states_public` so the public mirror always carries the same version.
- Clients use **`isFreshGameState()`** in `src/lib/game-state-version.ts` to compare the current state's `state_version` against an incoming Realtime/polling payload's `state_version` — older payloads are dropped. Never compare on `updated_at` for ordering purposes.

## Environment Configuration

| Variable | Public/Server | Declared in `.env.example` | Used in |
|----------|---------------|----------------------------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Public | yes | `utils/supabase/{client,server,middleware}.ts`, `app/api/setup/route.ts`, `app/host/actions.ts`, `app/login/page.tsx` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public | yes | `utils/supabase/{client,server,middleware}.ts`, `app/login/page.tsx` |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only | yes | `app/api/setup/route.ts`, `app/host/actions.ts` (privileged winner writes) |
| `SETUP_SECRET` | Server-only | yes | `app/api/setup/route.ts` |
| `NEXT_PUBLIC_SITE_URL` | Public | yes | `app/display/[sessionId]/page.tsx` — fallback origin for the player follower QR URL when request headers are unavailable in production |

See [[overview]] for the full stack profile.
```

### `docs/architecture/overview.md`

```
---
generated: true
last_updated: 2026-04-30T00:00:00Z
source: session-setup
project: anchor-bingo
---

# Architecture Overview

> Auto-generated by session-setup. Manual edits will be overwritten on next refresh.

## Project Profile

- **Package name:** `anchor-bingo`
- **Framework:** Next.js 16.1.4 (App Router) on React 19.2.3
- **Language:** TypeScript 5 (strict)
- **Styling:** Tailwind CSS v4 (`@tailwindcss/postcss`) with `tailwind-merge` and `clsx`
- **Database:** Supabase (PostgreSQL + Auth + RLS)
- **Test runner:** Node.js native test runner (`node --test --import tsx`)

## Code Footprint

| Metric | Count |
|--------|------:|
| Total `.ts` / `.tsx` files in `src/` | ~50 (incl. shared `lib/` helpers added in the live-event reliability work) |
| App Router pages (`page.tsx`) | 12 |
| API routes (`route.ts`) | 1 |
| Layouts (`layout.tsx`) | 1 |
| Server action files (`'use server'`) | 5 |
| Components (in `src/components/`) | 9 |

## Top-Level `src/` Layout

```
src/
├── app/             # App Router (pages, route handlers, server actions)
│   ├── admin/       # Staff-only: sessions, snowball pots, history, backup
│   ├── api/         # Setup endpoint (SETUP_SECRET-gated)
│   ├── display/     # Public big-screen pub display view
│   ├── host/        # Host control: start games, call numbers, validate wins
│   ├── login/       # Staff login (invite-only)
│   ├── player/      # Public mobile follower view (read-only mirror)
│   └── page.tsx     # Public landing
├── components/      # Shared UI (Header, LayoutContent, ConnectionBanner, ui/)
├── hooks/           # use-connection-health, wake-lock (nosleep.js)
├── lib/             # game-state-version, connection-health, prize-validation,
│                    # win-stages, log-error, jackpot, snowball, utils
├── types/           # Shared TS types (incl. generated Database type)
└── utils/
    └── supabase/    # client.ts, server.ts, middleware.ts (session refresh
                     # registered via src/proxy.ts on auth-only routes)
```

## Integrations

| Library | Purpose |
|---------|---------|
| `@supabase/ssr` + `@supabase/supabase-js` | Auth (cookie-based SSR), DB queries, Realtime, service-role admin client |
| `qrcode.react` (`QRCodeSVG`) | Display QR pointing at the public follower view (`/player/[sessionId]`) — NOT a join-a-card flow |
| `nosleep.js` | Prevent screen dimming during live games (host & display) |
| `zod` | Input validation (server actions / forms) |
| `tailwind-merge`, `clsx` | Class composition utilities |

No `react-player`, no Stripe, no Twilio, no OpenAI/Anthropic, no Resend, no Upstash present in code.

## Auth Model Summary

- **Next.js middleware IS wired** via `src/proxy.ts`, which exports `proxy()` (forwarding to `updateSession()` in `src/utils/supabase/middleware.ts`) and a tightly scoped `config.matcher = ['/admin/:path*', '/host/:path*', '/login']`. Public routes (`/display/*`, `/player/*`, `/`) bypass the middleware entirely so the TV and follower screens stay fast.
- Defence in depth: every protected page also calls `supabase.auth.getUser()` server-side and `redirect('/login')` if unauthenticated.
- `host/*` and `admin/*` are protected. `player/*`, `display/*`, `login`, and `/` are public.
- Server actions in `host/actions.ts` re-verify auth and use a `requireController` pattern; some flows use the service-role key (`SUPABASE_SERVICE_ROLE_KEY`) for privileged DB writes (e.g. winner records).
- `/api/setup` is gated by `SETUP_SECRET` (compare-on-server bootstrap endpoint).
- Public sign-up is disabled at the UI level. The `signup()` server action returns an "invite-only" error for safety in case any caller invokes it.

## Live-State Versioning

`game_states` and `game_states_public` both carry a `state_version bigint` column, bumped by the `bump_game_state_version` BEFORE UPDATE trigger on every write. The `sync_game_states_public()` trigger keeps the public mirror aligned. Clients use `isFreshGameState()` (in `src/lib/game-state-version.ts`) to drop out-of-order Realtime / polling payloads — never compare on `updated_at`.

## Atomic Admin Mutations

Recent migration `20260430120300_atomic_admin_mutations.sql` introduces four security-definer RPCs to close TOCTOU windows in admin destructive flows:

- `delete_session_safe(p_session_id)` — used by `deleteSession`
- `delete_game_safe(p_game_id)` — used by `deleteGame`
- `update_game_safe(p_game_id, ...)` — used by `updateGame`
- `reset_session_safe(p_session_id)` — used by `resetSession`

Each performs precheck-and-mutate atomically under a row lock so a host cannot start a game (or insert a winner) between the application-layer check and the destructive write.

## Cross-references

- Routes: see [[routes]]
- Server actions: see [[server-actions]]
- Database schema: see [[data-model]]
- Action ↔ table ↔ caller graph: see [[relationships]]
```

### `docs/architecture/README.md`

```
---
generated: true
last_updated: 2026-04-30T00:00:00Z
source: session-setup
project: anchor-bingo
---

# Architecture Documentation Index

> Auto-generated by session-setup. Manual edits will be overwritten on next refresh.
> For persistent notes, use `docs/architecture/NOTES.md`.

## Documents

| Document | Status | Last Updated | Description |
|----------|--------|--------------|-------------|
| [[overview]] | generated | 2026-04-30 | Stack profile, file counts, integrations, auth model summary |
| [[routes]] | generated | 2026-04-30 | URL ↔ file map for pages, API routes, layouts; auth flow |
| [[server-actions]] | generated | 2026-04-30 | All `'use server'` mutations grouped by file with tables and revalidation |
| [[data-model]] | generated | 2026-04-30 | Tables referenced in code + environment variables (full schema in session-context) |
| [[relationships]] | generated | 2026-04-30 | Tables → actions, actions → callers, integrations → files, auth flow diagram |

## Project Snapshot

- **Project:** `anchor-bingo` (BingoBlast / OJ-CashBingo)
- **Stack:** Next.js 16.1.4 + React 19.2.3 + TypeScript + Supabase + Tailwind v4
- **Test runner:** Node.js native (`node --test --import tsx`)
- **Code:** 12 pages, 1 layout, 1 API route, 5 server-action files (33 actions), 8 tables + 4 atomic RPCs, 13 migrations

## Regeneration

These files are recreated by the `session-setup` skill at the start of a new session. To refresh manually, re-run session setup. Source-of-truth lives in code under `src/` and migrations under `supabase/migrations/`.
```

### `docs/architecture/relationships.md`

```
---
generated: true
last_updated: 2026-04-30T00:00:00Z
source: session-setup
project: anchor-bingo
---

# Relationships

> Auto-generated by session-setup. Manual edits will be overwritten on next refresh.

Cross-references between tables, actions, callers, and integrations.

## Routes → Tables Read

| Route | Tables Read |
|-------|-------------|
| `/admin` | `sessions`, `profiles` |
| `/admin/sessions/[id]` | `sessions`, `games`, `snowball_pots`, `profiles` |
| `/admin/snowball` | `snowball_pots`, `profiles` |
| `/admin/history` | `winners`, `sessions`, `games`, `profiles` |
| `/admin/backup` | `games`, `game_states`, `sessions`, `profiles` |
| `/host` | `sessions`, `games`, `game_states`, `profiles` |
| `/host/[sessionId]/[gameId]` | `sessions`, `games`, `game_states`, `winners`, `snowball_pots`, `profiles` |
| `/display/[sessionId]` | `sessions`, `games`, `game_states_public` |
| `/player/[sessionId]` | `sessions`, `games`, `game_states_public` |
| `/login` | `auth.users` (via Supabase Auth) |
| `/api/setup` | `auth.users`, `profiles` |

## Tables → Actions That Touch Them

| Table | Actions |
|-------|---------|
| `sessions` | `createSession`, `updateSession`, `deleteSession` (RPC), `duplicateSession`, `updateSessionStatus`, `resetSession` (RPC), `startGame`, `endGame`, `moveToNextGameOnBreak`, `moveToNextGameAfterWin` |
| `games` | `createGame`, `updateGame` (RPC), `duplicateGame`, `deleteGame` (RPC), `duplicateSession`, `resetSession` (RPC, cascade) |
| `game_states` | `startGame`, `takeControl`, `sendHeartbeat`, `getCurrentGameState`, `callNextNumber`, `toggleBreak`, `pauseForValidation`, `resumeGame`, `endGame`, `moveToNextGame*`, `validateClaim` (read-only), `announceWin`, `advanceToNextStage`, `skipStage`, `voidLastNumber`, `recordWinner` |
| `game_states_public` | (none — populated by `sync_game_states_public()` trigger) |
| `winners` | `recordWinner` (service-role insert), `voidWinner`, `toggleWinnerPrizeGiven`, `resetSession` (RPC, cascade) |
| `profiles` | All admin/host action auth checks (role lookup), `utils/supabase/middleware.ts` (session refresh), `/api/setup` (admin promotion) |
| `snowball_pots` | `createSnowballPot`, `updateSnowballPot`, `deleteSnowballPot`, `resetSnowballPot`, `recordWinner` |
| `snowball_pot_history` | `updateSnowballPot`, `resetSnowballPot`, `recordWinner`, `deleteSnowballPot` (cascade) |

## Actions → Likely Callers

Action files live alongside the page that consumes them, so the immediate caller is the colocated `page.tsx` (or its child client components).

| Action file | Primary caller(s) |
|-------------|-------------------|
| `src/app/login/actions.ts` | `src/app/login/page.tsx` (client login form) |
| `src/app/admin/actions.ts` | `src/app/admin/page.tsx` (sessions list) |
| `src/app/admin/sessions/[id]/actions.ts` | `src/app/admin/sessions/[id]/page.tsx` (session detail / game CRUD) |
| `src/app/admin/snowball/actions.ts` | `src/app/admin/snowball/page.tsx` |
| `src/app/host/actions.ts` | `src/app/host/[sessionId]/[gameId]/page.tsx` and its host-control client components (called via heartbeat polling per CLAUDE.md notes) |

## Integrations → Files

| Integration | Files |
|-------------|-------|
| `@supabase/ssr` (cookie-based SSR) | `src/utils/supabase/client.ts`, `src/utils/supabase/server.ts`, `src/utils/supabase/middleware.ts` |
| `@supabase/supabase-js` (service-role admin client + types) | `src/app/api/setup/route.ts`, `src/app/admin/actions.ts`, `src/app/admin/sessions/[id]/actions.ts`, `src/app/admin/snowball/actions.ts`, `src/app/host/actions.ts` |
| `qrcode.react` | `src/app/display/[sessionId]/display-ui.tsx` — QR points at the public `/player/[sessionId]` follower view, NOT a join-a-card flow |
| `nosleep.js` | `src/hooks/wake-lock.ts` (consumed by host/display/player game screens) |
| `zod` | Form validation across server actions (declared in `package.json`) |

## Shared Helpers (`src/lib/`, `src/hooks/`, `src/components/`)

These cross-cutting helpers underpin the live-event reliability work and are imported across the host, display, and player surfaces. Keep this list in step when adding to `src/lib/`.

| Helper | Used by |
|--------|---------|
| `src/lib/game-state-version.ts` (`isFreshGameState`) | Host control client, `display-ui.tsx`, `player-ui.tsx` — drops out-of-order Realtime/polling payloads using `state_version` |
| `src/lib/connection-health.ts` | `src/hooks/use-connection-health.ts` — pure reducer for the connection-health state machine |
| `src/lib/prize-validation.ts` (`validateGamePrizes`) | `src/app/admin/sessions/[id]/actions.ts` (`createGame`, `updateGame`) |
| `src/lib/win-stages.ts` (`getRequiredSelectionCountForStage`, etc.) | `src/app/host/actions.ts` (`validateClaim`, `recordWinner`) |
| `src/lib/log-error.ts` | Server actions and route handlers — shared error logger |
| `src/lib/jackpot.ts`, `src/lib/snowball.ts` | Snowball / cash-jackpot eligibility computations in `host/actions.ts` |
| `src/hooks/use-connection-health.ts` | `display-ui.tsx`, `player-ui.tsx` — drives the "Reconnecting…" banner |
| `src/hooks/wake-lock.ts` (`nosleep.js`) | Host control client, `display-ui.tsx`, `player-ui.tsx` |
| `src/components/connection-banner.tsx` | `display-ui.tsx`, `player-ui.tsx` — shared "Reconnecting…" banner with auto-refresh |

## Auth Flow Map

```
Browser request
   │
   ▼
src/proxy.ts (matcher: '/admin/:path*' | '/host/:path*' | '/login')
   │   → updateSession() refreshes Supabase session, redirects auth misses.
   │   Public routes (/, /display/*, /player/*) BYPASS this entirely.
   │
   ▼
src/app/layout.tsx  (Geist fonts, LayoutContent — no auth)
   │
   ▼
src/app/<segment>/page.tsx   ← server component
   │   getSupabaseServerClient() → supabase.auth.getUser()
   │   if !user && protected: redirect('/login')
   │   role lookup via profiles.role (host vs admin)
   │
   ▼
Client UI dispatches → server action ('use server')
   │   re-verifies getUser()
   │   role / host-access check
   │   .from(table).insert/update/delete
   │   revalidatePath(...)
   │
   ▼
Response → page re-renders with fresh data
```

## Cross-doc Index

- [[overview]] — stack and code footprint
- [[routes]] — URL → file → auth table
- [[server-actions]] — full action list grouped by file
- [[data-model]] — tables and env vars
```

### `docs/architecture/routes.md`

```
---
generated: true
last_updated: 2026-04-30T00:00:00Z
source: session-setup
project: anchor-bingo
---

# Routes

> Auto-generated by session-setup. Manual edits will be overwritten on next refresh.

App Router maps `src/app/<segments>/page.tsx` → URL paths. Dynamic segments use `[param]` notation.

## Pages

| URL | File | Auth |
|-----|------|------|
| `/` | `src/app/page.tsx` | Public |
| `/login` | `src/app/login/page.tsx` | Public |
| `/admin` | `src/app/admin/page.tsx` | `getUser()` → redirect `/login` |
| `/admin/backup` | `src/app/admin/backup/page.tsx` | `getUser()` → redirect `/login` |
| `/admin/history` | `src/app/admin/history/page.tsx` | `getUser()` → redirect `/login` |
| `/admin/sessions/[id]` | `src/app/admin/sessions/[id]/page.tsx` | `getUser()` → redirect `/login` |
| `/admin/snowball` | `src/app/admin/snowball/page.tsx` | `getUser()` → redirect `/login` |
| `/host` | `src/app/host/page.tsx` | `getUser()` → redirect `/login` |
| `/host/[sessionId]/[gameId]` | `src/app/host/[sessionId]/[gameId]/page.tsx` | `getUser()` → redirect `/login` |
| `/display` | `src/app/display/page.tsx` | Public (auto-redirects to single active session) |
| `/display/[sessionId]` | `src/app/display/[sessionId]/page.tsx` | Public |
| `/player/[sessionId]` | `src/app/player/[sessionId]/page.tsx` | Public (guest-friendly) |

## API Routes

| URL | Method(s) | File | Auth |
|-----|-----------|------|------|
| `/api/setup` | `GET` (returns 405), `POST` | `src/app/api/setup/route.ts` | `x-setup-secret` header validated against `SETUP_SECRET` with `timingSafeEqual`; uses `SUPABASE_SERVICE_ROLE_KEY` for privileged DB ops; returns 404 if `SETUP_SECRET` is unset |

## Layouts

| Scope | File | Notes |
|-------|------|-------|
| Root (all routes) | `src/app/layout.tsx` | Loads Geist fonts and `<LayoutContent>` (client component that conditionally hides chrome on `/host/[…]/[…]`, `/display/[…]`, `/player/[…]` game screens). No auth enforcement here. |

## Public vs Auth Split

| Surface | Routes | Middleware? |
|---------|--------|-------------|
| Public | `/`, `/display`, `/display/[sessionId]`, `/player/[sessionId]` | No — bypasses the proxy |
| Auth | `/admin`, `/admin/*`, `/host`, `/host/*`, `/login` | Yes — proxy runs `updateSession()` |

## Auth Flow

1. **`src/proxy.ts`** exports `proxy()` (forwarding to `updateSession()` in `src/utils/supabase/middleware.ts`) plus a scoped matcher:
   ```ts
   export const config = {
     matcher: [
       '/admin/:path*',
       '/host/:path*',
       '/login',
     ],
   }
   ```
   Public routes (`/display/*`, `/player/*`, `/`) deliberately bypass the middleware so the TV and follower screens are not session-refreshed on every request. `updateSession()` itself handles redirecting unauthenticated users away from `/admin/*` and `/host/*`, and redirecting already-logged-in users away from `/login`.
2. Defence in depth: auth is also enforced **per page** in server components via `getSupabaseServerClient()` → `supabase.auth.getUser()` → `redirect('/login')`.
3. Server actions re-verify auth (`getUser()`) and check role via `profiles.role` lookup. See [[server-actions]].
4. The login client page calls the `login` server action in `src/app/login/actions.ts` which sets Supabase cookies and `revalidatePath('/', 'layout')`. The `signup()` action is also exported but returns an "invite-only" error — the login page UI does not surface a sign-up option.

See [[overview]] for stack profile and [[server-actions]] for mutation entry points.
```

### `docs/architecture/server-actions.md`

```
---
generated: true
last_updated: 2026-04-30T00:00:00Z
source: session-setup
project: anchor-bingo
---

# Server Actions

> Auto-generated by session-setup. Manual edits will be overwritten on next refresh.

Five files contain `'use server'` directives. Auth is re-verified server-side in every mutation; `revalidatePath` is invoked after successful writes. Audit logging is not implemented (no `logAuditEvent` helper present).

## `src/app/login/actions.ts`

| Action | Tables | Auth | Revalidates |
|--------|--------|------|-------------|
| `login(formData)` | — (Supabase Auth) | Public — establishes session | `'/', 'layout'` |
| `signup()` | — (always returns "invite-only" error; no DB writes) | Public | — |
| `signout()` | — (Supabase Auth) | Authenticated | `'/', 'layout'` |

## `src/app/admin/actions.ts`

| Action | Tables | Auth | Revalidates |
|--------|--------|------|-------------|
| `createSession(_prev, formData)` | `sessions`, `profiles` | `getUser()` + role check | `/admin` |
| `updateSession(sessionId, _prev, formData)` | `sessions`, `profiles` | `getUser()` + role check | `/admin`, `/admin/sessions/[id]` |
| `deleteSession(sessionId)` | RPC `delete_session_safe` (atomic precheck + delete under row lock) | `getUser()` + role check | `/admin` |
| `duplicateSession(sessionId)` | `sessions`, `games`, `profiles` | `getUser()` + role check | `/admin` |

## `src/app/admin/sessions/[id]/actions.ts`

| Action | Tables | Auth | Revalidates |
|--------|--------|------|-------------|
| `createGame(sessionId, _prev, formData)` | `games`, `sessions`, `profiles` | `getUser()` + role check | session detail |
| `updateGame(gameId, sessionId, _prev, formData)` | RPC `update_game_safe` (atomic structural-update guard against `game_states.status`) | `getUser()` + role check + `validateGamePrizes` | session detail |
| `duplicateGame(gameId, sessionId)` | `games`, `sessions`, `profiles` | `getUser()` + role check | session detail |
| `deleteGame(gameId, sessionId)` | RPC `delete_game_safe` (atomic precheck + delete under row lock; blocks delete on started/completed games) | `getUser()` + role check | session detail |
| `updateSessionStatus(sessionId, status)` | `sessions`, `profiles` | `getUser()` + role check | session detail |
| `resetSession(sessionId, confirmationText)` | RPC `reset_session_safe` (deletes winners → game_states → resets session in one txn). Caller must type `RESET` or the session name. | `getUser()` + role check | session detail |
| `voidWinner(winnerId, voidReason)` | `winners`, `profiles` | `getUser()` + role check | session detail |

## `src/app/admin/snowball/actions.ts`

| Action | Tables | Auth | Revalidates |
|--------|--------|------|-------------|
| `createSnowballPot(_prev, formData)` | `snowball_pots`, `profiles` | `getUser()` + role check | `/admin/snowball` |
| `updateSnowballPot(id, _prev, formData)` | `snowball_pots`, `snowball_pot_history`, `profiles` | `getUser()` + role check | `/admin/snowball` |
| `deleteSnowballPot(id)` | `snowball_pots`, `games`, `profiles` | `getUser()` + role check | `/admin/snowball` |
| `resetSnowballPot(id)` | `snowball_pots`, `snowball_pot_history`, `profiles` | `getUser()` + role check | `/admin/snowball` |

## `src/app/host/actions.ts`

The largest action file — orchestrates live game flow. Some actions construct a service-role client (`SUPABASE_SERVICE_ROLE_KEY`) for privileged writes that need to bypass RLS.

| Action | Tables | Auth |
|--------|--------|------|
| `startGame(...)` | `games`, `game_states`, `sessions`, `profiles` | host |
| `takeControl(gameId)` | `game_states`, `profiles` | host |
| `sendHeartbeat(gameId)` | `game_states` | host |
| `getCurrentGameState(gameId)` | `game_states` | host |
| `callNextNumber(gameId)` | `game_states`, `games` | host |
| `toggleBreak(gameId, onBreak)` | `game_states` | host |
| `pauseForValidation(gameId)` | `game_states` | host |
| `resumeGame(gameId)` | `game_states` | host |
| `endGame(gameId, sessionId)` | `games`, `game_states`, `sessions` | host |
| `moveToNextGameOnBreak(...)` | `games`, `game_states` | host |
| `moveToNextGameAfterWin(...)` | `games`, `game_states`, `winners` | host |
| `validateClaim(gameId, claimedNumbers)` | `game_states` | host (validates claimed numbers vs called set — see commit `ea505e1`) |
| `announceWin(gameId, stage)` | `game_states`, `winners` | host |
| `advanceToNextStage(gameId)` | `game_states` | host |
| `recordWinner(...)` | `winners`, `snowball_pots`, `snowball_pot_history` | host (uses service-role client) |
| `toggleWinnerPrizeGiven(sessionId, gameId, winnerId, prizeGiven)` | `winners` | host |
| `skipStage(gameId, currentStageIndex, totalStages)` | `game_states` | host |
| `voidLastNumber(gameId)` | `game_states` | host |

All host actions wrap mutations in auth checks and call `revalidatePath` for the host/display/player views. Live-state mutations also require `requireController` (compares `game_states.controlling_host_id` to the caller's user id).

## RPCs Used

| RPC | Caller | Purpose |
|-----|--------|---------|
| `delete_session_safe` | `deleteSession` | Atomic precheck + delete under row lock |
| `delete_game_safe` | `deleteGame` | Atomic precheck + delete under row lock |
| `update_game_safe` | `updateGame` | Atomic structural-update guard against `game_states.status` |
| `reset_session_safe` | `resetSession` | Atomic: delete winners → delete game_states → reset session |

See [[relationships]] for the table → action and action → caller cross-reference.
```

### `tasks/host-controller-tweaks/SPEC.md`

```
# Host Controller — Pre-Game Briefing & Layout Tightening

**Status:** Draft for review
**Author:** Claude
**Date:** 2026-04-30
**Scope:** Host control screen only (`/host/[sessionId]/[gameId]`). Display TV and player follower views are unchanged.

---

## Background

Host (the caller) operates the game from a phone-sized screen. Two friction points have surfaced in live use:

1. The pre-game state on the host doesn't tell the host what they need to read out — game number, prize ladder, and (for the first game of the night) the house rules. They currently have to guess or look at the big screen.
2. The "Players see this in 2s" hint is no longer useful and steals vertical space.
3. The number nickname is below the ball; eyes drop to it after the ball, when the host wants to call the nickname *while* the ball is being seen.
4. On a typical iPhone Safari viewport, "Take Break" and "Check Claim" are clipped at the bottom — the host has to scroll to reach them mid-game.

The display TV already implements the same pre-game pattern (rules + prize ladder); we should mirror that on the host screen so the host reads what the room sees.

## Goals

- Host knows what to say at the start of every game without leaving the controller.
- Host gets the rules in front of them once per session (first game only).
- Primary controls (Next Number, Take Break, Check Claim) all visible above the fold on iPhone-class viewports.
- No regression to the live-call surface or the public display/player views.

## Non-Goals

- No change to the public display TV (`/display/[sessionId]`) layout.
- No change to the player follower (`/player/[sessionId]`).
- No change to data model, server actions, or RLS.
- No change to the house-rules wording — we reuse the existing rules verbatim.
- No persistence change for the call-delay seconds (still on `game_states.call_delay_seconds`, just no longer surfaced on the host).

---

## Change 1 — Remove "Players see this in 2s" from host

**Current:** [src/app/host/[sessionId]/[gameId]/game-control.tsx:801-805](src/app/host/[sessionId]/[gameId]/game-control.tsx:801) renders a `<p>` between the nickname and the stats row reading `Players see this in {currentGameState.call_delay_seconds ?? 2}s`.

**Proposed:** Delete the paragraph entirely. The `call_delay_seconds` value is still used downstream for the public display delay; we just stop surfacing it on the host.

**Verification:** Snapshot the host screen with `numbers_called_count > 0`; the line is gone, no other change.

---

## Change 2 — Move number nickname above the ball

**Current order in the main card:**
1. Big bingo ball (or "READY" placeholder)
2. Nickname (e.g. "Stuck In The Tree")
3. (deleted) "Players see this in Xs"
4. Stats row (Calls / Playing For / Prize)

**Proposed order:**
1. Nickname (e.g. "Stuck In The Tree") — only when there is a current number
2. Big bingo ball (or "READY" placeholder when no current number)
3. Stats row (Calls / Playing For / Prize)

**Notes:**
- Nickname is conditional — if there is no current number, no slot is rendered.
- For numbers with no entry in `NUMBER_NICKNAMES`, the nickname slot stays empty (same as today). Do not render an empty heading element.
- Animation on the nickname (`animate-in fade-in slide-in-from-bottom-4`) becomes `slide-in-from-top-4` so it still feels like it is arriving with the new number.

**Verification:** Call a number with a known nickname (e.g. 53). Nickname renders above the ball. Call a number without a nickname (e.g. 18). Only the ball renders; no empty space where the nickname would be.

---

## Change 3 — Pre-game briefing on the host

**Trigger condition:** the briefing renders whenever `numbers_called_count === 0`. It applies to **every** game in the session — the host gets a fresh briefing before game 1, game 2, game 3, etc., so they can read out that game's prizes before kicking off.

**Rules sub-block trigger:** the HOUSE RULES portion of the briefing is only included when this is the first game of the session — `game.game_index === min(game_index)` across the session's games. Games 2+ get the briefing without the rules.

**What replaces the empty "READY" disc when the briefing is showing:**

```
┌─────────────────────────────────────────────┐
│  GAME 1 · STANDARD                          │   ← header strip
│  ● Green   Friday Night Bingo               │   ← colour dot + colour name + game name
├─────────────────────────────────────────────┤
│  TONIGHT YOU CAN WIN                        │
│  Stage 1: Line          —  £20             │
│  Stage 2: Two Lines     —  Bottle of Prosecco │
│  Stage 3: Full House    —  £50 + Snowball  │
├─────────────────────────────────────────────┤
│  HOUSE RULES                                │
│  ➤ Claims must be called on the number     │
│    they're won on — late claims invalid.    │
│  ➤ Multiple claims share the prize.         │
│  ➤ Snowball eligibility: must have been    │
│    here for the last three games.           │
│  🎉 Enjoy the night and best of luck!       │
└─────────────────────────────────────────────┘
        [        NEXT NUMBER        ]
        [  Take Break  ][ Check Claim ]
```

**Header strip fields:**
- `GAME {game.game_index}` — bold, large.
- `· {game.type.toUpperCase()}` — secondary, always shown. `STANDARD`, `SNOWBALL`, or `JACKPOT`.
- A 12 px round colour dot filled with `game.background_colour`, followed by the **colour name in words** (e.g. `Green`, `Red`), followed by the game name. Colour name is for accessibility — the host is colour-blind and needs the word, not just the dot.

**Colour-name resolution:**
- New helper `src/lib/colour-name.ts` exports `getColourName(hex: string): string`.
- Curated palette of 12 names: `White`, `Black`, `Grey`, `Red`, `Orange`, `Yellow`, `Green`, `Teal`, `Blue`, `Purple`, `Pink`, `Brown`.
- Returns the nearest palette label by Euclidean distance in RGB space.
- Returns an empty string if the input is not a valid `#rrggbb` hex; the briefing then falls back to showing the dot only.
- Tested in `src/lib/colour-name.test.ts` — happy path (`#ffffff` → "White", `#16a34a` → "Green") plus an invalid input case.

**Prize ladder block:**
- Title: `TONIGHT YOU CAN WIN`.
- One row per entry in `game.stage_sequence`, in order:
  - Left: `Stage {n}: {stage label}` — `Line` / `Two Lines` / `Full House` rendered verbatim (no extra formatting helper needed; the values are already the display labels).
  - Right: prize text from `game.prizes[stage]`. If missing, render `⚠️ Prize not set` in the destructive colour (matches the host stats row's existing missing-prize style).
- Snowball game: under the ladder, a single line — `Snowball jackpot: £{current_jackpot_amount} (within first {current_max_calls} calls).` Only when `game.type === 'snowball'` and `currentSnowballPot` is loaded.

**House rules block:**
- Shown only when the briefing is for the first game of the session (`isFirstGameOfSession === true`). Games 2+ render the briefing without this block.
- Content lives in **`src/lib/house-rules.ts`** (new file) as a single exported constant `HOUSE_RULES`. Shape: `{ items: Array<{ icon: string; text: string }> }`.
- Both the host briefing and the existing `renderHouseRulesPanel` in [display-ui.tsx:471-493](src/app/display/[sessionId]/display-ui.tsx:471) consume `HOUSE_RULES`. The display visual styling stays exactly as-is; only the data source changes from inline JSX to the shared constant.
- Title on the host briefing: `HOUSE RULES`.
- Read-only — no interactive elements.

**How the host page learns "first game":**
- Add one extra Supabase read in [src/app/host/[sessionId]/[gameId]/page.tsx](src/app/host/[sessionId]/[gameId]/page.tsx): `select('game_index').eq('session_id', sessionId).order('game_index', { ascending: true }).limit(1).single()`.
- Compare against the loaded `game.game_index`.
- Pass `isFirstGameOfSession: boolean` as a prop to `<GameControl>`.

**Behaviour after the first call:**
- The briefing disappears the moment `numbers_called_count` becomes `1` — replaced by the standard nickname → ball → stats layout.
- Calling "Undo Last Call" back to zero re-shows the briefing for that game. Acceptable; matches the public display behaviour.
- This applies on every game — game 2's briefing shows when game 2 is opened with zero calls, etc.

**Stats row visibility during the briefing:**
- The single-stage stats row (Calls / Playing For / Prize) is hidden while the briefing is showing. The ladder is the richer view; running both would duplicate the prize and read as noise.
- Snowball summary strip (`isSnowballGame` block, today at [game-control.tsx:827-846](src/app/host/[sessionId]/[gameId]/game-control.tsx:827)) is also hidden during the briefing — already covered by the snowball line inside the ladder.

**Verification:**
- Open game 1 of a fresh session, no calls. See full briefing (game header + colour dot + colour word + ladder + **rules**) + Next Number + Take Break + Check Claim — without scrolling on iPhone 14 Pro Safari.
- Open game 2, no calls. See briefing (game header + colour dot + colour word + ladder) + Next Number + Take Break + Check Claim — **no rules block**.
- Call number 1 on any game. Briefing disappears; standard ball view returns.
- Use "Undo Last Call" to drop back to zero on any game. Briefing for that game returns (with rules on game 1, without on games 2+).

---

## Change 4 — Tighten vertical spacing so primary controls fit above the fold

**Target:** iPhone 14 Pro Safari (390 × 664 viewport after URL bar) sees the bingo ball, stats row, Next Number, Take Break, and Check Claim without scroll, on a game with at least one number called.

**Spacing diet (proposed values, open to tweak):**

| Element | Current | Proposed |
|---|---|---|
| Main display card padding | `p-8` | `p-5` |
| Ball wrapper margin-bottom | `mb-6` | `mb-3` |
| Ball size | `w-40 h-40 text-7xl` | `w-32 h-32 text-6xl` |
| Nickname margin-bottom (now above ball) | `mb-4` | `mb-3` |
| (deleted) "Players see this in Xs" | `mb-4` | gone |
| Stats row top padding | `pt-4` | `pt-3` |
| Card margin-bottom | `mb-6` | `mb-4` |
| Control grid gap | `gap-4` | `gap-3` |
| Control grid margin-bottom | `mb-6` | `mb-4` |
| Next Number button height | `h-24 text-3xl` | `h-20 text-2xl` |
| Page wrapper bottom padding | `pb-32` | `pb-24` |

The Take Break / Check Claim buttons stay at `h-16` (44 px is the iOS tap-target floor; `h-16` is 64 px and still feels right at arm's length).

**Verification:** Take a screenshot at iPhone 14 Pro / Safari with one number called. The bottom edge of "Check Claim" sits inside the visible viewport — no scroll required.

**Safety check on display:** None — these classes are scoped to `game-control.tsx` and don't affect `/display` or `/player`.

---

## File-by-file impact

| File | Change |
|---|---|
| [src/app/host/[sessionId]/[gameId]/page.tsx](src/app/host/[sessionId]/[gameId]/page.tsx) | Add a query for the session's lowest `game_index`; pass `isFirstGameOfSession` to `GameControl`. |
| [src/app/host/[sessionId]/[gameId]/game-control.tsx](src/app/host/[sessionId]/[gameId]/game-control.tsx) | Accept `isFirstGameOfSession`. Render briefing component when first-game + zero-calls. Reorder nickname above ball. Delete "Players see this" line. Apply spacing diet. |
| (new) `src/components/host/pre-game-briefing.tsx` | New stateless component for the briefing (header + ladder + rules). Props: `game`, `currentSnowballPot`. Consumes `HOUSE_RULES` from the shared lib. |
| (new) `src/lib/house-rules.ts` | Single source of truth for the rule items. Exports `HOUSE_RULES` constant. |
| (new) `src/lib/colour-name.ts` | Exports `getColourName(hex)` — nearest-palette lookup against a 12-name curated list. Plus a `.test.ts` next to it. |
| [src/app/display/[sessionId]/display-ui.tsx](src/app/display/[sessionId]/display-ui.tsx) | Import `HOUSE_RULES` from the shared lib and render the same items inside the existing `renderHouseRulesPanel`. No visual change. |

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Extra Supabase read on every host page load to find min(game_index). | Single indexed read on `(session_id, game_index)`; effectively free. The host page is per-session-per-host, not high-traffic. |
| Spacing diet feels too tight on bigger phones (Plus / Max). | Spacing values listed are proposed, not final. Implement, screenshot on 14 Pro and 14 Pro Max, adjust before merging. |
| Pre-game block re-appears on "Undo Last Call" back to 0. | Accept — same behaviour as the public display. Gives a host a clean way to re-read the rules if needed. |
| Snowball calls window changes mid-game and the briefing copy goes stale. | Briefing is only shown when `numbers_called_count === 0`, before any window opens — copy can't go stale during play. |
| `formatStageLabel` helper not exported / not present. | If absent, copy the small lookup map directly into the briefing component. Confirm during planning. |

## Decisions (locked in)

1. **Game type wording.** Header always shows `GAME N · {TYPE}`. `STANDARD`, `SNOWBALL`, or `JACKPOT`. Standard games are not hidden.
2. **Colour identification.** Small coloured dot **and** the colour name in words (e.g. `Green`) — for accessibility (host is colour-blind). Not a tinted card.

[truncated at line 200 — original has 222 lines]
```

### `tasks/review/phase-1/remediation-plan.md`

```
# Remediation Plan - Superseded

This older Phase 1 remediation plan is superseded by:

`docs/superpowers/specs/2026-04-29-bingoblast-design.md`

Do not implement from the old plan. It references function names and behaviors that no longer match the current code, and it predates the code-reviewed void-safe polling requirements.
```

## Related Files (grep hints)

These files reference the basenames of changed files. They are hints for verification — not included inline. Read them only if a specific finding requires it.

```
docs/superpowers/plans/2026-04-30-live-event-reliability.md
docs/superpowers/specs/2026-04-30-live-event-reliability-design.md
tasks/codex-qa-review/2026-04-29-bingoblast-tonight-review-pack.md
tasks/codex-qa-review/2026-04-30-live-event-reliability-review-pack.md
tasks/review/live-event-fixes/wave-3/W3D-handoff.md
```

## Workspace Conventions (`Cursor/CLAUDE.md`)

```markdown
# CLAUDE.md — Workspace Standards

Shared guidance for Claude Code across all projects. Project-level `CLAUDE.md` files take precedence over this one — always read them first.

## Default Stack

Next.js 15 App Router, React 19, TypeScript (strict), Tailwind CSS, Supabase (PostgreSQL + Auth + RLS), deployed on Vercel.

## Workspace Architecture

21 projects across three brands, plus shared tooling:

| Prefix | Brand | Examples |
|--------|-------|----------|
| `OJ-` | Orange Jelly | AnchorManagementTools, CheersAI2.0, Planner2.0, MusicBingo, CashBingo, QuizNight, The-Anchor.pub, DukesHeadLeatherhead.com, OrangeJelly.co.uk, WhatsAppVideoCreator |
| `GMI-` | GMI | MixerAI2.0 (canonical auth reference), TheCookbook, ThePantry |
| `BARONS-` | Barons | CareerHub, EventHub, BrunchLaunchAtTheStar, StPatricksDay, DigitalExperienceMockUp, WebsiteContent |
| (none) | Shared / test | Test, oj-planner-app |

## Core Principles

**How to think:**
- **Simplicity First** — make every change as simple as possible; minimal code impact
- **No Laziness** — find root causes; no temporary fixes; senior developer standards
- **Minimal Impact** — only touch what's necessary; avoid introducing bugs

**How to act:**
1. **Do ONLY what is asked** — no unsolicited improvements
2. **Ask ONE clarifying question maximum** — if unclear, proceed with safest minimal implementation
3. **Record EVERY assumption** — document in PR/commit messages
4. **One concern per changeset** — if a second concern emerges, park it
5. **Fail safely** — when in doubt, stop and request human approval

### Source of Truth Hierarchy

1. Project-level CLAUDE.md
2. Explicit task instructions
3. Existing code patterns in the project
4. This workspace CLAUDE.md
5. Industry best practices / framework defaults

## Ethics & Safety

AI MUST stop and request explicit approval before:
- Any operation that could DELETE user data or drop DB columns/tables
- Disabling authentication/authorisation or removing encryption
- Logging, sending, or storing PII in new locations
- Changes that could cause >1 minute downtime
- Using GPL/AGPL code in proprietary projects

## Communication

- When the user asks to "remove" or "clean up" something, clarify whether they mean a code change or a database/data cleanup before proceeding
- Ask ONE clarifying question maximum — if still unclear, proceed with the safest interpretation

## Debugging & Bug Fixes

- When fixing bugs, check the ENTIRE application for related issues, not just the reported area — ask: "Are there other places this same pattern exists?"
- When given a bug report: just fix it — don't ask for hand-holding
- Point at logs, errors, failing tests — then resolve them
- Zero context switching required from the user

## Code Changes

- Before suggesting new environment variables or database columns, check existing ones first — use `grep` to find existing env vars and inspect the current schema before proposing additions
- One logical change per commit; one concern per changeset

## Workflow Orchestration

### 1. Plan Mode Default
- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions)
- If something goes sideways, STOP and re-plan immediately

### 2. Subagent Strategy
- Use subagents liberally to keep main context window clean
- Offload research, exploration, and parallel analysis to subagents
- One task per subagent for focused execution

### 3. Task Tracking
- Write plan to `tasks/todo.md` with checkable items before starting
- Mark items complete as you go; document results when done

### 4. Self-Improvement Loop
- After ANY correction from the user: update `tasks/lessons.md` with the pattern
- Write rules that prevent the same mistake; review lessons at session start

### 5. Verification Before Done
- Never mark a task complete without proving it works
- Run tests, check logs, demonstrate correctness
- Ask yourself: "Would a staff engineer approve this?"
- For non-trivial changes: pause and ask "is there a more elegant way?"

### 6. Codex Integration Hook
Uses OpenAI Codex CLI to audit, test and simulate — catches what Claude misses.

```
when: "running tests OR auditing OR simulating"
do:
  - run_skill(codex-review, target=current_task)
  - compare_outputs(claude_result, codex_result)
  - flag_discrepancies(threshold=medium)
  - merge_best_solution()
```

The full multi-specialist QA review skill lives in `~/.claude/skills/codex-qa-review/`. Trigger with "QA review", "codex review", "second opinion", or "check my work". Deploys four specialist agents (Bug Hunter, Security Auditor, Performance Analyst, Standards Enforcer) into a single prioritised report.

## Common Commands

```bash
npm run dev       # Start development server
npm run build     # Production build
npm run lint      # ESLint (zero warnings enforced)
npm test          # Run tests (Vitest unless noted otherwise)
npm run typecheck # TypeScript type checking (npx tsc --noEmit)
npx supabase db push   # Apply pending migrations (Supabase projects)
```

## Coding Standards

### TypeScript
- No `any` types unless absolutely justified with a comment
- Explicit return types on all exported functions
- Props interfaces must be named (not inline anonymous objects for complex props)
- Use `Promise<{ success?: boolean; error?: string }>` for server action return types

### Frontend / Styling
- Use design tokens only — no hardcoded hex colours in components
- Always consider responsive breakpoints (`sm:`, `md:`, `lg:`)
- No conflicting or redundant class combinations
- Design tokens should live in `globals.css` via `@theme inline` (Tailwind v4) or `tailwind.config.ts`
- **Never use dynamic Tailwind class construction** (e.g., `bg-${color}-500`) — always use static, complete class names due to Tailwind's purge behaviour

### Date Handling
- Always use the project's `dateUtils` (typically `src/lib/dateUtils.ts`) for display
- Never use raw `new Date()` or `.toISOString()` for user-facing dates
- Default timezone: Europe/London
- Key utilities: `getTodayIsoDate()`, `toLocalIsoDate()`, `formatDateInLondon()`

### Phone Numbers
- Always normalise to E.164 format (`+44...`) using `libphonenumber-js`

## Server Actions Pattern

All mutations use `'use server'` functions (typically in `src/app/actions/` or `src/actions/`):

```typescript
'use server';
export async function doSomething(params): Promise<{ success?: boolean; error?: string }> {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Unauthorized' };
  // ... permission check, business logic, audit log ...
  revalidatePath('/path');
  return { success: true };
}
```

## Database / Supabase

See `.claude/rules/supabase.md` for detailed patterns. Key rules:
- DB columns are `snake_case`; TypeScript types are `camelCase`
- Always wrap DB results with a conversion helper (e.g. `fromDb<T>()`)
- RLS is always on — use service role client only for system/cron operations
- Two client patterns: cookie-based auth client and service-role admin client

### Before Any Database Work
Before making changes to queries, migrations, server actions, or any code that touches the database, query the live schema for all tables involved:
```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name IN ('relevant_table') ORDER BY ordinal_position;
```
Also check for views referencing those tables — they will break silently if columns change:
```sql
SELECT table_name FROM information_schema.view_table_usage
WHERE table_name IN ('relevant_table');
```

### Migrations
- Always verify migrations don't conflict with existing timestamps
- Test the connection string works before pushing
- PostgreSQL views freeze their column lists — if underlying tables change, views must be recreated
- Never run destructive migrations (DROP COLUMN/TABLE) without explicit approval

## Git Conventions

See `.claude/rules/pr-and-git-standards.md` for full PR templates, branch naming, and reviewer checklists. Key rules:
- Conventional commits: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`
- Never force-push to `main`
- One logical change per commit
- Meaningful commit messages explaining "why" not just "what"

## Rules Reference

Core rules (always loaded from `.claude/rules/`):

| File | Read when… |
|------|-----------|
| `ui-patterns.md` | Building or modifying UI components, forms, buttons, navigation, or accessibility |
| `testing.md` | Adding, modifying, or debugging tests; setting up test infrastructure |
| `definition-of-ready.md` | Starting any new feature — check requirements are clear before coding |
| `definition-of-done.md` | Finishing any feature — verify all quality gates pass |
| `complexity-and-incremental-dev.md` | Scoping a task that touches 4+ files or involves schema changes |
| `pr-and-git-standards.md` | Creating branches, writing commit messages, or opening PRs |
| `verification-pipeline.md` | Before pushing — run the full lint → typecheck → test → build pipeline |
| `supabase.md` | Any database query, migration, RLS policy, or client usage |

Domain rules (auto-injected from `.claude/docs/` when you edit relevant files):

| File | Domain |
|------|--------|
| `auth-standard.md` | Auth, sessions, middleware, RBAC, CSRF, password reset, invites |
| `background-jobs.md` | Async job queues, Vercel Cron, retry logic |
| `api-key-auth.md` | External API key generation, validation, rotation |
| `file-export.md` | PDF, DOCX, CSV generation and download |
| `rate-limiting.md` | Upstash rate limiting, 429 responses |
| `qr-codes.md` | QR code generation (client + server) |
| `toast-notifications.md` | Sonner toast patterns |
| `email-notifications.md` | Resend email, templates, audit logging |
| `ai-llm.md` | LLM client, prompts, token tracking, vision |
| `payment-processing.md` | Stripe/PayPal two-phase payment flows |
| `data-tables.md` | TanStack React Table v8 patterns |

## Quality Gates

A feature is only complete when it passes the full Definition of Done checklist (`.claude/rules/definition-of-done.md`). At minimum: builds, lints, type-checks, tests pass, no hardcoded secrets, auth checks in place, code commented where complex.
```

## Project Conventions (`CLAUDE.md`)

```markdown
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
```

## Rule: `/Users/peterpitcher/Cursor/.claude/rules/definition-of-done.md`

```markdown
# Definition of Done (DoD)

A feature is ONLY complete when ALL applicable items pass. This extends the Quality Gates in the root CLAUDE.md.

## Code Quality

- [ ] Builds successfully — `npm run build` with zero errors
- [ ] Linting passes — `npm run lint` with zero warnings
- [ ] Type checks pass — `npx tsc --noEmit` clean (or project equivalent)
- [ ] No `any` types unless justified with a comment
- [ ] No hardcoded secrets or API keys
- [ ] No hardcoded hex colours — use design tokens
- [ ] Server action return types explicitly typed

## Testing

- [ ] All existing tests pass
- [ ] New tests written for business logic (happy path + at least 1 error case)
- [ ] Coverage meets project minimum (default: 80% on business logic)
- [ ] External services mocked — never hit real APIs in tests
- [ ] If no test suite exists yet, note this in the PR as tech debt

## Security

- [ ] Auth checks in place — server actions re-verify server-side
- [ ] Permission checks present — RBAC enforced on both UI and server
- [ ] Input validation complete — all user inputs sanitised (Zod or equivalent)
- [ ] No new PII logging, sending, or storing without approval
- [ ] RLS verified (Supabase projects) — queries respect row-level security

## Accessibility

- [ ] Interactive elements have visible focus styles
- [ ] Colour is not the sole indicator of state
- [ ] Modal dialogs trap focus and close on Escape
- [ ] Tables have proper `<thead>`, `<th scope>` markup
- [ ] Images have meaningful `alt` text
- [ ] Keyboard navigation works for all interactive elements

## Documentation

- [ ] Complex logic commented — future developers can understand "why"
- [ ] README updated if new setup, config, or env vars are needed
- [ ] Environment variables documented in `.env.example`
- [ ] Breaking changes noted in PR description

## Deployment

- [ ] Database migrations tested locally before pushing
- [ ] Rollback plan documented for schema changes
- [ ] No console.log or debug statements left in production code
- [ ] Verification pipeline passes (see `verification-pipeline.md`)
```

## Rule: `/Users/peterpitcher/Cursor/.claude/rules/supabase.md`

```markdown
# Supabase Conventions

## Client Patterns

Two Supabase client patterns — always use the correct one:

```typescript
// Server-side auth (anon key + cookie session) — use for auth checks:
const supabase = await getSupabaseServerClient();
const { data: { user } } = await supabase.auth.getUser();

// Server-side data (service-role, bypasses RLS) — use for system/cron operations:
const db = await getDb(); // or createClient() with service role
const { data } = await db.from("table").select("*").eq("id", id).single();

// Browser-only (client components):
const supabase = getSupabaseBrowserClient();
```

ESLint rules should prevent importing the admin/service-role client in client components.

## snake_case ↔ camelCase Conversion

DB columns are always `snake_case`; TypeScript types are `camelCase` with Date objects. Always wrap DB results:

```typescript
import { fromDb } from "@/lib/utils";
const record = fromDb<MyType>(dbRow); // converts snake_case keys + ISO strings → Date
```

All type definitions should live in a central types file (e.g. `src/types/database.ts`).

## Row Level Security (RLS)

- RLS is always enabled on all tables
- Use the anon-key client for user-scoped operations (respects RLS)
- Use the service-role client only for system operations, crons, and webhooks
- Never disable RLS "temporarily" — create a proper service-role path instead

## Migrations

```bash
npx supabase db push          # Apply pending migrations
npx supabase migration new    # Create a new migration file
```

- Migrations live in `supabase/migrations/`
- Full schema reference in `supabase/schema.sql` (paste into SQL Editor for fresh setup)
- Never run destructive migrations (DROP COLUMN/TABLE) without explicit approval
- Test migrations locally with `npx supabase db push --dry-run` before pushing (see `verification-pipeline.md`)

### Dropping columns or tables — mandatory function audit

When a migration drops a column or table, you MUST search for every function and trigger that references it and update them in the same migration. Failing to do so leaves silent breakage: PL/pgSQL functions that reference a dropped column/table throw an exception at runtime, and if any of those functions have an `EXCEPTION WHEN OTHERS THEN` handler, the error is swallowed and returned as a generic blocked/failure state — making the bug invisible until someone notices the feature is broken.

**Before writing any `DROP COLUMN` or `DROP TABLE`:**

```sql
-- Find all functions that reference the column or table
SELECT routine_name, routine_definition
FROM information_schema.routines
WHERE routine_definition ILIKE '%column_or_table_name%'
  AND routine_type = 'FUNCTION';
```

Or search the migrations directory:
```bash
grep -r "column_or_table_name" supabase/migrations/ --include="*.sql" -l
```

For each function found: update it in the same migration to remove or replace the reference. Never leave a function referencing infrastructure that no longer exists.

This also applies to **triggers** — check trigger functions separately:
```bash
grep -r "column_or_table_name" supabase/migrations/ --include="*.sql" -n
```

## Auth

- Supabase Auth with JWT + HTTP-only cookies
- Auth checks happen in layout files or middleware
- Server actions must always re-verify auth server-side (never rely on UI hiding)
- Public routes must be explicitly allowlisted

## Audit Logging

All mutations (create, update, delete) in server actions must call `logAuditEvent()`:

```typescript
await logAuditEvent({
  user_id: user.id,
  operation_type: 'update',
  resource_type: 'thing',
  operation_status: 'success'
});
```
```

---

_End of pack._
