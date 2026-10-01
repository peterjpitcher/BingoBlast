// src/components/display/use-session-overview.ts
//
// The rest of the night, for the TV and the phone: the session's games in
// order (for "Game 3 of 10, Blue book" and the next game between games), each
// game's public status, and a snowball pot for rule 8 of the house rules.
//
// Non-critical, like the pot channel: a failed read keeps the last good
// overview and is logged, and never touches connection health or the banner.
// It is re-read when `refreshKey` changes (the caller passes the session's
// state_version, which the lifecycle functions bump when a game starts or
// finishes) and once a minute, which also picks up a pot settled after its game.
'use client';

import { useEffect, useRef, useState } from 'react';
import type { createClient } from '@/utils/supabase/client';
import type { GameStatus, GameType } from '@/types/database';
import type { SnowballRulePot } from '@/lib/house-rules';
import { logError } from '@/lib/log-error';

export interface OverviewGame {
  id: string;
  game_index: number;
  name: string;
  type: GameType;
  background_colour: string;
  snowball_pot_id: string | null;
}

export interface SessionOverview {
  /** In game_index order. */
  games: OverviewGame[];
  /** A game with no public state row has not started, so it is absent here. */
  statusByGameId: Record<string, GameStatus>;
  /** The pot of the night's first snowball game, for the rules; null when there is none. */
  rulesPot: (SnowballRulePot & { id: string }) | null;
}

const OVERVIEW_GAME_COLUMNS = 'id, game_index, name, type, background_colour, snowball_pot_id';
const RULES_POT_COLUMNS = 'id, current_max_calls, current_jackpot_amount, calls_increment, jackpot_increment';
const REFRESH_MS = 60_000;

type PublicClient = ReturnType<typeof createClient>;

async function fetchSessionOverview(client: PublicClient, sessionId: string, logScope: string): Promise<SessionOverview> {
  const { data: games, error: gamesError } = await client
    .from('games')
    .select(OVERVIEW_GAME_COLUMNS)
    .eq('session_id', sessionId)
    .order('game_index', { ascending: true })
    .returns<OverviewGame[]>();
  if (gamesError || !games) throw gamesError ?? new Error('Session games lookup returned nothing');

  const statusByGameId: Record<string, GameStatus> = {};
  if (games.length > 0) {
    const { data: states, error: statesError } = await client
      .from('game_states_public')
      .select('game_id, status')
      .in('game_id', games.map((game) => game.id))
      .returns<{ game_id: string; status: GameStatus }[]>();
    if (statesError || !states) throw statesError ?? new Error('Session game states lookup returned nothing');
    for (const state of states) statusByGameId[state.game_id] = state.status;
  }

  let rulesPot: SessionOverview['rulesPot'] = null;
  const potId = games.find((game) => game.type === 'snowball' && game.snowball_pot_id)?.snowball_pot_id ?? null;
  if (potId) {
    const { data: pot, error: potError } = await client
      .from('snowball_pots')
      .select(RULES_POT_COLUMNS)
      .eq('id', potId)
      .maybeSingle<SnowballRulePot & { id: string }>();
    // The rules can go without rule 8 for a minute; the games cannot wait on it.
    if (potError) logError(logScope, potError);
    else rulesPot = pot ?? null;
  }

  return { games, statusByGameId, rulesPot };
}

export interface UseSessionOverviewOptions {
  supabase: PublicClient;
  sessionId: string;
  /** Any value that changes when the night moves on, for example the session's state_version. */
  refreshKey: string | number;
  logScope: string;
}

/** Null until the first successful read. */
export function useSessionOverview({
  supabase,
  sessionId,
  refreshKey,
  logScope,
}: UseSessionOverviewOptions): SessionOverview | null {
  const [overview, setOverview] = useState<SessionOverview | null>(null);
  const requestSeqRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const seq = ++requestSeqRef.current;
      try {
        const next = await fetchSessionOverview(supabase, sessionId, logScope);
        if (cancelled || seq !== requestSeqRef.current) return;
        setOverview(next);
      } catch (err) {
        if (!cancelled) logError(logScope, err);
      }
    };
    void load();
    const interval = setInterval(() => {
      void load();
    }, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [supabase, sessionId, refreshKey, logScope]);

  return overview;
}
