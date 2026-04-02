/**
 * Seeding service entry point.
 *
 * Connects to SquadJS instances via Socket.IO, tracks seeding activity,
 * and rewards players with whitelist access when they accumulate enough points.
 *
 * Required env var:
 *   DATABASE_URL   — PostgreSQL connection string (same as the rest of the stack)
 *
 * Optional env vars:
 *   PORT           — health check HTTP port (default 8090)
 *   RUN_ONCE=true  — run one poll then exit (testing mode)
 *   CONCURRENCY    — max guilds polled concurrently (default 3)
 */

import cron from "node-cron"
import { validateConfig, config } from "./config.js"
import { ensureTables, closePG } from "./db.js"
import { disconnectAll } from "./squadjs.js"
import { startHealthServer, stopHealthServer } from "./health.js"
import { pollAllGuilds, runPointResets, runExpiryCleanup, runDailyDecay } from "./tracker.js"

async function shutdown(code = 0): Promise<never> {
  console.log("[seeding] Shutting down gracefully...")
  try {
    disconnectAll()
    await stopHealthServer()
    await closePG()
  } catch (err) {
    console.error("[seeding] Error during shutdown:", err)
  }
  process.exit(code)
}

async function main(): Promise<void> {
  try {
    validateConfig()
  } catch (err) {
    console.error("[seeding] Configuration error:", err instanceof Error ? err.message : err)
    process.exit(1)
  }

  console.log(`[seeding] Starting — mode: ${config.RUN_ONCE ? "run-once" : "cron"}`)

  // Ensure tables exist
  try {
    await ensureTables()
    console.log("[seeding] Database tables verified")
  } catch (err) {
    console.error("[seeding] Failed to ensure tables:", err)
    process.exit(1)
  }

  // Start health check server
  try {
    await startHealthServer(config.PORT)
  } catch (err) {
    console.error("[seeding] Failed to start health server:", err)
    // Non-fatal — continue without health endpoint
  }

  // Run initial poll
  try {
    await pollAllGuilds()
    console.log("[seeding] Initial poll complete")
  } catch (err) {
    console.error("[seeding] Initial poll failed:", err)
    if (config.RUN_ONCE) await shutdown(1)
  }

  if (config.RUN_ONCE) await shutdown(0)

  // ─── Schedule recurring tasks ────────────────────────────────────────────

  // Main poll loop — every minute
  cron.schedule("*/1 * * * *", async () => {
    try {
      await pollAllGuilds()
    } catch (err) {
      console.error("[seeding] Scheduled poll failed:", err)
    }
  })
  console.log('[seeding] Poll cron scheduled: "*/1 * * * *"')

  // Point resets — check every hour if any guild needs a reset
  // Individual guild reset_cron values are checked against current time
  cron.schedule("0 * * * *", async () => {
    try {
      await runPointResets()
    } catch (err) {
      console.error("[seeding] Point reset failed:", err)
    }
  })
  console.log('[seeding] Reset cron scheduled: "0 * * * *"')

  // Daily decay — every 4 hours
  cron.schedule("0 */4 * * *", async () => {
    try {
      await runDailyDecay()
    } catch (err) {
      console.error("[seeding] Daily decay failed:", err)
    }
  })
  console.log('[seeding] Decay cron scheduled: "0 */4 * * *"')

  // Expiry cleanup — every 15 minutes
  cron.schedule("*/15 * * * *", async () => {
    try {
      await runExpiryCleanup()
    } catch (err) {
      console.error("[seeding] Expiry cleanup failed:", err)
    }
  })
  console.log('[seeding] Expiry cron scheduled: "*/15 * * * *"')

  // ─── Signal handlers ─────────────────────────────────────────────────────

  process.on("SIGTERM", () => { shutdown(0) })
  process.on("SIGINT", () => { shutdown(0) })
}

main().catch(async (err) => {
  console.error("[seeding] Fatal error:", err)
  await shutdown(1)
})
