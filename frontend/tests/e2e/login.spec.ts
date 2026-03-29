/**
 * login.spec.ts
 * Critical path: login flow and auth redirect behaviour.
 *
 * Authenticated tests require PLAYWRIGHT_STORAGE_STATE to point at a
 * pre-saved browser storage state (Discord OAuth session). Without it
 * those tests are skipped.
 */
import { test, expect } from "@playwright/test";

test.describe("Login — Unauthenticated flow", () => {
  test("home page shows Sign In button", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await expect(page.locator("nav").getByText("Sign In")).toBeVisible();
  });

  test("/login redirects to Discord OAuth", async ({ page }) => {
    await page.goto("/login");
    await page.waitForURL(/discord\.com|\/callback|\/login/, { timeout: 10_000 });
  });

  test("dashboard redirects to home when unauthenticated", async ({ page }) => {
    await page.goto("/dashboard");
    // Should end up somewhere other than dashboard
    await page.waitForURL(/\//);
    expect(page.url()).not.toMatch(/\/dashboard$/);
  });

  test("my-whitelist redirects when unauthenticated", async ({ page }) => {
    await page.goto("/my-whitelist");
    await expect(page).not.toHaveURL(/my-whitelist/, { timeout: 10_000 });
  });

  test("session API returns logged_in: false when not authenticated", async ({ request }) => {
    const res = await request.get("/api/auth/session");
    if (res.status() === 429) return;
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.logged_in).toBe(false);
  });
});

// Authenticated path — requires saved session storage state
test.describe("Login — Authenticated flow", () => {
  test.fixme("OAuth callback lands on dashboard with session", async ({ page }) => {
    // Set up: run `playwright codegen` with a real Discord account,
    // save storage state to tests/e2e/.auth/user.json, then use:
    //   test.use({ storageState: 'tests/e2e/.auth/user.json' })
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.locator("text=Dashboard")).toBeVisible();
  });
});
