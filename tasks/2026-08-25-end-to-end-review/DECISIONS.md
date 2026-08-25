# Decision log

Generated 2026-08-25. Updated as answers come in.

The previous spec pointed at a numbered questions section that did not exist, which left the tie
and prize rules referenced but undefined. This is that section.

Every open decision carries a recommendation. **If a decision is not made, the recommendation is
what gets built**, except where the row says otherwise, and the assumption is recorded in the
commit that implements it.

## Decisions already taken and implemented

These were made while implementing, under the reasoning given. Say so if any is wrong and it will
be changed.

| # | Decision | Reasoning |
|---|---|---|
| D0 | Self sign-up is switched OFF on the production project | Confirmed by the owner and verified live on 2026-08-25: `GET /auth/v1/settings` returns `disable_signup: true`. This was the one critical hole. |
| D1 | A new account lands as `pending` and can reach nothing until an admin promotes it | Turning the dashboard signup toggle off is an untracked hosted setting that can drift back. The inert default holds regardless. |
| D2 | `winners` is NOT added to the Realtime publication; the host lists refresh explicitly after each mutation instead | Postgres Changes broadcasts whole rows, and winners SELECT is readable by anon, so publishing it would stream prize text and free-text void reasons to every punter phone. |
| D3 | A snowball pot is archived, never deleted | Its history is the audit trail for real cash. The old delete path destroyed it and usually failed halfway, leaving every game unlinked. |
| D4 | A session reset refuses outright when the session has already settled the pot, rather than rewinding the pot automatically | Later games may legitimately have moved the pot since, so rewinding overwrites real movements with a stale figure. A wrong pot that looks right is worse than a refusal. |
| D5 | A session reset records what it destroyed, including the winners as jsonb, in an append-only log | The winners are anonymous by policy, so the snapshot carries no personal data, and without it a wiped night is unanswerable afterwards. |
| D6 | `resetSnowballPot` no longer clears `last_awarded_at` | That column records when the jackpot was last actually won. A manual correction to the current figures says nothing about it. |
| D7 | The cash jackpot prompt is decided by game type alone, never by the game's name | The name regex overwrote every configured stage prize. All six jackpot games in production are already typed, so nothing depended on it. |
| D8 | Stage advance and skip take an expected stage index from the client and treat a repeat as a no-op | A client key alone does nothing. Binding the write to the index the CLIENT named is what makes a retry inert rather than a second advance. |
| D9 | A tied stage prize is split evenly between the winners, with the odd penny to whoever was recorded first | Owner, 2026-08-25. It is what the house rule on the pub TV has always said. Ten ties already exist in the data, two of them cash jackpots recorded at the full amount for each winner. |
| D10 | The snowball jackpot splits like any other prize when tied | Follows from D9. An earlier commit had made at most one winner carry the jackpot, reasoning that the pot resets once; that reasoning was about the pot, not the payout. The pot still resets once. |
| D11 | A stage whose winner rows disagree about the prize is NOT split; each row keeps its own value | The host can edit the prize text when recording, so a stage with a "Bar of Chocolate" winner and a "£10 Cash" winner is reachable. Averaging them would invent a number nobody agreed to, and the first version of the split handed the chocolate winner half the cash. |
| D12 | Staff accounts are managed by hand in the Supabase dashboard, not through a screen in the app | Owner, 2026-08-25. One admin and a handful of hosts, so a screen is more code than it saves. Procedure in `docs/runbooks/staff-accounts.md`. |
| D13 | The six pot movements that predate the audit table are reconstructed and marked as reconstructed | Owner, 2026-08-25. Otherwise the £140 on the TV can never be reconciled. The mapping is forced by the arithmetic rather than chosen, and the migration refuses rather than guesses if that stops being true. |
| D14 | Technical failures go to an external sink, not a database table, through a vendor-neutral boundary | Owner, 2026-08-25. A sink inside the database cannot record the database being unreachable, which is the failure that matters most on a bingo night. No SDK dependency, so it ships without its own regression risk. |
| D15 | Offline host operation is struck from the PRD rather than built | Owner, 2026-08-25. The database decides which ball comes out, which is what stops two devices drawing the same number. Moving that into a phone with no signal trades a reliability problem for a correctness one. The screens surviving a wobble is already fixed, and the paper fallback is written down. |
| D16 | Backups: the project is on the Pro plan, so daily backups exist | Owner, 2026-08-25. Verified the plan directly. Superseded in detail by D17. |
| D17 | Backups: 8 days of daily backups, point-in-time recovery NOT enabled, and no restore drill | Owner, 2026-08-25. The worst case is losing one night, and a night is reconstructable from the paper books and one pot figure. Paying for PITR to protect a few hours of pub bingo results is a poor trade. Revisit if the app ever holds something paper cannot rebuild. |
| D18 | The 43 historic customer names are exported to a file the owner keeps, so nothing depends on the database copy | Owner, 2026-08-25. The in-database archive is a temporary safety net, not the store of record. Once the file is somewhere the owner trusts, the archive table is dropped. |

---

## Open decisions

Six were answered by the owner on 2026-08-25 and have moved into the table above.
These 13 remain, and none of them blocks anything currently in progress.

### Q1. The controller lock can be taken but never released, so a second staff device can lock the host out

Blocks `live-controller-lock-no-release` (R1-before-release, effort M).

**Question.** Should an admin be able to force control away from a device that is still heartbeating, or must the holder release it themselves?

**Recommendation.** allow an admin force-takeover with an audit row, because on a live night the alternative is walking round the pub to find an open tab.

**Answer.** _(not yet given)_

### Q2. A game can only be ended by recording a valid claim, and skipping the final stage leaves dangling state

Blocks `live-no-clean-end-or-abandon` (R1-before-release, effort M).

**Question.** When the host abandons a game part-way, should the snowball pot still roll over for that game, and what happens to a stage prize already announced but never recorded?

**Recommendation.** roll the pot over as normal and record no winner, because an abandoned game consumed no jackpot claim.

**Answer.** _(not yet given)_

### Q3. current_stage_index can only ever increase, so an accidental advance is unrecoverable

Blocks `live-stage-cannot-step-back` (R1-before-release, effort M).

**Question.** Who may step a game back to a stage it has already left, host or admin only, and what happens to a non-void winner already recorded at the stage being abandoned?

**Recommendation.** admin only, confirm-gated, and refuse outright while a non-void winner exists at the target stage.

**Answer.** _(not yet given)_

### Q4. An unattended TV never returns to a later live session

Blocks `live-tv-cannot-follow-session-lifecycle` (R1-before-release, effort M).

**Question.** When more than one session is live at once, which one should an unattended TV show?

**Recommendation.** the most recently started running session, since concurrent sessions are not supported in practice and a picker screen is useless on a TV with no input device.

**Answer.** _(not yet given)_

### Q5. Write down the accessibility and device release criteria, starting with reduced motion

Blocks `qual-accessibility-release-criteria` (R1-before-release, effort M).

**Question.** Which host phones and which TV browser must be supported, is a colour-blind host a confirmed requirement, and what viewing distance should the TV be legible at?

**Recommendation.** name the actual devices in use and treat colour-blindness as confirmed, since the codebase already justifies getColourName on that basis.

**Answer.** _(not yet given)_

### Q6. reset_session_safe deletes a whole night's winners and game states and records nothing

Blocks `qual-session-reset-leaves-no-record` (R1-before-release, effort M).

**Question.** Should a reset archive the destroyed rows as jsonb in a log table, or soft-delete winners and game_states and filter them from live queries?

**Recommendation.** soft-delete, because it also keeps settle_snowball_pot's evidence trail intact.

**Answer.** _(not yet given)_

### Q7. An orphan SECURITY DEFINER function is anon executable and exists in production but in no migration

Blocks `sec-orphan-booking-function` (R1-before-release, effort XS).

**Question.** Does any other Anchor product call create_table_booking_transaction against this database? It writes to table_bookings, table_booking_items and table_booking_payments, none of which exist here, so

**Recommendation.** I would recommend revoking the PUBLIC and anon grants now regardless and dropping the function only once somebody confirms nothing else calls it.

**Answer.** _(not yet given)_

### Q8. The session lock on adding and cloning games is UI only, and Clone is not even disabled

Blocks `admin-session-lock-server-side` (R2-next-cycle, effort S).

**Question.** May an admin add or clone a game into a session that is already running, for example an impromptu extra game, or must the session be reset to ready first?

**Recommendation.** allow it deliberately with a warning, because pubs do add games on the night, and moveToNextGameOnBreak already picks up an appended game correctly.

**Answer.** _(not yet given)_

### Q9. Define the explicit session and pot commands so corrections stop being ad hoc rewinds

Blocks `money-lifecycle-and-correction-commands` (R2-next-cycle, effort L).

**Question.** 1. May a session that has already settled a snowball pot ever be replayed, or must the admin correct the pot by hand first? 2. Who is allowed to approve a compensating pot adjustment, and does it need a typed reason? 3. Is permanent deletion of a pot or a session ever required for a business or privacy reason, or is a soft archive always acceptable?

**Recommendation.** refuse the replay of a settled session, let any admin post a compensating adjustment with a mandatory reason, and never hard delete.

**Answer.** _(not yet given)_

### Q10. No business action is recorded: no actor on winners, no void ball, no takeover, no refused claim, no admin change

Blocks `obs-business-audit-ledger` (R2-next-cycle, effort L).

**Question.** How long are operational and financial records retained, may staff UUIDs and emails appear in exports, and may a refused claim store the punter's claimed numbers?

**Recommendation.** store the numbers, because they contain nothing identifying and they are the only thing that could reconstruct a disputed win, but set an explicit retention period and restrict reads to admins.

**Answer.** _(not yet given)_

### Q11. An admin edit to a running game reaches neither the host screen nor the pub TV

Blocks `qual-admin-edits-invisible-to-live-surfaces` (R2-next-cycle, effort M).

**Question.** Should mid-game edits propagate to the live surfaces, or be blocked outright while game_states.status is 'in_progress'?

**Recommendation.** propagate the handful of fields the live surfaces read, because a correction to the ticket colour is exactly the edit someone makes mid-game.

**Answer.** _(not yet given)_

### Q12. Set capacity and performance targets before the QR code is put in front of a full room

Blocks `qual-capacity-and-performance-targets` (R2-next-cycle, effort M).

**Question.** What is the venue capacity, how many guests are expected to open the follower view, and what delay between the host calling a number and the TV showing it is acceptable?

**Recommendation.** size for the full room scanning the QR, because that is the advertised behaviour.

**Answer.** _(not yet given)_

### Q13. The display has no audio, though the PRD lists Win, Break and Start sounds as in scope for v1

Blocks `qual-no-display-audio` (R3-backlog, effort S).

**Question.** Build the three sounds, or strike them from PRD 3.1?

**Recommendation.** strike them, because the host already calls the room to attention verbally and an unattended TV that makes noise is harder to live with than one that does not.

**Answer.** _(not yet given)_

