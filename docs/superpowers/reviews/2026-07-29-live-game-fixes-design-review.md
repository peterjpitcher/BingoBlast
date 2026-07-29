# Developer review: live game fixes specification

Review date: 2026-07-29  
Specification reviewed: `docs/superpowers/specs/2026-07-29-live-game-fixes-design.md`  
Review outcome: **Not ready for implementation without material revision**

## 1. Review scope and method

This is a separate review. The original specification was not edited.

The review checked the specification against:

- the host, player and display implementations;
- host and admin server actions;
- Supabase migrations, triggers, RLS and Realtime setup;
- shared timing, state-version, connection-health and snowball helpers;
- the current test setup and delivery files.

Baseline checks on the unchanged code all passed:

- `npm test`: 35 tests passed;
- `npm run lint`: passed;
- `npx tsc --noEmit`: passed.

Those checks do not cover the live UI, server-action races, database concurrency, Realtime recovery or migrations.

### Priority scale

- **P0 — Blocker:** implementation could be incorrect, unsafe or unable to meet an acceptance criterion.
- **P1 — High:** must be resolved or explicitly accepted before implementation approval.
- **P2 — Medium:** should be resolved before release.
- **P3 — Low:** useful improvement with limited delivery risk.

## 2. Executive assessment

The specification is strong at identifying the main host subscription defect and mapping many visible symptoms to current code. The proposed stable hook dependencies, immediate application of returned state, stale-state protection, undo confirmation, public waiting screens and delayed snowball counters are sensible directions.

It is not yet implementation-ready. Four issues are blockers:

1. The current data model cannot reveal several rapid calls individually three seconds after each call.
2. The required “void the winner in Admin” recovery has no Admin UI, so its acceptance test cannot be completed.
3. The proposed undo winner check and compare-and-set are not one atomic operation, so a winner and an undo can still race.
4. Post-win and stage-changing actions are neither idempotent nor transactional; double actions or retries can skip stages, duplicate winners or update a snowball pot more than once.

The specification also needs an exact action-response contract, a decision on the meaning of `call_delay_seconds`, explicit Post Win workflow states, realistic timing criteria, database and browser-level tests, a migration/rollback plan, and production monitoring.

## 3. Confirmed issues

### F-01 — Per-call three-second reveal is impossible with the proposed state model

- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Functional / Data model / Timing
- **Relevant section:** Issue 3; Issue 10; Verification steps 3–4; Assumption 2
- **Description:** The specification requires the host to call several numbers quickly while every public number appears three seconds after its own call. The database stores only one `last_call_at` value for the whole `called_numbers` array.
- **Rationale/evidence:** `player-ui.tsx:342-406` and `display-ui.tsx:359-430` cancel the previous timeout whenever a newer snapshot arrives. When the final timeout runs, it applies the full latest array. Five calls made 400ms apart can therefore appear together after the last call, and earlier calls can be delayed longer than three seconds. Their individual call times cannot be reconstructed after a poll or reconnect.
- **Impact:** Acceptance steps 3 and 4 can contradict each other. Public screens may jump several numbers at once, skip the visual display of intermediate balls, or show incorrect countdown timing.
- **Recommended action:** Decide one of these designs before implementation:
  1. Keep a minimum server call gap at or above the public delay, which is the simplest safe option.
  2. Persist a timestamped call event for every number and let public clients process an ordered reveal queue.
  3. Explicitly permit batched public catch-up and change the acceptance criteria so individual three-second timing is not promised.
  
  If rapid calling remains required, option 2 is the only design that preserves every ball across Realtime, polling, reload and reconnect.
- **Open questions:** What does “back to back” mean in milliseconds? Must every intermediate ball be visible for a minimum duration? What should a newly opened or reconnected phone do with overdue queued calls?

### F-02 — The Admin winner-void recovery does not exist in the UI

- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Functional / Operational recovery
- **Relevant section:** Issue 1, U5; Issue 1 acceptance
- **Description:** The proposed error tells the host to void a winner in Admin, but no Admin screen invokes `voidWinner`.
- **Rationale/evidence:** `src/app/admin/sessions/[id]/actions.ts:357-378` defines the action. The winner table in `session-detail.tsx:350-403` only displays status. A repository-wide search finds no UI import or call of `voidWinner`.
- **Impact:** A winner recorded against the latest call remains a dead end. The stated acceptance test cannot be performed, and the live game may stop while staff search for a control that is not present.
- **Recommended action:** Add an Admin winner-void control with a confirmation modal, mandatory reason, in-flight guard, success/error feedback and page revalidation. Add a direct, clearly labelled path from the host error to the relevant Admin session when the signed-in user is an admin. If ordinary hosts cannot access Admin, provide an agreed escalation path or a narrowly authorised host recovery action with an audit reason.
- **Open questions:** Who is expected to perform the void during a live event? Are all hosts also admins? Should voiding a winner reverse prize-given or snowball effects?

### F-03 — Winner check and undo are still not atomic

- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Data integrity / Concurrency
- **Relevant section:** Issue 1, U3–U5; proposed undo fix
- **Description:** Adding `.eq('numbers_called_count', ...)` protects the number count, but it does not make the winner check and undo one transaction.
- **Rationale/evidence:** A winner can be inserted after the proposed `winners` count query but before the `game_states` update. The winner insert does not change `numbers_called_count`, so the undo compare-and-set can still succeed. The result is a non-void winner recorded at a call count that has been rolled back.
- **Impact:** Winner audit data and live game state can disagree. This can affect prize handling and snowball decisions.
- **Recommended action:** Perform the winner check and undo under a database transaction and lock the game-state row. `recordWinner` must use the same lock or an equivalent database constraint so it cannot insert during the undo transaction. Return the committed row from that transaction.
- **Open questions:** Should an undo be permitted after a stage has advanced or a prize has been marked as given? Which related state must be reversed?

### F-04 — Mutation-time controller and game-state conditions are not binding

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Security / Concurrency / Data integrity
- **Relevant section:** Headline fix; Issue 1; Issue 2; Issue 3
- **Description:** Host actions check controller ownership and state before the write, but the write itself usually filters only by `game_id`. The specification only adds a number-count guard to undo.
- **Rationale/evidence:** RLS permits any host/admin to update `game_states`. `requireController()` reads ownership separately. A controller change, break, validation pause or status change can occur between that read and a later update. For example, `callNextNumber` can pass its prechecks, then write after another action has put the game on break because its update does not require `on_break = false`, `paused_for_validation = false`, `status = in_progress` and the same controller.
- **Impact:** A stale host can mutate the game after losing control. Calls can be committed during a break or claim check. Returning the updated row does not prevent this.
- **Recommended action:** Prefer atomic database functions for call, undo, take-control and stage transitions. At minimum, bind controller ID, status, break/pause state and expected version/count in the update filter, and return a structured conflict when zero rows change. Make `takeControl` itself an atomic conditional update.
- **Open questions:** Is a brief overlap between two host devices ever acceptable? Should conflicts automatically refresh the losing host and show who currently has control?

### F-05 — Post-win, winner and stage changes are not idempotent or transactional

- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Data integrity / Financial risk / Error handling
- **Relevant section:** Issue 2; Phases 2 and 5; Verification steps 8–9
- **Description:** The specification fixes double-tap protection only for undo. Post Win buttons and stage actions can still be invoked twice, and several business transitions are multi-step operations without a transaction.
- **Rationale/evidence:** `advanceToNextStage` reads then writes the stage without compare-and-set. `skipStage` trusts client-supplied stage index and total stages. `moveToNextGame*` can end a game, update a snowball pot, start another game and toggle a break across separate requests. `recordWinner` inserts a winner before updating display state; if the second write fails, retrying can add another legitimate-looking winner. Multiple winners are valid, so a simple unique constraint is not available.
- **Impact:** Double taps, request retries or two host tabs can skip a stage, duplicate a winner, roll/reset a pot twice, or leave a half-completed transition. Snowball pot errors have direct financial impact.
- **Recommended action:** Add in-flight guards to every modal action, but do not rely on the client. Give each logical transition a server idempotency key and execute its related database changes in one transaction/RPC with expected state/version checks. Return the committed result and an explicit “already applied” result on replay.
- **Open questions:** What uniquely identifies a legitimate second winner versus a retry? Which transitions must be reversible by an admin?

### F-06 — “Stay on this game” has no defined resulting state

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Functional / Workflow / UX
- **Relevant section:** Issue 2, Post Win modal fix
- **Description:** Closing only the Post Win modal leaves the validation modal, `validationResult`, selected numbers and server `paused_for_validation` state behind.
- **Rationale/evidence:** The Post Win modal is layered on top of an existing validation flow. `recordWinner` keeps the game paused and sets win display state. The proposed `setShowPostWinModal(false)` does not say whether to resume calls, clear the announcement, keep the valid claim visible, or advance the stage.
- **Impact:** The host can land on another blocking modal, re-open “Record Winner” and create a duplicate, or remain paused without a clear next action. The button label promises a state transition that has not been specified.
- **Recommended action:** Define the complete state transition for every Post Win choice. If there is no valid need to remain on the same stage, remove “Stay on this game.” If it is needed for multiple winners, rename it to that purpose and specify exactly which client and server fields remain or reset.
- **Open questions:** Does “stay” mean validate another winner, continue calling on the same stage, or merely dismiss the message? Should the public win announcement remain visible?

### F-07 — The “return updated state from every mutation” contract is contradictory

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** API contract / Architecture
- **Relevant section:** Issue 2 fix; Files touched; Phase 2
- **Description:** The specification says all listed actions should chain `.select('*').single()` and that clients should apply the result through `isFreshGameState`, but the listed actions do not all update `game_states`.
- **Rationale/evidence:** `toggleWinnerPrizeGiven` updates `winners`, not `game_states`. Composite move actions update several rows and then navigate. `recordWinner` inserts a winner and later updates game state. `takeControl` should return game state, while prize toggling should return a winner. Heartbeats change `game_states` but should not cause local workflow updates.
- **Impact:** Developers must guess return types and client behaviour. A broad mechanical change could return the wrong row type or create unnecessary state churn.
- **Recommended action:** Add an action contract table with: action name, tables changed, required preconditions, atomic boundary, exact success type, conflict type, local client update, navigation/revalidation behaviour and whether it is idempotent. Exclude actions that do not need a game-state snapshot.
- **Open questions:** Which actions are expected to update the current page immediately, and which always navigate away?

### F-08 — The call round-trip claim is incorrect and no performance target is defined

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Performance / Delivery
- **Relevant section:** Issue 3
- **Description:** The proposed change does not reduce six Supabase round trips to three.
- **Rationale/evidence:** `authorizeHost` performs `auth.getUser()` and a profile query. A combined game-state/controller read is a third request and update-with-return is a fourth. Removing the separate controller read and re-read therefore reduces six requests to four, not three.
- **Impact:** The expected latency improvement is overstated. The host may still miss the implied 500ms experience on pub Wi-Fi.
- **Recommended action:** Correct the estimate and define a measurable target such as p50/p95 action latency under an agreed network profile. If fewer requests are required, use one authenticated database RPC for authorisation, controller/state validation and mutation after `getUser()`, then measure it.
- **Open questions:** Is 500ms measured from tap to paint, or from successful server response to paint? What is the acceptable p95 on the actual venue network?

### F-09 — `call_delay_seconds` changes meaning and conflicts with project rules

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Architecture / Documentation / Maintainability
- **Relevant section:** Issue 3; Assumption 4; Files touched
- **Description:** The specification changes `call_delay_seconds` from a server call-gap value into a public reveal delay while keeping its old name.
- **Rationale/evidence:** Current code, `AGENTS.md` and `CLAUDE.md` explicitly say the server gap is derived from this column. The specification updates only `CLAUDE.md`, leaving the authoritative project instructions and database meaning inconsistent.
- **Impact:** Future work can accidentally re-couple the behaviours or “fix” the server to use the column again. The implementation would violate current project guidance unless that guidance is deliberately changed.
- **Recommended action:** Prefer explicit names such as `public_reveal_delay_seconds` and `HOST_MIN_CALL_GAP_MS`. If retaining the column, update schema comments, TypeScript comments, `AGENTS.md`, `CLAUDE.md` and architecture documentation in the same change, and record the compatibility decision.
- **Open questions:** Is avoiding one new column more important than preserving clear semantics? Is the public delay intended to be globally fixed or configurable per game?

### F-10 — The three-second rule has unrecorded exceptions and uses unsynchronised clocks

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Timing / Functional ambiguity
- **Relevant section:** Issues 3 and 7; Acceptance criteria
- **Description:** Public delay logic immediately copies all server calls when validation starts or the game completes. It also compares a server timestamp with the guest device clock.
- **Rationale/evidence:** `player-ui.tsx:351-357` has an immediate-sync branch for `paused_for_validation` and `completed`; display has the same pattern. A claim made within the delay therefore reveals the ball early. `last_call_at` is created by the application server, while reveal timing uses browser `Date.now()`, so a phone with a wrong clock can reveal early or late.
- **Impact:** “Each ball appears three seconds after the host called it” is not consistently true, and timing can differ across phones.
- **Recommended action:** State the intended validation/completion exception explicitly. For strict timing, base the queue on database-generated timestamps and define a clock-skew strategy. At minimum, add tolerance and device-clock tests.
- **Open questions:** Must the claimed ball be revealed immediately during validation even if three seconds have not elapsed? Which requirement wins?

### F-11 — The loading fix can hide outages as “Waiting for Host”

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Error handling / Reliability / Functional
- **Relevant section:** Issue 5
- **Description:** Setting `hasLoaded` in every terminal branch does not distinguish “there is no active game” from “the game or state query failed.”
- **Rationale/evidence:** `refreshActiveGame` currently ignores query errors and treats missing rows as null state. With the proposed change, public users can see a normal waiting screen during an RLS, network, schema or data error. Also, a fresh display load with `session.status = running` and `active_game_id = null` derives `isWaitingState = false`, leaving no main state after the spinner is removed.
- **Impact:** Real failures become silent, and the TV can be blank between games or after a partial transition.
- **Recommended action:** Use an explicit load state such as `loading | waiting | active | failed | completed`. Handle and log game/state query errors separately, show a recoverable connection/error state, and derive waiting consistently as “not completed and no active game” unless a different inter-game screen is specified.
- **Open questions:** What should the TV and phone show during a database error? Is a running session with no active game a normal break or an invalid state?

### F-12 — Reconnect behaviour for several channels is underspecified

- **Status:** Confirmed issue
- **Priority:** P2
- **Type:** Integration / Reliability
- **Relevant section:** Issue 5; Phase 4
- **Description:** The proposed session-channel backoff and visibility reconnect do not define how they interact with game-state and pot channels or connection health.
- **Rationale/evidence:** `useConnectionHealth` has one Realtime status, but each surface can have session, game-state and snowball-pot channels. If multiple channels report into one status, a healthy channel can hide a failed critical channel, or an optional channel can mark the whole page unhealthy.
- **Impact:** The banner and auto-refresh may report the wrong state, and reconnect code may create duplicate channels or unnecessary churn.
- **Recommended action:** Identify critical channels and track them separately, or deliberately treat polling as the health source for session changes. Define one reusable reconnect lifecycle, including cleanup, visibility handling, backoff reset and maximum retry behaviour.
- **Open questions:** Is a failed pot channel page-critical? Should session polling make a separate session Realtime channel optional?

### F-13 — Production Realtime configuration is not reproducible from migrations

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Integration / Environment drift / Deployment
- **Relevant section:** Headline finding; Verification
- **Description:** The specification says production has `game_states`, `game_states_public` and `sessions` in the Realtime publication, but repository migrations do not ensure all three.
- **Rationale/evidence:** The sessions migration adds `sessions`; the public-state migration adds `game_states_public`; the `game_states` publication statements are commented out. A new or rebuilt environment can therefore lack host Realtime even after the React dependency fix.
- **Impact:** Staging or disaster-recovery environments may fail differently from production, and the root defect can appear only partially fixed.
- **Recommended action:** Add an idempotent migration or provisioning check for every required publication table. Record the production verification query and expected result in the release checklist.
- **Open questions:** Was `game_states` enabled manually in production? Which environment is the source of truth?

### F-14 — Migration sequencing, rollback and live-session safety are missing

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Migration / Deployment / Operational risk
- **Relevant section:** Issue 3; Phase 3; Assumption 5
- **Description:** The migration backfills all rows and the phase says “database first,” but no deployment window, compatibility matrix or rollback sequence is provided.
- **Rationale/evidence:** With the old application and the new value, the host gap becomes three seconds until the new code is live. Updating `game_states` also triggers mirror updates and Realtime events. A migration during an active call delay can reschedule the visible ball. Rolling the app back while keeping the database change restores a three-second host gap.
- **Impact:** A technically compatible deployment can still disrupt a live game. Rollback behaviour is unclear.
- **Recommended action:** Deploy only outside a live session. Document old-app/new-database and new-app/old-database behaviour, pre/post queries, backup expectations, rollback SQL and application rollback order. Consider changing defaults first and backfilling only non-live rows, then updating live/new rows in a controlled window.
- **Open questions:** Can deployment be guaranteed between events? Must historical completed rows be changed at all?

### F-15 — Database verification does not execute the migration

- **Status:** Confirmed issue
- **Priority:** P2
- **Type:** Testing / Migration
- **Relevant section:** Issue 3 acceptance; Verification
- **Description:** `supabase db push --dry-run` checks the planned push but does not prove the migration executes correctly or that triggers and data end in the expected state.
- **Rationale/evidence:** The repository has no automated migration test or local database integration test. The Supabase CLI is also invoked through unpinned `npx`.
- **Impact:** SQL syntax, permissions, publication state, trigger side effects or backfill errors can reach deployment despite a clean dry run.
- **Recommended action:** Pin the CLI version. Run a local reset/apply test, assert defaults and existing rows, verify `game_states_public` matches `game_states`, and test rollback or forward-fix SQL. Run a production preflight query before promotion.
- **Open questions:** Is a disposable staging Supabase project available for release rehearsal?

### F-16 — The test plan does not cover the defects being fixed

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Testing / Quality
- **Relevant section:** Files touched; Verification
- **Description:** The only proposed automated tests cover nickname and house-rule constants.
- **Rationale/evidence:** The root defect is hook/effect identity; the highest risks are action races, delayed-call sequencing, modal state and Realtime recovery. None has an automated test. The current 35 passing tests are pure helper tests and do not cover UI or actions.
- **Impact:** The implementation can pass every listed automated check while the original live failures remain or new race conditions are introduced.
- **Recommended action:** Add:
  - a pure tested reveal-queue/timing helper;
  - server-action/RPC concurrency tests for call, undo, winner and stage transitions;
  - browser tests for host immediate updates, waiting screens, validation, Post Win errors and visibility recovery;
  - deterministic screenshot tests at the required viewports;
  - migration integration tests.
  
  If browser infrastructure is deliberately out of scope, require stored manual evidence and two-person sign-off.
- **Open questions:** Is adding Playwright acceptable, or must delivery remain manual-only?

### F-17 — Snowball eligibility behaviour is a material unconfirmed product change

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Business rule / Financial risk
- **Relevant section:** Additional defect E7; Phase 5
- **Description:** Removing the auto-tick changes jackpot-award behaviour but is not included in the recorded host decisions and is labelled low risk.
- **Rationale/evidence:** An unchecked default can cause an eligible winner to miss a jackpot. An auto-checked default can award an ineligible winner. Both are financially significant, and the system cannot derive attendance.
- **Impact:** A host mistake can create a payout dispute.
- **Recommended action:** Require an explicit two-choice decision—“Eligible” or “Not eligible”—before recording a Full House in an open snowball window. Do not use a meaningful default. Add server validation and a dedicated acceptance test. Obtain host/business-owner sign-off.
- **Open questions:** Who verifies attendance, and what is the recovery process after a wrong eligibility choice?

### F-18 — The recent-ball overflow claim is not guaranteed by the proposed classes

- **Status:** Confirmed issue
- **Priority:** P2
- **Type:** Responsive UI / Functional detail
- **Relevant section:** Issue 6; Decision 3
- **Description:** The specification says five balls will scroll horizontally, but the ball items are shrinkable flex children.
- **Rationale/evidence:** `BingoBall` does not include `shrink-0`, and the player strip uses a normal flex row. The browser can shrink the declared widths instead of overflowing, potentially creating compressed or non-circular balls.
- **Impact:** The literal 40% size increase and scrolling acceptance may not be achieved on narrow phones.
- **Recommended action:** Add `shrink-0` and explicit minimum width/height to each item. Test 320px, 375px and a large-text/zoom case. Define whether the lead ball’s existing scale transform counts toward the 40%.
- **Open questions:** Must all five balls remain fully circular at 200% text zoom?

### F-19 — Accessibility acceptance criteria are missing

- **Status:** Confirmed issue
- **Priority:** P2
- **Type:** Accessibility
- **Relevant section:** Issues 1, 2, 6, 7, 8 and 10; Verification
- **Description:** The specification adds modal interactions, live counters, errors, horizontally scrolling content and large responsive text without accessibility requirements.
- **Rationale/evidence:** The shared modal supplies a focus trap, but the new error and count states need announcement behaviour. The enlarged strip needs keyboard/touch access and visible clipping/scroll affordance. Animated/pulsing content has no reduced-motion acceptance check.
- **Impact:** Keyboard, screen-reader, low-vision or motion-sensitive users may be unable to complete host recovery or understand changing state.
- **Recommended action:** Add keyboard, focus return, Escape, `aria-live`, error association, contrast, reduced-motion, 200% zoom and touch-target checks. Use an automated accessibility scan plus a short manual keyboard/screen-reader pass.
- **Open questions:** Which browsers and assistive technologies are supported for staff devices?

### F-20 — Production observability and release monitoring are absent

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Monitoring / Operations
- **Relevant section:** Headline finding; Verification; Phasing
- **Description:** The plan fixes a failure that was only discovered during a live event but adds no way to detect recurrence after release.
- **Rationale/evidence:** `logError` is disabled in production unless `LOG_ERRORS=true`. There is no remote error, action-latency, conflict, channel-reconnect or stale-state telemetry, and no post-deploy observation window.
- **Impact:** Subscription churn, failed mutations or slow calls can recur unnoticed until the next event.
- **Recommended action:** At minimum, enable safe structured production logging for host action failures and Realtime reconnect loops, record action latency and conflict counts, and define a short post-deploy live rehearsal. Avoid logging IDs or sensitive session details. Add an operational dashboard or a documented log query if available.
- **Open questions:** What production logging/alerting service is available? Who monitors the next live session?

### F-21 — Phase and scope claims are inaccurate

- **Status:** Confirmed issue
- **Priority:** P2
- **Type:** Delivery planning / Estimation
- **Relevant section:** Complexity header; Files touched; Phasing
- **Description:** The stated “13 source files plus one migration” does not match the file table, and the phases are not fully independent.
- **Rationale/evidence:** The file table lists 12 entries including `CLAUDE.md`, not 13 source files. Phase 4’s three-second behaviour depends on Phase 3. Phase 2’s action response changes need exact client and type changes. Phase 5 includes a financially significant snowball decision and is not uniformly low risk.
- **Impact:** Estimates, review scope and release confidence are understated.
- **Recommended action:** Recount files after the required design changes, identify cross-phase dependencies, and classify each phase by data/financial/operational risk rather than diff size. Treat each deploy as a release unit with its own rollback and acceptance evidence.
- **Open questions:** Are phases expected to be separate production deployments or only separate implementation pull requests?

### F-22 — “No open questions remain” is unsupported

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Requirements / Governance / Traceability
- **Relevant section:** Assumptions; Decisions; final sentence
- **Description:** Several important choices remain assumptions rather than confirmed decisions.
- **Rationale/evidence:** These include rapid-call reveal semantics, the 400ms value, timing exceptions, Admin access for winner voids, Post Win dismissal behaviour, snowball eligibility, migration timing and performance targets. The source host report is described but not linked or reproduced as traceable requirements.
- **Impact:** Developers must make product and operational decisions during implementation, and later acceptance disputes are likely.
- **Recommended action:** Convert every unresolved item into a named decision with owner and date. Link each host symptom to a requirement and acceptance test. Do not mark the specification ready until all P0/P1 decisions are resolved.
- **Open questions:** Who has final authority for host workflow, jackpot rules and release acceptance?

### F-23 — `revalidatePath` changes are not fully specified

- **Status:** Confirmed issue
- **Priority:** P2
- **Type:** Framework behaviour / API design
- **Relevant section:** Additional defect E1; Issue 2
- **Description:** Many affected actions receive only `gameId`, but the proposed concrete path also requires `sessionId`. The specification does not say whether signatures change, an extra query is added, a dynamic path is revalidated or the invalid call is removed.
- **Rationale/evidence:** An extra session lookup works against the round-trip reduction goal. Several pages are already dynamic because they use authenticated cookie-based Supabase access, so the claim that navigation will necessarily serve stale server state needs a reproduction.
- **Impact:** Implementation can add avoidable requests or inconsistent action signatures for a cache invalidation whose benefit has not been demonstrated.
- **Recommended action:** Decide one pattern: pass a verified `sessionId`, use an appropriate dynamic-route revalidation form, or remove per-game revalidation where returned state/Realtime/navigation already provides freshness. Add a navigation reproduction test.
- **Open questions:** Which exact stale navigation has been observed?

### F-24 — The specification is not yet under version control

- **Status:** Confirmed issue
- **Priority:** P2
- **Type:** Delivery governance
- **Relevant section:** Document status
- **Description:** At review time, Git reports the specification as untracked.
- **Rationale/evidence:** An untracked design can be changed or lost without an auditable approval history.
- **Impact:** Implementation may proceed against a local version that reviewers cannot reliably identify.
- **Recommended action:** Commit the reviewed specification and this report together, then record the approved revision or commit before implementation starts.
- **Open questions:** Is there an expected design-approval branch or pull-request process?

## 4. Optional improvements

### O-01 — Use an explicit host workflow state machine

- **Status:** Optional improvement
- **Priority:** P2
- **Type:** Simplification / Maintainability
- **Relevant section:** Issue 2; host modal changes
- **Description:** The host component uses many independent booleans for validation, winner and Post Win modals.
- **Rationale:** Invalid combinations are already possible, such as Post Win over a valid validation result. More modal flags and local errors increase that risk.
- **Impact:** Without simplification, future changes are harder to reason about and test.
- **Recommended action:** Model the flow as named states such as `calling`, `validating`, `claim-valid`, `recording-winner`, `post-win` and `transitioning`.
- **Open questions:** Can this be done in the same change without making the root fix harder to review?

### O-02 — Share public live-state and reveal logic

- **Status:** Optional improvement
- **Priority:** P2
- **Type:** Simplification / Reliability
- **Relevant section:** Issues 3, 5, 7 and 10
- **Description:** Player and display duplicate session polling, subscriptions, freshness checks and delayed-number logic.
- **Rationale:** The specification requires matching fixes in both files. Separate implementations can drift, especially around reconnects and timing.
- **Impact:** A later fix may work on phones but not the TV, or vice versa.
- **Recommended action:** Extract a tested `usePublicLiveGame` hook and a pure reveal-queue helper while leaving presentation separate.
- **Open questions:** Is a small refactor acceptable in this delivery, or should it follow after the urgent root fix?

### O-03 — Remove `hasLoaded` rather than widening its meaning

- **Status:** Optional improvement
- **Priority:** P3
- **Type:** Simplification
- **Relevant section:** Issue 5
- **Description:** The server component has already fetched the session before the client renders, so “talked to the server” is already true on first render.
- **Rationale:** A separate boolean duplicates information and caused the permanent spinner.
- **Impact:** Keeping it creates more branches and makes error handling less clear.
- **Recommended action:** Initialise from a typed server load result or remove the gate and render waiting/failed/active states directly.
- **Open questions:** Is the initial spinner still required for any valid route state?

### O-04 — Centralise host mutation result handling

- **Status:** Optional improvement
- **Priority:** P2
- **Type:** Simplification / API consistency
- **Relevant section:** Issue 2
- **Description:** Many handlers repeat clear-error, await, set-error and apply-fresh-state logic.
- **Rationale:** A typed helper can enforce the action contract and make missing in-flight/error behaviour visible.
- **Impact:** Less duplicated code and fewer inconsistent handlers.
- **Recommended action:** Create a small typed client helper after the action matrix is agreed. Do not make it hide action-specific transitions.
- **Open questions:** Should conflict errors trigger an automatic state refresh?

### O-05 — Replace literal 40% sizing with a constrained responsive target

- **Status:** Optional improvement
- **Priority:** P3
- **Type:** Responsive design
- **Relevant section:** Issue 6
- **Description:** Literal multiplication produces unusual fixed values and assumes horizontal scroll is always desirable.
- **Rationale:** A `clamp()` with minimum touch size and maximum width can preserve emphasis across more phone sizes and zoom levels.
- **Impact:** Better results on 320px devices and accessibility zoom.
- **Recommended action:** Keep the host-confirmed visual intent, but express acceptance as measured rendered size and readability rather than exact Tailwind values.
- **Open questions:** Is exact 1.4× a business requirement or a visual direction?

## 5. Suggested wording changes to the specification

These are targeted edits, not a rewrite.

1. Replace the absolute headline statement:

   > “Its 3 second polling fallback never completes a single tick.”

   with:

   > “In normal visible-tab operation, the one-second health re-render repeatedly clears and re-arms the three-second poll before it can run, while also repeatedly rebuilding the Realtime subscription.”

2. Do not use this error until a real recovery control exists:

   > “Void that winner in Admin, then undo.”

   Suggested wording after the Admin UI is included:

   > “Cannot undo because a winner was recorded on this call. An admin must void that winner with a reason before this call can be undone.”

3. Replace:

   > “Cut `callNextNumber` from six round trips to three”

   with:

   > “Cut `callNextNumber` from six external requests to four by combining the controller/state read and returning the updated row. Measure the result; use an atomic RPC if the agreed latency target is not met.”

4. Replace the strict timing acceptance until the queue decision is made:

   > “Display and player reveal each ball 3 seconds after the host called it.”

   with one of:

   > “The server prevents another call until the current public reveal window has elapsed, and both public surfaces show that ball after 3 seconds.”

   or:

   > “Each persisted call event is revealed in order no earlier than 3 seconds after its own server timestamp, including after polling or reconnect.”

5. Replace:

   > “Post Win modal ... give it a real dismiss”

   with:

   > “Define and implement the complete client and server state transition for every Post Win choice. A dismiss is allowed only if the resulting validation, announcement and stage states are explicitly specified.”

6. Replace:

   > “Each phase is independently deployable and leaves no broken intermediate state.”

   with:

   > “Each phase is intended to be separately reviewable. Production deployment dependencies, compatibility states and rollback steps are listed for every phase.”

7. Replace the final sentence:

   > “No open questions remain. Ready to implement on approval.”

   with:

   > “Implementation approval is blocked until the rapid-call reveal model, atomic mutation design, winner-void workflow, Post Win transitions, snowball eligibility choice, timing semantics and release plan are confirmed.”

8. Confirm whether the nickname is intentionally:

   > `Andys Den`

   or:

   > `Andy's Den`

## 6. Required changes before approval

1. Decide whether rapid calls are prohibited, queued as timestamped events, or allowed to batch on public screens.
2. Add the missing Admin winner-void user journey and operational permissions.
3. Define atomic, controller-bound and idempotent database operations for call, undo, winner recording, stage completion and snowball transitions.
4. Define every Post Win state transition.
5. Publish an exact action input/output/conflict contract.
6. Resolve and document the meaning of `call_delay_seconds`.
7. Separate waiting, failed, active and completed public load states.
8. Make required Realtime publication configuration reproducible.
9. Add database concurrency, browser-flow, timing, migration and screenshot tests.
10. Add deployment, rollback, monitoring and live-rehearsal steps.
11. Obtain explicit approval for snowball eligibility behaviour.
12. Correct the scope, file count, phase dependencies and performance claims.

## 7. Unresolved decisions

- Minimum permitted pace between host calls.
- Strict per-ball public reveal versus batched catch-up.
- Validation/completion behaviour inside the three-second reveal window.
- Winner-void role, UI location and audit/reversal behaviour.
- Meaning of “Stay on this game.”
- Explicit handling of legitimate multiple winners versus retries.
- Snowball eligibility confirmation design and owner.
- Column naming and configuration scope for public delay.
- Measurable host latency and public timing tolerances.
- Behaviour during a running session with no active game.
- Release window, rollback owner and production monitoring owner.

## 8. Major risks

- **Financial:** duplicate or incorrect snowball pot updates and eligibility decisions.
- **Data integrity:** winner records can disagree with rolled-back call counts or duplicate after partial failure.
- **Live operations:** staff can be left without a working recovery path during a game.
- **Guest trust:** public screens can batch, skip or prematurely reveal calls and countdowns.
- **Security/ownership:** a stale host can mutate state after control changes.
- **Deployment:** production and rebuilt environments can have different Realtime behaviour.
- **Regression:** the proposed automated tests do not exercise the failures being changed.

## 9. Recommended delivery sequence

1. Resolve the open product and timing decisions and update the specification.
2. Design the atomic database/API contracts and migration compatibility plan.
3. Add the critical concurrency and reveal-queue tests first.
4. Ship the host dependency-array root fix as the smallest urgent release, with monitoring.
5. Ship atomic undo plus the complete winner-void recovery.
6. Ship the defined Post Win/state-transition changes.
7. Ship the timing model and public reconnect/load-state changes.
8. Ship layout and content changes after screenshot and accessibility checks.
9. Rehearse the full flow in a staging/test session on venue-like devices and network conditions.
10. Deploy between live sessions, verify publication/data state, monitor the next rehearsal, and retain a tested rollback path.

## 10. Final readiness assessment

**Requirements readiness:** Partial  
**Technical design readiness:** Not ready  
**Delivery readiness:** Not ready  
**Implementation recommendation:** Do not approve the full five-phase implementation yet.

The host subscription root cause is ready for a small isolated fix. The wider specification needs the P0 and P1 findings resolved before it can safely govern implementation of undo, post-win, timing and snowball behaviour.
