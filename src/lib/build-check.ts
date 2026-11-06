// src/lib/build-check.ts
//
// When the TV and the phones may reload themselves for a new release: Cash
// Bingo's own rule, which it hands to the shared kit's build check
// (useBuildCheck in @anchor-nights/kit/tv, through src/hooks/use-build-check.ts).
// The generic part (comparing release ids, deciding reload, prompt or wait)
// lives in the kit.
//
// - TV and phone ('auto'): reload by themselves, but only at a safe moment:
//   no game in progress, or the game on a break. Never while numbers are being
//   called, and never over a claim check or a win (isPublicReloadSafe below).
// - Host ('prompt'): never reload by themselves. Offer a Reload button, and
//   hold even that back while the host is in a claim (game-control.tsx).

import { getInGameSubState, type NightPhaseGameState } from './night-phase';

/** The parts of a game state the public reload decision reads. */
export type PublicReloadGameState = Pick<
  NightPhaseGameState,
  'status' | 'on_break' | 'paused_for_validation' | 'display_win_type'
>;

/**
 * Whether the TV or a phone may reload itself now for a new release.
 *
 * Safe only when no game is in progress (before the night, between games,
 * after it), or when the game in progress is on a break. A reload takes the
 * screen away for a few seconds, which while numbers are being called is a
 * ball the room may miss; over a claim check or a win it hides the very thing
 * the room is watching. Those come from getInGameSubState, so this agrees with
 * what the screen is actually showing: a break that also has a win or a claim
 * on screen counts as the win or the claim, not the break.
 */
export function isPublicReloadSafe(state: PublicReloadGameState | null | undefined): boolean {
  if (!state || state.status !== 'in_progress') return true;
  return getInGameSubState(state) === 'break';
}
