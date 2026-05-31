import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Unit tests only. Playwright e2e specs live in e2e/ and run via `npm run test:e2e`.
    include: ["__tests__/**/*.test.ts"],
    exclude: ["e2e/**", "node_modules/**", ".claude/**"],
    environment: "node",
  },
});
