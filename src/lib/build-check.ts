// src/lib/build-check.ts
//
// Whether a long-lived screen should pick up a new release, and how.
//
// The pub TV and the phones stay on one page for hours (the TV for days), so
// without this they keep running whatever release was live when the page was
// opened. The client's own build id is baked in at build time
// (NEXT_PUBLIC_BUILD_ID, from VERCEL_GIT_COMMIT_SHA in next.config.ts), and
// GET /api/build says what the server is running now.
//
// - 'auto' (TV and phone): reload by themselves, but only at a safe moment:
//   no game in progress, or the game on a break. Never while numbers are being
//   called, and never over a claim check or a win (isPublicReloadSafe below).
// - 'prompt' (host): never reload by themselves. Offer a Reload button, and
//   hold even that back while the host is in a claim.
// - 'dev' is what a local build reports. It never triggers anything.

import { getInGameSubState, type NightPhaseGameState } from './night-phase';

export const DEV_BUILD_ID = 'dev';

export type BuildCheckMode = 'auto' | 'prompt';
export type BuildAction = 'none' | 'reload' | 'prompt' | 'wait';

export interface BuildDecisionInput {
  clientBuild: string | null | undefined;
  serverBuild: string | null | undefined;
  mode: BuildCheckMode;
  /** Public: isPublicReloadSafe(). Host: no claim open. */
  safe: boolean;
}

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

/** True only when both ids are real release ids and they differ. */
export function isNewBuild(
  clientBuild: string | null | undefined,
  serverBuild: string | null | undefined,
): boolean {
  if (!clientBuild || !serverBuild) return false;
  if (clientBuild === DEV_BUILD_ID || serverBuild === DEV_BUILD_ID) return false;
  return clientBuild !== serverBuild;
}

export function decideBuildAction({ clientBuild, serverBuild, mode, safe }: BuildDecisionInput): BuildAction {
  if (!isNewBuild(clientBuild, serverBuild)) return 'none';
  if (!safe) return 'wait';
  return mode === 'auto' ? 'reload' : 'prompt';
}
