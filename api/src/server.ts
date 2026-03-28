import Fastify from "fastify"
import cors from "@fastify/cors"

import { env } from "./lib/env.js"
import prismaPlugin from "./plugins/prisma.js"
import authPlugin from "./plugins/auth.js"
import { fileRoutes } from "./routes/files.js"
import { internalRoutes } from "./routes/internal.js"
import { cache } from "./services/cache.js"
import { DiscordRESTClient } from "./lib/discord.js"
import { syncOutputs } from "./services/output.js"

async function build() {
  const app = Fastify({
    logger: {
      level: env.NODE_ENV === "production" ? "info" : "debug",
      transport: env.NODE_ENV !== "production"
        ? { target: "pino-pretty", options: { translateTime: "HH:MM:ss", ignore: "pid,hostname" } }
        : undefined,
    },
  })

  // ─── Plugins ────────────────────────────────────────────────────────────────

  await app.register(cors, {
    origin: env.CORS_ORIGIN || env.WEB_BASE_URL || false,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  })

  await app.register(prismaPlugin)
  await app.register(authPlugin)

  // ─── Discord REST client (shared across routes) ──────────────────────────────

  const discord = new DiscordRESTClient(env.DISCORD_TOKEN)
  app.decorate("discord", discord)

  // ─── Routes ─────────────────────────────────────────────────────────────────

  await app.register(fileRoutes)
  await app.register(internalRoutes, { prefix: "/internal" })

  // Health check
  app.get("/healthz", async () => ({
    status: "ok",
    guilds: discord.guildCount(),
    files: cache.fileCount(),
  }))

  return app
}

async function start() {
  const app = await build()

  // ─── Prime Discord guild list ────────────────────────────────────────────────

  const discord = app.discord
  await discord.fetchGuilds()
  app.log.info(`Discord REST client ready — ${discord.guildCount()} guild(s)`)

  // ─── Prime file cache for all guilds ────────────────────────────────────────

  for (const guild of discord.getGuilds()) {
    try {
      const outputs = await syncOutputs(app.prisma, guild.id)
      cache.set(guild.id, outputs)
      app.log.info(`Primed cache for guild ${guild.name} (${guild.id})`)
    } catch (err) {
      app.log.error({ err, guildId: guild.id }, "Failed to prime cache at startup")
    }
  }

  // ─── Heartbeat: refresh cache every 5 minutes ───────────────────────────────

  const HEARTBEAT_MS = 5 * 60 * 1000
  setInterval(async () => {
    for (const guild of discord.getGuilds()) {
      try {
        const outputs = await syncOutputs(app.prisma, guild.id)
        cache.set(guild.id, outputs)
      } catch (err) {
        app.log.debug({ err, guildId: guild.id }, "Heartbeat cache refresh failed")
      }
    }
  }, HEARTBEAT_MS).unref()

  // ─── Start listening ─────────────────────────────────────────────────────────

  await app.listen({ port: env.PORT, host: env.HOST })
}

// ─── Type augmentation for discord on FastifyInstance ────────────────────────

declare module "fastify" {
  interface FastifyInstance {
    discord: DiscordRESTClient
  }
}

start().catch((err) => {
  console.error(err)
  process.exit(1)
})
