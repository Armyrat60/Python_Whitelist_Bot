/**
 * Global test setup — runs before any test file.
 * Sets required env vars so lib/env.ts does not throw.
 */
process.env.DATABASE_URL       = process.env.DATABASE_URL       ?? 'postgresql://test:test@localhost/test'
process.env.DISCORD_TOKEN      = process.env.DISCORD_TOKEN      ?? 'test-discord-token'
process.env.WEB_BASE_URL       = process.env.WEB_BASE_URL       ?? 'http://localhost:8080'
process.env.WEB_SESSION_SECRET = process.env.WEB_SESSION_SECRET ?? 'test-session-secret-32-chars-ok!'
process.env.WEB_FILE_SECRET    = process.env.WEB_FILE_SECRET    ?? 'test-file-secret'
