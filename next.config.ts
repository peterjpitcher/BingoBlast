import type { NextConfig } from "next";
import { buildIdFromEnv } from "@anchor-nights/kit/env";
import { validateBuildEnv } from "./src/lib/env";
import { EVENT_IMAGE_REMOTE_PATTERN } from "@anchor-nights/kit/events/image-host";

// Fails the build (and `next dev` start-up) with a message naming any missing or
// malformed variable, rather than shipping and failing on a pub night.
validateBuildEnv();

const nextConfig: NextConfig = {
  // The shared kit ships TypeScript source, so Next compiles it with the app.
  transpilePackages: ["@anchor-nights/kit"],
  env: {
    // The release this bundle was built from (VERCEL_GIT_COMMIT_SHA). The
    // long-lived screens compare it with GET /api/build to pick up a new
    // release (src/hooks/use-build-check.ts). 'dev' outside Vercel, which
    // never triggers a reload.
    NEXT_PUBLIC_BUILD_ID: buildIdFromEnv(),
  },
  images: {
    // Event artwork from the management app's event-images bucket, and nothing
    // else. The kit's events feed drops any image URL outside this pattern
    // (@anchor-nights/kit/events/image-host), so the optimiser never refuses one.
    remotePatterns: [EVENT_IMAGE_REMOTE_PATTERN],
  },
};

export default nextConfig;
