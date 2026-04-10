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

import { cacheGet, cacheSet } from "../../lib/redis.js"

// In-memory fallback + Redis cache for guild info
const guildInfoMem = new Map<string, { data: unknown; expiresAt: number }>()
const CACHE_TTL = 5 * 60 // 5 minutes (seconds for Redis)
const CACHE_TTL_MS = CACHE_TTL * 1000

export default async function guildInfoRoutes(app: FastifyInstance) {

  // ── GET /api/admin/guild-info ────────────────────────────────────────────

  app.get("/guild-info", { preHandler: adminHook }, async (req, reply) => {
    const guildId = BigInt(req.session.activeGuildId!)
    const cacheKey = String(guildId)

    // Check Redis cache first, then in-memory fallback
    const redisCached = await cacheGet(`guild-info:${cacheKey}`)
    if (redisCached) {
      return reply.send(JSON.parse(redisCached))
    }
    const memCached = guildInfoMem.get(cacheKey)
    if (memCached && memCached.expiresAt > Date.now()) {
      return reply.send(memCached.data)
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

      guildInfoMem.set(cacheKey, { data: result, expiresAt: Date.now() + CACHE_TTL_MS })
      await cacheSet(`guild-info:${cacheKey}`, JSON.stringify(result), CACHE_TTL)
      return reply.send(result)
    } catch (err) {
      app.log.error({ err, guildId }, "Failed to fetch guild info from Discord")
      return reply.code(502).send({ error: "Failed to fetch guild info from Discord" })
    }
  })

  // ── GET /api/admin/guild-info/booster-role ──────────────────────────────

  app.get("/guild-info/booster-role", { preHandler: adminHook }, async (req, reply) => {
    const guildId = BigInt(req.session.activeGuildId!)

    try {
      const boosterRole = await app.discord.fetchBoosterRole(guildId)
      if (!boosterRole) {
        return reply.send({ booster_role: null })
      }

      // Check if this role is already linked to any panel
      const existingPanelRole = await app.prisma.panelRole.findFirst({
        where: { guildId, roleId: BigInt(boosterRole.id), isActive: true },
        include: { panel: { select: { id: true, name: true, whitelistId: true } } },
      })

      return reply.send({
        booster_role: {
          id: boosterRole.id,
          name: boosterRole.name,
        },
        linked_panel: existingPanelRole ? {
          panel_id: existingPanelRole.panel.id,
          panel_name: existingPanelRole.panel.name,
          whitelist_id: existingPanelRole.panel.whitelistId,
          slot_limit: existingPanelRole.slotLimit,
        } : null,
      })
    } catch (err) {
      app.log.error({ err, guildId }, "Failed to fetch booster role")
      return reply.code(502).send({ error: "Failed to fetch booster role from Discord" })
    }
  })
}
