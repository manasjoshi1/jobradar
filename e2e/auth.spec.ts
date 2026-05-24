/**
 * E2E — Authentication flow
 *
 * Proves:
 *  - Unauthenticated "/" redirects to "/login"
 *  - Wrong credentials show error message
 *  - Correct email + password logs in and shows the user name in header
 *  - Logout returns to /login
 */
import { test, expect } from "@playwright/test";
import { E2E_EMAIL, E2E_PASSWORD, E2E_USER_NAME } from "./helpers";

// Each test starts fresh — no shared auth state
test.use({ storageState: { cookies: [], origins: [] } });

test("unauthenticated visit to / redirects to /login", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
});

test("wrong password shows error", async ({ page }) => {
  await page.goto("/login");
  await page.locator("#email").fill(E2E_EMAIL);
  await page.locator("#password").fill("wrong-password-xyz");
  await page.getByRole("button", { name: /sign in/i }).click();

  // Error message should appear — "Invalid email or password"
  await expect(page.getByText(/invalid email or password/i)).toBeVisible({ timeout: 8_000 });

  // Should stay on /login
  await expect(page).toHaveURL(/\/login/);
});

test("empty password keeps submit disabled", async ({ page }) => {
  await page.goto("/login");
  const btn = page.getByRole("button", { name: /sign in/i });
  // Button should be disabled while both fields are empty
  await expect(btn).toBeDisabled();
});

test("correct password logs in and shows user name", async ({ page }) => {
  await page.goto("/login");
  await page.locator("#email").fill(E2E_EMAIL);
  await page.locator("#password").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();

  // Should navigate away from /login
  await expect(page).toHaveURL("/", { timeout: 15_000 });

  // User name appears in header
  await expect(page.getByText(E2E_USER_NAME, { exact: false })).toBeVisible({ timeout: 8_000 });
});

test("logout returns to /login", async ({ page }) => {
  // Log in first
  await page.goto("/login");
  await page.locator("#email").fill(E2E_EMAIL);
  await page.locator("#password").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL("/", { timeout: 15_000 });

  // Find and click the logout button (icon button next to user name)
  // The button has aria-label="Log out" per LoginForm.tsx / JobBoardClient.tsx
  // Logout button has title="Sign out" (aria accessible name)
  const logoutBtn = page.getByRole("button", { name: /sign out/i });
  await expect(logoutBtn).toBeVisible({ timeout: 8_000 });
  await logoutBtn.click();

  // Should end up on /login
  await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
});

test("session persists across page reload", async ({ page }) => {
  await page.goto("/login");
  await page.locator("#email").fill(E2E_EMAIL);
  await page.locator("#password").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL("/", { timeout: 15_000 });

  // Reload the page — cookie should still be valid
  await page.reload();
  await expect(page).toHaveURL("/");
  await expect(page.getByText(E2E_USER_NAME, { exact: false })).toBeVisible({ timeout: 8_000 });
});
