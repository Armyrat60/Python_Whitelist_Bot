/**
 * users.spec.ts
 * Critical path: users (roster) management.
 *
 * Unauthenticated: auth enforcement on users API.
 * Authenticated (fixme): page loads, empty state, search.
 */
import { test, expect } from "@playwright/test";

test.describe("Users — API auth enforcement", () => {
  test("GET /api/admin/users requires auth", async ({ request }) => {
    const res = await request.get("/api/admin/users?whitelist_slug=default&page=1&per_page=20");
    expect([401, 403, 429]).toContain(res.status());
  });

  test("PATCH /api/admin/users/:id/:type requires auth", async ({ request }) => {
    const res = await request.patch("/api/admin/users/123456789012345678/default", {
      data: { status: "active" },
    });
    expect([401, 403, 429]).toContain(res.status());
  });

  test("DELETE /api/admin/users/:id/:type requires auth", async ({ request }) => {
    const res = await request.delete("/api/admin/users/123456789012345678/default");
    expect([401, 403, 429]).toContain(res.status());
  });

  test("POST /api/admin/users/bulk-delete requires auth", async ({ request }) => {
    const res = await request.post("/api/admin/users/bulk-delete", {
      data: { discord_ids: ["123456789012345678"], whitelist_slug: "default" },
    });
    expect([401, 403, 429]).toContain(res.status());
  });
});

test.describe("Users — Authenticated (requires stored session)", () => {
  test.fixme("users page loads without error", async ({ page }) => {
    await page.goto("/dashboard/users");
    await page.waitForLoadState("networkidle");
    // Table or empty state must be visible
    await expect(page.locator("table, [data-testid='empty-state']").first()).toBeVisible({ timeout: 15_000 });
  });

  test.fixme("search filters the user list", async ({ page }) => {
    await page.goto("/dashboard/users");
    await page.waitForLoadState("networkidle");
    const searchInput = page.getByPlaceholder(/search/i);
    await searchInput.fill("test");
    await page.waitForTimeout(500); // debounce
    // Result set should be present (may be empty if no match)
    await expect(page.locator("table tbody, [data-testid='empty-state']").first()).toBeVisible();
  });
});
