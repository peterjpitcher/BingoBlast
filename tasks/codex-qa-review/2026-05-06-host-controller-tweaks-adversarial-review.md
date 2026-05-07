# Adversarial Review: Host Controller Tweaks (SPEC)

**Date:** 2026-05-06
**Mode:** C — Spec Compliance (challenge the spec; no implementation yet)
**Scope:** [tasks/host-controller-tweaks/SPEC.md](../host-controller-tweaks/SPEC.md)
**Pack:** [2026-05-06-host-controller-tweaks-review-pack.md](2026-05-06-host-controller-tweaks-review-pack.md) (111 KB)
**Reviewers:** Assumption Breaker, Spec Trace Auditor, Integration & Architecture, Workflow & Failure-Path

---

## Executive Summary

The spec is broadly coherent and the architectural moves are sound — server-side call pacing stays put, shared helpers go to `src/lib/`, the first-game check is index-aware, and public display/player surfaces are explicitly out of scope. **One blocking contradiction** survives the recent Q4 flip ("every game" vs "first game"): the file-impact table still says briefing renders only on the first game, while the trigger section says every game. Fix that and the spec is implementation-ready, modulo three medium concerns around display visual parity, briefing-state vertical fit, and the colour-name fallback.

## What Appears Solid (preserve as-is)

- **Call-pacing stays server-side.** Spec only removes the host-facing "Players see this in Xs" hint; `call_delay_seconds` continues to drive the public display delay. Matches the `Don't drop the server-side number-call gap` rule. (AB / SPEC / WF agree.)
- **First-game detection is index-aware.** Using `min(game_index)` instead of hard-coding `=== 1` is robust to renumbering. (AB-confirmed.)
- **Pure shared helpers with colocated tests.** `getColourName` as `src/lib/colour-name.ts` with a `.test.ts` next to it follows the existing pattern (`game-state-version.test.ts`, `prize-validation.test.ts`, etc.). (AB / ARCH agree.)
- **Server-component data loading boundary.** Adding the first-game query to `page.tsx` keeps the SSR auth/loading boundary clean — no client-side data fetch. (ARCH-confirmed.)
- **Undo-Last-Call re-shows briefing.** Recoverable pre-game readout via existing state, no new state machine. (WF-confirmed.)
- **No new attack surface.** No RLS, server-action, middleware, or schema changes. Public route auth bypass remains intact. (All reviewers confirm in `empty_categories`.)

---

## Critical Risks (blocking)

### CR-1 — Spec contradicts itself on briefing trigger (AB-001 / SPEC-001)
**Severity:** High • **Confidence:** High • **Blocking**
**Location:** [SPEC.md "File-by-file impact" row](../host-controller-tweaks/SPEC.md) — `game-control.tsx` cell currently reads "Render briefing component when first-game + zero-calls"

The trigger section (Change 3) says: briefing renders whenever `numbers_called_count === 0`, on every game; the **HOUSE RULES sub-block** is the only first-game-only piece. The file-impact table still says the whole briefing is first-game-only. Two reviewers independently flagged this — an implementer copying from the impact row would omit the prize ladder on games 2+, breaking the load-bearing "I can read out what we're playing for" requirement.

**Fix:** rewrite the impact-table cell to read: *"Render briefing component when `numbers_called_count === 0`. Pass `isFirstGameOfSession` so the rules sub-block conditionally renders."*

### CR-2 — `<PreGameBriefing>` prop contract drops the rules-gate (WF-001)
**Severity:** Medium-High (lifts to High because it intersects CR-1) • **Confidence:** High • **Blocking**
**Location:** [SPEC.md impact table — pre-game-briefing.tsx row](../host-controller-tweaks/SPEC.md) — props listed as `game` and `currentSnowballPot`.

The component as specified can't decide whether to render the rules block — `isFirstGameOfSession` is fetched in `page.tsx` but never reaches the component. Implementer either shows rules on every game or hides them on every game.

**Fix:** add `isFirstGameOfSession: boolean` (or `showHouseRules: boolean`) to the briefing component props, **or** split the rules into a separate `<HouseRulesPanel />` rendered by `GameControl` directly. Spec needs to pick one.

---

## Spec Defects

### SD-1 — `getColourName` empty-string fallback breaks accessibility (AB-005 / SPEC-002)
**Severity:** Medium • **Confidence:** Medium-High • **Blocking**

Spec says invalid hex returns `''` and the briefing falls back to dot-only. The whole reason for the colour word is that the host is colour-blind — a dot-only fallback restores colour-as-sole-indicator. Even if every existing `games.background_colour` is currently valid `#rrggbb`, the spec shouldn't bake in the unsafe path.

**Fix:** spec the fallback as the literal string `"Unknown colour"` (or echo the raw hex, e.g. `"#A3B5FF"`). Update the test to assert the fallback string, not `''`.

### SD-2 — Stage-label assumption is under-specified (AB-003 / SPEC-005)
**Severity:** Medium • **Confidence:** Medium

Spec assumes `stage_sequence` values are user-facing labels (`Line`, `Two Lines`, `Full House`). The schema default confirms this — `stage_sequence jsonb DEFAULT '["Line","Two Lines","Full House"]'` — but the risk table also hedges about a `formatStageLabel` helper. The hedge introduces ambiguity.

**Fix:** drop the `formatStageLabel` row from the risks table. State outright: stage values are user-facing labels by schema default. If the implementation finds otherwise (e.g. an admin entered something else), the briefing renders the value verbatim — no helper, no transform.

### SD-3 — Vertical-fit budget covers the wrong screen state (AB-004 / WF-002 / SPEC-003)
**Severity:** Medium • **Confidence:** High • **Blocking**

The "above the fold on iPhone 14 Pro" verification is the load-bearing UX promise. The spacing diet table only verifies the **in-play** state (one number called). The **first-game pre-game** state is taller — game header + 3-row prize ladder + 4-line house rules — and is also required to fit. Quick napkin maths puts it at ~400 px content + 50 px page header + margins; the 14 Pro Safari viewport is ~664 px, so it likely fits, but not by enough that we should leave it implicit.

**Fix:** either:
- Add an explicit pre-game layout budget (briefing 280 px max, controls 156 px, page header ~50 px, leaves 180 px headroom on a 14 Pro), and require a screenshot at zero calls on game 1 before merge; or
- Relax the contract: "primary controls (Next Number, Take Break, Check Claim) are always visible above the fold; the briefing body may scroll inside its own container if it overflows."

I'd take option 2 — it's safer, the briefing is a one-time read, the controls are the recurring need.

---

## Architecture & Integration Defects

### AI-1 — Display-TV refactor visual-parity is unproven (AB-002 / SPEC-004 / ARCH-001)
**Severity:** Medium • **Confidence:** Medium

Three reviewers raised this. The current `renderHouseRulesPanel` in [display-ui.tsx:471-493](src/app/display/[sessionId]/display-ui.tsx:471) isn't simple `{ icon, text }` rows — it has:
- An inline `<span className="font-bold">late claims invalid</span>` mid-text on item 1
- A different icon (`🎉`) and styling (`pt-1` on the `<li>`, `clamp()`-sized icon, `font-bold italic` on the text) on the last item

A naive `Array<{ icon, text }>` shape loses the inline emphasis on item 1 and the special last-item styling. Promising "no visual change to display" while flattening to that shape is a pre-broken contract.

**Fix:** specify a richer data shape that preserves both:
```ts
type Segment = { text: string; bold?: boolean };
type Rule = {
  icon: string;
  segments: Segment[];
  variant?: 'default' | 'closing';   // 'closing' applies pt-1 li + bold-italic text + clamp icon
};
```
Or punt on extraction — keep rules as inline JSX in both `display-ui.tsx` and the new briefing component, and accept the duplication. Either is fine; the current spec sits unsafely between the two.

### AI-2 — "Indexed read" claim isn't backed by docs (ARCH-002)
**Severity:** Low • **Confidence:** Medium

The risks table claims `min(game_index)` is a free indexed read. Probably true (the games table likely has a unique constraint on `(session_id, game_index)` enforced as an index), but the data-model docs don't explicitly show it. Not a blocker — at pub-bingo scale (handful of sessions, a dozen games each) the read is trivial regardless.

**Fix:** soften "Single indexed read" to "Single small read on a low-cardinality table". Or verify the index in the migrations directory and lock the claim.

---

## Workflow & Failure-Path Defects

(All workflow concerns are folded into CR-1 / CR-2 / SD-3 above. Reviewer flagged no orphan retry, idempotency, or race issues — UI-only changes preserve the existing live-state pipeline.)

---

## Security & Data Risks

(Security reviewer was not run for this pass — change is UI-only with no auth, RLS, server-action, or schema impact. Confirmed by Integration & Architecture and Spec Trace reviewers in their `empty_categories`.)

---

## Unproven Assumptions

| ID | Assumption | What would confirm |
|---|---|---|
| UA-1 | All `games.background_colour` values in the wild are valid `#rrggbb` | Inspect schema/admin form validation; if not enforced, the SD-1 fix is mandatory regardless |
| UA-2 | The display rules panel can be losslessly extracted to a shared shape | Side-by-side screenshot of `/display/[sessionId]` before vs after the refactor — block merge on parity |
| UA-3 | The proposed spacing diet leaves enough room for the first-game briefing | Implement, screenshot at iPhone 14 Pro and 14 Pro Max viewports, before merge |
| UA-4 | `stage_sequence` values stored in production are exactly `Line` / `Two Lines` / `Full House` | Spot-check the production DB; or normalise in the briefing component (fallback render) |
| UA-5 | `games(session_id, game_index)` is indexed | `grep -i 'CREATE.*INDEX.*games' supabase/migrations/*.sql` — soften the claim if absent |

---

## Recommended Fix Order

1. **CR-1** — rewrite the file-impact table cell so trigger and impact agree. Two-line edit.
2. **CR-2** — add the prop / decide on the split. One-line edit (or paragraph if splitting).
3. **SD-1** — change `''` fallback to `"Unknown colour"`. Update tests.
4. **SD-3** — pick option (1) or (2) for the vertical-fit budget; spec the chosen path.
5. **AI-1** — pick richer-shape vs inline-duplication for the rules; lock the contract.
6. **SD-2** — drop the `formatStageLabel` hedge from risks.
7. **AI-2** — soften the "indexed read" claim or verify and lock it.

After 1-5, the spec is buildable. 6-7 are polish.

## Minor Observations

- The "Risks & Mitigations" table item *"Pre-game block re-appears on Undo Last Call back to 0"* is now mis-categorised given Q4 flipped to "every game" — Undo on game 2+ now correctly re-shows that game's briefing. Update the row's wording from "Accept" to "By design".
- The "Out of scope" bullet *"A briefing block on games 2+"* was already removed during the Q4 flip — confirmed clean.

---

**Tone check:** the review is a green light *with caveats*. None of the findings invalidate the spec's overall direction — they are corrections within a sound shape, mostly produced by my own incomplete edit pass when flipping Q4. Five edits to the SPEC and the implementation plan can be drafted with confidence.
