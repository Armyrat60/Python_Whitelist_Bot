/**
 * Admin dashboard stats, audit log, health checks, and resync routes.
 *
 * Prefix: /api/admin
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify"
import { syncOutputs } from "../../services/output.js"
import { cache } from "../../services/cache.js"
import { getFileToken } from "../../services/token.js"
import { toJSON } from "../../lib/json.js"

// ─── Admin preHandler ─────────────────────────────────────────────────────────

const adminHook = async (req: FastifyRequest, reply: FastifyReply) => {
  if (!req.session.userId) return reply.code(401).send({ error: "Not authenticated" })
  if (!req.session.activeGuildId) return reply.code(400).send({ error: "No guild selected" })
  const guild = req.session.guilds?.find(g => g.id === req.session.activeGuildId)
  if (!guild?.isAdmin) return reply.code(403).send({ error: "Admin access required" })
}

// ─── triggerSync ──────────────────────────────────────────────────────────────

async function triggerSync(app: FastifyInstance, guildId: bigint) {
  try {
    const outputs = await syncOutputs(app.prisma, guildId)
    await cache.set(guildId, outputs)
    const salt = await app.prisma.botSetting.findUnique({
      where: { guildId_settingKey: { guildId, settingKey: "url_salt" } }
    })
    cache.registerToken(getFileToken(guildId, salt?.settingValue ?? null), guildId)
  } catch (err) {
    app.log.error({ err, guildId }, "triggerSync failed")
  }
}

// ─── Routes ───────────────────────────────────────────────────────────────────

export default async function auditRoutes(app: FastifyInstance) {
  const { prisma } = app

  // ── GET /api/admin/stats ─────────────────────────────────────────────────────

  app.get("/stats", { preHandler: adminHook }, async (req, reply) => {
    const guildId = BigInt(req.session.activeGuildId!)

    const [activeCount, identCount, recentAudit, orphanCount, whitelists, totalRegistered, disabledRoleLostCount, noAccessCount] = await Promise.all([
      prisma.whitelistUser.count({ where: { guildId, status: "active" } }),
      prisma.whitelistIdentifier.count({ where: { guildId } }),
      prisma.auditLog.count({
        where: { guildId, createdAt: { gte: new Date(Date.now() - 7 * 86400000) } },
      }),
      prisma.whitelistUser.count({ where: { guildId, discordId: { lt: 0n } } }),
      prisma.whitelist.findMany({
        where:   { guildId, enabled: true },
        select:  { id: true, slug: true, name: true },
      }),
      prisma.whitelistUser.count({ where: { guildId } }),
      prisma.whitelistUser.count({ where: { guildId, status: "disabled_role_lost" } }),
      prisma.whitelistUser.count({ where: { guildId, status: "active", effectiveSlotLimit: 0 } }),
    ])

    // Per-whitelist breakdown: active users, identifier count, slot capacity
    const whitelistIds = whitelists.map(w => w.id)

    const [perTypeUsers, perTypeIdents, panelRoles, slotSums] = await Promise.all([
      prisma.whitelistUser.groupBy({
        by:    ["whitelistId"],
        where: { guildId, whitelistId: { in: whitelistIds }, status: "active" },
        _count: { discordId: true },
      }),
      prisma.whitelistIdentifier.groupBy({
        by:    ["whitelistId"],
        where: { guildId, whitelistId: { in: whitelistIds } },
        _count: { idValue: true },
      }),
      prisma.panelRole.findMany({
        where:  { guildId, panel: { whitelistId: { in: whitelistIds } }, isActive: true },
        select: { slotLimit: true, panel: { select: { whitelistId: true } } },
      }),
      prisma.whitelistUser.groupBy({
        by:    ["whitelistId"],
        where: { guildId, whitelistId: { in: whitelistIds }, status: "active" },
        _sum:  { effectiveSlotLimit: true },
      }),
    ])

    // Build capacity map: whitelist_id -> sum of role slot limits
    const capacityMap = new Map<number, number>()
    for (const pr of panelRoles) {
      const wid = pr.panel.whitelistId
      if (wid !== null) capacityMap.set(wid, (capacityMap.get(wid) ?? 0) + pr.slotLimit)
    }

    const per_type: Record<string, {
      active_users: number; total_ids: number; slots_used: number; capacity: number
    }> = {}

    for (const wl of whitelists) {
      const users    = perTypeUsers.find(r => r.whitelistId === wl.id)?._count.discordId ?? 0
      const ids      = perTypeIdents.find(r => r.whitelistId === wl.id)?._count.idValue   ?? 0
      const slotsSum = slotSums.find(r => r.whitelistId === wl.id)?._sum.effectiveSlotLimit ?? 0
      per_type[wl.slug] = {
        active_users: users,
        total_ids:    ids,
        slots_used:   slotsSum,
        capacity:     capacityMap.get(wl.id) ?? 0,
      }
    }

    // Daily submissions (new whitelist_user rows) for last 7 days
    const days: { day: string; date: string; count: number }[] = []
    for (let i = 6; i >= 0; i--) {
      const d     = new Date(Date.now() - i * 86400000)
      const start = new Date(d.getFullYear(), d.getMonth(), d.getDate())
      const end   = new Date(start.getTime() + 86400000)
      const count = await prisma.whitelistUser.count({
        where: { guildId, createdAt: { gte: start, lt: end } },
      })
      days.push({
        day:   d.toLocaleDateString("en-US", { weekday: "short" }),
        date:  start.toISOString().slice(0, 10),
        count,
      })
    }

    return reply.send(toJSON({
      total_active_users:       activeCount,
      total_identifiers:        identCount,
      recent_audit_count:       recentAudit,
      orphan_count:             orphanCount,
      total_registered:         totalRegistered,
      disabled_role_lost_count: disabledRoleLostCount,
      no_access_count:          noAccessCount,
      per_type,
      daily_submissions:        days,
    }))
  })

  // ── GET /api/admin/audit ─────────────────────────────────────────────────────

  app.get("/audit", { preHandler: adminHook }, async (req, reply) => {
    const guildId = BigInt(req.session.activeGuildId!)
    const query   = req.query as {
      page?:      string
      per_page?:  string
      whitelist?: string
      type?:      string   // alias for whitelist (frontend uses "type")
      action?:    string
      actor?:     string   // filter by actor Discord ID
      date_from?: string
      date_to?:   string
    }

    const page    = Math.max(1, parseInt(query.page    ?? "1",  10))
    const perPage = Math.min(200, Math.max(1, parseInt(query.per_page ?? "50", 10)))

    const where: Record<string, unknown> = { guildId }

    const whitelistSlug = query.whitelist ?? query.type
    if (whitelistSlug) {
      const wl = await prisma.whitelist.findUnique({
        where: { guildId_slug: { guildId, slug: whitelistSlug } },
        select: { id: true },
      })
      if (!wl) return reply.code(404).send({ error: "Whitelist not found" })
      where.whitelistId = wl.id
    }

    if (query.action) where.actionType = query.action

    if (query.actor) {
      try { where.actorDiscordId = BigInt(query.actor) } catch { /* ignore invalid ID */ }
    }

    const createdAt: Record<string, Date> = {}
    if (query.date_from) createdAt.gte = new Date(query.date_from)
    if (query.date_to)   createdAt.lte = new Date(query.date_to)
    if (Object.keys(createdAt).length > 0) where.createdAt = createdAt

    const [total, entries] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take:    perPage,
        skip:    (page - 1) * perPage,
      }),
    ])

    // Resolve actor/target names from whitelist_users in batch
    const actorIds = [...new Set(
      entries.flatMap(e => [e.actorDiscordId, e.targetDiscordId].filter(Boolean) as bigint[])
    )]
    const knownUsers = actorIds.length > 0
      ? await prisma.whitelistUser.findMany({
          where:   { guildId, discordId: { in: actorIds } },
          select:  { discordId: true, discordName: true },
          distinct: ["discordId"],
        })
      : []
    const nameMap = new Map(knownUsers.map(u => [u.discordId.toString(), u.discordName]))

    const result = entries.map(e => ({
      id:                  e.id,
      guild_id:            e.guildId.toString(),
      whitelist_id:        e.whitelistId,
      action_type:         e.actionType,
      actor_discord_id:    e.actorDiscordId?.toString()  ?? null,
      actor_discord_name:  e.actorDiscordId ? (nameMap.get(e.actorDiscordId.toString()) ?? null) : null,
      target_discord_id:   e.targetDiscordId?.toString() ?? null,
      target_discord_name: e.targetDiscordId ? (nameMap.get(e.targetDiscordId.toString()) ?? null) : null,
      details:             e.details,
      created_at:          e.createdAt,
    }))

    return reply.send(toJSON({
      entries: result,
      total,
      page,
      per_page: perPage,
      pages:    Math.ceil(total / perPage),
    }))
  })

  // ── GET /api/admin/health ────────────────────────────────────────────────────

  app.get("/health", { preHandler: adminHook }, async (req, reply) => {
    const guildId = BigInt(req.session.activeGuildId!)

    const alerts: Array<{ level: "warning" | "info" | "error"; message: string; link?: string }> = []

    const [
      panelsWithNoChannel,
      duplicateSteamRows,
      orphanCount,
      bridgeConfig,
      recentFailedJob,
      whitelists,
    ] = await Promise.all([
      prisma.panel.count({ where: { guildId, channelId: null, enabled: true } }),
      // Duplicate Steam IDs: same value under two or more distinct Discord users
      prisma.whitelistIdentifier.groupBy({
        by:    ["idValue"],
        where: { guildId, idType: { in: ["steamid", "steam64"] } },
        _count: { discordId: true },
        having: { discordId: { _count: { gt: 1 } } },
      }),
      prisma.whitelistUser.count({ where: { guildId, discordId: { lt: 0n } } }),
      prisma.bridgeConfig.findUnique({ where: { guildId }, select: { lastSyncStatus: true, lastSyncAt: true, enabled: true } }),
      prisma.jobQueue.findFirst({
        where:   { guildId, jobType: "bridge_sync", status: "failed" },
        orderBy: { completedAt: "desc" },
        select:  { completedAt: true, error: true },
      }),
      prisma.whitelist.findMany({ where: { guildId, enabled: true }, select: { id: true, name: true } }),
    ])

    if (panelsWithNoChannel > 0) {
      alerts.push({ level: "warning", message: `${panelsWithNoChannel} panel(s) have no channel configured`, link: "/dashboard/panels" })
    }

    // Panels with push errors (bot reported a permission or config problem)
    const panelsWithErrors = await prisma.panel.findMany({
      where:  { guildId, lastPushStatus: "error" },
      select: { name: true, lastPushError: true },
    })
    for (const p of panelsWithErrors) {
      alerts.push({ level: "error", message: `Panel "${p.name}": ${p.lastPushError ?? "push failed"}`, link: "/dashboard/panels" })
    }

    if (duplicateSteamRows.length > 0) {
      alerts.push({
        level:   "warning",
        message: `${duplicateSteamRows.length} Steam ID(s) are registered to multiple users — check for duplicate accounts`,
        link:    "/dashboard/conflicts",
      })
    }

    if (orphanCount > 0) {
      alerts.push({ level: "info", message: `${orphanCount} imported user(s) could not be matched to a Discord account`, link: "/dashboard/manual-roster" })
    }

    if (bridgeConfig?.enabled && bridgeConfig.lastSyncStatus === "error") {
      const when = bridgeConfig.lastSyncAt
        ? `(last attempt: ${bridgeConfig.lastSyncAt.toLocaleString()})`
        : ""
      alerts.push({ level: "error", message: `SquadJS bridge last sync failed ${when} — check your MySQL credentials` })
    }

    if (recentFailedJob && !bridgeConfig?.lastSyncStatus) {
      alerts.push({ level: "warning", message: "A recent bridge sync job failed" })
    }

    // Info: whitelists with no active users
    for (const wl of whitelists) {
      const userCount = await prisma.whitelistUser.count({
        where: { guildId, whitelistId: wl.id, status: "active" },
      })
      if (userCount === 0) {
        alerts.push({ level: "info", message: `Whitelist "${wl.name}" is enabled but has no active users` })
      }
    }

    return reply.send({ alerts })
  })

  // ── GET /api/admin/health/duplicate-ids ──────────────────────────────────────
  // Returns details on which Steam IDs are duplicated and who holds them.

  app.get("/health/duplicate-ids", { preHandler: adminHook }, async (req, reply) => {
    const guildId = BigInt(req.session.activeGuildId!)

    const rows = await prisma.whitelistIdentifier.groupBy({
      by:    ["idValue"],
      where: { guildId, idType: { in: ["steamid", "steam64"] } },
      _count: { discordId: true },
      having: { discordId: { _count: { gt: 1 } } },
    })

    if (rows.length === 0) return reply.send({ duplicates: [] })

    const duplicateValues = rows.map(r => r.idValue)

    const identifiers = await prisma.whitelistIdentifier.findMany({
      where:   { guildId, idType: { in: ["steamid", "steam64"] }, idValue: { in: duplicateValues } },
      select:  { idValue: true, discordId: true },
      distinct: ["idValue", "discordId"],
    })

    // Resolve discord names
    const discordIds = [...new Set(identifiers.map(i => i.discordId))]
    const users = await prisma.whitelistUser.findMany({
      where:   { guildId, discordId: { in: discordIds } },
      select:  { discordId: true, discordName: true },
      distinct: ["discordId"],
    })
    const nameMap = new Map(users.map(u => [u.discordId.toString(), u.discordName]))

    const grouped = new Map<string, Array<{ discord_id: string; discord_name: string | null }>>()
    for (const ident of identifiers) {
      const id = ident.discordId.toString()
      if (!grouped.has(ident.idValue)) grouped.set(ident.idValue, [])
      grouped.get(ident.idValue)!.push({ discord_id: id, discord_name: nameMap.get(id) ?? null })
    }

    const duplicates = [...grouped.entries()].map(([steam_id, holders]) => ({
      steam_id,
      holder_count: holders.length,
      holders,
    }))

    return reply.send(toJSON({ duplicates }))
  })

  // ── DELETE /api/admin/health/identifier ─────────────────────────────────────
  // Remove a specific Steam ID from a specific user (for conflict resolution)

  app.delete("/health/identifier", { preHandler: adminHook }, async (req, reply) => {
    const guildId = BigInt(req.session.activeGuildId!)
    const body = req.body as Record<string, unknown>
    const steamId = String(body?.steam_id ?? "").trim()
    const discordId = BigInt(String(body?.discord_id ?? "0"))

    if (!steamId || discordId === 0n) {
      return reply.code(400).send({ error: "steam_id and discord_id are required." })
    }

    const deleted = await prisma.whitelistIdentifier.deleteMany({
      where: { guildId, discordId, idValue: steamId, idType: { in: ["steam64", "steamid"] } },
    })

    if (deleted.count === 0) {
      return reply.code(404).send({ error: "Identifier not found." })
    }

    await triggerSync(app, guildId)
    return reply.send({ ok: true, removed: deleted.count })
  })

  // ── POST /api/admin/resync ───────────────────────────────────────────────────

  app.post("/resync", { preHandler: adminHook }, async (req, reply) => {
    const guildId = BigInt(req.session.activeGuildId!)
    await triggerSync(app, guildId)
    return reply.send({ ok: true, message: "Whitelist sync triggered" })
  })

  // ── POST /api/admin/report ───────────────────────────────────────────────────

  app.post("/report", { preHandler: adminHook }, async (_req, reply) => {
    return reply.code(503).send({ ok: false, error: "Reports require Discord bot gateway" })
  })

  // ── GET /api/admin/audit/export ──────────────────────────────────────────────

  app.get("/audit/export", { preHandler: adminHook }, async (req, reply) => {
    const guildId = BigInt(req.session.activeGuildId!)
    const { type, action, date_from, date_to } = req.query as Record<string, string>

    const where: Record<string, unknown> = { guildId }

    if (type) {
      const wl = await prisma.whitelist.findUnique({
        where: { guildId_slug: { guildId, slug: type } },
        select: { id: true },
      })
      if (wl) where.whitelistId = wl.id
    }

    if (action) where.actionType = action

    if (date_from || date_to) {
      const createdAt: Record<string, Date> = {}
      if (date_from) createdAt.gte = new Date(date_from + "T00:00:00Z")
      if (date_to)   createdAt.lte = new Date(date_to + "T23:59:59Z")
      where.createdAt = createdAt
    }

    const rows = await prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 10000,
    })

    const lines: string[] = ["id,whitelist_id,action_type,actor_discord_id,target_discord_id,details,created_at"]
    for (const r of rows) {
      lines.push([
        r.id,
        r.whitelistId ?? "",
        r.actionType,
        r.actorDiscordId ? String(r.actorDiscordId) : "",
        r.targetDiscordId ? String(r.targetDiscordId) : "",
        (r.details ?? "").replace(/,/g, ";"),
        r.createdAt.toISOString(),
      ].join(","))
    }

    reply.header("Content-Type", "text/csv")
    reply.header("Content-Disposition", 'attachment; filename="audit_log.csv"')
    return reply.send(lines.join("\n"))
  })
}
