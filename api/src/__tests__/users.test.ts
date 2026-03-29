import { describe, it, expect, beforeEach, vi } from 'vitest'
import { buildTestApp, TEST_GUILD_ID, type TestApp } from './helpers.js'

// Mock the services used by users.ts so tests don't need real DB/cache
vi.mock('../services/output.js', () => ({
  syncOutputs: vi.fn().mockResolvedValue({}),
}))
vi.mock('../services/cache.js', () => ({
  cache: {
    set:           vi.fn(),
    registerToken: vi.fn(),
    get:           vi.fn().mockReturnValue(null),
    hasGuild:      vi.fn().mockReturnValue(false),
    hasFile:       vi.fn().mockReturnValue(false),
    lookupToken:   vi.fn().mockReturnValue(null),
    removeToken:   vi.fn(),
    fileCount:     vi.fn().mockReturnValue(0),
  },
}))
vi.mock('../services/token.js', () => ({
  getFileToken: vi.fn().mockReturnValue('test-token'),
  getFileUrl:   vi.fn().mockReturnValue('http://localhost/wl/test-token/test.txt'),
}))

import userRoutes from '../routes/admin/users.js'

const GUILD_ID_BIGINT = BigInt(TEST_GUILD_ID)
const DISCORD_ID      = '333444555666777888'

function makeWhitelist(overrides: Record<string, unknown> = {}) {
  return {
    id:               1,
    guildId:          GUILD_ID_BIGINT,
    name:             'Test WL',
    slug:             'test',
    enabled:          true,
    squadGroup:       'Whitelist',
    outputFilename:   'test.txt',
    defaultSlotLimit: 1,
    stackRoles:       false,
    isDefault:        true,
    createdAt:        new Date(),
    updatedAt:        new Date(),
    ...overrides,
  }
}

function makeUser(overrides: Record<string, unknown> = {}) {
  return {
    id:                  1,
    guildId:             GUILD_ID_BIGINT,
    discordId:           BigInt(DISCORD_ID),
    discordName:         'TestUser',
    whitelistId:         1,
    status:              'active',
    slotLimitOverride:   null,
    effectiveSlotLimit:  1,
    lastPlanName:        null,
    createdAt:           new Date(),
    updatedAt:           new Date(),
    expiresAt:           null,
    createdVia:          'admin',
    notes:               null,
    whitelist:           { slug: 'test', name: 'Test WL' },
    ...overrides,
  }
}

describe('PATCH /users/:discordId/:type', () => {
  let t: TestApp

  beforeEach(async () => {
    t = await buildTestApp(async (app) => {
      await app.register(userRoutes, { prefix: '/api/admin' })
    })
  })

  it('saves expires_at to DB (not just audit log)', async () => {
    t.prisma.whitelist.findUnique.mockResolvedValueOnce(makeWhitelist())
    t.prisma.whitelistUser.findUnique.mockResolvedValueOnce(makeUser())
    t.prisma.whitelistUser.update.mockResolvedValueOnce(makeUser({ expiresAt: new Date('2025-12-31') }))
    t.prisma.auditLog.create.mockResolvedValueOnce({})
    t.prisma.botSetting.findUnique.mockResolvedValue(null)

    const res = await t.app.inject({
      method:  'PATCH',
      url:     `/api/admin/users/${DISCORD_ID}/test`,
      headers: { 'content-type': 'application/json' },
      payload: { expires_at: '2025-12-31T00:00:00.000Z' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })

    // Verify the DB update was called with expiresAt
    expect(t.prisma.whitelistUser.update).toHaveBeenCalledOnce()
    const updateCall = t.prisma.whitelistUser.update.mock.calls[0][0] as { data: Record<string, unknown> }
    expect(updateCall.data).toHaveProperty('expiresAt')
    expect(updateCall.data.expiresAt).toBeInstanceOf(Date)
  })

  it('saves notes to DB', async () => {
    t.prisma.whitelist.findUnique.mockResolvedValueOnce(makeWhitelist())
    t.prisma.whitelistUser.findUnique.mockResolvedValueOnce(makeUser())
    t.prisma.whitelistUser.update.mockResolvedValueOnce(makeUser({ notes: 'VIP player' }))
    t.prisma.auditLog.create.mockResolvedValueOnce({})
    t.prisma.botSetting.findUnique.mockResolvedValue(null)

    const res = await t.app.inject({
      method:  'PATCH',
      url:     `/api/admin/users/${DISCORD_ID}/test`,
      headers: { 'content-type': 'application/json' },
      payload: { notes: 'VIP player' },
    })

    expect(res.statusCode).toBe(200)

    const updateCall = t.prisma.whitelistUser.update.mock.calls[0][0] as { data: Record<string, unknown> }
    expect(updateCall.data).toHaveProperty('notes', 'VIP player')
  })

  it('sets notes to null when explicitly passed null', async () => {
    t.prisma.whitelist.findUnique.mockResolvedValueOnce(makeWhitelist())
    t.prisma.whitelistUser.findUnique.mockResolvedValueOnce(makeUser({ notes: 'old note' }))
    t.prisma.whitelistUser.update.mockResolvedValueOnce(makeUser({ notes: null }))
    t.prisma.auditLog.create.mockResolvedValueOnce({})
    t.prisma.botSetting.findUnique.mockResolvedValue(null)

    const res = await t.app.inject({
      method:  'PATCH',
      url:     `/api/admin/users/${DISCORD_ID}/test`,
      headers: { 'content-type': 'application/json' },
      payload: { notes: null },
    })

    expect(res.statusCode).toBe(200)

    const updateCall = t.prisma.whitelistUser.update.mock.calls[0][0] as { data: Record<string, unknown> }
    expect(updateCall.data).toHaveProperty('notes', null)
  })

  it('returns 404 when whitelist not found', async () => {
    t.prisma.whitelist.findUnique.mockResolvedValueOnce(null)

    const res = await t.app.inject({
      method:  'PATCH',
      url:     `/api/admin/users/${DISCORD_ID}/nonexistent`,
      headers: { 'content-type': 'application/json' },
      payload: { status: 'active' },
    })

    expect(res.statusCode).toBe(404)
  })

  it('returns 404 when user not found', async () => {
    t.prisma.whitelist.findUnique.mockResolvedValueOnce(makeWhitelist())
    t.prisma.whitelistUser.findUnique.mockResolvedValueOnce(null)

    const res = await t.app.inject({
      method:  'PATCH',
      url:     `/api/admin/users/${DISCORD_ID}/test`,
      headers: { 'content-type': 'application/json' },
      payload: { status: 'active' },
    })

    expect(res.statusCode).toBe(404)
  })
})

describe('GET /users', () => {
  let t: TestApp

  beforeEach(async () => {
    t = await buildTestApp(async (app) => {
      await app.register(userRoutes, { prefix: '/api/admin' })
    })
  })

  it('returns notes field in each user object', async () => {
    t.prisma.whitelistUser.count.mockResolvedValueOnce(1)
    t.prisma.whitelistUser.findMany.mockResolvedValueOnce([
      makeUser({ notes: 'Important player' }),
    ])
    t.prisma.whitelistIdentifier.findMany.mockResolvedValueOnce([])

    const res = await t.app.inject({ method: 'GET', url: '/api/admin/users' })
    expect(res.statusCode).toBe(200)

    const body = res.json()
    expect(body.users).toHaveLength(1)
    expect(body.users[0]).toHaveProperty('notes', 'Important player')
  })

  it('returns null notes when user has no notes', async () => {
    t.prisma.whitelistUser.count.mockResolvedValueOnce(1)
    t.prisma.whitelistUser.findMany.mockResolvedValueOnce([
      makeUser({ notes: null }),
    ])
    t.prisma.whitelistIdentifier.findMany.mockResolvedValueOnce([])

    const res = await t.app.inject({ method: 'GET', url: '/api/admin/users' })
    const body = res.json()
    expect(body.users[0]).toHaveProperty('notes', null)
  })

  it('returns paginated response shape', async () => {
    t.prisma.whitelistUser.count.mockResolvedValueOnce(0)
    t.prisma.whitelistUser.findMany.mockResolvedValueOnce([])
    t.prisma.whitelistIdentifier.findMany.mockResolvedValueOnce([])

    const res = await t.app.inject({ method: 'GET', url: '/api/admin/users' })
    const body = res.json()

    expect(body).toHaveProperty('users')
    expect(body).toHaveProperty('total')
    expect(body).toHaveProperty('page')
    expect(body).toHaveProperty('per_page')
    expect(body).toHaveProperty('pages')
    expect(Array.isArray(body.users)).toBe(true)
  })
})
