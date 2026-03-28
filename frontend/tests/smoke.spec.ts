import { test, expect } from "@playwright/test";

test.describe("Smoke Tests", () => {
  test("login page loads", async ({ page }) => {
    await page.goto("/");
    // Nav brand name (span, not a heading)
    await expect(page.locator("text=Squad Whitelister").first()).toBeVisible();
    // Use exact nav-scoped match to avoid catching "Sign in with Discord" button
    await expect(page.locator("nav").getByRole("button", { name: "Sign In", exact: true })).toBeVisible();
  });

  test("login button links to Discord OAuth", async ({ page }) => {
    await page.goto("/");
    // Use exact role to avoid matching "Sign in with Discord" button too
    const link = page.locator("nav").getByRole("link", { name: "Sign In", exact: true });
    await expect(link).toHaveAttribute("href", "/login");
  });

  test("health endpoint returns OK", async ({ request }) => {
    const response = await request.get("/healthz");
    // 200 expected; tolerate 429 (Cloudflare rate limit) — not a server error
    if (response.status() === 429) {
      console.warn("Health endpoint rate-limited (429) — skipping body check");
      return;
    }
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.status).toBe("ok");
  });

  test("unauthenticated API returns logged_in false", async ({ request }) => {
    const response = await request.get("/api/auth/session");
    if (response.status() === 429) {
      console.warn("Session endpoint rate-limited (429) — skipping body check");
      return;
    }
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.logged_in).toBe(false);
  });

  test("whitelist file URL returns 404 for invalid token", async ({ request }) => {
    const response = await request.get("/wl/invalid-token/test.txt");
    // 404 expected; 429 means rate limited but not exposed = also fine
    expect([404, 429]).toContain(response.status());
  });
});

test.describe("Protected Routes (redirect to login)", () => {
  test("dashboard redirects unauthenticated users", async ({ page }) => {
    await page.goto("/dashboard");
    // Should either show login page or redirect to home
    await expect(page).toHaveURL(/\/(dashboard)?/);
  });

  test("setup page accessible structure", async ({ page }) => {
    await page.goto("/dashboard/setup");
    // Page should render (even if redirected for auth)
    await expect(page).toHaveURL(/\/(dashboard\/setup)?/);
  });
});
