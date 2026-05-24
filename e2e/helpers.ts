/**
 * Shared E2E helpers.
 * Imported by individual spec files — keeps tests DRY.
 */
import { type Page, expect } from "@playwright/test";

export const E2E_EMAIL    = "e2e@jobradar.test";
export const E2E_PASSWORD = "JobRadarE2E!";
export const E2E_USER_NAME = "Default User";

/**
 * Log in via the /login page.
 * After success the browser is on "/" (home).
 */
export async function login(page: Page, email = E2E_EMAIL, password = E2E_PASSWORD) {
  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();

  // Hard redirect lands on home — wait for the jobs tab to appear
  await expect(page).toHaveURL("/", { timeout: 15_000 });
}

/**
 * Log in via the API (faster, no browser interaction).
 * Returns the cookies so they can be added to the page context.
 */
export async function loginViaApi(page: Page, email = E2E_EMAIL, password = E2E_PASSWORD) {
  const res = await page.request.post("/api/auth/login", {
    data: { email, password },
  });

  if (!res.ok()) {
    throw new Error(`Login API failed: ${res.status()} ${await res.text()}`);
  }

  // The cookie is set automatically into the page context by Playwright
  return res;
}

/**
 * Assert that the page shows a "Default User" pill somewhere in the header.
 */
export async function expectLoggedIn(page: Page) {
  await expect(page.getByText(E2E_USER_NAME, { exact: false })).toBeVisible({ timeout: 10_000 });
}
