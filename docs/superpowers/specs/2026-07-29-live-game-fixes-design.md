# Spec: live game fixes (host control, public screens, timing)

Date: 2026-07-29
Revision: v2, supersedes v1 after developer review
Status: approved for implementation
Complexity: 5 (XL) - 19 source files, 3 migrations, cross-cutting concurrency changes, split into 6 reviewable phases
Source: host report after the live session on 2026-07-28
Review: `docs/superpowers/reviews/2026-07-29-live-game-fixes-design-review.md` (24 findings, all resolved below)

---

## 0. What changed in v2

1. **"Guest screen" means the pub TV at `/display/[sessionId]`**, not the phone follower. Issues 5, 6, 7 and 10 are re-targeted. The phone at `/player/[sessionId]` gets a fitted equivalent of each change so the two surfaces never disagree in front of guests.
2. Every P0 and P1 review finding is resolved in the design rather than left to implementation. The significant additions are atomic database functions for call, undo and record-winner, a client reveal queue so no ball is ever skipped, explicit public load states, an explicit snowball eligibility choice, a host winner-void control, and a deployment plan.
3. Review findings are traced in section 10.

---

## 1. The headline finding

Nine of the ten reported symptoms are real. Two of them (undo confusion, break not refreshing) share a single root cause, and it is the most serious defect in the app:

**In normal visible-tab operation, the one second connection-health re-render repeatedly clears and re-arms the host's three second poll before it can run, while also repeatedly rebuilding the host's Realtime subscription.**

Why:

- `useConnectionHealth()` returns a new object literal on every render and runs `setInterval(() => setNow(Date.now()), 1000)`, forcing a re-render at least once per second (`src/hooks/use-connection-health.ts:30-37`, `61-69`).
- `pollGameState` is `useCallback(..., [gameId, health])`, so it gets a new identity every render, and the polling effect is `useEffect(..., [pollGameState])`. Its `setInterval(..., 3000)` is cleared and re-armed roughly every second, so it does not reach 3000ms while the tab is visible (`game-control.tsx:333-363`, `436-442`).
- The Realtime effect is `useEffect(..., [gameId, health])`, so the `game_states` channel is removed and re-subscribed roughly every second, which is faster than a Supabase channel takes to subscribe (`game-control.tsx:368-432`).

Net effect: the host screen only reliably updates from the initial server render, from the state `callNextNumber` returns in its own response, and from the two `winners` subscriptions, which happen to have stable deps. **Break, undo, pause, resume, stage advance and control changes are effectively invisible to the host until a manual reload.**

The public surfaces are unaffected, because they destructure the stable callbacks (`const { markPollSuccess, markPollFailure, markRealtimeStatus } = health`) and depend on those instead of the object (`player-ui.tsx:74`, `220`, `340`). That is exactly the reported pattern: the TV and phones kept up, the host screen did not.

Production Realtime publication verified as `game_states`, `game_states_public`, `sessions`. This is a client wiring bug, not a database configuration one, **but** the repository migrations do not reproduce that publication state, which is fixed separately (see 4.13).

---

## 2. Decisions of record

Confirmed by the host on 2026-07-29:

| # | Decision |
|---|----------|
| D1 | "Guest screen" is the pub TV at `/display/[sessionId]`. The phone at `/player/[sessionId]` gets the same fixes, sized to fit a small screen. |
| D2 | Undo keeps "ball goes back in the bag": the next call re-draws the same number, and the confirm modal says so plainly. |
| D3 | The enlarged recent-calls strip keeps five balls and may slide sideways rather than dropping to four. |
| D4 | The host does not get an optimistic ball. It appears when the server confirms. |
| D5 | Call-and-response reminders appear on both the host briefing and the pub TV. |
| D6 | A **Void winner** control is added to the host Winners and Prizes list, with a mandatory reason and a confirm step, so the host can clear a blocked undo without leaving the game. |
| D7 | Snowball eligibility becomes an **explicit Eligible / Not eligible choice with no default** whenever a Full House is recorded while the jackpot window is open. |
| D8 | Ship to production tonight: implement, verify, merge to `main`, push, then apply the migrations to Supabase. Code first, migrations second (see section 8). |

Decisions taken by the implementer, recorded because the review asked for them:

| # | Decision | Rationale |
|---|----------|-----------|
| D9 | Rapid calls are permitted, and the public surfaces run a **client-side reveal queue** rather than a persisted per-call event log. | No ball is ever skipped, the newest ball is never early, and each ball gets a minimum time on screen. A per-call event table would be more exact but is a schema and RLS change on the hottest path, on the night before a live test. |
| D10 | `call_delay_seconds` keeps its name and becomes the public reveal delay. The host gap becomes the constant `HOST_MIN_CALL_GAP_MS`. | Avoids a column rename plus trigger and type churn. Mitigated by documenting the meaning in the column comment, the TypeScript type, `CLAUDE.md`, `AGENTS.md` and the architecture docs in the same change. |
| D11 | No Playwright or browser automation in this delivery. | It is a new toolchain on a deadline. Instead: pure helpers extracted and unit tested, plus a mandatory manual evidence checklist in section 9. Recorded as accepted risk R7. |

---

## 3. The reveal model (resolves the timing contradiction)

The old spec promised both "host may call back to back" and "each ball appears exactly three seconds after its call". With a single `last_call_at` for the whole array, those conflict: the pending timer is cancelled whenever a newer snapshot arrives, so several fast calls could appear at once and intermediate balls could be skipped entirely.

**New model.** A pure helper, `src/lib/reveal-queue.ts`, decides how many balls the public surface may show:

```
planReveal({
  serverNumbers,        // called_numbers from game_states_public
  revealedCount,        // how many the client currently shows
  lastCallAt,           // server timestamp of the most recent call
  publicDelayMs,        // call_delay_seconds * 1000
  minDwellMs,           // 1200
  lastRevealAtMs,       // when this client last advanced
  snapImmediately,      // paused_for_validation or status completed
  now,
}) => { revealCount, nextTickInMs }
```

Rules, in order:

1. `serverNumbers.length < revealedCount` (an undo): snap down immediately.
2. `snapImmediately`: reveal everything now. This is a **deliberate, documented exception**: during a claim check and at game end the screens must agree with the host instantly, because a claim is validated against the last called ball.
3. Otherwise reveal at most one ball per tick:
   - the newest ball may not be revealed before `lastCallAt + publicDelayMs`;
   - a backlog ball (any ball that is not the newest) may be revealed once `minDwellMs` has elapsed since this client last advanced.
4. `nextTickInMs` is the delay until the next decision, or null when caught up.

Guarantees: no ball is skipped, the newest ball is never early, every ball is on screen for at least 1.2s, and the state is fully derivable after a reload, a poll or a reconnect because it depends only on the current snapshot.

Honest limitation, recorded: earlier balls have no stored timestamp, so a backlog is **paced**, not individually timed. If the host calls five balls in two seconds, the fifth appears 3s after its own call and the earlier four appear in order at 1.2s intervals before it. Real calling pace is 5 to 10 seconds per ball, so this is a theoretical case.

Device clock skew: reveal timing compares the server `last_call_at` with the browser clock. A phone with a badly wrong clock reveals early or late. Accepted, and the helper clamps the computed wait to the range `[0, publicDelayMs]` so a skewed clock can never delay a ball indefinitely.

**Acceptance wording (replaces the old absolute claim):** each ball is revealed in order, no earlier than 3 seconds after its own server call time, and no ball is skipped, including after polling, reload or reconnect. During a claim check and at game end the screens snap to the server state immediately.

---

## 4. Issue by issue

### 4.1 Issue 1: undo last number confuses the game

| Ref | Finding | Location |
|-----|---------|----------|
| U1 | Host screen never reflects the undo (section 1). The host keeps showing the voided ball and the old count while the TV and phones roll back. That divergence is the confusion. | `game-control.tsx:333-442` |
| U2 | `voidLastNumber` returns no state, so even with Realtime fixed there is a gap. | `host/actions.ts:1393-1452` |
| U3 | No compare-and-set guard on the void update, unlike `callNextNumber`. Two rapid undos, or an undo racing a call, can remove two numbers or discard a legitimate call. | `host/actions.ts:1433-1444` vs `572-584` |
| U4 | No client in-flight guard. A blocking `confirm()` and no `isVoiding` flag, so the double tap that is normal on a phone fires twice. | `game-control.tsx:715-729` |
| U5 | The winner guard is a dead end. It counts winners at `call_count_at_win = numbers_called_count` **without filtering `is_void`**, and tells the host to "delete the winner record first" when nothing in the app deletes winners. | `host/actions.ts:1416-1428` |
| U6 | The winner check and the undo write are separate statements, so a winner inserted between them survives against a rolled-back call count (review F-03). | `host/actions.ts:1416-1444` |
| U7 | Undo puts the ball back in the bag: `number_sequence` is untouched while the count decrements, so the next call re-draws the same ball. Confirmed as intended (D2), but the host is not told. | `host/actions.ts:1430-1431`, `560` |

Verified safe and deliberately unchanged: `voidLastNumber` does not touch `last_call_at`. With the reveal queue, a void before the ball is revealed drops it silently, and a void after reveal snaps the screens back. Recorded so nobody "fixes" it later.

**Fix**

1. Stabilise the host live-update wiring (phase 1).
2. Replace the read-then-write with the atomic RPC `void_last_number(p_game_id)`: it locks the `game_states` row `for update`, asserts controller and status, counts **non-void** winners at the current call count inside the same transaction, decrements, clears win display, and returns the committed row. This closes U3, U5 and U6 in one place.
3. The host applies the returned row immediately through `isFreshGameState`.
4. Replace `confirm()` with an in-app confirm modal that names the ball, states that the next call will re-draw the same ball, and disables while in flight.
5. Blocked-undo message: "Cannot undo because a winner was recorded on this call. Void that winner in the Winners and Prizes list, with a reason, then undo." Paired with D6, which makes that route exist.

**Acceptance**

- Undo updates the host screen within 500ms with no reload, and the TV and phone follow.
- Double-tapping undo removes exactly one ball.
- With a winner on the last ball, undo is refused with a message naming the Winners and Prizes list. After voiding that winner there, undo succeeds.
- A winner recorded concurrently with an undo results in exactly one of the two succeeding, and the other returns a conflict.
- The confirm modal states which ball is voided and that it will be re-drawn.

### 4.2 Issue 2: going on break leaves the host stuck

| Ref | Finding | Location |
|-----|---------|----------|
| B1 | Root cause in section 1. `toggleBreak` returns bare success, so the ON BREAK banner never appears and the button never flips to "Resume Session". | `host/actions.ts:602-639` |
| B2 | The Post Win modal is a trap. `onClose={() => {}}` makes its ✕ and Escape dead, every one of its three buttons can fail and `return` early, and `actionError` renders on the page **behind** the modal. | `game-control.tsx:1210-1238`, `780` |
| B3 | Mutation-time conditions are not binding: prechecks read controller and status, then the write filters only on `game_id`, so a call can commit after a break began (review F-04). | `host/actions.ts` throughout |
| B4 | `advanceToNextStage` reads then writes the stage with no compare-and-set, and `skipStage` trusts the client's stage index and stage count (review F-05). | `host/actions.ts:1061-1126`, `1345-1391` |
| B5 | `recordWinner` inserts the winner and then updates display state as two statements; a failure on the second invites a retry that inserts a second winner (review F-05). | `host/actions.ts:1244-1306` |

**Fix**

1. **Action contract.** Every host mutation gets an explicit contract, published in section 5. Only actions that change `game_states` return a `game_states` row; the others return their own row or nothing.
2. **Binding writes.** Every `game_states` update filters on `controlling_host_id = <caller>` plus the state it asserted (`status`, `on_break`, `paused_for_validation`, and `current_stage_index` or `state_version` where relevant). Zero rows changed returns a structured conflict, `{ success: false, conflict: true, error }`, and the client refreshes state and shows the reason.
3. **Atomic where it matters.** `call_next_number`, `void_last_number` and `record_winner_atomic` become Postgres functions following the existing `atomic_admin_mutations` pattern (`security definer`, `set search_path = public`, `revoke all` then `grant execute to authenticated`, row lock via `for update`). `record_winner_atomic` inserts the winner and updates display state in one transaction, so a partial failure leaves nothing to retry.
4. **`skipStage` stops trusting the client.** It derives the stage index and stage count server-side from `game_states` and `games`, matching `advanceToNextStage`, and its signature drops `currentStageIndex` and `totalStages`.
5. **`advanceToNextStage`** filters on the expected `current_stage_index`, so a double tap cannot skip a stage.
6. **Post Win modal** gets defined states (section 4.3), inline errors with `role="alert"`, in-flight guards on all buttons, and a guaranteed escape.

**Acceptance**

- Pressing "Take Break" flips the banner and the button label immediately, no reload.
- A call attempted after another device started a break is refused with a conflict, and the host screen refreshes to show the break.
- Double-tapping "Continue Playing" advances exactly one stage.
- Killing the network between the winner insert and the display update leaves no winner recorded.
- Any failure inside the Post Win modal is shown inside the modal, and the modal can always be closed.

### 4.3 Post Win modal: complete state definition (resolves review F-06)

The modal opens after a winner is recorded. At that moment the server has `paused_for_validation = true` and a win announcement set, and the client may still hold a validation modal, a `validationResult` and a selection.

| Choice | Server transition | Client transition |
|--------|-------------------|-------------------|
| Continue Playing (not final stage) | `advance_stage`: `current_stage_index + 1`, `paused_for_validation = false`, win display cleared | close Post Win and validation modals, clear selection and result, reset prize text to the new stage's planned prize |
| Move to Next Game (final stage) | end current game, snowball pot settled, start next game, session `active_game_id` updated | close all modals, clear selection, navigate to the next game |
| Continue and Take Break (not final stage) | as Continue Playing, then `on_break = true` | as Continue Playing |
| Take a Break (final stage) | as Move to Next Game, then next game `on_break = true` | as Move to Next Game |
| Validate Another Winner | keep stage, keep `paused_for_validation = true`, **clear win display** so the TV returns to "Checking Claim" | close Post Win, clear selection and result, reopen the validation modal |
| Close and stay paused (new) | no server change: the game stays paused with the announcement showing | close Post Win only. The main pad's "Resume" and "Check Claim" remain available, and the ON PAUSE banner explains the state |

"Close and stay paused" is the guaranteed escape hatch, and it is labelled for what it does rather than the vague "stay on this game". Every choice is in-flight guarded, and a conflict re-reads state and shows which condition failed.

### 4.4 Issue 3: host gets the ball at once, guests three seconds later

Today one column does two jobs: the server's minimum gap between host calls (`host/actions.ts:541-554`) and the public reveal delay (`player-ui.tsx:369`, `display-ui.tsx:391`). Every production row on both tables is `2`.

**Fix**

1. `call_delay_seconds` becomes purely the public reveal delay. Migration sets the default to `3` on both tables, backfills every row to `3`, and adds a `comment on column` recording the meaning. `sync_game_states_public()` already carries the column, so the trigger is unchanged.
2. The host gap becomes `HOST_MIN_CALL_GAP_MS = 400` in `src/lib/call-timing.ts`, passed into `call_next_number` as a parameter. The server-side gap is retained per the project rule, it simply stops costing seconds. The row lock plus the count check inside the function is the real double-call protection.
3. `callNextNumber` becomes `auth.getUser()` plus one RPC. **Corrected count: six external requests become two**, not the three claimed in v1. The authorisation, controller check, state assertions, append and return all happen inside the function.
4. Documentation updated in the same change: column comment, `types/database.ts`, `CLAUDE.md`, `AGENTS.md:61,100,134`, `docs/architecture/data-model.md` and `server-actions.md`.

**Performance target.** p50 under 400ms and p95 under 900ms, measured from the server action being invoked to its response, on the venue network. Measured by a timing log in the action, not asserted by claim. Tap-to-paint adds the browser's own render, which is not part of the target.

**Acceptance**

- Host can call five balls back to back with no "please wait" error.
- Ball appears on the host as soon as the server responds.
- Both public surfaces follow the reveal model in section 3.
- Migration applies cleanly and every row on both tables reads 3.

### 4.5 Issue 4: number 10 nickname

`10: "Starmers Den"` becomes `10: "Andys Den"`, exactly as written by the host. Single occurrence at `game-control.tsx:52`.

`NUMBER_NICKNAMES` moves to `src/lib/number-nicknames.ts` with a unit test, out of the 1347 line client component.

### 4.6 Issue 5: TV hung on a loading message

Root cause: `hasLoaded` is initialised to `initialActiveGameState != null` and the `!hasLoaded` early return short-circuits the whole render (`display-ui.tsx:78`, `521`; `player-ui.tsx:68`, `427`). Before the host starts a game there is no `game_states_public` row, so `hasLoaded` stays false. The poll's "no active game" branch calls `refreshActiveGame(null)` and returns without ever setting it (`display-ui.tsx:258-263`, `132-136`), so "Connecting to game…" is permanent. The TV therefore shows a spinner instead of the "Session Starts Shortly" and House Rules screen, which is exactly what was reported.

Also found (review F-11): `refreshActiveGame` ignores query errors, so an RLS, network or schema failure is indistinguishable from "no game". And a fresh display load with `status = running` and `active_game_id = null`, which happens between games, derives `isWaitingState = false` and leaves the TV with no state to render at all.

**Fix**

1. Replace the boolean with an explicit phase: `'loading' | 'waiting' | 'active' | 'completed' | 'failed'`.
   - `loading` only until the first server answer.
   - `waiting` whenever the session is not completed and there is no active game state. This covers both before the first game and between games, so the TV is never blank.
   - `failed` when a session, game or game-state query errors. Renders a recoverable "Reconnecting to the game" panel, keeps polling, and logs through `logError`. It never masquerades as `waiting`.
   - `completed` from session status.
2. `refreshActiveGame` returns a discriminated result instead of silently setting null, and its errors are surfaced.
3. Add Realtime force-reconnect on `visibilitychange` to both public surfaces, matching the host (`game-control.tsx:446-454`).
4. Add exponential backoff to the session channel on both surfaces, matching the game-state channel.
5. Channel health (review F-12): only the **game-state channel** reports into `useConnectionHealth`. The session and snowball-pot channels are explicitly non-critical, because polling already covers game switches and pot changes, so a failed pot channel can never put a "Reconnecting" banner on the pub TV. Recorded in code comments.

**Acceptance**

- Opening the TV before the host starts shows the waiting screen with House Rules, not a spinner.
- Between games the TV shows the waiting screen, never a blank main area.
- When the host starts, both surfaces switch over within 3 seconds with no reload.
- A forced query failure shows the recoverable panel, not the waiting screen, and recovers by itself when the query succeeds.
- Locking and unlocking a phone recovers live updates within 3 seconds.

### 4.7 Issue 6: recent calls 40 percent bigger at the bottom of the TV

Target is the TV footer strip (`display-ui.tsx:743-762`), not the phone.

| Element | Now | After |
|---------|-----|-------|
| Lead ball | `w-16 h-16 text-[36px]` (4rem, 36px) | `w-[5.6rem] h-[5.6rem] text-[50px]` |
| Trailing balls | `w-12 h-12 text-[27px]` (3rem, 27px) | `w-[4.2rem] h-[4.2rem] text-[38px]` |

A 5.6rem ball does not fit the current `h-32` footer once the "Recent Calls" header row is included, so three coupled values change together:

- footer `h-32` becomes `h-40`;
- the main ball's size calc `calc(100vh - 16rem)` becomes `calc(100vh - 18rem)`;
- the QR badge moves from `bottom-36` to `bottom-44`.

The strip already has `shrink-0` on its items and a fade mask, so fewer balls fit and the rest fade out, which is the intended behaviour on a TV.

**Phone equivalent** (D1): the phone strip (`player-ui.tsx:612-619`) goes up by the same 40 percent, lead `w-14 h-14 text-xl` to `w-[4.9rem] h-[4.9rem] text-[1.75rem]` and trailing `w-12 h-12 text-lg` to `w-[4.2rem] h-[4.2rem] text-[1.575rem]`, keeping five balls with horizontal slide (D3). Review F-18 applies here: `BingoBall` has no `shrink-0`, so as flex children the balls would be squashed instead of overflowing. Both the class and an explicit `min-w`/`min-h` are added. Checked at 320px and 375px, and at 200 percent text zoom.

### 4.8 Issue 7: keep the last ball visible during a claim check, and count the claim on the host

1. **Pub TV.** The full-screen "Checking Claim" overlay hides the ball entirely, because `showActiveGame` requires `!paused_for_validation` (`display-ui.tsx:433`, `627-635`). The overlay gains the last called ball, large, under the caption "Claim must include". The reveal model snaps to the server state on validation, so the ball shown is always the true last call.
2. **Phone.** The ball does stay on screen today, but nothing says it is the number the claim must contain. The "Checking Claim" card gains the same "Claim must include: N" line.
3. **Host validation modal.** A live counter, `8/10`, prominent above the grid with `aria-live="polite"`, plus a tick or cross for "includes the last called ball".

Also fixed here: the client falls back to five required numbers for an unrecognised stage (`?? 5` at `game-control.tsx:263`) while the server rejects unknown stages outright (`host/actions.ts:939-941`). The client now mirrors the server, disabling Check Win and saying the stage is not valid.

### 4.9 Issue 8: call-and-response reminders

New `CALL_RESPONSES` constant in `src/lib/house-rules.ts`:

| Number | Response |
|--------|----------|
| 2 | a quack |
| 11 | a wolf whistle |
| 22 | a double quack |
| 59 | tap your pen on your glass |
| 69 | an ooooooooo |
| 88 | wobble wobble |

**Host briefing** (`pre-game-briefing.tsx`): a "Remind the room" block beside the existing House Rules, first game of the session only.

**Pub TV** (`display-ui.tsx`, inside `renderHouseRulesPanel`): a "Join in" block below the rules, on the waiting, break and session-complete screens. Six full-width lines would overflow, so:

- a two column grid, three rows, each cell reading `2  a quack` with the number bold in the gold accent;
- entries at `clamp(1.1rem, 1.6vw, 1.7rem)`, smaller than the rules, since they are a nudge not a rule;
- the rules list tightens from `space-y-4` to `space-y-3` to buy back the space.

Height budget at 1920x1080 is roughly 808px of main area against about 600px of panel, so it fits. The panel is `overflow-hidden`, so anything that does not fit is clipped silently. This is a screenshot check at 1920x1080 and 1280x720 on all three screens that use the panel, and it is on the mandatory evidence list.

`HOUSE_RULES` itself is unchanged, but the panel's screenshot baseline needs refreshing.

### 4.10 Issue 9: snowball block not centred on the host

`game-control.tsx:840-859`. The block sits inside a `CardContent` that is `items-center text-center`, but is itself `w-full ... flex-col md:flex-row md:justify-between` with the second paragraph hard-coded `text-right`. On a phone that leaves the jackpot line left-aligned and the countdown right-aligned inside a full-width box, which reads as broken.

Fix: `items-center text-center md:flex-row md:justify-between md:text-left` on the container, `text-center md:text-right` on the countdown paragraph.

### 4.11 Issue 10: bigger snowball countdown on the TV

Today the TV's only snowball indicator is one small line in the left footer column (`display-ui.tsx:732-738`), which is not readable from the back of the room.

Fix: a corner badge in the main content area, top right, shown only for snowball games and only while a game is active. It carries a `clamp(3rem, 6vw, 5.5rem)` numeral with a "CALLS LEFT" caption, plus the jackpot amount beneath at `clamp(1.1rem, 1.8vw, 1.6rem)`. On last call or once closed it shows that wording at the same size instead of a number. It sits top right so it never collides with the QR badge bottom left, and the validation and win overlays (z-70 and z-80) cover it as they do everything else. The footer line stays, shortened.

**Phone equivalent** (D1): the existing snowball panel is restructured to jackpot on the left and a `text-6xl` countdown on the right with a small caption.

**Related defect fixed here.** Both surfaces read the raw server count for snowball counters (`player-ui.tsx:568`, `display-ui.tsx:735`) while the "Calls" chip reads the revealed count. With a 3 second reveal delay the countdown would tick **before** the ball appears and spoil it, and the two counters on the same screen would disagree. All public snowball counters move to the revealed count.

---

## 5. Action contract (resolves review F-07)

`ActionResult<T>` gains an optional `conflict?: true` so the client can distinguish "you lost a race, here is fresh state" from "this failed".

| Action | Writes | Atomic boundary | Returns | Client behaviour |
|--------|--------|-----------------|---------|------------------|
| `callNextNumber` | `game_states` | RPC `call_next_number`, row lock | `game_states` row | apply via `isFreshGameState` |
| `voidLastNumber` | `game_states` | RPC `void_last_number`, row lock, winner check inside | `game_states` row | apply, close confirm modal |
| `recordWinner` | `winners` + `game_states` | RPC `record_winner_atomic`, one transaction | `game_states` row | apply, open Post Win |
| `toggleBreak` | `game_states` | bound update, controller plus status | `game_states` row | apply |
| `pauseForValidation` | `game_states` | bound update | `game_states` row | apply |
| `resumeGame` | `game_states` | bound update | `game_states` row | apply, close validation modal |
| `advanceToNextStage` | `game_states` | bound update on expected `current_stage_index` | `game_states` row | apply |
| `skipStage` | `game_states` | bound update, indices derived server-side | `game_states` row | apply |
| `announceWin` | `game_states` | bound update on expected stage | `game_states` row | apply |
| `endGame` | `game_states`, `snowball_pots`, `sessions` | existing sequence, bound `game_states` update | `game_states` row | apply, then navigate |
| `takeControl` | `game_states` | single conditional update, no separate read | `game_states` row | apply |
| `startGame` | `game_states`, `games`, `sessions` | existing sequence | redirect target | navigate |
| `moveToNextGameOnBreak` / `AfterWin` | composite | composite, documented as non-atomic | redirect target | navigate |
| `sendHeartbeat` | `game_states` | bound update | nothing | no local state change |
| `toggleWinnerPrizeGiven` | `winners` | bound update | `winners` row | apply to winner lists only |
| `voidWinnerFromHost` | `winners` | existing `voidWinner`, admin only | `winners` row | refresh winner lists |

The two composite `moveToNextGame*` actions remain non-atomic. They end a game, settle a pot, start the next game and optionally set a break across separate statements. Making them one transaction means moving four business operations into SQL, which is out of scope tonight. Mitigation: they are in-flight guarded on the client, each step already checks its own preconditions and aborts on failure, and their failure mode is a visible half-transition the host can retry rather than silent data loss. Recorded as accepted risk R3.

---

## 6. Additional defects fixed in scope

| Ref | Defect | Fix |
|-----|--------|-----|
| E1 | `revalidatePath('/host/${gameId}')` in 11 actions targets a route that does not exist. | Remove the bogus calls. Keep `revalidatePath('/host')` and add `/host/${sessionId}/${gameId}` only in actions that already hold `sessionId`. No signature changes and no extra queries, per review F-23. |
| E2 | `handleSnowballPotUpdate` counts jackpot winners without filtering `is_void`, so a voided jackpot winner still resets the pot at game end. Financial. | Add `.eq('is_void', false)`. |
| E3 | Client `?? 5` selection-count fallback diverges from the server's hard reject. | Client mirrors the server. |
| E4 | Public snowball counters read the undelayed count. | Move to the revealed count. |
| E5 | Public surfaces lack Realtime reconnect on visibility and session-channel backoff. | Added, with only the game-state channel reporting into health. |
| E6 | `NUMBER_NICKNAMES` is a 60 entry table inside a client component. | Moved to `src/lib/number-nicknames.ts`. |
| E7 | Snowball eligibility auto-tick fights an explicit un-tick. | Replaced by the explicit two-choice control (D7), enforced server-side inside `record_winner_atomic`. |
| E8 | Realtime publication is not reproducible from migrations: the `game_states` statements are commented out. | Idempotent migration asserting all three tables. |
| E9 | Host action failures are invisible in production: `logError` returns early unless `LOG_ERRORS=true`. | New server-only `logActionFailure(action, err)` that always logs with the existing UUID redaction. Applied to every host action failure path, plus an action latency line. |

Explicitly out of scope: 90-ball rules, digital cards, audio calling, winner names, the proxy matcher, RLS policy changes, and any destructive migration. No column or table is dropped.

---

## 7. Files touched

19 source files, 3 migrations, 6 documentation files.

| File | Change |
|------|--------|
| `src/hooks/use-connection-health.ts` | memoise the returned object; document that it must never be a dependency |
| `src/app/host/[sessionId]/[gameId]/game-control.tsx` | stable deps, apply returned state everywhere, undo confirm modal, in-flight guards on every mutation, claim counter, Post Win states plus inline errors, snowball centring, explicit eligibility choice, void-winner control, nickname import, selection-count parity, conflict handling |
| `src/app/host/actions.ts` | RPC wrappers for call/undo/record-winner, bound updates elsewhere, `skipStage` signature, conflict results, `is_void` filters, `revalidatePath` cleanup, failure logging, latency logging |
| `src/app/display/[sessionId]/display-ui.tsx` | load phases, reconnect on visible, session backoff, reveal queue, 40 percent footer balls plus footer and QR geometry, snowball corner badge, last ball in the validation overlay, "Join in" grid, revealed-count counters |
| `src/app/player/[sessionId]/player-ui.tsx` | same as display, sized for a phone |
| `src/app/display/[sessionId]/page.tsx` | pass a typed initial load result |
| `src/app/player/[sessionId]/page.tsx` | pass a typed initial load result |
| `src/app/admin/sessions/[id]/actions.ts` | export `voidWinner` for host use, confirm its admin guard, `is_void` filter on pot settlement |
| `src/components/host/pre-game-briefing.tsx` | "Remind the room" block |
| `src/components/ui/bingo-ball.tsx` | `shrink-0` and explicit minimums |
| `src/types/actions.ts` | `conflict?: true` |
| `src/types/database.ts` | RPC signatures, `call_delay_seconds` comment |
| `src/lib/reveal-queue.ts` | new, pure |
| `src/lib/call-timing.ts` | new: `HOST_MIN_CALL_GAP_MS`, `DEFAULT_PUBLIC_CALL_DELAY_SECONDS`, `PUBLIC_MIN_DWELL_MS` |
| `src/lib/number-nicknames.ts` | new, with `10: "Andys Den"` |
| `src/lib/house-rules.ts` | `CALL_RESPONSES` |
| `src/lib/log-action-failure.ts` | new, server-only, always logs |
| `src/lib/reveal-queue.test.ts` | new |
| `src/lib/call-timing.test.ts`, `src/lib/number-nicknames.test.ts`, `src/lib/house-rules.test.ts` | new |
| `supabase/migrations/20260729120000_atomic_host_mutations.sql` | new: `assert_is_host`, `call_next_number`, `void_last_number`, `record_winner_atomic` |
| `supabase/migrations/20260729120100_public_reveal_delay.sql` | new: default 3, backfill, column comments |
| `supabase/migrations/20260729120200_ensure_realtime_publication.sql` | new: idempotent publication assertions |
| `CLAUDE.md`, `AGENTS.md`, `docs/architecture/data-model.md`, `docs/architecture/server-actions.md`, `docs/architecture/overview.md` | timing semantics, the health-hook gotcha, the new RPCs |

---

## 8. Phasing, deployment and rollback

Phases are **separately reviewable**. They are not separately deployable: phase 4 depends on phase 3's migration for the 3 second value, and phase 2's client changes depend on phase 2's action contract. All phases ship in one release tonight.

| Phase | Contents | Risk |
|-------|----------|------|
| 1 | Host live-update root fix, health hook memo, docs gotcha | Low. Smallest diff, highest severity |
| 2 | Migration 1 (atomic host RPCs), action contract, bound updates, undo flow, Post Win states, void-winner control, explicit eligibility | **High: data integrity and financial** |
| 3 | Migration 2 (public reveal delay), `HOST_MIN_CALL_GAP_MS`, round-trip reduction, docs | Medium: timing semantics |
| 4 | Reveal queue, public load phases, reconnect and backoff, revealed-count counters | Medium: guest-visible timing |
| 5 | TV geometry (footer, QR, ball calc), 40 percent balls, snowball badge, validation ball, "Join in" grid, phone equivalents | Low, but needs screenshot evidence |
| 6 | Content and host layout: `Andys Den`, nickname extraction, claim counter, snowball centring, selection-count parity, migration 3 | Low |

**Deployment order** (D8). The three migrations do **not** all go on the same side of the deploy. Two are additive and must land first; one changes the meaning of an existing value and must land last.

1. Verify locally: `npm run lint`, `npx tsc --noEmit`, `npm test`, `npm run build`.
2. Apply `20260729120000_atomic_host_mutations.sql`. Purely additive: it creates four functions the currently deployed code never calls.
3. Apply `20260729120200_ensure_realtime_publication.sql`. Also additive, and idempotent against the current state.
4. Merge to `main` and push. Vercel deploys.
5. Confirm the deployment is live and serving the new code.
6. **Then** apply `20260729120100_public_reveal_delay.sql`.
7. Run the post-deploy verification queries in section 9.

`npx supabase db push` cannot be used. The remote migration history has eight versions with no matching local file, three of which exist only in production, so the CLI aborts before parsing anything. Apply via `apply_migration` instead. Recovering those three files is tracked separately and is a prerequisite for ever rebuilding this project from the repo.

Why the split, in both directions:

- **Functions missing, new app live**: `callNextNumber`, `voidLastNumber` and `recordWinner` would all fail, because they call functions that do not exist. This is the worst case and it is why steps 2 and 3 come before the deploy.
- **New reveal delay, old app live**: the old app reads `call_delay_seconds = 3` as its *host* gap, so the host would be forced to wait 3 seconds between every call. Annoying, not dangerous, but it is why step 6 comes after the deploy.
- **New app, old reveal delay**: the new app uses its own 400ms host gap and reads `call_delay_seconds = 2`, so the public reveal is 2 seconds instead of 3. Correct behaviour, slightly early. This is the only intermediate state, and it exists between steps 4 and 6.
- **Rollback**: revert the merge and redeploy. The database can stay as it is, except that the old app would then enforce a 3 second host gap, so a rollback must also run `update public.game_states set call_delay_seconds = 2; update public.game_states_public set call_delay_seconds = 2;`. The new RPCs are additive and harmless if unused. Rollback SQL is committed alongside the migrations as `docs/superpowers/plans/2026-07-29-rollback.sql`.

Timing: applied overnight with no session running, so no live game is disturbed. No backup is taken because no data is destroyed; the only data change is one integer column moving from 2 to 3 on 60 rows per table, and the rollback statement above reverses it.

---

## 9. Verification

**Automated, per phase:** `npm run lint`, `npx tsc --noEmit`, `npm test`, `npm run build`. New pure helpers carry unit tests: reveal queue (ordering, no-skip, undo snap, validation snap, clock skew clamp, backlog pacing), call timing constants, nicknames, call responses.

**Post-deploy database checks:**

```sql
-- all three functions exist
select proname from pg_proc where proname in
  ('assert_is_host','call_next_number','void_last_number','record_winner_atomic');
-- reveal delay applied
select distinct call_delay_seconds from public.game_states;
select distinct call_delay_seconds from public.game_states_public;
-- mirror consistent
select count(*) from public.game_states gs join public.game_states_public p
  using (game_id) where gs.state_version <> p.state_version;
-- publication complete
select tablename from pg_publication_tables
 where pubname='supabase_realtime' and schemaname='public';
```

**Mandatory manual evidence** (accepted in place of browser automation, D11). Run against a test session with `is_test_session = true` so the snowball pot is untouched, host on a phone, TV on a screen, follower on a second phone:

1. TV before the host starts: waiting screen with House Rules and the "Join in" grid, no spinner.
2. Start the game. TV and phone switch within 3 seconds without a reload.
3. Call one ball: host shows it on server response, TV and phone show it 3 seconds later.
4. Call five balls back to back: no "please wait" error, and all five appear in order on both public surfaces with none skipped.
5. Undo: host, TV and phone roll back within 500ms. The next call re-draws the same ball, as the confirm modal said.
6. Double-tap undo: exactly one ball removed.
7. Take a break: host banner and button flip immediately. TV shows Break Time with rules and the "Join in" grid.
8. Resume, then check a claim: host shows `n/10` counting up, the TV overlay shows the last ball under "Claim must include", the phone card shows the same.
9. Record a winner on a snowball Full House with the window open: the eligibility choice is forced, no default.
10. In the Post Win modal, exercise every button including "Close and stay paused". Any error shows inside the modal.
11. Snowball TV badge readable from the back of the room, and its count does not move before the ball appears.
12. Host snowball panel centred on a phone.
13. Lock and unlock the follower phone: updates resume within 3 seconds.
14. Screenshots at 1920x1080 and 1280x720 of the TV waiting, break and session-complete screens: nothing clipped.
15. Phone recent-calls strip at 320px and 375px, and at 200 percent text zoom: balls stay circular and slide rather than squash.

Accessibility pass: keyboard through the undo confirm, validation, winner, Post Win and void-winner modals; focus returns on close; Escape closes what should close; claim counter and action errors announced; touch targets at least 44px; the added TV badge and grid honour `prefers-reduced-motion`.

---

## 10. Review traceability

| Finding | Resolution |
|---------|-----------|
| F-01 rapid-call reveal impossible | Section 3: client reveal queue, acceptance reworded, limitation recorded |
| F-02 no Admin winner-void UI | D6: host Winners and Prizes gains Void with reason plus confirm |
| F-03 winner check and undo not atomic | `void_last_number` RPC, row lock, winner check inside the transaction |
| F-04 mutation conditions not binding | Section 5: every write bound to controller and asserted state, conflict results |
| F-05 not idempotent or transactional | RPCs for call/undo/record-winner, bound stage updates, `skipStage` stops trusting the client, in-flight guards, composite actions declared as accepted risk R3 |
| F-06 "Stay on this game" undefined | Section 4.3: full state table, renamed to "Close and stay paused" |
| F-07 contradictory return contract | Section 5: explicit contract table |
| F-08 round-trip claim wrong | Section 4.4: corrected to six requests becoming two, with a measurable p50/p95 target |
| F-09 `call_delay_seconds` semantics | D10: name kept, meaning documented in the column comment, types, `CLAUDE.md`, `AGENTS.md` and architecture docs |
| F-10 timing exceptions and clock skew | Section 3: validation and completion snap documented, skew clamped |
| F-11 loading fix hides outages | Section 4.6: explicit `loading / waiting / active / completed / failed` phases |
| F-12 reconnect underspecified | Section 4.6: one reconnect lifecycle, only the game-state channel reports into health |
| F-13 publication not reproducible | E8: idempotent migration |
| F-14 migration and rollback missing | Section 8: order, both compatibility directions, rollback SQL, timing |
| F-15 dry run proves nothing | Section 9: post-deploy SQL assertions on functions, defaults, mirror and publication |
| F-16 tests do not cover the defects | Section 9: pure helpers extracted and tested, mandatory manual evidence, R7 recorded |
| F-17 snowball eligibility unconfirmed | D7: explicit two-choice, no default, enforced server-side |
| F-18 overflow not guaranteed | Section 4.7: `shrink-0` plus minimums on `BingoBall`, tested at 320px and 200 percent zoom |
| F-19 accessibility missing | Section 9: accessibility pass defined |
| F-20 no observability | E9: `logActionFailure` always logs, plus latency logging |
| F-21 scope claims inaccurate | Section 7 recounted to 19 source files and 3 migrations, section 8 states phases are reviewable not independently deployable, risk classified |
| F-22 "no open questions" unsupported | Section 2: every item is now a dated decision with an owner |
| F-23 `revalidatePath` unspecified | E1: bogus calls removed, concrete paths only where `sessionId` is already held |
| F-24 spec not under version control | Committed with the review in phase 1 |
| O-01 host state machine | Deferred. Section 4.3 defines the transitions without a rewrite, so the root fix stays reviewable. Recorded as follow-up |
| O-02 share public live-state logic | Partially taken: the reveal queue is shared and tested. Full `usePublicLiveGame` extraction deferred as follow-up |
| O-03 remove `hasLoaded` | Taken, replaced by explicit phases |
| O-04 centralise mutation handling | Partially taken: a typed `applyMutationResult` helper on the host, action-specific transitions left explicit |
| O-05 responsive sizing instead of literal 40 percent | Not taken. The host asked for 40 percent and confirmed it (D3). Acceptance is measured rendered size |

---

## 11. Release record (2026-07-30, early hours)

Shipped. Verification at each step:

| Step | Result |
|------|--------|
| Local pipeline | lint clean, `tsc --noEmit` clean, 59 tests passing (was 35), production build succeeds |
| Adversarial review | two independent passes, 26 findings. Both blockers and all four high findings fixed before release, in commits `69a87d7` and `8e59560` |
| Migration `20260729120000` atomic host mutations | applied before deploy, 4 functions present, all `security definer` |
| Migration `20260729120200` realtime publication | applied before deploy, 3 tables published |
| Migration `20260729120300` snowball audit and settlement guard | applied before deploy, `game_id` column, partial unique index and admin INSERT policy all present |
| Merge and push | `0b1b5bf` on `main`, pushed to `github.com/peterjpitcher/BingoBlast` |
| Migration `20260729120100` public reveal delay | applied after push. `call_delay_seconds` is 3 on both tables, mirror consistent |
| Data integrity | 87 winner rows and 60 game-state rows unchanged, 0 mirror version mismatches, 0 mirror delay mismatches |

**Deployment not verified.** The `origin` remote (`peterpitcher/BingoBlast`) does not exist and was not used; the working remote is `alt` (`peterjpitcher/BingoBlast`), whose `main` matched the pre-work commit, so it is the live repository. `NEXT_PUBLIC_SITE_URL` is not set in `.env.local` and the documented example origin does not resolve, so the Vercel deployment could not be confirmed from here. Migration `20260729120100` was applied without that confirmation on the basis that no session was running, so the only intermediate state (the previously deployed code reading 3 as its host gap) could not affect anyone. **Confirm the deployment succeeded before the next live session.**

The `origin` remote should be corrected or removed, since a push to it fails.

## 12. Accepted risks

| # | Risk | Mitigation |
|---|------|-----------|
| R1 | Backlogged balls are paced rather than individually timed | Real pace is 5 to 10 seconds per ball. No ball is skipped and the newest is never early |
| R2 | Device clock skew shifts reveal timing | Wait clamped to `[0, publicDelayMs]` |
| R3 | `moveToNextGame*` remain non-atomic | Each step checks preconditions and aborts; failures are visible and retryable; in-flight guarded |
| R4 | New database with old app forces a 3 second host gap | Code deploys before the migration; rollback SQL provided |
| R5 | TV panel clips rather than scrolls if the "Join in" grid is too tall | Screenshot evidence at two resolutions on all three screens is mandatory |
| R6 | Explicit eligibility adds a step for the host mid-game | Two large buttons, prominent jackpot-window warning already present |
| R7 | No browser automation, so UI regressions rely on manual evidence | 15 step manual checklist, evidence retained; Playwright recorded as a follow-up |
| R8 | Large release the night before a production test | Phased commits so any single phase can be reverted, plus a documented rollback path |
