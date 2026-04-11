/**
 * Role sync rules and role change logging routes.
 *
 * GET    /role-sync-rules       — list all rules for the active guild
 * POST   /role-sync-rules       — create a new rule
 * PUT    /role-sync-rules/:id   — update a rule
 * DELETE /role-sync-rules/:id   — delete a rule
 * GET    /role-watch-configs    — list watched roles
 * PUT    /role-watch-configs    — replace watched roles
 * GET    /role-change-logs      — paginated role change logs
 */
import type { FastifyInstance } from "fastify"

const MAX_RULES = 10
const MAX_SOURCE_ROLES = 20

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serializeRule(r: any) {
  return {
    id:               r.id,
    name:             r.name,
    target_role_id:   String(r.targetRoleId),
    target_role_name: r.targetRoleName,
    enabled:          r.enabled,
    created_at:       r.createdAt,
    updated_at:       r.updatedAt,
    source_roles:     (r.sourceRoles ?? []).map((s: any) => ({
      id:        s.id,
      role_id:   String(s.roleId),
      role_name: s.roleName,
    })),
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serializeWatchConfig(c: any) {
  return {
    id:        c.id,
    role_id:   String(c.roleId),
    role_name: c.roleName,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serializeLogEntry(e: any) {
  return {
    id:           e.id,
    discord_id:   String(e.discordId),
    discord_name: e.discordName,
    role_id:      String(e.roleId),
    role_name:    e.roleName,
    action:       e.action,
    created_at:   e.createdAt,
  }
}

export default async function roleSyncRuleRoutes(app: FastifyInstance) {
  const adminHook = [app.requireAdmin]

  // ── GET /role-sync-rules ────────────────────────────────────────────────

  app.get("/role-sync-rules", { preHandler: adminHook }, async (req, reply) => {
    const guildId = BigInt(req.session.activeGuildId!)

    const rules = await app.prisma.roleSyncRule.findMany({
      where: { guildId },
      include: { sourceRoles: true },
      orderBy: { createdAt: "asc" },
    })

    return reply.send({ rules: rules.map(serializeRule) })
  })

  // ── POST /role-sync-rules ───────────────────────────────────────────────

  app.post<{
    Body: {
      name: string
      target_role_id: string
      target_role_name: string
      source_roles: Array<{ role_id: string; role_name: string }>
    }
  }>("/role-sync-rules", { preHandler: adminHook }, async (req, reply) => {
    const guildId = BigInt(req.session.activeGuildId!)
    const { name, target_role_id, target_role_name, source_roles } = req.body ?? {}

    if (!name?.trim() || !target_role_id || !target_role_name || !source_roles?.length) {
      return reply.code(400).send({ error: "name, target_role_id, target_role_name, and source_roles are required." })
    }

    if (source_roles.length > MAX_SOURCE_ROLES) {
      return reply.code(400).send({ error: `Maximum ${MAX_SOURCE_ROLES} source roles per rule.` })
    }

    // Check rule limit
    const count = await app.prisma.roleSyncRule.count({ where: { guildId } })
    if (count >= MAX_RULES) {
      return reply.code(400).send({ error: `Maximum ${MAX_RULES} rules per server.` })
    }

    // Prevent target role from being a source role in any existing rule (circular)
    const existingSources = await app.prisma.roleSyncSourceRole.findMany({
      where: {
        rule: { guildId },
        roleId: BigInt(target_role_id),
      },
    })
    if (existingSources.length > 0) {
      return reply.code(400).send({ error: "The target role is already used as a source role in another rule." })
    }

    const rule = await app.prisma.roleSyncRule.create({
      data: {
        guildId,
        name: name.trim(),
        targetRoleId: BigInt(target_role_id),
        targetRoleName: target_role_name,
        enabled: true,
        sourceRoles: {
          create: source_roles.map((r) => ({
            roleId: BigInt(r.role_id),
            roleName: r.role_name,
          })),
        },
      },
      include: { sourceRoles: true },
    })

    return reply.send({ rule: serializeRule(rule) })
  })

  // ── PUT /role-sync-rules/:id ────────────────────────────────────────────

  app.put<{
    Params: { id: string }
    Body: {
      name?: string
      target_role_id?: string
      target_role_name?: string
      enabled?: boolean
      source_roles?: Array<{ role_id: string; role_name: string }>
    }
  }>("/role-sync-rules/:id", { preHandler: adminHook }, async (req, reply) => {
    const guildId = BigInt(req.session.activeGuildId!)
    const ruleId = parseInt(req.params.id, 10)
    const { name, target_role_id, target_role_name, enabled, source_roles } = req.body ?? {}

    // Verify ownership
    const existing = await app.prisma.roleSyncRule.findFirst({
      where: { id: ruleId, guildId },
    })
    if (!existing) {
      return reply.code(404).send({ error: "Rule not found." })
    }

    if (source_roles && source_roles.length > MAX_SOURCE_ROLES) {
      return reply.code(400).send({ error: `Maximum ${MAX_SOURCE_ROLES} source roles per rule.` })
    }

    // Build update data
    const data: Record<string, unknown> = {}
    if (name !== undefined) data.name = name.trim()
    if (target_role_id !== undefined) data.targetRoleId = BigInt(target_role_id)
    if (target_role_name !== undefined) data.targetRoleName = target_role_name
    if (enabled !== undefined) data.enabled = enabled

    await app.prisma.roleSyncRule.update({
      where: { id: ruleId },
      data,
    })

    // Replace source roles if provided
    if (source_roles) {
      await app.prisma.roleSyncSourceRole.deleteMany({ where: { ruleId } })
      await app.prisma.roleSyncSourceRole.createMany({
        data: source_roles.map((r) => ({
          ruleId,
          roleId: BigInt(r.role_id),
          roleName: r.role_name,
        })),
      })
    }

    const updated = await app.prisma.roleSyncRule.findUnique({
      where: { id: ruleId },
      include: { sourceRoles: true },
    })

    return reply.send({ rule: serializeRule(updated) })
  })

  // ── DELETE /role-sync-rules/:id ─────────────────────────────────────────

  app.delete<{ Params: { id: string } }>(
    "/role-sync-rules/:id",
    { preHandler: adminHook },
    async (req, reply) => {
      const guildId = BigInt(req.session.activeGuildId!)
      const ruleId = parseInt(req.params.id, 10)

      const existing = await app.prisma.roleSyncRule.findFirst({
        where: { id: ruleId, guildId },
      })
      if (!existing) {
        return reply.code(404).send({ error: "Rule not found." })
      }

      await app.prisma.roleSyncRule.delete({ where: { id: ruleId } })

      return reply.send({ ok: true })
    },
  )

  // ── GET /role-watch-configs ─────────────────────────────────────────────

  app.get("/role-watch-configs", { preHandler: adminHook }, async (req, reply) => {
    const guildId = BigInt(req.session.activeGuildId!)

    const configs = await app.prisma.roleWatchConfig.findMany({
      where: { guildId },
      orderBy: { roleName: "asc" },
    })

    return reply.send({ configs: configs.map(serializeWatchConfig) })
  })

  // ── PUT /role-watch-configs ─────────────────────────────────────────────

  app.put<{
    Body: { roles: Array<{ role_id: string; role_name: string }> }
  }>("/role-watch-configs", { preHandler: adminHook }, async (req, reply) => {
    const guildId = BigInt(req.session.activeGuildId!)
    const { roles } = req.body ?? {}

    if (!Array.isArray(roles)) {
      return reply.code(400).send({ error: "roles array is required." })
    }

    // Replace all watched roles for this guild
    await app.prisma.roleWatchConfig.deleteMany({ where: { guildId } })

    if (roles.length > 0) {
      await app.prisma.roleWatchConfig.createMany({
        data: roles.map((r) => ({
          guildId,
          roleId: BigInt(r.role_id),
          roleName: r.role_name,
        })),
      })
    }

    const configs = await app.prisma.roleWatchConfig.findMany({
      where: { guildId },
      orderBy: { roleName: "asc" },
    })

    return reply.send({ configs: configs.map(serializeWatchConfig) })
  })

  // ── GET /role-change-logs ───────────────────────────────────────────────

  app.get<{
    Querystring: {
      page?: string
      per_page?: string
      role_id?: string
      discord_id?: string
      action?: string
      date_from?: string
      date_to?: string
    }
  }>("/role-change-logs", { preHandler: adminHook }, async (req, reply) => {
    const guildId = BigInt(req.session.activeGuildId!)
    const page = Math.max(1, parseInt(req.query.page ?? "1", 10) || 1)
    const perPage = Math.min(100, Math.max(1, parseInt(req.query.per_page ?? "50", 10) || 50))
    const skip = (page - 1) * perPage

    // Build filters
    const where: Record<string, unknown> = { guildId }
    if (req.query.role_id) where.roleId = BigInt(req.query.role_id)
    if (req.query.discord_id) where.discordId = BigInt(req.query.discord_id)
    if (req.query.action && (req.query.action === "gained" || req.query.action === "lost")) {
      where.action = req.query.action
    }
    if (req.query.date_from || req.query.date_to) {
      const createdAt: Record<string, Date> = {}
      if (req.query.date_from) createdAt.gte = new Date(req.query.date_from)
      if (req.query.date_to) createdAt.lte = new Date(req.query.date_to)
      where.createdAt = createdAt
    }

    const [entries, total] = await Promise.all([
      app.prisma.roleChangeLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: perPage,
        skip,
      }),
      app.prisma.roleChangeLog.count({ where }),
    ])

    return reply.send({
      entries: entries.map(serializeLogEntry),
      total,
      page,
      per_page: perPage,
      pages: Math.ceil(total / perPage),
    })
  })
}
