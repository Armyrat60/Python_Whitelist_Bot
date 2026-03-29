/**
 * SquadJS → Whitelister bridge entry point.
 *
 * Reads player records from a SquadJS MySQL database and upserts them into
 * the Squad Whitelister PostgreSQL database so admins can search players by
 * in-game name and see which Discord users they're linked to.
 *
 * Environment variables:
 *   SQUADJS_MYSQL_URL       mysql://user:pass@host:3306/squadjs   (required)
 *   DATABASE_URL            postgresql://...                       (required)
 *   GUILD_ID                Discord guild snowflake                (required)
 *   SQUADJS_SERVER_NAME     Human label stored per player row      (optional, default "Game Server")
 *   SYNC_INTERVAL_MINUTES   How often to sync                      (optional, default 15)
 *   RUN_ONCE                "true" = run once then exit            (optional, default false)
 *   BATCH_SIZE              Players per INSERT batch               (optional, default 500)
 */

import cron from "node-cron"
import { validateConfig, config } from "./config.js"
import { runSync } from "./sync.js"
import { closePG } from "./db.js"
import { closeMySQL } from "./mysql.js"

async function shutdown(code = 0): Promise<never> {
  console.log("[bridge] Shutting down gracefully...")
  try {
    await closeMySQL()
    await closePG()
  } catch (err) {
    console.error("[bridge] Error during shutdown:", err)
  }
  process.exit(code)
}

async function main(): Promise<void> {
  // Validate config before attempting any connections
  try {
    validateConfig()
  } catch (err) {
    console.error("[bridge] Configuration error:", err instanceof Error ? err.message : err)
    process.exit(1)
  }

  console.log(`[bridge] Starting — server: "${config.SERVER_NAME}", guild: ${config.GUILD_ID}`)
  console.log(`[bridge] Mode: ${config.RUN_ONCE ? "run-once" : `cron every ${config.SYNC_INTERVAL_MINUTES}m`}`)

  // Run initial sync on startup
  try {
    await runSync()
  } catch (err) {
    console.error("[bridge] Initial sync failed:", err)
    if (config.RUN_ONCE) await shutdown(1)
    // In daemon mode: log and continue — next cron run will retry
  }

  if (config.RUN_ONCE) {
    await shutdown(0)
  }

  // Schedule recurring sync
  if (config.SYNC_INTERVAL_MINUTES < 60) {
    // Sub-hourly: every N minutes
    const expr = `*/${config.SYNC_INTERVAL_MINUTES} * * * *`
    console.log(`[bridge] Cron scheduled: "${expr}"`)
    cron.schedule(expr, async () => {
      try {
        await runSync()
      } catch (err) {
        console.error("[bridge] Scheduled sync failed:", err)
      }
    })
  } else {
    // Hourly or longer: run at the top of each hour
    const hours = Math.floor(config.SYNC_INTERVAL_MINUTES / 60)
    const expr = `0 */${hours} * * *`
    console.log(`[bridge] Cron scheduled: "${expr}"`)
    cron.schedule(expr, async () => {
      try {
        await runSync()
      } catch (err) {
        console.error("[bridge] Scheduled sync failed:", err)
      }
    })
  }

  // Graceful shutdown hooks
  process.on("SIGTERM", () => { shutdown(0) })
  process.on("SIGINT",  () => { shutdown(0) })
}

main().catch(async (err) => {
  console.error("[bridge] Fatal error:", err)
  await shutdown(1)
})
