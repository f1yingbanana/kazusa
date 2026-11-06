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
