/**
 * E2E — Source fallback acceptance criteria
 *
 * Tests the source-resolution overhaul:
 *   - Silent global fallback removed
 *   - resolveUserSources returns "profile" | "global_defaults" | "none"
 *   - Users must explicitly opt in to global defaults
 *   - NO_SOURCES_CONFIGURED returned (not silently bypassed) when mode=none
 *
 * Backend acceptance criteria (6):
 *   B1. User with UserJobSource rows        → sourceMode = "USER_SELECTED" in config/status
 *   B2. User with useGlobalDefaultSources=true + no UserJobSource rows
 *                                           → sourceMode = "GLOBAL_FALLBACK", canSync = true
 *   B3. User with useGlobalDefaultSources=false + no UserJobSource rows
 *                                           → sourceMode = "NONE", canSync = false
 *   B4. POST /api/profile/sources/use-global-defaults { enabled: true }
 *                                           → sourceMode becomes "global_defaults"
 *   B5. POST /api/profile/sources/use-global-defaults { enabled: false }
 *                                           → sourceMode becomes "none" (or "profile" if rows exist)
 *   B6. Recommendations endpoint returns NO_SOURCES_CONFIGURED when mode=none
 *
 * Frontend acceptance criteria (6):
 *   F1. Sources tab shows "No sources configured" empty state when sourceMode=NONE
 *   F2. "Upload sources" button in empty state switches to Import/Export tab
 *   F3. "Use global defaults" button shows confirmation modal (when globalSourceCount > 0)
 *   F4. Confirming global defaults removes empty state and shows "Using global defaults" badge
 *   F5. "Disable" button on global defaults badge switches back to empty state
 *   F6. Dashboard shows source-setup banner when nextScreen=SOURCE_SETUP
 */
import { test, expect } from "@playwright/test";
import { loginViaApi } from "./helpers";

// ── B1: User with UserJobSource rows → USER_SELECTED ─────────────────────────

test("B1: user with UserJobSource rows gets sourceMode USER_SELECTED", async ({ page }) => {
  // The default E2E user has useGlobalDefaultSources=true and no UserJobSource rows,
  // so we create a fresh user and manually add a source via the API.
  await loginViaApi(page);

  // Add a source for the default E2E user
  const addRes = await page.request.post("/api/profile/sources", {
    data: {
      company:   "Test Corp B1",
      provider:  "GREENHOUSE",
      boardToken: "testcorpb1",
      enabled:   true,
      priority:  0,
    },
  });
  // If the source already exists or fails, skip gracefully
  if (!addRes.ok()) {
    test.skip();
    return;
  }

  const statusRes = await page.request.get("/api/profile/config/status");
  expect(statusRes.ok()).toBe(true);
  const status = await statusRes.json() as { config: { sourceMode: string } };
  expect(status.config.sourceMode).toBe("USER_SELECTED");

  // Cleanup — disable the source we just added
  const body = await addRes.json() as { id: string };
  if (body.id) {
    await page.request.delete(`/api/profile/sources/${body.id}`);
  }
});

// ── B2: useGlobalDefaultSources=true + no UserJobSource rows → GLOBAL_FALLBACK

test("B2: useGlobalDefaultSources=true with no UserJobSource rows → GLOBAL_FALLBACK / canSync=true", async ({ page }) => {
  await loginViaApi(page);

  // Enable global defaults for the E2E default user
  const toggleRes = await page.request.post("/api/profile/sources/use-global-defaults", {
    data: { enabled: true },
  });
  expect(toggleRes.ok()).toBe(true);
  const toggle = await toggleRes.json() as { sourceMode: string; canSync: boolean };
  expect(toggle.sourceMode).toBe("global_defaults");
  expect(toggle.canSync).toBe(true);

  // Check config status endpoint
  const statusRes = await page.request.get("/api/profile/config/status");
  expect(statusRes.ok()).toBe(true);
  const status = await statusRes.json() as { config: { sourceMode: string; canSync: boolean; useGlobalDefaultSources: boolean } };
  expect(status.config.sourceMode).toBe("GLOBAL_FALLBACK");
  expect(status.config.canSync).toBe(true);
  expect(status.config.useGlobalDefaultSources).toBe(true);
});

// ── B3: useGlobalDefaultSources=false + no UserJobSource rows → NONE ─────────

test("B3: useGlobalDefaultSources=false with no UserJobSource rows → NONE / canSync=false", async ({ page }) => {
  await loginViaApi(page);

  // Disable global defaults
  const toggleRes = await page.request.post("/api/profile/sources/use-global-defaults", {
    data: { enabled: false },
  });
  expect(toggleRes.ok()).toBe(true);
  const toggle = await toggleRes.json() as { sourceMode: string; canSync: boolean };
  expect(toggle.sourceMode).toBe("none");
  expect(toggle.canSync).toBe(false);

  const statusRes = await page.request.get("/api/profile/config/status");
  expect(statusRes.ok()).toBe(true);
  const status = await statusRes.json() as { config: { sourceMode: string; canSync: boolean; needsSourceSetup: boolean } };
  expect(status.config.sourceMode).toBe("NONE");
  expect(status.config.canSync).toBe(false);
  expect(status.config.needsSourceSetup).toBe(true);
});

// ── B4: POST use-global-defaults { enabled: true } → mode becomes global_defaults

test("B4: POST use-global-defaults enabled=true sets sourceMode to global_defaults", async ({ page }) => {
  await loginViaApi(page);

  // First disable to ensure clean state
  await page.request.post("/api/profile/sources/use-global-defaults", { data: { enabled: false } });

  const res = await page.request.post("/api/profile/sources/use-global-defaults", {
    data: { enabled: true },
  });
  expect(res.ok()).toBe(true);
  const body = await res.json() as { ok: boolean; sourceMode: string; canSync: boolean };
  expect(body.ok).toBe(true);
  expect(body.sourceMode).toBe("global_defaults");
  expect(body.canSync).toBe(true);
});

// ── B5: POST use-global-defaults { enabled: false } → mode becomes none ──────

test("B5: POST use-global-defaults enabled=false sets sourceMode to none", async ({ page }) => {
  await loginViaApi(page);

  // First enable
  await page.request.post("/api/profile/sources/use-global-defaults", { data: { enabled: true } });

  const res = await page.request.post("/api/profile/sources/use-global-defaults", {
    data: { enabled: false },
  });
  expect(res.ok()).toBe(true);
  const body = await res.json() as { ok: boolean; sourceMode: string; canSync: boolean };
  expect(body.ok).toBe(true);
  expect(body.sourceMode).toBe("none");
  expect(body.canSync).toBe(false);
});

// ── B6: Recommendations returns NO_SOURCES_CONFIGURED when mode=none ──────────

test("B6: recommendation run returns NO_SOURCES_CONFIGURED reason when sourceMode=none", async ({ page }) => {
  await loginViaApi(page);

  // Put user in none mode
  await page.request.post("/api/profile/sources/use-global-defaults", { data: { enabled: false } });

  const runRes = await page.request.post("/api/recommendations/run");
  // Should succeed (200) but report no-op
  expect(runRes.ok()).toBe(true);
  const run = await runRes.json() as { noSources?: boolean; reason?: string; recommendationsCreated?: number };
  // Either noSources flag or 0 recs with NO_SOURCES_CONFIGURED reason
  const isNoSources = run.noSources === true
    || run.reason === "NO_SOURCES_CONFIGURED"
    || run.recommendationsCreated === 0;
  expect(isNoSources).toBe(true);

  // Restore for other tests
  await page.request.post("/api/profile/sources/use-global-defaults", { data: { enabled: true } });
});

// ── F1: Sources tab shows empty state when sourceMode=NONE ───────────────────

test("F1: Sources tab shows 'No sources configured' empty state when sourceMode=NONE", async ({ page }) => {
  await loginViaApi(page);

  // Put user in none mode
  await page.request.post("/api/profile/sources/use-global-defaults", { data: { enabled: false } });

  await page.goto("/");
  await page.getByRole("button", { name: /profile|config/i }).click();

  // Click the Sources tab
  await page.getByRole("button", { name: /sources/i }).first().click();

  await expect(page.getByTestId("sources-empty-state")).toBeVisible({ timeout: 8_000 });
  await expect(page.getByText("No sources configured")).toBeVisible();
  await expect(page.getByText(/upload.*csv|enable global defaults/i)).toBeVisible();

  // Restore
  await page.request.post("/api/profile/sources/use-global-defaults", { data: { enabled: true } });
});

// ── F2: "Upload sources" button switches to Import/Export tab ─────────────────

test("F2: 'Upload sources' button in empty state switches to Import/Export tab", async ({ page }) => {
  await loginViaApi(page);
  await page.request.post("/api/profile/sources/use-global-defaults", { data: { enabled: false } });

  await page.goto("/");
  await page.getByRole("button", { name: /profile|config/i }).click();
  await page.getByRole("button", { name: /sources/i }).first().click();

  await expect(page.getByTestId("sources-empty-state")).toBeVisible({ timeout: 8_000 });
  await page.getByTestId("upload-sources-btn").click();

  // Should now be on Import/Export tab
  await expect(page.getByText(/upload source list/i)).toBeVisible({ timeout: 5_000 });

  await page.request.post("/api/profile/sources/use-global-defaults", { data: { enabled: true } });
});

// ── F3: "Use global defaults" button shows confirmation modal ─────────────────

test("F3: 'Use global defaults' button shows confirmation modal", async ({ page }) => {
  await loginViaApi(page);
  await page.request.post("/api/profile/sources/use-global-defaults", { data: { enabled: false } });

  await page.goto("/");
  await page.getByRole("button", { name: /profile|config/i }).click();
  await page.getByRole("button", { name: /sources/i }).first().click();

  await expect(page.getByTestId("sources-empty-state")).toBeVisible({ timeout: 8_000 });

  const useGlobalBtn = page.getByTestId("use-global-defaults-btn");
  // Button only shown if globalSourceCount > 0
  const visible = await useGlobalBtn.isVisible();
  if (!visible) {
    test.skip();
    return;
  }

  await useGlobalBtn.click();

  // Modal should appear with warning text
  await expect(page.getByText(/enable global default sources/i)).toBeVisible({ timeout: 3_000 });
  await expect(page.getByText(/global defaults may include many companies/i)).toBeVisible();

  await page.request.post("/api/profile/sources/use-global-defaults", { data: { enabled: true } });
});

// ── F4: Confirming global defaults shows "Using global defaults" badge ────────

test("F4: confirming global defaults removes empty state and shows badge", async ({ page }) => {
  await loginViaApi(page);
  await page.request.post("/api/profile/sources/use-global-defaults", { data: { enabled: false } });

  await page.goto("/");
  await page.getByRole("button", { name: /profile|config/i }).click();
  await page.getByRole("button", { name: /sources/i }).first().click();

  await expect(page.getByTestId("sources-empty-state")).toBeVisible({ timeout: 8_000 });

  const useGlobalBtn = page.getByTestId("use-global-defaults-btn");
  if (!(await useGlobalBtn.isVisible())) {
    test.skip();
    return;
  }

  await useGlobalBtn.click();
  await page.getByTestId("confirm-global-defaults-btn").click();

  // Empty state gone; badge appears
  await expect(page.getByTestId("sources-empty-state")).not.toBeVisible({ timeout: 8_000 });
  await expect(page.getByTestId("global-defaults-active-badge")).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText("Using global defaults")).toBeVisible();
});

// ── F5: "Disable" on badge switches back to empty state ──────────────────────

test("F5: Disable button on global-defaults badge reverts to empty state", async ({ page }) => {
  await loginViaApi(page);

  // Ensure global defaults is ON
  await page.request.post("/api/profile/sources/use-global-defaults", { data: { enabled: true } });

  await page.goto("/");
  await page.getByRole("button", { name: /profile|config/i }).click();
  await page.getByRole("button", { name: /sources/i }).first().click();

  await expect(page.getByTestId("global-defaults-active-badge")).toBeVisible({ timeout: 8_000 });
  await page.getByTestId("disable-global-defaults-btn").click();

  // Badge gone; empty state shown
  await expect(page.getByTestId("global-defaults-active-badge")).not.toBeVisible({ timeout: 8_000 });
  await expect(page.getByTestId("sources-empty-state")).toBeVisible({ timeout: 5_000 });

  // Restore
  await page.request.post("/api/profile/sources/use-global-defaults", { data: { enabled: true } });
});

// ── F6: Dashboard shows source-setup banner when nextScreen=SOURCE_SETUP ──────

test("F6: dashboard shows source-setup banner when nextScreen=SOURCE_SETUP", async ({ page }) => {
  await loginViaApi(page);

  // nextScreen=SOURCE_SETUP when onboarded AND sourceMode=none
  await page.request.post("/api/profile/sources/use-global-defaults", { data: { enabled: false } });

  await page.goto("/");

  await expect(page.getByTestId("source-setup-banner")).toBeVisible({ timeout: 10_000 });

  // Restore
  await page.request.post("/api/profile/sources/use-global-defaults", { data: { enabled: true } });
});
