# W1B Handoff — Pure Libraries + Tests

## Status

All 12 files created, staged via `git add`, NOT committed. All checks pass.

## Files Created

| Path | Type | Notes |
|---|---|---|
| `src/lib/game-state-version.ts` | helper | `isFreshGameState()` |
| `src/lib/game-state-version.test.ts` | test | 6 tests |
| `src/lib/prize-validation.ts` | helper | `validateGamePrizes()` |
| `src/lib/prize-validation.test.ts` | test | 5 tests |
| `src/lib/connection-health.ts` | reducer | `initialHealthState`, `reduceHealth`, `selectShouldShowBanner`, `selectShouldAutoRefresh` |
| `src/lib/connection-health.test.ts` | test | 7 tests |
| `src/lib/win-stages.ts` | helper | `REQUIRED_SELECTION_COUNT_BY_STAGE`, `getRequiredSelectionCountForStage()` |
| `src/lib/win-stages.test.ts` | test | 5 tests |
| `src/lib/log-error.ts` | helper | `logError(scope, err)` with UUID redaction |
| `src/lib/log-error.test.ts` | test | 2 tests |
| `src/hooks/use-connection-health.ts` | React hook | `useConnectionHealth()` wrapping the reducer |
| `src/components/connection-banner.tsx` | component | `ConnectionBanner` outage banner with auto-refresh |

## Verification

### `npm test` (full suite)
- 27 tests pass, 0 fail (25 new + 2 pre-existing in `tests/utils.test.ts`).
- Each new test was first observed to FAIL before its implementation existed (TDD discipline confirmed).

### `npx tsc --noEmit`
- Clean. No errors introduced. Pre-baseline (before my changes) was also clean.

### `git status --short` (staged additions only)
```
A  src/components/connection-banner.tsx
A  src/hooks/use-connection-health.ts
A  src/lib/connection-health.test.ts
A  src/lib/connection-health.ts
A  src/lib/game-state-version.test.ts
A  src/lib/game-state-version.ts
A  src/lib/log-error.test.ts
A  src/lib/log-error.ts
A  src/lib/prize-validation.test.ts
A  src/lib/prize-validation.ts
A  src/lib/win-stages.test.ts
A  src/lib/win-stages.ts
```

## Deviations from Plan

Two minor adaptations to keep `npx tsc --noEmit` clean — behaviour and test assertions are unchanged:

1. **Test imports drop the `.ts` extension.** The plan code uses e.g. `import { foo } from './foo.ts'`. Under the project's existing tsconfig (`module: "esnext"`, `moduleResolution: "bundler"`, no `allowImportingTsExtensions`), this triggers `TS5097`. The Node native test runner via `tsx` resolves the extensionless path identically (verified by passing tests). Existing test pattern in `tests/utils.test.ts` also uses extensionless imports.

2. **`win-stages.test.ts`: removed the `@ts-expect-error` directive on the `'Bogus'` call.** The implementation signature is `(stage: string)`, so passing the literal `'Bogus'` is type-valid; the directive was unused and triggered `TS2578`. The runtime assertion (returns `null` for an unknown stage) is preserved.

3. **`log-error.test.ts`: cast `process.env` when assigning `NODE_ENV`.** Next.js declares `NODE_ENV` as readonly, triggering `TS2540`. Used `(process.env as Record<string, string | undefined>).NODE_ENV = 'production'` to satisfy the type system without changing semantics.

## Type Imports Status

W1A has already exported `WinStage` and `GameType` from `src/types/database.ts` (verified — both are present at lines 11 and 13). Both:
- `src/lib/prize-validation.ts` imports `GameType` and `WinStage`
- `src/lib/win-stages.ts` imports `WinStage`

No temporary local types needed.

## Test Pass Summary

```
ℹ tests 27
ℹ suites 0
ℹ pass 27
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 161.485459
```

New tests breakdown (25):
- game-state-version: 6
- prize-validation: 5
- connection-health: 7
- win-stages: 5
- log-error: 2

## Issues / Assumptions

- None blocking. Wave 2/3 agents can rely on these helpers.
- The Wave 2 agents that wire these libs into `game-control.tsx`, `display-ui.tsx`, `player-ui.tsx`, and admin actions will need to be aware that `validateGamePrizes` returns a discriminated union (`{ valid: true } | { valid: false; missingStages: WinStage[] }`).
- `useConnectionHealth` must be used inside a client component (`'use client'`); it relies on `window`/`Date.now`/`setInterval`.
- `ConnectionBanner` triggers `window.location.reload()` when `shouldAutoRefresh` becomes true, which is an irreversible side effect — only consumers that want the auto-refresh behaviour should pass `shouldAutoRefresh={true}` from the hook.
