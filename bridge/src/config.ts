/**
 * Bridge configuration.
 *
 * Required: DATABASE_URL (PostgreSQL — same as the rest of the stack)
 * Optional: SYNC_INTERVAL_MINUTES, RUN_ONCE, BATCH_SIZE
 *
 * MySQL connection details are now stored per-guild in the bridge_configs
 * table and managed through the dashboard. No SQUADJS_MYSQL_URL needed.
 */

export const config = {
  // Whitelister PostgreSQL
  DATABASE_URL: process.env.DATABASE_URL ?? "",

  // How often to run a full sync across all enabled guilds (minutes).
  // Individual guilds can override this via their bridge_config row.
  SYNC_INTERVAL_MINUTES: parseInt(process.env.SYNC_INTERVAL_MINUTES ?? "15", 10),

  // Run once and exit — useful for Railway cron jobs
  RUN_ONCE: process.env.RUN_ONCE === "true",

  // Players per INSERT batch per guild (keeps memory bounded on large servers)
  BATCH_SIZE: parseInt(process.env.BATCH_SIZE ?? "500", 10),
}

export function validateConfig() {
  if (!config.DATABASE_URL) throw new Error("DATABASE_URL is required")
  if (isNaN(config.SYNC_INTERVAL_MINUTES) || config.SYNC_INTERVAL_MINUTES < 1) {
    throw new Error("SYNC_INTERVAL_MINUTES must be a positive integer")
  }
}
