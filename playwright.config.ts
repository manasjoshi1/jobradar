import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright E2E configuration for JobRadar.
 *
 * In CI: the app is started separately via start-server-and-test,
 * so webServer is NOT used in CI (we just point at the running server).
 *
 * Locally: same flow — run `npm run ci:e2e` which starts the server first.
 */

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false, // SQLite can't handle parallel writers
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,           // Single worker — shared SQLite db
  timeout: 30_000,
  expect: { timeout: 10_000 },

  reporter: process.env.CI
    ? [["line"], ["html", { open: "never", outputFolder: "playwright-report" }]]
    : [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],

  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",

    // All tests share a browser context so cookies persist across test files
    // via the storageState fixture defined in e2e/fixtures.ts
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  outputDir: "test-results",
});
