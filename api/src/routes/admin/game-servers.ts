/**
 * Game server management + SFTP operations.
 *
 * Prefix: /api/admin
 *
 * CRUD:
 *   GET    /game-servers           — list guild's game servers
 *   POST   /game-servers           — add server
 *   PUT    /game-servers/:id       — update server
 *   DELETE /game-servers/:id       — remove server
 *
 * SFTP operations:
 *   POST   /game-servers/:id/sftp/test          — test connection
 *   GET    /game-servers/:id/sftp/files          — list remote files
 *   GET    /game-servers/:id/sftp/files/:filename — read remote file
 *   POST   /game-servers/:id/sftp/push-whitelist — push whitelist output
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify"
import { testConnection, listFiles, readFile, writeFile, toSftpConfig } from "../../lib/sftp.js"
import { syncOutputs } from "../../services/output.js"

const MASKED = "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022"

const adminHook = async (req: FastifyRequest, reply: FastifyReply) => {
  if (!req.session.userId) return reply.code(401).send({ error: "Not authenticated" })
  if (!req.session.activeGuildId) return reply.code(400).send({ error: "No guild selected" })
  const guild = req.session.guilds?.find(g => g.id === req.session.activeGuildId)
  if (!guild?.isAdmin) {
    // Check granular sftp_read or sftp_write
    const perms = (guild as Record<string, unknown>)?.granularPermissions as Record<string, boolean> | undefined
    if (!perms?.sftp_read && !perms?.sftp_write) {
      return reply.code(403).send({ error: "Admin or SFTP permission required" })
    }
  }
}

const requireSftpWrite = async (req: FastifyRequest, reply: FastifyReply) => {
  if (!req.session.userId) return reply.code(401).send({ error: "Not authenticated" })
  if (!req.session.activeGuildId) return reply.code(400).send({ error: "No guild selected" })
  const guild = req.session.guilds?.find(g => g.id === req.session.activeGuildId)
  if (guild?.isAdmin) return
  const perms = (guild as Record<string, unknown>)?.granularPermissions as Record<string, boolean> | undefined
  if (!perms?.sftp_write) return reply.code(403).send({ error: "Missing permission: sftp_write" })
}

function maskServer(s: {
  id: number; name: string; sftpHost: string | null; sftpPort: number;
  sftpUser: string | null; sftpPassword: string | null; sftpBasePath: string;
  rconHost: string | null; rconPort: number; rconPassword: string | null;
  enabled: boolean; createdAt: Date; updatedAt: Date;
}) {
  return {
    id: s.id,
    name: s.name,
    sftp_host: s.sftpHost,
    sftp_port: s.sftpPort,
    sftp_user: s.sftpUser,
    sftp_password: s.sftpPassword ? MASKED : null,
    sftp_base_path: s.sftpBasePath,
    rcon_host: s.rconHost,
    rcon_port: s.rconPort,
    rcon_password: s.rconPassword ? MASKED : null,
    enabled: s.enabled,
    created_at: s.createdAt.toISOString(),
  }
}

export default async function gameServerRoutes(app: FastifyInstance) {
  const { prisma } = app

  // ── GET /game-servers ─────────────────────────────────────────────────────

  app.get("/game-servers", { preHandler: adminHook }, async (req, reply) => {
    const guildId = BigInt(req.session.activeGuildId!)
    const servers = await prisma.gameServer.findMany({
      where: { guildId },
      orderBy: { name: "asc" },
    })
    return reply.send({ servers: servers.map(maskServer) })
  })

  // ── POST /game-servers ────────────────────────────────────────────────────

  app.post<{
    Body: { name: string; sftp_host?: string; sftp_port?: number; sftp_user?: string; sftp_password?: string; sftp_base_path?: string; rcon_host?: string; rcon_port?: number; rcon_password?: string }
  }>("/game-servers", { preHandler: requireSftpWrite }, async (req, reply) => {
    const guildId = BigInt(req.session.activeGuildId!)
    const { name, sftp_host, sftp_port, sftp_user, sftp_password, sftp_base_path, rcon_host, rcon_port, rcon_password } = req.body

    if (!name?.trim()) return reply.code(400).send({ error: "Server name is required" })

    // Max 10 servers per guild
    const count = await prisma.gameServer.count({ where: { guildId } })
    if (count >= 10) return reply.code(400).send({ error: "Maximum 10 servers per guild" })

    const server = await prisma.gameServer.create({
      data: {
        guildId,
        name: name.trim(),
        sftpHost: sftp_host?.trim() ?? null,
        sftpPort: sftp_port ?? 22,
        sftpUser: sftp_user?.trim() ?? null,
        sftpPassword: sftp_password ?? null,
        sftpBasePath: sftp_base_path?.trim() || "/SquadGame/ServerConfig",
        rconHost: rcon_host?.trim() ?? null,
        rconPort: rcon_port ?? 21114,
        rconPassword: rcon_password ?? null,
      },
    })

    return reply.code(201).send({ server: maskServer(server) })
  })

  // ── PUT /game-servers/:id ─────────────────────────────────────────────────

  app.put<{
    Params: { id: string }
    Body: { name?: string; sftp_host?: string; sftp_port?: number; sftp_user?: string; sftp_password?: string; sftp_base_path?: string; rcon_host?: string; rcon_port?: number; rcon_password?: string; enabled?: boolean }
  }>("/game-servers/:id", { preHandler: requireSftpWrite }, async (req, reply) => {
    const guildId = BigInt(req.session.activeGuildId!)
    const id = parseInt(req.params.id, 10)
    const { name, sftp_host, sftp_port, sftp_user, sftp_password, sftp_base_path, rcon_host, rcon_port, rcon_password, enabled } = req.body

    const existing = await prisma.gameServer.findFirst({ where: { id, guildId } })
    if (!existing) return reply.code(404).send({ error: "Server not found" })

    const effectiveSftpPass = sftp_password === MASKED ? existing.sftpPassword : sftp_password
    const effectiveRconPass = rcon_password === MASKED ? existing.rconPassword : rcon_password

    const server = await prisma.gameServer.update({
      where: { id },
      data: {
        name:         name?.trim() ?? undefined,
        sftpHost:     sftp_host !== undefined ? sftp_host?.trim() ?? null : undefined,
        sftpPort:     sftp_port ?? undefined,
        sftpUser:     sftp_user !== undefined ? sftp_user?.trim() ?? null : undefined,
        sftpPassword: effectiveSftpPass !== undefined ? effectiveSftpPass : undefined,
        sftpBasePath: sftp_base_path?.trim() ?? undefined,
        rconHost:     rcon_host !== undefined ? rcon_host?.trim() ?? null : undefined,
        rconPort:     rcon_port ?? undefined,
        rconPassword: effectiveRconPass !== undefined ? effectiveRconPass : undefined,
        enabled:      enabled ?? undefined,
      },
    })

    return reply.send({ server: maskServer(server) })
  })

  // ── DELETE /game-servers/:id ──────────────────────────────────────────────

  app.delete<{ Params: { id: string } }>("/game-servers/:id", { preHandler: requireSftpWrite }, async (req, reply) => {
    const guildId = BigInt(req.session.activeGuildId!)
    const id = parseInt(req.params.id, 10)

    const existing = await prisma.gameServer.findFirst({ where: { id, guildId } })
    if (!existing) return reply.code(404).send({ error: "Server not found" })

    await prisma.gameServer.delete({ where: { id } })
    return reply.send({ ok: true })
  })

  // ── POST /game-servers/:id/sftp/test ──────────────────────────────────────

  app.post<{ Params: { id: string } }>("/game-servers/:id/sftp/test", { preHandler: adminHook }, async (req, reply) => {
    const guildId = BigInt(req.session.activeGuildId!)
    const id = parseInt(req.params.id, 10)

    const server = await prisma.gameServer.findFirst({ where: { id, guildId } })
    if (!server) return reply.code(404).send({ error: "Server not found" })

    const config = toSftpConfig(server)
    if (!config) return reply.send({ ok: false, message: "SFTP credentials incomplete — fill in host, username, and password" })

    const result = await testConnection(config)
    return reply.send(result)
  })

  // ── GET /game-servers/:id/sftp/files ──────────────────────────────────────

  app.get<{
    Params: { id: string }
    Querystring: { subdir?: string }
  }>("/game-servers/:id/sftp/files", { preHandler: adminHook }, async (req, reply) => {
    const guildId = BigInt(req.session.activeGuildId!)
    const id = parseInt(req.params.id, 10)

    const server = await prisma.gameServer.findFirst({ where: { id, guildId } })
    if (!server) return reply.code(404).send({ error: "Server not found" })

    const config = toSftpConfig(server)
    if (!config) return reply.send({ error: "SFTP not configured" })

    try {
      const files = await listFiles(config, req.query.subdir)
      return reply.send({ files })
    } catch (err) {
      return reply.code(500).send({ error: `SFTP error: ${(err as Error).message}` })
    }
  })

  // ── GET /game-servers/:id/sftp/files/:filename ────────────────────────────

  app.get<{
    Params: { id: string; filename: string }
  }>("/game-servers/:id/sftp/files/:filename", { preHandler: adminHook }, async (req, reply) => {
    const guildId = BigInt(req.session.activeGuildId!)
    const id = parseInt(req.params.id, 10)

    const server = await prisma.gameServer.findFirst({ where: { id, guildId } })
    if (!server) return reply.code(404).send({ error: "Server not found" })

    const config = toSftpConfig(server)
    if (!config) return reply.send({ error: "SFTP not configured" })

    try {
      const content = await readFile(config, req.params.filename)
      return reply.send({ filename: req.params.filename, content })
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message })
    }
  })

  // ── POST /game-servers/:id/sftp/push-whitelist ────────────────────────────

  app.post<{
    Params: { id: string }
    Body: { filename?: string }
  }>("/game-servers/:id/sftp/push-whitelist", { preHandler: requireSftpWrite }, async (req, reply) => {
    const guildId = BigInt(req.session.activeGuildId!)
    const id = parseInt(req.params.id, 10)

    const server = await prisma.gameServer.findFirst({ where: { id, guildId } })
    if (!server) return reply.code(404).send({ error: "Server not found" })

    const config = toSftpConfig(server)
    if (!config) return reply.send({ ok: false, error: "SFTP not configured" })

    try {
      // Generate all whitelist outputs for this guild
      const outputs = await syncOutputs(prisma, guildId)
      const filenames = Object.keys(outputs)

      if (filenames.length === 0) {
        return reply.send({ ok: false, error: "No whitelist output files to push" })
      }

      // Push all whitelist files
      const results: Array<{ filename: string; ok: boolean; error?: string }> = []
      for (const [filename, content] of Object.entries(outputs)) {
        try {
          await writeFile(config, filename, content)
          results.push({ filename, ok: true })
        } catch (err) {
          results.push({ filename, ok: false, error: (err as Error).message })
        }
      }

      const allOk = results.every((r) => r.ok)
      return reply.send({
        ok: allOk,
        message: allOk
          ? `Pushed ${results.length} file(s) to ${server.name}`
          : `Some files failed to push`,
        results,
      })
    } catch (err) {
      app.log.error({ err, guildId, serverId: id }, "SFTP push-whitelist failed")
      return reply.code(500).send({ ok: false, error: `SFTP error: ${(err as Error).message}` })
    }
  })
}
