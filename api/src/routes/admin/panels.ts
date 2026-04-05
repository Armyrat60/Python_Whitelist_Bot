import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify"
import { toJSON } from "../../lib/json.js"

// ─── Queue helpers ────────────────────────────────────────────────────────────

async function queueRefresh(app: FastifyInstance, guildId: bigint, panelId: number, reason = "settings_changed") {
  try {
    await app.prisma.panelRefreshQueue.create({
      data: { guildId, panelId, reason, action: "refresh" }
    })
  } catch (err) {
    app.log.warn({ err }, "Failed to queue panel refresh")
  }
}

async function queueDelete(app: FastifyInstance, guildId: bigint, panelId: number, channelId: bigint | null, messageId: bigint | null) {
  if (!channelId || !messageId) return
  try {
    await app.prisma.panelRefreshQueue.create({
      data: { guildId, panelId, reason: "panel_deleted", action: "delete", channelId, messageId }
    })
  } catch (err) {
    app.log.warn({ err }, "Failed to queue panel delete")
  }
}

// ─── Admin preHandler ─────────────────────────────────────────────────────────

const adminHook = async (req: FastifyRequest, reply: FastifyReply) => {
  if (!req.session.userId) return reply.code(401).send({ error: "Not authenticated" })
  if (!req.session.activeGuildId) return reply.code(400).send({ error: "No guild selected" })
  const guild = req.session.guilds?.find(g => g.id === req.session.activeGuildId)
  if (!guild?.isAdmin) return reply.code(403).send({ error: "Admin access required" })
}

// ─── Routes ───────────────────────────────────────────────────────────────────

export default async function panelRoutes(app: FastifyInstance) {
  const { prisma } = app

  // GET /api/admin/panels
  app.get("/panels", { preHandler: adminHook }, async (req, reply) => {
    const guildId = BigInt(req.session.activeGuildId!)

    const panels = await prisma.panel.findMany({
      where:   { guildId },
      orderBy: { id: "asc" }
    })

    const result = panels.map(p => ({
      id:                 p.id,
      name:               p.name,
      channel_id:         p.channelId?.toString()      ?? null,
      log_channel_id:     p.logChannelId?.toString()   ?? null,
      whitelist_id:       p.whitelistId,
      panel_message_id:   p.panelMessageId?.toString() ?? null,
      is_default:         p.isDefault,
      enabled:            p.enabled,
      show_role_mentions: p.showRoleMentions,
      last_push_status:   p.lastPushStatus  ?? null,
      last_push_error:    p.lastPushError   ?? null,
      last_push_at:       p.lastPushAt      ?? null,
    }))

    return reply.send(toJSON({ panels: result }))
  })

  // POST /api/admin/panels
  app.post("/panels", { preHandler: adminHook }, async (req, reply) => {
    const guildId = BigInt(req.session.activeGuildId!)
    const body = req.body as {
      name:            string
      channel_id?:     string | null
      log_channel_id?: string | null
      whitelist_id?:   number | null
    }

    if (!body.name || typeof body.name !== "string") {
      return reply.code(400).send({ error: "name is required" })
    }

    const count = await prisma.panel.count({ where: { guildId } })
    if (count >= 5) {
      return reply.code(400).send({ error: "Maximum of 5 panels allowed" })
    }

    const panel = await prisma.panel.create({
      data: {
        guildId,
        name:           body.name,
        channelId:      body.channel_id     ? BigInt(body.channel_id)     : null,
        logChannelId:   body.log_channel_id ? BigInt(body.log_channel_id) : null,
        whitelistId:    body.whitelist_id   ?? null,
        panelMessageId: null,
        isDefault:      false,
        enabled:        true,
        createdAt:      new Date(),
        updatedAt:      new Date(),
      }
    })

    return reply.code(201).send(toJSON({ ok: true, id: panel.id, name: panel.name }))
  })

  // PUT /api/admin/panels/:panelId
  app.put("/panels/:panelId", { preHandler: adminHook }, async (req, reply) => {
    const guildId  = BigInt(req.session.activeGuildId!)
    const panelId  = parseInt((req.params as { panelId: string }).panelId, 10)

    if (isNaN(panelId)) {
      return reply.code(400).send({ error: "Invalid panelId" })
    }

    const existing = await prisma.panel.findFirst({ where: { id: panelId, guildId } })
    if (!existing) return reply.code(404).send({ error: "Panel not found" })

    const body = req.body as {
      name?:               string
      channel_id?:         string | null
      log_channel_id?:     string | null
      whitelist_id?:       number | null
      enabled?:            boolean
      show_role_mentions?: boolean
    }

    const data: Record<string, unknown> = { updatedAt: new Date() }

    if (body.name               !== undefined) data["name"]             = body.name
    if (body.enabled            !== undefined) data["enabled"]          = body.enabled
    if (body.whitelist_id       !== undefined) data["whitelistId"]      = body.whitelist_id
    if (body.show_role_mentions !== undefined) data["showRoleMentions"] = body.show_role_mentions
    if (body.channel_id         !== undefined) {
      data["channelId"] = body.channel_id ? BigInt(body.channel_id) : null
    }
    if (body.log_channel_id     !== undefined) {
      data["logChannelId"] = body.log_channel_id ? BigInt(body.log_channel_id) : null
    }

    await prisma.panel.update({ where: { id: panelId }, data })

    await queueRefresh(app, guildId, panelId, "dashboard_update")

    return reply.send(toJSON({ ok: true, panel_id: panelId }))
  })

  // DELETE /api/admin/panels/:panelId
  app.delete("/panels/:panelId", { preHandler: adminHook }, async (req, reply) => {
    const guildId = BigInt(req.session.activeGuildId!)
    const panelId = parseInt((req.params as { panelId: string }).panelId, 10)

    if (isNaN(panelId)) {
      return reply.code(400).send({ error: "Invalid panelId" })
    }

    const count = await prisma.panel.count({ where: { guildId } })
    if (count <= 1) {
      return reply.code(400).send({ error: "Cannot delete the last panel" })
    }

    const existing = await prisma.panel.findFirst({ where: { id: panelId, guildId } })
    if (!existing) return reply.code(404).send({ error: "Panel not found" })

    // Queue Discord message deletion before removing the DB record
    await queueDelete(app, guildId, panelId, existing.channelId, existing.panelMessageId)

    await prisma.panel.delete({ where: { id: panelId } })

    return reply.send({ ok: true })
  })

  // POST /api/admin/panels/:panelId/push
  app.post("/panels/:panelId/push", { preHandler: adminHook }, async (req, reply) => {
    const guildId = BigInt(req.session.activeGuildId!)
    const panelId = parseInt((req.params as { panelId: string }).panelId, 10)
    if (isNaN(panelId)) return reply.code(400).send({ error: "Invalid panelId" })

    const existing = await prisma.panel.findFirst({ where: { id: panelId, guildId } })
    if (!existing) return reply.code(404).send({ error: "Panel not found" })

    await queueRefresh(app, guildId, panelId, "manual_push")

    return reply.send({ ok: true, queued: true })
  })
}
