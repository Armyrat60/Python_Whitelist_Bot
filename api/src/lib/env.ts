/**
 * Typed environment variable access.
 * Throws at startup if required vars are missing.
 */

function required(key: string): string {
  const val = process.env[key]
  if (!val) throw new Error(`Missing required env var: ${key}`)
  return val
}

function optional(key: string, fallback = ""): string {
  return process.env[key] ?? fallback
}

export const env = {
  DATABASE_URL:          required("DATABASE_URL"),
  DISCORD_TOKEN:         required("DISCORD_TOKEN"),
  DISCORD_CLIENT_ID:     optional("DISCORD_CLIENT_ID"),
  DISCORD_CLIENT_SECRET: optional("DISCORD_CLIENT_SECRET"),
  WEB_BASE_URL:          optional("WEB_BASE_URL").replace(/\/$/, ""),
  WEB_FILE_SECRET:       optional("WEB_FILE_SECRET"),
  WEB_SESSION_SECRET:    optional("WEB_SESSION_SECRET", "change-me"),
  WEB_INTERNAL_SECRET:   optional("WEB_FILE_SECRET"),   // same secret for internal sync
  PORT:                  parseInt(optional("PORT", "8080"), 10),
  HOST:                  optional("HOST", "0.0.0.0"),
  CORS_ORIGIN:           optional("CORS_ORIGIN"),
  NODE_ENV:              optional("NODE_ENV", "development"),
}
