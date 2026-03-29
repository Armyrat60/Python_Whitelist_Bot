/**
 * Configuration loaded from environment variables.
 * Required: SQUADJS_MYSQL_URL, DATABASE_URL, GUILD_ID
 * Optional: SQUADJS_SERVER_NAME, SYNC_INTERVAL_MINUTES, RUN_ONCE
 */

function required(key: string): string {
  const val = process.env[key]
  if (!val) throw new Error(`Missing required environment variable: ${key}`)
  return val
}

export const config = {
  // SquadJS MySQL connection URL: mysql://user:pass@host:3306/squadjs
  MYSQL_URL: process.env.SQUADJS_MYSQL_URL ?? "",

  // Whitelister PostgreSQL (same DATABASE_URL as the rest of the stack)
  DATABASE_URL: process.env.DATABASE_URL ?? "",

  // Discord Guild ID this bridge is syncing for
  GUILD_ID: process.env.GUILD_ID ?? "",

  // Human-readable server label stored alongside each player row
  SERVER_NAME: process.env.SQUADJS_SERVER_NAME ?? "Game Server",

  // How often to sync (minutes). Ignored when RUN_ONCE=true.
  SYNC_INTERVAL_MINUTES: parseInt(process.env.SYNC_INTERVAL_MINUTES ?? "15", 10),

  // When true: run one sync and exit (useful for Railway cron or one-shot jobs)
  RUN_ONCE: process.env.RUN_ONCE === "true",

  // How many player rows to batch per INSERT cycle (keeps memory bounded)
  BATCH_SIZE: parseInt(process.env.BATCH_SIZE ?? "500", 10),
}

export function validateConfig() {
  if (!config.MYSQL_URL) throw new Error("SQUADJS_MYSQL_URL is required")
  if (!config.DATABASE_URL) throw new Error("DATABASE_URL is required")
  if (!config.GUILD_ID) throw new Error("GUILD_ID is required")
  if (isNaN(config.SYNC_INTERVAL_MINUTES) || config.SYNC_INTERVAL_MINUTES < 1) {
    throw new Error("SYNC_INTERVAL_MINUTES must be a positive integer")
  }
}
