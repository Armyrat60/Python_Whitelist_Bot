/**
 * Core seeding tracker logic.
 *
 * Polls SquadJS instances for player counts, determines seeding mode,
 * awards points to online players, and grants whitelist rewards when
 * players reach the required threshold.
 */

import * as db from "./db.js"
import * as squadjs from "./squadjs.js"
import { validateRewardGroup } from "./safety.js"
import { updateHealthStats } from "./health.js"
import { pool } from "./db.js"

/**
 * Main poll loop — called every minute by cron.
 *
 * For each enabled guild:
 * 1. Ensure Socket.IO connection is established
 * 2. Get current player list from SquadJS
 * 3. Determine if server is in seeding mode
 * 4. Award points to online players
 * 5. Grant rewards to qualifying players
 * 6. Update poll status
 */
export async function pollAllGuilds(): Promise<void> {
  const configs = await db.loadEnabledConfigs()

  if (configs.length === 0) {
    updateHealthStats(0, squadjs.connectionCount())
    return
  }

  // Process each guild
  const results = await Promise.allSettled(
    configs.map((cfg) => pollGuild(cfg)),
  )

  // Log any unexpected failures
  for (let i = 0; i < results.length; i++) {
    if (results[i].status === "rejected") {
      const err = (results[i] as PromiseRejectedResult).reason
      console.error(`[seeding/tracker] Guild ${configs[i].guild_id} poll failed:`, err)
    }
  }

  updateHealthStats(configs.length, squadjs.connectionCount())
}

async function pollGuild(cfg: db.SeedingConfigRow): Promise<void> {
  const guildId = cfg.guild_id
  const guildKey = String(guildId)

  // Ensure connection is established
  if (!squadjs.isConnected(guildKey)) {
    if (cfg.squadjs_host && cfg.squadjs_token) {
      squadjs.connect(guildKey, cfg.squadjs_host, cfg.squadjs_port, cfg.squadjs_token)
      // Give it a moment to connect on first attempt
      await new Promise((r) => setTimeout(r, 2000))
    } else {
      await db.updatePollStatus(guildId, "error", "No SquadJS connection configured")
      return
    }
  }

  // Check if actually connected
  if (!squadjs.isConnected(guildKey)) {
    const status = squadjs.getConnectionStatus(guildKey)
    await db.updatePollStatus(
      guildId,
      "error",
      `Not connected to SquadJS: ${status.lastError ?? "connecting..."} (attempts: ${status.reconnectAttempts})`,
    )
    return
  }

  // Get online players
  const players = await squadjs.getOnlinePlayers(guildKey)
  const playerCount = players.length

  // Determine seeding mode
  const isSeedingMode =
    playerCount >= cfg.seeding_start_player_count &&
    playerCount <= cfg.seeding_player_threshold

  if (!isSeedingMode) {
    const reason = playerCount < cfg.seeding_start_player_count
      ? `Player count (${playerCount}) below minimum (${cfg.seeding_start_player_count})`
      : `Player count (${playerCount}) above threshold (${cfg.seeding_player_threshold})`

    await db.updatePollStatus(guildId, "ok", `Not seeding: ${reason}`)
    return
  }

  // Server is in seeding mode — award points
  const playerInputs: db.PlayerInput[] = players.map((p) => ({
    steamId: p.steamId,
    name: p.name,
  }))

  const awarded = await db.awardPoints(guildId, playerInputs)

  // Check for players who qualify for rewards
  let rewarded = 0
  const qualifiers = await db.getUnrewardedQualifiers(guildId, cfg.points_required)

  if (qualifiers.length > 0) {
    // Validate reward group safety before granting any rewards
    const safety = await validateRewardGroup(pool, guildId, cfg.reward_group_name)

    if (!safety.safe) {
      console.warn(
        `[seeding/tracker] Guild ${guildId}: Skipping rewards — ${safety.reason}`,
      )
      await db.logAudit(
        guildId,
        "seeding_reward_blocked",
        JSON.stringify({ reason: safety.reason, qualifiers: qualifiers.length }),
      )
    } else {
      // Use the dedicated seeding whitelist (auto-created with correct group)
      const whitelistId = await db.ensureSeedingWhitelist(guildId, cfg.reward_group_name)

      if (whitelistId) {
        for (const q of qualifiers) {
          const ok = await db.createWhitelistReward(
            guildId,
            q.steam_id,
            q.player_name,
            whitelistId,
            cfg.reward_group_name,
            cfg.reward_duration_hours,
          )
          if (ok) {
            await db.markRewarded(guildId, q.steam_id)
            rewarded++
            console.log(
              `[seeding/tracker] Reward granted to ${q.player_name ?? q.steam_id} in guild ${guildId}`,
            )
          }
        }
      } else {
        console.warn(`[seeding/tracker] Guild ${guildId}: No whitelist configured for rewards`)
      }
    }
  }

  const msg = `Seeding active: ${playerCount} players, ${awarded} points awarded${rewarded > 0 ? `, ${rewarded} rewards granted` : ""}`
  await db.updatePollStatus(guildId, "ok", msg)
}


/**
 * Run the fixed_reset point reset for all guilds.
 * Called on each guild's reset_cron schedule.
 */
export async function runPointResets(): Promise<void> {
  const configs = await db.loadEnabledConfigs()

  for (const cfg of configs) {
    if (cfg.tracking_mode !== "fixed_reset") continue

    // The cron scheduler in index.ts handles per-guild reset timing.
    // This function is called when the reset is due.
    const count = await db.resetPoints(cfg.guild_id)
    if (count > 0) {
      console.log(`[seeding/tracker] Reset ${count} player points for guild ${cfg.guild_id}`)
      await db.logAudit(
        cfg.guild_id,
        "seeding_points_reset",
        JSON.stringify({ players_reset: count, mode: "fixed_reset" }),
      )
    }
  }
}

/**
 * Run expiry cleanup for seeding rewards.
 * Sets status='expired' for any rewards past their expires_at date.
 */
export async function runExpiryCleanup(): Promise<void> {
  const expired = await db.expireSeedingRewards()
  if (expired > 0) {
    console.log(`[seeding/tracker] Expired ${expired} seeding reward(s)`)
  }
}
