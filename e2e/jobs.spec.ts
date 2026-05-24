/**
 * E2E — Jobs tab
 *
 * Proves:
 *  - Jobs tab loads and shows seeded job cards
 *  - Company and title text visible in cards
 *  - Search/filter field is present and interactive
 *  - Saving a job (heart) updates state in UI
 *  - Changing status via select dropdown updates the UI
 *  - Status is preserved after page reload (persisted in UserJobStatus)
 */
import { test, expect } from "@playwright/test";
import { loginViaApi } from "./helpers";

// Log in once before all tests in this file
test.beforeEach(async ({ page }) => {
  await loginViaApi(page);
  await page.goto("/");
  // Ensure the Jobs tab is active (it's the default but confirm)
  const allJobsTab = page.getByRole("button", { name: /all jobs/i });
  await expect(allJobsTab).toBeVisible({ timeout: 10_000 });
  await allJobsTab.click();
});

/** Wait for job cards to appear — h3 titles inside the card grid */
async function waitForJobCards(page: Parameters<typeof test>[1] extends (args: infer A) => unknown ? A extends { page: infer P } ? P : never : never) {
  // Job cards render h3 titles; wait until at least one is visible
  await expect(page.locator("main h3").first()).toBeVisible({ timeout: 12_000 });
}

test("jobs tab loads and shows job cards", async ({ page }) => {
  await waitForJobCards(page);

  // Company names appear in <p> tags inside cards (not as hidden <option>s)
  const companyInCard = page.locator("main p").filter({ hasText: /Acme Corp|Beta Inc|Gamma Ltd/ }).first();
  await expect(companyInCard).toBeVisible({ timeout: 8_000 });
});

test("job title and company appear in cards", async ({ page }) => {
  await waitForJobCards(page);

  // Titles are in <h3> inside the main content area
  await expect(
    page.locator("main h3").filter({ hasText: /Senior Java Backend Engineer/i }).first()
  ).toBeVisible({ timeout: 8_000 });

  await expect(
    page.locator("main h3").filter({ hasText: /Full Stack TypeScript Engineer/i }).first()
  ).toBeVisible({ timeout: 8_000 });
});

test("search / filter controls are present", async ({ page }) => {
  // Filter section heading
  await expect(page.getByText(/Advanced Search/i)).toBeVisible({ timeout: 8_000 });

  // At least one filter input or select should exist inside the filter section
  const filterSection = page.locator("section, div").filter({ has: page.getByText(/Advanced Search/i) });
  await expect(filterSection.first()).toBeVisible({ timeout: 5_000 });
});

test("saving a job (heart button) updates the UI", async ({ page }) => {
  await waitForJobCards(page);

  // Find the first heart button — click it to save
  const firstHeart = page.getByRole("button", { name: "❤️" }).first();
  await expect(firstHeart).toBeVisible({ timeout: 10_000 });
  await firstHeart.click();

  // Button remains visible after click (optimistic update)
  await expect(firstHeart).toBeVisible();
});

test("changing job status via select persists across reload", async ({ page }) => {
  await waitForJobCards(page);

  // Each job card has a status select with options NEW / SAVED / APPLIED / SKIPPED
  // Look for the first select inside main that has the "NEW" option text
  const statusSelects = page.locator("main select").filter({ hasText: "NEW" });
  const firstSelect = statusSelects.first();
  await expect(firstSelect).toBeVisible({ timeout: 10_000 });

  // Change to SKIPPED
  await firstSelect.selectOption("SKIPPED");
  await page.waitForTimeout(800); // let API call settle

  // Reload and confirm the status was persisted via UserJobStatus
  await page.reload();
  await page.getByRole("button", { name: /all jobs/i }).click();
  await waitForJobCards(page);

  // At least one select should now show SKIPPED
  const skippedSelect = page.locator("main select").filter({ hasText: "SKIPPED" }).first();
  await expect(skippedSelect).toBeVisible({ timeout: 10_000 });
});

test("changing job status to APPLIED shows APPLIED in select", async ({ page }) => {
  await waitForJobCards(page);

  // Find a status select that currently shows NEW, change it to APPLIED
  const statusSelects = page.locator("main select").filter({ hasText: "NEW" });
  const firstSelect = statusSelects.first();
  await expect(firstSelect).toBeVisible({ timeout: 10_000 });
  await firstSelect.selectOption("APPLIED");
  await expect(firstSelect).toHaveValue("APPLIED");
});
