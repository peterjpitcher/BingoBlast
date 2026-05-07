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

1. Add `import { HOUSE_RULES, type Rule } from '@/lib/house-rules';` near the top.
2. Replace the inline `<li>` JSX with:
   ```tsx
   <ul className={houseRulesListClass}>
     {HOUSE_RULES.map((rule, i) => (
       <li
         key={i}
         className={cn(
           'flex gap-4 items-start',
           rule.variant === 'closing' && 'pt-1'
         )}
       >
         <span
           className={
             rule.variant === 'closing'
               ? 'text-[clamp(1.7rem,2.3vw,2.4rem)]'
               : 'text-white mt-1'
           }
         >
           {rule.icon}
         </span>
         <span
           className={cn(
             rule.variant === 'closing' && 'font-bold italic'
           )}
         >
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
   ```
3. Confirm `React` is imported (it is — top of the file).
4. Do not touch any surrounding JSX, classes, or copy.

**Verification:**
- Build passes: `npm run build`.
- Manual screenshot diff: load `/display/[sessionId]` in a waiting state (no game in progress) before vs after this task, compare. Pixel-identical in the rules panel — block merge if not.

---

### Task 2.2 — `src/components/host/pre-game-briefing.tsx`

**Files:**
- create `src/components/host/pre-game-briefing.tsx`

**Implementation skeleton (final styling tuned in Wave 3):**

```tsx
// src/components/host/pre-game-briefing.tsx
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
  const stages = game.stage_sequence as string[];
  const prizes = (game.prizes ?? {}) as Record<string, string>;

  return (
    <div className="w-full">
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

**Verification:**
- `npm run build` passes.
- Component is unused at this point — that's fine; Wave 3 wires it in.

---

## Wave 3 — Host wiring, nickname reorder, "Players see this" removal, spacing diet (sequential, 1 task)

This is the largest task because all four host-side changes co-exist in `game-control.tsx` and depend on each other for layout. Done in one logical pass to avoid intermediate broken states.

### Task 3.1 — Host page + GameControl

**Files:**
- modify `src/app/host/[sessionId]/[gameId]/page.tsx`
- modify `src/app/host/[sessionId]/[gameId]/game-control.tsx`

**Sub-step A — page.tsx: derive `isFirstGameOfSession`.**

After the existing game/session/state fetches, add:

```ts
const { data: firstGame } = await supabase
  .from('games')
  .select('game_index')
  .eq('session_id', sessionId)
  .order('game_index', { ascending: true })
  .limit(1)
  .single<{ game_index: number }>();

const isFirstGameOfSession = !!firstGame && game.game_index === firstGame.game_index;
```

Pass `isFirstGameOfSession={isFirstGameOfSession}` to `<GameControl …>`. Defensive default: if the query fails, treat as `false` (better to omit rules than to show them on the wrong game).

**Sub-step B — game-control.tsx: accept the new prop.**

Add `isFirstGameOfSession: boolean` to `GameControlProps`. Destructure in the function signature.

**Sub-step C — Delete "Players see this in Xs" (Change 1).**

Remove [game-control.tsx:801-805](src/app/host/[sessionId]/[gameId]/game-control.tsx:801) — the entire `{currentGameState.last_call_at && ( <p ... /> )}` block.

**Sub-step D — Reorder nickname above ball (Change 2).**

Move the `{currentNickname && (<h2>...)}` block to render **above** the `<div className="mb-6 relative">{currentNumber ? <BingoBall /> : <READY-disc />}</div>` block. Update the nickname's animation utility from `slide-in-from-bottom-4` to `slide-in-from-top-4`.

**Sub-step E — Render briefing instead of READY disc (Change 3).**

Where the READY placeholder currently renders, conditionally render `<PreGameBriefing>` instead when `currentGameState.numbers_called_count === 0`. Concretely, replace the inner of the main display card with:

```tsx
{currentGameState.numbers_called_count === 0 ? (
  <PreGameBriefing
    game={game}
    currentSnowballPot={currentSnowballPot}
    isFirstGameOfSession={isFirstGameOfSession}
  />
) : (
  <>
    {/* nickname above ball */}
    {currentNickname && (
      <h2 className="text-3xl font-bold text-white mb-3 animate-in fade-in slide-in-from-top-4">
        {currentNickname}
      </h2>
    )}
    <div className="mb-3 relative">
      <BingoBall ... />
    </div>
    {/* stats row */}
    <div className="flex items-center gap-6 ...">...</div>
    {/* snowball strip if applicable */}
    {isSnowballGame && (...)}
  </>
)}
```

Add `import { PreGameBriefing } from '@/components/host/pre-game-briefing';` to the import block.

**Note on the briefing scroll container (SD-3 hard-target compliance):** the main display card currently has no max-height. To honour "primary controls always visible above the fold even on game 1 with rules", wrap the briefing body in a constrained-height scrollable region:

```tsx
<div className="max-h-[55vh] overflow-y-auto pr-1">
  <PreGameBriefing ... />
</div>
```

55vh on a 14 Pro (~664 px) ≈ 365 px, leaving room for page header (~50 px), card padding (~40 px), and the 156 px control stack — controls remain pinned. The pinned controls are already below the card in the existing layout, so no further restructure is needed.

**Sub-step F — Apply spacing diet (Change 4).**

Apply the diet from the SPEC table:
- Main card padding `p-8` → `p-5`
- Ball wrapper `mb-6` → `mb-3` (already done in sub-step E)
- Ball size `w-40 h-40 text-7xl` → `w-32 h-32 text-6xl`
- Nickname `mb-4` → `mb-3` (already done in sub-step E)
- Stats row `pt-4` → `pt-3`
- Card outer `mb-6` → `mb-4`
- Control grid `gap-4` → `gap-3` and `mb-6` → `mb-4`
- Next Number button `h-24 text-3xl` → `h-20 text-2xl`
- Page wrapper `pb-32` → `pb-24`

Take Break / Check Claim stay at `h-16`.

**Verification:**
- `npm run lint` — zero warnings.
- `npx tsc --noEmit` — clean.
- `npm test` — all tests pass.
- `npm run build` — clean production build.
- Manual: open `/host/[sessionId]/[gameId]` in dev for a fresh game-1 session (no calls). Briefing renders with rules, controls visible. Open game 2 (no calls): briefing without rules. Call a number: briefing disappears, nickname renders above ball.

---

## Wave 4 — Verification pipeline (sequential)

### Task 4.1 — Run the full pre-push pipeline

**Commands (stop at first failure):**
```bash
npm run lint
npx tsc --noEmit
npm test
npm run build
```

**Expected:** all four green. If any fail, fix in place before proceeding.

---

## Wave 5 — Manual screenshot verification (sequential, requires running dev server)

### Task 5.1 — iPhone 14 Pro Safari layout checks

Run `npm run dev` and use Chrome DevTools' iPhone 14 Pro preset (390 × 664 with the Safari mobile UA).

**Three states to capture:**
1. **In-play** (one number called): bingo ball, nickname above ball, stats row, Next Number, Take Break, Check Claim — all visible without scroll.
2. **Pre-game game 2** (zero calls, not first game): briefing (header + colour dot + colour word + game name + prize ladder) + controls — all visible. No rules block.
3. **Pre-game game 1** (zero calls, first game): full briefing including House Rules + controls. Controls always visible; briefing body may scroll inside its own container.

### Task 5.2 — Display visual parity

Open `/display/[sessionId]` in a waiting state. Compare against a baseline screenshot captured before Wave 2.1. Pixel-identical in the rules panel — block merge if not.

---

## Risk / contingency

| If… | Then… |
|---|---|
| `npm run lint` finds an issue I introduced | Fix and re-run; commit only when clean. |
| `tsc` finds a type error in the briefing or display refactor | Most likely cause: `game.background_colour` is `string \| null`; pass `?? ''` into `getColourName`. |
| The 14 Pro screenshot shows controls clipped on game 1 | Reduce briefing `max-h-[55vh]` to `max-h-[50vh]`; if still tight, drop ball size further (`w-28 h-28`). |
| Display screenshot diff shows a visible change | Inspect — the most likely cause is React Fragment vs span on bold-bridging segments. Adjust until pixel-identical. |
| First-game query fails (e.g. session deleted mid-session) | Defensive default: `isFirstGameOfSession = false` — skip the rules block. |

## Out of scope (deferred)

- Bigger phone screenshot tests (14 Pro Max) — defer to dev observation.
- Editing rule wording.
- Any change to `/player/[sessionId]`.
- Index migration for `games(session_id, game_index)` — only add if grep finds none.

---

## Atomic commit plan

Aim for one commit per task:

1. `feat(host): add getColourName helper with palette + tests` (Task 1.1)
2. `feat(host): add HOUSE_RULES shared constant` (Task 1.2)
3. `refactor(display): consume HOUSE_RULES from shared lib (no visual change)` (Task 2.1)
4. `feat(host): add PreGameBriefing component` (Task 2.2)
5. `feat(host): pre-game briefing, nickname above ball, drop call-delay hint, spacing diet` (Task 3.1) — bigger commit, touches two files; acceptable because the changes interact.

After the verification waves: no extra commits unless fixes are needed.
