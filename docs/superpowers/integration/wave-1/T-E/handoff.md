# T-E Handoff — Live Stage Validation in announceWin and recordWinner

## Status
Complete. All four edits applied to `/Users/peterpitcher/Cursor/OJ-CashBingo/src/app/host/actions.ts`.

## Edits applied
1. **`announceWin()`** — added live-stage validation: fetches `game_states.current_stage_index`/`status` and `games.type`/`stage_sequence`, rejects when game not in progress, when stage is not configured, when `stage` mismatches `stage_sequence[current_stage_index]`, and when 'snowball' is used outside a snowball-type game's Full House stage.
2. **`recordWinner()`** — replaced the prior `liveGameState` mini-fetch with two consolidated fetches:
   - `liveGameRow` from `games` selecting `session_id, type, snowball_pot_id, stage_sequence` (also validates `liveGameRow.session_id !== sessionId` returning `"Game does not belong to this session."`).
   - `liveStateRow` from `game_states` selecting `numbers_called_count, current_stage_index, status` (validates `status !== 'in_progress'` and `stage !== expectedStage`).
   - `resolvedCallCountAtWin` is now `const` initialised from `liveStateRow.numbers_called_count`.
   - `void callCountAtWin;` silences the unused-parameter warning (signature unchanged).
3. **`recordWinner()`** — removed the second `from('games')` fetch (the one selecting `type, snowball_pot_id`) and replaced with `const game = liveGameRow;`. Eliminates a duplicate roundtrip.
4. **`recordWinner()`** — `winner_name: winnerName.trim()` on the winners insert.

## Self-check results
- [x] `announceWin` has stage-mismatch error path (line 982 — `Stage mismatch: live stage is ${expectedStage}.`).
- [x] `recordWinner` has `Game does not belong to this session.` error path (line 1137).
- [x] Second `from('games')` fetch inside `recordWinner` is gone — replaced with `const game = liveGameRow;` at line 1176.
- [x] `winner_name: winnerName.trim()` present on line 1212; unmodified `winner_name: winnerName,` no longer present (note: line 1269 has `display_winner_name: winnerName` — unrelated field, not part of the spec).
- [x] `let resolvedCallCountAtWin = callCountAtWin;` removed; replaced with `const resolvedCallCountAtWin = liveStateRow.numbers_called_count;` at line 1160.
- [x] `void callCountAtWin;` present at line 1126 to silence the now-unused-parameter warning.

## grep counts
- `grep -c "from('games')" /Users/peterpitcher/Cursor/OJ-CashBingo/src/app/host/actions.ts` → **11**

## Constraints honoured
- Only `src/app/host/actions.ts` was modified.
- No new top-level imports added (`Database`, `WinStage`, `ActionResult`, `createClient` already imported).
- 4-space indentation matches existing file.
- Error message strings match the spec character-for-character.
- `recordWinner` function signature unchanged — `callCountAtWin` parameter kept (now intentionally unused, suppressed via `void`).

## Notes for downstream waves
- Compile/lint/type-check verification deferred to the verification wave per spec.
- `liveGameRow` now serves both ownership/stage validation and the snowball-jackpot lookup that previously did its own `from('games')` query — single source of truth for game metadata in `recordWinner`.
