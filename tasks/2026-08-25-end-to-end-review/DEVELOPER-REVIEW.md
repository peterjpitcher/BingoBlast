# Developer review of `SPEC.md`

**Review date:** 25 August 2026  
**Reviewed baseline:** `main` at `2fc21d3`  
**Documents reviewed:** `SPEC.md`, both appendices, the current repository, migrations, tests, and the old PRD  
**Original changed:** No

## Overall assessment

The review work is strong as a diagnostic report, but the document is **not ready to be used as an implementation specification or production release plan**.

The immediate self-sign-up problem is credible and should be closed now. However, the statement that the app will be safe for a live night after P0.1–P0.10 is not supported yet. Several other live-game, money, auth, recovery, and deployment risks sit outside that gate. Many proposed changes also lack exact behaviour, acceptance tests, migration steps, owners, rollback plans, and resolved business decisions.

Current local checks agree with the stated baseline:

- 67 tests pass.
- Lint, type-check, and production build pass.
- `npm audit` currently reports 10 high-severity package findings and offers Next 16.3.2 as part of the fix path.
- Docker is still unavailable, so `supabase/tests/run.sh` could not be run.
- The PostgreSQL harness covers selected migrations, not a clean replay of all 26 migrations.

### Status and priority used in this report

- **Confirmed issue:** A gap or contradiction visible in the specification, appendices, repository, or current command output.
- **Optional improvement:** A useful simplification or quality improvement, but not a blocker by itself.
- **P0:** Resolve before implementation or immediately for an active security exposure.
- **P1:** Resolve before production release.
- **P2:** Resolve in the next planned delivery cycle.
- **P3:** Backlog.

## Findings summary

| ID | Finding | Status | Priority | Type |
|---|---|---|---|---|
| R01 | The live-night readiness claim is not supported | Confirmed issue | P0 | Release governance |
| R02 | The 164-item count is not a count of unique defects | Confirmed issue | P1 | Scope and evidence |
| R03 | A required tie-splitting decision is referenced but missing | Confirmed issue | P0 | Missing requirement |
| R04 | The document set contains factual contradictions | Confirmed issue | P1 | Accuracy |
| R05 | Priority and severity are mixed and inconsistent | Confirmed issue | P0 | Prioritisation |
| R06 | Important appendix findings never enter the delivery plan | Confirmed issue | P0 | Scope traceability |
| R07 | Acceptance criteria are incomplete and often not testable | Confirmed issue | P0 | Requirements quality |
| R08 | Ownership, estimates, milestones, and dependencies are incomplete | Confirmed issue | P1 | Delivery planning |
| R09 | The sequencing depends on CI before CI is created | Confirmed issue | P0 | Delivery sequencing |
| R10 | Production evidence is not reproducible enough | Confirmed issue | P1 | Evidence and auditability |
| R11 | The urgent auth fix does not define a complete staff lifecycle | Confirmed issue | P0 | Security and operations |
| R12 | The proposed `pending` role does not meet its own access requirement | Confirmed issue | P0 | Authorisation |
| R13 | Publishing `winners` to Realtime adds avoidable data exposure | Confirmed issue | P0 | Security and integration |
| R14 | Idempotency is solved only for some mutations | Confirmed issue | P0 | Correctness and recovery |
| R15 | Money and state-integrity risks remain outside the release gate | Confirmed issue | P0 | Data integrity |
| R16 | Reset, void, delete, and abandon semantics are unresolved | Confirmed issue | P0 | Functional and data design |
| R17 | Cash-jackpot type and prize correction rules are ambiguous | Confirmed issue | P1 | Functional requirement |
| R18 | Prize and tie accounting is not defined | Confirmed issue | P0 | Business rule and data model |
| R19 | Offline requirements conflict with the database-authority design | Confirmed issue | P0 | Architecture and scope |
| R20 | Several live operator journeys have no planned fix | Confirmed issue | P1 | User journey |
| R21 | Business audit and technical error monitoring are conflated | Confirmed issue | P1 | Observability |
| R22 | A session export is incorrectly presented as disaster recovery | Confirmed issue | P0 | Backup and recovery |
| R23 | Migration, constraint, and historical-data handling are missing | Confirmed issue | P0 | Migration and data |
| R24 | The security hardening plan is not complete enough to implement safely | Confirmed issue | P0 | Security architecture |
| R25 | Privacy, access, and retention rules are missing | Confirmed issue | P1 | Privacy and compliance |
| R26 | The test plan does not trace to the risks being fixed | Confirmed issue | P0 | Testing |
| R27 | Browser, device, and accessibility release criteria are missing | Confirmed issue | P1 | Accessibility and UX |
| R28 | Capacity and performance targets are absent | Confirmed issue | P1 | Performance |
| R29 | Monitoring, alerting, and live-night runbooks are absent | Confirmed issue | P0 | Operations |
| R30 | Environment, rollout, smoke-test, and rollback plans are absent | Confirmed issue | P0 | Deployment |
| R31 | The dependency upgrade is treated as lower risk than it is | Confirmed issue | P1 | Dependency management |
| R32 | Use one canonical backlog instead of three overlapping lists | Optional improvement | P2 | Simplification |
| R33 | Prefer reversible state changes over destructive workflows | Optional improvement | P2 | Simplification |
| R34 | Decide which product document is authoritative before refactoring | Optional improvement | P2 | Product governance |

## Detailed findings

### R01 — The live-night readiness claim is not supported

**Relevant section:** §1 “The headline”, §4 P0, §10 “Proposed sequencing”, §11 “What this review did not cover”  
**Status:** Confirmed issue  
**Priority:** P0  
**Type:** Release governance

**Description:** The spec says the app will be safe for a night once P0.1–P0.10 are complete. It also says the current engine has never run a real night, the host role has never existed in production, browser testing was not done, the database test harness was not run, no load or soak test was done, and deployment settings were not inspected.

**Rationale:** Static review and passing helper tests do not prove a live, multi-device, network-sensitive money flow is safe.

**Impact:** The developer could treat P0 completion as approval to run production without the evidence needed for a go/no-go decision.

**Recommended action:** Replace the readiness statement with a release gate. Require a full host-role rehearsal, browser tests, complete migration replay, network-failure tests, production-config review, backup confirmation, and named business sign-off.

**Open questions:** Who has authority to approve the live-night release? What exact evidence is required? When is the next live night?

### R02 — The 164-item count is not a count of unique defects

**Relevant section:** §2 and Appendix A  
**Status:** Confirmed issue  
**Priority:** P1  
**Type:** Scope and evidence

**Description:** Appendix A explicitly keeps duplicates. Examples include 12/15, 9/31, 3/49, 16/23, 19/53, 22/72/78, 51/64, and 80/126. The headline count therefore measures register entries, not distinct defects.

**Rationale:** Delivery sizing, risk totals, and progress reporting need one canonical item per underlying problem.

**Impact:** Scope looks larger than it is, while repeated items can receive different severities or be fixed twice.

**Recommended action:** Deduplicate the register. Keep the original appendix as evidence, but create a canonical backlog with links to all source finding IDs.

**Open questions:** How many unique issues remain after deduplication? Which severity wins where duplicate entries disagree?

### R03 — A required tie-splitting decision is referenced but missing

**Relevant section:** §6 P2.3, “see question 3 below”  
**Status:** Confirmed issue  
**Priority:** P0  
**Type:** Missing requirement

**Description:** There is no numbered questions or decisions section, so “question 3” does not exist.

**Rationale:** Tie handling affects jackpot payout, winner rows, totals, display wording, audit history, and void behaviour.

**Impact:** P1.7 and P2.3 cannot be implemented correctly.

**Recommended action:** Add a decision log and resolve tie splitting before designing the prize schema or winner flow.

**Open questions:** Is one stage prize divided between winners, duplicated for every winner, or entered manually? Is the snowball jackpot ever split? How is rounding handled?

### R04 — The document set contains factual contradictions

**Relevant section:** §9 and Appendix B  
**Status:** Confirmed issue  
**Priority:** P1  
**Type:** Accuracy

**Description:** Section 9 says duplicate session was never built, but `duplicateSession` is implemented and used. Appendix B says `/admin/snowball` shows pot history, while the current page only loads pot rows and P1.10 correctly says history is not displayed. Appendix B also calls login “invite only” without distinguishing the missing UI from the open Supabase signup API.

**Rationale:** The document claims to describe the app “as it actually is today”. Contradictions weaken trust in the proposed backlog.

**Impact:** Developers may remove or rebuild existing features, or accept incorrect architecture notes.

**Recommended action:** Correct these statements and run a consistency pass across the spec and both appendices.

**Open questions:** Are there more generated-summary errors in Appendix B? Should Appendix B remain normative or evidence-only?

### R05 — Priority and severity are mixed and inconsistent

**Relevant section:** §4–§8  
**Status:** Confirmed issue  
**Priority:** P0  
**Type:** Prioritisation

**Description:** P0 is used as a delivery priority while each item also has security severity. Later sections mix P1/P2/P3/P4, complexity scores, and Appendix severities. P0.10 contains two unrelated defects. Direct host writes to protected state are placed in P3 even though P0.2 treats the same trusted-host threat as high risk.

**Rationale:** Priority should express delivery order; severity should express consequence. They should not substitute for one another.

**Impact:** Serious defects can be delayed because they appear in a lower-numbered narrative section or a “housekeeping” block.

**Recommended action:** Give every unique backlog item separate fields for severity, likelihood, release priority, effort, owner, and dependency. Split P0.10.

**Open questions:** Is a legitimate or compromised host account inside the threat model? What risk level blocks a live night?

### R06 — Important appendix findings never enter the delivery plan

**Relevant section:** Appendix A compared with §4–§10  
**Status:** Confirmed issue  
**Priority:** P0  
**Type:** Scope traceability

**Description:** Several live failures are confirmed in Appendix A but are not included in a release block. Examples include non-idempotent `callNextNumber`, failed settlement with no retry, `endGame` reporting success when the pot did not settle, no controller release, no Resume control, incomplete final-stage completion, public polling that can hang forever, display wake lock absence, and an unattended TV that never returns to a later live session.

**Rationale:** A full register is useful only if every accepted item is fixed, explicitly deferred, or rejected with a reason.

**Impact:** The stated P0 gate can pass while known live-night failures remain.

**Recommended action:** Add a disposition column to the canonical backlog: release blocker, scheduled block, accepted risk, false positive, or deferred. Require an owner and reason for every deferral.

**Open questions:** Which of these behaviours are acceptable for the next event? Who accepts each remaining risk?

### R07 — Acceptance criteria are incomplete and often not testable

**Relevant section:** §4–§8  
**Status:** Confirmed issue  
**Priority:** P0  
**Type:** Requirements quality

**Description:** P0 items have short “Done when” statements, but P1–P4 mostly do not. Several P0 criteria are too broad, such as “every host control”, “recoverable shell”, “survives a redirect”, and “every text run”. They do not define test setup, expected persisted state, timeout, or failure result.

**Rationale:** Clear acceptance criteria are needed for money, concurrency, auth, and recovery changes.

**Impact:** Implementations can appear complete while missing a second device, lost response, stale response, or database failure.

**Recommended action:** Write Given/When/Then criteria for every release item. Include UI result, database result, audit result, retry result, and second-device result where relevant.

**Open questions:** Which browser/device combinations are supported? What response and recovery times count as success?

### R08 — Ownership, estimates, milestones, and dependencies are incomplete

**Relevant section:** §4 and §10  
**Status:** Confirmed issue  
**Priority:** P1  
**Type:** Delivery planning

**Description:** The spec uses “you” and “I”, but does not name owners. Complexity scores are not defined, are not delivery estimates, and have no confidence range. There are no target dates, reviewer assignments, or external dependencies beyond one dashboard toggle.

**Rationale:** Several changes require venue decisions, Supabase project access, Vercel access, Docker-capable CI, test devices, and a rehearsal slot.

**Impact:** Work can block late or be deployed in the wrong order.

**Recommended action:** Add owner, approver, estimate, dependency, target date, and status to each block. Name who can change production Auth and Vercel settings.

**Open questions:** Who is the developer, database reviewer, product owner, and live-night approver? Is there a staging Supabase project?

### R09 — The sequencing depends on CI before CI is created

**Relevant section:** §8 and §10  
**Status:** Confirmed issue  
**Priority:** P0  
**Type:** Delivery sequencing

**Description:** Blocks A–E are to be verified with the “full pipeline”, but CI is not added until Block F. The repository also has no `typecheck` or PostgreSQL test npm script. The text says each block is one changeset while B, D, and E say they must be split.

**Rationale:** High-risk auth and money migrations should not land before the checks intended to protect them.

**Impact:** Early changes can be merged without repeatable database or browser verification.

**Recommended action:** Make CI and a Docker-capable full migration test Block 0. Define one PR per atomic change, with compatibility and deployment order stated.

**Open questions:** Can the chosen CI runner start Docker services? Which checks are blocking?

### R10 — Production evidence is not reproducible enough

**Relevant section:** §2 and Appendix A  
**Status:** Confirmed issue  
**Priority:** P1  
**Type:** Evidence and auditability

**Description:** The document gives results but not a timestamped evidence bundle with command versions, SQL queries, sanitized outputs, audit JSON, production config screenshots, or hashes. “Confirmed by a second agent” is not the same as an executable reproduction.

**Rationale:** Production settings and rows can change after the review date.

**Impact:** A developer cannot reliably confirm that a finding still exists or prove that it is fixed.

**Recommended action:** Add an evidence manifest. For each live finding, include the read-only query or API check, observed-at time, environment, expected result, and post-fix check. Do not store secrets.

**Open questions:** Where should sanitized evidence be stored? How long is a production observation considered current?

### R11 — The urgent auth fix does not define a complete staff lifecycle

**Relevant section:** P0.1, P3.6, and §9 password-reset gap  
**Status:** Confirmed issue  
**Priority:** P0  
**Type:** Security and operations

**Description:** Disabling signup and adding `pending` are useful defences, but the spec does not define how an account is invited, promoted, rejected, disabled, removed, password-reset, or audited. It also does not define what happens to existing sessions when a staff account is disabled.

**Rationale:** Invite-only security is an operational process as well as a database enum.

**Impact:** Staff can be locked out, granted the wrong role, or remain active after they should lose access.

**Recommended action:** Document and test a staff lifecycle runbook. Derive role changes server-side, audit them, and define session revocation. Treat the dashboard signup toggle as the emergency action.

**Open questions:** Who may create and approve a host? Is MFA required for admins? What is the deprovisioning time target?

### R12 — The proposed `pending` role does not meet its own access requirement

**Relevant section:** P0.1 and P3.3  
**Status:** Confirmed issue  
**Priority:** P0  
**Type:** Authorisation

**Description:** P0.1 says a pending account must have no access to `/host`, but the current host middleware and `/host` page check only that a user exists. A pending user may reach the route even if RLS hides data. P3.3 proposes making winners readable by all `authenticated` users, which would include `pending` users.

**Rationale:** Authentication is not authorisation. A harmless tier must be denied at the route, server action, RPC, RLS, and Realtime layers.

**Impact:** The acceptance criterion can fail, and a pending account can still see staff or winner data through broad authenticated policies.

**Recommended action:** Add explicit admin/host checks to protected pages and middleware. Replace broad `authenticated` data policies with profile-role predicates where the pending role must be excluded. Add negative tests using a real pending JWT.

**Open questions:** Should pending users see a clear approval screen or be signed out? Which tables may pending users read?

### R13 — Publishing `winners` to Realtime adds avoidable data exposure

**Relevant section:** P0.3 and P3.3  
**Status:** Confirmed issue  
**Priority:** P0  
**Type:** Security and integration

**Description:** P0.3 requires both an explicit refresh and adding `winners` to the Realtime publication. Postgres Changes publishes row payloads to authorised subscribers. The current anonymous winner SELECT policy means the publication change would broaden live exposure until P3.3 lands. Even after that, broad authenticated access includes pending users under the proposed model.

**Rationale:** The actual P0 need is to refresh the host list after successful mutations. Realtime is optional for that same-device path.

**Impact:** Winner details, void reasons, actor fields added later, and request IDs could be exposed to clients that do not need them.

**Recommended action:** Prefer explicit refresh after record/void/prize mutations and a small poll for secondary host screens. Add `winners` to Realtime only if a defined multi-device requirement justifies it, after RLS and payload review. Put any publication change in a migration.

**Open questions:** Must a second host device see winner changes instantly? Which winner columns may each role receive?

### R14 — Idempotency is solved only for some mutations

**Relevant section:** P0.6, P0.7, Appendix A 54/59, and host composite actions  
**Status:** Confirmed issue  
**Priority:** P0  
**Type:** Correctness and recovery

**Description:** The spec proposes a client key for stage advance and skip, but does not define where the key is stored or checked atomically. `callNextNumber` remains non-idempotent even though its error copy tells the host to retry. Multi-step move/end/start/break actions also need a clear retry contract.

**Rationale:** A client key alone has no effect. The database must persist and compare it under the same lock as the state change, or the client must reconcile state before allowing another action.

**Impact:** A lost response can draw a second ball, skip a stage, start the wrong game, or leave a partial transition.

**Recommended action:** Define one mutation protocol: request ID, expected state version, one atomic RPC, persisted result, and safe repeat response. Cover call, advance, skip, end, and composite transitions. Where idempotency is not practical, poll and reconcile before enabling retry.

**Open questions:** How long are request IDs retained? What result should a repeat call return? Can two different valid actions share the same expected state version?

### R15 — Money and state-integrity risks remain outside the release gate

**Relevant section:** P3.1–P3.2, Appendix A 62/71/122/128/130, and the §1 readiness claim  
**Status:** Confirmed issue  
**Priority:** P0  
**Type:** Data integrity

**Description:** A host can directly update broad `game_states` and `sessions` fields. Pot settlement can fail after the game leaves the state from which it can be retried. Some completion paths leave `ended_at` and `active_game_id` wrong. The manual force-jackpot path bypasses the normal eligibility rule. These are not in the P0 gate.

**Rationale:** These faults can alter calls, completion state, or money just as directly as P0.2.

**Impact:** The app can be declared safe while a compromised host or normal failure still corrupts a night or jackpot.

**Recommended action:** Reassess these items as release blockers. Route sensitive transitions through narrowly granted, locked RPCs. Add a visible and retryable settlement state. Remove or strictly admin-gate forced jackpot behaviour.

**Open questions:** Is a host account trusted against deliberate API use? What is the operational response when settlement fails?

### R16 — Reset, void, delete, and abandon semantics are unresolved

**Relevant section:** P1.1–P1.5, P1.9, P2.2  
**Status:** Confirmed issue  
**Priority:** P0  
**Type:** Functional and data design

**Description:** The spec identifies destructive problems but does not choose one safe business rule. Reversing an old pot settlement can overwrite later legitimate pot movements. Voiding a paid jackpot after later games is not the same as rolling back a transaction. “End game” does not say whether the game is completed, cancelled, abandoned, or settled. Pot deletion does not define archive behaviour.

**Rationale:** Historical financial events should normally be corrected by compensating entries, not erased or silently rewound.

**Impact:** A technically correct implementation can still create the wrong current pot or destroy the audit trail.

**Recommended action:** Define explicit states and commands: cancel before settlement, complete and settle, abandon with admin reconciliation, void winner, compensating pot adjustment, archive pot, and reset test session. Prefer refusing unsafe reset over automatic reversal.

**Open questions:** May a settled real session ever be reset? Who can approve a compensating pot adjustment? Can a paid prize ever be marked unpaid?

### R17 — Cash-jackpot type and prize correction rules are ambiguous

**Relevant section:** P0.8, P1.4, old PRD FR-7/FR-11  
**Status:** Confirmed issue  
**Priority:** P1  
**Type:** Functional requirement

**Description:** The spec says to use `type === 'jackpot'`, but the old PRD only defines standard and snowball. It says “never write it to more than one stage” without naming the stage. It also proposes unlocking prize text after start without saying which stages may be edited or how clients and existing winners behave.

**Rationale:** Prize edits are public and may affect payouts already earned.

**Impact:** The host, TV, history, and winner row can show different prize values.

**Recommended action:** Confirm whether `jackpot` is a supported first-class type. Define its allowed stage sequence, target stage, amount validation, currency storage, edit window, audit entry, and client refresh behaviour. Never change prize text on an already recorded winner.

**Open questions:** Which stage receives the cash jackpot? May an admin edit the current stage after any balls are called? Should the game store planned and final prize separately?

### R18 — Prize and tie accounting is not defined

**Relevant section:** P1.7 and P2.3  
**Status:** Confirmed issue  
**Priority:** P0  
**Type:** Business rule and data model

**Description:** A single amount column on each winner does not define non-cash prizes, currency, prize quantity, ties, rounding, planned versus awarded value, or whether “prize given” applies per winner or to one shared award.

**Rationale:** The data model should follow the pub’s payout rule, not guess it.

**Impact:** Payout totals and the audit record can be financially wrong.

**Recommended action:** Decide the business rule first. Consider a stage award or claim-group record with total value and linked winner rows. If the simpler winner-column design is kept, use a decimal database type or integer pence and define split allocation explicitly.

**Open questions:** Are non-cash prizes valued? Is the currency always GBP? Who enters the final split and when?

### R19 — Offline requirements conflict with the database-authority design

**Relevant section:** §1, §9, old PRD success criteria, and Appendix A 7  
**Status:** Confirmed issue  
**Priority:** P0  
**Type:** Architecture and scope

**Description:** The PRD says the host must keep calling while offline. The current safety model depends on a database row lock for every call. True offline calling would move authority to the client and require later conflict reconciliation, which conflicts with “the database is the referee”. P0.5 only preserves the last screen and does not make host mutations work offline.

**Rationale:** This is a product and architecture decision, not a small reliability fix.

**Impact:** The app can either fail its headline PRD promise or weaken its strongest correctness guarantee.

**Recommended action:** Choose one path before delivery: formally remove offline calling and define a paper/manual outage runbook, or commission a separate offline-authority design. Do not imply that reload gating provides offline operation.

**Open questions:** How long must the host work without internet? Is manual fallback acceptable? Which device owns the offline sequence?

### R20 — Several live operator journeys have no planned fix

**Relevant section:** §9 flow gap and Appendix A 55/56/68/80/101/126/137/153/159/164  
**Status:** Confirmed issue  
**Priority:** P1  
**Type:** User journey

**Description:** The plan does not fully cover preparing a draft session for the host, releasing control, taking over safely, resuming after “stay paused”, recovering after sign-out or navigation, keeping the TV awake, returning an unattended TV to the next session, handling two live sessions, or starting with a real host-role account.

**Rationale:** These are normal event operations, not rare internal edge cases.

**Impact:** Staff can be blocked or the public display can remain stale during a live night.

**Recommended action:** Add end-to-end journey requirements and tests from setup through close-down. Include primary host, backup host, TV, guest phone, and admin intervention.

**Open questions:** Is more than one live session allowed? How should controller release and takeover work? Should `/display` follow the next active session automatically?

### R21 — Business audit and technical error monitoring are conflated

**Relevant section:** P2.2 and P2.5  
**Status:** Confirmed issue  
**Priority:** P1  
**Type:** Observability

**Description:** The proposal suggests an append-only business event table and a database error sink. A database table cannot reliably capture database or network outages because the failing dependency is also the sink. Business events and stack traces also need different access, retention, and redaction rules.

**Rationale:** Audit records prove business actions. Telemetry diagnoses technical failures. They serve different purposes.

**Impact:** Important failures may still disappear, or sensitive technical data may be stored in the business database.

**Recommended action:** Use a database audit ledger for successful or refused business actions and external error monitoring/logging for technical failures. Add correlation IDs between them. Define redaction and alert rules.

**Open questions:** Which monitoring provider is approved? What data may leave Supabase/Vercel? Who receives alerts during a game?

### R22 — A session export is incorrectly presented as disaster recovery

**Relevant section:** P2.1  
**Status:** Confirmed issue  
**Priority:** P0  
**Type:** Backup and recovery

**Description:** “One CSV or JSON per session” is useful for reporting but is not “the answer to what if the database is lost”. It cannot restore auth users, roles, current pot state, constraints, functions, RLS, config, or all sessions consistently.

**Rationale:** Backup and restore require a complete, automated, tested recovery process with defined recovery targets.

**Impact:** The team may believe it has disaster recovery when it only has a partial manual export.

**Recommended action:** Keep export as an admin/reporting feature. Separately document Supabase backups or PITR, schema migrations, auth/config recovery, RPO, RTO, and a restore drill.

**Open questions:** What Supabase backup tier is enabled? What data-loss window and recovery time are acceptable? Has a restore ever been tested?

### R23 — Migration, constraint, and historical-data handling are missing

**Relevant section:** P0.1, P1.8, P2.2–P2.4, P3.4, and §10  
**Status:** Confirmed issue  
**Priority:** P0  
**Type:** Migration and data

**Description:** The plan adds an enum value, policies, functions, constraints, audit data, and prize fields without defining preflight queries, existing-row backfills, invalid-data handling, generated type updates, migration compatibility, or rollback. The six unlogged historical pot movements also have no treatment.

**Rationale:** Constraints can fail on existing duplicates. Fabricated audit history can be misleading. Policy changes can break the old app during a staggered deploy.

**Impact:** Production migration can fail, lock tables, break live traffic, or create false financial history.

**Recommended action:** For each schema change, document preflight, migration, backfill, verification, application compatibility, and forward recovery. Record a clearly labelled opening balance instead of inventing old pot events. Regenerate database types.

**Open questions:** Are any current `game_index` or `max_calls` values invalid? Can production have a maintenance window? How should incomplete historic audit data be labelled?

### R24 — The security hardening plan is not complete enough to implement safely

**Relevant section:** P0.1–P0.2 and P3  
**Status:** Confirmed issue  
**Priority:** P0  
**Type:** Security architecture

**Description:** `supabase/config.toml` controls the local stack; it does not by itself enforce hosted production Auth settings. Default privileges are grantor-specific, so the exact roles and desired grants must be stated and tested. Removing broad table policies requires replacement RPCs for direct host mutations that have no existing RPC. The service-role start path and one-time `/api/setup` endpoint also need explicit disposition, not only better logging.

**Rationale:** Security changes can either leave holes or break the host if applied as broad statements.

**Impact:** The team can believe production is pinned to invite-only when it is not, or remove required access without a compatible app release.

**Recommended action:** Use a production configuration runbook or supported infrastructure automation, then verify the public Auth settings endpoint. Define a complete grant matrix. Revoke default `PUBLIC` access for every relevant function owner. Replace direct sensitive writes with narrow RPCs. Disable or remove `/api/setup` after bootstrap and rotate its secret.

**Open questions:** How will hosted Auth drift be detected? Which database roles create functions in every environment? Is `/api/setup` still needed?

**Reference:** Supabase documents `config.toml` as local-project configuration, while hosted signup is controlled by Auth project settings: <https://supabase.com/docs/guides/local-development/cli/config> and <https://supabase.com/docs/guides/auth/general-configuration>.

### R25 — Privacy, access, and retention rules are missing

**Relevant section:** P2.1–P2.5 and P3.3  
**Status:** Confirmed issue  
**Priority:** P1  
**Type:** Privacy and compliance

**Description:** New actor IDs, errors, rejected claims, exports, and free-text void reasons can contain staff or customer information. The spec does not define access, retention, deletion, export audit, redaction, or whether names are forbidden in free text.

**Rationale:** The project deliberately anonymises winners. New observability features must preserve that policy.

**Impact:** The remediation can create a larger personal-data footprint than the current app.

**Recommended action:** Add a small data-classification table covering each new field. Restrict audit/export access, set retention periods, redact logs, and add UI wording that forbids customer names where appropriate.

**Open questions:** How long must financial and operational records be retained? Are staff UUIDs and emails allowed in exports? Who can read technical logs?

### R26 — The test plan does not trace to the risks being fixed

**Relevant section:** §2, §4 “Done when”, §8, and §11  
**Status:** Confirmed issue  
**Priority:** P0  
**Type:** Testing

**Description:** The existing 67 tests cover helpers. The PostgreSQL harness applies only four selected migrations. There is no test matrix mapping each P0/P1 item to unit, SQL, integration, browser, concurrency, failure-injection, and manual rehearsal evidence.

**Rationale:** The highest risks occur across browser, server action, RLS, Realtime, and database transactions.

**Impact:** Green tests may not exercise the changed path at all.

**Recommended action:** Add a requirement-to-test matrix. Run all 26 migrations from empty state and an upgrade from production-shaped fixtures. Add real JWT tests for anon, pending, host, and admin; lost-response tests; two-device races; settlement failure/retry; token refresh; and a full-night browser rehearsal.

**Open questions:** Which tests run on every PR versus before release? Can a sanitized production-shaped fixture be committed?

### R27 — Browser, device, and accessibility release criteria are missing

**Relevant section:** P0.10, §8, §11, and Appendix A accessibility findings  
**Status:** Confirmed issue  
**Priority:** P1  
**Type:** Accessibility and UX

**Description:** The spec only gives a 4.5:1 contrast target for one screen. It does not state a WCAG level, minimum touch target, keyboard behaviour, focus handling, screen-reader naming, reduced motion, colour-independent states, zoom, safe areas, TV viewing distance, or supported devices.

**Rationale:** The host UI is mobile and time-critical. Several confirmed findings involve mis-taps, colour-only state, invalid nested controls, and inaccessible click targets.

**Impact:** A host can validate the wrong number or be unable to operate a recovery control.

**Recommended action:** Target WCAG 2.2 AA for interactive staff/player surfaces where practical. Define at least 44×44 px touch targets for critical controls, visible focus, non-colour state cues, reduced-motion behaviour, and real-device testing.

**Open questions:** Which host phones and TV browser are used? Is a colour-blind host a known requirement? What viewing distance should the TV support?

### R28 — Capacity and performance targets are absent

**Relevant section:** §11 and Appendix A 69/82/139  
**Status:** Confirmed issue  
**Priority:** P1  
**Type:** Performance

**Description:** There are no expected counts for guest phones, displays, sessions, games, history rows, or concurrent hosts. There are no latency, Realtime lag, polling load, recovery, or page-load targets.

**Rationale:** Three-second polling per client plus Realtime can create avoidable load. Unpaginated admin and export pages worsen over time.

**Impact:** The app may pass a one-device rehearsal but fail when many guests scan the QR code.

**Recommended action:** Define realistic peak concurrency and SLOs. Load-test a five-hour session with expected guest phones, Realtime interruptions, and history growth. Add pagination and query limits before scale makes them urgent.

**Open questions:** What is the venue capacity? How many guests are expected to use the follower view? What delay is acceptable between host and TV?

### R29 — Monitoring, alerting, and live-night runbooks are absent

**Relevant section:** P2.5 and §11  
**Status:** Confirmed issue  
**Priority:** P0  
**Type:** Operations

**Description:** The spec proposes storing failures but does not define health signals, dashboards, alerts, ownership, or procedures for auth failure, Realtime failure, settlement failure, database outage, stuck controller, stale TV, or bad deployment.

**Rationale:** Live-night problems need a clear response within minutes.

**Impact:** The team may detect a money or display failure only when a player reports it.

**Recommended action:** Define operational alerts for failed host actions and pot settlement, plus Realtime/database health. Write a one-page live-night runbook with manual call tracking, pot reconciliation, controller takeover, TV recovery, and support contacts.

**Open questions:** Who is on call during the event? Which failures should page someone immediately? What is the manual fallback kit?

### R30 — Environment, rollout, smoke-test, and rollback plans are absent

**Relevant section:** §10 and §11  
**Status:** Confirmed issue  
**Priority:** P0  
**Type:** Deployment

**Description:** The plan does not define local, staging, preview, and production parity; Vercel environment checks; Supabase project linkage; database-before-app ordering; backward compatibility; backup point; rollback/forward-fix strategy; maintenance window; or production smoke tests.

**Rationale:** RLS, RPC signatures, enum values, Realtime publication, and app code must be deployed in a compatible order.

**Impact:** A safe code change can still cause an outage during deployment.

**Recommended action:** Add a deployment checklist per block. Include pre-deploy backup, migration preflight, deploy order, post-migration SQL checks, role smoke tests, display/host smoke tests, rollback limits, and named decision maker.

**Open questions:** Is there a production-like staging project? Can database migrations be rolled forward quickly? Is deployment allowed on event day?

### R31 — The dependency upgrade is treated as lower risk than it is

**Relevant section:** P1.11  
**Status:** Confirmed issue  
**Priority:** P1  
**Type:** Dependency management

**Description:** The current audit does report 10 high findings and Next 16.3.2 is offered as a non-major fix. However, the findings include direct and transitive production and development packages. A framework upgrade can change proxy, server-action, build, and runtime behaviour. “Score 1 (XS)” has no regression allowance.

**Rationale:** Security fixes are needed, but package counts do not equal exploitable production paths and an automated audit fix still needs review.

**Impact:** The upgrade can be under-tested or combined with unrelated live-flow changes.

**Recommended action:** Make the dependency update its own PR. Capture audit before/after, lockfile changes, release notes, production dependency scope, and full regression results. Add a CI audit policy with an explicit exception process.

**Open questions:** Which advisories affect deployed runtime paths? Does 16.3.2 require any code or hosting changes?

### R32 — Use one canonical backlog instead of three overlapping lists

**Relevant section:** §4–§10 and Appendix A  
**Status:** Optional improvement  
**Priority:** P2  
**Type:** Simplification

**Description:** The P0/P1/P2/P3/P4 narrative, seven delivery blocks, and 164-entry appendix overlap.

**Rationale:** One canonical table makes ownership, status, dependencies, and acceptance clear while the prose remains a useful explanation.

**Impact:** Less planning overhead and fewer missed items.

**Recommended action:** Keep the appendix as evidence. Use one deduplicated implementation backlog and one short decision log.

**Open questions:** Which issue tracker will be authoritative?

### R33 — Prefer reversible state changes over destructive workflows

**Relevant section:** P1.1–P1.5 and P2.2  
**Status:** Optional improvement  
**Priority:** P2  
**Type:** Simplification

**Description:** Soft archive, explicit cancellation, and compensating ledger entries are simpler to reason about than delete/unlink/reverse workflows.

**Rationale:** Auditability and recovery improve when history is retained.

**Impact:** Fewer dangerous branches and less manual database repair.

**Recommended action:** Add `archived_at` or status fields for pots and sessions. Use append-only corrections for pot money. Restrict hard delete to unused test data.

**Open questions:** Is permanent deletion required for any business or privacy reason?

### R34 — Decide which product document is authoritative before refactoring

**Relevant section:** §8 and §9  
**Status:** Optional improvement  
**Priority:** P2  
**Type:** Product governance

**Description:** The old PRD conflicts with the current product, while the remediation spec both cites it and proposes retiring it.

**Rationale:** Refactoring against an unsettled product contract risks preserving the wrong behaviour.

**Impact:** Time can be spent on offline support, named winners, sound, templates, or player features that are no longer wanted.

**Recommended action:** Create a short current product baseline first. Mark each old PRD requirement as retained, changed, delivered, or retired. Then schedule refactoring.

**Open questions:** Are named winners still prohibited? Are sound, templates, password reset, and full offline operation still required?

## Suggested wording corrections

These are targeted changes only; they do not rewrite the original document.

1. **§1 readiness statement**

   Replace “the app is safe to run a night on once items P0.1 to P0.10 below are done” with:

   > Completing P0.1–P0.10 removes the most visible immediate risks, but production approval also requires the release gate in section X: full migration tests, real host-role browser rehearsal, failure-injection checks, production configuration review, backup confirmation, and business sign-off.

2. **§2 findings count**

   Replace “164 remain” with:

   > 164 verified register entries remain. The appendix intentionally includes duplicates from different review lenses, so the number of unique implementation defects has not yet been established.

3. **P0.1 configuration wording**

   Replace “add a checked-in `supabase/config.toml` recording the auth settings so the toggle is not invisible” with:

   > Add `supabase/config.toml` for local parity, and separately document or automate the hosted production Auth setting. The checked-in file does not itself enforce the production dashboard setting.

4. **P2.1 export wording**

   Replace “This is also the answer to ‘what if the database is lost’” with:

   > This provides an operator-readable session export. Database loss is handled separately through managed backups, schema migrations, configuration recovery, and a tested restore runbook.

5. **§9 incorrect feature statement**

   Remove “duplicate session” from the “never built” list. It is implemented and used by the admin dashboard.

6. **Appendix B history statement**

   Replace “`/admin/snowball` shows current pot values and their history” with:

   > `/admin/snowball` shows current pot values. Pot history is stored but is not currently displayed.

## Readiness conclusion

### Readiness rating

**Diagnostic review:** strong.  
**Implementation specification:** not ready.  
**Production release plan:** not ready.  
**Immediate production security posture:** unsafe until self-sign-up is disabled and verified.

### Key required changes

1. Disable production self-sign-up immediately and verify the public Auth endpoint rejects signup.
2. Build one deduplicated backlog with a disposition for every appendix finding.
3. Resolve the business decisions for ties, resets, voids, abandoned games, pot correction, jackpot type, prize edits, offline behaviour, and deletion/archive.
4. Expand the live-night release gate to include omitted idempotency, settlement, host-write, completion, controller, display, and recovery risks.
5. Add exact acceptance criteria and a requirement-to-test matrix.
6. Move CI and full migration replay ahead of all remediation blocks.
7. Add migration, deployment, backup, smoke-test, monitoring, and rollback plans.
8. Run a production-like rehearsal with real admin, host, pending, TV, and guest clients under network failure.

### Unresolved decisions

- How staff accounts are invited, approved, reset, disabled, and audited.
- Whether legitimate host accounts are trusted against direct API use.
- Whether host calling must work fully offline or uses a manual fallback.
- How standard and snowball ties split prizes and rounding.
- Whether settled real sessions can ever be reset.
- How voiding a settled jackpot creates a compensating pot entry.
- Whether pots are archived or deleted.
- Whether `jackpot` is a supported game type and which stage receives its prize.
- Which monitoring provider, retention policy, and alert owner apply.
- Which browsers, phones, TV setup, accessibility target, and guest concurrency are supported.
- Which document becomes the current product source of truth.

### Major risks

- The public self-sign-up route currently grants host capability.
- The remediation can be declared complete while known live-night failures remain outside P0.
- Money corrections can corrupt later pot history if implemented as rollback rather than compensation.
- Auth/RLS changes can break production if database and app releases are not compatible.
- A session export may be mistaken for a real backup.
- No full host-role, browser, migration, network, load, or production-configuration proof exists yet.

### Recommended next steps

1. Apply and independently verify the production signup toggle now.
2. Hold a short decision session for the unresolved business rules.
3. Deduplicate Appendix A and produce the canonical release backlog.
4. Create CI, full migration replay, and a production-like test environment.
5. Write the release gate and acceptance tests before implementing live-flow changes.
6. Deliver auth and direct-write hardening first, using compatibility-safe migrations.
7. Deliver live-flow and money fixes in small PRs with failure-injection tests.
8. Run a complete rehearsal, record evidence, fix any failures, then make a named go/no-go decision.
