# Anchor Bingo: end-to-end review and remediation spec

**Date:** 25 August 2026
**Repo:** `OJ-CashBingo` (BingoBlast), branch `main` at `2fc21d3`
**Production Supabase:** `bcmorqsgeumtmhvctvgu`, eu-west-2, Postgres 17
**Status:** for review. No code has been changed.

---

## 1. The headline

The engine of this app is genuinely well built. The money and the balls are decided inside the
database under row locks, not in the browser, and that is the right call. The problems are not in
the engine. They are in three places around it:

1. **One critical security hole.** Self sign-up is switched on in your Supabase project right now,
   and the database automatically gives every brand new account the **host** role. Anyone who reads
   the public keys out of the `/display` page, signs up, and confirms their own email address can
   drive a live game: call balls, void balls, record winners and move the snowball pot. This is the
   only item in this document I would treat as urgent. It is also mostly fixed by a toggle you have
   to flick yourself.

2. **The current live-game engine has never actually run a bingo night.** Every atomic database
   function the app now depends on (`call_next_number`, `void_last_number`, `record_winner_atomic`,
   `settle_snowball_pot`, `set_winner_prize_given`) was applied to production on the evening of
   29 July 2026, roughly three hours **after** the last session finished. All 87 winner rows in
   production predate the idempotency key. Nothing in the current engine has been through a real
   Friday night. That is not a defect, but it is the single biggest risk in this document, and it
   is why the fixes below are grouped around "what breaks on a real night".

3. **A cluster of live-night failures nobody would notice until they bit.** The host's winners list
   silently never refreshes, so a host cannot tick "prize given" for a win they just recorded. A
   single failed background request silently removes the snowball jackpot prompt and pays a
   qualifying punter nothing. The 30 second "reconnect" logic reloads the page even when the device
   has no network, which replaces the pub TV with a browser error page and throws away a claim the
   host is halfway through typing.

Everything else is smaller: gaps in the record you keep, tidiness, and features the PRD promises
that were never built.

**Bottom line:** the app is safe to run a night on once items P0.1 to P0.10 below are done.
It is not currently safe to leave exposed on the internet with sign-ups on.

---

## 2. What I actually did

| Check | Result |
|---|---|
| `npm test` | 67 tests, 67 pass, 0 fail |
| `npm run lint` | clean |
| `npx tsc --noEmit` | clean |
| `npm run build` | succeeds, 14 routes |
| `npm audit` | 10 high-severity advisories, all with fixes available, including Next itself |
| `bash supabase/tests/run.sh` | **not run.** Docker is not available on this machine |
| Live database | read-only inspection of schema, functions, grants, RLS, triggers, indexes, publication and row counts |
| Deep review | 22 agents: 10 independent lenses over the code and the live database, one adversarial verifier per lens, plus a completeness critic |

The review produced 179 raw findings. 15 were refuted on verification and discarded. **164 remain:
1 critical, 18 high, 62 medium, 83 low.** The full register with evidence is in
[Appendix A](APPENDIX-A-findings.md). The architecture and data-flow map is in
[Appendix B](APPENDIX-B-architecture.md).

Every claim marked CONFIRMED was reproduced by a second agent working independently from the source
or the live database. The two headline items (self sign-up, and the winners realtime gap) I also
verified myself, directly, before writing this.

### What the live database actually contains

- 6 sessions, all completed. 60 games, 60 game states, all completed. 87 winners. 1 snowball pot.
- **One** user account, role `admin`. No host-role account has ever existed, so every
  `role = 'host'` path in the security model is untested against real use.
- All 87 winners have a null idempotency key, confirming the current winner engine is unexercised.
- The snowball pot has moved six times (from 42 calls / £20 to 54 calls / £140) with **zero** rows
  in the audit table that is supposed to record exactly that.
- The `winners` table is **not** in the Supabase realtime publication. Only `sessions`,
  `game_states` and `game_states_public` are.

---

## 3. What is genuinely well built

This is not padding. These mechanisms are the reason the list of critical faults is one item long
rather than ten, and none of the remediation below should weaken them.

- **The database is the referee.** Every host action that can cost the pub money runs as a
  `security definer` Postgres function that takes a `for update` lock on the row it is about to
  change and re-checks its conditions under that lock. Two host phones on flaky wifi cannot both
  draw ball 47.
- **Winner recording cannot double-pay.** The browser mints one claim key when the Record Winner
  modal opens and reuses it on every retry. A retry after a timeout returns the existing state
  instead of inserting a second win, while a genuine tie carries its own key and saves properly.
- **Hosts can settle the pot without being able to name a figure.** The pot tables are admin-only.
  A host reaches the pot solely through `settle_snowball_pot`, which derives every written value
  from the pot row itself.
- **The public screens cannot see the future.** `game_states_public` is a trigger-maintained mirror
  with no write policy and no shuffled sequence, so a punter's phone cannot read upcoming balls.
- **Ordering is monotonic, not clock-based.** `state_version` removes an entire class of bug where
  a poll and a realtime message race and the older snapshot wins.
- **Deletion is defended by the database, not the browser.** Started games and sessions with
  winners cannot be deleted even by a hand-crafted API call.
- **The comments are unusually good.** Several files explain not just what the code does but which
  bug the shape prevents. That is why this review could be as specific as it is.

---

## 4. The ten things that matter (P0)

Do these before the next bingo night. Complexity scores follow the workspace scale.

### P0.1 Close self sign-up and stop the database handing out the host role
**Severity: critical. Complexity: 2 (S). Verified live.**

`disable_signup` is `false` on the production project, and the `handle_new_user` trigger inserts
every new auth user into `profiles` with `role = 'host'`. The `user_role` enum has only `admin` and
`host`, so there is no harmless authenticated tier to land in. The app's `signup()` server action
returns "invite-only" but that is decoration: it does not touch Supabase's own `/auth/v1/signup`
endpoint, which is public.

Two independent fixes, both needed:
- **You** turn off "Allow new users to sign up" in the Supabase dashboard (Authentication,
  Sign In / Providers). I cannot do this from here.
- **I** add a third `user_role` value (`pending`), change `handle_new_user` to insert that instead,
  and add a checked-in `supabase/config.toml` recording the auth settings so the toggle is not
  invisible. `assert_is_host()` and every RLS policy already name roles explicitly, so nothing else
  changes.

**Done when:** a signup against the production auth endpoint is refused, and a manually created
account lands as `pending` with no access to `/host`.

### P0.2 Remove the direct-insert route to `winners`
**Severity: high. Complexity: 1 (XS).**

The `winners` INSERT policy allows any host or admin row insert. A host with a normal browser JWT
can `POST /rest/v1/winners` with `is_snowball_jackpot: true`, and when that game ends
`settle_snowball_pot` believes it and resets the live pot to base instead of rolling it over. This
is exactly the hole the UPDATE side of `winners` is deliberately defended against, left open on the
INSERT side. `record_winner_atomic` is `security definer` and owned by `postgres`, so the host flow
keeps working with no INSERT policy at all.

**Done when:** the policy is dropped, a direct insert from a host JWT is refused, and
`supabase/tests/run.sh` still passes.

### P0.3 Make the host's winners list actually refresh
**Severity: high. Complexity: 2 (S). Verified live.**

Both winner lists on the host screen are kept up to date only by a realtime subscription on
`public.winners`, and that table is not in the realtime publication, so the channels can never
fire. Nothing else re-fetches. In practice: the host records a Line winner, the Winners and Prizes
list still says (0), and they cannot tick "prize given" for the punter standing at the bar. Worse,
this breaks the documented recovery route for a mis-called ball, because the undo refusal sends the
host to a winners list that does not contain the blocking winner.

Fix by calling `refreshWinnerLists()` on every successful record path rather than depending on
replication config, and separately add `winners` to the publication.

**Done when:** recording a winner updates the count and the list without a page reload.

### P0.4 Stop a failed background request silently withholding the jackpot
**Severity: high. Complexity: 2 (S).**

The snowball pot is read once at mount with the error thrown away and never retried. If that one
request fails, the host screen says "this game is not linked to a snowball pot" even though it is,
the mandatory eligible / not-eligible choice disappears, and `recordWinner` sends
`snowballEligible: false`. A qualifying Full House inside the window is recorded as an ordinary
win, the punter is not paid the jackpot, and the pot rolls over instead of resetting. Nothing is
logged and nothing is shown.

Fix: capture and log the error, retry on the existing poll cadence, distinguish "could not load"
from "no pot", and refuse to record a snowball Full House while the pot is unknown.

**Done when:** with the pot request blocked, the host screen says the pot could not be loaded and
Confirm Winner is blocked on a snowball Full House.

### P0.5 Stop the 30 second auto-reload firing when the device is offline
**Severity: high. Complexity: 1 (XS).**

After 30 seconds unhealthy, every surface calls `window.location.reload()`. With no network that
lands on the browser's offline page: the pub TV at the back of the room is dead until someone walks
over to it, and the host device loses a claim it was halfway through typing. Without the reload,
all three surfaces would have kept their last good render and recovered on their own through the
3 second poll and the realtime backoff.

Fix: gate the reload on `navigator.onLine`, and never reload while a host modal is open or numbers
are selected.

**Done when:** with the network cut, the TV keeps showing the last ball and recovers by itself when
the network returns.

### P0.6 Give every host control a visible failure
**Severity: high. Complexity: 3 (M).**

Most host mutation handlers have a `finally` but no `catch`. A dropped request therefore resets the
button to idle and shows nothing at all. The host, seeing nothing happen, taps again. For
`advanceToNextStage` and `skipStage` that second tap skips an entire stage with its prize
unawarded, because the retry re-reads the now-advanced index.

Fix: the same catch and error treatment `handleCallNextNumber` already has, on every handler. For
stage advance and skip specifically, add a client-minted idempotency key per tap, as `recordWinner`
already does.

**Done when:** every host control shows an error when its request fails, and a double tap on
Continue Playing cannot advance two stages.

### P0.7 Fix "Continue and Take Break", which can skip a stage
**Severity: high. Complexity: 2 (S).**

The handler advances the stage first and then issues the break as a second call. If the break call
fails or is lost, the stage has already moved, and a retry advances again.

**Done when:** advance and break are one operation, or the retry cannot advance twice.

### P0.8 Stop a game name containing "jackpot" wiping every configured prize
**Severity: high. Complexity: 2 (S).**

`isCashJackpotGame` falls back to a regex on the game **name**. A standard three-stage game called
"Game 5 - Mini Jackpot" therefore prompts for a cash amount at start, and `startGame` then writes
that amount over **every** stage prize in the database. The admin's Line and Two Lines prizes are
gone permanently, the TV and the briefing advertise the full jackpot for all three stages, and the
prize inputs are locked once the game has started so the admin cannot put them back.

Fix: gate the overwrite on `type === 'jackpot'` only, and never write it to more than one stage.
Pair with P1.4, which unlocks prize text on a started game.

**Done when:** a standard game with "jackpot" in its name starts normally with its prizes intact.

### P0.9 Stop the middleware logging staff out mid-shift
**Severity: high. Complexity: 1 (XS).**

Every redirect in `updateSession` returns a fresh `NextResponse.redirect` that carries none of the
refreshed Supabase auth cookies the client just set. The browser keeps a refresh token that has
already been consumed, so the next request fails and the host is bounced to the login screen from
behind the bar.

**Done when:** the redirect responses copy the cookies, and a session older than the token lifetime
survives a redirect.

### P0.10 Fix the two public-screen dead ends
**Severity: high. Complexity: 2 (S).**

Two separate faults, same symptom, both on the screens the punters look at:
- A transient Supabase read failure during the display's auto-reload calls `notFound()`, which
  renders a static 404 with no JavaScript, no poll and no recovery. The TV stays on
  "This page could not be found" for the rest of the night.
- The player screen paints white text directly on the game's background colour, and your production
  games use pale yellows and peaches to match the paper books. At roughly 1.4:1 contrast the
  "View All Numbers" button is invisible, which is the one thing a punter with a paper book
  actually wants. `getContrastColor` already exists in the codebase and is called from nowhere.

**Done when:** a read failure renders the recoverable shell rather than a 404, and every text run on
the player screen meets 4.5:1 against every colour an admin can pick.

---

## 5. P1: fix in the next changeset

These do not stop a night, but each one either loses money, loses the record, or leaves the app in
a state only direct database work can undo.

| # | Item | Why it matters | Score |
|---|---|---|---|
| P1.1 | `deleteSnowballPot` unlinks every game from the pot, then fails on a foreign key it cannot satisfy | The unlink is committed and irreversible. Historical games silently stop being snowball games. When it does succeed it permanently destroys the pot's entire audit trail | 3 (M) |
| P1.2 | Resetting a session deletes the whole night with no archive and no audit row, and leaves the snowball pot where the deleted night put it | The replayed night can then never settle the pot, because the settlement claim survives the reset. Currently a 24-row silent deletion for the July session | 3 (M) |
| P1.3 | An abandoned game strands the pot. There is no unconditional "End game" | If the host closes the app rather than working through the post-win modal, the game stays in progress for ever and the jackpot never moves. Next week the TV advertises last week's figure | 3 (M) |
| P1.4 | Prize text cannot be corrected once a game has started | A mistyped cash jackpot amount is permanent and public. Contradicts FR-11 | 2 (S) |
| P1.5 | Voiding a jackpot winner after settlement leaves the pot reset when it should have rolled over, and the confirmation text says the opposite | Direct cash error, silently wrong, only fixable by hand | 2 (S) |
| P1.6 | `/admin/history` shows voided winners as ordinary payouts. The void flag is never read | Your permanent record of who was paid is wrong wherever a win was voided | 1 (XS) |
| P1.7 | A tie on a snowball Full House records two full jackpots but the pot resets once | The record says you paid the jackpot twice | 2 (S) |
| P1.8 | Nothing caps a pot's `max_calls` at 90, and nothing enforces one `game_index` per session | A typo makes every Full House win the jackpot. Duplicate indexes make the host screen think two games are the last one | 1 (XS) |
| P1.9 | `voidWinner` is exported but wired to nothing | An admin reviewing a finished night has no way to void a wrongly recorded win | 1 (XS) |
| P1.10 | The pot's own history is written but never displayed anywhere | You cannot see how the jackpot reached its current figure | 2 (S) |
| P1.11 | Upgrade Next 16.1.4 to 16.3.2 and clear the 10 high-severity advisories | All have fixes and none is a major version | 1 (XS) |

---

## 6. P2: the record you keep

The question "is everything tracked and stored properly?" has a clear answer: **the money is
stored properly, the night is not.** These are the specific business questions the current data
cannot answer.

| Question you might ask | Why it cannot be answered today |
|---|---|
| How much did we pay out on 29 July? | `winners.prize_description` is free text ("£10 Cash", "Bar of Chocolate"). There is no amount column and no screen totals anything |
| How did the jackpot get to £140? | `snowball_pot_history` is empty for all six rollovers, and no screen reads it anyway |
| Who recorded this win, and who handed the prize over? | `winners` carries no actor and no timestamps beyond `created_at` |
| Which ball was voided, when, and by whom? | Nothing records a void. The ball simply goes back in the bag |
| How many claims did we check and reject? | Refused claims are stored nowhere. There is no evidence the host checked at all |
| Who was controlling the game at 21:40? | Controller handovers overwrite in place |
| Why is last month's session empty? | `resetSession` hard-deletes the night with no audit row |
| What happened when the app failed mid-game? | All failures go to `console.error` only, so they live in Vercel's log retention and nowhere else |
| Can I get a copy of a night's results? | No. `/admin/backup` is not an export. It is an unlinked page (nothing in the UI links to it) that renders the pre-shuffled bag for every game ever played, on one unpaginated page, with no download |

Proposed P2 work, in order:

- **P2.1 A real export.** One CSV or JSON per session covering games, called numbers, winners,
  prizes, voids and pot movement. Score 2 (S). This is also the answer to "what if the database is
  lost".
- **P2.2 An event log.** One append-only table recording voids, refused claims, controller
  takeovers, session resets and failed actions, with actor and timestamp. Score 3 (M).
- **P2.3 A prize amount column** on `winners`, populated alongside the free text, plus a per-session
  payout total on `/admin/history`. Score 2 (S). Needs a decision from you on tie splitting, see
  question 3 below.
- **P2.4 Fix the audit writes that can silently not happen.** `updateSnowballPot` and
  `resetSnowballPot` move the money in one round trip and log the audit in another, swallow audit
  failures, and never prove the update landed. Move both into one `security definer` function, the
  way `settle_snowball_pot` already works. Score 2 (S).
- **P2.5 A persistent error sink.** At minimum write action failures to a table so the morning after
  is diagnosable. Score 2 (S).
- **P2.6 Timezone correctness.** Four user-facing dates are formatted with raw `Date` methods and no
  timezone, so `/admin/history` renders in the server's UTC locale rather than Europe/London.
  Score 1 (XS).

---

## 7. P3: tighten the security model

None of these is exploitable by a stranger once P0.1 lands, but all of them assume a host account
is trustworthy, and the app's own documented position is that a host holds a real JWT in a browser
and should not be trusted with raw table access.

- **P3.1** `game_states` UPDATE grants a host every column of every row, which defeats the point of
  `call_next_number`'s locked guards: a host can write `called_numbers` by hand. Narrow it, or
  remove the policy and route everything through the existing functions. Score 3 (M).
- **P3.2** `sessions` UPDATE lets a host rewrite any column, including `is_test_session`, which
  switches snowball settlement off entirely. Score 2 (S).
- **P3.3** `winners` SELECT is `using true` to anonymous. Nothing on the public screens reads the
  table, so anyone with the public key can read every prize and every `void_reason`, which is the
  free-text field most likely to name a customer. Restrict to authenticated. Score 1 (XS).
- **P3.4** Default privileges in the `public` schema still hand `anon` EXECUTE on every new function
  and full DML on every new table. This is the recurring trap that has already produced two
  remediation migrations. Fix the default, not the symptom. Score 2 (S).
- **P3.5** `startGame` runs as service-role and never checks the game belongs to the session it was
  told to start. Score 1 (XS).
- **P3.6** `/api/setup` grants the admin role with no audit, no logging and without proving the
  write landed. It reports success even when nothing was written. Score 1 (XS).
- **P3.7** `create_table_booking_transaction` is a `security definer` function executable by
  `anon`, belongs to no code in this project, and no migration creates it. It would vanish on a
  rebuild. Decide whether to drop it. Score 1 (XS), plus a decision.

---

## 8. P4: quality and maintainability backlog

Not urgent, but this is where the next bug will come from.

- `game-control.tsx` is 1,914 lines with 39 `useState`, 8 `useEffect` and 8 inline modals.
  `display-ui.tsx` and `player-ui.tsx` share 574 near-identical lines of data layer, and their
  overlay gating has **already** drifted apart. Extract the shared live-state hook first, then the
  modals. Score 4 (L), must be split.
- No CI at all. `npm test`, lint, typecheck, build and `supabase/tests/run.sh` all pass, and nothing
  runs them on a push. Score 1 (XS) and probably the highest value-per-hour item in this document.
- `settle_snowball_pot` has zero test coverage, and `run.sh` applies only 4 of the 26 migrations.
  `jackpot.ts` and `snowball.ts`, the two money helpers, have no tests at all.
- No `error.tsx`, `global-error.tsx`, `not-found.tsx` or `loading.tsx` anywhere.
- Two incompatible server-action error conventions: host actions redact and map, admin actions
  return raw Postgres messages straight to the screen.
- Ten native `alert()` / `confirm()` dialogs coexist with four purpose-built typed-confirm modals.
  The money screens use the `confirm()` ones.
- Three overlapping colour systems including a 200 line `!important` override sheet that leaks an
  old pink brand into admin focus rings. Hard-coded hex values throughout, against the workspace
  design-token rule.
- Geist Sans is loaded and preloaded but never applied. The body falls back to Arial.
- Every entrance animation class in the app is dead: nothing provides `animate-in`, `fade-in`,
  `zoom-in` or `slide-in-from-*`. Verified absent from the built CSS.
- `.DS_Store` committed in seven directories.
- `src/types/database.ts` is hand-maintained and claims a dozen live-nullable columns are non-null.

---

## 9. Things the PRD promises that do not exist

`docs/PRD.md` is v1.1 dated 24 November 2025 and no longer describes this application. It should be
either updated or retired, because right now it is a source of false requirements.

**Listed in scope, never built:** offline resilience for the host (the PRD's headline reliability
requirement: there is no cache, no service worker, no queue, so a wifi drop stops the night dead),
sound effects on the display, game templates, duplicate session, password reset, named winners.

**Listed out of scope, but built anyway:** the player-side follower screen and the display QR code.

**Stated but not enforced:** the five allowed stage sequences (FR-8), and "once running, structural
fields are locked" (the guard exists in the UI but the server actions accept both a new game and a
clone on a running session).

**One flow gap worth naming separately:** new sessions are created with status `draft`, and both
`/host` and `/display` only list sessions that are `ready` or `running`. If an admin forgets to
click "Mark as Ready", the host arrives to an empty dashboard with no explanation and the TV shows
"Waiting for the next game to start". Nothing prompts for that step.

---

## 10. Proposed sequencing

Each block is one changeset, independently deployable, verified with the full pipeline before the
next starts.

| Block | Contents | Score | Notes |
|---|---|---|---|
| **A. Lock the door** | P0.1, P0.2, P3.3, P3.4 | 3 (M) | Database and config only, no UI. Needs your dashboard toggle to land first |
| **B. Survive a real night** | P0.3 to P0.7, P0.9 | 4 (L), split in two | The live-game correctness block. Would benefit from a dry run on a test session |
| **C. The screens punters see** | P0.8, P0.10 | 2 (S) | Contrast, the 404 dead end, the jackpot name regex |
| **D. Money integrity** | P1.1 to P1.5, P1.7, P2.4 | 4 (L), split in two | All snowball pot and winner-record correctness |
| **E. The record** | P1.6, P1.9, P1.10, P2.1 to P2.3, P2.6 | 4 (L), split | Export, event log, payout totals, void display |
| **F. Housekeeping** | P1.8, P1.11, P3.1, P3.2, P3.5 to P3.7, CI | 3 (M) | |
| **G. Refactor** | P4 | 5 (XL) | Only after A to F, and only with the tests from E in place |

Blocks A and C are safe to ship immediately. Block B changes the code path that runs a live game,
so I would want a full rehearsal on a test session before the next real night, not just a green
pipeline.

---

## 11. What this review did not cover

- **`supabase/tests/run.sh` was not executed.** Docker is not available here. Its 53 assertions are
  taken on trust from the code, not observed.
- **No browser testing.** Everything about the UI is read from the source, the live data and the
  built CSS. Nothing was clicked. The contrast finding, for example, is computed from the hex values
  in your production `games` rows against the classes in the components, not measured on a phone.
- **No load or soak testing.** The claim that the display survives a five-hour night is untested.
- **Deployment configuration was not inspected.** Vercel project settings, environment variables in
  production, and domain configuration are outside what I could read from here.
- **`create_table_booking_transaction`** was left alone. It is anonymous-executable and belongs to
  no code in this repo, so I could not determine who calls it.

---

## 12. Appendices

- [Appendix A: full findings register](APPENDIX-A-findings.md), all 164 findings with evidence,
  failure scenarios, proposed fixes and verification verdicts.
- [Appendix B: architecture and flow map](APPENDIX-B-architecture.md), the app as it actually is
  today, including every write path and the guard on each.
