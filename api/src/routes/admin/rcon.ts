/**
 * RCON routes for game server interaction.
 *
 * Prefix: /api/admin
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify"
import { testRconConnection } from "../../lib/rcon.js"
import {
  getServerInfo,
  getFullServerState,
  kickPlayer,
  warnPlayer,
  broadcast,
  forceTeamChange,
  removeFromSquad,
  disbandSquad,
  demoteCommander,
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
    return { server, config, guildId }
  }

  /** Write an RCON action to the audit log. */
  async function auditRcon(guildId: bigint, userId: string, actionType: string, details: Record<string, unknown>) {
    try {
      await prisma.auditLog.create({
        data: {
          guildId,
          actionType,
          actorDiscordId: BigInt(userId),
          details: JSON.stringify(details),
          createdAt: new Date(),
        },
      })
    } catch (err) {
      app.log.error({ err, actionType }, "Failed to write RCON audit log")
    }
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

    const start = Date.now()
    try {
      const state = await getFullServerState(result.config)
      return reply.send({ ...state, responseTime: Date.now() - start })
    } catch (err) {
      return reply.send({ info: null, teams: [], totalPlayers: 0, error: (err as Error).message, responseTime: Date.now() - start })
    }
  })

  // ── POST /game-servers/:id/rcon/kick ──────────────────────────────────────

  app.post<{
    Params: { id: string }
    Body: { player_id: string; player_name?: string; reason?: string }
  }>("/game-servers/:id/rcon/kick", { preHandler: requireRconExecute }, async (req, reply) => {
    const result = await getServerConfig(req, reply, parseInt(req.params.id, 10))
    if (!result) return

    const { player_id, player_name, reason } = req.body
    if (!player_id) return reply.code(400).send({ error: "player_id is required" })

    try {
      const response = await kickPlayer(result.config, player_id, reason || "Kicked by admin")
      await auditRcon(result.guildId, req.session.userId!, "rcon_kick", {
        server: result.server.name, playerId: player_id, playerName: player_name, reason: reason || "Kicked by admin",
      })
      return reply.send({ ok: true, response })
    } catch (err) {
      return reply.code(500).send({ ok: false, error: (err as Error).message })
    }
  })

  // ── POST /game-servers/:id/rcon/warn ──────────────────────────────────────

  app.post<{
    Params: { id: string }
    Body: { target: string; player_name?: string; message: string }
  }>("/game-servers/:id/rcon/warn", { preHandler: requireRconExecute }, async (req, reply) => {
    const result = await getServerConfig(req, reply, parseInt(req.params.id, 10))
    if (!result) return

    const { target, player_name, message } = req.body
    if (!target || !message) return reply.code(400).send({ error: "target and message are required" })

    try {
      const response = await warnPlayer(result.config, target, message)
      await auditRcon(result.guildId, req.session.userId!, "rcon_warn", {
        server: result.server.name, target, playerName: player_name, message,
      })
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
      await auditRcon(result.guildId, req.session.userId!, "rcon_broadcast", {
        server: result.server.name, message,
      })
      return reply.send({ ok: true, response })
    } catch (err) {
      return reply.code(500).send({ ok: false, error: (err as Error).message })
    }
  })

  // ── POST /game-servers/:id/rcon/force-team-change ─────────────────────────

  app.post<{
    Params: { id: string }
    Body: { player_id: string; player_name?: string }
  }>("/game-servers/:id/rcon/force-team-change", { preHandler: requireRconExecute }, async (req, reply) => {
    const result = await getServerConfig(req, reply, parseInt(req.params.id, 10))
    if (!result) return

    const { player_id, player_name } = req.body
    if (!player_id) return reply.code(400).send({ error: "player_id is required" })

    try {
      const response = await forceTeamChange(result.config, player_id)
      await auditRcon(result.guildId, req.session.userId!, "rcon_force_team_change", {
        server: result.server.name, playerId: player_id, playerName: player_name,
      })
      return reply.send({ ok: true, response })
    } catch (err) {
      return reply.code(500).send({ ok: false, error: (err as Error).message })
    }
  })

  // ── POST /game-servers/:id/rcon/remove-from-squad ─────────────────────────

  app.post<{
    Params: { id: string }
    Body: { player_id: string; player_name?: string }
  }>("/game-servers/:id/rcon/remove-from-squad", { preHandler: requireRconExecute }, async (req, reply) => {
    const result = await getServerConfig(req, reply, parseInt(req.params.id, 10))
    if (!result) return

    const { player_id, player_name } = req.body
    if (!player_id) return reply.code(400).send({ error: "player_id is required" })

    try {
      const response = await removeFromSquad(result.config, player_id)
      await auditRcon(result.guildId, req.session.userId!, "rcon_remove_from_squad", {
        server: result.server.name, playerId: player_id, playerName: player_name,
      })
      return reply.send({ ok: true, response })
    } catch (err) {
      return reply.code(500).send({ ok: false, error: (err as Error).message })
    }
  })

  // ── POST /game-servers/:id/rcon/disband-squad ──────────────────────────────

  app.post<{
    Params: { id: string }
    Body: { team_id: string; squad_id: string; squad_name?: string }
  }>("/game-servers/:id/rcon/disband-squad", { preHandler: requireRconExecute }, async (req, reply) => {
    const result = await getServerConfig(req, reply, parseInt(req.params.id, 10))
    if (!result) return

    const { team_id, squad_id, squad_name } = req.body
    if (!team_id || !squad_id) return reply.code(400).send({ error: "team_id and squad_id are required" })

    try {
      const response = await disbandSquad(result.config, team_id, squad_id)
      await auditRcon(result.guildId, req.session.userId!, "rcon_disband_squad", {
        server: result.server.name, teamId: team_id, squadId: squad_id, squadName: squad_name,
      })
      return reply.send({ ok: true, response })
    } catch (err) {
      return reply.code(500).send({ ok: false, error: (err as Error).message })
    }
  })

  // ── POST /game-servers/:id/rcon/demote-commander ──────────────────────────

  app.post<{
    Params: { id: string }
    Body: { team_id: string }
  }>("/game-servers/:id/rcon/demote-commander", { preHandler: requireRconExecute }, async (req, reply) => {
    const result = await getServerConfig(req, reply, parseInt(req.params.id, 10))
    if (!result) return

    const { team_id } = req.body
    if (!team_id) return reply.code(400).send({ error: "team_id is required" })

    try {
      const response = await demoteCommander(result.config, team_id)
      await auditRcon(result.guildId, req.session.userId!, "rcon_demote_commander", {
        server: result.server.name, teamId: team_id,
      })
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
