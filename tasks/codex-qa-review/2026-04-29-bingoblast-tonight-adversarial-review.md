# Adversarial Review: BingoBlast Tonight Fixes (T-A through T-E)

**Date:** 2026-04-29
**Mode:** B — Code Review
**Scope:** Five fixes applied to `src/app/host/[sessionId]/[gameId]/game-control.tsx`, `src/app/player/[sessionId]/player-ui.tsx`, `src/app/display/[sessionId]/display-ui.tsx`, `src/app/api/setup/route.ts`, `src/app/host/actions.ts`.
**Pack:** `tasks/codex-qa-review/2026-04-29-bingoblast-tonight-review-pack.md`
**Reviewers:** Assumption Breaker, Integration & Architecture, Workflow & Failure-Path, Security & Data Risk

---

## Executive Summary

The five fixes deliver what the spec specified. Verification (lint, typecheck, build) passes. The four Codex reviewers converged on one structural concern that is **explicitly a deliberate spec decision**, and two findings that turn out to be **false alarms** when checked against the existing pause/heartbeat flow. Two security findings about over-fetching session columns are real but **pre-existing exposures** — the page already passes the full `Session` row as a prop. **No tonight-blocking issues. Ship it.**

---

## What Appears Solid

All four reviewers independently confirmed:

- **`/api/setup` timing-safe comparison** is correctly implemented. Both digests are fixed-length 32 bytes before `timingSafeEqual`, so there is no length-leak path. Empty/missing secret hashes to a stable digest. ([src/app/api/setup/route.ts:1, 15, 23, 40](../../src/app/api/setup/route.ts:1))
- **`announceWin` and `recordWinner` server-side hardening** still calls `requireController` first; live-state and live-game rows are re-fetched server-side; client-supplied `callCountAtWin` is correctly ignored in favour of the live `numbers_called_count`. ([src/app/host/actions.ts:948, 1089, 1123](../../src/app/host/actions.ts:948))
- **Polling effect cleanup** in display and player is hygienic: `cancelled` flag, `clearInterval`, `removeEventListener` all present in the return.
- No new client-side service-role usage. No raw SQL, command interpolation, file upload, or open-redirect introduced.
- No new schema or migration coupling.

---

## Critical Risks

### CR-1 — Removing the host monotonic guard creates a stale-overwrite window (DELIBERATE per spec § Fix A)

**Reviewers flagging it:** Assumption Breaker (AB-001), Integration & Architecture (ARCH-001), Workflow & Failure-Path (WF-001/002).
**Files:** [src/app/host/[sessionId]/[gameId]/game-control.tsx:391, :433](../../src/app/host/%5BsessionId%5D/%5BgameId%5D/game-control.tsx:391)

**Concern:** With the `numbers_called_count >=` guard removed from both the Realtime payload handler and the 3-second polling effect, a delayed Realtime/poll response carrying an older row image can roll back the host UI's called-numbers list.

**Why this is not blocking:**
- The spec at § Fix A explicitly states this is the chosen trade-off: *"Count-only freshness is invalid because voiding is a first-class feature. If stronger anti-stale ordering is needed later, add a `state_version` migration in a separate PR."*
- The previous guard actively blocked legitimate `voidLastNumber()` operations. That was a real, reproducible bug; the rollback risk Codex identifies is theoretical and self-healing within one 3s poll cycle.
- For tonight's pub bingo with one host on stable WiFi, the rollback window is ≤3 seconds and corrects itself on the next poll.

**Action:** None tonight. **Post-tonight:** add a `state_version bigint` column to `game_states`, increment in every state-changing action, and use it as the freshness marker. Listed in spec § 7 follow-up.

### CR-2 — Same stale-overwrite window in player and display polling (DELIBERATE)

**Reviewers flagging it:** Workflow & Failure-Path (WF-003, WF-004), Assumption Breaker (AB-002, AB-003).
**Files:** [src/app/player/[sessionId]/player-ui.tsx:194](../../src/app/player/%5BsessionId%5D/player-ui.tsx:194), [src/app/display/[sessionId]/display-ui.tsx:170](../../src/app/display/%5BsessionId%5D/display-ui.tsx:170)

**Concern:** Same as CR-1, applied to the new polling fallbacks in the public-facing display and player views.

**Why this is not blocking:** Same reasoning as CR-1. Spec deliberately chose void-safety over stale-rollback protection. The display already has a delayed-rendering layer that smooths transitions; the player view self-heals on the next poll.

**Action:** None tonight. Same `state_version` follow-up applies.

---

## Implementation Defects

None blocking. The implementation matches the spec exactly. Error strings, dependency arrays, helper signature, and edit anchors all verified by the wave gate review.

---

## Architecture & Integration Defects

### ARCH-002 — `in_progress` status check conflicting with pause flow — **FALSE ALARM**

**Reviewer:** Integration & Architecture.
**Concern raised:** "`recordWinner` and `announceWin` reject any state other than `in_progress`, which may conflict with the existing claim-validation state machine if `pauseForValidation` changes status."

**Verified false against actual code:**
- `pauseForValidation` ([host/actions.ts:617-639](../../src/app/host/actions.ts:617)) only sets `paused_for_validation: true`. It does **not** change `status`.
- `announceWin` update only sets `paused_for_validation: true`. Status remains `in_progress`.
- The status only changes to `completed` after the final stage advance, which happens *after* the winner is recorded.

**Action:** None. Reviewer correctly hedged with "needs verification" — verification confirms no conflict.

### ARCH-003 — Code duplication between player and display polling (out of scope)

**Reviewer:** Integration & Architecture.
**Concern:** Player and display each carry near-identical polling effects.

**Action:** Acknowledged. Spec § 6 explicitly lists "do not refactor for shared abstractions" as out of scope tonight. Real concern, real follow-up.

---

## Workflow & Failure-Path Defects

### WF-005 — `recordWinner` ignoring client-supplied `callCountAtWin` — **FALSE ALARM**

**Reviewer:** Workflow & Failure-Path.
**Concern raised:** Host could accidentally call another number between claim and record, causing the live `numbers_called_count` (now used) to drift past the actual claim moment.

**Verified false against actual code:**
- `callNextNumber` ([host/actions.ts:526](../../src/app/host/actions.ts:526)) explicitly returns "Game is paused for claim validation" when `paused_for_validation` is true.
- The flow is: `pauseForValidation` (sets pause) → `validateClaim` → `announceWin` (keeps pause) → `recordWinner`. The host **cannot** call a new number anywhere in that sequence.

**Action:** None.

---

## Security & Data Risks

### SEC-001 / SEC-002 — `sessions.select('*')` in display and player polling

**Reviewer:** Security & Data Risk.
**Files:** [src/app/display/[sessionId]/display-ui.tsx:145](../../src/app/display/%5BsessionId%5D/display-ui.tsx:145), [src/app/player/[sessionId]/player-ui.tsx:172](../../src/app/player/%5BsessionId%5D/player-ui.tsx:172)

**Concern:** Browser anon Supabase client now fetches every `sessions` column instead of just `active_game_id, status`. If the `sessions` table contains host metadata, test flags, or other non-display data, those are exposed to anyone with the public URL.

**Real, but not a regression:**
- The display and player pages already receive the **full `Session` row** as a server-side prop (see `display-ui.tsx:35-46` and `player-ui.tsx:27-32` — both accept `session: Session`).
- The exposure exists at page mount today. The new polling re-fetches the same shape that was already on the wire.
- Spec § Fix C explicitly required `select('*')` to surface `status` transitions for waiting/completed states.

**Action tonight:** None. The threat model (in-pub bingo, no hostile internet adversaries, RLS is configured at the `sessions` table level for anon clients) makes this acceptable.

**Post-tonight follow-up:** Audit the `sessions` table for columns that anon clients should not see. If any exist, either tighten RLS or replace `select('*')` with an explicit allowlist. This is a workspace-wide hygiene item, not a tonight blocker.

---

## Unproven Assumptions

| Claim | What would confirm it |
|------|----------------------|
| Heartbeat UPDATEs always carry the latest `called_numbers` value, so the removed guard does not regress. | Inspect `sendHeartbeat` SQL — only updates `controller_last_seen_at`, but Postgres triggers `sync_game_states_public` on ANY game_states UPDATE which writes the FULL row. So heartbeats DO carry full state. ✓ |
| RLS policies on `sessions` table only expose anon-safe columns. | Read [supabase/migrations](../../supabase/migrations/) and confirm RLS policies. Out of scope tonight. |
| The 3-second poll interval is short enough that a stale rollback self-heals within tolerable UX. | Empirical — host-side rollback would be visible to host briefly; display/player rollback is harder to notice due to delayed rendering. Tonight's reality test will reveal it. |

---

## Recommended Fix Order

**Tonight: nothing.** Ship as-is.

**Post-tonight cleanup PR (in priority order):**

1. Add `state_version bigint NOT NULL DEFAULT 0` to `game_states`; increment in every state-changing server action; replace polling overlap with version comparison. This addresses CR-1 and CR-2 properly.
2. Audit `sessions` and `game_states_public` RLS policies. Either tighten anon column access or restore explicit `select(...)` allowlists in client polling. Addresses SEC-001/002.
3. Extract shared session/game polling logic into a reusable hook. Addresses ARCH-003.

---

## Minor Observations

- The 4 ESLint warnings (2 pre-existing, 2 from new polling deps) are non-blocking. The new ones flag that ESLint can't see that `?.id`, `?.prizes`, `?.stage_sequence` together cover the same `currentActiveGame` object. Listing `currentActiveGame` whole would cause more frequent re-runs; the chosen sub-deps are deliberate.
- `void callCountAtWin;` ([host/actions.ts:1126](../../src/app/host/actions.ts:1126)) silences unused-param lint without changing the public signature. Correct.

---

## Final Verdict

**Ship for tonight's game.** No blocking issues. The major finding (CR-1/CR-2) is a documented spec-level trade-off, not a code defect. The two false alarms (ARCH-002, WF-005) check out clean against the actual code. The two security findings (SEC-001/002) are pre-existing exposures inherited from page-level props, not new regressions.
