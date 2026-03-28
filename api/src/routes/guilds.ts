/**
 * Guild selection and theme routes.
 *
 * GET  /api/guilds         — list guilds from session
 * POST /api/guilds/switch  — change active guild
 * GET  /api/guild/theme    — fetch accent colours for active guild
 */
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify"

// ─── Shared preHandlers ────────────────────────────────────────────────────────

async function requireLogin(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!req.session.userId) {
    return reply.code(401).send({ error: "Not authenticated" })
  }
}

async function requireLoginAndGuild(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!req.session.userId) {
    return reply.code(401).send({ error: "Not authenticated" })
  }
  if (!req.session.activeGuildId) {
    return reply.code(400).send({ error: "No guild selected" })
  }
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

export const guildRoutes: FastifyPluginAsync = async (app) => {
  // ── GET /api/guilds ─────────────────────────────────────────────────────────

  app.get("/guilds", { preHandler: requireLogin }, async (req, reply) => {
    return reply.send({
      guilds:          req.session.guilds ?? [],
      active_guild_id: req.session.activeGuildId ?? null,
    })
  })

  // ── POST /api/guilds/switch ─────────────────────────────────────────────────

  app.post<{ Body: { guild_id: string } }>(
    "/guilds/switch",
    { preHandler: requireLogin },
    async (req, reply) => {
      const { guild_id } = req.body

      const match = req.session.guilds?.find((g) => g.id === guild_id)
      if (!match) {
        return reply.code(403).send({ error: "Guild not in session" })
      }

      req.session.activeGuildId = guild_id
      return reply.send({ ok: true, active_guild_id: guild_id })
    },
  )

  // ── GET /api/guild/theme ────────────────────────────────────────────────────

  app.get("/guild/theme", { preHandler: requireLoginAndGuild }, async (req, reply) => {
    const guildId = BigInt(req.session.activeGuildId!)

    const [primaryRow, secondaryRow] = await Promise.all([
      app.prisma.botSetting.findUnique({
        where: { guildId_settingKey: { guildId, settingKey: "accent_primary" } },
      }),
      app.prisma.botSetting.findUnique({
        where: { guildId_settingKey: { guildId, settingKey: "accent_secondary" } },
      }),
    ])

    return reply.send({
      accent_primary:   primaryRow?.settingValue   ?? null,
      accent_secondary: secondaryRow?.settingValue ?? null,
    })
  })
}
