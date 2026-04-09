import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify"
import { cache } from "../../services/cache.js"
import { getFileToken } from "../../services/token.js"
import { syncOutputs } from "../../services/output.js"

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
    cache.set(guildId, outputs)
    const salt = await app.prisma.botSetting.findUnique({
      where: { guildId_settingKey: { guildId, settingKey: "url_salt" } }
    })
    cache.registerToken(getFileToken(guildId, salt?.settingValue ?? null), guildId)
  } catch (err) {
    app.log.error({ err, guildId }, "triggerSync failed")
  }
}

// ─── Hardcoded Squad permissions ─────────────────────────────────────────────

const SQUAD_PERMISSIONS = {
  reserve:         "Reserve slot",
  kick:            "Kick players",
  ban:             "Ban players",
  changemap:       "Change map",
  pause:           "Pause server",
  cheat:           "Cheat commands",
  private:         "Private server",
  balance:         "Team balance",
  chat:            "Chat commands",
  cameraman:       "Cameraman mode",
  immune:          "Immune from kicks",
  manageserver:    "Manage server",
  featuretest:     "Feature test",
  forceteamchange: "Force team change",
  canseeadminchat: "See admin chat",
} as const

// ─── Routes ───────────────────────────────────────────────────────────────────

export default async function groupRoutes(app: FastifyInstance) {
  const { prisma } = app

  // GET /api/admin/groups
  app.get("/groups", { preHandler: adminHook }, async (req, reply) => {
    const guildId = BigInt(req.session.activeGuildId!)

    const groups = await prisma.squadGroup.findMany({
      where:   { guildId },
      orderBy: { groupName: "asc" }
    })

    return reply.send({
      groups: groups.map(g => ({
        group_name:  g.groupName,
        permissions: g.permissions,
        is_default:  g.isDefault,
        description: g.description,
        enabled:     g.enabled,
      }))
    })
  })

  // PATCH /api/admin/groups/:groupName/toggle  — flip enabled
  app.patch("/groups/:groupName/toggle", { preHandler: adminHook }, async (req, reply) => {
    const guildId = BigInt(req.session.activeGuildId!)
    const { groupName } = req.params as { groupName: string }

    const existing = await prisma.squadGroup.findUnique({
      where: { guildId_groupName: { guildId, groupName } }
    })
    if (!existing) {
      return reply.code(404).send({ error: `Group "${groupName}" not found` })
    }

    const updated = await prisma.squadGroup.update({
      where: { guildId_groupName: { guildId, groupName } },
      data:  { enabled: !existing.enabled, updatedAt: new Date() }
    })

    await triggerSync(app, guildId)

    return reply.send({ ok: true, enabled: updated.enabled })
  })

  // GET /api/admin/permissions
  app.get("/permissions", { preHandler: adminHook }, async (_req, reply) => {
    return reply.send({ permissions: SQUAD_PERMISSIONS })
  })

  // POST /api/admin/groups
  app.post("/groups", { preHandler: adminHook }, async (req, reply) => {
    const guildId = BigInt(req.session.activeGuildId!)
    const body = req.body as {
      group_name: string
      permissions: string
      description?: string
    }

    if (!body.group_name || typeof body.group_name !== "string") {
      return reply.code(400).send({ error: "group_name is required" })
    }
    if (body.group_name.length > 100) {
      return reply.code(400).send({ error: "group_name must be 100 characters or fewer" })
    }
    if (!body.permissions || typeof body.permissions !== "string") {
      return reply.code(400).send({ error: "permissions is required" })
    }

    const duplicate = await prisma.squadGroup.findUnique({
      where: { guildId_groupName: { guildId, groupName: body.group_name } }
    })
    if (duplicate) {
      return reply.code(409).send({ error: `Group "${body.group_name}" already exists` })
    }

    const groupCount = await prisma.squadGroup.count({ where: { guildId } })
    if (groupCount >= 10) {
      return reply.code(400).send({ error: "Maximum of 10 groups per guild" })
    }

    await prisma.squadGroup.create({
      data: {
        guildId,
        groupName:   body.group_name,
        permissions: body.permissions,
        description: body.description ?? "",
        isDefault:   false,
        createdAt:   new Date(),
        updatedAt:   new Date(),
      }
    })

    return reply.code(201).send({ ok: true, group_name: body.group_name })
  })

  // PUT /api/admin/groups/:groupName
  app.put("/groups/:groupName", { preHandler: adminHook }, async (req, reply) => {
    const guildId   = BigInt(req.session.activeGuildId!)
    const { groupName } = req.params as { groupName: string }
    const body = req.body as {
      group_name?:  string
      permissions:  string
      description?: string
    }

    const existing = await prisma.squadGroup.findUnique({
      where: { guildId_groupName: { guildId, groupName } }
    })
    if (!existing) {
      return reply.code(404).send({ error: `Group "${groupName}" not found` })
    }

    const newGroupName = body.group_name ?? groupName

    if (newGroupName !== groupName) {
      // Rename: check the new name is not taken
      const conflict = await prisma.squadGroup.findUnique({
        where: { guildId_groupName: { guildId, groupName: newGroupName } }
      })
      if (conflict) {
        return reply.code(409).send({ error: `Group "${newGroupName}" already exists` })
      }

      // Delete old, create new
      await prisma.$transaction([
        prisma.squadGroup.delete({
          where: { guildId_groupName: { guildId, groupName } }
        }),
        prisma.squadGroup.create({
          data: {
            guildId,
            groupName:   newGroupName,
            permissions: body.permissions,
            description: body.description ?? existing.description,
            isDefault:   existing.isDefault,
            createdAt:   existing.createdAt,
            updatedAt:   new Date(),
          }
        }),
        // Update all whitelists that referenced the old group name
        prisma.whitelist.updateMany({
          where: { guildId, squadGroup: groupName },
          data:  { squadGroup: newGroupName, updatedAt: new Date() }
        }),
      ])
    } else {
      await prisma.squadGroup.update({
        where: { guildId_groupName: { guildId, groupName } },
        data: {
          permissions: body.permissions,
          description: body.description ?? existing.description,
          updatedAt:   new Date(),
        }
      })
    }

    await triggerSync(app, guildId)

    return reply.send({ ok: true })
  })

  // DELETE /api/admin/groups/:groupName
  app.delete("/groups/:groupName", { preHandler: adminHook }, async (req, reply) => {
    const guildId   = BigInt(req.session.activeGuildId!)
    const { groupName } = req.params as { groupName: string }

    const inUse = await prisma.whitelist.findFirst({
      where: { guildId, squadGroup: groupName }
    })
    if (inUse) {
      const usingWhitelists = await prisma.whitelist.findMany({
        where:  { guildId, squadGroup: groupName },
        select: { name: true, slug: true }
      })
      const names = usingWhitelists.map(w => `"${w.name}"`).join(", ")
      return reply.code(400).send({
        error:      `Group "${groupName}" is in use by: ${names}. Reassign those whitelists to a different group first.`,
        whitelists: usingWhitelists.map(w => ({ name: w.name, slug: w.slug }))
      })
    }

    const existing = await prisma.squadGroup.findUnique({
      where: { guildId_groupName: { guildId, groupName } }
    })
    if (!existing) {
      return reply.code(404).send({ error: `Group "${groupName}" not found` })
    }

    await prisma.squadGroup.delete({
      where: { guildId_groupName: { guildId, groupName } }
    })

    return reply.send({ ok: true, deleted: groupName })
  })
}
