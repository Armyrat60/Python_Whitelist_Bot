/**
 * security.spec.ts
 * Security, injection, and boundary tests for all admin API endpoints.
 * These run against the live environment defined by BASE_URL.
 *
 * Note on 429: Cloudflare rate-limits rapid sequential requests.
 * A 429 means you're not getting through — equivalent to auth rejection for
 * these "requires auth" tests.
 */
import { test, expect } from "@playwright/test";

/** Status codes that all mean "you're not getting in". */
const DENIED = [401, 403, 404, 405, 429];

// Helper: assert that every admin endpoint rejects unauthenticated requests
const adminEndpoints: Array<{ method: "get" | "post" | "put" | "delete"; path: string; body?: object }> = [
  { method: "get",    path: "/api/admin/stats" },
  { method: "get",    path: "/api/admin/health" },
  { method: "get",    path: "/api/admin/settings" },
  // /api/admin/whitelists GET does not exist (no route registered) — 404 is correct
  { method: "get",    path: "/api/admin/whitelists" },
  { method: "get",    path: "/api/admin/panels" },
  { method: "get",    path: "/api/admin/tier-categories" },
  { method: "get",    path: "/api/admin/groups" },
  { method: "get",    path: "/api/admin/audit" },
  { method: "get",    path: "/api/admin/roles" },
  { method: "get",    path: "/api/admin/channels" },
  { method: "get",    path: "/api/admin/users?whitelist_slug=default&page=1&per_page=20" },
  { method: "post",   path: "/api/admin/resync" },
  { method: "post",   path: "/api/admin/whitelists", body: { name: "injection-test" } },
  { method: "post",   path: "/api/admin/panels", body: { name: "injection-test" } },
  { method: "post",   path: "/api/admin/tier-categories", body: { name: "injection-test" } },
  { method: "post",   path: "/api/admin/import", body: { data: "test", type: "default", format: "csv", mode: "skip" } },
  { method: "post",   path: "/api/admin/users/bulk-delete", body: { discord_ids: ["1"], whitelist_slug: "default" } },
  { method: "post",   path: "/api/admin/panels/1/push" },
  { method: "delete", path: "/api/admin/whitelists/1" },
  { method: "delete", path: "/api/admin/panels/1" },
  { method: "delete", path: "/api/admin/tier-categories/1" },
];

test.describe("Admin API — Authentication Required", () => {
  for (const endpoint of adminEndpoints) {
    test(`${endpoint.method.toUpperCase()} ${endpoint.path} requires auth`, async ({ request }) => {
      let res;
      if (endpoint.method === "get") {
        res = await request.get(endpoint.path);
      } else if (endpoint.method === "post") {
        res = await request.post(endpoint.path, { data: endpoint.body ?? {} });
      } else if (endpoint.method === "put") {
        res = await request.put(endpoint.path, { data: endpoint.body ?? {} });
      } else {
        res = await request.delete(endpoint.path);
      }
      // Must not return 200 — 401, 403, 404 (no route), or 429 (rate limited) all mean "denied"
      expect(DENIED).toContain(res.status());
      expect(res.status()).not.toBe(200);
    });
  }
});

test.describe("Admin API — Input Validation (unauthenticated)", () => {
  test("import with no body does not 500", async ({ request }) => {
    const res = await request.post("/api/admin/import", { data: {} });
    expect(res.status()).not.toBe(500);
  });

  test("import with SQL injection in data field does not 500", async ({ request }) => {
    const res = await request.post("/api/admin/import", {
      data: {
        data: "'; DROP TABLE whitelist_users; --",
        type: "default",
        format: "csv",
        mode: "skip",
      },
    });
    expect(res.status()).not.toBe(500);
  });

  test("creating whitelist with very long name does not 500", async ({ request }) => {
    const res = await request.post("/api/admin/whitelists", {
      data: { name: "x".repeat(10000) },
    });
    expect(res.status()).not.toBe(500);
  });

  test("settings PUT with XSS payload does not 500", async ({ request }) => {
    const res = await request.put("/api/admin/settings", {
      data: { welcome_dm_text: "<script>alert(1)</script>" },
    });
    expect(res.status()).not.toBe(500);
  });

  test("bulk-delete with empty array does not 500", async ({ request }) => {
    const res = await request.post("/api/admin/users/bulk-delete", {
      data: { discord_ids: [], whitelist_slug: "default" },
    });
    expect(res.status()).not.toBe(500);
  });

  test("audit endpoint with invalid page param does not 500", async ({ request }) => {
    const res = await request.get("/api/admin/audit?page=-1&per_page=abc");
    expect(res.status()).not.toBe(500);
  });
});

test.describe("General HTTP Security", () => {
  test("OPTIONS preflight does not crash the server", async ({ request }) => {
    const res = await request.fetch("/api/admin/stats", { method: "OPTIONS" });
    expect(res.status()).not.toBe(500);
  });

  test("PATCH method on non-PATCH endpoint returns correct error", async ({ request }) => {
    const res = await request.fetch("/api/admin/stats", { method: "PATCH" });
    expect([401, 403, 404, 405, 429]).toContain(res.status());
    expect(res.status()).not.toBe(500);
  });

  test("Content-Type application/xml is rejected cleanly", async ({ request }) => {
    const res = await request.post("/api/admin/whitelists", {
      headers: { "Content-Type": "application/xml" },
      data: "<whitelist><name>test</name></whitelist>",
    });
    expect([400, 401, 403, 415, 429]).toContain(res.status());
    expect(res.status()).not.toBe(500);
  });

  test("Sending null JSON body does not 500", async ({ request }) => {
    const res = await request.post("/api/admin/whitelists", {
      headers: { "Content-Type": "application/json" },
      data: "null",
    });
    expect(res.status()).not.toBe(500);
  });

  test("health endpoint never returns 500", async ({ request }) => {
    const res = await request.get("/healthz");
    expect([200, 429]).toContain(res.status());
    expect(res.status()).not.toBe(500);
  });

  test("unknown API path returns 404 not 500", async ({ request }) => {
    const res = await request.get("/api/admin/nonexistent-endpoint-xyzzy");
    expect([401, 403, 404, 429]).toContain(res.status());
    expect(res.status()).not.toBe(500);
  });

  test("very long URL does not cause 500", async ({ request }) => {
    const longPath = "/api/admin/" + "x".repeat(2000);
    const res = await request.get(longPath);
    expect([400, 401, 403, 404, 414, 429]).toContain(res.status());
    expect(res.status()).not.toBe(500);
  });
});

test.describe("Session Endpoint Contract", () => {
  test("session response shape is valid", async ({ request }) => {
    const res = await request.get("/api/auth/session");
    if (res.status() === 429) {
      console.warn("Session rate-limited (429) — skipping shape check");
      return;
    }
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body).toHaveProperty("logged_in");
    expect(typeof body.logged_in).toBe("boolean");
  });

  test("unauthenticated session has no guild data", async ({ request }) => {
    const res = await request.get("/api/auth/session");
    if (res.status() === 429) {
      console.warn("Session rate-limited (429) — skipping guild data check");
      return;
    }
    const body = await res.json();
    if (!body.logged_in) {
      expect(body.guilds ?? []).toHaveLength(0);
      expect(body.discord_id ?? "").toBe("");
    }
  });

  test("health response includes required fields", async ({ request }) => {
    const res = await request.get("/healthz");
    if (res.status() === 429) {
      console.warn("Health rate-limited (429) — skipping field check");
      return;
    }
    const body = await res.json();
    expect(body).toHaveProperty("status");
    expect(body).toHaveProperty("guilds_cached");
    expect(body).toHaveProperty("files_cached");
    expect(body.status).toBe("ok");
  });
});
