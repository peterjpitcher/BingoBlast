# Wave 1 — house-rules handoff

## Outputs
- src/lib/house-rules.ts (new)

## Verification
- Typecheck: `npx tsc --noEmit` — pass

## Public API
- Types: `Segment`, `Rule`
- Constant: `HOUSE_RULES: ReadonlyArray<Rule>` (4 items)
- Import path: `@/lib/house-rules`

## Notes for downstream
- The display refactor agent (Wave 2) must map over HOUSE_RULES and produce DOM byte-identical to the current inline JSX in `src/app/display/[sessionId]/display-ui.tsx:471-493`. Specifically:
  - Items with `variant !== 'closing'`: <li className="flex gap-4 items-start"> with icon span "text-white mt-1" and text span (no extra class).
  - Item with `variant === 'closing'`: <li className="flex gap-4 items-start pt-1"> with icon span "text-[clamp(1.7rem,2.3vw,2.4rem)]" and text span "font-bold italic".
  - Segments with `bold: true` wrap in <span className="font-bold">; segments without it render as text fragments inline.
- The host briefing agent (Wave 2) uses a smaller styling but the same iteration shape.

## Issues encountered
none
