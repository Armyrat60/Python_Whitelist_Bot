import Fastify from "fastify"
import cors from "@fastify/cors"
import rateLimit from "@fastify/rate-limit"

import { env } from "./lib/env.js"
import prismaPlugin from "./plugins/prisma.js"
import authPlugin, { ensureSessionsTable } from "./plugins/auth.js"
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
import panelRoleRoutes from "./routes/admin/panel-roles.js"
import categoryRoutes from "./routes/admin/categories.js"
import userRoutes from "./routes/admin/users.js"
import playerRoutes from "./routes/admin/players.js"
import auditRoutes from "./routes/admin/audit.js"
import notificationRoutes from "./routes/admin/notifications.js"
import permissionsRoutes from "./routes/admin/permissions.js"
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

  // Global rate limiting — 200 req/min per IP, stricter on auth routes
  await app.register(rateLimit, {
    global: true,
    max: 200,
    timeWindow: "1 minute",
    skipOnError: true,
    keyGenerator: (req: { ip: string }) => req.ip,
    errorResponseBuilder: () => ({
      error: "Too many requests",
      message: "Rate limit exceeded. Try again in a minute.",
      statusCode: 429,
    }),
  })

  await app.register(prismaPlugin)

  // ─── Discord REST client (shared across routes) ──────────────────────────────

  const discord = new DiscordRESTClient(env.DISCORD_TOKEN)
  app.decorate("discord", discord)

  // ─── Routes outside session scope (zero DB dependency — healthcheck safe) ────
  //
  // authPlugin is NOT wrapped with fp(), so its session middleware only applies
  // within the child scope below. These three registrations are in the root scope
  // and will NEVER trigger a session store DB query, making /healthz reliable
  // regardless of database availability during blue-green deploys.

  app.get("/healthz", async () => ({
    status: "ok",
    guilds: discord.guildCount(),
    files: cache.fileCount(),
  }))

  await app.register(fileRoutes)
  await app.register(internalRoutes, { prefix: "/internal" })

  // ─── Routes inside session scope ────────────────────────────────────────────
  //
  // authPlugin registers @fastify/cookie + @fastify/session + requireAuth decorators.
  // Because it is NOT wrapped with fp(), those hooks are scoped here only.

  await app.register(async (api) => {
    await api.register(authPlugin)

    await api.register(authRoutes)   // login/callback/logout
    await api.register(guildRoutes, { prefix: "/api" })
    await api.register(adminSettingsRoutes, { prefix: "/api/admin" })
    await api.register(whitelistRoutes, { prefix: "/api/admin" })
    await api.register(groupRoutes, { prefix: "/api/admin" })
    await api.register(panelRoutes, { prefix: "/api/admin" })
    await api.register(panelRoleRoutes, { prefix: "/api/admin" })
    await api.register(categoryRoutes, { prefix: "/api/admin" })
    await api.register(userRoutes, { prefix: "/api/admin" })
    await api.register(playerRoutes, { prefix: "/api/admin" })
    await api.register(auditRoutes, { prefix: "/api/admin" })
    await api.register(notificationRoutes, { prefix: "/api/admin" })
    await api.register(permissionsRoutes, { prefix: "/api/admin" })
    await api.register(importExportRoutes, { prefix: "/api/admin" })
    await api.register(roleSyncRoutes, { prefix: "/api/admin" })
    await api.register(reconcileRoutes, { prefix: "/api/admin" })
    await api.register(myWhitelistRoutes, { prefix: "/api" })
    await api.register(steamRoutes, { prefix: "/api" })
  })

  return app
}

async function start() {
  const app = await build()

  // ─── Start listening immediately so healthcheck passes ───────────────────────

  await app.listen({ port: env.PORT, host: env.HOST })

  // ─── Ensure sessions table exists (non-blocking, never crashes startup) ───────

  ensureSessionsTable(app.prisma).catch(() => {})

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
