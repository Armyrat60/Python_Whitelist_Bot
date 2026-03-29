/**
 * SquadJS → Whitelister bridge entry point.
 *
 * Reads per-guild MySQL connection configs from the bridge_configs table
 * (set up via the dashboard) and syncs SquadJS player records into the
 * squad_players table on a configurable schedule.
 *
 * Required env var:
 *   DATABASE_URL   — PostgreSQL connection string (same as the rest of the stack)
 *
 * Optional env vars:
 *   SYNC_INTERVAL_MINUTES  — global sync frequency (default 15); individual
 *                            guilds set their own interval in the dashboard
 *   RUN_ONCE=true          — run one sync then exit (Railway cron mode)
 *   BATCH_SIZE             — INSERT batch size per guild (default 500)
 */

import cron from "node-cron"
import { validateConfig, config } from "./config.js"
import { runSync } from "./sync.js"
import { closePG } from "./db.js"

async function shutdown(code = 0): Promise<never> {
  console.log("[bridge] Shutting down gracefully...")
  try {
    await closePG()
  } catch (err) {
    console.error("[bridge] Error during shutdown:", err)
  }
  process.exit(code)
}

async function main(): Promise<void> {
  try {
    validateConfig()
  } catch (err) {
    console.error("[bridge] Configuration error:", err instanceof Error ? err.message : err)
    process.exit(1)
  }

  console.log(`[bridge] Starting — mode: ${config.RUN_ONCE ? "run-once" : `cron every ${config.SYNC_INTERVAL_MINUTES}m`}`)
  console.log("[bridge] MySQL credentials are loaded per-guild from the dashboard bridge_configs table")

  try {
    await runSync()
  } catch (err) {
    console.error("[bridge] Initial sync failed:", err)
    if (config.RUN_ONCE) await shutdown(1)
  }

  if (config.RUN_ONCE) await shutdown(0)

  const expr = `*/${config.SYNC_INTERVAL_MINUTES} * * * *`
  console.log(`[bridge] Cron scheduled: "${expr}"`)

  cron.schedule(expr, async () => {
    try {
      await runSync()
    } catch (err) {
      console.error("[bridge] Scheduled sync failed:", err)
    }
  })

  process.on("SIGTERM", () => { shutdown(0) })
  process.on("SIGINT",  () => { shutdown(0) })
}

main().catch(async (err) => {
  console.error("[bridge] Fatal error:", err)
  await shutdown(1)
})
