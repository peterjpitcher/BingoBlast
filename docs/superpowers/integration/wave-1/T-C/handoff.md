# T-C Handoff: Tighten Display Polling Fallback (Void-Safe, 3s)

## Owner
Edits scoped to `/Users/peterpitcher/Cursor/OJ-CashBingo/src/app/display/[sessionId]/display-ui.tsx` only.

## Edits made

### Edit 1 — Added `POLL_INTERVAL_MS` constant
Inserted `const POLL_INTERVAL_MS = 3000;` immediately after the `formatStageLabel` helper (now line 35) and before the `DisplayUI` default export. No other code changed in that region.

### Edit 2 — Replaced 10s polling effect with void-safe 3s polling effect
Replaced the entire `useEffect` block previously at lines 138-168 (which polled every 10s with a `Pick<Session, 'active_game_id' | 'status'>` partial select and only updated `currentGameState`). The new effect:

- Polls every `POLL_INTERVAL_MS` (3000ms).
- Selects the full `sessions` row with `Session` type and the full `game_states_public` row with `GameState` type (both type aliases were already imported, no import changes).
- On each tick: updates `currentSession`, recomputes `isWaitingState` from `(!active_game_id && status !== 'running')`, dispatches `refreshActiveGame` when the active game id changes, otherwise refreshes `currentGameState` and recomputes `currentPrizeText` from the active game's `stage_sequence` / `prizes` map.
- Adds a `cancelled` guard, runs `poll()` once on mount, and registers a `visibilitychange` listener that triggers an immediate poll when the tab returns to visible.
- Cleanup: sets `cancelled = true`, clears the interval, and removes the visibility listener.
- Deps: `[session.id, currentActiveGame?.id, currentActiveGame?.prizes, currentActiveGame?.stage_sequence, refreshActiveGame]`.
- No monotonic count guard (`numbers_called_count >=`) anywhere in the new effect.

## Grep verification

```
$ grep -n "10000" src/app/display/[sessionId]/display-ui.tsx
(none)

$ grep -n "numbers_called_count >=" src/app/display/[sessionId]/display-ui.tsx
(none)

$ grep -n "POLL_INTERVAL_MS" src/app/display/[sessionId]/display-ui.tsx
35:const POLL_INTERVAL_MS = 3000;
180:    interval = setInterval(() => { void poll(); }, POLL_INTERVAL_MS);

$ grep -n "setCurrentSession\|setIsWaitingState\|setCurrentPrizeText" src/app/display/[sessionId]/display-ui.tsx
# state declarations + setters fire at lines 155, 156, 173 inside the new poll effect (plus pre-existing call sites in refreshActiveGame and the realtime subscription, which were not touched).
```

## Self-check status
- [x] Constant `POLL_INTERVAL_MS = 3000` declared once.
- [x] Old 10-second polling effect removed (no `10000` literal remains).
- [x] New void-safe 3-second effect in its place.
- [x] No `numbers_called_count >=` guard.
- [x] `setCurrentSession`, `setIsWaitingState`, `setCurrentPrizeText` all called inside the new effect.
- [x] No imports added or removed.
- [x] No other effects, Realtime subscriptions, or rendering logic modified.

## Anomalies
None. The two find-blocks matched exactly as specified, both edits applied cleanly on the first attempt, and all four grep self-checks passed.
