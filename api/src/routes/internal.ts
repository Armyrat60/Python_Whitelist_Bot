/**
 * Internal routes — used by the Python bot worker to push cache updates.
 * Only reachable within the Railway private network (not exposed publicly).
 *
 * POST /internal/sync/:guildId  — regenerate and cache outputs for a guild
 *
 * Port of the /internal/sync/{guild_id} handler in bot/web_routes/api.py.
 */
import type { FastifyPluginAsync } from "fastify"
import { env } from "../lib/env.js"
import { cache } from "../services/cache.js"
import { syncOutputs } from "../services/output.js"
import { getFileToken } from "../services/token.js"

export const internalRoutes: FastifyPluginAsync = async (app) => {
  // All internal routes require the shared WEB_FILE_SECRET bearer token.
  app.addHook("onRequest", async (req, reply) => {
    const auth = req.headers["authorization"] ?? ""
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : ""
    if (!token || token !== env.WEB_FILE_SECRET) {
      reply.code(401).send({ error: "Unauthorized" })
    }
  })

  app.post<{ Params: { guildId: string } }>(
    "/sync/:guildId",
    async (req, reply) => {
      const guildId = BigInt(req.params.guildId)
      try {
        const outputs = await syncOutputs(app.prisma, guildId)
        await cache.set(guildId, outputs)

        const salt = await app.prisma.botSetting.findUnique({
          where: { guildId_settingKey: { guildId, settingKey: "url_salt" } },
          select: { settingValue: true },
        })
        const token = getFileToken(guildId, salt?.settingValue ?? null)
        cache.registerToken(token, guildId)

        return reply.send({ ok: true, files: Object.keys(outputs).length })
      } catch (err) {
        app.log.error({ err, guildId }, "Internal sync failed")
        return reply.code(500).send({ error: "Sync failed" })
      }
    },
  )
}
