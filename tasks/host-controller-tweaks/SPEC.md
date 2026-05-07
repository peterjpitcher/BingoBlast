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

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Extra Supabase read on every host page load to find min(game_index). | Single small read on a low-cardinality table (`games` rows per session ≈ a dozen); trivial at pub-bingo scale. During implementation, confirm a covering index on `games(session_id, game_index)` via `grep -in 'INDEX.*games' supabase/migrations/*.sql`; add one if missing. |
| Spacing diet feels too tight on bigger phones (Plus / Max). | Spacing values listed are proposed, not final. Implement, screenshot on 14 Pro and 14 Pro Max, adjust before merging. |
| Briefing re-appears on "Undo Last Call" back to 0. | By design — same behaviour as the public display. Gives the host a clean way to re-read the prizes (and on game 1, the rules) if needed. |
| Snowball calls window changes mid-game and the briefing copy goes stale. | Briefing is only shown when `numbers_called_count === 0`, before any window opens — copy can't go stale during play. |
| Display rules refactor accidentally changes the public TV. | Mandatory before/after screenshot of `/display/[sessionId]` waiting state; merge blocked on any pixel diff in the rules panel. The richer `Rule` shape (segments + variant) carries enough fidelity to preserve item 1's inline bold and item 4's special styling losslessly. |

## Decisions (locked in)

1. **Game type wording.** Header always shows `GAME N · {TYPE}`. `STANDARD`, `SNOWBALL`, or `JACKPOT`. Standard games are not hidden.
2. **Colour identification.** Small coloured dot **and** the colour name in words (e.g. `Green`) — for accessibility (host is colour-blind). Not a tinted card.
3. **Rules source of truth.** New `src/lib/house-rules.ts` constant; the public display also switches to consuming it (no visual change there). One place to edit if the rules ever shift.
4. **Briefing scope.** Briefing shown **before every game** when zero numbers have been called. Game 1 also includes the HOUSE RULES sub-block; games 2+ omit the rules but keep the header + colour + ladder. Briefing disappears as soon as the first number is called for that game.
5. **Spacing diet.** Proceed as proposed — ball 160 → 128 px, Next Number button 96 → 80 px, padding/margins trimmed per the table above. Will screenshot on iPhone 14 Pro and 14 Pro Max during implementation; bump the ball back to 144 if 128 looks too small.

---

## Acceptance criteria

- [ ] On the **first** game of a fresh session with `numbers_called_count === 0`, the host sees the full briefing (game header `GAME 1 · STANDARD` + colour dot + colour word + game name, prize ladder for every stage, House Rules) + Next Number + Take Break + Check Claim — all without scrolling on iPhone 14 Pro Safari.
- [ ] On games 2+ pre-game with `numbers_called_count === 0`, the host sees the briefing **without** the House Rules block (game header + colour dot + colour word + game name + prize ladder for every stage of that game) + Next Number + Take Break + Check Claim — all without scrolling.
- [ ] Once a number is called for any game, the briefing disappears; nickname renders above the ball; "Players see this in Xs" is gone; Take Break and Check Claim are visible above the fold.
- [ ] On every game, when there is a current number, the nickname renders **above** the ball; nothing renders in its place when the number has no nickname.
- [ ] Public display (`/display/[sessionId]`) waiting-state rules panel is **pixel-identical** before vs after the `HOUSE_RULES` extraction (verified by screenshot diff).
- [ ] Player follower (`/player/[sessionId]`) is unchanged.
- [ ] `getColourName` returns the expected name for the canonical hex of every palette entry, and the literal string `"Unknown colour"` for invalid input.
- [ ] No new TypeScript or ESLint warnings; existing tests still pass; new test added for `getColourName` covering happy path + `"Unknown colour"` fallback.

## Out of scope

- Editing the rules wording.
- Any change to call-delay behaviour, only its visibility.
- Any redesign of post-game / break / paused-for-validation states.
