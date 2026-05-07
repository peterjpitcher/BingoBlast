# Wave 1 — colour-name handoff

## Outputs
- src/lib/colour-name.ts (new)
- src/lib/colour-name.test.ts (new)

## Verification
- Test command: `node --test --import tsx src/lib/colour-name.test.ts`
- Result: tests 4, pass 4, fail 0 (all 4 tests passing in 380.408125 ms)
- Typecheck: `npx tsc --noEmit` — pass (no new errors introduced for colour-name.ts/colour-name.test.ts)

## Assumptions
- The HEX_RE regex deliberately rejects 3-char shorthand (`#fff`) and any non-6-char hex. Consumer code should pass full `#rrggbb` or pre-normalise.

## Issues encountered
None.

## Notes for downstream
- Public API: `getColourName(hex: string): string`. Always returns a non-empty string.
- Import path: `@/lib/colour-name`.
