import type { NextConfig } from "next";
import { buildIdFromEnv } from "@anchor-nights/kit/env";
import { validateBuildEnv } from "./src/lib/env";
import { EVENT_IMAGE_REMOTE_PATTERN } from "@anchor-nights/kit/events/image-host";
import { securityHeaders } from "@anchor-nights/kit/auth/headers";

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
  // The auth standard's security headers on every response (section 3). The
  // CSP is Report-Only for now; move to cspMode: "enforce" after two weeks of
  // clean reports. Documented exceptions (CLAUDE.md, owner Peter, reviewed
  // quarterly): script-src 'unsafe-inline' because Next's inline scripts carry
  // no nonce yet, and style-src 'unsafe-inline' for React style attributes
  // and next/font. Event artwork comes through the image optimiser
  // (/_next/image), so img-src needs no extra host.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders({
          supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
          cspMode: "report-only",
          extra: { scriptSrc: ["'unsafe-inline'"], styleSrc: ["'unsafe-inline'"] },
        }),
      },
    ];
  },
};

export default nextConfig;
