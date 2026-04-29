# Claude Hand-Off Brief: BingoBlast Tonight Fixes

**Generated:** 2026-04-29
**Review mode:** B — Code Review
**Overall risk:** Low (for tonight's game)

---

## DO NOT REWRITE

These are sound and must be preserved as-is:

- **`/api/setup` SHA-256 timing-safe comparison.** Both digests are fixed-length 32 bytes. No length-leak path. Empty/missing secret hashes deterministically. ([src/app/api/setup/route.ts:1, 15, 23, 40](../../src/app/api/setup/route.ts:1))
- **`announceWin` and `recordWinner` live-stage validation.** Server fetches live state, rejects mismatches, ignores client-supplied `callCountAtWin`. Error strings match spec exactly. Stage check is correctly compatible with `paused_for_validation` because pause does NOT change `status`.
- **Polling effect cleanup** in player and display: `cancelled` flag, `clearInterval`, `removeEventListener` all correct.
- **Removed monotonic guards** in host. This is a deliberate spec choice. Do NOT re-add them. Voiding is a first-class feature; count-only freshness is wrong.

---

## SPEC REVISION REQUIRED

None for tonight.

For the post-tonight cleanup PR, the spec already lists at § 7:
- [ ] Add `state_version bigint` column to `game_states` to enable proper anti-stale ordering. This is the architecturally correct fix to CR-1/CR-2.
- [ ] Audit `sessions` table RLS policies vs anon-readable columns; tighten if non-public columns are exposed.

---

## IMPLEMENTATION CHANGES REQUIRED

**None tonight.** All findings are either:
- Deliberate spec trade-offs (CR-1, CR-2, SEC-001/002 acknowledged in spec § 6/§ 7)
- False alarms verified against the code (ARCH-002, WF-005)
- Out-of-scope per spec § 6 (ARCH-003)

---

## ASSUMPTIONS TO RESOLVE (post-tonight)

- [ ] Confirm anon RLS policies on `sessions` and `game_states_public` actually filter sensitive columns. If not, narrow the polling `select('*')` calls.
- [ ] Confirm the heartbeat `UPDATE game_states SET controller_last_seen_at` triggers `sync_game_states_public` to write the FULL row image (it should, given the trigger pattern). If a heartbeat could ever produce a partial row image, the stale-overwrite window is wider than estimated.

---

## REPO CONVENTIONS TO PRESERVE

- All Supabase mutations remain in `'use server'` files under `src/app/.../actions.ts`.
- `requireController(supabase, gameId)` precedes every host mutation. Keep it.
- Server actions return `{ success?: boolean; error?: string }` shape.
- Error strings are user-facing — keep them grammatical and specific.
- `node:` prefix on Node built-in imports (matches the new `node:crypto` import).

---

## RE-REVIEW REQUIRED AFTER FIXES

Not required for tonight.

After the post-tonight cleanup PR ships:
- [ ] Re-run codex-qa-review against the `state_version` migration to verify monotonic ordering is reinstated correctly without re-introducing the void bug.
- [ ] Re-run security-data-risk reviewer if any RLS tightening lands.

---

## REVISION PROMPT

No revision needed for tonight. The implementation is ready for live use.

If you want a follow-up cleanup PR after tonight, here is a ready-to-run prompt:

> Apply the post-tonight cleanup items from `tasks/codex-qa-review/2026-04-29-bingoblast-tonight-claude-handoff.md`:
> 1. Add a `state_version bigint NOT NULL DEFAULT 0` column to `game_states` via Supabase migration. Increment it in every server action that mutates `game_states`. Update host/display/player polling and Realtime handlers to apply the new payload only if `payload.state_version > current.state_version`.
> 2. Audit anon-readable columns on `sessions` and `game_states_public`. Either tighten RLS or replace the polling `select('*')` calls with explicit allowlists.
> 3. Extract player and display polling into a shared `useSessionGameSync(sessionId)` hook in `src/hooks/`.
>
> Verification: `npm run lint && npx tsc --noEmit && npm run build` plus a targeted manual smoke test of void, stage advance, session completion, and tab-hidden recovery on all three views.
