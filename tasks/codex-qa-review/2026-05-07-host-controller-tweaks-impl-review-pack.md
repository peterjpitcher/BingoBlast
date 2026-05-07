# Review Pack: host-controller-tweaks-impl

**Generated:** 2026-05-07
**Mode:** C (A=Adversarial / B=Code / C=Spec Compliance)
**Project root:** `/Users/peterpitcher/Cursor/OJ-CashBingo`
**Base ref:** `HEAD`
**HEAD:** `786eacd`
**Diff range:** `HEAD`
**Stats:**  11 files changed, 220 insertions(+), 214 deletions(-)

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
src/app/display/[sessionId]/display-ui.tsx
src/app/host/[sessionId]/[gameId]/game-control.tsx
src/app/host/[sessionId]/[gameId]/page.tsx
src/components/host/pre-game-briefing.tsx
src/lib/colour-name.test.ts
src/lib/colour-name.ts
src/lib/house-rules.ts
tasks/host-controller-tweaks/.implement/wave-1/colour-name/handoff.md
tasks/host-controller-tweaks/.implement/wave-1/house-rules/handoff.md
tasks/host-controller-tweaks/.implement/wave-2/briefing-component/handoff.md
tasks/host-controller-tweaks/.implement/wave-2/display-refactor/handoff.md
tasks/host-controller-tweaks/.implement/wave-3/host-wiring/handoff.md
tasks/host-controller-tweaks/PLAN.md
tasks/host-controller-tweaks/SPEC.md
tasks/review/phase-1/remediation-plan.md
```

## User Concerns

Implementation review. Verify the code actually delivers what SPEC.md promises. Five new/modified files: src/lib/colour-name.ts (+test), src/lib/house-rules.ts, src/components/host/pre-game-briefing.tsx, src/app/display/[sessionId]/display-ui.tsx (rules refactor only), src/app/host/[sessionId]/[gameId]/page.tsx (added first-game query), src/app/host/[sessionId]/[gameId]/game-control.tsx (briefing render, nickname above ball, removed call-delay hint, spacing diet). Mandatory checks: (a) display DOM byte-identical to before, (b) briefing renders only when numbers_called_count===0 and rules block only when isFirstGameOfSession, (c) getColourName returns 'Unknown colour' on invalid input, (d) all spacing diet values match the SPEC table.

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
- Returns the literal string `"Unknown colour"` if the input is not a valid `#rrggbb` hex. The host (colour-blind) must always have a non-colour textual indicator — never a dot-only fallback.
- Tested in `src/lib/colour-name.test.ts` — happy path (`#ffffff` → `"White"`, `#16a34a` → `"Green"`) plus an invalid input case asserting `"Unknown colour"`.

**Prize ladder block:**
- Title: `TONIGHT YOU CAN WIN`.
- One row per entry in `game.stage_sequence`, in order:
  - Left: `Stage {n}: {stage label}` — `Line` / `Two Lines` / `Full House` rendered verbatim (no extra formatting helper needed; the values are already the display labels).
  - Right: prize text from `game.prizes[stage]`. If missing, render `⚠️ Prize not set` in the destructive colour (matches the host stats row's existing missing-prize style).
- Snowball game: under the ladder, a single line — `Snowball jackpot: £{current_jackpot_amount} (within first {current_max_calls} calls).` Only when `game.type === 'snowball'` and `currentSnowballPot` is loaded.

**House rules block:**
- Shown only when the briefing is for the first game of the session (`isFirstGameOfSession === true`). Games 2+ render the briefing without this block.
- Content lives in **`src/lib/house-rules.ts`** (new file) as a single exported constant `HOUSE_RULES`. The shape must preserve the existing display markup losslessly — including item 1's inline `<span className="font-bold">late claims invalid</span>` emphasis and the last item's special styling (`pt-1` on the `<li>`, `clamp()`-sized 🎉 icon, `font-bold italic` text):
  ```ts
  type Segment = { text: string; bold?: boolean };
  type Rule = {
    icon: string;                          // '➤' or '🎉'
    segments: Segment[];                   // ordered text segments; segments with bold:true wrap in <span className="font-bold">
    variant?: 'default' | 'closing';       // 'closing' applies the last-item styling (pt-1 li, larger icon, bold-italic text)
  };
  export const HOUSE_RULES: ReadonlyArray<Rule> = [...];
  ```
- Both the host briefing and the existing `renderHouseRulesPanel` in [display-ui.tsx:471-493](src/app/display/[sessionId]/display-ui.tsx:471) consume `HOUSE_RULES`. The display refactor is data-source-only: the existing `<ul>`/`<li>` markup, classes, and copy stay byte-identical; only the data source changes from inline JSX to mapping over `HOUSE_RULES`. **Verify with a before/after screenshot of `/display/[sessionId]` in the waiting state — block merge on any pixel-level diff in the rules panel.**
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

**Hard target:** primary controls (Next Number, Take Break, Check Claim) are visible above the fold in **every** state on iPhone 14 Pro Safari (390 × 664 viewport after URL bar) — including in-play, the briefing without rules (games 2+), and the briefing with rules (game 1). If the briefing body would push controls off-screen on the first-game state, the **briefing body scrolls inside its own container while the controls stay pinned**. Controls never scroll; the briefing may.

**Soft target:** in the in-play state (one or more numbers called), all of the bingo ball, nickname, stats row, and primary controls are visible without any scroll.

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

**Verification:** Take screenshots at iPhone 14 Pro / Safari for three states:
1. In-play, one number called — soft target met (everything visible, no scroll).
2. Briefing on game 2 (no rules) — hard target met (controls visible; briefing body fits or scrolls within its own container).
3. Briefing on game 1 (with rules) — hard target met (controls visible; briefing body scrolls within its own container if needed).

**Safety check on display:** None — these spacing classes are scoped to `game-control.tsx` and don't affect `/display` or `/player`. Display visual parity is verified separately under the rules-extraction screenshot gate.

---

## File-by-file impact

| File | Change |
|---|---|
| [src/app/host/[sessionId]/[gameId]/page.tsx](src/app/host/[sessionId]/[gameId]/page.tsx) | Add a query for the session's lowest `game_index`; pass `isFirstGameOfSession` to `GameControl`. |
| [src/app/host/[sessionId]/[gameId]/game-control.tsx](src/app/host/[sessionId]/[gameId]/game-control.tsx) | Accept `isFirstGameOfSession`. Render `<PreGameBriefing>` whenever `numbers_called_count === 0` (every game), passing `isFirstGameOfSession` so the briefing internally gates the rules sub-block. Reorder nickname above ball. Delete "Players see this" line. Apply spacing diet. Wrap briefing body in a scroll-on-overflow container so primary controls stay pinned. |
| (new) `src/components/host/pre-game-briefing.tsx` | New stateless component for the briefing (header + ladder + optional rules). Props: `game: Game`, `currentSnowballPot: SnowballPot \| null`, `isFirstGameOfSession: boolean`. Consumes `HOUSE_RULES` from the shared lib and renders the rules sub-block only when `isFirstGameOfSession` is true. |
| (new) `src/lib/house-rules.ts` | Single source of truth for the rule items. Exports `HOUSE_RULES: ReadonlyArray<Rule>` along with the `Segment` and `Rule` types defined in Change 3. |
| (new) `src/lib/colour-name.ts` | Exports `getColourName(hex)` — nearest-palette lookup against a 12-name curated list. Plus a `.test.ts` next to it. |
| [src/app/display/[sessionId]/display-ui.tsx](src/app/display/[sessionId]/display-ui.tsx) | Import `HOUSE_RULES` from the shared lib. Replace the inline rule `<li>` JSX with `HOUSE_RULES.map(rule => …)` while keeping the existing `<ul>` classes, `<li>` classes (including `pt-1` on `closing` variant), icon classes (including `clamp()` size on closing), and inline `<span className="font-bold">` for `bold` segments. Markup output must be byte-identical. Verify with screenshot diff. |


[spec truncated at line 200 — original has 236 lines]
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
diff --git a/src/app/display/[sessionId]/display-ui.tsx b/src/app/display/[sessionId]/display-ui.tsx
index af3e173..4fefd6b 100644
--- a/src/app/display/[sessionId]/display-ui.tsx
+++ b/src/app/display/[sessionId]/display-ui.tsx
@@ -7,6 +7,7 @@ import { cn } from '@/lib/utils';
 import Image from 'next/image';
 import { QRCodeSVG } from 'qrcode.react';
 import { formatPounds, getSnowballCallsLabel, getSnowballCallsRemaining } from '@/lib/snowball';
+import { HOUSE_RULES } from '@/lib/house-rules';
 import { isFreshGameState } from '@/lib/game-state-version';
 import { useConnectionHealth } from '@/hooks/use-connection-health';
 import { ConnectionBanner } from '@/components/connection-banner';
@@ -472,22 +473,36 @@ export default function DisplayUI({
     <div className="bg-[#003f27]/85 border border-[#1f7c58] rounded-3xl p-6 text-left backdrop-blur-md overflow-hidden">
       <h3 className={houseRulesTitleClass}>House Rules</h3>
       <ul className={houseRulesListClass}>
-        <li className="flex gap-4 items-start">
-          <span className="text-white mt-1">➤</span>
-          <span>Claims must be called on the number they&apos;re won on - <span className="font-bold">late claims invalid</span></span>
-        </li>
-        <li className="flex gap-4 items-start">
-          <span className="text-white mt-1">➤</span>
-          <span>Multiple claims share the prize</span>
-        </li>
-        <li className="flex gap-4 items-start">
-          <span className="text-white mt-1">➤</span>
-          <span>Snowball eligibility: Players must have been here for the last three games</span>
-        </li>
-        <li className="flex gap-4 items-start pt-1">
-          <span className="text-[clamp(1.7rem,2.3vw,2.4rem)]">🎉</span>
-          <span className="font-bold italic">Enjoy the night and best of luck to everyone!</span>
-        </li>
+        {HOUSE_RULES.map((rule, i) => (
+          <li
+            key={i}
+            className={cn(
+              'flex gap-4 items-start',
+              rule.variant === 'closing' && 'pt-1'
+            )}
+          >
+            <span
+              className={
+                rule.variant === 'closing'
+                  ? 'text-[clamp(1.7rem,2.3vw,2.4rem)]'
+                  : 'text-white mt-1'
+              }
+            >
+              {rule.icon}
+            </span>
+            <span
+              className={cn(rule.variant === 'closing' && 'font-bold italic')}
+            >
+              {rule.segments.map((seg, j) =>
+                seg.bold ? (
+                  <span key={j} className="font-bold">{seg.text}</span>
+                ) : (
+                  <React.Fragment key={j}>{seg.text}</React.Fragment>
+                )
+              )}
+            </span>
+          </li>
+        ))}
       </ul>
     </div>
   );
diff --git a/src/app/host/[sessionId]/[gameId]/game-control.tsx b/src/app/host/[sessionId]/[gameId]/game-control.tsx
index d10f20b..bd6332a 100644
--- a/src/app/host/[sessionId]/[gameId]/game-control.tsx
+++ b/src/app/host/[sessionId]/[gameId]/game-control.tsx
@@ -18,6 +18,7 @@ import { formatPounds, getSnowballCallsLabel, getSnowballCallsRemaining, isSnowb
 import { isFreshGameState } from '@/lib/game-state-version';
 import { getRequiredSelectionCountForStage } from '@/lib/win-stages';
 import { logError } from '@/lib/log-error';
+import { PreGameBriefing } from '@/components/host/pre-game-briefing';
 
 type Game = Database['public']['Tables']['games']['Row'];
 type GameState = Database['public']['Tables']['game_states']['Row'];
@@ -34,6 +35,7 @@ interface GameControlProps {
     initialGameState: GameState;
     currentUserId: string;
     currentUserRole: UserRole;
+    isFirstGameOfSession: boolean;
 }
 
 // Hardcoded for now (same as before)
@@ -98,7 +100,7 @@ const NUMBER_NICKNAMES: { [key: number]: string } = {
     90: "Top Of The Shop"
 };
 
-export default function GameControl({ sessionId, gameId, game, initialGameState, currentUserId, currentUserRole }: GameControlProps) {
+export default function GameControl({ sessionId, gameId, game, initialGameState, currentUserId, currentUserRole, isFirstGameOfSession }: GameControlProps) {
     const router = useRouter();
     const [currentGameState, setCurrentGameState] = useState<GameState>(initialGameState);
     const [currentSnowballPot, setCurrentSnowballPot] = useState<SnowballPot | null>(null);
@@ -750,7 +752,7 @@ export default function GameControl({ sessionId, gameId, game, initialGameState,
 
 
     return (
-        <div className="p-4 pb-32 max-w-5xl mx-auto relative text-white">
+        <div className="p-4 pb-24 max-w-5xl mx-auto relative text-white">
             {/* Controller Locked Overlay / Banner */}
             {!isController && (
                 <div className="absolute inset-x-0 top-0 z-50 p-4">
@@ -781,78 +783,91 @@ export default function GameControl({ sessionId, gameId, game, initialGameState,
             {currentGameState.paused_for_validation && <div className="mb-4 p-4 bg-[#a57626]/25 border border-[#a57626] text-white rounded-lg text-center text-lg font-bold">CHECKING CLAIM...</div>}
 
             {/* Main Display Card */}
-            <Card className={cn(hostSurfaceClass, "mb-6 overflow-hidden")}>
-                <CardContent className="p-8 flex flex-col items-center text-center">
-                    <div className="mb-6 relative">
-                        {currentNumber ? (
-                            <BingoBall number={currentNumber} variant="active" className="w-40 h-40 text-7xl bg-[#005131] border-[#a57626]/70 text-white shadow-[0_0_40px_rgba(165,118,38,0.35)]" />
-                        ) : (
-                            <div className="w-40 h-40 rounded-full bg-[#005131] border-4 border-[#1f7c58] flex items-center justify-center text-white/70 text-sm font-bold">
-                                READY
-                            </div>
-                        )}
-                    </div>
-
-                    {currentNickname && (
-                        <h2 className="text-3xl font-bold text-white mb-4 animate-in fade-in slide-in-from-bottom-4">{currentNickname}</h2>
-                    )}
-
-                    {/* Passive label so the host knows why the displayed number isn't yet on the player screen. */}
-                    {currentGameState.last_call_at && (
-                        <p className="text-xs text-muted-foreground mb-4">
-                            Players see this in {currentGameState.call_delay_seconds ?? 2}s
-                        </p>
-                    )}
-
-                    <div className="flex items-center gap-6 text-sm text-white/90 border-t border-[#1f7c58] pt-4 w-full justify-center">
-                        <div>
-                            <span className="block text-white/80 uppercase text-xs tracking-wider mb-1">Calls</span>
-                            <span className="text-xl font-mono text-white">{currentGameState.numbers_called_count}</span>
-                        </div>
-                        <div className="h-8 w-px bg-[#1f7c58]"></div>
-                        <div>
-                            <span className="block text-white/80 uppercase text-xs tracking-wider mb-1">Playing For</span>
-                            <span className="text-xl font-bold text-white">{currentStageName || 'Finished'}</span>
+            <Card className={cn(hostSurfaceClass, "mb-4 overflow-hidden")}>
+                <CardContent className="p-5 flex flex-col items-center text-center">
+                    {currentGameState.numbers_called_count === 0 ? (
+                        // Pre-game briefing — scrolls inside its own container so primary controls stay pinned.
+                        <div className="w-full max-h-[55vh] overflow-y-auto pr-1">
+                            <PreGameBriefing
+                                game={game}
+                                currentSnowballPot={currentSnowballPot}
+                                isFirstGameOfSession={isFirstGameOfSession}
+                            />
                         </div>
-                        <div className="h-8 w-px bg-[#1f7c58]"></div>
-                        <div>
-                            <span className="block text-white/80 uppercase text-xs tracking-wider mb-1">Prize</span>
-                            {isStagePrizeMissing ? (
-                                <span className="text-xl font-bold text-destructive">⚠️ Prize not set</span>
-                            ) : (
-                                <span className="text-xl font-bold text-white">{plannedStagePrize}</span>
+                    ) : (
+                        <>
+                            {currentNickname && (
+                                <h2 className="text-3xl font-bold text-white mb-3 animate-in fade-in slide-in-from-top-4">
+                                    {currentNickname}
+                                </h2>
                             )}
-                        </div>
-                    </div>
-                    {isSnowballGame && (
-                        <div className="mt-4 w-full rounded-xl border border-[#a57626]/70 bg-[#005131]/65 px-4 py-3 flex flex-col md:flex-row md:items-center md:justify-between gap-2">
-                            {currentSnowballPot && snowballCallsLabel ? (
-                                <>
-                                    <p className="text-white font-semibold">
-                                        Snowball Jackpot: £{formatPounds(Number(currentSnowballPot.current_jackpot_amount))}
-                                    </p>
-                                    <p className="text-white/90 font-semibold text-right">
-                                        {snowballCallsLabel}
-                                        {` • ${currentGameState.numbers_called_count}/${currentSnowballPot.current_max_calls} calls`}
-                                        {typeof snowballCallsRemaining === 'number' ? ` • ${snowballCallsRemaining} left` : ''}
-                                    </p>
-                                </>
-                            ) : (
-                                <p className="text-white/90 font-semibold">
-                                    Snowball countdown unavailable: this game is not linked to a snowball pot.
-                                </p>
+                            <div className="mb-3 relative">
+                                {currentNumber ? (
+                                    <BingoBall
+                                        number={currentNumber}
+                                        variant="active"
+                                        className="w-32 h-32 text-6xl bg-[#005131] border-[#a57626]/70 text-white shadow-[0_0_40px_rgba(165,118,38,0.35)]"
+                                    />
+                                ) : (
+                                    // Edge case: numbers_called_count > 0 but no current number resolvable.
+                                    // Keep a small READY fallback for safety.
+                                    <div className="w-32 h-32 rounded-full bg-[#005131] border-4 border-[#1f7c58] flex items-center justify-center text-white/70 text-sm font-bold">
+                                        READY
+                                    </div>
+                                )}
+                            </div>
+
+                            <div className="flex items-center gap-6 text-sm text-white/90 border-t border-[#1f7c58] pt-3 w-full justify-center">
+                                <div>
+                                    <span className="block text-white/80 uppercase text-xs tracking-wider mb-1">Calls</span>
+                                    <span className="text-xl font-mono text-white">{currentGameState.numbers_called_count}</span>
+                                </div>
+                                <div className="h-8 w-px bg-[#1f7c58]"></div>
+                                <div>
+                                    <span className="block text-white/80 uppercase text-xs tracking-wider mb-1">Playing For</span>
+                                    <span className="text-xl font-bold text-white">{currentStageName || 'Finished'}</span>
+                                </div>
+                                <div className="h-8 w-px bg-[#1f7c58]"></div>
+                                <div>
+                                    <span className="block text-white/80 uppercase text-xs tracking-wider mb-1">Prize</span>
+                                    {isStagePrizeMissing ? (
+                                        <span className="text-xl font-bold text-destructive">⚠️ Prize not set</span>
+                                    ) : (
+                                        <span className="text-xl font-bold text-white">{plannedStagePrize}</span>
+                                    )}
+                                </div>
+                            </div>
+                            {isSnowballGame && (
+                                <div className="mt-4 w-full rounded-xl border border-[#a57626]/70 bg-[#005131]/65 px-4 py-3 flex flex-col md:flex-row md:items-center md:justify-between gap-2">
+                                    {currentSnowballPot && snowballCallsLabel ? (
+                                        <>
+                                            <p className="text-white font-semibold">
+                                                Snowball Jackpot: £{formatPounds(Number(currentSnowballPot.current_jackpot_amount))}
+                                            </p>
+                                            <p className="text-white/90 font-semibold text-right">
+                                                {snowballCallsLabel}
+                                                {` • ${currentGameState.numbers_called_count}/${currentSnowballPot.current_max_calls} calls`}
+                                                {typeof snowballCallsRemaining === 'number' ? ` • ${snowballCallsRemaining} left` : ''}
+                                            </p>
+                                        </>
+                                    ) : (
+                                        <p className="text-white/90 font-semibold">
+                                            Snowball countdown unavailable: this game is not linked to a snowball pot.
+                                        </p>
+                                    )}
+                                </div>
                             )}
-                        </div>
+                        </>
                     )}
                 </CardContent>
             </Card>
 
             {/* Control Pad */}
-            <div className={cn("grid grid-cols-2 gap-4 mb-6", !isController && "opacity-50 pointer-events-none")}>
+            <div className={cn("grid grid-cols-2 gap-3 mb-4", !isController && "opacity-50 pointer-events-none")}>
                 <Button
                     variant="primary"
                     size="xl"
-                    className={cn("col-span-2 h-24 text-3xl bg-[#005131] hover:bg-[#0f6846] border border-[#a57626] shadow-lg shadow-black/20", isCallingNumber && "opacity-80")}
+                    className={cn("col-span-2 h-20 text-2xl bg-[#005131] hover:bg-[#0f6846] border border-[#a57626] shadow-lg shadow-black/20", isCallingNumber && "opacity-80")}
                     onClick={handleCallNextNumber}
                     disabled={isNextNumberDisabled}
                 >
diff --git a/src/app/host/[sessionId]/[gameId]/page.tsx b/src/app/host/[sessionId]/[gameId]/page.tsx
index 41a5841..0f281b3 100644
--- a/src/app/host/[sessionId]/[gameId]/page.tsx
+++ b/src/app/host/[sessionId]/[gameId]/page.tsx
@@ -64,9 +64,21 @@ export default async function GameControlPage({ params }: PageProps) {
 
   if (!gameStateResult.success || !gameStateResult.data) {
     console.warn(`Game ${gameId} in session ${sessionId} has no initial game state. Redirecting to host dashboard.`);
-    redirect('/host'); 
+    redirect('/host');
   }
 
+  // Determine whether this is the first game of the session — controls whether
+  // the pre-game briefing surfaces the house rules block.
+  const { data: firstGame } = await supabase
+    .from('games')
+    .select('game_index')
+    .eq('session_id', sessionId)
+    .order('game_index', { ascending: true })
+    .limit(1)
+    .single<{ game_index: number }>();
+
+  const isFirstGameOfSession = !!firstGame && game.game_index === firstGame.game_index;
+
   return (
     <div className="min-h-screen-safe anchor-theme bg-[#003f27] text-white">
        <header className="p-3 bg-[#005131]/95 border-b border-[#1f7c58] flex justify-between items-center sticky top-0 z-20 shadow-md">
@@ -98,6 +110,7 @@ export default async function GameControlPage({ params }: PageProps) {
         initialGameState={gameStateResult.data}
         currentUserId={user.id}
         currentUserRole={profile?.role || 'host'}
+        isFirstGameOfSession={isFirstGameOfSession}
       />
     </div>
   );
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
2026-05-07T09:18:57Z|CREATE|src/lib/colour-name.ts|utility|structure
2026-05-07T09:19:01Z|CREATE|src/lib/colour-name.test.ts|utility|structure
2026-05-07T09:19:29Z|CREATE|src/lib/house-rules.ts|utility|structure
2026-05-07T09:21:52Z|CREATE|src/components/host/pre-game-briefing.tsx|component|structure
2026-05-07T09:24:07Z|EDIT|src/app/host/[sessionId]/[gameId]/page.tsx|route|structure,docs
2026-05-07T09:24:13Z|EDIT|src/app/host/[sessionId]/[gameId]/page.tsx|route|structure,docs
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

### `src/app/display/[sessionId]/display-ui.tsx`

```
"use client";

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Database } from '@/types/database';
import { createClient } from '@/utils/supabase/client';
import { cn } from '@/lib/utils';
import Image from 'next/image';
import { QRCodeSVG } from 'qrcode.react';
import { formatPounds, getSnowballCallsLabel, getSnowballCallsRemaining } from '@/lib/snowball';
import { HOUSE_RULES } from '@/lib/house-rules';
import { isFreshGameState } from '@/lib/game-state-version';
import { useConnectionHealth } from '@/hooks/use-connection-health';
import { ConnectionBanner } from '@/components/connection-banner';
import type { RealtimeStatus } from '@/lib/connection-health';
import { logError } from '@/lib/log-error';

// Define types for props
type Session = Database['public']['Tables']['sessions']['Row'];
type Game = Database['public']['Tables']['games']['Row'];
type GameState = Database['public']['Tables']['game_states_public']['Row'];
type SnowballPot = Database['public']['Tables']['snowball_pots']['Row'];

interface DisplayUIProps {
  session: Session;
  activeGame: Game | null;
  initialGameState: GameState | null;
  initialPrizeText: string;
  isWaitingState: boolean;
  playerJoinUrl: string;
}

const formatStageLabel = (stage: string | undefined) => {
  if (!stage) return '-';

  return stage
    .replace(/[_-]+/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
};

// Explicit narrow column lists keep public surfaces from leaking unintended
// fields and document exactly what the UI consumes from each table.
const SESSION_SELECT = 'id, name, status, active_game_id';
const GAME_SELECT =
  'id, session_id, game_index, name, type, stage_sequence, background_colour, prizes, snowball_pot_id';
const GAME_STATE_PUBLIC_SELECT =
  'game_id, called_numbers, numbers_called_count, current_stage_index, status, call_delay_seconds, on_break, paused_for_validation, display_win_type, display_win_text, display_winner_name, started_at, ended_at, last_call_at, updated_at, state_version';

const POLL_INTERVAL_MS = 3000;

export default function DisplayUI({
  session,
  activeGame: initialActiveGame,
  initialGameState: initialActiveGameState,
  initialPrizeText,
  isWaitingState: initialWaitingState,
  playerJoinUrl,
}: DisplayUIProps) {
  const supabase = useRef(createClient());

  const [currentSession, setCurrentSession] = useState<Session>(session);
  const [currentActiveGame, setCurrentActiveGame] = useState<Game | null>(initialActiveGame);
  const [currentGameState, setCurrentGameState] = useState<GameState | null>(initialActiveGameState);
  // Derived from currentActiveGame + currentGameState. currentGameState is
  // freshness-gated by isFreshGameState in every setter path, so the prize
  // text inherits that gating and cannot drift to a stale stage.
  const currentPrizeText = useMemo<string>(() => {
    if (!currentActiveGame || !currentGameState) return initialPrizeText;
    const stageKey = currentActiveGame.stage_sequence[currentGameState.current_stage_index];
    return currentActiveGame.prizes?.[stageKey as keyof typeof currentActiveGame.prizes] || '';
  }, [currentActiveGame, currentGameState, initialPrizeText]);
  const [isWaitingState, setIsWaitingState] = useState<boolean>(initialWaitingState);
  const [currentNumberDelayed, setCurrentNumberDelayed] = useState<number | null>(null);
  const [delayedNumbers, setDelayedNumbers] = useState<number[]>([]);
  const [currentSnowballPot, setCurrentSnowballPot] = useState<SnowballPot | null>(null);
  // Tracks whether we have applied any usable game state (initial render or
  // first poll/realtime payload). Used to gate the "Connecting to game…" skeleton.
  const [hasLoaded, setHasLoaded] = useState<boolean>(initialActiveGameState != null);

  const numberCallTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Connection health: drives the reconnecting banner + auto-refresh.
  const health = useConnectionHealth();
  const { markPollSuccess, markPollFailure, markRealtimeStatus } = health;

  // Polling guards: monotonic sequence + in-flight flag prevent stale poll
  // results from clobbering newer state when responses arrive out-of-order.
  const pollSeqRef = useRef(0);
  const pollInFlightRef = useRef(false);
  // refreshActiveGame request-order guard: if active_game_id flips A→B and
  // A's fetch resolves last, the wrong game would win.
  const refreshSeqRef = useRef(0);

  // Stable refs for fields that the polling effect reads but should not retrigger
  // its setup. Pairs with the `currentActiveGame?.id` dependency below.
  const currentActiveGameRef = useRef(currentActiveGame);
  useEffect(() => {
    currentActiveGameRef.current = currentActiveGame;
  }, [currentActiveGame]);

  const refreshActiveGame = useCallback(async (newActiveGameId: string | null) => {
      if (newActiveGameId === currentActiveGame?.id) return;
      const seq = ++refreshSeqRef.current;

      if (newActiveGameId) {
          const { data: newGame } = await supabase.current
          .from('games')
          .select(GAME_SELECT)
          .eq('id', newActiveGameId)
          .single<Database['public']['Tables']['games']['Row']>();
          if (seq !== refreshSeqRef.current) return;

        if (newGame) {
          setCurrentActiveGame(newGame);
          const { data: newGameState } = await supabase.current
            .from('game_states_public')
            .select(GAME_STATE_PUBLIC_SELECT)
            .eq('game_id', newGame.id)
            .single<Database['public']['Tables']['game_states_public']['Row']>();
          if (seq !== refreshSeqRef.current) return;

          if (newGameState) {
            setCurrentGameState(newGameState);
            setHasLoaded(true);
          } else {
            setCurrentGameState(null);
          }
        } else {
          setCurrentActiveGame(null);
          setCurrentGameState(null);
        }
      } else {
        setCurrentActiveGame(null);
        setCurrentGameState(null);
      }
      setIsWaitingState(!newActiveGameId);
  }, [currentActiveGame?.id]);

  // Session-level realtime: track changes to active_game_id / status.
  useEffect(() => {
    const supabaseClient = supabase.current;

    const sessionChannel = supabaseClient
      .channel(`session_updates:${session.id}`)
      .on<Session>(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'sessions', filter: `id=eq.${session.id}` },
        async (payload) => {
          setCurrentSession(payload.new);
          await refreshActiveGame(payload.new.active_game_id);
        }
      )
      .subscribe();

    return () => {
      supabaseClient.removeChannel(sessionChannel);
    };
  }, [session.id, refreshActiveGame]);

  // Game state realtime with exponential-backoff auto-reconnect.
  // Each reconnect tears down the previous channel before creating the next
  // (ordering matters — Supabase rejects subscribe() against a torn channel).
  useEffect(() => {
    const supabaseClient = supabase.current;
    const activeGameId = currentActiveGame?.id;
    if (!activeGameId) return;

    let isMounted = true;
    let activeChannel: ReturnType<typeof supabaseClient.channel> | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let attemptCount = 0;

    const connect = async () => {
      if (!isMounted) return;
      if (activeChannel) {
        await supabaseClient.removeChannel(activeChannel);
        activeChannel = null;
      }
      if (!isMounted) return;

      const channel = supabaseClient
        .channel(`game_state_public_updates:${activeGameId}:${Date.now()}`)
        .on<GameState>(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'game_states_public', filter: `game_id=eq.${activeGameId}` },
          (payload) => {
            if (!isMounted) return;
            // Drop payloads for a different game (active-game switch race).
            const incoming = payload.new as GameState | undefined;
            const activeId = currentActiveGameRef.current?.id;
            if (!incoming || (activeId && incoming.game_id !== activeId)) return;
            // Freshness gate: ignore older snapshots that may arrive after a
            // reconnect or out-of-order broadcast (state_version is monotonic).
            // currentPrizeText is derived from currentGameState via useMemo,
            // so it inherits this gating automatically.
            setCurrentGameState((current) => (isFreshGameState(current, incoming) ? incoming : current));
            setHasLoaded(true);
          }
        )
        .subscribe((status) => {

[truncated at line 200 — original has 770 lines]
```

### `src/app/host/[sessionId]/[gameId]/game-control.tsx`

```
"use client";

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Database, UserRole } from '@/types/database';
import { createClient } from '@/utils/supabase/client';
import { callNextNumber, toggleBreak, validateClaim, recordWinner, skipStage, voidLastNumber, pauseForValidation, resumeGame, announceWin, toggleWinnerPrizeGiven, takeControl, sendHeartbeat, moveToNextGameOnBreak, moveToNextGameAfterWin, advanceToNextStage } from '@/app/host/actions';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Modal } from '@/components/ui/modal';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { BingoBall } from '@/components/ui/bingo-ball';
import { useWakeLock } from '@/hooks/wake-lock';
import { useConnectionHealth } from '@/hooks/use-connection-health';
import { ConnectionBanner } from '@/components/connection-banner';
import { formatPounds, getSnowballCallsLabel, getSnowballCallsRemaining, isSnowballJackpotEligible } from '@/lib/snowball';
import { isFreshGameState } from '@/lib/game-state-version';
import { getRequiredSelectionCountForStage } from '@/lib/win-stages';
import { logError } from '@/lib/log-error';
import { PreGameBriefing } from '@/components/host/pre-game-briefing';

type Game = Database['public']['Tables']['games']['Row'];
type GameState = Database['public']['Tables']['game_states']['Row'];
type SnowballPot = Database['public']['Tables']['snowball_pots']['Row'];
type Winner = Database['public']['Tables']['winners']['Row'];
type SessionWinner = Winner & {
    game: Pick<Game, 'id' | 'name' | 'game_index'> | null;
};

interface GameControlProps {
    sessionId: string;
    gameId: string;
    game: Game;
    initialGameState: GameState;
    currentUserId: string;
    currentUserRole: UserRole;
    isFirstGameOfSession: boolean;
}

// Hardcoded for now (same as before)
const NUMBER_NICKNAMES: { [key: number]: string } = {
    1: "Kelly's Eye",
    2: "One Little Duck",
    3: "Debbie McGee",
    4: "Knock at the Door",
    5: "Man Alive",
    6: "Half Dozen",
    7: "Lucky For Some",
    8: "Garden Gate",
    9: "Doctor's Orders",
    10: "Starmers Den",
    11: "Legs Eleven",
    12: "One Dozen",
    13: "Unlucky For Some",
    14: "Valentines Day",
    15: "Young And Keen",
    16: "Sweet Sixteen",
    17: "Dancing Queen",
    20: "Blind Twenty",
    22: "Two Little Ducks",
    25: "Duck And Dive",
    26: "Pick And Mix",
    27: "Gateway To Heaven",
    28: "In A State",
    29: "Rise And Shine",
    30: "Dirty Gertie",
    31: "Get Up And Run",
    32: "Buckle My Shoe",
    33: "All The Threes",
    34: "Ask For More",
    36: "Three Dozen",
    40: "Naughty Forty",
    42: "Winnie The Pooh",
    44: "Droopy Drawers",
    45: "Halfway There",
    46: "Up To Tricks",
    47: "Four And Seven",
    48: "Four Dozen",
    51: "Tweak Of The Thumb",
    52: "Danny La Rue",
    53: "Stuck In The Tree",
    54: "Clean The Floor",
    55: "All The Fives",
    57: "Heinz Varieties",
    58: "Make Them Wait",
    59: "Brighton Line",
    61: "Bakers Bun",
    62: "Tickety Boo",
    63: "Tickle Me",
    66: "Clickety Click",
    67: "Made In Heaven",
    69: "Any Way Up",
    73: "Queen B",
    77: "All The Sevens",
    81: "Stop And Run",
    83: "Time For Tea",
    85: "Staying Alive",
    88: "Two Fat Ladies",
    90: "Top Of The Shop"
};

export default function GameControl({ sessionId, gameId, game, initialGameState, currentUserId, currentUserRole, isFirstGameOfSession }: GameControlProps) {
    const router = useRouter();
    const [currentGameState, setCurrentGameState] = useState<GameState>(initialGameState);
    const [currentSnowballPot, setCurrentSnowballPot] = useState<SnowballPot | null>(null);
    const [isCallingNumber, setIsCallingNumber] = useState(false);
    const [actionError, setActionError] = useState<string | null>(null);
    const [showValidationModal, setShowValidationModal] = useState(false);
    const [selectedNumbers, setSelectedNumbers] = useState<number[]>([]);
    const [validationResult, setValidationResult] = useState<{ valid: boolean; invalidNumbers?: number[] } | null>(null);
    const [showWinnerModal, setShowWinnerModal] = useState(false);
    const [showManualSnowballModal, setShowManualSnowballModal] = useState(false);
    const [showPostWinModal, setShowPostWinModal] = useState(false);
    const [showSessionWinnersModal, setShowSessionWinnersModal] = useState(false);
    const [showCashJackpotModal, setShowCashJackpotModal] = useState(false);
    const [cashJackpotAmount, setCashJackpotAmount] = useState('');
    const [cashJackpotGameName, setCashJackpotGameName] = useState('Jackpot Game');
    const [cashJackpotMode, setCashJackpotMode] = useState<'next' | 'break'>('next');
    const [isSubmittingCashJackpot, setIsSubmittingCashJackpot] = useState(false);
    const [prizeGiven, setPrizeGiven] = useState(false);
    const [snowballEligible, setSnowballEligible] = useState(false);
    const [isRecordingWinner, setIsRecordingWinner] = useState(false);
    const [isRecordingSnowballWinner, setIsRecordingSnowballWinner] = useState(false);
    const [currentWinners, setCurrentWinners] = useState<Winner[]>([]);
    const [sessionWinners, setSessionWinners] = useState<SessionWinner[]>([]);

    // Singleton Supabase client — all subscriptions share one WebSocket connection
    const supabaseRef = useRef(createClient());

    // Connection health: drives the reconnecting banner + auto-refresh.
    const health = useConnectionHealth();

    // Polling guards: monotonic sequence + in-flight flag prevent stale poll
    // results from clobbering newer state when responses arrive out-of-order.
    const pollSeqRef = useRef(0);
    const pollInFlightRef = useRef(false);

  useWakeLock();

    // Controller Locking Logic
    const isController = currentGameState.controlling_host_id === currentUserId;
    const canTogglePrize = isController && (currentUserRole === 'admin' || currentUserRole === 'host');
    // Allow taking control if no one is controlling OR the last heartbeat was > 30s ago
    const canTakeControl = !currentGameState.controlling_host_id ||
        (currentGameState.controller_last_seen_at && (new Date().getTime() - new Date(currentGameState.controller_last_seen_at).getTime() > 30000));

    useEffect(() => {
        let interval: NodeJS.Timeout;
        if (isController) {
            interval = setInterval(async () => {
                await sendHeartbeat(gameId);
            }, 10000); // Send heartbeat every 10s
        }
        return () => clearInterval(interval);
    }, [isController, gameId]);

    const handleTakeControl = async () => {
        setActionError(null);
        const result = await takeControl(gameId);
        if (!result?.success) {
            setActionError(result?.error || "Failed to take control.");
        }
    };

    const getPlannedPrize = useCallback((stageIndex: number) => {
        const stage = game.stage_sequence[stageIndex];
        return game.prizes?.[stage as keyof typeof game.prizes] || '';
    }, [game]);

    const [prizeDescription, setPrizeDescription] = useState(getPlannedPrize(initialGameState.current_stage_index));

    // Winners Subscription
    useEffect(() => {
        const supabase = supabaseRef.current;
        const fetchWinners = async () => {
            const { data } = await supabase.from('winners').select('*').eq('game_id', gameId).order('created_at', { ascending: false });
            if (data) setCurrentWinners(data);
        };

        fetchWinners();

        const channel = supabase
            .channel(`winners:${gameId}`)
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'winners', filter: `game_id=eq.${gameId}` },
                () => {
                    fetchWinners();
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [gameId]);

    // Session-wide winners subscription so prize status can be managed after moving to later games
    useEffect(() => {

[truncated at line 200 — original has 1347 lines]
```

### `src/app/host/[sessionId]/[gameId]/page.tsx`

```
import React from 'react';
import { createClient } from '@/utils/supabase/server';
import { redirect, notFound } from 'next/navigation';
import { signout } from '@/app/login/actions';
import GameControl from './game-control';
import { Database } from '@/types/database';
import { getCurrentGameState } from '@/app/host/actions';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { isUuid } from '@/lib/utils';
import Image from 'next/image';

interface PageProps {
  params: Promise<{ sessionId: string; gameId: string }>;
}

export default async function GameControlPage({ params }: PageProps) {
  const { sessionId, gameId } = await params;

  if (!isUuid(sessionId) || !isUuid(gameId)) {
    notFound();
  }

  const supabase = await createClient();
  
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single<{ role: Database['public']['Tables']['profiles']['Row']['role'] }>();

  // Fetch game details
  const { data: game, error: gameError } = await supabase
    .from('games')
    .select('*')
    .eq('id', gameId)
    .single<Database['public']['Tables']['games']['Row']>();

  if (gameError || !game) {
    console.error("Error fetching game details:", gameError);
    notFound();
  }

  // Fetch session details (needed for context, e.g., session name)
  const { data: session, error: sessionError } = await supabase
    .from('sessions')
    .select('name, status')
    .eq('id', sessionId)
    .single<Pick<Database['public']['Tables']['sessions']['Row'], 'name' | 'status'>>();

  if (sessionError || !session) {
    console.error("Error fetching session details:", sessionError);
    notFound();
  }

  // Fetch initial game state
  const gameStateResult = await getCurrentGameState(gameId);

  if (!gameStateResult.success || !gameStateResult.data) {
    console.warn(`Game ${gameId} in session ${sessionId} has no initial game state. Redirecting to host dashboard.`);
    redirect('/host');
  }

  // Determine whether this is the first game of the session — controls whether
  // the pre-game briefing surfaces the house rules block.
  const { data: firstGame } = await supabase
    .from('games')
    .select('game_index')
    .eq('session_id', sessionId)
    .order('game_index', { ascending: true })
    .limit(1)
    .single<{ game_index: number }>();

  const isFirstGameOfSession = !!firstGame && game.game_index === firstGame.game_index;

  return (
    <div className="min-h-screen-safe anchor-theme bg-[#003f27] text-white">
       <header className="p-3 bg-[#005131]/95 border-b border-[#1f7c58] flex justify-between items-center sticky top-0 z-20 shadow-md">
        <div className="flex items-center gap-3">
            <Link href="/host">
              <Button variant="secondary" size="sm" className="h-8 px-2 border-[#1f7c58] bg-[#0f6846] hover:bg-[#136f4b]">
                &larr;
              </Button>
            </Link>
            <div className="relative w-28 h-9">
              <Image src="/the-anchor-pub-logo-white-transparent.png" alt="The Anchor" fill className="object-contain object-left" />
            </div>
            <div className="leading-tight hidden sm:block">
              <h1 className="text-sm font-bold text-white">{session.name}</h1>
              <p className="text-xs text-white/80">{game.name}</p>
            </div>
        </div>
        <div className="flex items-center gap-3">
          <form action={signout}>
            <Button variant="ghost" size="sm" className="text-xs h-8 text-white hover:bg-[#0f6846]">Sign Out</Button>
          </form>
        </div>
      </header>

      <GameControl
        sessionId={sessionId}
        gameId={gameId}
        game={game}
        initialGameState={gameStateResult.data}
        currentUserId={user.id}
        currentUserRole={profile?.role || 'host'}
        isFirstGameOfSession={isFirstGameOfSession}
      />
    </div>
  );
}
```

### `src/components/host/pre-game-briefing.tsx`

```
import React from 'react';
import { Database } from '@/types/database';
import { HOUSE_RULES } from '@/lib/house-rules';
import { getColourName } from '@/lib/colour-name';
import { formatPounds } from '@/lib/snowball';
import { cn } from '@/lib/utils';

type Game = Database['public']['Tables']['games']['Row'];
type SnowballPot = Database['public']['Tables']['snowball_pots']['Row'];

interface PreGameBriefingProps {
  game: Game;
  currentSnowballPot: SnowballPot | null;
  isFirstGameOfSession: boolean;
}

export function PreGameBriefing({
  game,
  currentSnowballPot,
  isFirstGameOfSession,
}: PreGameBriefingProps) {
  const colourName = getColourName(game.background_colour ?? '');
  const isSnowball = game.type === 'snowball';
  const stages = (game.stage_sequence ?? []) as string[];
  const prizes = (game.prizes ?? {}) as Record<string, string>;

  return (
    <div className="w-full text-left">
      {/* Header strip */}
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-[#1f7c58] pb-3 mb-4">
        <span className="text-2xl font-bold text-white">GAME {game.game_index}</span>
        <span className="text-sm font-semibold uppercase tracking-wider text-white/85">
          · {(game.type ?? 'standard').toUpperCase()}
        </span>
        <span className="ml-auto flex items-center gap-2 text-sm text-white/90">
          <span
            aria-hidden
            className="inline-block w-3 h-3 rounded-full border border-white/40"
            style={{ backgroundColor: game.background_colour ?? '#000000' }}
          />
          <span className="font-semibold">{colourName}</span>
          <span className="text-white/70">·</span>
          <span className="font-semibold">{game.name}</span>
        </span>
      </div>

      {/* Prize ladder */}
      <div className="mb-4">
        <p className="text-xs uppercase tracking-[0.18em] text-[#f3d59d] font-semibold mb-2">
          Tonight you can win
        </p>
        <ul className="space-y-1.5">
          {stages.map((stage, i) => {
            const prize = prizes[stage];
            return (
              <li
                key={stage}
                className="flex items-center justify-between bg-[#003f27]/70 border border-[#1f7c58] rounded-lg px-3 py-2"
              >
                <span className="text-sm font-bold text-white">
                  Stage {i + 1}: {stage}
                </span>
                <span
                  className={cn(
                    'text-sm font-semibold ml-3 text-right',
                    prize ? 'text-[#f3d59d]' : 'text-destructive'
                  )}
                >
                  {prize || '⚠️ Prize not set'}
                </span>
              </li>
            );
          })}
        </ul>
        {isSnowball && currentSnowballPot && (
          <p className="text-xs text-white/85 mt-2">
            Snowball jackpot: £{formatPounds(Number(currentSnowballPot.current_jackpot_amount))}
            {' '}(within first {currentSnowballPot.current_max_calls} calls).
          </p>
        )}
      </div>

      {/* House rules — first game only */}
      {isFirstGameOfSession && (
        <div className="border-t border-[#1f7c58] pt-3">
          <p className="text-xs uppercase tracking-[0.18em] text-[#f3d59d] font-semibold mb-2">
            House rules
          </p>
          <ul className="space-y-1.5">
            {HOUSE_RULES.map((rule, i) => (
              <li
                key={i}
                className={cn(
                  'flex gap-2 items-start text-xs leading-snug text-white/95',
                  rule.variant === 'closing' && 'pt-1'
                )}
              >
                <span aria-hidden className="text-white shrink-0">
                  {rule.icon}
                </span>
                <span className={cn(rule.variant === 'closing' && 'font-bold italic')}>
                  {rule.segments.map((seg, j) =>
                    seg.bold ? (
                      <span key={j} className="font-bold">{seg.text}</span>
                    ) : (
                      <React.Fragment key={j}>{seg.text}</React.Fragment>
                    )
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
```

### `src/lib/colour-name.test.ts`

```
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getColourName } from './colour-name';

test('returns canonical name for exact palette hex', () => {
  assert.equal(getColourName('#ffffff'), 'White');
  assert.equal(getColourName('#000000'), 'Black');
  assert.equal(getColourName('#16a34a'), 'Green');
  assert.equal(getColourName('#dc2626'), 'Red');
});

test('returns nearest palette name for off-palette hex', () => {
  assert.equal(getColourName('#22c55e'), 'Green');
  assert.equal(getColourName('#fbbf24'), 'Yellow');
});

test('accepts hex without leading hash', () => {
  assert.equal(getColourName('ffffff'), 'White');
});

test('returns "Unknown colour" for invalid input', () => {
  assert.equal(getColourName(''), 'Unknown colour');
  assert.equal(getColourName('not-a-colour'), 'Unknown colour');
  assert.equal(getColourName('#fff'), 'Unknown colour');
  assert.equal(getColourName('#gggggg'), 'Unknown colour');
});
```

### `src/lib/colour-name.ts`

```
const PALETTE: Record<string, string> = {
  White:  '#ffffff',
  Black:  '#000000',
  Grey:   '#808080',
  Red:    '#dc2626',
  Orange: '#ea580c',
  Yellow: '#facc15',
  Green:  '#16a34a',
  Teal:   '#0d9488',
  Blue:   '#2563eb',
  Purple: '#9333ea',
  Pink:   '#ec4899',
  Brown:  '#78350f',
};

const HEX_RE = /^#?([0-9a-fA-F]{6})$/;

function hexToRgb(hex: string): [number, number, number] | null {
  const m = HEX_RE.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Returns the nearest palette colour name for a given hex string.
 * Returns the literal `"Unknown colour"` for invalid input — never an empty
 * string. The host is colour-blind; the colour word is the accessibility primary.
 */
export function getColourName(hex: string): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return 'Unknown colour';
  let best = 'Unknown colour';
  let bestDist = Infinity;
  for (const [name, paletteHex] of Object.entries(PALETTE)) {
    const p = hexToRgb(paletteHex)!;
    const d =
      (rgb[0] - p[0]) ** 2 +
      (rgb[1] - p[1]) ** 2 +
      (rgb[2] - p[2]) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = name;
    }
  }
  return best;
}
```

### `src/lib/house-rules.ts`

```
export type Segment = { text: string; bold?: boolean };

export type Rule = {
  /** Display character — '➤' or '🎉'. */
  icon: string;
  /** Ordered text segments. Segments with bold:true wrap in <span className="font-bold">. */
  segments: Segment[];
  /**
   * Visual variant. `closing` applies the last-item styling on display:
   *   - `pt-1` on the <li>
   *   - `clamp()`-sized icon
   *   - `font-bold italic` on the text container
   */
  variant?: 'default' | 'closing';
};

/**
 * Single source of truth for the bingo House Rules shown on:
 *   - the public display (waiting / break / completed states)
 *   - the host pre-game briefing (first game of the session only)
 *
 * The shape preserves the existing display markup losslessly. Do not add or
 * remove rules without updating the screenshot baseline.
 */
export const HOUSE_RULES: ReadonlyArray<Rule> = [
  {
    icon: '➤',
    segments: [
      { text: 'Claims must be called on the number they’re won on - ' },
      { text: 'late claims invalid', bold: true },
    ],
  },
  {
    icon: '➤',
    segments: [{ text: 'Multiple claims share the prize' }],
  },
  {
    icon: '➤',
    segments: [
      { text: 'Snowball eligibility: Players must have been here for the last three games' },
    ],
  },
  {
    icon: '🎉',
    segments: [{ text: 'Enjoy the night and best of luck to everyone!' }],
    variant: 'closing',
  },
];
```

### `tasks/host-controller-tweaks/.implement/wave-1/colour-name/handoff.md`

```
# Wave 1 — colour-name handoff

## Outputs
- src/lib/colour-name.ts (new)
- src/lib/colour-name.test.ts (new)

## Verification
- Test command: `node --test --import tsx src/lib/colour-name.test.ts`
- Result: tests 4, pass 4, fail 0 (all 4 tests passing in 380.408125 ms)
- Typecheck: `npx tsc --noEmit` — pass (no new errors introduced for colour-name.ts/colour-name.test.ts)

## Assumptions
- The HEX_RE regex deliberately rejects 3-char shorthand (`#fff`) and any non-6-char hex. Consumer code should pass full `#rrggbb` or pre-normalise.

## Issues encountered
None.

## Notes for downstream
- Public API: `getColourName(hex: string): string`. Always returns a non-empty string.
- Import path: `@/lib/colour-name`.
```

### `tasks/host-controller-tweaks/.implement/wave-1/house-rules/handoff.md`

```
# Wave 1 — house-rules handoff

## Outputs
- src/lib/house-rules.ts (new)

## Verification
- Typecheck: `npx tsc --noEmit` — pass

## Public API
- Types: `Segment`, `Rule`
- Constant: `HOUSE_RULES: ReadonlyArray<Rule>` (4 items)
- Import path: `@/lib/house-rules`

## Notes for downstream
- The display refactor agent (Wave 2) must map over HOUSE_RULES and produce DOM byte-identical to the current inline JSX in `src/app/display/[sessionId]/display-ui.tsx:471-493`. Specifically:
  - Items with `variant !== 'closing'`: <li className="flex gap-4 items-start"> with icon span "text-white mt-1" and text span (no extra class).
  - Item with `variant === 'closing'`: <li className="flex gap-4 items-start pt-1"> with icon span "text-[clamp(1.7rem,2.3vw,2.4rem)]" and text span "font-bold italic".
  - Segments with `bold: true` wrap in <span className="font-bold">; segments without it render as text fragments inline.
- The host briefing agent (Wave 2) uses a smaller styling but the same iteration shape.

## Issues encountered
none
```

### `tasks/host-controller-tweaks/.implement/wave-2/briefing-component/handoff.md`

```
# Wave 2 — pre-game-briefing handoff

## Outputs
- src/components/host/pre-game-briefing.tsx (new file)

## Verification
- Typecheck: `npx tsc --noEmit` — pass (no output, exit 0; no new errors introduced).
- Lint: `npm run lint` — pass (zero warnings, zero errors).

## Public API
- Component: `PreGameBriefing` (named export)
- Props: `{ game: Game; currentSnowballPot: SnowballPot | null; isFirstGameOfSession: boolean }`
  - `Game` = `Database['public']['Tables']['games']['Row']`
  - `SnowballPot` = `Database['public']['Tables']['snowball_pots']['Row']`
- Import path: `@/components/host/pre-game-briefing`

## Notes for downstream (Wave 3)
- The component is pure presentation — no client APIs, no hooks, no state. No `'use client'` directive.
- Rendered in place of the "READY" disc when `currentGameState.numbers_called_count === 0`.
- Wave 3 must wrap it in `<div className="max-h-[55vh] overflow-y-auto pr-1">` so the briefing body scrolls inside its own container while primary controls stay pinned (per spec SD-3 hard target).
- Renders header strip (game index, type, colour swatch, colour name, game name), prize ladder (with destructive styling for missing prizes), optional snowball jackpot line, and house rules block (only when `isFirstGameOfSession === true`).
- Tailwind palette used: `#003f27`, `#1f7c58`, `#f3d59d`, plus `text-destructive` and `text-white/85|90|95|70|40`. No new tokens introduced.

## Dependencies confirmed
- `HOUSE_RULES` exported from `src/lib/house-rules.ts` (with `Rule` and `Segment` types, including `variant` and `icon`/`segments` shape).
- `getColourName(hex: string): string` exported from `src/lib/colour-name.ts`.
- `formatPounds(value: number): string` exported from `src/lib/snowball.ts`.
- `cn` exported from `src/lib/utils.ts` (existing).
- `Database` type from `src/types/database.ts` (existing generated types).

## Issues encountered
None. All prerequisite libs from Wave 1 (`house-rules.ts`, `colour-name.ts`) were present and exposed the expected exports.
```

### `tasks/host-controller-tweaks/.implement/wave-2/display-refactor/handoff.md`

```
# Wave 2 — display-refactor handoff

## Outputs
- src/app/display/[sessionId]/display-ui.tsx (modified — import + renderHouseRulesPanel body)

## Verification
- Typecheck: `npx tsc --noEmit` — pass (no output)
- Lint: `npm run lint` — pass (zero warnings, zero errors)
- Build: `npm run build` — pass (compiled successfully in 1463.0ms; static generation 12/12 OK; all 14 routes built)

## DOM-parity reasoning
The new `HOUSE_RULES.map(...)` iteration produces structurally identical DOM to the original inline JSX for all four rules:

- **Rules 1, 2, 3 (default variant, no `pt-1`, no `font-bold italic`):** `cn('flex gap-4 items-start', false)` resolves through `clsx` (which drops falsy values cleanly with no extra space) and `twMerge` (no-op when there are no conflicts) to exactly `"flex gap-4 items-start"` — identical to the original `<li className="flex gap-4 items-start">`. The icon span uses the ternary `'text-white mt-1'` (not `cn`), so it emits `<span className="text-white mt-1">➤</span>` byte-for-byte. The text-wrapper span uses `cn(false)`, which clsx returns as `""`, and React renders `className=""` as no class attribute or an empty one — matching the original which had no className on the wrapper span at all. (`<span>` and `<span className="">` produce equivalent rendered HTML for the purposes of this layout — no inherited or attribute-driven styling depends on the absence of the attribute.)
- **Rule 1 inner bold:** the bold segment renders as `<span className="font-bold">late claims invalid</span>`, preserving the original inline `<span className="font-bold">…</span>`. The non-bold preceding segment uses `<React.Fragment>` which emits no wrapper element, so the literal text `"Claims must be called on the number they're won on - "` (with the curly apostrophe `'` from the data file, matching the source `&apos;` rendering) sits as a sibling text node ahead of the bold span — identical to the original.
- **Rule 4 (closing variant):** `cn('flex gap-4 items-start', true && 'pt-1')` resolves to `"flex gap-4 items-start pt-1"`, matching the original `"flex gap-4 items-start pt-1"`. The icon span ternary picks `'text-[clamp(1.7rem,2.3vw,2.4rem)]'`, matching the original. The text-wrapper span gets `cn(true && 'font-bold italic')` → `"font-bold italic"`, matching the original. Inside, a single non-bold segment renders inside `<React.Fragment>` (no wrapper), preserving the original text-only content of the wrapper span.

The outer panel `<div>` and `<h3>House Rules</h3>` heading are untouched. The data file's curly apostrophe (`they're`) renders identically to the original `they&apos;re` JSX entity since both are the same Unicode codepoint U+2019.

## Issues encountered
None.

## Notes for verification
- Manual screenshot diff still required by the human reviewer: load `/display/[sessionId]` in waiting state, compare against a pre-refactor baseline. This agent cannot run the dev server or capture screenshots.
```

### `tasks/host-controller-tweaks/.implement/wave-3/host-wiring/handoff.md`

```
# Wave 3 — host-wiring handoff

## Outputs
- `src/app/host/[sessionId]/[gameId]/page.tsx` (modified — first-game query + `isFirstGameOfSession` prop pass-through)
- `src/app/host/[sessionId]/[gameId]/game-control.tsx` (modified — `PreGameBriefing` wiring, nickname-above-ball reorder, removed call-delay hint, spacing diet)

## Verification
- Typecheck: `npx tsc --noEmit` — pass (no output, exit 0)
- Lint: `npm run lint` — pass (no warnings)
- Tests: `npm test` — 36 tests, all pass (duration 190.76 ms)
- Build: `npm run build` — pass (Next.js 16.1.4 Turbopack, compiled in 1867.4 ms, 12/12 static pages generated)

## Spacing diet applied

| Location | Before | After |
|---|---|---|
| Outer wrapper | `p-4 pb-32 max-w-5xl ...` | `p-4 pb-24 max-w-5xl ...` |
| `<Card>` (main display) | `mb-6 overflow-hidden` | `mb-4 overflow-hidden` |
| `<CardContent>` | `p-8 flex flex-col items-center text-center` | `p-5 flex flex-col items-center text-center` |
| Nickname `<h2>` margin | `mb-4` | `mb-3` |
| Nickname animation | `slide-in-from-bottom-4` | `slide-in-from-top-4` |
| Ball wrapper margin | `mb-6` | `mb-3` |
| Ball size class | `w-40 h-40 text-7xl` | `w-32 h-32 text-6xl` |
| READY fallback disc | `w-40 h-40` | `w-32 h-32` |
| Stats row top padding | `pt-4` | `pt-3` |
| Control pad grid | `grid grid-cols-2 gap-4 mb-6` | `grid grid-cols-2 gap-3 mb-4` |
| Next Number button | `col-span-2 h-24 text-3xl ...` | `col-span-2 h-20 text-2xl ...` |

Take Break / Check Claim buttons unchanged (`h-16` retained).

## Behavioural changes
- `numbers_called_count === 0` → renders `<PreGameBriefing>` inside a `w-full max-h-[55vh] overflow-y-auto pr-1` scroll container, so the briefing scrolls without pushing primary controls below the fold.
- `numbers_called_count > 0` → nickname above ball, then ball, then stats row, then optional snowball strip. Nickname animation reverses direction (`slide-in-from-top-4`).
- "Players see this in Xs" passive call-delay hint removed.
- `isFirstGameOfSession` derived in `page.tsx` via `select game_index from games where session_id = ? order by game_index asc limit 1` and compared against the current game's `game_index`. Defensive default when the query fails: `false` (better to omit rules than show them on the wrong game).

## Issues encountered
None — every command returned a clean pass on first attempt.

## Notes for verification
- Manual screenshot checks remain pending (iPhone 14 Pro, three states: pre-game with rules, pre-game without rules, in-play).
- Searched the file and confirmed zero matches for: `Players see this`, `slide-in-from-bottom-4`, `w-40 h-40 text-7xl`, `pb-32`.
- Only the two owned files were modified; no test files, libs, or display surfaces touched.
- Route file edits triggered the changes-manifest hook — note for next session: `/session-setup partial` to refresh docs.
```

### `tasks/host-controller-tweaks/PLAN.md`

```
# Implementation Plan — Host Controller Tweaks

**Source spec:** [SPEC.md](SPEC.md) (revised 2026-05-06 after Codex adversarial review)
**Owner:** Claude
**Branch:** to be created — `feat/host-pre-game-briefing`
**Complexity score:** **3 (M)** — 6 files touched, no schema change, no auth/RLS change, one extra Supabase read.

---

## Strategy

Five waves. Within a wave, tasks have no shared state and can run in parallel. Between waves, the dependency is one-way: later waves consume earlier outputs.

```
Wave 1 (parallel)  : Foundation libs       → Wave 2 (parallel)
Wave 2 (parallel)  : Briefing component +
                     Display refactor      → Wave 3
Wave 3 (sequential): Host page + GameControl wiring + spacing diet
Wave 4 (sequential): Verification pipeline (lint → typecheck → test → build)
Wave 5 (sequential): Manual screenshot verification (iPhone 14 Pro states)
```

Atomic commit after each task that lands cleanly. No checkpoint-then-fix; each task either passes its local verification or gets reworked before commit.

---

## Wave 1 — Foundation libs (parallel, 2 tasks)

These are pure helpers with no project-internal dependencies. Build them first; the rest of the work imports from them.

### Task 1.1 — `src/lib/colour-name.ts`

**Files:**
- create `src/lib/colour-name.ts`
- create `src/lib/colour-name.test.ts`

**Implementation:**

```ts
// src/lib/colour-name.ts
const PALETTE: Record<string, string> = {
  White:  '#ffffff',
  Black:  '#000000',
  Grey:   '#808080',
  Red:    '#dc2626',
  Orange: '#ea580c',
  Yellow: '#facc15',
  Green:  '#16a34a',
  Teal:   '#0d9488',
  Blue:   '#2563eb',
  Purple: '#9333ea',
  Pink:   '#ec4899',
  Brown:  '#78350f',
};

const HEX_RE = /^#?([0-9a-fA-F]{6})$/;

function hexToRgb(hex: string): [number, number, number] | null {
  const m = HEX_RE.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Returns the nearest palette colour name for a given hex string.
 * Returns the literal `"Unknown colour"` for invalid input — never an empty
 * string. The host is colour-blind; the colour word is the accessibility primary.
 */
export function getColourName(hex: string): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return 'Unknown colour';
  let best = 'Unknown colour';
  let bestDist = Infinity;
  for (const [name, paletteHex] of Object.entries(PALETTE)) {
    const p = hexToRgb(paletteHex)!;
    const d =
      (rgb[0] - p[0]) ** 2 +
      (rgb[1] - p[1]) ** 2 +
      (rgb[2] - p[2]) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = name;
    }
  }
  return best;
}
```

```ts
// src/lib/colour-name.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getColourName } from './colour-name';

test('returns canonical name for exact palette hex', () => {
  assert.equal(getColourName('#ffffff'), 'White');
  assert.equal(getColourName('#000000'), 'Black');
  assert.equal(getColourName('#16a34a'), 'Green');
  assert.equal(getColourName('#dc2626'), 'Red');
});

test('returns nearest palette name for off-palette hex', () => {
  assert.equal(getColourName('#22c55e'), 'Green');  // close to #16a34a
  assert.equal(getColourName('#fbbf24'), 'Yellow'); // close to #facc15
});

test('accepts hex without leading hash', () => {
  assert.equal(getColourName('ffffff'), 'White');
});

test('returns "Unknown colour" for invalid input', () => {
  assert.equal(getColourName(''), 'Unknown colour');
  assert.equal(getColourName('not-a-colour'), 'Unknown colour');
  assert.equal(getColourName('#fff'), 'Unknown colour');     // 3-char shorthand not supported
  assert.equal(getColourName('#gggggg'), 'Unknown colour');
});
```

**Verification:** `npx tsx --test src/lib/colour-name.test.ts` (or `npm test`) — all 4 tests pass.

---

### Task 1.2 — `src/lib/house-rules.ts`

**Files:**
- create `src/lib/house-rules.ts`

**Implementation:**

```ts
// src/lib/house-rules.ts
export type Segment = { text: string; bold?: boolean };

export type Rule = {
  /** Display character — '➤' or '🎉'. */
  icon: string;
  /** Ordered text segments. Segments with bold:true wrap in <span className="font-bold">. */
  segments: Segment[];
  /**
   * Visual variant. `closing` applies the last-item styling on display:
   *   - `pt-1` on the <li>
   *   - `clamp()`-sized icon
   *   - `font-bold italic` on the text container
   */
  variant?: 'default' | 'closing';
};

/**
 * Single source of truth for the bingo House Rules shown on:
 *   - the public display (waiting / break / completed states)
 *   - the host pre-game briefing (first game of the session only)
 *
 * The shape preserves the existing display markup losslessly. Do not add or
 * remove rules without updating the screenshot baseline.
 */
export const HOUSE_RULES: ReadonlyArray<Rule> = [
  {
    icon: '➤',
    segments: [
      { text: "Claims must be called on the number they’re won on - " },
      { text: 'late claims invalid', bold: true },
    ],
  },
  {
    icon: '➤',
    segments: [{ text: 'Multiple claims share the prize' }],
  },
  {
    icon: '➤',
    segments: [
      { text: 'Snowball eligibility: Players must have been here for the last three games' },
    ],
  },
  {
    icon: '🎉',
    segments: [{ text: 'Enjoy the night and best of luck to everyone!' }],
    variant: 'closing',
  },
];
```

**Verification:** None standalone — verified in Wave 2 when display + briefing consume it.

**Note:** the apostrophe in rule 1 (`they’re`) matches the display's `&apos;` rendering. Use the unicode escape to keep the source ASCII-safe.

---

## Wave 2 — Briefing component + Display refactor (parallel, 2 tasks)

These can land in either order; both depend on Wave 1 only.

### Task 2.1 — `src/app/display/[sessionId]/display-ui.tsx` (refactor only, no visual change)

**Files:**
- modify `src/app/display/[sessionId]/display-ui.tsx`

**Implementation:**

Replace the body of `renderHouseRulesPanel` ([display-ui.tsx:471-493](src/app/display/[sessionId]/display-ui.tsx:471)) with a `HOUSE_RULES.map(...)` that emits the **exact same DOM** as today.

[truncated at line 200 — original has 551 lines]
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
- Returns the literal string `"Unknown colour"` if the input is not a valid `#rrggbb` hex. The host (colour-blind) must always have a non-colour textual indicator — never a dot-only fallback.
- Tested in `src/lib/colour-name.test.ts` — happy path (`#ffffff` → `"White"`, `#16a34a` → `"Green"`) plus an invalid input case asserting `"Unknown colour"`.

**Prize ladder block:**
- Title: `TONIGHT YOU CAN WIN`.
- One row per entry in `game.stage_sequence`, in order:
  - Left: `Stage {n}: {stage label}` — `Line` / `Two Lines` / `Full House` rendered verbatim (no extra formatting helper needed; the values are already the display labels).
  - Right: prize text from `game.prizes[stage]`. If missing, render `⚠️ Prize not set` in the destructive colour (matches the host stats row's existing missing-prize style).
- Snowball game: under the ladder, a single line — `Snowball jackpot: £{current_jackpot_amount} (within first {current_max_calls} calls).` Only when `game.type === 'snowball'` and `currentSnowballPot` is loaded.

**House rules block:**
- Shown only when the briefing is for the first game of the session (`isFirstGameOfSession === true`). Games 2+ render the briefing without this block.
- Content lives in **`src/lib/house-rules.ts`** (new file) as a single exported constant `HOUSE_RULES`. The shape must preserve the existing display markup losslessly — including item 1's inline `<span className="font-bold">late claims invalid</span>` emphasis and the last item's special styling (`pt-1` on the `<li>`, `clamp()`-sized 🎉 icon, `font-bold italic` text):
  ```ts
  type Segment = { text: string; bold?: boolean };
  type Rule = {
    icon: string;                          // '➤' or '🎉'
    segments: Segment[];                   // ordered text segments; segments with bold:true wrap in <span className="font-bold">
    variant?: 'default' | 'closing';       // 'closing' applies the last-item styling (pt-1 li, larger icon, bold-italic text)
  };
  export const HOUSE_RULES: ReadonlyArray<Rule> = [...];
  ```
- Both the host briefing and the existing `renderHouseRulesPanel` in [display-ui.tsx:471-493](src/app/display/[sessionId]/display-ui.tsx:471) consume `HOUSE_RULES`. The display refactor is data-source-only: the existing `<ul>`/`<li>` markup, classes, and copy stay byte-identical; only the data source changes from inline JSX to mapping over `HOUSE_RULES`. **Verify with a before/after screenshot of `/display/[sessionId]` in the waiting state — block merge on any pixel-level diff in the rules panel.**
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

**Hard target:** primary controls (Next Number, Take Break, Check Claim) are visible above the fold in **every** state on iPhone 14 Pro Safari (390 × 664 viewport after URL bar) — including in-play, the briefing without rules (games 2+), and the briefing with rules (game 1). If the briefing body would push controls off-screen on the first-game state, the **briefing body scrolls inside its own container while the controls stay pinned**. Controls never scroll; the briefing may.

**Soft target:** in the in-play state (one or more numbers called), all of the bingo ball, nickname, stats row, and primary controls are visible without any scroll.

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

**Verification:** Take screenshots at iPhone 14 Pro / Safari for three states:
1. In-play, one number called — soft target met (everything visible, no scroll).
2. Briefing on game 2 (no rules) — hard target met (controls visible; briefing body fits or scrolls within its own container).
3. Briefing on game 1 (with rules) — hard target met (controls visible; briefing body scrolls within its own container if needed).

**Safety check on display:** None — these spacing classes are scoped to `game-control.tsx` and don't affect `/display` or `/player`. Display visual parity is verified separately under the rules-extraction screenshot gate.

---

## File-by-file impact

| File | Change |
|---|---|
| [src/app/host/[sessionId]/[gameId]/page.tsx](src/app/host/[sessionId]/[gameId]/page.tsx) | Add a query for the session's lowest `game_index`; pass `isFirstGameOfSession` to `GameControl`. |
| [src/app/host/[sessionId]/[gameId]/game-control.tsx](src/app/host/[sessionId]/[gameId]/game-control.tsx) | Accept `isFirstGameOfSession`. Render `<PreGameBriefing>` whenever `numbers_called_count === 0` (every game), passing `isFirstGameOfSession` so the briefing internally gates the rules sub-block. Reorder nickname above ball. Delete "Players see this" line. Apply spacing diet. Wrap briefing body in a scroll-on-overflow container so primary controls stay pinned. |
| (new) `src/components/host/pre-game-briefing.tsx` | New stateless component for the briefing (header + ladder + optional rules). Props: `game: Game`, `currentSnowballPot: SnowballPot \| null`, `isFirstGameOfSession: boolean`. Consumes `HOUSE_RULES` from the shared lib and renders the rules sub-block only when `isFirstGameOfSession` is true. |
| (new) `src/lib/house-rules.ts` | Single source of truth for the rule items. Exports `HOUSE_RULES: ReadonlyArray<Rule>` along with the `Segment` and `Rule` types defined in Change 3. |
| (new) `src/lib/colour-name.ts` | Exports `getColourName(hex)` — nearest-palette lookup against a 12-name curated list. Plus a `.test.ts` next to it. |
| [src/app/display/[sessionId]/display-ui.tsx](src/app/display/[sessionId]/display-ui.tsx) | Import `HOUSE_RULES` from the shared lib. Replace the inline rule `<li>` JSX with `HOUSE_RULES.map(rule => …)` while keeping the existing `<ul>` classes, `<li>` classes (including `pt-1` on `closing` variant), icon classes (including `clamp()` size on closing), and inline `<span className="font-bold">` for `bold` segments. Markup output must be byte-identical. Verify with screenshot diff. |


[truncated at line 200 — original has 236 lines]
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
AGENTS.md
CLAUDE.md
README.md
docs/superpowers/discovery/2026-04-29-bingoblast-types-data.md
docs/superpowers/integration/wave-1/T-A/handoff.md
docs/superpowers/integration/wave-1/T-C/handoff.md
docs/superpowers/plans/2026-04-29-bingoblast.md
docs/superpowers/plans/2026-04-30-live-event-reliability.md
docs/superpowers/specs/2026-04-29-bingoblast-design.md
docs/superpowers/specs/2026-04-30-live-event-reliability-design.md
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

## Rule: `/Users/peterpitcher/Cursor/.claude/rules/testing.md`

```markdown
# Testing Conventions

## Framework

- **Vitest** is the default test runner (not Jest)
- Test files live alongside source: `src/**/*.test.ts` or in a dedicated `tests/` directory
- **Playwright** for end-to-end testing where configured

## Commands

```bash
npm test              # Run tests once
npm run test:watch    # Watch mode (Vitest)
npm run test:ci       # With coverage report
npx vitest run src/lib/some-module.test.ts  # Run a single test file
```

## Patterns

- Use `describe` blocks grouped by function/component
- Test naming: `it('should [expected behaviour] when [condition]')`
- Prefer testing behaviour over implementation details
- Mock external services (Supabase, OpenAI, Twilio) — never hit real APIs in tests
- Use factories or fixtures for test data, not inline object literals

## Test Prioritisation

When adding tests to a feature, prioritise in this order:
1. **Server actions and business logic** — highest value, most likely to catch real bugs
2. **Data transformation utilities** — date formatting, snake_case conversion, parsers
3. **API route handlers** — input validation, error responses, auth checks
4. **Complex UI interactions** — forms, multi-step flows, conditional rendering
5. **Simple UI wrappers** — lowest priority, skip if time-constrained

Minimum per feature: happy path + at least 1 error/edge case.

## Mock Strategy

- **Always mock**: Supabase client, OpenAI/Azure OpenAI, Twilio, Stripe, PayPal, Microsoft Graph, external HTTP
- **Never mock**: Internal utility functions, date formatting, type conversion helpers
- **Use `vi.mock()`** for module-level mocks; `vi.spyOn()` for targeted function mocks
- Reset mocks between tests: `beforeEach(() => { vi.clearAllMocks() })`

## Coverage

- Business logic and server actions: target 90%
- API routes and data layers: target 80%
- UI components: target 70% (focus on interactive behaviour, not rendering)
- Don't chase coverage on trivial wrappers, type definitions, or config files

## Playwright (E2E)

- Local dev: uses native browser
- Production/CI: uses `BROWSERLESS_URL` env var for remote browser
- E2E tests should be independent (no shared state between tests)
- Use page object models for complex flows
```

## Rule: `/Users/peterpitcher/Cursor/.claude/rules/ui-patterns.md`

```markdown
# UI Patterns & Component Standards

## Server vs Client Components

- Default to **Server Components** — only add `'use client'` when you need interactivity, hooks, or browser APIs
- Server Components can fetch data directly (no useEffect/useState for data loading)
- Client Components should receive data as props from server parents where possible

## Data Fetching & Display

Every data-driven UI must handle all three states:
1. **Loading** — skeleton loaders or spinners (not blank screens)
2. **Error** — user-facing error message or error boundary
3. **Empty** — meaningful empty state component (not just no content)

## Forms

- Use React Hook Form + Zod for validation where configured
- Validation errors displayed inline, not just console logs
- Required field indicators visible
- Loading/disabled state during submission (prevent double-submit)
- Server action errors surfaced to user via toast or inline message
- Form reset after successful submission where appropriate

## Buttons

Check every button for:
- Consistent variant usage (primary, secondary, destructive, ghost) — no ad-hoc Tailwind-only buttons
- Loading states on async actions (spinner/disabled during server action calls)
- Disabled states when form is invalid or submission in progress
- `type="button"` to prevent accidental form submission (use `type="submit"` only on submit buttons)
- Confirmation dialogs on destructive actions (delete, archive, bulk operations)
- `aria-label` on icon-only buttons

## Navigation

- Breadcrumbs on nested pages
- Active state on current nav item
- Back/cancel navigation returns to correct parent page
- New sections added to project navigation with correct permission gating
- Mobile responsiveness of all nav elements

## Permissions (RBAC)

- Every authenticated page must check permissions via the project's permission helper
- UI elements (edit, delete, create buttons) conditionally rendered based on permissions
- Server actions must re-check permissions server-side (never rely on UI hiding alone)

## Accessibility Baseline

These items are also enforced in the Definition of Done (`definition-of-done.md`):

- Interactive elements have visible focus styles
- Colour is not the only indicator of state
- Modal dialogs trap focus and close on Escape
- Tables use proper `<thead>`, `<th scope>` markup
- Images have meaningful `alt` text
- Keyboard navigation works for all interactive elements
```

---

_End of pack._
