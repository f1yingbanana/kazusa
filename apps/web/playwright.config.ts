import { resolve } from "node:path";
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results",
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 30_000 },
  use: {
    baseURL: "http://127.0.0.1:3000",
    browserName: "chromium",
    channel: process.env.PLAYWRIGHT_CHANNEL ?? "chrome",
    viewport: { width: 1440, height: 1000 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev",
    cwd: resolve(__dirname, "../.."),
    url: "http://127.0.0.1:3000/kazusa/world",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
