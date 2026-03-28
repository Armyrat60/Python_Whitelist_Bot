import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  // Run sequentially against the live site — parallel workers trigger Cloudflare rate limiting (429)
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  workers: 1,
  reporter: "html",
  use: {
    baseURL: process.env.BASE_URL || "https://squadwhitelister.com",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    // Give the live site more time to respond
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
});
