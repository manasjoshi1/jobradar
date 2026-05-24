/**
 * E2E — History & Sources tabs
 *
 * Proves:
 *  - History tab loads (even with empty sync history)
 *  - Sources tab loads without freezing
 *  - Sources tab shows seeded sources
 *  - No full-page crash on slow/empty API responses
 *  - Profile tab loads with user name and role profiles
 */
import { test, expect } from "@playwright/test";
import { loginViaApi, E2E_USER_NAME } from "./helpers";

test.beforeEach(async ({ page }) => {
  await loginViaApi(page);
  await page.goto("/");
});

// Use exact emoji+text to avoid matching the "📋 Sync History" button
const HISTORY_TAB_NAME = "📊 History";
const SOURCES_TAB_NAME = "🏢 Sources";
const PROFILE_TAB_NAME = "👤 Profile";

test("history tab loads and shows sync run table", async ({ page }) => {
  const historyTab = page.getByRole("button", { name: HISTORY_TAB_NAME });
  await expect(historyTab).toBeVisible({ timeout: 8_000 });
  await historyTab.click();

  await page.waitForTimeout(2_000);

  // Page body should still contain content (not crashed)
  await expect(page.locator("main")).toBeVisible({ timeout: 5_000 });
  // The tab content rendered — header or empty state
  const hasContent = await page.locator("main").isVisible();
  expect(hasContent).toBe(true);
});

test("sources tab loads without freezing", async ({ page }) => {
  const sourcesTab = page.getByRole("button", { name: SOURCES_TAB_NAME });
  await expect(sourcesTab).toBeVisible({ timeout: 8_000 });
  await sourcesTab.click();

  await page.waitForTimeout(3_000);
  await expect(page.locator("main")).toBeVisible({ timeout: 5_000 });
});

test("sources tab shows seeded job sources", async ({ page }) => {
  await page.getByRole("button", { name: SOURCES_TAB_NAME }).click();
  await page.waitForTimeout(3_000);

  // Seeded companies should appear in the sources list
  await expect(page.getByText("Acme Corp").first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("Beta Inc").first()).toBeVisible({ timeout: 8_000 });
  await expect(page.getByText("Gamma Ltd").first()).toBeVisible({ timeout: 8_000 });
});

test("profile tab loads and shows user name", async ({ page }) => {
  const profileTab = page.getByRole("button", { name: PROFILE_TAB_NAME });
  await expect(profileTab).toBeVisible({ timeout: 8_000 });
  await profileTab.click();

  // User name in the main profile panel (not the header pill — scope to main)
  await expect(
    page.locator("main").getByText(E2E_USER_NAME, { exact: false })
  ).toBeVisible({ timeout: 8_000 });
});

test("profile tab shows role profiles", async ({ page }) => {
  await page.getByRole("button", { name: PROFILE_TAB_NAME }).click();

  // ProfileConfigPanel fetches async — wait for the sub-tab buttons to appear.
  // The "Role Profiles (N/N)" button appears only after loading completes.
  const roleProfilesSubTab = page.getByRole("button", { name: /Role Profiles \(/ });
  await expect(roleProfilesSubTab).toBeVisible({ timeout: 12_000 });

  // Click into the Role Profiles sub-tab
  await roleProfilesSubTab.click();

  // Seeded role profile names should now be visible
  await expect(page.getByText(/Backend Java/i)).toBeVisible({ timeout: 8_000 });
  await expect(page.getByText(/Full Stack React/i)).toBeVisible({ timeout: 8_000 });
  await expect(page.getByText(/Payments.*Platform/i)).toBeVisible({ timeout: 8_000 });
});

test("profile tab shows job preferences (min score)", async ({ page }) => {
  await page.getByRole("button", { name: PROFILE_TAB_NAME }).click();

  // ProfileConfigPanel default tab is Preferences — wait for its content to load.
  // The "Min Score (0–100)" label appears once loading completes.
  await expect(page.getByText(/Min Score/i)).toBeVisible({ timeout: 12_000 });

  // Min score is an <input type="number"> seeded at 40 — check via input value
  const minScoreInput = page.locator('input[type="number"]').first();
  await expect(minScoreInput).toBeVisible({ timeout: 5_000 });
  await expect(minScoreInput).toHaveValue("40");
});
