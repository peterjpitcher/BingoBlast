# Implementation plan and progress

**Branch:** `fix/review-remediation`, cut from `main` at `2fc21d3`
**Updated:** 25 August 2026

The work list itself is [BACKLOG.md](BACKLOG.md). This is the plan for executing it: what order,
what is done, what is next, and what is blocked.

---

## Ground rules

1. **One concern per commit**, each with a message that says what was wrong, not just what changed.
2. **`npm run verify` (lint, typecheck, test, build) passes before every commit.** No commit lands
   red.
3. **No migration is applied to production by me.** Every migration is written, reviewed and
   replayed in CI. Applying to production is a separate, deliberate act and needs the owner's word.
4. **Application first, or together, never database first.** Every database change here narrows
   something the running application currently relies on.
5. **Where a business decision is genuinely open, the code is not written.** Guessing at a payout
   rule is worse than leaving it. Those items are listed under Blocked below.

---

## Status summary

| Block | What | State |
|---|---|---|
| 0 | CI and the full migration replay | Committed. **Never yet run**, because it needs a push |
| 1 | Security: signup, roles, direct-insert route | Committed |
| 2 | Live-night correctness: silent failures, retries, screens | Committed |
| 3 | Money integrity: pot archive, atomic edits, session reset | Committed |
| 4 | The record: void display, London dates, pot history on screen | Committed |
| 5 | Remaining R0: forced jackpot, settlement retry, call idempotency, claim entry | **Next** |
| 6 | Narrowing the table-wide host grants | Not started, needs replacement RPCs first |
| 7 | Export, audit ledger, error monitoring | Blocked on Q7, Q9, Q16 |
| 8 | Prize and tie accounting | Blocked on Q6 |
| 9 | Accessibility and performance criteria | Blocked on Q10, Q17 |
| 10 | Dependency upgrade | Not started, deliberately its own changeset |
| 11 | Refactor | Not started, and should not start until the tests in block 5 exist |

---

## Done

Every item below is committed on `fix/review-remediation` and passes lint, typecheck, 95 tests and
the production build.

### Block 0: `ci: add CI, a full migration replay suite, and the missing npm scripts`

- `.github/workflows/ci.yml`. There was no CI at all. Three jobs: lint/typecheck/test/build, the
  Postgres harness, and an advisory dependency audit.
- `supabase/tests/supabase-bootstrap.sql`, reproducing a fresh Supabase project including the
  production default privileges for **both** default-ACL owners. Without both, the container is
  friendlier than production and every grant assertion passes for the wrong reason.
- `supabase/tests/replay.test.sql` and SUITE D: all migrations replayed in order, twice, with the
  end state asserted object by object and grant by grant against production. 31 assertions.
- `npm run typecheck`, `npm run test:db`, `npm run verify`.

**Not yet proven.** Docker is unavailable locally, so this has never executed. The first push is the
first run. Making the CI required is gate 1 in [RELEASE-GATE.md](RELEASE-GATE.md).

### Block 1: `fix(auth): stop new accounts landing as staff...` and `fix(auth): authorise at the route...`

- `pending` role, `handle_new_user` inserts it, column default changed, profile self-insert policy
  pinned so a missing profile row cannot be recreated as `admin`.
- `winners` INSERT policy dropped. `record_winner_atomic` is `security definer` owned by `postgres`,
  which holds `rolbypassrls` and owns the table, and the table has no `FORCE ROW LEVEL SECURITY`, so
  the host flow keeps working with no policy at all.
- Middleware and both host pages name the roles they accept. Middleware redirects now carry the
  refreshed auth cookies, which is what was logging staff out mid-shift.
- New `/pending` screen.

### Block 2: `fix(host): three live-night faults...`, `fix(host): make every control fail visibly...`, `fix(public): stop the pub TV dead-ending...`

- Winner lists refresh explicitly after every mutation and when opened. The dead Realtime
  subscriptions are removed rather than left looking functional.
- The snowball pot loader keeps its error, logs it, retries with backoff, re-checks on visibility,
  and distinguishes "no pot" from "could not load". Recording a snowball Full House is refused while
  the pot is unknown.
- The 30 second auto-reload requires `navigator.onLine` and requires the surface to say it is not
  holding a modal, a part-tapped claim or an in-flight request.
- Every host handler has a `catch`, and the wording says whether retrying is safe. Checking a claim
  writes nothing so retry freely; undoing a ball is not idempotent so the message says reload first.
- `advanceToNextStage` and `skipStage` take an expected stage index and treat a repeat as a no-op.
  "Continue and Take Break" is one call rather than two.
- A transient read failure renders the recoverable shell instead of a static 404.
- The player screen's four white-on-pale-colour text runs each have a background of their own.

### Block 3: `fix(money): stop pot edits losing their audit trail...` and `fix(admin): a session reset now keeps a record...`

- `archive_snowball_pot` replaces the three-statement delete that destroyed the audit trail and
  usually failed halfway. Pots are archived, never deleted.
- `update_snowball_pot_safe` and `reset_snowball_pot_safe`: pot and audit row in one transaction,
  returning the persisted row. An audit row is only written when the current figures actually move.
- `reset_session_safe` records everything it destroys in an append-only `session_reset_log`, and
  refuses when the session has already settled the pot.
- Constraints: pot windows within 1 to 90, amounts non-negative, one `game_index` per session.
- The two money buttons use typed confirmation instead of `window.confirm()`.

### Block 4: `fix(admin): show voided wins as voided...` and `feat(admin): let an admin void a winner...`

- Winner History carries a Status column: VOID with the reason, PRIZE GIVEN, or not handed over.
- `src/lib/dates.ts` plus tests. Every user-facing date is Europe/London and en-GB, and a bare
  `date` column is not timezone-shifted.
- `/admin/snowball` displays the pot history it has been writing and nobody could read.
- `voidWinner` is wired into the session screen, so a night can be corrected the morning after.
- `feat(host): add the Resume and End Game controls the pad was missing`: Resume existed only inside
  a modal that "Close and stay paused" closed, and there was no way to end a game without a winner,
  which is what stranded the snowball pot on an abandoned game.

---

## Next: block 5, the remaining R0 items

In order, each its own commit.

1. **`money-force-jackpot-ungated`.** `record_winner_atomic` awards the jackpot when
   `p_force_snowball_jackpot` is true, with no window check at all, and the Manual Snowball Win
   button sets it for any host at any call count. Gate it and record that it was used.
2. **`money-snowball-tie-double-jackpot`.** Two tied Full House winners each record a full jackpot
   against a pot that pays once and resets once. The safe half of this is fixable without Q6: refuse
   to mark a second jackpot winner on the same game. How the cash is split is Q6 and stays open.
3. **`money-settlement-failure-no-retry`.** Every route to settlement is gated on a status the game
   has already left, so a failure is terminal. Give it a route back.
4. **`qual-completion-paths-report-false-success`.** `endGame` tells the host the game ended even
   when the pot demonstrably did not move.
5. **`live-mutation-protocol`.** `callNextNumber` is still not idempotent while its own error copy
   tells the host to retry. This is the last of the mutation protocol.
6. **`qual-claim-entry-unsafe-on-a-phone`.** 27px targets, no textual read-back of what was tapped,
   and called and uncalled numbers differing only by text opacity, on the screen where a mis-tap
   pays the wrong person.
7. **`qual-money-and-live-path-test-coverage`.** The tests that would have caught the above.

---

## Blocked, and on what

Not started deliberately. Building these on a guess would be worse than leaving them.

| Item | Blocked on |
|---|---|
| Prize amounts, tie splitting, prize correction after start | Q6 |
| Staff invite, promote, disable, password reset | Q1 |
| Session export and the real backup story | Q7 |
| Backfilling the six missing pot movements | Q8 |
| Technical error monitoring | Q9 |
| Accessibility and device targets | Q10 |
| Capacity and performance targets | Q17 |
| Offline: build it or strike it from the PRD | Q19 |
| Dropping `create_table_booking_transaction` | Q12 |

---

## Deferred with a reason

- **Block 6, narrowing the table-wide host grants on `game_states` and `sessions`.** Both are real:
  a host can rewrite any column of any row, including `is_test_session`, which switches snowball
  settlement off entirely. Neither can be narrowed by editing a policy, because Postgres RLS grants
  row access, not column access. The fix is replacement RPCs for every direct write, then dropping
  the broad policy, in that order across two deploys. That is a larger, higher-risk change than
  anything in blocks 1 to 5 and it should not be rushed in alongside them. Until it lands, the
  protection is that a host account is issued deliberately by an admin, which is exactly what block
  1 restored.
- **Block 11, the refactor.** `game-control.tsx` is 1,914 lines with 39 `useState` and 8 inline
  modals, and `display-ui.tsx` and `player-ui.tsx` share 574 near-identical lines that have already
  drifted. It is where the next bug will come from, and it must not be attempted before the tests in
  block 5 exist, because there would be nothing to catch a regression.
