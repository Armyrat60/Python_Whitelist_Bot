/**
 * Whitelist file serving — GET /wl/:token/:filename
 *
 * Token is an HMAC-SHA256 of guild_id + secret, truncated to 16 chars.
 * On cache miss the file is regenerated on-demand from the DB.
 *
 * Port of WebServer._handle_file() from bot/web.py.
 */
import type { FastifyPluginAsync } from "fastify"
import { cache } from "../services/cache.js"
import { syncOutputs } from "../services/output.js"
import { getFileToken, verifyToken } from "../services/token.js"

export const fileRoutes: FastifyPluginAsync = async (app) => {
  app.get<{
    Params: { token: string; filename: string }
  }>("/wl/:token/:filename", {
    config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
  }, async (req, reply) => {
    const { token, filename } = req.params

    // ── Resolve guild from token ───────────────────────────────────────────
    let guildId = cache.lookupToken(token)

    if (guildId === null) {
      // Token not in memory — scan all known guilds (self-heals after restart).
      for (const guild of req.server.discord.getGuilds()) {
        const salt = await app.prisma.botSetting.findUnique({
          where: { guildId_settingKey: { guildId: guild.id, settingKey: "url_salt" } },
          select: { settingValue: true },
        })
        const candidate = getFileToken(guild.id, salt?.settingValue ?? null)
        if (verifyToken(token, candidate)) {
          guildId = guild.id
          cache.registerToken(token, guildId)
          break
        }
      }
    }

    if (guildId === null) {
      return reply.code(404).type("text/plain").send("Not found")
    }

    // ── Verify token is still valid (guard against stale mapping) ─────────
    const salt = await app.prisma.botSetting.findUnique({
      where: { guildId_settingKey: { guildId, settingKey: "url_salt" } },
      select: { settingValue: true },
    })
    const expected = getFileToken(guildId, salt?.settingValue ?? null)
    if (!verifyToken(token, expected)) {
      return reply.code(404).type("text/plain").send("Not found")
    }

    // ── Serve from cache, regenerating on miss ────────────────────────────
    if (!cache.hasFile(guildId, filename)) {
      try {
        const outputs = await syncOutputs(app.prisma, guildId)
        cache.set(guildId, outputs)
        cache.registerToken(token, guildId)
      } catch (err) {
        app.log.error({ err, guildId, filename }, "Failed to regenerate whitelist cache")
        return reply.code(404).type("text/plain").send("Not found")
      }
    }

    const content = cache.get(guildId, filename)
    if (content === null) {
      return reply.code(404).type("text/plain").send("Not found")
    }

    return reply
      .code(200)
      .type("text/plain; charset=utf-8")
      .header("Cache-Control", "no-store, no-cache, must-revalidate")
      .header("Pragma", "no-cache")
      .send(content)
  })
}
