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

    if (!config) return reply.send({ config: null, servers: [] })

    // Fetch servers for this guild
    const servers = await app.prisma.seedingServer.findMany({
      where: { guildId },
      orderBy: { createdAt: "asc" },
    })

    return reply.send({
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
        enabled:                     config.enabled,
        last_poll_at:                config.lastPollAt?.toISOString() ?? null,
        last_poll_status:            config.lastPollStatus,
        last_poll_message:           config.lastPollMessage,
        reward_tiers:                config.rewardTiers,
        rcon_warnings_enabled:       config.rconWarningsEnabled,
        rcon_warning_message:        config.rconWarningMessage,
        decay_days_threshold:        config.decayDaysThreshold,
        decay_points_per_day:        config.decayPointsPerDay,
        discord_role_reward_enabled: config.discordRoleRewardEnabled,
        discord_role_reward_id:      config.discordRoleRewardId,
        discord_remove_role_on_expiry: config.discordRemoveRoleOnExpiry,
        auto_seed_alert_enabled:     config.autoSeedAlertEnabled,
        auto_seed_alert_role_id:     config.autoSeedAlertRoleId,
        auto_seed_alert_cooldown_min: config.autoSeedAlertCooldownMin,
        discord_notify_channel_id:   config.discordNotifyChannelId,
        rcon_broadcast_enabled:      config.rconBroadcastEnabled,
        rcon_broadcast_message:      config.rconBroadcastMessage,
        rcon_broadcast_interval_min: config.rconBroadcastIntervalMin,
        reward_cooldown_hours:       config.rewardCooldownHours,
        require_discord_link:        config.requireDiscordLink,
        streak_enabled:              config.streakEnabled,
        streak_days_required:        config.streakDaysRequired,
        streak_multiplier:           config.streakMultiplier,
        bonus_multiplier_enabled:    config.bonusMultiplierEnabled,
        bonus_multiplier_value:      config.bonusMultiplierValue,
        bonus_multiplier_start:      config.bonusMultiplierStart?.toISOString() ?? null,
        bonus_multiplier_end:        config.bonusMultiplierEnd?.toISOString() ?? null,
        custom_embed_title:          config.customEmbedTitle,
        custom_embed_description:    config.customEmbedDescription,
        custom_embed_image_url:      config.customEmbedImageUrl,
        custom_embed_color:          config.customEmbedColor,
        population_tracking_enabled: config.populationTrackingEnabled,
        webhook_url:                 config.webhookUrl,
        webhook_enabled:             config.webhookEnabled,
        points_per_server:           config.pointsPerServer,
        leaderboard_public:          config.leaderboardPublic,
        created_at:                  config.createdAt.toISOString(),
        updated_at:                  config.updatedAt.toISOString(),
      },
      servers: servers.map((s) => ({
        id: s.id,
        server_name: s.serverName,
        squadjs_host: s.squadjsHost,
        squadjs_port: s.squadjsPort,
        squadjs_token: MASKED,
        enabled: s.enabled,
        last_poll_at: s.lastPollAt?.toISOString() ?? null,
        last_poll_status: s.lastPollStatus,
        last_poll_message: s.lastPollMessage,
      })),
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
      discord_role_reward_enabled?: boolean
      discord_role_reward_id?: string | null
      discord_remove_role_on_expiry?: boolean
      auto_seed_alert_enabled?: boolean
      auto_seed_alert_role_id?: string | null
      auto_seed_alert_cooldown_min?: number
      discord_notify_channel_id?: string | null
      rcon_broadcast_enabled?: boolean
      rcon_broadcast_message?: string
      rcon_broadcast_interval_min?: number
      reward_cooldown_hours?: number
      require_discord_link?: boolean
      streak_enabled?: boolean
      streak_days_required?: number
      streak_multiplier?: number
      bonus_multiplier_enabled?: boolean
      bonus_multiplier_value?: number
      bonus_multiplier_start?: string | null
      bonus_multiplier_end?: string | null
      custom_embed_title?: string | null
      custom_embed_description?: string | null
      custom_embed_image_url?: string | null
      custom_embed_color?: string | null
      population_tracking_enabled?: boolean
      webhook_url?: string | null
      webhook_enabled?: boolean
      points_per_server?: boolean
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
    if (body.bonus_multiplier_value !== undefined && (body.bonus_multiplier_value < 1 || body.bonus_multiplier_value > 10)) {
      return reply.code(400).send({ error: "bonus_multiplier_value must be 1-10" })
    }
    if (body.streak_multiplier !== undefined && (body.streak_multiplier < 1 || body.streak_multiplier > 5)) {
      return reply.code(400).send({ error: "streak_multiplier must be 1-5" })
    }

    // Validate reward group safety
    const groupName = body.reward_group_name ?? existing?.rewardGroupName ?? "Reserve"
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
        discordRoleRewardEnabled: body.discord_role_reward_enabled ?? false,
        discordRoleRewardId:    body.discord_role_reward_id  ?? null,
        discordRemoveRoleOnExpiry: body.discord_remove_role_on_expiry ?? false,
        autoSeedAlertEnabled:   body.auto_seed_alert_enabled ?? false,
        autoSeedAlertRoleId:    body.auto_seed_alert_role_id ?? null,
        autoSeedAlertCooldownMin: body.auto_seed_alert_cooldown_min ?? 30,
        discordNotifyChannelId: body.discord_notify_channel_id ?? null,
        rconBroadcastEnabled:  body.rcon_broadcast_enabled   ?? false,
        rconBroadcastMessage:  body.rcon_broadcast_message   ?? "This server is in seeding mode! Earn whitelist rewards by staying online.",
        rconBroadcastIntervalMin: body.rcon_broadcast_interval_min ?? 10,
        rewardCooldownHours:   body.reward_cooldown_hours    ?? 0,
        requireDiscordLink:    body.require_discord_link     ?? false,
        streakEnabled:         body.streak_enabled           ?? false,
        streakDaysRequired:    body.streak_days_required     ?? 3,
        streakMultiplier:      body.streak_multiplier        ?? 1.5,
        bonusMultiplierEnabled: body.bonus_multiplier_enabled ?? false,
        bonusMultiplierValue:  body.bonus_multiplier_value   ?? 2.0,
        bonusMultiplierStart:  body.bonus_multiplier_start ? new Date(body.bonus_multiplier_start) : null,
        bonusMultiplierEnd:    body.bonus_multiplier_end ? new Date(body.bonus_multiplier_end) : null,
        customEmbedTitle:      body.custom_embed_title       ?? null,
        customEmbedDescription: body.custom_embed_description ?? null,
        customEmbedImageUrl:   body.custom_embed_image_url   ?? null,
        customEmbedColor:      body.custom_embed_color       ?? null,
        populationTrackingEnabled: body.population_tracking_enabled ?? false,
        webhookUrl:             body.webhook_url              ?? null,
        webhookEnabled:         body.webhook_enabled          ?? false,
        pointsPerServer:        body.points_per_server        ?? false,
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
        discordRoleRewardEnabled: body.discord_role_reward_enabled ?? existing?.discordRoleRewardEnabled ?? false,
        discordRoleRewardId:    body.discord_role_reward_id !== undefined ? body.discord_role_reward_id : (existing?.discordRoleRewardId ?? null),
        discordRemoveRoleOnExpiry: body.discord_remove_role_on_expiry ?? existing?.discordRemoveRoleOnExpiry ?? false,
        autoSeedAlertEnabled:   body.auto_seed_alert_enabled ?? existing?.autoSeedAlertEnabled   ?? false,
        autoSeedAlertRoleId:    body.auto_seed_alert_role_id !== undefined ? body.auto_seed_alert_role_id : (existing?.autoSeedAlertRoleId ?? null),
        autoSeedAlertCooldownMin: body.auto_seed_alert_cooldown_min ?? existing?.autoSeedAlertCooldownMin ?? 30,
        discordNotifyChannelId: body.discord_notify_channel_id !== undefined ? body.discord_notify_channel_id : (existing?.discordNotifyChannelId ?? null),
        rconBroadcastEnabled:  body.rcon_broadcast_enabled   ?? existing?.rconBroadcastEnabled   ?? false,
        rconBroadcastMessage:  body.rcon_broadcast_message   ?? existing?.rconBroadcastMessage   ?? "This server is in seeding mode!",
        rconBroadcastIntervalMin: body.rcon_broadcast_interval_min ?? existing?.rconBroadcastIntervalMin ?? 10,
        rewardCooldownHours:   body.reward_cooldown_hours    ?? existing?.rewardCooldownHours    ?? 0,
        requireDiscordLink:    body.require_discord_link     ?? existing?.requireDiscordLink     ?? false,
        streakEnabled:         body.streak_enabled           ?? existing?.streakEnabled           ?? false,
        streakDaysRequired:    body.streak_days_required     ?? existing?.streakDaysRequired     ?? 3,
        streakMultiplier:      body.streak_multiplier        ?? existing?.streakMultiplier       ?? 1.5,
        bonusMultiplierEnabled: body.bonus_multiplier_enabled ?? existing?.bonusMultiplierEnabled ?? false,
        bonusMultiplierValue:  body.bonus_multiplier_value   ?? existing?.bonusMultiplierValue   ?? 2.0,
        bonusMultiplierStart:  body.bonus_multiplier_start !== undefined ? (body.bonus_multiplier_start ? new Date(body.bonus_multiplier_start) : null) : (existing?.bonusMultiplierStart ?? null),
        bonusMultiplierEnd:    body.bonus_multiplier_end !== undefined ? (body.bonus_multiplier_end ? new Date(body.bonus_multiplier_end) : null) : (existing?.bonusMultiplierEnd ?? null),
        customEmbedTitle:      body.custom_embed_title !== undefined ? body.custom_embed_title : (existing?.customEmbedTitle ?? null),
        customEmbedDescription: body.custom_embed_description !== undefined ? body.custom_embed_description : (existing?.customEmbedDescription ?? null),
        customEmbedImageUrl:   body.custom_embed_image_url !== undefined ? body.custom_embed_image_url : (existing?.customEmbedImageUrl ?? null),
        customEmbedColor:      body.custom_embed_color !== undefined ? body.custom_embed_color : (existing?.customEmbedColor ?? null),
        populationTrackingEnabled: body.population_tracking_enabled ?? existing?.populationTrackingEnabled ?? false,
        webhookUrl:             body.webhook_url !== undefined ? body.webhook_url : (existing?.webhookUrl ?? null),
        webhookEnabled:         body.webhook_enabled          ?? existing?.webhookEnabled          ?? false,
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
        require_discord_link:        config.requireDiscordLink,
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

  // ── Server CRUD ───────────────────────────────────────────────────────────

  app.post<{
    Body: { server_name: string; squadjs_host: string; squadjs_port?: number; squadjs_token: string }
  }>("/seeding-config/servers", { preHandler: adminHook }, async (req, reply) => {
    const guildId = BigInt(req.session.activeGuildId!)
    const body = req.body ?? {}

    if (!body.server_name?.trim() || !body.squadjs_host?.trim() || !body.squadjs_token) {
      return reply.code(400).send({ error: "server_name, squadjs_host, and squadjs_token are required" })
    }

    // Check 5 server limit
    const count = await app.prisma.seedingServer.count({ where: { guildId } })
    if (count >= 5) {
      return reply.code(400).send({ error: "Maximum 5 servers per guild" })
    }

    const server = await app.prisma.seedingServer.create({
      data: {
        guildId,
        serverName: body.server_name.trim(),
        squadjsHost: body.squadjs_host.trim(),
        squadjsPort: body.squadjs_port ?? 3000,
        squadjsToken: body.squadjs_token,
      },
    })

    return reply.send({
      ok: true,
      server: { id: server.id, server_name: server.serverName, squadjs_host: server.squadjsHost, squadjs_port: server.squadjsPort, squadjs_token: MASKED, enabled: server.enabled },
    })
  })

  app.put<{
    Params: { id: string }
    Body: { server_name?: string; squadjs_host?: string; squadjs_port?: number; squadjs_token?: string; enabled?: boolean }
  }>("/seeding-config/servers/:id", { preHandler: adminHook }, async (req, reply) => {
    const guildId = BigInt(req.session.activeGuildId!)
    const serverId = parseInt(req.params.id, 10)
    const body = req.body ?? {}

    const existing = await app.prisma.seedingServer.findFirst({ where: { id: serverId, guildId } })
    if (!existing) return reply.code(404).send({ error: "Server not found" })

    const token = body.squadjs_token && body.squadjs_token !== MASKED ? body.squadjs_token : existing.squadjsToken

    const server = await app.prisma.seedingServer.update({
      where: { id: serverId },
      data: {
        serverName: body.server_name?.trim() ?? existing.serverName,
        squadjsHost: body.squadjs_host?.trim() ?? existing.squadjsHost,
        squadjsPort: body.squadjs_port ?? existing.squadjsPort,
        squadjsToken: token,
        enabled: body.enabled ?? existing.enabled,
      },
    })

    return reply.send({
      ok: true,
      server: { id: server.id, server_name: server.serverName, squadjs_host: server.squadjsHost, squadjs_port: server.squadjsPort, squadjs_token: MASKED, enabled: server.enabled },
    })
  })

  app.delete<{
    Params: { id: string }
  }>("/seeding-config/servers/:id", { preHandler: adminHook }, async (req, reply) => {
    const guildId = BigInt(req.session.activeGuildId!)
    const serverId = parseInt(req.params.id, 10)

    const existing = await app.prisma.seedingServer.findFirst({ where: { id: serverId, guildId } })
    if (!existing) return reply.code(404).send({ error: "Server not found" })

    await app.prisma.seedingServer.delete({ where: { id: serverId } })
    return reply.send({ ok: true })
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

    // Parse tiers for tier chip labels
    const tiers = (config?.rewardTiers as Array<{ points: number; duration_hours: number; label: string }>) ?? null
    const sortedTiers = tiers?.length ? [...tiers].sort((a, b) => b.points - a.points) : null

    function getTierLabel(points: number): string | null {
      if (!sortedTiers) return null
      const tier = sortedTiers.find((t) => points >= t.points)
      return tier?.label ?? null
    }

    return reply.send({
      points_required: pointsRequired,
      reward_tiers: tiers,
      players: players.map((p) => ({
        steam_id:    p.steamId,
        player_name: p.playerName ?? `Seeder_${p.steamId.slice(-6)}`,
        points:      p.points,
        seeding_hours: Math.round(p.points / 60 * 10) / 10,
        progress_pct: Math.min(100, Math.round((p.points / pointsRequired) * 100)),
        tier_label:  getTierLabel(p.points),
        rewarded:    p.rewarded,
        rewarded_at: p.rewardedAt?.toISOString() ?? null,
        last_award_at: p.lastAwardAt?.toISOString() ?? null,
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
        player_name: p.playerName ?? `Seeder_${p.steamId.slice(-6)}`,
        points:      p.points,
        progress_pct: Math.min(100, Math.round((p.points / pointsRequired) * 100)),
        rewarded:    p.rewarded,
        rewarded_at: p.rewardedAt?.toISOString() ?? null,
        last_award_at: p.lastAwardAt?.toISOString() ?? null,
      })),
    })
  })

  // ── GET /seeding/stats ────────────────────────────────────────────────────

  app.get("/seeding/stats", { preHandler: adminHook }, async (req, reply) => {
    const guildId = BigInt(req.session.activeGuildId!)

    const config = await app.prisma.seedingConfig.findUnique({ where: { guildId } })
    const pointsRequired = config?.pointsRequired ?? 120

    // Total seeders with any points
    const totalSeeders = await app.prisma.seedingPoints.count({
      where: { guildId, points: { gt: 0 } },
    })

    // Total rewarded
    const totalRewarded = await app.prisma.seedingPoints.count({
      where: { guildId, rewarded: true },
    })

    // Total points across all players (seeding hours)
    const pointsAgg = await app.prisma.seedingPoints.aggregate({
      where: { guildId },
      _sum: { points: true },
    })
    const totalPoints = pointsAgg._sum.points ?? 0
    const totalSeedingHours = Math.round(totalPoints / 60 * 10) / 10

    // Top 5 seeders
    const top10 = await app.prisma.seedingPoints.findMany({
      where: { guildId, points: { gt: 0 } },
      orderBy: { points: "desc" },
      take: 10,
    })

    // Recent rewards (last 10 from audit log)
    const recentRewards = await app.prisma.auditLog.findMany({
      where: { guildId, actionType: "seeding_reward_granted" },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { details: true, createdAt: true },
    })

    // Count players who qualified but have no Discord link (when require_discord_link is on)
    let pendingDiscordLink = 0
    if (config?.requireDiscordLink) {
      const pendingResult = await app.prisma.$queryRaw<[{ count: bigint }]>`
        SELECT COUNT(*) as count
        FROM seeding_points sp
        WHERE sp.guild_id = ${guildId}
          AND sp.points >= ${pointsRequired}
          AND sp.rewarded = FALSE
          AND NOT EXISTS (
            SELECT 1 FROM whitelist_identifiers wi
            WHERE wi.guild_id = sp.guild_id
              AND wi.id_type IN ('steam64', 'steamid')
              AND wi.id_value = sp.steam_id
          )
          AND NOT EXISTS (
            SELECT 1 FROM squad_players sqp
            WHERE sqp.guild_id = sp.guild_id
              AND sqp.steam_id = sp.steam_id
              AND sqp.discord_id IS NOT NULL
          )
      `
      pendingDiscordLink = Number(pendingResult[0]?.count ?? 0)
    }

    return reply.send({
      points_required: pointsRequired,
      total_seeders: totalSeeders,
      total_rewarded: totalRewarded,
      total_seeding_hours: totalSeedingHours,
      pending_discord_link: pendingDiscordLink,
      top_seeders: top10.map((p) => ({
        player_name: p.playerName ?? `Seeder_${p.steamId.slice(-6)}`,
        points: p.points,
        progress_pct: Math.min(100, Math.round((p.points / pointsRequired) * 100)),
        rewarded: p.rewarded,
      })),
      recent_rewards: recentRewards.map((r) => {
        let d: Record<string, unknown> = {}
        try { d = typeof r.details === "string" ? JSON.parse(r.details) : (r.details as unknown as Record<string, unknown>) ?? {} } catch { /* ignore */ }
        return {
          player_name: String(d.player_name ?? "Unknown"),
          tier_label: String(d.tier_label ?? "Standard"),
          created_at: r.createdAt.toISOString(),
        }
      }),
    })
  })

  // ── GET /seeding/population ────────────────────────────────────────────────

  app.get<{
    Querystring: { hours?: string }
  }>("/seeding/population", { preHandler: adminHook }, async (req, reply) => {
    const guildId = BigInt(req.session.activeGuildId!)
    const hours = Math.min(parseInt(req.query.hours ?? "24", 10) || 24, 168) // max 7 days

    const snapshots = await app.prisma.$queryRaw<Array<{
      player_count: number
      is_seeding: boolean
      created_at: Date
    }>>`
      SELECT player_count, is_seeding, created_at
      FROM population_snapshots
      WHERE guild_id = ${guildId}
        AND created_at > NOW() - make_interval(hours => ${hours})
      ORDER BY created_at ASC
    `

    return reply.send({
      hours,
      snapshots: snapshots.map((s) => ({
        player_count: s.player_count,
        is_seeding: s.is_seeding,
        time: s.created_at.toISOString(),
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

  // ── GET /seeding/leaderboard/export ────────────────────────────────────────

  app.get("/seeding/leaderboard/export", { preHandler: adminHook }, async (req, reply) => {
    const guildId = BigInt(req.session.activeGuildId!)

    const config = await app.prisma.seedingConfig.findUnique({ where: { guildId } })
    const pointsRequired = config?.pointsRequired ?? 120
    const tiers = (config?.rewardTiers as Array<{ points: number; duration_hours: number; label: string }>) ?? null
    const sortedTiers = tiers?.length ? [...tiers].sort((a, b) => b.points - a.points) : null

    const players = await app.prisma.seedingPoints.findMany({
      where: { guildId, OR: [{ points: { gt: 0 } }, { rewarded: true }] },
      orderBy: [{ points: "desc" }],
    })

    const csvLines = ["Rank,Player Name,Steam ID,Points,Seeding Hours,Progress %,Tier,Rewarded,Rewarded At,Last Active"]
    players.forEach((p, idx) => {
      const tier = sortedTiers?.find((t) => p.points >= t.points)?.label ?? ""
      csvLines.push([
        idx + 1,
        `"${(p.playerName ?? "").replace(/"/g, '""')}"`,
        p.steamId,
        p.points,
        Math.round(p.points / 60 * 10) / 10,
        Math.min(100, Math.round((p.points / pointsRequired) * 100)),
        tier,
        p.rewarded ? "Yes" : "No",
        p.rewardedAt?.toISOString() ?? "",
        p.lastAwardAt?.toISOString() ?? "",
      ].join(","))
    })

    return reply
      .header("Content-Type", "text/csv")
      .header("Content-Disposition", `attachment; filename="seeding_leaderboard_${new Date().toISOString().slice(0, 10)}.csv"`)
      .send(csvLines.join("\n"))
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
