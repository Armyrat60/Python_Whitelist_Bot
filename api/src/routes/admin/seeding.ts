/**
 * Seeding module configuration and leaderboard routes.
 *
 * GET    /seeding-config         — get this guild's seeding config (token masked)
 * PUT    /seeding-config         — create or update seeding config
 * DELETE /seeding-config         — remove seeding config
 * POST   /seeding-config/test    — test Socket.IO connection to SquadJS
 * GET    /seeding/leaderboard    — top seeders by points
 * GET    /seeding/players        — paginated player list with points
 * POST   /seeding/reset          — manual point reset
 * POST   /seeding/grant          — manual point grant to specific player
 */
import type { FastifyInstance } from "fastify"
import { Prisma } from "@prisma/client"

const MASKED = "••••••••"

export default async function seedingRoutes(app: FastifyInstance) {
  const adminHook = [app.requireAdmin]

  // ── GET /seeding-config ──────────────────────────────────────────────────

  app.get("/seeding-config", { preHandler: adminHook }, async (req, reply) => {
    const guildId = BigInt(req.session.activeGuildId!)

    const config = await app.prisma.seedingConfig.findUnique({ where: { guildId } })

    if (!config) return reply.send({ config: null })

    return reply.send({
      config: {
        id:                          config.id,
        squadjs_host:                config.squadjsHost,
        squadjs_port:                config.squadjsPort,
        squadjs_token:               MASKED,  // never expose the real token
        seeding_start_player_count:  config.seedingStartPlayerCount,
        seeding_player_threshold:    config.seedingPlayerThreshold,
        points_required:             config.pointsRequired,
        reward_whitelist_id:         config.rewardWhitelistId,
        reward_group_name:           config.rewardGroupName,
        reward_duration_hours:       config.rewardDurationHours,
        tracking_mode:               config.trackingMode,
        reset_cron:                  config.resetCron,
        poll_interval_seconds:       config.pollIntervalSeconds,
        seeding_window_enabled:      config.seedingWindowEnabled,
        seeding_window_start:        config.seedingWindowStart,
        seeding_window_end:          config.seedingWindowEnd,
        enabled:                     config.enabled,
        last_poll_at:                config.lastPollAt?.toISOString() ?? null,
        last_poll_status:            config.lastPollStatus,
        last_poll_message:           config.lastPollMessage,
        reward_tiers:                config.rewardTiers,
        rcon_warnings_enabled:       config.rconWarningsEnabled,
        rcon_warning_message:        config.rconWarningMessage,
        decay_days_threshold:        config.decayDaysThreshold,
        decay_points_per_day:        config.decayPointsPerDay,
        leaderboard_public:          config.leaderboardPublic,
        created_at:                  config.createdAt.toISOString(),
        updated_at:                  config.updatedAt.toISOString(),
      },
    })
  })

  // ── PUT /seeding-config ──────────────────────────────────────────────────

  app.put<{
    Body: {
      squadjs_host?: string
      squadjs_port?: number
      squadjs_token?: string
      seeding_start_player_count?: number
      seeding_player_threshold?: number
      points_required?: number
      reward_whitelist_id?: number | null
      reward_group_name?: string
      reward_duration_hours?: number
      tracking_mode?: string
      reset_cron?: string
      poll_interval_seconds?: number
      seeding_window_enabled?: boolean
      seeding_window_start?: string
      seeding_window_end?: string
      reward_tiers?: Array<{ points: number; duration_hours: number; label: string }> | null
      rcon_warnings_enabled?: boolean
      rcon_warning_message?: string
      decay_days_threshold?: number
      decay_points_per_day?: number
      enabled?: boolean
      leaderboard_public?: boolean
    }
  }>("/seeding-config", { preHandler: adminHook }, async (req, reply) => {
    const guildId = BigInt(req.session.activeGuildId!)
    const body = req.body ?? {}

    const existing = await app.prisma.seedingConfig.findUnique({ where: { guildId } })

    // Handle masked token — keep stored value if masked
    const token =
      body.squadjs_token && body.squadjs_token !== MASKED
        ? body.squadjs_token
        : existing?.squadjsToken

    if (!token && !existing) {
      return reply.code(400).send({ error: "squadjs_token is required when creating a new config" })
    }

    const host = body.squadjs_host ?? existing?.squadjsHost
    if (!host) {
      return reply.code(400).send({ error: "squadjs_host is required" })
    }

    // Validate thresholds
    const startCount = body.seeding_start_player_count ?? existing?.seedingStartPlayerCount ?? 2
    const threshold = body.seeding_player_threshold ?? existing?.seedingPlayerThreshold ?? 50
    if (startCount >= threshold) {
      return reply.code(400).send({ error: "seeding_start_player_count must be less than seeding_player_threshold" })
    }

    const pointsRequired = body.points_required ?? existing?.pointsRequired ?? 120
    if (pointsRequired < 1 || pointsRequired > 10000) {
      return reply.code(400).send({ error: "points_required must be between 1 and 10000" })
    }

    // Validate tracking mode
    const trackingMode = body.tracking_mode ?? existing?.trackingMode ?? "fixed_reset"
    if (!["fixed_reset", "daily_decay"].includes(trackingMode)) {
      return reply.code(400).send({ error: "tracking_mode must be 'fixed_reset' or 'daily_decay'" })
    }

    // Validate tiered rewards
    if (body.reward_tiers !== undefined && body.reward_tiers !== null) {
      if (!Array.isArray(body.reward_tiers) || body.reward_tiers.length < 2 || body.reward_tiers.length > 5) {
        return reply.code(400).send({ error: "reward_tiers must have 2-5 entries" })
      }
      const pts = body.reward_tiers.map((t) => t.points).sort((a, b) => a - b)
      if (new Set(pts).size !== pts.length) {
        return reply.code(400).send({ error: "Tier point values must be unique" })
      }
      for (const t of body.reward_tiers) {
        if (!t.points || t.points < 1 || !t.duration_hours || t.duration_hours < 1 || !t.label?.trim()) {
          return reply.code(400).send({ error: "Each tier needs points >= 1, duration_hours >= 1, and a label" })
        }
      }
    }

    // Validate decay settings
    if (body.decay_days_threshold !== undefined && (body.decay_days_threshold < 1 || body.decay_days_threshold > 30)) {
      return reply.code(400).send({ error: "decay_days_threshold must be 1-30" })
    }
    if (body.decay_points_per_day !== undefined && (body.decay_points_per_day < 1 || body.decay_points_per_day > 1000)) {
      return reply.code(400).send({ error: "decay_points_per_day must be 1-1000" })
    }

    // Validate reward group safety
    const groupName = body.reward_group_name ?? existing?.rewardGroupName ?? "reserve"
    const group = await app.prisma.squadGroup.findUnique({
      where: { guildId_groupName: { guildId, groupName } },
    })
    if (group) {
      const perms = group.permissions.split(",").map((p) => p.trim().toLowerCase())
      const dangerous = perms.filter((p) =>
        ["ban", "kick", "immune", "changemap", "config", "cameraman", "canseeadminchat", "manageserver", "cheat"].includes(p),
      )
      if (dangerous.length > 0) {
        return reply.code(400).send({
          error: `Reward group "${groupName}" has dangerous permissions: ${dangerous.join(", ")}. Only safe permissions (reserve, balance, teamchange) are allowed.`,
        })
      }
    }

    const config = await app.prisma.seedingConfig.upsert({
      where: { guildId },
      create: {
        guildId,
        squadjsHost:            host,
        squadjsPort:            body.squadjs_port            ?? 3000,
        squadjsToken:           token!,
        seedingStartPlayerCount: startCount,
        seedingPlayerThreshold: threshold,
        pointsRequired:         pointsRequired,
        rewardWhitelistId:      body.reward_whitelist_id     ?? null,
        rewardGroupName:        groupName,
        rewardDurationHours:    body.reward_duration_hours   ?? 168,
        trackingMode:           trackingMode,
        resetCron:              body.reset_cron              ?? "0 0 * * *",
        pollIntervalSeconds:    body.poll_interval_seconds   ?? 60,
        seedingWindowEnabled:   body.seeding_window_enabled  ?? false,
        seedingWindowStart:     body.seeding_window_start    ?? "07:00",
        seedingWindowEnd:       body.seeding_window_end      ?? "22:00",
        rewardTiers:            body.reward_tiers            ?? Prisma.JsonNull,
        rconWarningsEnabled:    body.rcon_warnings_enabled   ?? false,
        rconWarningMessage:     body.rcon_warning_message    ?? "Seeding Progress: {progress}% ({points}/{required}). Keep seeding!",
        decayDaysThreshold:     body.decay_days_threshold    ?? 3,
        decayPointsPerDay:      body.decay_points_per_day    ?? 10,
        enabled:                body.enabled                 ?? false,
        leaderboardPublic:      body.leaderboard_public      ?? false,
      },
      update: {
        squadjsHost:            host,
        squadjsPort:            body.squadjs_port            ?? existing?.squadjsPort            ?? 3000,
        squadjsToken:           token!,
        seedingStartPlayerCount: startCount,
        seedingPlayerThreshold: threshold,
        pointsRequired:         pointsRequired,
        rewardWhitelistId:      body.reward_whitelist_id !== undefined ? body.reward_whitelist_id : existing?.rewardWhitelistId,
        rewardGroupName:        groupName,
        rewardDurationHours:    body.reward_duration_hours   ?? existing?.rewardDurationHours    ?? 168,
        trackingMode:           trackingMode,
        resetCron:              body.reset_cron              ?? existing?.resetCron              ?? "0 0 * * *",
        pollIntervalSeconds:    body.poll_interval_seconds   ?? existing?.pollIntervalSeconds    ?? 60,
        seedingWindowEnabled:   body.seeding_window_enabled  ?? existing?.seedingWindowEnabled   ?? false,
        seedingWindowStart:     body.seeding_window_start    ?? existing?.seedingWindowStart     ?? "07:00",
        seedingWindowEnd:       body.seeding_window_end      ?? existing?.seedingWindowEnd       ?? "22:00",
        rewardTiers:            body.reward_tiers !== undefined ? (body.reward_tiers ?? Prisma.JsonNull) : (existing?.rewardTiers ?? Prisma.JsonNull),
        rconWarningsEnabled:    body.rcon_warnings_enabled   ?? existing?.rconWarningsEnabled    ?? false,
        rconWarningMessage:     body.rcon_warning_message    ?? existing?.rconWarningMessage     ?? "Seeding Progress: {progress}% ({points}/{required}). Keep seeding!",
        decayDaysThreshold:     body.decay_days_threshold    ?? existing?.decayDaysThreshold     ?? 3,
        decayPointsPerDay:      body.decay_points_per_day    ?? existing?.decayPointsPerDay      ?? 10,
        enabled:                body.enabled                 ?? existing?.enabled                ?? false,
        leaderboardPublic:      body.leaderboard_public      ?? existing?.leaderboardPublic      ?? false,
      },
    })

    return reply.send({
      ok: true,
      config: {
        id:                          config.id,
        squadjs_host:                config.squadjsHost,
        squadjs_port:                config.squadjsPort,
        squadjs_token:               MASKED,
        seeding_start_player_count:  config.seedingStartPlayerCount,
        seeding_player_threshold:    config.seedingPlayerThreshold,
        points_required:             config.pointsRequired,
        reward_whitelist_id:         config.rewardWhitelistId,
        reward_group_name:           config.rewardGroupName,
        reward_duration_hours:       config.rewardDurationHours,
        tracking_mode:               config.trackingMode,
        reset_cron:                  config.resetCron,
        poll_interval_seconds:       config.pollIntervalSeconds,
        seeding_window_enabled:      config.seedingWindowEnabled,
        seeding_window_start:        config.seedingWindowStart,
        seeding_window_end:          config.seedingWindowEnd,
        reward_tiers:                config.rewardTiers,
        rcon_warnings_enabled:       config.rconWarningsEnabled,
        rcon_warning_message:        config.rconWarningMessage,
        decay_days_threshold:        config.decayDaysThreshold,
        decay_points_per_day:        config.decayPointsPerDay,
        enabled:                     config.enabled,
        last_poll_at:                config.lastPollAt?.toISOString() ?? null,
        last_poll_status:            config.lastPollStatus,
        last_poll_message:           config.lastPollMessage,
        leaderboard_public:          config.leaderboardPublic,
      },
    })
  })

  // ── DELETE /seeding-config ───────────────────────────────────────────────

  app.delete("/seeding-config", { preHandler: adminHook }, async (req, reply) => {
    const guildId = BigInt(req.session.activeGuildId!)

    const existing = await app.prisma.seedingConfig.findUnique({ where: { guildId } })
    if (!existing) return reply.code(404).send({ error: "No seeding config found" })

    await app.prisma.seedingConfig.delete({ where: { guildId } })
    return reply.send({ ok: true })
  })

  // ── POST /seeding-config/test ────────────────────────────────────────────
  // Test Socket.IO connection to SquadJS

  app.post<{
    Body: {
      squadjs_host?: string
      squadjs_port?: number
      squadjs_token?: string
    }
  }>("/seeding-config/test", { preHandler: adminHook }, async (req, reply) => {
    const guildId = BigInt(req.session.activeGuildId!)
    const body = req.body ?? {}

    let host = body.squadjs_host
    let port = body.squadjs_port
    let token = body.squadjs_token && body.squadjs_token !== MASKED
      ? body.squadjs_token
      : undefined

    // Fall back to stored config
    if (!host || !token) {
      const stored = await app.prisma.seedingConfig.findUnique({ where: { guildId } })
      if (!stored) return reply.code(400).send({ error: "No seeding config saved — provide credentials or save a config first" })
      host = host ?? stored.squadjsHost
      port = port ?? stored.squadjsPort
      token = token ?? stored.squadjsToken
    }

    if (!host || !token) {
      return reply.code(400).send({ error: "squadjs_host and squadjs_token are required" })
    }

    // Test connectivity by attempting an HTTP GET to the SquadJS host.
    // The seeding-service will handle the actual Socket.IO connection.
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 8000)

      const url = `http://${host}:${port}/socket.io/?EIO=4&transport=polling`
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { "Accept": "*/*" },
      })
      clearTimeout(timer)

      if (response.ok || response.status === 400) {
        // Socket.IO endpoint responds (even 400 means it's there)
        return reply.send({
          ok: true,
          message: `SquadJS reachable at ${host}:${port}. The seeding service will establish the full Socket.IO connection.`,
        })
      }

      return reply.send({
        ok: false,
        message: `SquadJS responded with HTTP ${response.status}. Check host and port.`,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return reply.send({
        ok: false,
        message: `Cannot reach SquadJS at ${host}:${port}: ${msg.includes("abort") ? "Connection timed out" : msg}`,
      })
    }
  })

  // ── GET /seeding/leaderboard ─────────────────────────────────────────────

  app.get<{
    Querystring: { limit?: string }
  }>("/seeding/leaderboard", { preHandler: adminHook }, async (req, reply) => {
    const guildId = BigInt(req.session.activeGuildId!)
    const limit = Math.min(parseInt(req.query.limit ?? "50", 10) || 50, 100)

    const config = await app.prisma.seedingConfig.findUnique({ where: { guildId } })
    const pointsRequired = config?.pointsRequired ?? 120

    const players = await app.prisma.seedingPoints.findMany({
      where: { guildId, OR: [{ points: { gt: 0 } }, { rewarded: true }] },
      orderBy: [{ rewarded: "desc" }, { points: "desc" }],
      take: limit,
    })

    return reply.send({
      points_required: pointsRequired,
      players: players.map((p) => ({
        steam_id:    p.steamId,
        player_name: p.playerName,
        points:      p.points,
        progress_pct: Math.min(100, Math.round((p.points / pointsRequired) * 100)),
        rewarded:    p.rewarded,
        rewarded_at: p.rewardedAt?.toISOString() ?? null,
      })),
    })
  })

  // ── GET /seeding/players ─────────────────────────────────────────────────

  app.get<{
    Querystring: { page?: string; limit?: string; search?: string }
  }>("/seeding/players", { preHandler: adminHook }, async (req, reply) => {
    const guildId = BigInt(req.session.activeGuildId!)
    const page = parseInt(req.query.page ?? "1", 10) || 1
    const limit = Math.min(parseInt(req.query.limit ?? "25", 10) || 25, 100)
    const skip = (page - 1) * limit

    const config = await app.prisma.seedingConfig.findUnique({ where: { guildId } })
    const pointsRequired = config?.pointsRequired ?? 120

    const where: Prisma.SeedingPointsWhereInput = { guildId }
    if (req.query.search) {
      where.OR = [
        { steamId: { contains: req.query.search } },
        { playerName: { contains: req.query.search, mode: "insensitive" } },
      ]
    }

    const [players, total] = await Promise.all([
      app.prisma.seedingPoints.findMany({
        where,
        orderBy: { points: "desc" },
        skip,
        take: limit,
      }),
      app.prisma.seedingPoints.count({ where }),
    ])

    return reply.send({
      points_required: pointsRequired,
      page,
      limit,
      total,
      players: players.map((p) => ({
        steam_id:    p.steamId,
        player_name: p.playerName,
        points:      p.points,
        progress_pct: Math.min(100, Math.round((p.points / pointsRequired) * 100)),
        rewarded:    p.rewarded,
        rewarded_at: p.rewardedAt?.toISOString() ?? null,
        last_award_at: p.lastAwardAt?.toISOString() ?? null,
      })),
    })
  })

  // ── POST /seeding/reset ──────────────────────────────────────────────────

  app.post("/seeding/reset", { preHandler: adminHook }, async (req, reply) => {
    const guildId = BigInt(req.session.activeGuildId!)
    const actorId = req.session.userId

    const result = await app.prisma.seedingPoints.updateMany({
      where: { guildId },
      data: { points: 0, rewarded: false, lastResetAt: new Date() },
    })

    // Audit log
    await app.prisma.auditLog.create({
      data: {
        guildId,
        actionType: "seeding_manual_reset",
        actorDiscordId: actorId ? BigInt(actorId) : null,
        details: JSON.stringify({ players_reset: result.count }),
        createdAt: new Date(),
      },
    })

    return reply.send({ ok: true, players_reset: result.count })
  })

  // ── POST /seeding/grant ──────────────────────────────────────────────────

  app.post<{
    Body: { steam_id: string; points: number }
  }>("/seeding/grant", { preHandler: adminHook }, async (req, reply) => {
    const guildId = BigInt(req.session.activeGuildId!)
    const actorId = req.session.userId
    const { steam_id, points } = req.body ?? {}

    if (!steam_id || typeof points !== "number") {
      return reply.code(400).send({ error: "steam_id and points are required" })
    }

    if (points < 0 || points > 10000) {
      return reply.code(400).send({ error: "points must be between 0 and 10000" })
    }

    // Validate Steam ID format
    if (!/^[0-9]{17}$/.test(steam_id)) {
      return reply.code(400).send({ error: "Invalid Steam64 ID format" })
    }

    await app.prisma.$executeRaw`
      INSERT INTO seeding_points (guild_id, steam_id, points, last_award_at)
      VALUES (${guildId}, ${steam_id}, ${points}, NOW())
      ON CONFLICT (guild_id, steam_id) DO UPDATE SET
        points = seeding_points.points + ${points},
        last_award_at = NOW()
    `

    // Audit log
    await app.prisma.auditLog.create({
      data: {
        guildId,
        actionType: "seeding_manual_grant",
        actorDiscordId: actorId ? BigInt(actorId) : null,
        details: JSON.stringify({ steam_id, points_granted: points }),
        createdAt: new Date(),
      },
    })

    return reply.send({ ok: true })
  })
}
