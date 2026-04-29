# T-B Handoff: Player Polling Fallback (Void-Safe)

## Summary
Added a 3-second polling fallback to the player UI that refreshes session, active game, game state, and prize text. Implementation is void-safe: the new effect contains NO monotonic count guard, so reductions in `numbers_called_count` (caused by host voiding a call) are applied directly to UI state.

## File modified
- `/Users/peterpitcher/Cursor/OJ-CashBingo/src/app/player/[sessionId]/player-ui.tsx`

## Lines added
- Line 27: `const POLL_INTERVAL_MS = 3000;` constant declared between the `PlayerUIProps` interface and the `PlayerUI` function.
- Lines 168-227: New polling `useEffect` placed immediately after the snowball-pot subscription effect (which now ends at line 166) and immediately before the existing "Delay Logic" effect (which now begins at line 229).

## Dependency array
```ts
[
  session.id,
  currentActiveGame?.id,
  currentActiveGame?.prizes,
  currentActiveGame?.stage_sequence,
  refreshActiveGame,
]
```

## Behaviour
- Polls every 3 seconds (`POLL_INTERVAL_MS`).
- Skipped when `document.visibilityState !== 'visible'` (saves cycles when tab is backgrounded).
- Re-polls immediately on `visibilitychange` to `visible` (catches up after returning to tab).
- Fetches the freshest `sessions` row first; if `active_game_id` has changed, defers to `refreshActiveGame()` (same path used by the realtime subscription).
- Otherwise fetches the freshest `game_states_public` row for the current game and applies it directly via `setCurrentGameState(freshState)`.
- Recomputes `currentPrizeText` from the fresh stage index against the current game's `prizes` map.
- `cancelled` flag and clean teardown on unmount: clears interval, removes visibility listener, ignores any in-flight responses.

## Void-safety verification
- No `numbers_called_count >=` guard anywhere in the new effect.
- `freshState` is unconditionally applied via `setCurrentGameState(freshState)` whenever it loads successfully.
- The downstream "Delay Logic" effect (unchanged by this task) already handles `serverCalledNumbers.length < delayedNumbers.length` by snapping `delayedNumbers` and `currentNumberDelayed` back to the server values, so a void propagates through correctly.

## Anomalies
- None. The `Session` and `GameState` types were already in scope (lines 15-17). `useEffect` and `useState` were already imported. No new imports needed.
- Indentation matches existing 2-space body style.
- Both subscription effects and the delay logic remain untouched.
