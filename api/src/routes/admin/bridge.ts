/**
 * SquadJS Bridge configuration routes.
 *
 * GET    /bridge-config         — get this guild's bridge config (password masked)
 * PUT    /bridge-config         — create or update bridge config
 * DELETE /bridge-config         — remove bridge config
 * POST   /bridge-config/test    — test MySQL connection with provided credentials
 */
import type { FastifyInstance } from "fastify"
import mysql from "mysql2/promise"

export default async function bridgeRoutes(app: FastifyInstance) {
  const adminHook = [app.requireAdmin]

  // ── GET /bridge-config ───────────────────────────────────────────────────

  app.get("/bridge-config", { preHandler: adminHook }, async (req, reply) => {
    const guildId = BigInt(req.session.activeGuildId!)

    const config = await app.prisma.bridgeConfig.findUnique({ where: { guildId } })

    if (!config) return reply.send({ config: null })

    return reply.send({
      config: {
        id:                   config.id,
        mysql_host:           config.mysqlHost,
        mysql_port:           config.mysqlPort,
        mysql_database:       config.mysqlDatabase,
        mysql_user:           config.mysqlUser,
        mysql_password:       "••••••••",          // never expose the real password
        server_name:          config.serverName,
        sync_interval_minutes: config.syncIntervalMinutes,
        enabled:              config.enabled,
        last_sync_at:         config.lastSyncAt?.toISOString() ?? null,
        last_sync_status:     config.lastSyncStatus,
        last_sync_message:    config.lastSyncMessage,
        created_at:           config.createdAt.toISOString(),
        updated_at:           config.updatedAt.toISOString(),
      },
    })
  })

  // ── PUT /bridge-config ───────────────────────────────────────────────────

  app.put<{
    Body: {
      mysql_host?: string
      mysql_port?: number
      mysql_database?: string
      mysql_user?: string
      mysql_password?: string
      server_name?: string
      sync_interval_minutes?: number
      enabled?: boolean
    }
  }>("/bridge-config", { preHandler: adminHook }, async (req, reply) => {
    const guildId = BigInt(req.session.activeGuildId!)
    const body = req.body ?? {}

    const existing = await app.prisma.bridgeConfig.findUnique({ where: { guildId } })

    // If the client sent the masked placeholder, keep the stored password
    const password =
      body.mysql_password && body.mysql_password !== "••••••••"
        ? body.mysql_password
        : existing?.mysqlPassword

    if (!password && !existing) {
      return reply.code(400).send({ error: "mysql_password is required when creating a new config" })
    }

    const host     = body.mysql_host     ?? existing?.mysqlHost
    const database = body.mysql_database ?? existing?.mysqlDatabase
    const user     = body.mysql_user     ?? existing?.mysqlUser

    if (!host || !database || !user) {
      return reply.code(400).send({ error: "mysql_host, mysql_database, and mysql_user are required" })
    }

    const config = await app.prisma.bridgeConfig.upsert({
      where: { guildId },
      create: {
        guildId,
        mysqlHost:           host,
        mysqlPort:           body.mysql_port           ?? 3306,
        mysqlDatabase:       database,
        mysqlUser:           user,
        mysqlPassword:       password!,
        serverName:          body.server_name          ?? "Game Server",
        syncIntervalMinutes: body.sync_interval_minutes ?? 15,
        enabled:             body.enabled              ?? true,
      },
      update: {
        mysqlHost:           host,
        mysqlPort:           body.mysql_port           ?? existing?.mysqlPort ?? 3306,
        mysqlDatabase:       database,
        mysqlUser:           user,
        mysqlPassword:       password!,
        serverName:          body.server_name          ?? existing?.serverName ?? "Game Server",
        syncIntervalMinutes: body.sync_interval_minutes ?? existing?.syncIntervalMinutes ?? 15,
        enabled:             body.enabled              ?? existing?.enabled ?? true,
      },
    })

    return reply.send({
      ok: true,
      config: {
        id:                   config.id,
        mysql_host:           config.mysqlHost,
        mysql_port:           config.mysqlPort,
        mysql_database:       config.mysqlDatabase,
        mysql_user:           config.mysqlUser,
        mysql_password:       "••••••••",
        server_name:          config.serverName,
        sync_interval_minutes: config.syncIntervalMinutes,
        enabled:              config.enabled,
        last_sync_at:         config.lastSyncAt?.toISOString() ?? null,
        last_sync_status:     config.lastSyncStatus,
        last_sync_message:    config.lastSyncMessage,
      },
    })
  })

  // ── POST /bridge-config/sync-now ────────────────────────────────────────
  // Enqueue an immediate bridge_sync job for this guild.

  app.post("/bridge-config/sync-now", { preHandler: adminHook }, async (req, reply) => {
    const guildId = BigInt(req.session.activeGuildId!)

    const existing = await app.prisma.bridgeConfig.findUnique({ where: { guildId } })
    if (!existing) return reply.code(404).send({ error: "No bridge config saved" })
    if (!existing.enabled) return reply.code(400).send({ error: "Bridge is disabled — enable it first" })

    const job = await app.prisma.jobQueue.create({
      data: {
        guildId,
        jobType:  "bridge_sync",
        payload:  {},
        status:   "pending",
        priority: 10,   // higher priority than cron-triggered syncs (which use 0)
      },
    })

    return reply.send({ ok: true, job_id: job.id })
  })

  // ── DELETE /bridge-config ────────────────────────────────────────────────

  app.delete("/bridge-config", { preHandler: adminHook }, async (req, reply) => {
    const guildId = BigInt(req.session.activeGuildId!)

    const existing = await app.prisma.bridgeConfig.findUnique({ where: { guildId } })
    if (!existing) return reply.code(404).send({ error: "No bridge config found" })

    await app.prisma.bridgeConfig.delete({ where: { guildId } })
    return reply.send({ ok: true })
  })

  // ── POST /bridge-config/test ─────────────────────────────────────────────
  // Attempt a real MySQL connection to validate the credentials.
  // Accepts either explicit credentials in the body OR tests the stored config.

  app.post<{
    Body: {
      mysql_host?: string
      mysql_port?: number
      mysql_database?: string
      mysql_user?: string
      mysql_password?: string
    }
  }>("/bridge-config/test", { preHandler: adminHook }, async (req, reply) => {
    const guildId = BigInt(req.session.activeGuildId!)
    const body = req.body ?? {}

    // If no explicit credentials provided, fall back to stored config
    let host     = body.mysql_host
    let port     = body.mysql_port
    let database = body.mysql_database
    let user     = body.mysql_user
    let password = body.mysql_password && body.mysql_password !== "••••••••"
      ? body.mysql_password
      : undefined

    if (!host || !database || !user || !password) {
      const stored = await app.prisma.bridgeConfig.findUnique({ where: { guildId } })
      if (!stored) return reply.code(400).send({ error: "No bridge config saved — provide credentials or save a config first" })
      host     = host     ?? stored.mysqlHost
      port     = port     ?? stored.mysqlPort
      database = database ?? stored.mysqlDatabase
      user     = user     ?? stored.mysqlUser
      password = password ?? stored.mysqlPassword
    }

    let conn: mysql.Connection | null = null
    try {
      conn = await mysql.createConnection({
        host,
        port:     port ?? 3306,
        database,
        user,
        password,
        connectTimeout: 8_000,
      })

      // Verify DBLog_Players exists and is readable
      const [rows] = await conn.execute<mysql.RowDataPacket[]>(
        "SELECT COUNT(*) AS cnt FROM DBLog_Players LIMIT 1"
      )
      const count = rows[0]?.cnt ?? 0

      return reply.send({
        ok: true,
        message: `Connected successfully. DBLog_Players has ${count} player record(s).`,
        player_count: Number(count),
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return reply.send({ ok: false, message: `Connection failed: ${msg}` })
    } finally {
      if (conn) await conn.end().catch(() => {})
    }
  })
}
