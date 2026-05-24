/**
 * E2E — Profile Config API
 * Smoke-tests the editable config endpoints.
 */
import { test, expect } from "@playwright/test";
import { loginViaApi } from "./helpers";

test.beforeEach(async ({ page }) => {
  await loginViaApi(page);
});

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
  // First get current
  const statusRes = await page.request.get("/api/profile/config/status");
  const status = await statusRes.json() as { preferences?: { minScore?: number } };
  const originalScore = status.preferences?.minScore ?? 45;

  // Update
  const newScore = originalScore === 50 ? 55 : 50;
  const patchRes = await page.request.patch("/api/profile/preferences", {
    data: { minScore: newScore },
  });
  expect(patchRes.status()).toBe(200);
  const updated = await patchRes.json() as { minScore?: number };
  expect(updated.minScore).toBe(newScore);

  // Restore
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

  // Clean up — soft delete
  if (created.id) {
    await page.request.delete(`/api/profile/role-profiles/${created.id}`);
  }
});

test("Profile config UI tab is accessible", async ({ page }) => {
  await page.goto("/");
  // Click the Profile tab
  const profileTab = page.getByRole("button", { name: /profile/i });
  await expect(profileTab).toBeVisible({ timeout: 10_000 });
  await profileTab.click();
  // Should show some config content
  await expect(page.locator("main")).toBeVisible();
});
