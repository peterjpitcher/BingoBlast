# Claude Hand-Off Brief: Host Controller Tweaks

**Generated:** 2026-05-06
**Review mode:** C (Spec Compliance — adversarial)
**Overall risk:** Medium — one blocking contradiction, three medium spec defects; all fixable in-spec without design rework
**Source pack:** [2026-05-06-host-controller-tweaks-review-pack.md](2026-05-06-host-controller-tweaks-review-pack.md)
**Full review:** [2026-05-06-host-controller-tweaks-adversarial-review.md](2026-05-06-host-controller-tweaks-adversarial-review.md)

---

## DO NOT REWRITE

- Server-side `call_delay_seconds` enforcement — spec only removes the host hint, not the pacing.
- `min(game_index)` first-game detection — robust, keep as-is.
- `getColourName` as a pure helper at `src/lib/colour-name.ts` with colocated test.
- The trigger section ("renders whenever `numbers_called_count === 0`, every game; rules-only-on-first-game") — this is the correct, current intent.
- The Q4 decision to show the prize ladder before every game.

## SPEC REVISION REQUIRED

- [ ] **CR-1** — In the **File-by-file impact** table, change the `game-control.tsx` cell from *"Render briefing component when first-game + zero-calls"* to *"Render briefing component when `numbers_called_count === 0`. Pass `isFirstGameOfSession` so the rules sub-block conditionally renders."*
- [ ] **CR-2** — In the same table, the new `pre-game-briefing.tsx` row currently lists props as `game, currentSnowballPot`. Add `isFirstGameOfSession: boolean` (or `showHouseRules: boolean`) so the component can gate the rules sub-block. Pick one name and use it consistently in Change 3's prose.
- [ ] **SD-1** — In the "Colour-name resolution" section of Change 3, change the invalid-input behaviour from *"Returns an empty string … the briefing falls back to showing the dot only"* to *"Returns the literal string `Unknown colour` so the host always has a non-colour indicator (the host is colour-blind; the colour word is the accessibility primary)."* Update the planned test case accordingly.
- [ ] **SD-3** — In Change 4 (vertical spacing), add an explicit clause covering the first-game pre-game state. Recommended wording: *"Primary controls (Next Number, Take Break, Check Claim) must be visible above the fold in every state, including the first-game pre-game briefing. If the briefing body would push controls off-screen on iPhone 14 Pro, the briefing scrolls inside its own container; controls remain pinned."* This relaxes the verification from "everything fits" to "controls always fit" and is honest about what we can guarantee.
- [ ] **AI-1** — In the rules-extraction plan ("House rules block" subsection of Change 3, plus the `house-rules.ts` row in the impact table), pick one of:
  - **Option A — richer shape:** specify `type Segment = { text: string; bold?: boolean }` and `type Rule = { icon: string; segments: Segment[]; variant?: 'default' | 'closing' }`. Display and host both consume this. The current `display-ui.tsx` `renderHouseRulesPanel` keeps its existing markup/styling but reads from the data.
  - **Option B — keep inline:** drop the shared `house-rules.ts` plan entirely. Both `display-ui.tsx` and the new briefing component inline the rules JSX. Acceptable cost: future edits happen in two places.

  Recommend **Option A**. If picking A, also add an acceptance criterion: *"Visual diff (or screenshot comparison) of `/display/[sessionId]` before vs after the refactor shows zero pixel-level change in the rules panel."*
- [ ] **SD-2** — In the "Risks & Mitigations" table, delete the row about `formatStageLabel`. Replace with a one-liner under Change 3 prize-ladder block: *"`stage_sequence` values are user-facing labels by the schema default (`Line`, `Two Lines`, `Full House`); render verbatim, no helper."*
- [ ] **AI-2** — In the same risks table, soften *"Single indexed read on (session_id, game_index); effectively free"* to *"Single small read on a low-cardinality table; trivial at pub-bingo scale."* Or, if you want to lock the claim, add an index check: `grep -in 'INDEX.*games' supabase/migrations/*.sql` and update accordingly.

## IMPLEMENTATION CHANGES REQUIRED

(None — there is no implementation yet. These will become implementation requirements once the spec lands.)

## ASSUMPTIONS TO RESOLVE

- [ ] **UA-1** — Are all production `games.background_colour` values valid `#rrggbb`? If yes, SD-1's `Unknown colour` fallback is belt-and-braces but harmless. If no, it's load-bearing. (Action: spot-check during implementation; resolve anyway via SD-1.)
- [ ] **UA-2** — Will the rules refactor preserve the display panel byte-for-byte? (Action: capture before/after screenshot during implementation; gate merge on parity if Option A picked.)
- [ ] **UA-3** — Will the first-game briefing actually fit above the fold? (Action: implement, screenshot iPhone 14 Pro at zero calls on game 1; if it doesn't, fall back to the SD-3 scrolling container.)
- [ ] **UA-4** — Are real `stage_sequence` values exactly `Line` / `Two Lines` / `Full House`? (Action: spot-check during implementation; render verbatim either way.)
- [ ] **UA-5** — Is `games(session_id, game_index)` indexed? (Action: trivially confirmable with one grep — do during implementation.)

## REPO CONVENTIONS TO PRESERVE

- `src/lib/*.ts` shared helpers + colocated `*.test.ts` — `colour-name.ts` and `house-rules.ts` (or `.tsx` if Option A) follow this.
- Native Node.js test runner — no Jest/Vitest. New tests use `node --test --import tsx`.
- Snake_case DB columns, camelCase TS — no DB changes here, but the `background_colour` field stays snake_case in the type, mapped via existing `fromDb` helpers.
- Server components for SSR data fetch — the first-game query goes in `page.tsx` (server), passed as a prop. Don't fetch from `game-control.tsx`.
- No design tokens hardcoded as hex in components — the briefing must use the existing `#003f27`, `#005131`, `#1f7c58`, `#a57626` palette already used in `game-control.tsx`.
- The proxy matcher at `/admin/:path*`, `/host/:path*`, `/login` stays untouched.

## RE-REVIEW REQUIRED AFTER FIXES

- [ ] **CR-1, CR-2, SD-1, SD-3, AI-1** — once spec is updated, a quick re-read by Claude (no second Codex pass needed) to confirm the contradictions are gone and the contract is consistent.
- [ ] **AI-1 (Option A)** — once implementation lands, before merge: visual screenshot diff of `/display/[sessionId]` rules panel.
- [ ] **UA-3** — once implementation lands, before merge: iPhone 14 Pro screenshot at zero calls on game 1 confirming primary controls visible.

## REVISION PROMPT

Ready-to-use prompt for the next pass:

> Apply the seven spec edits in [tasks/codex-qa-review/2026-05-06-host-controller-tweaks-claude-handoff.md](tasks/codex-qa-review/2026-05-06-host-controller-tweaks-claude-handoff.md) to [tasks/host-controller-tweaks/SPEC.md](tasks/host-controller-tweaks/SPEC.md). Pick **Option A** for AI-1 (richer shape, screenshot parity gate). After applying, re-read the updated spec and confirm: (a) trigger condition and impact table agree, (b) `<PreGameBriefing>` props include the first-game flag, (c) `getColourName` invalid-input fallback is `"Unknown colour"`, (d) Change 4 has a controls-always-visible clause, (e) AI-1 row specifies the segment-and-variant shape with a parity-screenshot acceptance criterion. Then write the implementation plan.
