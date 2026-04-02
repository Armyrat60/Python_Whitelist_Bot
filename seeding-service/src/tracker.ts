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

/** Milestones at which RCON warnings are sent (descending for highest-first match). */
const MILESTONES = [100, 75, 50, 25, 10]

/** Tracks last warned percentage per player to avoid duplicate warnings. Memory-only. */
const lastWarnedPct = new Map<string, number>()

/** Format an RCON warning message with template variables. */
function formatWarning(template: string, progress: number, points: number, required: number, playerName: string): string {
  return template
    .replace(/\{progress\}/g, String(progress))
    .replace(/\{points\}/g, String(points))
    .replace(/\{required\}/g, String(required))
    .replace(/\{player_name\}/g, playerName)
}

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

  // Check seeding time window (if enabled)
  if (cfg.seeding_window_enabled) {
    const now = new Date()
    const currentMinutes = now.getHours() * 60 + now.getMinutes()
    const [startH, startM] = cfg.seeding_window_start.split(":").map(Number)
    const [endH, endM] = cfg.seeding_window_end.split(":").map(Number)
    const windowStart = (startH ?? 7) * 60 + (startM ?? 0)
    const windowEnd = (endH ?? 22) * 60 + (endM ?? 0)

    let inWindow: boolean
    if (windowStart <= windowEnd) {
      // Normal window: e.g. 07:00 - 22:00
      inWindow = currentMinutes >= windowStart && currentMinutes < windowEnd
    } else {
      // Overnight window: e.g. 22:00 - 07:00
      inWindow = currentMinutes >= windowStart || currentMinutes < windowEnd
    }

    if (!inWindow) {
      await db.updatePollStatus(
        guildId,
        "ok",
        `Outside seeding window (${cfg.seeding_window_start} - ${cfg.seeding_window_end}). Currently ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`,
      )
      return
    }
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

  // ── RCON milestone warnings ───────────────────────────────────────────
  if (cfg.rcon_warnings_enabled) {
    try {
      const steamIds = playerInputs.map((p) => p.steamId)
      const pointsMap = await db.getPlayerPointsBatch(guildId, steamIds)
      const tiers = cfg.reward_tiers as db.RewardTier[] | null
      const effectiveMax = tiers?.length
        ? Math.max(...tiers.map((t) => t.points))
        : cfg.points_required

      const warnings: Promise<boolean>[] = []
      for (const p of playerInputs) {
        const pts = pointsMap.get(p.steamId) ?? 0
        const pct = effectiveMax > 0 ? Math.round((pts / effectiveMax) * 100) : 0
        const key = `${guildId}:${p.steamId}`
        const lastPct = lastWarnedPct.get(key) ?? 0

        for (const milestone of MILESTONES) {
          if (pct >= milestone && lastPct < milestone) {
            const msg = formatWarning(cfg.rcon_warning_message, pct, pts, effectiveMax, p.name)
            warnings.push(squadjs.warnPlayer(guildKey, p.steamId, msg))
            lastWarnedPct.set(key, pct)
            break // only send highest newly crossed milestone
          }
        }
      }
      if (warnings.length > 0) await Promise.allSettled(warnings)
    } catch (err) {
      console.error(`[seeding/tracker] RCON warning error for guild ${guildId}:`, err)
    }
  }

  // ── Check for players who qualify for rewards ─────────────────────────
  let rewarded = 0
  const tiers = cfg.reward_tiers as db.RewardTier[] | null
  const hasTiers = tiers && tiers.length >= 2

  // Determine the minimum threshold to check
  const minThreshold = hasTiers
    ? Math.min(...tiers.map((t) => t.points))
    : cfg.points_required

  const qualifiers = await db.getUnrewardedQualifiers(guildId, minThreshold)

  if (qualifiers.length > 0) {
    const safety = await validateRewardGroup(pool, guildId, cfg.reward_group_name)

    if (!safety.safe) {
      console.warn(`[seeding/tracker] Guild ${guildId}: Skipping rewards — ${safety.reason}`)
      await db.logAudit(guildId, "seeding_reward_blocked", JSON.stringify({ reason: safety.reason, qualifiers: qualifiers.length }))
    } else {
      const whitelistId = await db.ensureSeedingWhitelist(guildId, cfg.reward_group_name)

      if (whitelistId) {
        // Sort tiers descending for highest-first matching
        const sortedTiers = hasTiers ? [...tiers].sort((a, b) => b.points - a.points) : null

        for (const q of qualifiers) {
          // Find the duration: highest matching tier or legacy single duration
          let duration = cfg.reward_duration_hours
          let tierLabel = ""

          if (sortedTiers) {
            const matchedTier = sortedTiers.find((t) => q.points >= t.points)
            if (!matchedTier) continue // shouldn't happen, but guard
            duration = matchedTier.duration_hours
            tierLabel = matchedTier.label
          }

          const ok = await db.createWhitelistReward(
            guildId, q.steam_id, q.player_name,
            whitelistId, cfg.reward_group_name, duration,
          )
          if (ok) {
            await db.markRewarded(guildId, q.steam_id)
            rewarded++
            console.log(`[seeding/tracker] Reward granted: ${q.player_name ?? q.steam_id} → ${tierLabel || "standard"} (${duration}h) in guild ${guildId}`)
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
 * Run daily decay for guilds using daily_decay tracking mode.
 * Subtracts points from players who haven't seeded recently.
 */
export async function runDailyDecay(): Promise<void> {
  try {
    await db.runDailyDecay()
  } catch (err) {
    console.error("[seeding/tracker] Daily decay failed:", err)
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
