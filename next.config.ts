import type { NextConfig } from "next";
import { validateBuildEnv } from "./src/lib/env";
import { EVENT_IMAGE_HOST, EVENT_IMAGE_PATH_PREFIX } from "./src/lib/events-feed/image-host";

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
  images: {
    // Event artwork from the management app's event-images bucket, and nothing
    // else. The projection drops any image URL outside this pattern
    // (src/lib/events-feed/image-host.ts), so next/image never refuses one.
    remotePatterns: [
      {
        protocol: "https",
        hostname: EVENT_IMAGE_HOST,
        port: "",
        pathname: `${EVENT_IMAGE_PATH_PREFIX}**`,
        search: "",
      },
    ],
  },
};

export default nextConfig;
