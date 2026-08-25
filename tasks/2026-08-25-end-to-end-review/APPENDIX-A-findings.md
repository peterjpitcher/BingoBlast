# Appendix A: full findings register

Generated 2026-08-25 from a 22-agent review of the repository and the live production database
(10 independent lenses, one adversarial verifier per lens, plus a completeness critic).
179 raw findings were produced, 15 were refuted on verification, and the 164 below survived.

- `CONFIRMED`: a second agent independently reproduced the fault from source or from the live database.
- `UNCERTAIN`: the answer depends on runtime state that could not be observed. Treat as unproven.
- `CRITIC`: came from the completeness pass, which had no separate verifier.

Some faults were found by more than one lens and appear more than once from different angles.
Duplicates are kept rather than merged so each lens's reasoning survives.

| # | Severity | Area | Finding | Verdict |
|---|---|---|---|---|
| 1 | critical | auth-security | "Invite-only" is enforced nowhere: any new auth user is auto-granted the host role | CONFIRMED |
| 2 | high | admin-flows | Resetting a session leaves the snowball pot where the deleted night put it, and permanently blocks the replay from settling it | CONFIRMED |
| 3 | high | admin-flows | Deleting a snowball pot unlinks every game from it, then fails on an FK it cannot satisfy , the links are gone for good | CONFIRMED |
| 4 | high | auth-security | Every redirect in updateSession discards the refreshed Supabase auth cookies, logging staff out | CONFIRMED |
| 5 | high | code-quality | deleteSnowballPot runs a three-step destructive cascade with no transaction and deletes the money audit trail | CONFIRMED |
| 6 | high | completeness | There is no unconditional End Game, and snowball settlement only ever runs from a completion path, so an abandoned snowball game leaves the jackpot frozen until an admin hand-edits it | CRITIC |
| 7 | high | completeness | The PRD's headline resilience requirement is entirely unbuilt: there is no local cache, no service worker, no PWA, so a Wi-Fi drop stops the night dead | CRITIC |
| 8 | high | completeness | Prize text cannot be corrected on a started game, contrary to FR-11, so a mistyped cash jackpot amount is permanent and a session reset does not restore the original prizes | CRITIC |
| 9 | high | db-integrity | The winners INSERT policy lets a host hand-craft a jackpot win and force a pot reset, the exact hole the UPDATE side is defended against | CONFIRMED |
| 10 | high | failure-paths | A transient Supabase read failure during the display's auto-reload lands the pub TV on a permanent 404 with no client JS to recover | CONFIRMED |
| 11 | high | failure-paths | Most host controls have no catch block: a dropped request silently does nothing, and a blind retry double-advances the stage | CONFIRMED |
| 12 | high | failure-paths | The host's winners lists never update during a game: `winners` is not in the realtime publication, and nothing polls it | CONFIRMED |
| 13 | high | host-live-flow | "Continue & Take Break" advances the stage before the break call, so a failed or lost break request lets a retry skip a whole stage | CONFIRMED |
| 14 | high | host-live-flow | A failed snowball pot fetch silently removes the jackpot eligibility prompt and mislabels the game as having no pot | CONFIRMED |
| 15 | high | host-live-flow | Host winners lists never refresh after a win: `winners` is not in the realtime publication and `handleRecordWinner` does not re-fetch | CONFIRMED |
| 16 | high | money-winner-path | Starting any game whose NAME contains "jackpot" overwrites every stage prize with the full cash jackpot amount | CONFIRMED |
| 17 | high | tracking-observability | resetSession hard-deletes an entire night's record with no archive and no audit row anywhere | CONFIRMED |
| 18 | high | ux-accessibility | game.background_colour is a free colour picker painted behind white text; production games use pale yellows and peaches, hiding the player screen's only control | CONFIRMED |
| 19 | high | ux-accessibility | The connection banner force-reloads after 30s unhealthy, including when the browser is offline, replacing the pub TV with a browser error page and discarding a host's in-progress claim | CONFIRMED |
| 20 | medium | admin-flows | voidWinner is exported but never called , an admin reviewing a finished night has no way to void a wrongly recorded win | CONFIRMED |
| 21 | medium | admin-flows | Nothing prevents two games sharing a game_index, and the host's first/last-game detection then misfires | CONFIRMED |
| 22 | medium | admin-flows | /admin/history lists voided winners as if they were paid , the void flag is never read | CONFIRMED |
| 23 | medium | admin-flows | A standard game whose name contains the word "jackpot" has all its configured prizes overwritten at start, and the admin cannot put them back | CONFIRMED |
| 24 | medium | admin-flows | Nothing caps a snowball pot's max_calls at 90, so a typo makes every Full House win the jackpot | CONFIRMED |
| 25 | medium | admin-flows | "Reset to Ready" is offered precisely while the session is live, and wipes a game in progress with no live-game guard | CONFIRMED |
| 26 | medium | admin-flows | The session-locked guard on adding and cloning games exists only in the UI; the server actions accept both on a running session, and Clone is not even disabled | CONFIRMED |
| 27 | medium | admin-flows | Manual pot edit and reset move the money in one round trip and log the audit in another, swallow audit failures, and never prove the update landed | CONFIRMED |
| 28 | medium | auth-security | game_states UPDATE grants hosts every column of every row, defeating call_next_number's atomic guards | CONFIRMED |
| 29 | medium | auth-security | Hosts can rewrite any column of any session, including the is_test_session flag that switches off snowball settlement | CONFIRMED |
| 30 | medium | auth-security | startGame runs as service-role and never checks the game belongs to the session it is told to start | CONFIRMED |
| 31 | medium | auth-security | winners INSERT policy checks only the caller's role, so a host can hand-craft a jackpot winner row | CONFIRMED |
| 32 | medium | code-quality | The Postgres harness is not wired into any script or CI, and the repo has no CI at all | CONFIRMED |
| 33 | medium | code-quality | display-ui.tsx and player-ui.tsx share 574 identical lines of data layer, and the overlay gating has already drifted | CONFIRMED |
| 34 | medium | code-quality | game-control.tsx is a 1914-line client component with 39 useState, 8 useEffect and 8 inline modals | CONFIRMED |
| 35 | medium | code-quality | maybeCompleteSession swallows every failure silently, including the final session-completion write | CONFIRMED |
| 36 | medium | code-quality | No error.tsx, global-error.tsx, not-found.tsx or loading.tsx anywhere in the app | CONFIRMED |
| 37 | medium | code-quality | Five high-severity advisories in production dependencies, including Next itself, kept out by exact version pins | CONFIRMED |
| 38 | medium | code-quality | The money function settle_snowball_pot has zero test coverage, and run.sh applies only 4 of 26 migrations | CONFIRMED |
| 39 | medium | code-quality | Ranked gaps: the behaviours that would break a game night and have no test of any kind | CONFIRMED |
| 40 | medium | completeness | An admin edit to a running game reaches neither the host screen nor the pub TV: the game row is a static prop on the host page and nothing subscribes to `games` | CRITIC |
| 41 | medium | completeness | The only 1-90 board in the host app lives inside the claim-check modal, and opening that modal immediately pauses the game and puts "CHECKING A CLAIM" on the pub TV | CRITIC |
| 42 | medium | completeness | On the claim grid, called and uncalled numbers share the same background and differ only by text opacity and a 60%-alpha 1px border - on the one screen the app documents as being used by a colour-blind host | CRITIC |
| 43 | medium | completeness | getContrastColor - the exact fix for the pale-game-colour-behind-white-text problem - already exists in the codebase and is called from nowhere | CRITIC |
| 44 | medium | completeness | The app cannot answer "how much did we pay out tonight?" - winners store free text with no amount column and no screen totals anything | CRITIC |
| 45 | medium | completeness | The app has no concept of splitting a prize, while the pub TV displays "Multiple claims share the prize" as a house rule | CRITIC |
| 46 | medium | completeness | There is no way to create a staff account or reset a staff password from inside the app or from anything in this repo, despite FR-3 requiring password reset | CRITIC |
| 47 | medium | completeness | Test sessions are filtered out of /display and nowhere else: Winner History and the host session list show test winners as real, with no marker and no filter | CRITIC |
| 48 | medium | db-integrity | Default privileges still hand anon EXECUTE on every new function and full DML on every new table in public | CONFIRMED |
| 49 | medium | db-integrity | Deleting a snowball pot unlinks every historical game and then fails on a foreign key, leaving irreversible damage | CONFIRMED |
| 50 | medium | db-integrity | games.game_index has no unique constraint per session, and a duplicate makes the host screen think two games are the last one | CONFIRMED |
| 51 | medium | db-integrity | reset_session_safe leaves the snowball settlement claim behind, so a replayed session can never move the pot again | CONFIRMED |
| 52 | medium | db-integrity | The live jackpot pot has moved six times with zero audit rows, and the admin pot actions still swallow audit-write failures | CONFIRMED |
| 53 | medium | failure-paths | The 30 second auto-reload fires while the browser is offline, replacing the live host console with the browser's offline error page and discarding the claim in progress | CONFIRMED |
| 54 | medium | failure-paths | `callNextNumber` has no idempotency key while its own error copy tells the host to retry, so a lost response draws a second unannounced ball | CONFIRMED |
| 55 | medium | failure-paths | The controller lock can be taken but never released, so a second staff device that grabs control locks the real host out for as long as its tab stays open | CONFIRMED |
| 56 | medium | failure-paths | The `/display` landing page never refreshes itself and needs a click when zero or two-plus sessions are live | CONFIRMED |
| 57 | medium | failure-paths | A game can only be ended by recording a winner: an abandoned game leaves the session running for ever, and the only admin escape deletes the night's winners | CONFIRMED |
| 58 | medium | failure-paths | `current_stage_index` can only ever increase, so any accidental stage advance is unrecoverable without wiping the session | CONFIRMED |
| 59 | medium | host-live-flow | The call-next-number transport-error message tells the host to retry a call that is not idempotent | CONFIRMED |
| 60 | medium | host-live-flow | Most host mutation handlers have `finally` but no `catch`, so a dropped request shows the host nothing at all | CONFIRMED |
| 61 | medium | money-winner-path | Admin snowball pot updates report success without proving the write landed, and swallow a failed audit insert | CONFIRMED |
| 62 | medium | money-winner-path | A pot settlement that fails once can never be retried: every route to it is gated on a status the game has already left | CONFIRMED |
| 63 | medium | money-winner-path | Cancelling the Manual Snowball modal leaves the jackpot amount pre-filled in the next Record Winner | CONFIRMED |
| 64 | medium | money-winner-path | Resetting a session leaves the snowball settlement claim behind, so the replayed game never moves the pot | CONFIRMED |
| 65 | medium | money-winner-path | A failed snowball pot fetch silently removes both routes to paying the jackpot and records the Full House as not eligible | CONFIRMED |
| 66 | medium | money-winner-path | A tie on a snowball Full House records two full jackpots but the pot only resets once | CONFIRMED |
| 67 | medium | money-winner-path | Voiding a jackpot winner after the game has settled leaves the pot reset, and the void confirmation says the opposite | CONFIRMED |
| 68 | medium | realtime-sync | The pub TV display never takes a wake lock, contrary to the documented design | CONFIRMED |
| 69 | medium | realtime-sync | Neither public screen can detect "data stopped arriving": the poll in-flight lock has no timeout and pollState never decays | CONFIRMED |
| 70 | medium | tracking-observability | Every admin mutation is both unaudited and unlogged: prize and game changes leave no trace | CONFIRMED |
| 71 | medium | tracking-observability | endGame reports success to the host when the snowball pot demonstrably did not settle | CONFIRMED |
| 72 | medium | tracking-observability | Winner History, the cross-session record of the night, shows voided winners as valid wins and hides prize_given | CONFIRMED |
| 73 | medium | tracking-observability | Every server-side failure on the display and player pages logs nothing in production | CONFIRMED |
| 74 | medium | tracking-observability | updateSnowballPot and resetSnowballPot can write an audit row for a move that did not happen, or move the pot with no audit row, both reporting success | CONFIRMED |
| 75 | medium | tracking-observability | Every snowball pot movement in production history is unrecorded: pot has grown £120 with zero audit rows | CONFIRMED |
| 76 | medium | tracking-observability | winners rows carry no actor and no timestamps beyond created_at: who recorded, who voided, who handed the prize over are all unanswerable | CONFIRMED |
| 77 | medium | ux-accessibility | The 90-number claim grid renders ~26-31px targets on a phone with no textual read-back, so a mis-tap can produce a false "Valid Claim" | CONFIRMED |
| 78 | medium | ux-accessibility | Winner History shows voided wins as ordinary payouts | CONFIRMED |
| 79 | medium | ux-accessibility | On a phone the live host screen never shows which game or which ticket colour is in play once calling starts | CONFIRMED |
| 80 | medium | ux-accessibility | After "Close and stay paused" the host has no Resume control, and the app's own copy points at one that does not exist | CONFIRMED |
| 81 | medium | ux-accessibility | "Skip (No Winner)" sits 8px from "Record Winner" on a valid claim, is irreversible, and has no confirmation while the cheaper Undo does | CONFIRMED |
| 82 | low | admin-flows | Admin list pages fetch every row ever with no limit or pagination, against an 8s statement timeout | CONFIRMED |
| 83 | low | admin-flows | The backup/export tool is unreachable from the UI, exports nothing, and shows the pre-shuffled bag rather than what was actually called | CONFIRMED |
| 84 | low | admin-flows | Duplicating a session stamps the start date from UTC rather than Europe/London | CONFIRMED |
| 85 | low | admin-flows | Winner dates on /admin/history render in the server's UTC/en-US locale, not Europe/London | CONFIRMED |
| 86 | low | admin-flows | The money screen uses a browser confirm() while sessions and games use typed confirmation | CONFIRMED |
| 87 | low | admin-flows | The reset-session modal tells the admin it deletes snowball history that it does not touch | CONFIRMED |
| 88 | low | admin-flows | Unchecking every stage produces a confusing "prize required" error instead of "select at least one stage" | CONFIRMED |
| 89 | low | admin-flows | stage_sequence is written straight from form input with no validation against the win_stage set, and can be persisted as a value no code can handle | CONFIRMED |
| 90 | low | admin-flows | updateSessionStatus reports success on an update it never proves landed, and permits any transition | CONFIRMED |
| 91 | low | auth-security | create_table_booking_transaction is EXECUTE-to-PUBLIC SECURITY DEFINER and belongs to no code in this project | CONFIRMED |
| 92 | low | auth-security | Two overlapping game_states INSERT policies, the narrower one dead | CONFIRMED |
| 93 | low | auth-security | sanitizeNextUrl does not handle backslashes, so a crafted login link breaks the post-login navigation | CONFIRMED |
| 94 | low | auth-security | Every authenticated account can read every staff email address | CONFIRMED |
| 95 | low | code-quality | Ten native alert()/confirm() dialogs coexist with four purpose-built typed-confirm modals | CONFIRMED |
| 96 | low | code-quality | authorizeAdmin is copy-pasted into three files and authorizeHost is a fourth near-copy | CONFIRMED |
| 97 | low | code-quality | next.config.ts is empty: no typed routes, no bundle analysis, and browserslist data is eight months stale | CONFIRMED |
| 98 | low | code-quality | Four user-facing dates are formatted with raw Date methods and no timezone, against the workspace date rule | CONFIRMED |
| 99 | low | code-quality | Dead exported server actions, dead component variants, no-op CSS classes and leftover authoring comments | CONFIRMED |
| 100 | low | code-quality | Two pairs of near-identical host server actions, one pair already drifted on a guard | CONFIRMED |
| 101 | low | code-quality | The host dashboard's Start / Resume / Re-open button has no in-flight guard | CONFIRMED |
| 102 | low | code-quality | Closing a stacked modal restores body scrolling while the modal underneath is still open | CONFIRMED |
| 103 | low | code-quality | Eleven raw console.error/warn calls bypass the redaction helpers, one logging two UUIDs | CONFIRMED |
| 104 | low | code-quality | resetSnowballPot reads the same pot row twice for data it already holds | CONFIRMED |
| 105 | low | code-quality | Three overlapping colour systems, with a 200-line !important override sheet that leaks the old pink brand on admin focus rings | CONFIRMED |
| 106 | low | code-quality | Two incompatible server-action error conventions: host actions redact and map, admin actions return raw Postgres messages | CONFIRMED |
| 107 | low | code-quality | Small typing weaknesses: a boolean/null control flag, a silent role downgrade, and a missing exported return type | CONFIRMED |
| 108 | low | code-quality | The two money helper modules, jackpot.ts and snowball.ts, have no tests at all | CONFIRMED |
| 109 | low | code-quality | Five .update() calls report success without proving the write landed, against the codebase's own documented rule | CONFIRMED |
| 110 | low | completeness | The display has no audio of any kind, though PRD 3.1 lists Win / Break / Start sound effects as in scope for v1 | CRITIC |
| 111 | low | completeness | The ticket colour is spelled out in words only on the host briefing; the pub TV and the follower phone paint the colour and never name it | CRITIC |
| 112 | low | db-integrity | The unindexed-FK, auth_rls_initplan and multiple_permissive_policies advisor warnings are noise at this data volume | CONFIRMED |
| 113 | low | db-integrity | create_table_booking_transaction exists in production but no migration creates it, so it would vanish on a rebuild | CONFIRMED |
| 114 | low | db-integrity | display_winner_name is rendered on both public screens but every write path sets it to null | CONFIRMED |
| 115 | low | db-integrity | The schema has no CHECK constraints at all, so every invariant depends on application code holding | CONFIRMED |
| 116 | low | db-integrity | The profiles INSERT policy checks only the id, so it would grant self-promotion to admin if a profile row were ever absent | CONFIRMED |
| 117 | low | db-integrity | The two admin snowball pot writes use .update() with no .select(), the exact pattern CLAUDE.md forbids, on the money table | CONFIRMED |
| 118 | low | db-integrity | Two comments still cite migration filename 20260730120000, which no longer exists after the July reconciliation | CONFIRMED |
| 119 | low | db-integrity | src/types/database.ts is hand-maintained and claims a dozen live-nullable columns are non-null | CONFIRMED |
| 120 | low | db-integrity | game_states.updated_at is frozen at insert time and mirrored into the public table, where four queries still select it | CONFIRMED |
| 121 | low | failure-paths | The Manual Snowball Win button stays enabled on a completed or paused game | CONFIRMED |
| 122 | low | failure-paths | A game completed via `skipStage` or `advanceToNextStage` leaves `ended_at` null and the session pointing at a finished game | CONFIRMED |
| 123 | low | failure-paths | The session-completion writes are never proved to have landed, against the codebase's own documented rule | CONFIRMED |
| 124 | low | host-live-flow | Manual Snowball Win is offered at any stage and on a completed game, and fails with a misleading refusal | CONFIRMED |
| 125 | low | host-live-flow | `maybeCompleteSession` swallows read errors and updates `sessions` without `.select()`, so a session can silently stay 'running' forever | CONFIRMED |
| 126 | low | host-live-flow | After "Close and stay paused" the main control pad has no Resume control, contradicting the modal's own instruction | CONFIRMED |
| 127 | low | host-live-flow | The host's `snowball_pots` realtime channel can never fire: the table is not in the publication | CONFIRMED |
| 128 | low | host-live-flow | Skipping the final stage completes the game outside `endGame`: no `ended_at`, `sessions.active_game_id` still points at the finished game, and the host gets no next step | CONFIRMED |
| 129 | low | host-live-flow | An inner modal unmounting releases the body scroll lock while the outer modal is still open | CONFIRMED |
| 130 | low | money-winner-path | p_force_snowball_jackpot bypasses the call-window check entirely, and the button that sets it is available to any host at any call count | CONFIRMED |
| 131 | low | money-winner-path | Money is displayed and stored with the last pence digit stripped: £212.50 renders as "£212.5" | CONFIRMED |
| 132 | low | money-winner-path | The jackpot amount is dropped from the winner record whenever the planned prize text already contains the word "snowball" | CONFIRMED |
| 133 | low | money-winner-path | The snowball pot admin form silently resets a stored increment of 0 to the hard-coded default on the next save | CONFIRMED |
| 134 | low | money-winner-path | set_winner_prize_given will mark a voided winner's prize as handed over | CONFIRMED |
| 135 | low | money-winner-path | validateClaim accepts a claim made of the same number repeated, and rejects nothing about duplicates | CONFIRMED |
| 136 | low | realtime-sync | The narrow SELECT lists on the public pages give false comfort: the anon key shipped to those pages can read every column of games and sessions | CONFIRMED |
| 137 | low | realtime-sync | The TV has no unattended path back to a live game: /display never re-checks for a new session and /display/[sessionId] is pinned to a completed one forever | CONFIRMED |
| 138 | low | realtime-sync | The game-state realtime reconnect has no re-entrancy guard, so two concurrent connect() calls orphan a subscribed channel that is never removed | CONFIRMED |
| 139 | low | realtime-sync | Backlog catch-up is uncapped: a client that falls behind trickles balls at 1.2s each and shows a wrong "current number" for up to a minute | CONFIRMED |
| 140 | low | realtime-sync | Both public screens subscribe to snowball_pots changes, but that table is not in the realtime publication | CONFIRMED |
| 141 | low | tracking-observability | There is no way to export the record of a night: /admin/backup exports nothing and shows the planned draw order, not what was called | CONFIRMED |
| 142 | low | tracking-observability | Controller handovers overwrite in place, so who was running the game at any moment is unrecoverable | CONFIRMED |
| 143 | low | tracking-observability | deleteSnowballPot permanently destroys the pot's entire audit trail before deleting the pot | CONFIRMED |
| 144 | low | tracking-observability | game_states.updated_at never advances after insert, and the stale value is mirrored to public clients | CONFIRMED |
| 145 | low | tracking-observability | Winner History renders dates in the server's timezone and locale, with no time of day | CONFIRMED |
| 146 | low | tracking-observability | snowball_pot_history is written but never read: no UI anywhere shows how the pot got to its current value | CONFIRMED |
| 147 | low | tracking-observability | A refused bingo claim is stored nowhere: false calls leave no evidence the host checked | CONFIRMED |
| 148 | low | tracking-observability | Session completion writes no timestamp and does not check the write landed | CONFIRMED |
| 149 | low | tracking-observability | /api/setup grants the admin role with no audit, no logging, and without proving the write landed | CONFIRMED |
| 150 | low | tracking-observability | A voided ball is erased with no record of which number, when, or by whom | CONFIRMED |
| 151 | low | ux-accessibility | Every entrance animation class in the app is dead: no plugin provides animate-in / fade-in / zoom-in / slide-in-from-*, verified absent from the built CSS | CONFIRMED |
| 152 | low | ux-accessibility | Geist Sans is loaded and preloaded but never applied; body falls back to Arial | CONFIRMED |
| 153 | low | ux-accessibility | The host dashboard's Start button has no in-flight state or double-tap guard, and reports errors through window.alert / window.confirm | CONFIRMED |
| 154 | low | ux-accessibility | Login fields carry no autoComplete attributes | CONFIRMED |
| 155 | low | ux-accessibility | Buttons nested inside Links in nine places produce invalid, doubly-focusable markup | CONFIRMED |
| 156 | low | ux-accessibility | No prefers-reduced-motion handling anywhere, with indefinite pulsing on the public screens | CONFIRMED |
| 157 | low | ux-accessibility | The pub TV's only outage signal is 14px white-on-amber with a 24px Refresh button | CONFIRMED |
| 158 | low | ux-accessibility | Host session rows expand via a bare div onClick with no keyboard or screen-reader affordance | CONFIRMED |
| 159 | low | ux-accessibility | Sign Out is a one-tap unconfirmed control in the top-right of the live host screen, next to a 32px back arrow | CONFIRMED |
| 160 | low | ux-accessibility | Resetting or deleting a snowball pot -- the app's most money-sensitive admin actions -- is guarded only by window.confirm | CONFIRMED |
| 161 | low | ux-accessibility | Closing a stacked modal restores page scrolling while the modal underneath is still open | CONFIRMED |
| 162 | low | ux-accessibility | The pub TV never shows the full called-numbers board; at 88 calls only the newest ~11 balls are visible | CONFIRMED |
| 163 | low | ux-accessibility | The TV's "Connecting to game…" state is default 16px text, unlike every other display state | CONFIRMED |
| 164 | low | ux-accessibility | The "View Only Mode" overlay covers the current ball on a second device, and offers no way forward when the other host's tab is still alive | CONFIRMED |

---

## Detail

### 1. [CRITICAL] "Invite-only" is enforced nowhere: any new auth user is auto-granted the host role

Area: auth-security | Verdict: CONFIRMED

Files: `supabase/migrations/20251201000000_baseline_schema.sql:195`, `src/app/login/actions.ts:36`, `src/app/host/page.tsx:22`

**What is wrong.** The trigger handle_new_user() inserts every newly created auth user into public.profiles with role='host', and user_role has only two labels ('admin','host'), so there is no unprivileged authenticated tier. Nothing in the repo, the database, or a version-controlled config disables Supabase self-signup; the only thing standing between the public internet and a host account is an untracked dashboard toggle.

**How it fails.** An attacker reads NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY out of the public /display or /player page bundle and POSTs to https://bcmorqsgeumtmhvctvgu.supabase.co/auth/v1/signup. If project signups are on, the on_auth_user_created trigger gives them profiles.role='host'. They now pass assert_is_host(), can EXECUTE call_next_number / void_last_number / record_winner_atomic / settle_snowball_pot / set_winner_prize_given (all granted to `authenticated`), can UPDATE any game_states row and any sessions row directly through PostgREST, and can INSERT winners rows. A live game can be driven, corrupted or ended by a stranger.

**Evidence.** handle_new_user(): "insert into public.profiles (id, email, role) values (new.id, new.email, 'host'); -- Default to host, manually upgrade to admin later". pg_enum for user_role returns exactly {admin, host}. src/app/login/actions.ts only stubs the signup() server action ("Registration is invite-only"), which does nothing about the GoTrue /auth/v1/signup endpoint. src/app/host/page.tsx:22 gates /host on `if (!user)` alone, with no role check.

**Proposed fix.** Confirm and pin the invite-only claim: turn off "Allow new users to sign up" in Auth settings and record it in a checked-in supabase/config.toml. Independently, stop the trigger granting privilege by default: add a third user_role value (e.g. 'pending' / 'none') and make handle_new_user() insert that, so an account is inert until an admin promotes it. assert_is_host() and every RLS policy already name the roles explicitly, so they need no change.

**Verifier note.** Traced end to end and verified live. supabase/migrations/20251201000000_baseline_schema.sql:196-206 defines handle_new_user() inserting role='host' for every auth.users row; pg_trigger in production shows on_auth_user_created enabled (tgenabled='O') and handle_new_user is SECURITY DEFINER owned by postgres (rolbypassrls=true), so the profile insert always lands. user_role has only {admin,host}, so there is no unprivileged authenticated tier. I settled the one runtime unknown by GETting the project's public GoTrue settings endpoint with the anon key from .env.local: it returns "disable_signup":false and "email":true, so self-signup IS enabled on bcmorqsgeumtmhvctvgu today. auth.users currentl

### 2. [HIGH] Resetting a session leaves the snowball pot where the deleted night put it, and permanently blocks the replay from settling it

Area: admin-flows | Verdict: CONFIRMED

Files: `src/app/admin/sessions/[id]/actions.ts:322`, `src/app/admin/sessions/[id]/session-detail.tsx:806`, `src/app/host/actions.ts:268`

**What is wrong.** reset_session_safe deletes winners and game_states but never touches snowball_pots or snowball_pot_history. Because settle_snowball_pot's idempotency claim is a unique index on (snowball_pot_id, game_id) that survives the reset, a replayed night returns 'already_settled' , which handleSnowballPotUpdate treats as success , so the pot silently never moves again for that game.

**How it fails.** Pot P sits at £280 / 56 calls. Session S (snowball game G on pot P) is played; nobody wins the jackpot; endGame settles it, writing history row (P, G, 'rollover') and moving P to £300 / 58. The host had started the wrong session, so the admin clicks 'Reset to Ready (Unlock)' and types RESET. reset_session_safe deletes the winners and game_states; P stays at £300 / 58 and the (P, G) history claim survives. The night is replayed properly and a punter wins the jackpot inside the window. endGame calls settle_snowball_pot(G) → unique_violation → outcome 'already_settled' → handleSnowballPotUpdate returns `{ success: true }` and only writes a log line. P is NOT reset to base £200 / 48: it stays at £300 / 58 while £300 has just been paid out. Next week the display advertises £320. Nobody is told anything went wrong; only a manual edit on /admin/snowball can correct it.

**Evidence.** Live reset_session_safe body: `delete from public.winners where session_id = p_session_id; delete from public.game_states gs using public.games g where gs.game_id = g.id and g.session_id = p_session_id; update public.sessions set status = 'ready', active_game_id = null where id = p_session_id;` , nothing else. Live index: `CREATE UNIQUE INDEX snowball_pot_history_pot_game_unique ON public.snowball_pot_history USING btree (snowball_pot_id, game_id) WHERE (game_id IS NOT NULL)`. src/app/host/actions.ts:268-274 , `if (settlement.outcome === 'already_settled') { logActionFailure(...) } return { success: true }`. The reset modal at session-detail.tsx:806 claims it deletes 'Any snowball jackpot history captured against winners in this session' , it does not.

**Proposed fix.** Make reset_session_safe also delete `snowball_pot_history` rows whose game_id belongs to the session AND reverse the pot to the values recorded in `old_val_max` / `old_val_jackpot` on those rows, all inside the same transaction. If reversal is deemed unsafe, refuse to reset any session that has a settled snowball game and tell the admin to correct the pot first. Either way, stop the modal claiming history is deleted.

**Verifier note.** Traced end to end. Live reset_session_safe body is exactly as quoted: assert_is_admin, delete winners by session_id, delete game_states via games, update sessions set status='ready'. It never touches snowball_pots or snowball_pot_history. Live index snowball_pot_history_pot_game_unique on (snowball_pot_id, game_id) WHERE game_id IS NOT NULL survives the reset because reset deletes winners and game_states, not games, so game_id is still populated (and the game_id FK is ON DELETE SET NULL, not CASCADE, so even a game delete would only null it rather than free the claim). Live settle_snowball_pot catches unique_violation and returns 'already_settled' with the pot untouched, and src/app/host/act

### 3. [HIGH] Deleting a snowball pot unlinks every game from it, then fails on an FK it cannot satisfy , the links are gone for good

Area: admin-flows | Verdict: CONFIRMED

Files: `src/app/admin/snowball/actions.ts:154`, `src/app/admin/snowball/actions.ts:165`, `src/app/admin/snowball/actions.ts:174`, `src/app/admin/snowball/snowball-list.tsx:61`

**What is wrong.** deleteSnowballPot runs three separate, non-transactional round trips: unlink all games, delete history, delete pot. RLS on snowball_pot_history has no DELETE policy, so step 2 silently deletes nothing and returns no error; step 3 then violates snowball_pot_history_snowball_pot_id_fkey (NO ACTION) and aborts , but step 1 has already committed, permanently stripping snowball_pot_id from every game that ever used the pot.

**How it fails.** Pot P has at least one snowball_pot_history row (any settled snowball game, or any 'Edit'/'Reset' the admin has done, both of which insert history). Admin clicks Delete on P and accepts the browser confirm. (1) `games.snowball_pot_id` is set NULL on all games referencing P, including completed historic games , committed. (2) The history delete matches 0 rows because RLS filters it; `error` is null so the code continues. (3) `delete from snowball_pots` raises 23503 and the admin sees a raw Postgres FK message. The pot still exists, but every game→pot link is destroyed. It cannot be repaired from the UI: update_game_safe preserves `snowball_pot_id` whenever game_states.status <> 'not_started', so no started or completed game can ever be re-linked. Today the project has 1 pot and 0 history rows, so the bug is latent , it will arm itself the first time that pot settles or is edited.

**Evidence.** src/app/admin/snowball/actions.ts:155-177 , unlink: `.from('games').update({ snowball_pot_id: null }).eq('snowball_pot_id', id)`; then `.from('snowball_pot_history').delete().eq('snowball_pot_id', id)` with only `if (deleteHistoryError) return ...`; then `.from('snowball_pots').delete().eq('id', id)`. Live pg_policies for snowball_pot_history: only 'Admins insert history' (INSERT) and 'Admins view history' (SELECT); relrowsecurity = true; no DELETE policy. Live constraint: `snowball_pot_history_snowball_pot_id_fkey FOREIGN KEY (snowball_pot_id) REFERENCES snowball_pots(id)` , no ON DELETE clause. Live update_game_safe body: when `v_status is not null and v_status <> 'not_started'` the UPDATE sets only name, game_index, background_colour, notes.

**Proposed fix.** Replace the three round trips with one SECURITY DEFINER RPC (delete_snowball_pot_safe) guarded by assert_is_admin() that refuses when any game still references the pot, and does the history delete + pot delete in one transaction. At minimum, add a DELETE policy for admins on snowball_pot_history and reverse the order so the pot delete is attempted before any game is unlinked. Also require a typed confirmation rather than window.confirm.

**Verifier note.** Every link in the chain checks out. Live pg_constraint: snowball_pot_history_snowball_pot_id_fkey is 'FOREIGN KEY (snowball_pot_id) REFERENCES snowball_pots(id)' with no ON DELETE clause, and games_snowball_pot_id_fkey likewise. Live pg_policies on snowball_pot_history returns exactly two rows, 'Admins insert history' (INSERT) and 'Admins view history' (SELECT) - no DELETE policy, so the admin's DELETE matches zero rows and PostgREST returns 204 with no error, exactly as the code's 'if (deleteHistoryError)' assumes cannot happen. The three calls at actions.ts:155, :165, :174 are three separate PostgREST requests, hence three transactions, so the unlink at :155 is committed before the pot del

### 4. [HIGH] Every redirect in updateSession discards the refreshed Supabase auth cookies, logging staff out

Area: auth-security | Verdict: CONFIRMED

Files: `src/utils/supabase/middleware.ts:63`, `src/utils/supabase/middleware.ts:72`, `src/utils/supabase/middleware.ts:81`

**What is wrong.** supabase.auth.getUser() may rotate the session, and the SSR client writes the new cookies onto the local `response` via setAll. All three redirect branches then return a brand-new NextResponse.redirect(url) that never copies those Set-Cookie headers, so the rotated tokens are thrown away while the old refresh token has already been consumed server-side.

**How it fails.** A host has been on shift for over an hour, so their access token is expired. They tap the bookmarked /login (or a host account follows a stale /admin link). The middleware runs getUser(), GoTrue rotates the refresh token and issues new cookies onto `response`; line 81 then returns NextResponse.redirect('/') carrying none of them. The browser still holds the now-consumed refresh token, so the very next request fails to refresh and the host is bounced to /login mid-game and has to sign in again from behind the bar.

**Evidence.** middleware.ts:19-31 setAll writes cookies onto `response`. Lines 54-63: `const url = request.nextUrl.clone(); ... return NextResponse.redirect(url)` , no `response.cookies.getAll().forEach(c => redirect.cookies.set(c))`. Same shape at lines 67-73 and 77-82. This is the exact pattern Supabase's SSR docs warn about.

**Proposed fix.** Build the redirect and copy the cookies before returning, e.g. `const redirectResponse = NextResponse.redirect(url); response.cookies.getAll().forEach(({name, value, ...opts}) => redirectResponse.cookies.set(name, value, opts)); return redirectResponse;` in all three branches.

**Verifier note.** Traced in src/utils/supabase/middleware.ts. setAll (lines 22-32) rebuilds `response` and writes the rotated cookies onto it; all three redirect branches (lines 54-63 /admin, 67-73 /host, 77-82 /login) build a fresh NextResponse.redirect(url) and return it without copying `response.cookies`. Nothing else in the request pipeline can persist a refresh: src/utils/supabase/server.ts swallows cookie writes in Server Components, so middleware is the only place the rotated token can be stored. GoTrue revokes the used refresh token after its short reuse interval, so the browser is left holding a dead token and the next protected request signs the user out. Realistic trigger: a staff member opening th

### 5. [HIGH] deleteSnowballPot runs a three-step destructive cascade with no transaction and deletes the money audit trail

Area: code-quality | Verdict: CONFIRMED

Files: `src/app/admin/snowball/actions.ts:134`

**What is wrong.** deleteSnowballPot unlinks every game from the pot, then deletes every snowball_pot_history row for it, then deletes the pot, as three independent round trips with an early return on each failure and no rollback. This is the same split-write shape that CLAUDE.md records as having previously left a pot needing manual correction, and which settle_snowball_pot was written to close.

**How it fails.** An admin deletes a retired pot. The unlink at line 155 succeeds; the history delete at line 165 fails (transient, or an RLS refusal since snowball_pot_history has no DELETE policy in the live list). The action returns an error, but every game that referenced the pot has already had snowball_pot_id set to null and nothing puts it back. Those games silently become non-snowball on the host screen ('Snowball countdown unavailable: this game is not linked to a snowball pot'). Separately, when the flow does succeed it permanently destroys the pot's entire change history, which is the audit trail for real cash.

**Evidence.** src/app/admin/snowball/actions.ts:155-181: three separate awaits, `.from('games').update({snowball_pot_id:null})`, `.from('snowball_pot_history').delete()`, `.from('snowball_pots').delete()`, each with `if (error) return { success:false, error: error.message }`. The live policy list in the brief shows snowball_pot_history with only Admins-insert and Admins-view policies.

**Proposed fix.** Move the whole cascade into a security-definer `delete_snowball_pot_safe(p_pot_id uuid)` that runs the three statements in one transaction under a `for update` lock on the pot, mirroring delete_session_safe and settle_snowball_pot. Consider soft-deleting the pot (an `archived_at` column) instead of destroying its history rows.

**Verifier note.** Confirmed, and under-called. admin/snowball/actions.ts:155-181 is three unrelated round trips with an early return on each. I then checked production read-only: snowball_pot_history has RLS enabled with only 'Admins insert history' (INSERT) and 'Admins view history' (SELECT) and no DELETE policy at all, and snowball_pot_history_snowball_pot_id_fkey is NO ACTION (confdeltype 'a'). So the middle step is not a transient risk, it is deterministic: the delete at :165 is filtered by RLS, matches zero rows, returns no error, the code proceeds, and the pot delete at :175 then fails 23503 whenever any history row exists - after every game referencing the pot has already had snowball_pot_id set to nul

### 6. [HIGH] There is no unconditional End Game, and snowball settlement only ever runs from a completion path, so an abandoned snowball game leaves the jackpot frozen until an admin hand-edits it

Area: completeness | Verdict: CRITIC, unverified

Files: `src/app/host/actions.ts:809`, `src/app/host/actions.ts:1218`, `src/app/host/actions.ts:1478`, `src/app/admin/snowball/actions.ts`

**What is wrong.** settle_snowball_pot is called from exactly three places, all of which require the game to reach a completion path (endGame, advanceToNextStage past the last stage, skipStage on the last stage). Combined with the already-reported absence of any unconditional End Game control, a snowball game that is simply abandoned never moves the pot at all - neither reset nor rollover.

**How it fails.** Game 9 is the snowball. Nobody claims within the window, the room thins out, and the host closes the app or the battery dies rather than working through the Post Win modal (which only opens after recordWinner succeeds). game_states.status stays 'in_progress' forever. handleSnowballPotUpdate is never reached, so current_jackpot_amount and current_max_calls stay exactly where they were. Next Friday the pre-game briefing and the pub TV both announce last week's jackpot as if it had never been played for, and the only correction route is /admin/snowball's manual edit - which reports success on a `.update()` it never proves landed and swallows its own audit-insert failure (already reported).

**Evidence.** `grep -n "handleSnowballPotUpdate" src/app/host/actions.ts` returns only lines 256 (definition), 809 (endGame), 1218 (advanceToNextStage), 1478 (skipStage). endGame requires status 'in_progress' and is reachable only from the Post Win modal or moveToNextGame*; skipStage is rendered only inside the `validationResult.valid` branch of the claim modal.

**Proposed fix.** Add an unconditional "End game" control to the host pad (confirmed, available whenever status is 'in_progress'), and make it the single completion path that settles the pot. Separately, surface un-settled snowball games on /admin/snowball ("Game 9 of Friday 12 Dec never settled - roll over / reset") so a stranded pot is visible rather than silently stale.

### 7. [HIGH] The PRD's headline resilience requirement is entirely unbuilt: there is no local cache, no service worker, no PWA, so a Wi-Fi drop stops the night dead

Area: completeness | Verdict: CRITIC, unverified

Files: `src/app/host/[sessionId]/[gameId]/game-control.tsx:752`, `src/app/host/actions.ts`, `next.config.ts`, `public/`

**What is wrong.** PRD FR-47 (host local caching), FR-48 (reconnect resolution) and the stated success criterion "If Wi-Fi drops, the host can keep calling and the display can catch up later" have no implementation of any kind. Every host action is a synchronous server round trip; nothing is queued, cached or replayed.

**How it fails.** The pub Wi-Fi drops for 90 seconds mid-game (routine at The Anchor). The host taps Call Next Number: the server action never resolves, and because most handlers have no catch (see host-actions-no-catch-silent-failure) the button simply returns to idle with nothing on screen. 30 seconds later ConnectionBanner calls window.location.reload() on a device with no network, replacing the host console with the browser's offline page. The host has no cached board, no queued calls and no way to keep the game moving: the room waits, or the host reverts to paper and the app's record of the night is now wrong from that ball onward.

**Evidence.** `grep -rn "localStorage|indexedDB|serviceWorker|manifest" src public next.config.ts` returns nothing. `ls public` returns only two logo PNGs (no manifest.json, no service worker). next.config.ts contains only a comment. Every mutation in src/app/host/actions.ts is a direct `await supabase...` with no queue. docs/PRD.md 6.10: "FR-47 - Host local caching: Cache state locally to allow calling/validating while offline" and "FR-48 - Reconnect resolution: Sync local state to server if host is ahead."

**Proposed fix.** Either build the minimum viable version of FR-47 (persist the current game_state snapshot and an outbound call queue to localStorage, replay on reconnect keyed by the existing state_version, and give callNextNumber an idempotency key so replay is safe), or explicitly strike FR-47/FR-48 from the PRD and tell the host the app requires connectivity. Do not leave a documented success criterion silently unbuilt. At minimum, stop the offline auto-reload (already reported separately) so the host keeps the last known board on screen.

### 8. [HIGH] Prize text cannot be corrected on a started game, contrary to FR-11, so a mistyped cash jackpot amount is permanent and a session reset does not restore the original prizes

Area: completeness | Verdict: CRITIC, unverified

Files: `src/app/admin/sessions/[id]/session-detail.tsx:547`, `supabase/migrations/20260430124120_atomic_admin_mutations.sql:53`, `src/app/host/actions.ts:354`, `supabase/migrations/20260430124207_reset_session_safe_status_ready.sql:45`

**What is wrong.** PRD FR-11 states that on a running session "Editable prize text and notes" must remain available. In fact the admin edit form disables the whole structural fieldset (which contains every prize input) once the game has started, and update_game_safe silently preserves `prizes` for any game whose state is not 'not_started'. There is no correction path at all.

**How it fails.** The host starts a game named "Game 5 - Jackpot" and fat-fingers the cash amount as 500 instead of 50. startGame writes "£500 Cash Jackpot" over EVERY stage in games.prizes (host/actions.ts:354-355), destroying the admin-entered Line and Two Lines prizes. The admin opens the game to fix it: the prize inputs are inside `<fieldset disabled={isGameLocked}>` so they cannot be typed into, and even a hand-crafted POST would hit update_game_safe's locked branch, which updates only name/game_index/background_colour/notes and returns success. The pub TV and the host briefing now advertise £500 across all three stages for the rest of the game. Resetting the session does not help either: reset_session_safe deletes winners and game_states but never touches games.prizes, so the original Line and Two Lines prizes are gone for good.

**Evidence.** session-detail.tsx:547 `<fieldset disabled={isGameLocked} aria-disabled={isGameLocked} ...>` wraps Game Type, stages, snowball pot and all `prize_${stage}` inputs (lines 547-680). update_game_safe locked branch: `update public.games set name = p_name, game_index = p_game_index, background_colour = p_background_colour, notes = p_notes where id = p_game_id` - prizes absent. reset_session_safe body deletes from winners and game_states and updates sessions only.

**Proposed fix.** Split the locked fieldset: keep type / stage_sequence / snowball_pot_id locked and move the prize inputs out, then extend update_game_safe's locked branch to write `prizes` as well (it is non-structural by FR-11). Add an explicit "Correct jackpot amount" control on the host screen for cash-jackpot games so the fix is reachable at the moment the typo is noticed.

### 9. [HIGH] The winners INSERT policy lets a host hand-craft a jackpot win and force a pot reset, the exact hole the UPDATE side is defended against

Area: db-integrity | Verdict: CONFIRMED

Files: `supabase/migrations/20251201000000_baseline_schema.sql:291`, `supabase/migrations/20260730065531_atomic_snowball_settlement.sql`, `CLAUDE.md`

**What is wrong.** `winners` INSERT is granted to role host by RLS, but `record_winner_atomic` is SECURITY DEFINER owned by `postgres` on a table without FORCE ROW LEVEL SECURITY, so it never needs that policy. The policy therefore only serves direct PostgREST inserts, and `settle_snowball_pot` derives reset-vs-rollover from exactly the columns a host can write.

**How it fails.** A host with a normal browser JWT sends `POST /rest/v1/winners` with `{session_id, game_id, stage:'Full House', winner_name:'Anonymous', is_snowball_jackpot:true, prize_description:'Snowball Jackpot £5000'}`. RLS policy "Hosts/Admins can create winners" passes (`profiles.role in (admin,host)`). When that game ends, `settle_snowball_pot` runs `select exists (... where game_id = p_game_id and coalesce(is_snowball_jackpot,false) and coalesce(is_void,false)=false)`, sees true, and resets the live pot to `base_max_calls`/`base_jackpot_amount` and stamps `last_awarded_at` instead of rolling it over. The pot today is £140/54 calls; it would drop to £20/42 calls. The row also appears on /admin/history as a jackpot win. None of the checks in `record_winner_atomic` (controller lock, status, stage_sequence match, jackpot-window recheck) are involved.

**Evidence.** Live policy: winners | "Hosts/Admins can create winners" | INSERT | with_check (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND (profiles.role = 'admin' OR profiles.role = 'host'))). Live catalogue: pg_proc.proowner for record_winner_atomic = postgres, prosecdef = true; pg_class.relforcerowsecurity for winners = false, relowner = postgres , so the definer function bypasses RLS and does not depend on the INSERT policy. settle_snowball_pot body (prod): `select exists ( select 1 from public.winners where game_id = p_game_id and coalesce(is_snowball_jackpot, false) and coalesce(is_void, false) = false ) into v_jackpot_won;`. CLAUDE.md already reasons this way for the other direction: "Do not widen the `winners` UPDATE policy to hosts: a host holds a real JWT in the browser and could then `PATCH /rest/v1/winners` to set `is_void` directly."

**Proposed fix.** Drop the "Hosts/Admins can create winners" INSERT policy on `winners` entirely (or restrict it to admin). `record_winner_atomic` is SECURITY DEFINER and owned by postgres, so the host flow keeps working with no policy at all , verify with the existing `supabase/tests/run.sh` harness. If a policy must stay for some other caller, add a WITH CHECK that pins `is_snowball_jackpot = false`, `is_void = false` and `winner_name = 'Anonymous'`.

**Verifier note.** Traced end to end and it holds. Live: winners policy "Hosts/Admins can create winners" WITH CHECK role in (admin,host); winners relacl grants authenticated=arwdDxtm (so PostgREST INSERT is permitted at the grant level); record_winner_atomic is prosecdef=true owned by postgres and winners.relforcerowsecurity=false, so the RPC never relies on that policy and the policy exists only for direct PostgREST inserts. settle_snowball_pot's prod body decides reset-vs-rollover on `exists(select 1 from winners where game_id=p_game_id and coalesce(is_snowball_jackpot,false) and coalesce(is_void,false)=false)` and derives every written value from the locked pot row, so a forged winners row is sufficient to

### 10. [HIGH] A transient Supabase read failure during the display's auto-reload lands the pub TV on a permanent 404 with no client JS to recover

Area: failure-paths | Verdict: CONFIRMED

Files: `src/app/display/[sessionId]/page.tsx:40`, `src/app/player/[sessionId]/page.tsx:26`, `src/components/connection-banner.tsx:9`, `src/app/display/[sessionId]/display-ui.tsx:795`

**What is wrong.** `/display/[sessionId]` calls `notFound()` whenever the initial `sessions` read errors, which conflates "this session does not exist" with "Postgres was briefly unreachable". Because the client auto-reloads after 30 seconds of unhealthy connection, an outage reliably drives the TV through that server read at exactly the moment it is most likely to fail, and Next's default 404 page ships no client JavaScript, so nothing on it ever retries.

**How it fails.** Supabase has a two-minute connectivity blip (pooler saturation, a restart, a network partition between Vercel and eu-west-2). The display's 3 second poll starts failing, `markPollFailure` sets `pollState='failing'`, `unhealthySinceMs` is stamped, and at 30 seconds `ConnectionBanner` reloads the page. The reload hits the server component, `supabase.from('sessions').select(...).single()` errors, and `notFound()` renders the default "This page could not be found" 404. That page is static, has no poll, no banner and no reload timer. Supabase recovers a minute later and the pub TV is still showing a 404 with a full room watching. Recovery requires someone to find the TV's browser and reload it by hand - and the same reasoning applies to every punter's phone on `/player/[sessionId]`, all of which 404 simultaneously and stay there. The rest of the file goes to considerable trouble to distinguish `initialLoadStatus: 'failed'` from "waiting" precisely so an outage is never dressed up as something else; this earlier `notFound()` bypasses all of it.

**Evidence.** src/app/display/[sessionId]/page.tsx: `const { data: session, error: sessionError } = await supabase.from('sessions').select(SESSION_SELECT).eq('id', sessionId).single(); if (sessionError || !session) { logError('display', sessionError ?? new Error('Session not found')); notFound(); }`. Contrast the very next block, which handles a failed game read as `initialLoadStatus = 'failed'` with the comment "It must never be presented to guests as 'the host has not started yet'... recovers on the next successful poll." `ls src/app` shows no `not-found.tsx` anywhere, so Next's default 404 (no client JS) is what renders.

**Proposed fix.** Distinguish the two cases: `notFound()` only when the query succeeds and returns no row (PostgREST `PGRST116`); on any other error render `DisplayUI` with `initialLoadStatus: 'failed'` and a null session shell so the existing recover-on-next-poll path takes over. Failing that, add an `app/not-found.tsx` that self-reloads on a timer, so an unattended screen can never be permanently stranded.

**Verifier note.** Traced and it is the worst of the connection findings. display/[sessionId]/page.tsx:40 and player/[sessionId]/page.tsx:26 both do `if (sessionError || !session) { logError(...); notFound(); }`, conflating a Postgres blip with a missing session, while the very next block deliberately downgrades a failed games/game_states read to `initialLoadStatus = 'failed'` with a comment saying an outage must never be dressed up as something else. `find src -name 'not-found*' -o -name 'error.tsx'` returns nothing, so Next's default 404 renders with no ConnectionBanner, no poll and no reload timer. Unlike the offline case, browser auto-reload does not help here: a 404 is a successful HTTP response, not a ne

### 11. [HIGH] Most host controls have no catch block: a dropped request silently does nothing, and a blind retry double-advances the stage

Area: failure-paths | Verdict: CONFIRMED

Files: `src/app/host/[sessionId]/[gameId]/game-control.tsx:578`, `src/app/host/[sessionId]/[gameId]/game-control.tsx:865`, `src/app/host/[sessionId]/[gameId]/game-control.tsx:560`, `src/app/host/[sessionId]/[gameId]/game-control.tsx:752`, `src/app/host/[sessionId]/[gameId]/game-control.tsx:922`, `src/app/host/[sessionId]/[gameId]/game-control.tsx:945`

**What is wrong.** Only `handleCallNextNumber`, `handleRecordWinner`, `handleTogglePrize`, `handleConfirmCashJackpotAndContinue` and the manual-snowball handler wrap their server-action call in try/catch. Every other host control uses `try { ... } finally { setBusy(false) }` with no catch, so a transport failure rejects unhandled: the button label flips back to idle and no error is shown at all.

**How it fails.** Host taps "Continue Playing" in the Post Win modal on the pub wifi. `advanceToNextStage` commits server-side (stage Line -> Two Lines) but the response is lost. The promise rejects, the `finally` clears `isAdvancing`, the button reverts from "Working…" to "Continue Playing", `setActionError` is never reached and the modal stays open with no message. The host, seeing nothing happen, taps again. The second call re-reads `current_stage_index` (now 1), binds `.eq('current_stage_index', 1)` and advances to index 2 - Two Lines is skipped entirely with its prize unawarded. On the final stage the same second tap sets `status='completed'` and fires `handleSnowballPotUpdate`, settling the pot. The concurrency guard (`.eq('current_stage_index', currentGameState.current_stage_index)`) only defends against two taps sharing one read; it cannot defend against a retry after a lost response. Recovery from the skipped stage: none in-app (see stage-index finding) - a full session reset or DB surgery.

**Evidence.** `const handleContinuePlaying = async (putOnBreak: boolean = false) => { ... setIsAdvancing(true); try { if (!applyMutation(await advanceToNextStage(gameId), "Failed to continue playing.")) return; ... } finally { setIsAdvancing(false); } };` - no catch. Same shape in `handleToggleBreak`, `handleSkipStage`, `handleBeginClaimCheck`, `handleCheckWin`, `handleResumeGame`, `handleConfirmVoidLastNumber`, `handleConfirmVoidWinner`, `handleTakeControl`, `handleMoveToNextGame`, `handleTakeBreakAfterGame`. Contrast `handleCallNextNumber`, which does catch and sets "Could not reach the server to call the next number."

**Proposed fix.** Give every handler the same catch/`setActionError` treatment `handleCallNextNumber` already has, so a dropped request is always visible as a dropped request. For `advanceToNextStage` and `skipStage` specifically, take the same idempotency-key approach as `recordWinner`: a client-minted key per tap on the button, stored on a ref, so a retry of the same intent is refused rather than applied twice.

**Verifier note.** Verified the shape in every named handler: handleContinuePlaying (578), handleToggleBreak (560), handleSkipStage (865), handleBeginClaimCheck (752), handleCheckWin, handleResumeGame, handleConfirmVoidLastNumber, handleConfirmVoidWinner, handleTakeControl, handleMoveToNextGame, handleTakeBreakAfterGame all use try/finally with no catch, while handleCallNextNumber, handleRecordWinner, handleTogglePrize and handleConfirmCashJackpotAndContinue do catch. A rejected server-action promise in a React event handler surfaces nothing. The double-advance is real, not theoretical: advanceToNextStage (actions.ts:1155-1205) re-reads current_stage_index itself and binds `.eq('current_stage_index', currentGa

### 12. [HIGH] The host's winners lists never update during a game: `winners` is not in the realtime publication, and nothing polls it

Area: failure-paths | Verdict: CONFIRMED

Files: `src/app/host/[sessionId]/[gameId]/game-control.tsx:213`, `src/app/host/[sessionId]/[gameId]/game-control.tsx:223`, `src/app/host/[sessionId]/[gameId]/game-control.tsx:245`, `supabase/migrations/20260729231901_ensure_realtime_publication.sql`

**What is wrong.** The host screen relies solely on Supabase Realtime `postgres_changes` on `winners` to refresh its per-game Winners card and its "Winners & Prizes (N)" list, but `winners` is not a member of the `supabase_realtime` publication in production, so those channels subscribe successfully and then deliver nothing for the rest of the game.

**How it fails.** Host validates a Line claim and records the winner. `recordWinner` succeeds and `applyMutation` updates the game state, but neither `fetchGameWinners` nor `fetchSessionWinners` is called on the success path, and the realtime channel that was supposed to call them can never fire. The Winners card stays empty and the "Winners & Prizes (0)" count stays at its mount-time value. The host opens Winners & Prizes to tick "prize given" for the punter standing at the bar and the win is not listed. Worse, this breaks the documented recovery route for a mis-called ball: `void_last_number` raises `winner_on_ball`, and the mapped host message says "Void that winner in the Winners and Prizes list, with a reason, then undo" - but that winner is not in the list on this device until the page is reloaded. Recovery: manual page reload. Every winner recorded on the current page is invisible until then.

**Evidence.** Live catalogue, `select schemaname, tablename from pg_publication_tables where pubname='supabase_realtime'` returns only `public.game_states`, `public.game_states_public`, `public.sessions`. The repo migration that made the publication reproducible lists exactly those three and never mentions `winners` or `snowball_pots`. Client code: `.channel(`winners:${gameId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'winners', filter: `game_id=eq.${gameId}` }, () => { fetchWinners(); }).subscribe()` and the identical `session_winners:${sessionId}` channel. `handleRecordWinner` ends with `setShowWinnerModal(false); clearSpentClaim(); setShowPostWinModal(true);` and no winner-list refresh; `refreshWinnerLists()` is called only from `handleConfirmVoidWinner`.

**Proposed fix.** Either add `public.winners` to the `supabase_realtime` publication in a migration (matching the existing guarded pattern), or stop depending on realtime for it: call `refreshWinnerLists()` on every successful `recordWinner` / `toggleWinnerPrizeGiven`, and fold a winners re-fetch into the existing 3 second poll. The same publication gap makes the `pot_updates_host:` and `pot_updates:` subscriptions on `snowball_pots` dead, though those matter far less because the pot does not move mid-game.

**Verifier note.** Traced end to end. Live catalogue confirms `select schemaname, tablename from pg_publication_tables where pubname='supabase_realtime'` returns only game_states, game_states_public and sessions, so the two `postgres_changes` channels on `winners` (game-control.tsx:223 and :245) can never fire. In the client, `refreshWinnerLists()` is called from exactly one place (line 1010, handleConfirmVoidWinner); `handleRecordWinner` ends at `clearSpentClaim(); setShowPostWinModal(true);` with no list refresh, and the Winners & Prizes button renders `sessionWinners.length` (line 1212) from mount-time data. The `winners:${gameId}` and `session_winners:${sessionId}` fetchers therefore run once per mount onl

### 13. [HIGH] "Continue & Take Break" advances the stage before the break call, so a failed or lost break request lets a retry skip a whole stage

Area: host-live-flow | Verdict: CONFIRMED

Files: `src/app/host/[sessionId]/[gameId]/game-control.tsx:578`, `src/app/host/[sessionId]/[gameId]/game-control.tsx:634`, `src/app/host/actions.ts:1180`

**What is wrong.** `handleContinuePlaying(true)` performs two sequential server calls and returns early if the second fails, leaving the stage already advanced with the Post Win modal still open; because `advanceToNextStage` derives the new index from a fresh read each time, tapping the button again advances a second stage.

**How it fails.** A three-stage game (Line, Two Lines, Full House) is at Line and a winner has just been recorded. Host taps "Continue & Take Break". `advanceToNextStage` commits, moving current_stage_index 0 -> 1 (Two Lines), and `applyMutation` applies it. The follow-up `toggleBreak(gameId, true)` request is lost on pub wifi and rejects; there is no `catch`, so it becomes an unhandled rejection, `isAdvancing` resets, and the Post Win modal stays open with no visible error. The host taps "Continue & Take Break" again. `advanceToNextStage` re-reads current_stage_index = 1 and advances to 2 (Full House). The Two Lines stage is never played, its prize is never claimed or paid, and the display jumps from Line to Full House.

**Evidence.** game-control.tsx:578-595: ``` if (!applyMutation(await advanceToNextStage(gameId), "Failed to continue playing.")) return; if (putOnBreak) { if (!applyMutation(await toggleBreak(gameId, true), "Failed to start break.")) return; } setShowPostWinModal(false); setShowValidationModal(false); handleClearSelection(); ``` There is no `catch` on the surrounding `try` (only `finally { setIsAdvancing(false) }`), so a thrown transport error leaves the modal open with no `actionError` set. actions.ts:1180 `let newStageIndex = currentGameState.current_stage_index + 1;` , the index comes from a fresh `select` each invocation (actions.ts:1156-1160), so the `.eq('current_stage_index', currentGameState.current_stage_index)` binding at line 1203 only defends against two concurrent taps sharing one read, not against a retry after a committed advance.

**Proposed fix.** Make the advance-plus-break pair one server round trip (a single action or RPC that advances and sets on_break under one lock), or close the Post Win modal as soon as the advance succeeds and surface the break failure as a separate, retryable "start break" action against the already-advanced stage. Add a `catch` so a thrown break call sets `actionError`.

**Verifier note.** Traced. handleContinuePlaying (578-595) has try/finally with no catch; the early return after a failed toggleBreak leaves showPostWinModal true. actions.ts:1156-1160 re-reads current_stage_index on every invocation and 1203 binds `.eq('current_stage_index', currentGameState.current_stage_index)` from that fresh read, so the optimistic guard only defends concurrent taps sharing one read, exactly as claimed - a retry after a committed advance advances again. I checked the Post Win modal body (1716-1785): it shows no stage name and the button label only flips at isFinalStage, so nothing on screen tells the host the stage already moved. handleTakeBreakAfterGame (634) delegates here when !isFinal

### 14. [HIGH] A failed snowball pot fetch silently removes the jackpot eligibility prompt and mislabels the game as having no pot

Area: host-live-flow | Verdict: CONFIRMED

Files: `src/app/host/[sessionId]/[gameId]/game-control.tsx:339`, `src/app/host/[sessionId]/[gameId]/game-control.tsx:328`, `src/app/host/[sessionId]/[gameId]/game-control.tsx:1143`, `src/app/host/[sessionId]/[gameId]/game-control.tsx:838`

**What is wrong.** The snowball pot is read once at mount with the error discarded and never retried; when that read fails, `currentSnowballPot` stays null, which disables the mandatory Eligible / Not eligible choice and makes `recordWinner` send `snowballEligible = false`, so a qualifying jackpot Full House records as a plain full house.

**How it fails.** Bar wifi drops for the two seconds after the host page mounts on a snowball game with `snowball_pot_id` set. The `snowball_pots` select fails, `data` is undefined, `setCurrentSnowballPot` is never called. The panel renders "Snowball countdown unavailable: this game is not linked to a snowball pot" even though it is linked, and the Manual Snowball Win button is hidden. On call 42 of a 50-call window a punter wins Full House. `isSnowballChoiceRequired` is false (it requires `currentSnowballPot`), so the Record Winner modal shows no eligibility buttons and Confirm Winner is enabled. `snowballEligibleChoice` is still null, so `recordWinner` is called with `snowballEligible = false`; `record_winner_atomic` computes `v_window_open = true` but `p_snowball_eligible = false`, so `v_is_jackpot` stays false. The jackpot is not awarded, the display says "BINGO!" rather than the snowball text, and `settle_snowball_pot` rolls the pot over instead of resetting it. No error is logged and no reload is prompted.

**Evidence.** game-control.tsx:345-350 discards the error and never retries or logs: ``` const { data } = await supabase .from('snowball_pots') .select('*') .eq('id', game.snowball_pot_id) .single(); if (data) setCurrentSnowballPot(data); ``` game-control.tsx:313-316 `const isSnowballJackpotWindowOpen = !!(currentSnowballPot && isSnowballJackpotEligible(...))` game-control.tsx:328 `const isSnowballChoiceRequired = isSnowballEligibilityStage && isSnowballJackpotWindowOpen;` game-control.tsx:824-827 the only guard on recording without a choice is `if (isSnowballChoiceRequired && snowballEligibleChoice === null)`. game-control.tsx:838 passes `snowballEligibleChoice === true`, which is false when the choice was never offered. game-control.tsx:1144-1146 renders the misleading "not linked to a snowball pot" copy for the failure case.

**Proposed fix.** Capture the error from the pot select, log it via `logError`, retry (or refetch on the same visibility/poll cadence as the game state), and distinguish "pot could not be loaded" from "game has no pot" in the UI. Block Confirm Winner on a snowball Full House when `game.snowball_pot_id` is set but `currentSnowballPot` is null, rather than silently recording ineligible.

**Verifier note.** Traced end to end. game-control.tsx:341-350 discards the error, and the effect deps are [game.type, game.snowball_pot_id], so there is no retry for the life of the page and no logError call. With currentSnowballPot null: isSnowballJackpotWindowOpen false (313), isSnowballChoiceRequired false (328), the guard at 824 does not fire, and 838 passes `snowballEligibleChoice === true` = false. Live pg_get_functiondef of record_winner_atomic confirms the consequence: `if coalesce(p_force_snowball_jackpot,false) or (v_window_open and coalesce(p_snowball_eligible,false))` is the only route to v_is_jackpot, so the row saves with is_snowball_jackpot false and display_win_text 'BINGO!'. settle_snowball_p

### 15. [HIGH] Host winners lists never refresh after a win: `winners` is not in the realtime publication and `handleRecordWinner` does not re-fetch

Area: host-live-flow | Verdict: CONFIRMED

Files: `src/app/host/[sessionId]/[gameId]/game-control.tsx:216`, `src/app/host/[sessionId]/[gameId]/game-control.tsx:239`, `src/app/host/[sessionId]/[gameId]/game-control.tsx:842`, `supabase/migrations/20260729231901_ensure_realtime_publication.sql:39`

**What is wrong.** Both host winner lists are kept up to date only by Supabase Realtime subscriptions on `public.winners`, but that table is not a member of the `supabase_realtime` publication in production, so those channels deliver nothing and no code path re-fetches after a winner is recorded.

**How it fails.** Host validates a Line claim and taps Confirm Winner. `record_winner_atomic` commits the row and `applyMutation` succeeds, so the Post Win modal opens. The "Winners" card on the host page stays empty and the button still reads "Winners & Prizes (0)". The host cannot tick "Give Prize" for the win just recorded, and if they later need to undo a ball the server refuses with `winner_on_ball`, the undo modal's "Open Winners and Prizes" button opens a list that does not contain the blocking winner, so the documented recovery route (void the winner, then undo) is unusable. Only a full page reload restores the lists.

**Evidence.** Live query `select pubname, schemaname, tablename from pg_publication_tables` returns for `supabase_realtime` only: public.game_states, public.game_states_public, public.sessions. `winners` is absent. Client code relies solely on it: game-control.tsx:222-231 `supabase.channel(`winners:${gameId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'winners', filter: `game_id=eq.${gameId}` }, () => { fetchWinners(); }).subscribe()` game-control.tsx:244-253 same shape for `session_winners:${sessionId}`. `grep -n "refreshWinnerLists\|fetchGameWinners()\|fetchSessionWinners()"` shows the only non-mount call site is line 1010, inside `handleConfirmVoidWinner`. The success arm of `handleRecordWinner` (lines 842-851) sets flags and opens the Post Win modal but never refreshes: ``` if (applyMutation(result, "Failed to record winner.")) { setPrizeGiven(false); setSnowballEligibleChoice(

**Proposed fix.** Call `await refreshWinnerLists()` on every successful record path (`handleRecordWinner` and the Manual Snowball handler at line 1892), so correctness does not depend on replication config. Separately, add `public.winners` to `supabase_realtime` in a migration (guarded like 20260729231901) if live cross-device winner updates are wanted.

**Verifier note.** Reproduced. Live `select pubname, tablename from pg_publication_tables` on bcmorqsgeumtmhvctvgu returns only game_states, game_states_public and sessions for `supabase_realtime`; `winners` is absent, so both postgres_changes channels (game-control.tsx:222 and :244) can never deliver. I grepped every call site of fetchGameWinners/fetchSessionWinners/refreshWinnerLists: mount effects (lines 218, 242) and handleConfirmVoidWinner (line 1010) only. handleRecordWinner's success arm (842-851) and the manual snowball arm (1891-1897) do not refresh, and the Winners & Prizes button (1207) opens the modal without fetching. So both lists are frozen at mount for the life of the page. Two mitigations the 

### 16. [HIGH] Starting any game whose NAME contains "jackpot" overwrites every stage prize with the full cash jackpot amount

Area: money-winner-path | Verdict: CONFIRMED

Files: `src/app/host/actions.ts:339`, `src/app/host/actions.ts:352`, `src/lib/jackpot.ts:3`

**What is wrong.** `isCashJackpotGame()` falls back to a regex on the game NAME for any game that is not type `snowball`, so a `standard` multi-stage game named e.g. "Game 5 - Jackpot" is treated as a cash jackpot game; `startGame` then writes the single jackpot prize text over EVERY stage in `stage_sequence`, destroying the admin-entered Line / Two Lines prizes permanently.

**How it fails.** Admin creates a standard game named "Game 5 - Mini Jackpot" with stages Line/Two Lines/Full House and prizes £5 / £10 / £25. Host taps Start; because `/\bjackpot\b/i` matches the name, the host is prompted for a cash jackpot amount and enters 100. `startGame` runs `for (const stage of stage_sequence) updatedPrizes[stage] = '£100 Cash Jackpot'` and writes it with the SERVICE-ROLE client (bypassing the admin-only `games` RLS policy). The first Line claim opens Record Winner pre-filled with "£100 Cash Jackpot" (`getPlannedPrize`), the host records it, and the Winners & Prizes list says a line winner is owed £100 instead of £5. The original prizes are gone from the `games` row with no recovery path.

**Evidence.** src/lib/jackpot.ts:3-14 , `if (gameType === 'jackpot') return true; if (gameType === 'snowball') return false; return /\bjackpot\b/i.test(gameName);` src/app/host/actions.ts:339 , `const requiresCashJackpotAmount = isFirstStartAttempt && isCashJackpotGame(gameDetailsForStart.name, gameDetailsForStart.type)` src/app/host/actions.ts:352-361 , `const jackpotPrizeText = formatCashJackpotPrize(parsedAmount); const updatedPrizes = {...}; for (const stage of gameDetailsForStart.stage_sequence || []) { updatedPrizes[stage] = jackpotPrizeText } ... await dbClient.from('games').update({prizes: updatedPrizes}).eq('id', gameId)` where `dbClient = getServiceRoleClient() || supabase`. Admin only forces `stage_sequence = ['Full House']` when `type === 'snowball' || type === 'jackpot'` (src/app/admin/sessions/[id]/actions.ts:74, :173), so a `standard` game keeps all three stages. Live prod check: every 

**Proposed fix.** Drop the name regex, or gate the prize overwrite on `type === 'jackpot'` only. At minimum, only write the jackpot prize text to stages that have no admin-entered prize, and never widen it beyond `stage_sequence.length === 1`.

**Verifier note.** Traced end to end. src/lib/jackpot.ts:13 falls back to /\bjackpot\b/i on the NAME for any game not typed 'snowball', and src/app/host/actions.ts:339 gates the prompt on that. The loop at :352-356 writes the single jackpot text over every entry in stage_sequence, and admin only forces a single Full House stage for type 'snowball'/'jackpot' (src/app/admin/sessions/[id]/actions.ts:74, :173), so a 'standard' multi-stage game keeps all three. The write uses the service-role client so admin-only RLS on games does not stop it, and the original prizes are gone. Live check agrees the trigger is latent: every current jackpot-named game is type='jackpot' with stage_sequence ['Full House'] (e.g. 'Game 1

### 17. [HIGH] resetSession hard-deletes an entire night's record with no archive and no audit row anywhere

Area: tracking-observability | Verdict: CONFIRMED

Files: `src/app/admin/sessions/[id]/actions.ts:322`, `supabase/migrations/20260729231945_atomic_host_mutations.sql`

**What is wrong.** reset_session_safe permanently deletes every winners row and every game_states row for a session (taking called_numbers, started_at, ended_at and the whole board with them) and writes nothing that records the reset happened, who did it, when, or what was destroyed.

**How it fails.** An admin opens /admin/sessions/<July 29th 2026>, types RESET (or the session name) and confirms. The live function runs `delete from public.winners where session_id = ...` then `delete from public.game_states gs using public.games g ...` and sets status back to 'ready'. Production currently holds 14 winners and 10 game_states for that session; all 24 rows are gone in one transaction. No row anywhere records the reset. The business questions 'who won on 29 July and what were they paid?' and 'why is last month's session empty?' become permanently unanswerable, and the answer to 'was this a mistake or deliberate?' does not exist. Worse in combination with the snowball pot: settle_snowball_pot derives reset-vs-rollover from `winners where is_snowball_jackpot and not is_void`, so once the winners rows are deleted the snowball_pot_history row for that game (which carries game_id) can no longer be checked against the evidence that justified it.

**Evidence.** Live pg_get_functiondef(reset_session_safe): "perform public.assert_is_admin(); delete from public.winners where session_id = p_session_id; delete from public.game_states gs using public.games g where gs.game_id = g.id and g.session_id = p_session_id; update public.sessions set status = 'ready', active_game_id = null where id = p_session_id;". No insert into any history table. RLS has no DELETE policy on `winners` at all, so this SECURITY DEFINER function is the only thing in the entire system that can destroy a winner row, and it destroys them silently and in bulk. `select count(*) from public.snowball_pot_history` returns 0, and there is no other audit table in the schema (public tables are only: game_states, game_states_public, games, profiles, sessions, snowball_pot_history, snowball_pots, winners).

**Proposed fix.** Before the deletes, insert a durable record of what is being destroyed: at minimum a session_reset_log row carrying session_id, auth.uid(), now(), the winner count and the winners rows themselves as jsonb (winner_name is already 'Anonymous', so nothing personal is retained). Alternatively soft-delete: add `reset_at`/`reset_by` to winners and game_states and filter them out of live queries rather than deleting. Either way the reset must leave a row, not just an absence.

**Verifier note.** Traced end to end. Live pg_get_functiondef(reset_session_safe) is exactly as quoted: assert_is_admin, then `delete from public.winners where session_id = ...`, then a delete of every game_states row for the session's games, then status back to 'ready'. No insert into any table, no archive, and no status guard, so a completed session from a month ago can be wiped as easily as tonight's. Confirmed the only other audit-shaped table (snowball_pot_history) holds 0 rows and there is no other history table. resetSession (src/app/admin/sessions/[id]/actions.ts:322) only gates on typing RESET or the session name. Severity corrected down from critical: the destruction is the button's advertised purpos

### 18. [HIGH] game.background_colour is a free colour picker painted behind white text; production games use pale yellows and peaches, hiding the player screen's only control

Area: ux-accessibility | Verdict: CONFIRMED

Files: `src/app/player/[sessionId]/player-ui.tsx:660`, `src/app/player/[sessionId]/player-ui.tsx:843`, `src/app/player/[sessionId]/player-ui.tsx:677`, `src/app/admin/sessions/[id]/session-detail.tsx:685`

**What is wrong.** The player page paints the whole viewport with the game's chosen colour and puts white text and the "View All Numbers" button directly on it, with no contrast check anywhere in the admin form or at render time.

**How it fails.** Admin sets Game 4's colour to #FFD93B to match the yellow paper books (this is exactly what production data shows). A punter opens /player/[sessionId] on their phone. The "Recent Calls" label, the "No numbers called yet" line, the "READY" placeholder and the "View All Numbers" button all render white on yellow at roughly 1.4:1 contrast: the button is invisible, so the full called-numbers board -- the one thing a punter with a paper book actually wants -- is unreachable. The "Tap once to keep this screen awake" hint (white on a 20% gold band over yellow) is invisible too, so the phone sleeps mid-game.

**Evidence.** Live production data, `select background_colour, count(*) from games group by 1`: #FFD93B, #FFBFA3, #FFA73A, #C8A2FF, #9CA3AF, #FF66B3 (6 games each). White on #FFD93B is ~1.38:1, on #FFBFA3 ~1.48:1, on #FFA73A ~1.78:1 (WCAG AA needs 4.5:1, or 3:1 for large text). player-ui.tsx:660 `style={{ backgroundColor: backgroundColor }}` on the root div; line 842 `<span className="text-sm text-white font-medium">Recent Calls</span>`; lines 843-850 the Button is `variant="ghost"` with `className="text-white h-auto p-0 hover:bg-transparent"`, so it has no background of its own; line 861 `<p className="text-white italic text-sm">No numbers called yet</p>`; line 831 `<span className="text-white font-bold">READY</span>` inside a transparent dashed circle. The admin picker (session-detail.tsx:685-700) is a bare `<input type="color">` plus a hex field with no contrast warning and a `#ffffff` DB default.

**Proposed fix.** Either compute a readable foreground per game colour (luminance test, switch to a dark text token below threshold), or put every text run on the player screen inside the existing dark `bg-[#003f27]/80` card treatment so the game colour is only ever a frame. Add a live contrast warning next to the admin colour picker.

**Verifier note.** Verified in source and against production. player-ui.tsx:611 takes background_colour raw and line 660 paints it on the root div with no darkening or overlay. The 'Recent Calls' label (line 842), the 'View All Numbers' ghost button (lines 843-850, no background of its own), the 'No numbers called yet' line (861) and the READY placeholder (831) all sit directly on that colour with text-white; the wake-lock hint band is bg-[#a57626]/20 over the same colour. Live query on games: #FFD93B, #FFBFA3, #FFA73A, #C8A2FF, #9CA3AF, #FF66B3 (plus #E23B3B, #28A745, #3A7DFF, #8B5A2B), 6 games each. Computed white-on-colour ratios: 1.38:1, 1.59:1, 1.94:1, 2.09:1, 2.54:1, 2.69:1 against the 4.5:1 AA requireme

### 19. [HIGH] The connection banner force-reloads after 30s unhealthy, including when the browser is offline, replacing the pub TV with a browser error page and discarding a host's in-progress claim

Area: ux-accessibility | Verdict: CONFIRMED

Files: `src/components/connection-banner.tsx:11`, `src/lib/connection-health.ts:102`, `src/app/display/[sessionId]/display-ui.tsx:795`, `src/app/host/[sessionId]/[gameId]/game-control.tsx:1061`

**What is wrong.** selectShouldAutoRefresh returns true 30s after the browser reports offline, and ConnectionBanner unconditionally calls window.location.reload(), which cannot succeed while the connection is down.

**How it fails.** Pub wifi drops for 90 seconds mid-session. The TV, the player phones and the host device all fire window.location.reload() at t+30s. With no network the reload lands on the browser's "No internet" page and nothing retries: the pub TV at the back of the room is dead until someone physically walks over and reloads it, and it shows a Chrome error page to the whole room instead of the last-known ball. Without the reload all three surfaces would have kept their last-good render and recovered on their own via the 3s poll and the realtime exponential backoff. On the host device the reload also discards selectedNumbers, so a 15-number claim entered during the outage is silently wiped.

**Evidence.** connection-health.ts:34 `const AUTO_REFRESH_THRESHOLD_MS = 30_000;` and lines 102-105 `selectShouldAutoRefresh` only checks `selectHealthy(state)`, which returns false whenever `state.online` is false (effectiveHealthy line 48). connection-banner.tsx lines 11-15: `useEffect(() => { if (shouldAutoRefresh) { window.location.reload(); } }, [shouldAutoRefresh]);` with no navigator.onLine guard. All three surfaces render it: display-ui.tsx:795, player-ui.tsx:662, game-control.tsx:1061.

**Proposed fix.** Gate the reload on `navigator.onLine` and skip it entirely while any host modal is open or selectedNumbers is non-empty. The polling + backoff paths already recover without a reload, so the auto-refresh should be the last resort, not the 30-second default.

**Verifier note.** Traced end to end. connection-health.ts:48 makes effectiveHealthy false whenever state.online is false, selectShouldAutoRefresh (lines 102-105) only consults selectHealthy plus the 30s threshold, and connection-banner.tsx:11-15 calls window.location.reload() from an effect with no navigator.onLine guard. The effect sits above the `if (!visible) return null` early return, so it fires even when the banner is not rendered, and all three surfaces mount the component (display-ui.tsx:795, player-ui.tsx:662, game-control.tsx:1061). useConnectionHealth re-renders once a second, so the threshold is evaluated continuously. An offline reload lands on the browser's network-error page, and on the host de

### 20. [MEDIUM] voidWinner is exported but never called , an admin reviewing a finished night has no way to void a wrongly recorded win

Area: admin-flows | Verdict: CONFIRMED

Files: `src/app/admin/sessions/[id]/actions.ts:357`, `src/app/admin/sessions/[id]/session-detail.tsx:390`

**What is wrong.** voidWinner in the session-detail actions file is dead code: nothing in src/ imports it. The session detail winners table renders a VOID badge but offers no void control, and /admin/history has neither. The only working void path is voidWinnerFromHost on the live host control screen, which requires an admin to be signed in and to navigate into a specific live game.

**How it fails.** The morning after, an admin reviewing /admin/sessions/[id] spots that a £40 Full House was recorded against the wrong game because the host tapped through too fast. Voiding it is an admin-only, money-affecting decision (RLS: winners UPDATE is admin-only) and the admin is the right person. But the winners table has only Time / Game / Winner / Stage / Prize / Status columns and no action button, and /admin/history has no controls at all. The admin's only route is to open the host control page for that already-completed game, which is not linked from anywhere in /admin. In practice the bad row stays, and every subsequent reconciliation and any snowball settlement derived from it is wrong.

**Evidence.** `grep -rn "voidWinner" src/` returns src/app/admin/sessions/[id]/actions.ts:357 (the definition) and only host-side references to the separate `voidWinnerFromHost`; session-detail.tsx:5 imports `createGame, deleteGame, duplicateGame, updateSessionStatus, updateGame, resetSession` , voidWinner is not among them. session-detail.tsx:388-396 renders the VOID / Prize Given / Outstanding badge with no accompanying button.

**Proposed fix.** Wire voidWinner into the session-detail winners table behind a reason-required modal (it already refuses an empty reason and correctly `.select()`s to prove the update landed), and surface the same control on /admin/history. Note the pot-reversal gap in the reset finding applies here too: voiding a jackpot winner after the game has been settled does not move the pot back.

### 21. [MEDIUM] Nothing prevents two games sharing a game_index, and the host's first/last-game detection then misfires

Area: admin-flows | Verdict: CONFIRMED

Files: `src/app/admin/sessions/[id]/actions.ts:158`, `src/app/admin/sessions/[id]/session-detail.tsx:526`, `src/app/host/[sessionId]/[gameId]/page.tsx:83`

**What is wrong.** The Edit-game form exposes a free 'Order' number input and updateGame only checks `game_index >= 1`. There is no unique constraint on (session_id, game_index) in production, so the obvious way to reorder games , retyping the order number , creates duplicates. The host game page compares game_index values rather than positions, so both duplicates are classified identically.

**How it fails.** Session has games at index 1, 2, 3, 4. The admin wants game 4 played second, so they open it and change Order from 4 to 2. updateGame accepts it (Number.isFinite && >= 1), update_game_safe writes it, and the session now has indexes 1, 2, 2, 3. The host opens the first index-2 game: `indexes` (sorted) is [1,2,2,3], and `isLastGameOfSession` compares `game.game_index === indexes[indexes.length - 1].game_index` → 2 === 3 is false, fine; but open the index-3 game and `isFirstGameOfSession`/`isLastGameOfSession` still key on values, so any duplicate at the first or last position (e.g. reorder game 1 to index 3 giving 2,3,3,4 , both index-3 games report isLast = true) makes the host see 'End Session' wording on a game that is not the last one, or the house-rules briefing on a game that is not the first. The two duplicate games also render as 'Game 2' and 'Game 2' on the admin table, the host dashboard and the winners list, so a recorded win cannot be attributed to the right game afterwards.

**Evidence.** src/app/admin/sessions/[id]/actions.ts:168-170 , the only check is `if (!Number.isFinite(game_index) || game_index < 1)`. session-detail.tsx:523-529 renders `<Input type="number" name="game_index" defaultValue={editingGame ? editingGame.game_index : nextIndex} required />` with no uniqueness check. Live pg_constraint for `games`: only games_pkey, games_session_id_fkey, games_snowball_pot_id_fkey , no unique on (session_id, game_index). src/app/host/[sessionId]/[gameId]/page.tsx:83-85 , `const isFirstGameOfSession = indexes.length > 0 && game.game_index === indexes[0].game_index;` and the mirrored isLast check.

**Proposed fix.** Add a unique index on games(session_id, game_index) and surface a friendly error on 23505, or give the admin explicit up/down reorder buttons that swap indexes in one RPC. Independently, change the host page to compare positions (find the row by id in the ordered list) rather than comparing game_index values, matching what moveToNextGameOnBreak already does with its `.order('game_index').order('created_at')` tiebreak.

### 22. [MEDIUM] /admin/history lists voided winners as if they were paid , the void flag is never read

Area: admin-flows | Verdict: CONFIRMED

Files: `src/app/admin/history/page.tsx:34`, `src/app/admin/history/page.tsx:89`

**What is wrong.** The Winner History page selects `*` from winners with no filter on is_void and renders no void indicator, so a win an admin deliberately voided is indistinguishable from a real one. The session detail page does show a VOID badge, so the two admin views of the same data disagree.

**How it fails.** During the night a host mis-hears a claim, records a £50 Full House winner, then an admin voids it via the host screen with reason 'false call'. `winners.is_void` becomes true. The next morning the admin opens /admin/history (linked from the top nav as 'Winners') to reconcile the till: the voided £50 row is listed with prize '£50', stage 'Full House', a normal-looking date and call count, with nothing to say it was cancelled. The night's payout is reconciled £50 over. There is also no prize_given column, so outstanding prizes are invisible here too.

**Evidence.** src/app/admin/history/page.tsx:34-41 , `.from('winners').select('*, session:sessions (name, start_date), game:games (name, type)').order('created_at', { ascending: false })` with no `.eq('is_void', false)`. The row JSX at :89-107 renders created_at, session/game, winner_name, prize_description, stage and call_count_at_win and never references `winner.is_void` or `winner.void_reason`. Contrast src/app/admin/sessions/[id]/session-detail.tsx:390-394 which does render a VOID badge from the same column.

**Proposed fix.** Render a VOID badge (and the void_reason on hover) plus a Prize Given / Outstanding column, matching session-detail.tsx, and strike through or dim voided rows. Add a 'hide voided' toggle rather than filtering them out silently, since the void audit trail is the point of keeping them.

### 23. [MEDIUM] A standard game whose name contains the word "jackpot" has all its configured prizes overwritten at start, and the admin cannot put them back

Area: admin-flows | Verdict: CONFIRMED

Files: `src/lib/jackpot.ts:13`, `src/app/host/actions.ts:339`, `src/app/admin/sessions/[id]/actions.ts:217`

**What is wrong.** isCashJackpotGame falls back to a name regex for any game not typed 'jackpot' or 'snowball'. A standard three-stage game named e.g. 'Game 5 - Jackpot Warm-Up' therefore prompts the host for a cash amount at start, and startGame then writes that one prize string over every stage in games.prizes. Once the game has started, update_game_safe refuses to write prizes, so the admin has no way to restore them.

**How it fails.** Admin creates a standard game named 'Interval Jackpot Special' with Line £10, Two Lines £20, Full House £40 , all validated and saved. The host starts it, is asked for a cash jackpot amount, and enters 100. startGame builds `updatedPrizes` by looping over stage_sequence and assigning `'£100 Cash Jackpot'` to every stage, then writes it to games.prizes. The display and player screens now advertise '£100 Cash Jackpot' for the Line and the Two Lines as well as the Full House, and the winners recorded for Line and Two Lines carry that prize_description. The admin opens the game to fix it: the fieldset is disabled (game in_progress) and update_game_safe takes the locked branch, which updates only name, game_index, background_colour and notes. The original prizes are gone and unrecoverable without direct database access.

**Evidence.** src/lib/jackpot.ts:3-14 , `if (gameType === 'jackpot') return true; if (gameType === 'snowball') return false; return /\bjackpot\b/i.test(gameName);` (type 'standard' falls through to the regex). src/app/host/actions.ts:339 `const requiresCashJackpotAmount = isFirstStartAttempt && isCashJackpotGame(gameDetailsForStart.name, gameDetailsForStart.type);` and :352-364 `for (const stage of gameDetailsForStart.stage_sequence || []) { updatedPrizes[stage] = jackpotPrizeText; }` then `.from('games').update(gamePrizeUpdate).eq('id', gameId)`. Live update_game_safe: the `v_status <> 'not_started'` branch omits prizes entirely.

**Proposed fix.** Drop the name-regex fallback now that `games.type` carries 'jackpot' explicitly (all 60 live games have a type), or at minimum restrict the overwrite to stage_sequence's final stage. Warn in the admin game form when a standard game's name matches /\bjackpot\b/i. Also, that `.update()` at host/actions.ts:361 has no `.select()`, so a filtered write would be reported as success.

### 24. [MEDIUM] Nothing caps a snowball pot's max_calls at 90, so a typo makes every Full House win the jackpot

Area: admin-flows | Verdict: CONFIRMED

Files: `src/app/admin/snowball/actions.ts:12`, `src/app/admin/snowball/actions.ts:16`, `src/lib/snowball.ts:17`

**What is wrong.** SnowballPotSchema validates base_max_calls and current_max_calls only as `>= 1`. There are 90 balls, and jackpot eligibility is `numbersCalledCount <= maxCalls`, so any value above 90 makes the jackpot window permanently open.

**How it fails.** An admin editing the pot fat-fingers Current Max Calls as 480 instead of 48 (the field sits next to a 'Set to Must Go (90)' helper, so three digits look plausible). isSnowballJackpotEligible(count, 480) is true for every possible call count, so record_winner_atomic's window re-check passes and the host is offered , and can award , the full jackpot to whoever gets the Full House on ball 87. The pot then resets to base. The pub pays out the snowball on a night it should have rolled over, and if base_max_calls carries the same typo, resetSnowballPot restores it.

**Evidence.** src/app/admin/snowball/actions.ts:12 `base_max_calls: z.coerce.number().min(1)` and :16 `current_max_calls: z.coerce.number().min(1)` , no `.max()`, no `.int()`. src/lib/snowball.ts:17-19 `export function isSnowballJackpotEligible(numbersCalledCount: number, maxCalls: number): boolean { return numbersCalledCount <= maxCalls; }`. The form's own helper button sets the field to 90 (snowball-list.tsx:186-195), confirming 90 is the intended ceiling.

**Proposed fix.** Change both to `z.coerce.number().int().min(1).max(90)` and add matching CHECK constraints on snowball_pots so a hand-crafted API call cannot bypass it either. Add `.int()` to calls_increment too.

### 25. [MEDIUM] "Reset to Ready" is offered precisely while the session is live, and wipes a game in progress with no live-game guard

Area: admin-flows | Verdict: CONFIRMED

Files: `src/app/admin/sessions/[id]/session-detail.tsx:268`, `src/app/admin/sessions/[id]/session-detail.tsx:326`, `src/app/admin/sessions/[id]/actions.ts:322`

**What is wrong.** The reset button renders exactly when isSessionLocked (status 'running' or 'completed'), so its most reachable state is a session that is being played right now. Neither resetSession nor reset_session_safe checks for an in_progress game, takes any lock, or warns that the session is live.

**How it fails.** Game 3 of tonight's session is in progress, 47 balls called, two winners already recorded. An admin on /admin/sessions/[id] means to reset last week's session but is on the wrong tab, types RESET (a fixed, guessable string , the session name is also accepted), and confirms. reset_session_safe deletes all winners for the session and all game_states rows. The AFTER DELETE trigger clears game_states_public, so the TV display and every player phone go blank mid-game. getCurrentGameState fails on the host page and the host is redirected to /host (src/app/host/[sessionId]/[gameId]/page.tsx:66-68). The 47 called numbers and both winners are gone with no undo; restarting the game generates a fresh shuffled number_sequence, so the paper books in the room no longer match.

**Evidence.** session-detail.tsx:268 `const isSessionLocked = session.status === 'running' || session.status === 'completed';` and :324-327 `{isSessionLocked && (<Button ... onClick={handleShowReset}>Reset to Ready (Unlock)</Button>)}`. session-detail.tsx:273 `const isResetConfirmed = resetTyped === 'RESET' || resetTyped === session.name;`. Live reset_session_safe contains no status check and no `for update`. The modal text (session-detail.tsx:800-810) never mentions that a game may be running.

**Proposed fix.** Add a status precheck inside reset_session_safe: raise if any game_states row for the session is 'in_progress' (locked `for update`), so the guard is binding rather than cosmetic. In the UI, drop 'RESET' as an accepted phrase (require the session name only) and show a red live-game warning listing the number of winners and called numbers about to be destroyed.

### 26. [MEDIUM] The session-locked guard on adding and cloning games exists only in the UI; the server actions accept both on a running session, and Clone is not even disabled

Area: admin-flows | Verdict: CONFIRMED

Files: `src/app/admin/sessions/[id]/actions.ts:53`, `src/app/admin/sessions/[id]/actions.ts:237`, `src/app/admin/sessions/[id]/session-detail.tsx:491`

**What is wrong.** createGame and duplicateGame never look at sessions.status. The Add Game buttons are disabled when isSessionLocked, but the per-row Clone button has no disabled prop at all, so an admin can append a game to a live or completed session with one click.

**How it fails.** The session is 'running' and the host is on game 3 of 4. An admin on /admin/sessions/[id] clicks Clone on game 2 to prepare next week's line-up. duplicateGame computes maxIndex + 1 = 5 and inserts 'Game 2 (Copy)' into the live session. When the host finishes game 4, moveToNextGameOnBreak reads the games live, finds a position after game 4, and starts 'Game 2 (Copy)' , a game the room has no book for. The same hole exists for createGame via a direct server-action call. Cloning into a completed session also silently reopens it for the host dashboard.

**Evidence.** src/app/admin/sessions/[id]/actions.ts:53-125 (createGame) and :237-284 (duplicateGame) both authorize admin and then write, with no read of sessions.status. session-detail.tsx:413 and :421 disable Add Game with `disabled={isSessionLocked}`; :491 `<Button ... onClick={() => handleDuplicateGame(game.id)}>Clone</Button>` has no disabled prop, while the Delete button next to it does. src/app/host/actions.ts:849-864 reads the session's games at move time, so a late insert is picked up.

**Proposed fix.** Read sessions.status in createGame and duplicateGame and refuse when it is 'running' or 'completed' (or push both through a SECURITY DEFINER RPC that checks under a lock, as delete_game_safe already does), and add `disabled={isSessionLocked}` to the Clone button.

### 27. [MEDIUM] Manual pot edit and reset move the money in one round trip and log the audit in another, swallow audit failures, and never prove the update landed

Area: admin-flows | Verdict: CONFIRMED

Files: `src/app/admin/snowball/actions.ts:106`, `src/app/admin/snowball/actions.ts:125`, `src/app/admin/snowball/actions.ts:229`, `src/app/admin/snowball/actions.ts:252`

**What is wrong.** updateSnowballPot and resetSnowballPot both do a bare `.update()` with no `.select()` , the exact shape CLAUDE.md forbids , and then insert the snowball_pot_history audit row as a separate, unguarded round trip whose failure is console.error'd and reported to the admin as success. This is the split-round-trip problem the codebase already fixed for the host path in settle_snowball_pot, left standing on the admin path.

**How it fails.** An admin corrects the pot from £280 to £200 on /admin/snowball. The `snowball_pots` update commits. The follow-up insert into snowball_pot_history fails (statement timeout on the `authenticated` role is 8s, or a transient error). `auditError` is logged to the server console only and the action returns `{ success: true }`. The admin sees the pot at £200 with no record of who changed it, when, or from what. The money moved with no audit trail, on the one table CLAUDE.md designates as the money table. Symmetrically, because neither update calls `.select()`, any write that matched zero rows would be reported as a success.

**Evidence.** src/app/admin/snowball/actions.ts:106-113 , `.from('snowball_pots').update(parsed.data).eq('id', id)` then only `if (error)`. :125-128 , `if (auditError) { console.error(...); // Continue despite error, not critical to block action }`. Identical shape at :229-255. Compare CLAUDE.md: "Every direct .update() must either .select() and treat zero rows as an error, or go through an RPC that returns the persisted value" and "Don't split snowball settlement back into two round trips."

**Proposed fix.** Move both operations into SECURITY DEFINER RPCs (update_snowball_pot_safe / reset_snowball_pot_safe) guarded by assert_is_admin() that write the pot and the history row in one transaction and RETURN the persisted pot row, mirroring settle_snowball_pot. Fail the action if the audit row does not land.

### 28. [MEDIUM] game_states UPDATE grants hosts every column of every row, defeating call_next_number's atomic guards

Area: auth-security | Verdict: CONFIRMED

Files: `supabase/migrations/20251221101438_add_game_states_public.sql:18`

**What is wrong.** "Hosts/Admins can update game state" has a USING clause of role in (admin,host) and no WITH CHECK and no column scope, and authenticated holds table-wide UPDATE. Every protection built into call_next_number, void_last_number and the controller heartbeat is therefore advisory: the same account can write the row directly.

**How it fails.** A host PATCHes /rest/v1/game_states?game_id=eq.<id> with {"controlling_host_id":"<their own uid>"} to steal control from the live host mid-game, or with {"numbers_called_count":10,"called_numbers":[...]} to rewrite the board. The rewritten count is what record_winner_atomic reads for v_call_count and for the jackpot window test (`v_window_open := v_call_count <= v_pot_max_calls`), so setting numbers_called_count to 10 at ball 80 reopens the jackpot window through the supposedly-server-authoritative path. The sync_game_states_public trigger then pushes the forged called_numbers straight onto the pub TV and every punter's phone.

**Evidence.** pg_policies: game_states | Hosts/Admins can update game state | UPDATE | qual = role in (admin,host) | with_check = null. record_winner_atomic: "v_call_count := coalesce(v_state.numbers_called_count, 0); ... v_window_open := v_call_count <= v_pot_max_calls;" , both read straight from the host-writable row. pg_class.relacl for game_states = {...authenticated=arwdDxtm/postgres...}.

**Proposed fix.** Revoke UPDATE on public.game_states from anon and authenticated and route every host write through SECURITY DEFINER functions (call_next_number, void_last_number and new ones for break / pause / resume / end / stage), which is already the pattern for the hot path. Short of that, add a WITH CHECK and restrict the grant to the specific columns the direct updates in src/app/host/actions.ts touch, and never include called_numbers, numbers_called_count, number_sequence or controlling_host_id.

### 29. [MEDIUM] Hosts can rewrite any column of any session, including the is_test_session flag that switches off snowball settlement

Area: auth-security | Verdict: CONFIRMED

Files: `supabase/migrations/20251221101436_fix_host_permissions.sql:4`, `src/app/host/actions.ts:505`

**What is wrong.** "Hosts can update sessions" was added purely so startGame could set status='running' and active_game_id, but it is an unscoped UPDATE with no WITH CHECK, so a host can write name, notes, status, created_by and is_test_session on any session row directly.

**How it fails.** A host PATCHes /rest/v1/sessions?id=eq.<live session> with {"is_test_session":true}. record_winner_atomic then takes the `v_is_test = false` branch and never marks a Full House as a snowball jackpot, and settle_snowball_pot returns 'test_session' and never rolls the pot over, so the pot silently stops growing for a whole night of real play. The reverse (flipping a test session to is_test_session=false) makes rehearsal games settle the real cash pot. The same policy also lets a host set any draft session to status='running', which puts it on /host and on the public /display session picker.

**Evidence.** pg_policies: sessions | Hosts can update sessions | UPDATE | qual = (EXISTS ... role='host') | with_check = null. settle_snowball_pot: "if coalesce(v_is_test, false) then return query select 'test_session'...". record_winner_atomic: "if v_is_test = false and v_game.type = 'snowball' ... then v_is_snowball_full_house := true;".

**Proposed fix.** Drop the blanket policy and move the two writes startGame and endGame need (status, active_game_id) into a SECURITY DEFINER function guarded by assert_is_host(), the way settle_snowball_pot already handles the pot. If the policy is kept as an interim, add a WITH CHECK that pins is_test_session, name, notes and created_by to their existing values.

### 30. [MEDIUM] startGame runs as service-role and never checks the game belongs to the session it is told to start

Area: auth-security | Verdict: CONFIRMED

Files: `src/app/host/actions.ts:189`, `src/app/host/actions.ts:315`, `src/app/host/actions.ts:485`, `src/app/host/actions.ts:505`

**What is wrong.** getServiceRoleClient() returns an RLS-bypassing client whenever SUPABASE_SERVICE_ROLE_KEY is set, and startGame uses it for every write. The only gate is authorizeHost (host or admin). sessionId and gameId arrive as separate server-action arguments and are never checked against games.session_id, and games.prizes is written with the service-role client even though games UPDATE is admin-only in RLS.

**How it fails.** A host invokes the startGame server action with startGame('<session A id>', '<game belonging to session B>'). The games lookup filters only on id, the game_states write only on game_id, and then sessions is updated to status='running', active_game_id=<game B> for session A. /display picks the single ready/running session and renders active_game_id, so the pub TV now shows a game from a different session while /host/[sessionA]/[gameB] 404s. Separately, calling startGame('<any session>','<any not-started game whose name matches /\bjackpot\b/i>', '99999') writes games.prizes for every stage as service-role, a write the admin-only "Admins can manage games" policy is meant to forbid to hosts.

**Evidence.** src/app/host/actions.ts:189-200 getServiceRoleClient(); line 315 `const dbClient = getServiceRoleClient() || supabase;`; line 317-321 `.from('games').select(...).eq('id', gameId)` with no `.eq('session_id', sessionId)`; lines 358-364 `dbClient.from('games').update(gamePrizeUpdate).eq('id', gameId)`; lines 500-509 `dbClient.from('sessions').update({status:'running', active_game_id: gameId}).eq('id', sessionId)`. isCashJackpotGame (src/lib/jackpot.ts:13) also matches any game merely *named* "jackpot".

**Proposed fix.** Add `.eq('session_id', sessionId)` to the games lookup and fail the action when it returns nothing. Then stop using the service-role client here: every write startGame performs is one the cookie client is already entitled to under RLS for a host, so `const dbClient = supabase` removes an RLS-bypass path with no functional loss (and forces the games.prizes write onto a properly authorised route).

### 31. [MEDIUM] winners INSERT policy checks only the caller's role, so a host can hand-craft a jackpot winner row

Area: auth-security | Verdict: CONFIRMED

Files: `supabase/migrations/20251201000000_baseline_schema.sql:291`

**What is wrong.** "Hosts/Admins can create winners" has WITH CHECK that only tests profiles.role, with no constraint on any column. authenticated holds full INSERT on public.winners (relacl arwdDxtm). Every guard that makes a recorded win trustworthy (controller lock, stage match, session match, jackpot window, call count derived server-side) lives inside record_winner_atomic and is skipped entirely by a direct PostgREST insert.

**How it fails.** A host opens devtools on /host, takes the access token, and runs POST /rest/v1/winners with {session_id, game_id, stage:'Full House', winner_name:'Anonymous', is_snowball_jackpot:true, prize_given:true, call_count_at_win:1}. No controller lock, no stage check, no window check applies. When the game ends, settle_snowball_pot's `exists (select 1 from winners where game_id=... and coalesce(is_snowball_jackpot,false) and coalesce(is_void,false)=false)` sees the fabricated row and resets the pot to base, booking the whole jackpot as paid. The same insert can also fabricate wins on a game that never ran, and /admin/history reports them as real payouts.

**Evidence.** pg_policies: winners | Hosts/Admins can create winners | INSERT | with_check = (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND (role='admin' OR role='host'))). pg_class.relacl for winners = {...authenticated=arwdDxtm/postgres...}. pg_constraint returns no CHECK constraints on winners at all, so winner_name is not pinned to 'Anonymous' either.

**Proposed fix.** Revoke INSERT on public.winners from anon and authenticated and let only record_winner_atomic (SECURITY DEFINER, already asserting host + controller + stage) write the table, exactly as snowball_pots is handled today. If the policy must stay, at minimum add a WITH CHECK pinning winner_name='Anonymous', is_snowball_jackpot=false, is_void=false and prize_given=false so the privileged path is the only one that can set the money-bearing flags.

### 32. [MEDIUM] The Postgres harness is not wired into any script or CI, and the repo has no CI at all

Area: code-quality | Verdict: CONFIRMED

Files: `package.json:6`, `supabase/tests/run.sh:1`

**What is wrong.** `bash supabase/tests/run.sh` is invokable only by hand. package.json exposes dev/build/start/lint/test and nothing else; there is no `test:db`, no `typecheck`, and no .github directory, so nothing runs lint, tsc, the Node tests or the SQL harness on push or before a migration is applied to production.

**How it fails.** A contributor edits a host RPC migration and pushes. Vercel builds and deploys on push (build only runs `next build`, which does not run tests). Nothing has run `npm test`, `npx tsc --noEmit` or run.sh. A broken record_winner_atomic reaches production and is discovered by a host mid-game.

**Evidence.** package.json scripts block: {"dev","build","start","lint":"eslint","test":"node --test --import tsx"}. `ls .github` -> "No such file or directory". `find . -name '*.yml' -not -path ./node_modules` returns nothing. CLAUDE.md's Common Commands section documents `npm run typecheck` which does not exist in this project.

**Proposed fix.** Add `"typecheck": "tsc --noEmit"` and `"test:db": "bash supabase/tests/run.sh"` to package.json, and a .github/workflows/ci.yml running lint -> typecheck -> test -> build on pull requests, with test:db gated on a `supabase/migrations/**` path filter (it needs Docker).

### 33. [MEDIUM] display-ui.tsx and player-ui.tsx share 574 identical lines of data layer, and the overlay gating has already drifted

Area: code-quality | Verdict: CONFIRMED

Files: `src/app/display/[sessionId]/display-ui.tsx:167`, `src/app/player/[sessionId]/player-ui.tsx:163`, `src/app/player/[sessionId]/player-ui.tsx:605`

**What is wrong.** 574 of display-ui's 1105 lines and player-ui's 900 lines are byte-identical: the session/game/state fetch, both realtime channels, the reconnect-on-visibility handler, the polling fallback, the snowball pot subscription and the whole planReveal pacing effect. The two copies differ only in the logError scope string ('display' vs 'player') and a channel-name suffix. Drift has already begun in the derived UI flags.

**How it fails.** display-ui gates every overlay on `hasRenderableGame` and documents why: "a stale on_break or paused_for_validation flag on a finished game can never stack a break or claim-check overlay on top of the waiting screen" (line 609-612). player-ui does not carry that gate: `isOnBreak = currentGameState?.on_break` (line 606) and `isValidating = currentGameState?.paused_for_validation` (line 608) read the raw row. player-ui also recomputes waiting as `!isSessionCompleted && !hasRenderableGame` (line 605) instead of `loadPhase === 'waiting'`, so the phase machine it just built is bypassed. The next fix applied to one screen will not reach the other, and guests at the table will see something the pub TV does not.

**Evidence.** difflib SequenceMatcher over the two files: "display lines 1105 player lines 900 identical lines 574", with equal blocks including display 505-579 / player 502-576 (75 lines, the entire reveal-pacing effect) and display 251-297 / player 247-293 (47 lines, the game-state realtime channel). Diff of the shared region shows the only changes are `logError('display', ...)` -> `logError('player', ...)` and `channel(\`session_updates:...\`)` -> `channel(\`session_updates_player:...\`)`.

**Proposed fix.** Extract `usePublicGameFeed({ sessionId, initialSession, initialGame, initialGameState, initialLoadStatus, scope })` into src/hooks/use-public-game-feed.ts covering display-ui 115-495 / player-ui 106-491, returning {currentSession, currentActiveGame, currentGameState, currentSnowballPot, connectionPhase, health}. Extract `useRevealQueue(currentActiveGame, currentGameState)` from display-ui 496-578 returning {delayedNumbers, revealedCallCount, currentNumberDelayed}. Then align player-ui's overlay flags on hasRenderableGame and loadPhase to match display-ui, or document in both files why the phone deliberately differs.

### 34. [MEDIUM] game-control.tsx is a 1914-line client component with 39 useState, 8 useEffect and 8 inline modals

Area: code-quality | Verdict: CONFIRMED

Files: `src/app/host/[sessionId]/[gameId]/game-control.tsx:45`

**What is wrong.** One component owns the realtime transport, the polling fallback, the winners lists, the snowball pot subscription, the claim flow, seven mutation flows and eight modals. 37 handler consts sit in a single closure and the JSX return spans lines 1036-1913 (878 lines).

**How it fails.** Every state change re-renders all eight modals and the 90-button claim grid. More importantly for correctness: handleTakeControl (line 169) closes over applyMutation, declared 254 lines later at line 423, and the code carries a comment apologising for the temporal dead zone. Any future refactor that calls handleTakeControl during render rather than on click throws a ReferenceError at exactly the moment a host is trying to take over a stuck game. Reviewers cannot hold 39 pieces of state in their head, which is how the duplicate-winner and stuck-CALLING bugs the comments describe got in.

**Evidence.** Counts from the file: 39 `useState`, 8 `useEffect(`, 3 `useRef(`, 6 `useCallback(`, 37 `const handle*/apply*/poll*` declarations, 8 `<Modal` blocks. Line 176 comment: "applyMutation is declared further down but only ever runs on a click, by which point the const is initialised for this render."

**Proposed fix.** Extract along five named seams, none of which changes behaviour: (1) `useHostGameFeed(gameId)` from lines 126-141, 377-410 (pollGameState), 423-441 (applyMutation), 444-514 (realtime channel + backoff), 518-536 (poll interval + visibility) returning {gameState, applyMutation, pollGameState, health}; (2) `useSessionWinners(sessionId, gameId)` from lines 70-71, 191-258, 260-285; (3) `useSnowballPot(game)` from lines 339-372; (4) `useClaimFlow()` from lines 52-53, 88-95, 719-750, 771-863; (5) the eight modals into ./modals/{ClaimCheck,SessionWinners,VoidWinner,Undo,RecordWinner,PostWin,CashJackpot,ManualSnowball}Modal.tsx (JSX lines 1279-1413, 1416-1495, 1499-1543, 1547-1593, 1596-1704, 1710-17

### 35. [MEDIUM] maybeCompleteSession swallows every failure silently, including the final session-completion write

Area: code-quality | Verdict: CONFIRMED

Files: `src/app/host/actions.ts:277`

**What is wrong.** maybeCompleteSession has three early `return` statements on error with no logging, and its final sessions update discards the result object entirely. It is called from endGame, advanceToNextStage and skipStage, and it is the only thing that marks a session completed.

**How it fails.** The host finishes the last game of the night. The `games` read or the `game_states` read blips on pub wifi, or the sessions update is rejected. maybeCompleteSession returns quietly, endGame returns success, and the host sees a normal finish. sessions.status stays 'running' and active_game_id may stay set, so /display keeps auto-redirecting the pub TV into a finished session and the next night's session picker shows two 'running' sessions. Nothing is in the Vercel logs, because none of the three failure paths calls logActionFailure.

**Evidence.** src/app/host/actions.ts:283 `if (error || !games || games.length === 0) return;`, :292 `if (completedStatesError) return;`, and :298-302: await supabase .from('sessions') .update({ status: 'completed', active_game_id: null }) .eq('id', sessionId) with no destructuring of the result. Every other write in this 1514-line file logs its failure.

**Proposed fix.** Give the function a `Promise<{ completed: boolean; error?: string }>` return, call logActionFailure on each early return, and add `.select('id')` to the update so a zero-row result is reported. Have the callers surface a session-level warning rather than silently succeeding.

### 36. [MEDIUM] No error.tsx, global-error.tsx, not-found.tsx or loading.tsx anywhere in the app

Area: code-quality | Verdict: CONFIRMED

Files: `src/app/layout.tsx:21`, `src/app/display/[sessionId]/page.tsx:27`

**What is wrong.** `find src/app -name 'error.tsx' -o -name 'global-error.tsx' -o -name 'not-found.tsx' -o -name 'loading.tsx'` returns nothing. The display and player pages call notFound() but there is no not-found.tsx to render.

**How it fails.** An uncaught render error inside display-ui.tsx (a malformed prizes JSON, an unexpected null on currentActiveGame.stage_sequence) puts Next's default error page on the pub TV in front of a full room, with no branding, no auto-recovery and nothing but a reload to escape. The app has built careful in-app recovery for connection failures (ConnectionBanner auto-refresh, the 'failed' load phase) but has no equivalent for a render throw. Separately, a mistyped /display/<uuid> gives guests Next's stock 404 rather than the pub's own screen.

**Evidence.** The find returns empty. src/app/display/[sessionId]/page.tsx:27 and :41 call notFound(); src/app/player/[sessionId]/page.tsx:26 and :40 the same; src/app/host/[sessionId]/[gameId]/page.tsx:21, :48, :61 the same. src/app/login/page.tsx:114 is the only Suspense boundary in the codebase.

**Proposed fix.** Add src/app/display/[sessionId]/error.tsx and src/app/player/[sessionId]/error.tsx rendering the existing 'Reconnecting to the game' panel with a `reset()` button and a setTimeout auto-reset, since these screens are unattended. Add src/app/global-error.tsx and a branded src/app/not-found.tsx.

### 37. [MEDIUM] Five high-severity advisories in production dependencies, including Next itself, kept out by exact version pins

Area: code-quality | Verdict: CONFIRMED

Files: `package.json:14`, `package.json:20`

**What is wrong.** `npm audit --omit=dev` reports 5 high-severity vulnerabilities in next, postcss, sharp, ws and nanoid. `next` and `eslint-config-next` are pinned exactly ("16.1.4", no caret) so no patch release is ever picked up; 16.1.4 sits inside the vulnerable range 9.3.4-canary.0 - 16.3.0-preview.10, and the fix is 16.3.2.

**How it fails.** The advisory list for the pinned Next version includes "Middleware / Proxy bypass in App Router applications via segment-prefetch routes" and "Middleware / Proxy bypass through dynamic route parameter injection" (both high). This app's only edge auth gate is src/proxy.ts on /admin/:path*. A crafted segment-prefetch request to /admin/... can skip the proxy entirely. The page-level supabase.auth.getUser() re-check limits the blast radius, but the documented boundary is bypassable and the fix is a version bump that the exact pin blocks. The `ws` advisory sits under @supabase/realtime-js, which runs the WebSocket on every public display and phone.

**Evidence.** `npm audit --omit=dev` -> "5 high severity vulnerabilities", affecting nanoid, next, postcss, sharp, ws. Advisory titles include "Next.js has a Middleware / Proxy bypass in App Router applications via segment-prefetch routes" (high) and "Next.js has a Middleware / Proxy bypass through dynamic route parameter injection" (high). `npm outdated`: next 16.1.4 -> 16.3.2; @supabase/supabase-js 2.91.0 -> 2.112.4; @supabase/ssr 0.8.0 -> 0.12.5.

**Proposed fix.** Bump next and eslint-config-next to 16.3.2, @supabase/supabase-js to 2.112.x and @supabase/ssr to 0.12.x, then run `npm audit --omit=dev` to confirm clean. Keep the exact pin on next if that is deliberate, but add a monthly bump to the routine, or switch to a caret and rely on the lockfile.

### 38. [MEDIUM] The money function settle_snowball_pot has zero test coverage, and run.sh applies only 4 of 26 migrations

Area: code-quality | Verdict: CONFIRMED

Files: `supabase/tests/run.sh:56`, `supabase/tests/run.sh:222`, `supabase/migrations/20260730065531_atomic_snowball_settlement.sql`, `CLAUDE.md`

**What is wrong.** supabase/tests/run.sh loads exactly four migration files and asserts only call_next_number, void_last_number, record_winner_atomic and bump_game_state_version. settle_snowball_pot (211 lines, decides jackpot reset vs rollover and computes both new pot values), set_winner_prize_given, update_game_safe, delete_game_safe, delete_session_safe and reset_session_safe are never loaded and never asserted anywhere.

**How it fails.** A change to settle_snowball_pot inverts or mis-guards the reset/rollover branch (for example dropping the `coalesce(is_void,false) = false` predicate that CLAUDE.md flags as load-bearing). `npm test` passes because the Node tests mock Supabase entirely. `bash supabase/tests/run.sh` passes because it never loads the file. The defect ships and the first snowball night after it either resets a pot that should have rolled over (jackpot silently deleted) or rolls over a pot that was won (the pub pays the jackpot again next week).

**Evidence.** run.sh declares only four migration paths: HOST_MUTATIONS="$MIGRATIONS/20260729231945_atomic_host_mutations.sql" WINNER_IDEMPOTENCY="$MIGRATIONS/20260730064309_winner_idempotency_key.sql" REVOKE_ANON="$MIGRATIONS/20260730070705_revoke_anon_execute_on_host_rpcs.sql" REVOKE_TRIGGER="$MIGRATIONS/20260730072329_revoke_anon_on_bump_game_state_version.sql" and `grep -roh 'settle_snowball_pot|set_winner_prize_given|update_game_safe|delete_game_safe|reset_session_safe|delete_session_safe' supabase/tests/` returns zero matches. Only call_next_number (8), void_last_number (8), record_winner_atomic (36) and bump_game_state_version (17) appear. CLAUDE.md claims the harness "applies the host-mutation migrations in order" and that a production apply "can be gated on it".

**Proposed fix.** Add a Suite D to run.sh that applies 20260430124120_atomic_admin_mutations.sql, 20260730065446_host_can_mark_prize_given.sql and 20260730065531_atomic_snowball_settlement.sql over the harness schema, then asserts settle_snowball_pot's four outcomes ('settled' reset, 'settled' rollover, 'already_settled', 'test_session'), the voided-jackpot-winner rollover case, and the new_max_calls/new_jackpot_amount arithmetic against base_/increment_ columns. Correct the CLAUDE.md testing paragraph to name exactly which functions are covered.

### 39. [MEDIUM] Ranked gaps: the behaviours that would break a game night and have no test of any kind

Area: code-quality | Verdict: CONFIRMED

Files: `src/hooks/use-connection-health.ts:3`, `src/app/host/actions.ts:305`, `src/app/host/actions.ts:44`

**What is wrong.** There are no tests for any React component or hook, and no test for any server action. Ranked by what actually stops a live game: (1) the useConnectionHealth dependency-array trap; (2) startGame's four-branch state machine; (3) the mapHostRpcError key contract with the SQL migrations; (4) settle_snowball_pot, covered separately.

**How it fails.** (1) use-connection-health.ts:3-13 documents in capitals that putting the returned object in a dependency array silently kills all live updates on the host screen: the 3-second poll is cleared before it fires and the Realtime channel is re-subscribed every second. Only the pure reducer in connection-health.ts is tested. Nothing catches a reintroduction, and the symptom is a host screen that looks fine and simply stops updating mid-game. (2) startGame (305-521) branches four ways (fresh insert, not_started conditional update, in_progress takeover, completed restart), each with its own binding predicate and conflict path, plus the jackpot-prize write; a wrong branch either wipes a board mid-game or refuses a legitimate takeover, and none of the four is exercised. (3) HOST_RPC_ERRORS (44-68) maps raised SQL keys to host wording; if a migration renames a key such as `winner_on_ball`, mapHostRpcError falls through to 'Something went wrong. Please try again.' and the undo modal's 'Open Winners and Prizes' escape hatch disappears, because that button is gated on `code === 'winner_on_ball'` (game-control.tsx:1557).

**Evidence.** `ls src/hooks/*.test.ts` -> no matches. No .test.ts exists for any file under src/app. mapHostRpcError:74 `const key = (rawMessage ?? '').trim().split(':')[0]` then `HOST_RPC_ERRORS[key] ?? { error: GENERIC_ACTION_ERROR }`. game-control.tsx:1557 `{undoError.code === 'winner_on_ball' && (<Button ...>Open Winners and Prizes</Button>)}`.

**Proposed fix.** Add, in this order: a lint rule or a small test that fails if `health` appears in any dependency array (a source grep test is enough and costs nothing); a test for mapHostRpcError that reads the raise keys out of supabase/migrations/*.sql and asserts every one has an entry in HOST_RPC_ERRORS; and startGame branch tests against a stubbed Supabase client covering the four status branches and their conflict returns.

### 40. [MEDIUM] An admin edit to a running game reaches neither the host screen nor the pub TV: the game row is a static prop on the host page and nothing subscribes to `games`

Area: completeness | Verdict: CRITIC, unverified

Files: `src/app/host/[sessionId]/[gameId]/page.tsx:38`, `src/app/host/[sessionId]/[gameId]/game-control.tsx:187`, `src/app/display/[sessionId]/display-ui.tsx:168`

**What is wrong.** `games` is not in the realtime publication and no client subscribes to it. The host page fetches the game row server-side once and passes it as a prop; game-control never re-reads it. display-ui only re-fetches the game row inside refreshActiveGame, which returns early when the active game id has not changed. So any admin edit that IS permitted mid-game (name, game_index, background_colour, notes) is invisible on both live surfaces until a full reload.

**How it fails.** Mid-game the admin notices the ticket colour on Game 4 is recorded as Yellow when the books are Peach, and corrects background_colour on /admin. The pub TV keeps painting the old colour for the rest of the game and the host briefing keeps saying "Yellow", so the admin reasonably concludes the edit did not save and tries again. Separately, changing game_index to reorder games while one is live silently re-decides which game the host page believes is first/last (isFirstGameOfSession / isLastGameOfSession are computed once at page render), so the post-win button wording can be wrong for the rest of the game.

**Evidence.** src/app/host/[sessionId]/[gameId]/page.tsx:38-45 fetches the game once and passes `game={game}` to GameControl; `grep -n "from('games')" game-control.tsx` returns nothing, and getPlannedPrize (line 187) reads `game.prizes` from that static prop. display-ui.tsx:168-171 `if (newActiveGameId === currentActiveGameId) return { status: 'ok', ... }` before any games fetch. `pg_publication_tables` for supabase_realtime (queried read-only) contains only game_states, game_states_public, sessions.

**Proposed fix.** Either fold the fields the live surfaces need (name, background_colour, prizes) into the polling refresh that already runs every 3 seconds on the public screens and add an equivalent on the host, or block all game edits while game_states.status is 'in_progress' and say so in the admin UI. Silently accepting an edit that no live surface honours is the worst of the three options.

### 41. [MEDIUM] The only 1-90 board in the host app lives inside the claim-check modal, and opening that modal immediately pauses the game and puts "CHECKING A CLAIM" on the pub TV

Area: completeness | Verdict: CRITIC, unverified

Files: `src/app/host/[sessionId]/[gameId]/game-control.tsx:752`, `src/app/host/[sessionId]/[gameId]/game-control.tsx:294`, `src/app/host/[sessionId]/[gameId]/game-control.tsx:1360`

**What is wrong.** The host pad shows only the current ball plus the previous nine (`called_numbers.slice(-10, -1)`). The full 90-number board exists only inside the validation modal, and handleBeginClaimCheck calls pauseForValidation as its first act. There is no read-only board anywhere on the host screen.

**How it fails.** Forty balls in, a punter at the bar asks the host "did you call 47?" - the single most common question on a bingo night. 47 is not in the last nine, so the host has no way to answer from the main pad. Tapping Check Claim to look at the board fires pauseForValidation(gameId), which sets paused_for_validation on game_states, disables Next Number / Break / Undo, and drives both public screens into the "Checking a claim" overlay in front of the whole room. The host has stopped the game to answer a question. The only way back is to reopen the modal and press "Cancel & Resume" (and per the separately-reported finding there is no Resume control on the main pad at all).

**Evidence.** game-control.tsx:752-767 `const handleBeginClaimCheck = async () => { ... setShowValidationModal(true); setIsPausing(true); try { const pauseResult = await pauseForValidation(gameId); ... } }`. game-control.tsx:294 `const lastNNumbers = (currentGameState.called_numbers || []).slice(-10, -1);`. The only `Array.from({ length: 90 }` in the file is at line 1360, inside the validation modal.

**Proposed fix.** Add a read-only "Board" sheet on the host pad that renders the same 90-cell grid from called_numbers with no server call and no pause. Reuse the grid component; the claim modal keeps the tappable version.

### 42. [MEDIUM] On the claim grid, called and uncalled numbers share the same background and differ only by text opacity and a 60%-alpha 1px border - on the one screen the app documents as being used by a colour-blind host

Area: completeness | Verdict: CRITIC, unverified

Files: `src/app/host/[sessionId]/[gameId]/game-control.tsx:1364`, `src/lib/colour-name.ts:26`

**What is wrong.** In the 90-number claim grid, an uncalled cell is `bg-[#0f6846] text-white/55` and a called cell is `bg-[#0f6846] text-white font-bold border border-[#a57626]/60`. Same background, same size, no icon, no text label. The codebase elsewhere states explicitly that the host is colour-blind and that a colour word is the accessibility primary, but that reasoning was never applied here.

**How it fails.** Under pub lighting on a phone, the host is entering a punter's fifteen Full House numbers against the clock. Because called and uncalled cells look near-identical, the host cannot use the grid to sanity-check the claim before submitting and is entirely dependent on the server's invalidNumbers reply. Worse, on a claim that IS valid the host has no visual confirmation that the numbers they tapped were the ones the punter read out - and the panel above shows only a count, never the numbers back as text (already reported separately). A transposed digit that happens to also be a called number validates as a win.

**Evidence.** game-control.tsx:1364-1377: uncalled `let buttonStyle = "bg-[#0f6846] text-white/55 hover:bg-[#136f4b]"`; called `buttonStyle = "bg-[#0f6846] text-white font-bold border border-[#a57626]/60"`. src/lib/colour-name.ts:26-28 comment: "Returns the literal \"Unknown colour\" for invalid input - never an empty string. The host is colour-blind; the colour word is the accessibility primary."

**Proposed fix.** Give called cells a genuinely different treatment that does not rely on hue or opacity - a filled light background with dark text, or a small check glyph - and add `aria-pressed` / `aria-label={`${num}, called`}` so the state is announced. Pair it with the textual read-back of the selected numbers.

### 43. [MEDIUM] getContrastColor - the exact fix for the pale-game-colour-behind-white-text problem - already exists in the codebase and is called from nowhere

Area: completeness | Verdict: CRITIC, unverified

Files: `src/lib/utils.ts:14`, `src/app/player/[sessionId]/player-ui.tsx`, `src/app/display/[sessionId]/display-ui.tsx`, `src/app/admin/sessions/[id]/session-detail.tsx`

**What is wrong.** src/lib/utils.ts exports a complete YIQ-luminance helper that returns 'text-white' or 'text-slate-900' for a given hex, with a deliberately conservative threshold and a comment explaining the choice. `grep -rn getContrastColor src` finds exactly one hit: the definition. Neither public screen, nor the admin colour picker, nor the pre-game briefing uses it.

**How it fails.** An admin picks a pale yellow for a game's background_colour (production games already use pale yellows and peaches). The player page paints the viewport that colour and puts white text and the "View All Numbers" button on top; the button becomes invisible on a punter's phone. The helper that would have returned 'text-slate-900' for that hex sits unused three imports away, so the bug is not a missing capability but an unwired one - and there is also no warning at pick time in the admin form.

**Evidence.** src/lib/utils.ts:14 `export function getContrastColor(hexColor: string): 'text-white' | 'text-slate-900'`. `grep -rn "getContrastColor" src` returns only `src/lib/utils.ts:14`. It also has no test, unlike eleven of the fifteen lib modules.

**Proposed fix.** Wire getContrastColor into display-ui and player-ui wherever background_colour is painted, and into the admin colour input as a live "this colour needs dark text" preview. Add a test for the threshold. If the helper is judged wrong, delete it rather than leaving a live-looking fix unconnected.

### 44. [MEDIUM] The app cannot answer "how much did we pay out tonight?" - winners store free text with no amount column and no screen totals anything

Area: completeness | Verdict: CRITIC, unverified

Files: `src/app/admin/history/page.tsx`, `src/app/admin/sessions/[id]/session-detail.tsx:379`, `supabase/migrations/20251201000000_baseline_schema.sql`

**What is wrong.** public.winners has prize_description text and prize_given boolean and no numeric amount. No admin screen sums anything. At the end of a cash bingo night the pub has to reconcile the till against what was handed over, and the app has no concept of the total.

**How it fails.** The night finishes with nine games, sixteen recorded winners, two ties and a snowball rollover. The landlord needs to know how much cash left the till. /admin/sessions/[id] lists winner rows with prize_description rendered as a string; /admin/history does the same across all nights. There is no total, no per-game subtotal, and because the prizes are strings like "£20 + Snowball Jackpot £140" and "£20 Snowball Full House" they cannot be summed even by hand without reading each one. The one number the business actually needs is the one number the system cannot produce.

**Evidence.** Live schema for public.winners (queried read-only): id, session_id, game_id, stage, winner_name, prize_description (text), prize_given, call_count_at_win, is_snowball_jackpot, is_void, void_reason, created_at, is_snowball_eligible, client_request_id. No amount column. session-detail.tsx:379 renders `{winner.prize_description || '-'}`. No `reduce`, `sum` or total appears on either admin winner surface.

**Proposed fix.** Add a numeric prize_amount_pence to winners, populate it from the parsed prize (parseCashJackpotAmount already exists) and from the jackpot amount in record_winner_atomic, then show "Paid out tonight: £X (of which £Y handed over)" on the session detail page and a per-session total on /admin/history. This also makes the prize_given tick meaningful.

### 45. [MEDIUM] The app has no concept of splitting a prize, while the pub TV displays "Multiple claims share the prize" as a house rule

Area: completeness | Verdict: CRITIC, unverified

Files: `src/lib/house-rules.ts:36`, `supabase/migrations/20260730064309_winner_idempotency_key.sql:230`, `src/app/host/[sessionId]/[gameId]/game-control.tsx:1611`, `src/app/admin/history/page.tsx`

**What is wrong.** HOUSE_RULES rule 2 is "Multiple claims share the prize", rendered on the display's waiting/break/completed screens and in the host briefing. PRD FR-14 also requires split-win logic. Nothing in the code splits anything: each tied winner is inserted with the full, unmodified prize_description, and the host is never prompted to halve it. The already-reported snowball double-jackpot is one instance of a rule that is missing everywhere.

**How it fails.** Two punters shout on the same ball for the Line prize of £20. The host validates the first, records the winner (prize_description "£20"), taps "Validate Another Winner", validates the second and records them too (prize_description "£20"). The pub actually pays £10 each. The winners table and /admin/history now say £40 went out for a £20 stage, on a night where the TV was telling the room the opposite. Because prize_description is free text with no numeric field, nothing downstream can ever reconcile it.

**Evidence.** src/lib/house-rules.ts:36 `segments: [{ text: 'Multiple claims share the prize' }]`. record_winner_atomic inserts `prize_description` straight from `p_prize_description` with no awareness of other winners at the same stage/call count. game-control.tsx:1611 binds the Record Winner modal's prize field to the shared `prizeDescription` state, prefilled from getPlannedPrize and never adjusted for a tie. docs/PRD.md FR-14: "Split wins logic: Multiple winners on same call share the status."

**Proposed fix.** When recordWinner runs and a non-void winner already exists for the same game and stage, have record_winner_atomic return that fact and have the host modal prompt "Second claim on this stage - split the prize?", pre-filling a halved amount. Longer term, add a numeric prize_amount_pence column alongside prize_description so a split is representable and totallable.

### 46. [MEDIUM] There is no way to create a staff account or reset a staff password from inside the app or from anything in this repo, despite FR-3 requiring password reset

Area: completeness | Verdict: CRITIC, unverified

Files: `src/app/login/actions.ts:38`, `src/app/login/page.tsx`, `src/app/api/setup/route.ts:88`, `README.md:51`

**What is wrong.** PRD FR-3 requires "Login, Logout, Basic password reset". The login page offers no forgot-password link and there is no reset route, no resetPasswordForEmail call anywhere in src/. signup() is a hard-coded refusal. /api/setup only promotes an existing auth user to admin - it cannot create one. So the entire staff account lifecycle lives in the Supabase dashboard and is documented nowhere in the repo.

**How it fails.** It is 7pm on a Friday. The regular host is off sick and a stand-in staff member needs to run the night. Either (a) they have never had an account, in which case someone must open the Supabase dashboard, create the auth user manually, and know that handle_new_user will grant them 'host' - a step written down nowhere; or (b) they have an account but have forgotten the password, in which case there is no forgot-password link on /login, no reset route, and no path forward without dashboard access. Bingo does not start.

**Evidence.** `grep -rni "resetPassword|forgot" src` returns nothing. src/app/login/actions.ts:38-41 `export async function signup(): Promise<ActionResult> { return { success: false, error: 'Registration is invite-only. Please contact an administrator.' } }`. src/app/api/setup/route.ts:88-91 only `.from('profiles').update({ role: 'admin' }).eq('id', user.id)` on a user found via listUsers. README.md mentions only that login is invite-only and that /api/setup exists. Live trigger on_auth_user_created runs handle_new_user, which inserts role 'host'.

**Proposed fix.** Add a "Forgot password" link on /login wired to supabase.auth.resetPasswordForEmail plus a /login/reset callback route - this is a small, self-contained change and closes a named PRD requirement. Then either extend /api/setup to invite a user by email (admin.inviteUserByEmail) or write the manual dashboard procedure into README.md so it survives the person who knows it.

### 47. [MEDIUM] Test sessions are filtered out of /display and nowhere else: Winner History and the host session list show test winners as real, with no marker and no filter

Area: completeness | Verdict: CRITIC, unverified

Files: `src/app/admin/history/page.tsx:33`, `src/app/host/page.tsx:26`, `src/app/admin/dashboard.tsx:163`, `src/app/admin/sessions/[id]/session-detail.tsx`

**What is wrong.** PRD FR-46 requires test sessions to be filtered from history, and FR-16 requires All / Test / Non-test filters on the sessions list. Only /display/page.tsx applies `.eq('is_test_session', false)`. Winner History selects every winners row with no session filter and renders no test badge; the host dashboard lists test sessions inline with real ones; the admin sessions list has no filter control.

**How it fails.** An admin runs a full 10-game rehearsal on a session flagged is_test_session before a new host's first night, recording a dozen fake winners to check the flow. Those winners are inserted normally (record_winner_atomic only uses is_test_session to suppress the jackpot flag, not to skip the insert). /admin/history - the pub's only cross-session record of who won what - now interleaves twelve fabricated wins with the real ones, ordered by created_at, with no VOID badge, no test badge and no way to filter them out. The next time anyone reconciles prizes against the record, the rehearsal is indistinguishable from a real Friday.

**Evidence.** src/app/admin/history/page.tsx:33-40 `.from('winners').select('*, session:sessions (name, start_date), game:games (name, type)').order('created_at', ...)` - no is_test_session filter, and the rendered row (checked through the file) carries no test indicator. src/app/host/page.tsx:26-34 filters only `.in('status', ['ready','running'])`. `grep -n "filter" src/app/admin/dashboard.tsx` returns nothing. docs/PRD.md FR-46: "Test sessions: Filtered from history, no impact on real pots."

**Proposed fix.** Add `.eq('is_test_session', false)` as the default on /admin/history with a "show test sessions" toggle, add a TEST badge to any row that survives the toggle, and add the All / Test / Non-test filter to /admin. FR-17's archive flag (also entirely absent) would solve the same list-growth problem.

### 48. [MEDIUM] Default privileges still hand anon EXECUTE on every new function and full DML on every new table in public

Area: db-integrity | Verdict: CONFIRMED

Files: `supabase/migrations/20260730070705_revoke_anon_execute_on_host_rpcs.sql`, `supabase/migrations/20260730072329_revoke_anon_on_bump_game_state_version.sql`, `supabase/migrations/20251201000000_baseline_schema.sql:330`

**What is wrong.** Two recent migrations revoked anon EXECUTE from the existing RPCs one by one, but nothing changed the schema's default ACLs. `pg_default_acl` still grants `anon=X` on functions and `anon=arwdDxtm` on tables in `public`, for both the `postgres` and `supabase_admin` grantors, so the next object created re-opens the hole.

**How it fails.** A future migration adds a host RPC, say `set_house_rules(...)`, following the pattern of the existing files but forgetting the two revokes. It is created with `anon=X/postgres` from the default ACL, so an unauthenticated visitor to /display can call `POST /rest/v1/rpc/set_house_rules` with the public anon key. It only fails if the function itself calls `assert_is_host()`. Likewise a new table added without an explicit `enable row level security` is created with full `arwdDxtm` for anon and is world-writable through PostgREST. This is the same class of defect that migrations 20260730070705 and 20260730072329 were written to clean up, and it is still armed.

**Evidence.** Live `pg_default_acl`: `{role: postgres, sch: public, defaclobjtype: f, acl: postgres=X/postgres | anon=X/postgres | authenticated=X/postgres | service_role=X/postgres}` and `{role: postgres, sch: public, defaclobjtype: r, acl: ... anon=arwdDxtm/postgres ...}`, plus the identical pair for grantor `supabase_admin`. `grep -rn "alter default privileges" supabase/` returns only `supabase/tests/harness-schema.sql:227` , no production migration ever sets them.

**Proposed fix.** Add a migration that runs `alter default privileges for role postgres in schema public revoke execute on functions from anon, public;` and the same for `supabase_admin`, so the base posture is closed and each new function has to opt in with an explicit `grant execute ... to authenticated`. Consider the same for tables if no new table is ever meant to be anon-writable. Extend `supabase/tests/grants.test.sql` to assert the default ACL, not just the current per-object ACLs.

### 49. [MEDIUM] Deleting a snowball pot unlinks every historical game and then fails on a foreign key, leaving irreversible damage

Area: db-integrity | Verdict: CONFIRMED

Files: `src/app/admin/snowball/actions.ts:156`, `src/app/admin/snowball/actions.ts:166`, `src/app/admin/snowball/actions.ts:175`

**What is wrong.** `deleteSnowballPot` nulls `games.snowball_pot_id` for every game on the pot, then tries to delete `snowball_pot_history` rows , but there is no DELETE policy on that table, so the delete silently matches zero rows , then deletes the pot, which violates `snowball_pot_history_snowball_pot_id_fkey` (no ON DELETE clause). The action returns the raw Postgres error after the destructive step has already committed.

**How it fails.** Once any settlement or manual pot edit has written a `snowball_pot_history` row (the current `settle_snowball_pot` writes one on every snowball game end), an admin clicks Delete on /admin/snowball. Step 1 sets `snowball_pot_id = null` on all 6 historical snowball games , committed. Step 2 (`.delete().eq('snowball_pot_id', id)`) is filtered out by RLS: no error, no rows. Step 3 raises `23503 update or delete on table "snowball_pots" violates foreign key constraint "snowball_pot_history_snowball_pot_id_fkey"`, which is returned to the UI as a raw database string. The pot still exists, but every past game has lost its pot link, so `settle_snowball_pot` now returns `not_snowball` for them and /admin/history/session-detail can no longer show which pot a past snowball game belonged to. There is no undo.

**Evidence.** Live policies on snowball_pot_history are only "Admins insert history" (INSERT) and "Admins view history" (SELECT) , no DELETE policy, and relforcerowsecurity=false does not help because the caller is `authenticated`, not the owner. Live constraint: `snowball_pot_history_snowball_pot_id_fkey FOREIGN KEY (snowball_pot_id) REFERENCES snowball_pots(id)` with no ON DELETE. Code order in deleteSnowballPot: `.from('games').update({ snowball_pot_id: null })` (line 156) → `.from('snowball_pot_history').delete()` (line 166) → `.from('snowball_pots').delete()` (line 175).

**Proposed fix.** Replace the three round trips with a `delete_snowball_pot_safe(p_pot_id uuid)` SECURITY DEFINER function guarded by `assert_is_admin()` that does the whole thing in one transaction, refuses when the pot has ever settled a game, and only then unlinks and deletes. At minimum, reorder so the pot delete is attempted first and add `on delete cascade` (or a delete policy) for the history rows.

### 50. [MEDIUM] games.game_index has no unique constraint per session, and a duplicate makes the host screen think two games are the last one

Area: db-integrity | Verdict: CONFIRMED

Files: `supabase/migrations/20251201000000_baseline_schema.sql:132`, `src/app/admin/sessions/[id]/actions.ts:69`, `src/app/host/[sessionId]/[gameId]/page.tsx:83`

**What is wrong.** Nothing at any layer stops two games in a session sharing a `game_index`: no DB constraint, and both `createGame` and `updateGame` accept a user-typed value validated only as `>= 1`. The host page derives first/last game purely by comparing `game_index` values, so a collision mislabels the run.

**How it fails.** An admin edits Game 3's "Game order" field to 5 on /admin/sessions/[id] while Game 5 already exists (the form pre-fills max+1 but the input is free). `update_game_safe` writes it; there is no unique index to stop it. On the host screen for the earlier of the two index-5 games, `isLastGameOfSession` is computed as `game.game_index === indexes[indexes.length - 1].game_index` and is true. After the final stage of that game, `isEndOfSession` is true, so the host is shown the end-of-session buttons instead of "Move to Next Game" , the precise failure the code comment says "is how two sessions were left running". `isFirstGameOfSession` has the mirror problem, showing the house-rules briefing twice.

**Evidence.** Live indexes on `games`: only `games_pkey`. No CHECK or UNIQUE constraint exists anywhere in the public schema (`select * from pg_constraint where contype='c'` returns nothing). Validation is `if (!Number.isFinite(game_index) || game_index < 1) { return { success: false, error: 'Game order must be a positive number.' } }` (createGame line 69, updateGame line 168). Host page: `const isLastGameOfSession = indexes.length > 0 && game.game_index === indexes[indexes.length - 1].game_index;`. Comment at game-control.tsx:319: "Labelling it 'Move to Next Game' when no next game exists reads as 'not for me', which is how two sessions were left running." Live data has no duplicates today (`dup_game_index` = 0 across 60 games / 6 sessions).

**Proposed fix.** Add `create unique index games_session_game_index_key on public.games (session_id, game_index)` and surface the resulting 23505 as a friendly message in createGame/updateGame. Separately, change the host page to compare game ids from the ordered list rather than index values, so it is robust regardless.

### 51. [MEDIUM] reset_session_safe leaves the snowball settlement claim behind, so a replayed session can never move the pot again

Area: db-integrity | Verdict: CONFIRMED

Files: `supabase/migrations/20260430124207_reset_session_safe_status_ready.sql:42`, `supabase/migrations/20260730065531_atomic_snowball_settlement.sql`, `src/app/admin/sessions/[id]/actions.ts:347`

**What is wrong.** `reset_session_safe` deletes `winners` and `game_states` for the session but does not touch `snowball_pot_history`, whose `(snowball_pot_id, game_id)` partial unique index is the settlement claim. The game ids survive the reset, so the claim survives and permanently blocks any further settlement of that game.

**How it fails.** Session S contains snowball game G on pot P (currently £140 / 54 calls). The night is run badly: G ends with no jackpot, `settle_snowball_pot(G)` writes history row (P,G) and rolls the pot to £160 / 56. The admin resets the session on /admin/sessions/[id] (types RESET). `reset_session_safe` deletes the winners and game states and sets the session back to 'ready'; the pot stays at £160 and the (P,G) history row stays. The session is replayed properly. When G ends this time, `settle_snowball_pot` hits `unique_violation` on `snowball_pot_history_pot_game_unique`, returns `already_settled`, and the pot does not move. Worse variant: the bad run had a jackpot claimed, so the pot was reset to base £20/42; after the reset-and-replay with no jackpot the pot should roll to £160/56 but is stuck at £20/42. Either way the live jackpot figure shown to punters is wrong and only a manual /admin/snowball edit can fix it.

**Evidence.** Prod `reset_session_safe` body: `begin perform public.assert_is_admin(); delete from public.winners where session_id = p_session_id; delete from public.game_states gs using public.games g where gs.game_id = g.id and g.session_id = p_session_id; update public.sessions set status = 'ready', active_game_id = null where id = p_session_id; end;` , no reference to snowball_pot_history or snowball_pots. Live index: `CREATE UNIQUE INDEX snowball_pot_history_pot_game_unique ON public.snowball_pot_history USING btree (snowball_pot_id, game_id) WHERE (game_id IS NOT NULL)`. Prod `settle_snowball_pot` catches that violation: `exception when unique_violation then ... return query select 'already_settled'::text, ...`.

**Proposed fix.** Inside `reset_session_safe`, before deleting winners, reverse the settlement for the session's games under a `for update` lock on the pot: for each `snowball_pot_history` row whose `game_id` belongs to this session, restore `snowball_pots.current_max_calls`/`current_jackpot_amount` from that row's `old_val_max`/`old_val_jackpot` (newest first), then delete the claim rows. Keep it in the same transaction as the rest of the reset.

### 52. [MEDIUM] The live jackpot pot has moved six times with zero audit rows, and the admin pot actions still swallow audit-write failures

Area: db-integrity | Verdict: CONFIRMED

Files: `src/app/admin/snowball/actions.ts:116`, `src/app/admin/snowball/actions.ts:243`

**What is wrong.** `snowball_pot_history` is empty in production while the one live pot has demonstrably advanced from its base values, so there is no record of who moved the pub's jackpot or when. `updateSnowballPot` and `resetSnowballPot` both log an audit-insert failure to the server console and return success, so the same silent loss can recur on the next manual edit.

**How it fails.** An admin corrects the jackpot on /admin/snowball. The `snowball_pots` update succeeds. The follow-up `snowball_pot_history` insert fails for any reason (RLS, FK on `changed_by`, transient error); the code does `console.error(...)` and continues, and the action returns `{ success: true }`. The pot has changed with no audit row and nobody is told. Because these are two separate round trips, a crash between them produces the same result. Today's live state is exactly that shape: `snowball_pots` = 1 row, name "2026 Snowball", base 42 calls / £20, increments 2 / £20, current 54 calls / £140 (precisely six rollovers), and `snowball_pot_history` = 0 rows.

**Evidence.** Live query: `select relname, n_live_tup from pg_stat_user_tables` → snowball_pot_history n_live_tup = 0. `select * from snowball_pots` → base_max_calls 42, base_jackpot_amount 20.00, calls_increment 2, jackpot_increment 20.00, current_max_calls 54, current_jackpot_amount 140.00, last_awarded_at null. `select type, count(*) from games group by 1` → snowball = 6. Code: `if (auditError) { console.error("Error logging snowball pot update history:", auditError.message); // Continue despite error, not critical to block action }` (line 116) and the identical block at line 243.

**Proposed fix.** Move both manual admin pot writes behind a SECURITY DEFINER RPC that writes the pot row and the history row in one transaction and returns the persisted values, the same shape `settle_snowball_pot` already uses. Failing that, treat `auditError` as a hard failure and return `{ success: false }`.

### 53. [MEDIUM] The 30 second auto-reload fires while the browser is offline, replacing the live host console with the browser's offline error page and discarding the claim in progress

Area: failure-paths | Verdict: CONFIRMED

Files: `src/components/connection-banner.tsx:9`, `src/lib/connection-health.ts:37`, `src/hooks/use-connection-health.ts:52`, `src/app/host/[sessionId]/[gameId]/game-control.tsx:1061`

**What is wrong.** `reduceHealth` treats a browser `offline` event as instantly unhealthy, and `selectShouldAutoRefresh` returns true 30 seconds later; `ConnectionBanner` then calls `window.location.reload()` unconditionally. Reloading a device that has no network cannot succeed - it destroys the working client and lands on the browser's "No internet" page, which has no retry of its own.

**How it fails.** Pub wifi drops for 45 seconds mid-game. At t+0 the browser fires `offline`, `online` goes false, `effectiveHealthy` goes false and `unhealthySinceMs` is stamped. The 1 second tick in `useConnectionHealth` keeps re-evaluating; at t+31 `shouldAutoRefresh` flips true and the banner effect reloads. The device still has no network, so the host console is replaced by the browser error page. When wifi returns at t+45 nothing recovers on its own - a human has to notice and tap reload. Until then the game is completely uncontrollable, where before the reload the page was at least still readable and would have resumed calling as soon as the next poll succeeded. Additionally, all client-only state is lost even on a successful reload: `selectedNumbers` (the ticket the host had just finished tapping in), `validationResult`, and `claimRequestIdRef` - so a claim check that was 14 numbers deep must be re-entered from scratch, and the idempotency key that protects a retried `recordWinner` is gone. Same code path is live on `/display` and `/player`.

**Evidence.** `export function ConnectionBanner({ visible, shouldAutoRefresh }) { useEffect(() => { if (shouldAutoRefresh) { window.location.reload(); } }, [shouldAutoRefresh]); ...` with no `navigator.onLine` guard. `function effectiveHealthy(state) { if (!state.online) return false; ... }` and `export function selectShouldAutoRefresh(state, now) { ... return now - state.unhealthySinceMs > AUTO_REFRESH_THRESHOLD_MS; }` where `AUTO_REFRESH_THRESHOLD_MS = 30_000`. No `beforeunload` handler and no persistence of `selectedNumbers` anywhere in game-control.tsx.

**Proposed fix.** Do not auto-reload when `!navigator.onLine`, and do not auto-reload the host screen at all while a modal holding unsaved work (claim selection, Record Winner) is open - the poll and the realtime backoff already recover without a reload. Persist `selectedNumbers` and the claim key to `sessionStorage` keyed by gameId so a reload, deliberate or automatic, does not throw away a half-entered ticket.

### 54. [MEDIUM] `callNextNumber` has no idempotency key while its own error copy tells the host to retry, so a lost response draws a second unannounced ball

Area: failure-paths | Verdict: CONFIRMED

Files: `src/app/host/actions.ts:586`, `src/app/host/[sessionId]/[gameId]/game-control.tsx:538`, `src/lib/call-timing.ts:11`

**What is wrong.** `recordWinner` is protected by a client-minted `clientRequestId` precisely so a call that commits but loses its response can be safely retried. The identical failure mode on `callNextNumber` has no such protection: the only guard is `HOST_MIN_CALL_GAP_MS = 400`, an anti-double-tap window that a retry after a timeout always clears.

**How it fails.** Host taps "NEXT NUMBER". `call_next_number` commits (ball 34 appended, `last_call_at = now()`), then the wifi drops before the response arrives. The catch fires: "Could not reach the server to call the next number. Check the connection and try again." The host does exactly that, eight seconds later. `v_remaining_ms = 400 - 8000` is negative, the gap check passes, and ball 71 is drawn. Two balls are now on the board, only one was called out to the room, and the pub TV reveals both 1.2 seconds apart via the reveal queue. The host cannot tell from the failure whether the first call landed - the same message appears whether the request died before or after commit. In a snowball game this also burns one of the jackpot-window calls counted by `v_window_open := v_call_count <= v_pot_max_calls`, so the jackpot can close a ball earlier than it should. Recovery: "Undo Last Call" removes the extra ball and puts it back in the bag, but only if the host notices, and only while no winner has been recorded on it.

**Evidence.** src/app/host/actions.ts: `const { data: gameState, error: rpcError } = await supabase.rpc('call_next_number', { p_game_id: gameId, p_min_gap_ms: HOST_MIN_CALL_GAP_MS })` - no request-id parameter, and the live function signature is `call_next_number(p_game_id uuid, p_min_gap_ms integer DEFAULT 400)` with the gap check `v_remaining_ms := coalesce(p_min_gap_ms, 0) - (extract(epoch from (now() - v_state.last_call_at)) * 1000); if v_remaining_ms > 0 then raise exception 'too_soon:%'`. `export const HOST_MIN_CALL_GAP_MS = 400;`. Client catch: `setActionError("Could not reach the server to call the next number. Check the connection and try again.")`.

**Proposed fix.** Mint a call-request uuid on the client per tap of NEXT NUMBER, pass it into `call_next_number`, store it on `game_states` (or a small `calls` audit table) and return the existing row unchanged when the key is already spent - the same shape `record_winner_atomic` uses. Short of that, change the error copy so it does not instruct a retry, and instead tell the host to check the call count before tapping again.

### 55. [MEDIUM] The controller lock can be taken but never released, so a second staff device that grabs control locks the real host out for as long as its tab stays open

Area: failure-paths | Verdict: CONFIRMED

Files: `src/app/host/actions.ts:531`, `src/app/host/actions.ts:152`, `src/app/host/[sessionId]/[gameId]/game-control.tsx:149`, `src/app/host/[sessionId]/[gameId]/game-control.tsx:1067`

**What is wrong.** `controlling_host_id` is only ever set to a user id - nothing in `src/` or in any Postgres function ever sets it back to null, and there is no "hand back control" button. The only route away from a holder is the 30 second stale-heartbeat window in `takeControl` / `startGame`, which requires the holder to stop heart-beating.

**How it fails.** Host puts their phone face-down on the bar during the break. iOS suspends the page, the 10 second `sendHeartbeat` interval stops, and after 30 seconds `controller_last_seen_at` is stale. The duty manager, who has `/host/[session]/[game]` open on their own phone to watch, sees a pulsing amber "Take Control" button - the UI actively invites the tap - and presses it. `takeControl`'s `.or('controller_last_seen_at.lt."<staleBefore>"')` matches and control moves. The real host picks their phone back up and is now in "View Only Mode" with every control greyed out and no Take Control button, because `canTakeControl` is false while the manager's heartbeat is live. They cannot call the next number until the manager closes that tab and 30 more seconds elapse. If the manager's tab is merely backgrounded rather than closed, Chrome throttles its 10 second interval towards once per minute, so the lock alternates between live and stale and the two devices can ping-pong control all night. Recovery: documented manual step only - the wrong device must close its tab, then wait 30 seconds. No data is corrupted (every mutation re-checks `controlling_host_id = auth.uid()` under a row lock), but the game stalls.

**Evidence.** `grep -rn "controlling_host_id" src` shows assignments only at host/actions.ts:391, 416, 449 and 537, all `controlling_host_id: authResult.user!.id`; every other reference is an `.eq()` guard or a read. `const CONTROLLER_HEARTBEAT_TIMEOUT_MS = 30000` against `interval = setInterval(async () => { await sendHeartbeat(gameId) }, 10000)`. The overlay renders `<Button ... className="... animate-pulse ..." onClick={handleTakeControl}>Take Control</Button>` whenever `canTakeControl`.

**Proposed fix.** Add a "Release control" button for the current holder that nulls `controlling_host_id` (bound to `.eq('controlling_host_id', user.id)`), and show who holds it. Consider also releasing on `pagehide` via `navigator.sendBeacon`, so navigating away or closing the tab hands the lock straight back instead of costing 30 seconds.

### 56. [MEDIUM] The `/display` landing page never refreshes itself and needs a click when zero or two-plus sessions are live

Area: failure-paths | Verdict: CONFIRMED

Files: `src/app/display/page.tsx:21`, `src/app/display/page.tsx:60`

**What is wrong.** `/display` auto-redirects only when exactly one non-test session is in `ready` or `running`. With zero it renders "Waiting for the next game to start..." behind a manual Refresh link, and with two or more it renders a list that has to be clicked. The page is a server component with no polling and no meta refresh, so whatever it renders at load is what stays on the TV.

**How it fails.** Two ways this bites on a real night. (a) Someone switches the pub TV on at 18:30 before the admin has marked tonight's session ready. `/display` renders the "No Active Games" card, the admin marks the session ready at 19:00, and the TV keeps showing the empty card until a member of staff walks over and clicks Refresh. (b) A session was left running from a previous night (see the no-way-to-end-a-game finding), so tonight there are two rows in `('ready','running')`, `sessions.length === 1` is false, the redirect never fires, and the TV shows a two-item picker that needs a mouse or a remote nobody has to hand. Recovery in both cases: a documented manual step at the TV, which is exactly the device nobody wants to be touching mid-service.

**Evidence.** `const { data: sessions } = await supabase.from('sessions').select(...).in('status', ['ready','running']).eq('is_test_session', false)...; if (sessions && sessions.length === 1) { redirect(`/display/${sessions[0].id}`); }` followed by a static card whose only affordance is `<Link href="/display"><Button variant="outline">Refresh</Button></Link>`. No interval, no `router.refresh()`, no client component on this route at all.

**Proposed fix.** Make the landing state a small client component that re-checks every 10 seconds and redirects as soon as exactly one session qualifies, so an unattended TV latches on to the session by itself. When several qualify, prefer the one with `status='running'`, or the most recently created, rather than demanding a click.

### 57. [MEDIUM] A game can only be ended by recording a winner: an abandoned game leaves the session running for ever, and the only admin escape deletes the night's winners

Area: failure-paths | Verdict: CONFIRMED

Files: `src/app/host/[sessionId]/[gameId]/game-control.tsx:1329`, `src/app/host/[sessionId]/[gameId]/game-control.tsx:1738`, `src/app/admin/sessions/[id]/session-detail.tsx:314`, `src/app/admin/sessions/[id]/actions.ts:302`

**What is wrong.** `handleSkipStage` ("Skip (No Winner)") is rendered only inside the `validationResult.valid` branch of the Validate Ticket modal, so it is reachable only after a claim has already been validated as VALID. The Post Win modal, which holds the only "End Game & Finish Session" button, opens only after `recordWinner` succeeds. There is no unconditional End Game control anywhere on the host screen, and the admin screen has no "mark session completed" control - only "Reset to Ready (Unlock)", which calls `reset_session_safe`.

**How it fails.** Fire alarm at 21:40, or the room empties before the Full House is claimed, or the tablet dies and the replacement host wants to abandon the half-played game. The host has no control that ends the game: "Next Number" is the only live button, "Check Claim" needs a claimant, and "Skip (No Winner)" is behind a valid claim. `game_states.status` stays `in_progress` and `sessions.status` stays `running` indefinitely. Knock-on effects the following week: `/display` lists both last week's stuck session and tonight's, so `sessions.length === 1` is false and the auto-redirect never fires - the pub TV shows a session picker that nobody can click; and if the abandoned game was the snowball game, `settle_snowball_pot` never runs, so the pot neither rolls over nor increments its call allowance. The only in-app escape is admin "Reset to Ready (Unlock)", and `reset_session_safe` starts with `delete from public.winners where session_id = p_session_id` - it destroys every winner record for that night, including the ones whose prizes were already handed over. Otherwise: direct DB surgery (`update sessions set status='completed'`).

**Evidence.** `grep -n "handleSkipStage"` returns exactly two hits in game-control.tsx: the definition at 865 and one render at 1329, inside `validationResult.valid ? (<... <Button onClick={handleSkipStage}>Skip (No Winner)</Button>)`. `endGame` is exported from src/app/host/actions.ts but is not in game-control.tsx's import list; it is only reachable via `moveToNextGameOnBreak` / `moveToNextGameAfterWin`, both of which are Post Win buttons. Live function body: `reset_session_safe` = `perform public.assert_is_admin(); delete from public.winners where session_id = p_session_id; delete from public.game_states ...; update public.sessions set status = 'ready', active_game_id = null`. Admin UI offers only `Mark as Ready` (draft only), `Start Session` and `Reset to Ready (Unlock)`.

**Proposed fix.** Add an "End Game (no winner)" control to the host pad, confirm-gated, calling `endGame` directly - it already handles snowball settlement and session completion correctly and refuses when the game is not in progress. Separately, add a non-destructive admin "Mark session completed" that calls the existing `updateSessionStatus(sessionId, 'completed')` server action, which is already written and admin-guarded but has no button.

### 58. [MEDIUM] `current_stage_index` can only ever increase, so any accidental stage advance is unrecoverable without wiping the session

Area: failure-paths | Verdict: CONFIRMED

Files: `src/app/host/actions.ts:1180`, `src/app/host/actions.ts:1444`, `src/app/admin/sessions/[id]/actions.ts:302`

**What is wrong.** Every write to `current_stage_index` in the codebase is `+1` (`advanceToNextStage`, `skipStage`), a fresh start that zeroes it along with `called_numbers`, or `reset_session_safe`. There is no decrement anywhere in `src/` or in any Postgres function, so there is no way to step a game back to a stage it has left.

**How it fails.** Host means to tap "Validate Another Winner" (a tie on Line) but hits "Continue Playing" directly above it in the Post Win modal. `advanceToNextStage` commits and the game is now on Two Lines. The second Line claimant is standing at the bar. `recordWinner` cannot help: `record_winner_atomic` derives `v_expected_stage := v_game.stage_sequence ->> current_stage_index` and raises `stage_mismatch` for any other stage, and the client derives `currentStage` from the same index. Voiding is no use either - it marks a row `is_void` and does not move the index. The only in-app remedy is admin "Reset to Ready (Unlock)", which deletes every winner and every called number for the whole session and starts the night again. Otherwise: direct DB surgery on `game_states.current_stage_index`. The same trap catches a winner recorded against the wrong stage: void the row and the stage has still moved on.

**Evidence.** `grep -rn "current_stage_index" src --include="*.ts" --include="*.tsx"` shows writes at only three places: `current_stage_index: 0` in the fresh-start object (host/actions.ts:438), `let newStageIndex = currentGameState.current_stage_index + 1` in `advanceToNextStage` (1180) and in `skipStage` (1444). No SQL function writes it either. `reset_session_safe` deletes `winners` and `game_states` outright.

**Proposed fix.** Add an admin-only (or controller-only, confirm-gated) "step back one stage" action that decrements `current_stage_index` under the same row lock and refuses if a non-void winner exists at the target stage. It is a small amount of code and it is the difference between a mis-tap costing ten seconds and costing the night's records.

### 59. [MEDIUM] The call-next-number transport-error message tells the host to retry a call that is not idempotent

Area: host-live-flow | Verdict: CONFIRMED

Files: `src/app/host/[sessionId]/[gameId]/game-control.tsx:554`, `supabase/migrations/20260729231945_atomic_host_mutations.sql:21`

**What is wrong.** `call_next_number` has no idempotency key, so a call that commits but loses its response draws a second ball on retry; the client's error copy nonetheless instructs the host to try again, unlike `recordWinner` whose copy explicitly states the retry is safe.

**How it fails.** Host taps NEXT NUMBER. `call_next_number` commits ball 47 but the response is lost on the way back (longer than the 400 ms `HOST_MIN_CALL_GAP_MS`). The client shows "Could not reach the server to call the next number. Check the connection and try again." The host taps again; the gap has elapsed so the server draws ball 12. Ball 47 is on the board and on the public display but was never called out to the room, so a player who marks from the screen and a player who marks from the caller's voice now disagree, and a Line claim on 47 is unverifiable by ear.

**Evidence.** game-control.tsx:553-554: ``` logError('host-control', err); setActionError("Could not reach the server to call the next number. Check the connection and try again."); ``` Compare game-control.tsx:859, where the same class of failure is handled honestly because a key exists: "...tap Confirm Winner again: if the win did save, tapping again will not record it twice." The migration header acknowledges the gap (20260729231945_atomic_host_mutations.sql:21-29): "a call that commits in the database but whose response is lost on the way back to the caller... call_next_number and void_last_number move the count they check, so the repeat is rejected or is at least visible." Live `pg_get_functiondef` confirms `call_next_number` takes no request-id parameter.

**Proposed fix.** Either reword the message to tell the host to check the last called ball on screen before retrying, or give `call_next_number` a client-minted request id (minted per tap) recorded on the state row so a retry returns the committed state instead of drawing again.

### 60. [MEDIUM] Most host mutation handlers have `finally` but no `catch`, so a dropped request shows the host nothing at all

Area: host-live-flow | Verdict: CONFIRMED

Files: `src/app/host/[sessionId]/[gameId]/game-control.tsx:560`, `src/app/host/[sessionId]/[gameId]/game-control.tsx:597`, `src/app/host/[sessionId]/[gameId]/game-control.tsx:634`, `src/app/host/[sessionId]/[gameId]/game-control.tsx:752`, `src/app/host/[sessionId]/[gameId]/game-control.tsx:771`, `src/app/host/[sessionId]/[gameId]/game-control.tsx:865`

**What is wrong.** Only `handleCallNextNumber`, `handleRecordWinner`, `handleTogglePrize`, the manual snowball handler and `handleConfirmCashJackpotAndContinue` catch transport errors; every other mutation handler lets the rejection escape as an unhandled promise rejection, resetting its in-flight flag without setting `actionError`.

**How it fails.** Host taps "Take Break" while the wifi is flapping. `toggleBreak` rejects before reaching the server. `handleToggleBreak`'s `finally` clears `isTogglingBreak`, so the button returns from "Starting break…" to "Take Break" with no message and no state change. The host reads that as "the tap did not register", taps again, and the room is left waiting while the display never shows ON BREAK. The same shape applies to Check Claim, Check Win, Skip Stage, Undo, Resume, Take Control and both Move-to-Next-Game handlers.

**Evidence.** game-control.tsx:560-570 `handleToggleBreak` , `try { ... } finally { setIsTogglingBreak(false); }`, no `catch`. Contrast game-control.tsx:543-557 `handleCallNextNumber`, which does catch and explains why: "Without the catch and finally, one dropped request left isCallingNumber true forever". The same reasoning was never applied to the other handlers. Affected handlers with `try`/`finally` and no `catch`: handleTakeControl (169), handleToggleBreak (560), handleContinuePlaying (578), handleMoveToNextGame (597), handleTakeBreakAfterGame (634), handleBeginClaimCheck (752), handleCheckWin (771), handleSkipStage (865), handleConfirmVoidLastNumber (922), handleResumeGame (945), handleConfirmVoidWinner (995).

**Proposed fix.** Wrap the action call in each handler with the same `catch (err) { logError('host-control', err); setActionError(...) }` used by `handleCallNextNumber`, or route every mutation through a shared `runMutation(fn, fallbackMessage)` helper that owns the try/catch/finally.

### 61. [MEDIUM] Admin snowball pot updates report success without proving the write landed, and swallow a failed audit insert

Area: money-winner-path | Verdict: CONFIRMED

Files: `src/app/admin/snowball/actions.ts:103`, `src/app/admin/snowball/actions.ts:118`, `src/app/admin/snowball/actions.ts:216`, `src/app/admin/snowball/actions.ts:231`

**What is wrong.** `updateSnowballPot`, `resetSnowballPot` and the unlink step in `deleteSnowballPot` all call `.update()` without `.select()`, so a write matching zero rows returns no error and no rows and is reported as success , the exact trap CLAUDE.md names as an invariant, on the money table itself. Worse, both money actions write the pot FIRST and then insert the `snowball_pot_history` audit row, and a failed audit insert is only `console.error`d while the action still returns `{ success: true }`.

**How it fails.** An admin corrects the pot to £160 on /admin/snowball. The pot UPDATE succeeds but the `snowball_pot_history` insert fails (this is not hypothetical , migration 20260729231841 exists because every audit insert on this table was being rejected by RLS for months, with the table sitting at zero rows while the pot had demonstrably moved six times). The admin is told the change saved, the pot has moved, and there is no record of who changed it, from what, or why. If instead the pot UPDATE matches nothing, the admin is still told it saved and walks away believing the pot is £160 when it is not.

**Evidence.** src/app/admin/snowball/actions.ts:103-110 , `const { error } = await supabase.from('snowball_pots').update(parsed.data).eq('id', id); if (error) {...}` , no `.select()`, no row-count check. :112-124 , audit insert after the fact: `if (auditError) { console.error(...); // Continue despite error, not critical to block action }`. :216-231 , same shape in `resetSnowballPot`. :151-156 , `deleteSnowballPot` unlink `.update({snowball_pot_id: null}).eq('snowball_pot_id', id)` with no `.select()`. CLAUDE.md Gotchas: "Every direct `.update()` must either `.select()` and treat zero rows as an error, or go through an RPC that returns the persisted value."

**Proposed fix.** Move both admin pot mutations behind a SECURITY DEFINER RPC that writes the pot and the audit row in one transaction and returns the persisted values, mirroring `settle_snowball_pot`. Short of that, add `.select()` to every update, treat zero rows as an error, and make a failed audit insert fail the action.

### 62. [MEDIUM] A pot settlement that fails once can never be retried: every route to it is gated on a status the game has already left

Area: money-winner-path | Verdict: CONFIRMED

Files: `src/app/host/actions.ts:1229`, `src/app/host/actions.ts:1477`, `src/app/host/actions.ts:800`

**What is wrong.** `advanceToNextStage` and `skipStage` write `status = 'completed'` first, then call `handleSnowballPotUpdate`. If the settlement RPC fails, they return `success: false` with SNOWBALL_POT_NOT_MOVED_ERROR , but the game is already completed, so re-tapping Advance hits `if (currentGameState.status === 'completed') return conflictFailure('This game has already finished.')`, `skipStage` bails the same way, and `endGame` requires `in_progress`. There is no code path that will attempt settlement again.

**How it fails.** Host taps "Advance to next stage" on the final stage of a snowball game. `game_states` commits as completed; the `settle_snowball_pot` call then fails on a transient network/statement error. The host sees "The game finished but the snowball pot did not update. Please check the pot in Admin." and, because the action returned failure, `applyMutation` does not apply the returned state, so the screen still shows the old stage. Tapping Advance again returns "This game has already finished." The pot is stuck at its pre-game value and must be corrected by hand on /admin/snowball, with the admin working out reset-vs-rollover themselves.

**Evidence.** src/app/host/actions.ts:1229-1236 , `if (newGameStatus === 'completed') { const potResult = await handleSnowballPotUpdate(supabase, gameId); if (!potResult.success) { return failure('advanceToNextStage', SNOWBALL_POT_NOT_MOVED_ERROR, potResult.error); } ... }` :1178-1180 , `if (currentGameState.status === 'completed') { return conflictFailure('advanceToNextStage', 'This game has already finished.'); }` :1477-1483 , identical shape in `skipStage`; :775-777 , `endGame` refuses unless `status === 'in_progress'`.

**Proposed fix.** Add an explicit "Settle snowball pot" retry (host action calling `settle_snowball_pot` for a completed game) surfaced by the error, or move settlement inside the same transaction as the completion write so a failure rolls the completion back and the whole action is retryable.

### 63. [MEDIUM] Cancelling the Manual Snowball modal leaves the jackpot amount pre-filled in the next Record Winner

Area: money-winner-path | Verdict: CONFIRMED

Files: `src/app/host/[sessionId]/[gameId]/game-control.tsx:1225`, `src/app/host/[sessionId]/[gameId]/game-control.tsx:890`

**What is wrong.** `prizeDescription` is one shared state. Opening the Manual Snowball Win modal sets it to `£<pot> (Manual Snowball Win)`. `handleOpenRecordWinnerModal` clears `actionError`, `snowballEligibleChoice` and mints a claim key, but does not reset `prizeDescription`, and the only other reset fires on a `current_stage_index` change.

**How it fails.** Host taps Manual Snowball Win to read what it does, sees the "this will reset the pot" warning and cancels. `prizeDescription` is now "£140.00 (Manual Snowball Win)". Two minutes later a normal Full House claim validates, Record Winner opens pre-filled with "£140.00 (Manual Snowball Win)" instead of the planned "£20 Full House", and the host taps Confirm Winner without re-reading the field. The `winners` row , the list the host pays from , says the punter is owed £140.

**Evidence.** src/app/host/[sessionId]/[gameId]/game-control.tsx:1225 , `setPrizeDescription(`£${currentSnowballPot.current_jackpot_amount} (Manual Snowball Win)`);` fires on button click, before the modal opens. :1864 , the Cancel button is `onClick={() => setShowManualSnowballModal(false)}` only. :884-900 `handleOpenRecordWinnerModal` , sets `actionError`, `snowballEligibleChoice`, `claimRequestIdRef`; no `setPrizeDescription`. :286-290 , the only other reset is `useEffect(..., [currentGameState.current_stage_index, getPlannedPrize])`.

**Proposed fix.** Call `setPrizeDescription(getPlannedPrize(currentGameState.current_stage_index))` inside `handleOpenRecordWinnerModal`, and reset it when the Manual Snowball modal is cancelled.

### 64. [MEDIUM] Resetting a session leaves the snowball settlement claim behind, so the replayed game never moves the pot

Area: money-winner-path | Verdict: CONFIRMED

Files: `supabase/migrations/20260430124120_atomic_admin_mutations.sql:174`, `supabase/migrations/20260729231841_snowball_audit_and_settlement_guard.sql:53`, `src/app/host/actions.ts:256`

**What is wrong.** `reset_session_safe` deletes `winners` and `game_states` for the session but not the `snowball_pot_history` rows that carry the `(snowball_pot_id, game_id)` settlement claim. Replaying the same snowball game and ending it hits the partial unique index, `settle_snowball_pot` returns `already_settled`, and `handleSnowballPotUpdate` treats that as success and only writes a log line. The pot silently does not move.

**How it fails.** A session is started by mistake, the snowball game runs and ends (pot rolls £140 -> £160, claim row written), and an admin uses Reset Session to run it again for real. The replay's Full House is won inside the window and recorded as Eligible. On game end, `settle_snowball_pot` finds the old claim for `(pot, game)`, returns `already_settled` and leaves the pot at £160. The pot is NOT reset after a jackpot payout, so the pub pays £160 now and offers the same £160 pot again next week. `handleSnowballPotUpdate` returns `{success: true}` and the host is told nothing.

**Evidence.** Live `reset_session_safe`: `delete from public.winners where session_id = p_session_id; delete from public.game_states gs using public.games g where gs.game_id = g.id and g.session_id = p_session_id; update public.sessions set status='ready', active_game_id=null ...` , no `snowball_pot_history` cleanup. supabase/migrations/20260729231841:53-55 , `create unique index ... snowball_pot_history_pot_game_unique on public.snowball_pot_history (snowball_pot_id, game_id) where game_id is not null;` (confirmed live in `pg_indexes`). src/app/host/actions.ts:271-274 , `if (settlement.outcome === 'already_settled') { logActionFailure(...) } return { success: true };`

**Proposed fix.** Delete `snowball_pot_history` rows whose `game_id` belongs to the session inside `reset_session_safe` (and reverse the pot move they represent, or refuse the reset when a settled snowball game is in the session). Also make `already_settled` visible to the admin rather than only appearing in a log line.

### 65. [MEDIUM] A failed snowball pot fetch silently removes both routes to paying the jackpot and records the Full House as not eligible

Area: money-winner-path | Verdict: CONFIRMED

Files: `src/app/host/[sessionId]/[gameId]/game-control.tsx:343`, `src/app/host/[sessionId]/[gameId]/game-control.tsx:328`, `src/app/host/[sessionId]/[gameId]/game-control.tsx:1215`

**What is wrong.** `currentSnowballPot` is fetched client-side with the error discarded (`const { data } = await ...; if (data) setCurrentSnowballPot(data)`). If that one request fails, `isSnowballChoiceRequired` is false, no eligibility choice is shown, `snowballEligibleChoice` stays `null`, and `recordWinner` is called with `snowballEligible = false` , so `record_winner_atomic` records `is_snowball_jackpot = false`. The Manual Snowball Win button is also hidden because it too is gated on `currentSnowballPot`, so there is no fallback.

**How it fails.** Snowball game, pot £140, window open at call 40. The pub wifi drops the single `snowball_pots` select on page load. The host screen shows no snowball panel and no Manual Snowball Win button. A punter shouts Full House on ball 41. Host checks the claim (valid), opens Record Winner , no Eligible/Not eligible buttons appear because `isSnowballEligibilityStage && currentSnowballPot` is false , and taps Confirm Winner. The row saves with `is_snowball_jackpot = false`. `settle_snowball_pot` then finds no non-void jackpot winner and ROLLS THE POT OVER to £160 instead of resetting it. The punter is not paid the £140 they won, and the host has no on-screen route to fix it.

**Evidence.** src/app/host/[sessionId]/[gameId]/game-control.tsx:343-350 , `const { data } = await supabase.from('snowball_pots').select('*').eq('id', game.snowball_pot_id).single(); if (data) setCurrentSnowballPot(data);` (error ignored, no retry, no banner). :322-328 , `const isSnowballJackpotWindowOpen = !!(currentSnowballPot && isSnowballJackpotEligible(...)); const isSnowballChoiceRequired = isSnowballEligibilityStage && isSnowballJackpotWindowOpen;` :838 , `snowballEligibleChoice === true` is passed as `snowballEligible`, and the choice is never set because the buttons at :1622-1660 render only `{isSnowballEligibilityStage && currentSnowballPot && ...}`. :1215 , `{game.type === 'snowball' && currentSnowballPot && ( ... Manual Snowball Win button ... )}`.

**Proposed fix.** Pass the pot row in as a server prop from the host page (it is already read server-side for the pre-game briefing), and on a client fetch failure surface a blocking warning rather than silently rendering the non-snowball layout. Alternatively have `record_winner_atomic` refuse a snowball Full House while the window is open unless `p_snowball_eligible` was an explicit true/false, so a missing choice is an error rather than a silent "no".

### 66. [MEDIUM] A tie on a snowball Full House records two full jackpots but the pot only resets once

Area: money-winner-path | Verdict: CONFIRMED

Files: `supabase/migrations/20260730064309_winner_idempotency_key.sql:225`, `src/app/host/[sessionId]/[gameId]/game-control.tsx:960`

**What is wrong.** `record_winner_atomic` has no check for an existing non-void `is_snowball_jackpot` winner in the same game. The documented tie flow ("Validate Another Winner") mints a fresh claim key and lets the host record a second Full House winner, also marked Eligible, also carrying the full pot amount in `prize_description`. There is no split, no warning, and no cap.

**How it fails.** Snowball pot £200, window open. Two punters shout Full House on ball 38 and both claims validate. Host records winner 1 as Eligible: `winners` row with `is_snowball_jackpot = true`, `prize_description = 'Snowball Jackpot £200'`. Host taps "Validate Another Winner", validates the second ticket, records winner 2 as Eligible: a second row, also `is_snowball_jackpot = true`, also £200. The Winners & Prizes list now shows £400 owed. `settle_snowball_pot` sees `exists(...)` and resets the pot once, to base. The pub pays £400 out of a £200 pot.

**Evidence.** Live `record_winner_atomic` body: the jackpot decision is `if coalesce(p_force_snowball_jackpot,false) or (v_window_open and coalesce(p_snowball_eligible,false)) then v_is_jackpot := true; v_jackpot_amount := v_pot_amount; end if;` , no query against existing winners for this game. src/app/host/[sessionId]/[gameId]/game-control.tsx:958-964 `handleValidateAnotherWinner` reopens the claim check, which leads back to `handleOpenRecordWinnerModal` (:896) and a fresh `claimRequestIdRef`, so the second insert is deliberately allowed. supabase/migrations/20260730065531_atomic_snowball_settlement.sql:128 , settlement is a boolean `exists`, so N jackpot winners still reset the pot exactly once.

**Proposed fix.** Inside `record_winner_atomic`, count existing non-void `is_snowball_jackpot` rows for the game. Either refuse a second one (raise a mapped key such as `jackpot_already_awarded` so the host must choose deliberately) or record it with the split amount. At minimum surface a hard confirmation in the Record Winner modal when a jackpot is already on record for this game.

### 67. [MEDIUM] Voiding a jackpot winner after the game has settled leaves the pot reset, and the void confirmation says the opposite

Area: money-winner-path | Verdict: CONFIRMED

Files: `src/app/host/[sessionId]/[gameId]/game-control.tsx:1513`, `src/app/host/actions.ts:1341`, `src/app/admin/sessions/[id]/actions.ts:357`, `supabase/migrations/20260730065531_atomic_snowball_settlement.sql:132`

**What is wrong.** `settle_snowball_pot` reads `winners` at the moment the game completes. Voiding the jackpot winner afterwards only flips `is_void`; nothing re-runs settlement, and the `(snowball_pot_id, game_id)` claim row means a re-run would return `already_settled` anyway. The pot stays reset to base. The host-facing void modal states the win "stops counting towards the snowball pot", which is false once the game has ended.

**How it fails.** Snowball pot at £140. Punter wins the jackpot on ball 39, host records it as Eligible, then advances/ends the game: `settle_snowball_pot` writes the `jackpot_won` claim row and resets the pot to base (£20). Five minutes later the claim is disputed and an admin voids the winner with a reason. `is_void` becomes true but the pot is still £20 , it should have rolled over to £160. Re-ending the game returns `already_settled` and changes nothing. No warning is shown; the pot silently restarts £140 low and the next few weeks' jackpot is wrong. The reverse case is equally live: void a non-jackpot Full House after settlement and the rollover that already happened is not undone.

**Evidence.** supabase/migrations/20260730065531_atomic_snowball_settlement.sql:128-134 (matches live `pg_get_functiondef`) , `select exists (select 1 from public.winners where game_id = p_game_id and coalesce(is_snowball_jackpot,false) and coalesce(is_void,false) = false) into v_jackpot_won;` is evaluated once, at settlement time only. Live function, `already_settled` branch: `return query select 'already_settled'::text, null::text, v_pot.id, v_pot.current_max_calls, v_pot.current_jackpot_amount;` , pot left exactly as-is. src/app/host/actions.ts:1341-1400 `voidWinnerFromHost` and src/app/admin/sessions/[id]/actions.ts:357-385 `voidWinner` both write only `is_void` / `void_reason`; neither touches `snowball_pots` or `snowball_pot_history`. src/app/host/[sessionId]/[gameId]/game-control.tsx:1513 , "The win stays on record, marked void, and stops counting towards the snowball pot."

**Proposed fix.** Make voiding a winner whose game has already settled either (a) re-settle the pot inside the same transaction (delete/replace the claim row and recompute), or (b) refuse with a message telling the admin to correct the pot on /admin/snowball. Either way change the modal copy so it does not promise a pot correction that does not happen.

### 68. [MEDIUM] The pub TV display never takes a wake lock, contrary to the documented design

Area: realtime-sync | Verdict: CONFIRMED

Files: `src/app/display/[sessionId]/display-ui.tsx:1`, `src/app/player/[sessionId]/player-ui.tsx:158`, `src/app/host/[sessionId]/[gameId]/game-control.tsx:143`

**What is wrong.** `useWakeLock()` is called on the host control screen and on the player follower screen, but not on `/display/[sessionId]`. The big screen is the one surface that is passive for the whole session and therefore the most likely to be blanked by the OS or browser screensaver.

**How it fails.** The TV is driven by a browser on a stick PC, laptop or Android TV with a 10-minute screen timeout. Nobody touches it after the session starts (that is the entire point of the display). During the pre-game waiting screen, or during a break, or during a stretch where the host is calling steadily and no input reaches the display device, the OS blanks the screen mid-game. Guests lose the board and a member of staff has to walk over and wake it. The host and player screens, which are handled and therefore least at risk, are the two that do hold the lock.

**Evidence.** `grep -rn 'useWakeLock' src/` returns only `src/app/host/[sessionId]/[gameId]/game-control.tsx:15,143` and `src/app/player/[sessionId]/player-ui.tsx:11,158`. The import list at display-ui.tsx:1-22 contains no reference to `@/hooks/wake-lock`, and `src/components/layout-content.tsx` does not supply one either. CLAUDE.md states "wake-lock.ts (nosleep.js-backed) keeps the screen awake on host and display during a live game", so either the code or the doc is wrong.

**Proposed fix.** Add `import { useWakeLock } from '@/hooks/wake-lock';` and call `useWakeLock();` in `DisplayUI`, alongside the existing `useConnectionHealth()` call at display-ui.tsx:148. Note that `nosleep.js` needs a user gesture on some platforms; the hook already re-attempts on `click`/`touchstart`/`keydown` and on a 15-second interval, so a single tap on the TV at setup is enough to arm it for the evening.

### 69. [MEDIUM] Neither public screen can detect "data stopped arriving": the poll in-flight lock has no timeout and pollState never decays

Area: realtime-sync | Verdict: CONFIRMED

Files: `src/lib/connection-health.ts:30`, `src/lib/connection-health.ts:47`, `src/app/display/[sessionId]/display-ui.tsx:370`, `src/app/display/[sessionId]/display-ui.tsx:436`, `src/app/player/[sessionId]/player-ui.tsx:405`, `src/app/player/[sessionId]/player-ui.tsx:471`

**What is wrong.** The connection-health model only flips unhealthy when a transport actively reports a failure. A transport that simply stops delivering is invisible: `lastSuccessAt` is recorded but never read by any selector, and `pollInFlightRef` is a plain boolean with no timeout and no reset in the effect cleanup, so one never-settling fetch stops all polling forever while `pollState` stays 'healthy'.

**How it fails.** Pub wifi drops a TCP connection mid-request without an RST. The display's poll at display-ui.tsx:372 sets `pollInFlightRef.current = true` and awaits a fetch that never settles (the `finally` at :436 never runs). Every subsequent 3-second tick hits the guard at :370 and returns immediately, so `markPollSuccess`/`markPollFailure` are never called again and `pollState` stays frozen at 'healthy'. The WebSocket then dies and reports CLOSED, setting `realtimeState = 'failing'` -- but `effectiveHealthy()` (connection-health.ts:47-52) returns true as soon as `pollState === 'healthy'`, so `selectShouldShowBanner` and `selectShouldAutoRefresh` both stay false. The pub TV sits on a frozen board showing ball 31 for the rest of the game, with no "Reconnecting..." banner and no 30-second auto-refresh, while the host calls balls 32 through 60. `logError` is a no-op in production (see finding prod-logging-disabled), so nothing is recorded either. Recovery requires a human to reload the TV.

**Evidence.** connection-health.ts:47-52 `function effectiveHealthy(state) { if (!state.online) return false; if (state.pollState === 'healthy' || state.realtimeState === 'healthy') return true; ... }` -- and `grep -rn lastSuccessAt src/` returns only the three write sites (connection-health.ts:30, :43, :60, :75) and no read. display-ui.tsx:370-372 `if (pollInFlightRef.current) return; pollInFlightRef.current = true;`; the effect cleanup at :450-454 sets `cancelled = true` and clears the interval but never resets `pollInFlightRef.current`.

**Proposed fix.** Two changes. (1) Make staleness a first-class health input: add a selector that reads the already-tracked `lastSuccessAt` (e.g. `now - lastSuccessAt > 15_000` demotes both transports to 'failing' regardless of what they last reported), and feed the once-a-second `now` tick that `useConnectionHealth` already has into it. (2) Give the poll a hard deadline: wrap each request in `AbortSignal.timeout(POLL_INTERVAL_MS * 3)` (or record the start time in a ref and let a later tick force-clear the lock and call `markPollFailure()` if the previous poll has been in flight longer than that).

### 70. [MEDIUM] Every admin mutation is both unaudited and unlogged: prize and game changes leave no trace

Area: tracking-observability | Verdict: CONFIRMED

Files: `src/app/admin/actions.ts:39`, `src/app/admin/sessions/[id]/actions.ts:53`, `src/app/admin/sessions/[id]/actions.ts:304`

**What is wrong.** None of the eleven admin server actions writes an audit row, and none of them calls logActionFailure or logError. Raw Supabase error messages are returned to the browser and then discarded.

**How it fails.** Someone edits Game 6's Full House prize from '£50' to '£25' the afternoon before the night, or changes a game's stage_sequence, or flips a session from running back to ready. Nothing records the change, the previous value, who made it or when: games has only created_at and sessions has only created_at/created_by. If the printed paper sheet and the screen disagree on the night, the question 'was the prize changed, and by whom?' cannot be answered. Separately, when one of these actions fails in production the Supabase error is returned to the admin's browser and vanishes: there is no server-side line, so 'the admin says saving the session errored last Tuesday' is undiagnosable. The host actions all route failures through logActionFailure; the admin actions route none.

**Evidence.** grep -rn 'logError|logActionFailure' src/ shows zero hits in src/app/admin/actions.ts, src/app/admin/sessions/[id]/actions.ts, src/app/admin/snowball/actions.ts and src/app/login/actions.ts. Every failure arm in those files is of the form `return { success: false, error: error.message }` (e.g. admin/actions.ts:64, 97, 119, 159, 186; sessions/[id]/actions.ts:120, 152, 230, 297, 315, 350). No audit table exists for sessions or games and pg_trigger shows no audit triggers. This also conflicts with the workspace standard that every mutation in a server action calls logAuditEvent().

**Proposed fix.** At minimum add logActionFailure to every admin failure arm so a production failure is diagnosable, and add an audit row for the value-bearing changes (game prizes, stage_sequence, session status transitions) recording actor, timestamp, before and after.

### 71. [MEDIUM] endGame reports success to the host when the snowball pot demonstrably did not settle

Area: tracking-observability | Verdict: CONFIRMED

Files: `src/app/host/actions.ts:809`, `src/app/host/actions.ts:1218`, `src/app/host/actions.ts:1478`

**What is wrong.** When settle_snowball_pot fails, endGame logs the failure and returns success, while the two sibling completion paths return SNOWBALL_POT_NOT_MOVED_ERROR. The host is told the game finished cleanly and the pot silently stays where it was.

**How it fails.** Host finishes 'Game 9 - Pink (SNOWBALL)' with no jackpot winner and taps the next-game control. moveToNextGameOnBreak sees status 'in_progress' and calls endGame. endGame's own update lands, then `handleSnowballPotUpdate` returns { success: false } because the RPC errored (DB blip, dropped connection, auth.uid() unexpectedly null). Line 811 calls logActionFailure and execution falls through to `return { success: true, data: { gameState: rows[0] } }`. The composite relays success, the host is redirected to Game 10, and no error is ever shown. The pot stays at £120 instead of rolling to £140. Next month the jackpot is £20 short, nobody knows why, and the only trace is a `[action:endGame]` line in Vercel logs that has long since aged out. advanceToNextStage:1220 and skipStage:1480 handle the identical condition by returning failure('...', SNOWBALL_POT_NOT_MOVED_ERROR), so the behaviour depends purely on which of three completion routes the host happened to take.

**Evidence.** src/app/host/actions.ts:809-812: "const potResult = await handleSnowballPotUpdate(supabase, gameId); if (!potResult.success) { logActionFailure('endGame', potResult.error ?? 'snowball pot update failed'); }" followed by no early return. Compare line 1218-1221: "const potResult = await handleSnowballPotUpdate(supabase, gameId); if (!potResult.success) { return failure('advanceToNextStage', SNOWBALL_POT_NOT_MOVED_ERROR, potResult.error); }". handleSnowballPotUpdate only sets success:false when the pot genuinely did not move (the 'already_settled', 'test_session' and 'not_snowball' outcomes all return success:true).

**Proposed fix.** Make endGame return failure('endGame', SNOWBALL_POT_NOT_MOVED_ERROR, potResult.error) after the state update lands, matching advanceToNextStage and skipStage. The game has already been marked completed at that point, so the host sees a real, actionable message ('check the pot in Admin') rather than a silent shortfall.

### 72. [MEDIUM] Winner History, the cross-session record of the night, shows voided winners as valid wins and hides prize_given

Area: tracking-observability | Verdict: CONFIRMED

Files: `src/app/admin/history/page.tsx:34`, `src/app/admin/history/page.tsx:89`

**What is wrong.** /admin/history selects every winners row with no is_void filter and renders no VOID badge and no prize-given column, so a voided win is visually identical to a paid one; void_reason is never rendered anywhere in the app.

**How it fails.** A host records a Full House twice by mistake; an admin voids the duplicate with the reason 'duplicate claim, same book'. On /admin/sessions/[id] the row correctly shows a red VOID badge (session-detail.tsx:387). On /admin/history the same row appears with the £50 prize text and the JACKPOT badge if applicable, and nothing marks it void. Anyone totalling the page to answer 'what did we pay out this quarter?' double-counts that £50. The reason the admin typed is stored in winners.void_reason and rendered by no page in the application, so 'why was this voided?' cannot be answered from the UI either. The same page also omits prize_given, so 'which prizes are still owed?' (68 of 87 production rows are still false) cannot be answered from the cross-session record at all.

**Evidence.** src/app/admin/history/page.tsx:34-41 selects `*` with `.order('created_at')` and no filter. The table body (lines 89-107) renders date, session/game, winner_name, prize_description plus an is_snowball_jackpot badge, stage and call_count_at_win. There is no reference to is_void, void_reason or prize_given on the page. Contrast src/app/admin/sessions/[id]/session-detail.tsx:387-404, which branches on is_void / prize_given for the same data. grep -rn 'void_reason' src/ --include='*.tsx' returns nothing.

**Proposed fix.** Add a Status column to /admin/history mirroring session-detail (VOID / Prize Given / Outstanding), surface void_reason on the void badge (tooltip or expandable), and either strike through or visibly separate voided rows so a payout total taken off the page is correct.

### 73. [MEDIUM] Every server-side failure on the display and player pages logs nothing in production

Area: tracking-observability | Verdict: CONFIRMED

Files: `src/lib/log-error.ts:5`, `.env.example`, `src/app/display/[sessionId]/page.tsx:40`, `src/app/player/[sessionId]/page.tsx:39`

**What is wrong.** logError returns early when NODE_ENV is production unless LOG_ERRORS === 'true', and LOG_ERRORS is set nowhere and documented nowhere. The six server-component failure paths on /display and /player therefore produce no output at all in production.

**How it fails.** On a Wednesday night the big screen shows the recoverable 'load failed' panel (or a 404) instead of the game. Root causes could be a session read failure, a missing active game, or a game_states_public read failure - all three call logError and then set initialLoadStatus = 'failed' or call notFound(). In production the very first line of logError returns, so nothing reaches Vercel's log drain. The next morning there is no line anywhere saying what failed, and the only remaining signal is a guest's word. The same applies to /player/[sessionId] for every punter's phone. Note the transient case is the worst: a one-off DB blip on the session read calls notFound(), giving the TV a permanent 404 until someone reloads it, with zero diagnostic residue.

**Evidence.** src/lib/log-error.ts:5-7: "if (process.env.NODE_ENV === 'production' && process.env.LOG_ERRORS !== 'true') { return; }". grep for LOG_ERRORS across the repo finds it only inside tasks/ and docs/ review documents, never in .env.example, .env.local.example, next.config, or the Environment Variables table in CLAUDE.md. The six production-server call sites are display/[sessionId]/page.tsx:40,78,90 and player/[sessionId]/page.tsx:39,60,72.

**Proposed fix.** Route the server-component failure paths through logActionFailure (which always logs and already redacts UUIDs) rather than logError, or set LOG_ERRORS=true in Vercel and add it to .env.example and the CLAUDE.md env table. logError's suppression is defensible for the browser-side call sites in game-control/display-ui/player-ui; it is not defensible for code running on Vercel.

### 74. [MEDIUM] updateSnowballPot and resetSnowballPot can write an audit row for a move that did not happen, or move the pot with no audit row, both reporting success

Area: tracking-observability | Verdict: CONFIRMED

Files: `src/app/admin/snowball/actions.ts:106`, `src/app/admin/snowball/actions.ts:229`

**What is wrong.** The pot update has no .select() so a zero-row update is indistinguishable from success, and the audit insert that follows runs regardless; separately, an audit-insert failure is console.error'd and success is still returned.

**How it fails.** Two opposite lies from the same function. (a) Admin edits the pot; the .update() matches zero rows (stale id from an open tab, or the pot was deleted in another tab). PostgREST returns no error and no rows, `if (error)` passes, and the code then inserts a snowball_pot_history row claiming the pot moved from £120 to £160. The audit trail now records a movement that never occurred, and the admin is told it saved. (b) The .update() does land but the history insert fails; line 126 does `console.error("Error logging snowball pot update history:", auditError.message)` with the comment 'Continue despite error, not critical to block action' and returns { success: true }. The pot has moved and no row explains it - which is precisely how production ended up with a £140 pot and an empty history table. resetSnowballPot has both bugs in the same shape at lines 229-255, and additionally clears last_awarded_at to null, destroying the record of when the jackpot was last won.

**Evidence.** src/app/admin/snowball/actions.ts:106-113: "const { error } = await supabase.from('snowball_pots').update(parsed.data).eq('id', id); if (error) { return { success: false, error: error.message } }" - no .select(), no rowcount check. Lines 125-128: "if (auditError) { console.error(...); // Continue despite error, not critical to block action }". Lines 229-240 and 252-255 repeat both patterns, with `last_awarded_at: null` at line 234. This contradicts the CLAUDE.md invariant that every direct .update() must .select() and treat zero rows as an error.

**Proposed fix.** Add .select('id') to both updates and fail on zero rows; move the pot update and the history insert into a single SECURITY DEFINER RPC so they share a transaction (the same fix already applied to settle_snowball_pot); treat an audit-insert failure as a hard failure, since an unexplained pot movement is the one outcome this table exists to prevent. Stop nulling last_awarded_at on reset.

### 75. [MEDIUM] Every snowball pot movement in production history is unrecorded: pot has grown £120 with zero audit rows

Area: tracking-observability | Verdict: CONFIRMED

Files: `src/app/host/actions.ts:256`, `src/app/admin/snowball/actions.ts:116`

**What is wrong.** The one live snowball pot has rolled over six times (£20 to £140, 42 to 54 calls) across six real sessions, and snowball_pot_history contains no rows at all. The pot's entire financial history is unexplained by stored data.

**How it fails.** Query the live DB today. `snowball_pots` holds one row, '2026 Snowball', base_max_calls 42, current_max_calls 54, base_jackpot_amount 20.00, current_jackpot_amount 140.00, last_awarded_at null. calls_increment is 2 and jackpot_increment 20, so that is exactly six rollovers, one per completed session (Feb 18, Mar 18, Apr 29, May 20, Jul 1, Jul 29 2026, all is_test_session=false). `select count(*) from snowball_pot_history` returns 0. If a punter or the licensee asks 'is £140 the right number, and when did each £20 go on?', the answer cannot be produced from the database. The historic cause is visible in the repo's own git history: snowball_pot_history had RLS enabled with only a SELECT policy, so the audit insert was silently rejected by RLS on every settlement while the pot update itself succeeded, and the code console.error'd and carried on. The write path is now fixed (settle_snowball_pot is SECURITY DEFINER and writes the claim and the pot move in one transaction), but the six historic movements are unrecoverable and there is no reconciliation or backfill.

**Evidence.** Live: `select id,name,base_max_calls,current_max_calls,base_jackpot_amount,current_jackpot_amount,last_awarded_at from snowball_pots` -> base 42/20.00, current 54/140.00. `select count(*) from snowball_pot_history` -> 0. `select count(*) filter (where is_snowball_jackpot) from winners` -> 0 (so all six were rollovers, never a reset). git log -S'snowball_pot_history' on src/app/host/actions.ts surfaces the prior comment: "snowball_pot_history has RLS enabled with only a SELECT policy, so every audit [insert failed]".

**Proposed fix.** Backfill the six missing rows from the derivable facts (one rollover per completed session with a snowball game, change_type 'rollover_backfill', changed_by null, plus a note) so the £140 is reconcilable, and add a startup or admin-page assertion that current_jackpot_amount equals base_jackpot_amount plus jackpot_increment times the count of rollover history rows since the last reset. Any drift then shows up as a visible mismatch rather than silence.

### 76. [MEDIUM] winners rows carry no actor and no timestamps beyond created_at: who recorded, who voided, who handed the prize over are all unanswerable

Area: tracking-observability | Verdict: CONFIRMED

Files: `src/app/host/actions.ts:1270`, `src/app/host/actions.ts:1311`, `src/app/admin/sessions/[id]/actions.ts:357`, `supabase/migrations/20260730064309_winner_idempotency_key.sql`

**What is wrong.** record_winner_atomic, set_winner_prize_given and both void paths all have auth.uid() available and none of them store it, and there is no voided_at, prize_given_at or updated_at column on winners.

**How it fails.** Three concrete unanswerable questions against live data. (1) 19 of the 87 production winner rows have prize_given = true and nothing records when the tick was made or by which host, so a punter saying 'I never got my £50' cannot be checked against anything; the only stored fact is a boolean. (2) An admin voids a £140 snowball Full House with a reason; is_void and void_reason are written and nothing else, so 'who voided it and at what time?' has no answer, and created_at still shows the original claim time. (3) A dispute about a Full House recorded at 20:17 on 29 July cannot be traced to a host, because winners has no recorded_by even though record_winner_atomic checks `v_state.controlling_host_id <> auth.uid()` two lines earlier and could store it for free.

**Evidence.** information_schema.columns for winners: id, session_id, game_id, stage, winner_name, prize_description, prize_given, call_count_at_win, is_snowball_jackpot, is_void, void_reason, created_at, is_snowball_eligible, client_request_id. No recorded_by, voided_by, voided_at, prize_given_at, prize_given_by or updated_at. Live pg_get_functiondef(set_winner_prize_given): "update public.winners set prize_given = p_prize_given where id = p_winner_id returning prize_given" - one column, no actor, no timestamp. voidWinner writes `.update({ is_void: true, void_reason: voidReason.trim() })` only. pg_trigger shows no audit trigger on winners (the only non-internal triggers in the schema are on game_states: on_game_states_upsert, on_game_states_delete, bump_game_state_version).

**Proposed fix.** Add recorded_by (set from auth.uid() inside record_winner_atomic), voided_by/voided_at (set inside the void path, which should become an RPC for the same reason), and prize_given_by/prize_given_at (set inside set_winner_prize_given). All four are derivable at write time and none of them store player-identifying data, so the anonymity policy is untouched.

### 77. [MEDIUM] The 90-number claim grid renders ~26-31px targets on a phone with no textual read-back, so a mis-tap can produce a false "Valid Claim"

Area: ux-accessibility | Verdict: CONFIRMED

Files: `src/app/host/[sessionId]/[gameId]/game-control.tsx:1359`, `src/app/host/[sessionId]/[gameId]/game-control.tsx:1300`, `src/app/host/[sessionId]/[gameId]/game-control.tsx:1286`

**What is wrong.** Claim entry, the one screen where the host types money-bearing data under time pressure, uses ten aspect-square buttons per row separated by 4px, giving 26-31px targets on every common phone width, and shows only a count rather than the numbers entered.

**How it fails.** Host on a 390px phone behind the bar enters a 15-number Full House claim. Reading '38' from the punter's book they catch the neighbouring cell and select 37. 37 was called earlier in the game, so validateClaim's two tests both pass (every selected number is in the called set, and the last ball is included) and the modal shows the green "Valid Claim" panel. The host pays out on a ticket that does not actually hold a full house. The reverse mis-tap onto an uncalled number produces "Invalid Claim" and a valid punter is told, in front of the room, that their claim is bad.

**Evidence.** `<div className="grid grid-cols-10 gap-1 sm:gap-2">` with `"aspect-square flex items-center justify-center text-sm sm:text-base rounded"` per button. Width chain on a 390px viewport: 390 - 32 (modal wrapper p-4) - 32 (Modal children p-4) - 16 (grid container p-2) - 2 (border) - 36 (9 x gap-1) = 272px / 10 = 27.2px per cell. 375px gives 25.7px, 430px gives 31.2px. The only feedback on what was entered is the count at line 1307 (`{selectedNumbers.length}/{requiredSelectionCount}`) plus grid highlighting at the same 27px scale.

**Proposed fix.** Drop the grid to 5 or 6 columns on narrow viewports (`grid-cols-5 sm:grid-cols-10`) so cells reach 44px, and render the selected numbers as a plain comma-separated list above the grid so the host can read them back against the ticket before tapping Check Win.

### 78. [MEDIUM] Winner History shows voided wins as ordinary payouts

Area: ux-accessibility | Verdict: CONFIRMED

Files: `src/app/admin/history/page.tsx:87`

**What is wrong.** /admin/history renders every winners row with its prize description and JACKPOT badge but never reads is_void or prize_given, so a voided win is indistinguishable from a paid one.

**How it fails.** A claim is recorded on the wrong ball and an admin correctly voids it with a reason. At the end of the month the same admin opens Winner History to reconcile the till: the voided row appears with "£50 Cash" and, if it was a snowball, a gold JACKPOT badge, with nothing marking it void. The prize is counted twice in the takings, or the admin chases a payout that was deliberately cancelled.

**Evidence.** The table body at lines 87-108 selects `*` but renders only created_at, session/game name, winner_name, prize_description, is_snowball_jackpot, stage and call_count_at_win. `grep -n "is_void\|prize_given" src/app/admin/history/page.tsx` returns nothing. The session-detail table does render both (session-detail.tsx:386-400), so the two admin views of the same data disagree.

**Proposed fix.** Add the VOID / Prize Given / Outstanding status column from session-detail.tsx:386-400 to the history table, and strike through or dim voided rows.

### 79. [MEDIUM] On a phone the live host screen never shows which game or which ticket colour is in play once calling starts

Area: ux-accessibility | Verdict: CONFIRMED

Files: `src/app/host/[sessionId]/[gameId]/page.tsx:99`, `src/app/host/[sessionId]/[gameId]/game-control.tsx:1078`, `src/components/host/pre-game-briefing.tsx:35`

**What is wrong.** The header hides the session and game name below 640px, and the pre-game briefing that carries the game index, name and ticket colour word is replaced by the ball view as soon as the first number is called.

**How it fails.** A stand-in host runs a six-game session from a phone. After the first ball of Game 4 the screen shows only the nickname, the ball, Calls / Playing For / Prize. Nothing says "Game 4" and nothing says "Yellow book". When a punter asks which book they are on, the host has to leave the live screen, and the colour word -- deliberately provided in getColourName because the host is colourblind -- is only reachable before the game starts.

**Evidence.** page.tsx:99 `<div className="leading-tight hidden sm:block">` wrapping the session and game name. game-control.tsx:1078 `currentGameState.numbers_called_count === 0 ? (<PreGameBriefing .../>) : (<>...ball view...</>)` -- the briefing, which is the only place `getColourName(game.background_colour)` appears (pre-game-briefing.tsx:22, rendered at line 41), disappears permanently after the first call. colour-name.ts:29 states "The host is colour-blind; the colour word is the accessibility primary."

**Proposed fix.** Add a compact always-on strip to the ball view showing "Game {game_index} · {colourName} book" alongside the existing Calls / Playing For / Prize row, and stop hiding the header text below sm.

### 80. [MEDIUM] After "Close and stay paused" the host has no Resume control, and the app's own copy points at one that does not exist

Area: ux-accessibility | Verdict: CONFIRMED

Files: `src/app/host/[sessionId]/[gameId]/game-control.tsx:1022`, `src/app/host/[sessionId]/[gameId]/game-control.tsx:1779`, `src/app/host/[sessionId]/[gameId]/game-control.tsx:1397`

**What is wrong.** While paused_for_validation, every primary control on the host pad is disabled except "Check Claim", and the only Resume buttons live inside the validation modal, yet the Post Win modal tells the host to "Resume ... from the main pad".

**How it fails.** Host records a winner, taps "Close and stay paused" in the Post Win modal (the documented guaranteed escape). The modal closes. The screen now shows the CHECKING CLAIM banner, NEXT NUMBER greyed, Take Break greyed, Undo Last Call greyed. The instruction text vanished with the modal. A stand-in host has no visible way to restart calling: the only route is to guess that "Check Claim" reopens a modal whose left-hand button is labelled "Cancel & Resume". The game sits paused in front of a full room.

**Evidence.** isNextNumberDisabled, isBreakToggleDisabled and isVoidLastNumberDisabled all include `isPausedForValidation` (lines 1022, 1023, 1025); isValidateButtonDisabled (line 1024) deliberately does not. handleResumeGame is referenced only at line 1339 ("Reject & Resume", inside the invalid-claim panel) and line 1397 ("Cancel & Resume", inside the validation modal footer). The Post Win copy at line 1780 reads: "Closes this box and leaves the game paused with the win on screen. Resume or check another claim from the main pad when you are ready."

**Proposed fix.** Add a Resume button to the main control pad that is enabled exactly when `currentGameState.paused_for_validation` is true (calling the existing handleResumeGame), and put it in the CHECKING CLAIM banner so it is where the host is already looking. Until then the Post Win copy should say "tap Check Claim, then Cancel & Resume".

### 81. [MEDIUM] "Skip (No Winner)" sits 8px from "Record Winner" on a valid claim, is irreversible, and has no confirmation while the cheaper Undo does

Area: ux-accessibility | Verdict: CONFIRMED

Files: `src/app/host/[sessionId]/[gameId]/game-control.tsx:1327`, `src/app/host/[sessionId]/[gameId]/game-control.tsx:865`

**What is wrong.** The Valid Claim panel puts the destructive stage-skip immediately next to the record action with only gap-2 between them, and skipStage commits with no confirm step and no route back to the skipped stage.

**How it fails.** Punter shouts Line, the host validates it, the green Valid Claim panel appears with "Record Winner" and "Skip (No Winner)" 8px apart. A thumb tap lands on Skip. The stage advances server-side, the claim modal closes, the selection clears, and there is no undo-stage control anywhere in the app. The Line prize is now unrecorded and the game is playing for Two Lines with a punter standing up holding a winning line.

**Evidence.** Lines 1325-1333: `<div className="flex gap-2">` containing `<Button ... onClick={handleOpenRecordWinnerModal}>Record Winner</Button>` and `<Button variant="ghost" onClick={handleSkipStage} ...>Skip (No Winner)</Button>`. handleSkipStage (line 865) calls the action directly with no confirmation. By contrast handleOpenUndoModal (line 906) opens a full confirm modal that names the ball, for an action the server can reverse.

**Proposed fix.** Move Skip out of the row (put it under a divider or in the modal footer) and add the same style of confirm modal used for Undo, naming the stage and the prize that will go unrecorded.

### 82. [LOW] Admin list pages fetch every row ever with no limit or pagination, against an 8s statement timeout

Area: admin-flows | Verdict: CONFIRMED

Files: `src/app/admin/history/page.tsx:34`, `src/app/admin/backup/page.tsx:30`, `src/app/admin/page.tsx:38`

**What is wrong.** /admin/history selects all winners, /admin/backup selects every game in the database together with its full 90-integer number_sequence, and /admin lists all sessions , none with `.range()`, `.limit()` or pagination. Supabase's PostgREST max-rows setting will truncate silently rather than error, and the `authenticated` role carries an 8s statement timeout.

**How it fails.** The production data today is small (6 sessions, 60 games, 87 winners) so nothing is visible yet. At roughly a session a week with ~15 winners each, /admin/history passes 1000 rows in about eighteen months and, if the project's API max-rows is at Supabase's 1000 default, quietly stops showing the oldest winners with no error and no 'showing 1000 of N' indicator , an admin looking for an old win concludes it never happened. /admin/backup grows fastest because each game carries a 90-element jsonb array.

**Proposed fix.** Add `.limit()` plus range-based pagination (or a session filter) to all three, and show the total count so truncation is never silent. Scope /admin/backup to a single session chosen by the admin.

### 83. [LOW] The backup/export tool is unreachable from the UI, exports nothing, and shows the pre-shuffled bag rather than what was actually called

Area: admin-flows | Verdict: CONFIRMED

Files: `src/app/admin/backup/page.tsx:30`, `src/app/admin/backup/page.tsx:63`, `src/components/header.tsx:8`

**What is wrong.** /admin/backup is not linked from the header nav, the admin dashboard or anywhere else , only a typed URL reaches it. What it renders is game_states.number_sequence, the full 90-ball shuffled bag generated at startGame, not called_numbers. It offers no download and omits winners, prizes, call counts and pot state, so it cannot be used to reconstruct a night.

**How it fails.** The tablet dies mid-game and the host needs the backup call sheet. Nobody can find it: NAV_ITEMS lists only Home / Sessions / Snowballs / Winners, and the admin dashboard header links only to /admin/snowball. If someone does reach /admin/backup, every game shows all 90 numbers with no marker for how far the game got, so the host cannot tell which have already been called and cannot resume. After the night, using the same page as the record of what happened is equally impossible: a game that stopped at ball 43 still lists 90, and none of the winners, prizes or the snowball settlement appear.

**Proposed fix.** Link the page from the header nav, scope it to one session (it currently fetches every game ever with no limit), select `called_numbers` and `numbers_called_count` alongside number_sequence so called and uncalled balls are visually separated, and add winners + prizes. If it is meant as an export, generate a CSV/JSON server-side and serve it from a route handler rather than a link the artifact sandbox or browser may block.

### 84. [LOW] Duplicating a session stamps the start date from UTC rather than Europe/London

Area: admin-flows | Verdict: CONFIRMED

Files: `src/app/admin/actions.ts:147`

**What is wrong.** duplicateSession sets start_date with `new Date().toISOString().split('T')[0]`, which is the UTC calendar date. Between 23:00 and 00:00 British Summer Time that is yesterday.

**How it fails.** An admin sets up next week's session at 23:30 on Friday 14 August (BST). toISOString() yields 2026-08-14T22:30:00.000Z, so start_date is stored as 2026-08-14 rather than 2026-08-15. The admin dashboard and the backup page then show the wrong date for the copied session, and the backup page's sessions-by-start_date ordering puts it in the wrong place.

**Proposed fix.** Compute the date with `Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date())` (which yields YYYY-MM-DD) via a shared dateUtils helper, and consider letting the admin pick the date rather than inferring it , createSession currently gives the admin no way to set start_date at all.

### 85. [LOW] Winner dates on /admin/history render in the server's UTC/en-US locale, not Europe/London

Area: admin-flows | Verdict: CONFIRMED

Files: `src/app/admin/history/page.tsx:91`, `src/app/admin/backup/page.tsx:61`, `src/app/admin/sessions/[id]/session-detail.tsx:365`

**What is wrong.** HistoryPage is an async server component, so `new Date(winner.created_at).toLocaleDateString()` is evaluated in the Node process's timezone and locale , UTC and (on Vercel) en-US , rather than Europe/London. Bingo runs into the late evening, so BST wins after 23:00 local are dated to the previous day.

**How it fails.** A Full House is recorded at 00:20 on Saturday 15 August, British Summer Time. created_at stores 2026-08-14T23:20:00Z (the live database timezone is UTC). /admin/history renders '8/14/2026' , the wrong day, in US format. The admin reconciling Saturday's takings does not find the win under Saturday. The same value on /admin/sessions/[id] renders differently again, because session-detail.tsx is a client component and uses the browser's Europe/London locale, so the two admin screens disagree about the date of the same win (and the server-rendered pass of that client component produces a hydration mismatch).

**Proposed fix.** Add a dateUtils module (the workspace convention; this project has none) that formats with `Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London' })`, and use it in every admin view so server and client renders agree. Guard the backup page's start_date against null instead of passing '' to the Date constructor.

### 86. [LOW] The money screen uses a browser confirm() while sessions and games use typed confirmation

Area: admin-flows | Verdict: CONFIRMED

Files: `src/app/admin/snowball/snowball-list.tsx:62`, `src/app/admin/snowball/snowball-list.tsx:74`

**What is wrong.** Deleting a snowball pot (which permanently removes its audit history and unlinks every game) and resetting one (which wipes the accumulated jackpot back to base) are both guarded by a single window.confirm, while deleting a session or a game , both of which are already blocked by the database when they matter , require typing the exact name.

**How it fails.** An admin scanning /admin/snowball clicks Reset on the wrong row and hits Enter on the browser dialog out of habit. A £300 accumulated jackpot drops to the £200 base immediately, with the only record being a history row. There is no name to type, no display of the current amount in the dialog, and no undo.

**Proposed fix.** Use the same typed-confirmation Modal pattern for pot delete and pot reset, and put the current jackpot amount and max calls in the dialog text so the admin can see what they are about to destroy.

### 87. [LOW] The reset-session modal tells the admin it deletes snowball history that it does not touch

Area: admin-flows | Verdict: CONFIRMED

Files: `src/app/admin/sessions/[id]/session-detail.tsx:806`, `src/app/admin/sessions/[id]/session-detail.tsx:809`

**What is wrong.** The confirmation modal is the only place an admin learns what reset does, and one of its three bullets is false. reset_session_safe never reads or writes snowball_pot_history.

**How it fails.** An admin about to reset a session reads 'Any snowball jackpot history captured against winners in this session' will be permanently deleted, and 'Snowball pot balances and the underlying game configuration are not touched'. They reasonably conclude the pot is back to a clean slate for a replay. In fact the history claim row survives, which is exactly what makes the replay's settlement return 'already_settled' and silently strand the pot (see the reset/snowball finding). The modal actively steers the admin into the failure.

**Proposed fix.** Fix the behaviour first (delete the session's snowball_pot_history rows and reverse the pot inside reset_session_safe), then make the modal describe what actually happens, including naming the pot and the amount it will be moved back to.

### 88. [LOW] Unchecking every stage produces a confusing "prize required" error instead of "select at least one stage"

Area: admin-flows | Verdict: CONFIRMED

Files: `src/app/admin/sessions/[id]/session-detail.tsx:597`, `src/app/admin/sessions/[id]/actions.ts:74`

**What is wrong.** With no stages checked, the client-side validateGamePrizes has an empty required list and passes, the submit button stays enabled, and the server then expands the empty selection back to all three default stages and fails prize validation for stages the form never rendered inputs for.

**How it fails.** An admin editing a standard game unchecks Line, Two Lines and Full House while deciding on the format. The form shows a small red 'Select at least one stage.' hint but Save Changes stays enabled. They click it. Client validation passes (requiredStages is []). On the server, `selectedStages.length > 0` is false, so stage_sequence falls back to getDefaultStagesForType('standard') = all three; the prize loop finds no `prize_Line` etc. in FormData because those inputs were not rendered, so prizes is {} and the action returns 'Game 5: prize required for Line, Two Lines, Full House' , naming stages the admin just removed. The admin cannot tell what the app wants.

**Proposed fix.** Disable submit when a standard game has zero stages selected, and on the server return an explicit 'Select at least one stage.' instead of silently substituting the default three.

### 89. [LOW] stage_sequence is written straight from form input with no validation against the win_stage set, and can be persisted as a value no code can handle

Area: admin-flows | Verdict: CONFIRMED

Files: `src/app/admin/sessions/[id]/actions.ts:73`, `src/app/admin/sessions/[id]/actions.ts:172`

**What is wrong.** createGame and updateGame take `formData.getAll('stages') as WinStage[]` and write it into games.stage_sequence, which is plain jsonb rather than an enum array. Nothing checks the values are among 'Line' / 'Two Lines' / 'Full House'. Unlike `type` (a Postgres enum that rejects garbage) and unlike the snowball pot form (the only admin action using zod), there is no backstop.

**How it fails.** A crafted server-action POST , or a future refactor that changes the checkbox values , supplies `stages=Corners`. sortStages maps it through `stageOrder['Corners']` = undefined, giving a NaN comparator, and the row is written as `stage_sequence: ["Corners"]`. The host starts that game; record_winner_atomic derives the stage from stage_sequence[current_stage_index] and casts it to the win_stage enum, which raises, so no winner can ever be recorded on that game. The admin cannot fix it either once the game has started, because update_game_safe preserves stage_sequence for any status other than 'not_started'.

**Proposed fix.** Validate every admin server action's input with zod, as the snowball actions already do: a `z.enum(['Line','Two Lines','Full House'])` array for stages, `z.enum(['standard','snowball','jackpot'])` for type, `z.coerce.number().int().min(1)` for game_index, and a `/^#([0-9a-f]{3}|[0-9a-f]{6})$/i` regex for background_colour (currently only enforced by a client-side `pattern` attribute).

### 90. [LOW] updateSessionStatus reports success on an update it never proves landed, and permits any transition

Area: admin-flows | Verdict: CONFIRMED

Files: `src/app/admin/sessions/[id]/actions.ts:304`

**What is wrong.** updateSessionStatus issues a bare `.update({ status }).eq('id', sessionId)` with no `.select()` , the pattern CLAUDE.md singles out as having already produced two silent-success bugs in this codebase. It also validates nothing about the transition: the caller supplies the target status and no check is made against the current one or against live games.

**How it fails.** An admin clicks 'Start Session' on a session id that no longer exists (stale tab, or the session was deleted in another window). The update matches zero rows. Supabase returns no error and no data, `if (error)` passes, and the action returns `{ success: true }`. The client calls router.refresh() and the admin believes the session is live and tells the host to start; the host dashboard shows nothing. The same shape means any RLS-filtered write would also be reported as a success. Separately, because the target status is a parameter with no state machine, a completed session can be flipped back to 'running' while its games are all 'completed', which the host dashboard will list as startable.

**Proposed fix.** Add `.select('id, status').single()` and treat a missing row as an error, matching updateSession. Add an explicit allowed-transition check (draft→ready, ready→running, running→completed) and refuse to move a session out of 'running' while any of its games is in_progress.

### 91. [LOW] create_table_booking_transaction is EXECUTE-to-PUBLIC SECURITY DEFINER and belongs to no code in this project

Area: auth-security | Verdict: CONFIRMED

Files: `supabase/migrations/20260730070705_revoke_anon_execute_on_host_rpcs.sql`

**What is wrong.** public.create_table_booking_transaction(jsonb,jsonb,jsonb) is SECURITY DEFINER owned by postgres with proacl containing `=X/postgres` (PUBLIC) and an explicit anon grant. Every other function in the schema had its anon EXECUTE revoked by the hardening migrations; this one was skipped.

**How it fails.** Anyone holding the public anon key (i.e. any punter who views /display) can POST /rest/v1/rpc/create_table_booking_transaction with attacker-chosen jsonb. It executes as the definer with RLS bypassed and performs three unconditional INSERTs into table_bookings, table_booking_items and table_booking_payments. In this database those tables do not exist so the call errors, but the grant is a permanent live-fire hazard: if that schema is ever restored, imported, or the function is re-pointed, an anonymous caller can create bookings and payment records at will. It also gives an unauthenticated attacker a definer-context error oracle.

**Proposed fix.** Drop the function if it is orphaned, which the evidence suggests (the tables it writes do not exist in this project). If it must stay, `revoke execute on function public.create_table_booking_transaction(jsonb,jsonb,jsonb) from public, anon;` in a new migration, mirroring 20260730070705.

### 92. [LOW] Two overlapping game_states INSERT policies, the narrower one dead

Area: auth-security | Verdict: CONFIRMED

Files: `supabase/migrations/20251221101436_fix_host_permissions.sql:12`, `supabase/migrations/20251221101438_add_game_states_public.sql`

**What is wrong.** "Hosts can insert game state" (role='host') and "Hosts/Admins can insert game state" (role in admin,host) both exist as PERMISSIVE INSERT policies. Permissive policies OR together, so the first grants nothing the second does not.

**How it fails.** No exploit today, but it is an active audit hazard: someone tightening "Hosts/Admins can insert game state" in a future migration will believe they have closed host inserts while the older policy silently keeps them open, and every INSERT pays for two profiles subqueries. The live performance advisor flags it as multiple_permissive_policies.

**Proposed fix.** `drop policy if exists "Hosts can insert game state" on public.game_states;` in a new migration, leaving the admin-or-host policy as the single source of truth.

### 93. [LOW] sanitizeNextUrl does not handle backslashes, so a crafted login link breaks the post-login navigation

Area: auth-security | Verdict: CONFIRMED

Files: `src/app/login/actions.ts:9`, `src/app/login/page.tsx:13`

**What is wrong.** The sanitiser rejects values not starting with '/' and values starting with '//', but not '/\'. WHATWG URL parsing treats a backslash as a forward slash for http(s), so '/\\evil.com' resolves to a foreign origin.

**How it fails.** A staff member is phished with https://bingo.theanchor.pub/login?next=/%5Cevil.com. They sign in successfully, the action returns redirectTo='/\\evil.com', and router.push receives it. Next's parseRelativeUrl resolves it against the dummy base, sees a different origin and throws "invariant: invalid relative URL", so the login appears to succeed and then the page errors instead of navigating. Next's own check is what stops this becoming an actual off-site redirect; the sanitiser that exists specifically to prevent it does not catch the case.

**Proposed fix.** Reject any next value whose second character is '/' or '\\', and drop anything containing a control character, e.g. `if (/^\/[/\\]/.test(nextUrl)) return '/'`. An allowlist of known internal prefixes ('/admin', '/host', '/') would be stronger still, since those are the only values the middleware ever sets.

### 94. [LOW] Every authenticated account can read every staff email address

Area: auth-security | Verdict: CONFIRMED

Files: `supabase/migrations/20260430124552_tighten_profiles_select.sql:11`

**What is wrong.** "Authenticated users can view profiles" is `to authenticated using (true)` over a table holding id, email and role. Nothing in the app needs a user to read anyone's profile but their own (every authorizeHost / authorizeAdmin filters .eq('id', user.id)).

**How it fails.** Any host account , including one obtained through the self-signup exposure above , runs GET /rest/v1/profiles?select=email,role and gets the full staff roster with which addresses are admins. That is a ready-made target list for credential stuffing against /login, which matters more given the project has leaked-password protection disabled.

**Proposed fix.** Narrow to `using (auth.uid() = id or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role='admin'))`. Also enable leaked-password protection in the project's Auth settings, which the live security advisor reports as off.

### 95. [LOW] Ten native alert()/confirm() dialogs coexist with four purpose-built typed-confirm modals

Area: code-quality | Verdict: CONFIRMED

Files: `src/app/host/dashboard.tsx:37`, `src/app/host/dashboard.tsx:173`, `src/app/admin/snowball/snowball-list.tsx:62`, `src/app/admin/sessions/[id]/session-detail.tsx:219`

**What is wrong.** game-control.tsx documents replacing window.confirm with an in-app modal (line 97, "T4.3") and builds a full in-modal error system so a host behind the bar can actually read a failure. The screen immediately upstream, host/dashboard.tsx, still uses alert() three times and confirm() once, and the admin surfaces use confirm() five more times next to their own typed-confirm modals.

**How it fails.** The host taps Start on a phone. startGame fails. host/dashboard.tsx:37 fires `alert("Error starting game: " + result.error)` - a blocking OS dialog on a phone the host is holding one-handed mid-service, showing text that on the admin paths is a raw Postgres message. Worse, host/dashboard.tsx:173 gates the destructive Re-open of a finished game behind a plain confirm(), while the far less destructive delete-game on the admin screen requires typing the game name. The guardrail strength is inverted relative to the risk.

**Proposed fix.** Replace all ten with the existing Modal component. For host/dashboard.tsx use the inline actionError pattern already in game-control.tsx rather than alert(); for the Re-open path use a typed-confirm modal matching session-detail's delete-game modal, since re-opening a completed game is a money-adjacent action.

### 96. [LOW] authorizeAdmin is copy-pasted into three files and authorizeHost is a fourth near-copy

Area: code-quality | Verdict: CONFIRMED

Files: `src/app/admin/actions.ts:18`, `src/app/admin/sessions/[id]/actions.ts:32`, `src/app/admin/snowball/actions.ts:24`, `src/app/host/actions.ts:139`

**What is wrong.** The same 18-line authorizeAdmin function, plus its AdminAuthResult type, is duplicated verbatim in three server-action files. src/app/host/actions.ts carries a fourth copy differing only in the accepted role set.

**How it fails.** A change to the auth check (adding a suspended-account check, switching from profiles.role to a JWT claim, or wrapping auth.uid() for the auth_rls_initplan advisor) has to land in four places. Landing it in three leaves one server-action file authorising on the old rule, and because there is no test on any of them nothing catches it.

**Proposed fix.** Create src/lib/authorize.ts exporting `authorize(supabase, roles: UserRole[])` returning the existing discriminated union, with `authorizeAdmin = (s) => authorize(s, ['admin'])` and `authorizeHost = (s) => authorize(s, ['admin','host'])`. Delete the four copies.

### 97. [LOW] next.config.ts is empty: no typed routes, no bundle analysis, and browserslist data is eight months stale

Area: code-quality | Verdict: CONFIRMED

Files: `next.config.ts:3`, `postcss.config.mjs:5`, `package.json:6`

**What is wrong.** next.config.ts contains only a `/* config options here */` comment. There is no typedRoutes, no bundle analyzer, no image config. postcss.config.mjs runs autoprefixer on top of @tailwindcss/postcss, which already prefixes via Lightning CSS. caniuse-lite is eight months old, so autoprefixer's targets are wrong.

**How it fails.** The pub TV is the oldest browser this app has to serve, and it is the one surface where prefixing and target data matter (globals.css:232 keeps a -webkit-mask-image prefix by hand "for older TV browsers"). With eight-month-stale caniuse data, autoprefixer's decisions about that TV's browser are guesses. Separately, without typedRoutes, a typo in one of the ~20 hand-written route strings (`/host/${sessionId}/${nextGameId}` in revalidatePath, `router.push(result.redirectTo)`) is a runtime 404 rather than a compile error, and revalidatePath silently revalidates nothing when the path is wrong.

**Proposed fix.** Set `typedRoutes: true` in next.config.ts and fix whatever it surfaces. Run `npx update-browselist-db@latest` and commit the lockfile change. Drop autoprefixer from postcss.config.mjs and from devDependencies. Add `"typecheck": "tsc --noEmit"` to package.json so the documented command exists.

### 98. [LOW] Four user-facing dates are formatted with raw Date methods and no timezone, against the workspace date rule

Area: code-quality | Verdict: CONFIRMED

Files: `src/app/admin/sessions/[id]/session-detail.tsx:365`, `src/app/admin/history/page.tsx:91`, `src/app/admin/backup/page.tsx:61`, `src/app/admin/actions.ts:147`

**What is wrong.** There is no dateUtils module in this project. Four display sites call toLocaleString()/toLocaleDateString() with no locale and no timeZone, and one write site derives a date from a UTC ISO string.

**How it fails.** admin/backup/page.tsx:61 and admin/history/page.tsx:91 are server components, so toLocaleDateString() runs on the Vercel server in UTC with the server's default locale, giving American M/D/YYYY ordering to a British pub. session-detail.tsx:365 is a client component so it renders in the viewer's locale, meaning the same winner timestamp reads differently on two admin screens. duplicateSession (admin/actions.ts:147) sets start_date from `new Date().toISOString().split('T')[0]`, which during British Summer Time between 00:00 and 01:00 local yields yesterday's date.

**Proposed fix.** Add src/lib/date-utils.ts with `formatDateInLondon` and `formatDateTimeInLondon` (Intl.DateTimeFormat with locale 'en-GB' and timeZone 'Europe/London') plus `getTodayIsoDate()` for the duplicateSession write, and route all five sites through it.

### 99. [LOW] Dead exported server actions, dead component variants, no-op CSS classes and leftover authoring comments

Area: code-quality | Verdict: CONFIRMED

Files: `src/app/login/actions.ts:40`, `src/app/admin/sessions/[id]/actions.ts:357`, `src/components/ui/button.tsx:4`, `src/components/ui/bingo-ball.tsx:35`

**What is wrong.** A cluster of dead surface and leftover scaffolding: two exported server actions with no callers, unused component variants, four uses of an undefined CSS class, and thinking-out-loud comments left in shipped UI primitives.

**How it fails.** Each item is individually harmless but collectively they make the codebase read as unfinished and mislead the next reader. `signup()` and `voidWinner()` are 'use server' exports, which means Next publishes a POST endpoint for each; both are unreachable from any UI. session-detail.tsx:575, :599, :627 and :676 apply `text-muted-foreground`, a shadcn token defined nowhere in this project, so the class resolves to nothing (it happens to be paired with text-yellow-200/80, so the text is still visible - it is dead, not broken). BingoBall's `normal` and `mini` variants and the getBallColor path that serves them are never used; only `active` and `called` are.

**Proposed fix.** Delete signup() (the login UI has no sign-up affordance and the comment's 'stable hook' argument does not justify a live endpoint), and either wire voidWinner into the admin winners table or delete it in favour of voidWinnerFromHost. Delete the `normal` and `mini` BingoBall variants. Replace text-muted-foreground with a defined class and drop the redundant border-destructive. Remove the authoring commentary from button.tsx and bingo-ball.tsx.

### 100. [LOW] Two pairs of near-identical host server actions, one pair already drifted on a guard

Area: code-quality | Verdict: CONFIRMED

Files: `src/app/host/actions.ts:841`, `src/app/host/actions.ts:913`, `src/app/host/actions.ts:1151`, `src/app/host/actions.ts:1410`

**What is wrong.** moveToNextGameOnBreak (841-911) and moveToNextGameAfterWin (913-979) are 66 lines each and differ only by a trailing toggleBreak call. advanceToNextStage (1151-1226) and skipStage (1410-1486) are the same read-state / read-game / compute-index / conditional-update / settle-pot flow, and have already drifted apart.

**How it fails.** skipStage guards `if (totalStages === 0) return failure('This game has no stages set up.')` (line 1440). advanceToNextStage has no such guard: with an empty stage_sequence it computes newStageIndex = 0+1 = 1, sees 1 >= 0, sets newStageIndex = -1 and newGameStatus = 'completed', and writes current_stage_index = -1 to game_states. The public surfaces then read `stage_sequence[-1]` and render undefined for the stage name. The same defect fixed once in skipStage is still open in advanceToNextStage, which is exactly what duplicated flows produce.

**Proposed fix.** Extract `advanceStage(supabase, controlResult, gameId, { clearWinDisplay: boolean })` covering the shared body and have both actions call it, so the totalStages guard and the pot-settlement path exist once. Extract `moveToNextGame(currentGameId, sessionId, cashJackpotAmountInput, { startOnBreak: boolean })` for the other pair. Drop the unused select columns at line 1172.

### 101. [LOW] The host dashboard's Start / Resume / Re-open button has no in-flight guard

Area: code-quality | Verdict: CONFIRMED

Files: `src/app/host/dashboard.tsx:164`

**What is wrong.** game-control.tsx carries nine separate per-action in-flight flags with a comment explaining why ("A publican taps twice on a phone, so every mutation gets its own flag and its own disabled control", line 110). The Start/Resume/Re-open button on host/dashboard.tsx has no such flag and is never disabled while startGame is in flight.

**How it fails.** A host on pub wifi taps Start, sees nothing happen for two seconds, and taps again. Two startGame calls run concurrently. The server-side conditional updates bind status, so the second returns a conflict rather than corrupting state, but that conflict surfaces as `alert("Error starting game: The game changed while you were acting. Refreshed now.")` on a game that in fact started correctly. The host now believes the start failed.

**Proposed fix.** Add `const [startingGameId, setStartingGameId] = useState<string | null>(null)` and gate both the handler and `disabled={startingGameId !== null}`, matching the pattern in game-control.tsx.

### 102. [LOW] Closing a stacked modal restores body scrolling while the modal underneath is still open

Area: code-quality | Verdict: CONFIRMED

Files: `src/components/ui/modal.tsx:78`

**What is wrong.** Modal's effect sets document.body.style.overflow = 'hidden' when open and, in its cleanup, sets it to 'unset' unconditionally. Modals in this app stack: Record Winner opens on top of the Claim Check modal, and Post Win opens on top of both.

**How it fails.** The host has the Claim Check modal open (game-control.tsx:1279, a full-height modal with a scrollable 90-number grid). Check Win succeeds and opens Record Winner on top (line 1596). The host taps Cancel. Record Winner's cleanup runs `document.body.style.overflow = 'unset'` while the Claim Check modal is still open, so the page behind now scrolls under the host's thumb while they re-count a ticket on a phone. The same happens every time Post Win is closed.

**Proposed fix.** Replace the direct style write with a module-level open-modal counter: increment on open, decrement on close, and only restore overflow when the count reaches zero. Also record and restore the previous overflow value rather than hard-coding 'unset'.

### 103. [LOW] Eleven raw console.error/warn calls bypass the redaction helpers, one logging two UUIDs

Area: code-quality | Verdict: CONFIRMED

Files: `src/app/host/[sessionId]/[gameId]/page.tsx:67`, `src/app/admin/snowball/actions.ts:126`, `src/app/admin/snowball/actions.ts:253`

**What is wrong.** The project has two deliberate logging helpers: logError (dev-only, redacts UUIDs) and logActionFailure (always logs, redacts UUIDs, drops Postgres details/hint so prize amounts do not reach the logs). Eleven call sites use console.error/console.warn directly instead, including three inside server code that runs in production.

**How it fails.** src/app/host/[sessionId]/[gameId]/page.tsx:67 emits `console.warn(\`Game ${gameId} in session ${sessionId} has no initial game state...\`)` on every host navigation to a game with no state row. Both UUIDs land unredacted in the Vercel production logs, which is precisely what the UUID_RE in log-action-failure.ts and log-error.ts exists to prevent. admin/snowball/actions.ts:126 and :253 log raw Supabase error messages from the money audit path with no redaction.

**Proposed fix.** Replace every console.error/warn in src/app with logError (server components) or logActionFailure (server actions), and pass identifiers as separate structured fields the helper can redact rather than interpolating them into the message string. Add an ESLint no-console rule with an override for src/lib/log-*.ts.

### 104. [LOW] resetSnowballPot reads the same pot row twice for data it already holds

Area: code-quality | Verdict: CONFIRMED

Files: `src/app/admin/snowball/actions.ts:207`

**What is wrong.** resetSnowballPot fetches the pot selecting base_max_calls, base_jackpot_amount, current_max_calls and current_jackpot_amount into `oldPot`, then immediately fetches the same row again selecting base_max_calls and base_jackpot_amount into `pot`, and uses `pot` for the update while `oldPot` supplies the audit values.

**How it fails.** Beyond the wasted round trip, the two reads are not in the same transaction, so if the pot's base values change between them the update writes one snapshot while the audit row records another - an audit trail that does not match the write it is describing.

**Proposed fix.** Delete the second query and use oldPot.base_max_calls / oldPot.base_jackpot_amount in the update. Better, fold the read, the update and the audit insert into one security-definer function as the settle path already does.

### 105. [LOW] Three overlapping colour systems, with a 200-line !important override sheet that leaks the old pink brand on admin focus rings

Area: code-quality | Verdict: CONFIRMED

Files: `src/app/globals.css:30`, `tailwind.config.ts:12`, `src/components/layout-content.tsx:22`, `src/app/admin/sessions/[id]/session-detail.tsx:568`

**What is wrong.** The Anchor rebrand was implemented as ~200 lines of `.anchor-theme .<old-class> { ... !important }` overrides repainting the previous pink/indigo/slate theme, applied by LayoutContent only on non-game pages. Alongside it, tailwind.config.ts still defines the old bingo.* palette (pink/amber/indigo, still referenced 21 times) and components carry 390 raw hex literals. Which system a class belongs to determines whether it renders green or pink, and the answer depends on the route.

**How it fails.** globals.css:146 overrides `.anchor-theme .ring-bingo-primary` but there is no override for the variant selectors `.focus-visible\:ring-bingo-primary:focus-visible` or `.focus\:ring-bingo-primary:focus`. Every form control on /admin therefore shows a pink #EC4899 focus ring on the green Anchor page: the game type select (session-detail.tsx:568), the stage checkboxes (:591), the notes textarea (:709), and the same three controls on admin/dashboard.tsx:241 and :251. Same gap for `group-hover:text-bingo-primary` on display/page.tsx:49. More broadly, a new admin component written with `bg-slate-800` silently renders green while one written with `#0f6846` renders green too, and the same `bg-slate-800` on a host page renders slate, so the correct way to write a colour depends on which route the component will be mounted under.

**Proposed fix.** Pick one system. Define the Anchor palette once as tokens (either in tailwind.config.ts under `theme.extend.colors.anchor` or as @theme in globals.css), rewrite the slate/indigo/bingo class usages in src/app/admin/** and src/app/display/page.tsx to those tokens, then delete the .anchor-theme override block and the bingo.* palette. Until that lands, add the missing focus-visible and group-hover overrides so the pink stops showing.

### 106. [LOW] Two incompatible server-action error conventions: host actions redact and map, admin actions return raw Postgres messages

Area: code-quality | Verdict: CONFIRMED

Files: `src/app/host/actions.ts:70`, `src/app/admin/actions.ts:64`, `src/app/admin/sessions/[id]/actions.ts:120`, `src/app/admin/snowball/actions.ts:69`

**What is wrong.** src/app/host/actions.ts has a full error discipline: failure()/conflictFailure()/rpcFailure()/relayFailure(), a HOST_RPC_ERRORS map turning raised keys into plain host-facing words, a conflict flag and a machine-readable code, with raw messages routed to logActionFailure which strips UUIDs and drops Postgres `details`/`hint` so prize amounts never land in logs. The three admin action files use none of it and return `{ success: false, error: error.message }` in fifteen places, with no logging at all.

**How it fails.** An admin tries to delete a session with a foreign-key dependency. The browser renders the raw Postgres text, for example 'insert or update on table "games" violates foreign key constraint "games_snowball_pot_id_fkey"' plus a DETAIL clause. Per the log-action-failure.ts comment, Postgres puts the failing row into DETAIL on constraint violations, so a winners-related failure would put prize_description (a cash amount) on screen. Nothing is logged server-side, so the failure is also undiagnosable after the fact.

**Proposed fix.** Move failure/conflictFailure/rpcFailure/relayFailure and the ActionFailure type from src/app/host/actions.ts into src/lib/action-result.ts and use them from all four action files. Give each admin failure a plain-English host message and pass the Supabase error object as the `logged` argument.

### 107. [LOW] Small typing weaknesses: a boolean|null control flag, a silent role downgrade, and a missing exported return type

Area: code-quality | Verdict: CONFIRMED

Files: `src/app/host/[sessionId]/[gameId]/game-control.tsx:149`, `src/app/host/[sessionId]/[gameId]/page.tsx:117`, `src/lib/utils.ts:6`

**What is wrong.** The codebase is otherwise strongly typed with no `any`, no `as any` and no ts-ignore anywhere. Three residual weaknesses stand out.

**How it fails.** (1) canTakeControl is `!controlling_host_id || (controller_last_seen_at && ...)`, whose type is boolean|null rather than boolean; when a controller is set but controller_last_seen_at is null it evaluates to null, which is falsy, so the Take Control button is hidden. The server-side takeControl explicitly treats a null heartbeat as "not a live lock" (host/actions.ts:534-535, `'controller_last_seen_at.is.null'`), so the client hides a button the server would honour, and a host locked out by a null-heartbeat controller has no way in. (2) page.tsx:117 `currentUserRole={profile?.role || 'host'}` silently downgrades an admin to host when the profiles read fails, removing the Void Winner control that is the documented only escape from an undo blocked by a winner on the last ball. (3) `cn()` has no explicit return type, against the workspace rule for exported functions.

**Proposed fix.** Rewrite canTakeControl as an explicit boolean that mirrors takeControl's four conditions, including the null-heartbeat case, and pull the 30000 literal from a shared CONTROLLER_HEARTBEAT_TIMEOUT_MS constant rather than duplicating the magic number the server already names (host/actions.ts:19). Make the role prop required and fail the page render if the profile read fails, rather than defaulting. Add `: string` to cn.

### 108. [LOW] The two money helper modules, jackpot.ts and snowball.ts, have no tests at all

Area: code-quality | Verdict: CONFIRMED

Files: `src/lib/jackpot.ts:16`, `src/lib/snowball.ts:17`, `src/lib/log-action-failure.ts:29`

**What is wrong.** Eleven of the fifteen src/lib modules have a co-located .test.ts. The four without are jackpot.ts, snowball.ts, log-action-failure.ts and utils.ts (whose tests live oddly at tests/utils.test.ts instead of beside the source). jackpot.ts and snowball.ts both decide money.

**How it fails.** parseCashJackpotAmount strips every non-digit and non-dot character before parsing: `Number(input.replace(/[^0-9.]/g, ''))`. A host typing '2,50' for two pounds fifty gets 250, and formatCashJackpotPrize writes '£250 Cash Jackpot' into games.prizes for every stage, which is what the display, the player phone and the winners row all show. A host typing '£12.50 (cash)' gets Number('12.50') = 12.5, correct by luck. There is no test asserting either case. Separately, isSnowballJackpotEligible (`numbersCalledCount <= maxCalls`) is the client-side gate that decides whether the host is even shown the Eligible / Not eligible choice; its boundary at exactly maxCalls is untested on the client side even though the same boundary is re-checked in SQL.

**Proposed fix.** Add src/lib/jackpot.test.ts covering parseCashJackpotAmount with '250', '£250', '2,50', '1,000', '12.50', '0', '-5', '' and '1.2.3', plus isCashJackpotGame's three branches. Add src/lib/snowball.test.ts covering getSnowballWindowStatus and isSnowballJackpotEligible at n = max-1, max and max+1, and formatPounds with 100, 100.5, 100.50 and NaN. Add src/lib/log-action-failure.test.ts asserting UUIDs are redacted and that `details`/`hint` are dropped. Move tests/utils.test.ts to src/lib/utils.test.ts.

### 109. [LOW] Five .update() calls report success without proving the write landed, against the codebase's own documented rule

Area: code-quality | Verdict: CONFIRMED

Files: `src/app/admin/sessions/[id]/actions.ts:309`, `src/app/admin/snowball/actions.ts:106`, `src/app/admin/snowball/actions.ts:229`, `src/app/host/actions.ts:298`, `src/app/api/setup/route.ts:91`

**What is wrong.** CLAUDE.md states every direct .update() must .select() and treat zero rows as an error, and two files in this repo carry comments explaining why (host/actions.ts:1377, admin/sessions/[id]/actions.ts:369). Five other .update() calls still check only `error` and never look at rows.

**How it fails.** Concrete on resetSnowballPot: an admin opens /admin/snowball, another admin deletes a pot, the first admin clicks Reset. The update at snowball/actions.ts:229 matches zero rows, PostgREST returns no error and no rows, so `if (error)` passes. The action then inserts a snowball_pot_history row at line 243 recording old_val_jackpot -> new_val_jackpot for a change that never happened, and returns success. The money audit trail now contains a fabricated entry. Second case: api/setup/route.ts:91 updates profiles.role='admin' for a user whose profiles row was never created; zero rows, no error, and the endpoint responds {success:true, role:'admin'} while the user has no admin access at all.

**Proposed fix.** Append `.select('id')` to each and treat an empty array as a failure, matching voidWinnerFromHost. For resetSnowballPot in particular, move the pot update and the audit insert into a single security-definer function the way settle_snowball_pot already does, so the audit row cannot outlive a failed update.

### 110. [LOW] The display has no audio of any kind, though PRD 3.1 lists Win / Break / Start sound effects as in scope for v1

Area: completeness | Verdict: CRITIC, unverified

Files: `src/app/display/[sessionId]/display-ui.tsx`, `public/`, `docs/PRD.md`

**What is wrong.** docs/PRD.md section 3.1 In scope (v1) ends with "Sound effects for the display client (Win, Break, Start)". There is no Audio, no <audio>, no .mp3 and no sound asset anywhere in the project. CLAUDE.md's "no audio" note is specifically about number announcements, which is a different thing.

**How it fails.** A Full House lands during the loudest part of a Friday night. The pub TV flips to a silent WIN! overlay. Half the room, facing the bar rather than the screen, misses the transition entirely and keeps marking, so the host has to shout over the room to stop play - which is exactly the moment a late claim becomes possible and the house rule "claims must be called on the number they're won on" becomes contentious.

**Proposed fix.** Add three short bundled sounds triggered off display_win_type transitions, on_break transitions and game start, behind a mute toggle persisted on the display device (the TV laptop is set up once). If sound is genuinely unwanted, delete the line from the PRD so it stops reading as an open requirement.

### 111. [LOW] The ticket colour is spelled out in words only on the host briefing; the pub TV and the follower phone paint the colour and never name it

Area: completeness | Verdict: CRITIC, unverified

Files: `src/lib/colour-name.ts:30`, `src/components/host/pre-game-briefing.tsx:22`, `src/app/display/[sessionId]/display-ui.tsx`, `src/app/player/[sessionId]/player-ui.tsx`

**What is wrong.** getColourName was written specifically so a colour is communicated as a word rather than a hue, and its own comment names accessibility as the reason. It is imported in exactly one place: the host's pre-game briefing. Both public surfaces render background_colour as a wash with no accompanying colour name.

**How it fails.** A colour-blind punter (roughly 1 in 12 men, and this is a pub) looks at the TV to work out which page of the book is in play for Game 4. The screen is washed in a colour they cannot name and nothing on it says "Peach". They have to ask a neighbour, or mark the wrong page and only discover it when their claim is refused - which, under the house rule shown on that same screen, cannot be re-claimed later.

**Proposed fix.** Render `{getColourName(game.background_colour)} book` next to the game name on both /display and /player. It is a one-line change per surface and reuses the tested helper.

### 112. [LOW] The unindexed-FK, auth_rls_initplan and multiple_permissive_policies advisor warnings are noise at this data volume

Area: db-integrity | Verdict: CONFIRMED

Files: `supabase/migrations/20251221101436_fix_host_permissions.sql:11`, `supabase/migrations/20251221101438_add_game_states_public.sql:13`

**What is wrong.** I checked each performance advisor item against real table sizes. The whole database is under 1 MB and the largest table is 87 rows, so none of the nine unindexed foreign keys or the per-row `auth.uid()` re-evaluations can matter. The one item worth a tidy is the genuinely duplicated INSERT policy on game_states, which is redundant rather than slow.

**How it fails.** No failure. Documenting so these are not treated as outstanding work: the sequential scans the advisor is warning about are over 60- and 87-row tables. `winners.game_id` is the only unindexed FK on a live-game code path (`void_last_number` and `settle_snowball_pot` both scan `winners` by `game_id` while holding a row lock) and at 87 rows that scan is sub-millisecond. Revisit if `winners` ever passes a few thousand rows.

**Proposed fix.** Drop the redundant "Hosts can insert game state" policy on `game_states` in a one-line migration. Leave the FK indexes and the `auth.uid()` wrapping alone until table volumes justify them; if you want the advisor quiet, wrap the policy calls as `(select auth.uid())`, which is behaviour-preserving.

### 113. [LOW] create_table_booking_transaction exists in production but no migration creates it, so it would vanish on a rebuild

Area: db-integrity | Verdict: CONFIRMED

Files: `supabase/migrations/20260730070705_revoke_anon_execute_on_host_rpcs.sql:62`, `supabase/migrations/20260527080524_lockdown_admin_functions_2026_05_27.sql:109`

**What is wrong.** This is the only object in the live `public` schema that no repo migration creates. Three migrations discuss it and deliberately leave it alone, but none defines it, so a project rebuilt from `supabase/migrations/` would not have it. It is also the one function still holding PUBLIC and anon EXECUTE.

**How it fails.** If the project is ever rebuilt from migrations (fresh project, branch database, the `supabase/tests/run.sh` harness), this function is absent. Whatever calls it , the migration comments guess "likely used by public booking form", and it is not this app , breaks with no warning. Conversely, in the live database it is a SECURITY DEFINER function callable by anon that inserts into `table_bookings`, `table_booking_items` and `table_booking_payments`, none of which exist in this project, so every call fails with `relation does not exist`. Whichever way round it is, the repo and production disagree about whether this object should exist.

**Proposed fix.** Decide and record it: either drop the function from production (it cannot succeed here , its target tables do not exist) or add a migration that creates it so the repo is a complete description of the database. Either way, revoke the PUBLIC and anon EXECUTE while it remains.

### 114. [LOW] display_winner_name is rendered on both public screens but every write path sets it to null

Area: db-integrity | Verdict: CONFIRMED

Files: `src/app/host/actions.ts:415`, `src/app/display/[sessionId]/display-ui.tsx:1030`, `src/app/player/[sessionId]/player-ui.tsx:750`

**What is wrong.** `game_states.display_winner_name` exists on both tables, is selected by the display and player queries, and both UIs render a prominent heading when it is truthy , but every code path that writes it writes `null`, including `record_winner_atomic`. It is dead weight that reads like a live feature.

**How it fails.** No runtime failure; the block simply never renders. The cost is that the column looks like a supported feature to the next person, and it sits directly against the documented policy that winners are anonymous and no player-identifying data is stored. Someone wiring it up to a real name would satisfy the type system and the schema while breaking that policy.

**Proposed fix.** Drop the render blocks and the column from the SELECT lists, and add a comment on the column recording that it is retained only for schema stability , or drop the column from both tables in a migration once the reads are gone.

### 115. [LOW] The schema has no CHECK constraints at all, so every invariant depends on application code holding

Area: db-integrity | Verdict: CONFIRMED

Files: `supabase/migrations/20251201000000_baseline_schema.sql`, `src/types/database.ts`

**What is wrong.** `pg_constraint` for schema public contains only primary keys, uniques and foreign keys , zero CHECK constraints. Money can go negative, call counts can go out of 1..90, `called_numbers` can drift from `numbers_called_count`, and `winners.session_id` need not agree with `games.session_id`. All of these are currently enforced only inside the RPCs, which several RLS policies let callers bypass.

**How it fails.** Concrete reachable case: a host inserts a `winners` row directly (see the winners-INSERT finding) with `session_id` set to a different session from the game's. `record_winner_atomic` would have raised `wrong_session`, but the direct insert has no such check and no FK spans both columns. The win then appears under the wrong session on /admin/history and in the `delete_session_safe` winner count, so the right session becomes deletable and the wrong one does not. Second case: `updateSnowballPot` accepts `current_jackpot_amount` from a zod schema with `min(0)` but nothing stops a direct `PATCH /rest/v1/snowball_pots` by an admin writing a negative jackpot, which then propagates into the display copy shown to punters. Third case: `game_states.numbers_called_count` is nullable with no range check, so a bad direct write can put the ball counter above 90 or below 0 and `call_next_number`'s `v_count >= jsonb_array_length(number_sequence)` guard reads a nonsense cursor.

**Proposed fix.** Add the cheap ones in one migration: `check (numbers_called_count between 0 and 90)` and `check (current_stage_index >= 0)` on game_states; `check (current_jackpot_amount >= 0 and base_jackpot_amount >= 0 and current_max_calls between 1 and 90 and base_max_calls between 1 and 90)` on snowball_pots; `check (call_count_at_win is null or call_count_at_win between 1 and 90)` on winners. For the session/game agreement, either drop the direct-insert path (preferred, see the winners-INSERT finding) or add a composite FK `winners(game_id, session_id) references games(id, session_id)` backed by a unique index on `games(id, session_id)`.

### 116. [LOW] The profiles INSERT policy checks only the id, so it would grant self-promotion to admin if a profile row were ever absent

Area: db-integrity | Verdict: CONFIRMED

Files: `supabase/migrations/20251201000000_baseline_schema.sql:237`

**What is wrong.** "Users can insert their own profile." has `with check (auth.uid() = id)` and says nothing about `role`. It is currently unexploitable only because `handle_new_user` creates a row for every auth user and there is no DELETE policy on `profiles`, so the primary key always blocks the insert.

**How it fails.** Any change that removes a profile row without removing the auth user , a manual dashboard tidy-up, a future admin "deactivate user" feature, or a data restore that misses `profiles` , leaves that user able to `POST /rest/v1/profiles` with `{id: <their own uid>, role: 'admin'}`. The policy passes and they are an admin, gaining `snowball_pots` write access and the `winners` UPDATE that CLAUDE.md defends at length. It is one deleted row away from privilege escalation.

**Proposed fix.** Tighten the WITH CHECK to `auth.uid() = id and role = 'host'::public.user_role`, or drop the policy entirely , `handle_new_user` is SECURITY DEFINER owned by postgres on a table without FORCE ROW LEVEL SECURITY, so it does not need any INSERT policy to work.

### 117. [LOW] The two admin snowball pot writes use .update() with no .select(), the exact pattern CLAUDE.md forbids, on the money table

Area: db-integrity | Verdict: CONFIRMED

Files: `src/app/admin/snowball/actions.ts:107`, `src/app/admin/snowball/actions.ts:230`

**What is wrong.** `updateSnowballPot` and `resetSnowballPot` call `.update(...).eq('id', id)` and check only `error`. A Supabase update that matches no row , stale id, or RLS filtering , returns no error and no rows, so the action reports success while the pot is unchanged. CLAUDE.md names this exact failure mode and says it had already bitten the snowball pot once.

**How it fails.** The admin has /admin/snowball open in a tab while the pot is deleted or its id changes in another session. They submit an edit: the prior `.select()` of the old values fails and the action bails, so today the id-not-found case is caught by luck rather than design. The uncaught case is an RLS change or a role downgrade between the `authorizeAdmin()` check and the update (the check reads `profiles.role`, the update re-evaluates the policy independently): the update matches zero rows, `error` is null, the action returns `{ success: true }`, the admin sees the pot page reload with the old figures and reasonably assumes a caching glitch. On a jackpot table, a false success is money reported wrong.

**Proposed fix.** Add `.select('id, current_max_calls, current_jackpot_amount')` to both updates and return a failure when zero rows come back, or fold both into the RPC suggested for the audit-trail finding.

### 118. [LOW] Two comments still cite migration filename 20260730120000, which no longer exists after the July reconciliation

Area: db-integrity | Verdict: CONFIRMED

Files: `src/types/database.ts:346`, `docs/architecture/overview.md:94`

**What is wrong.** The 2026-07-30 filename reconciliation renamed `20260730120000_atomic_snowball_settlement.sql` to `20260730065531_...` and the winner-idempotency migration to `20260730064309_...`, but two references were missed, including one baked into a live column comment in production.

**How it fails.** Someone auditing which migration introduced `winners.client_request_id` follows the comment to `20260730120000`, finds no such file, and cannot tell whether the migration was lost or renamed. This matters more than usual here because the repo's own MEMORY note records that repo and production histories were reconciled 1:1 and must stay that way.

**Proposed fix.** Update both comments to the real filenames. The live column comment can be corrected in the same migration as any other change, or simply left , but note in `docs/architecture/data-model.md` that the production comment carries the pre-reconciliation version.

### 119. [LOW] src/types/database.ts is hand-maintained and claims a dozen live-nullable columns are non-null

Area: db-integrity | Verdict: CONFIRMED

Files: `src/types/database.ts:76`, `src/types/database.ts:180`, `src/types/database.ts:335`

**What is wrong.** The file is hand-written (it carries prose comments a generator would not produce) and its Row types mark many columns non-null that are nullable in production. It is internally inconsistent about it: `winners.is_void` is correctly `boolean | null` with a long comment about why, while `winners.is_snowball_jackpot` , nullable in exactly the same way and read by the same money logic , is typed `boolean`.

**How it fails.** A developer writes a jackpot report and, trusting `is_snowball_jackpot: boolean`, filters with `.eq('is_snowball_jackpot', false)` to list non-jackpot wins. Postgres drops NULL rows from an `= false` comparison, so any pre-default or hand-inserted row silently disappears from the report. This is precisely the trap the neighbouring `is_void` comment warns about, and TypeScript gives no hint because the type says the column can never be null. Same shape for `game_states.numbers_called_count`, `status`, `called_numbers` and `sessions.status`: strict-mode TS will not force a null check on a value the database can return as null.

**Proposed fix.** Regenerate with `supabase gen types typescript` into a `database.generated.ts`, keep the hand-written prose in a thin wrapper that re-exports it, and reconcile the differences. If regeneration is not wanted, at minimum change `is_snowball_jackpot` to `boolean | null` and carry the same comment as `is_void`.

### 120. [LOW] game_states.updated_at is frozen at insert time and mirrored into the public table, where four queries still select it

Area: db-integrity | Verdict: CONFIRMED

Files: `supabase/migrations/20251201000000_baseline_schema.sql:157`, `src/app/display/[sessionId]/display-ui.tsx:103`, `src/app/player/[sessionId]/player-ui.tsx:95`

**What is wrong.** `updated_at` has `default now()` but there is no BEFORE UPDATE trigger to maintain it and none of the RPCs or server actions ever set it, so it records when the row was created, not when it last changed. The sync trigger faithfully copies the stale value into `game_states_public`, and four query strings still request it.

**How it fails.** Anyone reaching for `updated_at` to answer "is this screen stale?" or "which snapshot is newer?" gets a timestamp that has not moved since the game state row was first written. Live proof: game d681eec1 has `updated_at = 2026-07-29 18:23:11` while `last_call_at = 2026-07-29 18:38:36` and `state_version = 190` , fifteen minutes and 190 updates later. CLAUDE.md warns "Don't trust `updated_at` for ordering. Use `state_version`", which understates it: the column is not merely unreliable, it never changes at all.

**Proposed fix.** Either set `new.updated_at := now()` inside the existing `bump_game_state_version` BEFORE UPDATE trigger (one line, no new trigger), or drop the column from the four SELECT lists and from `game_states_public` so nobody can be misled by it.

### 121. [LOW] The Manual Snowball Win button stays enabled on a completed or paused game

Area: failure-paths | Verdict: CONFIRMED

Files: `src/app/host/[sessionId]/[gameId]/game-control.tsx:1216`

**What is wrong.** Every other host control is gated by `isGameCompleted` / `isGameNotInProgress` / `isPausedForValidation`. The Manual Snowball Win button is gated only by `!isController` (via a `pointer-events-none` wrapper) and by the presence of a pot.

**How it fails.** Host presses browser Back from the new game to the finished snowball game, or is still on the page after the game completed. The amber "🏆 Manual Snowball Win" button is live. Tapping it mints a fresh claim key, sets a prize description of `£<jackpot> (Manual Snowball Win)` and opens the award modal, which reads as a live jackpot payout. `record_winner_atomic` refuses with `not_in_progress` so no money moves - the server is sound - but the host has been walked all the way to a Confirm button on the one action in the app that pays out the jackpot, on a game that is over. Recovery: none needed, but it is the wrong affordance to leave live.

**Proposed fix.** Add `disabled={!isController || isRecordingSnowballWinner || isGameNotInProgress || isGameCompleted}` to match the rest of the pad.

### 122. [LOW] A game completed via `skipStage` or `advanceToNextStage` leaves `ended_at` null and the session pointing at a finished game

Area: failure-paths | Verdict: CONFIRMED

Files: `src/app/host/actions.ts:1189`, `src/app/host/actions.ts:1456`, `src/app/host/actions.ts:781`

**What is wrong.** `endGame` sets `ended_at`, clears `sessions.active_game_id` and normalises the session status. The two other paths that can set `status='completed'` - `advanceToNextStage` past the last stage and `skipStage` on the last stage - do neither: they write the status, settle the pot, call `maybeCompleteSession` and stop.

**How it fails.** Host validates a Full House claim on the last game, then taps "Skip (No Winner)" rather than recording it. `skipStage` sets `status='completed'` with `ended_at` still null and settles the snowball pot, but `sessions.active_game_id` still points at the now-finished game and the session is not tidied unless every game happens to be complete. The host is left on a completed game page with no Post Win modal and no next step, and `/admin/history` has a completed game with no end time. The pub TV falls back to the waiting screen (because `hasRenderableGame` requires `status === 'in_progress'`), so guests see nothing wrong, but the session record is inconsistent and, if the host closes the tab here, the session stays `running`.

**Proposed fix.** Have both paths route their completion through `endGame` (or share its tail), so `ended_at`, the pot settlement, `maybeCompleteSession` and the `active_game_id` clear-down always happen together whichever control finished the game.

### 123. [LOW] The session-completion writes are never proved to have landed, against the codebase's own documented rule

Area: failure-paths | Verdict: CONFIRMED

Files: `src/app/host/actions.ts:296`, `src/app/host/actions.ts:818`

**What is wrong.** `maybeCompleteSession` fires `.update({ status: 'completed', active_game_id: null })` with no `.select()`, no zero-row check and not even an error check - the result is discarded entirely. `endGame`'s follow-up "clear the active game" write checks `error` but likewise has no `.select()`. CLAUDE.md states the rule explicitly: a Supabase `.update()` that RLS filters out returns no error and no rows, so `if (error)` passes while nothing is written.

**How it fails.** The final game of the night ends. `maybeCompleteSession` runs, its update is filtered or fails, and nothing anywhere notices - there is no `if (error)`, no log line, no host-facing message. `endGame` then re-reads the session, sees it is not `completed`, and writes `{ active_game_id: null, status: 'running' }` instead. The session is left running for ever, which is the same end state as the abandoned-game case: next week's `/display` shows a picker instead of the game, and if the last game was the snowball game the audit trail is misleading. The host is told the game ended successfully. This is the one path where a silent write failure produces exactly the symptom that is hardest to attribute, because it surfaces a week later on a different screen.

**Proposed fix.** Add `.select('id')` to both writes and treat zero rows as a logged failure; at minimum, log the error from `maybeCompleteSession` rather than discarding it. The session-completion write is the one place where a silent no-op is invisible until the following week.

### 124. [LOW] Manual Snowball Win is offered at any stage and on a completed game, and fails with a misleading refusal

Area: host-live-flow | Verdict: CONFIRMED

Files: `src/app/host/[sessionId]/[gameId]/game-control.tsx:1217`, `src/app/host/[sessionId]/[gameId]/game-control.tsx:1884`

**What is wrong.** The button is gated only on `game.type === 'snowball' && currentSnowballPot`, but the action it fires always claims stage 'Full House', so on any earlier stage the server raises `stage_mismatch` and the host is told the live stage has moved on.

**How it fails.** Host is on the Line stage of a snowball game and taps Manual Snowball Win to pre-award a jackpot. `record_winner_atomic` computes `v_expected_stage = 'Line'`, raises `stage_mismatch`, and the host sees "The live stage has moved on. Refreshing now." , which is untrue and gives no hint that the button only works during Full House. On a completed game the same tap yields "This game is not in progress."

**Proposed fix.** Only render the button when `currentStageName === 'Full House'` and the game is in progress, or disable it with a tooltip explaining it is a Full House control.

### 125. [LOW] `maybeCompleteSession` swallows read errors and updates `sessions` without `.select()`, so a session can silently stay 'running' forever

Area: host-live-flow | Verdict: CONFIRMED

Files: `src/app/host/actions.ts:277`, `src/app/host/actions.ts:298`, `src/app/host/actions.ts:813`

**What is wrong.** The helper that closes a session returns silently on any read error and finishes with a bare `.update()` whose row count is never checked, which is precisely the failure shape CLAUDE.md warns about; callers treat its completion as success.

**How it fails.** Host ends the last game of the night. The `game_states` read inside `maybeCompleteSession` returns a transient error, so the function returns without doing anything. `endGame` then reads the session, sees status still 'running', and sets `active_game_id = null, status = 'running'`, returning success. The host is navigated to `/host` and the session still appears under RUNNING with every game showing "Re-open". `/display` still resolves the session as active. Nothing tells anyone the session was never closed, and an admin has to fix it by hand.

**Proposed fix.** Return a result from `maybeCompleteSession`, add `.select('id')` to the update and treat zero rows as a failure, log the swallowed read errors via `logActionFailure`, and have `endGame` surface "the game ended but the session did not close" the way it already does for the `active_game_id` clear at line 832.

### 126. [LOW] After "Close and stay paused" the main control pad has no Resume control, contradicting the modal's own instruction

Area: host-live-flow | Verdict: CONFIRMED

Files: `src/app/host/[sessionId]/[gameId]/game-control.tsx:1779`, `src/app/host/[sessionId]/[gameId]/game-control.tsx:1022`, `src/app/host/[sessionId]/[gameId]/game-control.tsx:1023`, `src/app/host/[sessionId]/[gameId]/game-control.tsx:1025`

**What is wrong.** While `paused_for_validation` is true, Next Number, Take Break and Undo Last Call are all disabled and no Resume button is rendered on the page, so the only route out of the pause is to reopen the claim-check modal and press "Cancel & Resume".

**How it fails.** Host records a winner, then taps "Close and stay paused" to hand out the prize. The Post Win modal closes and the page shows "CHECKING CLAIM...". The host wants to carry on: NEXT NUMBER is disabled, Take Break is disabled, Undo Last Call is disabled. The modal's own copy told them to "Resume ... from the main pad", but the only enabled control that leads anywhere is "Check Claim", which re-pauses and then has to be cancelled. Mid-game, behind the bar, this reads as a frozen app.

**Proposed fix.** Render a Resume button on the main pad (or repurpose the Take Break button) whenever `currentGameState.paused_for_validation` is true, calling `handleResumeGame`; alternatively correct the Post Win copy to name the Check Claim route.

### 127. [LOW] The host's `snowball_pots` realtime channel can never fire: the table is not in the publication

Area: host-live-flow | Verdict: CONFIRMED

Files: `src/app/host/[sessionId]/[gameId]/game-control.tsx:352`

**What is wrong.** `pot_updates_host:${pot_id}` subscribes to UPDATE events on `public.snowball_pots`, which is absent from `supabase_realtime`, so the host's jackpot figure is whatever was read at mount for the life of the page.

**How it fails.** An admin corrects the pot on `/admin/snowball` while the host page is open on a snowball game. The host's panel keeps showing the old jackpot amount and the old `current_max_calls`, so the "N calls left" countdown and the amount quoted in the Record Winner modal are both wrong until the host reloads. The server still derives the real values from the locked pot row, so no wrong payout is written, but the host reads the wrong number to the room.

**Proposed fix.** Re-read the pot alongside the existing 3-second `pollGameState` (or on the visibility handler), or add `public.snowball_pots` to the publication in a guarded migration.

### 128. [LOW] Skipping the final stage completes the game outside `endGame`: no `ended_at`, `sessions.active_game_id` still points at the finished game, and the host gets no next step

Area: host-live-flow | Verdict: CONFIRMED

Files: `src/app/host/actions.ts:1444`, `src/app/host/actions.ts:1476`, `src/app/host/actions.ts:781`, `src/app/host/[sessionId]/[gameId]/game-control.tsx:865`

**What is wrong.** `skipStage` (and the racy `newGameStatus === 'completed'` branch of `advanceToNextStage`) sets `status = 'completed'` directly, so it skips everything `endGame` does beyond the pot settlement: it never writes `ended_at`, never clears `sessions.active_game_id`, and the client never opens the Post Win modal or navigates.

**How it fails.** Game 2 of 5 reaches Full House and nobody claims by ball 90. The host opens Check Claim and taps "Skip (No Winner)". `skipStage` caps the index at the last stage and sets status completed. `maybeCompleteSession` finds games 3-5 incomplete, so the session stays 'running' with `active_game_id` still pointing at game 2. The TV at `/display/[sessionId]` keeps rendering the finished game 2 until the host separately starts game 3 from `/host`. On the host screen every control is now disabled, the validation modal has closed, no Post Win modal opens and no navigation happens, so the only way forward is the browser back arrow in the header. The `game_states.ended_at` for that game is left null, unlike every game ended through the Post Win path.

**Proposed fix.** Have `skipStage` and `advanceToNextStage` reuse the same completion tail as `endGame` (set `ended_at`, settle the pot, `maybeCompleteSession`, then clear `active_game_id` when the session stays running), and on the client open the Post Win / next-game prompt when the returned state comes back completed.

### 129. [LOW] An inner modal unmounting releases the body scroll lock while the outer modal is still open

Area: host-live-flow | Verdict: CONFIRMED

Files: `src/components/ui/modal.tsx:78`

**What is wrong.** `Modal` sets `document.body.style.overflow` from an effect whose cleanup unconditionally writes `"unset"`, so closing a stacked modal unlocks page scroll behind the modal that is still open.

**How it fails.** On the host screen the Record Winner modal is stacked over the still-open Validate Ticket modal. The host taps Cancel on Record Winner; its effect cleanup runs `document.body.style.overflow = "unset"`. The Validate Ticket modal is still open but the page behind it now scrolls under touch, so a mis-swipe on the 90-number grid scrolls the page instead of the grid.

**Proposed fix.** Use a module-level open-modal counter and only restore `overflow` when the count reaches zero.

### 130. [LOW] p_force_snowball_jackpot bypasses the call-window check entirely, and the button that sets it is available to any host at any call count

Area: money-winner-path | Verdict: CONFIRMED

Files: `supabase/migrations/20260730064309_winner_idempotency_key.sql:225`, `src/app/host/[sessionId]/[gameId]/game-control.tsx:1215`, `src/app/host/[sessionId]/[gameId]/game-control.tsx:1886`

**What is wrong.** CLAUDE.md states "The window is re-checked inside `record_winner_atomic`, so an out-of-window jackpot cannot be awarded by the client." That is not what the function does: `if coalesce(p_force_snowball_jackpot,false) or (v_window_open and ...)` short-circuits on the force flag before the window is consulted. The Manual Snowball Win button passes `true` and is rendered for any snowball game with a pot, regardless of `numbers_called_count`.

**How it fails.** Snowball window is 48 calls; the pot is £200; ball 71 is called and a Full House is claimed. The eligibility panel correctly says "Jackpot is closed". The host instead taps Manual Snowball Win (still on screen), Confirm Snowball Win, and `record_winner_atomic` writes `is_snowball_jackpot = true, prize_given = true, prize_description = '£200.00 (Manual Snowball Win)'`. `settle_snowball_pot` then RESETS the pot to base. A host-role account, not an admin, has just paid and cleared a £200 pot outside the rules with two taps and no second approval. Any authenticated host can also do it directly: `record_winner_atomic` is EXECUTE-able by `authenticated` (confirmed by the live advisor output).

**Proposed fix.** Either gate the force path on `profiles.role = 'admin'` inside `record_winner_atomic` (an override of the payout rules is a money decision), or require a typed reason recorded on the winner row, and hide the Manual Snowball Win button once the window is closed unless the user is an admin. Correct the CLAUDE.md claim either way.

### 131. [LOW] Money is displayed and stored with the last pence digit stripped: £212.50 renders as "£212.5"

Area: money-winner-path | Verdict: CONFIRMED

Files: `src/lib/snowball.ts:34`, `supabase/migrations/20260730064309_winner_idempotency_key.sql:236`

**What is wrong.** `formatPounds` does `value.toFixed(2).replace(/\.?0+$/, '')`, which strips a trailing zero from a two-decimal amount. The database does the same with `trim_scale(round(v_jackpot_amount,2))::text` when it builds the winner's prize text. Both are used on customer-facing surfaces.

**How it fails.** Admin sets `jackpot_increment` to 12.50 (or any amount with a 0 in the pence). The pot reaches 212.50. The pub TV (`display-ui.tsx:842`), the punters' phones (`player-ui.tsx:788`), the host screen (`game-control.tsx:1135`) and the pre-game briefing all show "£212.5". When the jackpot is won, `record_winner_atomic` writes `prize_description = 'Snowball Jackpot £212.5'` into the permanent winners record. Verified: `formatPounds(212.5) -> '212.5'`, `formatPounds(20.50) -> '20.5'`, and on the live database `trim_scale(round(212.50,2))::text -> '212.5'`.

**Proposed fix.** Format money as either a whole number or exactly two decimals , never one. `Number.isInteger(v) ? String(v) : v.toFixed(2)`. In SQL use `to_char(round(v,2), 'FM999999990.00')` with the integer case handled explicitly, rather than `trim_scale`.

### 132. [LOW] The jackpot amount is dropped from the winner record whenever the planned prize text already contains the word "snowball"

Area: money-winner-path | Verdict: CONFIRMED

Files: `supabase/migrations/20260730064309_winner_idempotency_key.sql:241`

**What is wrong.** `record_winner_atomic` appends the jackpot text only when `position('snowball' in lower(v_prize)) = 0`. A perfectly ordinary admin-entered prize such as "£20 Snowball Full House" trips that check, so a genuine jackpot win is stored with the stage prize alone and the jackpot amount appears nowhere in the audit row.

**How it fails.** Admin sets the snowball game's Full House prize to "£20 Snowball Game". Pot is £140, window open, punter wins, host chooses Eligible. `v_prize` already contains "snowball", so the `' + Snowball Jackpot £140'` suffix is skipped. The `winners` row reads "£20 Snowball Game". The big screen flashes "FULL HOUSE + SNOWBALL £140!" and then clears, but the Winners & Prizes list the host pays from , and the permanent audit record , say £20. The punter is underpaid by £140 unless somebody remembers the flash.

**Proposed fix.** Drop the substring heuristic and always append the jackpot text when `v_is_jackpot` is true (or key the de-duplication on the exact generated `v_jackpot_text`, not on the word "snowball"). Also render an explicit "+ JACKPOT £X" badge in the Winners & Prizes list from `is_snowball_jackpot` rather than relying on free text.

### 133. [LOW] The snowball pot admin form silently resets a stored increment of 0 to the hard-coded default on the next save

Area: money-winner-path | Verdict: CONFIRMED

Files: `src/app/admin/snowball/snowball-list.tsx:248`, `src/app/admin/snowball/snowball-list.tsx:198`

**What is wrong.** Every numeric field uses `defaultValue={editingPot?.X || <default>}`, which treats a stored 0 as absent. `calls_increment` and the max-calls fields are true integers over the wire (numeric money columns arrive as strings, e.g. `"20.00"`, so those are accidentally safe), so a pot deliberately configured with `calls_increment = 0` is silently rewritten to 2 the next time an admin opens and saves the pot.

**How it fails.** Admin configures the 2026 Snowball with a fixed 48-call window and `calls_increment = 0` , the pot grows in cash but the window never widens. Weeks later they open the pot to bump the jackpot amount; the Calls Increment field renders "2" instead of "0" and they save. From then on `settle_snowball_pot` widens the window by 2 calls every rollover, so the jackpot becomes progressively easier to win and gets paid out sooner and more often than the house intended. `updateSnowballPot` accepts it (`calls_increment: z.coerce.number().min(0)`) and writes it with no diff shown.

**Proposed fix.** Use `??` instead of `||` for every `defaultValue` in this form: `editingPot?.calls_increment ?? 2`.

### 134. [LOW] set_winner_prize_given will mark a voided winner's prize as handed over

Area: money-winner-path | Verdict: CONFIRMED

Files: `supabase/migrations/20260730065446_host_can_mark_prize_given.sql:70`, `src/app/host/actions.ts:1305`

**What is wrong.** The RPC checks the winner exists and belongs to the session, but not `is_void`. The host UI disables the button for voided rows (`disabled={... || winner.is_void === true}`), so the guard exists only on the client for a money-adjacent flag on a win that has been cancelled.

**How it fails.** A win is voided after the host already marked the prize given, or a stale host tab (whose `sessionWinners` list still shows `is_void: false`) posts `toggleWinnerPrizeGiven` for a row an admin has just voided. The RPC writes `prize_given = true` on a voided winner and returns true, so the action reports success. The session's paid-out record then shows a prize handed over against a cancelled win, which is exactly the row a cash reconciliation would trip over.

**Proposed fix.** Select `is_void` alongside `session_id` in the RPC and raise a mapped key (e.g. `winner_voided`) when it is true and `p_prize_given` is true. Add the mapping to HOST_RPC_ERRORS in src/app/host/actions.ts.

### 135. [LOW] validateClaim accepts a claim made of the same number repeated, and rejects nothing about duplicates

Area: money-winner-path | Verdict: CONFIRMED

Files: `src/app/host/actions.ts:981`, `src/app/host/actions.ts:1044`

**What is wrong.** The server checks the array length against the per-stage required count, that every entry is an integer 1..90, that the last called ball is present, and that every entry is in the called set. It never de-duplicates, so `[7,7,7,7,7]` where 7 is the last called ball passes as a valid Line.

**How it fails.** The grid UI cannot produce duplicates, so this is not reachable by tapping , but `validateClaim` is a server action any authenticated host session can post to directly, and the whole point of the function is that the server does not trust the client's arithmetic. A malformed or replayed payload of five copies of the last ball returns `{valid: true}`, the host screen shows "Valid Claim", and a win is announced on the big screen for a ticket that does not exist. (Impact is capped because a host can record a winner without validating at all, so this is a correctness gap rather than a privilege escalation.)

**Proposed fix.** Add `if (new Set(claimedNumbers).size !== claimedNumbers.length) return failure('validateClaim', 'A claim cannot repeat the same number.')` before the membership loop.

### 136. [LOW] The narrow SELECT lists on the public pages give false comfort: the anon key shipped to those pages can read every column of games and sessions

Area: realtime-sync | Verdict: CONFIRMED

Files: `src/app/display/[sessionId]/page.tsx:15`, `src/app/player/[sessionId]/page.tsx:14`, `src/app/display/[sessionId]/display-ui.tsx:97`

**What is wrong.** Four separate comments in the display and player code state that "Explicit narrow column lists keep public surfaces from leaking unintended fields". They do not: the live RLS on `games` and `sessions` is `SELECT ... to public USING (true)`, and RLS grants row access, not column access. Any punter who scans the QR gets the anon key from the page bundle and can read `games.notes`, `sessions.notes` and `sessions.created_by` directly.

**How it fails.** A guest opens devtools on /player/{id}, copies `NEXT_PUBLIC_SUPABASE_ANON_KEY` out of the JS bundle, and issues `GET /rest/v1/sessions?select=*`. They receive every session ever run, including `notes` and the `created_by` staff user id. Today `notes` is empty on all six production rows, so nothing is actually exposed -- but the code comments actively discourage anyone from noticing that `notes` is a staff-only free-text field a member of staff could reasonably use for takings, prize float, or a note about a barred customer.

**Proposed fix.** Either move `notes` off the publicly readable tables, or replace the `using (true)` policies with column-restricted grants (`revoke select on public.sessions from anon; grant select (id, name, start_date, status, is_test_session, active_game_id) on public.sessions to anon;` and the equivalent for `games`), which is the only mechanism that actually enforces the column list. At minimum, correct the four comments so the next reader does not assume the narrow select is a security boundary.

### 137. [LOW] The TV has no unattended path back to a live game: /display never re-checks for a new session and /display/[sessionId] is pinned to a completed one forever

Area: realtime-sync | Verdict: CONFIRMED

Files: `src/app/display/page.tsx:22`, `src/app/display/page.tsx:63`, `src/app/display/[sessionId]/display-ui.tsx:601`

**What is wrong.** `/display` is a pure server component with no client-side refresh: when zero sessions are ready or running it renders a static "Waiting for the next game to start..." card whose only escape is a human clicking Refresh. And once a session completes, `/display/[sessionId]` locks into the terminal `completed` phase and never redirects back to `/display`, so a TV left on overnight shows the thank-you screen the next evening.

**How it fails.** Staff switch the TV on and open `/display` at 5pm, before the admin has created tonight's session. The production database currently holds six sessions, all `completed` and none `ready` (verified live), so the page falls to the empty branch at page.tsx:63-73. At 7pm the admin creates the session and the host starts game 1. The TV is still showing "No Active Games" -- there is no interval, no `router.refresh()`, no meta refresh and no realtime subscription on this route -- so a member of staff has to walk over and tap Refresh. The mirror case: the TV is left on `/display/{lastNightId}` overnight; `isSessionCompletedState` at display-ui.tsx:580 stays true, `loadPhase` resolves to 'completed' at :601 and the thank-you screen is terminal, so the same manual intervention is needed the following week.

**Proposed fix.** Give `/display` a small client wrapper that calls `router.refresh()` on a 15-30 second interval while no session is active, and prefer a `running` session over a `ready` one when several match (today `sessions.length === 1` is the only auto-redirect condition, so one stale `ready` session will permanently break the redirect). On `/display/[sessionId]`, when `currentSession.status === 'completed'` and the poll sees another session become `running`, redirect to `/display` rather than sitting on the terminal screen.

### 138. [LOW] The game-state realtime reconnect has no re-entrancy guard, so two concurrent connect() calls orphan a subscribed channel that is never removed

Area: realtime-sync | Verdict: CONFIRMED

Files: `src/app/display/[sessionId]/display-ui.tsx:289`, `src/app/display/[sessionId]/display-ui.tsx:338`, `src/app/display/[sessionId]/display-ui.tsx:355`, `src/app/player/[sessionId]/player-ui.tsx:285`, `src/app/player/[sessionId]/player-ui.tsx:334`, `src/app/player/[sessionId]/player-ui.tsx:351`

**What is wrong.** `connect()` is async and awaits `removeChannel(activeChannel)` before nulling `activeChannel` and creating the replacement. It is invoked from two independent triggers -- the backoff `setTimeout` inside the subscribe callback and the `visibilitychange` handler via `reconnectGameStateRef` -- with no flag preventing overlap. When both run, the first one's freshly created channel is overwritten by the second and is left subscribed with no reference, so it is never torn down on cleanup.

**How it fails.** A guest's phone loses signal in the pub. The channel reports CHANNEL_ERROR and a 2-second backoff timer is armed (player-ui.tsx:325-327). The guest pockets the phone and takes it out again 2 seconds later; `visibilitychange` fires and calls `reconnectGameStateRef.current()` (player-ui.tsx:351) at almost the same moment the timer fires. Both `connect()` invocations read `activeChannel === C0`, both `await removeChannel(C0)` (the second is a no-op), then both proceed: connect#1 assigns `activeChannel = C1`, connect#2 assigns `activeChannel = C2`. C1 is subscribed to `game_states_public` but unreachable -- the effect cleanup at :341-342 only removes C2. Every call now delivers two payloads (two `setCurrentGameState` calls, two re-renders, two reveal-effect teardown/re-plan cycles per ball), and the leaked channel counts against the project's Realtime concurrent-connection budget for the rest of the evening. Repeat over a two-hour session with a flaky connection and the count grows monotonically.

**Proposed fix.** Add a `let connecting = false;` (or a promise chain) inside each effect: `const connect = async () => { if (connecting || !isMounted) return; connecting = true; try { ... } finally { connecting = false; } }`. Also clear any armed `reconnectTimer` at the top of `connect()` so a visibility-triggered reconnect cancels the pending backoff rather than racing it.

### 139. [LOW] Backlog catch-up is uncapped: a client that falls behind trickles balls at 1.2s each and shows a wrong "current number" for up to a minute

Area: realtime-sync | Verdict: CONFIRMED

Files: `src/lib/reveal-queue.ts:81`, `src/lib/call-timing.ts:14`, `src/app/display/[sessionId]/display-ui.tsx:578`

**What is wrong.** When more than one ball is outstanding, `planReveal` advances exactly one ball per `PUBLIC_MIN_DWELL_MS` (1200ms) with no upper bound on how far behind the client may be. Everything downstream -- the giant main number, the Recent Calls strip, "Total Calls", and the snowball "Calls Left" countdown -- is derived from `revealedCallCount`, so a lagging client displays a stale number as if it were the live call.

**How it fails.** The pub TV's connection stalls for 100 seconds (WebSocket dead, one poll hung -- see finding no-data-staleness-detector). The host calls 15 balls in that window. When data resumes, `serverCount - revealedCount = 15`, which takes branch 4 at reveal-queue.ts:81-86 and paces one ball every 1200ms. For the next ~20 seconds the TV's main ball and the `currentNumberDelayed` shown in the claim-check overlay (display-ui.tsx:943) are balls the host called well over a minute ago, while `Total Calls` at :1073 under-reports by up to 15. If a punter shouts BINGO during that window and the host pauses, `snapImmediately` rescues the overlay -- but until then the big screen is confidently wrong. Nothing in the plan lets it jump the queue.

**Proposed fix.** Add a catch-up ceiling to `planReveal`, mirroring the existing `adoptRevealCount` policy: when `serverCount - revealedCount` exceeds a threshold (e.g. 4), jump straight to `serverCount - 1` and let the normal single-ball delay gate the newest ball. That preserves "the newest ball is never revealed early" while dropping the guarantee that no intermediate ball is individually displayed -- which is the right trade for a screen whose job is to show the current call, and it keeps the strip correct because the numbers are still all present in `delayedNumbers`.

### 140. [LOW] Both public screens subscribe to snowball_pots changes, but that table is not in the realtime publication

Area: realtime-sync | Verdict: CONFIRMED

Files: `src/app/display/[sessionId]/display-ui.tsx:474`, `src/app/player/[sessionId]/player-ui.tsx:374`

**What is wrong.** `supabase_realtime` contains only `game_states`, `game_states_public` and `sessions`. The `pot_updates` / `pot_updates_player` postgres_changes subscriptions on `snowball_pots` can never fire, so the jackpot amount and `current_max_calls` on both public screens are frozen at whatever was read when the active game last changed.

**How it fails.** An admin corrects the jackpot on /admin/snowball mid-session (say from £120 to £150 after a miscount). `settle_snowball_pot` or the admin update writes the new value. Neither the pub TV nor any guest phone ever sees it: the subscription is inert and the pot is only re-read inside the effect keyed on `currentActiveGame` (display-ui.tsx:494). The TV keeps advertising £120 in the countdown badge (:842) and the footer (:1060) until the host starts the next game. Guests are shown a jackpot figure that no longer matches the one the pub will pay.

**Proposed fix.** Pick one and make it honest. Either add `snowball_pots` to the `supabase_realtime` publication (it is already anon-SELECTable per the live RLS, so the payloads carry nothing new), or delete the two dead subscriptions and re-read the pot on the existing 3-second poll so the displayed jackpot is never more than a few seconds stale.

### 141. [LOW] There is no way to export the record of a night: /admin/backup exports nothing and shows the planned draw order, not what was called

Area: tracking-observability | Verdict: CONFIRMED

Files: `src/app/admin/backup/page.tsx:30`

**What is wrong.** The page documented as the export tool renders an unpaginated HTML list of every game's pre-generated number_sequence. It has no download, no CSV/JSON, no winners, no called numbers and no pot data, so the permanent record cannot leave the system.

**How it fails.** The licensee asks for the record of the 29 July night to file, or the app is being decommissioned and the six nights of history need archiving. /admin/backup is the only thing resembling an export. It lists number_sequence - the shuffled 1..90 array generated at start time, i.e. the planned draw order, not the balls actually called (called_numbers, which is a different column) - for every game ever created, currently 60 games at 90 numbers each in one unpaginated page, with no winners, no times, no prizes and no pot movements. There is no download control anywhere in the app. The only route to a permanent record is direct database access. As a side effect the page also renders the full future draw order for games that have not been played yet.

**Proposed fix.** Add a real per-session export (CSV or JSON) covering winners with their status and prize, each game's called_numbers with started_at/ended_at, and the pot movements for the night. Scope the existing backup call sheet to a single session, and consider hiding the sequence for games that have not started.

### 142. [LOW] Controller handovers overwrite in place, so who was running the game at any moment is unrecoverable

Area: tracking-observability | Verdict: CONFIRMED

Files: `src/app/host/actions.ts:520`, `src/app/host/actions.ts:385`

**What is wrong.** takeControl and startGame both overwrite game_states.controlling_host_id with the new host's id. Only the final controller survives, and nothing records that a takeover happened or when.

**How it fails.** Two staff run the night from two phones; the first phone's battery dies mid Game 6, the second host taps 'Take control' and finishes the session. The following week a win from Game 6 is disputed. game_states.controlling_host_id now holds only the second host's id (and winners rows hold no actor at all - see the winners finding), so 'who was in control when this ball was called and this win recorded?' has no answer. A stale-heartbeat takeover is indistinguishable from a deliberate one, and a takeover that happened by accident (a host opening the page on a second device) is indistinguishable from both.

**Proposed fix.** Log the handover into the same game_events table proposed for voided balls: game_id, event_type 'controller_taken', previous controller, new controller, whether the previous heartbeat was stale, and the timestamp.

### 143. [LOW] deleteSnowballPot permanently destroys the pot's entire audit trail before deleting the pot

Area: tracking-observability | Verdict: CONFIRMED

Files: `src/app/admin/snowball/actions.ts:164`

**What is wrong.** The delete path removes every snowball_pot_history row for the pot, unlinks the pot from all historical games, then deletes the pot - and records nothing about any of it.

**How it fails.** An admin retires the '2026 Snowball' pot at the end of the year and creates a 2027 one. The action deletes all snowball_pot_history rows for the old pot, sets games.snowball_pot_id = null on every game that ever used it (including completed games from six past sessions), then deletes the pot row. Afterwards there is no record that the pot ever existed, no record of the £120 that accreted into it, no record of which games were snowball games, and no record that the deletion happened or who did it. The question 'what did the 2026 snowball pay out over the year?' becomes unanswerable, and past sessions silently lose the fact that Game 9 was a snowball game at all. Today this is masked only because snowball_pot_history is already empty; it becomes destructive the moment settlements start writing rows.

**Proposed fix.** Do not delete pots. Add an `archived_at` column and hide archived pots from the game-linking dropdown, leaving the history and the games.snowball_pot_id links intact. If deletion must stay, refuse it when any history row or any game reference exists.

### 144. [LOW] game_states.updated_at never advances after insert, and the stale value is mirrored to public clients

Area: tracking-observability | Verdict: CONFIRMED

Files: `supabase/migrations/20260729231945_atomic_host_mutations.sql`, `src/app/host/actions.ts:296`

**What is wrong.** bump_game_state_version sets only state_version and no write path sets updated_at, so the column keeps the row's creation time forever while the row is updated hundreds of times. sync_game_states_public copies the stale value into game_states_public.

**How it fails.** Debugging the morning after: 'Game 10 stopped responding, when was it last touched?' The live row for 'Game 10 - Green (JACKPOT)' says updated_at = 2026-07-29 20:17:59.974766+00. Its state_version is 133 (133 updates) and its ended_at is 2026-07-30 06:24:17 - the next morning. Anyone reading updated_at concludes nothing happened to that row after 20:17 on the 29th, which is wrong by ten hours and 133 writes. The same wrong value is selected into the display and player payloads (GAME_STATE_PUBLIC_SELECT includes updated_at in all four files), so it is on the wire to public clients too. Separately, that 06:24 ended_at is itself a night that cannot be explained: nothing records why or by whom a game was ended ten hours after its last ball.

**Proposed fix.** Set `new.updated_at := now()` in bump_game_state_version alongside the version bump. Also note the mixed clocks in the same rows: started_at and ended_at are Node's `new Date().toISOString()` from the server action while last_call_at is Postgres now(), so cross-column timing arithmetic is already approximate.

### 145. [LOW] Winner History renders dates in the server's timezone and locale, with no time of day

Area: tracking-observability | Verdict: CONFIRMED

Files: `src/app/admin/history/page.tsx:91`

**What is wrong.** A server component formats winners.created_at with raw new Date(...).toLocaleDateString(), so on Vercel it renders in UTC with the Node default (US) locale, and the time of day is dropped entirely.

**How it fails.** A win recorded at 00:30 London time (BST, = 23:30 UTC the previous day) is listed under the previous date, so it appears on the wrong night. Everyday rows render as '7/29/2026' rather than 29/07/2026 for a British pub. Because only the date is shown and there is no session grouping or ordering hint beyond created_at desc, the order in which wins happened within a night is not visible on the page at all - the sibling session-detail page uses toLocaleString() and, being a client component, at least renders in the viewer's timezone.

**Proposed fix.** Format with an explicit locale and timezone (en-GB, Europe/London) and include the time, or move the formatting into a small client component so it renders in the viewer's timezone as session-detail already does.

### 146. [LOW] snowball_pot_history is written but never read: no UI anywhere shows how the pot got to its current value

Area: tracking-observability | Verdict: CONFIRMED

Files: `src/app/admin/snowball/page.tsx`, `src/app/admin/snowball/snowball-list.tsx`, `src/app/admin/history/page.tsx`

**What is wrong.** The only money audit table in the schema has no reader. Nothing in src/ selects from snowball_pot_history; the admin snowball page shows the pot's current values and an edit form and nothing else.

**How it fails.** An admin wants to answer 'the jackpot says £140, show me the six £20 increments and who authorised them'. /admin/snowball renders SnowballList from the snowball_pots rows only. /admin/history renders winners only. There is no page, no export and no query in the app that reads snowball_pot_history, so even once rows start being written by settle_snowball_pot they are invisible to every user of the system. Answering the question requires direct SQL access to the production database.

**Proposed fix.** Add a pot-history panel to /admin/snowball: change_type, old and new values, the linked game and session, changed_by resolved to an email, and created_at. It is the only way an admin can ever see the audit trail the system is now paying to write.

### 147. [LOW] A refused bingo claim is stored nowhere: false calls leave no evidence the host checked

Area: tracking-observability | Verdict: CONFIRMED

Files: `src/app/host/actions.ts:978`

**What is wrong.** validateClaim reads the called set server-side, computes invalidNumbers, returns them to the browser and stores nothing. The genuinely-invalid branch does not even log.

**How it fails.** A punter shouts BINGO, the host pauses, types the six numbers, and the server finds two of them were never called. The action returns { success: true, data: { valid: false, invalidNumbers: [12, 63] } }. The host says 'sorry, not a valid claim' and resumes. Nothing is written to any table and nothing is logged (the `return { success: true, data: { valid: false ... } }` path at line 1051 never calls logActionFailure; only the malformed-input arms do). The questions 'how many false claims did we have on the night?', 'was this the same table shouting three times?' and, crucially, 'did the host actually check the claim before refusing/paying?' cannot be answered from anything the system stores. The only claims that leave a trace are the ones that were paid.

**Proposed fix.** Record every claim check: game_id, stage, call_count at the time, the claimed numbers, the verdict, the actor and the timestamp. The claimed numbers are already server-visible and contain nothing player-identifying, and having them stored is what would let a disputed win be reconstructed at all (today not even a successful claim stores which numbers were on the book).

### 148. [LOW] Session completion writes no timestamp and does not check the write landed

Area: tracking-observability | Verdict: CONFIRMED

Files: `src/app/host/actions.ts:296`, `src/app/admin/sessions/[id]/actions.ts:309`

**What is wrong.** maybeCompleteSession and updateSessionStatus both flip sessions.status with a bare .update() - no .select(), no rowcount check, and sessions has no ended_at or completed_at column.

**How it fails.** The last game of the night ends; maybeCompleteSession writes status 'completed' and active_game_id null. If that update matches nothing (RLS, stale id) it returns no error and no rows and the function simply returns, leaving the session showing as running with no error anywhere. When it does succeed, no timestamp is stored, so 'what time did the night finish?' is only derivable from max(game_states.ended_at) - which production shows can be misleading: the July 29th session's last game carries ended_at 2026-07-30 06:24:17, ten hours after its final ball, because someone ended it the next morning and nothing records that.

**Proposed fix.** Add .select('id') and treat zero rows as a failure in both places, and add a completed_at column set when the status moves to 'completed' so the night has an authoritative end time independent of the last game's ended_at.

### 149. [LOW] /api/setup grants the admin role with no audit, no logging, and without proving the write landed

Area: tracking-observability | Verdict: CONFIRMED

Files: `src/app/api/setup/route.ts:91`

**What is wrong.** The bootstrap endpoint updates profiles.role to 'admin' using the service-role client with no .select(), no audit row, no log line, and profiles has no updated_at, so a privilege escalation to admin is invisible after the fact.

**How it fails.** Two problems from one call. (1) The write is unverified: `.update({ role: 'admin' }).eq('id', user.id)` with no .select(). If the profiles row does not exist (the auth-user trigger failed, or the user predates it) the update matches zero rows, PostgREST returns no error, and the endpoint responds `{ success: true, user: <email>, role: 'admin' }` while nothing was written. The operator believes the account is admin; the next login is refused as a non-admin and nobody knows why. This is exactly the failure pattern CLAUDE.md documents as having already bitten the prize tick and the snowball pot. (2) Even when it does land, nothing records it: profiles has only id/role columns with no updated_at, there is no audit table, and the route logs nothing on success. Answering 'when did this account become admin, and who ran the setup call?' is impossible. Production currently holds exactly one profile row, so an unexpected second admin would be the only signal.

**Proposed fix.** Add `.select('id')` and treat zero rows as a 500, and emit a logActionFailure/console line on both success and failure recording the target email (already in the request) and the timestamp so the grant is at least visible in the Vercel log.

### 150. [LOW] A voided ball is erased with no record of which number, when, or by whom

Area: tracking-observability | Verdict: CONFIRMED

Files: `src/app/host/actions.ts:1490`, `supabase/migrations/20260729231945_atomic_host_mutations.sql`

**What is wrong.** void_last_number pops the last element out of called_numbers and decrements the count in place. The number that was voided, the time, and the host who did it are all discarded, and last_call_at is deliberately left untouched so even the timing signal is lost.

**How it fails.** During Game 6 a host mis-taps and calls a ball early, then voids it. The ball goes back in the bag and is re-drawn later. A punter afterwards says 'you called 47, then said you hadn't, and then called it again ten minutes later'. The only stored artefacts are the final called_numbers array and a state_version counter. Nothing records that a void happened, which number, at what time, or by which host, so the claim cannot be checked either way. The same applies to the display_win_type/display_win_text/display_winner_name that the void clears: a win announcement that went up on the big screen and was then withdrawn leaves no trace.

**Proposed fix.** Insert a row into a small game_events table (game_id, event_type 'ball_voided', number, actor auth.uid(), now()) inside the same transaction as the update. That one table would also cover controller takeovers and refused claims, which have the same problem.

### 151. [LOW] Every entrance animation class in the app is dead: no plugin provides animate-in / fade-in / zoom-in / slide-in-from-*, verified absent from the built CSS

Area: ux-accessibility | Verdict: CONFIRMED

Files: `src/components/ui/modal.tsx:92`, `src/components/ui/bingo-ball.tsx:24`, `src/app/display/[sessionId]/display-ui.tsx:1021`, `package.json:13`

**What is wrong.** 30 usages of tailwindcss-animate class names across src/ compile to nothing, so the modal, win overlay, waiting screen and active-ball transitions are hard cuts rather than the intended fades.

**How it fails.** The win overlay is meant to fade up over the TV (`animate-in fade-in duration-300`); it actually pops instantly, as does every modal on the host's phone. `animate-bounce-slight` on the BingoBall 'active' variant does nothing at all. The intent is invisible in review because the class names read as if they work.

**Proposed fix.** Either add `tw-animate-css` and import it in globals.css, or strip the dead classes and write the two or three transitions that matter (win overlay, modal) as plain CSS in globals.css alongside the existing mask utilities.

### 152. [LOW] Geist Sans is loaded and preloaded but never applied; body falls back to Arial

Area: ux-accessibility | Verdict: CONFIRMED

Files: `src/app/layout.tsx:6`, `src/app/globals.css:21`

**What is wrong.** layout.tsx configures Geist Sans as a CSS variable and tailwind.config maps font-sans to it, but globals.css sets an unlayered body font-family of Arial and nothing in src/ ever uses the font-sans class.

**How it fails.** Every visitor, including punters on pub wifi loading /player on a phone, downloads a Geist Sans woff2 that no element ever renders in. The whole app renders in Arial, so the typography of the TV numerals and headings is not what the config says it is.

**Proposed fix.** Either drop the Arial declaration and let the Tailwind font-sans default apply, or drop the Geist Sans import from layout.tsx so it is not fetched.

### 153. [LOW] The host dashboard's Start button has no in-flight state or double-tap guard, and reports errors through window.alert / window.confirm

Area: ux-accessibility | Verdict: CONFIRMED

Files: `src/app/host/dashboard.tsx:34`, `src/app/host/dashboard.tsx:164`, `src/app/host/dashboard.tsx:173`

**What is wrong.** The first action of the night gives no feedback while it is in flight, and the surrounding error and confirm handling uses blocking native dialogs that the live host screen deliberately replaced with modals.

**How it fails.** Host taps "Start" on pub wifi. The button does not change, no spinner appears, and the router.push does not fire for two or three seconds, so the host taps again. Two startGame calls go out. When one fails, the failure arrives as a native alert() box, which iOS will suppress after repeated dialogs ("Don't show more alerts"), leaving later failures completely silent.

**Proposed fix.** Add a per-game in-flight flag that disables the button and shows "Starting…", and replace the three alerts and the re-open confirm with the existing Modal + inline error-banner pattern used on the game control screen.

### 154. [LOW] Login fields carry no autoComplete attributes

Area: ux-accessibility | Verdict: CONFIRMED

Files: `src/app/login/page.tsx:71`, `src/app/login/page.tsx:85`

**What is wrong.** The email and password inputs omit autoComplete, so password managers and iOS/Android autofill are less reliable on the one screen a stand-in host must get through before they can do anything.

**How it fails.** A stand-in host opens /login on a pub tablet. Safari's saved-password suggestion does not appear above the keyboard because the fields are not annotated, so they type an email and password they half-remember while the room waits.

**Proposed fix.** Add `autoComplete="username"` (or "email") and `autoComplete="current-password"`.

### 155. [LOW] Buttons nested inside Links in nine places produce invalid, doubly-focusable markup

Area: ux-accessibility | Verdict: CONFIRMED

Files: `src/app/page.tsx:33`, `src/app/admin/dashboard.tsx:170`, `src/app/display/page.tsx:69`

**What is wrong.** `<Link><Button/></Link>` puts a <button> inside an <a>, which is invalid HTML and gives assistive technology two nested interactive elements for one target.

**How it fails.** A keyboard user tabbing the home page role picker stops twice per option (once on the anchor, once on the button) and hears the role announced ambiguously. Some screen readers skip the link name entirely and read only the button.

**Proposed fix.** Use `<Link className={buttonClasses}>` directly, or add an `asChild`-style prop to Button so it can render as the anchor.

### 156. [LOW] No prefers-reduced-motion handling anywhere, with indefinite pulsing on the public screens

Area: ux-accessibility | Verdict: CONFIRMED

Files: `src/app/display/[sessionId]/display-ui.tsx:993`, `src/app/display/[sessionId]/display-ui.tsx:663`, `src/app/player/[sessionId]/player-ui.tsx:728`, `src/app/host/[sessionId]/[gameId]/game-control.tsx:1072`

**What is wrong.** animate-pulse runs indefinitely on the TV's pre-call prize rows, the promo headline, the player's Checking Claim card and the host's ON BREAK banner, with no reduced-motion opt-out and no way for a viewer to stop it.

**How it fails.** A guest with vestibular sensitivity opens /player and hits a claim check: the whole card pulses continuously with no way to stop it. The TV's stage-and-prize panel pulses three rows on staggered delays for the entire pre-call period, which can be several minutes. WCAG 2.2.2 requires a pause/stop/hide mechanism for content that moves for more than five seconds.

**Proposed fix.** Add a global `@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; } }` block to globals.css, and drop the pulse from the TV prize rows, which are being read rather than glanced at.

### 157. [LOW] The pub TV's only outage signal is 14px white-on-amber with a 24px Refresh button

Area: ux-accessibility | Verdict: CONFIRMED

Files: `src/components/connection-banner.tsx:19`

**What is wrong.** When a live game is on screen the display never falls back to the large 'failed' panel (a renderable game deliberately outranks it), so a stalled TV shows the last ball plus a small amber pill nobody in the room can read.

**How it fails.** Realtime and polling both stall while a game is renderable. The TV keeps showing ball 43 as though it were current. The only cue is a `text-sm` pill at the top with roughly 1.8:1 contrast, unreadable at 10 metres, and its "Refresh" control is about 24x20px on a screen with no pointer. Punters keep marking a board that has stopped advancing until the 30s auto-reload fires (see the offline-reload finding).

**Proposed fix.** Give ConnectionBanner a size variant: on /display render it at the same clamp() scale as the rest of the TV chrome, drop the Refresh button there (no pointer exists), and raise its z-index above the win overlay.

### 158. [LOW] Host session rows expand via a bare div onClick with no keyboard or screen-reader affordance

Area: ux-accessibility | Verdict: CONFIRMED

Files: `src/app/host/dashboard.tsx:89`

**What is wrong.** The only way to see a session's games on /host is to tap a plain div; it has no role, tabIndex, key handler or aria-expanded.

**How it fails.** A host using an external keyboard on a tablet, or any assistive technology, tabs through /host and reaches nothing: the session card is not focusable, so the games list cannot be opened and no game can be started. Screen-reader users get no announcement that the row is expandable or expanded.

**Proposed fix.** Make the row a `<button type="button">` with `aria-expanded={expandedSessionId === session.id}` and `aria-controls` pointing at the games panel.

### 159. [LOW] Sign Out is a one-tap unconfirmed control in the top-right of the live host screen, next to a 32px back arrow

Area: ux-accessibility | Verdict: CONFIRMED

Files: `src/app/host/[sessionId]/[gameId]/page.tsx:105`, `src/app/host/[sessionId]/[gameId]/page.tsx:91`

**What is wrong.** The live game control page keeps a sticky header whose only right-hand control signs the host out mid-game with no confirmation, and whose back arrow is below the 44px target minimum.

**How it fails.** Host reaches for the top-right of the phone mid-game (the reflex spot for dismissing things) and hits Sign Out. The session cookie is cleared, they land on /login, the controller heartbeat stops and the game is left with a stale controlling_host_id for 30 seconds. They must re-enter credentials they may not know (staff accounts are invite-only and created out of band) before they can call the next number.

**Proposed fix.** Remove Sign Out from the live game header entirely (it is available on /host), or gate it behind a confirm modal. Raise the back control to min-h-[44px] min-w-[44px] and give it an aria-label.

### 160. [LOW] Resetting or deleting a snowball pot -- the app's most money-sensitive admin actions -- is guarded only by window.confirm

Area: ux-accessibility | Verdict: CONFIRMED

Files: `src/app/admin/snowball/snowball-list.tsx:74`, `src/app/admin/snowball/snowball-list.tsx:62`, `src/app/admin/snowball/snowball-list.tsx:133`

**What is wrong.** Deleting a session or a game requires typing the exact name, but wiping an accumulated jackpot back to its base value needs one tap on a native OK, from a 32px ghost button in a table row.

**How it fails.** Admin means to tap "Edit" on the Friday pot but lands on "Reset" (both are `h-8 px-2` ghost buttons, 8px apart). The native confirm appears, they tap OK by reflex on a phone, and a pot that had rolled over to £340 across six weeks is reset to £200. The pot value is not versioned in snowball_pot_history for a manual reset the way a settlement is, so the number has to be reconstructed by hand.

**Proposed fix.** Use the same typed-confirm Modal pattern for pot reset and pot delete, and show the current value in the dialog ("This will clear £340 back to £200").

### 161. [LOW] Closing a stacked modal restores page scrolling while the modal underneath is still open

Area: ux-accessibility | Verdict: CONFIRMED

Files: `src/components/ui/modal.tsx:78`

**What is wrong.** Modal sets document.body.style.overflow on open and unconditionally resets it to 'unset' on cleanup, so the Record Winner modal closing releases the scroll lock that the Validation modal underneath still needs.

**How it fails.** Host confirms a winner. Record Winner closes, its cleanup sets body overflow to 'unset', and the Post Win modal opens. The page behind both modals is now scrollable, so a scroll gesture aimed at the modal content moves the page underneath instead, and the modal appears to drift on the screen.

**Proposed fix.** Track open modals in a module-level counter and only restore overflow when the count reaches zero.

### 162. [LOW] The pub TV never shows the full called-numbers board; at 88 calls only the newest ~11 balls are visible

Area: ux-accessibility | Verdict: CONFIRMED

Files: `src/app/display/[sessionId]/display-ui.tsx:1075`

**What is wrong.** The footer strip renders every called number in a single non-scrolling flex row with overflow-hidden and a fade mask, so all but the last handful are silently hidden, and there is no other view of the board on the big screen.

**How it fails.** At 88 calls a punter looks up to check whether 12 has gone. The strip shows roughly the last eleven balls, masked at the right edge with no cue that 77 more are hidden. "Total Calls: 88" is the only hint. Their only recourse is to scan the QR, open the phone follower and tap "View All Numbers" -- a control which, on a pale game colour, is itself invisible (see the background-colour finding).

**Proposed fix.** Add a compact 90-cell called board to the TV -- either in place of the empty left footer cell during a game, or as a periodic alternate view during long gaps between calls.

### 163. [LOW] The TV's "Connecting to game…" state is default 16px text, unlike every other display state

Area: ux-accessibility | Verdict: CONFIRMED

Files: `src/app/display/[sessionId]/display-ui.tsx:755`

**What is wrong.** The loading phase renders unscaled body text centred on the big screen, while the adjacent 'failed' state correctly uses clamp() typography sized for the room.

**How it fails.** The TV is switched on before the session data is available. The whole 55" screen is plain dark green with a line of 16px text in the middle, which reads as a broken or blank screen from the floor. Ten seconds later the same outage, once classified as 'failed', renders a 4rem headline.

**Proposed fix.** Reuse the 'failed' screen's typography (and its role="status" aria-live) for the loading phase.

### 164. [LOW] The "View Only Mode" overlay covers the current ball on a second device, and offers no way forward when the other host's tab is still alive

Area: ux-accessibility | Verdict: CONFIRMED

Files: `src/app/host/[sessionId]/[gameId]/game-control.tsx:1039`, `src/app/host/[sessionId]/[gameId]/game-control.tsx:148`

**What is wrong.** The controller-lock banner is absolutely positioned over the top of the main display card, hiding the nickname and the top of the current number, and when canTakeControl is false it shows no owner, no timer and no route to recover.

**How it fails.** A host runs the game from a tablet and opens the same page on their phone to watch the count. The phone shows the View Only banner floating over the main card, obscuring the nickname and part of the giant ball, so the second screen cannot do the one thing it was opened for. Separately, a colleague leaves the host page open on the back-office PC and goes home: their heartbeat keeps firing every 10s, canTakeControl stays false forever, and the host on the floor sees only "Another host is currently controlling this game" with no Take Control button, no name, and no explanation of what to do.

**Proposed fix.** Make the banner a normal in-flow block above the card rather than an absolute overlay, and when canTakeControl is false show how long ago the controller was last seen plus the plain-English instruction ("the other device must close the game page, or wait 30 seconds after it goes offline").
