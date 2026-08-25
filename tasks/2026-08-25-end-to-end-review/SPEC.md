# Anchor Bingo: end-to-end review and remediation spec

**Version:** 2, 25 August 2026. Version 1 was reviewed in [DEVELOPER-REVIEW.md](DEVELOPER-REVIEW.md)
and rated "not ready" as an implementation specification. This version answers all 34 of those
findings; section 12 traces each one to what changed.
**Repo:** `OJ-CashBingo` (BingoBlast), baseline `main` at `2fc21d3`, work on `fix/review-remediation`
**Production Supabase:** `bcmorqsgeumtmhvctvgu`, eu-west-2, Postgres 17

---

## 1. The headline

The engine of this app is well built. The money and the balls are decided inside the database under
row locks, not in the browser, and that is the right call. The problems are around it.

**One item is genuinely urgent.** Self sign-up is switched on in your Supabase project, and the
database gives every brand new account the **host** role. Anyone who reads the public keys out of
the `/display` page, signs up, and confirms their own email address can drive a live game. Verified
directly: `GET /auth/v1/settings` returns `disable_signup: false`, and `handle_new_user` inserts
`role = 'host'`. The code fix is written and committed. **The dashboard toggle is yours to flick and
is the one thing here I cannot do.**

**The current live-game engine has never run a bingo night.** Every atomic database function it
depends on was applied on the evening of 29 July, about three hours after the last session ended.
All 87 winner rows predate the idempotency key. This is not a defect but it is the largest single
risk in this document, and it is why section 6 is a release gate rather than a checklist.

### What this is not

Completing the code does not make the app safe to run a night on. Version 1 of this spec said it
did, and that was not supportable. Static review and passing helper tests do not prove a live,
multi-device, network-sensitive money flow works. Approval needs the evidence in
[RELEASE-GATE.md](RELEASE-GATE.md): a full migration replay, a rehearsal with a real host-role
account, browser verification on the actual host phone and the pub TV, network-failure injection, a
production configuration check, a confirmed backup, and a named human saying yes.

---

## 2. Document set

| Document | What it is | Use it when |
|---|---|---|
| This spec | Narrative: what is wrong, what was decided, what state the work is in | Reading the situation |
| [BACKLOG.md](BACKLOG.md) | **The single canonical work list.** 96 deduplicated items with severity, likelihood, release priority, effort, dependencies, Given/When/Then acceptance criteria, tests, preflight SQL and rollback | Doing or tracking any of the work |
| [DECISIONS.md](DECISIONS.md) | 8 decisions already taken with reasoning, 19 open with recommendations | Answering the questions that block work |
| [RELEASE-GATE.md](RELEASE-GATE.md) | 20 gates that must produce evidence before a live night, plus the 11 delivery blocks in order | Deciding whether to run the next night |
| [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md) | What has been built so far, commit by commit, and what remains | Picking up the work |
| [APPENDIX-A-findings.md](APPENDIX-A-findings.md) | The raw 164-entry register with evidence. Evidence only, not a work list | Checking why something is in the backlog |
| [APPENDIX-B-architecture.md](APPENDIX-B-architecture.md) | The app as it actually is: every write path and its guard | Understanding the system |

---

## 3. What was actually done, and what it proves

| Check | Result | Reproduce |
|---|---|---|
| `npm test` | 95 pass, 0 fail (67 at baseline) | `npm test` |
| `npm run lint` | clean | `npm run lint` |
| `npm run typecheck` | clean | `npm run typecheck` |
| `npm run build` | succeeds, 15 routes | `npm run build` |
| `npm audit` | 10 high-severity advisories, all with fixes, including Next itself | `npm audit --audit-level=high` |
| `npm run test:db` | **not run.** Docker is unavailable on this machine | Runs in CI, see block 0 |
| Live database | read-only inspection of schema, functions, grants, RLS, triggers, indexes, publication, row counts and auth settings | See the SQL in each backlog item |

The deep review used 22 agents across 10 independent lenses with an adversarial verifier per lens.
179 raw findings, 15 refuted, 164 recorded. Those 164 register entries deduplicate to **96 canonical
items**: 21 R0 blockers, 42 before-release, 24 next-cycle, 9 backlog. The register count and the
work count are different numbers and version 1 conflated them.

### Verification standard used here

A finding is only stated as fact below if it was reproduced independently. The two headline items I
verified myself, directly against production, rather than relying on an agent:

- `GET https://bcmorqsgeumtmhvctvgu.supabase.co/auth/v1/settings` returns `disable_signup: false`.
- `pg_get_functiondef` for `handle_new_user` inserts `role = 'host'`; `pg_enum` for `user_role`
  returns exactly `{admin, host}`; `on_auth_user_created` is enabled.
- `pg_publication_tables` for `supabase_realtime` returns only `sessions`, `game_states`,
  `game_states_public`. `winners` is absent, which is why the host's winner lists could never
  refresh.
- `pg_roles.rolbypassrls` is true for `postgres`, which owns every table and function, and no table
  has `FORCE ROW LEVEL SECURITY`. This is what makes dropping the `winners` INSERT policy safe.

Preflight for every constraint added, run read-only on 2026-08-25, all clean: 0 duplicate
`(session_id, game_index)` groups, 0 pots with `max_calls` over 90, 0 orphan winners, all
`stage_sequence` values valid, all `background_colour` values valid hex, all session statuses valid.
No constraint in this work needs a backfill.

### What the live database contains

6 sessions, all completed. 60 games, 60 game states, all completed. 87 winners. 1 snowball pot at
£140 / 54 calls. **One** user account, role `admin`, so no host-role account has ever existed and
every `role = 'host'` path is untested against real use. All 87 winners have a null idempotency key.
`snowball_pot_history` is empty while the pot has demonstrably moved six times.

---

## 4. What is genuinely well built

None of the remediation should weaken these.

- **The database is the referee.** Every host action that can cost money runs as a `security
  definer` function that takes a `for update` lock and re-checks its conditions under that lock.
- **Winner recording cannot double-pay.** One claim key per modal, reused on every retry, landing in
  a uniquely indexed column checked before anything else. A tie carries its own key and saves.
- **Hosts can settle the pot without naming a figure.** Every written value is derived from the
  locked pot row.
- **The public screens cannot see the future.** `game_states_public` is a trigger-maintained mirror
  with no write policy and no shuffled sequence.
- **Ordering is monotonic.** `state_version` removes the whole class of poll-versus-realtime races.
- **Deletion is defended by the database, not the browser.**
- **The comments are unusually good.** Several files explain which bug a shape prevents, which is
  why this review could be as specific as it is.

---

## 5. The shape of the problem

Rather than repeating the backlog, here is what the 96 items are actually about.

**Things that fail silently.** This is the dominant pattern and it accounts for most of the R0 list.
A failed background request removed the jackpot eligibility prompt and paid a punter an ordinary
prize. Two realtime subscriptions on a table that is not published could never fire, so the host's
winner list was frozen at mount. Eleven of sixteen host handlers had a `finally` and no `catch`, so
a dropped request reset the button and said nothing. A `.update()` without `.select()` reports
success on a write RLS filtered out. None of these looks like a bug from the outside; they look like
the app working.

**Things that cannot be retried.** A lost response on stage advance turned a second tap into a
skipped stage with its prize unawarded. Pot settlement can still fail with no route back, because
every path to it is gated on a status the game has already left. `callNextNumber` is still not
idempotent while its own error copy tells the host to try again.

**Money paths with no record.** The pot has moved six times with zero audit rows. Manual pot edits
could move cash and swallow the audit write. A session reset destroyed a whole night with nothing
recording it. Voided wins rendered in Winner History as ordinary payouts. There is still no export.

**Authorisation that assumes everyone is staff.** Self sign-up plus a host default is the critical
one. Underneath it: routes that checked authentication rather than authorisation, a `winners` INSERT
policy that checked only the caller's role, and table-wide UPDATE grants on `game_states` and
`sessions` that let a host rewrite any column of any row.

**Screens that dead-end.** A transient read failure put the pub TV on a static 404 for the rest of
the night. The 30 second auto-reload fired while offline. White text sat on pale game colours at
about 1.4:1, hiding the only route to the numbers board.

---

## 6. Release gate

Full detail in [RELEASE-GATE.md](RELEASE-GATE.md): 20 gates, each naming the evidence required and
whether the developer can satisfy it alone. The blocking ones in summary:

1. CI green on the branch, including a full replay of every migration from an empty database, twice.
2. A rehearsal of a complete night with a **real host-role account**, which has never existed.
3. Browser verification on the actual host phone and the actual pub TV browser.
4. Network-failure injection: wifi dropped mid-call, mid-claim and mid-settlement.
5. Production configuration checked, including `disable_signup` proven true from the public endpoint.
6. A confirmed, restorable backup with a stated recovery window.
7. Named sign-off from the product owner.

Gate 6 needs an answer that does not exist yet: nobody has confirmed which Supabase backup tier is
enabled or tested a restore. That is open decision Q7.

---

## 7. Delivery order

Eleven blocks, in [RELEASE-GATE.md](RELEASE-GATE.md). The ordering constraint that is not negotiable:
**block 0 is CI and the full migration replay**, because those are what protect the auth and money
migrations that follow. Version 1 had CI in the last block while claiming every earlier block would
be verified by "the full pipeline", which did not exist by name and could not run the database tests
at all.

Every block states its deploy order. The rule throughout is **application first, or together, never
database first**, because each database change narrows something the running application currently
relies on.

---

## 8. Decisions

Eight are taken and implemented, with reasoning, in [DECISIONS.md](DECISIONS.md). The ones worth
knowing without reading it:

- A new account lands as `pending` and can reach nothing until an admin promotes it.
- `winners` is deliberately **not** published over Realtime; the host lists refresh explicitly.
- A snowball pot is archived, never deleted.
- A session reset refuses when it would strand the pot, rather than rewinding the pot automatically.
- A session reset records everything it destroys.

Nineteen are open. Six matter enough to answer before much more is built: staff lifecycle (Q1), tie
and prize accounting (Q6), backup and recovery (Q7), the missing pot history backfill (Q8), error
monitoring (Q9), and offline (Q19). Each carries a recommendation, and **if no answer comes the
recommendation is what gets built**.

---

## 9. Data and tracking

The question "is everything tracked and stored properly?" has a clear answer: **the money is stored
properly, the night is not.** The specific questions the stored data still cannot answer:

| Question | Why not | Backlog item |
|---|---|---|
| How much did we pay out on 29 July? | `prize_description` is free text with no amount column | `money-prize-and-tie-accounting-model` |
| How did the jackpot get to £140? | Six movements, zero audit rows. Now displayed, still empty for the historic ones | `obs-snowball-pot-history-invisible-and-empty` |
| Who recorded this win, who handed the prize over? | `winners` carries no actor | `obs-business-audit-ledger` |
| Which ball was voided, when, by whom? | Nothing records a void | `obs-business-audit-ledger` |
| How many claims were checked and rejected? | Refused claims are stored nowhere | `obs-business-audit-ledger` |
| What failed mid-game? | Failures go to `console.error` only | `obs-technical-error-monitoring` |
| Can I get a copy of a night's results? | No export exists. `/admin/backup` is an unlinked page showing the pre-shuffled bag | `obs-session-export-and-disaster-recovery` |

An export is **reporting, not disaster recovery**. It cannot restore auth users, roles, RLS,
functions or configuration. Version 1 called it "the answer to what if the database is lost", which
was wrong. Backup and restore is Q7 and needs a real answer.

---

## 10. Things the PRD promises that do not exist

`docs/PRD.md` is v1.1 dated 24 November 2025 and no longer describes this application. It should be
retired or rewritten, because it is currently a source of false requirements.

**In scope, never built:** offline resilience for the host (its headline reliability requirement),
sound effects, game templates, password reset, named winners.

**Out of scope, built anyway:** the player follower screen and the display QR code.

**Stated but not enforced:** the five allowed stage sequences (FR-8), and "once running, structural
fields are locked" (the guard exists in the UI; the server actions accept both a new game and a
clone on a running session).

Version 1 also listed "duplicate session" as never built. That was wrong: `duplicateSession` is
implemented at `src/app/admin/actions.ts:126` and used by the admin dashboard. Corrected.

One flow gap: new sessions are created as `draft`, and both `/host` and `/display` list only `ready`
or `running` sessions. If an admin forgets "Mark as Ready", the host arrives to an empty dashboard
with no explanation.

---

## 11. What this review did not cover

- **`supabase/tests/run.sh` has still not been executed here.** Docker is unavailable on this
  machine. Block 0 adds a CI job that runs it, which is the first time it will ever have run.
- **No browser testing.** Everything about the UI is read from source, live data and built CSS. The
  contrast finding is computed from the hex values in your production `games` rows, not measured on
  a phone.
- **No load or soak testing.** "The display survives a five-hour night" is untested.
- **Deployment configuration was not inspected.** Vercel settings, production environment variables
  and domain configuration are outside what could be read from here.
- **`create_table_booking_transaction`** is anon-executable, belongs to no code in this repo, and is
  created by no migration, so it would vanish on a rebuild. Left alone pending Q12.

---

## 12. How this version answers the developer review

| Finding | Answer |
|---|---|
| R01 readiness claim unsupported | Section 1 no longer claims safety from code alone. [RELEASE-GATE.md](RELEASE-GATE.md) has 20 gates with named evidence and owners |
| R02 164 is not a defect count | Section 3 states both numbers. 164 register entries deduplicate to 96 canonical items |
| R03 tie decision referenced but missing | [DECISIONS.md](DECISIONS.md) exists. Tie accounting is Q6 |
| R04 factual contradictions | `duplicateSession` correction in section 10; the pot-history claim corrected in Appendix B |
| R05 priority and severity conflated | Every backlog item carries severity, likelihood, release priority and effort as separate fields |
| R06 appendix findings never entered the plan | Every one of the 164 has a disposition. Nothing dropped without a stated reason |
| R07 untestable acceptance criteria | Given/When/Then per item, stating the database result, not only the screen result |
| R08 no owners or dependencies | Dependencies per item; blocks carry deploy notes. Owner naming is still yours to assign |
| R09 CI sequenced after the work it protects | CI and the full replay are block 0 and are already committed |
| R10 evidence not reproducible | Section 3 gives the exact queries; each backlog item carries preflight SQL |
| R11 no staff lifecycle | Q1, an R0 blocker |
| R12 pending role not denied at every layer | Fixed in code: routes, actions, RPC and RLS all name the roles. Realtime is safe only because `winners` is unpublished, and D2 keeps it that way |
| R13 publishing winners adds exposure | D2: not published. Explicit refresh instead |
| R14 idempotency only partial | `live-mutation-protocol` is a single R0 item that the individual fixes depend on. Advance and skip are done; `callNextNumber` is not |
| R15 money risks outside the gate | The merge pass promoted them. Forced jackpot, settlement retry, unbounded host writes and false completion success are all R0 now |
| R16 reset, void, delete, abandon undefined | D3, D4, D5 taken. The rest is Q14 |
| R17 jackpot type ambiguous | Fixed: type alone decides. Prize correction is part of Q6 |
| R18 prize and tie accounting undefined | Q6, explicitly not implemented until answered |
| R19 offline conflicts with the design | Q19, with a recommendation to strike it from the PRD |
| R20 operator journeys unfixed | Now backlog items with their own criteria |
| R21 audit and telemetry conflated | Split: `obs-business-audit-ledger` and `obs-technical-error-monitoring` |
| R22 export presented as recovery | Section 9 corrects it. Backup is Q7 |
| R23 migration handling missing | Every migration carries preflight, compatibility, deploy order and rollback in its own header |
| R24 security plan incomplete | `config.toml` is no longer claimed to enforce hosted settings. Default privileges, replacement RPCs and `/api/setup` disposition are separate items |
| R25 privacy rules missing | The reset log's contents are justified against the anonymity policy; the void reason field now warns against names. Retention is Q16 |
| R26 tests do not trace to risks | Every backlog item names its tests by level and file |
| R27 accessibility criteria missing | Q10 |
| R28 capacity targets missing | Q17 |
| R29 monitoring and runbooks missing | Q9, plus the runbook gate |
| R30 deployment plan missing | Deploy notes per block; migration headers carry order and rollback |
| R31 dependency upgrade under-weighted | Its own item and its own changeset, not bundled |
| R32 three overlapping lists | One canonical backlog. The appendix is evidence only |
| R33 prefer reversible changes | D3 and D4 |
| R34 which product document is authoritative | Section 10 recommends retiring the PRD. Confirmation needed |
