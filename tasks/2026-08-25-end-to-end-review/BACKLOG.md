# Canonical implementation backlog

Generated 2026-08-25. This is the single list of work. The 164-entry register in
[Appendix A](APPENDIX-A-findings.md) stays as evidence; every one of its entries has a disposition
here and none was silently dropped.

## How the numbers reconcile

- 164 register entries, all dispositioned: 115 canonical, 48 merged as duplicates, 1 accepted as a risk, 0 rejected as false positives.
- 96 canonical items after a further 23 cross-area merges.
- **Severity** is the consequence if it happens. **Likelihood** is how likely on a real pub night.
  **Release priority** is delivery order. They are separate judgements and are not interchangeable.
- `R0-blocker` means the next live night must not run without it.

Status column: **done** landed on `fix/review-remediation`, **partial** started and named in the
implementation plan, blank means not started.

| Priority | Status | Key | Sev / likelihood | Effort | Title | Decision needed |
|---|---|---|---|---|---|---|
| R0-blocker | done | `live-host-mutation-failures-silent` | high / likely | S | Most host controls have finally but no catch, so a dropped request shows the host nothing |  |
| R0-blocker | partial | `live-mutation-protocol` | critical / likely | L | One idempotent, version-checked mutation protocol for every host state change |  |
| R0-blocker | done | `live-public-404-on-transient-read-failure` | high / possible | S | A transient read failure leaves the pub TV and every punter phone on a permanent 404 |  |
| R0-blocker | done | `live-winner-lists-never-refresh` | high / certain | XS | The host's winners and prizes lists never update during a game |  |
| R0-blocker |  | `money-force-jackpot-ungated` | critical / possible | S | Manual Snowball Win pays the full pot outside the call window, for any host, with no audit |  |
| R0-blocker | done | `money-pot-fetch-failure-withholds-jackpot` | critical / possible | S | One failed pot fetch silently records a genuine jackpot win as not eligible |  |
| R0-blocker | done | `money-reset-session-unsafe-semantics` | critical / possible | M | "Reset to Ready" wipes a live game and permanently strands the snowball pot |  |
| R0-blocker |  | `money-settlement-failure-no-retry` | high / possible | M | A failed pot settlement can never be retried because the game is already completed |  |
| R0-blocker |  | `money-snowball-tie-double-jackpot` | critical / possible | S | A tie on a snowball Full House records two full jackpots against a pot that pays once |  |
| R0-blocker | partial | `qual-ci-gate-and-migration-replay` | critical / certain | M | Prove the CI gate green and make it blocking, including the full 28-migration replay |  |
| R0-blocker |  | `qual-claim-entry-unsafe-on-a-phone` | critical / likely | S | The claim grid has 27px targets, no read-back and no visible called state, so a mis-tap pays the wrong person |  |
| R0-blocker | partial | `qual-completion-paths-report-false-success` | high / possible | S | endGame and maybeCompleteSession report success when the pot did not move or the session did not complete |  |
| R0-blocker |  | `qual-money-and-live-path-test-coverage` | high / certain | L | Write the tests the money and live-game paths do not have, traced to the risks they cover |  |
| R0-blocker | done | `qual-offline-auto-reload-kills-every-screen` | critical / likely | S | The 30-second auto-reload fires while offline and kills the pub TV, the phones and the host's claim |  |
| R0-blocker |  | `sec-game-states-update-unbounded` | high / unlikely | L | Hosts can rewrite any column of any game_states row, defeating the atomic call guards |  |
| R0-blocker | done | `sec-host-routes-authorise-not-just-authenticate` | high / certain | S | The /host routes admit anyone with a session, so a pending account walks straight in |  |
| R0-blocker | done | `sec-middleware-drops-refreshed-session-cookies` | high / possible | XS | Every redirect in the auth middleware throws away the refreshed session cookies |  |
| R0-blocker |  | `sec-sessions-update-unbounded` | high / unlikely | M | Hosts can rewrite any column of any session, including the flag that switches off snowball settlement |  |
| R0-blocker | done | `sec-signup-grants-host-role` | critical / possible | M | Anyone on the internet can create an account that is granted the host role |  |
| R0-blocker |  | `sec-staff-lifecycle-and-setup-endpoint` | critical / certain | M | There is no defined way to invite, promote, disable or deprovision a staff account | yes |
| R0-blocker | done | `sec-winners-insert-open-to-hosts` | critical / unlikely | XS | A host can hand-craft a winners row straight through the API, fabricating a jackpot and forcing a pot reset |  |
| R1-before-release |  | `live-composite-advance-break-not-atomic` | high / possible | M | Continue and Take Break advances the stage before the break call, so a retry skips a whole stage |  |
| R1-before-release |  | `live-controller-lock-no-release` | high / possible | M | The controller lock can be taken but never released, so a second staff device can lock the host out | yes |
| R1-before-release |  | `live-display-no-wake-lock` | medium / likely | XS | The pub TV display never takes a wake lock, contrary to the documented design |  |
| R1-before-release |  | `live-no-clean-end-or-abandon` | high / possible | M | A game can only be ended by recording a valid claim, and skipping the final stage leaves dangling state | yes |
| R1-before-release |  | `live-public-anon-column-exposure` | medium / possible | S | The narrow public SELECT lists are not a security boundary |  |
| R1-before-release |  | `live-public-poll-can-hang-forever` | high / possible | M | The public poll has no request deadline and connection health never decays with time |  |
| R1-before-release |  | `live-stage-cannot-step-back` | high / possible | M | current_stage_index can only ever increase, so an accidental advance is unrecoverable | yes |
| R1-before-release |  | `live-tv-cannot-follow-session-lifecycle` | medium / likely | M | An unattended TV never returns to a later live session | yes |
| R1-before-release |  | `admin-no-void-winner-control` | medium / likely | S | An admin reviewing a finished night has no way to void a wrongly recorded win |  |
| R1-before-release |  | `host-validate-claim-duplicates` | medium / unlikely | XS | validateClaim accepts a claim made of the same number repeated |  |
| R1-before-release |  | `money-admin-pot-write-not-atomic` | high / possible | M | Admin pot edits and resets are not proved to land and swallow their own audit failure |  |
| R1-before-release |  | `money-cash-jackpot-name-regex` | high / possible | XS | Starting any game whose name contains "jackpot" overwrites every stage prize |  |
| R1-before-release |  | `money-format-pounds-pence` | medium / possible | XS | Money renders with the last pence digit stripped, so £212.50 shows as £212.5 |  |
| R1-before-release |  | `money-manual-snowball-prize-text-leak` | medium / possible | XS | Cancelling the Manual Snowball modal leaves the jackpot amount in the next winner's prize text |  |
| R1-before-release |  | `money-pot-delete-non-transactional` | high / unlikely | M | Deleting a snowball pot unlinks every game, then fails on a foreign key it cannot satisfy |  |
| R1-before-release |  | `money-pot-max-calls-unbounded` | critical / unlikely | XS | Nothing caps a snowball pot's max calls at 90, so a typo opens the jackpot for ever |  |
| R1-before-release |  | `money-prize-and-tie-accounting-model` | high / likely | L | Decide the pub's prize and tie payout rule before the winner data model is changed | yes |
| R1-before-release |  | `money-void-after-settlement-pot-uncorrected` | high / possible | M | Voiding a jackpot winner after the game has settled leaves the pot wrong and the modal says otherwise |  |
| R1-before-release |  | `obs-session-export-and-disaster-recovery` | medium / possible | M | /admin/backup exports nothing and shows the planned draw order, and it is not disaster recovery | yes |
| R1-before-release |  | `obs-snowball-pot-history-invisible-and-empty` | high / certain | M | The pot has grown 120 pounds with zero history rows, and no screen reads the history table at all | yes |
| R1-before-release |  | `obs-technical-error-monitoring` | high / likely | M | Server-side failures on the public pages log nothing in production and admin actions leak raw Postgres text | yes |
| R1-before-release |  | `qual-accessibility-release-criteria` | medium / certain | M | Write down the accessibility and device release criteria, starting with reduced motion | yes |
| R1-before-release |  | `qual-history-hides-void-and-prize-given` | high / likely | S | Winner History shows voided wins as ordinary payouts and never shows prize_given |  |
| R1-before-release |  | `qual-native-dialogs-and-double-tap` | medium / likely | M | Ten native alert and confirm dialogs, an unguarded Start button, and the money actions behind the weakest guard |  |
| R1-before-release |  | `qual-no-error-boundaries` | medium / possible | S | No error.tsx, global-error.tsx or not-found.tsx anywhere, on screens that run unattended |  |
| R1-before-release |  | `qual-no-full-called-board` | medium / certain | M | The full 1-90 board exists only inside the modal that pauses the game, and never on the TV |  |
| R1-before-release |  | `qual-paused-with-no-resume-control` | high / likely | XS | After Close and stay paused the host has no Resume control and the app's own copy points at one that does not exist |  |
| R1-before-release |  | `qual-player-screen-colour-contrast` | high / certain | S | The game colour is painted raw behind white text on the player screen and the contrast helper is never called |  |
| R1-before-release |  | `qual-prod-dependency-vulnerabilities` | high / unlikely | S | Five high-severity advisories in production dependencies, with next pinned exactly so no patch is picked up |  |
| R1-before-release |  | `qual-session-reset-leaves-no-record` | critical / possible | M | reset_session_safe deletes a whole night's winners and game states and records nothing | yes |
| R1-before-release |  | `qual-signout-on-live-host-screen` | medium / possible | XS | Sign Out is a one-tap unconfirmed control in the top-right of the live host screen |  |
| R1-before-release |  | `qual-skip-stage-no-confirm` | high / possible | XS | Skip (No Winner) sits 8px from Record Winner, is irreversible and has no confirmation |  |
| R1-before-release |  | `qual-test-sessions-in-permanent-record` | medium / likely | S | Test sessions are filtered out of /display and nowhere else, so rehearsal winners look real |  |
| R1-before-release |  | `qual-ticket-colour-and-game-identity-missing` | medium / likely | XS | The ticket colour word and the game number vanish from every screen once calling starts |  |
| R1-before-release |  | `qual-tv-status-states-not-sized-for-room` | medium / likely | S | The TV's outage and loading states are rendered at phone scale |  |
| R1-before-release |  | `qual-unproven-updates-report-success` | high / possible | S | Three .update() calls report success without proving the write landed, against the codebase's own rule |  |
| R1-before-release |  | `qual-view-only-lockout-no-way-forward` | high / possible | S | The View Only banner covers the current ball and offers no route back when another tab is still alive |  |
| R1-before-release |  | `db-types-drift-from-live-schema` | medium / possible | S | The hand-written database types claim a dozen live-nullable columns are non-null and list no enums |  |
| R1-before-release |  | `db-unique-game-index-per-session` | medium / possible | S | Nothing stops two games in a session sharing a game order, and the host screen then thinks both are the last |  |
| R1-before-release |  | `sec-default-privileges-anon` | medium / possible | S | Default privileges still hand anon EXECUTE on every new function and full DML on every new table |  |
| R1-before-release |  | `sec-orphan-booking-function` | medium / unlikely | XS | An orphan SECURITY DEFINER function is anon executable and exists in production but in no migration | yes |
| R1-before-release |  | `sec-start-game-unvalidated-session-game-pair` | medium / unlikely | XS | startGame runs as service role and never checks the game belongs to the session it is told to start |  |
| R2-next-cycle |  | `live-realtime-reconnect-no-reentrancy-guard` | low / unlikely | S | Concurrent realtime connect calls can orphan a channel or tear down the live one |  |
| R2-next-cycle |  | `live-reveal-backlog-uncapped` | medium / possible | S | A client that falls behind trickles balls at the dwell rate and shows a wrong current number |  |
| R2-next-cycle |  | `live-snowball-pot-realtime-dead` | low / likely | S | Three snowball_pots realtime subscriptions can never fire because the table is not published |  |
| R2-next-cycle |  | `admin-game-form-input-unvalidated` | low / likely | S | The admin game form accepts zero stages and unvalidated stage names |  |
| R2-next-cycle |  | `admin-session-lock-server-side` | medium / possible | S | The session lock on adding and cloning games is UI only, and Clone is not even disabled | yes |
| R2-next-cycle |  | `money-jackpot-text-suppressed` | low / possible | XS | The jackpot amount is dropped from the winner record when the prize text mentions snowball |  |
| R2-next-cycle |  | `money-lifecycle-and-correction-commands` | high / possible | L | Define the explicit session and pot commands so corrections stop being ad hoc rewinds | yes |
| R2-next-cycle |  | `money-prize-given-on-voided-winner` | low / unlikely | XS | set_winner_prize_given will tick a voided winner's prize as handed over |  |
| R2-next-cycle |  | `obs-business-audit-ledger` | medium / possible | L | No business action is recorded: no actor on winners, no void ball, no takeover, no refused claim, no admin change | yes |
| R2-next-cycle |  | `obs-game-states-updated-at-frozen` | low / certain | XS | game_states.updated_at never advances and the stale value is mirrored to public clients |  |
| R2-next-cycle |  | `qual-admin-edits-invisible-to-live-surfaces` | medium / possible | M | An admin edit to a running game reaches neither the host screen nor the pub TV | yes |
| R2-next-cycle |  | `qual-authorize-helper-duplication` | medium / possible | S | authorizeAdmin is copy-pasted into three files and authorizeHost is a fourth near-copy |  |
| R2-next-cycle |  | `qual-capacity-and-performance-targets` | medium / possible | M | Set capacity and performance targets before the QR code is put in front of a full room | yes |
| R2-next-cycle |  | `qual-dates-unlocalised` | low / certain | S | User-facing dates are formatted with raw Date methods and no timezone, in a British pub |  |
| R2-next-cycle |  | `qual-game-control-monolith` | medium / possible | L | game-control.tsx is 1914 lines with 39 useState, 8 useEffect and 8 inline modals |  |
| R2-next-cycle |  | `qual-host-action-near-duplicates` | low / unlikely | M | Two pairs of near-identical host server actions, one pair already drifted on a guard |  |
| R2-next-cycle |  | `qual-keyboard-and-form-semantics` | medium / possible | S | A bare div opens the host session list, buttons nest inside links, and login has no autocomplete |  |
| R2-next-cycle |  | `qual-modal-scroll-lock` | low / likely | XS | Closing a stacked modal restores body scrolling while the modal underneath is still open |  |
| R2-next-cycle |  | `qual-public-screen-duplication` | medium / likely | M | The display and player screens share 574 identical lines of data layer and have already drifted |  |
| R2-next-cycle |  | `qual-styling-systems-and-pink-focus-rings` | low / certain | L | Three overlapping colour systems, with an override sheet that leaks the old pink brand on admin focus rings |  |
| R2-next-cycle |  | `qual-typing-weaknesses` | medium / unlikely | S | A silent admin-to-host role downgrade, a boolean-or-null control flag and a missing return type |  |
| R2-next-cycle |  | `db-duplicate-game-states-insert-policy` | low / unlikely | XS | Two overlapping INSERT policies on game_states, the narrower one dead |  |
| R2-next-cycle |  | `sec-login-next-backslash` | low / unlikely | XS | The login redirect sanitiser misses a backslash, so a phished link breaks the sign-in |  |
| R2-next-cycle |  | `sec-profiles-readable-by-every-account` | low / possible | XS | Every authenticated account can read the whole staff roster and who is admin |  |
| R3-backlog |  | `admin-list-queries-unbounded` | low / unlikely | XS | Admin list pages fetch every row ever with no limit or pagination |  |
| R3-backlog |  | `money-pot-form-falsy-defaults` | low / unlikely | XS | The pot form silently resets a stored increment of 0 to the default on the next save |  |
| R3-backlog |  | `qual-build-config-gaps` | low / possible | S | next.config.ts is empty, autoprefixer duplicates Lightning CSS, and browserslist data is stale |  |
| R3-backlog |  | `qual-dead-exports-and-scaffolding` | low / possible | S | Dead exported server actions, dead component variants and no-op CSS classes |  |
| R3-backlog |  | `qual-dead-styling-assets` | low / certain | XS | Every entrance animation class is dead and Geist Sans is downloaded but never applied |  |
| R3-backlog |  | `qual-no-display-audio` | low / possible | S | The display has no audio, though the PRD lists Win, Break and Start sounds as in scope for v1 | yes |
| R3-backlog |  | `qual-offline-capability-unbuilt` | low / likely | XL | The PRD's headline resilience requirement is entirely unbuilt | yes |
| R3-backlog |  | `db-display-winner-name-dead-column` | low / unlikely | XS | display_winner_name is rendered on both public screens but every write path sets it to null |  |
| R3-backlog |  | `db-stale-migration-filename-refs` | low / certain | XS | Comments still cite a migration filename that the July reconciliation removed |  |

---

## Detail

### `live-host-mutation-failures-silent` :: Most host controls have finally but no catch, so a dropped request shows the host nothing

**R0-blocker** | severity high, likelihood likely | effort S | area liveflow | status **done**

handleToggleBreak, handleContinuePlaying, handleBeginClaimCheck, handleCheckWin, handleSkipStage, handleResumeGame, handleConfirmVoidLastNumber, handleTakeControl, handleMoveToNextGame and handleTakeBreakAfterGame all reset their busy flag in finally but never catch. A transport failure becomes an unhandled rejection, the button simply un-greys, and the host has no idea whether the action landed.

**Why this priority.** This is the trigger for every other live failure in this area. A host who cannot tell a failure from a success taps again, and until the mutation protocol lands that second tap is what skips a stage or draws a second ball. Only callNextNumber, recordWinner, the cash jackpot modal and the prize toggle currently catch.

**Files.** `src/app/host/[sessionId]/[gameId]/game-control.tsx`

**Depends on.** `live-mutation-protocol`

**Acceptance criteria.**

- **Given** The host control page open on a live game, with all fetches to the Supabase origin blocked at the network layer so every server action rejects. Baseline game_states row captured. **when** The host taps Take Break. **then** Within 5 seconds a visible error names the action and tells the host what to do, the button returns to enabled, and no unhandled promise rejection appears in the console. In the database: on_break, paused_for_validation, display_win_type and state_version for that game are identical to the captured baseline.
- **Given** The same blocked-network setup, repeated once per handler for the ten named handlers: handleToggleBreak, handleContinuePlaying, handleBeginClaimCheck, handleCheckWin, handleSkipStage, handleResumeGame, handleConfirmVoidLastNumber, handleTakeControl, handleMoveToNextGame, handleTakeBreakAfterGame. **when** Each handler's control is tapped in turn. **then** Each shows a visible error naming that action, clears its busy flag, and leaves the corresponding database columns unchanged from baseline. This is a fixed list of ten checks, not 'every host control'.
- **Given** Network blocked, then restored after the error is shown, with the live-mutation-protocol request ids in place. **when** The host taps the same control a second time after the error. **then** Exactly one committed effect exists in the database for that intent (one state_version bump attributable to it) and the screen reflects it once.
- **Given** Any of the ten handlers rejecting. **when** The rejection is caught. **then** logActionFailure is called once with that handler's action name and the error, and the log line is retrievable from the Vercel function or browser log for that request, so a post-mortem can tell which control failed.
- **Given** A handler whose action returns a conflict result rather than rejecting (for example toggleBreak on a game that is no longer in_progress). **when** The control is tapped. **then** The conflict message is shown, the screen re-reads and displays the true state within one poll interval, and the database row is unchanged. A conflict must not be dressed up as a transport error or vice versa.

**Tests.**

| Level | Name | Proves |
|---|---|---|
| unit | `src/lib/host-action-runner.test.ts` | The shared wrapper resolves to a typed outcome for success, conflict and transport rejection; it always clears the busy flag, always sets an error message on rejection, always calls logActionFailure once, and never re-throws. |
| unit | `src/app/host/[sessionId]/[gameId]/handler-coverage.test.ts` | A source scan of game-control.tsx asserting each of the ten named handlers routes through the wrapper and that no bare `await <serverAction>(` call sits outside it, so a new handler cannot silently regress. |
| integration | `src/app/host/host-action-failure-paths.test.ts` | With a mocked Supabase client made to reject, each handler's exported logic produces an error state and issues no further write call. |
| failure-injection | `rehearsal: airplane-mode tap of each of the ten controls` | On the real host device with the network cut, every one of the ten controls shows the host a failure rather than silently un-greying, and the database row is confirmed unchanged by a read-only query afterwards. |

**Preflight (read-only, run against production before the change).**

```sql
select game_id, status, on_break, paused_for_validation, current_stage_index, numbers_called_count, controlling_host_id, state_version from public.game_states order by updated_at desc limit 10;
```

**Rollback.** Client-only change with no schema impact. Revert the game-control.tsx commit; the previous finally-only handlers return. No database state to undo and no migration to reverse.

**Register entries absorbed.** 11, 60

### `live-mutation-protocol` :: One idempotent, version-checked mutation protocol for every host state change

**R0-blocker** | severity critical, likelihood likely | effort L | area liveflow | status **partial**

Only recordWinner has a persisted idempotency key. callNextNumber, advanceToNextStage, skipStage, toggleBreak, endGame and the two move-to-next-game actions have none, yet the host UI tells the host to retry after a transport failure. A lost response on a committed call therefore draws a second ball that nobody announced, and on a snowball game that silently spends one call of the jackpot window.

**Why this priority.** The host taps Next Number roughly ninety times a game, all night, on pub wifi. One dropped response is close to inevitable across a session, and the current error copy actively instructs the host to repeat a call that is not safe to repeat. A second undrawn ball changes who can claim and can close a snowball window a ball early, which is money.

**Files.** `src/app/host/actions.ts`, `src/app/host/[sessionId]/[gameId]/game-control.tsx`, `src/lib/claim-request-id.ts`, `supabase/migrations/`

**Acceptance criteria.**

- **Given** A game in_progress with 10 balls called, controlling_host_id = host A, game_states.state_version = V. Assumed default: every host RPC gains p_request_id uuid and p_expected_state_version bigint, and commits an audit row in a new public.host_mutation_requests table in the same transaction. **when** The host calls call_next_number with request id R, it commits, then the identical call with request id R is replayed (simulating a lost response and the retry the error copy already tells the host to make). **then** The screen shows the same ball as the first call and no second ball. In the database: called_numbers has length 11 (not 12), numbers_called_count = 11, state_version equals the value stamped by the first call, and public.host_mutation_requests holds exactly one row for R.
- **Given** The same game, gap already elapsed past HOST_MIN_CALL_GAP_MS. **when** Two genuinely distinct calls are made with two different request ids R1 then R2. **then** Two different balls appear. In the database: called_numbers has length 12, numbers_called_count = 12, state_version has advanced by exactly 2 from V, and host_mutation_requests holds one row each for R1 and R2. The protocol must not collapse legitimate repeat actions.
- **Given** A host screen holding a stale snapshot at state_version V-1 because another device advanced the stage. **when** That screen calls advance_to_next_stage with p_expected_state_version = V-1. **then** The action returns the conflict shape (the STATE_MOVED_ERROR path, not a generic failure) and the screen refreshes to the true state. In the database: current_stage_index is unchanged, state_version is unchanged, and no host_mutation_requests row was written.
- **Given** A snowball game whose pot has max_calls = 54 and 53 balls already called, so exactly one call of the jackpot window remains. **when** call_next_number with request id R commits, the response is lost, and the host retries with the same R. **then** In the database: numbers_called_count = 54 (not 55), so the jackpot window is not silently spent, and snowball_pots for that pot has identical current_amount and max_calls to before the retry.
- **Given** A game whose final stage has just been completed and end_game with request id R has committed, stamping ended_at = T. **when** The same end_game call is replayed with request id R. **then** The action succeeds and returns the stored result. In the database: game_states.ended_at is still exactly T (not re-stamped), sessions.active_game_id is unchanged, and there is one host_mutation_requests row for R.
- **Given** toggle_break, skip_stage, move_to_next_game_on_break and move_to_next_game_after_win each called once with a request id, committed, then replayed with the same id. **when** Each replay runs. **then** For each action the database row is byte-identical to the state after the first commit, state_version advanced by exactly 1 across the pair, and host_mutation_requests holds exactly one row per request id. Named actions, not 'every host control'.

**Tests.**

| Level | Name | Proves |
|---|---|---|
| sql-harness | `supabase/tests/host-mutation-idempotency.test.sql` | Each of call_next_number, void_last_number, toggle_break, advance_to_next_stage, skip_stage, end_game and both move-to-next-game functions is a no-op on replay of the same p_request_id, returning the stored state rather than raising, and writes exactly one host_mutation_requests row. |
| concurrency | `supabase/tests/mutation-protocol-contention.test.sql` | Two live psql connections issuing the same p_request_id concurrently produce one committed effect and one replay result, and two different request ids under the row lock produce two effects in a defined order. |
| sql-harness | `supabase/tests/host-mutation-version-check.test.sql` | A stale p_expected_state_version is refused with the conflict code and leaves current_stage_index, called_numbers and state_version untouched; a null p_expected_state_version keeps the pre-change behaviour so the migration is backward compatible. |
| unit | `src/lib/mutation-request-id.test.ts` | The client mints one request id per user intent, reuses it across retries of that intent, and mints a fresh one only when a new intent begins, mirroring the proven claim-request-id rule. |
| failure-injection | `rehearsal: lost-response retry on every host control` | With responses dropped after commit for each named control in turn, a host retry produces one effect in the database and one visible outcome on screen. |

**Preflight (read-only, run against production before the change).**

```sql
select p.proname, pg_get_function_identity_arguments(p.oid) as args, p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('call_next_number','void_last_number','record_winner_atomic','settle_snowball_pot','set_winner_prize_given') order by 1; select to_regclass('public.host_mutation_requests') as clash_check; select count(*) as live_game_states, count(*) filter (where status = 'in_progress') as in_progress from public.game_states;
```

**Rollback.** The new parameters are added with defaults of null and the functions keep their pre-change behaviour when p_request_id is null, so the deploy is forward compatible. To roll back: redeploy the function bodies from supabase/migrations/20260729231945_atomic_host_mutations.sql (plus the later winner and settlement migrations) in a single new migration, then drop public.host_mutation_requests. The table is append-only audit so nothing operational is lost. Client rolls back by ceasing to send request ids, which the null default already tolerates.

**Register entries absorbed.** 54, 59

### `live-public-404-on-transient-read-failure` :: A transient read failure leaves the pub TV and every punter phone on a permanent 404

**R0-blocker** | severity high, likelihood possible | effort S | area liveflow | status **done**

Both public server components call notFound() when the initial sessions read errors, conflating "no such session" with "Postgres was briefly unreachable". Next's default 404 page ships no client JavaScript, so it has no poll, no banner and no reload timer and never recovers on its own.

**Why this priority.** This compounds with the offline auto-reload. Any outage lasting over thirty seconds drives the TV through a fresh server render at the exact moment the read is most likely to fail, and the result stays dead after Supabase recovers. The rest of the display code already distinguishes a failed load from a waiting one, so this earlier notFound() throws away work already done. Recovery needs a human standing at the TV with a full room watching.

**Files.** `src/app/display/[sessionId]/page.tsx`, `src/app/player/[sessionId]/page.tsx`

**Acceptance criteria.**

- **Given** A session id that exists, with the sessions read forced to fail with a non-PGRST116 error (for example a connection failure to the pooler). **when** The pub TV loads /display/[sessionId]. **then** The response is HTTP 200 carrying the client shell with the reconnect banner and the 3 second poll running, not a 404. One logError entry is written server-side naming the session id and the Postgres error code. In the database: nothing is written by the page render.
- **Given** A session id that genuinely does not exist, so the read returns PGRST116. **when** The TV loads that URL. **then** Next's 404 page is served. The two cases must be distinguishable, which is exactly the conflation the defect created.
- **Given** A malformed, non-uuid session id. **when** The TV loads that URL. **then** A 404 is served without any database round trip.
- **Given** The TV sitting on the degraded shell after a transient failure, with nobody in the room touching it. **when** Postgres becomes reachable again and two poll intervals elapse. **then** The full display renders unattended, and the numbers shown equal game_states_public.called_numbers for the session's active game with the same numbers_called_count, verified by a read-only query at that moment.
- **Given** The same four conditions applied to /player/[sessionId] on a punter's phone. **when** Each is exercised. **then** Identical outcomes: 200 and a recovering shell on an outage, 404 only on a genuinely missing or malformed id, unattended recovery on the poll.

**Tests.**

| Level | Name | Proves |
|---|---|---|
| unit | `src/app/display/[sessionId]/session-load-outcome.test.ts` | The pure classifier maps PGRST116 to 'not found', any other error to 'degraded', and a row to 'render', so the 404 decision is testable without a browser and cannot drift back to notFound-on-any-error. |
| integration | `src/app/player/[sessionId]/player-page-load.test.ts` | With a mocked server client, the player page returns the degraded shell props on a transient error and calls notFound only on PGRST116 or a non-uuid id. |
| failure-injection | `rehearsal: block the Supabase host for two minutes with the TV on /display` | The TV keeps a recovering shell rather than a static 404 and comes back on its own, which is the actual pub failure the defect describes. |
| manual-rehearsal | `rehearsal step 1: TV and two phones through a simulated outage` | All public surfaces recover unattended, and no member of staff has to walk to the TV. |

**Preflight (read-only, run against production before the change).**

```sql
select id, name, status, active_game_id from public.sessions order by created_at desc limit 10;
```

**Rollback.** Revert the two page.tsx commits and the shell props; the previous unconditional notFound() returns. No schema change and no data written, so rollback is a redeploy with no database action.

**Register entries absorbed.** 10

### `live-winner-lists-never-refresh` :: The host's winners and prizes lists never update during a game

**R0-blocker** | severity high, likelihood certain | effort XS | area liveflow | status **done**

Both host winner lists are kept current only by Supabase Realtime channels on public.winners, and that table is not in the supabase_realtime publication in production, so the channels subscribe and then deliver nothing. handleRecordWinner and the manual snowball handler never call refreshWinnerLists, so a win recorded after page load is invisible until the page reloads.

**Why this priority.** This fires on every single win, not on an edge case. The Winners and Prizes list is what the host works from when handing cash and prizes over at the break, and it will be missing exactly the current game's winners with a wrong count on the button. The client-side fix is a few lines and does not need any publication change.

**Files.** `src/app/host/[sessionId]/[gameId]/game-control.tsx`

**Acceptance criteria.**

- **Given** The host control page loaded on a live game, Winners list showing (0) and the Prizes list empty. **when** The host validates a Line claim and records the winner successfully. **then** Within 2 seconds and with no page reload the Winners list shows 1 entry for the Line stage and the Prizes list shows a row with a working Prize Given toggle. In the database: public.winners holds exactly one row for that game_id and stage with is_void false, winner_name 'Anonymous' and client_request_id not null.
- **Given** The same page, with the browser's realtime websocket blocked so no postgres_changes message can ever arrive. **when** The host records a winner. **then** The lists still update within 2 seconds, proving the refresh comes from calling refreshWinnerLists on the success path and not from replication configuration. Database result as above, one winners row.
- **Given** A snowball game with a loaded pot, host on the Full House stage inside the window. **when** The host records a win through the Manual Snowball control. **then** Both lists update without reload. In the database: one winners row with is_snowball_jackpot true, and the pot settlement is visible as one new snowball_pot_history row.
- **Given** The migration adding public.winners to the realtime publication has been applied. **when** select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'winners' is run. **then** It returns 1, and select relreplident from pg_class where oid = 'public.winners'::regclass returns 'd' with a primary key present (or 'f'), so UPDATE and DELETE events carry an identifying key.
- **Given** Two staff devices open on the same game, device A holding control and device B watching. **when** Device A records a winner. **then** Device B's Winners count increases within 5 seconds without a reload, by realtime or by the existing poll. In the database there is still exactly one winners row, proving B rendered rather than re-recorded.
- **Given** A ball whose call is blocked from undo because a non-void winner was recorded against it, recorded after page load. **when** The host attempts Void Last Number and is refused, then opens the winners list the refusal points them at. **then** The blocking winner is present in that list, so the documented recovery route works. In the database: called_numbers and numbers_called_count are unchanged by the refused undo.

**Tests.**

| Level | Name | Proves |
|---|---|---|
| sql-harness | `supabase/tests/realtime-publication.test.sql` | public.winners is in the supabase_realtime publication after the migration, has an adequate replica identity, and the assertion re-runs clean on a second apply so a re-run of the migration is idempotent. |
| integration | `src/app/host/winner-list-refresh.test.ts` | With a mocked Supabase client, every success path that creates a winner (handleRecordWinner, the manual snowball handler, and the void-winner handler) calls refreshWinnerLists exactly once, and no success path returns without it. |
| unit | `src/app/host/[sessionId]/[gameId]/winner-refresh-coverage.test.ts` | A source scan asserting no winners-mutating handler in game-control.tsx exits its success branch without a refreshWinnerLists call, so a new path cannot regress silently. |
| manual-rehearsal | `rehearsal step 4: record a Line winner and tick prize given without reloading` | The end-to-end pub scenario the defect broke: the punter is at the bar, the host records and ticks in one go, and a read-only query confirms winners.prize_given is true. |

**Preflight (read-only, run against production before the change).**

```sql
select schemaname, tablename from pg_publication_tables where pubname = 'supabase_realtime' order by 1,2; select relreplident from pg_class where oid = 'public.winners'::regclass; select count(*) as total_winners, count(client_request_id) as with_key, count(*) filter (where coalesce(is_void,false)) as voided from public.winners;
```

**Rollback.** Two independent halves. The client refresh call is reverted by reverting the commit and is sufficient on its own. The publication change is undone with `alter publication supabase_realtime drop table public.winners;` which takes effect immediately, breaks nothing (the client no longer depends on it) and does not touch any row.

**Register entries absorbed.** 12, 15

### `money-force-jackpot-ungated` :: Manual Snowball Win pays the full pot outside the call window, for any host, with no audit

**R0-blocker** | severity critical, likelihood possible | effort S | area money | status **not started**

record_winner_atomic short-circuits on coalesce(p_force_snowball_jackpot,false) before v_window_open is consulted, and the Manual Snowball Win button is rendered for any snowball game with a pot regardless of numbers_called_count, contradicting the CLAUDE.md claim that the window is re-checked server side. Done when the force path requires profiles.role = 'admin' inside the function or records a typed reason on the winners row, the button is hidden once the window has closed, and the CLAUDE.md sentence is corrected.

**Why this priority.** Overriding the payout rule is a money decision, and right now any host can take it at ball 85 with one tap and leave no record of why. The documentation says this cannot happen, so nobody is watching for it. The override is genuinely useful for a disputed shout, so gate and audit it rather than removing it.

**Priority changed by the merge pass.** Raised from R1/high on developer review R15, which names the forced jackpot bypassing eligibility as wrongly outside the gate, and on the security area's own note that under the untrusted-host assumption this is the cheapest way for a host to move real money. record_winner_atomic short-circuits on p_force_snowball_jackpot before v_window_open is consulted, the button is rendered at any call count, there is no admin approval and no typed reason recorded. It also contradicts the CLAUDE.md claim that the window is re-checked server-side, so the documentation is currently misleading whoever reviews this next.

**Files.** `supabase/migrations/20260730064309_winner_idempotency_key.sql`, `src/app/host/[sessionId]/[gameId]/game-control.tsx`, `CLAUDE.md`

**Acceptance criteria.**

- **Given** ASSUMED DEFAULT: the manual override requires BOTH profiles.role = 'admin' inside record_winner_atomic AND a typed reason persisted on the winners row (new nullable column winners.manual_award_reason). Snowball game G with numbers_called_count = 60 and pot current_max_calls = 54 (window closed), a host-role account on the control screen. **when** The host looks at the game controls. **then** The Manual Snowball Win button is not rendered at all. A query of the rendered output for that label returns nothing, in every game status other than in_progress as well.
- **Given** An admin-role account calls record_winner_atomic with p_force_snowball_jackpot = true and no reason, window closed. **when** The RPC executes. **then** It raises manual_award_reason_required. In the database: zero winners rows inserted and game_states unchanged.
- **Given** An admin-role account calls it with p_force_snowball_jackpot = true and reason 'pot agreed with landlord, ball 55 miscalled', numbers_called_count = 60. **when** The RPC executes. **then** Success. In the database: one winners row with is_snowball_jackpot = true, manual_award_reason set to that exact text, call_count_at_win = 60, and prize_description carrying the jackpot amount; game_states.display_win_type = 'snowball'.
- **Given** A host-role (non-admin) account calls record_winner_atomic with p_force_snowball_jackpot = true, with or without a reason. **when** The RPC executes. **then** It raises unauthorized. In the database: zero winners rows inserted; the snowball_pots row is untouched; and because no jackpot row exists, a later settlement rolls the pot over rather than resetting it.
- **Given** The CLAUDE.md sentence claiming the jackpot window is re-checked inside record_winner_atomic. **when** The documentation is read after the change. **then** It names the admin-only, reason-required manual override as the single exception to the window check. A grep assertion over CLAUDE.md finds the word 'manual override' within the same paragraph as the window claim.

**Tests.**

| Level | Name | Proves |
|---|---|---|
| sql-harness | `supabase/tests/force-jackpot-gate.test.sql` | p_force_snowball_jackpot = true is refused for a host-role caller with unauthorized, refused for an admin with no reason with manual_award_reason_required, and accepted for an admin with a reason, persisting the reason on the winners row. |
| unit | `src/app/host/[sessionId]/[gameId]/manual-snowball-button.test.tsx` | The button is hidden when isSnowballJackpotEligible is false, when the game status is not in_progress, and when the signed-in role is not admin. |
| unit | `scripts/check-claude-md-claims.test.ts` | CLAUDE.md no longer states the window is re-checked server-side without naming the manual override exception. |
| manual-rehearsal | `rehearsal/manual-snowball.md` | A host cannot reach the manual award; an admin can, and must type a reason that appears on the winners list afterwards. |

**Preflight (read-only, run against production before the change).**

```sql
select w.id, w.game_id, w.call_count_at_win, p.current_max_calls, w.prize_description, w.created_at from winners w join games g on g.id = w.game_id join snowball_pots p on p.id = g.snowball_pot_id where coalesce(w.is_snowball_jackpot,false) and w.call_count_at_win > p.current_max_calls;
```

**Rollback.** Revert the admin check and the reason requirement inside record_winner_atomic and restore the button's render condition. Leave winners.manual_award_reason in place - dropping a column needs explicit approval and the column is nullable and harmless.

**Register entries absorbed.** 121, 124, 130

### `money-pot-fetch-failure-withholds-jackpot` :: One failed pot fetch silently records a genuine jackpot win as not eligible

**R0-blocker** | severity critical, likelihood possible | effort S | area money | status **done**

currentSnowballPot is fetched client side with the error discarded and no retry, so a single failed request makes isSnowballChoiceRequired false, sends snowballEligible false to record_winner_atomic, hides the Manual Snowball Win fallback, and leaves settle_snowball_pot rolling the pot over instead of resetting it. Done when the pot row is passed in as a server prop from the host page, and record_winner_atomic refuses a snowball Full House while the window is open unless p_snowball_eligible arrived as an explicit true or false.

**Why this priority.** Pub wi-fi drops requests, and this one dropped request costs a punter the whole jackpot with no visible warning and no fallback button. The winners row records the wrong outcome, so even the audit trail agrees with the mistake afterwards. A missing eligibility answer must be an error, never a silent no.

**Files.** `src/app/host/[sessionId]/[gameId]/game-control.tsx`, `supabase/migrations/20260730064309_winner_idempotency_key.sql`

**Acceptance criteria.**

- **Given** The host page for snowball game G is rendered server-side and the snowball_pots row is passed to the client component as a prop. **when** The client-side pot refresh request is failed by injection after hydration. **then** The Eligible / Not eligible choice is still rendered at the Full House stage; the 'this game is not linked to a snowball pot' message is not shown; the jackpot figure on screen equals snowball_pots.current_jackpot_amount for the linked pot.
- **Given** Game G is typed snowball with a snowball_pot_id that resolves to no readable pot row (deleted, archived, or read failure on the server too). **when** The host opens the Record Winner modal at Full House. **then** Record is blocked with 'Cannot record a snowball win while the pot is unknown.' In the database: no winners row is written and game_states.paused_for_validation is unchanged.
- **Given** record_winner_atomic is called for a snowball Full House with the pot window open and p_snowball_eligible passed as NULL (the parameter default is changed from false to null). **when** The RPC executes. **then** It raises snowball_choice_required. In the database: zero winners rows inserted; game_states.display_win_type, display_win_text and paused_for_validation are all unchanged.
- **Given** Window open, host explicitly chooses Eligible. **when** The winner is recorded. **then** winners has one new row with is_snowball_jackpot = true, is_snowball_eligible = true, call_count_at_win equal to the locked game_states.numbers_called_count, and prize_description ending in 'Snowball Jackpot £<pot amount>'; game_states.display_win_type = 'snowball'.
- **Given** Two host devices are open on game G, one of them with a failed client pot refresh; only device 1 holds the controller lock. **when** Both devices attempt to record the same Full House. **then** Device 2 is refused with not_controller before any snowball logic runs; device 1 records normally. In the database: exactly one winners row for that stage and claim.

**Tests.**

| Level | Name | Proves |
|---|---|---|
| sql-harness | `supabase/tests/snowball-eligibility-required.test.sql` | With the window open, p_snowball_eligible null raises snowball_choice_required and writes nothing; explicit false records a non-jackpot Full House; explicit true records a jackpot. With the window closed, null is accepted and records a non-jackpot win. |
| failure-injection | `src/app/host/[sessionId]/[gameId]/pot-prop.test.tsx` | With the server prop supplied and the client refresh rejected, the eligibility choice still renders and the pot amount shown comes from the prop. |
| integration | `src/app/host/actions.test.ts` | recordWinner forwards an absent host choice as null rather than coercing it to false, so the database guard can fire. |
| manual-rehearsal | `rehearsal/pot-offline.md` | Putting the host device into flight mode after page load leaves the eligibility choice and the jackpot figure intact. |

**Preflight (read-only, run against production before the change).**

```sql
select g.id, g.name, g.snowball_pot_id, p.id as pot_found from games g left join snowball_pots p on p.id = g.snowball_pot_id where g.type = 'snowball' and g.snowball_pot_id is not null and p.id is null;
```

**Rollback.** Restore p_snowball_eligible's default to false and drop the server prop (the client fetch is retained throughout, so the page keeps working). Additive change; no data written.

**Register entries absorbed.** 14, 65

### `money-reset-session-unsafe-semantics` :: "Reset to Ready" wipes a live game and permanently strands the snowball pot

**R0-blocker** | severity critical, likelihood possible | effort M | area money | status **done**

reset_session_safe takes no lock, checks no game status, and deletes winners and game_states while leaving snowball_pots and the (snowball_pot_id, game_id) claim row in snowball_pot_history untouched, so a replayed night returns 'already_settled' and the pot never moves again; the confirmation modal also claims it deletes snowball history that it never touches. Done when reset_session_safe raises if any game_states row for the session is in_progress (read for update) or if any snowball_pot_history row exists for a game in the session, and the modal text names only the winners and game_states rows that are actually deleted.

**Why this priority.** The button renders precisely while the session is running, so its most reachable state is a night in progress: one admin tap plus the fixed word RESET destroys every called number and every recorded winner mid-game, and the host cannot recover the night. The pot half is worse because it is silent: the pot keeps advertising an amount that has already been paid out, and only a manual edit on /admin/snowball ever corrects it. Refusing an unsafe reset is safe without any business decision, which is exactly what R16 asks for.

**Files.** `src/app/admin/sessions/[id]/actions.ts`, `src/app/admin/sessions/[id]/session-detail.tsx`, `supabase/migrations/20260430124120_atomic_admin_mutations.sql`, `src/app/host/actions.ts`

**Acceptance criteria.**

- **Given** Session S is 'running' and one of its games has game_states.status = 'in_progress'; an admin is on /admin/sessions/S with the Reset to Ready modal open. **when** The admin types the session name exactly and confirms. **then** The screen shows 'Cannot reset while a game is in progress. End or abandon the game first.' In the database: select count(*) from winners where session_id = S is unchanged; every game_states row for S's games still exists with the same state_version it had before; sessions.status is still 'running' and active_game_id is unchanged.
- **Given** Session S has a snowball game G1 that already carries a snowball_pot_history row for (pot P, G1). **when** The admin confirms the reset. **then** The screen shows a refusal naming pot P and telling the admin to correct it on /admin/snowball. In the database: zero winners rows are deleted for S; the snowball_pot_history row for (P, G1) still exists; P.current_max_calls, P.current_jackpot_amount and P.last_awarded_at are all byte-identical to their pre-attempt values.
- **Given** Session S where every game is 'not_started' or 'completed', and no snowball_pot_history row exists for any game in S. **when** The admin confirms the reset. **then** The screen returns to the session list with the session marked Ready. In the database: select count(*) from winners where session_id = S returns 0; select count(*) from game_states gs join games g on g.id = gs.game_id where g.session_id = S returns 0; sessions.status = 'ready' and active_game_id is null; any snowball_pots row linked from S's games is unchanged on current_max_calls, current_jackpot_amount, last_awarded_at and archived_at.
- **Given** The reset succeeded once and S is now 'ready' with no winners and no game_states. **when** The admin runs the reset a second time on the same session. **then** The action reports success rather than an error (the guarded reset is idempotent). In the database: winners for S = 0 rows, game_states for S = 0 rows, sessions.status still 'ready', and no snowball_pots or snowball_pot_history row anywhere has changed.
- **Given** An admin has the reset confirmation modal open. **when** The admin reads the confirmation text. **then** The text names exactly two things as deleted: the session's recorded winners and its live game state. It contains no reference to snowball history, the snowball pot, or the jackpot. A string assertion over the modal's copy finds no occurrence of 'snowball' or 'pot'.

**Tests.**

| Level | Name | Proves |
|---|---|---|
| sql-harness | `supabase/tests/reset-session-guards.test.sql` | reset_session_safe reads the session's game_states rows FOR UPDATE and raises 'game_in_progress' when any is in_progress; raises 'settlement_exists' when any snowball_pot_history row references a game in the session; on the clean path deletes winners and game_states and leaves the snowball_pots row unmodified column for column. |
| concurrency | `supabase/tests/reset-session-guards.test.sql (two-connection pair driven by run.sh)` | With connection A inside call_next_number holding the game_states row lock, connection B's reset_session_safe blocks and then refuses; A's call still commits and numbers_called_count increments exactly once. |
| unit | `src/app/admin/sessions/[id]/reset-modal-copy.test.ts` | The confirmation string enumerates only winners and live game state, and mentions neither the snowball pot nor its history. |
| manual-rehearsal | `rehearsal/reset-live-session.md` | With a host mid-game on device 1, an admin on device 2 attempting the reset sees the refusal, and the host's next Call Next Number still lands. |

**Preflight (read-only, run against production before the change).**

```sql
select s.id, s.name, s.status, count(*) filter (where gs.status = 'in_progress') as live_games, count(distinct h.id) as settlement_rows from sessions s left join games g on g.session_id = s.id left join game_states gs on gs.game_id = g.id left join snowball_pot_history h on h.game_id = g.id group by 1,2,3 having count(*) filter (where gs.status = 'in_progress') > 0 or count(distinct h.id) > 0;
```

**Rollback.** create or replace reset_session_safe with the 20260430124207 body to drop both guards, and revert the modal copy. The change adds no columns and writes no data, so there is nothing to undo; any session already refused a reset is simply still intact.

**Register entries absorbed.** 2, 25, 51, 64, 87

### `money-settlement-failure-no-retry` :: A failed pot settlement can never be retried because the game is already completed

**R0-blocker** | severity high, likelihood possible | effort M | area money | status **not started**

advanceToNextStage and skipStage commit status = 'completed' first and then call settle_snowball_pot, so a settlement failure returns an error against a game that advanceToNextStage now refuses (.neq status completed), skipStage refuses the same way and endGame requires in_progress, leaving no code path that will try again. Done when either the completion write and the settlement share one transaction so a failure rolls the completion back, or an explicit host action settles a completed game and snowball_pot_history gains its row on the retry.

**Why this priority.** The host sees a real error and can do nothing about it, and the pot then carries the wrong jackpot into the following week until somebody edits it by hand. It is recoverable by an admin, which is why it sits below the R0 line, but it converts a transient network blip into manual money repair. R15 of the developer review flags exactly this as sitting outside the release gate.

**Priority changed by the merge pass.** Raised from R1 on developer review R15, which names unretryable settlement as wrongly outside the gate and asks what the operational response is when settlement fails. Today there is none: advanceToNextStage and skipStage commit status='completed' before calling settle_snowball_pot, and every action that could try again refuses a completed game. The pot silently stops at the wrong value and the only correction is a hand edit on /admin/snowball, which is itself one of the unproved writes in block 4.

**Files.** `src/app/host/actions.ts`

**Acceptance criteria.**

- **Given** ASSUMED DEFAULT: the completion write and the settlement share one transaction (a single complete_and_settle_game RPC), so a settlement failure rolls the completion back; an explicit settle-a-completed-game action is also added for games completed before this change. Snowball game G is on its final stage and the settlement is made to fail (pot row locked by another connection to statement_timeout). **when** The host taps Complete Game. **then** The host sees 'The game could not be completed because the snowball pot did not settle. Try again.' In the database: game_states.status is still 'in_progress' with the same current_stage_index; sessions.status is still 'running'; select count(*) from snowball_pot_history where game_id = G returns 0; snowball_pots is unchanged.
- **Given** The same game, with the injected failure removed. **when** The host taps Complete Game again. **then** Success. In the database: game_states.status = 'completed'; exactly one snowball_pot_history row for (pot P, G); snowball_pots moved once - reset to base if a non-void is_snowball_jackpot winner exists for G, otherwise current + increment on both columns.
- **Given** A game completed under the old code that has game_states.status = 'completed' and no snowball_pot_history row (the preflight query lists these). **when** An admin runs the explicit Settle snowball pot action for that game. **then** Success. In the database: one history row appears for (P, that game) and the pot moves once. Running it a second time returns 'already settled', writes no second history row, and leaves the pot figures identical.
- **Given** The combined RPC committed but the host's device lost the response. **when** The host taps Complete Game again. **then** The action reports success. In the database: still exactly one snowball_pot_history row for the game (the partial unique index on (snowball_pot_id, game_id) holds) and the pot figures are unchanged from the first run.
- **Given** A non-snowball game on its final stage. **when** The host completes it. **then** game_states.status = 'completed'; no snowball_pot_history row is written; no error is shown; maybeCompleteSession still runs.

**Tests.**

| Level | Name | Proves |
|---|---|---|
| sql-harness | `supabase/tests/complete-and-settle.test.sql` | complete_and_settle_game commits the status change and the settlement together, rolls the status change back when the settlement raises, and answers a second call with 'already_settled' having moved nothing. |
| failure-injection | `supabase/tests/complete-and-settle.test.sql` | Holding a FOR UPDATE lock on the pot from a second connection with a short statement_timeout makes the settlement fail; the game_states row is then read back as still in_progress. |
| concurrency | `supabase/tests/complete-and-settle.test.sql (two-connection pair)` | Two connections completing the same game produce one completion and one history row, and the pot moves exactly once. |
| integration | `src/app/host/actions.test.ts` | advanceToNextStage, skipStage and endGame all route a final-stage completion through the combined RPC and none of them writes status = 'completed' before settling. |
| manual-rehearsal | `rehearsal/settlement-failure.md` | A settlement failure leaves the host on a game they can retry rather than on a completed game with a frozen pot. |

**Preflight (read-only, run against production before the change).**

```sql
select g.id as game_id, g.name, s.name as session_name, gs.status, g.snowball_pot_id from games g join game_states gs on gs.game_id = g.id join sessions s on s.id = g.session_id left join snowball_pot_history h on h.game_id = g.id where g.type = 'snowball' and g.snowball_pot_id is not null and coalesce(s.is_test_session,false) = false and gs.status = 'completed' and h.id is null;
```

**Rollback.** Restore the two-step order in advanceToNextStage, skipStage and endGame, and drop complete_and_settle_game. Any pot settled by the new path stays settled - its history row is the record and must not be removed. Games listed by the preflight above are settled by the explicit action, not by the rollback.

**Register entries absorbed.** 62

### `money-snowball-tie-double-jackpot` :: A tie on a snowball Full House records two full jackpots against a pot that pays once

**R0-blocker** | severity critical, likelihood possible | effort S | area money | status **not started**

record_winner_atomic never counts existing non-void is_snowball_jackpot rows for the game, and the documented "Validate Another Winner" tie flow mints a fresh claim key, so a second Full House winner is recorded as eligible carrying the full pot amount in prize_description while settle_snowball_pot resets the pot only once. Done when a second non-void is_snowball_jackpot insert for the same game_id raises a mapped key such as jackpot_already_awarded, and the host sees that refusal rather than a silent second award.

**Why this priority.** Full House ties are ordinary in 90-ball pub bingo, and this is the single largest cash amount the app touches. Two people are each told they have won the whole pot in front of a full room, which is money paid wrong in the most public way available. Refusing the second award and forcing a deliberate admin decision needs no business rule, so this is implementable now; how a legitimate tie is then split is the separate question in money-prize-and-tie-accounting-model.

**Files.** `supabase/migrations/20260730064309_winner_idempotency_key.sql`, `src/app/host/[sessionId]/[gameId]/game-control.tsx`

**Acceptance criteria.**

- **Given** ASSUMED DEFAULT (from money-prize-and-tie-accounting-model): the snowball jackpot is never split and pays once per game; the stage prize may still be shared. Snowball game G, window open, one non-void winners row for G with is_snowball_jackpot = true. **when** The host uses Validate Another Winner, opens Record Winner (fresh client_request_id) and chooses Eligible. **then** The modal shows 'The snowball jackpot has already been awarded for this game.' In the database: select count(*) from winners where game_id = G and coalesce(is_snowball_jackpot,false) and coalesce(is_void,false) = false returns 1; no new winners row of any kind was inserted; game_states.display_win_type and display_win_text are unchanged.
- **Given** The same tie situation. **when** The host records the second Full House winner choosing Not eligible. **then** The action succeeds. In the database: winners holds 2 rows for G at stage 'Full House'; the newer row has is_snowball_jackpot = false, is_snowball_eligible = false, and prize_description containing no 'Snowball Jackpot £' substring.
- **Given** The first jackpot winner for G has been voided (is_void = true). **when** An admin records a fresh Full House claim for G as Eligible with a new client_request_id, window still open. **then** The action succeeds. In the database: the new row has is_snowball_jackpot = true; the count of non-void jackpot rows for G is 1; the voided row is unchanged.
- **Given** The first jackpot record committed but the host's device lost the response; the Record Winner modal is still open with the same claim key. **when** The host taps Record Winner again. **then** The action succeeds and the host advances to Post Win. In the database: no second winners row is inserted and no jackpot_already_awarded error is raised - the client_request_id lookup is still evaluated before the new jackpot guard.
- **Given** Game G has exactly one non-void jackpot winner and reaches completion. **when** Settlement runs. **then** select count(*) from snowball_pot_history where game_id = G returns 1 with change_type = 'jackpot_won'; snowball_pots.current_jackpot_amount = base_jackpot_amount and current_max_calls = base_max_calls; last_awarded_at was moved to the settlement time.

**Tests.**

| Level | Name | Proves |
|---|---|---|
| sql-harness | `supabase/tests/snowball-tie.test.sql` | A second eligible is_snowball_jackpot insert for the same game_id raises jackpot_already_awarded; a Not-eligible second claim succeeds; voiding the first re-opens the award; and the client_request_id fast path is checked before the new guard so a retry stays inert. |
| concurrency | `supabase/tests/snowball-tie.test.sql (two-connection pair driven by run.sh)` | Two eligible Full House claims with different keys committed from two live connections serialise on the game_states row lock: exactly one commits, the other raises jackpot_already_awarded, and winners ends with one non-void jackpot row. |
| unit | `src/app/host/actions.test.ts` | HOST_RPC_ERRORS maps jackpot_already_awarded to host-readable copy that tells the host the jackpot is already paid and the second claim can still be recorded as a shared stage win. |
| manual-rehearsal | `rehearsal/snowball-tie.md` | Two shouts on the same ball: the host records both, sees the jackpot awarded once, and the second winner recorded against the shared stage prize. |

**Preflight (read-only, run against production before the change).**

```sql
select game_id, count(*) as non_void_jackpot_rows from winners where coalesce(is_snowball_jackpot,false) and coalesce(is_void,false) = false group by 1 having count(*) > 1;
```

**Rollback.** Restore record_winner_atomic to its 20260730064309 body. The change inserts and alters no data, so no correction is needed; any jackpot refused during the change is simply not recorded.

**Register entries absorbed.** 66

### `qual-ci-gate-and-migration-replay` :: Prove the CI gate green and make it blocking, including the full 28-migration replay

**R0-blocker** | severity critical, likelihood certain | effort M | area quality | status **partial**

A CI workflow, a full replay of every migration from empty plus an idempotency second pass, and the missing npm scripts all landed at adcce5d, one commit past the review baseline. What is not yet proved is that the pipeline has ever run green on a runner: Docker is unavailable locally so npm run test:db has never executed here, and the dependency-audit job is deliberately continue-on-error. Done means a green run of all three jobs is visible on a pull request, replay.test.sql asserts the live object, grant and RLS set read from bcmorqsgeumtmhvctvgu, a second replay changes no catalogue row, and branch protection refuses a merge without it.

**Why this priority.** Every other item in this backlog is a change to money code, migrations or the live host screen, and the only evidence any of them work is a pipeline nobody has yet watched go green. The database job is the one that matters: it is the only place the 28 migrations are replayed, and a migration that is fine alone and wrong in sequence is exactly what breaks a night after a deploy.

**Files.** `.github/workflows/ci.yml`, `package.json`, `supabase/tests/run.sh`, `supabase/tests/replay.test.sql`

**Acceptance criteria.**

- **Given** A pull request open against main from a branch at the current HEAD, with .github/workflows/ci.yml present **when** CI runs on the pull request **then** All three jobs (app, database, audit) report success on the PR checks page; the database job log shows suite D applying every file in supabase/migrations in filename order (currently 28 files) against a fresh postgres:17 container; the run URL is recorded in the PR body as the evidence link
- **Given** The replay database after the first pass of all migrations **when** run.sh runs the second replay pass over the same database **then** A catalogue snapshot taken after pass 1 and again after pass 2 is byte-identical (pg_proc.proname + pg_get_function_identity_arguments + prosrc + proacl, pg_policies, pg_class.relrowsecurity, information_schema.columns, pg_publication_tables), and run.sh exits 0. Any differing row is printed by name and fails the job
- **Given** A read-only catalogue export from production bcmorqsgeumtmhvctvgu committed as the expected fixture **when** supabase/tests/replay.test.sql asserts the replayed database against that fixture **then** Every function name plus identity arguments, every EXECUTE grant per grantee, every RLS policy name and command, and every table with rowsecurity on match production exactly; a missing or extra object fails with the object name in the message
- **Given** Branch protection configured on main requiring the app and database checks **when** A maintainer attempts to merge a PR whose database job is red, queued or skipped **then** GitHub refuses the merge; the required-checks list on the branch protection settings page names both jobs; a screenshot or gh api output of that settings page is stored as evidence
- **Given** The audit job, once qual-prod-dependency-vulnerabilities has landed **when** CI runs **then** continue-on-error is absent from the audit job in ci.yml and the job is in the required-checks list, so a new high advisory blocks the merge

**Tests.**

| Level | Name | Proves |
|---|---|---|
| sql-harness | `supabase/tests/replay.test.sql` | The full 28-migration replay from empty produces exactly the function, grant, RLS and publication set that production carries |
| sql-harness | `supabase/tests/replay-idempotence.test.sql` | A second replay pass changes no catalogue row, so every migration is safe to run twice |
| integration | `.github/workflows/ci.yml green run on a pull request` | The pipeline actually executes on a Docker-capable runner, which has never happened on the dev machine |
| manual-rehearsal | `docs/runbooks/release-gate.md#branch-protection` | A merge is genuinely refused without a green database job, rather than the workflow merely existing |

**Preflight (read-only, run against production before the change).**

```sql
select p.proname, pg_get_function_identity_arguments(p.oid) as args, p.proacl::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' order by 1,2; select schemaname, tablename, policyname, cmd, roles::text from pg_policies where schemaname='public' order by 1,2,3; select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' order by 1; select pubname, schemaname, tablename from pg_publication_tables order by 1,2,3;
```

**Rollback.** CI and test files only, no production effect. Revert the workflow commit and remove the required checks from branch protection. If replay.test.sql asserts against a production shape that later changes legitimately, regenerate the fixture from the preflight queries in the same PR as the migration that changed it.

**Register entries absorbed.** 32

### `qual-claim-entry-unsafe-on-a-phone` :: The claim grid has 27px targets, no read-back and no visible called state, so a mis-tap pays the wrong person

**R0-blocker** | severity critical, likelihood likely | effort S | area quality | status **not started**

The 90-number grid is grid-cols-10 gap-1 below the sm breakpoint, giving 24 to 31px cells on common phones, and a called cell differs from an uncalled one only by text opacity and a 60 per cent alpha border on the identical background. The only feedback is a count. Done means cells measure at least 44px at 360px width, called cells carry a non-colour cue and aria-pressed, the selected numbers appear as a readable comma-separated list before submission, and a deliberate off-by-one tap onto a previously called number is caught by the host reading the list back rather than being written to winners as a valid claim.

**Why this priority.** This is the one screen where a host enters money-bearing data under time pressure, on a phone, in pub lighting. A single mis-tap onto a neighbouring number that happens to have been called passes both server checks and shows a green Valid Claim, so the pub pays a prize to someone who has not won, and the row in winners is indistinguishable from a real win afterwards. The app also documents that the host is colour-blind, and this grid is the one place that reasoning was never applied.

**Files.** `src/app/host/[sessionId]/[gameId]/game-control.tsx`

**Depends on.** `qual-ci-gate-and-migration-replay`

**Acceptance criteria.**

- **Given** The claim-check grid open on the host page at a 360x800 viewport **when** Every one of the 90 cells is measured with getBoundingClientRect **then** Each cell is at least 44px wide and 44px tall, no two cells overlap, and the grid scrolls within its own container rather than shrinking cells
- **Given** A game where 7 and 17 have been called and 8 has not **when** The grid renders **then** Called cells carry a non-colour cue (a shape or glyph, not only opacity or border alpha) and an accessible name ending 'called'; uncalled cells are named 'not called'; selection state is exposed as aria-pressed on every cell, independent of the called cue
- **Given** The host has tapped 5, 17 and 23 **when** The claim panel is shown before submission **then** A read-back line renders '5, 17, 23' in ascending order at 16px or larger alongside the count, so the host can read it back to the punter; the list updates on every tap
- **Given** The host intends 18 but taps 17, which is in the called set so validateClaim would pass **when** The host reads the read-back list aloud and the punter corrects it, then the host deselects 17 and selects 18 and confirms **then** The abandoned claim inserts zero rows into winners; the corrected claim inserts exactly one winners row for that game and stage, with client_request_id not null and call_count_at_win equal to the server-derived count

**Tests.**

| Level | Name | Proves |
|---|---|---|
| unit | `src/lib/claim-readback.test.ts` | The read-back string is ascending, comma-separated, and matches the selection set exactly, including the empty and single-number cases |
| manual-rehearsal | `docs/runbooks/rehearsal.md#S3-claim-entry-on-a-phone` | 44px targets, the called cue and the read-back are usable on the actual host phone under pub lighting, with a deliberate off-by-one caught by the read-back |
| sql-harness | `supabase/tests/host-flow.test.sql` | An abandoned claim writes nothing and a confirmed claim writes exactly one winners row, so a mis-tap corrected before confirm leaves no trace |

**Rollback.** Presentation-only change to the claim modal in src/app/host/[sessionId]/[gameId]/game-control.tsx. Revert the commit. No schema or server-action contract changes, so no coordination with a database release.

**Register entries absorbed.** 42, 77

### `qual-completion-paths-report-false-success` :: endGame and maybeCompleteSession report success when the pot did not move or the session did not complete

**R0-blocker** | severity high, likelihood possible | effort S | area quality | status **partial**

endGame logs a failed settle_snowball_pot and then returns success, while advanceToNextStage and skipStage return SNOWBALL_POT_NOT_MOVED_ERROR on the identical condition. maybeCompleteSession has three bare returns on error with no logging and discards its update result, and it is the only thing that marks a session completed. Done means all three completion routes behave identically, and a failure leaves the host with an actionable message rather than sessions.status stuck at 'running' or snowball_pots unchanged.

**Why this priority.** Which of three routes the host happened to take decides whether a failed pot settlement is reported or swallowed. Swallowed, the pot stays twenty pounds short, the host sees a clean finish, and the only trace is a Vercel log line that ages out. The session half is worse in public: /display keeps redirecting the pub TV into a finished session.

**Priority changed by the merge pass.** Raised from R1 on developer review R15, which names completion paths leaving ended_at and active_game_id wrong as a gate item. This merged item now owns endGame, maybeCompleteSession and the two stage-advance routes, and the defect is that a night can end looking finished while the session is still 'running', the finished game is still the active one, and the pot never moved. Nothing downstream, including the rehearsal in the release gate, can be trusted until the three completion routes behave identically.

**Files.** `src/app/host/actions.ts`

**Depends on.** `qual-ci-gate-and-migration-replay`

**Acceptance criteria.**

- **Given** settle_snowball_pot forced to fail (failure injection) **when** endGame runs **then** It returns exactly the SNOWBALL_POT_NOT_MOVED_ERROR string that advanceToNextStage and skipStage return, logs the failure with a correlation id, and leaves the game in a state from which the host can retry; snowball_pots and snowball_pot_history are unchanged
- **Given** The same forced failure **when** advanceToNextStage past the last stage and skipStage on the last stage run **then** All three routes produce byte-identical error strings and identical database outcomes, proved by comparing the returned value and the affected rows across the three paths
- **Given** maybeCompleteSession hitting each of its three current bare-return error branches **when** It runs **then** Each branch logs with a correlation id and surfaces a failure; the host sees a message naming the session and what to check, rather than sessions.status silently staying 'running'
- **Given** The injected fault cleared after a failed completion **when** The host retries the same completion **then** The pot moves exactly once: one snowball_pot_history row for that (snowball_pot_id, game_id), and the pot values equal the single expected outcome

**Tests.**

| Level | Name | Proves |
|---|---|---|
| failure-injection | `supabase/tests/snowball-settlement.test.sql (three completion routes)` | endGame, advanceToNextStage and skipStage behave identically when settlement fails, and a retry after recovery settles exactly once |
| unit | `src/app/host/actions.test.ts` | The three completion routes map the settlement failure to the same error constant, asserted by comparing the returned strings |
| manual-rehearsal | `docs/runbooks/rehearsal.md#S15-settlement-failure` | A host facing a failed settlement gets an actionable message and a working retry, not a false success |

**Preflight (read-only, run against production before the change).**

```sql
select p.id, p.current_max_calls, p.current_jackpot_amount from public.snowball_pots p; select count(*) from public.snowball_pot_history;
```

**Rollback.** Server-action changes only. Revert the commit to restore the previous behaviour; no schema change. Any session left at 'running' by the old behaviour is completed by an admin status update, which now proves the write.

**Register entries absorbed.** 35, 71, 123, 125

### `qual-money-and-live-path-test-coverage` :: Write the tests the money and live-game paths do not have, traced to the risks they cover

**R0-blocker** | severity high, likelihood certain | effort L | area quality | status **not started**

settle_snowball_pot, set_winner_prize_given, update_game_safe, delete_game_safe, delete_session_safe and reset_session_safe are asserted nowhere. No React component, hook or server action has a test. jackpot.ts and snowball.ts, the two modules that decide money, have none. Done means a requirement-to-test matrix maps every R0 and R1 item in this backlog to its evidence, and the suite asserts settle_snowball_pot's four outcomes plus the voided-jackpot rollover against the values actually written to snowball_pots and snowball_pot_history, startGame's four status branches, and that every error key raised in a migration has an entry in HOST_RPC_ERRORS.

**Why this priority.** A change that inverts the reset against rollover branch in settle_snowball_pot passes npm test, because the Node tests mock Supabase, and passed the old harness because it never loaded the file. The first snowball night after it either deletes a jackpot or pays it twice. The connection-health dependency-array trap is the other one: it is documented in capitals, it silently killed all live updates on the host screen once already, and only the pure reducer is tested.

**Priority changed by the merge pass.** Promoted from R1 into block 0. Developer review R09 puts CI and the migration replay before any remediation; the same argument applies to the test matrix, because every acceptance criterion in this backlog is stated as a database result and there is currently nothing that can assert one. settle_snowball_pot, set_winner_prize_given, update_game_safe, delete_game_safe, delete_session_safe and reset_session_safe are asserted nowhere, and blocks 2 to 5 all change them. Scope for block 0 is the matrix plus assertions against the functions as they stand today; each later block adds its own cases.

**Files.** `supabase/tests/run.sh`, `src/lib/jackpot.ts`, `src/lib/snowball.ts`, `src/lib/log-action-failure.ts`, `src/app/host/actions.ts`, `src/hooks/use-connection-health.ts`

**Depends on.** `qual-ci-gate-and-migration-replay`

**Acceptance criteria.**

- **Given** docs/testing/requirement-to-test-matrix.md **when** It is checked by a script in CI **then** Every R0 and R1 key in the canonical backlog has at least one test row naming a file or scenario at a stated level; a backlog key with no row fails the build, so coverage cannot silently lapse
- **Given** settle_snowball_pot exercised across its outcomes **when** The harness runs reset (a valid in-window jackpot win), rollover (no jackpot win), rollover after a voided jackpot win, the no-linked-pot case, and a repeat call for the same game **then** Each asserts the actual snowball_pots columns after the call (current_max_calls, current_jackpot_amount, last_awarded_at) and the matching snowball_pot_history row, not the function's return value; the voided case rolls over because coalesce(is_void,false) = false excludes it, and the repeat call leaves exactly one history row
- **Given** startGame's four status branches **when** Each is exercised **then** Each asserts the resulting game_states.status and the resulting games.prizes, including that a jackpot start writes only the Full House entry and a standard game's prizes are untouched
- **Given** Every error key raised by a raise in supabase/migrations **when** A test scans the migration files and compares against HOST_RPC_ERRORS in src/app/host/actions.ts **then** Every raised key has a mapped entry; an unmapped key fails the test, so a new database refusal can never reach a host as the generic message by accident
- **Given** set_winner_prize_given, update_game_safe, delete_game_safe, delete_session_safe and reset_session_safe **when** The harness runs **then** Each has a success case asserting the persisted row and a refusal case asserting zero rows changed, including the delete-protection rules for started games and sessions with winners

**Tests.**

| Level | Name | Proves |
|---|---|---|
| sql-harness | `supabase/tests/snowball-settlement.test.sql` | The four settlement outcomes plus the voided-jackpot rollover, asserted against the written pot and history values |
| sql-harness | `supabase/tests/admin-mutations.test.sql` | set_winner_prize_given, update_game_safe, delete_game_safe, delete_session_safe and reset_session_safe each succeed and each refuse, with the row counts to prove it |
| unit | `src/app/host/actions.test.ts` | Every error key raised in a migration is mapped in HOST_RPC_ERRORS, scanned from the migration files so it cannot drift |
| unit | `src/lib/snowball.test.ts and src/lib/jackpot.test.ts` | The two modules that decide money agree with the database function on window eligibility, calls remaining and jackpot formatting at the boundaries (exactly at max_calls, one under, one over) |
| integration | `docs/testing/requirement-to-test-matrix.md check script` | No R0 or R1 backlog item can exist without a named test, which is the traceability R26 asks for |

**Preflight (read-only, run against production before the change).**

```sql
select count(*) as winners, count(*) filter (where is_snowball_jackpot) as jackpot_wins, count(*) filter (where coalesce(is_void,false)) as voided from public.winners; select p.base_max_calls, p.calls_increment, p.base_jackpot_amount, p.jackpot_increment, p.current_max_calls, p.current_jackpot_amount from public.snowball_pots p;
```

**Rollback.** Tests and documentation only, no production surface. If a new test fails against a shape that turns out to be intended, correct the assertion in the same PR rather than deleting the test.

**Register entries absorbed.** 38, 39, 108

### `qual-offline-auto-reload-kills-every-screen` :: The 30-second auto-reload fires while offline and kills the pub TV, the phones and the host's claim

**R0-blocker** | severity critical, likelihood likely | effort S | area quality | status **done**

selectShouldAutoRefresh only checks selectHealthy plus a 30-second threshold, and effectiveHealthy is false whenever the browser reports offline, so ConnectionBanner calls window.location.reload() with no navigator.onLine guard on all three surfaces. Done means a simulated 90-second offline window produces zero reloads, every surface still shows its last-known ball, game_states_public is re-read and the state_version advances within one poll of the network returning, and an open host modal or a non-empty selectedNumbers array suppresses the reload even when online.

**Why this priority.** Pub wifi drops are routine at The Anchor. Today a 90-second blip replaces the big screen at the back of the room with the browser's offline page, where it stays until someone physically walks over, and wipes a fifteen-number claim the host had already typed. Without the reload every surface recovers on its own through the existing poll and realtime backoff, so this single line is the difference between a blip and a dead room.

**Files.** `src/components/connection-banner.tsx`, `src/lib/connection-health.ts`, `src/app/display/[sessionId]/display-ui.tsx`, `src/app/player/[sessionId]/player-ui.tsx`, `src/app/host/[sessionId]/[gameId]/game-control.tsx`

**Depends on.** `qual-ci-gate-and-migration-replay`

**Acceptance criteria.**

- **Given** /display/[sessionId] rendering ball 47 from a game_states_public row at state_version N, with the pub TV online **when** The network is cut for 90 seconds **then** window.location.reload is never called (a counter stubbed over reload reads 0), ball 47 and the called list stay on screen, and the Reconnecting banner appears with aria-live polite. No write reaches the database: the game_states_public row is still at state_version N
- **Given** The same TV after the 90-second offline window **when** The network returns **then** Within one poll interval plus 1 second the client re-reads game_states_public and renders the row with the highest state_version (>= N), the banner clears, and no reload occurred at any point
- **Given** The host device online, unhealthy for more than 30 seconds, with the Record Winner modal open or selectedNumbers.length > 0 **when** The auto-refresh threshold passes **then** The reload is suppressed, the modal contents and the selected numbers are unchanged, and no winners row is inserted or lost
- **Given** The host device online, unhealthy for more than 30 seconds, with no modal open and no numbers selected **when** The threshold passes **then** Exactly one reload occurs (the intended behaviour is retained for the recoverable case), and after reload the host pad shows the current game_states row

**Tests.**

| Level | Name | Proves |
|---|---|---|
| unit | `src/lib/connection-health.test.ts` | The reload decision is a pure function of (state, now, navigator.onLine, busy) and returns false whenever online is false or busy is true, never reaching the DOM |
| failure-injection | `docs/runbooks/rehearsal.md#S1-offline-window` | A real 90-second offline window on the TV, a host phone and a guest phone produces zero reloads and full recovery within one poll |
| manual-rehearsal | `docs/runbooks/rehearsal.md#S2-claim-survives-drop` | A half-typed claim on the host device survives a network drop that crosses the 30-second threshold |

**Rollback.** Client-only change in src/lib/connection-health.ts and src/components/connection-banner.tsx. Revert the commit; the previous behaviour returns with no data migration. Forward-fix is preferred because the reverted behaviour is the defect.

**Register entries absorbed.** 19, 53

### `sec-game-states-update-unbounded` :: Hosts can rewrite any column of any game_states row, defeating the atomic call guards

**R0-blocker** | severity high, likelihood unlikely | effort L | area security | status **not started**

The 'Hosts/Admins can update game state' policy has a role only USING clause, no WITH CHECK and no column scope, and authenticated holds table wide UPDATE, so a host can PATCH controlling_host_id to steal the controller lock mid game, or rewrite called_numbers and numbers_called_count, which record_winner_atomic reads for the call count and the jackpot window and which the sync trigger pushes straight onto the pub TV. Done means: the policy carries a WITH CHECK, the UPDATE grant is column scoped to only what the remaining direct writes touch, and a host JWT attempting to PATCH called_numbers, numbers_called_count, number_sequence or controlling_host_id receives 42501.

**Why this priority.** On the assumption that a host with a browser JWT is not trusted against deliberate direct API use, this makes every guard in call_next_number and void_last_number advisory rather than binding. It is not R0 or R1 because it needs a hostile member of staff, and the jackpot window reopening it enables is already available to that same host through the sanctioned Manual Snowball Award button, so the genuinely new capability is forging the board and stealing another host's controller lock. It sits at R2 because of cost and risk, not because it does not matter: developer review R24 is right that the policy cannot simply be dropped, since advanceToNextStage and the break, pause, resume and end writes go through it with the cookie client, so replacement SECURITY DEFINER functions have to exist and ship before the grant is narrowed. The cheap interim, a WITH CHECK plus a column scoped grant, can land first and should.

**Priority changed by the merge pass.** Raised from R2 on developer review R15, which names broad host writes to game_states as wrongly left outside the gate and says to reassess them as release blockers. The policy has a role-only USING clause, no WITH CHECK and no column scope, so a host can steal the controller lock mid-game or rewrite called_numbers and numbers_called_count, which record_winner_atomic reads for the call count and the jackpot window and which the sync trigger pushes straight to the pub TV. Size L is a reason to start it early, not a reason to defer it.

**Files.** `supabase/migrations/20251221101438_add_game_states_public.sql`, `src/app/host/actions.ts`

**Acceptance criteria.**

- **Given** The migration applied **when** select policyname, cmd, qual, with_check from pg_policies where tablename = 'game_states' and cmd = 'UPDATE' **then** exactly one UPDATE policy exists and its with_check is non-null and restricted to the admin and host roles
- **Given** The grant narrowed **when** select privilege_type, column_name from information_schema.column_privileges where table_name = 'game_states' and grantee = 'authenticated' and privilege_type = 'UPDATE', and relacl is read from pg_class **then** authenticated holds UPDATE only on the named columns that the remaining direct writes in src/app/host/actions.ts touch, and holds no table-level UPDATE
- **Given** A host JWT **when** it PATCHes /rest/v1/game_states?game_id=eq.<id> setting called_numbers, then numbers_called_count, then number_sequence, then controlling_host_id (four separate attempts) **then** every attempt returns 403 with code 42501 and the row is unchanged: state_version and all four columns are identical before and after
- **Given** A host JWT and an allowed column **when** it PATCHes call_delay_seconds **then** the request returns 200, the persisted value matches, and state_version increases by exactly 1
- **Given** The narrowed grants deployed with the app **when** a host runs a full game: start, call, void, break, pause, resume, record winner, advance stage, end game **then** every step succeeds and numbers_called_count only ever changes through call_next_number or void_last_number (assert each step's state_version delta is exactly 1 and the count matches the called_numbers length)
- **Given** Two host devices on the same game **when** the second device takes the controller heartbeat lock and the first then calls a number **then** controlling_host_id changed only through the RPC path, the first device's call returns the not-controller failure, and numbers_called_count did not move

**Tests.**

| Level | Name | Proves |
|---|---|---|
| sql-harness | `supabase/tests/game-states-write-scope.test.sql` | exactly one UPDATE policy with a WITH CHECK, column-scoped grants, refusal of the four protected columns under 'set role authenticated', and the full host flow still succeeding through the RPCs |
| integration | `supabase/tests/jwt/game-states-postgrest.test.mjs` | a real host JWT gets 42501 from PostgREST for the protected columns rather than a silently filtered no-op |
| concurrency | `supabase/tests/run.sh two-connection pair 'controller steal'` | the controller lock cannot be taken by a direct write while another host holds it |
| manual-rehearsal | `Live-night rehearsal, full host flow on two devices` | no host control broke when the table-level grant was withdrawn |

**Preflight (read-only, run against production before the change).**

```sql
select policyname, cmd, qual, with_check from pg_policies where schemaname = 'public' and tablename = 'game_states' order by cmd, policyname; select relacl from pg_class where oid = 'public.game_states'::regclass; select grantee, privilege_type, column_name from information_schema.column_privileges where table_schema = 'public' and table_name = 'game_states' order by grantee, privilege_type, column_name;
```

**Rollback.** The migration records the previous CREATE POLICY and the table-level GRANT UPDATE statement in its ROLLBACK comment. Restoring both is two statements and no data change. Because this narrows access, the failure mode of a bad apply is a host control refusing rather than data loss, and the rehearsal in the acceptance criteria is what catches it before release.

**Register entries absorbed.** 28

### `sec-host-routes-authorise-not-just-authenticate` :: The /host routes admit anyone with a session, so a pending account walks straight in

**R0-blocker** | severity high, likelihood certain | effort S | area security | status **done**

src/app/host/page.tsx:22 and src/app/host/[sessionId]/[gameId]/page.tsx:28 gate on 'if (!user)' alone, so the moment a pending tier exists a pending account reaches the host screens; the middleware /host branch had the same shape, and an uncommitted working tree change now fixes the middleware but not the two pages. Done means: a pending JWT hitting /host and /host/[id]/[id] is redirected, and a negative test using a real pending JWT proves game_states returns zero rows and assert_is_host() raises for that same account.

**Why this priority.** This is developer review R12 rather than a register entry, and it is the half of the signup fix that is easy to skip. Shipping the pending role without it just moves the hole: the account can no longer read or write anything through RLS, but it renders the host control screen and every button on it, which is both alarming and a support call on a pub night. The good news is that two of the five layers already hold: authorizeHost in src/app/host/actions.ts:153 positively checks role in (admin, host), and assert_is_host() names both roles explicitly, so server actions and RPCs already deny a pending caller. The gap is the route layer, plus the UserRole union in src/types/database.ts which still reads 'admin' | 'host'. Realtime is the fifth layer and is safe today only because winners is not published, which is why the winners item below must keep it that way.

**Files.** `src/app/host/page.tsx`, `src/app/host/[sessionId]/[gameId]/page.tsx`, `src/utils/supabase/middleware.ts`, `src/types/database.ts`

**Depends on.** `sec-signup-grants-host-role`

**Acceptance criteria.**

- **Given** A signed-in account whose profiles.role is 'pending' (and, separately, an account with no profiles row at all) **when** it requests GET /host **then** the response is a redirect to /login (307), the body contains no session name from public.sessions, and the same JWT selecting from public.game_states returns 0 rows
- **Given** The same pending account **when** it requests GET /host/<real sessionId>/<real gameId> **then** the response is a redirect to /login, and the same JWT calling public.assert_is_host() raises; select count(*) from public.game_states and public.winners are unchanged before and after
- **Given** An account with profiles.role 'host' and one with 'admin' **when** each requests GET /host and GET /host/<sessionId>/<gameId> **then** both receive HTTP 200 with the dashboard and game control rendered, and a subsequent call_next_number by the host increases game_states.numbers_called_count by exactly 1
- **Given** A signed-out browser **when** it requests GET /host/<sessionId>/<gameId> **then** it is redirected to /login with next set to that exact path, and after signing in as a host it lands on that path with the game control rendered
- **Given** The middleware /host branch and both page guards deployed together **when** a pending account's request is redirected **then** the redirect carries the Set-Cookie pair for any rotated session (shares the fix in sec-middleware-drops-refreshed-session-cookies), so the pending user is not thrown into a refresh loop
- **Given** A pending account already viewing /host when it is demoted mid-session **when** it triggers any host server action (call, void, record winner) **then** the action returns a failure, and the database shows no change: game_states.state_version and winners row count are identical before and after

**Tests.**

| Level | Name | Proves |
|---|---|---|
| sql-harness | `supabase/tests/pending-role.test.sql (shared with sec-signup-grants-host-role)` | the database layer refuses a pending uid independently of the route guard, so the route guard is defence in depth rather than the only control |
| integration | `supabase/tests/jwt/route-authorisation.test.mjs (mints real anon/pending/host/admin JWTs against a throwaway project and asserts status codes for /host and /host/[sessionId]/[gameId])` | the two page server components and the middleware all authorise on role, not merely on the presence of a user |
| manual-rehearsal | `docs/runbooks/staff-lifecycle.md, scenario 'pending account tries to reach the host screens'` | observed behaviour on a real browser matches the redirect contract, including what the pending user is told |

**Preflight (read-only, run against production before the change).**

```sql
select id, role from public.profiles order by role, id; select count(*) as users_without_profile from auth.users u left join public.profiles p on p.id = u.id where p.id is null;
```

**Rollback.** Revert the two page guards and the middleware STAFF_ROLES check in one commit; no schema or data change is involved, so the previous behaviour returns on redeploy.

**Register entries absorbed.** none (raised by the completeness or merge pass)

### `sec-middleware-drops-refreshed-session-cookies` :: Every redirect in the auth middleware throws away the refreshed session cookies

**R0-blocker** | severity high, likelihood possible | effort XS | area security | status **done**

supabase.auth.getUser() rotates an expired refresh token and the SSR client writes the new pair onto the local response, but all three redirect branches returned a fresh NextResponse.redirect that carried none of them, so the browser kept a refresh token GoTrue had already consumed and the next request signed the user out. Done means: every redirect path copies response.cookies onto the redirect, and a request made with an expired access token to /login or /admin comes back carrying Set-Cookie for the rotated pair.

**Why this priority.** A host an hour into a shift who taps a bookmarked /login, or follows a stale /admin link, is bounced to the login form from behind the bar and has to sign in again mid game. It is self healing and touches no game state, which is why it is not R0, but it is a self inflicted logout at the worst possible moment and the fix is three lines. Worth flagging that an uncommitted working tree change already implements exactly this fix alongside the pending role gating, so this item may already be in flight; it should be confirmed as landed rather than assumed.

**Priority changed by the merge pass.** Raised from R1. This is XS (copy response.cookies onto each redirect) and it signs the host out mid-game: getUser() rotates the refresh token, the redirect discards the new pair, and the browser is left holding a token GoTrue has already consumed. A host logged out between two balls, on a phone, in a noisy pub, is exactly the failure the release gate exists to prevent, and the fix costs nothing.

**Files.** `src/utils/supabase/middleware.ts`

**Acceptance criteria.**

- **Given** A signed-in admin whose access token has expired but whose refresh token is still valid **when** the browser requests GET /admin **then** the response carries Set-Cookie for the rotated sb-*-auth-token pair, and a second request made with only those returned cookies returns HTTP 200 for /admin rather than a redirect to /login
- **Given** The same expired-access-token state **when** the browser requests GET /login (the branch that redirects a signed-in user away) **then** the 307 to /admin carries the same rotated Set-Cookie pair, and following it lands on /admin signed in
- **Given** A pending or unauthorised account with an expired access token **when** it requests GET /host and is redirected **then** the redirect to /login also carries the rotated cookies, so the user lands signed in on /login instead of entering a refresh loop
- **Given** A signed-out browser **when** it requests GET /admin **then** it is redirected to /login with next set to /admin and no auth cookies are set on the response
- **Given** An expired-access-token request that triggers exactly one refresh **when** the request completes **then** in the auth schema exactly one refresh token for that session is newly issued and the consumed one is marked revoked; a third request using the newly issued cookies succeeds
- **Given** Two tabs of the same session refreshing at nearly the same moment **when** both requests hit the middleware **then** the user remains signed in: at least one unrevoked refresh token remains for that session and a subsequent request with the latest cookies returns 200, not a sign-out

**Tests.**

| Level | Name | Proves |
|---|---|---|
| unit | `src/utils/supabase/middleware.test.ts (node --test, fake NextRequest and a stubbed createServerClient whose setAll writes two cookies)` | all three redirect branches return a response carrying every cookie written onto the local response, so no branch can regress to a bare NextResponse.redirect |
| integration | `supabase/tests/jwt/token-refresh.test.mjs (request with a deliberately expired access token and a valid refresh token)` | the real Set-Cookie pair is present on the redirect and the rotated pair authenticates the next request |
| manual-rehearsal | `Live-night rehearsal, 'leave the host screen idle past the access-token TTL, then call a number'` | the behaviour that logged a host out behind the bar an hour into a shift no longer occurs |

**Rollback.** Revert the redirectPreservingSession helper and its three call sites in src/utils/supabase/middleware.ts. No schema or data change; the only risk of the change is cookie duplication, which the unit test pins.

**Register entries absorbed.** 4

### `sec-sessions-update-unbounded` :: Hosts can rewrite any column of any session, including the flag that switches off snowball settlement

**R0-blocker** | severity high, likelihood unlikely | effort M | area security | status **not started**

'Hosts can update sessions' was added so startGame could set status and active_game_id, but it is an unscoped UPDATE with no WITH CHECK, so a host can also write is_test_session, name, notes and created_by on any session; flipping is_test_session on the live session makes record_winner_atomic skip the snowball branch and settle_snowball_pot return 'test_session', so the pot silently stops growing for a whole night. Done means: the two writes startGame and maybeCompleteSession need go through a SECURITY DEFINER function guarded by assert_is_host(), and a host JWT attempting to PATCH sessions.is_test_session receives 42501.

**Why this priority.** Same root as the game_states item and the same trust assumption: RLS grants row access, not column or value access, and a host holds a real JWT. The consequence is worse than it looks because it is invisible, the pot simply fails to grow and nobody is told, but it needs a hostile host hand crafting a PostgREST call, nothing in the host UI writes that column, and an admin can correct the pot by hand on /admin/snowball. R2 rather than R1 because the replacement RPC is real work and the same release should carry the game_states equivalent. This is exactly the pattern settle_snowball_pot already establishes, so the shape is known.

**Priority changed by the merge pass.** Raised from R2 on developer review R15. An unscoped UPDATE with no WITH CHECK lets a host flip is_test_session on the live session, which makes record_winner_atomic skip the snowball branch and settle_snowball_pot return 'test_session', so the pot silently stops growing for a whole night with no error anywhere. That is a money defect with no visible symptom, which is the worst combination.

**Files.** `supabase/migrations/20251221101436_fix_host_permissions.sql`, `src/app/host/actions.ts`

**Acceptance criteria.**

- **Given** The migration applied (assumed default: the two writes move to SECURITY DEFINER RPCs guarded by assert_is_host(), mirroring settle_snowball_pot, and the unscoped host UPDATE policy is dropped) **when** select policyname, cmd, qual, with_check from pg_policies where tablename = 'sessions' and cmd = 'UPDATE' **then** no UPDATE policy grants the host role an unscoped write; any remaining policy is admin-only or carries a with_check limited to status and active_game_id
- **Given** A host JWT **when** it PATCHes /rest/v1/sessions?id=eq.<id> setting is_test_session true (and separately name, notes, created_by) **then** each attempt returns 403 with code 42501 and select is_test_session, name, notes, created_by from public.sessions where id = <id> is identical before and after
- **Given** A host using Start Game in the UI **when** the start RPC runs **then** it returns the persisted row, sessions.status = 'running' and active_game_id = the started game id in the database; because the RPC returns the values, a write filtered by RLS cannot be reported as success
- **Given** A host finishing the final stage of the final game **when** the completion RPC runs **then** sessions.status = 'completed' and active_game_id is null in the database, and /host and /display no longer list the session as live
- **Given** A live session with is_test_session false and a snowball full house recorded **when** settle_snowball_pot runs **then** it resets the pot (current_max_calls = base_max_calls, current_jackpot_amount = base_jackpot_amount) and writes a snowball_pot_history row, proving the host could not have flipped the flag to make settlement skip
- **Given** An admin on /admin/sessions/[id] **when** the admin edits name, notes or is_test_session **then** the write lands: the selected row shows the new values, so the narrowing did not remove legitimate admin editing

**Tests.**

| Level | Name | Proves |
|---|---|---|
| sql-harness | `supabase/tests/sessions-write-scope.test.sql` | the host role cannot write is_test_session or any other column directly, the two new RPCs perform exactly the intended writes under assert_is_host(), and an admin can still edit |
| integration | `supabase/tests/jwt/sessions-postgrest.test.mjs` | a real host JWT receives 42501 from PostgREST for is_test_session |
| manual-rehearsal | `Live-night rehearsal, 'start the first game through to session completion'` | start and completion still work once the direct writes are replaced by RPCs |

**Preflight (read-only, run against production before the change).**

```sql
select policyname, cmd, qual, with_check from pg_policies where schemaname = 'public' and tablename = 'sessions' order by cmd, policyname; select id, name, status, is_test_session, active_game_id, created_by from public.sessions order by created_at desc limit 20; select relacl from pg_class where oid = 'public.sessions'::regclass;
```

**Rollback.** The migration records the dropped policy's CREATE statement and the two new functions' DROP statements in its ROLLBACK comment. Reverting is three statements plus redeploying the previous app build; sessions data is never rewritten by the change itself.

**Register entries absorbed.** 29

### `sec-signup-grants-host-role` :: Anyone on the internet can create an account that is granted the host role

**R0-blocker** | severity critical, likelihood possible | effort M | area security | status **done**

Self-signup is on in production (the public GoTrue settings endpoint returns disable_signup false) and handle_new_user inserts every new auth user into profiles with role 'host', and user_role has only {admin, host} so there is no harmless tier. Done means: enum_range(null::user_role) returns {admin, host, pending}, handle_new_user inserts 'pending', the profiles INSERT policy WITH CHECK pins role to 'pending', the hosted Auth settings endpoint returns disable_signup true, and a JWT minted for a pending account gets zero rows from game_states and an exception from assert_is_host().

**Why this priority.** A stranger who reads the anon key out of the public /display bundle, signs up, and confirms their own email currently gets a real host JWT: they can call numbers, end the session, record winners and move the pot on the live game the pub is running that evening. That is a stranger controlling a live night, which is the definition of an R0. The dashboard toggle is the emergency action and can be done in minutes, but it is not version controlled and config.toml does not enforce it, so the pending role and the trigger change are what actually pin it. Register 116 is the same defect from the other end: the profiles INSERT policy checks only the id and says nothing about role, so it hands out self-promotion the moment a profile row is ever missing, and it must be pinned in the same migration.

**Files.** `supabase/migrations/20251201000000_baseline_schema.sql`, `src/types/database.ts`, `src/app/login/actions.ts`

**Acceptance criteria.**

- **Given** Production Supabase project bcmorqsgeumtmhvctvgu with the hosted Auth settings changed **when** GET https://bcmorqsgeumtmhvctvgu.supabase.co/auth/v1/settings with the anon key, then POST /auth/v1/signup with a fresh email and password **then** settings returns disable_signup true, the signup POST returns HTTP 422 with error_code signup_disabled, and select count(*) from auth.users is identical before and after
- **Given** The pending-tier migration applied to a throwaway replayed database **when** select unnest(enum_range(null::public.user_role)) and select prosrc from pg_proc where proname='handle_new_user' **then** the enum returns exactly admin, host, pending, and handle_new_user inserts role 'pending' (no literal 'host' remains in the body)
- **Given** The pending-tier migration applied and a row inserted into auth.users by the harness **when** the handle_new_user trigger fires **then** select role from public.profiles where id = <new uid> returns 'pending' and no row anywhere holds role 'host' as a result of the insert
- **Given** An authenticated JWT whose uid has no profiles row **when** it inserts into public.profiles with id = auth.uid() and role = 'admin' through PostgREST **then** the request is refused with 42501 (or the WITH CHECK pins the value so the persisted row is 'pending'); select role from public.profiles where id = <uid> is either absent or 'pending', never 'admin' or 'host'
- **Given** A profiles row with role 'pending' and a JWT minted for that account **when** the account selects from public.game_states and calls public.assert_is_host() **then** the select returns exactly 0 rows and assert_is_host() raises (unauthorized: host or admin role required); select count(*) from public.winners and public.game_states are unchanged
- **Given** An existing profile with role 'host' after the migration **when** that host runs the normal call flow through call_next_number **then** the call succeeds, game_states.numbers_called_count increases by exactly 1 and state_version by exactly 1, proving the pending tier did not break real staff

**Tests.**

| Level | Name | Proves |
|---|---|---|
| sql-harness | `supabase/tests/pending-role.test.sql (new suite in supabase/tests/run.sh)` | enum_range contains pending, handle_new_user writes 'pending', the profiles INSERT WITH CHECK refuses a self-granted admin/host role, assert_is_host() raises for a pending uid, and game_states returns zero rows for a pending uid under RLS |
| integration | `scripts/check-auth-settings.mjs (pre-release drift check, reads /auth/v1/settings and attempts one signup)` | the hosted Auth project really returns disable_signup true and a signup POST is refused 422, which config.toml alone cannot prove |
| manual-rehearsal | `docs/runbooks/staff-lifecycle.md, step 'attempt a public signup'` | a person with only the public anon key cannot create any account, observed end to end |

**Preflight (read-only, run against production before the change).**

```sql
select unnest(enum_range(null::public.user_role)) as role; select p.role, count(*) from public.profiles p group by 1 order by 1; select count(*) as users_without_profile from auth.users u left join public.profiles p on p.id = u.id where p.id is null; select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'handle_new_user';
```

**Rollback.** Re-enable signup from the Supabase dashboard and re-point handle_new_user at 'host' with a create or replace (body recorded in the migration's ROLLBACK comment). The 'pending' enum value cannot be dropped once used and is left in place, which is harmless. No data is destroyed, so rollback is a forward-fix, not a restore.

**Register entries absorbed.** 1, 116

### `sec-staff-lifecycle-and-setup-endpoint` :: There is no defined way to invite, promote, disable or deprovision a staff account

**R0-blocker** | severity critical, likelihood certain | effort M | area security | status **not started**

Turning signup off and adding a pending tier makes account creation safe but leaves no route to create a legitimate host, promote a pending one, revoke a leaver, or reset a forgotten password, and /api/setup remains live as a service role admin bootstrap guarded only by SETUP_SECRET. Done means: a written runbook plus, at minimum, a proven procedure whose database result is a profiles row moving from 'pending' to 'host' with the acting admin recorded, and a documented decision on whether /api/setup stays, with its secret rotated if it does.

**Why this priority.** This is developer review R11. Nothing here breaks the next live night, but the signup lockdown creates the problem it solves: the first time a new bar staff member needs host access, somebody has to know how to grant it, and the tempting shortcut is to turn public signup back on. Writing the runbook in the same release as the lockdown is what stops that. /api/setup is included because it is the one remaining path that mints an admin with the service role key, and it needs an explicit keep or delete decision rather than being left to sit.

**Priority changed by the merge pass.** The security area scored this R1 and the quality area scored it R0. R0 wins. It is not an independent piece of work: it is the second half of closing self-signup, and shipping the closure without it means the first time a stand-in host needs an account, nobody can create one and nobody can reset a forgotten password without Supabase console access. A host who cannot log in on the night is a cancelled night.

**Files.** `src/app/api/setup/route.ts`, `src/app/login/actions.ts`, `supabase/migrations/20251201000000_baseline_schema.sql`

**Depends on.** `sec-signup-grants-host-role`

**Blocked on a decision.** Who may approve a new host account, and must a departing staff member lose access the same night? The answer decides whether we build an admin Users screen with session revocation or simply document a Supabase dashboard procedure, and I would recommend the documented procedure first because there is one admin and a handful of hosts.

**Acceptance criteria.**

- **Given** An admin signed in and a profile with role 'pending' **when** the admin promotes it using the documented procedure (an admin-only SECURITY DEFINER RPC, e.g. set_profile_role(p_profile_id, p_role)) **then** select role from public.profiles where id = <target> returns 'host', and exactly one role-change audit row exists recording old role 'pending', new role 'host', changed_by = the acting admin's auth.uid() and a timestamp
- **Given** A host account being deprovisioned (a leaver) **when** the documented revoke procedure runs **then** profiles.role for that id is 'pending' (or the auth user is banned per the runbook), one audit row records the change and the acting admin, the account's next GET /host is redirected to /login, and select count(*) from auth.sessions where user_id = <id> is 0; the runbook states the residual access-token window in minutes
- **Given** A host who has forgotten their password **when** the documented reset is performed **then** the host can sign in again and select role from public.profiles where id = <id> still returns 'host' (a reset never changes role), with no new profiles row created
- **Given** SETUP_SECRET unset in the production environment (the assumed default: the route stays in code but is disarmed) **when** POST /api/setup is called with any x-setup-secret header **then** the response is HTTP 404 and select count(*) from public.profiles where role = 'admin' is unchanged
- **Given** SETUP_SECRET temporarily set to a freshly rotated value during a documented emergency **when** POST /api/setup is called first with the old secret and then with the new one for an existing auth user's email **then** the first call returns 401 with the admin count unchanged, the second returns 200, that profile's role is 'admin', and a role-change audit row records the promotion; the runbook requires unsetting the variable immediately afterwards and a re-check that the route 404s
- **Given** A host (not admin) JWT **when** it calls the role-change RPC for any profile including its own **then** the call raises (assert_is_admin), profiles is byte-identical before and after, and no audit row is written
- **Given** docs/runbooks/staff-lifecycle.md exists and names an owner **when** a named person walks the full lifecycle in a rehearsal: invite, promote to host, use the host screens, demote, confirm lockout **then** each step's database result matches the criteria above and the rehearsal is signed off in the runbook with a name and date

**Tests.**

| Level | Name | Proves |
|---|---|---|
| sql-harness | `supabase/tests/profile-role-change.test.sql` | the role-change RPC is admin-only, writes both the profile and the audit row in one transaction, and refuses a host caller with no partial write |
| integration | `supabase/tests/jwt/setup-endpoint.test.mjs` | /api/setup returns 404 when SETUP_SECRET is unset, 401 for a wrong secret (constant-time compare), and 200 with a persisted admin role for the correct rotated secret |
| manual-rehearsal | `docs/runbooks/staff-lifecycle.md end-to-end rehearsal (invite, promote, password reset, deprovision)` | the process is executable by a person under time pressure and every step has an observable database result |

**Preflight (read-only, run against production before the change).**

```sql
select u.id, u.email, u.created_at, u.last_sign_in_at, u.banned_until, p.role from auth.users u left join public.profiles p on p.id = u.id order by u.created_at; select count(*) as admins from public.profiles where role = 'admin';
```

**Rollback.** Role changes are reversible with the same RPC (and every change leaves an audit row, so the prior state is recoverable from the audit trail). /api/setup is disarmed instantly by unsetting SETUP_SECRET, which makes it 404 with no deploy. If the audit table or RPC must be withdrawn, drop them in a single migration; profiles data is untouched.

**Register entries absorbed.** 46

### `sec-winners-insert-open-to-hosts` :: A host can hand-craft a winners row straight through the API, fabricating a jackpot and forcing a pot reset

**R0-blocker** | severity critical, likelihood unlikely | effort XS | area security | status **done**

The winners INSERT policy tests only profiles.role in (admin, host) with no constraint on any column, and authenticated holds table-wide INSERT, so a POST to /rest/v1/winners skips every guard in record_winner_atomic: the controller lock, the session and stage match, the derived call count and the jackpot window; settle_snowball_pot then reads that forged row and resets the live pot instead of rolling it over. Done means: no INSERT policy on winners grants the host role, a host JWT posting directly to /rest/v1/winners receives 42501, and supabase/tests/run.sh still passes because record_winner_atomic is SECURITY DEFINER owned by postgres on a table without FORCE ROW LEVEL SECURITY and never needed the policy.

**Why this priority.** I am assuming a legitimate host account is not trusted against deliberate direct API use, because a host holds a real JWT in a browser with devtools open, which is the same reasoning CLAUDE.md already applies to the winners UPDATE side. On that assumption this is a real hole, but it is not R0: it needs a deliberate insider, and that insider can already cause a pot reset through the sanctioned Manual Snowball Award button, so what the policy uniquely adds is fabricated history, an arbitrary winner_name against the anonymity policy, and a bypass of the controller lock. It earns R1 purely on price. Nothing in src/ inserts into winners, so this is a one line policy drop with no application change and a harness that already proves the host flow survives. One constraint to carry into any fix for the separate host refresh problem: winners must not be added to the supabase_realtime publication. Its SELECT policy is 'Read access for all' granted to public, so publishing it would stream void_reason free text and client_request_id to every punter phone on /player. Refresh after the mutation instead.

**Priority changed by the merge pass.** Raised from R1/high. Under the stated assumption that a host account is not trusted against deliberate direct API use, this is the cheapest route to fabricated money: the winners INSERT policy constrains no column, so a POST to /rest/v1/winners skips the controller lock, the session and stage match, the derived call count and the jackpot window, and settle_snowball_pot then reads the forged row and resets a live pot. The fix is XS (drop the host arm of the policy; record_winner_atomic is SECURITY DEFINER owned by postgres on a table without FORCE ROW LEVEL SECURITY and never needed it).

**Files.** `supabase/migrations/20251201000000_baseline_schema.sql`, `supabase/migrations/20260730065531_atomic_snowball_settlement.sql`, `supabase/tests/run.sh`

**Acceptance criteria.**

- **Given** The migration applied (assumed default: drop the 'Hosts/Admins can create winners' INSERT policy entirely, since record_winner_atomic never needed it) **when** select policyname, cmd, with_check from pg_policies where schemaname='public' and tablename='winners' and cmd='INSERT' **then** no returned row grants the host role: either zero INSERT policies exist, or exactly one admin-only policy exists
- **Given** A JWT for an account with profiles.role 'host' **when** it POSTs directly to /rest/v1/winners with a hand-crafted body setting is_snowball_jackpot true for a live game **then** the response is HTTP 403 with code 42501, and select count(*) from public.winners where game_id = <game> is identical before and after
- **Given** The same host through the normal flow **when** the Record Winner modal submits and record_winner_atomic runs **then** the call succeeds, exactly one new winners row exists with winner_name = 'Anonymous', client_request_id equal to the modal's key, and is_snowball_jackpot set from the server-derived eligibility, not from any client field
- **Given** The direct-insert route is closed and a genuine non-jackpot full house has been recorded **when** settle_snowball_pot runs for that game **then** the pot rolls over: current_max_calls = previous + calls_increment and current_jackpot_amount = previous + jackpot_increment, and it does not reset to base, proving no forged jackpot row could have forced the reset
- **Given** The retry path **when** the same claim is submitted twice with the same client_request_id **then** still exactly one winners row exists and the second call returns the current state rather than raising, so closing the policy did not disturb idempotency
- **Given** The full migration set **when** bash supabase/tests/run.sh is executed **then** it exits 0, including the host-flow suite, confirming record_winner_atomic (SECURITY DEFINER, owner postgres, on a table with relforcerowsecurity = false) works with no INSERT policy present

**Tests.**

| Level | Name | Proves |
|---|---|---|
| sql-harness | `supabase/tests/winners-insert-policy.test.sql` | the catalogue shows no host-granting INSERT policy, a direct insert under 'set role authenticated' with a host uid is refused, and record_winner_atomic still inserts successfully for that same uid |
| sql-harness | `supabase/tests/run.sh existing host-flow and winner-idempotency suites (regression)` | the host path, ties and retries are unaffected by removing the policy |
| integration | `supabase/tests/jwt/winners-postgrest.test.mjs` | a real host JWT hitting PostgREST receives 403/42501 rather than being filtered to a silent no-op |
| manual-rehearsal | `Live-night rehearsal, 'record a full house and a snowball full house'` | the host UI records winners normally with the policy gone |

**Preflight (read-only, run against production before the change).**

```sql
select policyname, cmd, qual, with_check from pg_policies where schemaname='public' and tablename='winners' order by cmd, policyname; select relrowsecurity, relforcerowsecurity, relacl from pg_class where oid = 'public.winners'::regclass; select count(*) as winners_rows, count(*) filter (where coalesce(is_snowball_jackpot,false)) as jackpot_rows from public.winners;
```

**Rollback.** The migration records the exact CREATE POLICY statement it drops in its ROLLBACK comment; re-running that one statement restores the previous behaviour with no data change. Because the RPC is SECURITY DEFINER on a table without FORCE ROW LEVEL SECURITY, neither direction affects existing rows.

**Register entries absorbed.** 9, 31

### `live-composite-advance-break-not-atomic` :: Continue and Take Break advances the stage before the break call, so a retry skips a whole stage

**R1-before-release** | severity high, likelihood possible | effort M | area liveflow | status **not started**

handleContinuePlaying(true) awaits advanceToNextStage and then awaits toggleBreak as a second round trip. If the break call fails or is lost, the stage has already moved, the host sees "Failed to start break", and pressing the same button again advances a second stage because advanceToNextStage re-reads the now-newer index.

**Why this priority.** A skipped stage means a prize such as Two Lines is never played, and because current_stage_index can only ever increase there is no way to put it back. The room is told the wrong stage and punters who were on two lines lose their shot. The two writes need to be one server action under one lock, keyed so a repeat is safe.

**Files.** `src/app/host/[sessionId]/[gameId]/game-control.tsx`, `src/app/host/actions.ts`

**Depends on.** `live-mutation-protocol`, `live-stage-cannot-step-back`

**Acceptance criteria.**

- **Given** A game in_progress at current_stage_index 0 of stage_sequence ['Line','Two Lines','Full House'], on_break false, state_version V. Assumed default: the two round trips are replaced by one RPC that advances the stage and sets the break inside a single transaction under the existing for-update lock. **when** The host taps Continue and Take Break and it commits. **then** In the database: current_stage_index = 1 AND on_break = true, both applied by a single UPDATE so state_version = V + 1 exactly. The screen shows stage 'Two Lines' and the break state together.
- **Given** The same starting state, with the break half made to fail inside the function. **when** The host taps Continue and Take Break. **then** An error is shown naming the action. In the database: current_stage_index is still 0 and on_break is still false and state_version is still V. Nothing is partially applied, which is the whole defect.
- **Given** The call commits but the response is lost in transit. **when** The host taps the same button again, carrying the same request id from the live-mutation-protocol item. **then** In the database: current_stage_index = 1 (not 2), on_break = true, state_version = V + 1, and exactly one host_mutation_requests row exists for that id. The retry must not consume a stage.
- **Given** A game on break at current_stage_index 1. **when** The host taps Continue without taking a break. **then** In the database: current_stage_index = 2, on_break = false, display_win_type, display_win_text and display_winner_name all null, state_version = V + 1.
- **Given** A game at the final stage index of its stage_sequence. **when** The host taps Continue and Take Break. **then** The action is refused with a message pointing the host at the end-of-game route rather than advancing past the last stage. In the database: current_stage_index unchanged and on_break unchanged.

**Tests.**

| Level | Name | Proves |
|---|---|---|
| sql-harness | `supabase/tests/advance-and-break-atomic.test.sql` | The combined function commits both column changes in one UPDATE (state_version advances by exactly 1), rolls both back when the break half raises, refuses past the final stage, and is a no-op on replay of the same request id. |
| concurrency | `supabase/tests/advance-and-break-contention.test.sql` | Two connections calling the combined function at once produce exactly one stage advance, because the for-update lock and the stage precheck are inside the same transaction. |
| integration | `src/app/host/continue-and-break.test.ts` | handleContinuePlaying(true) issues a single server call, and on failure leaves the UI showing the pre-advance stage rather than a stage the database did not award. |
| failure-injection | `rehearsal: drop the response to Continue and Take Break, then retry` | The retry advances one stage and not two, confirmed by a read-only query on current_stage_index. |

**Preflight (read-only, run against production before the change).**

```sql
select gs.game_id, g.name, gs.current_stage_index, g.stage_sequence, gs.on_break, gs.status, gs.state_version from public.game_states gs join public.games g on g.id = gs.game_id where gs.status = 'in_progress' order by gs.updated_at desc;
```

**Rollback.** Revert to the two-call client sequence by reverting the game-control.tsx commit; the new RPC can be left in place unused (it is additive and grants are host-only), or dropped in a follow-up migration. No data written by the new function needs undoing beyond the host_mutation_requests audit rows, which are append-only.

**Register entries absorbed.** 13

### `live-controller-lock-no-release` :: The controller lock can be taken but never released, so a second staff device can lock the host out

**R1-before-release** | severity high, likelihood possible | effort M | area liveflow | status **not started**

takeControl sets controlling_host_id and there is no matching release action anywhere. Once a different staff account grabs control during a stale-heartbeat window, its tab keeps heartbeating every ten seconds, so the real host's take-control call is refused for as long as that tab stays open and there is no admin override.

**Why this priority.** It takes two different staff accounts to trigger, so it is not a certainty, but when it happens the host simply cannot run the game from the device in their hand and has no in-app way out. The same-account case is safe because takeControl already allows a self-takeover. Not R0 only because closing self-signup removes the stranger version of this.

**Files.** `src/app/host/actions.ts`, `src/app/host/[sessionId]/[gameId]/game-control.tsx`

**Blocked on a decision.** Should an admin be able to force control away from a device that is still heartbeating, or must the holder release it themselves? Recommendation: allow an admin force-takeover with an audit row, because on a live night the alternative is walking round the pub to find an open tab.

**Acceptance criteria.**

- **Given** Device A holds control: game_states.controlling_host_id = A's user id with a fresh controller_last_seen_at. Assumed default: add an explicit host-callable release plus an admin-only forced override, and make the heartbeat refresh an existing lock only, never acquire one. **when** Device A taps Hand Over Control, or closes the host page. **then** In the database: controlling_host_id is null and controller_last_seen_at is null, and state_version has advanced by exactly 1. A's screen shows the take-control prompt and its mutating buttons are disabled.
- **Given** Control released as above. **when** Device B taps Take Control. **then** It succeeds on the first attempt with no stale-heartbeat wait. In the database: controlling_host_id = B's user id, controller_last_seen_at is within the last 5 seconds, state_version advanced by exactly 1.
- **Given** Device B holds control and is heartbeating every 10 seconds, and the real host on device A cannot take it back. **when** An admin uses the forced-release override on /admin/sessions/[id] for that game. **then** In the database: controlling_host_id and controller_last_seen_at are null. Within one poll interval device B's screen shows it no longer controls and disables its mutating buttons, and B's next heartbeat does NOT re-acquire the lock (controlling_host_id stays null until someone explicitly takes control).
- **Given** A signed-in user whose profiles.role is 'host', holding a real browser JWT. **when** They call the forced-release RPC directly against /rest/v1/rpc with their own token. **then** The call is refused for insufficient privilege. In the database: controlling_host_id and controller_last_seen_at are unchanged. The override is a money-adjacent admin power and must not be reachable by a host.
- **Given** Device A does not hold the lock (controlling_host_id is B). **when** Device A calls the ordinary release action for that game. **then** The call is refused. In the database: controlling_host_id is still B and state_version is unchanged. Release must be holder-only so it cannot be used as a back-door take-control.

**Tests.**

| Level | Name | Proves |
|---|---|---|
| sql-harness | `supabase/tests/controller-lock-release.test.sql` | Release by the holder clears both columns; release by a non-holder is refused; the admin override clears them; a host JWT is refused the override; and the heartbeat function refreshes an existing lock but never acquires a null one. |
| concurrency | `supabase/tests/controller-lock-contention.test.sql` | Two connections racing release and take-control produce a single well-defined owner under the for-update lock, with no window where both devices believe they control the game. |
| sql-harness | `supabase/tests/grants.test.sql` | Extended to assert anon has no EXECUTE on the release or override functions and that the override is not granted to the host role, catching the default-privilege drift already known to bite this project. |
| manual-rehearsal | `rehearsal step 3: two staff phones fighting over control, then an admin override` | The real recovery path works from the admin screen without a session reset, and the loser's screen degrades to read-only rather than showing live controls that would fail. |

**Preflight (read-only, run against production before the change).**

```sql
select gs.game_id, g.name, gs.status, gs.controlling_host_id, gs.controller_last_seen_at, now() - gs.controller_last_seen_at as heartbeat_age from public.game_states gs join public.games g on g.id = gs.game_id where gs.controlling_host_id is not null order by gs.updated_at desc; select id, role from public.profiles order by role;
```

**Rollback.** Drop the release and override functions in a follow-up migration and revert the client commit. controlling_host_id and controller_last_seen_at are pre-existing columns and are not altered by the change, so no data migration is involved. If the override needs disabling urgently without a deploy, revoke EXECUTE on it from authenticated: the pre-change stale-heartbeat path still works.

**Register entries absorbed.** 55

### `live-display-no-wake-lock` :: The pub TV display never takes a wake lock, contrary to the documented design

**R1-before-release** | severity medium, likelihood likely | effort XS | area liveflow | status **not started**

player-ui.tsx imports and calls useWakeLock, and CLAUDE.md states that wake-lock.ts keeps the screen awake on host and display, but display-ui.tsx has no such import or call. The one screen the whole room watches is the only one that can sleep.

**Why this priority.** Whether this bites depends on how the TV is driven, but a browser on a stick or mini PC will dim or sleep during a long break and the room loses the board. The fix is a single import and call matching what the player screen already does, and it closes a stated-versus-actual gap in the project's own documentation.

**Files.** `src/app/display/[sessionId]/display-ui.tsx`, `src/hooks/wake-lock.ts`

**Acceptance criteria.**

- **Given** /display/[sessionId] open on the pub TV browser with a live game running, and the operating system screen timeout set to 5 minutes. **when** The TV is left untouched for 30 minutes while the host calls balls. **then** The screen is still lit and still showing the current ball. A wake lock is held: either navigator.wakeLock has a non-released sentinel or the nosleep.js fallback video is playing, checkable in the console. In the database: nothing is written by the display, so game_states.state_version changes only by the host's own calls.
- **Given** The TV browser tab is backgrounded (screensaver, tab switch), which releases the wake lock. **when** The tab returns to the foreground. **then** The lock is re-acquired without a page reload and without a fresh user gesture where the browser allows it, and the display still shows the live state.
- **Given** The session is completed and the thank-you screen is showing. **when** The screen sits idle. **then** The wake lock is released so the TV can sleep normally, matching how a night actually ends.
- **Given** A browser with no Wake Lock API. **when** /display/[sessionId] loads. **then** The page renders normally, no unhandled promise rejection is logged, and the nosleep.js fallback engages, matching the behaviour player-ui.tsx already has.
- **Given** The change under review. **when** The source of display-ui.tsx is scanned. **then** It imports and calls useWakeLock, matching the documented design in CLAUDE.md that says wake-lock.ts keeps the screen awake on host and display.

**Tests.**

| Level | Name | Proves |
|---|---|---|
| unit | `src/hooks/wake-lock.test.ts` | The hook acquires on mount, releases on unmount, re-acquires on visibilitychange back to visible, and resolves without throwing when navigator.wakeLock is absent. |
| unit | `src/app/display/[sessionId]/wake-lock-wired.test.ts` | A source scan asserting display-ui.tsx calls useWakeLock, so the documented design and the code cannot silently diverge again. |
| manual-rehearsal | `rehearsal step 9: leave the TV on the display screen for 30 minutes` | The one screen the whole room watches does not sleep mid-game on the actual TV hardware and browser, which is the only place this can genuinely be proven. |

**Rollback.** Client-only. Revert the display-ui.tsx commit and the TV returns to its current no-lock behaviour. No schema change and no writes.

**Register entries absorbed.** 68

### `live-no-clean-end-or-abandon` :: A game can only be ended by recording a valid claim, and skipping the final stage leaves dangling state

**R1-before-release** | severity high, likelihood possible | effort M | area liveflow | status **not started**

"Skip (No Winner)" is rendered only inside the validationResult.valid branch of the claim modal, and the only End Game buttons live in the Post Win modal that opens after recordWinner succeeds, so there is no unconditional end control. Completing a game through skipStage or advanceToNextStage also bypasses endGame, leaving game_states.ended_at null and sessions.active_game_id still pointing at the finished game.

**Why this priority.** Any night cut short by last orders, a fire alarm or a game nobody claims leaves the host with no way to close it down. The session then sits at 'running' for ever, which breaks next week's TV auto-redirect, and the only admin escape resets the session and takes the night's winners with it.

**Files.** `src/app/host/[sessionId]/[gameId]/game-control.tsx`, `src/app/host/actions.ts`, `src/app/admin/sessions/[id]/session-detail.tsx`, `src/app/admin/sessions/[id]/actions.ts`

**Blocked on a decision.** When the host abandons a game part-way, should the snowball pot still roll over for that game, and what happens to a stage prize already announced but never recorded? Recommendation: roll the pot over as normal and record no winner, because an abandoned game consumed no jackpot claim.

**Acceptance criteria.**

- **Given** A game in_progress at any stage index, no claim under validation, with the session's active_game_id pointing at it. Assumed default: an always-available End Game (No Winner) control on the main pad behind a confirm, routed through the same end_game path used after a win. **when** The host taps End Game and confirms. **then** In the database: game_states.status = 'completed', ended_at is not null, on_break = false, paused_for_validation = false, and sessions.active_game_id no longer equals that game id. The screen shows the next-game chooser rather than a dead pad.
- **Given** A game at the final stage of its stage_sequence. **when** The host taps Skip (No Winner) on that final stage. **then** The game completes through the same path. In the database: game_states.status = 'completed', ended_at is not null (the dangling-state defect), and sessions.active_game_id is cleared or advanced to the next game. The host is shown the next step.
- **Given** The final game of a session, ended by either route. **when** The end completes. **then** In the database: sessions.status = 'completed'. The action returns the persisted session row so a zero-row update is impossible to mistake for success.
- **Given** A game with three non-void recorded winners. **when** The host ends it with End Game (No Winner). **then** In the database: the count of winners rows for that game is still 3, every is_void is still false, and every prize_given value is unchanged. Ending a game must never touch money already awarded.
- **Given** End Game committed with a request id, then the response lost. **when** The host taps End Game again with the same request id. **then** In the database: ended_at holds its original timestamp unchanged, status is still 'completed', and sessions.active_game_id is unchanged. The retry is a no-op.

**Tests.**

| Level | Name | Proves |
|---|---|---|
| sql-harness | `supabase/tests/end-game-completeness.test.sql` | Every route out of a game (recorded win, skip of the final stage, explicit end with no winner) leaves status 'completed', ended_at not null and sessions.active_game_id cleared, and leaves existing winners rows untouched. |
| integration | `src/app/host/end-game-return-shape.test.ts` | endGame returns a failure, not a success, when the sessions update matches zero rows, and the client shows the failure rather than the next-game chooser. |
| unit | `src/lib/host-pad-controls.test.ts` | The End Game control is offered for every in_progress game state (including on break and paused for validation) and is not offered on a completed game, so it is genuinely unconditional rather than buried in the post-win modal. |
| manual-rehearsal | `rehearsal step 5: abandon a game mid-stage, then start the next one` | A real abandoned game does not strand the session, and a read-only query confirms ended_at and active_game_id afterwards. |

**Preflight (read-only, run against production before the change).**

```sql
select s.id as session_id, s.name, s.status as session_status, s.active_game_id, gs.game_id, gs.status as game_status, gs.ended_at from public.sessions s join public.games g on g.session_id = s.id join public.game_states gs on gs.game_id = g.id where gs.status = 'completed' and gs.ended_at is null; select id, name, status, active_game_id from public.sessions where status = 'running';
```

**Rollback.** Revert the client commit to remove the End Game control, and revert the end_game function to its prior body in a new migration. Games already completed by the new route stay completed with ended_at set, which is strictly better data than the pre-change null, so no backfill or reversal of rows is required.

**Register entries absorbed.** 6, 57, 122, 128

### `live-public-anon-column-exposure` :: The narrow public SELECT lists are not a security boundary

**R1-before-release** | severity medium, likelihood possible | effort S | area liveflow | status **not started**

Four comments in the display and player code claim that explicit narrow column lists stop public surfaces leaking unintended fields. RLS grants row access, not column access, so anyone who scans the QR has the anon key from the page bundle and can read every column of games and sessions, including notes and created_by.

**Why this priority.** Nothing currently stored in those columns is sensitive on a pub night, so this is not a live-night blocker. It is a false comfort in a comment that the next developer will believe, and the correct mechanism is a column-level grant to anon rather than a select list. This overlaps the security area's RLS work and should be fixed there.

**Priority changed by the merge pass.** Raised from R2/low. Developer review R05 warns against leaving a serious item soft because of where it landed, and this one was scored on its narrative section rather than its content. Four comments in the display and player code assert that narrow SELECT column lists are a security boundary; they are not, and the anon key is in the public page bundle, so anyone who scans the QR can read every column of sessions and games including notes and created_by. Either narrow the grants or delete the false claim, and that decision belongs with the block 3 RLS work rather than a later cycle.

**Files.** `src/app/display/[sessionId]/page.tsx`, `src/app/player/[sessionId]/page.tsx`, `supabase/migrations/`

**Acceptance criteria.**

- **Given** The anon key readable from the /display page bundle by anyone who scans the QR. Assumed default: column-level SELECT grants to anon on public.sessions and public.games are narrowed to the columns the public screens actually consume, and the four misleading comments are corrected. The alternative (a dedicated public view) was not assumed because it is a larger change. **when** An anon client issues GET /rest/v1/games?select=* for a live session. **then** Only the agreed public columns are returned. An explicit GET /rest/v1/games?select=notes returns HTTP 401/403 with PostgREST code 42501. In the database: has_column_privilege('anon', 'public.games', 'notes', 'SELECT') is false.
- **Given** The same anon key. **when** It issues GET /rest/v1/sessions?select=*. **then** Only id, name, status and active_game_id are returned, and has_column_privilege('anon', 'public.sessions', 'created_by', 'SELECT') is false, matching what the public pages already claim to read.
- **Given** A signed-in admin JWT. **when** It reads the same tables. **then** Every column is still returned and /admin/sessions/[id] still renders notes and created_by. The narrowing must not break the staff surfaces.
- **Given** A signed-in host JWT. **when** The host runs a full game end to end in the rehearsal. **then** Every host screen renders and every host action succeeds, so the narrowed grants did not remove a column the host flow depends on.
- **Given** The source of display-ui.tsx, player-ui.tsx and both public page.tsx files after the change. **when** They are scanned for the claim that narrow SELECT lists prevent leaking unintended fields. **then** That claim is gone, replaced by an accurate note that the narrow list documents what the UI consumes and that the real boundary is the column grant. A false comfort in a comment is what let this stand.

**Tests.**

| Level | Name | Proves |
|---|---|---|
| sql-harness | `supabase/tests/anon-column-grants.test.sql` | has_column_privilege('anon', ...) is false for every non-public column of sessions and games and true for every column the public screens read, and the same assertions hold after a second apply of all migrations. |
| sql-harness | `supabase/tests/grants-drift.sql` | Extended to re-grant the columns and prove the repair migration takes them away again, catching the default-privilege drift that already handed anon EXECUTE back on the host RPCs once. |
| integration | `src/app/display/public-column-usage.test.ts` | The display and player pages render from exactly the narrowed column set, so the grant and the code agree and a future UI change cannot silently rely on a revoked column. |
| manual-rehearsal | `rehearsal step 16: full night on host, admin, display and player after the revoke` | No staff or public screen lost a field it needs, which is the only real risk in narrowing grants. |

**Preflight (read-only, run against production before the change).**

```sql
select table_name, column_name, privilege_type from information_schema.column_privileges where grantee = 'anon' and table_schema = 'public' and table_name in ('sessions','games','game_states_public','snowball_pots') order by table_name, column_name; select table_name, column_name from information_schema.columns where table_schema = 'public' and table_name in ('sessions','games') order by table_name, ordinal_position; select policyname, cmd, roles from pg_policies where schemaname = 'public' and table_name is not null and tablename in ('sessions','games') order by tablename, policyname;
```

**Rollback.** A single migration that re-grants SELECT on all columns of public.sessions and public.games to anon restores the previous behaviour immediately with no data change. Because a wrongly narrowed grant breaks a public screen visibly and instantly, keep that re-grant statement ready to paste during the release window. The comment corrections are reverted with the code commit.

**Register entries absorbed.** 136

### `live-public-poll-can-hang-forever` :: The public poll has no request deadline and connection health never decays with time

**R1-before-release** | severity high, likelihood possible | effort M | area liveflow | status **not started**

pollInFlightRef is a plain boolean and the Supabase request has no timeout, so one never-settling fetch stops all polling for good. Nothing marks a failure in that case, and no selector reads lastSuccessAt, so pollState stays healthy, the reconnecting banner never appears and the auto-refresh never fires.

**Why this priority.** The health model only notices a transport that actively reports failure, never one that simply stops delivering. The failure mode is a pub TV frozen on an old number, showing no warning at all, while the host keeps calling. That is worse than a visible outage because nobody in the room knows the screen is wrong.

**Files.** `src/lib/connection-health.ts`, `src/app/display/[sessionId]/display-ui.tsx`, `src/app/player/[sessionId]/player-ui.tsx`, `src/hooks/use-connection-health.ts`

**Acceptance criteria.**

- **Given** The display page polling every 3 seconds, with one fetch made to never settle. Assumed defaults: an 8 second request deadline enforced with AbortController, and a 15 second staleness decay on lastSuccessAt. **when** The host waits 30 seconds. **then** The hung request is aborted at 8 seconds, a poll failure is marked once, and the next scheduled tick issues a fresh request rather than being blocked by the in-flight flag. In the database: nothing is written by the public page.
- **Given** The same, with the server permanently unreachable so every poll aborts. **when** 30 seconds elapse. **then** The Reconnecting banner is visible (selectShouldShowBanner returns true), and where the browser is online with nothing unsaved exactly one auto-reload fires at the documented threshold, so the hang is no longer invisible.
- **Given** A health state that received a success at time T and then no events at all, because polling stopped silently. **when** The clock advances to T + 15 seconds. **then** selectHealthy returns false purely from time decay against lastSuccessAt, with no failure event required. This is the case the current implementation cannot detect.
- **Given** The connection recovering after a hang. **when** One poll succeeds. **then** The banner clears within one tick and the number of balls rendered equals game_states_public.numbers_called_count for that session's active game, verified by a read-only query at that instant.
- **Given** Normal healthy operation with every poll settling in under a second. **when** Ten minutes of polling run. **then** No request is aborted, no spurious failure is marked, and the banner never appears. The deadline must not cause false failures on a slow but working connection.

**Tests.**

| Level | Name | Proves |
|---|---|---|
| unit | `src/lib/connection-health.test.ts` | A new time-decay selector marks the transport unhealthy when now minus lastSuccessAt exceeds the staleness threshold with no events, and recovers on the first success, extending the existing coverage rather than replacing it. |
| unit | `src/lib/poll-deadline.test.ts` | The in-flight guard holds a token and a start time rather than a boolean: a request older than the deadline is abandoned, marked as a failure exactly once, and does not block the next tick; a late reply from an abandoned request is discarded. |
| failure-injection | `rehearsal: throttle the Supabase origin to a black hole with the TV on /display` | The banner appears within the documented window and the screen recovers on its own when the origin returns, rather than sitting silently healthy and frozen. |
| manual-rehearsal | `rehearsal step 8: watch the TV through a 2 minute network stall` | The stall is visible to the room as a Reconnecting banner and the ball count matches the database once the network returns. |

**Rollback.** Client-only. Revert the commit and the boolean in-flight flag and the event-only health selectors return. No schema change, no writes to reverse.

**Register entries absorbed.** 69

### `live-stage-cannot-step-back` :: current_stage_index can only ever increase, so an accidental advance is unrecoverable

**R1-before-release** | severity high, likelihood possible | effort M | area liveflow | status **not started**

Every write to current_stage_index in the code and in the Postgres functions is either plus one, a fresh start that zeroes it, or reset_session_safe. There is no decrement anywhere, so a mis-tapped Continue or Skip permanently removes a stage from the night with no route back short of a destructive session reset.

**Why this priority.** One mis-tap on a busy bar, or one retry of the composite break action, costs a whole prize stage that the room has already paid to play. Today the only correction is a session reset that wipes the winners, so in practice the host will carry on and the pub will settle it out of the till.

**Files.** `src/app/host/actions.ts`, `supabase/migrations/`

**Depends on.** `live-mutation-protocol`

**Blocked on a decision.** Who may step a game back to a stage it has already left, host or admin only, and what happens to a non-void winner already recorded at the stage being abandoned? Recommendation: admin only, confirm-gated, and refuse outright while a non-void winner exists at the target stage.

**Acceptance criteria.**

- **Given** A game in_progress at current_stage_index 1, with no non-void winners recorded for that game. Assumed default: step-back is admin-only, reached from /admin/sessions/[id], not exposed to the host, because reversing an awarded stage is a money decision. **when** An admin taps Step Back a Stage and confirms. **then** In the database: current_stage_index = 0, state_version advanced by exactly 1, called_numbers is the identical array and numbers_called_count is the identical value (balls are not un-drawn), and display_win_type, display_win_text and display_winner_name are all null.
- **Given** A game at current_stage_index 1 with a non-void winners row already recorded at stage index 0. **when** The admin attempts to step back. **then** The call is refused with a message naming the blocking winner. In the database: current_stage_index is still 1 and no winners row is altered. A stage that has been paid must not be silently reopened.
- **Given** A game at current_stage_index 0. **when** The admin attempts to step back. **then** The call is refused. In the database: current_stage_index is still 0, never negative, and state_version is unchanged.
- **Given** A signed-in user whose profiles.role is 'host', holding a real browser JWT. **when** They call the step-back RPC directly against /rest/v1/rpc. **then** The call is refused for insufficient privilege and current_stage_index is unchanged, matching the admin-only boundary already applied to the pot tables and the winners UPDATE policy.
- **Given** A step-back that committed and whose response was lost. **when** The admin retries with the same request id. **then** In the database: current_stage_index is 0, not -1, and exactly one audit row exists for the request id.

**Tests.**

| Level | Name | Proves |
|---|---|---|
| sql-harness | `supabase/tests/stage-step-back.test.sql` | Step-back decrements by one under the for-update lock, refuses at index 0, refuses when a non-void winner exists at or above the target index (with coalesce(is_void,false) = false so NULL rows are not skipped), leaves called_numbers untouched, and is a no-op on replay. |
| sql-harness | `supabase/tests/grants.test.sql` | Extended to assert anon and the host role have no EXECUTE on the step-back function, and that a re-apply of the migration does not hand the grant back through default privileges. |
| integration | `src/app/admin/stage-step-back.test.ts` | The admin action surfaces the winner-blocked refusal as a distinct, actionable message rather than a generic failure, and does not offer the control on a completed game. |
| manual-rehearsal | `rehearsal step 6: mis-tap Continue, then recover with an admin step-back` | The recovery route works during a live game without a destructive session reset, and the called balls are still intact afterwards. |

**Preflight (read-only, run against production before the change).**

```sql
select gs.game_id, g.name, gs.current_stage_index, g.stage_sequence, gs.numbers_called_count, (select count(*) from public.winners w where w.game_id = g.id and coalesce(w.is_void, false) = false) as live_winners from public.game_states gs join public.games g on g.id = gs.game_id order by gs.updated_at desc limit 20;
```

**Rollback.** Drop the step-back function in a follow-up migration and revert the admin UI commit. Any step-back already performed leaves only a lowered current_stage_index and cleared display columns, both of which the ordinary advance path can move forward again, so no data repair is needed.

**Register entries absorbed.** 58

### `live-tv-cannot-follow-session-lifecycle` :: An unattended TV never returns to a later live session

**R1-before-release** | severity medium, likelihood likely | effort M | area liveflow | status **not started**

/display is a server component that only redirects when exactly one session is ready or running, and it never refreshes itself, so with zero or two-plus live sessions it sits waiting for a click. /display/[sessionId] treats a completed session as terminal and shows the thank-you screen for ever with no re-check for a newer session.

**Why this priority.** The TV is mounted on a wall with no keyboard. Every week it will still be showing last week's thank-you screen until a staff member gets a remote out, and a session left stuck at 'running' turns the landing page into a picker that nobody can click. This is a weekly nuisance rather than a live-night stopper.

**Files.** `src/app/display/page.tsx`, `src/app/display/[sessionId]/display-ui.tsx`

**Depends on.** `live-no-clean-end-or-abandon`

**Blocked on a decision.** When more than one session is live at once, which one should an unattended TV show? Recommendation: the most recently started running session, since concurrent sessions are not supported in practice and a picker screen is useless on a TV with no input device.

**Acceptance criteria.**

- **Given** No sessions with status 'ready' or 'running', and the pub TV parked on /display. Assumed default: /display re-checks on a 15 second client poll and auto-redirects only when exactly one session is live; /display/[sessionId] on a completed session polls for a newer live session. **when** An admin sets a session to 'ready'. **then** Within 20 seconds the TV navigates to /display/<that session id> with nobody touching it. In the database: the TV writes nothing, so the session row is unchanged apart from the admin's own status update.
- **Given** Two sessions both 'ready' at once, TV on /display. **when** The page polls. **then** A chooser lists both by sessions.name and keeps refreshing as statuses change, and the TV does not pick one automatically. In the database: nothing is written.
- **Given** The TV on /display/<A> where session A has status 'completed', and session B becomes 'running'. **when** 60 seconds elapse. **then** The TV moves to /display/<B> unattended, so an unmanned TV can follow a two-session night.
- **Given** The TV on /display/<A> with A completed and no other live session anywhere. **when** The TV sits for 10 minutes. **then** The thank-you screen stays on show and a poll request is observable in the network log at the expected cadence. It does not 404, blank, or stop checking.
- **Given** Session A completed and then re-opened by an admin back to 'running'. **when** The TV is on the thank-you screen for A. **then** Within one poll interval the TV returns to A's live view, because the check is on current status rather than a one-time terminal decision.

**Tests.**

| Level | Name | Proves |
|---|---|---|
| unit | `src/lib/display-routing.test.ts` | A pure function over a list of {id, status} returns 'redirect to X' for exactly one live session, 'choose' for two or more, 'wait' for none, and 'stay' when the current session is still live, covering all five acceptance states without a browser. |
| integration | `src/app/display/display-index-poll.test.ts` | With a mocked client, the index re-reads sessions on the documented cadence and issues the redirect only on the single-live-session outcome, and a read failure leaves the current view rather than 404ing. |
| manual-rehearsal | `rehearsal step 10: finish session A, start session B, TV untouched` | The unattended TV follows the night across a session boundary, which is the whole point of the item and is not observable in unit tests. |

**Preflight (read-only, run against production before the change).**

```sql
select id, name, status, active_game_id, created_at from public.sessions order by created_at desc limit 20; select status, count(*) from public.sessions group by status;
```

**Rollback.** Revert the two display route commits and the server-component single-redirect behaviour returns. Read-only surfaces, no schema change, no writes to reverse.

**Register entries absorbed.** 56, 137

### `admin-no-void-winner-control` :: An admin reviewing a finished night has no way to void a wrongly recorded win

**R1-before-release** | severity medium, likelihood likely | effort S | area money | status **not started**

voidWinner exists at src/app/admin/sessions/[id]/actions.ts:357 and correctly .select()s to prove the update landed, but nothing imports it: session-detail.tsx imports only createGame, deleteGame, duplicateGame, updateSessionStatus, updateGame and resetSession, and /admin/history offers nothing either, so the only working route is voidWinnerFromHost inside a specific live game screen. Done when the session detail winners table and /admin/history both offer a reason-required void that sets winners.is_void true and winners.void_reason to the typed text.

**Why this priority.** Wrongly recorded wins are the normal reason a night needs correcting, and the only person allowed to void one has to navigate back into a live host control screen to do it. The server action is already written and already safe, so this is wiring rather than new logic. It must land after the pot-correction refusal so the new buttons do not promise a pot movement that does not happen.

**Files.** `src/app/admin/sessions/[id]/actions.ts`, `src/app/admin/sessions/[id]/session-detail.tsx`, `src/app/admin/history/page.tsx`

**Depends on.** `money-void-after-settlement-pot-uncorrected`

**Acceptance criteria.**

- **Given** An admin on /admin/sessions/S with recorded winner W1 in the winners table. **when** They tap Void on W1's row, leave the reason blank and submit. **then** The screen shows 'Give a reason before voiding this winner.' In the database: winners.is_void for W1 is still false and void_reason is still null.
- **Given** The same row. **when** They type 'duplicate claim' and submit. **then** The row re-renders with a VOID badge showing 'duplicate claim'. In the database: select is_void, void_reason from winners where id = W1 returns (true, 'duplicate claim'), proved by the action's .select() returning exactly one row.
- **Given** An admin on /admin/history looking at the same winner. **when** They void it there with the same reason. **then** The same two database columns are set to the same values, and the page re-renders the row as void without a manual reload (revalidatePath on both /admin/history and the session detail path).
- **Given** A host-role account signed in. **when** They navigate to /admin/sessions/S or /admin/history, and separately call voidWinner directly. **then** The pages redirect to /. The direct call returns 'Only an admin can void a winner.' In the database: winners is unchanged and the winners UPDATE policy matched zero rows.
- **Given** Winner W1 already voided with reason 'duplicate claim'. **when** An admin voids it again with reason 'test'. **then** The action reports 'That win is already voided.' and winners.void_reason for W1 is still 'duplicate claim' - the original reason is not overwritten.

**Tests.**

| Level | Name | Proves |
|---|---|---|
| integration | `src/app/admin/sessions/[id]/actions.test.ts` | voidWinner refuses a blank reason, treats a zero-row update as failure rather than success, persists both is_void and void_reason on the happy path, and refuses a non-admin role. |
| sql-harness | `supabase/tests/winners-void-policy.test.sql` | The winners UPDATE policy remains admin-only, so a host JWT PATCH setting is_void is rejected and the UI control is not the only guard. |
| unit | `src/app/admin/history/history-table.test.tsx` | The Void control renders on both the session-detail winners table and /admin/history, and is absent for an already-voided row. |
| manual-rehearsal | `rehearsal/admin-void.md` | An admin reviewing a finished night can void a wrong win from either admin screen without opening a live host game. |

**Preflight (read-only, run against production before the change).**

```sql
select count(*) as total, count(*) filter (where coalesce(is_void,false)) as voided, count(*) filter (where coalesce(is_void,false) and coalesce(void_reason,'') = '') as voided_without_reason from winners;
```

**Rollback.** Remove the UI wiring from session-detail.tsx and the history page. voidWinner already existed unused, so nothing in the database changes in either direction; winners already voided stay voided.

**Register entries absorbed.** 20

### `host-validate-claim-duplicates` :: validateClaim accepts a claim made of the same number repeated

**R1-before-release** | severity medium, likelihood unlikely | effort XS | area money | status **not started**

The action checks the array length against the required count, integer range, presence of the last called ball and membership in the called set, but never de-duplicates, so [7,7,7,7,7] with 7 as the last ball returns valid. Done when a claim containing a repeated number is refused before the membership loop.

**Why this priority.** The grid UI cannot produce duplicates, so this is reachable only by posting the action directly, and validateClaim writes nothing: the announcement and the winner record are separate calls the host makes deliberately. Practical impact on a pub night is nil. Worth the one line whenever the file is next open.

**Priority changed by the merge pass.** Raised from R3/low, the clearest R05 case in the register. validateClaim checks length, range, presence of the last ball and membership, but never de-duplicates, so [7,7,7,7,7] with 7 as the last ball returns valid and the host records a win. It is the only input-validation gap that can pay the wrong person, it compounds with the 27px claim grid in block 6, and it is a two-line fix.

**Files.** `src/app/host/actions.ts`

**Acceptance criteria.**

- **Given** A game whose called set is {7, 12, 33, 41, 55} with 7 as the most recent ball, at the Line stage requiring five numbers. **when** The host enters [7, 7, 7, 7, 7] and validates. **then** The result is invalid with 'That claim repeats a number (7). Check the book again.' In the database: no winners row is written and game_states is unchanged - validation is read-only.
- **Given** The same game. **when** The host enters [7, 12, 33, 41, 55]. **then** The result is valid.
- **Given** The same game. **when** The host enters [7, 12, 12, 41, 55]. **then** Invalid, naming 12 as the repeat, and the refusal happens before the called-set membership loop runs.
- **Given** A claim with the right count and no repeats but missing the most recent ball, e.g. [12, 33, 41, 55, 61]. **when** Validated. **then** Still invalid for the existing reason (the last ball is not in the claim). The new duplicate check does not mask the existing checks or change their messages.
- **Given** A claim array of the wrong length, e.g. four numbers at the Line stage. **when** Validated. **then** Refused for length first, exactly as today.

**Tests.**

| Level | Name | Proves |
|---|---|---|
| unit | `src/lib/claim-validation.test.ts` | Duplicate detection runs before the membership check, names the repeated number, and does not alter the existing length, range, last-ball and membership outcomes. |
| integration | `src/app/host/actions.test.ts` | validateClaim returns {valid:false} for a repeated number without querying the called-numbers list, using a stub that fails the test if the read is issued. |
| manual-rehearsal | `rehearsal/claim-validation.md` | Mis-tapping the same number five times on the 90-number grid produces a refusal, not a false Valid Claim. |

**Rollback.** Remove the de-duplication check from validateClaim. The action is read-only, so no persisted state is affected in either direction.

**Register entries absorbed.** 135

### `money-admin-pot-write-not-atomic` :: Admin pot edits and resets are not proved to land and swallow their own audit failure

**R1-before-release** | severity high, likelihood possible | effort M | area money | status **not started**

updateSnowballPot and resetSnowballPot both issue a bare .update() with no .select() on the money table and then insert the snowball_pot_history row in a separate round trip whose failure is only console.error'd while the action still returns success, which is the exact split the codebase already fixed for the host path in settle_snowball_pot. Done when both go through a SECURITY DEFINER RPC guarded by assert_is_admin() that writes the pot and the history row in one transaction and returns the persisted pot row, and a missing history row fails the action.

**Why this priority.** Manual pot corrections happen exactly when something has already gone wrong, which is the worst moment to be told a write succeeded when no row moved or no audit entry exists. CLAUDE.md names this shape as having already produced two silent-success bugs in this codebase, and it is still standing on the money table itself. Every other route to the pot is already transactional, so this is the last one left.

**Files.** `src/app/admin/snowball/actions.ts`

**Acceptance criteria.**

- **Given** Pot P at 54 calls / £140.00, an admin signed in on /admin/snowball. **when** The admin changes the current jackpot to £160.00 and saves. **then** The screen shows £160.00. In the database: snowball_pots.current_jackpot_amount = 160.00; exactly one new snowball_pot_history row with change_type = 'manual_edit', old_val_jackpot = 140.00, new_val_jackpot = 160.00, game_id null, and changed_by equal to the admin's auth.uid().
- **Given** The same edit, with the history insert forced to fail inside the function (failure injection, e.g. a deliberately violated constraint on snowball_pot_history). **when** The admin saves. **then** The action returns an error and the screen shows no success. In the database: snowball_pots.current_jackpot_amount is still 140.00 - both writes rolled back together - and snowball_pot_history gained no row.
- **Given** A host-role account with a real JWT calling update_snowball_pot_safe directly. **when** The RPC is invoked. **then** It raises unauthorized (assert_is_admin). In the database: the pot row is unchanged and no history row exists.
- **Given** Pot P. **when** An admin changes only the name and the increments, leaving current_max_calls and current_jackpot_amount alone, and saves. **then** snowball_pots.name and the increment columns are updated; select count(*) from snowball_pot_history where snowball_pot_id = P is unchanged - configuration is not a money movement and must not produce an audit row claiming one.
- **Given** Pot P at 60 calls / £180 with base 42 calls / £20. **when** An admin confirms Reset to base. **then** snowball_pots.current_max_calls = 42 and current_jackpot_amount = 20.00; exactly one new history row with change_type = 'manual_reset' carrying both old and new values; last_awarded_at is unchanged.
- **Given** The RPC returns no row (RLS or a missing pot). **when** The action processes the result. **then** The action returns 'Could not save that change. Please reload and try again.' and never reports success on an unproved write.

**Tests.**

| Level | Name | Proves |
|---|---|---|
| sql-harness | `supabase/tests/admin-pot-rpc.test.sql` | update_snowball_pot_safe and reset_snowball_pot_safe write the pot and the history row in one transaction, roll both back on a forced history failure, refuse a host-role caller, and write no history row for a configuration-only change; both return the persisted pot row. |
| failure-injection | `supabase/tests/admin-pot-rpc.test.sql` | With snowball_pot_history made to reject the insert, the pot figures are identical before and after the attempt. |
| integration | `src/app/admin/snowball/actions.test.ts` | A null RPC return is treated as failure, and mapPotRpcError converts pot_not_found, pot_archived and unauthorized into admin-readable copy rather than raw Postgres text. |
| manual-rehearsal | `rehearsal/pot-edit.md` | After an edit the /admin/snowball history panel shows the movement with the admin's name, the old value and the new value. |

**Preflight (read-only, run against production before the change).**

```sql
select p.id, p.name, p.current_max_calls, p.current_jackpot_amount, p.base_max_calls, p.base_jackpot_amount, count(h.id) as history_rows, max(h.created_at) as last_history from snowball_pots p left join snowball_pot_history h on h.snowball_pot_id = p.id group by 1,2,3,4,5,6;
```

**Rollback.** drop function public.update_snowball_pot_safe(uuid, text, int, numeric, int, numeric, int, numeric); drop function public.reset_snowball_pot_safe(uuid); and restore the previous two-round-trip bodies of updateSnowballPot and resetSnowballPot. History rows written by the new path are kept - they are real audit and must not be removed.

**Register entries absorbed.** 27, 52, 61, 74, 104, 117

### `money-cash-jackpot-name-regex` :: Starting any game whose name contains "jackpot" overwrites every stage prize

**R1-before-release** | severity high, likelihood possible | effort XS | area money | status **not started**

isCashJackpotGame falls back to a name regex for anything not typed snowball, so a standard multi-stage game named "Game 5 Jackpot" prompts the host for a cash amount and startGame writes that single prize text over every entry in stage_sequence, and update_game_safe then refuses prize edits once the game has started. Done when the regex fallback is removed, the prize write is gated on type = 'jackpot' and touches only the final stage, and the games update carries .select() so a filtered write cannot report success.

**Why this priority.** The Line and Two Lines prizes are destroyed irrecoverably and the big screen then advertises the full cash jackpot for every stage, so the room is told the wrong money three times in one game. Production shows all six jackpot-typed games already carry "jackpot" in the name and no standard game does, so the backward-compatibility regex protects nothing and can be deleted with no data impact. It is a four line change that removes a whole class of prize corruption.

**Files.** `src/lib/jackpot.ts`, `src/app/host/actions.ts`, `src/app/admin/sessions/[id]/actions.ts`

**Acceptance criteria.**

- **Given** Game G named 'Game 5 Jackpot' with type = 'regular', stage_sequence ['Line','Two Lines','Full House'] and prizes {'Line':'£10','Two Lines':'£15','Full House':'£25'}. **when** The host taps Start Game. **then** No cash-amount prompt appears and the game starts. In the database: select prizes from games where id = G is byte-identical to its pre-start value; game_states.status = 'in_progress'.
- **Given** Game G with type = 'jackpot' and stage_sequence ['Full House']. **when** The host starts it and enters 250. **then** The prompt is shown. In the database: games.prizes = '{"Full House":"£250 Cash Jackpot"}'::jsonb with exactly one key; game_states.status = 'in_progress'.
- **Given** Game G with type = 'jackpot' and stage_sequence ['Line','Full House'], prizes {'Line':'£10','Full House':'TBC'}. **when** The host starts it and enters 250. **then** games.prizes->>'Line' is still '£10'; games.prizes->>'Full House' is '£250 Cash Jackpot'. Only the final stage was written.
- **Given** A host-role account starts a type='jackpot' game (games UPDATE is admin-only in RLS, so the prize write matches zero rows). **when** startGame runs. **then** The action returns an error naming the prize write. In the database: games.prizes is unchanged and game_states.status is NOT 'in_progress' - the .select() on the games update makes the filtered write a failure rather than a silent success.
- **Given** A table of game names containing the word jackpot in various forms, each with type = 'regular'. **when** isCashJackpotGame is called for each. **then** Every case returns false; the function reads game type only and no name regex remains in the module.

**Tests.**

| Level | Name | Proves |
|---|---|---|
| unit | `src/lib/jackpot.test.ts` | isCashJackpotGame is decided by type alone: 'jackpot' true, 'regular'/'snowball'/null false regardless of name, including 'Game 5 Jackpot' and 'Mini-Jackpot'. |
| integration | `src/app/host/actions.test.ts` | startGame against a stubbed Supabase: a zero-row prize update returns failure and never issues the game_states status write; a regular-typed game issues no prize write at all. |
| sql-harness | `supabase/tests/start-game-prize-write.test.sql` | A host-role caller updating games.prizes matches zero rows under the admin-only policy, so the action's zero-row branch is genuinely reachable in production. |
| manual-rehearsal | `rehearsal/cash-jackpot.md` | Starting a regular multi-stage game whose name contains 'jackpot' leaves all three stage prizes intact on /admin and on the pub TV. |

**Preflight (read-only, run against production before the change).**

```sql
select id, session_id, name, type, stage_sequence, prizes from games where name ~* '\yjackpot\y' and type is distinct from 'jackpot';
```

**Rollback.** Restore the name-regex fallback in src/lib/jackpot.ts and drop the .select() on the prizes update. No schema change; games rows already corrupted by the old behaviour are not restored by either direction and must be corrected by hand.

**Register entries absorbed.** 8, 16, 23

### `money-format-pounds-pence` :: Money renders with the last pence digit stripped, so £212.50 shows as £212.5

**R1-before-release** | severity medium, likelihood possible | effort XS | area money | status **not started**

formatPounds does value.toFixed(2).replace(/\.?0+$/, ''), and record_winner_atomic does the same with trim_scale(round(v_jackpot_amount,2))::text, both on customer-facing surfaces and in the stored winners.prize_description. Done when a pot of 212.50 renders as £212.50 on the display and the winners row text contains 212.50, with whole amounts still shown without decimals.

**Why this priority.** Nobody is paid the wrong sum and £212.5 is unambiguous to a reader, so this is presentation rather than money. It is on the big screen in front of the room and in the permanent audit text, so it reads as sloppy where the pub most wants to look careful. Two lines of change on each side.

**Priority changed by the merge pass.** Raised from R2/low. This is an R05 case: it was scored low because it sits in a formatting section, but the value it mangles is the jackpot advertised to the room on the pub TV and the amount written into the winners audit text by record_winner_atomic. A pot of 212.50 shown as 212.5 is a customer-facing money error in a venue where the number is read aloud. The fix is XS on both sides.

**Files.** `src/lib/snowball.ts`, `supabase/migrations/20260730064309_winner_idempotency_key.sql`

**Acceptance criteria.**

- **Given** A snowball pot with current_jackpot_amount = 212.50. **when** /display, /player/[sessionId], the host control screen and /admin/snowball each render it. **then** All four show '£212.50'. None shows '£212.5'.
- **Given** A pot with current_jackpot_amount = 140.00. **when** The same four surfaces render it. **then** All four show '£140' - whole amounts keep no decimal places, so the pub TV is not cluttered.
- **Given** A pot with current_jackpot_amount = 212.05. **when** Rendered. **then** All four show '£212.05'.
- **Given** A snowball jackpot won on a pot of 212.50. **when** The winner is recorded. **then** In the database: winners.prize_description for that row contains the substring 'Snowball Jackpot £212.50'; game_states.display_win_text contains '£212.50'. Neither contains '£212.5'.
- **Given** A snowball jackpot won on a pot of 140.00. **when** Recorded. **then** winners.prize_description contains 'Snowball Jackpot £140' and not '£140.00'.
- **Given** The formatPounds helper. **when** Called with 212.5, 212.05, 140, 0, 0.5 and NaN. **then** It returns '212.50', '212.05', '140', '0', '0.50' and '0' respectively.

**Tests.**

| Level | Name | Proves |
|---|---|---|
| unit | `src/lib/snowball.test.ts` | formatPounds returns two decimal places whenever there are pence and none when the amount is whole, across the table above including the 0.5 and NaN edges. |
| sql-harness | `supabase/tests/jackpot-text-format.test.sql` | record_winner_atomic builds '£212.50', '£212.05' and '£140' from pot amounts 212.50, 212.05 and 140.00, and writes those strings into winners.prize_description and game_states.display_win_text. |
| manual-rehearsal | `rehearsal/pence-display.md` | A test pot set to 212.50 reads correctly on the TV from the back of the room and on a phone. |

**Preflight (read-only, run against production before the change).**

```sql
select id, name, current_jackpot_amount, base_jackpot_amount, jackpot_increment from snowball_pots where current_jackpot_amount <> round(current_jackpot_amount) or base_jackpot_amount <> round(base_jackpot_amount) or jackpot_increment <> round(jackpot_increment);
```

**Rollback.** Revert formatPounds and the trim_scale text builder inside record_winner_atomic. Display-only going forward; winners rows already written with a stripped pence digit keep their old text and are listed by a select on prize_description like '%.%' for manual correction if the pub wants it.

**Register entries absorbed.** 131

### `money-manual-snowball-prize-text-leak` :: Cancelling the Manual Snowball modal leaves the jackpot amount in the next winner's prize text

**R1-before-release** | severity medium, likelihood possible | effort XS | area money | status **not started**

prizeDescription is one shared state that the Manual Snowball button sets to "£<pot> (Manual Snowball Win)", and neither the modal's Cancel handler nor handleOpenRecordWinnerModal resets it, so the next ordinary Record Winner carries the jackpot amount. Done when handleOpenRecordWinnerModal sets prizeDescription back to the planned prize for the current stage, and the winners row for an ordinary Line win contains the stage prize text only.

**Why this priority.** A £5 Line winner gets an audit row that reads like a £300 jackpot, and the host reading the modal aloud may well pay it. The host does see the field before confirming, which is the only thing keeping this out of the R0 band. It is a one line addition to a handler that already resets three other pieces of state.

**Files.** `src/app/host/[sessionId]/[gameId]/game-control.tsx`

**Acceptance criteria.**

- **Given** A snowball game with pot £140 at the Line stage, whose games.prizes->>'Line' is '£10'. The host taps Manual Snowball Win, then Cancel. **when** The host then taps Record Winner. **then** The prize field reads exactly '£10'. The string 'Manual Snowball Win' and the figure 140 appear nowhere in the modal.
- **Given** The same state. **when** The host records that Line winner without editing the field. **then** In the database: select prize_description from winners for the new row returns exactly '£10'; it contains no '140' and no 'Manual Snowball'; is_snowball_jackpot is false.
- **Given** A stage with no configured prize (games.prizes has no key for it), after a cancelled Manual Snowball modal. **when** The host opens Record Winner. **then** The field is empty, not carrying the pot amount. If the winner is recorded unedited, winners.prize_description is null.
- **Given** The host opens Manual Snowball, cancels, then opens Manual Snowball again. **when** The second Manual Snowball modal renders. **then** The field is repopulated with '£140 (Manual Snowball Win)' - the reset does not break the manual flow it was added to contain.
- **Given** The stage advances from Line to Two Lines while all modals are closed. **when** The host opens Record Winner. **then** The field reads games.prizes->>'Two Lines', not the Line prize and not any earlier manual text.

**Tests.**

| Level | Name | Proves |
|---|---|---|
| unit | `src/app/host/[sessionId]/[gameId]/prize-description.test.ts` | A pure helper covering: after a manual-snowball value has been set, opening the record modal returns the planned prize for the current stage index, and returns null where no prize is configured. |
| integration | `src/app/host/actions.test.ts` | recordWinner passes the prize string through verbatim, so the reset must happen client-side and cannot be papered over on the server. |
| manual-rehearsal | `rehearsal/manual-snowball.md` | Cancel the manual modal, record an ordinary win, and read the winners list: the jackpot figure is absent. |

**Preflight (read-only, run against production before the change).**

```sql
select id, session_id, game_id, stage, prize_description, created_at from winners where prize_description ilike '%manual snowball%' and coalesce(is_snowball_jackpot,false) = false;
```

**Rollback.** Revert handleOpenRecordWinnerModal to leave prizeDescription untouched. UI-only; winners rows already written with the leaked text are listed by the preflight query and must be corrected by an admin.

**Register entries absorbed.** 63

### `money-pot-delete-non-transactional` :: Deleting a snowball pot unlinks every game, then fails on a foreign key it cannot satisfy

**R1-before-release** | severity high, likelihood unlikely | effort M | area money | status **not started**

deleteSnowballPot runs three separate round trips, and because snowball_pot_history has only SELECT and INSERT policies in production the history delete removes nothing and returns no error, so the pot delete then violates snowball_pot_history_snowball_pot_id_fkey while the already-committed unlink has stripped snowball_pot_id from every game that ever used the pot. Done when one SECURITY DEFINER RPC guarded by assert_is_admin() refuses while any game or history row references the pot, and the games rows still carry their snowball_pot_id after a refused attempt.

**Why this priority.** The failure looks like a harmless error message but has already destroyed the link between every historical game and the pot it fed, which cannot be reconstructed. It is admin housekeeping rather than a live-night action, which is why it sits below R0, but it is unrecoverable when it does fire. Per R33 the right answer is a soft archive flag rather than a hard delete at all.

**Files.** `src/app/admin/snowball/actions.ts`, `src/app/admin/snowball/snowball-list.tsx`

**Acceptance criteria.**

- **Given** Pot P is linked from three games, one of which has game_states.status = 'in_progress', and P carries five snowball_pot_history rows. **when** An admin confirms Archive on P. **then** The screen shows 'Cannot archive while a game using this pot is unfinished.' In the database: select count(*) from games where snowball_pot_id = P still returns 3; select count(*) from snowball_pot_history where snowball_pot_id = P still returns 5; the snowball_pots row still exists with archived_at null.
- **Given** The same pot after all three games are completed. **when** An admin confirms Archive. **then** Success. In the database: snowball_pots.archived_at is set; select count(*) from games where snowball_pot_id = P still returns 3 - the links are kept, not stripped; all five history rows are present. On screen: P is gone from the active pot list and from the game-form pot picker, and is visible under Archived.
- **Given** Any refused archive attempt for any reason. **when** The refusal is returned. **then** select count(*) from games where snowball_pot_id = P is identical to the pre-attempt count. This is the specific proof that no unlink committed ahead of a later failure, which is what the old three-round-trip path did.
- **Given** An archived pot. **when** An admin creates a new game, and separately a hand-crafted PostgREST insert names the archived pot's id. **then** The picker does not offer the archived pot; the hand-crafted insert is refused by the guard (archived_pot) and no games row is created.
- **Given** A host-role account calling archive_snowball_pot directly with a real JWT. **when** The RPC executes. **then** It raises unauthorized (assert_is_admin). In the database: snowball_pots.archived_at is still null, games links are unchanged and history is unchanged.

**Tests.**

| Level | Name | Proves |
|---|---|---|
| sql-harness | `supabase/tests/archive-pot.test.sql` | archive_snowball_pot refuses while any linked game is unfinished, archives cleanly otherwise, leaves games.snowball_pot_id populated in both outcomes, never touches snowball_pot_history, and refuses a host-role caller. |
| sql-harness | `supabase/tests/archive-pot.test.sql` | Linking a new game to an archived pot is refused, so archiving is not a route to a silently broken game. |
| integration | `src/app/admin/snowball/actions.test.ts` | The delete/archive action calls the single RPC and maps pot_in_use and archived_pot to admin-readable copy; no separate unlink or history-delete statement remains in the action. |
| manual-rehearsal | `rehearsal/archive-pot.md` | A refused archive leaves the pot fully usable, and an accepted one leaves every historical game still showing as a snowball game. |

**Preflight (read-only, run against production before the change).**

```sql
select p.id, p.name, p.archived_at, count(distinct g.id) as linked_games, count(*) filter (where gs.status is distinct from 'completed') as unfinished_games, count(distinct h.id) as history_rows from snowball_pots p left join games g on g.snowball_pot_id = p.id left join game_states gs on gs.game_id = g.id left join snowball_pot_history h on h.snowball_pot_id = p.id group by 1,2,3;
```

**Rollback.** drop function public.archive_snowball_pot(uuid); and restore the previous deleteSnowballPot action. Leave snowball_pots.archived_at in place (dropping a column needs explicit approval); with the readers reverted it is simply ignored, and any pot already archived becomes visible again.

**Register entries absorbed.** 3, 5, 49, 143

### `money-pot-max-calls-unbounded` :: Nothing caps a snowball pot's max calls at 90, so a typo opens the jackpot for ever

**R1-before-release** | severity critical, likelihood unlikely | effort XS | area money | status **not started**

SnowballPotSchema validates base_max_calls and current_max_calls as only >= 1 with no .int() and no upper bound, and pg_constraint on snowball_pots carries nothing but the primary key, so a value above 90 makes isSnowballJackpotEligible true on every Full House. Done when the zod schema is .int().min(1).max(90) and matching CHECK constraints exist on snowball_pots so a hand-crafted PostgREST call is refused too.

**Why this priority.** A single mistyped digit on the pot form pays the full jackpot to every Full House winner from then on, with nothing in the app or the database to stop it. The live preflight shows no pot above 90 today, so the constraint needs no backfill and can go in unchanged. Low likelihood, but the consequence is unbounded cash and the fix is one line plus one constraint.

**Files.** `src/app/admin/snowball/actions.ts`, `src/lib/snowball.ts`

**Acceptance criteria.**

- **Given** An admin is editing pot P (current_max_calls 54) on /admin/snowball. **when** They type 900 into Max calls and save. **then** The form shows 'Max calls must be a whole number between 1 and 90.' In the database: snowball_pots.current_max_calls for P is still 54 and no snowball_pot_history row was written.
- **Given** The same form. **when** They type 45.5 into Max calls and save. **then** Refused as not a whole number (zod .int()); no write; the row is unchanged.
- **Given** An admin JWT issuing a hand-crafted PATCH /rest/v1/snowball_pots?id=eq.P with current_max_calls = 900. **when** The request is sent. **then** PostgREST returns 400 citing check constraint snowball_pots_max_calls_within_90; the row is unchanged. The same holds for base_max_calls, and for any value below 1.
- **Given** Pot P at 54 calls. **when** An admin saves a valid change to 60. **then** The screen shows 60. In the database: current_max_calls = 60 and exactly one new snowball_pot_history row exists with old_val_max = 54 and new_val_max = 60.
- **Given** Pot P with current_max_calls = 54 and a snowball game where numbers_called_count = 55. **when** A Full House is recorded with the host choosing Eligible. **then** record_winner_atomic records is_snowball_jackpot = false because the window is closed, whatever the host chose; the winners row carries call_count_at_win = 55 and no 'Snowball Jackpot £' text.

**Tests.**

| Level | Name | Proves |
|---|---|---|
| unit | `src/app/admin/snowball/schema.test.ts` | SnowballPotSchema rejects 0, 91, 900, 45.5 and non-numeric input for both base_max_calls and current_max_calls, and accepts the boundaries 1 and 90. |
| sql-harness | `supabase/tests/snowball-constraints.test.sql` | Insert and update of base_max_calls or current_max_calls outside 1..90 raise check_violation, so a hand-crafted PostgREST call cannot get past the form. |
| unit | `src/lib/snowball.test.ts` | isSnowballJackpotEligible is true at numbersCalledCount = maxCalls and false at maxCalls + 1. |
| manual-rehearsal | `rehearsal/pot-edit.md` | A typo of 900 is rejected on screen with a readable message rather than silently accepted. |

**Preflight (read-only, run against production before the change).**

```sql
select id, name, base_max_calls, current_max_calls from snowball_pots where base_max_calls not between 1 and 90 or current_max_calls not between 1 and 90;
```

**Rollback.** alter table public.snowball_pots drop constraint snowball_pots_max_calls_within_90; and revert the zod schema to .min(1). The preflight above returned zero rows on 2026-08-25, so the constraint cannot fail on apply and dropping it restores the prior behaviour exactly.

**Register entries absorbed.** 24, 115

### `money-prize-and-tie-accounting-model` :: Decide the pub's prize and tie payout rule before the winner data model is changed

**R1-before-release** | severity high, likelihood likely | effort L | area money | status **not started**

A single free-text prize_description on each winner cannot express a split, a non-cash prize, a quantity, a planned versus awarded value, or whether prize_given applies per winner or to one shared award, and update_game_safe refuses prize edits once a game has started so a mistake cannot be corrected. Done when the agreed rule is written down and the schema follows it, with money held as integer pence or a decimal type rather than parsed out of text.

**Why this priority.** Ties happen on ordinary pub nights and the app currently has no answer for them, so the guard in money-snowball-tie-double-jackpot will refuse a legitimate tie until the pub says what a tie is worth. This is the R18 and R17 decision the developer review says must be taken before the schema is guessed at. The code cannot be written until the pub answers, which is why it is not carrying a release-blocking priority it could not honour.

**Priority changed by the merge pass.** The money area scored this R2 and the quality area R1; R1 wins, and developer review R03 and R18 both make it a prerequisite rather than an improvement. The pub TV already advertises that multiple claims share the prize and nothing in the code splits anything, so a tie tonight is settled by whatever the host decides and recorded as free text. The release gate requires the night to reconcile against the till, which is impossible without a numeric amount on winners. The product decision must be answered before the schema changes, not after.

**Files.** `supabase/migrations/20260730064309_winner_idempotency_key.sql`, `src/app/admin/sessions/[id]/actions.ts`, `src/lib/prize-validation.ts`

**Blocked on a decision.** 1. When two people share a stage, is the prize divided between them, paid in full to each, or entered by hand, and how is an odd penny rounded? 2. Is the snowball jackpot ever split, or does the first valid claim take it? 3. May an admin correct a stage's prize text after balls have been called, and if so does an already recorded winner keep the old text? Recommendation: split cash stage prizes evenly with the odd penny to the first claim, never split the jackpot, and allow prize edits only for stages not yet won.

**Acceptance criteria.**

- **Given** ASSUMED DEFAULT (this item carries the open decision R03/R18; these criteria assume: the stage prize is split equally between the winners of that stage with the remainder pence going to the earliest recorded winner; the snowball jackpot is never split and pays once per game; prize_given applies per winner row; cash is held as integer pence in a new nullable winners.prize_amount_pence with the free text kept as winners.prize_label). The decision has been recorded. **when** docs/decisions/prize-and-tie-accounting.md is read. **then** It states, under four separate headings, the split rule, the jackpot rule, the rounding rule and who prize_given applies to. A docs test asserts the file exists and contains all four headings, and CLAUDE.md links to it.
- **Given** A Line stage with a planned prize of £25.00 and two winners recorded on the same ball. **when** Both are recorded. **then** In the database: each winners row carries prize_amount_pence = 1250; the sum over that game and stage for non-void rows is 2500; neither row carries 2500.
- **Given** A Line stage with a planned prize of £25.01 and two winners. **when** Both are recorded. **then** The pence values are 1251 and 1250, with the extra penny on the row with the earliest created_at; the sum is 2501.
- **Given** A stage whose prize is non-cash, e.g. 'bottle of wine'. **when** A winner is recorded. **then** prize_amount_pence is null and prize_label = 'bottle of wine'. The night's cash total ignores the row entirely rather than treating it as zero-with-a-warning.
- **Given** A snowball jackpot claimed by two tied Full House winners. **when** Both are recorded. **then** Exactly one row has is_snowball_jackpot = true carrying the full jackpot in prize_amount_pence; the other row has is_snowball_jackpot = false and carries only its share of the stage prize. This is the same invariant enforced by money-snowball-tie-double-jackpot.
- **Given** A game already started whose Full House prize was mistyped. **when** An admin corrects the prize text and amount. **then** update_game_safe permits a prize-only edit on a started game; games.prizes shows the new value; winners rows already recorded keep the prize_amount_pence they were awarded (the correction applies to stages not yet won).
- **Given** Session S with three non-void cash winners and one voided one. **when** An admin loads /admin/history. **then** The session's cash total equals select sum(prize_amount_pence) from winners where session_id = S and coalesce(is_void,false) = false, rendered in pounds and pence.

**Tests.**

| Level | Name | Proves |
|---|---|---|
| unit | `src/lib/prize-split.test.ts` | Equal split, remainder-penny allocation to the earliest winner, single winner takes the whole prize, non-cash returns null, and zero prize returns zero - across two, three and four winners. |
| sql-harness | `supabase/tests/prize-accounting.test.sql` | winners.prize_amount_pence exists with a CHECK of null or >= 0, and the per-stage sum of non-void rows equals the planned stage prize in pence for the split cases. |
| integration | `src/app/admin/history/totals.test.ts` | The per-session cash total sums prize_amount_pence and excludes voided and non-cash rows. |
| sql-harness | `supabase/tests/prize-edit-after-start.test.sql` | update_game_safe accepts a prize-only edit on a started game and still refuses stage or type edits. |
| manual-rehearsal | `rehearsal/tie-payout.md` | Two winners on one line: the host reads the split straight off the screen and pays it, with no mental arithmetic. |

**Preflight (read-only, run against production before the change).**

```sql
select w.id, w.session_id, w.game_id, w.stage, w.prize_description, w.is_snowball_jackpot, w.is_void, g.prizes from winners w join games g on g.id = w.game_id order by w.created_at desc limit 200;
```

**Rollback.** prize_amount_pence and prize_label are additive and nullable, so the readers can be reverted to prize_description at any time with no data loss; prize_description continues to be written throughout the change. Dropping the two columns needs explicit approval and is not part of the routine rollback.

**Register entries absorbed.** 44, 45

### `money-void-after-settlement-pot-uncorrected` :: Voiding a jackpot winner after the game has settled leaves the pot wrong and the modal says otherwise

**R1-before-release** | severity high, likelihood possible | effort M | area money | status **not started**

settle_snowball_pot evaluates the non-void jackpot exists() once at completion, so a later void only flips is_void while the pot stays reset to base, and the (snowball_pot_id, game_id) claim means a re-run would return 'already_settled' anyway, yet the host void modal states the win "stops counting towards the snowball pot". Done when voiding a winner whose game already has a snowball_pot_history row is refused with a message naming the pot to correct, and the modal copy no longer promises a pot movement that does not happen.

**Why this priority.** An admin voids a wrongly recorded jackpot believing the pot goes back, and it does not, so the pot advertises base while the money it should hold has quietly vanished from the display. R16 is explicit that refusing an unsafe reversal beats performing a silent wrong one, and that refusal plus honest copy is implementable today. The compensating-entry design that would make the reversal safe is the open question in money-lifecycle-and-correction-commands.

**Files.** `src/app/host/[sessionId]/[gameId]/game-control.tsx`, `src/app/host/actions.ts`, `src/app/admin/sessions/[id]/actions.ts`, `supabase/migrations/20260730065531_atomic_snowball_settlement.sql`

**Acceptance criteria.**

- **Given** Snowball game G has settled with a snowball_pot_history row of change_type = 'jackpot_won', and its jackpot winner row W1 is non-void. **when** An admin voids W1 with a reason. **then** The screen shows 'The snowball pot for this game has already settled. Correct pot <pot name> on /admin/snowball first, then void.' In the database: winners.is_void for W1 is still false and void_reason is still null; snowball_pots is unchanged.
- **Given** Winner W2 belongs to a game with no snowball_pot_history row (unsettled, or not a snowball game). **when** An admin voids W2 with reason 'wrong book'. **then** Success. In the database: winners.is_void = true and void_reason = 'wrong book' for W2, proved by the action's .select() returning one row; the pot, if any, is untouched.
- **Given** The void confirmation modal is open on an unsettled snowball win. **when** The admin reads the copy. **then** It says the win will stop counting towards the snowball pot only because the pot has not yet settled. Opening the same modal on a settled game shows instead the pot name and the figure to correct. The unconditional sentence 'stops counting towards the snowball pot' appears nowhere in the component.
- **Given** An admin JWT issuing a hand-crafted PATCH /rest/v1/winners setting is_void = true on a settled game's jackpot winner. **when** The request is sent. **then** It is rejected: voiding routes through void_winner_safe, and a BEFORE UPDATE trigger on winners raises settlement_exists when is_void is being set true while a snowball_pot_history row exists for that winner's game. The row is unchanged.
- **Given** The manual-rehearsal path: an admin has posted a compensating adjustment on /admin/snowball to put the pot back, then voids. **when** The void is attempted again. **then** It is still refused by the same guard - correcting the pot does not remove the settlement row. The documented procedure is: correct the pot, then record the void reason against the session in the export rather than flipping is_void on a settled jackpot. This is deliberate and is written in the refusal message.

**Tests.**

| Level | Name | Proves |
|---|---|---|
| sql-harness | `supabase/tests/void-after-settlement.test.sql` | void_winner_safe (and the winners trigger) raise settlement_exists when a snowball_pot_history row exists for the winner's game, succeed otherwise, and persist is_void and void_reason together. |
| unit | `src/app/host/[sessionId]/[gameId]/void-modal-copy.test.ts` | The modal copy is conditional on whether the game has settled and never promises a pot movement in the settled case. |
| integration | `src/app/admin/sessions/[id]/actions.test.ts` | voidWinner surfaces the mapped refusal text including the pot name, and reports failure on a zero-row update. |
| manual-rehearsal | `rehearsal/void-after-settlement.md` | An admin trying to void a settled jackpot is sent to /admin/snowball with the pot named, rather than being told the pot will correct itself. |

**Preflight (read-only, run against production before the change).**

```sql
select w.id as winner_id, w.game_id, w.is_void, w.prize_description, h.change_type, h.old_val_jackpot, h.new_val_jackpot from winners w join snowball_pot_history h on h.game_id = w.game_id where coalesce(w.is_snowball_jackpot,false);
```

**Rollback.** Drop the trigger and the settlement check inside the void RPC, and restore the previous modal copy. No data is written by the change, so nothing needs correcting.

**Register entries absorbed.** 67

### `obs-session-export-and-disaster-recovery` :: /admin/backup exports nothing and shows the planned draw order, and it is not disaster recovery

**R1-before-release** | severity medium, likelihood possible | effort M | area quality | status **not started**

The page documented as the export tool renders every game's pre-generated number_sequence, which is the planned draw order rather than called_numbers, unpaginated across all 60 games, with no winners, no times, no pot data and no download control anywhere in src. Done means a per-session export produces a file containing winners with their status and amount, each game's called_numbers with started_at and ended_at, and the pot movements for the night, and the backup story is documented separately as Supabase backups with a stated recovery point and recovery time.

**Why this priority.** The export is useful reporting and the team must not mistake it for recovery. As it stands the only route to a permanent record of a night is direct database access, and the page also publishes the full future draw order for games that have not been played yet.

**Files.** `src/app/admin/backup/page.tsx`

**Depends on.** `qual-ci-gate-and-migration-replay`, `qual-winner-prize-amounts-and-splitting`

**Blocked on a decision.** What Supabase backup tier or point-in-time recovery is enabled, what data-loss window and recovery time are acceptable, and has a restore ever been tested? Recommendation: confirm the tier and run one restore drill before the next live night, because an export cannot restore auth users, roles, RLS or functions.

**Acceptance criteria.**

- **Given** A completed session with winners, games and pot movements **when** The admin exports it **then** A file is produced whose winners section has one entry per winners row for that session carrying stage, is_void, prize_given, amount and call_count_at_win; whose games section carries each game's called_numbers with started_at and ended_at; and whose pot section carries the snowball_pot_history rows for that night. A test that parses the file and compares it row by row against the SQL result finds no difference
- **Given** The export page **when** It renders **then** number_sequence appears nowhere in the output (the planned draw order is never shown), the list is paginated, and a visible download control produces the file
- **Given** A reader of the documentation **when** They open docs/runbooks/disaster-recovery.md **then** It names the Supabase backup tier actually enabled on bcmorqsgeumtmhvctvgu, a stated RPO and RTO, the restore procedure covering auth users, roles, functions, RLS and config, and a dated record of at least one restore drill; and the export page carries copy stating it is a report, not a backup

**Tests.**

| Level | Name | Proves |
|---|---|---|
| unit | `src/lib/session-export.test.ts` | The export serialiser emits called_numbers rather than number_sequence and includes every required field for a fixture session |
| integration | `src/app/admin/backup/export.test.ts` | The exported file round-trips: parsing it reproduces exactly the rows the SQL query returns for that session |
| manual-rehearsal | `docs/runbooks/disaster-recovery.md#restore-drill` | A restore has actually been performed once and the elapsed time is recorded against the stated RTO |

**Preflight (read-only, run against production before the change).**

```sql
select s.id, s.name, s.start_date, count(distinct g.id) as games, count(distinct w.id) as winners from public.sessions s left join public.games g on g.session_id = s.id left join public.winners w on w.session_id = s.id group by 1,2,3 order by s.start_date;
```

**Rollback.** Read-only export plus documentation. Revert the page commit; no data effect. The disaster-recovery document is independent of the code and should not be reverted.

**Register entries absorbed.** 83, 141

### `obs-snowball-pot-history-invisible-and-empty` :: The pot has grown 120 pounds with zero history rows, and no screen reads the history table at all

**R1-before-release** | severity high, likelihood certain | effort M | area quality | status **not started**

snowball_pots holds one pot at 54 calls and 140 pounds against a base of 42 and 20, which is six rollovers across six completed sessions, and snowball_pot_history contains no rows. Nothing in src ever selects from that table, so even once settle_snowball_pot starts writing, the rows are invisible to every user. Done means /admin/snowball shows the pot's movements with change type, old and new values, the linked game and the actor, and a reconciliation assertion flags any drift between current_jackpot_amount and base plus increment times the rollover count.

**Why this priority.** If the licensee asks whether 140 pounds is the right number and when each twenty went on, the answer cannot be produced from the database, and after the write path is fixed the audit table the system is now paying to write still has no reader anywhere in the app.

**Files.** `src/app/admin/snowball/page.tsx`, `src/app/admin/snowball/snowball-list.tsx`, `src/app/host/actions.ts`

**Depends on.** `qual-ci-gate-and-migration-replay`, `qual-snowball-manual-edits-not-atomic`

**Blocked on a decision.** Should the six missing historic movements be backfilled as derived rows marked as a backfill, or left absent with a note? Recommendation: backfill them, because otherwise the 140 pounds currently advertised to the room can never be reconciled from stored data.

**Acceptance criteria.**

- **Given** A pot with N snowball_pot_history rows **when** /admin/snowball loads **then** A movements table lists each row newest first with change_type, old and new max_calls, old and new jackpot amount, the linked session and game index derived from game_id, and the actor; the displayed row count equals select count(*) from snowball_pot_history where snowball_pot_id = $1
- **Given** The live pot at 54 calls / £140 against base 42 / £20 with increments 2 / £20 and zero history rows **when** The reconciliation check runs on that page **then** It flags the drift rather than agreeing: it shows the derived expected value from the history rows, the actual value, and an explicitly labelled 'unexplained opening balance' line for the six unlogged movements
- **Given** A game settled after this ships **when** The admin reloads /admin/snowball **then** A new movement row appears whose old and new values match what settle_snowball_pot actually wrote to snowball_pots, and whose game link resolves to the game that caused it

**Tests.**

| Level | Name | Proves |
|---|---|---|
| unit | `src/lib/pot-reconciliation.test.ts` | The reconciliation function detects drift between current values and base plus increments times the rollover count derived from history, and labels an unexplained balance rather than hiding it |
| sql-harness | `supabase/tests/snowball-settlement.test.sql` | Every settlement writes a history row whose old and new values match the pot row after the call |
| manual-rehearsal | `docs/runbooks/rehearsal.md#S17-pot-movements-visible` | An admin can answer 'why is the pot £140' from the screen alone |

**Preflight (read-only, run against production before the change).**

```sql
select p.id, p.name, p.base_max_calls, p.calls_increment, p.current_max_calls, p.base_jackpot_amount, p.jackpot_increment, p.current_jackpot_amount, p.last_awarded_at, (select count(*) from public.snowball_pot_history h where h.snowball_pot_id = p.id) as history_rows from public.snowball_pots p;
```

**Rollback.** Read-only page addition. Revert the commit; the history table and its rows are untouched either way.

**Register entries absorbed.** 75, 146

### `obs-technical-error-monitoring` :: Server-side failures on the public pages log nothing in production and admin actions leak raw Postgres text

**R1-before-release** | severity high, likelihood likely | effort M | area quality | status **not started**

logError returns immediately when NODE_ENV is production unless LOG_ERRORS is 'true', and LOG_ERRORS is set nowhere and documented nowhere, so all six server-component failure paths on /display and /player are silent. Eleven raw console calls bypass the redaction helpers, one emitting two unredacted UUIDs, and twelve admin failure arms return error.message straight to the browser with no logging at all. Done means a technical failure on any surface reaches an external monitor with a correlation id, no Postgres details or hint reaches a browser or a log line, and the monitor is separate from any database table.

**Why this priority.** When the big screen showed a load-failed panel on a Wednesday night, there is no line anywhere the next morning saying what failed, and the transient case is the worst: a one-off blip on the session read calls notFound() and leaves the TV on a permanent 404 with zero diagnostic residue. On the admin side a constraint violation can put a prize amount from the DETAIL clause on screen.

**Files.** `src/lib/log-error.ts`, `src/lib/log-action-failure.ts`, `src/app/display/[sessionId]/page.tsx`, `src/app/player/[sessionId]/page.tsx`, `src/app/host/[sessionId]/[gameId]/page.tsx`, `src/app/admin/actions.ts`, `src/app/admin/sessions/[id]/actions.ts`, `src/app/admin/snowball/actions.ts`

**Depends on.** `qual-ci-gate-and-migration-replay`

**Blocked on a decision.** Which error monitoring provider is approved, and what technical data is allowed to leave Supabase and Vercel? Recommendation: a hosted sink with UUIDs and Postgres detail stripped at the boundary, because a database table cannot record a database outage.

**Acceptance criteria.**

- **Given** NODE_ENV=production and a forced failure injected into each of the six server-component failure paths on /display and /player **when** Each page renders **then** An event reaches the external monitor within 60 seconds carrying a correlation id, the route and the error class; the same correlation id is shown in the user-visible fallback; and the event contains no Postgres message, detail or hint
- **Given** Any of the twelve admin failure arms that currently return error.message **when** The action fails **then** The browser receives only a mapped message from HOST_RPC_ERRORS or the generic constant; a test asserting that no returned error string matches /SQLSTATE|relation .* does not exist|violates .* constraint|permission denied for/ passes for every arm, and the raw error goes to the monitor instead
- **Given** The repository as committed **when** Lint runs **then** A no-console rule with an allowlist for the redaction helpers passes with zero violations; the eleven raw console calls are gone, and no log line emits a UUID other than a correlation id (asserted by a grep-based test over the logging helpers)
- **Given** The database unreachable **when** A technical failure occurs on any surface **then** The error still reaches the monitor, proving the sink is not a Postgres table

**Tests.**

| Level | Name | Proves |
|---|---|---|
| unit | `src/lib/log-error.test.ts` | Redaction strips Postgres message, detail, hint and UUIDs, and the production guard no longer swallows the event when a monitor is configured |
| unit | `src/lib/error-surface.test.ts` | Every server-action error string returned to a browser is from the mapped set, enumerated table-driven so a new action cannot be forgotten |
| failure-injection | `docs/runbooks/rehearsal.md#S16-monitor-receives-failures` | A forced failure on each public surface arrives in the monitor with a correlation id, with the database down |

**Rollback.** Adds a monitoring client and redaction; no schema change. Roll back by removing the monitor env var, which returns the app to local-only logging. Do not roll back the redaction, which is the part that protects the browser payload.

**Register entries absorbed.** 73, 103, 106

### `qual-accessibility-release-criteria` :: Write down the accessibility and device release criteria, starting with reduced motion

**R1-before-release** | severity medium, likelihood certain | effort M | area quality | status **not started**

There is no stated WCAG level, touch-target minimum, focus rule, non-colour state rule, zoom or viewing-distance target anywhere, and the only prefers-reduced-motion reference in src is a comment saying one badge does not need an opt-out, against sixteen animate-pulse usages that run indefinitely on the TV and the player phone. Done means a written target of WCAG 2.2 AA for staff and player surfaces, 44px minimum targets for critical controls, visible focus, non-colour state cues, a global reduced-motion block in globals.css, a stated TV viewing distance, and a named list of host phones and the TV browser that get tested on real devices.

**Why this priority.** Several of the confirmed defects in this backlog are mis-taps, colour-only state and controls below the target minimum, and without a written criterion they get fixed one at a time and reintroduced. WCAG 2.2.2 also requires a way to stop content that moves for more than five seconds, and the TV's prize rows pulse for the entire pre-call period.

**Files.** `src/app/globals.css`, `src/app/display/[sessionId]/display-ui.tsx`, `src/app/player/[sessionId]/player-ui.tsx`, `src/app/host/[sessionId]/[gameId]/game-control.tsx`

**Depends on.** `qual-ci-gate-and-migration-replay`

**Blocked on a decision.** Which host phones and which TV browser must be supported, is a colour-blind host a confirmed requirement, and what viewing distance should the TV be legible at? Recommendation: name the actual devices in use and treat colour-blindness as confirmed, since the codebase already justifies getColourName on that basis.

**Acceptance criteria.**

- **Given** docs/standards/accessibility.md **when** It is reviewed **then** It states WCAG 2.2 AA as the target for /admin, /host and /player; a 44px minimum for a named list of critical controls; a visible focus rule; a non-colour state rule; a stated TV viewing distance (assumed default 6 metres); and a named list of host phone models and the TV browser that get tested on real devices
- **Given** globals.css with a global prefers-reduced-motion block **when** The user agent reports prefers-reduced-motion: reduce **then** All sixteen animate-pulse usages stop animating and no transition exceeds 100ms; a test asserts the media block exists in the built stylesheet and that no animation rule falls outside it
- **Given** Each control on the named critical list at a 360px viewport **when** Measured **then** Every one is at least 44 by 44 pixels with a visible focus indicator at 3:1 against its background
- **Given** A keyboard-only operator **when** They tab through /host and /admin **then** Every interactive element is reachable in a sensible order with a visible focus ring and a correct accessible name

**Tests.**

| Level | Name | Proves |
|---|---|---|
| unit | `src/lib/reduced-motion.test.ts` | The built CSS contains the reduced-motion block and no animation escapes it |
| manual-rehearsal | `docs/standards/accessibility.md#device-matrix` | The named phones and the TV browser have each been checked against the stated criteria and the result is dated |

**Rollback.** Documentation plus a CSS block. The CSS block is safe to revert but should not be; the document is independent of the code.

**Register entries absorbed.** 156

### `qual-history-hides-void-and-prize-given` :: Winner History shows voided wins as ordinary payouts and never shows prize_given

**R1-before-release** | severity high, likelihood likely | effort S | area quality | status **not started**

/admin/history selects every winners row with no is_void filter and the row renderer emits only date, session, game, winner_name, prize_description, the JACKPOT badge, stage and call count, while the sibling session page correctly branches on VOID and Prize Given. void_reason is rendered by no page in the app. Done means a row with is_void true is visibly marked and excluded from any total on the page, prize_given appears as a status, and void_reason is readable from the UI.

**Why this priority.** This is the pub's only cross-session record. A duplicate claim that an admin correctly voided still appears with its full prize and its jackpot badge, so anyone reconciling the quarter double-counts it, and 68 of the 87 production winner rows have prize_given false with no way to see from this page which prizes are still owed.

**Files.** `src/app/admin/history/page.tsx`, `src/app/admin/sessions/[id]/session-detail.tsx`

**Depends on.** `qual-ci-gate-and-migration-replay`

**Acceptance criteria.**

- **Given** A winners set containing one row with is_void = true and void_reason = 'ball called in error' and one ordinary row **when** /admin/history renders **then** The voided row shows a VOID badge, its void_reason is readable on the row or behind a disclosure on the row, and it is excluded from every money or count total on the page
- **Given** The same page **when** Any row renders **then** prize_given renders as an explicit status ('Given' / 'Not given'), matching the winners.prize_given boolean for that row
- **Given** The page with an include-void toggle **when** The toggle is switched **then** The displayed totals recompute to equal the SQL sum with the same is_void filter, to the penny, and the row count equals the SQL count
- **Given** The history page loaded **when** The database is inspected afterwards **then** No winners row changed: the page is read-only and writes nothing

**Tests.**

| Level | Name | Proves |
|---|---|---|
| unit | `src/lib/winner-totals.test.ts` | The total helper excludes voided rows and matches a reference sum for mixed void, prize_given and jackpot rows |
| manual-rehearsal | `docs/runbooks/rehearsal.md#S12-history-reconciles` | A voided win is unmistakable on the history page and does not inflate the night's total |

**Preflight (read-only, run against production before the change).**

```sql
select coalesce(is_void,false) as voided, coalesce(prize_given,false) as given, count(*) from public.winners group by 1,2 order by 1,2; select count(*) from public.winners where void_reason is not null;
```

**Rollback.** Read-only presentation change on /admin/history. Revert the commit; no data effect.

**Register entries absorbed.** 22, 72, 78

### `qual-native-dialogs-and-double-tap` :: Ten native alert and confirm dialogs, an unguarded Start button, and the money actions behind the weakest guard

**R1-before-release** | severity medium, likelihood likely | effort M | area quality | status **not started**

host/dashboard.tsx uses alert three times and confirm once with no in-flight flag on Start, Resume or Re-open, while the live game screen carries nine per-action in-flight flags and a full in-modal error system. Deleting a session or a game demands a typed name, but resetting or deleting an accumulated jackpot needs one tap on a native OK from a 32px ghost button. Done means Start disables itself while startGame is in flight so a double tap produces one call and no spurious conflict, errors appear in-page rather than in an OS dialog, and pot reset and delete use the typed-confirm modal and name the current value.

**Why this priority.** Start is the first action of every night, on pub wifi, on a phone held one-handed. Nothing changes for two seconds, the host taps again, and the resulting conflict surfaces as an OS alert saying the game changed while you were acting, on a game that in fact started fine. iOS also suppresses repeat alerts, so later failures go completely silent. Meanwhile the guardrail strength is inverted against the money risk.

**Files.** `src/app/host/dashboard.tsx`, `src/app/admin/snowball/snowball-list.tsx`, `src/app/admin/dashboard.tsx`, `src/app/admin/sessions/[id]/session-detail.tsx`

**Depends on.** `qual-ci-gate-and-migration-replay`

**Acceptance criteria.**

- **Given** The /host dashboard showing a game with status not_started **when** The host double taps Start within 300ms **then** Exactly one startGame call reaches the server: the game_states row transitions to in_progress once, state_version advances by exactly 1, and no conflict error is shown; the button is disabled from the first tap until the response lands
- **Given** Any failure on the dashboard (Start, Resume or Re-open) **when** It fails **then** The message renders in-page in an aria-live region; a grep-based test finds zero occurrences of window.alert( or window.confirm( anywhere in src
- **Given** A snowball pot at 54 calls / £140 **when** An admin taps Reset or Delete **then** A typed-confirm modal appears naming the pot and its current values ('54 calls, £140'); the action runs only after the pot name is typed exactly; on cancel, snowball_pots and snowball_pot_history are unchanged

**Tests.**

| Level | Name | Proves |
|---|---|---|
| unit | `src/lib/no-native-dialogs.test.ts` | No source file calls alert or confirm, enforced by scanning src so a new one cannot creep back |
| sql-harness | `supabase/tests/host-flow.test.sql (double start)` | Two start calls for the same game produce one transition, so the client guard is belt and the database is braces |
| manual-rehearsal | `docs/runbooks/rehearsal.md#S20-double-tap-start` | A genuine fat-fingered double tap on a phone produces one game start and no error toast |

**Preflight (read-only, run against production before the change).**

```sql
select id, name, current_max_calls, current_jackpot_amount from public.snowball_pots;
```

**Rollback.** Client-side guards and modals. Revert the commit; the database-side start guard is unaffected.

**Register entries absorbed.** 86, 95, 101, 153, 160

### `qual-no-error-boundaries` :: No error.tsx, global-error.tsx or not-found.tsx anywhere, on screens that run unattended

**R1-before-release** | severity medium, likelihood possible | effort S | area quality | status **not started**

A search for error.tsx, global-error.tsx, not-found.tsx and loading.tsx under src/app returns nothing, while notFound() is called from the display, player and host game pages. Done means an uncaught render error on /display or /player shows the pub's own recovery panel with an automatic retry rather than Next's default error page, and a mistyped session id shows a branded 404.

**Why this priority.** The app has built careful in-app recovery for connection failures and has no equivalent for a render throw, on a screen that hangs on a wall in front of a full room with nobody standing next to it.

**Files.** `src/app/layout.tsx`, `src/app/display/[sessionId]/page.tsx`, `src/app/player/[sessionId]/page.tsx`

**Depends on.** `qual-ci-gate-and-migration-replay`

**Acceptance criteria.**

- **Given** src/app/display/[sessionId]/error.tsx present and a child component forced to throw **when** /display/[sessionId] renders **then** The pub's own recovery panel renders at room scale, reset() is invoked automatically on a timer until the render succeeds, and Next's default error page never appears; the same applies on /player/[sessionId]
- **Given** A mistyped session id **when** It is navigated to **then** not-found.tsx renders a branded 404 telling the reader what to do, with HTTP status 404, on the display, player and host game routes that call notFound()
- **Given** A render error thrown in the root layout **when** The page loads **then** global-error.tsx renders rather than a blank page
- **Given** Any of those error paths **when** It fires **then** No write reaches the database, and the error is reported to the external monitor with a correlation id that is also displayed on the recovery panel

**Tests.**

| Level | Name | Proves |
|---|---|---|
| unit | `src/app/display/[sessionId]/error.test.tsx` | The boundary calls reset on a timer and renders the recovery copy, without needing a browser |
| manual-rehearsal | `docs/runbooks/rehearsal.md#S18-tv-recovers-from-a-render-error` | An unattended TV recovers on its own from a thrown render error, which is the whole point of the boundary |

**Rollback.** Additive route files only. Delete them to revert; behaviour returns to the Next defaults.

**Register entries absorbed.** 36

### `qual-no-full-called-board` :: The full 1-90 board exists only inside the modal that pauses the game, and never on the TV

**R1-before-release** | severity medium, likelihood certain | effort M | area quality | status **not started**

The host pad shows the current ball plus the previous nine, and the only 90-number grid sits inside the claim-check modal whose opening calls pauseForValidation as its first act. The TV renders called numbers in a single non-scrolling flex row with an overflow mask, so at 88 calls roughly eleven balls are visible. Done means the host can open a read-only board that makes no server call and leaves game_states.paused_for_validation false, and the TV shows a compact 90-cell called board.

**Why this priority.** Did you call 47 is the most common question on a bingo night, and answering it currently means stopping the game and putting CHECKING A CLAIM on the screen in front of the whole room. A punter who looks up to check the same thing gets the last eleven balls and a total, with no cue that 77 more are hidden.

**Files.** `src/app/host/[sessionId]/[gameId]/game-control.tsx`, `src/app/display/[sessionId]/display-ui.tsx`

**Depends on.** `qual-ci-gate-and-migration-replay`

**Acceptance criteria.**

- **Given** A live game with 42 numbers called and game_states.paused_for_validation = false **when** The host opens the read-only board **then** A 90-cell board renders showing exactly the 42 called numbers marked; zero server mutations occur (no network POST or RPC observed), and game_states.paused_for_validation is still false with state_version unchanged
- **Given** That board open **when** The host closes it **then** The game_states row is byte-identical to before it was opened, and calling continues without a resume step
- **Given** A game with 88 numbers called on the TV **when** /display renders **then** All 88 called numbers are visible in a compact 90-cell board (the count of rendered called cells equals 88), none clipped by an overflow mask, and the board is legible at the stated viewing distance

**Tests.**

| Level | Name | Proves |
|---|---|---|
| unit | `src/lib/called-board.test.ts` | The board model marks exactly the called set for 0, 1, 42 and 88 calls, with no off-by-one at 1 and 90 |
| sql-harness | `supabase/tests/host-flow.test.sql` | No read path used by the board writes to game_states, so opening it cannot pause the game |
| manual-rehearsal | `docs/runbooks/rehearsal.md#S22-full-board-late-in-a-game` | At 88 calls the room can still see every called number on the TV |

**Preflight (read-only, run against production before the change).**

```sql
select max(numbers_called_count) as max_calls_seen from public.game_states;
```

**Rollback.** Presentation-only additions on the host pad and the TV. Revert the commit; the claim-check modal remains the fallback board.

**Register entries absorbed.** 41, 162

### `qual-paused-with-no-resume-control` :: After Close and stay paused the host has no Resume control and the app's own copy points at one that does not exist

**R1-before-release** | severity high, likelihood likely | effort XS | area quality | status **not started**

While paused_for_validation is true, Next Number, Take Break and Undo are all disabled and the only Resume buttons live inside the validation modal, yet the Post Win modal tells the host to resume from the main pad. Done means a Resume control appears on the main pad and in the CHECKING CLAIM banner whenever game_states.paused_for_validation is true, and pressing it clears that flag and re-enables calling without reopening any modal.

**Why this priority.** Close and stay paused is documented as the guaranteed escape from the Post Win modal, and it leaves a stand-in host with a greyed-out pad, a CHECKING A CLAIM overlay on the pub TV and written instructions pointing at a button that is not there. The game sits paused in front of a full room until someone guesses that Check Claim reopens a modal whose left button says Cancel and Resume.

**Files.** `src/app/host/[sessionId]/[gameId]/game-control.tsx`

**Depends on.** `qual-ci-gate-and-migration-replay`

**Acceptance criteria.**

- **Given** game_states.paused_for_validation = true and no modal open on the host pad **when** The host looks at the screen **then** A Resume control is visible in normal flow on the main pad and inside the CHECKING CLAIM banner, and the Post Win modal copy names that same control rather than one that does not exist
- **Given** That state **when** The host taps Resume once **then** Exactly one server call is made; game_states.paused_for_validation becomes false, state_version advances by exactly 1, and Next Number, Take Break and Undo become enabled without any modal being opened
- **Given** The host taps Resume twice because the first response was slow **when** Both calls reach the server **then** paused_for_validation is false, state_version has advanced by exactly 1 in total, and the second call returns the current state rather than an error
- **Given** The TV and a guest phone showing the claim-check overlay **when** Resume is pressed **then** Both clear the overlay within one poll interval, driven by the game_states_public mirror rather than a local flag

**Tests.**

| Level | Name | Proves |
|---|---|---|
| sql-harness | `supabase/tests/host-flow.test.sql` | The resume RPC clears paused_for_validation under the row lock, bumps state_version once, and is a safe no-op when already false |
| manual-rehearsal | `docs/runbooks/rehearsal.md#S7-close-and-stay-paused` | A host who chooses Close and stay paused can get calling again without reopening the validation modal, and the TV follows |

**Preflight (read-only, run against production before the change).**

```sql
select count(*) from public.game_states where paused_for_validation is true;
```

**Rollback.** Adds a control and, if a new RPC is introduced, one function. Revert the client to hide the control; the RPC is harmless if left in place. No data change.

**Register entries absorbed.** 80, 126

### `qual-player-screen-colour-contrast` :: The game colour is painted raw behind white text on the player screen and the contrast helper is never called

**R1-before-release** | severity high, likelihood certain | effort S | area quality | status **not started**

player-ui paints background_colour on the root element and puts white text and the ghost View All Numbers button straight on it, with no contrast check in the admin picker or at render. getContrastColor in src/lib/utils.ts already returns the right answer and grep finds exactly one occurrence, its own definition. Done means every text run and control on the player screen clears 4.5:1 against the actual background_colour values held in the games table today, which include pale yellows and peaches, and the admin colour input warns at pick time.

**Why this priority.** Production games already use pale yellows to match the paper books, so the punter's follower phone renders white on yellow at roughly 1.4:1 today. The View All Numbers button is invisible, which removes the one thing a punter with a paper book actually wants from that screen, and the keep-awake hint is invisible too so the phone sleeps mid-game.

**Files.** `src/app/player/[sessionId]/player-ui.tsx`, `src/lib/utils.ts`, `src/app/admin/sessions/[id]/session-detail.tsx`

**Depends on.** `qual-ci-gate-and-migration-replay`

**Acceptance criteria.**

- **Given** The distinct games.background_colour values held in production today, committed as a fixture from the preflight query **when** A contrast test evaluates every text run and control on the player screen against the colour actually painted behind it **then** Every run reaches at least 4.5:1, and non-text UI boundaries such as the ghost View All Numbers button border reach at least 3:1, for every colour in the fixture including the pale yellows and peaches
- **Given** The player screen rendering a game with background_colour '#fde68a' **when** The page is inspected **then** Text colour is chosen by getContrastColor from src/lib/utils.ts rather than hard-coded white, and grep finds the helper referenced from the player render path as well as its definition
- **Given** The admin colour input, with the assumed default that a failing colour warns rather than blocks **when** An admin types a colour whose best available foreground falls below 4.5:1 **then** An inline warning naming the measured ratio appears next to the input before save; the value can still be saved, and games.background_colour stores exactly the 6-digit hex entered

**Tests.**

| Level | Name | Proves |
|---|---|---|
| unit | `src/lib/contrast.test.ts` | The contrast ratio function is correct against known WCAG pairs, and every production background colour in the committed fixture clears 4.5:1 with the foreground the app would choose |
| manual-rehearsal | `docs/runbooks/rehearsal.md#S4-player-screen-on-a-phone` | The pale-colour games are readable on a real phone at arm's length in pub lighting, which a computed ratio alone does not settle |

**Preflight (read-only, run against production before the change).**

```sql
select background_colour, count(*) as games from public.games group by 1 order by 2 desc;
```

**Rollback.** Presentation-only. Revert src/app/player/[sessionId]/player-ui.tsx and the admin picker warning. No stored colour value changes, so existing games are unaffected either way.

**Register entries absorbed.** 18, 43

### `qual-prod-dependency-vulnerabilities` :: Five high-severity advisories in production dependencies, with next pinned exactly so no patch is picked up

**R1-before-release** | severity high, likelihood unlikely | effort S | area quality | status **not started**

npm audit --omit=dev still reports five high findings across next, postcss, sharp, ws and nanoid, and package.json pins next and eslint-config-next to a bare 16.1.4 inside the vulnerable range, with the fix at 16.3.2. The advisories include two middleware and proxy bypasses in App Router, and ws sits under the realtime client that every public phone and the TV run. Done means the audit is clean at high and the CI audit job has continue-on-error removed so it blocks.

**Why this priority.** The blast radius is limited because every protected page re-checks auth server side, so this is not a live-night blocker, but the documented edge boundary is bypassable and the fix is a version bump the exact pin currently blocks. The CI audit job was deliberately landed non-blocking on the understanding this backlog gets cleared first.

**Files.** `package.json`, `.github/workflows/ci.yml`, `src/proxy.ts`

**Depends on.** `qual-ci-gate-and-migration-replay`

**Acceptance criteria.**

- **Given** package.json after the upgrade **when** npm audit --omit=dev --audit-level=high runs **then** It exits 0 with zero high or critical findings; next resolves to 16.3.2 or later and the pin is no longer an exact version inside the vulnerable range; eslint-config-next matches
- **Given** CI after the upgrade **when** ci.yml is inspected **then** The audit job has no continue-on-error and appears in the required-checks list, so a future high advisory blocks the merge
- **Given** The upgraded tree **when** npm run verify and npm run test:db run **then** Lint, typecheck, tests, build and the full Postgres harness all pass, and the audit JSON before and after is committed as evidence under tasks/
- **Given** The two App Router middleware and proxy bypass advisories **when** A rehearsal exercises the proxy matcher **then** /admin and /host still require a session, a redirect still carries the refreshed auth cookies, and /display and /player still bypass the middleware entirely (no Supabase round trip observed in the network log)

**Tests.**

| Level | Name | Proves |
|---|---|---|
| integration | `.github/workflows/ci.yml audit job (blocking)` | The audit is clean at high and stays clean, because a regression fails the build |
| manual-rehearsal | `docs/runbooks/rehearsal.md#S19-proxy-matcher-after-upgrade` | The framework upgrade did not change the auth boundary the app depends on, which no unit test covers |

**Rollback.** Its own PR with a lockfile diff. Roll back by reverting the single commit and restoring package-lock.json. Do not combine with live-flow changes, so the revert is unambiguous.

**Register entries absorbed.** 37

### `qual-session-reset-leaves-no-record` :: reset_session_safe deletes a whole night's winners and game states and records nothing

**R1-before-release** | severity critical, likelihood possible | effort M | area quality | status **not started**

The live function asserts admin, deletes every winners row for the session, deletes every game_states row for its games, sets status back to 'ready' and inserts nothing anywhere. For the 29 July session that is 14 winners and 10 game states gone in one transaction with no trace. Done means a reset leaves a durable row naming the session, the actor, the timestamp and what was destroyed, or the rows are soft-deleted and filtered out, so that after a reset a query can still answer who won and what was paid.

**Why this priority.** One typed confirmation permanently erases the money record of a night, and nothing records that it happened or who did it. It is worse in combination with the pot: settle_snowball_pot derives reset against rollover from the winners rows, so once they are deleted the pot history row for that game can no longer be checked against the evidence that justified it.

**Files.** `supabase/migrations/20260729231945_atomic_host_mutations.sql`, `src/app/admin/sessions/[id]/actions.ts`

**Depends on.** `qual-ci-gate-and-migration-replay`

**Blocked on a decision.** Should a reset archive the destroyed rows as jsonb in a log table, or soft-delete winners and game_states and filter them from live queries? Recommendation: soft-delete, because it also keeps settle_snowball_pot's evidence trail intact.

**Acceptance criteria.**

- **Given** Decision assumed: reset soft-deletes rather than destroys. A session with 14 winners rows and 10 game_states rows **when** An admin resets it **then** Zero rows are physically deleted: the winners rows carry a reset marker (reset_at and reset_by, or is_void with a reset reason) and the game_states rows are archived; sessions.status is 'ready'; and exactly one audit ledger row names the session id, the actor auth.uid(), the timestamp, and the counts affected (14 winners, 10 game states)
- **Given** That session after the reset **when** A SQL query asks who won game 3 of that night and what was paid **then** It still returns the answer from the retained rows, and every UI list and money total excludes them so the reset session reads as unplayed on screen
- **Given** A non-test session whose snowball pot has already been settled **when** An admin attempts a reset **then** The reset is refused with a named error naming the settled pot; nothing is marked, archived or deleted (the safer default: refuse rather than auto-reverse a money movement)
- **Given** A reset whose response was lost **when** The admin retries with the same reset id **then** The second call is a no-op: no additional audit row, no additional marking, and the same result is returned

**Tests.**

| Level | Name | Proves |
|---|---|---|
| sql-harness | `supabase/tests/reset-session-safe.test.sql` | A reset retains every row, writes exactly one audit row with the right counts, refuses on a settled pot, and is idempotent on a repeat |
| manual-rehearsal | `docs/runbooks/rehearsal.md#S14-reset-a-rehearsal-session` | A rehearsal session can be reset and replayed, and the previous rehearsal's winners are still answerable afterwards |

**Preflight (read-only, run against production before the change).**

```sql
select s.id, s.name, s.status, s.is_test_session, count(distinct w.id) as winners, count(distinct gs.id) as game_states from public.sessions s left join public.winners w on w.session_id = s.id left join public.games g on g.session_id = s.id left join public.game_states gs on gs.game_id = g.id group by 1,2,3,4 order by s.start_date;
```

**Rollback.** Migration replaces reset_session_safe and adds nullable marker columns. Roll back by restoring the previous function body; the marker columns are harmless if left. Because nothing is deleted, a reset performed in error is undone by clearing the markers, which is itself an admin action leaving an audit row.

**Register entries absorbed.** 17

### `qual-signout-on-live-host-screen` :: Sign Out is a one-tap unconfirmed control in the top-right of the live host screen

**R1-before-release** | severity medium, likelihood possible | effort XS | area quality | status **not started**

The live game page keeps a sticky header whose only right-hand control signs the host out mid-game with no confirmation, next to a 32px back arrow that is below the touch-target minimum. Done means Sign Out is removed from the live game header or gated behind a confirm, and the back control measures at least 44 by 44 with an accessible name.

**Why this priority.** The top-right of a phone is the reflex spot for dismissing things. Hitting it mid-game clears the session cookie, drops the host on the login screen, stops the controller heartbeat and leaves the game with a stale controlling_host_id, and staff accounts are invite-only so the host may not know the password they now need.

**Files.** `src/app/host/[sessionId]/[gameId]/page.tsx`

**Depends on.** `qual-ci-gate-and-migration-replay`, `qual-accessibility-release-criteria`

**Acceptance criteria.**

- **Given** The live host game page **when** The sticky header renders **then** Either no Sign Out control is present, or it is behind a confirm naming the live game; the back control measures at least 44 by 44 pixels and has an accessible name such as 'Back to host dashboard'
- **Given** The confirm shown **when** The host cancels **then** The session cookie is intact, the host stays on the page, and game_states.controlling_host_id is unchanged
- **Given** The host confirms sign out during a live game **when** The sign out completes **then** The controller lock is released (controlling_host_id set to null or controller_last_seen_at cleared) so a second device can take control immediately rather than waiting out the heartbeat, and one audit row records the release

**Tests.**

| Level | Name | Proves |
|---|---|---|
| sql-harness | `supabase/tests/host-flow.test.sql (controller release)` | Releasing the lock lets another host take control without waiting for the heartbeat to expire |
| manual-rehearsal | `docs/runbooks/rehearsal.md#S21-sign-out-mid-game` | A mis-tap in the header cannot end a host's shift silently, and a deliberate sign out hands over cleanly |

**Preflight (read-only, run against production before the change).**

```sql
select id, controlling_host_id, controller_last_seen_at, status from public.game_states where status = 'in_progress';
```

**Rollback.** Header change plus an optional release call on sign out. Revert the commit; the lock then expires on the heartbeat as it does today.

**Register entries absorbed.** 159

### `qual-skip-stage-no-confirm` :: Skip (No Winner) sits 8px from Record Winner, is irreversible and has no confirmation

**R1-before-release** | severity high, likelihood possible | effort XS | area quality | status **not started**

The green Valid Claim panel is a flex gap-2 row with Record Winner beside a ghost Skip (No Winner), and handleSkipStage calls the server immediately with no confirm, while the far cheaper Undo Last Call opens a full modal. Done means Skip is separated from Record Winner, sits behind a confirm naming the stage and the prize that will go unrecorded, and a mis-tap leaves game_states.current_stage_index unchanged and inserts no row into winners.

**Why this priority.** The mis-tap happens at the exact moment a punter is standing up holding a winning line. The stage advances server-side, the claim modal closes, and there is no undo-stage control anywhere in the app, so the prize is unrecorded and the game is now playing for the next stage in front of the winner.

**Files.** `src/app/host/[sessionId]/[gameId]/game-control.tsx`

**Depends on.** `qual-ci-gate-and-migration-replay`

**Acceptance criteria.**

- **Given** The green Valid Claim panel open on a game whose current stage is Line with prize '£20' **when** The host taps Skip (No Winner) **then** A confirmation modal opens naming the stage ('Line') and the prize that will go unrecorded ('£20'); no server call is made, so game_states.current_stage_index and state_version are unchanged and winners has no new row
- **Given** That confirmation modal open **when** The host cancels **then** The panel returns unchanged, and the game_states row is byte-identical to before the tap
- **Given** That confirmation modal open **when** The host confirms **then** game_states.current_stage_index increases by exactly 1, state_version advances by exactly 1, zero rows are inserted into winners, and one audit ledger row records the skip with actor, game id and skipped stage
- **Given** The Valid Claim panel rendered at a 360px viewport **when** The gap between Record Winner and Skip (No Winner) is measured **then** The two controls are at least 24px apart or on separate rows, and Skip is styled as the secondary action, so a mis-tap on the money button is not adjacent to the irreversible one

**Tests.**

| Level | Name | Proves |
|---|---|---|
| sql-harness | `supabase/tests/host-flow.test.sql` | A confirmed skip advances current_stage_index by exactly one and inserts no winners row, and a repeated skip with the same idempotency key does not advance twice |
| manual-rehearsal | `docs/runbooks/rehearsal.md#S6-skip-stage-confirm` | A deliberate mis-tap on Skip is caught by the confirm and leaves the game exactly where it was |

**Rollback.** Client-side confirm plus an audit insert. Revert the client commit to restore the immediate action; the audit table is additive and can stay. A stage skipped in error is corrected only by an admin, so the confirm is the control that matters.

**Register entries absorbed.** 81

### `qual-test-sessions-in-permanent-record` :: Test sessions are filtered out of /display and nowhere else, so rehearsal winners look real

**R1-before-release** | severity medium, likelihood likely | effort S | area quality | status **not started**

Only /display applies is_test_session false. Winner History selects every winners row with no session filter and no test badge, the host dashboard lists test sessions inline with real ones, and the admin sessions list has no filter. record_winner_atomic uses is_test_session only to suppress the jackpot flag, so the rows are inserted normally. Done means /admin/history defaults to sessions where is_test_session is false, any test row that is shown carries a badge, and the All / Test / Non-test filter exists on the sessions list.

**Why this priority.** The remediation plan itself calls for a full host-role rehearsal before the next live night, which means a dozen fabricated winners are about to be written into the same table the pub reconciles against, interleaved by created_at with real wins and indistinguishable from them.

**Files.** `src/app/admin/history/page.tsx`, `src/app/host/page.tsx`, `src/app/admin/dashboard.tsx`, `src/app/admin/sessions/[id]/session-detail.tsx`

**Depends on.** `qual-ci-gate-and-migration-replay`

**Acceptance criteria.**

- **Given** One session with is_test_session = true carrying winners, and one real session **when** /admin/history loads with its default filter **then** Only rows whose session has is_test_session = false appear, and the displayed row count equals select count(*) from winners w join sessions s on s.id = w.session_id where s.is_test_session = false
- **Given** That page **when** The user switches the filter to All **then** Test rows appear, each carrying a TEST badge, and they are excluded from any money total on the page (the total is unchanged by the toggle)
- **Given** The /host dashboard and the /admin sessions list **when** They load **then** An All / Test / Non-test filter is present on each, test sessions carry a badge inline, and the default selection is stated in the UI rather than implied
- **Given** A winner recorded in a test session **when** record_winner_atomic runs **then** The row is inserted as normal with is_snowball_jackpot suppressed exactly as today; no behaviour change in the database, only in what the reporting screens show

**Tests.**

| Level | Name | Proves |
|---|---|---|
| unit | `src/lib/session-filter.test.ts` | The filter predicate maps All / Test / Non-test to the right is_test_session condition and defaults to non-test |
| manual-rehearsal | `docs/runbooks/rehearsal.md#S13-rehearsal-does-not-pollute-history` | A full rehearsal night can be run without its winners appearing as real payouts on the history page |

**Preflight (read-only, run against production before the change).**

```sql
select s.is_test_session, count(distinct s.id) as sessions, count(w.id) as winners from public.sessions s left join public.winners w on w.session_id = s.id group by 1;
```

**Rollback.** Filter and badge only. Revert the commit to show everything again. No data change, and no rows are hidden at the database level, so a direct SQL query still sees everything.

**Register entries absorbed.** 47

### `qual-ticket-colour-and-game-identity-missing` :: The ticket colour word and the game number vanish from every screen once calling starts

**R1-before-release** | severity medium, likelihood likely | effort XS | area quality | status **not started**

getColourName was written so a colour is communicated as a word, and it is imported in exactly one file, the host pre-game briefing, which is replaced by the ball view as soon as numbers_called_count leaves zero. The host header hides the session and game name below 640px, and neither public screen names the colour at all. Done means the game_index and the colour name derived from games.background_colour are visible on the live host pad, the TV and the player phone at all times during a game.

**Why this priority.** A stand-in host running six games from a phone has nothing on screen saying which game or which book is in play, and has to leave the live screen to find out. For a colour-blind punter or host the colour wash carries no information at all, and under the pub's own house rule a claim marked on the wrong page cannot be re-claimed later.

**Files.** `src/lib/colour-name.ts`, `src/components/host/pre-game-briefing.tsx`, `src/app/host/[sessionId]/[gameId]/page.tsx`, `src/app/host/[sessionId]/[gameId]/game-control.tsx`, `src/app/display/[sessionId]/display-ui.tsx`, `src/app/player/[sessionId]/player-ui.tsx`

**Depends on.** `qual-ci-gate-and-migration-replay`

**Acceptance criteria.**

- **Given** A game with game_index 3 and background_colour '#fde68a', with numbers_called_count at 12 so the pre-game briefing is long gone **when** The host pad, /display/[sessionId] and /player/[sessionId] are rendered **then** All three show 'Game 3' and the colour word 'Yellow' continuously during play; the word equals getColourName(games.background_colour) for that row, and both remain visible at a 360px viewport width where the host header currently hides the session and game name
- **Given** The same game on the TV at the stated viewing distance **when** The identity strip is measured **then** The game number and colour word render at the room-scale clamp used by the rest of the TV chrome, not at body scale
- **Given** An admin changes background_colour mid-game (depends on qual-admin-edits-invisible-to-live-surfaces) **when** One poll interval passes **then** All three surfaces show the new colour word derived from the updated games row, without a reload

**Tests.**

| Level | Name | Proves |
|---|---|---|
| unit | `src/lib/colour-name.test.ts` | getColourName returns a sensible word for every distinct background_colour value in production, extended from the preflight fixture |
| manual-rehearsal | `docs/runbooks/rehearsal.md#S5-ticket-colour-visible-all-night` | The colour word and game number are readable on the TV from the back of the room and on the host phone at any point during a game, not just before the first ball |

**Preflight (read-only, run against production before the change).**

```sql
select distinct background_colour from public.games order by 1;
```

**Rollback.** Presentation-only additions to three render paths. Revert the commit; no schema or action changes.

**Register entries absorbed.** 79, 111

### `qual-tv-status-states-not-sized-for-room` :: The TV's outage and loading states are rendered at phone scale

**R1-before-release** | severity medium, likelihood likely | effort S | area quality | status **not started**

A renderable game deliberately outranks the failed phase, so a stalled TV keeps showing the last ball plus a 14px white-on-amber pill at roughly 1.8:1 with a 24px Refresh button that no pointer can reach, and the loading phase renders unscaled body text where the adjacent failed branch uses clamp typography. Done means both states use the same room-scale typography as the rest of the TV chrome, the banner sits above the win overlay, and the pointer-only Refresh control is dropped on /display.

**Why this priority.** When realtime and polling both stall on a renderable game, the room keeps marking a board that has stopped advancing and the only cue is unreadable from ten metres. It matters more once the 30-second auto-reload is correctly suppressed, because the banner then becomes the only signal there is.

**Priority changed by the merge pass.** Raised from R2 because it is the visible half of the block 7 offline fix. Once the TV stops reloading itself, the stale-state banner becomes the only signal the room gets that the screen is behind, and today it is a 14px white-on-amber pill at roughly 1.8:1 with a 24px Refresh button no pointer can reach. Shipping the reload fix without this leaves the room looking at a frozen board with no readable explanation.

**Files.** `src/components/connection-banner.tsx`, `src/app/display/[sessionId]/display-ui.tsx`

**Depends on.** `qual-ci-gate-and-migration-replay`, `qual-offline-auto-reload-kills-every-screen`

**Acceptance criteria.**

- **Given** /display with a renderable game and a stalled connection **when** The status banner renders at 1920x1080 **then** Its text uses the same clamp scale as the rest of the TV chrome with a computed font size of at least 32px, its contrast against its background is at least 4.5:1 (the current white-on-amber at roughly 1.8:1 fails), and it paints above the win overlay in z-order
- **Given** /display in its loading phase **when** It renders **then** It uses the same room-scale typography as the adjacent failed branch, not unscaled body text
- **Given** /display in any status state **when** The rendered markup is inspected **then** No pointer-only Refresh control is present, because no pointer can reach the TV; recovery is automatic

**Tests.**

| Level | Name | Proves |
|---|---|---|
| unit | `src/app/display/[sessionId]/status-states.test.tsx` | Both the loading and failed branches use the shared room-scale class and neither renders a Refresh button |
| manual-rehearsal | `docs/runbooks/rehearsal.md#S23-tv-status-from-the-back` | The stalled and loading states are readable from the stated viewing distance |

**Rollback.** Presentation-only on /display. Revert the commit.

**Register entries absorbed.** 157, 163

### `qual-unproven-updates-report-success` :: Three .update() calls report success without proving the write landed, against the codebase's own rule

**R1-before-release** | severity high, likelihood possible | effort S | area quality | status **not started**

updateSessionStatus, maybeCompleteSession's sessions write and /api/setup's profiles role grant all check only error and never look at rows, so an RLS filter or a stale id returns no error and no rows and the action reports success. sessions also has no completed_at column. Done means each call appends .select('id') and treats an empty array as a failure, /api/setup returns 500 when no profiles row was updated, and a completed session carries an authoritative completed_at rather than being inferred from the last game's ended_at.

**Why this priority.** CLAUDE.md records this exact shape as having already made a host's prize-given tick a lie and corrupted the snowball pot. The setup case is the sharpest: an operator is told an account is now admin while nothing was written, and the account is refused at the next login with nobody knowing why.

**Files.** `src/app/admin/sessions/[id]/actions.ts`, `src/app/host/actions.ts`, `src/app/api/setup/route.ts`

**Depends on.** `qual-ci-gate-and-migration-replay`

**Acceptance criteria.**

- **Given** updateSessionStatus called with a session id the caller cannot see under RLS **when** The action runs **then** The .update() carries .select('id'), the empty array is treated as failure, the action returns an error, and the sessions row is unchanged
- **Given** maybeCompleteSession whose sessions update matches zero rows **when** It runs **then** The failure is logged with a correlation id and returned to the caller; the code contains no bare return on that branch, so sessions.status is never left 'running' with nothing recorded anywhere
- **Given** A session whose last game has just completed **when** maybeCompleteSession succeeds **then** sessions.status = 'completed' and sessions.completed_at is within one second of now; the six existing completed sessions are backfilled from max(game_states.ended_at) for their games, and no session with status 'completed' has a null completed_at afterwards
- **Given** /api/setup called with a valid SETUP_SECRET but a user id that has no profiles row **when** The request is made **then** The response is HTTP 500 with a message saying no profile was updated, and the profiles table is unchanged; a 200 on a zero-row update fails this test

**Tests.**

| Level | Name | Proves |
|---|---|---|
| unit | `src/app/admin/actions.test.ts` | With a mocked Supabase client returning { data: [], error: null }, every one of the three call sites returns an error rather than success |
| sql-harness | `supabase/tests/session-completion.test.sql` | completed_at is set on completion, the backfill leaves no completed session with a null completed_at, and a CHECK or partial index enforces that going forward |
| integration | `src/app/api/setup/route.test.ts` | A zero-row profiles update returns 500, and a successful grant returns the persisted role |

**Preflight (read-only, run against production before the change).**

```sql
select status, count(*) from public.sessions group by 1; select s.id, s.name, s.status, max(gs.ended_at) as last_game_ended from public.sessions s left join public.games g on g.session_id = s.id left join public.game_states gs on gs.game_id = g.id group by 1,2,3 order by 4;
```

**Rollback.** Adds a nullable sessions.completed_at plus a data backfill for six rows, and tightens three actions. Roll back by dropping nothing: leave the column, revert the action code. The backfill is derived, so re-running it is idempotent.

**Register entries absorbed.** 90, 109, 148, 149

### `qual-view-only-lockout-no-way-forward` :: The View Only banner covers the current ball and offers no route back when another tab is still alive

**R1-before-release** | severity high, likelihood possible | effort S | area quality | status **not started**

The controller-lock banner is absolutely positioned over the top of the main card, hiding the nickname and part of the giant ball, and when canTakeControl is false it names no owner, shows no last-seen time and offers no instruction. Done means the banner sits in normal flow above the card, and when game_states.controller_last_seen_at is recent the screen states how long ago the controller was seen and what the host must do to get control back.

**Why this priority.** A colleague who leaves the host page open on the back-office PC keeps a heartbeat firing every ten seconds, so the host on the floor sees only Another host is currently controlling this game, with no Take Control button and no explanation. That is the host locked out of the live game with nothing on screen telling them why.

**Files.** `src/app/host/[sessionId]/[gameId]/game-control.tsx`

**Depends on.** `qual-ci-gate-and-migration-replay`

**Acceptance criteria.**

- **Given** A game whose game_states.controller_last_seen_at is within the heartbeat window from another device **when** A second host opens the same game **then** The View Only banner renders in normal flow above the ball card: the giant ball and its nickname are fully visible with no overlapping bounding boxes, the banner states how many seconds ago the controller was last seen, and it names the action required ('the other device must leave the game, or wait N seconds')
- **Given** controller_last_seen_at older than the shared heartbeat constant **when** The second host presses Take Control **then** Exactly one game_states row is updated: controlling_host_id becomes the second host's auth uid and controller_last_seen_at becomes now; one audit ledger row records both the previous and the new controller id and the actor
- **Given** The original device still open after that takeover **when** It next taps Call Next Number **then** call_next_number refuses under the row lock with the controller error key, the host sees the mapped message, and game_states.called_numbers is unchanged; the original device shows View Only within one heartbeat

**Tests.**

| Level | Name | Proves |
|---|---|---|
| concurrency | `supabase/tests/host-flow.test.sql (two-connection controller pair)` | Only the current controller can call, and a takeover moves the lock atomically without both devices ever drawing a ball |
| manual-rehearsal | `docs/runbooks/rehearsal.md#S8-second-host-takeover` | A backup host phone can read the banner, understand what to do, and either wait or take control, with the ball still visible throughout |

**Preflight (read-only, run against production before the change).**

```sql
select id, controlling_host_id, controller_last_seen_at from public.game_states where status = 'in_progress';
```

**Rollback.** Banner layout is presentation-only; revert to restore the overlay. The takeover audit insert is additive.

**Register entries absorbed.** 164

### `db-types-drift-from-live-schema` :: The hand-written database types claim a dozen live-nullable columns are non-null and list no enums

**R1-before-release** | severity medium, likelihood possible | effort S | area security | status **not started**

src/types/database.ts is hand maintained and types winners.is_snowball_jackpot as boolean while the identically nullable is_void is honestly boolean | null with a comment warning about this exact trap, and it declares Enums as never while five enums exist live, so a future .eq('is_snowball_jackpot', false) filter would silently drop NULL rows with no type error. Done means: the file is reconciled against a generated types file, is_snowball_jackpot and the game_states and sessions columns listed in the register carry their real nullability, and UserRole includes 'pending'.

**Why this priority.** No runtime failure today: production holds zero nulls in every affected column because the defaults populate on insert, and types do not change behaviour. It moves up from backlog for one reason, developer review R23: this remediation adds an enum value to user_role, and the type file that still reads 'admin' | 'host' is what the route gating item depends on. Reconciling the rest while the file is open is cheap, and the trap it leaves for the next developer writing a jackpot report is real.

**Priority changed by the merge pass.** Raised from R2/low because it is now a dependency of block 1, not a tidy-up. Once user_role gains 'pending', src/types/database.ts must carry it or every role comparison in the app is typed against a set that no longer matches the database. The nullability corrections (is_snowball_jackpot in particular, where a future .eq(...,false) filter would silently drop NULL rows with no type error) ride in the same reconciliation against a generated types file.

**Files.** `src/types/database.ts`

**Depends on.** `sec-signup-grants-host-role`

**Acceptance criteria.**

- **Given** A generated types file produced from the live schema (supabase gen types typescript against project bcmorqsgeumtmhvctvgu, or against a throwaway database built by replaying supabase/migrations) **when** it is diffed against src/types/database.ts **then** there is no nullability difference for any column, and the Enums block lists all five live enums instead of never
- **Given** The reconciled file **when** winners.is_snowball_jackpot and the game_states and sessions columns named in the register are inspected **then** each carries its real nullability (is_snowball_jackpot is boolean | null, matching the honest typing already given to is_void), and UserRole includes 'pending'
- **Given** The nullable typing in place **when** the repo is searched for equality filters on nullable boolean columns (for example .eq('is_snowball_jackpot', false)) **then** no such filter remains: each is replaced by an explicit null-aware form, because an equality filter silently drops NULL rows and would have compiled cleanly under the old typing
- **Given** A guard script (npm run types:check) that regenerates types into a temporary file **when** it runs and the generated output differs from the committed src/types/database.ts **then** it exits non-zero and names the differing table and column, and it is listed as a mandatory pre-release step in the release checklist (there is no CI to run it automatically)
- **Given** The reconciled types committed **when** npx tsc --noEmit, npm run lint, npm test and npm run build are run **then** all four pass, and any newly nullable read is handled with a real branch or default rather than silenced with a non-null assertion (asserted by a review checklist item and a grep for new '!' assertions on those fields)

**Tests.**

| Level | Name | Proves |
|---|---|---|
| integration | `scripts/check-generated-types.mjs, invoked as npm run types:check` | the committed types still match the live schema, so this drift cannot silently return |
| unit | `npm test (existing src/lib/*.test.ts suite) run after the nullability changes` | the helper layer still compiles and behaves once nullable fields are honest |
| manual-rehearsal | `Release checklist step 'run npm run types:check against production before deploying'` | a human confirmation that repo types and production schema agree at release time |

**Preflight (read-only, run against production before the change).**

```sql
select table_name, column_name, is_nullable, data_type, column_default from information_schema.columns where table_schema = 'public' order by table_name, ordinal_position; select t.typname, string_agg(e.enumlabel, ',' order by e.enumsortorder) as labels from pg_type t join pg_enum e on e.enumtypid = t.oid join pg_namespace n on n.oid = t.typnamespace where n.nspname = 'public' group by 1 order by 1;
```

**Rollback.** Revert src/types/database.ts and remove the types:check script in one commit. This is a compile-time change only: no migration, no data, and no runtime behaviour depends on it beyond the null-handling branches added alongside, which are reverted in the same commit.

**Register entries absorbed.** 119

### `db-unique-game-index-per-session` :: Nothing stops two games in a session sharing a game order, and the host screen then thinks both are the last

**R1-before-release** | severity medium, likelihood possible | effort S | area security | status **not started**

games.game_index has no unique constraint per session and both createGame and updateGame validate only that it is a positive number, while the host page derives first and last game by comparing index values, so on a collision the earlier game shows the end of session buttons instead of Move to Next Game. Done means: a unique index on games (session_id, game_index) exists, a duplicate insert or update raises 23505 and the admin form shows a friendly message, and the host page compares game ids from the ordered list rather than index values. The preflight on 2026-08-25 found zero duplicate (session_id, game_index) groups, so the index applies with no backfill.

**Why this priority.** This is the only item in my area reachable by an admin doing something entirely ordinary, typing a game order into the form while reshuffling the night's running order. The consequence lands on the host at the worst moment: the code comment at game-control.tsx:319 records that mislabelling that button is how two sessions were left running. It is R1 rather than R0 because it needs a duplicate to be created first and the live data is clean today, and because the host can still end the session manually. The database half and the host page half are both worth doing: the index prevents it, the id comparison makes the screen correct regardless.

**Files.** `supabase/migrations/20251201000000_baseline_schema.sql`, `src/app/admin/sessions/[id]/actions.ts`, `src/app/host/[sessionId]/[gameId]/page.tsx`

**Acceptance criteria.**

- **Given** The migration applied **when** select indexdef from pg_indexes where schemaname = 'public' and tablename = 'games' and indexdef ilike '%unique%' **then** one index covers (session_id, game_index)
- **Given** A session already holding a game at game_index 2 **when** an admin creates another game in that session with game_index 2 **then** Postgres raises 23505, the action returns a friendly message naming the clash (for example 'Game order 2 is already used in this session'), the screen shows that message and not a raw Postgres error, and select count(*) from public.games where session_id = <s> and game_index = 2 is still 1
- **Given** The same session **when** an admin edits an existing game's order to a value another game already uses **then** the same 23505 path applies: friendly message on screen and no change in the database (the edited row still holds its original game_index)
- **Given** Games at orders 1, 2 and 3 **when** the admin swaps the games at 2 and 3 **then** the operation succeeds against the unique index (the reorder runs in one transaction, or via a temporary out-of-range value), and afterwards the three rows hold orders 1, 2, 3 with the two game ids swapped
- **Given** A session with several games **when** the host page renders **then** first and last are derived by comparing game ids against the ordered list (games[0].id and games[games.length - 1].id), so only the genuinely last game shows the end-of-session controls and every earlier game shows Move to Next Game, proven by a unit test over the extracted ordering helper
- **Given** The 2026-08-25 preflight, which found zero duplicate (session_id, game_index) groups **when** the same preflight is re-run immediately before applying **then** it again returns zero rows, so the index is created validated with no backfill; if it returns any row, the apply is stopped and the duplicates are resolved by an admin first

**Tests.**

| Level | Name | Proves |
|---|---|---|
| sql-harness | `supabase/tests/games-unique-index.test.sql` | the unique index exists, a duplicate insert and a duplicate update both raise 23505, and a two-step swap inside one transaction succeeds |
| unit | `src/lib/game-order.test.ts (extract the first/last derivation into src/lib/game-order.ts)` | first and last are decided by position in the ordered list, so equal index values can no longer make two games look last |
| unit | `src/app/admin/actions.test.ts (mocked Supabase returning code 23505)` | the admin actions map 23505 to a friendly message instead of surfacing the raw error |
| manual-rehearsal | `Admin rehearsal, 'create, reorder and delete games in a session'` | the admin can still build a normal evening's card with the index in place |

**Preflight (read-only, run against production before the change).**

```sql
select session_id, game_index, count(*) from public.games group by 1, 2 having count(*) > 1; select indexdef from pg_indexes where schemaname = 'public' and tablename = 'games'; select session_id, array_agg(game_index order by game_index) from public.games group by 1 order by 1;
```

**Rollback.** drop index if exists public.games_session_id_game_index_key; The index adds no columns and rewrites no data, so the rollback is instant and lossless.

**Register entries absorbed.** 21, 50

### `sec-default-privileges-anon` :: Default privileges still hand anon EXECUTE on every new function and full DML on every new table

**R1-before-release** | severity medium, likelihood possible | effort S | area security | status **not started**

pg_default_acl for schema public still shows anon=X on functions and anon=arwdDxtm on tables, for both the postgres and supabase_admin grantors, so the two migrations that revoked anon EXECUTE from the existing RPCs one at a time treated symptoms and left the base posture open. Done means: pg_default_acl for schema public shows no anon or PUBLIC entry for object types f and r under either grantor, and supabase/tests/grants.test.sql asserts the default ACL rather than only the current per-object ACLs.

**Why this priority.** There is no live exposure today, so on its own this would be R2 hardening. It is R1 because of sequencing: this remediation is about to create several new SECURITY DEFINER functions (the pot RPC, the session write RPCs, the pot delete guard), and every one of them will be born anon executable unless the default is closed first. It has already bitten twice, which is why two revoke migrations exist. Developer review R24 is right that default privileges are grantor specific, so the migration must name both postgres and supabase_admin, and the harness assertion is what stops it drifting back.

**Files.** `supabase/migrations/20260730070705_revoke_anon_execute_on_host_rpcs.sql`, `supabase/migrations/20260730072329_revoke_anon_on_bump_game_state_version.sql`, `supabase/tests/grants.test.sql`

**Acceptance criteria.**

- **Given** The migration applied (assumed default: revoke from anon and PUBLIC only, leaving the authenticated and service_role defaults alone so nothing existing breaks) **when** select defaclrole::regrole as grantor, defaclobjtype, defaclacl from pg_default_acl where defaclnamespace = 'public'::regnamespace **then** for object types 'f' and 'r', under both grantors postgres and supabase_admin, no ACL item names anon and none has an empty grantee (PUBLIC)
- **Given** The closed default posture **when** a new function is created in schema public by postgres with no explicit grant **then** has_function_privilege('anon', <fn>, 'EXECUTE') is false; the same probe under the pre-migration posture returned true, so the harness canary is re-based rather than deleted
- **Given** The closed default posture **when** a new table is created in schema public with no explicit grant **then** has_table_privilege('anon', <table>, 'SELECT') and 'INSERT' are both false
- **Given** Default privileges are not retroactive **when** the anon role reads public.game_states_public after the migration **then** it still returns the live row and the /display and /player pages still render the board, proving existing public access was not withdrawn
- **Given** supabase/tests/grants.test.sql extended **when** bash supabase/tests/run.sh runs **then** it exits 0, the pre-migration phases still assert the old production-shaped default ACL (the canary), and the post-migration phase asserts the closed default ACL for both object types and both grantors
- **Given** A full replay of every migration into an empty production-shaped database **when** supabase/tests/replay.test.sql runs **then** it asserts pg_default_acl has no anon or PUBLIC entry for 'f' or 'r', so a rebuild reproduces the closed posture rather than the open one

**Tests.**

| Level | Name | Proves |
|---|---|---|
| sql-harness | `supabase/tests/grants.test.sql (extended with default-ACL assertions) plus a new phase in supabase/tests/run.sh applying the new migration` | the base posture is closed at the catalogue level, not merely patched per function, and the canary still proves the harness is production-shaped |
| sql-harness | `supabase/tests/replay.test.sql (end-state assertion on pg_default_acl)` | a fresh build from supabase/migrations produces the closed default privileges |
| integration | `supabase/tests/jwt/anon-surface.test.mjs` | anon can still read game_states_public and still cannot execute any host RPC, so the public screens keep working while the future hazard is closed |

**Preflight (read-only, run against production before the change).**

```sql
select defaclrole::regrole as grantor, defaclobjtype, defaclacl from pg_default_acl where defaclnamespace = 'public'::regnamespace order by 1, 2; select p.oid::regprocedure as fn, p.proacl from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' order by 1;
```

**Rollback.** The migration records the exact inverse statements (alter default privileges for role postgres in schema public grant execute on functions to anon; and the table equivalent, for both grantors). One statement per line, no data change, reversible in seconds.

**Register entries absorbed.** 48

### `sec-orphan-booking-function` :: An orphan SECURITY DEFINER function is anon executable and exists in production but in no migration

**R1-before-release** | severity medium, likelihood unlikely | effort XS | area security | status **not started**

public.create_table_booking_transaction is SECURITY DEFINER owned by postgres with PUBLIC and anon EXECUTE, the only function in the schema still holding either, and no repo migration creates it, so the repo and production disagree about whether it should exist at all. Done means: pg_proc.proacl for that function shows no PUBLIC or anon entry, and either the function is dropped or a migration creates it so a rebuild from supabase/migrations/ reproduces the live schema.

**Why this priority.** Nothing can happen today: the three tables it writes do not exist, so every anonymous call raises an undefined table error. It is on the list because it is a permanent live fire hazard sitting on the public anon key, and because it is the single object that makes the repo an incomplete description of production, which matters more than usual here given the migration histories were reconciled one to one in July and have to stay that way. Cheap, but it needs a human to confirm ownership before the drop, which is why the revoke and the drop should be separated.

**Priority changed by the merge pass.** Raised from R2/low for the revoke half only. An anon-executable SECURITY DEFINER function owned by postgres, present in production and in no migration, is the single riskiest object in the schema, and revoking PUBLIC and anon EXECUTE is XS and needs no decision from anybody. Dropping the function stays blocked on confirmation that no other Anchor product calls it, and the production-configuration gate item checks the revoke landed.

**Files.** `supabase/migrations/20260730070705_revoke_anon_execute_on_host_rpcs.sql`, `supabase/migrations/20260527080524_lockdown_admin_functions_2026_05_27.sql`

**Blocked on a decision.** Does any other Anchor product call create_table_booking_transaction against this database? It writes to table_bookings, table_booking_items and table_booking_payments, none of which exist here, so I would recommend revoking the PUBLIC and anon grants now regardless and dropping the function only once somebody confirms nothing else calls it.

**Acceptance criteria.**

- **Given** The full definition captured by the preflight and recorded in the migration (assumed default: drop it, since its target tables do not exist in this project) **when** select to_regprocedure('public.create_table_booking_transaction(jsonb,jsonb,jsonb)') **then** it returns null in production after the migration is applied
- **Given** The drop applied **when** every function in schema public is checked for a PUBLIC or anon EXECUTE grant **then** zero rows are returned: no proacl contains an empty grantee '=X/' or an 'anon=X' item, and the corresponding Supabase security advisory no longer fires
- **Given** A fresh replay of every file in supabase/migrations into an empty production-shaped database **when** supabase/tests/replay.test.sql compares the resulting function list against the production function list **then** the two sets match exactly, so repo and production no longer disagree about whether this function exists
- **Given** The alternative decision is taken instead (adopt the function) **when** the adopting migration is applied and replayed **then** pg_proc.proacl for it shows no PUBLIC and no anon entry, a repo migration creates it, and the same replay set-equality assertion passes
- **Given** The change is catalogue-only **when** bash supabase/tests/run.sh is executed and a full host flow is rehearsed **then** run.sh exits 0 and no app behaviour changes, because no code in this repo references the function

**Tests.**

| Level | Name | Proves |
|---|---|---|
| sql-harness | `supabase/tests/replay.test.sql (extend with a function-set assertion for schema public)` | a rebuild from supabase/migrations produces exactly the functions production holds, so an orphan cannot reappear unnoticed |
| sql-harness | `supabase/tests/grants.test.sql (add a schema-wide 'no PUBLIC or anon EXECUTE anywhere in public' assertion)` | the last function holding PUBLIC and anon EXECUTE is gone and no new one can be added without failing the suite |
| manual-rehearsal | `Post-apply advisor re-run recorded in the release checklist` | the live security advisor is clean for this finding |

**Preflight (read-only, run against production before the change).**

```sql
select p.oid::regprocedure as fn, p.prosecdef, p.proowner::regrole as owner, p.proacl, pg_get_functiondef(p.oid) as definition from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'create_table_booking_transaction'; select to_regclass('public.table_bookings'), to_regclass('public.table_booking_items'), to_regclass('public.table_booking_payments'); select p.oid::regprocedure as fn, p.proacl from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and (p.proacl::text like '%anon=%' or p.proacl::text like '%=X/%');
```

**Rollback.** The migration must paste the pg_get_functiondef output captured by the preflight into its ROLLBACK comment before dropping, so the function can be recreated verbatim. Nothing else references it, so recreating it restores the prior state exactly.

**Register entries absorbed.** 91, 113

### `sec-start-game-unvalidated-session-game-pair` :: startGame runs as service role and never checks the game belongs to the session it is told to start

**R1-before-release** | severity medium, likelihood unlikely | effort XS | area security | status **not started**

src/app/host/actions.ts:317 looks the game up by id alone and line 500 then writes sessions.status='running' and active_game_id filtered only on sessionId, all through the RLS bypassing service role client, so a crafted call with a mismatched pair points one session at another session's game. Done means: the games lookup carries .eq('session_id', sessionId) and the action fails when it returns nothing, matching the 'wrong_session' guard record_winner_atomic already raises.

**Why this priority.** Unreachable through the UI, because the host dashboard only ever renders games nested under their own session, so this needs a deliberately crafted server action call. It is R1 only because the fix is one .eq() and a null check, and because the codebase already holds the correct pattern three feet away in record_winner_atomic. Note that one half of the original finding does not survive scrutiny: writing games.prizes with the service role client is not an accidental privilege escape, it is the designed cash jackpot start flow where the host types the amount and games UPDATE is admin only in RLS, which is exactly why the service role client is there. Dropping the service role client entirely from startGame would break that, so the fix is the missing check, not the client swap.

**Files.** `src/app/host/actions.ts`

**Acceptance criteria.**

- **Given** Session A and session B each with their own games, and a host signed in **when** startGame(sessionA.id, gameFromSessionB.id) is invoked (a crafted server-action call, not reachable from the UI) **then** the action returns a failure ActionResult with a user-safe message, the screen shows that message, and in the database sessions A and B both have their original status and active_game_id, no game_states row exists for gameFromSessionB, and games.prizes for gameFromSessionB is unchanged
- **Given** The same host and a matching pair **when** startGame(session.id, itsOwnGame.id) is invoked **then** the action succeeds, sessions.status = 'running', sessions.active_game_id = that game id, and exactly one game_states row exists for the game with numbers_called_count = 0, status 'in_progress' and a 90-element number_sequence
- **Given** A valid startGame whose response is lost in transit **when** the host taps Start again **then** no second game_states row is created (count stays 1), number_sequence is not re-shuffled (identical array before and after), and the action returns either success or the STATE_MOVED conflict message, never a silent restart
- **Given** The guard in place **when** the games lookup in src/app/host/actions.ts runs **then** it carries .eq('session_id', sessionId) and the action fails when it returns no row, matching the 'wrong_session' refusal record_winner_atomic already raises for the same mismatch
- **Given** A cash-jackpot game started with a mismatched pair **when** the action fails **then** no service-role write occurred at all: games.prizes, sessions and game_states for both sessions are byte-identical before and after (compare a row-hash of the three tables)

**Tests.**

| Level | Name | Proves |
|---|---|---|
| unit | `src/app/host/start-game-pair.test.ts (node --test, mocked Supabase client recording the query filters)` | the games lookup includes the session_id filter and the action returns a failure without issuing any update when the lookup returns no row |
| sql-harness | `supabase/tests/host-flow.test.sql (extend with a wrong_session assertion for record_winner_atomic)` | the database-side refusal for a mismatched pair is still the reference behaviour the action now matches |
| manual-rehearsal | `Live-night rehearsal, 'start each game in a two-session evening'` | the added filter does not break the normal start path, including a restart of a completed game |

**Preflight (read-only, run against production before the change).**

```sql
select s.id as session_id, s.status, s.active_game_id, g.id as game_id, g.session_id as game_session_id, g.game_index from public.sessions s join public.games g on g.session_id = s.id order by s.created_at desc, g.game_index; select count(*) as mismatched_active_games from public.sessions s join public.games g on g.id = s.active_game_id where g.session_id <> s.id;
```

**Rollback.** Single-file revert of src/app/host/actions.ts; no schema or data change, so redeploying the previous build restores the old behaviour.

**Register entries absorbed.** 30

### `live-realtime-reconnect-no-reentrancy-guard` :: Concurrent realtime connect calls can orphan a channel or tear down the live one

**R2-next-cycle** | severity low, likelihood unlikely | effort S | area liveflow | status **not started**

connect() assigns activeChannel only after the whole builder chain including subscribe() returns, and the visibility handler can call connect() while a previous subscribe is still in flight. The status callback closes over the shared activeChannel variable, so it can remove a newer live channel rather than its own, and in the narrow synchronous-error window it removes nothing at all.

**Why this priority.** The register's "never removed" claim only holds in the narrow window before assignment; the common case is channel churn that the exponential backoff eventually recovers from. It still means the host can spend a bad-network stretch reconnecting more than it needs to, on top of a poll that is also struggling. A generation counter per connect attempt is the standard fix.

**Files.** `src/app/host/[sessionId]/[gameId]/game-control.tsx`, `src/app/display/[sessionId]/display-ui.tsx`, `src/app/player/[sessionId]/player-ui.tsx`

**Acceptance criteria.**

- **Given** A display page whose realtime connect is invoked twice in the same tick, because a visibilitychange fires while a previous subscribe is still in flight. Assumed default: a monotonic generation counter, the channel assigned to a ref before subscribe, and every status callback and teardown comparing its own generation before removing anything. **when** Both connects run to completion. **then** Exactly one channel remains for that topic (supabaseClient.getChannels() filtered to the topic has length 1) and the superseded one has been removed. No orphan channel is left subscribed.
- **Given** Connect A in flight when connect B starts and finishes first. **when** A's subscribe status callback fires with SUBSCRIBED. **then** A removes its own channel and does not remove B's. The page still receives updates: a subsequent write to game_states_public for that game is rendered on screen within 2 seconds.
- **Given** A subscribe that throws synchronously. **when** connect() runs. **then** The partially built channel is removed, the ref is cleared, and the retry backoff schedules a new attempt. Nothing is left behind, which is the narrow window in which the current code removes nothing at all.
- **Given** The component unmounting while a connect is still in flight. **when** Unmount runs and the in-flight subscribe later settles. **then** That channel is removed once it settles and getChannels() for the topic is empty. No zombie subscription survives the unmount.
- **Given** Any of the four orderings above. **when** They complete. **then** In the database: nothing is written. game_states_public.state_version for the game is identical before and after, confirming realtime churn has no write side effect.

**Tests.**

| Level | Name | Proves |
|---|---|---|
| unit | `src/lib/realtime-channel-manager.test.ts` | The connect and teardown logic, extracted behind an injected fake client, holds a single live channel across all four orderings (double connect, out-of-order settle, synchronous throw, unmount mid-flight) and never removes a channel from a newer generation. |
| integration | `src/app/display/realtime-reconnect.test.ts` | With a fake Supabase client, repeated visibility toggles leave exactly one subscribed channel and the page still applies an incoming payload afterwards. |
| manual-rehearsal | `rehearsal step 15: lock and unlock the TV and a phone ten times during a game` | On the real deployment the channel count stays at one and live updates keep arriving, which is the failure mode a unit test with a fake client cannot fully prove. |

**Rollback.** Client-only refactor into one lib module. Revert the commit and the current inline connect logic returns. No schema change and no writes.

**Register entries absorbed.** 138

### `live-reveal-backlog-uncapped` :: A client that falls behind trickles balls at the dwell rate and shows a wrong current number

**R2-next-cycle** | severity medium, likelihood possible | effort S | area liveflow | status **not started**

planReveal paces a backlog at one ball per minDwellMs with no cap, so a screen that missed twenty balls during a network gap takes roughly twenty-four seconds to catch up. Throughout that time the public current-number readout is wrong while the host is calling the real one.

**Why this priority.** A fresh page load adopts serverCount minus one, so this only bites a client that stays mounted through a gap, such as a phone coming back from lock or a TV recovering from a blip. Punters marking cards against a screen that is half a minute behind the caller is a dispute waiting to happen. Cap the backlog and snap when it exceeds a small number of balls.

**Files.** `src/lib/reveal-queue.ts`, `src/app/display/[sessionId]/display-ui.tsx`, `src/app/player/[sessionId]/player-ui.tsx`

**Acceptance criteria.**

- **Given** planReveal called with revealedCount 10, calledNumbers of length 11, lastRevealAtMs equal to now minus minDwellMs. Assumed default: the backlog cap is 3 balls; beyond the cap the queue snaps to the newest revealable ball instead of trickling. **when** The plan is computed. **then** revealCount is 11 and nextTickInMs is minDwellMs. Normal single-ball pacing is unchanged by the cap.
- **Given** planReveal with revealedCount 10 and calledNumbers of length 13 (a backlog of exactly 3, at the cap). **when** The plan is computed. **then** Balls are still paced one per minDwellMs. The cap must not alter behaviour at or below the cap.
- **Given** planReveal with revealedCount 10 and calledNumbers of length 30 (a backlog of 20, from a network gap). **when** The plan is computed. **then** revealCount jumps in a single step to the newest ball whose call is already past its call_delay_seconds, and nextTickInMs returns to the idle tick. The catch-up must not take roughly 24 seconds.
- **Given** A phone that missed 20 balls in flight mode and then reconnects. **when** One poll succeeds. **then** Within 2 seconds the on-screen current number equals the last revealable element of game_states_public.called_numbers for that game. In the database: the public screens write nothing, so numbers_called_count and state_version are unchanged by the catch-up.
- **Given** A ball called 0.5 seconds ago on a game with call_delay_seconds = 2, during a backlog snap. **when** The plan is computed. **then** That ball is NOT revealed. The public reveal delay is still honoured while snapping, so a punter's phone still cannot see the future.

**Tests.**

| Level | Name | Proves |
|---|---|---|
| unit | `src/lib/reveal-queue.test.ts` | Extended with the five cases above: unchanged pacing at and below the cap, a single-step snap above it, the reveal delay honoured during a snap, and no negative or overshooting revealCount. |
| manual-rehearsal | `rehearsal step 14: phone in flight mode for 60 seconds during calling` | On reconnect the punter's phone shows the true current ball almost immediately rather than trailing the room by twenty balls while the host calls. |

**Preflight (read-only, run against production before the change).**

```sql
select distinct call_delay_seconds, count(*) from public.game_states group by 1 order by 1; select max(numbers_called_count) as max_calls_in_a_game from public.game_states;
```

**Rollback.** Pure client logic in one lib module. Revert the reveal-queue.ts commit and the uncapped trickle returns. No schema change, no writes.

**Register entries absorbed.** 139

### `live-snowball-pot-realtime-dead` :: Three snowball_pots realtime subscriptions can never fire because the table is not published

**R2-next-cycle** | severity low, likelihood likely | effort S | area liveflow | status **not started**

The host control, display and player screens all subscribe to postgres_changes on public.snowball_pots, but only sessions, game_states and game_states_public are in the supabase_realtime publication. The channels subscribe successfully and deliver nothing, and no poll re-reads the pot either.

**Why this priority.** The pot only moves at settlement, which happens at game end, and the host page does a full navigation between games, so on a normal night nobody sees a stale value. It matters if an admin corrects a pot on /admin/snowball mid-session, and it matters that three pieces of live code are quietly dead. Fold the pot into the existing poll rather than publishing another table.

**Files.** `src/app/host/[sessionId]/[gameId]/game-control.tsx`, `src/app/display/[sessionId]/display-ui.tsx`, `src/app/player/[sessionId]/player-ui.tsx`

**Acceptance criteria.**

- **Given** The migration adding public.snowball_pots to the realtime publication has been applied. Assumed default: publish the table AND add a poll fallback, mirroring the winners decision, so no screen depends on replication config alone. **when** select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'snowball_pots' is run. **then** It returns 1, and select relreplident from pg_class where oid = 'public.snowball_pots'::regclass returns 'd' with a primary key present (or 'f').
- **Given** Host control, /display and /player all open on a game linked to pot P. **when** An admin changes the pot amount on /admin/snowball. **then** All three screens show the new amount within 5 seconds with no reload. In the database: snowball_pots.current_amount equals the new value and exactly one snowball_pot_history row records the change with a non-null changed_by.
- **Given** The same three screens, with the realtime websocket blocked in each browser. **when** The admin makes the same change. **then** All three still update within the poll interval, proving the pot is re-read on the existing poll rather than depending on the publication.
- **Given** A host settling the pot at the end of a snowball game through settle_snowball_pot. **when** The settlement commits. **then** The calls-remaining label and the jackpot amount change on /display and /player within 5 seconds. In the database: the pot row shows either the reset or the rollover values derived from base_max_calls, calls_increment, base_jackpot_amount and jackpot_increment, and exactly one new snowball_pot_history row exists.
- **Given** The publication change applied. **when** An anon client with the page's own key subscribes to snowball_pots changes. **then** The columns it receives are no wider than the columns the public screens already read, and the existing RLS SELECT policy on snowball_pots is unchanged by the migration, confirmed by comparing pg_policies before and after.

**Tests.**

| Level | Name | Proves |
|---|---|---|
| sql-harness | `supabase/tests/realtime-publication.test.sql` | snowball_pots (alongside winners) is in the supabase_realtime publication with an adequate replica identity, the migration is idempotent on re-apply, and no RLS policy on the table changed. |
| integration | `src/app/host/pot-poll-fallback.test.ts` | With realtime mocked as never delivering, the host, display and player pot values still refresh from the poll, so the three dead subscriptions are no longer the only source of truth. |
| manual-rehearsal | `rehearsal step 12: admin changes the pot with all three screens open` | All three surfaces agree within seconds on the real deployment, and a read-only query confirms one history row rather than a silent pot move. |

**Preflight (read-only, run against production before the change).**

```sql
select schemaname, tablename from pg_publication_tables where pubname = 'supabase_realtime' order by 1,2; select relreplident from pg_class where oid = 'public.snowball_pots'::regclass; select policyname, cmd, roles, qual from pg_policies where schemaname = 'public' and tablename = 'snowball_pots' order by policyname; select id, current_amount, max_calls, base_max_calls, calls_increment, base_jackpot_amount, jackpot_increment from public.snowball_pots;
```

**Rollback.** `alter publication supabase_realtime drop table public.snowball_pots;` takes effect immediately and breaks nothing once the poll fallback is in place. The poll fallback is reverted with the client commit. No rows are altered by either half.

**Register entries absorbed.** 127, 140

### `admin-game-form-input-unvalidated` :: The admin game form accepts zero stages and unvalidated stage names

**R2-next-cycle** | severity low, likelihood likely | effort S | area money | status **not started**

With no stages ticked, validateGamePrizes sees an empty required list and passes, the submit button stays enabled, and the server silently substitutes the three default stages and then fails prize validation for inputs the form never rendered; separately, stage_sequence is written from a bare formData.getAll('stages') cast into a jsonb column with no check against the win_stage set. Done when a standard game with zero stages returns "Select at least one stage." and writes no games row, and every admin action validates its input with zod as the snowball actions already do.

**Why this priority.** An admin who unticks every stage gets a prize error for stages they cannot see, which is a dead end during setup rather than during the night. The stage_sequence half is hardening only: the same admin already holds blanket ALL on games through RLS, so validation protects against a future refactor rather than a reachable failure. Bundled because both live in the same two functions.

**Files.** `src/app/admin/sessions/[id]/actions.ts`, `src/app/admin/sessions/[id]/session-detail.tsx`

**Acceptance criteria.**

- **Given** An admin on the Add Game form with every stage checkbox cleared. **when** They tap Save. **then** The form shows 'Select at least one stage.' and no prize error. In the database: select count(*) from games where session_id = S is unchanged.
- **Given** A request that omits stages entirely, sent directly to createGame. **when** The action runs. **then** It returns 'Select at least one stage.' before any Supabase call. The server does not substitute the three default stages. No games row is written.
- **Given** A request carrying stages ['Line','Bogus']. **when** createGame runs. **then** zod refuses with a message naming the invalid stage; no games row is written. If such a value did reach the database, a CHECK on stage_sequence rejects it as well.
- **Given** A request carrying stages ['Full House'] with an empty prize for Full House. **when** createGame runs. **then** It returns the prize-required message and writes no games row - prize validation runs against the stages actually submitted, not against a default set.
- **Given** A valid submission of stages ['Line','Full House'] with prizes for both. **when** Saved. **then** In the database: one games row where stage_sequence = '["Line","Full House"]'::jsonb exactly (order preserved, no extras) and prizes has exactly those two keys.
- **Given** Every server action exported from src/app/admin. **when** Each is called with a malformed FormData payload. **then** Each returns a validation error before issuing any Supabase call, proved by a stubbed client that fails the test if from() is reached.

**Tests.**

| Level | Name | Proves |
|---|---|---|
| unit | `src/app/admin/sessions/[id]/game-schema.test.ts` | The zod schema refuses zero stages, an unknown stage, a duplicated stage and a non-integer order, and accepts each valid stage subset in sequence order. |
| integration | `src/app/admin/sessions/[id]/actions.test.ts` | createGame and updateGame return before any database call on malformed input, using a stub that throws if from() is invoked. |
| sql-harness | `supabase/tests/stage-sequence-check.test.sql` | A games row whose stage_sequence contains a value outside the win_stage set, or an empty array, is rejected by the CHECK constraint. |
| manual-rehearsal | `rehearsal/game-form.md` | Unticking every stage gives a message an admin can act on, not a confusing prize error. |

**Preflight (read-only, run against production before the change).**

```sql
select id, session_id, name, stage_sequence from games where jsonb_typeof(stage_sequence) is distinct from 'array' or jsonb_array_length(stage_sequence) = 0 or not (stage_sequence <@ '["Line","Two Lines","Full House"]'::jsonb);
```

**Rollback.** Revert the zod schemas and drop the stage_sequence CHECK constraint. The preflight returned zero non-conforming rows on 2026-08-25, so the constraint cannot fail on apply.

**Register entries absorbed.** 88, 89

### `admin-session-lock-server-side` :: The session lock on adding and cloning games is UI only, and Clone is not even disabled

**R2-next-cycle** | severity medium, likelihood possible | effort S | area money | status **not started**

createGame and duplicateGame never read sessions.status and the "Admins can manage games" policy is a blanket ALL, so nothing stops a game being appended to a running or completed session, and the per-row Clone button carries no disabled prop while the Delete beside it does. Done when the agreed rule is enforced server side, so an attempt against a running session either inserts no games row or inserts one deliberately, and the Clone button matches Add Game.

**Why this priority.** An admin can change the shape of a night that is already being played with one click on a button the UI forgot to disable. The routing underneath survives it, so this is a missing guardrail rather than a broken live path. The server cannot be written until the pub says whether the action should be allowed at all.

**Files.** `src/app/admin/sessions/[id]/actions.ts`, `src/app/admin/sessions/[id]/session-detail.tsx`

**Blocked on a decision.** May an admin add or clone a game into a session that is already running, for example an impromptu extra game, or must the session be reset to ready first? Recommendation: allow it deliberately with a warning, because pubs do add games on the night, and moveToNextGameOnBreak already picks up an appended game correctly.

**Acceptance criteria.**

- **Given** ASSUMED DEFAULT: games may only be added or cloned while sessions.status = 'ready'. Session S has status 'running'. **when** An admin submits the Add Game form for S. **then** The action returns 'Games can only be added while the session is Ready.' In the database: select count(*) from games where session_id = S is unchanged and no game_states row was created.
- **Given** Session S is 'running'. **when** An admin looks at a game row's Clone button. **then** Clone is disabled with the same reason shown as the Delete button beside it. If duplicateGame is called directly anyway, it refuses and the games count for S is unchanged.
- **Given** Session S is 'ready'. **when** An admin adds a game and clones an existing one. **then** Both succeed. In the database: the games count for S increases by one per action, and each new row's game_index is unique within S.
- **Given** Session S is 'completed'. **when** An admin JWT issues a hand-crafted PostgREST insert into games naming S. **then** The insert is refused by the database (a BEFORE INSERT trigger raising session_not_ready), not only by the server action. select count(*) from games where session_id = S is unchanged.
- **Given** Session S is 'ready' when the Add Game form renders, and is moved to 'running' by a host on another device before the admin submits. **when** The submit lands. **then** The action refuses rather than racing through, because the status is read inside the same guarded write. The games count for S is unchanged.

**Tests.**

| Level | Name | Proves |
|---|---|---|
| sql-harness | `supabase/tests/session-lock.test.sql` | Inserting into games for a session with status 'running' or 'completed' raises session_not_ready; 'ready' succeeds; the guard lives in the database so a hand-crafted call cannot bypass it. |
| integration | `src/app/admin/sessions/[id]/actions.test.ts` | createGame and duplicateGame read sessions.status and refuse for running and completed, mapping the database refusal to readable copy. |
| unit | `src/app/admin/sessions/[id]/session-detail.test.tsx` | The Clone button carries the same disabled condition and reason text as Delete. |
| manual-rehearsal | `rehearsal/session-lock.md` | An admin cannot append a game to a night the host is already running. |

**Preflight (read-only, run against production before the change).**

```sql
select s.status, count(distinct s.id) as sessions, count(g.id) as games from sessions s left join games g on g.session_id = s.id group by 1;
```

**Rollback.** Drop the trigger and remove the status guards from createGame and duplicateGame. Games created before the change are unaffected; nothing is deleted in either direction.

**Register entries absorbed.** 26

### `money-jackpot-text-suppressed` :: The jackpot amount is dropped from the winner record when the prize text mentions snowball

**R2-next-cycle** | severity low, likelihood possible | effort XS | area money | status **not started**

record_winner_atomic appends the jackpot text only when position('snowball' in lower(v_prize)) = 0, so an ordinary admin-entered prize such as "£20 Snowball Full House" suppresses it and the jackpot amount appears nowhere on the audit row. Done when a jackpot win always carries the amount, with de-duplication keyed on the exact generated jackpot text rather than on the word snowball, and the host list shows a jackpot badge driven by is_snowball_jackpot rather than free text.

**Why this priority.** Naming the prize after the game is the natural thing for an admin to type, and doing so quietly removes the payout amount from the only permanent record of it. The is_snowball_jackpot flag is still correct, so the win is not lost, only the figure. Reconciling the night afterwards then needs the pot history instead.

**Files.** `supabase/migrations/20260730064309_winner_idempotency_key.sql`, `src/app/host/[sessionId]/[gameId]/game-control.tsx`

**Acceptance criteria.**

- **Given** A snowball game whose configured Full House prize is '£20 Snowball Full House', with pot £140. **when** The host records an eligible Full House. **then** In the database: winners.prize_description = '£20 Snowball Full House + Snowball Jackpot £140' and is_snowball_jackpot = true. The jackpot amount is present despite the word 'snowball' already appearing in the planned prize.
- **Given** A snowball game whose configured prize is literally 'Snowball Jackpot £140' (already the generated text), pot £140. **when** An eligible Full House is recorded. **then** winners.prize_description = 'Snowball Jackpot £140' exactly, appearing once - de-duplication is keyed on the exact generated string, not on the word snowball.
- **Given** A snowball game with no configured Full House prize, pot £140. **when** An eligible Full House is recorded. **then** winners.prize_description = 'Snowball Jackpot £140'.
- **Given** A recorded jackpot row rendered on the host winners list and on /admin/history. **when** Both surfaces render it. **then** A jackpot badge is shown, driven by winners.is_snowball_jackpot. Editing prize_description to remove every mention of the word jackpot does not remove the badge.
- **Given** A non-jackpot Full House on a snowball game whose planned prize text contains the word 'snowball'. **when** Recorded as Not eligible. **then** No jackpot badge is shown; is_snowball_jackpot is false; prize_description carries no ' + Snowball Jackpot ' suffix.

**Tests.**

| Level | Name | Proves |
|---|---|---|
| sql-harness | `supabase/tests/jackpot-text-format.test.sql` | The four prize-text cases above: append when absent, do not double when the exact generated string is already present, substitute when null, and never append on a non-jackpot win. |
| unit | `src/app/host/winners-list.test.tsx` | The jackpot badge is driven by is_snowball_jackpot and survives a prize_description containing no matching words. |
| manual-rehearsal | `rehearsal/snowball-prize-text.md` | A game whose admin-entered prize mentions the snowball still records the cash amount on the audit row. |

**Preflight (read-only, run against production before the change).**

```sql
select id, game_id, prize_description, is_snowball_jackpot, created_at from winners where coalesce(is_snowball_jackpot,false) and (prize_description is null or prize_description not ilike '%jackpot £%');
```

**Rollback.** Restore the position('snowball' in lower(v_prize)) = 0 condition in record_winner_atomic. Rows written under the new behaviour keep their fuller text, which is correct either way.

**Register entries absorbed.** 132

### `money-lifecycle-and-correction-commands` :: Define the explicit session and pot commands so corrections stop being ad hoc rewinds

**R2-next-cycle** | severity high, likelihood possible | effort L | area money | status **not started**

The app has one destructive reset, one void, one hard pot delete and one hard pot reset, with no defined vocabulary for cancelling before settlement, completing and settling, abandoning with reconciliation, posting a compensating pot adjustment, archiving a pot, or resetting a test session. Done when each command exists as a named, guarded RPC, pot corrections are append-only rows in snowball_pot_history rather than in-place rewrites, and pots and sessions carry an archived_at rather than being deleted.

**Why this priority.** The three before-release fixes above all take the same shape, which is refusing an unsafe action rather than performing a silent wrong reversal, and that only holds up if there is a legitimate correction route to send the admin down instead. Without one, the answer to every mistake is editing the pot by hand on /admin/snowball with no record of why. This is R16 and R33 and it needs the pub's answers before any of it can be built.

**Files.** `supabase/migrations/20260430124120_atomic_admin_mutations.sql`, `supabase/migrations/20260730065531_atomic_snowball_settlement.sql`, `src/app/admin/snowball/actions.ts`, `src/app/admin/sessions/[id]/actions.ts`

**Depends on.** `money-reset-session-unsafe-semantics`, `money-void-after-settlement-pot-uncorrected`, `money-pot-delete-non-transactional`

**Blocked on a decision.** 1. May a session that has already settled a snowball pot ever be replayed, or must the admin correct the pot by hand first? 2. Who is allowed to approve a compensating pot adjustment, and does it need a typed reason? 3. Is permanent deletion of a pot or a session ever required for a business or privacy reason, or is a soft archive always acceptable? Recommendation: refuse the replay of a settled session, let any admin post a compensating adjustment with a mandatory reason, and never hard delete.

**Acceptance criteria.**

- **Given** ASSUMED DEFAULT (this item carries the open decision R16/R33; these criteria assume six named commands: cancel_session, complete_and_settle_game, abandon_game, adjust_snowball_pot, archive_snowball_pot, reset_test_session; pot corrections are append-only snowball_pot_history rows, never in-place rewrites; pots and sessions carry archived_at rather than being deleted). The decision has been recorded. **when** docs/decisions/lifecycle-commands.md is read. **then** Each of the six commands is named with its precondition, its exact database effect and its refusal cases. A docs test asserts every command named in that document has a matching function in supabase/migrations.
- **Given** Session S with zero winners and every game still 'not_started'. **when** An admin runs Cancel Session. **then** In the database: sessions.status = 'cancelled' and archived_at is set; winners and game_states rows are untouched. On screen: S no longer appears on /host or /display, and appears on /admin/history only behind an 'include archived' toggle.
- **Given** A snowball game abandoned mid-stage (the room has emptied). **when** The host runs Abandon Game with reason 'power cut'. **then** In the database: game_states.status = 'abandoned' with the reason persisted and ended_at set; exactly one snowball_pot_history row for that game with change_type = 'rollover'; the pot moves by calls_increment and jackpot_increment once and only once. A second Abandon Game call writes no second history row.
- **Given** Pot P showing £160 which should be £140 after a historic double settlement. **when** An admin posts an adjustment to £140 with reason 'double settlement on 2026-08-18'. **then** In the database: snowball_pots.current_jackpot_amount = 140.00; a new snowball_pot_history row exists with change_type = 'manual_adjustment', old_val_jackpot = 160, new_val_jackpot = 140, the reason and changed_by = the admin's auth.uid(); comparing the history row set before and after shows only an addition - no existing row's id or columns changed.
- **Given** A session with is_test_session = true, and separately a real session. **when** An admin runs Reset Test Session on each. **then** The test session is reset (winners and game_states removed, status 'ready'). The real session raises not_a_test_session and nothing is deleted - select count(*) from winners where session_id = <real> is unchanged.
- **Given** A host-role account calling each of the admin-only commands with a real JWT. **when** Each RPC executes. **then** Each raises unauthorized and writes nothing. The commands the decision marks host-callable (complete_and_settle_game, abandon_game) succeed for a host and still derive every written value from locked rows.
- **Given** snowball_pot_history, the money audit trail. **when** An UPDATE and a DELETE are attempted against it as an admin and as an authenticated user. **then** Both are refused for every role except service_role. The table is append-only, so a correction can only ever be a new row.

**Tests.**

| Level | Name | Proves |
|---|---|---|
| sql-harness | `supabase/tests/lifecycle-commands.test.sql` | One section per command: its precondition holds, its database effect is exactly as documented, its refusal cases raise the mapped key, and a second identical call is a no-op rather than a second movement. |
| sql-harness | `supabase/tests/pot-history-append-only.test.sql` | UPDATE and DELETE on snowball_pot_history are refused for authenticated and for an admin, so pot corrections cannot rewrite the past. |
| integration | `src/app/admin/lifecycle-actions.test.ts` | Each command's server action maps its error keys to admin-readable copy and treats a null RPC return as failure. |
| concurrency | `supabase/tests/lifecycle-commands.test.sql (two-connection pairs)` | Two simultaneous abandon_game calls on the same game, and two simultaneous adjust_snowball_pot calls on the same pot, each produce exactly one history row and one pot movement. |
| manual-rehearsal | `rehearsal/night-corrections.md` | An abandoned game, a double settlement and a test-session reset can each be handled end to end from the admin screens, without hand-editing the database. |

**Preflight (read-only, run against production before the change).**

```sql
select 'sessions' as object, status::text as value, count(*) from sessions group by 1,2 union all select 'game_states', status::text, count(*) from game_states group by 1,2 union all select 'pot_history', change_type, count(*) from snowball_pot_history group by 1,2 union all select 'test_sessions', coalesce(is_test_session,false)::text, count(*) from sessions group by 1,2;
```

**Rollback.** The six commands are additive SECURITY DEFINER functions; drop each one and the existing paths remain as they are today. archived_at columns are nullable and additive and stay in place (dropping a column needs explicit approval). snowball_pot_history rows written by the new commands are real audit and are never removed.

**Register entries absorbed.** none (raised by the completeness or merge pass)

### `money-prize-given-on-voided-winner` :: set_winner_prize_given will tick a voided winner's prize as handed over

**R2-next-cycle** | severity low, likelihood unlikely | effort XS | area money | status **not started**

The RPC locks the winners row and checks existence and session but never reads is_void, so the only guard against marking a cancelled win as paid is the disabled attribute on the host button. Done when the function raises a mapped key such as winner_voided when is_void is true and p_prize_given is true, with the mapping added to HOST_RPC_ERRORS.

**Why this priority.** The client guard works, so this only fires through a direct API call by someone holding a host JWT, or after a future UI change removes the disabled prop. It leaves a money-adjacent flag saying a cancelled prize was paid, which is exactly the kind of row an end-of-night reconciliation trusts. Cheap to close while the function is open for other reasons.

**Files.** `supabase/migrations/20260730065446_host_can_mark_prize_given.sql`, `src/app/host/actions.ts`

**Acceptance criteria.**

- **Given** Winner W1 with is_void = true and prize_given = false. **when** set_winner_prize_given(W1, true) is called directly, bypassing the disabled UI control. **then** It raises winner_voided. In the database: select prize_given from winners where id = W1 is still false.
- **Given** Winner W1 with is_void = true and prize_given = true (the prize was handed over before the void). **when** set_winner_prize_given(W1, false) is called. **then** It succeeds. In the database: prize_given = false. Un-ticking a voided winner is allowed - the guard only blocks asserting that a cancelled win was paid.
- **Given** Live winner W2 with is_void false. **when** set_winner_prize_given(W2, true) is called. **then** It succeeds and returns the persisted winners row. In the database: prize_given = true. The host's tick is proved by the returned row, not assumed.
- **Given** A voided row on the host's winners list. **when** The host looks at the prize-given control. **then** It is disabled and no request is sent. If a request is sent anyway, HOST_RPC_ERRORS maps winner_voided to 'That win has been voided, so the prize cannot be marked as given.'
- **Given** A winner belonging to a different session than the one supplied. **when** The RPC is called. **then** It raises wrong_session, as today, and no column is written.

**Tests.**

| Level | Name | Proves |
|---|---|---|
| sql-harness | `supabase/tests/prize-given-void.test.sql` | set_winner_prize_given raises winner_voided for (voided, true), succeeds for (voided, false), succeeds for (live, true) returning the persisted row, and still raises wrong_session on a session mismatch. |
| unit | `src/app/host/actions.test.ts` | HOST_RPC_ERRORS contains a winner_voided entry with host-readable copy. |
| manual-rehearsal | `rehearsal/prize-given.md` | A voided win cannot be ticked as paid from the host screen, and an already-paid voided win can still be corrected. |

**Preflight (read-only, run against production before the change).**

```sql
select id, session_id, game_id, stage, is_void, void_reason, prize_given from winners where coalesce(is_void,false) and coalesce(prize_given,false);
```

**Rollback.** Restore the previous set_winner_prize_given body and remove the HOST_RPC_ERRORS entry. No data is written by the change.

**Register entries absorbed.** 134

### `obs-business-audit-ledger` :: No business action is recorded: no actor on winners, no void ball, no takeover, no refused claim, no admin change

**R2-next-cycle** | severity medium, likelihood possible | effort L | area quality | status **not started**

winners carries no recorded_by, voided_by, voided_at, prize_given_by or prize_given_at even though every write path has auth.uid() to hand. void_last_number pops the ball and inserts nothing, takeControl overwrites controlling_host_id in place, validateClaim returns a refusal and stores nothing, and none of the eleven admin actions writes an audit row. Done means each of those actions inserts an append-only ledger row naming actor, timestamp and before and after values, written inside the same transaction as the change it describes.

**Why this priority.** Every dispute a pub actually has is unanswerable today. Nineteen production winner rows say a prize was given with no record of when or by whom. A ball called, withdrawn and re-called later leaves only a version counter. A punter saying I never got my fifty pounds can be checked against a single boolean and nothing else.

**Priority changed by the merge pass.** Lowered from R1/high. This was too harsh for a single-venue pub with one admin and a handful of hosts. The money record itself is restored by the block 4 pot items (snowball_pot_history written atomically and displayed), and the winners rows already reconstruct who won what. A full append-only ledger across eleven admin actions, void_last_number, takeControl and refused claims is a next-cycle build. Within the item, do the winners actor columns first (recorded_by, voided_by, voided_at, prize_given_by, prize_given_at): they are additive, cheap, and the only part with money value.

**Files.** `src/app/host/actions.ts`, `src/app/admin/actions.ts`, `src/app/admin/sessions/[id]/actions.ts`, `supabase/migrations/20260729231945_atomic_host_mutations.sql`, `supabase/migrations/20260730064309_winner_idempotency_key.sql`

**Depends on.** `qual-ci-gate-and-migration-replay`, `obs-technical-error-monitoring`

**Blocked on a decision.** How long are operational and financial records retained, may staff UUIDs and emails appear in exports, and may a refused claim store the punter's claimed numbers? Recommendation: store the numbers, because they contain nothing identifying and they are the only thing that could reconstruct a disputed win, but set an explicit retention period and restrict reads to admins.

**Acceptance criteria.**

- **Given** An append-only ledger table with actor, occurred_at, entity type and id, action, before and after JSON **when** Each of record winner, void winner, void last number, take control, set prize given, refused claim, and each of the eleven admin actions is performed once **then** Exactly one ledger row exists per action, with actor equal to auth.uid(), and before/after values that match the row that changed
- **Given** The ledger insert forced to fail **when** Any of those actions runs **then** The business change rolls back too: the winners, game_states, sessions, games or snowball_pots row is unchanged, proving the ledger write shares the transaction rather than following it
- **Given** A claim refused by validateClaim **when** The refusal returns **then** A ledger row records the refusal with the game, stage and the count of invalid numbers, and contains no customer-identifying free text (asserted by a test rejecting any name-shaped field)
- **Given** takeControl replacing an existing controller **when** The takeover commits **then** The ledger row names both the previous and the new controlling_host_id, so an in-place overwrite is still reconstructable
- **Given** A host JWT and an admin JWT **when** Either attempts UPDATE or DELETE on the ledger table **then** Both are refused by RLS and grants; only INSERT via the security definer paths and admin SELECT are permitted

**Tests.**

| Level | Name | Proves |
|---|---|---|
| sql-harness | `supabase/tests/audit-ledger.test.sql` | One row per action with the right actor and before/after values, transactional coupling, and append-only enforcement against real role JWTs |
| failure-injection | `supabase/tests/audit-ledger.test.sql (ledger failure branch)` | A failed ledger insert prevents the business change, so no unrecorded money or state movement is possible |
| unit | `src/lib/audit-actions.test.ts` | The enumerated action list covers every mutating server action, so adding an action without an audit entry fails the build |

**Preflight (read-only, run against production before the change).**

```sql
select count(*) as winners_total, count(*) filter (where client_request_id is null) as pre_idempotency from public.winners; select count(*) from public.snowball_pot_history;
```

**Rollback.** New table plus function changes. Roll back by restoring the previous function bodies; leave the table in place (it is append-only and empty rows harm nothing). Never drop the table once a live night has written to it.

**Register entries absorbed.** 70, 76, 142, 147, 150

### `obs-game-states-updated-at-frozen` :: game_states.updated_at never advances and the stale value is mirrored to public clients

**R2-next-cycle** | severity low, likelihood certain | effort XS | area quality | status **not started**

bump_game_state_version sets only state_version and no write path sets updated_at, so every row keeps its creation time while being updated hundreds of times, and sync_game_states_public copies the stale value into the public mirror that the display and player payloads select. Done means updated_at advances on every write and a row's updated_at is within a second of its last state_version bump.

**Why this priority.** Debugging the morning after, the live row for Game 10 says nothing happened after 20:17 on 29 July, when in fact 133 updates followed and the game was ended at 06:24 the next morning. The value is also on the wire to public clients, where anyone could reasonably trust it.

**Files.** `supabase/migrations/20260729231945_atomic_host_mutations.sql`, `src/app/host/actions.ts`

**Depends on.** `qual-ci-gate-and-migration-replay`

**Acceptance criteria.**

- **Given** A game_states row **when** Any write bumps state_version **then** bump_game_state_version also sets updated_at to now(); immediately after the write, now() - updated_at is under one second
- **Given** Twenty calls made in sequence on one game **when** The row history is examined **then** updated_at strictly increases alongside state_version, with no pair where state_version advanced and updated_at did not
- **Given** The public mirror **when** sync_game_states_public runs **then** game_states_public.updated_at equals the source row's updated_at, so the value the display and player payloads select is current rather than the creation time
- **Given** The 60 existing game_states rows whose updated_at is frozen at creation **when** The migration lands **then** They are either left with a documented note or set to coalesce(ended_at, started_at, updated_at); no row is left claiming a future timestamp

**Tests.**

| Level | Name | Proves |
|---|---|---|
| sql-harness | `supabase/tests/state-version.test.sql` | The trigger advances updated_at with state_version and the mirror copies the current value, not a stale one |

**Preflight (read-only, run against production before the change).**

```sql
select count(*) as rows, count(*) filter (where updated_at = (select min(updated_at) from public.game_states)) as frozen_at_earliest, min(updated_at), max(updated_at) from public.game_states; select gs.id, gs.state_version, gs.updated_at, p.updated_at as public_updated_at from public.game_states gs join public.game_states_public p on p.game_id = gs.game_id limit 20;
```

**Rollback.** Trigger change plus an optional backfill. Roll back by restoring the previous trigger body. The backfill is derived and idempotent, and no consumer currently relies on updated_at for ordering (state_version is the comparator), so the change is low blast radius.

**Register entries absorbed.** 120, 144

### `qual-admin-edits-invisible-to-live-surfaces` :: An admin edit to a running game reaches neither the host screen nor the pub TV

**R2-next-cycle** | severity medium, likelihood possible | effort M | area quality | status **not started**

games is not in the realtime publication and nothing subscribes to it, the host page passes the game row as a static prop, and the display only re-reads the game inside refreshActiveGame, which returns early when the active game id has not changed. So the fields that update_game_safe does permit mid-game, name, game_index, background_colour and notes, are accepted into the database and never appear. Done means an update to games on a running game is visible on both live surfaces within one poll interval, or the edit is refused with an explanation.

**Why this priority.** An admin who corrects a game's ticket colour mid-game sees the TV keep painting the old one, reasonably concludes the edit did not save, and tries again. Reordering game_index while a game is live also silently re-decides which game the host page believes is last, so the post-win button wording can be wrong for the rest of the game.

**Files.** `src/app/host/[sessionId]/[gameId]/page.tsx`, `src/app/host/[sessionId]/[gameId]/game-control.tsx`, `src/app/display/[sessionId]/display-ui.tsx`

**Depends on.** `qual-ci-gate-and-migration-replay`

**Blocked on a decision.** Should mid-game edits propagate to the live surfaces, or be blocked outright while game_states.status is 'in_progress'? Recommendation: propagate the handful of fields the live surfaces read, because a correction to the ticket colour is exactly the edit someone makes mid-game.

**Acceptance criteria.**

- **Given** Decision assumed: mid-game edits become visible rather than being refused. A running game on the host pad and the TV **when** An admin changes games.name, game_index, background_colour or notes **then** Within one poll interval both the host pad and /display show the new values without a reload, and the rendered values equal the games row exactly
- **Given** The same running game **when** An admin attempts to change type, stage_sequence or snowball_pot_id **then** update_game_safe refuses with a named error mapped in the client, and those three columns are unchanged
- **Given** The display already showing the active game **when** refreshActiveGame runs and the active game id has not changed **then** It still re-reads the game row rather than returning early, so a change to a permitted column is picked up

**Tests.**

| Level | Name | Proves |
|---|---|---|
| sql-harness | `supabase/tests/update-game-safe.test.sql` | The permitted and refused column sets on a started game, asserted against the persisted row |
| manual-rehearsal | `docs/runbooks/rehearsal.md#S24-mid-game-admin-edit` | An admin correcting a game name mid-game sees it reach both live surfaces |

**Preflight (read-only, run against production before the change).**

```sql
select pubname, tablename from pg_publication_tables where pubname = 'supabase_realtime' order by 2;
```

**Rollback.** If the fix adds games to the realtime publication, that is a migration and is reverted by dropping it from the publication. If it is a poll-side change only, revert the client commit. Prefer the poll route: it needs no publication change and no new row exposure.

**Register entries absorbed.** 40

### `qual-authorize-helper-duplication` :: authorizeAdmin is copy-pasted into three files and authorizeHost is a fourth near-copy

**R2-next-cycle** | severity medium, likelihood possible | effort S | area quality | status **not started**

Two of the three copies are byte-identical, the third differs only in trailing whitespace, and the host copy is the same shape with the role test widened. Done means one shared helper in src/lib, the four copies deleted, and a test proving a non-admin session is refused by every admin server action.

**Why this priority.** The security work in this backlog changes exactly this check, adding a pending role and a suspended-account test. Landing that in three of four files leaves one server-action file authorising on the old rule, and there is no test on any of them to catch it.

**Files.** `src/app/admin/actions.ts`, `src/app/admin/sessions/[id]/actions.ts`, `src/app/admin/snowball/actions.ts`, `src/app/host/actions.ts`

**Depends on.** `qual-ci-gate-and-migration-replay`

**Acceptance criteria.**

- **Given** One shared helper module in src/lib (authorizeAdmin and authorizeHost) **when** The repository is scanned **then** The three admin copies and the host near-copy are deleted, every call site imports the shared module, and a scan finds no second definition of either function name
- **Given** A session whose profiles.role is 'host' **when** Each admin server action is invoked in turn **then** Every one returns the unauthorised error and writes nothing: row counts on sessions, games, winners, snowball_pots and snowball_pot_history are unchanged after the whole sweep
- **Given** A session whose profiles.role is 'pending' **when** Each admin and each host server action is invoked **then** All are refused, proving the shared helper excludes the harmless tier as well as the wrong staff tier

**Tests.**

| Level | Name | Proves |
|---|---|---|
| unit | `src/lib/authorize.test.ts` | A table-driven sweep over the enumerated action list refuses host and pending sessions for every admin action, so a new action cannot be added without an entry |
| sql-harness | `supabase/tests/grants.test.sql` | The database refuses the same callers independently of the application helper, so the helper is defence in depth rather than the only gate |

**Preflight (read-only, run against production before the change).**

```sql
select role, count(*) from public.profiles group by 1;
```

**Rollback.** Pure refactor of an authorisation check, so it must land with the sweep test in the same PR. Revert the commit if the sweep fails; the database-side policies are unaffected either way.

**Register entries absorbed.** 96

### `qual-capacity-and-performance-targets` :: Set capacity and performance targets before the QR code is put in front of a full room

**R2-next-cycle** | severity medium, likelihood possible | effort M | area quality | status **not started**

There are no stated expectations for guest phones, displays, sessions, history rows or concurrent hosts, and no latency, realtime lag, polling load or page-load targets, while every public client polls game_states_public on a short interval alongside realtime. Done means a written peak concurrency figure and a measured five-hour session at that figure, with the observed lag between a call_next_number commit and the number appearing on the TV, and pagination on the admin and export pages before row growth forces it.

**Why this priority.** The app may pass a one-device rehearsal and fail the first time forty phones scan the QR at once. This item carries no register entries because the appendix findings on polling load and unpaginated pages sit in other areas, but the developer review is right that the targets have to exist before the load test can mean anything.

**Priority changed by the merge pass.** Lowered from R1. The written targets are cheap and belong in the gate, and the gate now carries the essential measurement (observed lag between a call_next_number commit and the TV rendering it, at the rehearsal's phone count). What is being deferred is the full measured five-hour soak at peak concurrency, which cannot be run before the remediation blocks land and is not what stands between the app and one supervised night.

**Files.** `src/app/display/[sessionId]/display-ui.tsx`, `src/app/player/[sessionId]/player-ui.tsx`, `src/app/admin/history/page.tsx`, `src/app/admin/backup/page.tsx`

**Depends on.** `qual-ci-gate-and-migration-replay`

**Blocked on a decision.** What is the venue capacity, how many guests are expected to open the follower view, and what delay between the host calling a number and the TV showing it is acceptable? Recommendation: size for the full room scanning the QR, because that is the advertised behaviour.

**Acceptance criteria.**

- **Given** docs/standards/capacity.md **when** It is reviewed **then** It states peak figures (assumed default: 60 guest phones, 1 TV, 2 host devices, one live session at a time) and SLOs: the ball appears on the TV within 2 seconds of the call_next_number commit at p95, public page load under 3 seconds on 4G, and a stated polling interval and its resulting request rate at peak
- **Given** A five-hour simulated session at the stated peak **when** It is run **then** The commit-to-TV lag is recorded at p50 and p95 against the SLO, no client stops updating for the duration, and Supabase request counts and egress for the run are recorded in the document
- **Given** /admin/history and /admin/backup against a fixture of 5000 winners rows and 60 sessions **when** They load **then** Both are paginated with an explicit query limit, the first page renders in under 1.5 seconds, and no query returns an unbounded result set

**Tests.**

| Level | Name | Proves |
|---|---|---|
| integration | `scripts/load/five-hour-session.ts` | The measured commit-to-TV lag and client stability at the stated peak, which no unit test can establish |
| unit | `src/lib/pagination.test.ts` | Every admin list query carries an explicit limit and offset, so row growth cannot silently produce an unbounded query |
| manual-rehearsal | `docs/standards/capacity.md#peak-rehearsal` | A real room of phones scanning the QR at once behaves within the stated targets |

**Preflight (read-only, run against production before the change).**

```sql
select (select count(*) from public.winners) as winners, (select count(*) from public.sessions) as sessions, (select count(*) from public.games) as games, (select count(*) from public.game_states) as game_states;
```

**Rollback.** Documentation plus pagination. Pagination is reverted by restoring the previous query, which is the riskier state; prefer forward-fix.

**Register entries absorbed.** none (raised by the completeness or merge pass)

### `qual-dates-unlocalised` :: User-facing dates are formatted with raw Date methods and no timezone, in a British pub

**R2-next-cycle** | severity low, likelihood certain | effort S | area quality | status **not started**

There is no dateUtils module in this project. Two server components format dates with toLocaleDateString and no locale or timezone, so they render in the Vercel runtime's UTC and US default, while a sibling client component renders the same timestamp in the viewer's locale. duplicateSession derives start_date from a UTC ISO string, which yields yesterday's date between midnight and 01:00 during British Summer Time. Done means all five sites go through a shared en-GB Europe/London helper, and a win recorded at 00:30 London time appears under the correct night.

**Why this priority.** Winner History drops the time of day entirely, so the order in which wins happened within a night is not visible on the page at all, and a late win can be filed under the previous date. Two admin screens also disagree about the same timestamp.

**Files.** `src/app/admin/history/page.tsx`, `src/app/admin/backup/page.tsx`, `src/app/admin/sessions/[id]/session-detail.tsx`, `src/app/admin/actions.ts`, `src/app/display/page.tsx`

**Depends on.** `qual-ci-gate-and-migration-replay`

**Acceptance criteria.**

- **Given** A winners row created at 2026-07-30T23:30:00Z, which is 00:30 on 31 July in London during BST **when** /admin/history and the session detail page render it **then** Both show '31 July 2026' from formatDateInLondon, identical strings on the server-rendered and client-rendered surfaces, regardless of the viewer's own locale or the Vercel runtime timezone
- **Given** duplicateSession invoked at 2026-07-30T23:30:00Z **when** The new session is created **then** sessions.start_date is '2026-07-31' from getTodayIsoDateInLondon, not '2026-07-30' derived from a UTC ISO string
- **Given** The repository as committed **when** It is scanned **then** No toLocaleDateString, toLocaleString or toLocaleTimeString call exists outside src/lib/dates.ts, and all five previously offending call sites import from that module

**Tests.**

| Level | Name | Proves |
|---|---|---|
| unit | `src/lib/dates.test.ts` | Formatting is en-GB Europe/London across a BST boundary, a GMT date, and the 00:30 case, with the process TZ forced to UTC and to a US zone to prove independence |
| unit | `src/lib/dates-callsites.test.ts` | A repo scan finds no raw locale formatting outside the shared helper, so a new call site cannot regress it |

**Preflight (read-only, run against production before the change).**

```sql
select id, name, start_date, created_at, created_at at time zone 'Europe/London' as london from public.sessions order by start_date; select count(*) from public.winners where (created_at at time zone 'Europe/London')::date <> (created_at at time zone 'UTC')::date;
```

**Rollback.** Presentation-only apart from duplicateSession's start_date derivation. Revert the commit; existing stored dates are unaffected because only formatting and one derived default change.

**Register entries absorbed.** 84, 85, 98, 145

### `qual-game-control-monolith` :: game-control.tsx is 1914 lines with 39 useState, 8 useEffect and 8 inline modals

**R2-next-cycle** | severity medium, likelihood possible | effort L | area quality | status **not started**

One client component owns the realtime transport, the polling fallback, the winners lists, the pot subscription, the claim flow, seven mutation flows and eight modals, with a 878-line JSX return and a handler that closes over a function declared 254 lines later behind an apologetic comment about the temporal dead zone. Done means the transport, the winners list, the pot and the claim flow move behind named hooks and the modals become separate components taking explicit props, with no behaviour change provable by the live-path tests.

**Why this priority.** Reviewers cannot hold 39 pieces of state in their head, which is how the duplicate-winner and stuck-calling bugs that the file's own comments describe got in. This is the file that runs the live game, so it must not be refactored until the tests that would catch a regression exist.

**Files.** `src/app/host/[sessionId]/[gameId]/game-control.tsx`

**Depends on.** `qual-ci-gate-and-migration-replay`, `qual-money-and-live-path-test-coverage`

**Acceptance criteria.**

- **Given** The refactor complete **when** src/app/host/[sessionId]/[gameId]/game-control.tsx is measured **then** It is under 400 lines; the transport, the winners list, the pot and the claim flow each sit behind a named hook with its own unit test; each of the eight modals is a separate component taking explicit props; and no handler closes over a function declared later in the file (the temporal-dead-zone comment is gone because the shape no longer needs it)
- **Given** The live-path rehearsal scenarios run before and after the refactor **when** The same sequence of taps is performed **then** The database outcomes are identical: the same winners rows, the same game_states column values and the same state_version increments, compared row by row

**Tests.**

| Level | Name | Proves |
|---|---|---|
| unit | `src/hooks/use-game-transport.test.ts` | The realtime and polling transport is testable in isolation and discards stale payloads by state_version |
| unit | `src/hooks/use-claim-flow.test.ts` | The claim key is minted at modal open and reused on every retry, which is the behaviour the refactor must not lose |
| manual-rehearsal | `docs/runbooks/rehearsal.md#S26-full-game-before-and-after` | A whole game played through the refactored screen writes the same rows as the original |

**Rollback.** Pure refactor. Revert the commit. Do not land it in the same PR as any behaviour change, so the revert is unambiguous.

**Register entries absorbed.** 34

### `qual-host-action-near-duplicates` :: Two pairs of near-identical host server actions, one pair already drifted on a guard

**R2-next-cycle** | severity low, likelihood unlikely | effort M | area quality | status **not started**

moveToNextGameOnBreak and moveToNextGameAfterWin differ only by a trailing break toggle, and advanceToNextStage and skipStage are the same read, compute, conditional update and settle flow. skipStage refuses a game with no stages; advanceToNextStage would compute a current_stage_index of minus one and write it. Done means the shared body exists once so the guard and the settlement path cannot diverge, and no path can write a negative current_stage_index to game_states.

**Why this priority.** The stated failure is latent rather than live: the admin action substitutes a default when no stages are selected, so an empty stage_sequence is not reachable through the UI and the live preflight found none. The duplication is the real cost, because the same defect was fixed once in one copy and left open in the other.

**Files.** `src/app/host/actions.ts`

**Depends on.** `qual-ci-gate-and-migration-replay`, `qual-money-and-live-path-test-coverage`

**Acceptance criteria.**

- **Given** A game whose stage_sequence is empty **when** advanceToNextStage is called **then** It is refused with the same named error skipStage already gives; game_states.current_stage_index is unchanged and is never written as -1
- **Given** A CHECK constraint on game_states.current_stage_index >= 0 **when** Any path attempts to write -1, including a hand-crafted API call **then** The database rejects it, so the guard cannot be lost by a future code change
- **Given** moveToNextGameOnBreak and moveToNextGameAfterWin run against identical starting state **when** Both complete **then** The resulting rows are identical on every column except game_states.on_break, proved by comparing the full row, and the shared body means the two cannot drift again

**Tests.**

| Level | Name | Proves |
|---|---|---|
| sql-harness | `supabase/tests/stage-advance.test.sql` | The empty stage_sequence refusal, the CHECK constraint rejection of -1, and that the two move paths differ only in on_break |
| unit | `src/app/host/actions.test.ts` | Both pairs call one shared body, so a guard added to one is present in the other |

**Preflight (read-only, run against production before the change).**

```sql
select min(current_stage_index) as min_stage_index, max(current_stage_index) as max_stage_index, count(*) filter (where current_stage_index < 0) as negative_rows from public.game_states; select count(*) from public.games where jsonb_array_length(stage_sequence) = 0;
```

**Rollback.** The CHECK constraint is the only schema change; the preflight confirms no existing row violates it, so it applies without a backfill. Roll back by dropping the constraint and restoring the previous action bodies.

**Register entries absorbed.** 100

### `qual-keyboard-and-form-semantics` :: A bare div opens the host session list, buttons nest inside links, and login has no autocomplete

**R2-next-cycle** | severity medium, likelihood possible | effort S | area quality | status **not started**

The only way to expand a session on /host is a plain div with onClick, no role, tabIndex, key handler or aria-expanded, which is a WCAG 2.1.1 Level A failure with no alternative route, and a game must be started from that list. Nine places nest a button inside a link, producing invalid doubly-focusable markup, and neither login field carries autoComplete. Done means every interactive element is reachable and operable by keyboard with a correct accessible name and one focus stop per target.

**Why this priority.** A host using an external keyboard on a tablet cannot open a session's games at all, so no game can be started. The login autocomplete gap matters for the same person: a stand-in host on a pub tablet gets no saved-password suggestion while the room waits.

**Files.** `src/app/host/dashboard.tsx`, `src/app/page.tsx`, `src/app/admin/dashboard.tsx`, `src/app/display/page.tsx`, `src/app/login/page.tsx`, `src/components/ui/button.tsx`

**Depends on.** `qual-ci-gate-and-migration-replay`, `qual-accessibility-release-criteria`

**Acceptance criteria.**

- **Given** The /host session list **when** A keyboard-only operator tabs to a session row and presses Enter, then Space **then** The row expands on both keys, it is a button element with aria-expanded reflecting the state, and a game can be started end to end without a pointer
- **Given** The repository as committed **when** It is scanned **then** Zero occurrences remain of a button element nested inside a link (the nine current sites are gone), so each target has exactly one focus stop and the markup is valid
- **Given** /login **when** It renders **then** The email input carries autoComplete='username' (or 'email') and the password input autoComplete='current-password', and a password manager fills both without intervention
- **Given** Any interactive element on /host and /admin **when** It receives keyboard focus **then** It has a visible focus indicator and an accessible name that describes its action, not just its icon

**Tests.**

| Level | Name | Proves |
|---|---|---|
| unit | `src/lib/markup-semantics.test.ts` | A repo scan finds no button-inside-link and no onClick on a bare div without role and key handling |
| manual-rehearsal | `docs/runbooks/rehearsal.md#S27-keyboard-only-host` | A host can start a game with a keyboard alone, which is the WCAG 2.1.1 failure the bare div creates today |

**Rollback.** Markup-only. Revert the commit; no behaviour or data change.

**Register entries absorbed.** 154, 155, 158

### `qual-modal-scroll-lock` :: Closing a stacked modal restores body scrolling while the modal underneath is still open

**R2-next-cycle** | severity low, likelihood likely | effort XS | area quality | status **not started**

Modal sets document.body.style.overflow to hidden on open and unconditionally to unset in its cleanup keyed on isOpen, and modals in this app stack, with Record Winner opening on top of Claim Check and Post Win on top of both. Done means an open-modal counter restores the previous overflow value only when the last modal closes, and the page behind never scrolls while any modal is open.

**Why this priority.** The host is re-counting a paper ticket on a phone with a scrollable 90-number grid open, and the page behind starts moving under their thumb, which is exactly the moment a mis-tap becomes a false valid claim.

**Files.** `src/components/ui/modal.tsx`, `src/app/host/[sessionId]/[gameId]/game-control.tsx`

**Depends on.** `qual-ci-gate-and-migration-replay`

**Acceptance criteria.**

- **Given** Claim Check open, then Record Winner opened on top of it **when** Record Winner is closed **then** document.body.style.overflow is still 'hidden' and the page behind does not scroll, because the open-modal count is still 1
- **Given** Three stacked modals (Claim Check, Record Winner, Post Win) **when** The last one closes **then** overflow is restored to the value captured before the first modal opened, not hardcoded to 'unset'
- **Given** Any modal open **when** The user attempts to scroll the page behind **then** It does not scroll, at every point in the open and close sequence

**Tests.**

| Level | Name | Proves |
|---|---|---|
| unit | `src/lib/scroll-lock.test.ts` | The counter locks on the first open, stays locked through nested open and close, and restores the captured value only on the last close |

**Rollback.** Single component change in src/components/ui/modal.tsx. Revert the commit.

**Register entries absorbed.** 102, 129, 161

### `qual-public-screen-duplication` :: The display and player screens share 574 identical lines of data layer and have already drifted

**R2-next-cycle** | severity medium, likelihood likely | effort M | area quality | status **not started**

The session and game fetch, both realtime channels, the visibility reconnect, the polling fallback, the pot subscription and the reveal pacing effect are byte-identical across the two files, differing only in a scope string and a channel suffix. The overlay gating has diverged: the display gates every overlay on hasRenderableGame with a comment explaining why, and the player reads the raw row. Done means one shared hook feeds both screens and the two surfaces agree on when a break or claim-check overlay may appear for a given game_states_public row.

**Why this priority.** The next fix applied to one screen will not reach the other, and the drift already present means guests at the table can see an overlay the pub TV does not, on the same game state.

**Files.** `src/app/display/[sessionId]/display-ui.tsx`, `src/app/player/[sessionId]/player-ui.tsx`

**Depends on.** `qual-ci-gate-and-migration-replay`

**Acceptance criteria.**

- **Given** One shared hook (for example usePublicGameFeed) consumed by both display-ui.tsx and player-ui.tsx **when** The two files are compared **then** No byte-identical block longer than 30 lines remains between them, the session and game fetch, both realtime channels, the visibility reconnect, the polling fallback, the pot subscription and the reveal pacing all live in the hook, and both files shrink by the duplicated line count
- **Given** A game_states_public row with on_break true but no renderable game **when** Both screens render it **then** Neither shows the break overlay: the display's hasRenderableGame gate is the behaviour kept, and the player screen now matches it rather than reading the raw row
- **Given** The same row driving a claim-check overlay **when** Both screens render **then** They agree exactly on whether the overlay appears, asserted by a table-driven test over the overlay gating function for every combination of hasRenderableGame, on_break, paused_for_validation and display_win_type

**Tests.**

| Level | Name | Proves |
|---|---|---|
| unit | `src/lib/public-overlay-gating.test.ts` | One gating function decides overlays for both surfaces, table-driven across every state combination |
| manual-rehearsal | `docs/runbooks/rehearsal.md#S25-tv-and-phone-agree` | The TV and a guest phone show the same overlay at the same moment through a break, a claim check and a win |

**Rollback.** Pure refactor with no schema or contract change. Revert the commit if the rehearsal shows a divergence; the gating test is the guard that makes the refactor provable.

**Register entries absorbed.** 33

### `qual-styling-systems-and-pink-focus-rings` :: Three overlapping colour systems, with an override sheet that leaks the old pink brand on admin focus rings

**R2-next-cycle** | severity low, likelihood certain | effort L | area quality | status **not started**

The rebrand was implemented as roughly 200 lines of theme-scoped important overrides on top of the previous palette, which is still defined in tailwind.config.ts and referenced 21 times, alongside 390 raw hex literals. The override covers the base ring class but not the focus-visible or focus variants, so every form control on /admin shows a pink focus ring on a green page. Done means one token set, the override block and the old palette deleted, and no pink pixel on any admin control.

**Why this priority.** Whether a class renders green or pink currently depends on which route the component is mounted under, so the correct way to write a colour is unknowable from the component alone. The visible symptom today is the old brand appearing on admin focus rings.

**Files.** `src/app/globals.css`, `tailwind.config.ts`, `src/components/layout-content.tsx`, `src/app/admin/sessions/[id]/session-detail.tsx`, `src/app/admin/dashboard.tsx`

**Depends on.** `qual-ci-gate-and-migration-replay`

**Acceptance criteria.**

- **Given** Any form control on /admin **when** It is focused by keyboard **then** The computed focus ring colour is the current brand token, and the built stylesheet contains none of the named old-palette pink hex literals in any ring, focus or focus-visible rule
- **Given** The repository as committed **when** It is scanned **then** The roughly 200-line !important override block is deleted, the old palette is removed from tailwind.config.ts with zero remaining references, and raw hex literals in components are zero or confined to a named allowlist in one tokens file
- **Given** Every screen after the consolidation **when** Rendered in light and dark **then** The visual result is unchanged apart from the corrected focus rings, checked against before-and-after screenshots of each route

**Tests.**

| Level | Name | Proves |
|---|---|---|
| unit | `src/lib/design-tokens.test.ts` | A scan of the built CSS finds no old-palette literal and no !important override block, and every component colour resolves to a token |
| manual-rehearsal | `docs/runbooks/rehearsal.md#S28-visual-diff` | The token consolidation changed nothing visible except the focus rings |

**Rollback.** Styling-only. Revert the commit. Land it separately from any layout change so a visual regression is attributable.

**Register entries absorbed.** 105

### `qual-typing-weaknesses` :: A silent admin-to-host role downgrade, a boolean-or-null control flag and a missing return type

**R2-next-cycle** | severity medium, likelihood unlikely | effort S | area quality | status **not started**

The host game page passes currentUserRole as profile?.role || 'host', so a failed profiles read silently downgrades an admin and removes the Void Winner control that is the documented only escape from an undo blocked by a winner on the last ball. canTakeControl is typed boolean or null and duplicates the server's 30 second heartbeat literal, and cn has no explicit return type. Done means the role prop is required and a failed profiles read fails the page render rather than defaulting, and the heartbeat timeout comes from one shared constant.

**Why this priority.** The register entry's headline claim about canTakeControl is refuted: every write to controlling_host_id also writes controller_last_seen_at, so the null-heartbeat state it misbehaves on is not reachable. The role downgrade is the item that stands, and it removes a money control at the moment the host needs it.

**Files.** `src/app/host/[sessionId]/[gameId]/page.tsx`, `src/app/host/[sessionId]/[gameId]/game-control.tsx`, `src/lib/utils.ts`, `src/app/host/actions.ts`

**Depends on.** `qual-ci-gate-and-migration-replay`

**Acceptance criteria.**

- **Given** An admin user whose profiles read fails on the host game page **when** The page renders **then** It fails or redirects with an explicit error rather than rendering with role 'host'; currentUserRole is a required prop with no default, so a silent downgrade cannot compile
- **Given** A real admin on the host game page **when** An undo is blocked by a winner on the last ball **then** The Void Winner control is present, because the role was read correctly; the documented escape route is available
- **Given** One exported CONTROLLER_HEARTBEAT_MS constant **when** The client computes canTakeControl and the server or SQL applies its heartbeat window **then** Both read the same value; a test asserts the client constant equals the value used in the RPC call and the value documented in the migration, so the 30-second literal exists once
- **Given** canTakeControl and cn **when** tsc --noEmit runs **then** canTakeControl is a plain boolean (no null third state) and cn has an explicit return type, with no new any introduced

**Tests.**

| Level | Name | Proves |
|---|---|---|
| unit | `src/lib/controller-heartbeat.test.ts` | One constant drives both sides of the heartbeat comparison, so client and server cannot disagree about who holds control |
| unit | `src/app/host/[sessionId]/[gameId]/page.test.ts` | A failed profiles read produces an error rather than a host-role render |

**Preflight (read-only, run against production before the change).**

```sql
select controller_last_seen_at, now() - controller_last_seen_at as age from public.game_states where controlling_host_id is not null order by 2 limit 10;
```

**Rollback.** Type and prop changes only. Revert the commit; no schema or data effect.

**Register entries absorbed.** 107

### `db-duplicate-game-states-insert-policy` :: Two overlapping INSERT policies on game_states, the narrower one dead

**R2-next-cycle** | severity low, likelihood unlikely | effort XS | area security | status **not started**

'Hosts can insert game state' (host only) and 'Hosts/Admins can insert game state' (admin or host) are both permissive INSERT policies on game_states, and permissive policies OR together, so the first grants nothing the second does not. Done means: pg_policies returns exactly one INSERT policy on game_states and the host start flow still inserts a game state successfully.

**Why this priority.** No exploit and no measurable cost at this data volume. It is on the list purely as an audit hazard: whoever later tightens the admin or host policy, which the game_states item above may well do, will believe they have closed host inserts while the older policy quietly keeps them open. Dropping it now is one line and removes a trap from the path of a change we are already planning.

**Files.** `supabase/migrations/20251221101436_fix_host_permissions.sql`, `supabase/migrations/20251221101438_add_game_states_public.sql`

**Acceptance criteria.**

- **Given** The migration applied **when** select count(*) from pg_policies where schemaname = 'public' and tablename = 'game_states' and cmd = 'INSERT' **then** it returns exactly 1, and that policy's with_check is the admin-or-host predicate
- **Given** A JWT with profiles.role 'host' **when** the host starts a game **then** a game_states row is inserted successfully: exactly one row exists for that game with status 'in_progress' and numbers_called_count 0
- **Given** A JWT with profiles.role 'admin' **when** it performs the inserts the app requires of an admin **then** they still succeed, so removing the narrower duplicate did not narrow admin access
- **Given** An anon key and a pending JWT **when** either attempts to insert into game_states **then** both are refused with 42501 and select count(*) from public.game_states is unchanged
- **Given** A full replay of every migration **when** supabase/tests/replay.test.sql runs **then** it asserts exactly one INSERT policy on game_states, so the dead policy cannot silently return in a future rebuild

**Tests.**

| Level | Name | Proves |
|---|---|---|
| sql-harness | `supabase/tests/game-states-write-scope.test.sql (shared with sec-game-states-update-unbounded)` | one INSERT policy remains, a host insert still succeeds and anon and pending are refused |
| sql-harness | `supabase/tests/replay.test.sql (policy-count assertion)` | a fresh build produces exactly one INSERT policy |
| manual-rehearsal | `Live-night rehearsal, 'start a game as host'` | the start flow is unaffected |

**Preflight (read-only, run against production before the change).**

```sql
select policyname, cmd, permissive, roles, qual, with_check from pg_policies where schemaname = 'public' and tablename = 'game_states' order by cmd, policyname;
```

**Rollback.** The migration records the dropped policy's CREATE POLICY statement in its ROLLBACK comment. Because permissive policies OR together, recreating it changes nothing functionally in either direction.

**Register entries absorbed.** 92, 112

### `sec-login-next-backslash` :: The login redirect sanitiser misses a backslash, so a phished link breaks the sign-in

**R2-next-cycle** | severity low, likelihood unlikely | effort XS | area security | status **not started**

sanitizeNextUrl rejects values not starting with a slash and values starting with a double slash but not '/\', which WHATWG URL parsing treats as a foreign origin. Done means: any next value whose second character is a slash or a backslash resolves to '/', proven by a unit test, ideally replaced by an allowlist of the three prefixes the middleware actually sets.

**Why this priority.** This is not an open redirect. Next's own relative URL parsing rejects the crafted value, so the worst outcome is that a phished member of staff signs in successfully and then the page throws instead of navigating. The defect is that the sanitiser written specifically to prevent this does not catch the case, which is a one character class fix and belongs in the same auth sweep. Nothing on a pub night depends on it.

**Files.** `src/app/login/actions.ts`, `src/app/login/page.tsx`

**Acceptance criteria.**

- **Given** sanitizeNextUrl extracted into src/lib/next-url.ts so it is importable by the node --test harness (assumed default: replace the prefix checks with an allowlist of the three prefixes the middleware actually sets) **when** it is called with '/\\evil.com', '/\\/evil.com', '//evil.com', '\\\\evil.com', 'https://evil.com', 'javascript:alert(1)', '' and null **then** every one of those returns '/'
- **Given** The same function **when** it is called with '/', '/admin', '/admin/snowball', '/host' and '/host/<uuid>/<uuid>' **then** each is returned unchanged, so the real post-login destinations still work
- **Given** The allowlist form of the fix **when** it is called with any value that is not '/' and does not begin '/admin' or '/host' **then** it returns '/', which is asserted by a property-style case list rather than by enumerating attack strings alone
- **Given** A signed-out user opening /login?next=/%5Cevil.com **when** they sign in with valid credentials **then** the browser lands on the application origin at '/', never on a foreign origin (assert the final URL's origin equals the app origin), and the sign-in itself still succeeded: the account has a live session
- **Given** A signed-out user opening /login?next=%2Fhost **when** they sign in as a host **then** they land on /host with the host dashboard rendered

**Tests.**

| Level | Name | Proves |
|---|---|---|
| unit | `src/lib/next-url.test.ts (node --test, picked up by the existing npm test glob over src/lib/*.test.ts)` | the backslash, double-slash, scheme and empty cases all collapse to '/', and the three legitimate prefixes survive |
| manual-rehearsal | `Live-night rehearsal, 'open a crafted login link, sign in, confirm the landing page'` | the WHATWG URL parsing behaviour in a real browser matches the unit test's expectation |

**Rollback.** Single-commit revert of src/lib/next-url.ts and src/app/login/actions.ts; no schema or data change.

**Register entries absorbed.** 93

### `sec-profiles-readable-by-every-account` :: Every authenticated account can read the whole staff roster and who is admin

**R2-next-cycle** | severity low, likelihood possible | effort XS | area security | status **not started**

'Authenticated users can view profiles' is to authenticated using (true) over a table holding id, email and role, while every call site in src/ reads only the caller's own row. Done means: the policy reads using (auth.uid() = id or the caller is admin), a non admin JWT selecting from /rest/v1/profiles returns exactly one row, and the admin screens still load.

**Why this priority.** One address is exposed today, so on its own this is minor. It matters as the follow on to the signup hole and to the pending tier: any account that gets through, including a pending one under a broad authenticated policy, gets a ready made target list of staff emails with the admin flagged, which is worth having when leaked password protection is off in the project's Auth settings. Every authorizeHost and authorizeAdmin already filters on the caller's own id, so narrowing the policy breaks nothing. Worth doing in the same auth sweep as the pending role rather than on its own.

**Files.** `supabase/migrations/20260430124552_tighten_profiles_select.sql`

**Depends on.** `sec-signup-grants-host-role`

**Acceptance criteria.**

- **Given** The migration applied **when** select qual from pg_policies where schemaname = 'public' and tablename = 'profiles' and cmd = 'SELECT' **then** the predicate references auth.uid() = id or an admin role check, and is not the literal true
- **Given** A JWT with profiles.role 'host' **when** it requests GET /rest/v1/profiles?select=id,email,role **then** it receives exactly 1 row, its own; a request filtered to another user's id returns 0 rows (an empty array, not a 403 that would confirm the id exists)
- **Given** A JWT with profiles.role 'admin' **when** it makes the same request **then** the row count equals select count(*) from public.profiles, and the /admin screens that list staff render the full roster
- **Given** A JWT with profiles.role 'pending' **when** it makes the same request **then** it receives exactly 1 row, its own, with role 'pending' and no other account's email
- **Given** The new policy in place **when** every call site in src/ that reads profiles runs (/host, /host/[sessionId]/[gameId], /admin, /admin/history, the host and admin authorisation helpers) **then** each still resolves the caller's own role: no page falls into its 'profile not found' branch and no host or admin action returns unauthorized for a correctly-roled account
- **Given** A policy that references the same table for the admin check **when** any role selects from profiles **then** the query completes without error 42P17 (infinite recursion), which is proven by an explicit harness assertion because a naive admin sub-select on profiles causes exactly that

**Tests.**

| Level | Name | Proves |
|---|---|---|
| sql-harness | `supabase/tests/profiles-select-scope.test.sql` | own-row visibility for host and pending, full visibility for admin, zero rows for another user's id, and no recursion error |
| integration | `supabase/tests/jwt/profiles-postgrest.test.mjs` | real JWT row counts through PostgREST match the policy intent for anon, pending, host and admin |
| manual-rehearsal | `Live-night rehearsal, 'load /host and every /admin screen as host and as admin'` | no screen regressed to an unauthorised or empty state |

**Preflight (read-only, run against production before the change).**

```sql
select policyname, cmd, qual, with_check from pg_policies where schemaname = 'public' and tablename = 'profiles' order by cmd, policyname; select count(*) as profile_rows from public.profiles; select role, count(*) from public.profiles group by 1 order by 1;
```

**Rollback.** The migration records the previous using (true) policy in its ROLLBACK comment; restoring it is one statement with no data change. The risk of a bad apply is an admin screen showing an empty roster, which the acceptance criteria detect before release.

**Register entries absorbed.** 94

### `admin-list-queries-unbounded` :: Admin list pages fetch every row ever with no limit or pagination

**R3-backlog** | severity low, likelihood unlikely | effort XS | area money | status **not started**

/admin/history selects all winners, /admin/backup selects every game with its full 90-integer number_sequence and no session filter, and /admin lists all sessions, none using .range() or .limit(), against an 8s statement timeout and a PostgREST max-rows setting that truncates silently rather than erroring. Done when each page requests a bounded range and shows the total count so truncation can never be silent.

**Why this priority.** Live counts are 6 sessions, 60 games and 87 winners, so nothing bites today and the projected timeline is over a year out. The risk is that truncation, when it eventually arrives, looks like missing data rather than an error. Best handled alongside the backup page rework, which is where the heaviest query lives.

**Files.** `src/app/admin/history/page.tsx`, `src/app/admin/backup/page.tsx`, `src/app/admin/page.tsx`

**Depends on.** `admin-backup-export-unfit`

**Acceptance criteria.**

- **Given** winners holds 5000 rows. **when** An admin loads /admin/history. **then** At most 100 winner rows are fetched, the page shows 'Showing 1-100 of 5000' from an exact count, and a Next control loads rows 101-200. The request completes without hitting the 8s statement timeout.
- **Given** The same page. **when** The issued SQL is inspected. **then** The winners query carries LIMIT 100 with an offset and an ORDER BY created_at desc. No query anywhere on the page returns more than 100 winners rows.
- **Given** /admin/backup with session S chosen. **when** The page loads. **then** The games query carries eq('session_id', S) and a bounded range; number_sequence is fetched only for S's games, never for every game ever.
- **Given** /admin listing sessions. **when** The page loads. **then** The sessions query carries a bounded range and an exact count; the displayed total equals select count(*) from sessions.
- **Given** A range request larger than the PostgREST max-rows setting. **when** The page renders. **then** The fetched count and the total count are shown separately, so a truncated page is visibly incomplete rather than silently short.

**Tests.**

| Level | Name | Proves |
|---|---|---|
| integration | `src/app/admin/history/page.test.ts` | The winners query builder is called with .range() and count:'exact', and the backup page's games query carries a session filter. |
| unit | `src/lib/pagination.test.ts` | Page/offset arithmetic and the 'Showing X-Y of Z' string are correct at the first page, a middle page, the last partial page and an empty result. |
| manual-rehearsal | `rehearsal/large-history.md` | With 5000 seeded winners in a throwaway project, /admin/history loads in under three seconds and reports the correct total. |

**Preflight (read-only, run against production before the change).**

```sql
select (select count(*) from winners) as winners, (select count(*) from sessions) as sessions, (select count(*) from games) as games, (select count(*) from snowball_pot_history) as pot_history;
```

**Rollback.** Remove the .range() and count arguments. Read-only change; no data risk in either direction.

**Register entries absorbed.** 82

### `money-pot-form-falsy-defaults` :: The pot form silently resets a stored increment of 0 to the default on the next save

**R3-backlog** | severity low, likelihood unlikely | effort XS | area money | status **not started**

Every numeric field uses defaultValue={editingPot?.X || default}, which treats a stored 0 as absent, so a pot deliberately configured with calls_increment = 0 is rewritten to 2 the next time an admin opens and saves it. Done when the form uses ?? for every default, and saving an untouched pot with calls_increment 0 leaves snowball_pots.calls_increment at 0.

**Why this priority.** Narrower than it first looks: the money columns arrive over the wire as strings such as "20.00" so they are accidentally safe, and the max-calls fields cannot hold 0 given the min of 1, leaving calls_increment as the only exposed field. Nobody currently configures a pot with a zero call increment. A one-character fix to keep for the next time the form is touched.

**Files.** `src/app/admin/snowball/snowball-list.tsx`

**Acceptance criteria.**

- **Given** Pot P stored with calls_increment = 0 and jackpot_increment = 0. **when** An admin opens the Edit form for P. **then** Both fields display 0, not the hard-coded defaults.
- **Given** The same form. **when** The admin saves without touching any field. **then** In the database: select calls_increment, jackpot_increment from snowball_pots where id = P are both still 0; no snowball_pot_history row is written because no current figure changed.
- **Given** Pot P stored with base_jackpot_amount = 0. **when** The form is opened and saved untouched. **then** base_jackpot_amount is still 0.
- **Given** An admin creating a brand-new pot with the form untouched. **when** Saved. **then** The persisted row matches exactly the values the form displayed, and those values are the documented defaults.
- **Given** The pot form source. **when** A lint or grep test inspects every numeric defaultValue. **then** None uses the || operator for its default; every one uses ?? so a stored 0 survives.

**Tests.**

| Level | Name | Proves |
|---|---|---|
| unit | `src/app/admin/snowball/pot-form.test.tsx` | A pot fixture with zeros renders zeros in every numeric field, and a null pot renders the documented defaults. |
| integration | `src/app/admin/snowball/actions.test.ts` | An untouched save of a zero-increment pot sends 0 to the RPC, not the default. |
| unit | `scripts/no-falsy-defaults.test.ts` | No numeric defaultValue in the pot form uses ||. |

**Preflight (read-only, run against production before the change).**

```sql
select id, name, base_max_calls, base_jackpot_amount, calls_increment, jackpot_increment, current_max_calls, current_jackpot_amount from snowball_pots where calls_increment = 0 or jackpot_increment = 0 or base_jackpot_amount = 0;
```

**Rollback.** Revert the ?? operators to ||. UI-only. Any pot whose increment was silently rewritten under the old behaviour is listed by the preflight query and must be corrected by an admin.

**Register entries absorbed.** 133

### `qual-build-config-gaps` :: next.config.ts is empty, autoprefixer duplicates Lightning CSS, and browserslist data is stale

**R3-backlog** | severity low, likelihood possible | effort S | area quality | status **not started**

next.config.ts contains only the scaffold comment, so there are no typed routes and roughly twenty hand-written route strings including revalidatePath targets are unchecked. postcss.config.mjs runs autoprefixer alongside the Tailwind v4 pipeline that already prefixes, against caniuse data eight months old. Done means typed routes are on and whatever they surface is fixed, the browserslist data is refreshed, and the redundant autoprefixer step is dropped.

**Why this priority.** The severity in the register is over-called: an empty next.config.ts is the Next default. The one real consequence is that a mistyped path in revalidatePath silently revalidates nothing, which shows up as a stale admin screen rather than an error. The typecheck script it also asked for already landed at adcce5d.

**Files.** `next.config.ts`, `postcss.config.mjs`, `package.json`

**Depends on.** `qual-ci-gate-and-migration-replay`

**Acceptance criteria.**

- **Given** next.config.ts with typed routes enabled **when** npm run typecheck runs **then** It passes with every hand-written route string, including the revalidatePath targets, type-checked; a deliberately mistyped route in a scratch commit fails the check, proving the guard is live
- **Given** The browserslist data **when** npm run build runs **then** No caniuse-lite outdated warning is emitted, and the refreshed data is committed in the lockfile
- **Given** postcss.config.mjs with autoprefixer removed **when** The stylesheet is built **then** The prefixed properties for the target browser set are unchanged from the previous build (diffed), and the build passes, proving the Tailwind v4 pipeline already covers it

**Tests.**

| Level | Name | Proves |
|---|---|---|
| unit | `src/lib/route-strings.test.ts` | Typed routes cover the revalidatePath call sites, which are the strings a typo would silently break |
| integration | `.github/workflows/ci.yml build job` | The build is clean with no browserslist warning and no duplicate prefixing step |

**Rollback.** Build configuration only. Revert the commit; if typed routes surface a large number of fixes, land those fixes first and enable the flag in a follow-up so the revert stays small.

**Register entries absorbed.** 97

### `qual-dead-exports-and-scaffolding` :: Dead exported server actions, dead component variants and no-op CSS classes

**R3-backlog** | severity low, likelihood possible | effort S | area quality | status **not started**

Two use server exports have no caller, which means Next publishes a POST endpoint for each with no UI route to them, and one of them, voidWinner, is the copy that correctly follows the prove-the-write rule. Four sites apply a shadcn token defined nowhere in this project, and two UI primitives carry authoring commentary. Done means no exported server action is unreachable from the UI, and no rendered class resolves to nothing.

**Why this priority.** Individually harmless, collectively they make the codebase read as unfinished. The sharp edge is that the dead voidWinner is the good pattern and the live host path is the one that needs fixing, so the next reader learns the wrong lesson from the wrong file.

**Files.** `src/app/login/actions.ts`, `src/app/admin/sessions/[id]/actions.ts`, `src/components/ui/button.tsx`, `src/components/ui/bingo-ball.tsx`, `src/app/admin/sessions/[id]/session-detail.tsx`

**Depends on.** `qual-ci-gate-and-migration-replay`

**Acceptance criteria.**

- **Given** The repository as committed **when** Every 'use server' export is cross-referenced against its imports **then** No exported server action is unreachable from a component or route, so Next publishes no POST endpoint with no UI route to it; the two current orphans are wired up or deleted
- **Given** voidWinner, the orphan that correctly follows the prove-the-write rule **when** The duplication is resolved **then** Whichever implementation survives carries the .select() proof, and a test asserts that a zero-row void returns an error rather than success
- **Given** The rendered markup **when** Class names are resolved against the built CSS **then** The four shadcn-token sites either use a token defined in this project or are removed; no rendered class resolves to nothing

**Tests.**

| Level | Name | Proves |
|---|---|---|
| unit | `src/lib/dead-exports.test.ts` | Every server action is reachable from the UI, so an unreferenced POST endpoint fails the build |
| sql-harness | `supabase/tests/host-flow.test.sql (void winner)` | A void that matches zero rows under RLS is reported as a failure, not a success |

**Preflight (read-only, run against production before the change).**

```sql
select count(*) filter (where is_void) as voided, count(*) as total from public.winners;
```

**Rollback.** Deleting an unreachable export is safe once the reachability test passes. Revert the commit if a caller is discovered; the test would have caught it first.

**Register entries absorbed.** 99

### `qual-dead-styling-assets` :: Every entrance animation class is dead and Geist Sans is downloaded but never applied

**R3-backlog** | severity low, likelihood certain | effort XS | area quality | status **not started**

Thirty animation class usages compile to nothing, verified absent from the built stylesheet with no animate plugin in package.json and no keyframes in the config, so the win overlay and every modal hard-cut rather than fade. Geist Sans is configured, preloaded and mapped to font-sans, while globals.css sets an unlayered body font of Arial, so the whole app renders in Arial and the font file is fetched for nothing. Done means the built CSS either defines the animations or contains none of the dead class names, and the font that is downloaded is the font that renders.

**Why this priority.** The intent is invisible in review because the class names read as though they work, and every punter on pub wifi pays for a font file that never renders.

**Files.** `src/components/ui/modal.tsx`, `src/components/ui/bingo-ball.tsx`, `src/app/display/[sessionId]/display-ui.tsx`, `src/app/layout.tsx`, `src/app/globals.css`

**Depends on.** `qual-ci-gate-and-migration-replay`

**Acceptance criteria.**

- **Given** The production build output **when** The class names used in src are extracted and diffed against the built stylesheet **then** Either every animation class used in src has a matching keyframe or utility in the built CSS, or none of those thirty class names appear in src at all; no class is rendered that resolves to nothing
- **Given** Any page in the built app **when** It loads **then** The computed font-family on body resolves to the Geist Sans variable, or Geist is removed from the app entirely and no font file is requested (asserted from the network list), so the font downloaded is the font that renders
- **Given** The win overlay and the modals **when** They open with prefers-reduced-motion not set **then** They either animate as intended or are deliberately instant, matching the documented decision rather than hard-cutting by accident

**Tests.**

| Level | Name | Proves |
|---|---|---|
| unit | `src/lib/dead-css.test.ts` | No rendered class name is absent from the built stylesheet, and no font is preloaded that the CSS never applies |

**Rollback.** Styling and asset configuration only. Revert the commit.

**Register entries absorbed.** 151, 152

### `qual-no-display-audio` :: The display has no audio, though the PRD lists Win, Break and Start sounds as in scope for v1

**R3-backlog** | severity low, likelihood possible | effort S | area quality | status **not started**

PRD section 3.1 lists sound effects for the display client as in scope, and there is no Audio element, no audio tag and no sound asset anywhere in the project. The CLAUDE.md note about no audio is specifically about number announcements, which is a different thing. Done means either three bundled sounds fire off the display_win_type, on_break and game start transitions behind a mute toggle persisted on the TV device, or the line is struck from the PRD.

**Why this priority.** A full house landing during the loudest part of a Friday flips a silent overlay, so half the room facing the bar keeps marking and the host has to shout over them, which is exactly when a late claim becomes contentious under the pub's own house rule.

**Files.** `src/app/display/[sessionId]/display-ui.tsx`, `docs/PRD.md`

**Depends on.** `qual-ci-gate-and-migration-replay`

**Blocked on a decision.** Build the three sounds, or strike them from PRD 3.1? Recommendation: strike them, because the host already calls the room to attention verbally and an unattended TV that makes noise is harder to live with than one that does not.

**Acceptance criteria.**

- **Given** Decision assumed: the sound-effects line is struck from the PRD, because no audio asset or player exists and the TV runs unattended where an unexpected sound is a liability **when** PRD section 3.1 is reviewed **then** The sound-effects requirement is marked retired with a date and the reason, and the CLAUDE.md note is clarified to distinguish number announcements (never in scope) from effect sounds (retired)
- **Given** If instead the three sounds are built **when** display_win_type changes, on_break becomes true, or a game starts **then** Exactly one sound plays per transition, keyed on the state_version change rather than on each poll (a repeated poll of the same row plays nothing), and no sound plays for a payload discarded as stale
- **Given** If built: the TV device **when** A mute toggle is set and the page is reloaded **then** The setting persists in localStorage on that device, the default is muted until a user gesture unlocks audio (browser autoplay policy), and the mute state is visible on screen

**Tests.**

| Level | Name | Proves |
|---|---|---|
| unit | `src/lib/display-audio.test.ts` | If built, one sound fires per state_version transition and none for a repeated or stale payload |
| manual-rehearsal | `docs/runbooks/rehearsal.md#S29-tv-audio` | If built, the TV's audio unlocks after a gesture and the mute setting survives an overnight reload |

**Rollback.** If struck, documentation only. If built, ship behind the mute default so rollback is leaving it muted, then removing the assets.

**Register entries absorbed.** 110

### `qual-offline-capability-unbuilt` :: The PRD's headline resilience requirement is entirely unbuilt

**R3-backlog** | severity low, likelihood likely | effort XL | area quality | status **not started**

FR-47 host local caching, FR-48 reconnect resolution and the success criterion about the host continuing to call through a wifi drop have no implementation of any kind. Every host action is a synchronous round trip and nothing is queued, cached or replayed. Done means either a queued call path whose replay is safe because call_next_number carries an idempotency key and produces exactly one new entry in game_states.called_numbers per intended call, or FR-47 and FR-48 struck from the PRD in writing.

**Why this priority.** Leaving a documented success criterion silently unbuilt means nobody knows the app cannot do the thing the PRD promises until the wifi drops on a Friday. Stopping the offline reload removes the acute damage, so this becomes a scope decision rather than an emergency.

**Priority changed by the merge pass.** Lowered from R2/medium. The harmful half of this finding, the auto-reload that destroys the screen precisely when the network is down, is fixed in block 7 and is now R0 in its own right. What remains is a PRD decision, and the area's own recommendation is to strike FR-47 and FR-48 rather than build a queued call path, because replaying a queued call against a database that is the sole authority on the ball bag is a hard correctness problem for a feature nobody has asked for. Backlog it behind the written decision.

**Files.** `src/app/host/[sessionId]/[gameId]/game-control.tsx`, `src/app/host/actions.ts`, `docs/PRD.md`, `next.config.ts`

**Depends on.** `qual-ci-gate-and-migration-replay`, `qual-offline-auto-reload-kills-every-screen`

**Blocked on a decision.** Build the offline queue, or strike FR-47 and FR-48 and tell the host the app needs connectivity? Recommendation: strike them for now, because a queued call replayed against a database that is the sole authority on the ball bag is a hard correctness problem and the immediate harm is fixed by stopping the auto-reload.

**Acceptance criteria.**

- **Given** Decision assumed: FR-47 and FR-48 are struck from the PRD, because client-side call authority conflicts with the database-as-referee design that everything else depends on **when** The PRD is reviewed **then** FR-47 and FR-48 are marked retired with a date and the reason, and docs/runbooks/outage.md describes the manual fallback (call from the paper sequence, record afterwards) with the steps to re-enter the night once the network returns
- **Given** A host device with no network **when** They tap Call Next Number **then** It fails visibly with a message saying calls are paused until the connection returns; no local queue exists, and when the network returns game_states.called_numbers contains exactly the balls the server drew, none duplicated and none invented
- **Given** If instead the queued-call path is built rather than struck **when** A queue of three calls is replayed after reconnection, including a replay of one that already committed **then** call_next_number is idempotent on the per-call key: game_states.called_numbers grows by exactly one entry per intended call, and the replayed duplicate returns the current state without drawing a fourth ball

**Tests.**

| Level | Name | Proves |
|---|---|---|
| sql-harness | `supabase/tests/call-idempotency.test.sql` | Whichever branch is chosen, a repeated call with the same key draws exactly one ball, which is the precondition for any queued replay |
| manual-rehearsal | `docs/runbooks/outage.md#rehearsal` | A host can run the manual fallback for ten minutes of outage and re-enter the night correctly |

**Rollback.** If the decision is to strike, the change is documentation only and needs no rollback. If the queued path is ever built, it lands behind a flag defaulting off, and rollback is turning the flag off.

**Register entries absorbed.** 7

### `db-display-winner-name-dead-column` :: display_winner_name is rendered on both public screens but every write path sets it to null

**R3-backlog** | severity low, likelihood unlikely | effort XS | area security | status **not started**

All nine writes in src/app/host/actions.ts and the final update inside record_winner_atomic set display_winner_name to null, yet the display and player pages both select it and render a prominent heading when it is truthy, so the block can never appear. Done means: the reads and the column are gone from the select lists and the UIs, or the column is dropped from both game_states and game_states_public once the reads are removed.

**Why this priority.** Nothing misbehaves. The cost is that the column reads as a supported feature to the next person while sitting directly against the documented policy that winners are anonymous and no player identifying data is stored, so the obvious next step for somebody tidying it up is to wire it to a real name, which would satisfy the type system and the schema while breaking the policy. Removing the reads closes that door for the price of a few lines.

**Files.** `src/app/host/actions.ts`, `src/app/display/[sessionId]/display-ui.tsx`, `src/app/player/[sessionId]/player-ui.tsx`

**Acceptance criteria.**

- **Given** The change applied (assumed default: remove the reads and the UI block now, and leave the column in place, because dropping a column requires explicit approval under the project rules) **when** the repo is searched for display_winner_name **then** it appears in no select list, no type read and no JSX under src/app/display or src/app/player
- **Given** A recorded win on a live game **when** the display and player pages render **then** the win block shows display_win_type and display_win_text exactly as before, with no empty heading and no layout gap where the removed block was, and the database is unchanged by the render
- **Given** The column left in place **when** a full host flow runs from start to end of session **then** select count(*) from public.game_states where display_winner_name is not null returns 0 and the same for public.game_states_public, confirming no write path sets it
- **Given** The alternative decision is later approved (drop the column) **when** the drop migration is applied **then** the column is gone from both public.game_states and public.game_states_public, sync_game_states_public() is updated in the same migration so it no longer references it, and a fresh replay leaves no function or trigger referencing the dropped name
- **Given** Either path **when** bash supabase/tests/run.sh runs and the display and player pages are loaded **then** run.sh exits 0 and both public screens render the live board and the win block

**Tests.**

| Level | Name | Proves |
|---|---|---|
| sql-harness | `supabase/tests/replay.test.sql (assert display_winner_name is either absent from both tables or referenced by no function or trigger)` | whichever decision is taken, no function or trigger is left pointing at infrastructure that changed |
| manual-rehearsal | `Live-night rehearsal, 'record a line win and look at the TV and a phone'` | the public screens still show the win clearly with the dead block removed |
| unit | `npm test (existing suite) after the select lists change` | no helper depended on the removed field |

**Preflight (read-only, run against production before the change).**

```sql
select count(*) as non_null_rows from public.game_states where display_winner_name is not null; select count(*) as non_null_public_rows from public.game_states_public where display_winner_name is not null; select routine_name from information_schema.routines where routine_schema = 'public' and routine_definition ilike '%display_winner_name%';
```

**Rollback.** Restoring the reads is a single-commit revert of the select lists and the two page components. If the column is later dropped, that migration must record the column definition and the previous sync_game_states_public() body in its ROLLBACK comment, and the drop needs explicit approval before it is applied.

**Register entries absorbed.** 114

### `db-stale-migration-filename-refs` :: Comments still cite a migration filename that the July reconciliation removed

**R3-backlog** | severity low, likelihood certain | effort XS | area security | status **not started**

src/types/database.ts:346 and docs/architecture/overview.md:94 both cite 20260730120000, and the same stale version is baked into the live column comment on winners.client_request_id via the COMMENT ON COLUMN text inside the applied migration, while the real files are 20260730064309 and 20260730065531. Done means: both repo references name the real filenames, and a new comment migration corrects the live column comment rather than editing applied history.

**Why this priority.** Documentation accuracy only, no behaviour affected. It matters slightly more than a normal stale comment because the repo and production migration histories were reconciled one to one in July and have to stay that way, so anybody auditing which migration introduced client_request_id follows the comment to a file that does not exist and cannot tell whether the migration was lost or renamed.

**Files.** `src/types/database.ts`, `docs/architecture/overview.md`, `supabase/migrations/20260730064309_winner_idempotency_key.sql`

**Acceptance criteria.**

- **Given** The repo after the change **when** the repo is searched for the string 20260730120000 **then** it returns zero results, and src/types/database.ts and docs/architecture/overview.md name the real filenames 20260730064309_winner_idempotency_key.sql and 20260730065531_atomic_snowball_settlement.sql
- **Given** A new comment-only migration (applied history is never edited) **when** it runs against production **then** select col_description('public.winners'::regclass, a.attnum) for client_request_id returns text naming the real filenames and containing no '20260730120000' substring
- **Given** The correction delivered as a new file **when** git diff is inspected for supabase/migrations **then** only the new file appears: no previously applied migration file is modified, and select count(*) from supabase_migrations.schema_migrations where version = '20260730120000' returns 0 both before and after
- **Given** A fresh replay of every migration into an empty database **when** supabase/tests/replay.test.sql runs **then** it asserts the winners.client_request_id column comment matches the corrected text, so a rebuild reproduces what production holds
- **Given** The change is documentation only **when** npm test, npm run lint, npx tsc --noEmit and npm run build run **then** all four pass and no runtime behaviour changes

**Tests.**

| Level | Name | Proves |
|---|---|---|
| sql-harness | `supabase/tests/replay.test.sql (assertion on the winners.client_request_id column comment)` | the live comment and a fresh rebuild agree, and the stale version string is gone from the database as well as the repo |
| manual-rehearsal | `Release checklist step 'grep the repo for retired migration versions'` | a human check that no other stale filename reference survives the July reconciliation |

**Preflight (read-only, run against production before the change).**

```sql
select col_description('public.winners'::regclass, a.attnum) as client_request_id_comment from pg_attribute a where a.attrelid = 'public.winners'::regclass and a.attname = 'client_request_id'; select version from supabase_migrations.schema_migrations where version in ('20260730120000','20260730064309','20260730065531');
```

**Rollback.** The comment migration records the previous COMMENT ON COLUMN text in its ROLLBACK comment; re-running that one statement restores it. The repo-side edits are a single-commit revert. Nothing executable changes.

**Register entries absorbed.** 118

---

## Register entries not carried into the backlog

| # | Disposition | Why |
|---|---|---|
| 112 | accepted-risk | This entry states no defect. The unindexed foreign keys and the auth_rls_initplan advisories are accepted at this data volume: the largest table is 87 rows and the whole database is under 16 MB, so the scans being warned about are sub millisecond. Revisit if winners passes a few thousand rows. Its one actionable observation, the duplicate INSERT policy on game_states, is carried by register 92. |

Every other register entry maps to a canonical item above, either directly or as a merged
duplicate. Nothing was dropped without a line here.