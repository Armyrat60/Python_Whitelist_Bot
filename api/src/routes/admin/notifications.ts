/**
 * Notification routing configuration routes.
 *
 * Prefix: /api/admin
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify"
import { toJSON } from "../../lib/json.js"

// ─── Admin preHandler ─────────────────────────────────────────────────────────

const adminHook = async (req: FastifyRequest, reply: FastifyReply) => {
  if (!req.session.userId) return reply.code(401).send({ error: "Not authenticated" })
  if (!req.session.activeGuildId) return reply.code(400).send({ error: "No guild selected" })
  const guild = req.session.guilds?.find(g => g.id === req.session.activeGuildId)
  if (!guild?.isAdmin) return reply.code(403).send({ error: "Admin access required" })
}

// ─── Constants ────────────────────────────────────────────────────────────────

const EVENT_TYPES: Record<string, { label: string; description: string }> = {
  user_joined:      { label: "User Joined",         description: "A member was auto-enrolled in the whitelist via a Discord role" },
  user_removed:     { label: "User Removed",         description: "A member was manually removed from the whitelist" },
  user_left_discord:{ label: "User Left Discord",    description: "A member left the server and was removed from the whitelist" },
  role_lost:        { label: "Role Lost",             description: "A member lost their required Discord role and was disabled" },
  role_returned:    { label: "Role Returned",         description: "A member regained their Discord role and was re-enabled" },
  report:           { label: "Whitelist Report",      description: "Periodic summary report of whitelist activity" },
  bot_alert:        { label: "Bot Alert",             description: "System alerts, errors, and important bot notifications" },
  admin_action:     { label: "Admin Action",          description: "Manual changes made by admins via the dashboard" },
}

// ─── Routes ───────────────────────────────────────────────────────────────────

export default async function notificationRoutes(app: FastifyInstance) {
  const { prisma } = app

  // ── GET /api/admin/notifications ────────────────────────────────────────────

  app.get("/notifications", { preHandler: adminHook }, async (req, reply) => {
    const guildId = BigInt(req.session.activeGuildId!)

    const rows = await prisma.notificationRouting.findMany({ where: { guildId } })
    const routing = Object.fromEntries(rows.map(r => [r.eventType, r.channelId]))

    return reply.send(toJSON({
      routing,
      event_types: EVENT_TYPES,
    }))
  })

  // ── PUT /api/admin/notifications ─────────────────────────────────────────────

  app.put("/notifications", { preHandler: adminHook }, async (req, reply) => {
    const guildId = BigInt(req.session.activeGuildId!)
    const body    = req.body as Record<string, string>

    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return reply.code(400).send({ error: "Body must be an object mapping eventType to channelId" })
    }

    await Promise.all(
      Object.entries(body).map(([eventType, channelId]) =>
        prisma.notificationRouting.upsert({
          where:  { guildId_eventType: { guildId, eventType } },
          update: { channelId: String(channelId) },
          create: { guildId, eventType, channelId: String(channelId) },
        })
      )
    )

    return reply.send({ ok: true })
  })
}
