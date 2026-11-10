import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./apps/web", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    // Code that opens its own database under OpenClaw's state directory (the
    // message and decision databases) must never write into the real one.
    env: {
      OPENCLAW_STATE_DIR: mkdtempSync(
        path.join(tmpdir(), "kazusa-test-state-"),
      ),
    },
    include: [
      "apps/*/plugins/*/src/**/*.test.ts",
      "apps/*/src/**/*.test.ts",
      "apps/web/lib/**/*.test.ts",
      "apps/web/hooks/**/*.test.ts",
      "packages/*/src/**/*.test.ts",
      "scripts/**/*.test.mjs",
    ],
  },
});
