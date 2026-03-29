/**
 * permissions.spec.ts
 * Critical path: dashboard permission grants (by user and by role).
 *
 * Unauthenticated: auth enforcement on permissions API.
 * Authenticated (fixme): grant user access, verify it appears in list.
 */
import { test, expect } from "@playwright/test";

test.describe("Permissions — API auth enforcement", () => {
  test("GET /api/admin/permissions requires auth", async ({ request }) => {
    const res = await request.get("/api/admin/permissions");
    expect([401, 403, 429]).toContain(res.status());
  });

  test("POST /api/admin/permissions requires auth", async ({ request }) => {
    const res = await request.post("/api/admin/permissions", {
      data: { discord_id: "123456789012345678", permission_level: "viewer" },
    });
    expect([401, 403, 429]).toContain(res.status());
  });

  test("DELETE /api/admin/permissions/:id requires auth", async ({ request }) => {
    const res = await request.delete("/api/admin/permissions/1");
    expect([401, 403, 429]).toContain(res.status());
  });

  test("GET /api/admin/dashboard-role-permissions requires auth", async ({ request }) => {
    const res = await request.get("/api/admin/dashboard-role-permissions");
    expect([401, 403, 429]).toContain(res.status());
  });

  test("POST /api/admin/dashboard-role-permissions requires auth", async ({ request }) => {
    const res = await request.post("/api/admin/dashboard-role-permissions", {
      data: { role_id: "123456789012345678", permission_level: "viewer" },
    });
    expect([401, 403, 429]).toContain(res.status());
  });
});

test.describe("Permissions — Authenticated (requires stored session)", () => {
  test.fixme("permissions page loads with By User and By Role sections", async ({ page }) => {
    await page.goto("/dashboard/permissions");
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(/by user/i)).toBeVisible();
    await expect(page.getByText(/by role/i)).toBeVisible();
  });

  test.fixme("can grant a user permission and they appear in the list", async ({ page }) => {
    await page.goto("/dashboard/permissions");
    await page.waitForLoadState("networkidle");
    // Fill in user ID and level, submit, verify row appears
    await page.getByPlaceholder(/discord user id/i).fill("123456789012345678");
    await page.getByRole("button", { name: /grant/i }).click();
    await expect(page.getByText("123456789012345678")).toBeVisible({ timeout: 10_000 });
  });
});
