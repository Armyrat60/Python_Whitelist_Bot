/**
 * panels.spec.ts
 * Critical path: panel management.
 *
 * Unauthenticated: auth enforcement.
 * Authenticated (fixme): create panel, assign channel, verify card appears.
 */
import { test, expect } from "@playwright/test";

test.describe("Panels — API auth enforcement", () => {
  test("GET /api/admin/panels requires auth", async ({ request }) => {
    const res = await request.get("/api/admin/panels");
    expect([401, 403, 404, 429]).toContain(res.status());
  });

  test("POST /api/admin/panels requires auth", async ({ request }) => {
    const res = await request.post("/api/admin/panels", {
      data: { name: "E2E Panel", whitelist_slug: "default" },
    });
    expect([401, 403, 429]).toContain(res.status());
  });

  test("POST /api/admin/panels/1/push requires auth", async ({ request }) => {
    const res = await request.post("/api/admin/panels/1/push");
    expect([401, 403, 429]).toContain(res.status());
  });

  test("GET /api/admin/channels requires auth", async ({ request }) => {
    const res = await request.get("/api/admin/channels");
    expect([401, 403, 429]).toContain(res.status());
  });
});

test.describe("Panels — Authenticated (requires stored session)", () => {
  test.fixme("panels page loads and shows existing panels", async ({ page }) => {
    await page.goto("/dashboard/panels");
    await page.waitForLoadState("networkidle");
    // Either shows panel cards or empty state — must not 500
    await expect(page.locator("h1, h2").first()).toBeVisible();
  });

  test.fixme("can create a panel and it appears in the list", async ({ page }) => {
    await page.goto("/dashboard/panels");
    await page.getByRole("button", { name: /new panel/i }).click();
    await page.getByLabel("Name").fill("E2E Test Panel");
    await page.getByRole("button", { name: /create/i }).click();
    await expect(page.getByText("E2E Test Panel")).toBeVisible();
  });
});
