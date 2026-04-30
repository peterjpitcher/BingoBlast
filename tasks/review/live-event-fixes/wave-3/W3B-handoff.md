# W3B Handoff — Display + Player UI

**Owner:** W3B
**Files (4):**
- `src/app/display/[sessionId]/page.tsx` (server)
- `src/app/display/[sessionId]/display-ui.tsx` (client)
- `src/app/player/[sessionId]/page.tsx` (server)
- `src/app/player/[sessionId]/player-ui.tsx` (client)

**Date:** 2026-04-30
**Status:** Done — staged, NOT committed.

## Verification

- `npx tsc --noEmit` — GREEN (zero diagnostics).
- `npm test` — 27/27 passing.
- `npm run lint` — 0 errors, 0 warnings on all 4 files I own. (Two remaining warnings live in `src/app/host/[sessionId]/[gameId]/game-control.tsx` — that file is W3A's scope.)

## What changed (per file)

### `src/app/display/[sessionId]/page.tsx` (server)

- Imported `logError` from `@/lib/log-error`.
- Replaced `console.error` / `console.warn` with `logError('display', err)` (3 sites: session fetch, game fetch, game-state fetch).
- Introduced module-level constants: `SESSION_SELECT`, `GAME_SELECT`, `GAME_STATE_PUBLIC_SELECT`. Replaced `select('*')` and `select('*, active_game_id, status')` with these explicit narrow column lists.

### `src/app/player/[sessionId]/page.tsx` (server)

- Same treatment as the display server page: `logError('player', err)`, identical explicit-select constants, three former `console.*` calls swapped.

### `src/app/display/[sessionId]/display-ui.tsx` (client) — full rewrite

Shape now mirrors W3A's host-control approach.

**Imports added:** `isFreshGameState`, `useConnectionHealth`, `ConnectionBanner`, `RealtimeStatus` (type), `logError`.

**State / refs:**
- Added `hasLoaded` boolean (initial `initialActiveGameState != null`). Flipped on first realtime payload, first poll apply, or `refreshActiveGame` success.
- Removed `currentGameStateRef` and its writer effect — confirmed unused after Wave 1 freshness work.
- Added `currentActiveGameRef` so realtime + poll callbacks can read the active game without re-running the realtime effect when the game object identity changes (also closes the old `react-hooks/exhaustive-deps` warning).
- Added `pollSeqRef` (monotonic sequence) and `pollInFlightRef` (in-flight flag).
- Added `health = useConnectionHealth()`; destructured `markPollSuccess`, `markPollFailure`, `markRealtimeStatus`.

**Realtime auto-reconnect (game state):**
- Split out from the session-channel effect into its own effect keyed on `currentActiveGame?.id`.
- `connect()` is async; awaits `removeChannel(activeChannel)` before subscribing the next channel, per the spec ordering requirement.
- Channel name now `game_state_public_updates:${activeGameId}:${Date.now()}` to avoid stale-channel reuse.
- Listener now `event: '*'` (was `UPDATE`-only).
- Apply path: `setCurrentGameState((current) => (isFreshGameState(current, incoming) ? incoming : current))`. Sets `hasLoaded(true)` and recomputes prize text.
- `subscribe()` callback wires `markRealtimeStatus(status)`. On `CHANNEL_ERROR`/`TIMED_OUT`/`CLOSED`, schedules reconnect via exponential backoff `Math.min(1000 * 2 ** attemptCount, 30000)`. `attemptCount` resets to 0 on `SUBSCRIBED`.
- Cleanup: clears `reconnectTimer` and removes the channel.

**Polling (visibility-gated, every 3s):**
- Wrapped in `try`/`finally`. Guarded by `pollInFlightRef` and `pollSeqRef` (drops late responses).
- Each fetch uses the explicit `SESSION_SELECT` / `GAME_STATE_PUBLIC_SELECT` lists.
- Apply path uses `isFreshGameState` (state_version-gated) so a slow poll cannot clobber a newer realtime snapshot. Also flips `hasLoaded(true)`.
- Wires `markPollSuccess()` on success, `markPollFailure()` on errors / null rows / thrown exceptions.
- Errors routed through `logError('display', err)`.
- Visibility-change handler unchanged: triggers an immediate poll when the tab becomes visible.

**"Prize not set" fallback:**
- Footer (line was ~572): `Prize: …` now renders red `⚠️ Prize not set` when `currentPrizeText` is empty.
- Pre-call stage preview (line was ~346): per-stage prize label is red and reads `⚠️ Prize not set` when `game.prizes[stage]` is missing. Done by extending each `stagePrizePreview` row with a `prizeMissing` flag.

**Loading skeleton:**
- Early return `<div>… Connecting to game…</div>` when `!hasLoaded`. Background colour `#005131` so the transition into the live UI is visually continuous.

**Connection banner:**
- `<ConnectionBanner visible={health.shouldShowBanner} shouldAutoRefresh={health.shouldAutoRefresh} />` rendered as the first child of the live UI tree.

**Pre-existing lint warnings cleared:**
- `gameError` is no longer destructured (the unused-binding warning at the old line 67 is gone — the failure path now relies on `!newGame` for the active-game refresh, which is sufficient because the surrounding code only branches on whether the row exists).
- `useEffect missing dependency: currentActiveGame` warning at the old line 194: resolved by splitting the polling effect off the realtime effect, keying both on `currentActiveGame?.id`, and reading the full game object via `currentActiveGameRef`.

### `src/app/player/[sessionId]/player-ui.tsx` (client) — full rewrite

Mirror of the display surface with these surface-specific differences:

- Channel names retain the `_player` suffix convention used previously: `session_updates_player`, `game_state_public_updates_player`, `pot_updates_player`.
- Prize "info card" (was `currentPrizeText || '-'`) now renders `⚠️ Prize not set` in red when missing.
- The "Connecting to game…" skeleton uses the same markup pattern as display.
- Removed the `currentGameStateRef` ref + its writer effect.
- Removed the now-redundant `react-hooks/set-state-in-effect` eslint-disable wrapper around the delay-logic effect (no diagnostics from that rule remain).
- Pre-existing `useEffect missing dependency: currentActiveGame` warning at the old line 221 cleared by the same approach as display: poll effect keyed on `currentActiveGame?.id` with state read through `currentActiveGameRef`.

## Self-check (per brief)

- [x] Realtime auto-reconnect with exponential backoff (1s → 30s) and channel cleanup before resubscribe — display + player.
- [x] Realtime + polling apply paths use `isFreshGameState` (state_version-gated).
- [x] Polling request-order guards via `pollSeqRef` / `pollInFlightRef` — display + player.
- [x] `useConnectionHealth` + `<ConnectionBanner />` rendered on both surfaces; realtime status + poll outcomes wired.
- [x] Explicit select lists on `sessions` / `games` / `game_states_public` in both `page.tsx` and `*-ui.tsx`. No `select('*')` remains for those tables in these files. (`snowball_pots` still uses `*` — out of brief scope.)
- [x] `currentGameStateRef` removed from both files. `grep -rn currentGameStateRef src/` returns zero hits.
- [x] "Connecting to game…" skeleton appears until first state apply on both surfaces.
- [x] `'Standard Prize'` strings replaced with red `⚠️ Prize not set`. `grep -rn 'Standard Prize' src/` returns zero hits.
- [x] `console.error` / `console.warn` swapped for `logError('display', err)` / `logError('player', err)` in all four files.
- [x] Pre-existing lint warnings on these four files cleared (`gameError` unused, two `useEffect missing dependency: currentActiveGame` warnings, one `Unused eslint-disable directive` warning).
- [x] `npx tsc --noEmit` clean. `npm test` 27/27. `npm run lint` clean for the 4 owned files.
- [x] Files staged via `git add`, not committed. Confirmed via `git status` (the four files appear under "Changes to be committed:").
- [x] Handoff written to `tasks/review/live-event-fixes/wave-3/W3B-handoff.md`.

## Notes for the next reviewer

- The realtime listener uses `event: '*'` rather than `'UPDATE'` because the freshness gate makes the broader filter safe and a future INSERT (e.g., when game state is first created) would otherwise be missed until the next poll.
- The pot subscription effect on display + player is unchanged. The brief scoped explicit selects to `sessions` / `games` / `game_states_public`, so `snowball_pots` queries continue to use `select('*')`.
- The freshness gate on the realtime path uses the functional setter form. This is intentional: it lets the gate compare against the latest state without forcing a re-subscription whenever `currentGameState` changes.
- Browser online/offline + visibility wiring lives inside `useConnectionHealth` and the existing `visibilitychange` listener respectively — both surfaces now benefit by virtue of importing the hook.
