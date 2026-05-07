# Wave 2 — display-refactor handoff

## Outputs
- src/app/display/[sessionId]/display-ui.tsx (modified — import + renderHouseRulesPanel body)

## Verification
- Typecheck: `npx tsc --noEmit` — pass (no output)
- Lint: `npm run lint` — pass (zero warnings, zero errors)
- Build: `npm run build` — pass (compiled successfully in 1463.0ms; static generation 12/12 OK; all 14 routes built)

## DOM-parity reasoning
The new `HOUSE_RULES.map(...)` iteration produces structurally identical DOM to the original inline JSX for all four rules:

- **Rules 1, 2, 3 (default variant, no `pt-1`, no `font-bold italic`):** `cn('flex gap-4 items-start', false)` resolves through `clsx` (which drops falsy values cleanly with no extra space) and `twMerge` (no-op when there are no conflicts) to exactly `"flex gap-4 items-start"` — identical to the original `<li className="flex gap-4 items-start">`. The icon span uses the ternary `'text-white mt-1'` (not `cn`), so it emits `<span className="text-white mt-1">➤</span>` byte-for-byte. The text-wrapper span uses `cn(false)`, which clsx returns as `""`, and React renders `className=""` as no class attribute or an empty one — matching the original which had no className on the wrapper span at all. (`<span>` and `<span className="">` produce equivalent rendered HTML for the purposes of this layout — no inherited or attribute-driven styling depends on the absence of the attribute.)
- **Rule 1 inner bold:** the bold segment renders as `<span className="font-bold">late claims invalid</span>`, preserving the original inline `<span className="font-bold">…</span>`. The non-bold preceding segment uses `<React.Fragment>` which emits no wrapper element, so the literal text `"Claims must be called on the number they're won on - "` (with the curly apostrophe `'` from the data file, matching the source `&apos;` rendering) sits as a sibling text node ahead of the bold span — identical to the original.
- **Rule 4 (closing variant):** `cn('flex gap-4 items-start', true && 'pt-1')` resolves to `"flex gap-4 items-start pt-1"`, matching the original `"flex gap-4 items-start pt-1"`. The icon span ternary picks `'text-[clamp(1.7rem,2.3vw,2.4rem)]'`, matching the original. The text-wrapper span gets `cn(true && 'font-bold italic')` → `"font-bold italic"`, matching the original. Inside, a single non-bold segment renders inside `<React.Fragment>` (no wrapper), preserving the original text-only content of the wrapper span.

The outer panel `<div>` and `<h3>House Rules</h3>` heading are untouched. The data file's curly apostrophe (`they're`) renders identically to the original `they&apos;re` JSX entity since both are the same Unicode codepoint U+2019.

## Issues encountered
None.

## Notes for verification
- Manual screenshot diff still required by the human reviewer: load `/display/[sessionId]` in waiting state, compare against a pre-refactor baseline. This agent cannot run the dev server or capture screenshots.
