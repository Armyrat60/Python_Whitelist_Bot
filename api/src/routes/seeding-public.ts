/**
 * Public seeding leaderboard route.
 *
 * GET /seeding/public-leaderboard — returns leaderboard if enabled for the guild.
 * Requires login but NOT admin permissions.
 */
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify"

async function requireAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!req.session.userId) {
    return reply.code(401).send({ error: "Not authenticated" })
  }
  if (!req.session.activeGuildId) {
    return reply.code(400).send({ error: "No guild selected" })
  }
}

const seedingPublicRoutes: FastifyPluginAsync = async (app) => {
  app.get("/seeding/public-leaderboard", { preHandler: requireAuth }, async (req, reply) => {
    const guildId = BigInt(req.session.activeGuildId!)

    const config = await app.prisma.seedingConfig.findUnique({ where: { guildId } })

    if (!config || !config.leaderboardPublic) {
      return reply.send({ enabled: false, points_required: 0, players: [] })
    }

    const pointsRequired = config.pointsRequired

    const players = await app.prisma.seedingPoints.findMany({
      where: { guildId, OR: [{ points: { gt: 0 } }, { rewarded: true }] },
      orderBy: [{ rewarded: "desc" }, { points: "desc" }],
      take: 50,
    })

    return reply.send({
      enabled: true,
      points_required: pointsRequired,
      players: players.map((p) => ({
        player_name: p.playerName,
        points: p.points,
        progress_pct: Math.min(100, Math.round((p.points / pointsRequired) * 100)),
        rewarded: p.rewarded,
      })),
    })
  })
}

export default seedingPublicRoutes
