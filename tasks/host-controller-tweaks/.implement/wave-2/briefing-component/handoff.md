# Wave 2 — pre-game-briefing handoff

## Outputs
- src/components/host/pre-game-briefing.tsx (new file)

## Verification
- Typecheck: `npx tsc --noEmit` — pass (no output, exit 0; no new errors introduced).
- Lint: `npm run lint` — pass (zero warnings, zero errors).

## Public API
- Component: `PreGameBriefing` (named export)
- Props: `{ game: Game; currentSnowballPot: SnowballPot | null; isFirstGameOfSession: boolean }`
  - `Game` = `Database['public']['Tables']['games']['Row']`
  - `SnowballPot` = `Database['public']['Tables']['snowball_pots']['Row']`
- Import path: `@/components/host/pre-game-briefing`

## Notes for downstream (Wave 3)
- The component is pure presentation — no client APIs, no hooks, no state. No `'use client'` directive.
- Rendered in place of the "READY" disc when `currentGameState.numbers_called_count === 0`.
- Wave 3 must wrap it in `<div className="max-h-[55vh] overflow-y-auto pr-1">` so the briefing body scrolls inside its own container while primary controls stay pinned (per spec SD-3 hard target).
- Renders header strip (game index, type, colour swatch, colour name, game name), prize ladder (with destructive styling for missing prizes), optional snowball jackpot line, and house rules block (only when `isFirstGameOfSession === true`).
- Tailwind palette used: `#003f27`, `#1f7c58`, `#f3d59d`, plus `text-destructive` and `text-white/85|90|95|70|40`. No new tokens introduced.

## Dependencies confirmed
- `HOUSE_RULES` exported from `src/lib/house-rules.ts` (with `Rule` and `Segment` types, including `variant` and `icon`/`segments` shape).
- `getColourName(hex: string): string` exported from `src/lib/colour-name.ts`.
- `formatPounds(value: number): string` exported from `src/lib/snowball.ts`.
- `cn` exported from `src/lib/utils.ts` (existing).
- `Database` type from `src/types/database.ts` (existing generated types).

## Issues encountered
None. All prerequisite libs from Wave 1 (`house-rules.ts`, `colour-name.ts`) were present and exposed the expected exports.
