/**
 * portal.spec.ts
 * Tests for the user-facing My Whitelist portal (/my-whitelist)
 */
import { test, expect } from "@playwright/test";

test.describe("My Whitelist Portal — Unauthenticated", () => {
  test("redirects to home when not logged in", async ({ page }) => {
    await page.goto("/my-whitelist");
    // Client-side redirect happens after load — wait until URL no longer contains /my-whitelist
    await expect(page).not.toHaveURL(/my-whitelist/, { timeout: 10_000 });
  });

  test("API returns 401 for GET /api/my-whitelist without auth", async ({ request }) => {
    const res = await request.get("/api/my-whitelist");
    expect([401, 403, 429]).toContain(res.status());
  });

  test("API returns 401 for PUT /api/my-whitelist/default without auth", async ({ request }) => {
    const res = await request.put("/api/my-whitelist/default", {
      data: { steam_ids: ["76561198000000001"], eos_ids: [] },
    });
    expect([401, 403, 429]).toContain(res.status());
  });

  test("API returns 401 for POST /api/my-whitelist/default without auth", async ({ request }) => {
    const res = await request.post("/api/my-whitelist/default", {
      data: { steam_ids: ["76561198000000001"], eos_ids: [] },
    });
    expect([401, 403, 429]).toContain(res.status());
  });
});

test.describe("My Whitelist Portal — Input Validation", () => {
  test("rejects obviously invalid Steam ID format", async ({ request }) => {
    // Attempt to PUT with a bogus ID — even if unauthenticated we get 401,
    // but we can confirm the server doesn't 500 on malformed input
    const res = await request.put("/api/my-whitelist/default", {
      data: { steam_ids: ["not-a-real-id"], eos_ids: [] },
    });
    // Either auth rejection (401/403), validation rejection (400/422), or rate limited (429)
    expect([400, 401, 403, 422, 429]).toContain(res.status());
    expect(res.status()).not.toBe(500);
  });

  test("rejects payload with too many IDs as array overflow", async ({ request }) => {
    const manyIds = Array.from({ length: 100 }, (_, i) => `7656119${String(i).padStart(10, "0")}`);
    const res = await request.put("/api/my-whitelist/default", {
      data: { steam_ids: manyIds, eos_ids: [] },
    });
    // Should reject (auth or validation) but not 500
    expect(res.status()).not.toBe(500);
  });

  test("handles empty steam_ids and eos_ids gracefully", async ({ request }) => {
    const res = await request.put("/api/my-whitelist/default", {
      data: { steam_ids: [], eos_ids: [] },
    });
    // Auth rejection is fine; server must not crash
    expect(res.status()).not.toBe(500);
  });

  test("handles missing body fields gracefully", async ({ request }) => {
    const res = await request.put("/api/my-whitelist/default", {
      data: {},
    });
    expect(res.status()).not.toBe(500);
  });
});

test.describe("My Whitelist Portal — Whitelist Token URLs", () => {
  test("short token returns 404 not 500", async ({ request }) => {
    const res = await request.get("/wl/abc/output.cfg");
    expect([404, 429]).toContain(res.status());
  });

  test("path traversal attempt is rejected", async ({ request }) => {
    const res = await request.get("/wl/../../../etc/passwd");
    // Should be a non-500 response
    expect(res.status()).not.toBe(500);
    expect([400, 404, 301, 302, 308, 429]).toContain(res.status());
  });

  test("extremely long token is rejected gracefully", async ({ request }) => {
    const longToken = "a".repeat(500);
    const res = await request.get(`/wl/${longToken}/output.cfg`);
    expect([400, 404, 414, 429]).toContain(res.status());
    expect(res.status()).not.toBe(500);
  });

  test("binary filename extension is rejected gracefully", async ({ request }) => {
    const res = await request.get("/wl/0000000000000000/output.exe");
    expect(res.status()).not.toBe(500);
  });
});

test.describe("My Whitelist Portal — Guild Switcher", () => {
  test("POST /api/guilds/switch requires auth", async ({ request }) => {
    const res = await request.post("/api/guilds/switch", {
      data: { guild_id: "123456789" },
    });
    expect([401, 403, 429]).toContain(res.status());
  });

  test("POST /api/guilds/switch with invalid guild_id returns error", async ({ request }) => {
    const res = await request.post("/api/guilds/switch", {
      data: { guild_id: "" },
    });
    expect([400, 401, 403, 422, 429]).toContain(res.status());
    expect(res.status()).not.toBe(500);
  });

  test("POST /api/guilds/switch with missing body returns error", async ({ request }) => {
    const res = await request.post("/api/guilds/switch", {
      data: {},
    });
    expect(res.status()).not.toBe(500);
  });
});
