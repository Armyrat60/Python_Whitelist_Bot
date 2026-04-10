import { describe, it, expect, beforeEach, vi } from 'vitest'
import { buildTestApp, TEST_GUILD_ID, type TestApp } from './helpers.js'

import categoryRoutes from '../routes/admin/categories.js'

const GUILD_ID = BigInt(TEST_GUILD_ID)
const WL_ID = 1
const CAT_ID = 10

function makeWhitelist(overrides: Record<string, unknown> = {}) {
  return {
    id: WL_ID, guildId: GUILD_ID, name: 'Imported', slug: 'imported',
    isManual: true, enabled: true, defaultSlotLimit: 1, squadGroup: 'reserve',
    ...overrides,
  }
}

function makeCategory(overrides: Record<string, unknown> = {}) {
  return {
    id: CAT_ID, guildId: GUILD_ID, whitelistId: WL_ID,
    name: 'DMH', slotLimit: null, sortOrder: 0, squadGroup: null, tags: null,
    createdAt: new Date(), updatedAt: new Date(),
    _count: { managers: 0, users: 5 },
    ...overrides,
  }
}

function makeManager(overrides: Record<string, unknown> = {}) {
  return {
    id: 1, categoryId: CAT_ID, discordId: 333333333333333333n,
    discordName: 'TestManager', addedAt: new Date(),
    ...overrides,
  }
}

// ─── GET /categories ─────────────────────────────────────────────────────────

describe('GET /whitelists/:whitelistId/categories', () => {
  let t: TestApp

  beforeEach(async () => {
    t = await buildTestApp(async (app) => {
      await app.register(categoryRoutes, { prefix: '/api/admin' })
    })
  })

  it('returns categories with counts', async () => {
    t.prisma.whitelist.findFirst.mockResolvedValueOnce(makeWhitelist())
    t.prisma.whitelistCategory.findMany.mockResolvedValueOnce([
      makeCategory({ name: 'DMH', _count: { managers: 2, users: 10 } }),
      makeCategory({ id: 11, name: 'S2C', _count: { managers: 0, users: 3 } }),
    ])

    const res = await t.app.inject({ method: 'GET', url: `/api/admin/whitelists/${WL_ID}/categories` })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.categories).toHaveLength(2)
    expect(body.categories[0].name).toBe('DMH')
    expect(body.categories[0].manager_count).toBe(2)
    expect(body.categories[0].user_count).toBe(10)
    expect(body.categories[0].tags).toBeNull()
  })

  it('returns 404 for unknown whitelist', async () => {
    t.prisma.whitelist.findFirst.mockResolvedValueOnce(null)
    const res = await t.app.inject({ method: 'GET', url: `/api/admin/whitelists/999/categories` })
    expect(res.statusCode).toBe(404)
  })
})

// ─── POST /categories ────────────────────────────────────────────────────────

describe('POST /whitelists/:whitelistId/categories', () => {
  let t: TestApp

  beforeEach(async () => {
    t = await buildTestApp(async (app) => {
      await app.register(categoryRoutes, { prefix: '/api/admin' })
    })
  })

  it('creates a category', async () => {
    t.prisma.whitelist.findFirst.mockResolvedValueOnce(makeWhitelist())
    t.prisma.whitelistCategory.create.mockResolvedValueOnce(
      makeCategory({ name: 'NewCat', slotLimit: 50 })
    )

    const res = await t.app.inject({
      method: 'POST',
      url: `/api/admin/whitelists/${WL_ID}/categories`,
      payload: { name: 'NewCat', slot_limit: 50 },
    })
    expect(res.statusCode).toBe(201)
    const body = JSON.parse(res.body)
    expect(body.ok).toBe(true)
    expect(body.name).toBe('NewCat')
  })

  it('rejects missing name', async () => {
    t.prisma.whitelist.findFirst.mockResolvedValueOnce(makeWhitelist())
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/admin/whitelists/${WL_ID}/categories`,
      payload: { slot_limit: 10 },
    })
    expect(res.statusCode).toBe(400)
  })
})

// ─── PUT /categories/:categoryId ─────────────────────────────────────────────

describe('PUT /whitelists/:whitelistId/categories/:categoryId', () => {
  let t: TestApp

  beforeEach(async () => {
    t = await buildTestApp(async (app) => {
      await app.register(categoryRoutes, { prefix: '/api/admin' })
    })
  })

  it('updates name and tags', async () => {
    t.prisma.whitelistCategory.findFirst.mockResolvedValueOnce(makeCategory())
    t.prisma.whitelistCategory.update.mockResolvedValueOnce(makeCategory({ name: 'Renamed', tags: 'clan,vip' }))

    const res = await t.app.inject({
      method: 'PUT',
      url: `/api/admin/whitelists/${WL_ID}/categories/${CAT_ID}`,
      payload: { name: 'Renamed', tags: 'clan,vip' },
    })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).ok).toBe(true)
  })

  it('clears slot_limit when set to null', async () => {
    t.prisma.whitelistCategory.findFirst.mockResolvedValueOnce(makeCategory({ slotLimit: 50 }))
    t.prisma.whitelistCategory.update.mockResolvedValueOnce(makeCategory({ slotLimit: null }))

    const res = await t.app.inject({
      method: 'PUT',
      url: `/api/admin/whitelists/${WL_ID}/categories/${CAT_ID}`,
      payload: { slot_limit: null },
    })
    expect(res.statusCode).toBe(200)
    expect(t.prisma.whitelistCategory.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ slotLimit: null }) })
    )
  })

  it('reassigns category to different whitelist', async () => {
    const targetWlId = 2
    t.prisma.whitelistCategory.findFirst.mockResolvedValueOnce(makeCategory())
    t.prisma.whitelist.findFirst.mockResolvedValueOnce(makeWhitelist({ id: targetWlId, name: 'Clan' }))
    t.prisma.whitelistUser.findMany.mockResolvedValueOnce([
      { discordId: 100n }, { discordId: 200n },
    ])
    t.prisma.whitelistIdentifier.updateMany.mockResolvedValueOnce({ count: 2 })
    t.prisma.whitelistUser.updateMany.mockResolvedValueOnce({ count: 2 })
    t.prisma.whitelistCategory.update.mockResolvedValueOnce(makeCategory({ whitelistId: targetWlId }))

    const res = await t.app.inject({
      method: 'PUT',
      url: `/api/admin/whitelists/${WL_ID}/categories/${CAT_ID}`,
      payload: { whitelist_id: targetWlId },
    })
    expect(res.statusCode).toBe(200)
    // Verify identifiers moved BEFORE users
    const identCall = t.prisma.whitelistIdentifier.updateMany.mock.invocationCallOrder[0]
    const userCall = t.prisma.whitelistUser.updateMany.mock.invocationCallOrder[0]
    expect(identCall).toBeLessThan(userCall)
  })

  it('returns 404 for missing category', async () => {
    t.prisma.whitelistCategory.findFirst.mockResolvedValueOnce(null)
    const res = await t.app.inject({
      method: 'PUT',
      url: `/api/admin/whitelists/${WL_ID}/categories/999`,
      payload: { name: 'X' },
    })
    expect(res.statusCode).toBe(404)
  })
})

// ─── DELETE /categories/:categoryId ──────────────────────────────────────────

describe('DELETE /whitelists/:whitelistId/categories/:categoryId', () => {
  let t: TestApp

  beforeEach(async () => {
    t = await buildTestApp(async (app) => {
      await app.register(categoryRoutes, { prefix: '/api/admin' })
    })
  })

  it('deletes a category', async () => {
    t.prisma.whitelistCategory.findFirst.mockResolvedValueOnce(makeCategory())
    t.prisma.whitelistCategory.delete.mockResolvedValueOnce(makeCategory())

    const res = await t.app.inject({
      method: 'DELETE',
      url: `/api/admin/whitelists/${WL_ID}/categories/${CAT_ID}`,
    })
    expect(res.statusCode).toBe(200)
    expect(t.prisma.whitelistCategory.delete).toHaveBeenCalledWith({ where: { id: CAT_ID } })
  })

  it('returns 404 for missing category', async () => {
    t.prisma.whitelistCategory.findFirst.mockResolvedValueOnce(null)
    const res = await t.app.inject({
      method: 'DELETE',
      url: `/api/admin/whitelists/${WL_ID}/categories/999`,
    })
    expect(res.statusCode).toBe(404)
  })
})

// ─── Managers ────────────────────────────────────────────────────────────────

describe('Category Managers', () => {
  let t: TestApp

  beforeEach(async () => {
    t = await buildTestApp(async (app) => {
      await app.register(categoryRoutes, { prefix: '/api/admin' })
    })
  })

  it('GET returns managers list', async () => {
    t.prisma.whitelistCategory.findFirst.mockResolvedValueOnce(makeCategory())
    t.prisma.categoryManager.findMany.mockResolvedValueOnce([makeManager()])

    const res = await t.app.inject({
      method: 'GET',
      url: `/api/admin/whitelists/${WL_ID}/categories/${CAT_ID}/managers`,
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.managers).toHaveLength(1)
    expect(body.managers[0].discord_name).toBe('TestManager')
  })

  it('POST adds a manager', async () => {
    t.prisma.whitelistCategory.findFirst.mockResolvedValueOnce(makeCategory())
    t.prisma.categoryManager.upsert.mockResolvedValueOnce(makeManager())

    const res = await t.app.inject({
      method: 'POST',
      url: `/api/admin/whitelists/${WL_ID}/categories/${CAT_ID}/managers`,
      payload: { discord_id: '333333333333333333', discord_name: 'TestManager' },
    })
    expect(res.statusCode).toBe(201)
    expect(JSON.parse(res.body).ok).toBe(true)
  })

  it('POST rejects missing discord_id', async () => {
    t.prisma.whitelistCategory.findFirst.mockResolvedValueOnce(makeCategory())
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/admin/whitelists/${WL_ID}/categories/${CAT_ID}/managers`,
      payload: { discord_name: 'Test' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('DELETE removes a manager', async () => {
    t.prisma.whitelistCategory.findFirst.mockResolvedValueOnce(makeCategory())
    t.prisma.categoryManager.findUnique.mockResolvedValueOnce(makeManager())
    t.prisma.categoryManager.delete.mockResolvedValueOnce(makeManager())

    const res = await t.app.inject({
      method: 'DELETE',
      url: `/api/admin/whitelists/${WL_ID}/categories/${CAT_ID}/managers/333333333333333333`,
    })
    expect(res.statusCode).toBe(200)
  })
})

// ─── Entries ─────────────────────────────────────────────────────────────────

describe('Category Entries', () => {
  let t: TestApp

  beforeEach(async () => {
    t = await buildTestApp(async (app) => {
      await app.register(categoryRoutes, { prefix: '/api/admin' })
    })
  })

  it('GET returns paginated entries with identifiers', async () => {
    const user = {
      guildId: GUILD_ID, discordId: 444n, whitelistId: WL_ID,
      discordName: 'Player1', status: 'active', effectiveSlotLimit: 1,
      slotLimitOverride: null, lastPlanName: null, createdAt: new Date(),
      updatedAt: new Date(), expiresAt: null, createdVia: 'import', notes: null,
      categoryId: CAT_ID, discordUsername: null, discordNick: null, clanTag: null,
      roleGainedAt: null, roleLostAt: null,
      whitelist: { slug: 'imported', name: 'Imported' },
      category: { id: CAT_ID, name: 'DMH' },
    }
    t.prisma.whitelistCategory.findFirst.mockResolvedValueOnce(makeCategory())
    t.prisma.whitelistUser.count.mockResolvedValueOnce(1)
    t.prisma.whitelistUser.findMany.mockResolvedValueOnce([user])
    t.prisma.whitelistIdentifier.findMany.mockResolvedValueOnce([
      { discordId: 444n, whitelistId: WL_ID, idType: 'steam64', idValue: '76561198000000001' },
    ])

    const res = await t.app.inject({
      method: 'GET',
      url: `/api/admin/whitelists/${WL_ID}/categories/${CAT_ID}/entries`,
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.entries).toHaveLength(1)
    expect(body.entries[0].discord_name).toBe('Player1')
    expect(body.entries[0].steam_ids).toContain('76561198000000001')
    expect(body.total).toBe(1)
  })

  it('POST adds an entry and enforces slot limit', async () => {
    t.prisma.whitelistCategory.findFirst.mockResolvedValueOnce(
      makeCategory({ slotLimit: 1, _count: { managers: 0, users: 1 } })
    )
    t.prisma.whitelist.findFirst.mockResolvedValueOnce(makeWhitelist())

    // Transaction mock: slot limit check returns count >= limit
    t.prisma.$transaction.mockImplementationOnce(async (fn: (tx: unknown) => unknown) => {
      const tx = {
        whitelistUser: { count: vi.fn().mockResolvedValue(1), upsert: vi.fn() },
        whitelistIdentifier: { upsert: vi.fn() },
      }
      return fn(tx)
    })

    const res = await t.app.inject({
      method: 'POST',
      url: `/api/admin/whitelists/${WL_ID}/categories/${CAT_ID}/entries`,
      payload: { steam_id: '76561198000000001' },
    })
    expect(res.statusCode).toBe(409)
    expect(JSON.parse(res.body).error).toContain('full')
  })

  it('DELETE removes an entry', async () => {
    t.prisma.whitelistCategory.findFirst.mockResolvedValueOnce(makeCategory())
    t.prisma.whitelistUser.findUnique.mockResolvedValueOnce({
      guildId: GUILD_ID, discordId: 444n, whitelistId: WL_ID,
      categoryId: CAT_ID, createdVia: 'manual_steam_only',
    })

    const res = await t.app.inject({
      method: 'DELETE',
      url: `/api/admin/whitelists/${WL_ID}/categories/${CAT_ID}/entries/444`,
    })
    expect(res.statusCode).toBe(200)
    expect(t.prisma.$transaction).toHaveBeenCalled()
  })
})
