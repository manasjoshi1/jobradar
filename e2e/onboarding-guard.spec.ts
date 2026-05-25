/**
 * E2E — Onboarding guard acceptance criteria
 *
 * Core rule under test:
 *   "Has the user completed onboarding once?" is separate from
 *   "Is their current config complete/usable?"
 *
 * Acceptance criteria (6):
 *   1. New user (completedAt=null)          → onboarding wizard
 *   2. Onboarded user with zero sources     → dashboard + source-setup banner, NOT onboarding
 *   3. Onboarded user with broken sources   → dashboard, NOT onboarding
 *   4. Onboarded user after YAML import fail→ stays on config screen, NOT onboarding
 *   5. Onboarded user with prefs reset      → dashboard (config warning), NOT onboarding
 *   6. Explicit requiresReboarding=true     → onboarding wizard
 *
 * All tests use the default E2E user (completedAt set, requiresReboarding=false)
 * except criterion 1 (new user via register) and criterion 6 (reset onboarding).
 */
import { test, expect } from "@playwright/test";
import { loginViaApi } from "./helpers";

// ── 1. New user → onboarding ───────────────────────────────────────────────────

test("new user who has never completed onboarding is redirected to /onboarding", async ({ page }) => {
  // Register a fresh user; they get onboardingCompleted=false in their JWT
  const unique = `onboard-test-${Date.now()}@jobradar.test`;
  const regRes = await page.request.post("/api/auth/register", {
    data: {
      fullName:        "Test Onboard User",
      email:           unique,
      password:        "TestPass123!",
      confirmPassword: "TestPass123!",
    },
  });
  expect(regRes.status()).toBe(200);

  // Navigate to home — proxy should redirect to /onboarding
  await page.goto("/");
  await expect(page).toHaveURL("/onboarding", { timeout: 10_000 });

  // Onboarding wizard should be visible
  await expect(page.locator("body")).toContainText(/welcome|set up|profile|get started/i, { timeout: 8_000 });
});

// ── 2. Onboarded user with zero sources → dashboard, NOT onboarding ───────────

test("onboarded user with zero sources sees dashboard (not onboarding)", async ({ page }) => {
  await loginViaApi(page);

  // Clear user sources via API
  await page.request.post("/api/profile/reset", { data: { mode: "sources" } });

  // Reload — should be on dashboard
  await page.goto("/");
  await expect(page).toHaveURL("/", { timeout: 10_000 });

  // Must NOT be on onboarding
  await expect(page).not.toHaveURL("/onboarding");

  // Source-setup banner or dashboard content must be visible
  // (banner shows when there are no global sources either; in CI global sources exist
  //  from the seed, so the banner may not show — but we must not be on onboarding)
  await expect(page.locator("main")).toBeVisible({ timeout: 8_000 });
});

// ── 3. Onboarded user with broken/404 sources → dashboard, NOT onboarding ─────

test("onboarded user with broken source URL stays on dashboard", async ({ page }) => {
  await loginViaApi(page);

  // Add a source with a 404 URL via the profile API
  const addRes = await page.request.post("/api/profile/sources", {
    data: {
      company:    "Broken Company E2E",
      provider:   "CUSTOM",
      url:        "https://jobs.example-broken-404.test/api/jobs",
      enabled:    true,
      priority:   1,
    },
  });
  expect([200, 201]).toContain(addRes.status());

  // Navigate to home — must land on dashboard, not onboarding
  await page.goto("/");
  await expect(page).toHaveURL("/", { timeout: 10_000 });
  await expect(page).not.toHaveURL("/onboarding");
  await expect(page.locator("main")).toBeVisible({ timeout: 8_000 });

  // Clean up the test source
  const createdSource = await addRes.json() as { id?: string };
  if (createdSource.id) {
    await page.request.delete(`/api/profile/sources/${createdSource.id}`);
  }
});

// ── 4. YAML import failure → stays on config screen, NOT onboarding ───────────

test("YAML import failure does not redirect to onboarding", async ({ page }) => {
  await loginViaApi(page);
  await page.goto("/");

  // Open Profile tab
  await page.getByRole("button", { name: /👤 Profile/i }).click();
  await expect(page.getByRole("button", { name: "Import / Export" })).toBeVisible({ timeout: 12_000 });
  await page.getByRole("button", { name: "Import / Export" }).click();

  // Paste invalid YAML into the textarea
  const yamlTextarea = page.locator("textarea").last();
  await yamlTextarea.fill(": invalid yaml {{ {{ bad");

  // Select "User Profile" type and try to import
  await page.getByRole("button", { name: "User Profile", exact: true }).click();
  await page.getByRole("button", { name: /^Import$/ }).click();

  // Should stay on the current page — NOT redirected to onboarding
  await expect(page).not.toHaveURL("/onboarding");
  await expect(page).toHaveURL("/", { timeout: 5_000 });

  // Should show an error (not a success, not an onboarding wizard)
  await page.waitForTimeout(1500);
  await expect(page).not.toHaveURL("/onboarding");
});

// ── 5. Onboarded user after preferences reset → dashboard (config warning) ────

test("preferences reset does not send onboarded user to onboarding", async ({ page }) => {
  await loginViaApi(page);

  // Reset preferences via API
  const resetRes = await page.request.post("/api/profile/reset", { data: { mode: "prefs" } });
  expect(resetRes.status()).toBe(200);
  const resetBody = await resetRes.json() as { ok: boolean };
  expect(resetBody.ok).toBe(true);

  // Navigate — must land on dashboard
  await page.goto("/");
  await expect(page).toHaveURL("/", { timeout: 10_000 });
  await expect(page).not.toHaveURL("/onboarding");
  await expect(page.locator("main")).toBeVisible({ timeout: 8_000 });

  // Config status should still show onboarding.completed = true
  const statusRes = await page.request.get("/api/profile/config/status");
  expect(statusRes.status()).toBe(200);
  const status = await statusRes.json() as {
    onboarding?: { completed: boolean; requiresReboarding: boolean };
  };
  expect(status.onboarding?.completed).toBe(true);
  expect(status.onboarding?.requiresReboarding).toBe(false);

  // Restore defaults (already done by "prefs" reset, but make it explicit)
  await page.request.patch("/api/profile/preferences", { data: { minScore: 40 } });
});

// ── 6. Explicit requiresReboarding=true → onboarding ─────────────────────────

test("explicit onboarding reset (requiresReboarding=true) redirects to /onboarding", async ({ page }) => {
  await loginViaApi(page);

  // Reset onboarding — this sets requiresReboarding=true AND refreshes JWT
  const resetRes = await page.request.post("/api/profile/reset", { data: { mode: "onboarding" } });
  expect(resetRes.status()).toBe(200);
  const resetBody = await resetRes.json() as { ok: boolean; reset: string[] };
  expect(resetBody.ok).toBe(true);
  expect(resetBody.reset).toContain("onboarding");

  // Verify DB state via status endpoint — the new JWT is already in the cookie
  const statusRes = await page.request.get("/api/profile/config/status");
  const status = await statusRes.json() as {
    onboarding?: { completed: boolean; requiresReboarding: boolean };
    ui?: { nextScreen: string };
  };
  expect(status.onboarding?.requiresReboarding).toBe(true);
  expect(status.ui?.nextScreen).toBe("ONBOARDING");

  // Navigate — proxy should redirect to onboarding (JWT now has onboardingCompleted=false)
  await page.goto("/");
  await expect(page).toHaveURL("/onboarding", { timeout: 10_000 });

  // ── Restore: complete onboarding to get user back to a usable state ──────────
  // We do this by hitting the API directly (simulating wizard completion)
  // so subsequent tests that share the E2E user are not broken.
  // NOTE: We POST /api/onboarding while on /onboarding page — the proxy allows it.
  const completeRes = await page.request.post("/api/onboarding", {
    data: {
      data: {
        fullName:         "Default User",
        selectedTitles:   ["Software Engineer"],
        hiddenTitles:     [],
        customTitles:     [],
        selectedSkills:   ["java"],
        niceHaveKeywords: [],
        negativeKeywords: [],
        remoteOk:         true,
        hybridOk:         true,
        onsiteOk:         false,
        targetCities:     [],
        needsSponsorship: false,
        minScore:         40,
        blockedCompanies: [],
      },
    },
  });
  expect(completeRes.status()).toBe(200);

  // Now / should be accessible again
  await page.goto("/");
  await expect(page).toHaveURL("/", { timeout: 10_000 });
});

// ── Status endpoint shape ──────────────────────────────────────────────────────

test("GET /api/profile/config/status returns onboarding + config + ui blocks", async ({ page }) => {
  await loginViaApi(page);

  const res = await page.request.get("/api/profile/config/status");
  expect(res.status()).toBe(200);

  const body = await res.json() as {
    onboarding?: {
      completed: boolean;
      completedAt: string | null;
      version: number;
      requiresReboarding: boolean;
      reboardingReason: string | null;
    };
    config?: {
      hasPreferences: boolean;
      hasSources: boolean;
      sourceCount: number;
      sourceMode: string;
      needsSourceSetup: boolean;
    };
    ui?: {
      nextScreen: string;
      message: string | null;
    };
  };

  // onboarding block
  expect(body.onboarding).toBeDefined();
  expect(typeof body.onboarding?.completed).toBe("boolean");
  expect(["string", "object"]).toContain(typeof body.onboarding?.completedAt); // string or null
  expect(typeof body.onboarding?.requiresReboarding).toBe("boolean");

  // config block
  expect(body.config).toBeDefined();
  expect(typeof body.config?.hasPreferences).toBe("boolean");
  expect(typeof body.config?.sourceCount).toBe("number");
  expect(["USER_SELECTED", "GLOBAL_FALLBACK", "NONE"]).toContain(body.config?.sourceMode);
  expect(typeof body.config?.needsSourceSetup).toBe("boolean");

  // ui block
  expect(body.ui).toBeDefined();
  expect(["ONBOARDING", "SOURCE_SETUP", "DASHBOARD"]).toContain(body.ui?.nextScreen);

  // E2E user should be on DASHBOARD (has preferences + sources from seed)
  expect(body.onboarding?.completed).toBe(true);
  expect(body.onboarding?.requiresReboarding).toBe(false);
  expect(body.ui?.nextScreen).toBe("DASHBOARD");
});
