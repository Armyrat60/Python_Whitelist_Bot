import Fastify from "fastify"
import cors from "@fastify/cors"

import { env } from "./lib/env.js"
import prismaPlugin from "./plugins/prisma.js"
import authPlugin from "./plugins/auth.js"
import { fileRoutes } from "./routes/files.js"
import { internalRoutes } from "./routes/internal.js"
import { authRoutes } from "./routes/auth.js"
import { guildRoutes } from "./routes/guilds.js"
import { userRoutes as myWhitelistRoutes } from "./routes/user.js"
import { steamRoutes } from "./routes/steam.js"
import importExportRoutes from "./routes/admin/importexport.js"
import roleSyncRoutes from "./routes/admin/rolesync.js"
import reconcileRoutes from "./routes/admin/reconcile.js"
import { adminSettingsRoutes } from "./routes/admin/settings.js"
import whitelistRoutes from "./routes/admin/whitelists.js"
import groupRoutes from "./routes/admin/groups.js"
import panelRoutes from "./routes/admin/panels.js"
import whitelistRoleRoutes from "./routes/admin/whitelist-roles.js"
import userRoutes from "./routes/admin/users.js"
import auditRoutes from "./routes/admin/audit.js"
import notificationRoutes from "./routes/admin/notifications.js"
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
  await app.register(authRoutes)   // login/callback/logout are top-level paths
  await app.register(guildRoutes, { prefix: "/api" })
  await app.register(adminSettingsRoutes, { prefix: "/api/admin" })
  await app.register(whitelistRoutes, { prefix: "/api/admin" })
  await app.register(groupRoutes, { prefix: "/api/admin" })
  await app.register(panelRoutes, { prefix: "/api/admin" })
  await app.register(whitelistRoleRoutes, { prefix: "/api/admin" })
  await app.register(userRoutes, { prefix: "/api/admin" })
  await app.register(auditRoutes, { prefix: "/api/admin" })
  await app.register(notificationRoutes, { prefix: "/api/admin" })
  await app.register(importExportRoutes, { prefix: "/api/admin" })
  await app.register(roleSyncRoutes, { prefix: "/api/admin" })
  await app.register(reconcileRoutes, { prefix: "/api/admin" })
  await app.register(myWhitelistRoutes, { prefix: "/api" })
  await app.register(steamRoutes, { prefix: "/api" })

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

  // ─── Start listening immediately so healthcheck passes ───────────────────────

  await app.listen({ port: env.PORT, host: env.HOST })

  // ─── Prime Discord guild list (background — must not block listen) ────────────

  const discord = app.discord

  const HEARTBEAT_MS = 5 * 60 * 1000

  async function refreshAll() {
    try {
      await discord.fetchGuilds()
      app.log.info(`Discord REST client ready — ${discord.guildCount()} guild(s)`)
    } catch (err) {
      app.log.error({ err }, "Failed to fetch Discord guilds")
    }
    for (const guild of discord.getGuilds()) {
      try {
        const outputs = await syncOutputs(app.prisma, guild.id)
        cache.set(guild.id, outputs)
        app.log.info(`Primed cache for guild ${guild.name} (${guild.id})`)
      } catch (err) {
        app.log.error({ err, guildId: guild.id }, "Failed to prime cache at startup")
      }
    }
  }

  // Run immediately in background, then on heartbeat
  refreshAll().catch(() => {})

  setInterval(() => {
    refreshAll().catch(() => {})
  }, HEARTBEAT_MS).unref()
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
