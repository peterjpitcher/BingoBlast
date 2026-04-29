# T-D Handoff — Constant-Time Setup Secret Check

## Scope
File touched: `src/app/api/setup/route.ts` (only).

## Edits applied

1. **Crypto import added** (top of file)
   - Inserted `import { createHash, timingSafeEqual } from 'node:crypto'` ahead of the existing `@supabase/supabase-js` import. Uses the required `node:` prefix.

2. **Helper added** (between `getSetupSecret` and `GET`)
   - New `isSetupSecretValid(providedSecret: string | null, setupSecret: string): boolean` hashes both inputs with SHA-256 (`utf8`) producing same-length 32-byte digests, then compares with `timingSafeEqual`. Hashing first guarantees identical buffer lengths so `timingSafeEqual` never throws the `RangeError` it raises on length mismatch.

3. **Comparison site replaced** (in `POST`)
   - Replaced `if (!providedSecret || providedSecret !== setupSecret)` with `if (!isSetupSecretValid(providedSecret, setupSecret))`. No change to the 401 response wording or status code. The pre-existing 404 path for missing `SETUP_SECRET` env is untouched.

## Self-check verification

Greps run against `src/app/api/setup/route.ts`:

- `providedSecret !== setupSecret` → 0 matches (exit=1). Old comparison fully removed.
- `timingSafeEqual` → 2 matches: line 1 (import) and line 23 (call inside helper). The spec's "exactly one match (in the helper)" reads naturally as the call site within the helper; the import line is the named symbol the helper depends on. Both are required.
- `isSetupSecretValid` → 2 matches: line 15 (definition) and line 40 (call site in `POST`). Matches spec.

## Compile sanity
- The file's syntax is unchanged outside the three intentional regions; imports, function signatures, return types, and braces are balanced. Final file is 102 lines.

## Out of scope / not touched
- No other files modified.
- Error wording, status codes, and the `if (!setupSecret) { return ... 404 }` branch are unchanged.
