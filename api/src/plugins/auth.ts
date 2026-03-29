/**
 * Session and auth plugin.
 * Registers @fastify/cookie + @fastify/session (Prisma-backed PostgreSQL store) and exposes
 * requireAdmin / requireAuth helpers on the Fastify instance.
 * Sessions survive API restarts — stored in the `sessions` table via Prisma raw queries.
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
    guilds?: Array<{
      id: string
      name: string
      icon: string | null
      isAdmin: boolean
      permissionLevel: "owner" | "admin" | "roster_manager" | "viewer"
    }>
  }
}

declare module "fastify" {
  interface FastifyInstance {
    requireAuth:          (req: FastifyRequest, reply: FastifyReply) => Promise<void>
    requireAdmin:         (req: FastifyRequest, reply: FastifyReply) => Promise<void>
    requireRosterManager: (req: FastifyRequest, reply: FastifyReply) => Promise<void>
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

// ─── Sessions table bootstrap (run AFTER app.listen to never block startup) ──
// Call this once from server.ts after listen() returns.
export async function ensureSessionsTable(prisma: FastifyInstance["prisma"]) {
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS sessions (
        sid    VARCHAR(255) NOT NULL PRIMARY KEY,
        sess   JSON         NOT NULL,
        expire TIMESTAMP(6) NOT NULL
      )
    `)
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON sessions (expire)`
    )
  } catch (err: any) {
    console.error("[sessions] ensureSessionsTable failed (non-fatal):", err?.message)
  }
}

/** Returns true if the error is "table does not exist" (PostgreSQL code 42P01). */
function isTableMissing(err: any): boolean {
  return err?.code === "42P01" || /relation.*does not exist/i.test(err?.message ?? "")
}

// ─── Plugin ───────────────────────────────────────────────────────────────────
//
// Uses fp() to make session middleware global (applies to all routes).
// The healthcheck is protected from DB hangs by the 500ms timeout in
// prismaStore.get() — if the DB is slow, the session is treated as empty
// and the request proceeds immediately rather than hanging.

const authPlugin: FastifyPluginAsync = fp(async (app: FastifyInstance) => {
  const isSecure = env.WEB_BASE_URL.startsWith("https") || env.NODE_ENV === "production"

  // ─── Prisma-backed session store ───────────────────────────────────────────
  // get() has a 500ms hard timeout so DB slowness during blue-green deploys
  // never causes healthcheck hangs. If the DB doesn't respond in time, the
  // session is treated as empty (null) and the request proceeds normally.

  const prismaStore = {
    get(sid: string, cb: (err: any, session?: any) => void) {
      let settled = false

      // Hard timeout — never block a request (including /healthz) longer than 500ms
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true
          cb(null, null)
        }
      }, 500)

      app.prisma.$queryRawUnsafe<{ sess: any }[]>(
        `SELECT sess FROM sessions WHERE sid = $1 AND expire > NOW()`,
        sid,
      )
        .then(([row]) => {
          if (!settled) {
            settled = true
            clearTimeout(timer)
            cb(null, row?.sess ?? null)
          }
        })
        .catch((err) => {
          if (!settled) {
            settled = true
            clearTimeout(timer)
            if (isTableMissing(err)) return cb(null, null)
            cb(err)
          }
        })
    },

    set(sid: string, sess: any, cb: (err?: any) => void) {
      const maxAge = sess.cookie?.maxAge ?? 7 * 24 * 60 * 60 * 1000
      const expire = new Date(Date.now() + maxAge)
      app.prisma.$executeRawUnsafe(
        `INSERT INTO sessions (sid, sess, expire)
         VALUES ($1, $2::json, $3)
         ON CONFLICT (sid) DO UPDATE SET sess = EXCLUDED.sess, expire = EXCLUDED.expire`,
        sid,
        JSON.stringify(sess),
        expire,
      )
        .then(() => cb())
        .catch((err) => {
          if (isTableMissing(err)) return cb()
          cb(err)
        })
    },

    destroy(sid: string, cb: (err?: any) => void) {
      app.prisma.$executeRawUnsafe(`DELETE FROM sessions WHERE sid = $1`, sid)
        .then(() => cb())
        .catch((err) => {
          if (isTableMissing(err)) return cb()
          cb(err)
        })
    },

    touch(sid: string, sess: any, cb: (err?: any) => void) {
      const maxAge = sess.cookie?.maxAge ?? 7 * 24 * 60 * 60 * 1000
      const expire = new Date(Date.now() + maxAge)
      app.prisma.$executeRawUnsafe(
        `UPDATE sessions SET expire = $2 WHERE sid = $1`,
        sid,
        expire,
      )
        .then(() => cb())
        .catch((err) => {
          if (isTableMissing(err)) return cb()
          cb(err)
        })
    },
  }

  await app.register(cookie)
  await app.register(session, {
    secret: sessionSecret(),
    cookieName: "wl_session",
    store: prismaStore as never,
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

  // requireRosterManager — allows owner, admin, and roster_manager
  app.decorate("requireRosterManager", async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.session.userId) {
      return reply.code(401).send({ error: "Not authenticated" })
    }
    if (!req.session.activeGuildId) {
      return reply.code(400).send({ error: "No guild selected" })
    }
    const guild = req.session.guilds?.find((g) => g.id === req.session.activeGuildId)
    const level = guild?.permissionLevel
    if (!level || !["owner", "admin", "roster_manager"].includes(level)) {
      return reply.code(403).send({ error: "Insufficient permissions" })
    }
  })
})

export default authPlugin
