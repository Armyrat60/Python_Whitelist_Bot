/**
 * Admin dashboard stats, audit log, health checks, and resync routes.
 *
 * Prefix: /api/admin
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify"
import { syncOutputs } from "../../services/output.js"
import { cache } from "../../services/cache.js"
import { getFileToken } from "../../services/token.js"

// ─── Admin preHandler ─────────────────────────────────────────────────────────

const adminHook = async (req: FastifyRequest, reply: FastifyReply) => {
  if (!req.session.userId) return reply.code(401).send({ error: "Not authenticated" })
  if (!req.session.activeGuildId) return reply.code(400).send({ error: "No guild selected" })
  const guild = req.session.guilds?.find(g => g.id === req.session.activeGuildId)
  if (!guild?.isAdmin) return reply.code(403).send({ error: "Admin access required" })
}

// ─── BigInt JSON helpers ──────────────────────────────────────────────────────

function bigIntReplacer(_: string, v: unknown) { return typeof v === "bigint" ? v.toString() : v }
function toJSON(data: unknown) { return JSON.parse(JSON.stringify(data, bigIntReplacer)) }

// ─── triggerSync ──────────────────────────────────────────────────────────────

async function triggerSync(app: FastifyInstance, guildId: bigint) {
  try {
    const outputs = await syncOutputs(app.prisma, guildId)
    cache.set(guildId, outputs)
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

    const [activeCount, identCount, recentAudit, orphanCount] = await Promise.all([
      prisma.whitelistUser.count({ where: { guildId, status: "active" } }),
      prisma.whitelistIdentifier.count({ where: { guildId } }),
      prisma.auditLog.count({
        where: { guildId, createdAt: { gte: new Date(Date.now() - 7 * 86400000) } },
      }),
      prisma.whitelistUser.count({ where: { guildId, discordId: { lt: 0n } } }),
    ])

    return reply.send({
      total_active_users:  activeCount,
      total_identifiers:   identCount,
      recent_audit_count:  recentAudit,
      orphan_count:        orphanCount,
    })
  })

  // ── GET /api/admin/audit ─────────────────────────────────────────────────────

  app.get("/audit", { preHandler: adminHook }, async (req, reply) => {
    const guildId = BigInt(req.session.activeGuildId!)
    const query   = req.query as {
      page?:      string
      per_page?:  string
      whitelist?: string
      action?:    string
      date_from?: string
      date_to?:   string
    }

    const page    = Math.max(1, parseInt(query.page    ?? "1",  10))
    const perPage = Math.min(200, Math.max(1, parseInt(query.per_page ?? "50", 10)))

    // Build where filters
    const where: Record<string, unknown> = { guildId }

    if (query.whitelist) {
      const wl = await prisma.whitelist.findUnique({
        where: { guildId_slug: { guildId, slug: query.whitelist } },
        select: { id: true },
      })
      if (!wl) return reply.code(404).send({ error: "Whitelist not found" })
      where.whitelistId = wl.id
    }

    if (query.action) where.actionType = query.action

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

    const result = entries.map(e => ({
      id:               e.id,
      guild_id:         e.guildId.toString(),
      whitelist_id:     e.whitelistId,
      action_type:      e.actionType,
      actor_discord_id: e.actorDiscordId?.toString() ?? null,
      target_discord_id: e.targetDiscordId?.toString() ?? null,
      details:          e.details,
      created_at:       e.createdAt,
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

    const alerts: Array<{ level: "warning" | "info"; message: string }> = []

    // Check for panels with no channel configured
    const panelsWithNoChannel = await prisma.panel.count({
      where: { guildId, channelId: null, enabled: true },
    })
    if (panelsWithNoChannel > 0) {
      alerts.push({
        level:   "warning",
        message: `${panelsWithNoChannel} panel(s) have no channel configured`,
      })
    }

    // Check for duplicate Steam IDs across users
    const steamIdRows = await prisma.whitelistIdentifier.groupBy({
      by:    ["idValue"],
      where: { guildId, idType: "steamid" },
      _count: { idValue: true },
      having: { idValue: { _count: { gt: 1 } } },
    })
    if (steamIdRows.length > 0) {
      alerts.push({
        level:   "warning",
        message: `${steamIdRows.length} Steam ID(s) are assigned to multiple users`,
      })
    }

    // Info: whitelists with no users
    const whitelists = await prisma.whitelist.findMany({
      where:   { guildId, enabled: true },
      select:  { id: true, name: true },
    })
    for (const wl of whitelists) {
      const userCount = await prisma.whitelistUser.count({
        where: { guildId, whitelistId: wl.id, status: "active" },
      })
      if (userCount === 0) {
        alerts.push({
          level:   "info",
          message: `Whitelist "${wl.name}" is enabled but has no active users`,
        })
      }
    }

    return reply.send({ alerts })
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
