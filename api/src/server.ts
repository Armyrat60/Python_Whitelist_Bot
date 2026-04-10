import Fastify from "fastify"
import cors from "@fastify/cors"
import rateLimit from "@fastify/rate-limit"

import { env } from "./lib/env.js"

// ─── Sentry ──────────────────────────────────────────────────────────────────
// Optional: only active if SENTRY_DSN is set AND @sentry/node is installed.
// @sentry/node v10 conflicts with prisma generate in Docker builds (WASM engine
// file issue), so it's NOT in package.json dependencies. Install it manually
// in the Railway runner or add it when upgrading Prisma to v6+.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let Sentry: any = null
if (env.SENTRY_DSN) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    Sentry = require("@sentry/node")
    Sentry.init({
      dsn: env.SENTRY_DSN,
      environment: env.NODE_ENV || "development",
      tracesSampleRate: 0.1,
      sendDefaultPii: false,
    })
  } catch {
    // @sentry/node not installed — skip silently
  }
}
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
import guildInfoRoutes from "./routes/admin/guild-info.js"
import battlemetricsRoutes from "./routes/admin/battlemetrics.js"
import gameServerRoutes from "./routes/admin/game-servers.js"
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
import bridgeRoutes from "./routes/admin/bridge.js"
import seedingRoutes from "./routes/admin/seeding.js"
import seedingPublicRoutes from "./routes/seeding-public.js"
import jobRoutes from "./routes/admin/jobs.js"
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

  // ─── Sentry error hook ──────────────────────────────────────────────────────
  if (Sentry) {
    const sentry = Sentry
    app.addHook("onError", (_request, _reply, error, done) => {
      sentry.captureException(error)
      done()
    })
  }

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
  await app.register(authPlugin)

  // ─── Discord REST client (shared across routes) ──────────────────────────────

  const discord = new DiscordRESTClient(env.DISCORD_TOKEN)
  app.decorate("discord", discord)

  // ─── Routes ─────────────────────────────────────────────────────────────────

  await app.register(fileRoutes)
  await app.register(internalRoutes, { prefix: "/internal" })
  await app.register(authRoutes)
  await app.register(guildRoutes, { prefix: "/api" })
  await app.register(adminSettingsRoutes, { prefix: "/api/admin" })
  await app.register(whitelistRoutes, { prefix: "/api/admin" })
  await app.register(groupRoutes, { prefix: "/api/admin" })
  await app.register(panelRoutes, { prefix: "/api/admin" })
  await app.register(panelRoleRoutes, { prefix: "/api/admin" })
  await app.register(categoryRoutes, { prefix: "/api/admin" })
  await app.register(userRoutes, { prefix: "/api/admin" })
  await app.register(playerRoutes, { prefix: "/api/admin" })
  await app.register(auditRoutes, { prefix: "/api/admin" })
  await app.register(notificationRoutes, { prefix: "/api/admin" })
  await app.register(permissionsRoutes, { prefix: "/api/admin" })
  await app.register(bridgeRoutes, { prefix: "/api/admin" })
  await app.register(seedingRoutes, { prefix: "/api/admin" })
  await app.register(jobRoutes,    { prefix: "/api/admin" })
  await app.register(importExportRoutes, { prefix: "/api/admin" })
  await app.register(roleSyncRoutes, { prefix: "/api/admin" })
  await app.register(reconcileRoutes, { prefix: "/api/admin" })
  await app.register(guildInfoRoutes, { prefix: "/api/admin" })
  await app.register(battlemetricsRoutes, { prefix: "/api/admin" })
  await app.register(gameServerRoutes, { prefix: "/api/admin" })
  await app.register(myWhitelistRoutes, { prefix: "/api" })
  await app.register(seedingPublicRoutes, { prefix: "/api" })
  await app.register(steamRoutes, { prefix: "/api" })

  // Health check — registered last so it appears after all routes in logs
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

  // ─── Ensure sessions table exists (non-blocking, never crashes startup) ───────

  ensureSessionsTable(app.prisma).catch((err) => {
    app.log.error({ err }, "Failed to ensure sessions table")
  })

  // ─── Stale job cleanup: mark running jobs older than 10 min as failed ────────
  // Guards against bridge worker crashes leaving jobs stuck in 'running' state.

  app.prisma.jobQueue.updateMany({
    where: {
      status:    "running",
      startedAt: { lt: new Date(Date.now() - 10 * 60 * 1000) },
    },
    data: {
      status:       "failed",
      completedAt:  new Date(),
      error:        "Job timed out (worker crashed or restarted)",
    },
  }).then(({ count }) => {
    if (count > 0) app.log.warn(`Cleaned up ${count} stale running job(s)`)
  }).catch((err) => {
    app.log.error({ err }, "Failed to clean up stale jobs")
  })

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
  refreshAll().catch((err) => {
    app.log.error({ err }, "Failed initial Discord guild refresh")
  })

  setInterval(() => {
    refreshAll().catch((err) => {
      app.log.error({ err }, "Failed periodic Discord guild refresh")
    })
  }, HEARTBEAT_MS).unref()
}

// ─── Type augmentation for discord on FastifyInstance ────────────────────────

declare module "fastify" {
  interface FastifyInstance {
    discord: DiscordRESTClient
  }
}

start().catch((err) => {
  console.error("=== FATAL: Server failed to start ===")
  console.error("Message:", err?.message ?? err)
  console.error("Code:", err?.code)
  console.error("Stack:", err?.stack)
  process.exit(1)
})
