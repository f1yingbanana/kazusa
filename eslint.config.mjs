import { defineConfig, globalIgnores } from "eslint/config";

/**
 * No rules live here. Each project (apps/kazusa, apps/web, packages/client)
 * owns its ESLint config and ESLint resolves the nearest one per file; this
 * file only lets `eslint` start from the repo root (editors, `eslint .`) and
 * keeps it out of the places no project owns.
 */
export default defineConfig([
  globalIgnores([
    "**/node_modules/**",
    ".claude/**",
    ".perf/**",
    "dist/**",
    "scripts/**",
  ]),
  {},
]);
