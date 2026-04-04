/**
 * Seeding service PostgreSQL client.
 *
 * Manages seeding_configs, seeding_points, seeding_sessions, seeding_servers tables
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
      reward_group_name           VARCHAR(100) NOT NULL DEFAULT 'Reserve',
      reward_duration_hours       INT          NOT NULL DEFAULT 168,
      tracking_mode               VARCHAR(20)  NOT NULL DEFAULT 'fixed_reset',
      reset_cron                  VARCHAR(50)  NOT NULL DEFAULT '0 0 * * *',
      poll_interval_seconds       INT          NOT NULL DEFAULT 60,
      seeding_window_enabled      BOOLEAN      NOT NULL DEFAULT FALSE,
      seeding_window_start        VARCHAR(5)   NOT NULL DEFAULT '07:00',
      seeding_window_end          VARCHAR(5)   NOT NULL DEFAULT '22:00',
      last_poll_at                TIMESTAMP    NULL,
      last_poll_status            VARCHAR(20)  NULL,
      last_poll_message           TEXT         NULL,
      leaderboard_public          BOOLEAN      NOT NULL DEFAULT FALSE,
      created_at                  TIMESTAMP    NOT NULL DEFAULT NOW(),
      updated_at                  TIMESTAMP    NOT NULL DEFAULT NOW()
    )
  `)

  // Add columns for existing installs
  await pool.query(`ALTER TABLE seeding_configs ADD COLUMN IF NOT EXISTS leaderboard_public BOOLEAN NOT NULL DEFAULT FALSE`)
  await pool.query(`ALTER TABLE seeding_configs ADD COLUMN IF NOT EXISTS seeding_window_enabled BOOLEAN NOT NULL DEFAULT FALSE`)
  await pool.query(`ALTER TABLE seeding_configs ADD COLUMN IF NOT EXISTS seeding_window_start VARCHAR(5) NOT NULL DEFAULT '07:00'`)
  await pool.query(`ALTER TABLE seeding_configs ADD COLUMN IF NOT EXISTS seeding_window_end VARCHAR(5) NOT NULL DEFAULT '22:00'`)
  // Rename old 'reserve' group to 'Reserve' for clarity
  await pool.query(`UPDATE seeding_configs SET reward_group_name = 'Reserve' WHERE reward_group_name = 'reserve'`)
  await pool.query(`UPDATE whitelists SET squad_group = 'Reserve' WHERE slug = 'seeding-rewards' AND squad_group = 'reserve'`)
  await pool.query(`
    INSERT INTO squad_groups (guild_id, group_name, permissions, description, is_default, created_at, updated_at)
    SELECT guild_id, 'Reserve', 'reserve', 'Seeding reward group (reserve only)', FALSE, NOW(), NOW()
    FROM seeding_configs WHERE enabled = TRUE
    ON CONFLICT (guild_id, group_name) DO NOTHING
  `)

  // Migrate seeding rewards from the old separate whitelist to the main whitelist.
  // Move whitelist_users and whitelist_identifiers from 'seeding-rewards' to the default whitelist.
  await pool.query(`
    UPDATE whitelist_users u
    SET whitelist_id = (
      SELECT w.id FROM whitelists w
      WHERE w.guild_id = u.guild_id AND w.is_default = TRUE AND w.enabled = TRUE
      LIMIT 1
    )
    WHERE u.created_via = 'seeding_reward'
      AND u.whitelist_id IN (SELECT id FROM whitelists WHERE slug = 'seeding-rewards')
      AND EXISTS (
        SELECT 1 FROM whitelists w
        WHERE w.guild_id = u.guild_id AND w.is_default = TRUE AND w.enabled = TRUE
      )
  `)
  await pool.query(`
    UPDATE whitelist_identifiers i
    SET whitelist_id = (
      SELECT w.id FROM whitelists w
      WHERE w.guild_id = i.guild_id AND w.is_default = TRUE AND w.enabled = TRUE
      LIMIT 1
    )
    WHERE i.verification_source = 'seeding_reward'
      AND i.whitelist_id IN (SELECT id FROM whitelists WHERE slug = 'seeding-rewards')
      AND EXISTS (
        SELECT 1 FROM whitelists w
        WHERE w.guild_id = i.guild_id AND w.is_default = TRUE AND w.enabled = TRUE
      )
  `)
  // Delete the old separate seeding whitelist (entries already migrated)
  await pool.query(`DELETE FROM whitelists WHERE slug = 'seeding-rewards'`)

  await pool.query(`ALTER TABLE seeding_configs ADD COLUMN IF NOT EXISTS reward_tiers JSONB NULL`)
  await pool.query(`ALTER TABLE seeding_configs ADD COLUMN IF NOT EXISTS rcon_warnings_enabled BOOLEAN NOT NULL DEFAULT FALSE`)
  await pool.query(`ALTER TABLE seeding_configs ADD COLUMN IF NOT EXISTS rcon_warning_message TEXT NOT NULL DEFAULT 'Seeding Progress: {progress}% ({points}/{required}). Keep seeding!'`)
  await pool.query(`ALTER TABLE seeding_configs ADD COLUMN IF NOT EXISTS decay_days_threshold INT NOT NULL DEFAULT 3`)
  await pool.query(`ALTER TABLE seeding_configs ADD COLUMN IF NOT EXISTS decay_points_per_day INT NOT NULL DEFAULT 10`)
  await pool.query(`ALTER TABLE seeding_configs ADD COLUMN IF NOT EXISTS discord_role_reward_enabled BOOLEAN NOT NULL DEFAULT FALSE`)
  await pool.query(`ALTER TABLE seeding_configs ADD COLUMN IF NOT EXISTS discord_role_reward_id VARCHAR(32) NULL`)
  await pool.query(`ALTER TABLE seeding_configs ADD COLUMN IF NOT EXISTS discord_remove_role_on_expiry BOOLEAN NOT NULL DEFAULT FALSE`)
  await pool.query(`ALTER TABLE seeding_configs ADD COLUMN IF NOT EXISTS auto_seed_alert_enabled BOOLEAN NOT NULL DEFAULT FALSE`)
  await pool.query(`ALTER TABLE seeding_configs ADD COLUMN IF NOT EXISTS auto_seed_alert_role_id VARCHAR(32) NULL`)
  await pool.query(`ALTER TABLE seeding_configs ADD COLUMN IF NOT EXISTS auto_seed_alert_cooldown_min INT NOT NULL DEFAULT 30`)
  await pool.query(`ALTER TABLE seeding_configs ADD COLUMN IF NOT EXISTS discord_notify_channel_id VARCHAR(32) NULL`)
  await pool.query(`ALTER TABLE seeding_configs ADD COLUMN IF NOT EXISTS rcon_broadcast_enabled BOOLEAN NOT NULL DEFAULT FALSE`)
  await pool.query(`ALTER TABLE seeding_configs ADD COLUMN IF NOT EXISTS rcon_broadcast_message TEXT NOT NULL DEFAULT 'This server is in seeding mode! Earn whitelist rewards by staying online.'`)
  await pool.query(`ALTER TABLE seeding_configs ADD COLUMN IF NOT EXISTS rcon_broadcast_interval_min INT NOT NULL DEFAULT 10`)
  await pool.query(`ALTER TABLE seeding_configs ADD COLUMN IF NOT EXISTS reward_cooldown_hours INT NOT NULL DEFAULT 0`)
  await pool.query(`ALTER TABLE seeding_configs ADD COLUMN IF NOT EXISTS require_discord_link BOOLEAN NOT NULL DEFAULT FALSE`)
  await pool.query(`ALTER TABLE seeding_configs ADD COLUMN IF NOT EXISTS streak_enabled BOOLEAN NOT NULL DEFAULT FALSE`)
  await pool.query(`ALTER TABLE seeding_configs ADD COLUMN IF NOT EXISTS streak_days_required INT NOT NULL DEFAULT 3`)
  await pool.query(`ALTER TABLE seeding_configs ADD COLUMN IF NOT EXISTS streak_multiplier REAL NOT NULL DEFAULT 1.5`)
  await pool.query(`ALTER TABLE seeding_configs ADD COLUMN IF NOT EXISTS bonus_multiplier_enabled BOOLEAN NOT NULL DEFAULT FALSE`)
  await pool.query(`ALTER TABLE seeding_configs ADD COLUMN IF NOT EXISTS bonus_multiplier_value REAL NOT NULL DEFAULT 2.0`)
  await pool.query(`ALTER TABLE seeding_configs ADD COLUMN IF NOT EXISTS bonus_multiplier_start TIMESTAMP NULL`)
  await pool.query(`ALTER TABLE seeding_configs ADD COLUMN IF NOT EXISTS bonus_multiplier_end TIMESTAMP NULL`)
  await pool.query(`ALTER TABLE seeding_configs ADD COLUMN IF NOT EXISTS custom_embed_title VARCHAR(255) NULL`)
  await pool.query(`ALTER TABLE seeding_configs ADD COLUMN IF NOT EXISTS custom_embed_description TEXT NULL`)
  await pool.query(`ALTER TABLE seeding_configs ADD COLUMN IF NOT EXISTS custom_embed_image_url VARCHAR(500) NULL`)
  await pool.query(`ALTER TABLE seeding_configs ADD COLUMN IF NOT EXISTS custom_embed_color VARCHAR(7) NULL`)
  await pool.query(`ALTER TABLE seeding_configs ADD COLUMN IF NOT EXISTS population_tracking_enabled BOOLEAN NOT NULL DEFAULT FALSE`)
  await pool.query(`ALTER TABLE seeding_configs ADD COLUMN IF NOT EXISTS webhook_url VARCHAR(500) NULL`)
  await pool.query(`ALTER TABLE seeding_configs ADD COLUMN IF NOT EXISTS webhook_enabled BOOLEAN NOT NULL DEFAULT FALSE`)
  await pool.query(`ALTER TABLE seeding_configs ADD COLUMN IF NOT EXISTS points_per_server BOOLEAN NOT NULL DEFAULT FALSE`)
  // Streak fields on seeding_points
  await pool.query(`ALTER TABLE seeding_points ADD COLUMN IF NOT EXISTS current_streak INT NOT NULL DEFAULT 0`)
  await pool.query(`ALTER TABLE seeding_points ADD COLUMN IF NOT EXISTS last_seed_date VARCHAR(10) NULL`)
  // Multi-server: server_id on seeding_points (0 = pooled, >0 = per-server)
  await pool.query(`ALTER TABLE seeding_points ADD COLUMN IF NOT EXISTS server_id INT NOT NULL DEFAULT 0`)
  // Population snapshots table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS population_snapshots (
      id            SERIAL PRIMARY KEY,
      guild_id      BIGINT    NOT NULL,
      player_count  INT       NOT NULL,
      is_seeding    BOOLEAN   NOT NULL,
      created_at    TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `)
  await pool.query(`CREATE INDEX IF NOT EXISTS pop_snap_guild_time_idx ON population_snapshots (guild_id, created_at DESC)`)

  // Create seeding_notifications table for Discord event queue
  await pool.query(`
    CREATE TABLE IF NOT EXISTS seeding_notifications (
      id         SERIAL PRIMARY KEY,
      guild_id   BIGINT      NOT NULL,
      event_type VARCHAR(50) NOT NULL,
      payload    JSONB       NOT NULL DEFAULT '{}',
      processed  BOOLEAN     NOT NULL DEFAULT FALSE,
      created_at TIMESTAMP   NOT NULL DEFAULT NOW()
    )
  `)
  await pool.query(`CREATE INDEX IF NOT EXISTS seeding_notif_guild_proc_idx ON seeding_notifications (guild_id, processed, created_at)`)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS seeding_points (
      id             SERIAL PRIMARY KEY,
      guild_id       BIGINT      NOT NULL,
      server_id      INT         NOT NULL DEFAULT 0,
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

  // Multi-server: create unique index on (guild_id, server_id, steam_id) for per-server point tracking
  // Drop the old unique constraint on (guild_id, steam_id) is not safe — it may be used by existing data.
  // Instead we create a new unique index and handle upsert logic in code.
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS seeding_points_guild_server_steam_idx
    ON seeding_points (guild_id, server_id, steam_id)
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

  // ─── Multi-server: seeding_servers table ────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS seeding_servers (
      id                SERIAL PRIMARY KEY,
      guild_id          BIGINT       NOT NULL,
      server_name       VARCHAR(255) NOT NULL,
      squadjs_host      VARCHAR(255) NOT NULL,
      squadjs_port      INT          NOT NULL DEFAULT 3000,
      squadjs_token     VARCHAR(500) NOT NULL,
      enabled           BOOLEAN      NOT NULL DEFAULT TRUE,
      last_poll_at      TIMESTAMP    NULL,
      last_poll_status  VARCHAR(20)  NULL,
      last_poll_message TEXT         NULL,
      created_at        TIMESTAMP    NOT NULL DEFAULT NOW(),
      updated_at        TIMESTAMP    NOT NULL DEFAULT NOW(),
      UNIQUE(guild_id, server_name)
    )
  `)

  // Migrate existing squadjs connection info from seeding_configs to seeding_servers
  await pool.query(`
    INSERT INTO seeding_servers (guild_id, server_name, squadjs_host, squadjs_port, squadjs_token)
    SELECT guild_id, 'Main Server', squadjs_host, squadjs_port, squadjs_token
    FROM seeding_configs
    WHERE squadjs_host IS NOT NULL AND squadjs_host != ''
      AND NOT EXISTS (SELECT 1 FROM seeding_servers WHERE seeding_servers.guild_id = seeding_configs.guild_id)
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
  seeding_window_enabled: boolean
  seeding_window_start: string
  seeding_window_end: string
  last_poll_at: Date | null
  last_poll_status: string | null
  last_poll_message: string | null
  reward_tiers: RewardTier[] | null
  rcon_warnings_enabled: boolean
  rcon_warning_message: string
  decay_days_threshold: number
  decay_points_per_day: number
  discord_role_reward_enabled: boolean
  discord_role_reward_id: string | null
  discord_remove_role_on_expiry: boolean
  auto_seed_alert_enabled: boolean
  auto_seed_alert_role_id: string | null
  auto_seed_alert_cooldown_min: number
  discord_notify_channel_id: string | null
  rcon_broadcast_enabled: boolean
  rcon_broadcast_message: string
  rcon_broadcast_interval_min: number
  reward_cooldown_hours: number
  require_discord_link: boolean
  streak_enabled: boolean
  streak_days_required: number
  streak_multiplier: number
  bonus_multiplier_enabled: boolean
  bonus_multiplier_value: number
  bonus_multiplier_start: Date | null
  bonus_multiplier_end: Date | null
  population_tracking_enabled: boolean
  webhook_url: string | null
  webhook_enabled: boolean
  leaderboard_public: boolean
  points_per_server: boolean
}

export interface RewardTier {
  points: number
  duration_hours: number
  label: string
}

export interface SeedingServerRow {
  id: number
  guild_id: bigint
  server_name: string
  squadjs_host: string
  squadjs_port: number
  squadjs_token: string
  enabled: boolean
  last_poll_at: Date | null
  last_poll_status: string | null
  last_poll_message: string | null
}

/** Load all enabled seeding configs. */
export async function loadEnabledConfigs(): Promise<SeedingConfigRow[]> {
  const result = await pool.query<SeedingConfigRow>(
    `SELECT * FROM seeding_configs WHERE enabled = TRUE`,
  )
  return result.rows
}

/** Load all enabled servers whose guild config is also enabled. */
export async function loadEnabledServers(): Promise<SeedingServerRow[]> {
  const result = await pool.query<SeedingServerRow>(
    `SELECT ss.* FROM seeding_servers ss
     JOIN seeding_configs sc ON ss.guild_id = sc.guild_id
     WHERE sc.enabled = TRUE AND ss.enabled = TRUE`,
  )
  return result.rows
}

/** Load config for a specific guild. */
export async function loadConfigForGuild(guildId: bigint): Promise<SeedingConfigRow | null> {
  const result = await pool.query<SeedingConfigRow>(
    `SELECT * FROM seeding_configs WHERE guild_id = $1 AND enabled = TRUE`,
    [guildId],
  )
  return result.rows[0] ?? null
}

/** Update poll status after each tick (on seeding_configs — legacy, still used for guild-level status). */
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

/** Update poll status on a specific seeding_server row. */
export async function updateServerPollStatus(
  serverId: number,
  status: "ok" | "error",
  message: string,
): Promise<void> {
  await pool.query(
    `UPDATE seeding_servers
     SET last_poll_at = NOW(),
         last_poll_status = $2,
         last_poll_message = $3,
         updated_at = NOW()
     WHERE id = $1`,
    [serverId, status, message],
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
 *
 * serverId: 0 = pooled (default), >0 = per-server tracking.
 */
export async function awardPoints(
  guildId: bigint,
  players: PlayerInput[],
  serverId: number = 0,
): Promise<number> {
  if (players.length === 0) return 0

  const client = await pool.connect()
  let awarded = 0

  try {
    for (const p of players) {
      const result = await client.query(
        `INSERT INTO seeding_points (guild_id, server_id, steam_id, player_name, points, last_award_at)
         VALUES ($1, $2, $3, $4, 1, NOW())
         ON CONFLICT (guild_id, server_id, steam_id) DO UPDATE SET
           points = seeding_points.points + 1,
           player_name = COALESCE(EXCLUDED.player_name, seeding_points.player_name),
           last_award_at = NOW()`,
        [guildId, serverId, p.steamId, p.name || null],
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

/** Reset all points for a guild (fixed_reset mode).
 *  Preserves rewarded status and rewarded_at — only resets points to 0.
 *  Players who already earned their reward keep the badge on the leaderboard.
 *
 *  If points_per_server is true, reset is still guild-wide (all server_id rows). */
export async function resetPoints(guildId: bigint): Promise<number> {
  const result = await pool.query(
    `UPDATE seeding_points
     SET points = 0, last_reset_at = NOW()
     WHERE guild_id = $1`,
    [guildId],
  )
  return result.rowCount ?? 0
}

/** Get current points for a batch of players (for RCON milestone checks).
 *  serverId: if provided and > 0, filter by server. Otherwise show pooled (0). */
export async function getPlayerPointsBatch(
  guildId: bigint,
  steamIds: string[],
  serverId: number = 0,
): Promise<Map<string, number>> {
  if (steamIds.length === 0) return new Map()
  const result = await pool.query<{ steam_id: string; points: number }>(
    `SELECT steam_id, points FROM seeding_points
     WHERE guild_id = $1 AND steam_id = ANY($2) AND server_id = $3`,
    [guildId, steamIds, serverId],
  )
  const map = new Map<string, number>()
  for (const row of result.rows) map.set(row.steam_id, row.points)
  return map
}

/** Apply daily decay to inactive players for all guilds using daily_decay mode. */
export async function runDailyDecay(): Promise<void> {
  const configs = await pool.query<{ guild_id: bigint; decay_days_threshold: number; decay_points_per_day: number }>(
    `SELECT guild_id, decay_days_threshold, decay_points_per_day
     FROM seeding_configs
     WHERE enabled = TRUE AND tracking_mode = 'daily_decay'`,
  )

  for (const cfg of configs.rows) {
    const result = await pool.query(
      `UPDATE seeding_points
       SET points = GREATEST(0, points - $2)
       WHERE guild_id = $1
         AND points > 0
         AND last_award_at < NOW() - make_interval(days => $3)`,
      [cfg.guild_id, cfg.decay_points_per_day, cfg.decay_days_threshold],
    )
    const affected = result.rowCount ?? 0
    if (affected > 0) {
      console.log(`[seeding/db] Decay applied: ${affected} player(s) lost ${cfg.decay_points_per_day} points in guild ${cfg.guild_id}`)
      await logAudit(
        cfg.guild_id,
        "seeding_daily_decay",
        JSON.stringify({ players_affected: affected, points_removed: cfg.decay_points_per_day, days_threshold: cfg.decay_days_threshold }),
      )
    }
  }
}

/** Get leaderboard for a guild.
 *  Shows players with points > 0 OR who have been rewarded (even after reset).
 *  serverId: if provided and > 0, filter by that server. Otherwise show all (pooled). */
export async function getLeaderboard(
  guildId: bigint,
  limit = 50,
  serverId?: number,
): Promise<Array<{
  steam_id: string
  player_name: string | null
  points: number
  rewarded: boolean
  rewarded_at: Date | null
}>> {
  let query: string
  let params: unknown[]

  if (serverId !== undefined && serverId > 0) {
    query = `SELECT steam_id, player_name, points, rewarded, rewarded_at
       FROM seeding_points
       WHERE guild_id = $1 AND server_id = $3 AND (points > 0 OR rewarded = TRUE)
       ORDER BY rewarded DESC, points DESC
       LIMIT $2`
    params = [guildId, limit, serverId]
  } else {
    // Pooled or aggregate: show all rows (server_id = 0 for pooled mode,
    // or all rows if no server filter)
    query = `SELECT steam_id, player_name, points, rewarded, rewarded_at
       FROM seeding_points
       WHERE guild_id = $1 AND (points > 0 OR rewarded = TRUE)
       ORDER BY rewarded DESC, points DESC
       LIMIT $2`
    params = [guildId, limit]
  }

  const result = await pool.query(query, params)
  return result.rows
}

// ─── Seeding whitelist management ────────────────────────────────────────────

/**
 * Hardcoded seeding group name and permissions.
 * This is NEVER configurable — seeding rewards always use reserve only.
 * This prevents any accidental permission escalation.
 */
const SEEDING_GROUP_NAME = "Reserve"
const SEEDING_GROUP_PERMS = "reserve"

/**
 * Get the main (default) whitelist ID for this guild.
 * Seeding rewards go into the MAIN whitelist — not a separate one.
 * The Reserve group is ensured to exist so seeding players get
 * only reserve permission even though they're on the same whitelist.
 *
 * Returns the main whitelist ID.
 */
export async function getMainWhitelistId(
  guildId: bigint,
): Promise<number | null> {
  // Always ensure the Reserve group exists with ONLY reserve permission
  await pool.query(
    `INSERT INTO squad_groups (guild_id, group_name, permissions, description, is_default, created_at, updated_at)
     VALUES ($1, $2, $3, 'Seeding rewards (reserve only, cannot be changed)', FALSE, NOW(), NOW())
     ON CONFLICT (guild_id, group_name) DO UPDATE SET
       permissions = EXCLUDED.permissions,
       description = EXCLUDED.description`,
    [guildId, SEEDING_GROUP_NAME, SEEDING_GROUP_PERMS],
  )

  // Find the main (default) whitelist
  const result = await pool.query<{ id: number }>(
    `SELECT id FROM whitelists
     WHERE guild_id = $1 AND is_default = TRUE AND enabled = TRUE
     LIMIT 1`,
    [guildId],
  )
  if (result.rows.length > 0) return result.rows[0].id

  // Fallback: first enabled whitelist
  const fallback = await pool.query<{ id: number }>(
    `SELECT id FROM whitelists
     WHERE guild_id = $1 AND enabled = TRUE
     ORDER BY id ASC LIMIT 1`,
    [guildId],
  )
  return fallback.rows[0]?.id ?? null
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
  requireDiscordLink: boolean = false,
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

    // If no Discord link and it's required, hold the reward
    if (!discordId && requireDiscordLink) {
      await client.query("ROLLBACK")
      return false
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

// ─── Population snapshots ────────────────────────────────────────────────────

/** Store a population snapshot for graphing. */
export async function savePopulationSnapshot(
  guildId: bigint,
  playerCount: number,
  isSeeding: boolean,
): Promise<void> {
  await pool.query(
    `INSERT INTO population_snapshots (guild_id, player_count, is_seeding, created_at)
     VALUES ($1, $2, $3, NOW())`,
    [guildId, playerCount, isSeeding],
  )
}

/** Clean up old snapshots (keep last 7 days) and processed notifications (keep 1 day). */
export async function cleanOldData(): Promise<void> {
  await pool.query(`DELETE FROM population_snapshots WHERE created_at < NOW() - INTERVAL '7 days'`)
  await pool.query(`DELETE FROM seeding_notifications WHERE processed = TRUE AND created_at < NOW() - INTERVAL '1 day'`)
}

// ─── Org settings ────────────────────────────────────────────────────────────

/** Get the guild's timezone from bot_settings (falls back to UTC). */
export async function getGuildTimezone(guildId: bigint): Promise<string> {
  const result = await pool.query<{ setting_value: string }>(
    `SELECT setting_value FROM bot_settings WHERE guild_id = $1 AND setting_key = 'timezone'`,
    [guildId],
  )
  return result.rows[0]?.setting_value || "UTC"
}

// ─── Streak tracking ─────────────────────────────────────────────────────────

/** Update streak for a player. Called once per day when they seed. */
export async function updateStreak(
  guildId: bigint,
  steamId: string,
  today: string, // YYYY-MM-DD format
): Promise<number> {
  // Get current streak info
  const result = await pool.query<{ current_streak: number; last_seed_date: string | null }>(
    `SELECT current_streak, last_seed_date FROM seeding_points
     WHERE guild_id = $1 AND steam_id = $2`,
    [guildId, steamId],
  )
  if (result.rows.length === 0) return 0

  const row = result.rows[0]
  if (row.last_seed_date === today) return row.current_streak // Already counted today

  // Check if yesterday was the last seed date (streak continues)
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  const yesterdayStr = yesterday.toISOString().slice(0, 10)

  let newStreak: number
  if (row.last_seed_date === yesterdayStr) {
    newStreak = row.current_streak + 1
  } else {
    newStreak = 1 // Streak broken, start fresh
  }

  await pool.query(
    `UPDATE seeding_points SET current_streak = $3, last_seed_date = $4
     WHERE guild_id = $1 AND steam_id = $2`,
    [guildId, steamId, newStreak, today],
  )

  return newStreak
}

// ─── Webhook ─────────────────────────────────────────────────────────────────

/** Send a webhook notification for a seeding event. Fire-and-forget. */
export async function sendWebhook(
  webhookUrl: string,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: eventType, timestamp: new Date().toISOString(), ...payload }),
      signal: AbortSignal.timeout(5000),
    })
  } catch (err) {
    console.error(`[seeding/db] Webhook failed for ${eventType}:`, err instanceof Error ? err.message : err)
  }
}

// ─── Notification queue ──────────────────────────────────────────────────────

/**
 * Queue a notification for the Python bot to pick up and send to Discord.
 * Event types: seeding_reward_granted, seeding_server_live, seeding_needs_seeders
 */
export async function queueNotification(
  guildId: bigint,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await pool.query(
    `INSERT INTO seeding_notifications (guild_id, event_type, payload, created_at)
     VALUES ($1, $2, $3, NOW())`,
    [guildId, eventType, JSON.stringify(payload)],
  )
}

// ─── Shutdown ────────────────────────────────────────────────────────────────

export async function closePG(): Promise<void> {
  await pool.end()
}
