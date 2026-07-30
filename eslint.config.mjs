import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Per-machine Claude Code cache. .claude/worktrees holds full checkouts of
    // this repo while background tasks run, so without this every worktree gets
    // linted as if it were source and `npm run lint` reports thousands of
    // problems that are not in the project at all.
    ".claude/**",
  ]),
]);

export default eslintConfig;
