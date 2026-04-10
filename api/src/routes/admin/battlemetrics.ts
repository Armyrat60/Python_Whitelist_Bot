/**
 * BattleMetrics integration routes.
 *
 * Prefix: /api/admin
 *
 * GET    /battlemetrics-config           — fetch config (API key masked)
 * PUT    /battlemetrics-config           — save config
 * DELETE /battlemetrics-config           — remove config
 * POST   /battlemetrics-config/test      — validate API key + server ID
 * GET    /battlemetrics/player/:steamId  — fetch player hours from BM
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify"
import { BattleMetricsClient } from "../../lib/battlemetrics.js"

const MASKED = "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022"

const adminHook = async (req: FastifyRequest, reply: FastifyReply) => {
  if (!req.session.userId) return reply.code(401).send({ error: "Not authenticated" })
  if (!req.session.activeGuildId) return reply.code(400).send({ error: "No guild selected" })
  const guild = req.session.guilds?.find(g => g.id === req.session.activeGuildId)
  if (!guild?.isAdmin) return reply.code(403).send({ error: "Admin access required" })
}

export default async function battlemetricsRoutes(app: FastifyInstance) {
  const { prisma } = app

  // ── GET /battlemetrics-config ─────────────────────────────────────────────

  app.get("/battlemetrics-config", { preHandler: adminHook }, async (req, reply) => {
    const guildId = BigInt(req.session.activeGuildId!)
    const config = await prisma.battleMetricsConfig.findUnique({ where: { guildId } })

    if (!config) return reply.send({ config: null })

    return reply.send({
      config: {
        server_id:   config.serverId,
        server_name: config.serverName,
        enabled:     config.enabled,
        api_key:     MASKED,
        has_api_key: !!config.apiKey,
      },
    })
  })

  // ── PUT /battlemetrics-config ─────────────────────────────────────────────

  app.put<{
    Body: { api_key?: string; server_id?: string; server_name?: string; enabled?: boolean }
  }>("/battlemetrics-config", { preHandler: adminHook }, async (req, reply) => {
    const guildId = BigInt(req.session.activeGuildId!)
    const { api_key, server_id, server_name, enabled } = req.body

    const existing = await prisma.battleMetricsConfig.findUnique({ where: { guildId } })

    // Require API key for new configs
    const effectiveKey = api_key === MASKED ? existing?.apiKey : api_key
    if (!effectiveKey) {
      return reply.code(400).send({ error: "API key is required" })
    }

    const config = await prisma.battleMetricsConfig.upsert({
      where: { guildId },
      create: {
        guildId,
        apiKey:     effectiveKey,
        serverId:   server_id ?? null,
        serverName: server_name ?? null,
        enabled:    enabled ?? true,
      },
      update: {
        apiKey:     effectiveKey,
        serverId:   server_id !== undefined ? server_id : undefined,
        serverName: server_name !== undefined ? server_name : undefined,
        enabled:    enabled !== undefined ? enabled : undefined,
      },
    })

    return reply.send({
      config: {
        server_id:   config.serverId,
        server_name: config.serverName,
        enabled:     config.enabled,
        api_key:     MASKED,
        has_api_key: true,
      },
    })
  })

  // ── DELETE /battlemetrics-config ───────────────────────────────────────────

  app.delete("/battlemetrics-config", { preHandler: adminHook }, async (req, reply) => {
    const guildId = BigInt(req.session.activeGuildId!)
    const existing = await prisma.battleMetricsConfig.findUnique({ where: { guildId } })
    if (!existing) return reply.code(404).send({ error: "No config found" })

    await prisma.battleMetricsConfig.delete({ where: { guildId } })
    return reply.send({ ok: true })
  })

  // ── POST /battlemetrics-config/test ───────────────────────────────────────

  app.post<{
    Body: { api_key?: string; server_id?: string }
  }>("/battlemetrics-config/test", { preHandler: adminHook }, async (req, reply) => {
    const guildId = BigInt(req.session.activeGuildId!)
    const { api_key, server_id } = req.body

    // Resolve API key (use existing if masked)
    let effectiveKey = api_key
    if (!effectiveKey || effectiveKey === MASKED) {
      const existing = await prisma.battleMetricsConfig.findUnique({ where: { guildId } })
      effectiveKey = existing?.apiKey
    }
    if (!effectiveKey) {
      return reply.send({ ok: false, message: "API key is required" })
    }

    const bm = new BattleMetricsClient(effectiveKey)

    // Test API token
    const connTest = await bm.testConnection()
    if (!connTest.ok) {
      return reply.send(connTest)
    }

    // Test server ID if provided
    if (server_id) {
      const server = await bm.getServerInfo(server_id)
      if (!server) {
        return reply.send({ ok: false, message: `Server ID ${server_id} not found or not accessible` })
      }
      return reply.send({
        ok: true,
        message: `Connected! Server: ${server.name} (${server.players}/${server.maxPlayers} players)`,
        server_name: server.name,
      })
    }

    return reply.send(connTest)
  })

  // ── GET /battlemetrics/servers ──────────────────────────────────────────────
  // Discover Squad servers accessible to the configured BM API token.

  app.get("/battlemetrics/servers", { preHandler: adminHook }, async (req, reply) => {
    const guildId = BigInt(req.session.activeGuildId!)
    const config = await prisma.battleMetricsConfig.findUnique({ where: { guildId } })
    if (!config?.apiKey) {
      return reply.send({ servers: [], reason: "BattleMetrics not configured" })
    }

    try {
      const bm = new BattleMetricsClient(config.apiKey)
      const servers = await bm.discoverServers()
      return reply.send({ servers })
    } catch (err) {
      app.log.error({ err, guildId }, "BattleMetrics server discovery failed")
      return reply.send({ servers: [], reason: "Failed to discover servers" })
    }
  })

  // ── GET /battlemetrics/player/:steamId ────────────────────────────────────

  app.get<{
    Params: { steamId: string }
  }>("/battlemetrics/player/:steamId", { preHandler: adminHook }, async (req, reply) => {
    const guildId = BigInt(req.session.activeGuildId!)
    const { steamId } = req.params

    if (!/^[0-9]{17}$/.test(steamId)) {
      return reply.code(400).send({ error: "Invalid Steam64 ID" })
    }

    const config = await prisma.battleMetricsConfig.findUnique({ where: { guildId } })
    if (!config || !config.enabled || !config.apiKey) {
      return reply.send({ player: null, reason: "BattleMetrics not configured" })
    }

    if (!config.serverId) {
      return reply.send({ player: null, reason: "No server ID configured" })
    }

    try {
      const bm = new BattleMetricsClient(config.apiKey)
      const hours = await bm.getPlayerHours(steamId, config.serverId)

      if (!hours) {
        return reply.send({ player: null, reason: "Player not found on BattleMetrics" })
      }

      return reply.send({
        player: {
          ...hours,
          serverName: config.serverName ?? null,
        },
      })
    } catch (err) {
      app.log.error({ err, steamId, guildId }, "BattleMetrics player lookup failed")
      return reply.send({ player: null, reason: "BattleMetrics API error" })
    }
  })
}
