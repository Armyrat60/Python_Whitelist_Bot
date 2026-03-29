/**
 * Session and auth plugin.
 * Registers @fastify/cookie + @fastify/session and exposes
 * requireAdmin / requireAuth helpers on the Fastify instance.
 */
import fp from "fastify-plugin"
import cookie from "@fastify/cookie"
import session from "@fastify/session"
import type { FastifyPluginAsync, FastifyInstance, FastifyRequest, FastifyReply } from "fastify"
import { env } from "../lib/env.js"
import { createHmac } from "crypto"

// ─── Session type augmentation ────────────────────────────────────────────────

declare module "@fastify/session" {
  interface FastifySessionObject {
    userId?: string        // Discord user ID (snowflake string)
    username?: string
    avatar?: string
    activeGuildId?: string // Currently selected guild
    guilds?: Array<{ id: string; name: string; icon: string | null; isAdmin: boolean }>
  }
}

declare module "fastify" {
  interface FastifyInstance {
    requireAuth: (req: FastifyRequest, reply: FastifyReply) => Promise<void>
    requireAdmin: (req: FastifyRequest, reply: FastifyReply) => Promise<void>
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Derive a stable 32-byte session secret from WEB_SESSION_SECRET. */
function sessionSecret(): string {
  return createHmac("sha256", env.WEB_SESSION_SECRET)
    .update("session-key")
    .digest("hex")
    .slice(0, 32)  // @fastify/session needs at least 32 chars
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

const authPlugin: FastifyPluginAsync = fp(async (app: FastifyInstance) => {
  const isSecure = env.WEB_BASE_URL.startsWith("https") || env.NODE_ENV === "production"

  await app.register(cookie)
  await app.register(session, {
    secret: sessionSecret(),
    cookieName: "wl_session",
    cookie: {
      secure: isSecure,
      httpOnly: true,
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in ms
    },
    rolling: true,       // reset expiry on every request
    saveUninitialized: false,
  })

  app.decorate("requireAuth", async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.session.userId) {
      return reply.code(401).send({ error: "Not authenticated" })
    }
  })

  app.decorate("requireAdmin", async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.session.userId) {
      return reply.code(401).send({ error: "Not authenticated" })
    }
    if (!req.session.activeGuildId) {
      return reply.code(400).send({ error: "No guild selected" })
    }
    const guild = req.session.guilds?.find((g) => g.id === req.session.activeGuildId)
    if (!guild?.isAdmin) {
      return reply.code(403).send({ error: "Not an admin of this guild" })
    }
  })
})

export default authPlugin
