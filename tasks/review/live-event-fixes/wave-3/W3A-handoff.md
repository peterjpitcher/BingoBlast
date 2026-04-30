# W3A Handoff — Host Control UI

**Owner:** W3A
**File:** `src/app/host/[sessionId]/[gameId]/game-control.tsx` (single-file scope)
**Date:** 2026-04-30
**Status:** Done — staged, NOT committed.

## Verification

- `npx tsc --noEmit` — GREEN.
- `npm test` — 27/27 passing.
- `npx eslint src/app/host/[sessionId]/[gameId]/game-control.tsx` — 0 errors. 2 warnings remain (`unused eslint-disable directive` on lines 247 and 279) but both are pre-existing on lines I did not touch (verified via `git show HEAD:...`).

## Change sites (current line numbers in the new file)

### Imports + removed local helpers

- **Lines ~7–18** — Added imports: `useConnectionHealth`, `ConnectionBanner`, `isFreshGameState`, `getRequiredSelectionCountForStage`, `logError`.
- **Lines ~96–109 (old)** — Removed `DISPLAY_SYNC_BUFFER_MS` constant and the local `getRequiredSelectionCount(stage)` function. Now routed through `getRequiredSelectionCountForStage` from `@/lib/win-stages` (with a `?? 5` fallback for non-canonical stage names — see judgment call 1).

### State shape

- **Lines ~111–144** — Removed `isConnected`, `displaySyncRemainingMs`, `winnerName` `useState` declarations. Added `isRecordingWinner` (Record Winner double-tap guard), `isRecordingSnowballWinner` (Snowball modal double-tap guard). Added `health = useConnectionHealth()`. Added `pollSeqRef` and `pollInFlightRef` for poll request-order guards.

### Computed values

- **Lines ~256–261** — Replaced `currentStagePrize = ... || 'Standard Prize'` with `plannedStagePrize` and `isStagePrizeMissing` so the JSX can render the red `⚠️ Prize not set` warning when the prize is missing.

### Removed display-sync ticking effect

- **Lines ~293–335 (old)** — Removed the entire `useEffect` that ticked at 100ms to compute `displaySyncRemainingMs`/`unlockAtMs`. Gone. Next-Number now disables only while the action is in flight.

### New: poll routine + realtime + visibility handler

- **Lines ~336–379** — Added `pollGameState` (`useCallback`) which:
  - Skips if a poll is already in flight.
  - Increments `pollSeqRef`, marks in-flight, fetches game state, drops the result if a newer poll started since.
  - Wraps the apply with `setCurrentGameState((current) => isFreshGameState(current, freshState) ? freshState : current)`.
  - Wires `health.markPollSuccess()` / `health.markPollFailure()`.
  - Pipes errors through `logError('host-control', err)`.
- **Lines ~381–383** — Added `reconnectRealtimeRef` so the visibility handler can call into the realtime effect's stable `connect` closure.
- **Lines ~385–443** — Replaced the realtime effect:
  - The realtime payload setter now uses `isFreshGameState`.
  - The subscribe callback dispatches `health.markRealtimeStatus(status)` for every status change.
  - Removed all `setIsConnected(...)` calls.
  - The `connect` closure now tears down any existing channel before re-subscribing, and clears any pending reconnect timer; assigns itself to `reconnectRealtimeRef.current` so the visibility handler can force a reconnect.
- **Lines ~445–453** — Polling effect now calls `pollGameState()` (DRY with the visibility handler).
- **Lines ~455–465** — Added the `visibilitychange` handler effect — when the tab becomes visible, it forces a realtime reconnect via `reconnectRealtimeRef.current?.()` and an immediate `pollGameState()`.

### Host-instant-on-action-response

- **Lines ~468–484** — `handleCallNextNumber` now applies `result.data.gameState` immediately on success, gated through `isFreshGameState`. Comment updated. The freshness gate ensures a slightly older Realtime echo cannot clobber the just-applied snapshot.

### Record Winner double-tap guard

- **Lines ~675–706** — `handleRecordWinner` wrapped in a `try/finally` that flips `isRecordingWinner`. Early-returns if already recording. Removed the `setWinnerName('')` cleanup line (winnerName state no longer exists).

### Disabled state cleanup

- **Lines ~745–751** — `isDisplaySyncLocked`/`displaySyncSeconds` removed. `isNextNumberDisabled` no longer references them.

### JSX changes

- **Lines ~772–776** — Replaced the LIVE/OFFLINE pill block with a single `<ConnectionBanner visible={health.shouldShowBanner} shouldAutoRefresh={health.shouldAutoRefresh} />`.
- **Lines ~810–815** — Added the new `<p className="text-xs text-muted-foreground mb-4">Players see this in {currentGameState.call_delay_seconds ?? 2}s</p>` directly below the nickname header. Hidden when `last_call_at` is null (no number called yet).
- **Lines ~828–835** — Prize render block now branches on `isStagePrizeMissing`: missing → `<span className="text-xl font-bold text-destructive">⚠️ Prize not set</span>`; present → original white-bold render of `plannedStagePrize`.
- **Lines ~858** — Next-Number button text simplified: `isCallingNumber ? "CALLING..." : count >= 90 ? "ALL NUMBERS CALLED" : "NEXT NUMBER"`. The `WAITING FOR DISPLAY (Ns)` branch is gone.
- **Lines ~881–885 (old)** — Removed the `{isDisplaySyncLocked && isController && ...}` block that explained the artificial wait.
- **Lines ~915–918** — Manual Snowball trigger button onClick: removed `setWinnerName('')`.
- **Lines ~1120–1192** — Record Winner Modal redesigned:
  - Removed the `<Input>` for winner name and the surrounding `<label>` + wrapping `<div>`.
  - Added a one-line note: "Winners are recorded anonymously. Confirm the prize details below to log the win."
  - Moved `autoFocus` onto the Prize Description input (so the modal still focuses something sensible on open).
  - Cancel button now `disabled={isRecordingWinner}`. Confirm button `disabled={isRecordingWinner}` and shows `Recording…` while the action is in flight.
- **Lines ~1207–1213** — Validate-Another-Winner button onClick: removed `setWinnerName('')`.
- **Lines ~1267–1334** — Manual Snowball Modal redesigned:
  - Removed the `<Input>` for winner name and the surrounding `<label>` + wrapping `<div>`.
  - Added the same anonymous-winner note.
  - Moved `autoFocus` onto the Prize Description input.
  - Confirm button is gated by `isRecordingSnowballWinner` via `try/finally`. Cancel button also `disabled={isRecordingSnowballWinner}`. Confirm shows `Recording…` while in flight.

### Console error sweep

- The file had no `console.error` / `console.warn` calls before W3A — D2 sweep was a no-op for this file. The new error paths in `pollGameState` use `logError('host-control', err)`.

## Judgment calls

1. **`?? 5` fallback on `getRequiredSelectionCountForStage`** — the helper returns `null` for unknown stages. The legacy local helper defaulted to 5. I preserved that legacy fallback so a custom stage_sequence value couldn't break the validation gate (the check is just a UX guard; the server re-validates). The comment in the code explains this.
2. **`text-destructive` for the prize-not-set warning** — the brief said "red". The codebase already uses Tailwind's `text-destructive` token elsewhere; this matches the design-token rule in the workspace CLAUDE.md ("no hardcoded hex colours"). The warning emoji ⚠️ is included as the brief specified.
3. **`autoFocus` migration** — both modals previously focused the (now-removed) winner-name input. I moved `autoFocus` to the Prize Description input on each so keyboard users still land on a useful field on modal open.
4. **`isRecordingSnowballWinner` is a separate state from `isRecordingWinner`** — the snowball modal handler is inline in JSX, not in `handleRecordWinner`. I added a parallel guard so the two flows can be open simultaneously (e.g. if a host opens manual snowball after recording a normal winner, the disable states don't bleed across).
5. **`pollGameState` swallows `error` into a poll-failure event rather than surfacing to UI** — consistent with the spec's intent that polling is a best-effort fallback; the `ConnectionBanner` is the user-facing surface for sustained polling failure.
6. **`pollGameState` is a `useCallback` with `health` in its dependency list** — `health` is recreated by `useConnectionHealth` only when its internal dispatch identities change (which is `useCallback`-stable inside the hook), so this does not retrigger the polling effect unnecessarily.
7. **Visibility handler force-reconnect** — calls `connect()` from inside the realtime effect via the ref. `connect()` is idempotent: it tears down any existing channel before re-subscribing. Safe to call when realtime is already SUBSCRIBED.
8. **`reconnectRealtimeRef` handling on cleanup** — set to `null` in the effect cleanup so a stale closure can't be invoked after unmount.

## Wave 2 contracts honoured

- `callNextNumber` response shape `{ success: true, data: { nextNumber, gameState } }` — used as-is in `handleCallNextNumber`. Did not modify.
- `recordWinner` signature (no `winnerName`, no `callCountAtWin`) — both callsites already on the correct signature; I did not revert.

## Out of scope (not touched)

- `src/app/host/actions.ts` — Wave 2 territory.
- Display, player, and admin UIs — W3B / W3C territory.
- Shared modal/button components — W3C territory.
- The pre-existing `eslint-disable-next-line react-hooks/set-state-in-effect` on lines 247 and 279 — these are noted as warnings but not introduced by W3A.

## Status

- File staged via `git add` (only).
- NOT committed — orchestrator will commit Wave 3.
