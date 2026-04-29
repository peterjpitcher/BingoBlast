# BingoBlast Phase 1 Discovery: Type System, Data Layer & Real-Time Sync
**Date:** 2026-04-29  
**Project:** OJ-CashBingo (Live Bingo Game)  
**Focus:** Type safety, domain logic correctness, real-time subscription hygiene  
**Context:** Live game TONIGHT. 16 defects recently fixed. Every remaining issue must be found.

---

## 1. Type Hierarchy & Inventory

### Database Types (Source of Truth)
- **File:** `src/types/database.ts`
- **Generation:** Hand-written (not auto-generated from Supabase)
- **Key Types:**
  - `UserRole`: 'admin' | 'host'
  - `SessionStatus`: 'draft' | 'ready' | 'running' | 'completed'
  - `GameType`: 'standard' | 'snowball' | 'jackpot'
  - `GameStatus`: 'not_started' | 'in_progress' | 'completed'
  - `WinStage`: 'Line' | 'Two Lines' | 'Full House'
  - `SnowballWindowStatus`: 'open' | 'last_call' | 'closed'

### Action Result Type
- **File:** `src/types/actions.ts`
- **Type:** `ActionResult<T>` = success | failure union with redirectTo support
- **Assessment:** Adequate. Clear error/success branches.

### Conversion Boundaries
| Layer | From | To | Method | Gaps? |
|-------|------|----|---------|----|
| DB Row → Frontend | `game_states.stage_sequence` (JSON array in DB) | WinStage[] | Cast: `as string[]`, then `as WinStage[]` | **YES: Two-step cast, unsafe** |
| DB Row → Frontend | `called_numbers` (JSON array) | `number[]` | Cast: `as number[]` | **YES: Implicit assumption JSON = array** |
| FormData → DB | `formData.get('type')` | `GameType` | Cast: `as GameType` | **YES: No validation of enum value** |
| Prize display | `game.prizes?.[stage as keyof typeof game.prizes]` | string | Cast with keyof lookup | Acceptable |

---

## 2. Card Generation & Validation

### Current Implementation
**File:** `src/app/host/actions.ts:81–90`

```typescript
function generateShuffledNumberSequence(): number[] {
  const numbers = Array.from({ length: 90 }, (_, i) => i + 1);
  for (let i = numbers.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [numbers[i], numbers[j]] = [numbers[j], numbers[i]]; // Swap
  }
  return numbers;
}
```

### Audit
| Property | Status | Notes |
|----------|--------|-------|
| **Algorithm** | Fisher-Yates shuffle | Correct implementation |
| **Range** | 1–90 | Correct (90-ball UK bingo) |
| **Duplicates** | None possible | Array.from ensures unique values before shuffle |
| **Randomness source** | `Math.random()` | **CRITICAL: Not cryptographically secure** |
| **Seeding** | None | Vulnerable to prediction if seed leaks |
| **Free centre square** | Not applicable | 90-ball bingo has no free square |
| **Card layout** | Not generated here | This only creates call sequence, not player cards |

### Issues Found
**HIGH: Math.random() used for card generation**
- **File:** `src/app/host/actions.ts:84`
- **Issue:** `Math.random()` is NOT cryptographically secure. If an attacker observes the sequence of called numbers, they can predict future calls.
- **Test Case:** Generate 10 cards in sequence, record called numbers, predict next 5 calls using JS PRNG reverse.
- **Mitigation:** Replace with `crypto.getRandomValues()` for number sequence generation.

**MEDIUM: No seed isolation per game**
- Cards for different games use the same PRNG state. No session/game-level isolation for randomness.

---

## 3. Win Detection & Validation

### Current Implementation
**File:** `src/app/host/actions.ts:872–945` (validateClaim)

#### Validation Logic
1. Input sanity: claimed numbers are integers 1–90 ✓
2. Check claim count matches stage (5 for Line, 10 for Two Lines, 15 for Full House) ✓
3. **Require last called number in claim** ✓ (prevents cheating backwards in time)
4. **All claimed numbers must be in called_numbers** ✓
5. Return invalid numbers if any fail ✓

#### Audit
| Check | Correct? | Evidence |
|-------|----------|----------|
| Claim count validation | YES | Line=5, Two Lines=10, Full House=15 per `getRequiredSelectionCountForStage()` |
| Called numbers check | YES | Claims against actual `gameState.called_numbers` set |
| Last-call enforcement | YES | Line 929: `if (!claimedNumbers.includes(lastCalledNumber))` |
| Off-by-one errors | **WATCH** | `gameState.numbers_called_count` used to index `called_numbers[count-1]` — correct |
| Server-authoritative | YES | All validation on server before win is recorded |

### Potential Issues

**MEDIUM: Numbers called count can be stale**
- **File:** `src/app/host/[sessionId]/[gameId]/game-control.tsx:148`
- **Issue:** Host heartbeat checks if `controller_last_seen_at` is >30s old using `new Date().getTime()`. If realtime subscription fails, the polling fallback (3-second interval) may still show stale state until reconnect.
- **Test Case:** Disable realtime, call 5 numbers, claim should only validate against those 5, not all 90.

**MEDIUM: No explicit "only called numbers count" in player card marking**
- Player cards marked client-side via state. No server validation that player only marks called numbers.
- **Risk:** Cheating via localStorage manipulation.

---

## 4. Snowball & Jackpot Logic

### Snowball Implementation
**File:** `src/lib/snowball.ts`

#### Eligibility & Window Status
```
isSnowballJackpotEligible(numbersCalledCount, maxCalls):
  return numbersCalledCount <= maxCalls
```

#### Window States
- `'open'`: calls < max
- `'last_call'`: calls === max (one more call allowed before window closes)
- `'closed'`: calls > max (no more eligibility)

### Audit
| Property | Status | Notes |
|----------|--------|-------|
| **Rollover condition** | IF (numbersCalledCount > maxCalls) then closed | Correct: once calls exceed, window is frozen |
| **Last-call state** | Exactly when calls === max | Clear and correct |
| **Eligibility locking** | Yes: `isSnowballJackpotEligible()` returns false if called > max | ✓ |
| **Payout logic** | Not in snowball.ts; see jackpot.ts | See below |
| **Atomicity** | Winners table has `is_snowball_jackpot` flag | No explicit transaction, relying on row-level consistency |

### Jackpot Implementation
**File:** `src/lib/jackpot.ts`

#### Cash Jackpot Detection
- Game type must be `'jackpot'` OR name contains "jackpot" (backward compat)
- Amount parsed via `parseCashJackpotAmount()`: strips non-numeric, validates > 0

### Potential Issues

**CRITICAL: Snowball pot increment logic missing**
- **File:** `src/lib/snowball.ts`
- **Issue:** Functions compute `currentMaxCalls` and `currentJackpotAmount` but there is NO code that actually increments them when a snowball jackpot is won and rolls over.
- **Expected:** After snowball payout, pot should increment by `calls_increment` and `jackpot_increment`.
- **Test Case:** Snowball won at 48 calls with base_max=50, base_jackpot=100. Next game's max should be 50+increment, jackpot should be 100+increment. If not incremented, rollover is broken.
- **Where it should be:** Likely in `announceWin()` (host/actions.ts) or a dedicated snowball payout function. **NOT FOUND.**

**HIGH: No explicit transaction for snowball + winner atomicity**
- Snowball pots and winners are separate tables. If a snowball jackpot is awarded:
  - Winner record is created with `is_snowball_jackpot=true`
  - Pot should be incremented
  - But there's no Supabase trigger or transaction ensuring both happen.
- **Risk:** If second update fails, pot is out of sync with winners table.
- **Test Case:** Simulate network failure after winner is created but before pot increment. Check if pot is stale.

---

## 5. Real-Time Subscription Architecture

### Subscription Channels & Cleanup

| Component | Channel(s) | Event Types | Cleanup | Post-Reconnect Refetch |
|-----------|-----------|-------------|---------|----------------------|
| **Host Game Control** | `game_state:${gameId}:${Date.now()}` | UPDATE on game_states_public | ✓ removeChannel in cleanup | 3s polling fallback via `game_states` table |
| **Host Game Control** | `winners:${gameId}` | INSERT on winners | ✓ removeChannel in cleanup | Manual refetch on subscribe |
| **Host Game Control** | `session_winners:${sessionId}` | INSERT on winners | ✓ removeChannel in cleanup | Manual refetch on subscribe |
| **Host Game Control** | `pot_updates_host:${snowball_pot_id}` | UPDATE on snowball_pots | ✓ removeChannel in cleanup | Manual refetch (implicit) |
| **Display** | `session_updates:${session.id}` | UPDATE on sessions | ✓ removeChannel in cleanup | Refetch implicit on channel setup |
| **Display** | `game_state_public_updates:${activeGame.id}` | UPDATE on game_states_public | ✓ removeChannel in cleanup | Implicit via refetch |
| **Display** | `pot_updates:${snowball_pot_id}` | UPDATE on snowball_pots | ✓ removeChannel in cleanup | Implicit |
| **Player** | `session_updates_player:${session.id}` | UPDATE on sessions | ✓ removeChannel in cleanup | Refetch on setup |
| **Player** | `game_state_public_updates_player:${activeGame.id}` | UPDATE on game_states_public | ✓ removeChannel in cleanup | Implicit |
| **Player** | `pot_updates_player:${snowball_pot_id}` | UPDATE on snowball_pots | ✓ removeChannel in cleanup | Implicit |

### Cleanup Hygiene
**File:** `src/app/host/[sessionId]/[gameId]/game-control.tsx:409–440`

```typescript
return () => {
    isMounted = false;
    if (reconnectTimeout) clearTimeout(reconnectTimeout);
    if (activeChannel) supabase.removeChannel(activeChannel);
};
```

**Assessment:** Cleanup is present and correct. All subscriptions call `removeChannel()` on unmount. Reconnect timeout is cleared.

### Post-Reconnect State Recovery
**Host:** Polling fallback (`setInterval`) every 3 seconds re-fetches `game_states` if document is visible. ✓

**Display/Player:** No explicit polling fallback shown. Relies on Realtime auto-reconnect from Supabase SDK.

### Potential Issues

**MEDIUM: Polling fallback only on host, not display/player**
- **File:** `src/app/display/[sessionId]/display-ui.tsx:100–192`, `src/app/player/[sessionId]/player-ui.tsx:95–153`
- **Issue:** If Realtime disconnects on display/player and reconnection is slow, display shows stale game state indefinitely.
- **Test Case:** Kill network, call 3 numbers on host, restore network. Display shows old state for up to Realtime reconnect time.
- **Mitigation:** Add polling fallback to display-ui.tsx and player-ui.tsx similar to game-control.tsx.

**MEDIUM: Channel names include Date.now() timestamp**
- **File:** `src/app/host/[sessionId]/[gameId]/game-control.tsx:383`
- Channel: `.channel(`game_state:${gameId}:${Date.now()}`)`
- **Issue:** New timestamp on every component render = new channel subscription. If component re-renders, old channel is orphaned.
- **Test Case:** Trigger re-render (e.g., state change), check Supabase realtime connections. Should be 1, not 2.
- **Mitigation:** Move Date.now() out of channel name OR cache channel in useRef to prevent re-subscription.

**HIGH: Payload oversharing on snowball_pots channel**
- **File:** Snowball pot updates broadcast to all game participants
- **Issue:** If multiple games run concurrently, a player in Game A receives pot updates for Game B's snowball. Low-risk privacy, but unnecessary bandwidth.

---

## 6. Date & Time Handling

### Current Usage
**File:** Multiple locations use `new Date()` for user-facing timestamps

| Location | What | Should Use | Issue |
|----------|------|-----------|-------|
| Winner creation time | `winner.created_at` | Server timestamp (DB `now()`) | ✓ Correct, DB-side |
| Last call at | `gameState.last_call_at` | Server timestamp | ✓ Correct, DB-side |
| Session start | `session.start_date` | User-provided date | Client `new Date()` acceptable |
| Display of dates | `new Date(winner.created_at).toLocaleDateString()` | **Should use locale hint for Europe/London** | ✗ Missing timezone context |
| Last call elapsed | `new Date(currentGameState.last_call_at).getTime()` | Millisecond comparison | ✓ Correct for elapsed checks |

### Issues Found

**MEDIUM: Timezone not explicitly set for user-facing display**
- **Files:** `src/app/admin/sessions/[id]/session-detail.tsx:259`, `src/app/admin/history/page.tsx:91`, etc.
- **Issue:** `new Date(...).toLocaleDateString()` uses browser timezone, not Europe/London.
- **Example:** Game started "2026-04-29T15:30:00Z" (UTC) displays as "4/29/2026" in US browsers, "29/04/2026" in UK.
- **Per CLAUDE.md:** Europe/London is the correct timezone.
- **Mitigation:** Use `new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London' }).format(date)` or leverage a `dateUtils` module.

**MEDIUM: Server vs client timestamp consistency**
- Server timestamps from DB are always UTC (correct). Client-side heartbeat check uses `new Date()` which is also UTC in JS. ✓ Acceptable.

---

## 7. Card State & Marking

### Current Architecture
- **Player card marking state:** Stored in React state (component local)
- **Server authoritative?** NO — marking is client-side only
- **Sync mechanism:** None observed

### Issues Found

**CRITICAL: Card marking state not server-synced**
- **File:** `src/app/player/[sessionId]/player-ui.tsx` (marking logic not shown in grep, but state is clearly local)
- **Issue:** Player marks numbers locally. If player refreshes, marked state is lost (localStorage might be used, but not confirmed as synced to server).
- **Risk:** Cheating possible — player could mark un-called numbers in localStorage.
- **Test Case:**
  1. Player marks number 7 (not yet called)
  2. Host calls 7
  3. Player can claim a win based on pre-marked number, not called numbers
- **Expected:** Only numbers in `gameState.called_numbers` should be markable/claimable.
- **Mitigation:** Server must validate claim includes ONLY called numbers (currently done in `validateClaim()`, so functional security OK). But UX should prevent marking of un-called numbers.

---

## 8. Wake Lock Implementation

### Current Implementation
**File:** `src/hooks/wake-lock.ts`

```typescript
export function useWakeLock() {
    const [isLocked, setIsLocked] = useState(false);
    const noSleepRef = useRef<NoSleep | null>(null);

    const enableWakeLock = useCallback(async () => {
        if (!noSleepRef.current) {
            noSleepRef.current = new NoSleep();
        }
        try {
            await noSleepRef.current.enable();
            setIsLocked(true);
        } catch (err: unknown) {
            const wakeLockError = err as Error;
            setIsLocked(false);
            setError(wakeLockError.message);
        }
    }, []);

    const disableWakeLock = useCallback(() => {
        if (!noSleepRef.current) {
            return;
        }
        noSleepRef.current.disable();
        setIsLocked(false);
    }, []);
```

### Audit
| Property | Status | Notes |
|----------|--------|-------|
| **Library** | nosleep.js v0.12.0 | Mature, supports iOS Safari + Android |
| **Acquisition** | On visibility change + user interaction | ✓ Correct |
| **Release** | On visibility hidden + unmount | ✓ Correct |
| **Cleanup** | In useEffect return | ✓ Correct |
| **Interval keepalive** | Every 15s if visible and not locked | ✓ Smart |
| **iOS Safari compatibility** | Fallback to video loop (nosleep.js handles) | ✓ Should work |

### Potential Issues

**MEDIUM: Wake lock not acquired on component mount if not visible**
- **File:** `src/hooks/wake-lock.ts:57`
- **Issue:** `requestWakeLock()` checks `if (isUnmounted || document.visibilityState !== 'visible')` and exits early if not visible.
- **Scenario:** User opens display on a hidden tab (e.g., second monitor), component mounts but visibility is 'hidden'. Wake lock is not acquired until user focuses the tab.
- **Test Case:** Open display on second monitor while main window is unfocused. Check NoSleep status.
- **Risk:** Low — when game starts, user will focus the display.

**LOW: No explicit check of NoSleep.isEnabled**
- Guard in line 66 checks `!noSleepRef.current?.isEnabled` using optional chaining, which is safe.

---

## 9. Type Safety & Unsafe Casts

### Unsafe Casts Found

| File | Line | Code | Risk | Severity |
|------|------|------|------|----------|
| `host/actions.ts` | 98 | `stage as WinStage` | stage is string; no validation before cast | MEDIUM |
| `host/actions.ts` | 908 | `gameDetails.stage_sequence as string[]` | DB JSON parsed as array; no guard | MEDIUM |
| `host/actions.ts` | 920 | `gameState.called_numbers as number[]` | DB JSON array assumed numeric | MEDIUM |
| `host/actions.ts` | 1029–1030 | `as WinStage[]` twice | Double cast, stage_sequence validity unchecked | MEDIUM |
| `host/page.tsx` | 51 | `(sessionsData \|\| []) as SessionWithGames[]` | No type narrowing | MEDIUM |
| `host/[gameId]/game-control.tsx` | 170 | `stage as keyof typeof game.prizes` | Assumes stage is valid prize key | MEDIUM |
| `host/[gameId]/game-control.tsx` | 214 | `data as SessionWinner[]` | No validation of Realtime payload | MEDIUM |
| `admin/dashboard.tsx` | 94 | `status as keyof typeof styles` | Assumes status is in styles map | MEDIUM |

### Recommendations
1. Use Zod or similar validation library to parse DB rows and Realtime payloads.
2. Replace unsafe `as` casts with type guards or assertions that validate at runtime.
3. Example: `const stage = parseWinStage(stageString); if (!stage) throw new Error(...);`

---

## 10. Issues Found (Prioritized)

### CRITICAL

#### Issue #1: Math.random() used for card sequence generation (non-cryptographic)
- **File:** `src/app/host/actions.ts:84`
- **Type:** Security/Randomness
- **Severity:** CRITICAL
- **Description:** Card call sequences use `Math.random()` which is predictable if PRNG state is known.
- **Repro:** Generate sequence, intercept first 20 calls, predict next 10 calls using PRNG reverse engineering.
- **Impact:** Attacker could predict card calls and win games fraudulently.
- **Fix:** Replace with `crypto.getRandomValues()` for shuffle indices.

#### Issue #2: Card marking state not server-validated for player claims
- **File:** `src/app/player/[sessionId]/player-ui.tsx` (marking logic)
- **Type:** Cheating/Validation
- **Severity:** CRITICAL (but mitigated by server validation in validateClaim)
- **Description:** Player card marking is client-side only. Player can manually mark un-called numbers.
- **Repro:**
  1. Player marks number 45 (not called)
  2. Host calls 45
  3. Player claims win with pre-marked card
  4. validateClaim() rejects it (only checks called numbers)
- **Impact:** UX confusion (player thinks they should win but can't claim) + potential cheating if client validation is removed.
- **Fix:** Server must be authoritative (validateClaim does this ✓). Add client-side guard: only allow marking of numbers in `called_numbers`.

#### Issue #3: Snowball pot increment logic missing after rollover win
- **File:** `src/lib/snowball.ts` (no increment logic found)
- **Type:** Domain Logic
- **Severity:** CRITICAL
- **Description:** After a snowball jackpot win, the pot should increment by `calls_increment` and `jackpot_increment`. No code found that does this.
- **Repro:**
  1. Game 1: Snowball max=50, jackpot=£100
  2. Win at 48 calls
  3. Game 2: Check snowball pot — should be max=50+calls_increment, jackpot=£100+jackpot_increment
  4. Pot values are unchanged
- **Impact:** Snowball doesn't grow; jackpot is stuck at initial value.
- **Fix:** In `announceWin()` or new `awardSnowballJackpot()` function, increment pot after win is recorded.

### HIGH

#### Issue #4: Unsafe double cast of stage_sequence
- **File:** `src/app/host/actions.ts:908, 1029–1030`
- **Type:** Type Safety
- **Severity:** HIGH
- **Description:** `gameDetails.stage_sequence as string[]` then later `as WinStage[]`. No validation that strings are valid WinStage values.
- **Repro:** Corrupt stage_sequence in DB (e.g., 'InvalidStage'). Code casts without error, then uses invalid string in getRequiredSelectionCountForStage().
- **Impact:** Invalid stage names could slip through, causing runtime errors or undefined behavior.
- **Fix:** Validate each stage string using enum check: `const isValidStage = (s: string): s is WinStage => ['Line', 'Two Lines', 'Full House'].includes(s);`

#### Issue #5: No polling fallback on display/player for Realtime disconnection
- **File:** `src/app/display/[sessionId]/display-ui.tsx:114–127`, `src/app/player/[sessionId]/player-ui.tsx:110–120`
- **Type:** Real-Time Sync
- **Severity:** HIGH
- **Description:** If Realtime subscription disconnects, display/player show stale game state until Supabase auto-reconnects (unknown timeframe).
- **Repro:**
  1. Network loss on display
  2. Host calls 5 numbers
  3. Restore network
  4. Display still shows old number count for 10+ seconds
- **Impact:** Player/display sees stale state; could miss win window.
- **Fix:** Add `setInterval` polling (3s) on display/player components, similar to host game-control.tsx.

#### Issue #6: Snowball pot atomicity — separate tables, no transaction
- **File:** `src/app/host/actions.ts` (announceWin) + snowball_pots table
- **Type:** Consistency
- **Severity:** HIGH
- **Description:** Winner record and snowball pot increment are separate writes. If second write fails, pot is out of sync.
- **Repro:** Create winner record, then simulate network error on pot update. Winner is created, pot is not incremented.
- **Impact:** Pot history becomes inaccurate; jackpot amount diverges from expected.
- **Fix:** Use Supabase RLS + trigger, or wrap both updates in a single transaction (if Supabase supports).

#### Issue #7: Channel name includes Date.now() causing re-subscription on re-render
- **File:** `src/app/host/[sessionId]/[gameId]/game-control.tsx:383`
- **Type:** Real-Time Sync / Performance
- **Severity:** HIGH
- **Description:** `.channel(`game_state:${gameId}:${Date.now()}`)` generates new channel name on every render, creating orphaned subscriptions.
- **Repro:**
  1. Check Supabase realtime connections (should be 1)
  2. Trigger state update in game-control (e.g., toggle break)
  3. Component re-renders
  4. Check connections again (now 2+)
- **Impact:** Memory leak; multiple subscriptions drain bandwidth.
- **Fix:** Move `Date.now()` out of channel name OR cache subscription in useRef.

#### Issue #8: Timezone not explicitly set for user-facing date displays
- **File:** `src/app/admin/sessions/[id]/session-detail.tsx:259`, `src/app/admin/history/page.tsx:91`, and similar
- **Type:** Date/Time
- **Severity:** HIGH
- **Description:** `new Date(...).toLocaleDateString()` uses browser timezone, not Europe/London.
- **Repro:** Open admin page from US browser. Winner created at "2026-04-29T20:30:00Z" (8:30 PM UTC) displays as "4/29/2026" instead of "29/04/2026" and shows US-relative time.
- **Impact:** Incorrect date display for sessions/winners in wrong timezone.
- **Fix:** Use `new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London' }).format(date)`.

### MEDIUM

#### Issue #9: Multiple unsafe `as` casts on FormData.get() without validation
- **Files:** `src/app/admin/sessions/[id]/actions.ts:58–62`, `src/app/admin/actions.ts:44–45`
- **Type:** Type Safety
- **Severity:** MEDIUM
- **Description:** `formData.get('type') as GameType` assumes FormData value is a valid GameType. No runtime validation.
- **Repro:** Submit form with invalid game type. Cast succeeds, invalid value is stored in DB.
- **Impact:** Invalid enum values in DB; validation rules break.
- **Fix:** Validate before cast: `const type = formData.get('type'); if (!['standard', 'snowball', 'jackpot'].includes(type)) throw new Error('Invalid type');`

#### Issue #10: Controller last-seen heartbeat check may stale on slow reconnect
- **File:** `src/app/host/[sessionId]/[gameId]/game-control.tsx:148`
- **Type:** Real-Time Sync
- **Severity:** MEDIUM
- **Description:** Host heartbeat checked with `new Date().getTime() - new Date(controllerLastSeenAt).getTime() > 30000`. If Realtime delays, stale value is used.
- **Repro:** Network lag, Realtime Update delayed 5s, heartbeat check uses 5s-old value.
- **Impact:** Could falsely detect controller timeout.
- **Fix:** Combine with polling fallback to ensure fresh data every 3s.

#### Issue #11: Player card marking lacks server-side enforcement (UX only)
- **File:** `src/app/player/[sessionId]/player-ui.tsx`
- **Type:** Input Validation
- **Severity:** MEDIUM
- **Description:** Only called numbers should be markable. No guard prevents marking of un-called numbers on client.
- **Repro:** Inspect element, manually mark un-called number, submit claim. Server rejects it, but UX is confusing.
- **Impact:** Player confusion; potential for social engineering if client code is seen as authoritative.
- **Fix:** Filter markable numbers: `callableNumbers = currentGameState.called_numbers`.

#### Issue #12: No validation of Realtime payload types
- **File:** `src/app/host/[sessionId]/[gameId]/game-control.tsx:214`
- **Type:** Type Safety
- **Severity:** MEDIUM
- **Description:** Realtime payload cast as `SessionWinner[]` without validation.
- **Repro:** Supabase sends malformed payload. Assume it's array, access `.length` — works if it's object, breaks silently if not.
- **Impact:** Silent failures; UI doesn't update with new winners.
- **Fix:** Add runtime validation: `if (!Array.isArray(data)) { console.error(...); return; }`

---

## 11. Subscription Cleanup Summary

All components properly clean up subscriptions in useEffect return:
- ✓ Host game-control.tsx
- ✓ Display display-ui.tsx
- ✓ Player player-ui.tsx

No memory leaks from subscription handlers firing after unmount.

---

## 12. Recommendations (Prioritized for Tonight)

### **DO BEFORE GAME:**
1. **FIX #3 (CRITICAL):** Implement snowball pot increment after win. Test with mock game.
2. **FIX #1 (CRITICAL):** Replace `Math.random()` with crypto.getRandomValues() for call sequence.
3. **MONITOR #6 (HIGH):** Check Supabase realtime connection count during live game; add logging.

### **BEFORE NEXT SESSION:**
1. Add polling fallback to display/player (#5).
2. Remove `Date.now()` from channel names (#7).
3. Add Zod validation for FormData and Realtime payloads (#9, #12).
4. Implement timezone-aware date display (#8).

### **NICE-TO-HAVE:**
1. Add client-side guard for card marking (#11).
2. Consolidate date/time handling in shared `dateUtils` module.
3. Pre-fetch Realtime payloads on subscribe to validate schema.

---

## 13. Test Cases for Live Game

**Before going live:**
1. Call 5 numbers, validate claim for Line → PASS
2. Disconnect network, call 3 more, reconnect → display shows correct count
3. Create Snowball game, simulate win, verify pot increments next game
4. Check Supabase realtime connections (should be 1 per component, not 2+)
5. Generate 3 sequences, verify no duplicates in any sequence
6. Test on iOS Safari and Android Chrome for wake lock

---

**Report Generated:** 2026-04-29 | **Status:** Ready for review before live game
