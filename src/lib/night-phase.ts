// src/lib/night-phase.ts
//
// Which part of the night the public screens are in (spec 5.1). Pure, and used
// by the TV, the phones and /play, so the screens can never disagree about it.
//
// Precedence, first match wins:
//   1. night_over     the session is completed (including an empty session, or
//                     one ended with games still unplayed);
//   2. in_game        the active game's state is in progress;
//   3. before_start   the night has not started: no started_at yet;
//   4. between_games  anything else, with started_at set.
//
// Row 3 is written in the spec as "ready or running with started_at null". A
// draft session with no started_at is also treated as before_start here:
// nothing has started, and saying "Next game coming up" would be wrong.
import type { GameStatus, SessionStatus } from '@/types/database';

export type NightPhase = 'night_over' | 'in_game' | 'before_start' | 'between_games';
export type InGameSubState = 'claim_check' | 'win' | 'break' | 'calling';

export interface NightPhaseSession {
  status: SessionStatus;
  /** Null (or missing, on a row read before the column existed) until the first game starts. */
  started_at?: string | null;
}

export interface NightPhaseGameState {
  status: GameStatus;
  on_break: boolean;
  paused_for_validation: boolean;
  display_win_type: string | null;
}

export interface GetNightPhaseInput {
  session: NightPhaseSession;
  /** The state of the session's active game, or null when there is none. */
  activeGameState: Pick<NightPhaseGameState, 'status'> | null;
}

export function getNightPhase({ session, activeGameState }: GetNightPhaseInput): NightPhase {
  if (session.status === 'completed') return 'night_over';
  if (activeGameState && activeGameState.status === 'in_progress') return 'in_game';
  if (!session.started_at) return 'before_start';
  return 'between_games';
}

/**
 * What a game in progress is doing. A win outranks the claim check because the
 * game stays paused after a winner is recorded, and the TV's win overlay sits
 * on top of the claim.
 */
export function getInGameSubState(
  state: Pick<NightPhaseGameState, 'on_break' | 'paused_for_validation' | 'display_win_type'>
): InGameSubState {
  if (state.display_win_type) return 'win';
  if (state.paused_for_validation) return 'claim_check';
  if (state.on_break) return 'break';
  return 'calling';
}

/**
 * The game that comes next between games: the lowest game number whose state
 * is not completed. A game with no state row has not started.
 */
export function pickNextGame<G extends { id: string; game_index: number }>(
  games: ReadonlyArray<G>,
  statusByGameId: Readonly<Record<string, GameStatus | undefined>>
): G | null {
  const ordered = [...games].sort((a, b) => a.game_index - b.game_index);
  return ordered.find((game) => statusByGameId[game.id] !== 'completed') ?? null;
}
