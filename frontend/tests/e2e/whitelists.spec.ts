/**
 * whitelists.spec.ts
 * Critical path: whitelist management.
 *
 * Unauthenticated: auth enforcement checks.
 * Authenticated (fixme): create, view, assign roles to whitelist.
 */
import { test, expect } from "@playwright/test";

test.describe("Whitelists — API auth enforcement", () => {
  test("GET /api/admin/whitelists requires auth", async ({ request }) => {
    const res = await request.get("/api/admin/whitelists");
    expect([401, 403, 404, 429]).toContain(res.status());
  });

  test("POST /api/admin/whitelists requires auth", async ({ request }) => {
    const res = await request.post("/api/admin/whitelists", {
      data: { name: "e2e-test-wl", slug: "e2e-test" },
    });
    expect([401, 403, 429]).toContain(res.status());
  });

  test("DELETE /api/admin/whitelists/1 requires auth", async ({ request }) => {
    const res = await request.delete("/api/admin/whitelists/1");
    expect([401, 403, 429]).toContain(res.status());
  });

  test("GET /api/admin/role-stats requires auth", async ({ request }) => {
    const res = await request.get("/api/admin/role-stats");
    expect([401, 403, 429]).toContain(res.status());
  });
});

test.describe("Whitelists — Authenticated (requires stored session)", () => {
  test.fixme("whitelist page renders cards for each whitelist", async ({ page }) => {
    await page.goto("/dashboard/whitelists");
    await expect(page.locator("[data-testid='whitelist-card']").first()).toBeVisible();
  });

  test.fixme("can create a whitelist and it appears in the list", async ({ page }) => {
    await page.goto("/dashboard/whitelists");
    await page.getByRole("button", { name: /new whitelist/i }).click();
    await page.getByLabel("Name").fill("E2E Test Whitelist");
    await page.getByRole("button", { name: /create/i }).click();
    await expect(page.getByText("E2E Test Whitelist")).toBeVisible();
  });
});
