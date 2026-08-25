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
| 0 | CI and the full migration replay | Committed **and run**: 33 migrations, 130 assertions, all pass |
| 1 | Security: signup, roles, direct-insert route | Committed |
| 2 | Live-night correctness: silent failures, retries, screens | Committed |
| 3 | Money integrity: pot archive, atomic edits, session reset | Committed |
| 4 | The record: void display, London dates, pot history on screen | Committed |
| 5 | Remaining R0: forced jackpot, settlement retry, call idempotency, claim entry | Committed |
| 6 | Narrowing the table-wide host grants | **Next**, needs replacement RPCs first |
| 7 | Error monitoring, backup and staff runbooks | Committed. Export and audit ledger still open |
| 8 | Prize and tie accounting | Committed |
| 9 | Accessibility and performance criteria | Blocked on the two remaining device questions |
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

**Now proven, and it found three things.** The harness had never been executed anywhere, because
"needs Docker" meant "never runs" on a machine without Docker. `run.sh` now falls back to a
temporary local Postgres 17 cluster, and running it found:

1. `20260825080604` could not be applied at all: changing a function's return type needs an explicit
   `DROP` first. A migration that fails on apply would have been discovered on production.
2. `20260430124552_tighten_profiles_select.sql` is not idempotent, the only one in the whole
   history. Found by applying all 33 migrations twice.
3. Re-replaying the whole history twice is not an achievable property and asking for it was wrong.
   A later migration that legitimately changes a return type makes an earlier `create or replace`
   of the same function fail. The property worth having is that each migration survives being run
   twice, which is what `db push` against a repaired history can actually ask of it.

Current state: 33 migrations replay from empty, each applied twice, followed by 37 catalogue
assertions and 29 behavioural ones. 130 assertions, all passing. Making CI required on the branch is
still gate 1 in [RELEASE-GATE.md](RELEASE-GATE.md).

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

### Block 5: the remaining R0 items

All committed, and all covered by the behavioural suite.

- **`money-force-jackpot-ungated`.** The window now binds on the forced route as well, and the
  Manual Snowball Win button is only offered during Full House while the window is genuinely open.
- **`money-snowball-tie-double-jackpot`.** At most one winner per game carries the jackpot flag,
  because the pot pays and resets once. How the cash is split between tied winners is Q6 and is
  deliberately still open: this fixes only the half that is wrong under every possible answer.
- **`money-settlement-failure-no-retry`.** `endGame` reports when the pot did not move, the host
  screen offers a Settle the pot button, and `settleSnowballPotForGame` is the route.
- **`qual-completion-paths-report-false-success`.** Same change; the game end still stands, but the
  answer no longer claims the pot moved when it did not.
- **`live-mutation-protocol`.** `callNextNumber` takes an idempotency key persisted and compared
  under the same row lock as the draw. This was the last unprotected mutation and the most
  frequently pressed button in the app.
- **`qual-claim-entry-unsafe-on-a-phone`.** Six columns on a phone (roughly 48px targets), called
  state by background rather than text opacity, `aria-pressed` and spoken labels, a sorted read-back
  of what was tapped with uncalled numbers called out, and the irreversible Skip separated from
  Record Winner and confirmed.
- **`qual-money-and-live-path-test-coverage`.** 29 behavioural Postgres assertions plus 28 new Node
  tests (`snowball`, `jackpot`, `dates`). 95 Node tests and 130 database assertions in total.

---

### Blocks 7 and 8: the owner's six answers, 25 August 2026

- **Tie splitting (D9 to D11).** `prize_amount_pence` and `prize_share_pence`, a
  trigger that keeps them in step from every write path including the two admin
  void routes, and payout totals on Winner History and the session screen that
  sum shares rather than amounts. The jackpot splits too. Backfilled across all
  87 rows.
- **Staff lifecycle (D12).** `docs/runbooks/staff-accounts.md`: add, promote,
  remove, revoke a live session, forgotten password, and what to check when
  somebody says they cannot get in.
- **Backups (D16).** Verified the project is on the Pro plan, so daily backups
  exist. `docs/runbooks/backup-and-recovery.md` carries the restore drill, which
  is the part that has never been done, and the plain statement that a session
  export is reporting and not a backup.
- **Pot history reconstruction (D13).** Six rows, marked `reconstructed_rollover`
  and rendered as such, with a read-only dry run against production recorded in
  the migration header showing they land exactly on 54 calls / £140.
- **Error monitoring (D14).** `src/lib/report-error.ts`, a vendor-neutral
  boundary with no new dependency. Seven tests assert what must never reach the
  sink.
- **Offline struck (D15).** `docs/PRD.md` carries a status banner and the two
  offline requirements are struck through. `docs/runbooks/live-night.md` carries
  the paper fallback that replaces it.

Also, found while implementing and fixed the same day: **43 of the 87 winner rows
carry real customer first names**, and the winners table was readable with the
public key that ships in the `/display` and `/player` bundles. CLAUDE.md says
winners are "anonymised by policy", which is true of the code and false of the
data. Read access is now staff only. The 43 names are untouched, because
rewriting customer data in production is the owner's decision and not a side
effect of a security fix.

---

## Next: block 6, narrowing the table-wide host grants

`sec-game-states-update-unbounded` and `sec-sessions-update-unbounded`. A host can rewrite any
column of any row in either table, including `is_test_session`, which switches snowball settlement
off entirely. Neither can be narrowed by editing a policy, because Postgres RLS grants row access,
not column access. The sequence is: add a replacement RPC for every direct write, deploy the app
that uses them, then drop the broad policy in a second deploy. Two changesets, in that order.

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
