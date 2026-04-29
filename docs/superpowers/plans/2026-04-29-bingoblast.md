# Implementation Plan — BingoBlast Remediation

**Spec:** [docs/superpowers/specs/2026-04-29-bingoblast-design.md](../specs/2026-04-29-bingoblast-design.md)
**Base commit:** `47e7752`
**Scope:** Five fixes in five files. No DB migration. Single PR.

---

## Dependency Graph

All five tasks are independent file edits with no shared symbols. They can run in a single parallel wave.

```
Wave 1 (parallel): T-A | T-B | T-C | T-D | T-E
Wave 2 (sequential): Verification (lint → typecheck → build)
```

Per-task ownership:

| Task | File | Lines edited |
|------|------|--------------|
| T-A  | `src/app/host/[sessionId]/[gameId]/game-control.tsx` | ~396-400, ~441-447 |
| T-B  | `src/app/player/[sessionId]/player-ui.tsx`           | new useEffect after existing channel effects |
| T-C  | `src/app/display/[sessionId]/display-ui.tsx`         | ~138-168 (rewrite of polling effect) |
| T-D  | `src/app/api/setup/route.ts`                         | ~1-40 (imports + helper + check site) |
| T-E  | `src/app/host/actions.ts`                            | `announceWin` (~946-995) and `recordWinner` (~1064-1226) |

---

## Task T-A — Make host client state void-safe

**File:** `src/app/host/[sessionId]/[gameId]/game-control.tsx`

### Edits

**Edit 1** — Realtime payload handler. Replace the current monotonic guard with a direct apply:

Find (lines ~393-401):
```ts
                    (payload) => {
                        if (!isMounted) return;
                        // Guard: never regress called_numbers — a heartbeat UPDATE carries
                        // the old called_numbers and must not overwrite a newer optimistic state.
                        setCurrentGameState(prev =>
                            payload.new.numbers_called_count >= prev.numbers_called_count
                                ? payload.new
                                : { ...payload.new, called_numbers: prev.called_numbers, numbers_called_count: prev.numbers_called_count }
                        );
                    }
```

Replace with:
```ts
                    (payload) => {
                        if (!isMounted) return;
                        setCurrentGameState(payload.new);
                    }
```

**Edit 2** — Polling effect. Replace the current monotonic guard with a direct apply:

Find (lines ~441-447):
```ts
            if (freshState) {
                // Apply same guard as Realtime: never regress called numbers
                setCurrentGameState(prev =>
                    freshState.numbers_called_count >= prev.numbers_called_count
                        ? freshState
                        : prev
                );
            }
```

Replace with:
```ts
            if (freshState) {
                setCurrentGameState(freshState);
            }
```

### Acceptance criteria (from spec § Fix A)

- Call two numbers on host. Click "Undo Last Call". Within one Realtime event or one 3s poll the host shows the previous number and `numbers_called_count` is decremented by 1.
- The Next Number button still calls based on the server's current `numbers_called_count` (i.e. it calls the previously-voided number again rather than skipping it).

---

## Task T-B — Add player polling fallback

**File:** `src/app/player/[sessionId]/player-ui.tsx`

### Edits

**Edit 1** — Add the poll-interval constant near the type definitions (after the `interface PlayerUIProps {…}` block, before `export default function PlayerUI…`):

```ts
const POLL_INTERVAL_MS = 3000;
```

**Edit 2** — Add a polling `useEffect` immediately after the existing snowball-pot subscription effect (i.e. after the block ending at line ~164 `return () => { if (potChannel) supabaseClient.removeChannel(potChannel); }; }, [currentActiveGame]);`).

```tsx
  useEffect(() => {
    let cancelled = false;
    let interval: NodeJS.Timeout | null = null;

    const poll = async () => {
      if (cancelled) return;
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;

      const { data: freshSession } = await supabase.current
        .from('sessions')
        .select('*')
        .eq('id', session.id)
        .single<Session>();
      if (cancelled || !freshSession) return;

      setCurrentSession(freshSession);

      if (freshSession.active_game_id !== currentActiveGame?.id) {
        await refreshActiveGame(freshSession.active_game_id);
        return;
      }

      if (currentActiveGame?.id) {
        const { data: freshState } = await supabase.current
          .from('game_states_public')
          .select('*')
          .eq('game_id', currentActiveGame.id)
          .single<GameState>();
        if (cancelled || !freshState) return;

        setCurrentGameState(freshState);
        const stageKey = currentActiveGame.stage_sequence[freshState.current_stage_index];
        setCurrentPrizeText(
          currentActiveGame.prizes?.[stageKey as keyof typeof currentActiveGame.prizes] || ''
        );
      }
    };

    void poll();
    interval = setInterval(() => { void poll(); }, POLL_INTERVAL_MS);

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void poll();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [
    session.id,
    currentActiveGame?.id,
    currentActiveGame?.prizes,
    currentActiveGame?.stage_sequence,
    refreshActiveGame,
  ]);
```

### Acceptance criteria (from spec § Fix B)

- Player open → block player network for 5s → host calls one number → restore network → player catches up within 3s without manual refresh.
- Active game changes during interruption → player switches to new active game after polling.
- `voidLastNumber` → player shows decremented count and previous number.
- Stage advance during interruption → both stage and prize text update on next poll.

---

## Task T-C — Tighten display polling fallback

**File:** `src/app/display/[sessionId]/display-ui.tsx`

### Edits

**Edit 1** — Add the constant near the type definitions (after `formatStageLabel` helper, before `export default function DisplayUI…`):

```ts
const POLL_INTERVAL_MS = 3000;
```

**Edit 2** — Replace the existing polling effect (lines ~138-168) with the void-safe, session-refreshing, prize-refreshing version:

Find:
```tsx
  useEffect(() => {
      const interval = setInterval(async () => {
          if (document.visibilityState !== 'visible') {
              return;
          }
          const { data: freshSession } = await supabase.current
              .from('sessions')
              .select('active_game_id, status') 
              .eq('id', session.id)
              .single<Pick<Session, 'active_game_id' | 'status'>>();
          
          if (freshSession) {
              if (freshSession.active_game_id !== currentActiveGame?.id) {
                  await refreshActiveGame(freshSession.active_game_id);
              } else if (currentActiveGame?.id) {
                  // Poll game state to ensure sync
                  const { data: freshState } = await supabase.current
                    .from('game_states_public')
                    .select('*')
                    .eq('game_id', currentActiveGame.id)
                    .single<Database['public']['Tables']['game_states_public']['Row']>();
                  
                  if (freshState) {
                      setCurrentGameState(freshState);
                  }
              }
          }
      }, 10000);

      return () => clearInterval(interval);
  }, [currentActiveGame, session.id, refreshActiveGame]);
```

Replace with:
```tsx
  useEffect(() => {
    let cancelled = false;
    let interval: NodeJS.Timeout | null = null;

    const poll = async () => {
      if (cancelled) return;
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;

      const { data: freshSession } = await supabase.current
        .from('sessions')
        .select('*')
        .eq('id', session.id)
        .single<Session>();
      if (cancelled || !freshSession) return;

      setCurrentSession(freshSession);
      setIsWaitingState(!freshSession.active_game_id && freshSession.status !== 'running');

      if (freshSession.active_game_id !== currentActiveGame?.id) {
        await refreshActiveGame(freshSession.active_game_id);
        return;
      }

      if (currentActiveGame?.id) {
        const { data: freshState } = await supabase.current
          .from('game_states_public')
          .select('*')
          .eq('game_id', currentActiveGame.id)
          .single<GameState>();
        if (cancelled || !freshState) return;

        setCurrentGameState(freshState);
        const stageKey = currentActiveGame.stage_sequence[freshState.current_stage_index];
        setCurrentPrizeText(
          currentActiveGame.prizes?.[stageKey as keyof typeof currentActiveGame.prizes] || ''
        );
      }
    };

    void poll();
    interval = setInterval(() => { void poll(); }, POLL_INTERVAL_MS);

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void poll();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [
    session.id,
    currentActiveGame?.id,
    currentActiveGame?.prizes,
    currentActiveGame?.stage_sequence,
    refreshActiveGame,
  ]);
```

### Acceptance criteria (from spec § Fix C)

- Realtime drop → display catches up within 3 seconds.
- Session completes during Realtime drop → display reflects completed service state after polling.
- Stage advances during Realtime drop → display stage AND prize update after polling.
- Last number voided → display shows previous current number and decremented count.

---

## Task T-D — Constant-time setup secret check

**File:** `src/app/api/setup/route.ts`

### Edits

**Edit 1** — Add Node crypto import at the top with the existing imports:

```ts
import { createHash, timingSafeEqual } from 'node:crypto'
```

**Edit 2** — Add the helper function below `getSetupSecret()` and above `export async function GET()`:

```ts
function isSetupSecretValid(providedSecret: string | null, setupSecret: string): boolean {
  const providedDigest = createHash('sha256')
    .update(providedSecret ?? '', 'utf8')
    .digest()
  const expectedDigest = createHash('sha256')
    .update(setupSecret, 'utf8')
    .digest()

  return timingSafeEqual(providedDigest, expectedDigest)
}
```

**Edit 3** — Replace the comparison site (lines ~27-30):

Find:
```ts
  const providedSecret = request.headers.get('x-setup-secret')
  if (!providedSecret || providedSecret !== setupSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
```

Replace with:
```ts
  const providedSecret = request.headers.get('x-setup-secret')
  if (!isSetupSecretValid(providedSecret, setupSecret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
```

### Acceptance criteria (from spec § Fix D)

- Missing `SETUP_SECRET` env: returns `404`.
- Missing `x-setup-secret` header: returns `401`.
- Wrong secret value: returns `401`.
- Correct secret: proceeds to JSON body parsing exactly as before.

---

## Task T-E — Live stage validation in `announceWin` and `recordWinner`

**File:** `src/app/host/actions.ts`

### Edits

**Edit 1** — Modify `announceWin` (~lines 946-995). Add live-stage validation between the `requireController` check and the existing `displayWinText` switch:

The current shape is:
```ts
export async function announceWin(gameId: string, stage: WinStage | 'snowball'): Promise<ActionResult> {
    const supabase = await createClient();
    const controlResult = await requireController(supabase, gameId)
    if (!controlResult.authorized) return { success: false, error: controlResult.error }

    let displayWinText: string;
    let displayWinType: string;

    if (stage === 'snowball') {
        // … snowball branch …
    } else {
        switch (stage) { … }
    }

    const winUpdate: … = { … };
    const { error } = await supabase.from('game_states').update(winUpdate).eq('game_id', gameId);
    if (error) { return { success: false, error: error.message }; }
    revalidatePath(`/host/${gameId}`);
    return { success: true };
}
```

After `if (!controlResult.authorized) return …` and before `let displayWinText`, insert:

```ts
    const { data: gameState, error: gameStateError } = await supabase
        .from('game_states')
        .select('current_stage_index, status')
        .eq('game_id', gameId)
        .single<Pick<Database['public']['Tables']['game_states']['Row'], 'current_stage_index' | 'status'>>();
    if (gameStateError || !gameState) {
        return { success: false, error: gameStateError?.message || "Game state not found." };
    }
    if (gameState.status !== 'in_progress') {
        return { success: false, error: "Cannot announce a winner unless the game is in progress." };
    }

    const { data: gameRow, error: gameRowError } = await supabase
        .from('games')
        .select('type, stage_sequence')
        .eq('id', gameId)
        .single<Pick<Database['public']['Tables']['games']['Row'], 'type' | 'stage_sequence'>>();
    if (gameRowError || !gameRow) {
        return { success: false, error: gameRowError?.message || "Game details not found." };
    }

    const expectedStage = (gameRow.stage_sequence as string[] | null)?.[gameState.current_stage_index];
    if (!expectedStage) {
        return { success: false, error: "Current stage is not configured for this game." };
    }

    if (stage === 'snowball') {
        if (gameRow.type !== 'snowball' || expectedStage !== 'Full House') {
            return { success: false, error: "Snowball announcement is only valid during Full House of a snowball game." };
        }
    } else if (stage !== expectedStage) {
        return { success: false, error: `Stage mismatch: live stage is ${expectedStage}.` };
    }
```

The existing switch and update logic remains unchanged.

**Edit 2** — Modify `recordWinner` (~lines 1064-1226). Three sub-edits:

(a) Add session/game ownership + live-stage validation immediately after the existing input validation (i.e. after the validStages enum check, before `const supabase = await createClient();`):

Find:
```ts
    if (!validStages.includes(stage)) {
        return { success: false, error: 'Invalid stage value.' };
    }
    if (!sessionId || !gameId) {
        return { success: false, error: 'Invalid session or game ID.' };
    }

    const supabase = await createClient();
    const controlResult = await requireController(supabase, gameId)
    if (!controlResult.authorized) return { success: false, error: controlResult.error }
```

Replace with:
```ts
    if (!validStages.includes(stage)) {
        return { success: false, error: 'Invalid stage value.' };
    }
    if (!sessionId || !gameId) {
        return { success: false, error: 'Invalid session or game ID.' };
    }

    const supabase = await createClient();
    const controlResult = await requireController(supabase, gameId)
    if (!controlResult.authorized) return { success: false, error: controlResult.error }

    const { data: liveGameRow, error: liveGameRowError } = await supabase
        .from('games')
        .select('session_id, type, snowball_pot_id, stage_sequence')
        .eq('id', gameId)
        .single<Pick<Database['public']['Tables']['games']['Row'], 'session_id' | 'type' | 'snowball_pot_id' | 'stage_sequence'>>();
    if (liveGameRowError || !liveGameRow) {
        return { success: false, error: liveGameRowError?.message || "Game details not found." };
    }
    if (liveGameRow.session_id !== sessionId) {
        return { success: false, error: "Game does not belong to this session." };
    }

    const { data: liveStateRow, error: liveStateRowError } = await supabase
        .from('game_states')
        .select('numbers_called_count, current_stage_index, status')
        .eq('game_id', gameId)
        .single<Pick<Database['public']['Tables']['game_states']['Row'], 'numbers_called_count' | 'current_stage_index' | 'status'>>();
    if (liveStateRowError || !liveStateRow) {
        return { success: false, error: liveStateRowError?.message || "Game state not found." };
    }
    if (liveStateRow.status !== 'in_progress') {
        return { success: false, error: "Cannot record a winner unless the game is in progress." };
    }

    const expectedStage = (liveGameRow.stage_sequence as string[] | null)?.[liveStateRow.current_stage_index];
    if (!expectedStage) {
        return { success: false, error: "Current stage is not configured for this game." };
    }
    if (stage !== expectedStage) {
        return { success: false, error: `Stage mismatch: live stage is ${expectedStage}.` };
    }
```

(b) Replace the existing live-state and game-row fetches further down with reads of `liveStateRow` and `liveGameRow`. Specifically:

Find:
```ts
    let resolvedCallCountAtWin = callCountAtWin;
    const { data: liveGameState } = await supabase
        .from('game_states')
        .select('numbers_called_count')
        .eq('game_id', gameId)
        .single<Pick<Database['public']['Tables']['game_states']['Row'], 'numbers_called_count'>>();

    if (liveGameState) {
        resolvedCallCountAtWin = liveGameState.numbers_called_count;
    }
```

Replace with:
```ts
    const resolvedCallCountAtWin = liveStateRow.numbers_called_count;
```

(c) Replace the second `games` fetch with a reference to `liveGameRow`:

Find:
```ts
    const { data: game } = await supabase
        .from('games')
        .select('type, snowball_pot_id')
        .eq('id', gameId)
        .single<Pick<Database['public']['Tables']['games']['Row'], 'type' | 'snowball_pot_id'>>();

    if (!isTestSession && game && game.type === 'snowball' && stage === 'Full House' && game.snowball_pot_id) {
```

Replace with:
```ts
    const game = liveGameRow;

    if (!isTestSession && game.type === 'snowball' && stage === 'Full House' && game.snowball_pot_id) {
```

(d) Trim winner name on insert. Find:
```ts
        winner_name: winnerName,
```

Replace with:
```ts
        winner_name: winnerName.trim(),
```

(e) Acknowledge the suppressed warning: `callCountAtWin` parameter is now unused. Mark it as an explicit unused parameter for backwards compat by leaving it in the signature and accepting a small lint suppression if the project's ESLint flags it. Use `void callCountAtWin;` near the top of the body to silence the warning if needed.

### Acceptance criteria (from spec § Fix E)

- Stale client cannot announce or record a `Line` winner while live stage is `Two Lines`.
- Stale client cannot record a winner with mismatched `(gameId, sessionId)`.
- Manual snowball award still works during a snowball game's live `Full House`.
- Normal Line / Two Lines / Full House host-UI flows still work.

---

## Wave 2 — Verification (sequential)

After all five edits:

```bash
npm run lint
npm test
npm run build
```

Each must pass with no errors. Manual smoke tests are listed in the spec § 5.

---

## Out of Scope (do not touch)

Per spec § 6: no PL/pgSQL transactions, no `state_version` column, no `crypto.getRandomValues()` shuffle, no unique winner constraints, no Zod migration, no timezone helpers, no audit-log table, no player digital tickets.
