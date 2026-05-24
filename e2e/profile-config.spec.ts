/**
 * E2E — Profile Config API + UI import path
 *
 * Smoke-tests:
 *  - Config status API shape
 *  - Preferences PATCH
 *  - Role profile POST (create + soft-delete)
 *  - YAML import via UI (upload/import path, not just API smoke)
 */
import { test, expect } from "@playwright/test";
import { loginViaApi } from "./helpers";

test.beforeEach(async ({ page }) => {
  await loginViaApi(page);
});

// ── API smoke ─────────────────────────────────────────────────────────────────

test("GET /api/profile/config/status returns valid shape", async ({ page }) => {
  const res = await page.request.get("/api/profile/config/status");
  expect(res.status()).toBe(200);
  const body = await res.json() as {
    user?: object;
    preferences?: object;
    roleProfiles?: { total: number; items: unknown[] };
    sources?: { total: number; items: unknown[] };
  };
  expect(body.user).toBeDefined();
  expect(body.preferences).toBeDefined();
  expect(body.roleProfiles).toBeDefined();
  expect(body.sources).toBeDefined();
});

test("PATCH /api/profile/preferences updates minScore", async ({ page }) => {
  // Get current
  const statusRes = await page.request.get("/api/profile/config/status");
  const status = await statusRes.json() as { preferences?: { minScore?: number } };
  const originalScore = status.preferences?.minScore ?? 45;

  // Update to a different value
  const newScore = originalScore === 50 ? 55 : 50;
  const patchRes = await page.request.patch("/api/profile/preferences", {
    data: { minScore: newScore },
  });
  expect(patchRes.status()).toBe(200);
  const updated = await patchRes.json() as { minScore?: number };
  expect(updated.minScore).toBe(newScore);

  // Restore original
  await page.request.patch("/api/profile/preferences", {
    data: { minScore: originalScore },
  });
});

test("POST /api/profile/role-profiles creates a profile", async ({ page }) => {
  const createRes = await page.request.post("/api/profile/role-profiles", {
    data: {
      name: "E2E Test Profile",
      enabled: true,
      priority: 1,
      minScore: 40,
      mustHaveKeywords: ["test"],
      niceHaveKeywords: [],
      negativeKeywords: [],
      preferredTitles: ["Test Engineer"],
      preferredLocations: ["remote"],
    },
  });
  expect(createRes.status()).toBe(201);
  const created = await createRes.json() as { id?: string; name?: string };
  expect(created.name).toBe("E2E Test Profile");

  // Soft-delete to clean up
  if (created.id) {
    await page.request.delete(`/api/profile/role-profiles/${created.id}`);
  }
});

// ── UI import path ────────────────────────────────────────────────────────────

test("YAML import via UI successfully imports user preferences", async ({ page }) => {
  await page.goto("/");

  // Open Profile tab
  await page.getByRole("button", { name: /👤 Profile/i }).click();

  // Wait for ProfileConfigPanel to load — "Import / Export" sub-tab button appears after loading
  await expect(page.getByRole("button", { name: "Import / Export" })).toBeVisible({ timeout: 12_000 });

  // Navigate to Import/Export sub-tab
  await page.getByRole("button", { name: "Import / Export" }).click();

  // Paste a minimal user-preferences YAML
  const testYaml = [
    "preferences:",
    "  minScore: 43",
    "  requiresSponsorship: false",
    "  targetLocations:",
    "    - remote",
    "    - united states",
    "  targetRoles:",
    "    - software engineer",
    "    - backend engineer",
    "  blockedCompanies: []",
    "  preferredCompanies: []",
  ].join("\n");

  // The paste textarea is the YAML input
  const yamlTextarea = page.locator("textarea").last();
  await yamlTextarea.fill(testYaml);

  // Make sure "User Profile" import type is selected (it's the default).
  // exact:true is required — "Export User Profile" button also contains the substring.
  await page.getByRole("button", { name: "User Profile", exact: true }).click();

  // Click Import button (exact match to avoid hitting "Importing…" disabled variant)
  await page.getByRole("button", { name: /^Import$/ }).click();

  // Should show success
  await expect(page.getByText("Import successful")).toBeVisible({ timeout: 10_000 });

  // Verify via API that preferences were actually updated
  const statusRes = await page.request.get("/api/profile/config/status");
  expect(statusRes.status()).toBe(200);
  const body = await statusRes.json() as { preferences?: { minScore?: number } };
  expect(body.preferences?.minScore).toBe(43);

  // Restore original seed value
  await page.request.patch("/api/profile/preferences", { data: { minScore: 40 } });
});

// ── Profile UI accessibility ──────────────────────────────────────────────────

test("Profile config UI tab is accessible", async ({ page }) => {
  await page.goto("/");
  const profileTab = page.getByRole("button", { name: /👤 Profile/i });
  await expect(profileTab).toBeVisible({ timeout: 10_000 });
  await profileTab.click();
  await expect(page.locator("main")).toBeVisible();
});
