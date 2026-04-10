/**
 * RCON routes for game server interaction.
 *
 * Prefix: /api/admin
 *
 * GET  /game-servers/:id/rcon/status    — server info
 * GET  /game-servers/:id/rcon/players   — full player/squad/team state
 * POST /game-servers/:id/rcon/kick      — kick a player
 * POST /game-servers/:id/rcon/warn      — warn a player
 * POST /game-servers/:id/rcon/broadcast — broadcast message
 * POST /game-servers/:id/rcon/test      — test RCON connection
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify"
import { testRconConnection } from "../../lib/rcon.js"
import {
  getServerInfo,
  getFullServerState,
  kickPlayer,
  warnPlayer,
  broadcast,
  toRconConfig,
} from "../../lib/squad-rcon.js"

const requireRconRead = async (req: FastifyRequest, reply: FastifyReply) => {
  if (!req.session.userId) return reply.code(401).send({ error: "Not authenticated" })
  if (!req.session.activeGuildId) return reply.code(400).send({ error: "No guild selected" })
  const guild = req.session.guilds?.find(g => g.id === req.session.activeGuildId)
  if (guild?.isAdmin) return
  const perms = (guild as Record<string, unknown>)?.granularPermissions as Record<string, boolean> | undefined
  if (!perms?.rcon_read) return reply.code(403).send({ error: "Missing permission: rcon_read" })
}

const requireRconExecute = async (req: FastifyRequest, reply: FastifyReply) => {
  if (!req.session.userId) return reply.code(401).send({ error: "Not authenticated" })
  if (!req.session.activeGuildId) return reply.code(400).send({ error: "No guild selected" })
  const guild = req.session.guilds?.find(g => g.id === req.session.activeGuildId)
  if (guild?.isAdmin) return
  const perms = (guild as Record<string, unknown>)?.granularPermissions as Record<string, boolean> | undefined
  if (!perms?.rcon_execute) return reply.code(403).send({ error: "Missing permission: rcon_execute" })
}

export default async function rconRoutes(app: FastifyInstance) {
  const { prisma } = app

  async function getServerConfig(req: FastifyRequest, reply: FastifyReply, serverId: number) {
    const guildId = BigInt(req.session.activeGuildId!)
    const server = await prisma.gameServer.findFirst({ where: { id: serverId, guildId } })
    if (!server) { reply.code(404).send({ error: "Server not found" }); return null }
    const config = toRconConfig(server)
    if (!config) { reply.send({ error: "RCON not configured — fill in host and password" }); return null }
    return { server, config }
  }

  // ── GET /game-servers/:id/rcon/status ─────────────────────────────────────

  app.get<{ Params: { id: string } }>("/game-servers/:id/rcon/status", { preHandler: requireRconRead }, async (req, reply) => {
    const result = await getServerConfig(req, reply, parseInt(req.params.id, 10))
    if (!result) return

    try {
      const info = await getServerInfo(result.config)
      return reply.send({ status: "online", ...info })
    } catch (err) {
      return reply.send({ status: "offline", error: (err as Error).message })
    }
  })

  // ── GET /game-servers/:id/rcon/players ────────────────────────────────────

  app.get<{ Params: { id: string } }>("/game-servers/:id/rcon/players", { preHandler: requireRconRead }, async (req, reply) => {
    const result = await getServerConfig(req, reply, parseInt(req.params.id, 10))
    if (!result) return

    try {
      const state = await getFullServerState(result.config)
      return reply.send(state)
    } catch (err) {
      return reply.send({ info: null, teams: [], totalPlayers: 0, error: (err as Error).message })
    }
  })

  // ── POST /game-servers/:id/rcon/kick ──────────────────────────────────────

  app.post<{
    Params: { id: string }
    Body: { player_id: string; reason?: string }
  }>("/game-servers/:id/rcon/kick", { preHandler: requireRconExecute }, async (req, reply) => {
    const result = await getServerConfig(req, reply, parseInt(req.params.id, 10))
    if (!result) return

    const { player_id, reason } = req.body
    if (!player_id) return reply.code(400).send({ error: "player_id is required" })

    try {
      const response = await kickPlayer(result.config, player_id, reason || "Kicked by admin")
      app.log.info({ userId: req.session.userId, serverId: result.server.id, playerId: player_id, reason }, "RCON kick")
      return reply.send({ ok: true, response })
    } catch (err) {
      return reply.code(500).send({ ok: false, error: (err as Error).message })
    }
  })

  // ── POST /game-servers/:id/rcon/warn ──────────────────────────────────────

  app.post<{
    Params: { id: string }
    Body: { target: string; message: string }
  }>("/game-servers/:id/rcon/warn", { preHandler: requireRconExecute }, async (req, reply) => {
    const result = await getServerConfig(req, reply, parseInt(req.params.id, 10))
    if (!result) return

    const { target, message } = req.body
    if (!target || !message) return reply.code(400).send({ error: "target and message are required" })

    try {
      const response = await warnPlayer(result.config, target, message)
      app.log.info({ userId: req.session.userId, serverId: result.server.id, target, message }, "RCON warn")
      return reply.send({ ok: true, response })
    } catch (err) {
      return reply.code(500).send({ ok: false, error: (err as Error).message })
    }
  })

  // ── POST /game-servers/:id/rcon/broadcast ─────────────────────────────────

  app.post<{
    Params: { id: string }
    Body: { message: string }
  }>("/game-servers/:id/rcon/broadcast", { preHandler: requireRconExecute }, async (req, reply) => {
    const result = await getServerConfig(req, reply, parseInt(req.params.id, 10))
    if (!result) return

    const { message } = req.body
    if (!message) return reply.code(400).send({ error: "message is required" })

    try {
      const response = await broadcast(result.config, message)
      app.log.info({ userId: req.session.userId, serverId: result.server.id, message }, "RCON broadcast")
      return reply.send({ ok: true, response })
    } catch (err) {
      return reply.code(500).send({ ok: false, error: (err as Error).message })
    }
  })

  // ── POST /game-servers/:id/rcon/test ──────────────────────────────────────

  app.post<{ Params: { id: string } }>("/game-servers/:id/rcon/test", { preHandler: requireRconRead }, async (req, reply) => {
    const result = await getServerConfig(req, reply, parseInt(req.params.id, 10))
    if (!result) return

    const testResult = await testRconConnection(result.config)
    return reply.send(testResult)
  })
}
