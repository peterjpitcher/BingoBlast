# QA Test Matrix — OJ-CashBingo

| TC | Area | Description | Result | Defect |
|----|------|-------------|--------|--------|
| TC-A01 | Session | Create session → status='ready' | PASS | — |
| TC-A02 | Session | Start first game → session='running', active_game_id set | PASS | — |
| TC-A03 | Session | End session → status='completed', player sees thank-you | PASS | — |
| TC-A04 | Session | Host modifies session structure → rejected server-side | UNKNOWN | QA-06 |
| TC-A05 | Session | Test session → snowball pot NOT updated | PASS | QA-11 (admin caveat) |
| TC-B01 | Number Calling | Call when not_started → rejected | PASS | — |
| TC-B02 | Number Calling | Call during break → rejected | PASS | — |
| TC-B03 | Number Calling | Call during paused_for_validation → rejected | PASS | — |
| TC-B04 | Number Calling | Call during display sync cooldown → rejected | PASS | — |
| TC-B05 | Number Calling | Same number twice → prevented | FAIL | QA-04 (race condition) |
| TC-B06 | Number Calling | Call 90th number → tracked correctly | PASS | — |
| TC-B07 | Number Calling | Void last number → removed, count decremented | PASS | — |
| TC-B08 | Number Calling | Void when no numbers called → rejected | PASS | — |
| TC-C01 | Claim Validation | Line: 5 valid numbers including last called → valid | PASS | — |
| TC-C02 | Claim Validation | Number not in calledNumbers → invalid | PASS | — |
| TC-C03 | Claim Validation | Last called number NOT in claim → invalid | UNKNOWN | QA-02 (verify) |
| TC-C04 | Claim Validation | Line: 4 numbers → invalid (wrong count) | PASS | — |
| TC-C05 | Claim Validation | Two Lines: 10 numbers, valid → valid | PASS | — |
| TC-C06 | Claim Validation | Two Lines: 9 numbers → invalid | PASS | — |
| TC-C07 | Claim Validation | Full House: 15 numbers, valid → valid | PASS | — |
| TC-C08 | Claim Validation | Full House: 14 numbers → invalid | PASS | — |
| TC-C09 | Claim Validation | Claim during break → no explicit block | UNKNOWN | — |
| TC-C10 | Claim Validation | Wrong stage claim → stage check in place? | UNKNOWN | — |
| TC-D01 | Winner Recording | Record Line winner → winner inserted, stage advances | PASS | — |
| TC-D02 | Winner Recording | Record Full House on standard game → completed | PASS | — |
| TC-D03 | Winner Recording | Snowball FH within max_calls → jackpot won, pot resets | FAIL | QA-01, QA-08 |
| TC-D04 | Winner Recording | Snowball FH beyond max_calls → rollover, no jackpot | FAIL | QA-01, QA-08 |
| TC-D05 | Winner Recording | snowball_eligible=false → no jackpot | PASS | — |
| TC-D06 | Winner Recording | Test session snowball → pot NOT updated | PASS | — |
| TC-D07 | Winner Recording | Empty winner name → accepted without error | FAIL | QA-05 |
| TC-D08 | Winner Recording | Null prize description → accepted silently | FAIL | QA-05 |
| TC-D09 | Winner Recording | Two simultaneous winner records → both inserted | UNKNOWN | — |
| TC-E01 | Stage Progression | advanceToNextStage on Line → moves to Two Lines | PASS | — |
| TC-E02 | Stage Progression | Last stage → game status=completed | PASS | — |
| TC-E03 | Stage Progression | Advance completed game → rejected | FAIL | QA-07 |
| TC-E04 | Stage Progression | skipStage → same as advanceToNextStage | PASS | — |
| TC-E05 | Stage Progression | Stage sequence respected per game type | PASS | — |
| TC-F01 | Snowball Pot | Rollover increments correctly | PASS | — |
| TC-F02 | Snowball Pot | Reset on jackpot win → base values, last_awarded_at | PASS | — |
| TC-F03 | Snowball Pot | Admin manual adjustment → logged in history | PASS | — |
| TC-F04 | Snowball Pot | Reset to base → all values revert | PASS | — |
| TC-F05 | Snowball Pot | max_calls_increment=0 → no call change | PASS | — |
| TC-F06 | Snowball Pot | Two successive rollovers → each adds increments | FAIL | QA-08 (double update) |
| TC-G01 | Player/Display | Player loads valid session → sees game state | PASS | — |
| TC-G02 | Player/Display | Player loads invalid session ID → 404 | PASS | — |
| TC-G03 | Player/Display | Display loads → sees game + QR code | PASS | — |
| TC-G04 | Player/Display | Game advances → player/display updates | PASS | QA-10 (5s lag) |
| TC-G05 | Player/Display | Session completes → player sees thank-you | PASS | — |
| TC-G06 | Player/Display | Player during break → shows break state | PASS | — |
| TC-H01 | Controller | Host takes control → can call numbers | PASS | — |
| TC-H02 | Controller | Heartbeat expires → another host can take control | FAIL | QA-09 (old host can reclaim) |
| TC-H03 | Controller | Two hosts take control simultaneously → one wins | FAIL | TA-04 (race condition) |
| TC-H04 | Controller | Heartbeat on completed game → no error | UNKNOWN | — |
| TC-I01 | Auth | Unauthenticated → /admin redirected to /login | PASS | — |
| TC-I02 | Auth | Host role → /admin redirected to /host | PASS | — |
| TC-I03 | Auth | Unauthenticated → /host redirected to /login | PASS | — |
| TC-I04 | Auth | Player → /player/[id] accessible, no auth | PASS | — |
| TC-I05 | Auth | Display → /display/[id] accessible, no auth | PASS | — |
| TC-I06 | Auth | Host calls admin-only server action → rejected | UNKNOWN | QA-06 |
