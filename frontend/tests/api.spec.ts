import { test, expect } from "@playwright/test";

test.describe("API Endpoint Tests", () => {
  test("GET /api/auth/session returns valid JSON", async ({ request }) => {
    const res = await request.get("/api/auth/session");
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body).toHaveProperty("logged_in");
  });

  test("GET /healthz returns status ok", async ({ request }) => {
    const res = await request.get("/healthz");
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body).toHaveProperty("guilds_cached");
    expect(body).toHaveProperty("files_cached");
  });

  test("GET /api/admin/stats requires auth", async ({ request }) => {
    const res = await request.get("/api/admin/stats");
    // Should return 401/403 or redirect, not 200
    expect([401, 403, 302].includes(res.status()) || !res.ok()).toBeTruthy();
  });

  test("GET /api/admin/settings requires auth", async ({ request }) => {
    const res = await request.get("/api/admin/settings");
    expect([401, 403, 302].includes(res.status()) || !res.ok()).toBeTruthy();
  });

  test("POST /api/admin/import requires auth", async ({ request }) => {
    const res = await request.post("/api/admin/import", {
      data: { data: "test", type: "default", format: "csv", mode: "skip" },
    });
    expect([401, 403, 302].includes(res.status()) || !res.ok()).toBeTruthy();
  });

  test("invalid whitelist file token returns 404", async ({ request }) => {
    const res = await request.get("/wl/0000000000000000/test.txt");
    expect(res.status()).toBe(404);
  });
});
