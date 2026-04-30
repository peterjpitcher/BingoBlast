# Claude Hand-Off Brief: Live Event Reliability

**Generated:** 2026-04-30
**Review mode:** B (Code Review)
**Overall risk:** **High** — multiple TOCTOU patterns + two client-side correctness gaps. None will silently corrupt stored data, but they can produce wrong UI / spurious refreshes / jackpot drift during a live event.

## DO NOT REWRITE

The following are correct and should be preserved unchanged:

- `state_version` migration + trigger + sync function copy (W1A).
- `isFreshGameState` helper (intentionally ignores `numbers_called_count` for void path).
- `validateGamePrizes` shared helper with jackpot exemption.
- Proxy matcher narrow scope (`/admin/:path*`, `/host/:path*`, `/login`).
- Public route narrow `select(...)` lists (no `number_sequence`/host-only fields leaked).
- Login server-side invite-only enforcement + `next` sanitisation.
- Connection-health pure reducer time-injection pattern (no `Date.now()` impurity).
- The deliberate non-uniqueness of `winners (game_id, stage)` (multi-winner ties valid).
- `useReducer(reducer, null, () => initialHealthState(Date.now()))` lazy init.

## SPEC REVISION REQUIRED

- [ ] **Locked-game editing scope** — the spec says only prize/type/snowball/stages are locked when a game is in progress, but the current UI/server contract has the fieldset disable swallowing all non-structural edits too. Decide: lock everything once started (and update the UI copy accordingly), OR allow non-structural edits and rework how locked fields are submitted. CR-7.

## IMPLEMENTATION CHANGES REQUIRED

### Blocking before next live event

- [ ] **CR-1 — Freshness-gate the prize text** in `src/app/display/[sessionId]/display-ui.tsx` and `src/app/player/[sessionId]/player-ui.tsx`. Move prize-text derivation off the incoming payload and onto `currentGameState` (already gated). Or wrap the setter in a freshness check.
- [ ] **CR-2 — Separate transport health** in `src/lib/connection-health.ts`. Track `pollHealthy` and `realtimeHealthy` independently. `unhealthy = !pollHealthy && !realtimeHealthy` (or whichever combination matches the spec's intent — confirm with user). Add reducer tests for the four transport-state combinations.
- [ ] **CR-3 — Atomic `updateGame` lock check** in `src/app/admin/sessions/[id]/actions.ts:223`. Either move the read+update into a Postgres function that holds the row lock for the duration, or add a `WHERE` predicate to the games update that requires no in-progress game-state row exists. Same idea: `update games set ... where id = ? and not exists (select 1 from game_states where game_id = games.id and status <> 'not_started')`.
- [ ] **CR-4 — Atomic delete-game / delete-session** in `src/app/admin/actions.ts:160` and `src/app/admin/sessions/[id]/actions.ts:310`. Same fix: predicate the DELETE on `not exists` against `game_states.status <> 'not_started'` and `winners`.
- [ ] **CR-5 — Single-transaction `resetSession`** in `src/app/admin/sessions/[id]/actions.ts:397`. Move all destructive deletes + status update into one PL/pgSQL RPC.
- [ ] **CR-6 — Surface `handleSnowballPotUpdate` read errors** in `src/app/host/actions.ts:113,138`. Treat missing `gameData`/`potData` as `{ success: false, error }` not silent success.
- [ ] **AW-3 — Check `game_id` before applying realtime payloads** in `display-ui.tsx`/`player-ui.tsx`. Drop payload if `payload.new.game_id !== currentActiveGame.id`.

### Non-blocking but worth fixing in the same PR

- [ ] **AW-1** — Branch on `payload.eventType` in display+player realtime handlers. Handle DELETE explicitly (clear local state) instead of casting `payload.new` blindly.
- [ ] **AW-2** — Active-game refresh request-order guard in `display-ui.tsx`/`player-ui.tsx`. Same `seqRef` pattern used for polling.
- [ ] **CR-7** (only after the spec revision above) — Either disable individual locked inputs and submit hidden values, or expand the server allowlist and update modal copy.

## ASSUMPTIONS TO RESOLVE

- [ ] Verify live `pg_policies` for `game_states`, `sessions`, `profiles` match `docs/schema.sql`. If `Hosts/Admins can update game state` matches the docs, tighten with `controlling_host_id = auth.uid()`. If `Public profiles viewable by everyone` matches, restrict to authenticated.
- [ ] Confirm Vercel sanitises `x-forwarded-host` before our app reads it; if not, fall back on `NEXT_PUBLIC_SITE_URL` exclusively in production.
- [ ] Confirm no `call_delay_seconds is null` rows exist (post-migration column should be NOT NULL — verify).

## REPO CONVENTIONS TO PRESERVE

- Server actions return `{ error }` on failure or `{ success, data }` shapes — keep when adding RPCs.
- Pure helpers in `src/lib/` with Node-native tests; no `console.error` in production paths (use `logError`).
- Migrations in `supabase/migrations/` with timestamp prefix; mirror in `docs/schema.sql`.
- British English in comments.

## RE-REVIEW REQUIRED AFTER FIXES

- [ ] **CR-2** — re-review the new reducer logic + tests against the spec's banner/auto-refresh intent.
- [ ] **CR-3, CR-4, CR-5** — re-review the new RPCs/predicates with the security reviewer.
- [ ] **CR-1** — re-confirm prize text holds steady through stale-payload replay.

## REVISION PROMPT

Use this to spawn the next round of work:

> Implement the blocking corrections from `tasks/codex-qa-review/2026-04-30-live-event-reliability-claude-handoff.md`. Priority order: CR-1 (prize text freshness), CR-2 (independent transport health + tests), CR-6 (snowball error surfacing), CR-3 + CR-4 + CR-5 (atomic admin mutations via RPC or predicate-on-write), AW-3 (game_id check). Keep the blocking spec question (CR-7) unanswered — flag it back to the user. Run lint/test/build before each commit. Do not introduce a winners uniqueness constraint.
