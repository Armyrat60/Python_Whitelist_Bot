/**
 * Test app factory for admin route tests.
 *
 * Creates a real Fastify instance with mocked prisma and discord,
 * and a hook that injects a valid admin session so every request
 * passes the adminHook / requireAdmin guards.
 */
import { vi } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import fp from 'fastify-plugin'

// ─── Test guild / user constants ─────────────────────────────────────────────

export const TEST_GUILD_ID = '111111111111111111'
export const TEST_USER_ID  = '222222222222222222'

// ─── Mock Prisma ─────────────────────────────────────────────────────────────

export function makeMockPrisma() {
  // Every model method is a vi.fn() that resolves to sensible defaults.
  // Individual tests override with .mockResolvedValueOnce() as needed.
  const mockFn = () => vi.fn().mockResolvedValue(null)
  const mockList = () => vi.fn().mockResolvedValue([])
  const mockCount = () => vi.fn().mockResolvedValue(0)

  const mock = {
    panel: {
      findMany:   mockList(),
      findFirst:  mockFn(),
      create:     mockFn(),
      update:     mockFn(),
      delete:     mockFn(),
      count:      mockCount(),
    },
    whitelist: {
      findMany:   mockList(),
      findFirst:  mockFn(),
      findUnique: mockFn(),
      create:     mockFn(),
      update:     mockFn(),
      delete:     mockFn(),
      count:      mockCount(),
    },
    whitelistUser: {
      findMany:   mockList(),
      findFirst:  mockFn(),
      findUnique: mockFn(),
      create:     mockFn(),
      update:     mockFn(),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      upsert:     mockFn(),
      delete:     mockFn(),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      count:      mockCount(),
    },
    whitelistIdentifier: {
      findMany:   mockList(),
      findFirst:  mockFn(),
      create:     mockFn(),
      upsert:     mockFn(),
      update:     mockFn(),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      delete:     mockFn(),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      count:      mockCount(),
    },
    panelRole: {
      findMany:   mockList(),
      findFirst:  mockFn(),
      findUnique: mockFn(),
      create:     mockFn(),
      upsert:     mockFn(),
      update:     mockFn(),
      delete:     mockFn(),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      count:      mockCount(),
    },
    panelRefreshQueue: {
      create:     mockFn(),
      findMany:   mockList(),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    notificationRouting: {
      findMany:   mockList(),
      findFirst:  mockFn(),
      findUnique: mockFn(),
      create:     mockFn(),
      upsert:     mockFn(),
    },
    botSetting: {
      findMany:   mockList(),
      findFirst:  mockFn(),
      findUnique: mockFn(),
      create:     mockFn(),
      upsert:     mockFn(),
      update:     mockFn(),
    },
    auditLog: {
      findMany:   mockList(),
      create:     mockFn(),
    },
    squadGroup: {
      findMany:   mockList(),
      findFirst:  mockFn(),
      create:     mockFn(),
      update:     mockFn(),
      delete:     mockFn(),
    },
    bridgeConfig: {
      findUnique: mockFn(),
      upsert:     mockFn(),
      delete:     mockFn(),
    },
    jobQueue: {
      create:     mockFn(),
      findUnique: mockFn(),
      findMany:   mockList(),
      update:     mockFn(),
      count:      mockCount(),
    },
    squadPlayer: {
      findMany:   mockList(),
      findFirst:  mockFn(),
      findUnique: mockFn(),
      create:     mockFn(),
      upsert:     mockFn(),
      update:     mockFn(),
      count:      mockCount(),
    },
    whitelistCategory: {
      findMany:   mockList(),
      findFirst:  mockFn(),
      findUnique: mockFn(),
      create:     mockFn(),
      update:     mockFn(),
      delete:     mockFn(),
      count:      mockCount(),
    },
    categoryManager: {
      findMany:   mockList(),
      findFirst:  mockFn(),
      findUnique: mockFn(),
      create:     mockFn(),
      upsert:     mockFn(),
      update:     mockFn(),
      delete:     mockFn(),
    },
    gameServer: {
      findMany:   mockList(),
      findFirst:  mockFn(),
      findUnique: mockFn(),
      create:     mockFn(),
      update:     mockFn(),
      delete:     mockFn(),
      count:      mockCount(),
    },
    $transaction: vi.fn(),  // wired up below (needs self-reference)
    $queryRaw: vi.fn().mockResolvedValue([]),
  }

  // $transaction passes the mock prisma itself as the `tx` argument so
  // callback-style transactions (async (tx) => { tx.model.update(...) })
  // can call the same mocked methods.
  mock.$transaction.mockImplementation(async (arg: unknown) => {
    if (Array.isArray(arg)) return Promise.all(arg)
    if (typeof arg === 'function') return (arg as (tx: typeof mock) => unknown)(mock)
    return null
  })

  return mock
}

export type MockPrisma = ReturnType<typeof makeMockPrisma>

// ─── Mock Discord ─────────────────────────────────────────────────────────────

export function makeMockDiscord() {
  return {
    fetchRoles:      vi.fn().mockResolvedValue([]),
    fetchChannels:   vi.fn().mockResolvedValue([]),
    fetchAllMembers: vi.fn().mockResolvedValue([]),
    fetchMember:     vi.fn().mockResolvedValue(null),
    fetchGuilds:     vi.fn().mockResolvedValue(undefined),
    getGuilds:       vi.fn().mockReturnValue([]),
    guildCount:      vi.fn().mockReturnValue(0),
  }
}

export type MockDiscord = ReturnType<typeof makeMockDiscord>

// ─── App factory ─────────────────────────────────────────────────────────────

export interface TestApp {
  app:     FastifyInstance
  prisma:  MockPrisma
  discord: MockDiscord
}

/**
 * Build a Fastify test app with mocked prisma/discord and an admin session.
 * Pass `registerRoutes` to register the route plugin(s) you want to test.
 */
export async function buildTestApp(
  registerRoutes: (app: FastifyInstance) => Promise<void>,
): Promise<TestApp> {
  const mockPrisma  = makeMockPrisma()
  const mockDiscord = makeMockDiscord()

  const app = Fastify({ logger: false })

  // ── Decorate with mocked services ─────────────────────────────────────────
  await app.register(fp(async (instance: FastifyInstance) => {
    instance.decorate('prisma',  mockPrisma  as unknown as import('@prisma/client').PrismaClient)
    instance.decorate('discord', mockDiscord as unknown as import('../lib/discord.js').DiscordRESTClient)

    // Expose requireAdmin / requireAuth as instance decorators (used by rolesync.ts)
    instance.decorate('requireAdmin', async (req: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply) => {
      if (!req.session.userId) return reply.code(401).send({ error: 'Not authenticated' })
      if (!req.session.activeGuildId) return reply.code(400).send({ error: 'No guild selected' })
      const guild = req.session.guilds?.find((g) => g.id === req.session.activeGuildId)
      if (!guild?.isAdmin) return reply.code(403).send({ error: 'Admin access required' })
    })
    instance.decorate('requireAuth', async (req: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply) => {
      if (!req.session.userId) return reply.code(401).send({ error: 'Not authenticated' })
    })
  }))

  // ── Register @fastify/cookie + @fastify/session for session support ────────
  const cookie  = (await import('@fastify/cookie')).default
  const session = (await import('@fastify/session')).default

  await app.register(cookie)
  await app.register(session, {
    secret: 'test-session-secret-at-least-32-chars!!',
    cookieName: 'wl_session',
    cookie: { secure: false },
    saveUninitialized: false,
  })

  // ── Inject admin session on every request ─────────────────────────────────
  app.addHook('onRequest', async (req) => {
    req.session.userId       = TEST_USER_ID
    req.session.username     = 'TestAdmin'
    req.session.activeGuildId = TEST_GUILD_ID
    req.session.guilds = [
      { id: TEST_GUILD_ID, name: 'Test Guild', icon: null, isAdmin: true, permissionLevel: 'admin' as const },
    ]
  })

  // ── Register the routes under test ────────────────────────────────────────
  await registerRoutes(app)

  await app.ready()

  return { app, prisma: mockPrisma, discord: mockDiscord }
}
