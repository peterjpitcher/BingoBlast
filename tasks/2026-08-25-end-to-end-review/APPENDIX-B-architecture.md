# Appendix B: architecture and flow map

Produced 2026-08-25 as part of the end-to-end review. This describes the application **as it
actually is today**, not as the PRD or the older design documents describe it. Two corrections were
applied to the generating agent's text where it was wrong, and are marked inline.

## 1. A night, end to end

**Setup (admin).** An admin signs in at `/login` (invite only, there is no sign-up path) and lands on `/admin`, the sessions list. `createSession` inserts a `sessions` row; `duplicateSession` copies an existing session and its games. Inside `/admin/sessions/[id]` the admin builds the running order with `createGame`, `updateGame`, `duplicateGame` and `deleteGame`. Each game records its type (standard or snowball), its stage sequence (Line, Two Lines, Full House), its prizes and, for a snowball game, which pot it draws from. Pots themselves live at `/admin/snowball` and are managed by `createSnowballPot`, `updateSnowballPot`, `resetSnowballPot` and `deleteSnowballPot`. Once a session is edited past the drafting stage the destructive edits are refused by the database, not the browser: `update_game_safe` locks the game's state row and silently narrows itself to non-structural fields once a game has started, and `delete_game_safe` and `delete_session_safe` refuse outright if any game has started or any winner exists.

**Running the night (host).** The host opens `/host`, picks a session and a game, and `startGame` fires. That action shuffles a 1 to 90 sequence, writes a `game_states` row, claims the controller lock for this host, and flips the session to `running` with `active_game_id` pointing at the game. If the game is a cash jackpot game it also asks for the amount and writes it into the game's prize text before starting. The host page then holds the lock alive with `sendHeartbeat` on a timer; another host can take over through `takeControl` only if the lock is unheld, already theirs, or the current holder's heartbeat is more than thirty seconds stale.

Calling balls goes through `callNextNumber`, which does nothing itself except call the Postgres function `call_next_number`. That function takes a `for update` lock on the game's state row and then checks, under the lock, that the caller is a host, is the controller, that the game is in progress, not on a break, not paused for a claim, that balls remain, and that the minimum gap since the last call has elapsed. Only then does it draw and commit. Undo is the mirror image: `voidLastNumber` calls `void_last_number`, which takes the same lock, refuses if a live (non-voided) winner was recorded on that ball, and puts the ball back in the bag. Breaks, pausing for a claim, resuming, moving between stages and ending the game are `toggleBreak`, `pauseForValidation`, `resumeGame`, `advanceToNextStage`, `skipStage` and `endGame`.

**Following along (display and player).** `/display` redirects to `/display/[sessionId]` when exactly one non-test session is ready or running, otherwise it shows a picker. The big screen renders a QR code pointing at `/player/[sessionId]` so guests can follow on their phones. Both screens read only `game_states_public`, never `game_states`, so the shuffled number sequence is never exposed. Both subscribe over Supabase Realtime and also poll on a short interval as a fallback, and both discard any payload whose `state_version` is not newer than what they hold. Neither screen shows a ball the instant it is drawn: `reveal-queue.ts` paces the reveal by `call_delay_seconds` so the TV does not run ahead of the host's voice, and snaps to the server state immediately during a claim check or at game end.

**Winners and the pot.** When someone shouts, the host pauses and types the claimed numbers. `validateClaim` re-reads the called list server side, insists the claim includes the most recent ball, checks the count against the stage, and returns either valid or the specific invalid numbers. `recordWinner` then calls `record_winner_atomic`, which locks the state row, derives the call count and expected stage itself, inserts the `winners` row and updates the on-screen win banner in one transaction. The host's browser mints a claim key when the modal opens and sends it every time, so a retry after a dropped connection cannot pay the same prize twice, while a genuine tie carries a different key and saves normally. For a snowball Full House the host must explicitly choose eligible or not eligible, and the jackpot window is re-checked inside the function against the pot's own `current_max_calls`.

Ending the game triggers settlement. `endGame` calls `settle_snowball_pot`, which locks the pot row, works out from the `winners` table whether the jackpot was actually won (ignoring voided wins), writes the audit row and moves the pot in the same transaction. Reset and rollover values come from the pot's own base and increment columns. The host supplies a game id and nothing else. When the last game in a session completes, `maybeCompleteSession` marks the session completed.

**Afterwards.** `/admin/history` lists past winners, `/admin/backup` is NOT an export: it is an unlinked page that renders the pre-shuffled bag for every game ever played, with no download (see SPEC section 6), and `/admin/snowball` shows current pot values and their history. Wins can be voided with a reason by an admin through `voidWinner` or `voidWinnerFromHost`; a host can only tick "prize given", and only through `set_winner_prize_given`.

## 2. Every write path

| Table | Written by | Mechanism | Guard |
|---|---|---|---|
| `sessions` | admin create/update/status/duplicate | direct insert/update | admin RLS; `updateSession` proves the row landed, `updateSessionStatus` does not |
| `sessions` | `startGame`, `endGame`, `maybeCompleteSession` | direct update | host RLS policy on sessions |
| `sessions` | `delete_session_safe`, `reset_session_safe` | RPC | admin assert plus refusal if any game started or any winner exists |
| `games` | admin create/duplicate | direct insert | admin RLS |
| `games` | `updateGame`, `deleteGame` | `update_game_safe`, `delete_game_safe` | admin assert, row lock, structural fields frozen once started |
| `games` | `startGame` writing the cash jackpot prize | direct update, service-role client when the key is present | host authorisation in the action only |
| `games` | `deleteSnowballPot` clearing `snowball_pot_id` | direct update | admin RLS |
| `game_states` | `startGame`, `takeControl`, `sendHeartbeat`, `toggleBreak`, `pauseForValidation`, `resumeGame`, `endGame`, `announceWin`, `advanceToNextStage`, `skipStage` | direct update, always `.eq()`-bound to the controller and expected status, always with `.select()` and zero rows treated as a conflict | host or admin RLS plus the bound conditions |
| `game_states` | `callNextNumber`, `voidLastNumber`, `recordWinner` | `call_next_number`, `void_last_number`, `record_winner_atomic` | row lock, all prechecks inside the lock |
| `game_states_public` | nothing in the app | `sync_game_states_public()` trigger only | no write policy exists at all |
| `game_states.state_version` | nothing in the app | `bump_game_state_version` before-update trigger | not writable by any client |
| `winners` | `recordWinner` | `record_winner_atomic` | idempotent on the client claim key, unique index enforces it |
| `winners.prize_given` | `toggleWinnerPrizeGiven` | `set_winner_prize_given` | host assert, writes that one column, returns the persisted value |
| `winners.is_void` | `voidWinner`, `voidWinnerFromHost` | direct update with `.select()` | admin-only RLS and an admin-only check in the action |
| `snowball_pots` | admin create/update/reset/delete | direct insert/update/delete | admin-only RLS; the update and reset paths do not prove the row landed |
| `snowball_pots` | host, at game end | `settle_snowball_pot` only | host assert, pot row lock, every value derived from the pot row |
| `snowball_pot_history` | admin update/reset | direct insert | admin-only RLS; a failed audit insert is logged and swallowed |
| `snowball_pot_history` | settlement | `settle_snowball_pot` | same transaction as the pot move, unique per pot and game |
| `profiles` | new sign-up | `handle_new_user` trigger, defaults to host | trigger only |
| `profiles.role` | `/api/setup` | service-role update to admin | `SETUP_SECRET`, compared in constant time |

## 3. What is genuinely well built

**The money and the balls are decided inside the database, not the browser.** Every host action that can cost the pub cash runs as a `security definer` Postgres function that takes a `for update` lock on the row it is about to change and then re-checks its conditions under that lock. This is not decoration. It is what stops two host phones on a flaky pub wifi both drawing ball 47, and what stops a re-ended game settling the pot twice.

**Winner recording cannot double-pay.** The host's browser mints one claim key per Record Winner modal and reuses it on every retry. The key lands in a uniquely indexed column, and `record_winner_atomic` checks it before anything else, so a retry after a timeout returns the existing state rather than inserting a second win. The design deliberately avoids keying on game and stage, because a genuine tie legitimately produces two wins on the same ball.

**Hosts can settle the pot without being able to name a value.** The pot tables stay admin-only in RLS. A host reaches the pot solely through `settle_snowball_pot`, which derives reset versus rollover from the winners table and both new figures from the pot's own base and increment columns. Widening RLS instead would have let a host with a browser JWT write any figure to the pot by hand-crafted API call.

**Direct updates prove they landed.** Almost every remaining `.update()` on `game_states` and `winners` calls `.select()` and treats zero rows as a conflict. Without that, an update filtered out by RLS returns no error and no rows, and the action would report success while nothing was written. That exact bug previously made a host's "prize given" tick a lie, and the fix is now applied as a house pattern.

**The public screens cannot see or write the private state.** `game_states_public` is a mirror maintained solely by a trigger, has a read-everything policy and no write policy at all, and carries no `number_sequence`. A guest phone loading `/player/[sessionId]` therefore cannot read the upcoming balls, and cannot alter anything.

**Ordering is monotonic, not clock-based.** `state_version` is bumped by a before-update trigger and compared by `isFreshGameState()`. This removes an entire class of bug where Realtime and the polling fallback overlap and an older snapshot overwrites a newer one because the timestamps happened to tie.

**Deletion is defended by the database.** Started or completed games cannot be deleted, and sessions with started games or recorded winners cannot be deleted, because `delete_game_safe` and `delete_session_safe` refuse. The admin UI could be bypassed entirely and the refusal would still hold.

## 4. Data model

| Table | Holds | Lifecycle | Who can write |
|---|---|---|---|
| `profiles` | One row per staff login, with role `admin` or `host` | Created automatically on sign-up as `host`; upgraded to admin out of band | Trigger on sign-up; admins; `/api/setup` with the secret |
| `sessions` | One bingo night: name, date, status, active game, test flag | draft to ready to running to completed; can be reset back to ready | Admins fully; hosts may update status and active game |
| `games` | One game within a night: order, type, stages, prizes, pot link | Created before the night; structure frozen once the game starts | Admins only, and `startGame` for the cash jackpot prize text |
| `game_states` | Live private state: shuffled sequence, called balls, stage, controller lock, version | Created at first start, mutated all night, deleted on session reset | Hosts and admins, mostly via locked RPCs |
| `game_states_public` | Public-safe mirror of the above, minus the sequence | Kept in step automatically | Nothing. Trigger only |
| `winners` | One audit row per recorded win, always anonymous, with claim key and void flag | Insert-only during play; voided later if needed; cleared on session reset | Insert by host or admin via RPC; `prize_given` by host via RPC; void by admin only |
| `snowball_pots` | Current and base jackpot amount and call window per pot | Long-lived across sessions; rolls over or resets each snowball game | Admins directly; hosts only via `settle_snowball_pot` |
| `snowball_pot_history` | Audit trail of every pot movement, and the settlement claim | Append-only, one row per pot per game | Admins directly; settlement function |