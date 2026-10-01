# Spec: claims on screen, start and end of night, events carousel and review QR

**Version:** 2, 30 September 2026. Version 1 (same date) was reviewed in `tasks/review-2026-09-30-guest-display-and-events.md`; section 17 maps every finding to its change here.
**Status:** Released on 1 October 2026. The reliability slice is production deployment `dpl_HD6VoCiYRdRBAqA4uEzECcJ138PB` (commit `0d5faf3`); the features are deployment `dpl_FwYnHWHVhTPuXVVwh75ztZeaFdD2` (commit `677ddca`), with the four migrations applied as versions `20261001075034`, `20261001075215`, `20261001075401` and `20261001075456`. The migration files in this repo carry those applied versions; where this spec says M1, M2a, M3 and M2b it means those four, in that order.
**Author:** Claude, for Peter Pitcher (owner)
**Repo baseline:** `main` at `d12b836`. Production app https://bingo-blast-ten.vercel.app (Vercel project `oj-cashbingo`). Production database Supabase `bcmorqsgeumtmhvctvgu` (eu-west-2, Postgres 17).
**Other repos involved:**
- `OJ-AnchorManagementTools` owns events, opening hours, short links and the feedback page. Its only change is written up separately (5.6).
- `OJ-The-Anchor.pub` hosts the public event pages. No change.

**Next live night:** Wednesday 18 November 2026, "Snowball Showdown Cash Bingo" (read from the live events feed, 30 September).

---

## 0. Decisions

**Made by the owner, 30 September 2026:**

| # | Decision |
|---|---|
| D1 | The claimed numbers appear on the TV and phones **as the host taps them**, for transparency. The server's verdict follows when the host taps Check Win. (The reviewer preferred publishing only at Check Win. The owner chose live. Section 5.2 handles the ordering and recovery this needs.) |
| D2 | The house rules wording in 5.3 is approved. |
| D3 | Do the bigger-text change now, as a size-only pass. |
| D4 | The TV keeps "Kitchen Open Until 9pm". The owner confirms 9pm is correct. It is not taken from the management app. (X19 is withdrawn, and review finding R17 no longer applies.) |
| D5 | Phones show the upcoming events and a "Tell us how we did" button at the start and end of the night. |
| D6 | The management app's feedback page change is written up separately, so the Google option is offered to every guest (5.6). |
| D7 | This spec is committed on a docs branch and pushed. |
| D8 | Build everything now. Production migrations and deployment wait for the owner's explicit yes (section 12). The owner gave that yes on 1 October 2026: bingo ran on 30 September, so the release can go out. |

**Built overnight on the recommended option, and confirmed by the owner on 1 October 2026:**

| # | Decision |
|---|---|
| A1 | **Late claims are the host's call.** If a claim misses the last number called, the host decides whether it came before that number was announced (undo it and re-check) or after (reject as late). The app does not guess from timings, because the TV can lag. |
| A2 | **Jackpot shares.** A snowball jackpot is shared only between the tied winners who were eligible for it. The ordinary stage prize is shared between all tied winners, as now. |
| A3 | **Which session a TV joins.** The TV joins a session that is running, or ready and dated today or earlier. A ready session dated in the future waits for its date. After the night ends, the TV stays on the end-of-night loop until 04:00 London time the next morning, then returns to `/display`. |
| A4 | **Rehearsal.** Run it on production data with a test session, using `/display?rehearsal=1`, which also lists test sessions. Test sessions already never move the snowball pot. |
| A5 | **The review invitation stays switched off** (`NEXT_PUBLIC_REVIEW_INVITE_ENABLED` unset) until the management app's feedback page offers Google to everyone. Events ship regardless. |
| A6 | **Event QR links.** When an event has no management short link, the QR uses the website's event-id link. That link works but loses its tracking tags, because the website's redirect drops them (R13). |

---

## 1. Summary

**What changes for the room:**

- **Claims.** While the host checks a claim, the TV and phones show each claimed number as the host taps it. Each is ticked if it has been called and crossed if not, followed by the server's verdict. Today the TV shows only "Checking Claim" and the last ball.
- **Before the first game.** The TV plays a loop: a large "follow the numbers on your phone" QR code, the house rules, the next bingo night, and upcoming events from the management app, each with its image and a QR code. Phones show the rules and the events.
- **After the last game.** The TV plays the thank-you, the next bingo night, and upcoming events, plus a large review QR once the review page is policy-safe. Phones show the events and a review button.
- **Readability.** Text on the TV, phones and host screen gets bigger, to set minimums, with no restyling. The house rules gain the legal basics and clearer play rules. A Rules button stays available on phones throughout the night.
- **The TV runs itself.** It can be left on `/display` permanently: it finds tonight's session, tells the phases of the night apart, picks up new releases by itself, and moves on to the next night.

**What does not change:** colours, fonts, components and layout style (the design-system overhaul comes later); paper tickets; anonymous winners; money rules; the admin and host role boundary. There are no code changes in the website. In the management app there is one read-only API key (issued in its settings) and one small, separate feedback-page change.

**The biggest problems found and fixed** (section 6):
1. **Live connections churn.** On the host screen, TV and phones, the live connection tears itself down and rebuilds in a loop after any reconnect.
2. **"Resume calling" after a win carries on at a stage that has already been won.**
3. **The TV announces "LINE WINNER!" before the win is recorded.**
4. **Retrying a stage move can skip a stage.**
5. **A failed snowball pot settlement is silent.**
6. **The night never formally ends** if any game is unplayed.
7. **Long-lived screens never pick up new releases.**

---

## 2. Evidence base

**What was done (30 September 2026, read only):**

- Full reads of the TV, phone and host screens, the host and admin actions, the shared libraries and all 45 migrations, in five discovery passes. The key bugs were re-verified by hand (X1, X4, X5).
- **Production checks (read only):**
  - The migration history matches the repo 1:1 (45 of 45).
  - `game_states_public` has no claim data.
  - There are 8 sessions, all `completed`, each with 10 games and 13 to 16 winners. None has a voided winner.
  - Tonight's session ran from 19:19 to 21:37 London time.
  - The snowball pot stands at £180 within 58 calls.
  - Sign-up is disabled, and new accounts default to `pending`.
  - Leaked-password protection is off.
- **Vercel production environment** (30 September): only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are set. That means:
  - `NEXT_PUBLIC_SITE_URL` is not set; the QR origin comes from request headers.
  - `SUPABASE_SERVICE_ROLE_KEY` is not set; `startGame` already falls back to the host's cookie client.
  - `ERROR_SINK_URL` is not set, so the error sink is a no-op in production today.
  - `LOG_ERRORS` is not set.
- **Live screens.** The TV and phone end-of-night screens were viewed at 1920x1080 and 375x812.
- **Live events feed** (website public proxy): 10 upcoming events, all with square and 16:9 images hosted on `tfcasgxopxegwrabvwat.supabase.co`. Slugs are up to 75 characters, and the next `bingo-night` is 18 November. Music Bingo uses the category `music-bingo`.
- **Review QR.** It decodes to `https://l.the-anchor.pub/cvf4k7`, which redirects (307) to the management feedback page with `utm_source=in_game_screen`. The reviewer confirmed that the short link has no expiry.
- **Management feedback page** (`OJ-AnchorManagementTools/src/app/(feedback)/feedback/page.tsx`): "I enjoyed my visit" links to Google, and "It could have been better" goes to a private form.
- **Tooling.** `npm run lint` and `npm run typecheck` pass. `npm test` and `npm run test:utc` both run 126 tests: 125 pass and 1 is skipped (it needs `SUPABASE_DB_URL`).
- **External sources.** Gambling Commission guidance and Google's review policy were read at source (links in section 9).

**Not verified before build:** the pub's actual TV (assumed 1080p, viewed from 4 to 6 m); the realtime churn in a real browser (it was shown in a Node simulation and in the library source); the management API's authenticated responses with the new key (read from code); and the exact field names for per-event screen short links on the single-event route (confirmed at build time).

---

## 3. How it works today

### 3.1 A night in data

- **Sessions:** `draft`, then `ready` (admin), then `running` (admin "Start Session", or the host starting a game), then `completed`.
  - Only `maybeCompleteSession` (`src/app/host/actions.ts:323-371`) sets `completed`, and only when every game has a completed state.
  - There is no end-of-night action, no lifecycle timestamps and no session version.
- **Games:** `not_started` (no `game_states` row), then `in_progress`, then `completed`.
  - `startGame` writes game state, then the session, as separate statements (`actions.ts:487-625`).
- **Live flags:** `on_break`, `paused_for_validation` and `display_win_*` on `game_states`, copied by trigger to the public `game_states_public`. The TV and phones follow that table over Realtime, with a 3-second poll as backup.
- **Stages:** Line needs 5 numbers, Two Lines 10, Full House 15 (`src/lib/win-stages.ts:4-8`).
- **Snowball:** a Full House within the pot's call limit wins the pot. The host must choose whether the winner was eligible.

### 3.2 The TV today (`src/app/display/[sessionId]/display-ui.tsx`)

| Situation | What the TV shows |
|---|---|
| No session (`/display`) | A small "No Active Games" card. It never refreshes (`display/page.tsx:14-25`) |
| Before the first game, and between games | "Session Starts Shortly", "Kitchen Open Until 9pm", House Rules (`:876-895`) |
| Game running | One large current ball and a footer with recent calls. There is **no 1 to 90 board** |
| Claim check | "Checking Claim" and "Claim must include [last ball]" (`:949-978`). The claimed numbers are never shown |
| Win | "LINE WINNER!" from `announceWin` as soon as the check passes, then "BINGO!" once recorded |
| Break | "Break Time", the kitchen card, House Rules |
| Night over | "Thanks For Coming", a static "Book For Our Next Event" card, House Rules |
| Always, except loading, claim and win | A 100px "Play Along" QR at level H (`:1120-1131`), scannable from about 0.6 m |

The TV stays on one session for good, has no wake lock, and never reloads to pick up a new release.

### 3.3 The phone today (`src/app/player/[sessionId]/player-ui.tsx`)

- **Before the start:** "Waiting for Host" and nothing else.
- **During a claim:** "Checking Claim / Claim must include N".
- **After the night:** "Thanks for coming! Please book for our next bingo event at the bar."
- **At no point:** rules, events or a review link.

### 3.4 The claim flow today

1. **Check Claim** calls `pauseForValidation`, which sets `paused_for_validation`.
2. The host taps numbers into local React state only (`game-control.tsx:57`).
3. **Check Win** calls `validateClaim`, which only reads and never writes. It does not reject duplicates.
4. **If valid:** `announceWin` publishes "LINE WINNER!" (`game-control.tsx:928`). Then Record Winner calls `record_winner_atomic`, which is keyed by a React-ref claim key (`game-control.tsx:93`, `:100`, `:1054`).
5. **If invalid:** the TV stays on "Checking Claim" until the host resumes.

The claimed numbers and the claim identity never leave the host's device, so a reload or a takeover loses them.

---

## 4. Goals and non-goals

**Goals:**

- **G1.** The room sees what is being claimed, number by number, and a server-issued verdict. The public wording is honest that the host still inspects the paper ticket.
- **G2.** One claim attempt survives dropped responses, a reload and a takeover on another phone, and records at most one winner.
- **G3.** Starting, finishing, ending and resetting a night follow one locking rule, so a completed night never has a running game.
- **G4.** The TV and phones reliably tell apart: before the first game, in a game, between games, and night over. They never regress to older data.
- **G5.** A follow-along QR, event QRs and a review QR that can be scanned from the room, with events that fail closed (never blank, never an error message).
- **G6.** House rules that cover the legal basics, stay available throughout the night, and explain how to win.
- **G7.** Minimum text sizes without restyling.
- **G8.** Fix the problems found that affect a live night, money, or the screens being changed.

**Non-goals:**

- The design-system overhaul.
- A 1 to 90 board on the TV.
- Events during breaks. (Added afterwards at the owner's request, 1 October 2026: see section 18.)
- A log of refused claims.
- Audio, digital tickets or winner names.
- The remaining security and admin backlog (section 13).
- Any website change.

---

## 5. Design

### 5.1 Night lifecycle: one lock order, timestamps and phases

**Rule.** Every lifecycle transition runs in **one database transaction** and locks **the session row first**, then the game-state rows. This applies to starting, re-opening, finishing, ending and resetting. No trigger on `game_states` writes to `sessions`, because that would reverse the lock order.

**Session columns (M1):**

- `started_at timestamptz null`: set once, inside `start_game`, when the first game starts. An ordinary re-open keeps it. Reset clears it.
- `completed_at timestamptz null`: set by a `before update` trigger on `sessions` when `status` becomes `completed`, and cleared when it leaves `completed`. Repeating an end never overwrites it, because the trigger only fires on the transition.
- `state_version bigint not null default 0`: bumped by the same trigger on every update. Public screens use it to ignore older session snapshots (R09).
- **Backfill:** `started_at` is set from the earliest game `started_at`, only where it is null, so a rerun is safe. `completed_at` is **not** backfilled; historic end times are unknown and stay null. Nothing reads `completed_at` to decide the phase.

**New and changed functions (M1).** All are `security definer` with `search_path = public, pg_catalog`, called with the cookie client, with `revoke ... from public, anon` and `grant execute ... to authenticated, service_role`:

| Function | Behaviour |
|---|---|
| `start_game(p_game_id uuid, p_number_sequence integer[] default null)` | Checks `assert_is_host()`. Locks the session, then the game state. Refuses with `night_ended` if the session is `completed`; a re-open of an ended night must go through an admin status change first. Refuses with `other_game_in_progress` if another game in the session is in progress. Then one of three things: creates the state if it does not exist (the TypeScript side still generates the shuffled sequence with `crypto`; the database checks it is a permutation of 1 to 90); re-opens a completed game (status `in_progress`, `ended_at` null, stage kept, as now); or takes control of an in-progress game. Finally sets the session to `running`, sets `active_game_id`, and sets `started_at` if it is still null. Returns the state. Replaces the separate writes in `startGame`, and the service-role write client there. |
| `finish_game(p_game_id uuid)` | Checks `assert_is_host()` and the controller. Locks the session, then the game state. Sets `completed`, sets `ended_at` if it is not already set, and clears the pause, break, win and claim fields. Clears `active_game_id` if it points at this game. If every game in the session is now completed, sets the session `completed`. Returns `{ game_state, session_completed }`. Used by `endGame` **and** by final-stage advance and skip (X9). Idempotent: finishing an already-completed game returns its current state. |
| `end_night(p_session_id uuid)` | Checks `assert_is_host()`. Locks the session. If it is already `completed`, returns success with its existing timestamps. If any game is in progress, refuses with `game_in_progress`. Otherwise sets `completed` and clears `active_game_id`. Unplayed games stay `not_started`, and their snowball pot is untouched. |
| `reset_session_safe` (changed) | Also sets `started_at = null`; the trigger clears `completed_at` when the status leaves `completed`. It already locks the session first. |

- `maybeCompleteSession` is removed; completion lives in `finish_game`.
- Admin `updateSessionStatus` stays a direct single-row update with `.select()` (X11). The trigger stamps it.
- Snowball settlement stays a separate call **after** `finish_game`, and now requires the game to be completed (X7).

**Phase function.** `getNightPhase()` in `src/lib/night-phase.ts` is pure and used by the TV, the phones and `/play`. Precedence, first match wins:

| Order | Phase | Rule |
|---|---|---|
| 1 | `night_over` | `status = 'completed'` (including an empty session, or one ended with unplayed games) |
| 2 | `in_game` | The active game's state is `in_progress`. Sub-states: `claim_check`, `win`, `break`, `calling` |
| 3 | `before_start` | `status` in (`ready`, `running`) and `started_at` is null |
| 4 | `between_games` | Anything else with `started_at` set |

- **Public session reads:** all four narrow selectors (`display/[sessionId]/page.tsx:17`, `display-ui.tsx:100`, `player/[sessionId]/page.tsx:16`, `player-ui.tsx:92`) add `start_date, started_at, completed_at, state_version`, with matching types in `src/types/database.ts`. A new shared constant replaces the four copies.
- **Host UI.** The host dashboard gets **End the night**, with a modal (not a browser `confirm()`) that lists any unplayed games. The final-game "End Game & Finish Session" goes through `finish_game`, then `end_night` if the session is still open.
- **Copy.** Between games, the TV and phone both say "Next game coming up", with the next game's name and colour, not "Session Starts Shortly".

### 5.2 Claims shown live, with one durable attempt (request 1, D1)

**Claim attempt.** Each claimant gets one **attempt id** (a uuid).

- The host's phone mints it when the host taps **Check Claim**, or **Check another claimant**, which replaces "Validate Another Winner".
- The server stores it at the start of the check. It then identifies every draft, the verdict, any undo and the recorded winner.
- It **is** the winner's idempotency key: `record_winner_atomic`'s existing `p_client_request_id` receives the attempt id. So a committed save, retried after a reload, the next stage or a takeover, returns the existing winner and never creates a second one.
- A genuine second claimant needs an explicit **Check another claimant**, which mints a new attempt.

**Private columns on `game_states` (M2a):**

- `claim_attempt_id uuid`
- `claim_stage_index integer` and `claim_call_count integer`: snapshots taken when the check starts.
- `claim_draft_seq integer not null default 0`
- `claim_undo_used boolean not null default false`

**Public columns** (on `game_states` and mirrored to `game_states_public`):

- `claim_numbers jsonb`: tapped numbers in tap order.
- `claim_result text`: one of `valid`, `invalid` or `late`.

**Protection.** One `before update` trigger function on `game_states`, `guard_claim_fields()`:

1. When `paused_for_validation` is false, it clears every claim field. This covers resume, break, advance, skip, finish and restart in one place.
2. Otherwise, it rejects any change to a claim field unless the transaction-local setting `bingo.claim_write` is `on`. Only the claim functions below set it.

Staff can still update other `game_states` columns directly (section 9); they can no longer forge a claim or its verdict.

**Functions (M2a).** All check `assert_is_host()` and the controller, lock `game_states` `for update`, and return a `code` on refusal.

| Function | Behaviour |
|---|---|
| `begin_claim_check(p_game_id, p_attempt_id, p_new_claimant boolean default false)` | Requires `in_progress` and not on a break. **If not paused:** pauses, clears the win fields, stores the attempt and its snapshots, and resets the draft. **If already paused with the same attempt:** does nothing (a safe retry). **If paused with a different attempt:** with `p_new_claimant`, replaces it and clears the claim and win fields; without it, refuses with `attempt_mismatch` and returns the current attempt id, so a reloaded or taken-over phone **adopts** the existing attempt and its draft. Replaces `pauseForValidation`. |
| `set_claim_draft(p_game_id, p_attempt_id, p_numbers integer[], p_seq integer)` | Requires paused, a matching attempt and no verdict yet. Numbers must be 1 to 90 with no duplicates, and no more than the stage needs. If `p_seq` is not above the stored sequence, it returns the current draft unchanged, so a stale or out-of-order write is ignored. Otherwise it stores the numbers in the order given. |
| `check_claim(p_game_id, p_attempt_id, p_numbers integer[], p_reject_as_late boolean default false)` | Requires paused, a matching attempt, and the current stage equal to the snapshot (otherwise `stale_attempt`). The count must equal the stage's requirement; the SQL table of counts matches `win-stages.ts`, enforced by a test. Verdict, in order: **`invalid`** if any number has not been called (returns `invalid_numbers`). **`missing_last_ball`** if every number was called but the last called ball is missing and `p_reject_as_late` is false: stores the numbers as the draft and writes no verdict, and the host decides (A1). **`late`** in the same case when `p_reject_as_late` is true. **`valid`** otherwise. If a verdict already exists for this attempt, it returns it when the numbers match (a safe retry) and refuses with `verdict_already_given` when they differ. |
| `void_last_number(p_game_id, p_attempt_id uuid default null, p_expected_count integer default null)` (changed) | **Not paused:** unchanged. **Paused:** allowed only when the attempt matches, there is no verdict, `claim_undo_used` is false, `numbers_called_count = p_expected_count`, and no non-void winner is on that ball. It then undoes the ball and sets `claim_undo_used`. A repeated tap finds the count changed and refuses with `already_undone`, so only the one ball is removed. |

**Enforcement (M2b, applied after the new host screen is live; section 12).** `record_winner_atomic` changes as follows:

1. It keeps its existing lookup of the idempotency key **first**, so a committed retry still succeeds after unpause or advance.
2. For a new winner, it requires paused, `claim_attempt_id = p_client_request_id`, `claim_result = 'valid'`, and `claim_stage_index` equal to the current stage. It then **re-checks** that the stored `claim_numbers` were all called and include the last ball.
3. The only exemption is Manual Snowball Win. It needs `p_force_snowball_jackpot` **and** a snowball-type game **and** the Full House stage **and** the jackpot window open, all checked under the lock. The flag alone no longer skips anything.
4. The win text becomes stage-specific: "LINE WINNER!", "TWO LINES WINNER!", "FULL HOUSE WINNER!", or the existing snowball text.
5. Money text is shown to two decimal places.

**Host flow:**

- **Tapping a number** updates the grid at once and sends the whole ordered list with `set_claim_draft`. While one send is in flight, the latest list waits and goes next, so there is at most one request at a time and the newest always wins.
- **A failed draft send** shows "TV not updated, retrying" and retries. Correctness never depends on drafts, because Check Win sends the full list.
- **Check Win** calls `check_claim`.
  - `valid`: Record Winner opens. `announceWin` is no longer called (X5).
  - `invalid` or `late`: **Reject & Resume**.
  - `missing_last_ball`: the host sees "This claim does not include the last number called ([n]). Did they call before [n] was announced?" with **Yes: undo [n] and check again** (the bound undo, then the same numbers are re-checked) and **No: reject as late**.
- **After a reload or takeover,** the host screen reads the private claim fields and reopens the claim modal with the same attempt and draft.

**TV and phones** (public fields only):

| State | Shows |
|---|---|
| Paused, draft empty | "Checking a Line claim", "Numbers appear as the caller reads them", "Last number called: 45" |
| Draft (live) | The balls in tap order, each ticked if called or crossed if not, the last called ball marked "last number called", and "3 of 5 numbers read out" |
| `valid` | All balls ticked, "All 5 numbers have been called. The caller is checking the ticket." Once recorded, the win overlay, with the balls still shown |
| `invalid` | Uncalled balls crossed in red. "Not a winner this time: 61 has not been called. The game carries on." |
| `late` | "Too late: the claim had to include 45. The game carries on." |

- Ticks and crosses come from the public `called_numbers`. Pausing already snaps the reveal queue to the server's count.
- Crosses are shapes, not colour alone.
- Up to 15 balls in at most 5 columns: each at least 120px at 1920x1080 and 80px at 1280x720.
- The public wording never claims the ticket itself is valid. The paper ticket is checked by the host (R08).

**Edge cases:**

- **Two claims at once:** checked one after the other with separate attempts; ties become separate winners.
- **Win, then break:** the break clears the pause, so the trigger clears the claim.
- **A dropped check or save response:** the retry uses the same attempt and returns the same result.
- **A delayed old check from an abandoned modal:** refused with `attempt_mismatch` or `stale_attempt`, and writes nothing.

### 5.3 House rules (request 2, D2)

**Approved rules** (`src/lib/house-rules.ts`). The snowball line is built from the live pot values:

1. Over 18s only.
2. Pay for your books before the game starts. Maximum stake £5 per person per game.
3. Play the book colour shown on the screen.
4. Shout as soon as you win. Your claim must include the last number called; once the next number is called, it is too late.
5. Winners on the same number share the prize.
6. If a claim is wrong, the game carries on.
7. The caller's decision is final.
8. Snowball: a Full House within {max calls} calls wins £{jackpot}. If nobody wins it, it grows by £{increment} and {calls increment} calls. You must have played the last three games to qualify.

**How to win:**

- Line: one full row on a ticket.
- Two Lines: two full rows on the same ticket.
- Full House: all 15 numbers on one ticket.

**Where the rules show:**

- **TV:** the `before_start` rules slide, and the break and `between_games` screens.
- **Phone:** the `before_start` screen, plus a **Rules** button that stays available all night, including during play.
- **Host:** the first-game briefing.

The phone copy says it follows the paper game and cannot be used to enter or claim.

**Game identity.** During play, the TV and phone show the game number and the colour word, for example "Game 3 of 10, Blue book", using `getColourName` (`src/lib/colour-name.ts`).

**Legal and operational boundary** (not app features; the designated premises supervisor confirms these before 18 November; section 9):

- Adults only.
- £5 stake limit per person per game, which players must be told about.
- Payment in cash before the game, with no credit.
- No entry fee.
- Stakes returned as prizes, with no profit or levy taken from the bingo.
- No linking with other premises.
- Rules available before and during play.
- Stakes or prizes for bingo checked over **any seven-day period** against £2,000.

The guidance summaries differ on exactly when a licence is needed after the limit is exceeded. The venue should confirm with the Commission or an adviser; this spec takes no position. The app's prize totals are not a record of stakes or of cash paid.

Remove the stale "screenshot baseline" comment in `house-rules.ts`.

### 5.4 Follow-along QR (request 3)

**`/play`** is a public route, not in the auth proxy matcher.

- **With `?s=<uuid>`:** redirects (307) to `/player/<uuid>` when that session exists. It never redirects off-site.
- **Without a parameter:** applies the session rule (A3). When exactly one session qualifies, it redirects to it. Otherwise it shows "No bingo running right now" with the next bingo night and upcoming events (5.5).

**The TV's QR payload:**

- `<origin>/play` when the TV's session is the unique qualifying one. That is about 37 characters: a 29x29 code at level M, where today's is 49x49 at level H.
- `<origin>/play?s=<id>` otherwise, so every QR leads to the session its TV shows (R12). That includes when staff picked a session from the list, and in rehearsal mode.

**Origin** (`getSiteOrigin()` in `src/lib/site-origin.ts`, used for all QR codes), first match wins:

1. `NEXT_PUBLIC_SITE_URL`, if set. It must be an https origin.
2. On production: `https://` plus `VERCEL_PROJECT_PRODUCTION_URL`.
3. On preview: `https://` plus `VERCEL_BRANCH_URL`, or `VERCEL_URL`. A preview never points at production, even if `NEXT_PUBLIC_SITE_URL` exists for all environments; on preview that variable is ignored.
4. In development: the request origin.

**On the TV:**

- **`before_start`:** a follow-along slide with the QR at least half the screen height (at least 540px at 1080p), "Follow the numbers on your phone", "Point your camera at the code", and the address printed without `https://`.
- **During games:** the corner QR uses the same payload, is at least 180px, and never overlaps content at 1280x720.
- **`night_over`:** there is no follow-along QR.

**Optional (not built):** a custom domain such as `bingo.the-anchor.pub`.

### 5.5 Upcoming events (request 5, D5)

**Source.** The management app's `GET /api/events`, fetched server-side only with a new `read:events` key named "Cash Bingo TV", sent as `X-API-Key`.

**One shared cached projection.** It does not depend on phase, session, time or the viewer.

- `getEventsProjection()` (server-only, `src/lib/events-feed/`) returns `{ status, fetchedAt, events, bingoNights }`.
- **General list:** `from_date=<today in London>&to_date=<today + 60 days>&status=scheduled&limit=50`.
- **Bingo nights, fetched separately (R11)** so the next one is never lost behind recurring events or the 8-card cap: the `bingo-night` category id is resolved from `GET /api/event-categories` (cached for 24 hours), then `category_id=<id>&status=scheduled&from_date=<today>&to_date=<today + 120 days>&limit=5`.
- **Detail lookups** (`GET /api/events/{id}`) fetch the per-event screen short links (`pre_event_screen` and `post_event_screen`) for the selected events. They run in parallel, each with a 3-second timeout and a 1-hour cache. A failed detail falls back to the id link for that event only.
- **The whole refresh is bounded to 8 seconds.** The list and category calls have 5-second timeouts.
- **Caching.**
  - The projection refreshes every 5 minutes.
  - **A failed refresh never replaces a good projection.** The cached function throws on failure, and the last good value keeps serving for up to 24 hours.
  - With no good value (a cold start), the result is `error` or `missing_config` straight away.
  - A missing key gives `missing_config`.
- **Error reporting and logging.** Errors go to `reportError()` through Next's `after()`, so reporting never delays the response. Response bodies are never logged.
- **Parsing.** Each event is parsed with zod on its own; a bad event is dropped alone.

**Selection** (a pure function, tested in both time zones):

1. Drop events that have already started.
2. Keep one occurrence per event name (the earliest).
3. Keep 8 at most.
4. Take `bingo-night` events out of the general list; they are only shown through the next-bingo slot.

**Screen data per event** (never the raw event):

- `id`, `title`, `startsAt`
- `category` slug
- `image` (landscape, else square, else hero, else null; plus alt text)
- `qrPre` and `qrPost` (the screen short link when present, otherwise the id link)

The route sends no labels. Clients work out "Tonight", "Tomorrow" or "Fri 16 Oct", and "7pm", at render time from `startsAt` in Europe/London (new helpers in `src/lib/dates.ts`). They also pick `qrPre` or `qrPost` by phase. A cached response is therefore never wrong after midnight or after a phase change (R10).

**Public route.** `GET /api/screen/events` takes no parameters, so there is a single cache entry and phones cannot amplify upstream calls. It returns the projection with `Cache-Control: public, s-maxage=60, stale-while-revalidate=300`.

**Clients:**

- The server page passes the first projection in.
- The TV refreshes every 10 minutes, and phones on load.
- Clients drop events that have started, and the bingo night dated on their own session's `start_date`.
- The **next bingo night** is the first remaining bingo night.
- **Freshness bound:** a cancelled or deleted event leaves the TV within about 16 minutes (5-minute projection, plus 1-minute route cache, plus 10-minute TV refresh).

**Id link.** `https://www.the-anchor.pub/events/<id>?utm_source=<channel>&utm_medium=screen`. The website's canonical redirect drops the tags, so this link is accessible but untracked (A6). The channel values match the management app's channel table.

**Images.**

- `next/image`, with `remotePatterns` for `tfcasgxopxegwrabvwat.supabase.co` under `/storage/v1/object/public/event-images/**`, at no more than 1280px wide.
- Square images are shown whole, beside the text.
- The next image is preloaded.
- On error, the card becomes text only.

**Playlists** (a pure function, `buildPlaylist(phase, projection, now, sessionDate)`):

| Phase | Loop | With no events or an error |
|---|---|---|
| `before_start` | Follow-along (20 s), next bingo (12 s), E1, E2 (12 s each), follow-along, rules (20 s), E3, E4, follow-along... | Follow-along (30 s), then rules (20 s) |
| `night_over` | Thanks (15 s), then the review slide if enabled (20 s), next bingo, E1, E2, and the thanks or review slide again after every two events | Thanks, then the review slide if enabled |
| Idle `/display` | "Bingo nights at The Anchor", next bingo, E1, E2... | "Bingo nights at The Anchor" with `the-anchor.pub/whats-on` |

- With `prefers-reduced-motion` set, there are no transitions.
- The loop pauses while the page is hidden.
- The TV never shows an event error.

**Phones.** At `before_start` and `night_over`, a list of the same events (thumbnail, title, when, and "View event", opening in a new tab). At `night_over`, also the review button when it is enabled.

### 5.6 Review QR (request 6, D6, A5)

- `REVIEW_URL = 'https://l.the-anchor.pub/cvf4k7'` in `src/lib/venue-links.ts`.
- The QR is generated in the app (`QRCodeSVG`, level M), at least half the screen height.
- **Copy:** "Enjoyed tonight? Tell us how we did" and "Scan to leave feedback". There is no incentive, no rating request and no pressure.
- **Gating.** The review slide and the phone button render only when `NEXT_PUBLIC_REVIEW_INVITE_ENABLED=true`. It is set once the management feedback page offers the Google review to every visitor.
- **The management change** is written up in `OJ-AnchorManagementTools/tasks/spec-2026-10-01-neutral-feedback-page.md`. It gives one page with two equal options, "Leave a Google review" and "Send us private feedback", with no sentiment pre-filter. The short link needs no change.
- **Release check:** follow the short link through both options and confirm that every visitor is offered the public review.

### 5.7 Readable text (request 4, D3)

**Floors.** These are provisional targets, confirmed at the rehearsal on the real TV:

| Screen | Viewport | Minimum | Key information |
|---|---|---|---|
| TV | 1920x1080 | 32px | 44px: prize, stage, snowball, recent calls, game and colour, claim verdict |
| TV | 1280x720 | 22px | 30px |
| Phone | 375x812 | 14px; body 16px; inputs 16px | Values 20px |
| Host | 375x812 and up | 14px | Money and closing decisions 16px; buttons at least 44px tall |

The supported TV viewports are 1280x720 and larger, unless the real TV shows otherwise.

**Approach.**

- Change classes screen by screen. Do not change the root font size, because the TV's height is budgeted in rem (`display-ui.tsx:664-674`).
- Add named `text-tv-*` tokens (a `clamp()` with a pixel floor) in `tailwind.config.ts`, so the overhaul can restyle them in one place.
- Change the shared `Input` to 16px text and the `Button` `sm` and `md` sizes to 44px tall. This affects admin forms too; they are covered by the checks below.
- No colour, font-family or component redesign. Arial stays.

**Readability fixes included:**

- Player status cards: use the solid card background, which lifts contrast from 1.4 to 2.0:1 (`player-ui.tsx:741`, `:751`, `:761`).
- TV headlines on the game colour: a backing panel (`display-ui.tsx:879-883`, `:900-904`, `:1041`).
- Reconnect banner contrast and its 44px Refresh button (`connection-banner.tsx:79`, `:85`).
- Host errors in red, distinct from the status banners (`game-control.tsx:1256`, `:1300`).
- Claim grid: a mark on called cells and bigger numbers.
- A `prefers-reduced-motion` rule, and no pulsing on text blocks.

**Acceptance (R14).** The fixture render script covers:

- every TV and phone state at the viewports above;
- the host claim, winner and end-night modals;
- representative admin forms.

It fails on:

- text below the viewport's floor;
- clipped or overlapping elements, and QR obstruction (bounding-box checks);
- `undefined`, `NaN` or `Invalid Date`;
- a zero prize shown to guests as a prize (zero totals elsewhere are allowed).

It also checks keyboard focus return in the modals, and the phone at 200% text zoom with every action still reachable. The longest fallback event QR and the review QR are scanned from the back of the room at the rehearsal.

### 5.8 The TV and phones run unattended

**`/display`** (A3):

- **One qualifying session:** redirect to it.
- **None:** the idle loop, re-checked every 60 seconds.
- **Several:** a list that refreshes itself.
- **A read error:** retry.
- **`?rehearsal=1`:** also lists test sessions (A4).

**`/display/[id]`:**

- At `night_over`, it stays on the end loop until 04:00 London time the next morning, or until another session starts running. It then returns to `/display`.
- It takes a wake lock using the existing `useWakeLock`.

**New releases.** A new `GET /api/build` returns the running deployment id. The build embeds its own id, taken from `VERCEL_GIT_COMMIT_SHA`, in `NEXT_PUBLIC_BUILD_ID` via `next.config.ts`.

- The TV and phones check every 5 minutes and on becoming visible.
- They **reload by themselves** when the id differs, but only at a safe moment: not during a claim check or a win.
- The host screen shows **"A new version is ready: Reload"** and never reloads itself. While the host is in a claim, the banner waits until the claim ends.

**Coherent public state (R09):**

- Session snapshots apply only if their `state_version` is not lower than the current one.
- Game state keeps its existing freshness guard.
- Every poll carries a sequence number. A response started before a newer Realtime event or a newer poll is discarded.
- On a game switch, the new game's state is fetched **before** the new game's name and colour are shown. This applies to the TV **and the phone** (X12b).
- **Polls have an 8-second deadline** (AbortController). A hung request releases the in-flight flag, so later polls continue.

---

## 6. Fixes found during discovery (in scope)

Severity is the consequence; likelihood is on a real pub night. **(re-verified)** means checked by hand.

| ID | Problem | Evidence | Sev / likelihood | Fix | Slice |
|---|---|---|---|---|---|
| X1 | Live connections churn and can pile up reconnect timers (host, TV, phone and pot channels) **(re-verified)** | `game-control.tsx:533-578`; `display-ui.tsx:225-268`, `:292-339`, `:484-523`; the same in `player-ui.tsx`. In realtime-js 2.91.0, `removeChannel` fires CLOSED synchronously when the socket cannot send (`RealtimeChannel.js:363-391`). A late CLOSED from an old channel tears down its replacement. Shipped on 29 July, and has run on two live nights | High / likely after a phone lock or wifi blip | One shared hook, `useRealtimeChannel`, with a generation token. Every callback checks it. The reference is cleared **before** `removeChannel`. There is only ever one pending timer. Tested with a fake channel that fires CLOSED synchronously and late, and across unmount and visibility changes | S0 |
| X2 | A retried stage move can skip a stage | `game-control.tsx:690`, `:1020`; the copy at `:706` and `:1033` says retrying is safe | High / possible | Capture the expected stage index when the modal opens and keep it through ambiguous responses until a definite result | S0 |
| X3 | A dropped Confirm Winner then a re-opened Record Winner mints a new key, giving a duplicate winner | `game-control.tsx:1655`, `:1054` | High / possible | Superseded by the durable attempt (5.2) | S2 |
| X4 | "Close and stay paused" then "Resume calling" carries on at a stage already won **(re-verified)** | `actions.ts:857-884`; the runbook recommends this path | High / likely once used | `resumeGame` refuses with `stage_already_won` when a non-void winner exists at the current stage. The pad then shows **Continue to [next stage]**. Update the runbook | S2 |
| X5 | The TV announces the win before it is recorded **(re-verified)** | `game-control.tsx:928`; `20260825080608:381-404` | Medium / likely | Remove `announceWin` from the check path; stage-specific text in `record_winner_atomic` (M2b) | S2 |
| X6 | A failed snowball settlement is silent on the next-game paths and final-stage advance or skip | `actions.ts:1016-1021`, `:1088-1093`, `:1435-1441`, `:1725-1732`; `game-control.tsx:1012-1037` | High / possible | Every path returns success plus a "pot did not settle" flag. The host sees a retry banner before moving on. The **host dashboard** also lists any completed snowball game with no settlement record, with a Settle button, so the retry survives a reload or leaving the page | S6 |
| X7 | A pot can be settled for an unfinished game | `20260730065531:71-145` | High / unlikely | Require the game to be `completed`, checked under the lock | S6 |
| X8 | A database blip on the host game page gives a 404 or a redirect | `host/[sessionId]/[gameId]/page.tsx:45-46`, `:57-59`, `:69-71`, `:77-79` | Medium-high / possible | Only "no rows" (PGRST116) gives a 404; anything else renders a retry screen | S0 |
| X9 | A final-stage advance or skip leaves the game half-finished | `actions.ts:1401-1423`, `:1703-1716` | Medium / likely | `finish_game` (5.1) | S1 |
| X10 | A game can be re-opened while another is running | `host/dashboard.tsx:80`, `:127`, `:174`; `actions.ts:612-625` | Medium / possible | `start_game` refuses under the session lock; the UI hides the button | S1 |
| X11 | Session writes are not proved to land | `actions.ts:617-624`, `:686-690`, `:956-963`, `:1366-1372`; `admin/sessions/[id]/actions.ts:309-312` | Medium / unlikely | Moved into RPCs, or `.select()` with zero rows treated as an error | S1 |
| X12a | One failed poll switches a pre-game TV to the full-screen "Reconnecting" page | `display-ui.tsx:387`, `:400`, `:418`, `:459`, `:632` | Medium / likely | The same 10-second grace as the banner, on the TV and the phone | S0 |
| X12b | A game switch briefly shows the new name with the old state | `display-ui.tsx:195-209`; `player-ui.tsx:191` | Low / likely | Fetch the state before switching, on both screens (5.8) | S0 |
| X12c | The pot channel can leak | `display-ui.tsx:484-523`; `player-ui.tsx:360-399` | Low / possible | Use the shared hook, with a pot id check | S0 |
| X12d | A TV clock running fast removes the reveal delay | `reveal-queue.ts:95-107` | Medium / possible | A server clock offset from `GET /api/time`, sampled on load and every 10 minutes (the midpoint of the request, keeping the lowest round trip of 3 samples), used when comparing `last_call_at`. The reveal pause (dwell) uses `performance.now()` | S0 |
| X12e | "⚠️ Prize not set" is shown to guests | `display-ui.tsx:1034`, `:1084`; `player-ui.tsx:809` | Low / possible | Host only | S0 |
| X12f | Long names overflow the TV's top bar | `display-ui.tsx:833-834` | Low / possible | Truncate | S0 |
| X12g | Polls can hang for ever | `display-ui.tsx:373-375`; `player-ui.tsx:410-412` | Medium / possible on an unattended TV | An 8-second deadline (5.8) | S0 |
| X12h | Long-lived tabs never pick up new releases | No build check exists | Medium / certain for a permanent TV | Build check (5.8) | S0 |
| X13 | Money shows as "£212.5" | `snowball.ts:34-42` (locked by `snowball.test.ts:67`); `20260825080608:371`; raw values at `snowball-list.tsx:166`, `:172`, `:175` and `session-detail.tsx:701` | Medium / certain whenever there are pence | en-GB formatting in `src/lib/money.ts`, with two decimals when there are pence and thousands separators; the SQL gets the same (M2b) | S0 / S2 |
| X14 | Voided wins look normal on the host card, and "Give Prize" works on them | `game-control.tsx:234-237`, `:1575-1591`; `20260730065446:46-89` | Medium / possible | VOID badge, no button; the RPC refuses | S6 |
| X15 | The manual snowball prize text leaks into the next winner | `game-control.tsx:1540`, `:2330`, `:1049-1056` | Medium / possible | Reset on cancel and on open | S0 |
| X16 | Duplicate numbers are accepted in a claim | `actions.ts:1127-1187` | Medium / unlikely | `check_claim` rejects them | S2 |
| X17 | The server allows undo during a claim check | `20260825080606:168-232` | Medium / unlikely | The bound undo only (5.2) | S2 |
| X18 | Host console Start, Resume and Re-open double-submit; errors use `alert()` | `host/dashboard.tsx:165-187`, `:38`, `:182`, `:257` | Medium / possible | Busy state, in-app error text, modal confirms | S0 |
| X19 | (withdrawn, D4) The kitchen line stays. It moves into `src/lib/venue-links.ts` as `KITCHEN_OPEN_UNTIL = '9pm'`, sourced as "owner, 30 September 2026" | | | | S0 |
| X20 | A session copy date is in UTC | `admin/actions.ts:147` | Low / unlikely | `getTodayIsoDateInLondon()` | S0 |
| X21 | Environment variables are not validated | `src/utils/supabase/*`; `middleware.ts:43-44`; `actions.ts:201-215` | Low / unlikely | `src/lib/env.ts`, imported by `next.config.ts` so it **runs at build**. It requires the Supabase URL and anon key everywhere, and `ANCHOR_API_KEY` in production builds from S4 onwards (a preview builds without it and shows `missing_config`). It validates `NEXT_PUBLIC_SITE_URL` as an https origin when set. The service-role fallback goes, because `start_game` no longer needs it | S0 (S4 for the key) |
| X22 | Jackpot money is missing from totals | `20260825080608:98`, `:133`, `:146`, `:174`; `src/lib/money.ts:39`; `admin/history/page.tsx:53`, `:155` | Medium / certain whenever there is a jackpot | Separate jackpot components (7, M3) | S6 |
| X23 | Documentation drift | `CLAUDE.md` on `NEXT_PUBLIC_SITE_URL`, the service role in `startGame` and the claim flow; `game-control.tsx:273-276`; the runbook | Low | Updated with each slice | All |

---

## 7. Data model and migrations

**Rules for every migration.** Each function:

- is `security definer`, with `set search_path = public, pg_catalog`;
- is guarded by a role;
- runs `revoke all ... from public, anon` and `grant execute ... to authenticated, service_role`;
- is added to the function allowlist in `supabase/tests/replay.test.sql`.

Every migration updates `supabase/tests/harness-schema.sql` and `src/types/database.ts` where they copy the schema. Enum values are never used in the migration that adds them. Migrations keep the version they are applied with. Each migration ships with a tested rollback script for **function definitions only**, in `supabase/rollback/`. Rolling back the app or the functions does not reverse data: a reset, a settled pot or cash already paid stays as it is.

**The order is linear:** M1, then M2a, then M3, then M2b. M1, M2a and M3 are all compatible with the host screen that is live today (suite F proves this). M2b (enforcement) is its own migration so it can be rolled back alone. All four are applied together, outside play, immediately before the features deploy (section 12). M3 and M2b both redefine `record_winner_atomic`: M2b is written on top of M3, and `test:db` tests the final combined definition. Any function whose parameter list changes (for example `void_last_number`) is dropped and recreated with default parameters, so an old caller's argument set still resolves to exactly one function.

**M1, lifecycle (S1):**

- `sessions.started_at`, `completed_at` and `state_version`.
- The `sessions` stamp trigger and the `started_at` backfill.
- `start_game`, `finish_game` and `end_night`.
- `reset_session_safe` clears `started_at`.

**M2a, claims, additive (S2):**

- The private and public claim columns, with public mirror sync and its grants restated (`create or replace` resets `search_path`).
- `guard_claim_fields()`.
- `begin_claim_check`, `set_claim_draft` and `check_claim`.
- The `void_last_number` change.
- `record_winner_atomic` is **unchanged** in M2a, so old and new host screens both work.

**M2b, claims, enforcement (S2, applied after the new host screen is live):**

- `record_winner_atomic` requires the valid attempt and re-checks the numbers.
- The narrowed manual exemption.
- Stage-specific win text and two-decimal money text.

**M3, money (S6):**

- **`winners` columns:** add `jackpot_pool_pence` and `jackpot_share_pence`.
  - `prize_share_pence` becomes the **ordinary** component only. Its pool is parsed from the ordinary prize text, **before** the jackpot text is appended, so a jackpot is never counted twice. A jackpot-only manual description has an ordinary pool of 0.
  - The jackpot pool is the pot amount taken under the lock. It is shared between the non-void eligible jackpot winners at that stage (A2), and the odd penny goes to the earliest.
  - The recompute on insert and on void covers both components.
- **Totals** (history page, session detail, `src/lib/money.ts` helpers) add both components.
- **Historic jackpot rows:** backfilled only where the settlement history records the pot amount for that game. Otherwise they stay null and the history shows "jackpot amount not recorded". Nothing is guessed from today's pot.
- `settle_snowball_pot` requires a completed game (X7).
- `set_winner_prize_given` refuses voided winners (X14).

No new table grants are needed: table-level SELECT and `using (true)` RLS cover the new columns, and Realtime publishes whole rows.

---

## 8. Configuration

| Name | Required | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes, checked at build | Existing |
| `NEXT_PUBLIC_SITE_URL` | No | Overrides the QR origin; must be https when set (5.4) |
| `ANCHOR_API_KEY` | In production builds from S4 | The `read:events` key, server only |
| `ANCHOR_API_BASE_URL` | No; defaults to `https://management.orangejelly.co.uk/api` | Server only |
| `NEXT_PUBLIC_REVIEW_INVITE_ENABLED` | No; off by default | Switches the review invitation on (A5) |
| `NEXT_PUBLIC_BUILD_ID` | Set by `next.config.ts` from `VERCEL_GIT_COMMIT_SHA` | Build check (5.8) |
| `images.remotePatterns` | `next.config.ts` | The management event-images bucket only |

The error sink (`ERROR_SINK_URL`) is not configured in production today, so reported errors go nowhere. The owner decides whether to configure it (section 13).

---

## 9. Security, privacy and compliance

- **Claims.** The claimed numbers and the verdict are public while a check is on screen. They identify nobody, and winners stay `'Anonymous'`.
- **New functions.** They are host-gated and called with the cookie client, so `auth.uid()` is recorded. Controller checks are made under the lock.
- **Claim proof is protected** by `guard_claim_fields()`. Staff can still update other private `game_states` columns directly (Appendix A: `sec-game-states-update-unbounded`). That existing trusted-staff limitation is accepted until the follow-up security spec.
- **Manual exemption.** It needs a genuine snowball Full House inside the jackpot window, checked under the lock.
- **The management key** stays server-side. Only public event fields reach clients, and nothing about players is sent upstream.
- **No open redirects.** `/play` only redirects to `/player/<uuid>` on its own origin. QR targets are built server-side from ids or management short links.
- **The public route** has no parameters and is served from cache.
- **Gambling Commission** ([code of practice, section B](https://www.gamblingcommission.gov.uk/authorities/codes-of-practice/guide/page/section-b-equal-chance-gaming-in-clubs-and-premises-with-an-alcohol-licence); [bingo in pubs and clubs](https://www.gamblingcommission.gov.uk/licensees-and-businesses/guide/page/bingo-in-pubs-and-clubs); [exempt gaming in pubs](https://www.gamblingcommission.gov.uk/licensees-and-businesses/guide/page/exempt-gaming-in-pubs); [pubs and clubs toolkit](https://www.gamblingcommission.gov.uk/authorities/guide/pubs-and-clubs-toolkit)). See the boundary in 5.3. This spec is not legal advice.
- **Google review policy** ([prohibited and restricted content](https://support.google.com/business/answer/7400114?hl=en)): do not selectively ask for positive reviews, and do not pressure people on the premises. Hence A5 and the neutral copy.
- **Owner actions found in passing:** leaked-password protection is off, and the error sink is unconfigured.

---

## 10. Edge cases and failure modes

| Case | Expected behaviour |
|---|---|
| TV opened while the session is `draft` | Idle loop; joins the session when it qualifies (A3) |
| A future session marked `ready` during tonight's `night_over` | Does not take over; waits for its date (A3) |
| Two qualifying sessions | `/display` lists them; the TV's QR carries `?s=` |
| "Start Session" before any game | Still `before_start` |
| Start racing end, reset or another start | One outcome under the session lock; never a running game in a completed night |
| Reset after completion | `before_start` again; the next first game sets a new `started_at` |
| Re-open a completed game | Keeps `started_at`; refused if another game is running or the night has ended |
| End the night with unplayed games | Allowed after confirmation; the pot is untouched |
| Night ended by mistake | Admin sets `running`; `completed_at` clears; `between_games` |
| Draft writes arrive out of order | Lower sequence numbers are ignored |
| The check response is lost | The retry returns the stored verdict |
| The save response is lost, then the phone reloads | Adopts the attempt; the retry returns the existing winner |
| Takeover mid-claim | The new controller adopts the attempt and its draft |
| A delayed old check from an abandoned modal | `attempt_mismatch` or `stale_attempt`; nothing changes |
| Missing the last ball, host says "called before" | One undo, bound to the attempt and the count, then a re-check |
| A repeated undo tap | `already_undone`; only one ball is removed |
| Two claimants | Separate attempts; ties become separate winners |
| Eligible and ineligible jackpot ties | The ordinary prize is shared between all; the jackpot between the eligible only (A2) |
| Void an eligible jackpot winner | Shares recompute; totals agree |
| An old host tab after M2b | Its save is refused. The build check shows the reload banner. The release runs outside play hours and hosts refresh (section 12) |
| An old poll returns after a newer event | Discarded |
| A poll hangs | Aborted after 8 seconds; the next poll runs |
| The events API is down, or returns 401, 429 or 503 | The last good projection for up to 24 hours, otherwise the fallback loop |
| Any event detail fails | That event uses the id link |
| More than 50 recurring events | The next bingo still comes from its own query |
| No bingo within 120 days | The generic "Bingo nights at The Anchor" slide |
| Midnight or a phase change with a warm cache | Labels and QR choice are worked out on the client |
| Clocks change (Sunday 25 October 2026) | London helpers; tests in both time zones either side of the change |
| A new deployment while the TV is mid-claim | The reload waits until the claim ends |
| Review page not yet neutral | No review slide or button (A5) |
| Reduced motion | No animation, no pulsing |

---

## 11. Testing and verification

**Unit tests** (Node test runner, in both London time and UTC):

- the night phase;
- the playlist;
- event selection, with fixtures either side of 25 October;
- QR payloads and the site origin;
- money formatting;
- the claim panel state;
- the draft send queue;
- `useRealtimeChannel` with a fake channel;
- the poll sequencing and deadline;
- the build check's decision about when a reload is safe;
- the clock offset.

**Database tests** (`npm run test:db`, local Docker and CI):

- every branch of `start_game`, `finish_game` and `end_night`, including races between two connections;
- the reset clearing `started_at`;
- the backfill and a rerun of it;
- `begin_claim_check`, `set_claim_draft` and `check_claim`: every code, idempotent retries and stale attempts;
- `guard_claim_fields()`: a direct forge is refused, and the unpause clear still works;
- the bound undo;
- `record_winner_atomic` (M3, then M2b combined): an idempotent retry after an advance, enforcement, a forged manual flag refused, and the genuine exemption;
- jackpot components: one winner, two eligible, eligible plus ineligible, jackpot only, an odd penny, and a void;
- the settle guard;
- the prize-given refusal;
- grants: anon and pending accounts cannot execute any new function;
- the stage counts in SQL match `win-stages.ts`.

**Failure injection:**

- the events fetch fails, with a warm and a cold cache;
- `check_claim` and `end_night` fail;
- a draft send fails;
- a settlement fails, then the page is reloaded.

**Browser run-through** on a local Supabase stack with every migration applied. Host, TV and phone at the viewports in 5.7:

- idle;
- before the start, including the follow-along QR;
- a first game with live claim tapping;
- valid, invalid and late verdicts;
- a missing last ball with undo;
- a win;
- ties;
- a break;
- finishing the last game;
- ending the night;
- the next session being discovered.

**Render script** as in 5.7.

**Gate:** `npm run verify`, `npm run test:utc` and `npm run test:db` all pass for every slice.

---

## 12. Delivery and release

**Slices.** S0 ships as its own PR. S1, S2, S6, S3, S4 and S5 ship together as one features PR stacked on it, because they share the same screen files. The table still records what each slice contains.

| Slice | Contents | Migration |
|---|---|---|
| S0 Reliability | X1, X2, X8, X12a to h, X13 (TypeScript), X15, X18, X19 (constant), X20, X21 | None |
| S1 Lifecycle | 5.1, 5.8 session rules, wake lock, X9, X10, X11 | M1 |
| S2 Claims | 5.2, X3, X4, X5, X13 (SQL), X16, X17 | M2a, M2b |
| S6 Money | X6, X7, X14, X22 | M3 |
| S3 Rules and follow-along | 5.3, 5.4 | None |
| S4 Events and review | 5.5, 5.6 (review switched off) | None |
| S5 Readable text | 5.7 | None |

**Release sequence** (owner's yes at each migration and deployment; never on a bingo day):

This follows the review's second option (R05): one release outside play, with a compulsory host refresh and a tested recovery path. It is simpler than staging enforcement across two deploys, and nights are monthly.

1. Merge and deploy S0. It has no migration.
2. Issue the events key and add `ANCHOR_API_KEY` to Vercel (production and preview).
3. **On a day with no bingo, outside opening hours**, apply M1, M2a, M3 and M2b in one `supabase db push`, then immediately merge and deploy the features PR. Between those two steps the old host screen cannot record a winner, which does not matter because no game is running.
4. Reload every host screen. The build check prompts hosts, and reloads the TV and phones by itself.
5. Rehearsal (A4): a test session with `/display?rehearsal=1` on the pub TV. Scan every QR from the back of the room, run the claim flow including a tie and a late claim, and leave the TV on `/display` through end of night and next-session discovery. Confirm the snowball pot has not moved.
6. Switch on `NEXT_PUBLIC_REVIEW_INVITE_ENABLED` once the management feedback page is neutral.

**Recovery:**

- Function rollback scripts are in `supabase/rollback/`.
- **To roll the screens back to the previous release, first apply `supabase/rollback/20261001075456_claim_enforcement.rollback.sql`, then roll back in Vercel.** M2b refuses any winner recorded without a checked claim, so the previous host screen cannot record winners while M2b is in place (suite F proves both halves). M1, M2a and M3 can stay: they work with the previous screens.
- If M2b blocks a real save during play, the host uses Manual Snowball Win only where it genuinely applies. Otherwise apply the M2b rollback script, which restores the M3 definition.
- The steps are in `docs/runbooks/backup-and-recovery.md`, section 7.

---

## 13. Out of scope and follow-ups

- **Later in this repo:**
  - the design-system overhaul (section 14);
  - a 1 to 90 board on the TV;
  - events during breaks (done on 1 October 2026, section 18);
  - a refused-claims log.
- **Follow-up security and admin spec:**
  - `sec-game-states-update-unbounded`, `sec-sessions-update-unbounded`, `sec-profiles-readable-by-every-account`, `sec-login-next-backslash`;
  - `live-controller-lock-no-release`, `live-stage-cannot-step-back`, `live-reveal-backlog-uncapped`;
  - the proxy treating a failed lookup as signed out;
  - undo idempotency when not paused;
  - missing `catch` blocks in admin;
  - `qual-no-error-boundaries`;
  - host-typed prize text as the payout;
  - archived pots not blocked;
  - the admin form and list items;
  - public-screen failures not reaching the error sink;
  - type drift;
  - the size of `game-control.tsx`;
  - branch protection on `main`.
- **Owner actions:**
  - issue the events key;
  - decide whether to configure `ERROR_SINK_URL`;
  - switch on leaked-password protection;
  - have the designated premises supervisor confirm the section 5.3 boundary.
- **Other repos:**
  - the management feedback page (written up; 5.6);
  - optionally, automatic screen short links: the management backfill cron is not scheduled;
  - optionally, the website keeping tracking tags on its canonical redirect (A6).

---

## 14. UI consistency review (inventory for the overhaul; no action here beyond 5.7)

- **Colour systems.** There are two, and they never meet:
  - the `bingo.*` tokens (pink, amber and indigo) are mostly unused;
  - the real green and gold palette exists as 377 hard-coded hex values, alongside 410 raw palette classes and 488 arbitrary values;
  - a 65-rule `!important` override layer misses modals, the TV and the phone, so admin modals render navy and pink and admin focus rings are pink.
- **Fonts.** Geist is downloaded but overridden by Arial.
- **Type.** There is no scale. Headings range from 14 to 48px, and the TV uses 32 custom sizes.
- **Components.**
  - Button is used 102 times, but 47 uses override its colours and 48 its height.
  - There are 23 hand-made badges.
  - There are 8 browser `confirm()` or `alert()` calls.
  - Void, Delete, Cancel and Sign Out each appear in 2 to 4 styles.
  - Archive, which is reversible, is styled as dangerous, while Manual Snowball Win, which pays out, is not.
- **Terminology.**
  - "Jackpot" means two different things.
  - The claim flow uses four names.
  - Prize status has six labels.
  - Copying is called "Copy", "Duplicate" and "Clone".
  - Stage names and "Game" are consistent.
- **Other.**
  - 29 animation classes do nothing, because no plugin defines them.
  - There are no loading or error route files and no toasts.
  - The TV date reads "September 30th 2026", not the British "Wednesday 30 September 2026".

---

## 15. Assumptions

- The TV is roughly 55", 1080p and viewed from 4 to 6 m, in a Chromium-class browser. This is checked at the rehearsal.
- There is one live session at a time in practice.
- The management app remains the source of truth for events.
- The review short link `cvf4k7` stays live.
- Winners remain anonymous.
- The TV stays on `/display`.
- The event-images bucket is public, as the live URLs load.
- A1 to A6 as in section 0.

---

## 16. Points still worth challenging

1. The live draft adds one write per tap under a lock on `game_states`. Is the single-in-flight send queue enough at the pace a host taps?
2. Does moving `startGame`'s writes into `start_game` preserve the cash-jackpot prize write and the re-open behaviour exactly?
3. Is a single release outside play, with the build check forcing a host refresh, an acceptable stand-in for staging enforcement across two deploys?
4. Is the build-check reload safe on every TV browser the pub might use?

---

## 17. Response to the review of version 1

| Finding | Response | Where |
|---|---|---|
| R01 Persist the claim identity | Adopted. A durable attempt id, used as the winner key, adopted after a reload or takeover, with stale checks refused | 5.2, 7 |
| R02 Serialise lifecycle transitions | Adopted. Session-first locking inside `start_game`, `finish_game`, `end_night` and reset; no game-state trigger on sessions; `end_night` is idempotent | 5.1 |
| R03 Timestamp reset and public reads | Adopted. Reset clears `started_at`, a re-open keeps it, all four selectors change, the precedence is stated, and `completed_at` is not backfilled | 5.1 |
| R04 Jackpot accounting | Adopted. Two components, pools and shares, totals, voids, and historic rows only from recorded evidence. The sharing rule is A2 | 7 (M3) |
| R05 Release compatibility | Adopted, using the review's second option: one release outside play, with migrations applied immediately before the deploy and a forced host refresh through the build check. M1, M2a and M3 are proved compatible with the live screens. The order is linear (M3 then M2b) and the combined function is tested. Rollback scripts are tested, and the limits of rollback are stated | 7, 12 |
| R06 Feedback destination | Adopted. The invitation is switched off until the page is neutral; the change is written up | 5.6, A5 |
| R07 Rehearsal routes | Adopted. `?rehearsal=1` on `/display`, `?s=` QR codes, and preview origins that never point at production | 5.4, 5.8, 12 |
| R08 Late-ball rule | Adopted. Host discretion instead of guessed visibility, a bound single undo, and public wording that says the ticket is checked by the host | 5.2, A1 |
| R09 Coherent public state | Adopted. Session `state_version`, poll sequencing, a poll deadline, and the phone included | 5.8 |
| R10 Event caching | Adopted. One parameterless projection, last good value kept, labels and QR chosen on the client, a bounded refresh, per-detail fallback, and reporting through `after()` | 5.5 |
| R11 Next bingo reservation | Adopted. A separate category query with a 120-day horizon, and a generic fallback | 5.5 |
| R12 Session selection | Adopted. `?s=` whenever the QR is not the unique match; the date rule is A3 | 5.4, 5.8 |
| R13 Fallback tracking | Accepted as untracked | A6 |
| R14 Acceptance beyond fonts | Adopted. Clipping, host and admin screens, keyboard, zoom, provisional floors, a supported-viewport bound, and a narrower zero-prize rule | 5.7 |
| R15 Legal boundary | Adopted. Stakes returned as prizes, any seven-day period, no position taken on licensing, rules available during play, and the supervisor's confirmation | 5.3 |
| R16 Claim trust boundary | Adopted. The guard trigger, the re-check inside recording, and the narrowed manual exemption | 5.2, 9 |
| R17 Hours completeness | No longer applies (D4) | X19 |

---

## 18. Addendum, 1 October 2026: events during breaks

Asked for by the owner the day after the release. It reverses the non-goal in section 4 and closes the follow-up in section 13. No migration and no new configuration.

- **TV, a break in a game:** the break screen (20 s), the next bingo night if there is one (12 s), then the events two at a time (12 s each) with the break screen again after every two, and the rules (20 s) once a loop. A late look at the TV therefore says the game is paused within about 24 seconds. With no usable events (none, an error, no key) the loop is the break screen and the rules, exactly as in section 5.4.
- **Label:** event and next-bingo slides carry the same "Break time" label as the rules slide.
- **One code at a time:** the corner follow-along QR is hidden while a slide with its own QR is up.
- **Backing panel:** during a game the screen is the game's book colour (section 3), which can be white. Event slides are white text drawn for the green screen, so while the night is paused they sit on the rules slide's dark panel. This was found in the browser test, not by the unit tests; the render check (`scripts/check-render.js`) now also reports low contrast.
- **Phones:** the events list of section 5.5 appears under the "On Break" card.
- **Links:** a third link per event, `qrInGame`, from the management app's `in_game_screen` channel, with the same id-link fallback as the other two, so scans from a break are counted apart. `eventLinkForPhase` picks it: pre-event before the night, in-game on a break, post-event after the night and on the idle screen. A cached feed response from before the field existed falls back to the pre-event link.
- **Between games:** the same loop around the "Next game coming up" screen, with that label on the event slides and the in-game links; the phone lists the events under its next-game card. Approved by the owner on 1 October 2026 and released separately from the break loop.

## Appendix A: backlog status re-verified on 30 September 2026

Source: `tasks/2026-08-25-end-to-end-review/BACKLOG.md`, whose status column is stale. Of the 86 rows not marked done:

- **13 are now fixed:**
  - `qual-claim-entry-unsafe-on-a-phone`, `live-composite-advance-break-not-atomic`, `money-admin-pot-write-not-atomic`
  - `money-cash-jackpot-name-regex`, `money-pot-delete-non-transactional`, `qual-history-hides-void-and-prize-given`
  - `qual-paused-with-no-resume-control`, `qual-prod-dependency-vulnerabilities`, `qual-session-reset-leaves-no-record`
  - `qual-skip-stage-no-confirm`, `sec-orphan-booking-function`, `sec-start-game-unvalidated-session-game-pair`
  - `live-snowball-pot-realtime-dead`
- **27 are partly fixed.**
- **43 are still open.**
- **3 no longer apply.**

**Closed by this spec:**

- `live-tv-cannot-follow-session-lifecycle`, `live-no-clean-end-or-abandon`, `live-display-no-wake-lock`
- `host-validate-claim-duplicates`, `qual-ticket-colour-and-game-identity-missing`
- `qual-completion-paths-report-false-success`, `money-settlement-failure-no-retry`, `qual-unproven-updates-report-success`
- `money-format-pounds-pence`, `money-manual-snowball-prize-text-leak`, `money-prize-given-on-voided-winner`
- `live-realtime-reconnect-no-reentrancy-guard`, `live-public-poll-can-hang-forever`
- `qual-player-screen-colour-contrast`, `qual-tv-status-states-not-sized-for-room`, `qual-dates-unlocalised`
- `obs-business-audit-ledger`, in part: claim attempts and verdicts are now stored while a game is paused.

## Appendix B: files expected to change

- **Public screens:**
  - `src/app/display/page.tsx`, `src/app/display/[sessionId]/{page,display-ui}.tsx`
  - `src/app/player/[sessionId]/{page,player-ui}.tsx`
  - new routes: `src/app/play/page.tsx`, `src/app/api/{screen/events,build,time}/route.ts`
  - new components under `src/components/display/`
- **Host:** `src/app/host/actions.ts`, `src/app/host/dashboard.tsx`, `src/app/host/[sessionId]/[gameId]/{page,game-control}.tsx`, `src/components/host/pre-game-briefing.tsx`.
- **Admin:** `src/app/admin/actions.ts`, `src/app/admin/sessions/[id]/{actions,session-detail}.tsx`, `src/app/admin/history/page.tsx`.
- **Libraries:**
  - new: `night-phase`, `events-feed/*`, `venue-links`, `env`, `site-origin`, `build-check`, `clock-offset`, `claim-draft-queue`, and the hook `src/hooks/use-realtime-channel.ts`;
  - changed: `house-rules`, `dates`, `money`, `snowball`, `reveal-queue`, `src/types/database.ts`.
- **Configuration and styles:** `next.config.ts`, `tailwind.config.ts`, `.env.example`, `src/components/ui/{input,button}.tsx`, `src/app/globals.css` (reduced-motion rule only).
- **Database:** `supabase/migrations/*` (M1, M2a, M2b, M3), `supabase/rollback/*`, `supabase/tests/{replay.test.sql,harness-schema.sql}` and new SQL tests.
- **Docs:** `CLAUDE.md`, `docs/runbooks/live-night.md`, `docs/architecture/*`.
