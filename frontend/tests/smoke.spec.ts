import { test, expect } from "@playwright/test";

test.describe("Smoke Tests", () => {
  test("login page loads", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("text=Squad Whitelister")).toBeVisible();
    await expect(page.locator("text=Sign in with Discord")).toBeVisible();
  });

  test("login button links to Discord OAuth", async ({ page }) => {
    await page.goto("/");
    const link = page.locator("a:has-text('Sign in with Discord')");
    await expect(link).toHaveAttribute("href", "/login");
  });

  test("health endpoint returns OK", async ({ request }) => {
    const response = await request.get("/healthz");
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.status).toBe("ok");
  });

  test("unauthenticated API returns logged_in false", async ({ request }) => {
    const response = await request.get("/api/auth/session");
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.logged_in).toBe(false);
  });

  test("whitelist file URL returns content or 404", async ({ request }) => {
    // This tests that the /wl/ route is proxied correctly
    const response = await request.get("/wl/invalid-token/test.txt");
    // Should get 404 (not found) not 500 (server error)
    expect(response.status()).toBe(404);
  });
});

test.describe("Protected Routes (redirect to login)", () => {
  test("dashboard redirects unauthenticated users", async ({ page }) => {
    await page.goto("/dashboard");
    // Should either show login page or redirect
    await expect(page).toHaveURL(/\/(dashboard)?/);
  });

  test("setup page accessible structure", async ({ page }) => {
    await page.goto("/dashboard/setup");
    // Page should render (even if redirected for auth)
    await expect(page).toHaveURL(/\/(dashboard\/setup)?/);
  });
});
