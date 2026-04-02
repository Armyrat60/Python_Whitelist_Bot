/**
 * Seeding service configuration.
 *
 * Required: DATABASE_URL (PostgreSQL — same as the rest of the stack)
 * Optional: PORT, RUN_ONCE, CONCURRENCY
 *
 * SquadJS connection details are stored per-guild in the seeding_configs
 * table and managed through the dashboard. No env vars needed for SquadJS.
 */

export const config = {
  // Whitelister PostgreSQL
  DATABASE_URL: process.env.DATABASE_URL ?? "",

  // HTTP health check port
  PORT: parseInt(process.env.PORT ?? "8090", 10),

  // Run once and exit — useful for testing
  RUN_ONCE: process.env.RUN_ONCE === "true",

  // Max guilds polling concurrently
  CONCURRENCY: parseInt(process.env.CONCURRENCY ?? "3", 10),
}

export function validateConfig() {
  if (!config.DATABASE_URL) throw new Error("DATABASE_URL is required")
  if (isNaN(config.PORT) || config.PORT < 1) {
    throw new Error("PORT must be a positive integer")
  }
}
