import type { NextConfig } from "next";
import { validateBuildEnv } from "./src/lib/env";

// Fails the build (and `next dev` start-up) with a message naming any missing or
// malformed variable, rather than shipping and failing on a pub night.
validateBuildEnv();

const nextConfig: NextConfig = {
  env: {
    // The release this bundle was built from. The long-lived screens compare it
    // with GET /api/build to pick up a new release (src/lib/build-check.ts).
    // 'dev' outside Vercel, which never triggers a reload.
    NEXT_PUBLIC_BUILD_ID: process.env.VERCEL_GIT_COMMIT_SHA ?? "dev",
  },
};

export default nextConfig;
