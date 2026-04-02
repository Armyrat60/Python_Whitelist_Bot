/**
 * Seeding service PostgreSQL client.
 *
 * Manages seeding_configs, seeding_points, seeding_sessions tables
 * and creates whitelist rewards by inserting real whitelist_user +
 * whitelist_identifier rows that the existing output service picks up.
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
  console.error("[seeding/db] Unexpected pool error:", err.message)
})

// ─── Table creation ──────────────────────────────────────────────────────────

/**
 * Create seeding tables if they don't already exist.
 * Idempotent — safe to call on every startup.
 */
export async function ensureTables(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS seeding_configs (
      id                          SERIAL PRIMARY KEY,
      guild_id                    BIGINT       NOT NULL UNIQUE,
      enabled                     BOOLEAN      NOT NULL DEFAULT FALSE,
      squadjs_host                VARCHAR(255) NOT NULL DEFAULT '',
      squadjs_port                INT          NOT NULL DEFAULT 3000,
      squadjs_token               VARCHAR(500) NOT NULL DEFAULT '',
      seeding_start_player_count  INT          NOT NULL DEFAULT 2,
      seeding_player_threshold    INT          NOT NULL DEFAULT 50,
      points_required             INT          NOT NULL DEFAULT 120,
      reward_whitelist_id         INT          NULL,
      reward_group_name           VARCHAR(100) NOT NULL DEFAULT 'reserve',
      reward_duration_hours       INT          NOT NULL DEFAULT 168,
      tracking_mode               VARCHAR(20)  NOT NULL DEFAULT 'fixed_reset',
      reset_cron                  VARCHAR(50)  NOT NULL DEFAULT '0 0 * * *',
      poll_interval_seconds       INT          NOT NULL DEFAULT 60,
      last_poll_at                TIMESTAMP    NULL,
      last_poll_status            VARCHAR(20)  NULL,
      last_poll_message           TEXT         NULL,
      leaderboard_public          BOOLEAN      NOT NULL DEFAULT FALSE,
      created_at                  TIMESTAMP    NOT NULL DEFAULT NOW(),
      updated_at                  TIMESTAMP    NOT NULL DEFAULT NOW()
    )
  `)

  // Add column for existing installs
  await pool.query(`
    ALTER TABLE seeding_configs ADD COLUMN IF NOT EXISTS leaderboard_public BOOLEAN NOT NULL DEFAULT FALSE
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS seeding_points (
      id             SERIAL PRIMARY KEY,
      guild_id       BIGINT      NOT NULL,
      steam_id       VARCHAR(32) NOT NULL,
      player_name    VARCHAR(255),
      points         INT         NOT NULL DEFAULT 0,
      last_award_at  TIMESTAMP   NULL,
      last_reset_at  TIMESTAMP   NULL,
      rewarded       BOOLEAN     NOT NULL DEFAULT FALSE,
      rewarded_at    TIMESTAMP   NULL,
      UNIQUE (guild_id, steam_id)
    )
  `)
  await pool.query(`
    CREATE INDEX IF NOT EXISTS seeding_points_guild_points_idx
    ON seeding_points (guild_id, points DESC)
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS seeding_sessions (
      id             SERIAL PRIMARY KEY,
      guild_id       BIGINT      NOT NULL,
      steam_id       VARCHAR(32) NOT NULL,
      player_name    VARCHAR(255),
      started_at     TIMESTAMP   NOT NULL,
      ended_at       TIMESTAMP   NULL,
      points_earned  INT         NOT NULL DEFAULT 0,
      player_count   INT         NOT NULL DEFAULT 0
    )
  `)
  await pool.query(`
    CREATE INDEX IF NOT EXISTS seeding_sessions_guild_started_idx
    ON seeding_sessions (guild_id, started_at DESC)
  `)
  await pool.query(`
    CREATE INDEX IF NOT EXISTS seeding_sessions_guild_steam_idx
    ON seeding_sessions (guild_id, steam_id)
  `)
}

// ─── Config operations ───────────────────────────────────────────────────────

export interface SeedingConfigRow {
  id: number
  guild_id: bigint
  enabled: boolean
  squadjs_host: string
  squadjs_port: number
  squadjs_token: string
  seeding_start_player_count: number
  seeding_player_threshold: number
  points_required: number
  reward_whitelist_id: number | null
  reward_group_name: string
  reward_duration_hours: number
  tracking_mode: string
  reset_cron: string
  poll_interval_seconds: number
  last_poll_at: Date | null
  last_poll_status: string | null
  last_poll_message: string | null
  leaderboard_public: boolean
}

/** Load all enabled seeding configs. */
export async function loadEnabledConfigs(): Promise<SeedingConfigRow[]> {
  const result = await pool.query<SeedingConfigRow>(
    `SELECT * FROM seeding_configs WHERE enabled = TRUE`,
  )
  return result.rows
}

/** Update poll status after each tick. */
export async function updatePollStatus(
  guildId: bigint,
  status: "ok" | "error",
  message: string,
): Promise<void> {
  await pool.query(
    `UPDATE seeding_configs
     SET last_poll_at = NOW(),
         last_poll_status = $2,
         last_poll_message = $3,
         updated_at = NOW()
     WHERE guild_id = $1`,
    [guildId, status, message],
  )
}

// ─── Points operations ───────────────────────────────────────────────────────

export interface PlayerInput {
  steamId: string
  name: string
}

/**
 * Award 1 point to each player in the list.
 * Uses INSERT ... ON CONFLICT to upsert efficiently.
 */
export async function awardPoints(
  guildId: bigint,
  players: PlayerInput[],
): Promise<number> {
  if (players.length === 0) return 0

  const client = await pool.connect()
  let awarded = 0

  try {
    for (const p of players) {
      const result = await client.query(
        `INSERT INTO seeding_points (guild_id, steam_id, player_name, points, last_award_at)
         VALUES ($1, $2, $3, 1, NOW())
         ON CONFLICT (guild_id, steam_id) DO UPDATE SET
           points = seeding_points.points + 1,
           player_name = COALESCE(EXCLUDED.player_name, seeding_points.player_name),
           last_award_at = NOW()`,
        [guildId, p.steamId, p.name || null],
      )
      if ((result.rowCount ?? 0) > 0) awarded++
    }
  } finally {
    client.release()
  }

  return awarded
}

/** Get players at or above the required points who haven't been rewarded yet. */
export async function getUnrewardedQualifiers(
  guildId: bigint,
  pointsRequired: number,
): Promise<Array<{ steam_id: string; player_name: string | null; points: number }>> {
  const result = await pool.query<{
    steam_id: string
    player_name: string | null
    points: number
  }>(
    `SELECT steam_id, player_name, points
     FROM seeding_points
     WHERE guild_id = $1
       AND points >= $2
       AND rewarded = FALSE`,
    [guildId, pointsRequired],
  )
  return result.rows
}

/** Mark a player as rewarded. */
export async function markRewarded(
  guildId: bigint,
  steamId: string,
): Promise<void> {
  await pool.query(
    `UPDATE seeding_points
     SET rewarded = TRUE, rewarded_at = NOW()
     WHERE guild_id = $1 AND steam_id = $2`,
    [guildId, steamId],
  )
}

/** Reset all points for a guild (fixed_reset mode). */
export async function resetPoints(guildId: bigint): Promise<number> {
  const result = await pool.query(
    `UPDATE seeding_points
     SET points = 0, rewarded = FALSE, last_reset_at = NOW()
     WHERE guild_id = $1`,
    [guildId],
  )
  return result.rowCount ?? 0
}

/** Get leaderboard for a guild. */
export async function getLeaderboard(
  guildId: bigint,
  limit = 50,
): Promise<Array<{
  steam_id: string
  player_name: string | null
  points: number
  rewarded: boolean
  rewarded_at: Date | null
}>> {
  const result = await pool.query(
    `SELECT steam_id, player_name, points, rewarded, rewarded_at
     FROM seeding_points
     WHERE guild_id = $1 AND points > 0
     ORDER BY points DESC
     LIMIT $2`,
    [guildId, limit],
  )
  return result.rows
}

// ─── Whitelist reward creation ───────────────────────────────────────────────

/**
 * Create a real whitelist_user + whitelist_identifier entry for a seeding reward.
 *
 * This is the critical function — it creates database rows that the existing
 * output service (output.ts) will pick up automatically. No changes to the
 * output service are needed.
 *
 * Uses ON CONFLICT to extend existing rewards rather than duplicating.
 */
export async function createWhitelistReward(
  guildId: bigint,
  steamId: string,
  playerName: string | null,
  whitelistId: number,
  _groupName: string,
  durationHours: number,
): Promise<boolean> {
  const client = await pool.connect()
  const expiresAt = new Date(Date.now() + durationHours * 60 * 60 * 1000)
  const now = new Date()
  const displayName = playerName ?? `Seeder_${steamId.slice(-6)}`

  try {
    await client.query("BEGIN")

    // 1. Try to find a linked Discord user for this Steam ID
    const identResult = await client.query<{ discord_id: bigint }>(
      `SELECT DISTINCT discord_id
       FROM whitelist_identifiers
       WHERE guild_id = $1
         AND id_type IN ('steam64', 'steamid')
         AND id_value = $2
       LIMIT 1`,
      [guildId, steamId],
    )

    // Also try squad_players table
    let discordId: bigint | null = identResult.rows[0]?.discord_id ?? null
    if (!discordId) {
      const spResult = await client.query<{ discord_id: bigint }>(
        `SELECT discord_id FROM squad_players
         WHERE guild_id = $1 AND steam_id = $2 AND discord_id IS NOT NULL
         LIMIT 1`,
        [guildId, steamId],
      )
      discordId = spResult.rows[0]?.discord_id ?? null
    }

    // If no Discord link, use a synthetic negative ID based on Steam ID hash
    // This prevents collisions and allows the output service to include them
    if (!discordId) {
      // Use last 15 digits of Steam ID as a negative number
      const numericPart = BigInt(steamId.slice(-15))
      discordId = -numericPart
    }

    // 2. Upsert whitelist_user — extend expiry if already exists
    await client.query(
      `INSERT INTO whitelist_users
         (guild_id, discord_id, whitelist_id, discord_name, status,
          effective_slot_limit, updated_at, created_at, expires_at, created_via)
       VALUES ($1, $2, $3, $4, 'active', 1, $5, $5, $6, 'seeding_reward')
       ON CONFLICT (guild_id, discord_id, whitelist_id) DO UPDATE SET
         status = 'active',
         expires_at = GREATEST(whitelist_users.expires_at, EXCLUDED.expires_at),
         updated_at = EXCLUDED.updated_at`,
      [guildId, discordId, whitelistId, displayName, now, expiresAt],
    )

    // 3. Upsert whitelist_identifier for the Steam ID
    await client.query(
      `INSERT INTO whitelist_identifiers
         (guild_id, discord_id, whitelist_id, id_type, id_value,
          is_verified, verification_source, created_at, updated_at)
       VALUES ($1, $2, $3, 'steam64', $4, TRUE, 'seeding_reward', $5, $5)
       ON CONFLICT (guild_id, discord_id, whitelist_id, id_type, id_value)
       DO UPDATE SET
         is_verified = TRUE,
         verification_source = 'seeding_reward',
         updated_at = EXCLUDED.updated_at`,
      [guildId, discordId, whitelistId, steamId, now],
    )

    // 4. Audit log entry
    await client.query(
      `INSERT INTO audit_log
         (guild_id, whitelist_id, action_type, target_discord_id, details, created_at)
       VALUES ($1, $2, 'seeding_reward_granted', $3, $4, NOW())`,
      [
        guildId,
        whitelistId,
        discordId,
        JSON.stringify({
          steam_id: steamId,
          player_name: playerName,
          duration_hours: durationHours,
          expires_at: expiresAt.toISOString(),
        }),
      ],
    )

    await client.query("COMMIT")
    return true
  } catch (err) {
    await client.query("ROLLBACK")
    console.error(`[seeding/db] Failed to create whitelist reward for ${steamId}:`, err)
    return false
  } finally {
    client.release()
  }
}

// ─── Expiry cleanup ──────────────────────────────────────────────────────────

/**
 * Expire seeding reward entries that have passed their expires_at date.
 * Only touches rows created by the seeding service (created_via = 'seeding_reward').
 */
export async function expireSeedingRewards(): Promise<number> {
  const result = await pool.query(
    `UPDATE whitelist_users
     SET status = 'expired', updated_at = NOW()
     WHERE created_via = 'seeding_reward'
       AND expires_at IS NOT NULL
       AND expires_at < NOW()
       AND status = 'active'`,
  )
  return result.rowCount ?? 0
}

// ─── Audit helper ────────────────────────────────────────────────────────────

export async function logAudit(
  guildId: bigint,
  actionType: string,
  details: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO audit_log (guild_id, action_type, details, created_at)
     VALUES ($1, $2, $3, NOW())`,
    [guildId, actionType, details],
  )
}

// ─── Shutdown ────────────────────────────────────────────────────────────────

export async function closePG(): Promise<void> {
  await pool.end()
}
