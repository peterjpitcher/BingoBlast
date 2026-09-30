# Developer review of the guest display and events specification

The draft is not ready for the affected lifecycle, claims and money implementation. Its overall product direction is proportionate, but literal implementation would leave gaps in reset behaviour, interrupted claim recovery, concurrent night transitions, jackpot totals and release compatibility. S0 can proceed separately with the conditions below. Production readiness has not been established.

Review date: 30 September 2026. Audience: the owner and implementing developer. Specification: the supplied draft titled “Spec: claims on screen, start and end of night, events carousel and review QR”, dated 30 September, baseline `d12b836`. This is a separate review, not approval to build or a replacement specification.

## Executive assessment

The intended outcome is a room that can follow a paper bingo night without staff maintaining the TV manually: clear claim checks, readable game information, a useful phone link, upcoming events and an end-of-night feedback invitation. The proposal sensibly retains paper tickets, anonymous winners and existing money boundaries. Publishing a complete checked claim is simpler and less error-prone than broadcasting every host tap.

The most consequential corrections are:

- Persist the identity of a claim before an uncertain check or winner save, including recovery on another device. Keeping a key in a React ref does not cover the stated phone-failure journey.
- Make starting, reopening, ending and resetting a night obey one transaction and locking rule. A session lock in the new End the night function alone does not protect the other paths.
- Clear the first-start timestamp on reset and include the new lifecycle fields in every public session read.
- Complete the jackpot accounting design through sharing, totals and history. Adding one column cannot repair consumers that still total ordinary prize shares.
- Define how M2 and M3 coexist with old host tabs and with each other. They both replace the winner function.
- Treat the sentiment-gated feedback destination as an S4 release dependency. Placing it in another repository does not remove its effect on the new invitation.

No P0 finding is assigned. There are material P1 corrections, but they do not justify blocking unrelated read-only work or the whole S0 slice. Avoid turning this into a design-system rewrite, a digital-ticket project or a general security renovation.

## Scope evidence and limitations

The two supplied attachments were read in full: the review brief and the specification. The specification attachment is the reviewed requirements source. Its SHA-256 is `efadd88ae7f143d86a141de65252dbf81e8b80db800183717df80f5f3b169e28`. The existing untracked repository specification was left untouched; it has different formatting and was not substituted for the attachment.

The CashBingo checkout was `main` at `d12b836a2ea73964677b9080750a6f2721502ac7`. Inspection covered relevant host and admin actions, host controls and dashboard, TV and phone server/client screens, public selectors, money and reveal helpers, connection handling, wake lock, shared controls and modal, database types, relevant migrations and SQL harness, Node tests, history and backup consumers, the live-night runbook and the referenced backlog. The workspace and project CLAUDE instructions were read. This was targeted impact tracing, not a fresh verification of all 86 backlog entries or every design inventory count.

Cross-repository interfaces were inspected in AnchorManagementTools at `b5a1bba43356a3b114bcfd5b5fb618eb7cee9b82`, and The Anchor website at `dd0db6804025c9097089ffb6586bd44b2fc4b615`. Management was 21 commits behind its local `origin/main` at `09a36bd`; the relevant events, hours, short-link and feedback interface files were compared and had no difference. Its unrelated working changes were left alone. Neither checkout is proof of the currently deployed commit.

Read-only production queries against `bcmorqsgeumtmhvctvgu` confirmed eight completed sessions, 45 migration-history entries, the current session/public-state/winner columns, broad staff UPDATE policies on private game state and sessions, and the current winner and settlement function definitions. Claim columns and session lifecycle timestamps are not present. A metadata query found no exposed view dependency on the reviewed tables. Matching migration counts do not independently prove all 45 migration versions and definitions match.

Current public checks confirmed the feedback page contains a Google link under “I enjoyed my visit” and a private form under “It could have been better”. A HEAD request to an existing website UUID event link returned a 308 canonical redirect without the supplied campaign parameters. The public website feed was inspected by the integration review: the first-50 concern below is a future-data risk, not a failure of the current small list. The tracking review short link was not opened merely to test it.

A read-only management short_links lookup confirmed `cvf4k7` currently has no expiry and points to the specified feedback destination. This establishes current configuration, not a guarantee that its target or availability will remain unchanged.

`npm test` and `npm run test:utc` each completed with 126 tests, 125 passing, zero failing and one skipped live anon-access catalogue check because no database connection was configured. A pure reveal-helper check demonstrated that a ball older than its public delay can still be awaiting backlog display. These results establish existing helper behaviour only. No proposed feature exists to exercise yet. No build, database replay, authenticated management API call with the proposed key, browser fault injection, actual-TV check, migration or deployment was performed. No player records or secret values were included in this report.

Evidence labels below distinguish confirmed requirements gaps, inspected code, current live evidence and plausible unexecuted failure scenarios. “Required correction” means resolve at the stated gate, not necessarily before all development begins. P1 is a material delivery issue; P2 is meaningful but non-critical; P3 is optional. Priority is separate from certainty.

## Wider impact and dependencies

| Change and input | Changed state or behaviour | Downstream users and consequences |
|---|---|---|
| Host pause, paper claim and called balls | Published claim and winner record | TV, phone, ties, controller takeover, stage advance, undo and payouts must describe the same attempt. The physical ticket still needs host inspection. |
| Game start, finish, reset and admin reopen | Session timestamps, active game and phase | Dashboard, public polling/Realtime, permanent TV routing, QR resolution and historical dates must stay coherent. Existing and newly created sessions both matter. |
| Snowball winner and pot | Jackpot component, shares and settlement | Host prize controls, history totals, voiding and manual recovery. An application rollback cannot reverse a payout or settled pot. |
| Management scheduled events, details and hours | Cached public event projection and kitchen copy | TV carousel, phone list, website redirects, key quota and campaign reporting. Event changes and revoked keys affect already-open screens. |
| Review short link | New public invitation to an existing external journey | Everyone invited, the feedback administrator and the venue's Google presence. Private feedback can collect personal data downstream although bingo adds none. |
| Shared input/button sizes and new panels | Layout and interaction changes | Admin forms as well as host, TV and phone; keyboard users, colour-blind users, people using text zoom and staff on older devices. |

No new email, SMS, booking write, payment collection, background job or scheduled automation is proposed in CashBingo. Existing website booking journeys remain destinations rather than changed implementations. The management short-link cron is an optional supplier improvement because a fallback exists. The existing backup page reads number sequences and does not need claim data; include it only in the operational regression check. No new product analytics system is needed to recognise success.

## High priority findings

### R01 Persist the claim identity through interrupted work

**P1 | Required correction | Claims, money and recovery | Confirmed specification gap; current key storage inspected.** References: 5.2, X3; `src/app/host/[sessionId]/[gameId]/game-control.tsx:93`, `:100`, `:1054`.

X3 creates the key when Check Win succeeds, but neither the proposed data nor RPC arguments retain a validation-attempt identity. If the check commits but its response disappears, there is no durable success identity to recover. If winner recording commits and the phone reloads, a subsequent recheck can mint a new key and turn the same person into a second tied winner. A delayed check from an abandoned modal can also land in a newer pause because both requests name only the game.

The existing winner-key uniqueness is useful and should remain. The gap is the recovery contract around it, not a need to prevent legitimate ties.

**Smallest adequate action:** persist one attempt identity before checking, return it in recoverable host state and require it for checking and recording. Bind it to the stage and called-ball snapshot. An explicit new claimant starts a new identity; transport retries do not. Keep the existing winner-key lookup before fresh-claim/status checks so a committed retry succeeds after unpause or advance. Developer owns the design before S2 implementation.

**Proposed wording:** “An interrupted check or save resumes the same persisted claim attempt. A fresh attempt is created only when the host explicitly starts another claimant. Stale responses cannot publish into a later attempt.”

**Acceptance:** lose the check response and save response separately; close/reopen the modal; reload; take over on another phone; retry after stage advance. Each original attempt produces one winner. A genuine second claimant still produces a separate tied winner. A delayed old check changes nothing.

### R02 Serialise lifecycle transitions across every competing path

**P1 | Required correction | Data integrity and operations | Confirmed design omission; concurrency outcome inferred from inspected code.** References: 5.1, X9, X10; `src/app/host/actions.ts:521`, `:547`, `:601`, `:886`, `:323`; reset migration `20260825080604_session_reset_audit_and_guard.sql:108`.

End the night locks the session, but current start/reopen writes game state before a separate session write. An unlocked “another game running” check can pass in two concurrent requests. End the night can race with start, and a trigger updating sessions from game-state writes adds a lock-order dependency with session-first reset. Hiding a button or adding a busy state does not establish the invariant.

**Smallest adequate action:** define a consistent transaction and lock order, preferably session first, for start, reopen, finish, reset and end. Re-read permitted session status and competing games under it. A stale start must not silently reopen an ended night. Make repeated End the night preserve its existing completion timestamp. Developer owns this before S1 implementation. This is a targeted lifecycle correction, not a demand to rewrite all server actions.

**Acceptance:** race different game starts and reopens, start against end, reset against start, and reopen against automatic completion using two local database connections. At most one game runs in the session. A completed night has no active running game. No deadlock or false success occurs. Preserve the unplayed-snowball rule and test-session isolation.

### R03 Complete timestamp reset and public data propagation

**P1 | Required correction | Lifecycle, public screens and historical data | Confirmed omission with current code and live column evidence.** References: 5.1, M1; reset migration `20260825080604:152-160`; `display/[sessionId]/page.tsx:17`, `display-ui.tsx:100`, `player/[sessionId]/page.tsx:16`, `player-ui.tsx:92`.

The new first-start timestamp is never specified to clear on reset. Reset currently deletes game states and sets the session ready. Retaining `started_at` then makes the proposed phase function return between_games instead of before_start. Ordinary reopen should retain that timestamp, so a blanket clear whenever status becomes ready is not necessarily the correct rule.

All four narrow session selectors currently omit the new timestamps and the session date needed by the events filter. M2 explicitly inventories public game-state selectors, but M1 has no equivalent session inventory. Without those reads, polling cannot calculate the proposed phase reliably even if Realtime temporarily supplies a whole row.

**Smallest adequate action:** clear both timestamps in the authorised reset operation, retain the first-start value on ordinary reopen, and include session Row/Insert/Update types and all four session reads in S1. State phase precedence for completed, in-progress and no-game snapshots. Backfill missing historic endpoints as estimates rather than exact end-of-night evidence. Live records have ten states per session; some recorded end timestamps are substantially later than their night's date, so backfill cannot certify the actual historic closing time. Developer owns this before S1 implementation.

**Acceptance:** complete, reset, then refresh with Realtime disabled. Both screens show before_start, and a new first game sets a new timestamp. Reopen retains the original start. An empty completed session and a session completed with unplayed games render night_over. Verify backfill row-by-row without overwriting known values on rerun.

### R04 Define the complete jackpot accounting change

**P1 | Required correction | Money, history and voiding | Confirmed incomplete requirement; existing consumers inspected.** References: X22, M3; `20260825080608_prize_amounts_and_tie_shares.sql:98`, `:133`, `:146`, `:174`; `src/lib/money.ts:39`; `src/app/admin/history/page.tsx:53`, `:155`.

The existing trigger extracts the first pound amount from prize text and totals consume `prize_share_pence`. Adding a jackpot pence column in the winner function leaves both mechanisms unchanged. It does not say how the ordinary prize and jackpot are shared when tied claimants have different eligibility, or how a jackpot-only manual description avoids counting the same money twice.

**Smallest adequate action:** define ordinary prize and jackpot components together, divide the jackpot among eligible jackpot winners, update recalculation on insert/void and update totals/history consumers. Preserve integer-pence conservation and the established anonymous winner rule. Specify treatment of historic rows: use reliable persisted evidence, and identify unknown amounts rather than guessing from today's pot. Include relevant triggers, types, helpers and history in the S6 touch list. Owner owns sharing policy; developer owns its consistent calculation, before S6 implementation.

**Acceptance:** one jackpot winner; two eligible ties; eligible/ineligible ties; an ordinary prize with no cash value plus a jackpot; jackpot-only manual text; an odd penny; void one eligible winner. Component shares sum to the intended pools exactly once and the history total agrees. Do not silently backfill unsupported historic payouts.

### R05 Specify schema and application compatibility during release

**P1 | Required correction | Delivery and recovery | Confirmed incompatibility between specified guard and current callers.** References: M2, M3, section 12; `game-control.tsx:918`, `:928`, `:974`; live `record_winner_atomic` definition.

M2 enforces a valid published claim, while the old host screen validates without writing one and announces a winner before saving. Applying M2 first makes old recordings fail; an already-open host tab remains old after deployment. Rolling the application back also restores those old callers against the new guard. M2 and M3 both redefine `record_winner_atomic`, so either branch can overwrite the other's logic unless integration is explicit.

**Smallest adequate action:** use either an additive schema/RPC release followed by frontend adoption and enforcement, or an agreed release outside play with compulsory host refresh and a tested recovery path. Rebase the later winner-function migration and test the combined final definition. Do not advertise S2 and S6 as wholly independent at that shared function. Owner authorises production application; developer prepares the compatibility matrix before migration approval.

**Acceptance:** define outcomes for old and new host callers against each schema stage. Exercise a real claim and retry after refresh. Test both intended slice orders, or constrain the order explicitly. The final function preserves claim checks, idempotency, manual exception, payout fields and role guards. Application rollback alone must not be described as reversing migrations, deleted reset records, settled pots or cash already paid.

### R06 Resolve the feedback destination before enabling the invitation

**P1 | Required correction or owner decision | Product, connected journey and policy | Current live page and code confirmed.** References: 5.6, 9, 13; Management `src/app/(feedback)/feedback/page.tsx:31-36`.

The new screen invites more people into a journey that sends a positive sentiment to Google and a negative sentiment to a private form. The draft already recognises this, but defers it as other-repository work while still requiring the invitation. Google's policy prohibits selectively soliciting positive reviews. Linking indirectly does not remove that dependency. [Google contribution policy](https://support.google.com/contributionpolicy/answer/7400114).

**Smallest adequate action:** make a neutral destination a release condition for the review slide and phone button. The owner can approve changing the short-link destination to a verified neutral feedback/review route, authorise a focused management-page correction, or defer just the review invitation. Events can still ship. Use neutral invitation copy. A passive optional QR does not itself prove pressure on the premises; do not claim otherwise.

**Acceptance:** follow the approved destination through both positive and negative experiences and confirm the same opportunity for a public review, with no reward, required rating or pressure. Verify the short link through an authorised end-to-end check at release. Owner resolves before S4 release, not before unrelated implementation.

### R07 Make the rehearsal exercise the actual public routes

**P1 | Required correction | Acceptance and release | Direct contradiction in the specification.** References: 11 versus 5.4/5.8; `src/app/display/page.tsx:18`; session display page `:80`.

The rehearsal uses `is_test_session = true`, while /display and /play exclude test sessions. That fixture cannot exercise permanent-root discovery or the actual QR journey. A preview QR can also point at production when `NEXT_PUBLIC_SITE_URL` is set to the production origin. A preview frontend alone does not establish a separate database.

**Smallest adequate action:** identify an isolated preview database with eligible rehearsal fixtures, or a controlled rehearsal routing mechanism that preserves normal public test exclusion. Explicitly verify the QR origin and pot isolation. Existing production test-session guards should remain. Developer and owner arrange this before rehearsal.

**Acceptance:** start from the preview /display, scan its actual QR, confirm matching rehearsal data, then traverse idle, first game, claims, break, completion and next-session discovery. Rehearsal must neither change production money nor accidentally show a production session.

## Medium priority findings

### R08 Bind the late-ball undo and state the actual fairness rule

**P2 | Required correction and owner decision | Claims, ticket checking and UX | Confirmed specification gap; visibility counterexample executed.** References: 5.2/5.3, X12d, X17; `src/lib/reveal-queue.ts:79`; undo migration `20260825080606:224`.

The draft equates elapsed reveal delay with “the room had seen it”. That is not true during backlog or network delay. The helper returned `revealCount: 5, nextTickInMs: 1900` with ten server balls and the newest already 3.1 seconds old against a two-second reveal delay. Pausing subsequently snaps the display; it cannot establish what was visible when somebody shouted. The written last-ball rule and this exception also need one host explanation.

The missing_last_ball refusal writes nothing. An undo function receiving only game id has no durable proof of the authorised exceptional attempt. Existing undo changes the count but retains `last_call_at`, so “no verdict and recently called” can permit a second undo. This is a risk of a naive implementation, not a claim that the proposed SQL has already shipped.

**Smallest adequate action:** bind a single permitted undo to the attempt and exact ball/count, consume it once, retain the winner-on-ball refusal and preserve the original server-set pause time across retries. Recommend a server timing convention with explicit host discretion for a delayed screen, rather than adding TV acknowledgement infrastructure. The owner decides whether lateness follows the caller's announcement or screen timing; the specification must stop presenting inferred visibility as fact. X12d also needs a defined server-time sample and resynchronisation policy; keep reveal dwell on a monotonic local clock.

The check proves selected numbers were called and the count is right. It does not prove they form the required rows on one paper ticket. Retain host physical-ticket inspection and describe public validity accordingly; no digital ticket model is needed.

**Acceptance:** repeated and delayed undo removes only the authorised ball. Repeated pause preserves its timestamp. Test delay zero, exact boundary, disconnected/backlogged TV, phone behind TV and corrected client clock. After correction, an eligible claim can be recorded without a false late verdict. Developer resolves guards before S2; owner confirms the host rule before rehearsal.

### R09 Preserve coherent public state across competing updates

**P2 | Required correction | Reliability and public UX | Code-supported race, not browser-reproduced.** References: S0 X12b, S1 phases; TV `display-ui.tsx:195`, `:240`, `:392`; phone `player-ui.tsx:191`, `:236`, `:429`.

A poll started before a Realtime completion can overwrite the newer session phase when it returns late. Session snapshots lack the game state's freshness guard. A reconnect generation token protects channel ownership, not ordering of these snapshots. X12b also describes a TV-only repair for a game-name/state mismatch that exists on the phone path too.

**Smallest adequate action:** apply session, active game and game state coherently on both public screens. Invalidate outstanding reads after newer authoritative events or introduce a minimal persisted revision if needed. Define a timeout/recovery for polls that never return: the existing in-flight flag otherwise prevents later polls, which materially affects a TV intended to run unattended even though general polling hardening is deferred in section 13. Developer resolves in S0/S1 or explicitly accepts the remaining unattended-TV limitation before release.

**Acceptance:** delay an old poll past completion, reopen and game-switch notifications. Neither screen reverts or combines a new game name with old balls. A never-resolving read releases/replaces the in-flight operation and later recovery works without staff intervention.

### R10 Clarify event caching and the complete refresh budget

**P2 | Required clarification | Integration, cost and degraded operation | Specification conflict; proposed implementation not present.** References: 5.5, 8, 10; `src/lib/report-error.ts:96`.

The draft promises last-good data during failed revalidation, but the wrapper never throws and returns an error result. If that result is cached as a successful public-route response, it can replace good data. It also promises a five-second timeout without saying whether it covers just the list or all eight detail lookups. Sequential five-second detail failures can turn a supposedly quick fallback into a long load. Reporting an error can add a further sink wait.

A returned `qrUrl` depends on before/after phase, while the route names only session as its cache input. A phase refresh can receive the previous cached channel. Similarly, cached whenLabel can say Tomorrow after midnight although startsAt remains future. Query-key variants and separate preview/production caches mean the quoted quota calculation is a normal-use estimate, not a guaranteed ceiling.

**Smallest adequate action:** share one cached upstream public event projection, preserve its last successful result deliberately, and derive current labels and pre/post targets independently of stale phase responses. Alternatively make every output-affecting dimension explicit in the cache key. Bound the whole refresh, make detail failures fall back to UUID links independently, and do not cache a failure as a replacement success. Validate session input and avoid letting arbitrary query values create independent upstream fetches. No distributed job system is necessary.

**Acceptance:** prime a good cache, then inject list timeout/401/429/503 and individual detail failures; good upcoming data remains within the agreed stale policy or the explicit fallback appears promptly. Cross midnight and phase change during a warm cache. Multiple phones share list/detail cache work. Deleted/cancelled future events are removed within an explicitly stated freshness bound. Developer resolves before S4 implementation.

### R11 Reserve the next bingo event before limiting the carousel

**P2 | Required clarification | Product selection and supplier contract | Plausible future-data risk, not a current-feed defect.** References: 5.5; Management `src/app/api/events/route.ts:114-116`, `:133`.

The first 50 raw events can contain many occurrences of recurring events. Deduplication afterwards cannot recover a later bingo event that was never fetched. Limiting the final list to eight can also discard the promised next bingo night if it is flagged only afterwards. The specification does not define what happens if no bingo exists in its 60-day window.

**Smallest adequate action:** explicitly reserve the earliest eligible bingo occurrence before the general eight-card cap. Use bounded pagination within the existing 60-day query, or a separate cached category query where supported. Avoid fetching an unbounded catalogue. If no bingo exists within the agreed horizon, use the generic website fallback rather than an invented date. The current feed is small, so this is not an emergency.

**Acceptance:** over 50 occurrences, over eight distinct earlier events, repeat names, no next bingo, a cancelled next bingo and one just outside 60 days. The playlist includes the intended next bingo when eligible and does not duplicate it as a general card. Developer resolves before S4 acceptance.

### R12 Align session selection and follow-along links

**P2 | Unresolved product rule | Routing and multi-session UX | Confirmed contradiction in supported ambiguity.** References: 5.4, 5.8, 10.

/display lets staff select among several sessions, while /play prefers today's session. A TV displaying another eligible session still shows the universal /play QR and can send scanners to different numbers. Two sessions dated today have no defined preference. “One live session in practice” reduces likelihood, but does not resolve the explicitly supported multi-session case.

**Smallest adequate action:** keep the stable QR when resolution is unique; when staff choose among ambiguous sessions, preserve that displayed session in the link or apply one explicit selection rule everywhere. Document whether a future ready session should take over an ended night's screen immediately; readiness currently has no date restriction. Do not silently add scheduling rules to the business.

**Acceptance:** two eligible sessions with different dates, two dated today, a future ready session, no session and a read outage. Every displayed follow-along link leads to the same session as its TV. Owner confirms any business selection rule before S3; developer can choose the minimal matching-link mechanism.

### R13 Correct the fallback tracking promise

**P2 | Required documentation correction or owner acceptance | Analytics and website dependency | Live HEAD response and code confirmed.** References: 5.5; website `app/events/[id]/page.tsx:412-414`.

An existing UUID event URL with pre_event_screen campaign parameters returned HTTP 308 to its slug path without those parameters. The event remains accessible, but reporting parity is not achieved by constructing the specified fallback alone. The website redirect drops search parameters.

**Smallest adequate action:** accept and describe an accessible but untracked UUID fallback, or authorise preserving allowed campaign parameters in the website canonical redirect if attribution is essential. A verified slug target is another trade-off but makes a denser QR. Do not require automatic short-link generation just to ship a functioning carousel.

**Acceptance:** follow both real short-link channels and the fallback to the final destination, checking campaign parameters and the reported source. Developer documents the limitation before S4 acceptance; owner decides only if a cross-repository change is required.

### R14 Extend acceptance beyond font measurements

**P2 | Required acceptance refinement | Accessibility, shared components and operations | Confirmed coverage gaps; no rendered defect alleged.** References: 5.7, 11, Appendix B; `src/components/ui/modal.tsx:19`, `:99`.

Computed font floors do not prove that a 15-ball panel, text, recent calls and QR fit at 720p, or that phone controls survive text enlargement. Host screens are given size/button targets but the render script covers only TV and phone. Changing shared button/input sizes also affects admin forms. The existing modal already supplies labelled dialog semantics, focus trapping and focus restoration, so reuse and verify it rather than demanding another modal system.

**Smallest adequate action:** add clipping/overlap and visual inspection to the fixture script; cover host claim, winner and end-night modals plus representative admin forms, keyboard operation, phone text zoom and colour-blind marks. Treat 32px/44px as provisional rehearsal targets rather than proven room readability. Bound the claimed viewport support at 1280x720 unless the actual TV demonstrates a smaller supported size. Match the size floors to each viewport explicitly.

The blanket render failure on “£0” also rejects legitimate empty-history totals or a genuinely zero value. Check forbidden zero prizes in the relevant guest-prize context rather than failing any rendered zero amount. Conserve null versus zero semantics.

**Acceptance:** screenshots at the specified viewports show no clipping or QR obstruction, every required control is reachable, keyboard focus returns correctly, new result messages are understandable without colour, and enlarged phone text does not remove actions. Scan the longest fallback event QR and review QR from the actual back of the room, not merely the shorter preferred QR. Developer resolves before S5 acceptance; owner supplies the actual-TV rehearsal.

### R15 Make the legal and operational boundary explicit

**P2 | Required clarification and release check | Venue operations and legal copy | Published guidance reviewed; actual venue practice not assessed.** References: 5.3, 9, 13.

The adult and per-person/per-game stake wording addresses useful basics but cannot establish lawful venue operation. Current Commission guidance also requires return of stakes as prizes and prohibits profit/levies from the bingo. The code expects rules to be available before and during play. Proposed rules disappear from the phone during active calling and the TV rotates them only before play; a laminated card or persistent rules access is enough, and may already exist. [Exempt gaming guidance](https://www.gamblingcommission.gov.uk/licensees-and-businesses/guide/page/exempt-gaming-in-pubs), [equal chance gaming code, provisions 1.6 to 1.8 and 3.1](https://assets.ctfassets.net/j16ev64qyf6l/4EcCZvweEjcoJvRD7vCzO5/b29c18219a4a731b6842c93c00373e53/Code-of-practice-for-equal-chance-gaming-in-clubs-and-premises-with-an-alcohol-licence.pdf).

“£2,000 a week” needs an operational any-seven-days check, not a calendar-week assumption. The sources are not identical on licence escalation: current exempt-gaming guidance describes notification on an exceedance and licensing when it occurs more than once, while the toolkit summarises applying when intending to exceed the limit. The specification's immediate “needs a licence” statement should not silently choose between these summaries. [Commission toolkit](https://www.gamblingcommission.gov.uk/authorities/guide/pubs-and-clubs-toolkit).

**Smallest adequate action:** have the designated premises supervisor confirm the actual stake allocation, age checks, cash/no-credit process, prize/rollover treatment, access to rules and rolling-period monitoring. Refer any threshold/licensing uncertainty to the Commission or a suitably qualified adviser. Do not add player-identifying data, stake ledgers or remote participation to this app merely for this review. Keep phone copy clear that it follows paper play and does not permit online entry or claims. “Caller decides” should not remove the venue's existing dispute route.

**Acceptance:** the live-night runbook identifies the responsible person, the verified offline rules route and the limits-check process. The new copy agrees with the approved venue process. The app's historical prize total is not presented as total stakes, proof of cash paid or a complete compliance measure. Owner/DPS resolves before the first live night; development of screen clarity need not wait.

### R16 Qualify the claim trust boundary and manual exception

**P2 | Required clarification | Security and authorisation | Broad policy confirmed in production; proposed bypass inferred.** References: 5.2, 9, 13; live game-state UPDATE policy; `20260825080608:250`, `:290`.

Section 9 honestly notes staff can directly update private game state, but 5.2 states every recorded win is tied to a server-checked claim. A host can set the new claim_result field directly under that existing policy. The new field does not add a new staff role, but a check of that field alone is not an independent validation boundary. The manual exemption is also represented by a caller-supplied Boolean in the existing winner RPC.

**Smallest adequate action:** either scope the guarantee to the intended staff UI or revalidate stored numbers within recording and protect the proof fields. Explicitly require the manual exemption to be a genuine snowball Full House under the locked jackpot rules, rather than exempting any request bearing the flag. Retain cookie-client execution and authenticated role/controller checks. No need to widen RLS or close the whole security backlog in this slice.

**Acceptance:** anon, pending and non-controlling staff cannot use the new RPCs; a forged manual flag on a standard game cannot skip claim requirements; role revocation between check and record is enforced; retries of existing winner keys remain idempotent. If proof protection is selected, direct host writes cannot forge it. Developer resolves before S2 implementation; owner explicitly accepts any retained trusted-staff limitation.

### R17 Do not assume a successful hours response is complete

**P2 | Required clarification or owner scope decision | Integration and venue copy | Supplier code confirmed; outage outcome not executed.** References: X19; Management `src/app/api/business/hours/route.ts:26-30`, `:61-78`; website `lib/hours-utils.ts:105`.

The endpoint returns an effective regular week and separate special-date entries, rather than a single resolved kitchen window. More importantly, a failed special-hours query is caught and returned as an empty list while regular hours remain available. A successful HTTP response therefore cannot distinguish “no exception” from “exceptions unavailable”. The proposed instruction to hide unavailable kitchen information cannot be met reliably by HTTP-status checking alone. A closure could be replaced by regular opening copy.

**Smallest adequate action:** remove the unsupported kitchen line in this slice unless the source can provide a trustworthy date-specific completeness signal. If the owner wants dynamic hours, specify regular/special precedence, deliberate kitchen null, closure flags, split sittings and an unavailable outcome. Any supplier change requires separate owner authorisation. Do not use currentStatus to answer a future session-date query. Developer resolves the adapter contract before X19 implementation; owner decides whether that extra display is wanted before S4.

**Acceptance:** special closure, special opening on a normally closed day, split sittings, future effective version and special-hours query failure. The guest screen never substitutes regular opening copy for unknown exception data.

## Acceptance and recovery matrix

These extend section 11, rather than replace its useful helper, SQL and rendering tests. The required browser tests need real host action paths on isolated data; builds and snapshots alone cannot prove them.

| Journey or failure combination | Required observable outcome | Finding and verification |
|---|---|---|
| Pause, check, lose response, refresh, save and retry | Same attempt and one winner; current claim remains recoverable | R01, local DB plus browser fault injection |
| Record, advance, then retry the committed save | Existing winner returned even though claim was cleared | R01/R05, SQL and host flow |
| Missing-last-ball correction, repeated tap, then valid check | Exactly one permitted undo and an auditable current ball/count | R08, SQL plus host/TV flow |
| Eligible and ineligible Full House ties, then void | Exact ordinary and eligible jackpot shares, correct total | R04/R16, SQL and history screen |
| Start against end/reset/reopen | One coherent lifecycle outcome, no running game under a completed night | R02, two-connection SQL races |
| Complete, reset, poll-only load | Before-start loop; new first start set only by the first game | R03, DB plus public screens |
| Old poll returns after Realtime completion | New phase retained on TV and phone | R09, controlled delayed responses |
| One failed poll, then a hung read, then recovery | Useful screen, honest connection state, continuing retries | R09, browser injection |
| Primed event cache, API failure, midnight and phase change | Bounded response, agreed last-good behaviour, correct label/channel | R10, route and browser tests |
| Dense recurring events and absent short links | Next bingo reserved; fallback opens correct event | R11/R13, selection fixtures and redirect checks |
| Real preview root and QR, then next session | Matching isolated session on TV/phone without production money changes | R07/R12, rehearsal |
| Shared size changes and 720p claim/win states | Readable text and controls without clipping or QR obstruction | R14, screenshots and manual interaction |
| Completed snowball with failed settlement | Retry remains discoverable after navigating away or reloading; pot moves once | X6/R05, injected RPC failure and return-to-game check |

X6's banner is the right direction, but the release check must confirm that pending settlement remains discoverable after leaving the page. Section 13 already records controller lock/release and undo idempotency limitations; do not mark those closed merely because the new normal path passes. No new refusal ledger is required by this review.

## Decisions ownership and gates

The following register records decisions required by the affected slices. The user-facing questions belong in chat, not this file.

| Decision | Recommended position and trade-off | Owner | Gate |
|---|---|---|---|
| Claim lateness and delayed-screen discretion | Use an explicit host/caller rule with discretion when the display lagged. Avoid treating elapsed delay as proof of visibility. | Owner/host | S2 design and rehearsal |
| End-of-night feedback destination | Neutral verified destination, otherwise defer review invitation while retaining events. | Owner | S4 release |
| Jackpot component sharing | Preserve ordinary prize sharing; share jackpot only among eligible jackpot winners, subject to owner confirmation. | Owner | S6 design |
| Retained direct staff game-state writes | Narrow the UI-only guarantee or protect/revalidate claim proof; do not imply a guarantee the retained policy defeats. | Owner and developer | S2 design |
| Ambiguous session selection | Preserve the TV's selected session in its follow link; define any future-session takeover rule explicitly. | Owner for business rule, developer for link behaviour | S3 acceptance |
| Fallback scan attribution | Accept missing attribution unless reporting is important enough to authorise the small website redirect change. | Owner | S4 acceptance |
| Kitchen message scope | Remove the unsupported line; restore dynamic copy only with a complete date-specific source contract. | Owner | X19/S4 design |
| Preview and old-tab release strategy | Isolated rehearsal and an outside-play compatible release, with host refresh verified. | Owner and developer | Migration/release approval |

Developer choices such as hook extraction, caching primitive, fixture renderer and component organisation do not require separate owner approval. The owner has not approved implementation or production application in this request.

## Simplification and optional improvements

Keep publishing on Check Win. Live tap mirroring adds ordering and write traffic without improving the core correctness outcome. A generation token is sufficient for X1 if it guards every callback, invalidates old work before channel removal, clears the reference before removal and leaves one timer. Test synchronous CLOSED, delayed CLOSED, unmount and visibility changes. A shared hook is a reasonable developer choice, not an extra prerequisite for the design-system overhaul.

Reuse `src/lib/money.ts`, `src/lib/dates.ts`, the existing modal and wake-lock hook. A build validation module must actually be called from the build path; creating the file alone is insufficient. Validate the QR origin as an HTTPS origin rather than merely non-empty, and distinguish production versus isolated preview. Per-slice required configuration is a good choice, provided S0's new prerequisites are added before its release.

Removing unverified kitchen copy is simpler than an additional hours display. If X19 remains, use the already-public date-resolved hours endpoint, respect kitchen null/closed and split service periods, suppress on failure and after the relevant window. It does not need an extra events-key scope. Do not invent a kitchen closing time from session date or regular hours. The specification labels this as an owner choice; confirm the chosen outcome with the owner before adding that UI.

R17 limits that option: the supplier currently hides failed exception lookups, so a public HTTP 200 is insufficient evidence that the window is complete.

**O01, P3 optional:** a custom bingo domain can shorten codes and improve recognisability. It is not needed for this build. **O02, P3 optional:** automatic management screen links can improve scan tracking and QR density later; the existing fallback supports delivery. Neither should delay the claims/lifecycle corrections.

Success can be recognised without new tracking: at rehearsal the host completes a claim without duplicate saving, a room member reads and scans from the back, and staff leave the TV on its stable route through a whole night and a later session. Use existing short-link reports only where attribution survives. No numerical claim-check target is agreed; record a baseline and let the host decide whether the revised flow is practical.

The error sink is optional in existing code. Its presence in prose does not prove alerts reach someone. Before release, verify a redacted synthetic failure reaches the configured destination and identify who responds, or document the existing server-log review process. Do not silently introduce another paid monitoring service or send real messages as part of this review.

## Coverage and remaining limits

| Area | Coverage and conclusion |
|---|---|
| Product and staff/public journeys | Reviewed. Good overall scope; claim recovery, session ambiguity and downstream feedback need the listed corrections. |
| Data, lifecycle, migration and money | Reviewed against relevant code and selected live metadata. Reset, concurrency, jackpot consumers and compatibility are material findings. |
| Security and privacy | Role boundaries, cookie clients, anonymous winners, public projection, direct-write limitations and key isolation reviewed. No new player identification is required. No penetration test or compliance certification. |
| Integrations, asynchronous behaviour, cost | Supplier routes, query ordering, link channels and public redirect checked. Authenticated payload and real quota/cold-cache behaviour remain to verify in S4. |
| Accessibility and device UX | Existing modal semantics and proposed contrast/size improvements reviewed. Actual browser layout, assistive technology and TV scan distance are unassessed until implementation/rehearsal. |
| Reliability and operation | Retry paths, polling/Realtime interactions, settlement recovery, wake lock and long-lived TV routing reviewed. Actual TV/browser capability and overnight endurance unverified. |
| Legal/policy | Official Commission and Google sources checked. Venue licences, stake accounting, physical procedures and historic payments not assessed. |
| Search, metadata and conversion | Public event destination and canonical redirect traced. These app routes are operational views, with no demonstrated need for an SEO overhaul. Decide normal indexing treatment during route work; no material standalone SEO blocker found. |
| Emails, SMS, payments, uploads, AI and new jobs | No change proposed. No AI-enabled feature or new communication send is applicable. Existing event publishing and link generation are upstream dependencies only. |
| Historical, in-progress and future work | Backfill limits, reset, old tabs, interrupted claims, reopened games, future sessions, repeated events and cancellation considered. Historic jackpot reconstruction needs an explicit evidence policy. |
| Licensing and handover | No new third-party package is required by the draft. Existing suppliers remain. Key revocation, short-link ownership, runbook and monitoring handover need release evidence. |

## Readiness and recommended next steps

**Specification readiness: Not ready for the affected implementation.** Resolve R01 to R05 before committing to the S1/S2/S6 designs. S0 is **Ready with specified conditions**: implement its bounded reliability fixes, cover the phone as well as TV for shared behaviour, define X12d's clock source, verify X21 is executed by the build, and set its configuration before release. The stage-retry fix must retain its captured expectation through ambiguous responses. No later claims migration is needed for that work.

S3/S4 and the incremental readability approach are **Ready with specified conditions**: coherent lifecycle foundation, matching QR resolution, explicit cache/selection contracts, a neutral feedback release decision and a usable rehearsal environment. Rules can proceed once venue facts are approved. The general styling overhaul, full security backlog and automatic short-link generation remain separate.

**Production readiness: Insufficient evidence to assess readiness.** There is no implementation of this draft to certify. The new code must pass the specified checks plus the fault/concurrency journeys above, then the actual-TV rehearsal. Production migration application still requires the owner's explicit yes. M1, M2 and M3 are proposed slices, not created or applied migrations.

Amend only the affected requirements and release gates, confirm the owner decisions in chat, then prepare the implementation plan. Maintain compatible migration order and a specific recovery procedure. At release, demonstrate the exact host/public journeys, confirm the intended deployment and schema, refresh old host tabs and check settlement/monitoring evidence. Do not claim success from a passing build alone.

This final challenge pass retained only changes that can still defeat the stated outcome if the draft is implemented competently as written: lost attempt identity, competing transitions, stale derived state, incomplete money consumers, external gating, cached phase/labels, selection truncation and an unusable rehearsal. It did not convert every deferred backlog item into this delivery.

**Done** - Separate developer review delivered, local only. The supplied specification, implementation files and live data were not modified. No migration was created or applied.

**Next:** Resolve the listed specification conditions and owner decisions before implementation approval.
