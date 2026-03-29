/**
 * Whitelister PostgreSQL client.
 *
 * The bridge writes to two tables:
 *   squad_players       — discovered in-game players, linked to Discord when possible
 *   audit_log           — records each sync run for admin visibility
 *
 * We also read from whitelist_identifiers to link Steam IDs to Discord users.
 */

import pg from "pg"
import { config } from "./config.js"

export const pool = new pg.Pool({
  connectionString: config.DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
})

pool.on("error", (err) => {
  console.error("[bridge/db] Unexpected pool error:", err.message)
})

/**
 * Create the squad_players table if it doesn't already exist.
 * Idempotent — safe to call on every startup.
 */
export async function ensureTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS squad_players (
      id            SERIAL PRIMARY KEY,
      guild_id      BIGINT       NOT NULL,
      steam_id      VARCHAR(32)  NOT NULL,
      last_seen_name VARCHAR(255),
      server_name   VARCHAR(255),
      first_seen_at TIMESTAMP    NOT NULL DEFAULT NOW(),
      last_seen_at  TIMESTAMP    NOT NULL DEFAULT NOW(),
      discord_id    BIGINT       NULL,
      UNIQUE (guild_id, steam_id)
    )
  `)
  await pool.query(`
    CREATE INDEX IF NOT EXISTS squad_players_guild_id_idx
    ON squad_players (guild_id)
  `)
  await pool.query(`
    CREATE INDEX IF NOT EXISTS squad_players_discord_id_idx
    ON squad_players (discord_id)
    WHERE discord_id IS NOT NULL
  `)
}

export interface PlayerRow {
  steamId: string
  lastName: string
}

export interface UpsertResult {
  upserted: number
  linked: number
}

/**
 * Upsert a batch of players into squad_players and attempt to link each
 * one to a Discord user via the whitelist_identifiers table.
 *
 * One round-trip per player (could be batched further, but player counts
 * are small enough that sequential queries are fine at 15-min intervals).
 */
export async function upsertPlayers(
  guildId: bigint,
  serverName: string,
  players: PlayerRow[],
): Promise<UpsertResult> {
  if (players.length === 0) return { upserted: 0, linked: 0 }

  const now = new Date()
  let upserted = 0
  let linked = 0

  const client = await pool.connect()
  try {
    for (const p of players) {
      // Upsert player — update name and timestamp on conflict
      const result = await client.query<{ id: number }>(
        `INSERT INTO squad_players
           (guild_id, steam_id, last_seen_name, server_name, first_seen_at, last_seen_at)
         VALUES ($1, $2, $3, $4, $5, $5)
         ON CONFLICT (guild_id, steam_id) DO UPDATE SET
           last_seen_name = EXCLUDED.last_seen_name,
           server_name    = EXCLUDED.server_name,
           last_seen_at   = EXCLUDED.last_seen_at
         RETURNING id`,
        [guildId, p.steamId, p.lastName || null, serverName, now],
      )
      if ((result.rowCount ?? 0) > 0) upserted++

      // Attempt to resolve a Discord user for this Steam ID
      const ident = await client.query<{ discord_id: bigint }>(
        `SELECT DISTINCT discord_id
         FROM whitelist_identifiers
         WHERE guild_id = $1
           AND id_type IN ('steam64', 'steamid')
           AND id_value = $2
         LIMIT 1`,
        [guildId, p.steamId],
      )
      if (ident.rows.length > 0) {
        await client.query(
          `UPDATE squad_players
           SET discord_id = $1
           WHERE guild_id = $2 AND steam_id = $3`,
          [ident.rows[0].discord_id, guildId, p.steamId],
        )
        linked++
      }
    }
  } finally {
    client.release()
  }

  return { upserted, linked }
}

/**
 * Write a sync-run record to the audit_log table so admins can see
 * when the bridge last ran and how many players were processed.
 */
export async function logSyncRun(
  guildId: bigint,
  details: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO audit_log
       (guild_id, action_type, details, created_at)
     VALUES ($1, 'squadjs_bridge_sync', $2, NOW())`,
    [guildId, details],
  )
}

// ─── Job queue helpers ────────────────────────────────────────────────────────

export interface JobRow {
  id:       number
  guild_id: bigint
  job_type: string
  payload:  Record<string, unknown>
}

/**
 * Claim the next N pending bridge_sync jobs.
 * Atomically marks them as 'running' so concurrent workers don't double-process.
 */
export async function claimPendingJobs(limit: number): Promise<JobRow[]> {
  const result = await pool.query<JobRow>(
    `UPDATE job_queue
     SET status     = 'running',
         started_at = NOW()
     WHERE id IN (
       SELECT id FROM job_queue
       WHERE status   = 'pending'
         AND job_type = 'bridge_sync'
       ORDER BY priority DESC, created_at ASC
       LIMIT $1
       FOR UPDATE SKIP LOCKED
     )
     RETURNING id, guild_id, job_type, payload`,
    [limit],
  )
  return result.rows
}

/** Mark a job as completed with an optional result payload. */
export async function completeJob(
  id: number,
  result: Record<string, unknown>,
): Promise<void> {
  await pool.query(
    `UPDATE job_queue
     SET status       = 'done',
         completed_at = NOW(),
         result       = $2
     WHERE id = $1`,
    [id, JSON.stringify(result)],
  )
}

/** Mark a job as failed with an error message. */
export async function failJob(id: number, error: string): Promise<void> {
  await pool.query(
    `UPDATE job_queue
     SET status       = 'failed',
         completed_at = NOW(),
         error        = $2
     WHERE id = $1`,
    [id, error],
  )
}

/**
 * Enqueue a bridge_sync job for a guild — but only if there is no
 * pending or running job already queued for that guild.
 */
export async function enqueueIfIdle(guildId: bigint): Promise<void> {
  await pool.query(
    `INSERT INTO job_queue (guild_id, job_type, status, priority)
     SELECT $1, 'bridge_sync', 'pending', 0
     WHERE NOT EXISTS (
       SELECT 1 FROM job_queue
       WHERE guild_id = $1
         AND job_type = 'bridge_sync'
         AND status IN ('pending', 'running')
     )`,
    [guildId],
  )
}

/** Close pool on graceful shutdown. */
export async function closePG(): Promise<void> {
  await pool.end()
}
