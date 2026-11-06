// src/hooks/use-build-check.ts
//
// The shared kit's build check (useBuildCheck in @anchor-nights/kit/tv) with
// Cash Bingo's settings filled in once, so the four screens that use it only
// say their mode and when a reload is safe:
//   - the release this bundle was built from (NEXT_PUBLIC_BUILD_ID, set in
//     next.config.ts; 'dev' locally, which never triggers anything);
//   - the sessionStorage key that remembers which release a tab already
//     reloaded for. It keeps its 'anchor-bingo:' prefix, so tabs that reloaded
//     before the move to the kit are still remembered.
//
// It checks GET /api/build every 5 minutes and whenever the page becomes
// visible: mode 'auto' (TV, phone) reloads by itself once it is safe and
// online; mode 'prompt' (host) never reloads and returns showPrompt.
'use client';

import { useBuildCheck as useKitBuildCheck, type BuildCheckMode, type UseBuildCheckApi } from '@anchor-nights/kit/tv';

export const BUILD_RELOADED_FOR_KEY = 'anchor-bingo:build-reloaded-for';

export interface UseBuildCheckOptions {
  mode: BuildCheckMode;
  /** TV and phone: isPublicReloadSafe(). Host: no claim open. Read on every render. */
  isSafeToReload: () => boolean;
}

export function useBuildCheck({ mode, isSafeToReload }: UseBuildCheckOptions): UseBuildCheckApi {
  return useKitBuildCheck({
    mode,
    // Referenced literally so the bundler inlines it.
    clientBuild: process.env.NEXT_PUBLIC_BUILD_ID,
    isSafeToReload,
    storageKey: BUILD_RELOADED_FOR_KEY,
  });
}
