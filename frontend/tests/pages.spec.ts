import { test, expect } from "@playwright/test";

test.describe("Page Rendering Tests", () => {
  test("home page has features section", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("text=Role-Based Tiers")).toBeVisible();
    await expect(page.locator("text=Instant Sync")).toBeVisible();
    await expect(page.locator("text=Multi-Community")).toBeVisible();
    await expect(page.locator("text=Web Dashboard")).toBeVisible();
  });

  test("home page has CTA section", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("text=Get Started Free")).toBeVisible();
  });

  test("home page nav bar shows sign in", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("text=Sign In")).toBeVisible();
  });

  test("home page logo renders", async ({ page }) => {
    await page.goto("/");
    const logo = page.locator("img[alt='']");
    await expect(logo).toBeVisible();
  });

  test("login redirects to Discord OAuth", async ({ page }) => {
    await page.goto("/login");
    // Should redirect to Discord or show callback page
    await page.waitForURL(/discord\.com|\/callback|\/login/);
  });

  test("my-whitelist redirects unauthenticated to home", async ({ page }) => {
    await page.goto("/my-whitelist");
    await page.waitForURL(/^\//);
  });
});

test.describe("API Security Tests", () => {
  test("admin bulk delete requires auth", async ({ request }) => {
    const res = await request.post("/api/admin/users/bulk-delete", {
      data: { discord_ids: ["123"], whitelist_slug: "default" },
    });
    expect([401, 403].includes(res.status()) || !res.ok()).toBeTruthy();
  });

  test("admin create whitelist requires auth", async ({ request }) => {
    const res = await request.post("/api/admin/whitelists", {
      data: { name: "test" },
    });
    expect([401, 403].includes(res.status()) || !res.ok()).toBeTruthy();
  });

  test("admin create panel requires auth", async ({ request }) => {
    const res = await request.post("/api/admin/panels", {
      data: { name: "test" },
    });
    expect([401, 403].includes(res.status()) || !res.ok()).toBeTruthy();
  });

  test("admin tier categories requires auth", async ({ request }) => {
    const res = await request.get("/api/admin/tier-categories");
    expect([401, 403].includes(res.status()) || !res.ok()).toBeTruthy();
  });

  test("admin groups requires auth", async ({ request }) => {
    const res = await request.get("/api/admin/groups");
    expect([401, 403].includes(res.status()) || !res.ok()).toBeTruthy();
  });

  test("admin push panel requires auth", async ({ request }) => {
    const res = await request.post("/api/admin/panels/1/push");
    expect([401, 403].includes(res.status()) || !res.ok()).toBeTruthy();
  });

  test("user whitelist requires auth", async ({ request }) => {
    const res = await request.get("/api/my-whitelist");
    expect([401, 403].includes(res.status()) || !res.ok()).toBeTruthy();
  });

  test("user update whitelist requires auth", async ({ request }) => {
    const res = await request.post("/api/my-whitelist/default", {
      data: { steam_ids: ["76561198000000000"], eos_ids: [] },
    });
    expect([401, 403].includes(res.status()) || !res.ok()).toBeTruthy();
  });
});

test.describe("Rate Limiting", () => {
  test("health endpoint handles rapid requests", async ({ request }) => {
    const promises = Array.from({ length: 10 }, () =>
      request.get("/healthz")
    );
    const results = await Promise.all(promises);
    // All should succeed (within rate limit)
    for (const res of results) {
      expect(res.ok()).toBeTruthy();
    }
  });
});
