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

  return {
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
      delete:     mockFn(),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      count:      mockCount(),
    },
    roleMapping: {
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
    tierCategory: {
      findMany:   mockList(),
      findFirst:  mockFn(),
      findUnique: mockFn(),
      create:     mockFn(),
      update:     mockFn(),
      delete:     mockFn(),
      count:      mockCount(),
    },
    tierEntry: {
      findMany:   mockList(),
      findFirst:  mockFn(),
      create:     mockFn(),
      update:     mockFn(),
      delete:     mockFn(),
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
    $transaction: vi.fn().mockImplementation(async (arg: unknown) => {
      if (Array.isArray(arg)) return Promise.all(arg)
      if (typeof arg === 'function') return arg({})
      return null
    }),
    $queryRaw: vi.fn().mockResolvedValue([]),
  }
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
  await app.register(fp(async (instance) => {
    instance.decorate('prisma',  mockPrisma)
    instance.decorate('discord', mockDiscord)

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
      { id: TEST_GUILD_ID, name: 'Test Guild', icon: null, isAdmin: true },
    ]
  })

  // ── Register the routes under test ────────────────────────────────────────
  await registerRoutes(app)

  await app.ready()

  return { app, prisma: mockPrisma, discord: mockDiscord }
}
