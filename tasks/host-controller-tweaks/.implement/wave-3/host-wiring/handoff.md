# Wave 3 — host-wiring handoff

## Outputs
- `src/app/host/[sessionId]/[gameId]/page.tsx` (modified — first-game query + `isFirstGameOfSession` prop pass-through)
- `src/app/host/[sessionId]/[gameId]/game-control.tsx` (modified — `PreGameBriefing` wiring, nickname-above-ball reorder, removed call-delay hint, spacing diet)

## Verification
- Typecheck: `npx tsc --noEmit` — pass (no output, exit 0)
- Lint: `npm run lint` — pass (no warnings)
- Tests: `npm test` — 36 tests, all pass (duration 190.76 ms)
- Build: `npm run build` — pass (Next.js 16.1.4 Turbopack, compiled in 1867.4 ms, 12/12 static pages generated)

## Spacing diet applied

| Location | Before | After |
|---|---|---|
| Outer wrapper | `p-4 pb-32 max-w-5xl ...` | `p-4 pb-24 max-w-5xl ...` |
| `<Card>` (main display) | `mb-6 overflow-hidden` | `mb-4 overflow-hidden` |
| `<CardContent>` | `p-8 flex flex-col items-center text-center` | `p-5 flex flex-col items-center text-center` |
| Nickname `<h2>` margin | `mb-4` | `mb-3` |
| Nickname animation | `slide-in-from-bottom-4` | `slide-in-from-top-4` |
| Ball wrapper margin | `mb-6` | `mb-3` |
| Ball size class | `w-40 h-40 text-7xl` | `w-32 h-32 text-6xl` |
| READY fallback disc | `w-40 h-40` | `w-32 h-32` |
| Stats row top padding | `pt-4` | `pt-3` |
| Control pad grid | `grid grid-cols-2 gap-4 mb-6` | `grid grid-cols-2 gap-3 mb-4` |
| Next Number button | `col-span-2 h-24 text-3xl ...` | `col-span-2 h-20 text-2xl ...` |

Take Break / Check Claim buttons unchanged (`h-16` retained).

## Behavioural changes
- `numbers_called_count === 0` → renders `<PreGameBriefing>` inside a `w-full max-h-[55vh] overflow-y-auto pr-1` scroll container, so the briefing scrolls without pushing primary controls below the fold.
- `numbers_called_count > 0` → nickname above ball, then ball, then stats row, then optional snowball strip. Nickname animation reverses direction (`slide-in-from-top-4`).
- "Players see this in Xs" passive call-delay hint removed.
- `isFirstGameOfSession` derived in `page.tsx` via `select game_index from games where session_id = ? order by game_index asc limit 1` and compared against the current game's `game_index`. Defensive default when the query fails: `false` (better to omit rules than show them on the wrong game).

## Issues encountered
None — every command returned a clean pass on first attempt.

## Notes for verification
- Manual screenshot checks remain pending (iPhone 14 Pro, three states: pre-game with rules, pre-game without rules, in-play).
- Searched the file and confirmed zero matches for: `Players see this`, `slide-in-from-bottom-4`, `w-40 h-40 text-7xl`, `pb-32`.
- Only the two owned files were modified; no test files, libs, or display surfaces touched.
- Route file edits triggered the changes-manifest hook — note for next session: `/session-setup partial` to refresh docs.
