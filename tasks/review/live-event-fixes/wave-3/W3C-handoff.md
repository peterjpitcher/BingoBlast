# W3C Handoff — Admin UI + Shared Components

## Scope delivered

Tasks **B3**, **D3**, **D4** (owned files only), **D7 steps 2–3**, **D8 steps 2–3**, **D9 steps 2–3** from the live-event reliability plan.

Built on Wave 2's server-side guards. All client UX changes match the existing server contracts.

## Files changed (staged)

- `src/app/admin/sessions/[id]/session-detail.tsx`
- `src/app/admin/dashboard.tsx`
- `src/components/ui/modal.tsx`
- `src/components/ui/button.tsx`

`src/app/admin/page.tsx` was reviewed; no destructive admin actions are exposed there (the Sign Out form lives in `sessions/[id]/page.tsx`, which is outside W3C ownership). No edit was needed.

## Detail per task

### B3 — Per-game prize lock + inline prize validation (`session-detail.tsx`)

- New helper `readGameStatus(game)` reads `game_states.status` regardless of join shape (single object vs array).
- `isGameLocked = editingGameStatus === 'in_progress' || 'completed'`. Per-game gating replaces the previous "session is running, all editing disabled" treatment — future not-started games inside a running session remain editable.
- Inside the Add/Edit Game modal, the type/stages/snowball-pot/prizes block is wrapped in `<fieldset disabled={isGameLocked} aria-disabled={isGameLocked}>`. A yellow inline banner explains the lock at the top of the form, plus per-section "Locked: game already started" footnotes.
- Per-game lock is also applied to the games table: Clone, Edit, and Delete buttons are no longer disabled by the session-level `isSessionLocked`. Delete is disabled only when the game itself is `in_progress` or `completed` (server-side guard already enforces this).
- Prize state migrated to a controlled `prizeDraft: Partial<Record<WinStage, string>>` so the UI can validate locally on submit.
- On submit, `validateGamePrizes({ type, stage_sequence, prizes: prizeDraft })` runs first. On failure, `missingPrizeStages` state is set and submission aborts.
- Each prize input that appears in `missingPrizeStages` gets `border-destructive border-red-500`, `aria-invalid="true"`, and a red inline error message beneath it.
- Submit button is `disabled={isSubmitting || missingPrizeStages.length > 0}`.

### D3 — Modal accessibility (`modal.tsx`)

- New `useFocusTrap(open, containerRef)` hook colocated inside `modal.tsx`.
  - Cycles Tab through focusable descendants only.
  - Forwards Escape to `[data-modal-close]` instead of duplicating the close handler.
  - Returns focus to the previously-focused element on close.
- Container now has `role="dialog"` (already present), `aria-modal="true"` (already present), and new `aria-labelledby={titleId}` (uses `useId()`).
- Title `<h2>` has `id={titleId}`.
- Close button switched to `<button type="button" data-modal-close aria-label="Close" className="p-2.5 ..." />` to give it a 44px tap target and an a11y label. Added `focus-visible:ring-2 focus-visible:ring-[#a57626]` so keyboard users see focus.

### D4 — Button `sm` size (`button.tsx`)

- `sm` variant changed from `h-8 px-3 text-xs` to `h-10 px-3 text-sm`.
- Swept owned files for `className="h-8"` overrides on `<Button size="sm">`:
  - `session-detail.tsx`: 3 callsites (Clone/Edit/Delete game). Removed `h-8` from the className and kept `px-2` plus colour utilities.
  - `dashboard.tsx`: 4 callsites (Manage/Edit/Copy/Delete session). Removed `h-8` className entirely — every button now uses the new size token.
- Did NOT sweep non-owned files (`snowball/*`, `host/*`, `display/*`, `player/*`, `sessions/[id]/page.tsx`). W3A and W3B sweep their own per the brief.

### D7 — Typed-confirm delete-game modal (`session-detail.tsx`)

- Replaced the `confirm("Delete this game?")` window prompt with a typed-confirm `Modal`.
- Title: `Delete game "<name>"?`.
- Body explains permanence and notes that started/completed/already-won games cannot be deleted.
- Input requires the user to type the exact game name. Delete button `disabled={typed !== game.name}`.
- On confirm, calls the existing `deleteGame(gameId, sessionId)` server action. Errors from Wave 2's guards (started status, recorded winners) surface inline inside the modal.

### D8 — Typed-confirm delete-session modal (`dashboard.tsx`)

- Replaced the `confirm()` prompt with a typed-confirm `Modal`.
- Title: `Delete session "<name>"?`.
- Body explains permanence and notes the server-side guards (started/completed games and recorded winners block deletion).
- Input requires the user to type the exact session name. Delete button `disabled={typed !== session.name}`.
- On confirm, calls the existing `deleteSession(sessionId)` server action. Errors surface inline inside the modal.

### D9 — Typed-confirm reset-session modal (`session-detail.tsx`)

- Replaced the `confirm("Reset session to Ready? ...")` prompt with a typed-confirm `Modal`.
- Title: `Reset session "<name>" to Ready?`.
- Body lists exactly what will be deleted:
  - All game states (called numbers, current stage, current pattern)
  - All recorded winners for this session
  - Any snowball jackpot history captured against winners in this session
- Caveat noted: snowball pot balances and the underlying game configuration are NOT touched.
- Input accepts EITHER `RESET` or the session name. Confirm button enabled when `typed === 'RESET' || typed === session.name`.
- On confirm, calls `resetSession(session.id, resetTyped)` — the typed value is forwarded directly to Wave 2's server action which performs its own validation.

## Verification

- `npx tsc --noEmit` — clean.
- `npm test` — 27/27 passing (no new tests added; no existing tests broken).
- `npm run lint` (owned files only) — clean. Two pre-existing warnings remain in non-owned files (`game-control.tsx`, `player-ui.tsx`) — out of scope for W3C.
- `npm run build` — succeeds.
- Files staged via `git add`. Not committed.

## Out of scope / left alone

- `confirm()` calls for non-destructive admin flows (`Mark as Ready`, `Start Session`, `Duplicate Session`) — not in the brief, kept as-is.
- Host UI (`game-control.tsx`), display, player, login, snowball — outside W3C ownership.
- Server actions — Wave 2 already lands the guards we rely on (`deleteGame`, `deleteSession`, `updateGame` per-game lock, `resetSession(sessionId, confirmationText)` accepting either `RESET` or the session name).
- `sessions/[id]/page.tsx` — already loads `*, game_states(*)` on the games select, so no data-load changes were needed.

## Notes for downstream waves / reviewers

- The `bg-[#005131]` `Input` variant means the red error border `border-destructive border-red-500` is the only visible affordance; consider colour-blind users — the inline `<p>` error message and `aria-invalid` cover the a11y baseline.
- `useFocusTrap` initial focus prefers the close button so screen readers announce the dialog title without trapping users inside a destructive form. If a particular modal needs to autofocus an input instead, use `autoFocus` on that input — the focus trap will then keep the user inside the dialog without overriding their entry point.
- Modal Escape close is now routed via `[data-modal-close]`. If a future modal omits the close button (`showCloseButton={false}`), Escape will not close it. Today every consumer renders the close button.
