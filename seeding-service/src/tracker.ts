/**
 * Core seeding tracker logic.
 *
 * Polls SquadJS instances for player counts, determines seeding mode,
 * awards points to online players, and grants whitelist rewards when
 * players reach the required threshold.
 *
 * Multi-server: each guild can have multiple seeding_servers. Each server
 * is polled independently. Points are tracked per-server or pooled based
 * on the guild's points_per_server setting.
 */

import * as db from "./db.js"
import * as squadjs from "./squadjs.js"
import { validateRewardGroup } from "./safety.js"
import { updateHealthStats } from "./health.js"
import { pool } from "./db.js"

/** Milestones at which RCON warnings are sent (descending for highest-first match). */
const MILESTONES = [100, 75, 50, 25, 10]

/** Tracks last warned percentage per player to avoid duplicate warnings. Memory-only.
 *  Key: `${guildId}:${serverId}:${steamId}` */
const lastWarnedPct = new Map<string, number>()

/** Tracks whether a server was in seeding mode on last poll (for server live / needs seeders events).
 *  Key: `${guildId}:${serverId}` */
const wasSeeding = new Map<string, boolean>()

/** Tracks last auto-seed alert time per guild:server (for cooldown).
 *  Key: `${guildId}:${serverId}` or `broadcast:${guildId}:${serverId}` */
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
 * For each enabled server (across all guilds):
 * 1. Load the guild config (cached per guild)
 * 2. Ensure Socket.IO connection is established
 * 3. Get current player list from SquadJS
 * 4. Determine if server is in seeding mode
 * 5. Award points to online players
 * 6. Grant rewards to qualifying players
 * 7. Update poll status on both server and guild
 */
export async function pollAllServers(): Promise<void> {
  const servers = await db.loadEnabledServers()

  if (servers.length === 0) {
    updateHealthStats(0, squadjs.connectionCount())
    return
  }

  // Cache guild configs to avoid re-loading for each server in the same guild
  const configCache = new Map<string, db.SeedingConfigRow | null>()

  // Process each server
  const results = await Promise.allSettled(
    servers.map(async (server) => {
      const guildKey = String(server.guild_id)
      let cfg = configCache.get(guildKey)
      if (cfg === undefined) {
        cfg = await db.loadConfigForGuild(server.guild_id)
        configCache.set(guildKey, cfg)
      }
      if (!cfg) return
      await pollServer(server, cfg)
    }),
  )

  // Log any unexpected failures
  for (let i = 0; i < results.length; i++) {
    if (results[i].status === "rejected") {
      const err = (results[i] as PromiseRejectedResult).reason
      console.error(`[seeding/tracker] Server ${servers[i].server_name} (guild ${servers[i].guild_id}) poll failed:`, err)
    }
  }

  // Count unique guilds being tracked
  const uniqueGuilds = new Set(servers.map((s) => String(s.guild_id))).size
  updateHealthStats(uniqueGuilds, squadjs.connectionCount())
}

async function pollServer(server: db.SeedingServerRow, cfg: db.SeedingConfigRow): Promise<void> {
  const guildId = cfg.guild_id
  const guildKey = String(guildId)
  const serverId = server.id
  const serverKey = `${guildKey}:${serverId}`

  // Determine server_id for point tracking: 0 = pooled, server.id = per-server
  const pointServerId = cfg.points_per_server ? serverId : 0

  // Ensure connection is established
  if (!squadjs.isConnected(guildKey, serverId)) {
    if (server.squadjs_host && server.squadjs_token) {
      squadjs.connect(guildKey, serverId, server.squadjs_host, server.squadjs_port, server.squadjs_token)
      // Give it a moment to connect on first attempt
      await new Promise((r) => setTimeout(r, 2000))
    } else {
      await db.updateServerPollStatus(serverId, "error", "No SquadJS connection configured")
      return
    }
  }

  // Check if actually connected
  if (!squadjs.isConnected(guildKey, serverId)) {
    const status = squadjs.getConnectionStatus(guildKey, serverId)
    await db.updateServerPollStatus(
      serverId,
      "error",
      `Not connected to SquadJS: ${status.lastError ?? "connecting..."} (attempts: ${status.reconnectAttempts})`,
    )
    return
  }

  // Check seeding time window (if enabled) — uses guild's timezone from org settings
  if (cfg.seeding_window_enabled) {
    const now = new Date()
    const tz = await db.getGuildTimezone(guildId)
    let localHour: number, localMinute: number
    try {
      const parts = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "numeric", hour12: false, timeZone: tz }).formatToParts(now)
      localHour = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10)
      localMinute = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10)
    } catch {
      localHour = now.getUTCHours()
      localMinute = now.getUTCMinutes()
    }
    const currentMinutes = localHour * 60 + localMinute
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
      await db.updateServerPollStatus(
        serverId,
        "ok",
        `Outside seeding window (${cfg.seeding_window_start} - ${cfg.seeding_window_end}). Currently ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`,
      )
      return
    }
  }

  // Get online players
  const players = await squadjs.getOnlinePlayers(guildKey, serverId)
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
    if (wasSeeding.get(serverKey) && playerCount > cfg.seeding_player_threshold) {
      if (cfg.discord_notify_channel_id) {
        await db.queueNotification(guildId, "seeding_server_live", {
          player_count: playerCount, threshold: cfg.seeding_player_threshold,
          channel_id: cfg.discord_notify_channel_id,
          server_name: server.server_name,
        })
      }
      if (cfg.webhook_enabled && cfg.webhook_url) {
        db.sendWebhook(cfg.webhook_url, "seeding_server_live", {
          guild_id: String(guildId), player_count: playerCount, threshold: cfg.seeding_player_threshold,
          server_name: server.server_name,
        }).catch(() => {})
      }
    }

    // Check for auto-seed alert (below minimum, with cooldown)
    if (cfg.auto_seed_alert_enabled && cfg.auto_seed_alert_role_id && cfg.discord_notify_channel_id &&
        playerCount < cfg.seeding_start_player_count) {
      const now = Date.now()
      const lastAlert = lastAutoSeedAlert.get(serverKey) ?? 0
      const cooldownMs = (cfg.auto_seed_alert_cooldown_min ?? 30) * 60 * 1000
      if (now - lastAlert > cooldownMs) {
        await db.queueNotification(guildId, "seeding_needs_seeders", {
          player_count: playerCount,
          threshold: cfg.seeding_player_threshold,
          role_id: cfg.auto_seed_alert_role_id,
          channel_id: cfg.discord_notify_channel_id,
          server_name: server.server_name,
        })
        lastAutoSeedAlert.set(serverKey, now)
      }
    }

    wasSeeding.set(serverKey, false)
    await db.updateServerPollStatus(serverId, "ok", `Not seeding: ${reason}`)
    return
  }

  wasSeeding.set(serverKey, true)

  // ── In-game seeding broadcast ─────────────────────────────────────────
  if (cfg.rcon_broadcast_enabled && cfg.rcon_broadcast_message) {
    const broadcastKey = `broadcast:${serverKey}`
    const lastBroadcast = lastAutoSeedAlert.get(broadcastKey) ?? 0
    const intervalMs = (cfg.rcon_broadcast_interval_min ?? 10) * 60 * 1000
    if (Date.now() - lastBroadcast > intervalMs) {
      // Broadcast to all players on the server
      const broadcastMsg = cfg.rcon_broadcast_message
        .replace(/\{player_count\}/g, String(playerCount))
        .replace(/\{threshold\}/g, String(cfg.seeding_player_threshold))
      for (const p of players) {
        squadjs.warnPlayer(guildKey, serverId, p.steamId, broadcastMsg).catch(() => {})
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
      awarded += await db.awardPoints(guildId, playerInputs, pointServerId)
    }
  } else {
    awarded = await db.awardPoints(guildId, playerInputs, pointServerId)
  }

  // ── Streak tracking ───────────────────────────────────────────────────
  if (cfg.streak_enabled) {
    // Use guild timezone for streak date tracking
    const tz = await db.getGuildTimezone(guildId)
    let today: string
    try {
      today = new Date().toLocaleDateString("en-CA", { timeZone: tz }) // YYYY-MM-DD format
    } catch {
      today = new Date().toISOString().slice(0, 10)
    }
    // Batch streak updates with Promise.all to avoid N+1
    const streakResults = await Promise.all(
      playerInputs.map((p) => db.updateStreak(guildId, p.steamId, today))
    )
    // Award bonus points for players who hit the streak threshold
    const bonusPlayers = playerInputs.filter((_, idx) =>
      streakResults[idx] >= cfg.streak_days_required && cfg.streak_multiplier > 1
    )
    if (bonusPlayers.length > 0) {
      const bonusPoints = Math.max(1, Math.ceil(cfg.streak_multiplier - 1))
      for (let i = 0; i < bonusPoints; i++) {
        await db.awardPoints(guildId, bonusPlayers, pointServerId)
      }
    }
  }

  // ── RCON milestone warnings ───────────────────────────────────────────
  if (cfg.rcon_warnings_enabled) {
    try {
      const steamIds = playerInputs.map((p) => p.steamId)
      const pointsMap = await db.getPlayerPointsBatch(guildId, steamIds, pointServerId)
      const tiers = cfg.reward_tiers as db.RewardTier[] | null
      const effectiveMax = tiers?.length
        ? Math.max(...tiers.map((t) => t.points))
        : cfg.points_required

      const warnings: Promise<boolean>[] = []
      for (const p of playerInputs) {
        const pts = pointsMap.get(p.steamId) ?? 0
        const pct = effectiveMax > 0 ? Math.round((pts / effectiveMax) * 100) : 0
        const key = `${guildId}:${serverId}:${p.steamId}`
        const lastPct = lastWarnedPct.get(key) ?? 0

        for (const milestone of MILESTONES) {
          if (pct >= milestone && lastPct < milestone) {
            const msg = formatWarning(cfg.rcon_warning_message, pct, pts, effectiveMax, p.name)
            warnings.push(squadjs.warnPlayer(guildKey, serverId, p.steamId, msg))
            lastWarnedPct.set(key, pct)
            break // only send highest newly crossed milestone
          }
        }
      }
      if (warnings.length > 0) await Promise.allSettled(warnings)
    } catch (err) {
      console.error(`[seeding/tracker] RCON warning error for guild ${guildId} server ${serverId}:`, err)
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
    // Group is hardcoded to Reserve:reserve — no safety check needed
    {
      const whitelistId = await db.getMainWhitelistId(guildId)

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
            cfg.require_discord_link,
          )
          if (ok) {
            await db.markRewarded(guildId, q.steam_id)
            rewarded++
            console.log(`[seeding/tracker] Reward granted: ${q.player_name ?? q.steam_id} → ${tierLabel || "standard"} (${duration}h) in guild ${guildId} server ${server.server_name}`)

            // Queue Discord notification for reward
            if (cfg.discord_notify_channel_id) {
              await db.queueNotification(guildId, "seeding_reward_granted", {
                steam_id: q.steam_id,
                player_name: q.player_name,
                tier_label: tierLabel || "Standard",
                duration_hours: duration,
                channel_id: cfg.discord_notify_channel_id,
                server_name: server.server_name,
              }).catch(() => {}) // non-blocking
            }

            // Send webhook if configured
            if (cfg.webhook_enabled && cfg.webhook_url) {
              db.sendWebhook(cfg.webhook_url, "seeding_reward_granted", {
                guild_id: String(guildId), steam_id: q.steam_id,
                player_name: q.player_name, tier_label: tierLabel || "Standard",
                duration_hours: duration,
                server_name: server.server_name,
              }).catch(() => {})
            }

            // Queue Discord role assignment
            if (cfg.discord_role_reward_enabled && cfg.discord_role_reward_id) {
              await db.queueNotification(guildId, "seeding_role_grant", {
                steam_id: q.steam_id,
                player_name: q.player_name,
                role_id: cfg.discord_role_reward_id,
              }).catch(() => {})
            }
          } else if (cfg.require_discord_link) {
            console.log(`[seeding/tracker] Reward held for ${q.player_name ?? q.steam_id} — no Discord link (guild ${guildId})`)
          }
        }
      } else {
        console.warn(`[seeding/tracker] Guild ${guildId}: No whitelist configured for rewards`)
      }
    }
  }

  const msg = `Seeding active: ${playerCount} players on ${server.server_name}, ${awarded} points awarded${rewarded > 0 ? `, ${rewarded} rewards granted` : ""}`
  await db.updateServerPollStatus(serverId, "ok", msg)
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
  await db.cleanOldData().catch(() => {})
}
