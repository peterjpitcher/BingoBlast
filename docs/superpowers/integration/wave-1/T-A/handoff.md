# T-A Handoff — Make Host Client State Reconciliation Void-Safe

## Mission
Removed the two monotonic `numbers_called_count` guards in the host's Realtime payload handler and 3-second polling effect so that `voidLastNumber()` (which intentionally decreases the count) is no longer ignored by the client.

## File touched
- `/Users/peterpitcher/Cursor/OJ-CashBingo/src/app/host/[sessionId]/[gameId]/game-control.tsx` (only file modified)

## Edits applied

### Edit 1 — Realtime payload handler (lines ~392-401 → ~392-395)
Replaced the monotonic-guard `setCurrentGameState(prev => ...)` block with a direct assignment:

```tsx
(payload) => {
    if (!isMounted) return;
    setCurrentGameState(payload.new);
}
```

Now lives at lines 392-395.

### Edit 2 — Polling fallback effect (lines ~441-447 → ~435-437)
Replaced the monotonic-guard `setCurrentGameState(prev => ...)` block with a direct assignment:

```tsx
if (freshState) {
    setCurrentGameState(freshState);
}
```

Now lives at lines 435-437.

## Verification

### Self-check 1 — old guard blocks no longer present
Read the file post-edit (lines 388-440). The two `setCurrentGameState(prev =>` blocks that took the Realtime payload / polled state have been removed and replaced with direct assignments shown above.

### Self-check 2 — call sites of `setCurrentGameState`
`grep -n "setCurrentGameState" /Users/peterpitcher/Cursor/OJ-CashBingo/src/app/host/[sessionId]/[gameId]/game-control.tsx` returned:

```
114:    const [currentGameState, setCurrentGameState] = useState<GameState>(initialGameState);
394:                        setCurrentGameState(payload.new);
436:                setCurrentGameState(freshState);
```

Line 114 is the `useState` declaration (unchanged). Lines 394 and 436 are the two new direct assignments. There are no other call sites — including no remaining `setCurrentGameState(prev =>` updaters in the file. (The brief noted that other call sites taking an explicit shape may exist; none do, so nothing else was touched.)

### Self-check 3 — grep for the old guard expression
`grep -n "numbers_called_count >= prev.numbers_called_count" /Users/peterpitcher/Cursor/OJ-CashBingo/src/app/host/[sessionId]/[gameId]/game-control.tsx` returned **zero matches** (output: `ZERO_MATCHES`). Both guards are confirmed removed.

## Anomalies
None. Both `old_string` blocks matched exactly on the first attempt; indentation preserved precisely; no imports added or removed; no other code in the file was modified; no blank lines added or removed outside the edited blocks.
