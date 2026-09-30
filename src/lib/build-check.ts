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
// - 'auto' (TV and phone): reload by themselves, but only at a safe moment,
//   never in the middle of a claim check or a win.
// - 'prompt' (host): never reload by themselves. Offer a Reload button, and
//   hold even that back while the host is in a claim.
// - 'dev' is what a local build reports. It never triggers anything.

export const DEV_BUILD_ID = 'dev';

export type BuildCheckMode = 'auto' | 'prompt';
export type BuildAction = 'none' | 'reload' | 'prompt' | 'wait';

export interface BuildDecisionInput {
  clientBuild: string | null | undefined;
  serverBuild: string | null | undefined;
  mode: BuildCheckMode;
  /** False during a claim check or a win (public), or while a claim is open (host). */
  safe: boolean;
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
