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
| D1 | A new account lands as `pending` and can reach nothing until an admin promotes it | Turning the dashboard signup toggle off is an untracked hosted setting that can drift back. The inert default holds regardless. |
| D2 | `winners` is NOT added to the Realtime publication; the host lists refresh explicitly after each mutation instead | Postgres Changes broadcasts whole rows, and winners SELECT is readable by anon, so publishing it would stream prize text and free-text void reasons to every punter phone. |
| D3 | A snowball pot is archived, never deleted | Its history is the audit trail for real cash. The old delete path destroyed it and usually failed halfway, leaving every game unlinked. |
| D4 | A session reset refuses outright when the session has already settled the pot, rather than rewinding the pot automatically | Later games may legitimately have moved the pot since, so rewinding overwrites real movements with a stale figure. A wrong pot that looks right is worse than a refusal. |
| D5 | A session reset records what it destroyed, including the winners as jsonb, in an append-only log | The winners are anonymous by policy, so the snapshot carries no personal data, and without it a wiped night is unanswerable afterwards. |
| D6 | `resetSnowballPot` no longer clears `last_awarded_at` | That column records when the jackpot was last actually won. A manual correction to the current figures says nothing about it. |
| D7 | The cash jackpot prompt is decided by game type alone, never by the game's name | The name regex overwrote every configured stage prize. All six jackpot games in production are already typed, so nothing depended on it. |
| D8 | Stage advance and skip take an expected stage index from the client and treat a repeat as a no-op | A client key alone does nothing. Binding the write to the index the CLIENT named is what makes a retry inert rather than a second advance. |

---

## Open decisions

### Q1. There is no defined way to invite, promote, disable or deprovision a staff account

Blocks `sec-staff-lifecycle-and-setup-endpoint` (R0-blocker, effort M).

**Question.** Who may approve a new host account, and must a departing staff member lose access the same night? The answer decides whether we build an admin Users screen with session revocation or simply document a Supabase dashboard procedure, and

**Recommendation.** I would recommend the documented procedure first because there is one admin and a handful of hosts.

**Answer.** _(not yet given)_

### Q2. The controller lock can be taken but never released, so a second staff device can lock the host out

Blocks `live-controller-lock-no-release` (R1-before-release, effort M).

**Question.** Should an admin be able to force control away from a device that is still heartbeating, or must the holder release it themselves?

**Recommendation.** allow an admin force-takeover with an audit row, because on a live night the alternative is walking round the pub to find an open tab.

**Answer.** _(not yet given)_

### Q3. A game can only be ended by recording a valid claim, and skipping the final stage leaves dangling state

Blocks `live-no-clean-end-or-abandon` (R1-before-release, effort M).

**Question.** When the host abandons a game part-way, should the snowball pot still roll over for that game, and what happens to a stage prize already announced but never recorded?

**Recommendation.** roll the pot over as normal and record no winner, because an abandoned game consumed no jackpot claim.

**Answer.** _(not yet given)_

### Q4. current_stage_index can only ever increase, so an accidental advance is unrecoverable

Blocks `live-stage-cannot-step-back` (R1-before-release, effort M).

**Question.** Who may step a game back to a stage it has already left, host or admin only, and what happens to a non-void winner already recorded at the stage being abandoned?

**Recommendation.** admin only, confirm-gated, and refuse outright while a non-void winner exists at the target stage.

**Answer.** _(not yet given)_

### Q5. An unattended TV never returns to a later live session

Blocks `live-tv-cannot-follow-session-lifecycle` (R1-before-release, effort M).

**Question.** When more than one session is live at once, which one should an unattended TV show?

**Recommendation.** the most recently started running session, since concurrent sessions are not supported in practice and a picker screen is useless on a TV with no input device.

**Answer.** _(not yet given)_

### Q6. Decide the pub's prize and tie payout rule before the winner data model is changed

Blocks `money-prize-and-tie-accounting-model` (R1-before-release, effort L).

**Question.** 1. When two people share a stage, is the prize divided between them, paid in full to each, or entered by hand, and how is an odd penny rounded? 2. Is the snowball jackpot ever split, or does the first valid claim take it? 3. May an admin correct a stage's prize text after balls have been called, and if so does an already recorded winner keep the old text?

**Recommendation.** split cash stage prizes evenly with the odd penny to the first claim, never split the jackpot, and allow prize edits only for stages not yet won.

**Answer.** _(not yet given)_

### Q7. /admin/backup exports nothing and shows the planned draw order, and it is not disaster recovery

Blocks `obs-session-export-and-disaster-recovery` (R1-before-release, effort M).

**Question.** What Supabase backup tier or point-in-time recovery is enabled, what data-loss window and recovery time are acceptable, and has a restore ever been tested?

**Recommendation.** confirm the tier and run one restore drill before the next live night, because an export cannot restore auth users, roles, RLS or functions.

**Answer.** _(not yet given)_

### Q8. The pot has grown 120 pounds with zero history rows, and no screen reads the history table at all

Blocks `obs-snowball-pot-history-invisible-and-empty` (R1-before-release, effort M).

**Question.** Should the six missing historic movements be backfilled as derived rows marked as a backfill, or left absent with a note?

**Recommendation.** backfill them, because otherwise the 140 pounds currently advertised to the room can never be reconciled from stored data.

**Answer.** _(not yet given)_

### Q9. Server-side failures on the public pages log nothing in production and admin actions leak raw Postgres text

Blocks `obs-technical-error-monitoring` (R1-before-release, effort M).

**Question.** Which error monitoring provider is approved, and what technical data is allowed to leave Supabase and Vercel?

**Recommendation.** a hosted sink with UUIDs and Postgres detail stripped at the boundary, because a database table cannot record a database outage.

**Answer.** _(not yet given)_

### Q10. Write down the accessibility and device release criteria, starting with reduced motion

Blocks `qual-accessibility-release-criteria` (R1-before-release, effort M).

**Question.** Which host phones and which TV browser must be supported, is a colour-blind host a confirmed requirement, and what viewing distance should the TV be legible at?

**Recommendation.** name the actual devices in use and treat colour-blindness as confirmed, since the codebase already justifies getColourName on that basis.

**Answer.** _(not yet given)_

### Q11. reset_session_safe deletes a whole night's winners and game states and records nothing

Blocks `qual-session-reset-leaves-no-record` (R1-before-release, effort M).

**Question.** Should a reset archive the destroyed rows as jsonb in a log table, or soft-delete winners and game_states and filter them from live queries?

**Recommendation.** soft-delete, because it also keeps settle_snowball_pot's evidence trail intact.

**Answer.** _(not yet given)_

### Q12. An orphan SECURITY DEFINER function is anon executable and exists in production but in no migration

Blocks `sec-orphan-booking-function` (R1-before-release, effort XS).

**Question.** Does any other Anchor product call create_table_booking_transaction against this database? It writes to table_bookings, table_booking_items and table_booking_payments, none of which exist here, so

**Recommendation.** I would recommend revoking the PUBLIC and anon grants now regardless and dropping the function only once somebody confirms nothing else calls it.

**Answer.** _(not yet given)_

### Q13. The session lock on adding and cloning games is UI only, and Clone is not even disabled

Blocks `admin-session-lock-server-side` (R2-next-cycle, effort S).

**Question.** May an admin add or clone a game into a session that is already running, for example an impromptu extra game, or must the session be reset to ready first?

**Recommendation.** allow it deliberately with a warning, because pubs do add games on the night, and moveToNextGameOnBreak already picks up an appended game correctly.

**Answer.** _(not yet given)_

### Q14. Define the explicit session and pot commands so corrections stop being ad hoc rewinds

Blocks `money-lifecycle-and-correction-commands` (R2-next-cycle, effort L).

**Question.** 1. May a session that has already settled a snowball pot ever be replayed, or must the admin correct the pot by hand first? 2. Who is allowed to approve a compensating pot adjustment, and does it need a typed reason? 3. Is permanent deletion of a pot or a session ever required for a business or privacy reason, or is a soft archive always acceptable?

**Recommendation.** refuse the replay of a settled session, let any admin post a compensating adjustment with a mandatory reason, and never hard delete.

**Answer.** _(not yet given)_

### Q15. No business action is recorded: no actor on winners, no void ball, no takeover, no refused claim, no admin change

Blocks `obs-business-audit-ledger` (R2-next-cycle, effort L).

**Question.** How long are operational and financial records retained, may staff UUIDs and emails appear in exports, and may a refused claim store the punter's claimed numbers?

**Recommendation.** store the numbers, because they contain nothing identifying and they are the only thing that could reconstruct a disputed win, but set an explicit retention period and restrict reads to admins.

**Answer.** _(not yet given)_

### Q16. An admin edit to a running game reaches neither the host screen nor the pub TV

Blocks `qual-admin-edits-invisible-to-live-surfaces` (R2-next-cycle, effort M).

**Question.** Should mid-game edits propagate to the live surfaces, or be blocked outright while game_states.status is 'in_progress'?

**Recommendation.** propagate the handful of fields the live surfaces read, because a correction to the ticket colour is exactly the edit someone makes mid-game.

**Answer.** _(not yet given)_

### Q17. Set capacity and performance targets before the QR code is put in front of a full room

Blocks `qual-capacity-and-performance-targets` (R2-next-cycle, effort M).

**Question.** What is the venue capacity, how many guests are expected to open the follower view, and what delay between the host calling a number and the TV showing it is acceptable?

**Recommendation.** size for the full room scanning the QR, because that is the advertised behaviour.

**Answer.** _(not yet given)_

### Q18. The display has no audio, though the PRD lists Win, Break and Start sounds as in scope for v1

Blocks `qual-no-display-audio` (R3-backlog, effort S).

**Question.** Build the three sounds, or strike them from PRD 3.1?

**Recommendation.** strike them, because the host already calls the room to attention verbally and an unattended TV that makes noise is harder to live with than one that does not.

**Answer.** _(not yet given)_

### Q19. The PRD's headline resilience requirement is entirely unbuilt

Blocks `qual-offline-capability-unbuilt` (R3-backlog, effort XL).

**Question.** Build the offline queue, or strike FR-47 and FR-48 and tell the host the app needs connectivity?

**Recommendation.** strike them for now, because a queued call replayed against a database that is the sole authority on the ball bag is a hard correctness problem and the immediate harm is fixed by stopping the auto-reload.

**Answer.** _(not yet given)_
