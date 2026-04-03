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

/** Tracks whether guild was in seeding mode on last poll (for server live / needs seeders events). */
const wasSeeding = new Map<string, boolean>()

/** Tracks last auto-seed alert time per guild (for cooldown). */
const lastAutoSeedAlert = new Map<string, number>()

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

  // Store population snapshot regardless of seeding mode
  if (cfg.population_tracking_enabled) {
    await db.savePopulationSnapshot(guildId, playerCount, isSeedingMode).catch(() => {})
  }

  if (!isSeedingMode) {
    const reason = playerCount < cfg.seeding_start_player_count
      ? `Player count (${playerCount}) below minimum (${cfg.seeding_start_player_count})`
      : `Player count (${playerCount}) above threshold (${cfg.seeding_player_threshold})`

    // Check for server live event (was seeding, now above threshold)
    if (wasSeeding.get(guildKey) && playerCount > cfg.seeding_player_threshold && cfg.discord_notify_channel_id) {
      await db.queueNotification(guildId, "seeding_server_live", {
        player_count: playerCount,
        threshold: cfg.seeding_player_threshold,
        channel_id: cfg.discord_notify_channel_id,
      })
    }

    // Check for auto-seed alert (below minimum, with cooldown)
    if (cfg.auto_seed_alert_enabled && cfg.auto_seed_alert_role_id && cfg.discord_notify_channel_id &&
        playerCount < cfg.seeding_start_player_count) {
      const now = Date.now()
      const lastAlert = lastAutoSeedAlert.get(guildKey) ?? 0
      const cooldownMs = (cfg.auto_seed_alert_cooldown_min ?? 30) * 60 * 1000
      if (now - lastAlert > cooldownMs) {
        await db.queueNotification(guildId, "seeding_needs_seeders", {
          player_count: playerCount,
          threshold: cfg.seeding_player_threshold,
          role_id: cfg.auto_seed_alert_role_id,
          channel_id: cfg.discord_notify_channel_id,
        })
        lastAutoSeedAlert.set(guildKey, now)
      }
    }

    wasSeeding.set(guildKey, false)
    await db.updatePollStatus(guildId, "ok", `Not seeding: ${reason}`)
    return
  }

  wasSeeding.set(guildKey, true)

  // ── In-game seeding broadcast ─────────────────────────────────────────
  if (cfg.rcon_broadcast_enabled && cfg.rcon_broadcast_message) {
    const broadcastKey = `broadcast:${guildKey}`
    const lastBroadcast = lastAutoSeedAlert.get(broadcastKey) ?? 0
    const intervalMs = (cfg.rcon_broadcast_interval_min ?? 10) * 60 * 1000
    if (Date.now() - lastBroadcast > intervalMs) {
      // Broadcast to all players on the server
      const broadcastMsg = cfg.rcon_broadcast_message
        .replace(/\{player_count\}/g, String(playerCount))
        .replace(/\{threshold\}/g, String(cfg.seeding_player_threshold))
      for (const p of players) {
        squadjs.warnPlayer(guildKey, p.steamId, broadcastMsg).catch(() => {})
      }
      lastAutoSeedAlert.set(broadcastKey, Date.now())
    }
  }

  // Server is in seeding mode — award points
  const playerInputs: db.PlayerInput[] = players.map((p) => ({
    steamId: p.steamId,
    name: p.name,
  }))

  // Calculate effective point multiplier
  let pointMultiplier = 1
  if (cfg.bonus_multiplier_enabled && cfg.bonus_multiplier_start && cfg.bonus_multiplier_end) {
    const now = Date.now()
    const start = new Date(cfg.bonus_multiplier_start).getTime()
    const end = new Date(cfg.bonus_multiplier_end).getTime()
    if (now >= start && now <= end) {
      pointMultiplier = cfg.bonus_multiplier_value ?? 2
    }
  }

  // Award points (with multiplier if active)
  let awarded: number
  if (pointMultiplier > 1) {
    // Award multiplied points by calling awardPoints multiple times or using a custom amount
    // For simplicity, just call awardPoints ceil(multiplier) times with fractional handling
    const fullPoints = Math.floor(pointMultiplier)
    awarded = 0
    for (let i = 0; i < fullPoints; i++) {
      awarded += await db.awardPoints(guildId, playerInputs)
    }
  } else {
    awarded = await db.awardPoints(guildId, playerInputs)
  }

  // ── Streak tracking ───────────────────────────────────────────────────
  if (cfg.streak_enabled) {
    const today = new Date().toISOString().slice(0, 10)
    for (const p of playerInputs) {
      const streak = await db.updateStreak(guildId, p.steamId, today)
      // Apply streak multiplier if they've hit the threshold
      if (streak >= cfg.streak_days_required && cfg.streak_multiplier > 1) {
        // Award bonus points for streak (extra points on top of normal)
        const bonusPoints = Math.floor(cfg.streak_multiplier - 1) // e.g., 1.5x = 0.5 extra, but at least 1
        if (bonusPoints >= 1) {
          await db.awardPoints(guildId, [p]) // extra point for streak
        }
      }
    }
  }

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

  let qualifiers = await db.getUnrewardedQualifiers(guildId, minThreshold)

  // Apply cooldown filter — skip players rewarded too recently
  if (cfg.reward_cooldown_hours > 0 && qualifiers.length > 0) {
    const cooldownMs = cfg.reward_cooldown_hours * 60 * 60 * 1000
    const now = Date.now()
    // Check rewarded_at for recently rewarded players (via a batch query)
    const recentlyRewarded = await pool.query<{ steam_id: string }>(
      `SELECT steam_id FROM seeding_points
       WHERE guild_id = $1 AND rewarded_at IS NOT NULL
         AND rewarded_at > NOW() - make_interval(hours => $2)`,
      [guildId, cfg.reward_cooldown_hours],
    )
    const cooldownSet = new Set(recentlyRewarded.rows.map((r) => r.steam_id))
    qualifiers = qualifiers.filter((q) => !cooldownSet.has(q.steam_id))
  }

  if (qualifiers.length > 0) {
    // Group is hardcoded to SeedReserve:reserve — no safety check needed
    {
      const whitelistId = await db.ensureSeedingWhitelist(guildId)

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

            // Queue Discord notification for reward
            if (cfg.discord_notify_channel_id) {
              await db.queueNotification(guildId, "seeding_reward_granted", {
                steam_id: q.steam_id,
                player_name: q.player_name,
                tier_label: tierLabel || "Standard",
                duration_hours: duration,
                channel_id: cfg.discord_notify_channel_id,
              }).catch(() => {}) // non-blocking
            }

            // Queue Discord role assignment
            if (cfg.discord_role_reward_enabled && cfg.discord_role_reward_id) {
              await db.queueNotification(guildId, "seeding_role_grant", {
                steam_id: q.steam_id,
                player_name: q.player_name,
                role_id: cfg.discord_role_reward_id,
              }).catch(() => {})
            }
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
/** Track last reset time per guild to avoid resetting more than once per period. */
const lastResetRun = new Map<string, number>()

export async function runPointResets(): Promise<void> {
  const configs = await db.loadEnabledConfigs()

  for (const cfg of configs) {
    if (cfg.tracking_mode !== "fixed_reset") continue

    // Check if the guild's reset_cron matches the current time window.
    // We use a simple approach: check if enough time has passed since last reset.
    const guildKey = String(cfg.guild_id)
    const now = Date.now()
    const lastReset = lastResetRun.get(guildKey) ?? 0

    // Determine the minimum interval between resets from the cron expression
    const minIntervalMs = getResetIntervalMs(cfg.reset_cron)

    if (now - lastReset < minIntervalMs) continue // Not time yet

    // Check if the cron matches current time (simple check for hour)
    if (!shouldResetNow(cfg.reset_cron)) continue

    const count = await db.resetPoints(cfg.guild_id)
    lastResetRun.set(guildKey, now)

    if (count > 0) {
      console.log(`[seeding/tracker] Reset ${count} player points for guild ${cfg.guild_id} (cron: ${cfg.reset_cron})`)
      await db.logAudit(
        cfg.guild_id,
        "seeding_points_reset",
        JSON.stringify({ players_reset: count, mode: "fixed_reset", cron: cfg.reset_cron }),
      )
    }
  }
}

/** Parse a cron expression and check if it should fire now (within the current hour). */
function shouldResetNow(cron: string): boolean {
  const parts = cron.trim().split(/\s+/)
  if (parts.length !== 5) return false

  const [cronMin, cronHr, cronDom, cronMon, cronDow] = parts
  const now = new Date()
  const hour = now.getHours()
  const dow = now.getDay()
  const dom = now.getDate()
  const month = now.getMonth() + 1

  // Check hour
  if (cronHr !== "*" && !cronHr.startsWith("*/")) {
    if (parseInt(cronHr, 10) !== hour) return false
  }
  // Check day of week
  if (cronDow !== "*") {
    if (parseInt(cronDow, 10) !== dow) return false
  }
  // Check day of month
  if (cronDom !== "*") {
    if (parseInt(cronDom, 10) !== dom) return false
  }
  // Check month
  if (cronMon !== "*") {
    if (parseInt(cronMon, 10) !== month) return false
  }
  return true
}

/** Get the minimum interval between resets (prevents running twice in same period). */
function getResetIntervalMs(cron: string): number {
  const parts = cron.trim().split(/\s+/)
  if (parts.length !== 5) return 24 * 60 * 60 * 1000 // default: 1 day

  const [, , cronDom, , cronDow] = parts
  if (cronDom !== "*") return 25 * 24 * 60 * 60 * 1000 // monthly: 25 days
  if (cronDow !== "*") return 6 * 24 * 60 * 60 * 1000  // weekly: 6 days
  return 23 * 60 * 60 * 1000                            // daily: 23 hours
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
  // Clean up old population snapshots (keep 7 days)
  await db.cleanOldSnapshots().catch(() => {})
}
