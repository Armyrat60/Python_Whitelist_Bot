/**
 * Notification routing configuration routes.
 *
 * Prefix: /api/admin
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify"

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

// ─── Constants ────────────────────────────────────────────────────────────────

const EVENT_TYPES = ["user_join", "user_leave", "user_update", "role_sync", "report"] as const

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
