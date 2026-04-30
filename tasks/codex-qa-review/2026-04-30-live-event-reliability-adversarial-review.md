# Adversarial Review: Live Event Reliability

**Date:** 2026-04-30
**Mode:** B (Code Review)
**Scope:** commits c45ee8e..585b1c3 (Wave 1–3 of the live-event reliability spec)
**Pack:** [tasks/codex-qa-review/2026-04-30-live-event-reliability-review-pack.md](2026-04-30-live-event-reliability-review-pack.md)
**Reviewers:** assumption-breaker · integration-architecture · workflow-failure-path · security-data-risk

## Executive Summary

The direction is sound and the foundation work is solid: `state_version` ordering, anonymous winner, narrowed proxy matcher, public-route column narrowing, and prize hard-block all land cleanly. But four reviewers independently flagged the same Achilles' heel — protections are implemented as **read-then-write checks in application code, without DB-level transactions**. Under the concurrent admin/host load of a live event, this is the failure mode that will bite. There are also two correctness gaps in the new client logic (prize-text drift past the freshness gate; connection-health collapsing two transports into one boolean) that should be fixed before Friday.

## What Appears Solid (don't rewrite)

- `state_version` column + trigger + sync-function copy (W1A migration).
- `isFreshGameState` helper + tests; pure helper, deliberately ignores `numbers_called_count` for void-path correctness.
- `validateGamePrizes` shared helper with jackpot exemption; reused on client + server.
- Proxy matcher narrowed to `/admin`, `/host`, `/login` — public surfaces bypass auth refresh.
- Display + player narrow `select(...)` lists exclude private `number_sequence` and host-only fields.
- Login: signup is server-side hard-failed; UI no longer exposes the toggle; `next` redirects sanitised against absolute/protocol-relative.
- Connection-health pure reducer takes time as input — no `Date.now()` impurity in the reducer (the prior fix held).
- No winner uniqueness constraint added — multi-winner ties remain valid.

## Critical Risks (blocking)

### CR-1 — `currentPrizeText` updates ignore the freshness gate
**Files:** `src/app/display/[sessionId]/display-ui.tsx:174`, `src/app/player/[sessionId]/player-ui.tsx:166`
The freshness gate protects `setCurrentGameState` but the prize-text derivation runs unconditionally from the incoming payload. A stale lower-version realtime/poll payload is rejected for game state but still rolls the displayed prize text back to a previous stage.
**Fix:** derive `currentPrizeText` from `currentGameState` (already gated) instead of `incoming`, OR gate the prize-text setter behind the same freshness check.

### CR-2 — Connection-health collapses transports into one boolean
**File:** `src/lib/connection-health.ts:37,52`
A single poll failure flips the page unhealthy even if realtime is still delivering payloads, and a bare `SUBSCRIBED` flips it healthy without any payload arriving. Live event consequence: spurious 30-second auto-refreshes when polling has a transient blip but realtime is fine, OR the banner never showing despite no fresh data flowing.
**Fix:** track `pollHealthy` and `realtimeHealthy` independently in the reducer. Surface `unhealthy` only when both transports are degraded. Add tests for the four combinations (poll✓×rt✓, poll✗×rt✓, poll✓×rt✗, poll✗×rt✗).

### CR-3 — `updateGame` lock is a TOCTOU read-then-write
**File:** `src/app/admin/sessions/[id]/actions.ts:145,224`
Reads `game_states.status`, decides `isLocked`, then later runs `.from('games').update(...)` with no status predicate. A host starting the game between the two operations defeats the lock — prizes/type/stages can change after the game starts.
**Fix:** include `eq('status', 'not_started')`-style guard in the update path, or wrap the read+write in an RPC that holds the row lock. Simplest: in the games update, add a sub-query check or move the locked-field comparison server-side conditional on a re-read inside the update transaction.

### CR-4 — `deleteGame` and `deleteSession` are TOCTOU
**Files:** `src/app/admin/actions.ts:117,160`, `src/app/admin/sessions/[id]/actions.ts:310`
Same pattern: pre-check that no game is in progress / has winners, then unconditional `.from(...).delete().eq('id', ...)`. A host action between the check and the delete erases live state.
**Fix:** wrap in a Postgres function that checks-and-deletes atomically (recommended), OR move the precondition into the DELETE WHERE clause via a NOT EXISTS subquery against `game_states` and `winners`.

### CR-5 — `resetSession` is a non-atomic destructive multi-step
**Files:** `src/app/admin/sessions/[id]/actions.ts:397,412,417`
Deletes `game_states` first, then separately deletes `winners`, then updates session status. A failure between steps leaves a half-erased session with no live recovery path.
**Fix:** consolidate into one PL/pgSQL RPC with a single transaction.

### CR-6 — `handleSnowballPotUpdate` swallows read errors
**File:** `src/app/host/actions.ts:113,138`
Treats missing `gameData` or `potData` as success. After a snowball win, a transient read failure leads to the pot not being reset/rolled over — and the host sees no error.
**Fix:** surface read errors as `{ success: false, error: '...' }`. Treat missing rows as configuration errors, not silent success.

### CR-7 — Started-game fieldset disable breaks form submission
**Files:** `src/app/admin/sessions/[id]/session-detail.tsx:543`, `src/app/admin/sessions/[id]/actions.ts:160`
The UI wraps `type` / `stages` / `prizes` in a disabled `<fieldset>`. Browsers omit disabled controls from `FormData`. The server then sees missing values and compares them against the original locked fields, treating "not submitted" as an attempted change. Net effect: even non-structural edits (notes/order) are rejected on a started game.
**Fix:** either (a) disable individual locked inputs and submit hidden values that match the existing data, or (b) lock the entire game (server allowlist + UI copy) and stop pretending non-structural edits are allowed.

## Architecture & Workflow Defects

### AW-1 — Realtime `event: '*'` casts every payload as upsert
**File:** `src/app/display/[sessionId]/display-ui.tsx:170-173` (and player counterpart)
DELETE events from `game_states_public` would route through the same handler with `payload.new` undefined.
**Fix:** branch on `payload.eventType` and handle DELETE explicitly (clear local state) or restrict the listener to `INSERT,UPDATE`.

### AW-2 — Active-game refresh lacks request-order guard
**Files:** `src/app/display/[sessionId]/display-ui.tsx:88`, `src/app/player/[sessionId]/player-ui.tsx:95`
If `active_game_id` flips from A to B and A's fetch resolves last, the display lands on the wrong game.
**Fix:** capture a sequence id at the start of the fetch, compare before applying setters. Same pattern already used for polling.

### AW-3 — `state_version` is per-row, but consumers don't check `game_id`
**File:** `src/lib/game-state-version.ts:30` (consumers in `display-ui.tsx`, `player-ui.tsx`)
The version is meaningful only within one `game_id` row. After an active-game switch, a delayed old-game payload with a higher version can pass the comparator and replace the new game's state.
**Fix:** before applying, assert `incoming.game_id === activeGameId`. Drop otherwise.

## Security & Data Risks

### SEC-A — RLS appears to allow any host to update any `game_states` row
**File:** `docs/schema.sql:74,128` (verify against live policies)
Documented policy `Hosts/Admins can update game state` checks only role membership, not controller ownership. If applied as written, a logged-in host can bypass server actions via direct Supabase client calls and write to a game they don't control.
**Verification:** query live `pg_policies` for `game_states` and `sessions`. If schema docs match production, tighten the policy to require `controlling_host_id = auth.uid()`.

### SEC-B — `profiles` RLS appears world-readable
**File:** `docs/schema.sql:21`
Documented `Public profiles are viewable by everyone` with `using (true)` exposes `email` and `role`.
**Verification:** query live policy. If true, restrict to authenticated users only.

### SEC-C — Display QR origin trusts forwarded host header
**File:** `src/app/display/[sessionId]/page.tsx:41`
`x-forwarded-host` is consumed without an allowlist. If the production proxy passes a spoofed header, the QR redirects guests to the attacker's domain.
**Fix:** require `NEXT_PUBLIC_SITE_URL` and prefer it over headers in production, or enforce an allowlist of acceptable hosts.

## Unproven Assumptions

| Assumption | Confirmed by |
|---|---|
| Live `pg_policies` for `game_states`, `sessions`, `profiles` match `docs/schema.sql` | Run `select * from pg_policies where schemaname = 'public'` and diff |
| Vercel preserves only sanitised `x-forwarded-host` | Vercel's proxy docs / a curl probe with a spoofed header |
| `JSON.stringify` of `prizes` round-trips with stable key order | Round-trip test against the actual DB |
| `call_delay_seconds = NULL` rows do not exist post-migration | `select count(*) from game_states where call_delay_seconds is null` |

## Recommended Fix Order

1. CR-1 (prize text freshness) — trivial, high impact
2. CR-2 (independent transport health) — moderate, blocks false auto-refresh
3. CR-6 (snowball read error swallowing) — small change, high impact
4. CR-3, CR-4, CR-5 (atomic admin mutations) — RPC/transaction work; biggest refactor
5. AW-3 (game_id check on freshness gate) — small, defensive
6. CR-7 (fieldset form contract) — UX bug, less likely during live event
7. SEC-A, SEC-B (RLS verification) — query production, tighten if needed
8. AW-1, AW-2, SEC-C — defensive

## Minor Observations

- `JSON.stringify` prize equality (AB-004) — fine in practice with stable key insertion, but the safer pattern is shallow equality on stage-keyed objects.
- Backfill migration uses `<> 2` which excludes NULL (WF-008) — column is NOT NULL after the migration so currently moot.
- `currentGameStateRef` removed cleanly in display + player.
