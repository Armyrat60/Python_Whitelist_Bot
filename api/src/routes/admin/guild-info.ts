/**
 * Discord guild info route — member count, boost level, etc.
 *
 * Prefix: /api/admin
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify"

const adminHook = async (req: FastifyRequest, reply: FastifyReply) => {
  if (!req.session.userId) return reply.code(401).send({ error: "Not authenticated" })
  if (!req.session.activeGuildId) return reply.code(400).send({ error: "No guild selected" })
  const guild = req.session.guilds?.find(g => g.id === req.session.activeGuildId)
  if (!guild?.isAdmin) return reply.code(403).send({ error: "Admin access required" })
}

// Simple in-memory cache to avoid hitting Discord rate limits
const guildInfoCache = new Map<string, { data: unknown; expiresAt: number }>()
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

export default async function guildInfoRoutes(app: FastifyInstance) {

  // ── GET /api/admin/guild-info ────────────────────────────────────────────

  app.get("/guild-info", { preHandler: adminHook }, async (req, reply) => {
    const guildId = BigInt(req.session.activeGuildId!)
    const cacheKey = String(guildId)

    // Check cache
    const cached = guildInfoCache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) {
      return reply.send(cached.data)
    }

    try {
      const [preview, roles] = await Promise.all([
        app.discord.fetchGuildPreview(guildId),
        app.discord.fetchRoles(guildId),
      ])

      const result = {
        member_count:  preview.memberCount,
        online_count:  preview.onlineCount,
        boost_level:   preview.boostLevel,
        booster_count: preview.boosterCount,
        role_count:    roles.length,
      }

      guildInfoCache.set(cacheKey, { data: result, expiresAt: Date.now() + CACHE_TTL })
      return reply.send(result)
    } catch (err) {
      app.log.error({ err, guildId }, "Failed to fetch guild info from Discord")
      return reply.code(502).send({ error: "Failed to fetch guild info from Discord" })
    }
  })
}
