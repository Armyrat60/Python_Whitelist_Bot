import { describe, it, expect, beforeEach } from 'vitest'
import { buildTestApp, TEST_GUILD_ID, type TestApp } from './helpers.js'
import whitelistRoleRoutes from '../routes/admin/whitelist-roles.js'

// syncOutputs + cache are fire-and-forget in whitelist-roles.ts — mock them
import { vi } from 'vitest'
vi.mock('../services/output.js', () => ({ syncOutputs: vi.fn().mockResolvedValue({}) }))
vi.mock('../services/cache.js', () => ({
  cache: { set: vi.fn(), registerToken: vi.fn(), get: vi.fn().mockReturnValue(null) },
}))

const GUILD_ID_BIGINT = BigInt(TEST_GUILD_ID)

function makeWhitelist(overrides: Record<string, unknown> = {}) {
  return {
    id: 1, guildId: GUILD_ID_BIGINT, name: 'Test WL', slug: 'test',
    enabled: true, squadGroup: 'Whitelist', outputFilename: 'test.txt',
    defaultSlotLimit: 1, stackRoles: false, isDefault: true,
    createdAt: new Date(), updatedAt: new Date(),
    ...overrides,
  }
}

function makeWlRole(overrides: Record<string, unknown> = {}) {
  return {
    id: 1, guildId: GUILD_ID_BIGINT, whitelistId: 1,
    roleId: BigInt('555000555000555000'), roleName: 'VIP',
    slotLimit: 2, isStackable: false, isActive: true,
    displayName: null, sortOrder: 0,
    createdAt: new Date(), updatedAt: new Date(),
    ...overrides,
  }
}

// ─── GET ──────────────────────────────────────────────────────────────────────

describe('GET /whitelists/:whitelistId/roles', () => {
  let t: TestApp

  beforeEach(async () => {
    t = await buildTestApp(async (app) => {
      await app.register(whitelistRoleRoutes, { prefix: '/api/admin' })
    })
  })

  it('returns empty roles list', async () => {
    t.prisma.whitelist.findFirst.mockResolvedValueOnce(makeWhitelist())
    t.prisma.whitelistRole.findMany.mockResolvedValueOnce([])
    t.discord.fetchRoles.mockResolvedValueOnce([])

    const res = await t.app.inject({ method: 'GET', url: '/api/admin/whitelists/1/roles' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ roles: [] })
  })

  it('returns roles with correct shape', async () => {
    t.prisma.whitelist.findFirst.mockResolvedValueOnce(makeWhitelist())
    t.prisma.whitelistRole.findMany.mockResolvedValueOnce([makeWlRole()])
    t.discord.fetchRoles.mockResolvedValueOnce([])

    const res = await t.app.inject({ method: 'GET', url: '/api/admin/whitelists/1/roles' })
    expect(res.statusCode).toBe(200)

    const { roles } = res.json()
    expect(roles).toHaveLength(1)
    expect(roles[0]).toMatchObject({
      id:           1,
      role_id:      '555000555000555000',
      role_name:    'VIP',
      slot_limit:   2,
      is_stackable: false,
      is_active:    true,
      display_name: null,
      sort_order:   0,
    })
  })

  it('returns 404 when whitelist belongs to a different guild', async () => {
    t.prisma.whitelist.findFirst.mockResolvedValueOnce(null)

    const res = await t.app.inject({ method: 'GET', url: '/api/admin/whitelists/999/roles' })
    expect(res.statusCode).toBe(404)
  })

  it('returns 400 for non-numeric whitelistId', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/api/admin/whitelists/abc/roles' })
    expect(res.statusCode).toBe(400)
  })
})

// ─── POST ─────────────────────────────────────────────────────────────────────

describe('POST /whitelists/:whitelistId/roles', () => {
  let t: TestApp

  beforeEach(async () => {
    t = await buildTestApp(async (app) => {
      await app.register(whitelistRoleRoutes, { prefix: '/api/admin' })
    })
  })

  it('creates a role and returns { ok, id }', async () => {
    t.prisma.whitelist.findFirst.mockResolvedValueOnce(makeWhitelist())
    t.prisma.whitelistRole.upsert.mockResolvedValueOnce(makeWlRole({ id: 42 }))
    t.prisma.panel.findMany.mockResolvedValueOnce([])

    const res = await t.app.inject({
      method:  'POST',
      url:     '/api/admin/whitelists/1/roles',
      headers: { 'content-type': 'application/json' },
      payload: { role_id: '555000555000555000', role_name: 'VIP', slot_limit: 2 },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({ ok: true, id: 42 })
  })

  it('returns 400 when role_id is missing', async () => {
    t.prisma.whitelist.findFirst.mockResolvedValueOnce(makeWhitelist())

    const res = await t.app.inject({
      method:  'POST',
      url:     '/api/admin/whitelists/1/roles',
      headers: { 'content-type': 'application/json' },
      payload: { role_name: 'VIP', slot_limit: 2 },
    })
    expect(res.statusCode).toBe(400)
  })

  it('returns 400 when slot_limit is missing', async () => {
    t.prisma.whitelist.findFirst.mockResolvedValueOnce(makeWhitelist())

    const res = await t.app.inject({
      method:  'POST',
      url:     '/api/admin/whitelists/1/roles',
      headers: { 'content-type': 'application/json' },
      payload: { role_id: '555000555000555000', role_name: 'VIP' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('returns 404 when whitelist not found', async () => {
    t.prisma.whitelist.findFirst.mockResolvedValueOnce(null)

    const res = await t.app.inject({
      method:  'POST',
      url:     '/api/admin/whitelists/999/roles',
      headers: { 'content-type': 'application/json' },
      payload: { role_id: '555000555000555000', role_name: 'VIP', slot_limit: 2 },
    })
    expect(res.statusCode).toBe(404)
  })

  it('queues panel refreshes on create', async () => {
    t.prisma.whitelist.findFirst.mockResolvedValueOnce(makeWhitelist())
    t.prisma.whitelistRole.upsert.mockResolvedValueOnce(makeWlRole())
    t.prisma.panel.findMany.mockResolvedValueOnce([{ id: 10 }, { id: 11 }])
    t.prisma.panelRefreshQueue.create.mockResolvedValue({})

    await t.app.inject({
      method:  'POST',
      url:     '/api/admin/whitelists/1/roles',
      headers: { 'content-type': 'application/json' },
      payload: { role_id: '555000555000555000', role_name: 'VIP', slot_limit: 2 },
    })

    expect(t.prisma.panelRefreshQueue.create).toHaveBeenCalledTimes(2)
  })
})

// ─── PUT ──────────────────────────────────────────────────────────────────────

describe('PUT /whitelists/:whitelistId/roles/:roleId', () => {
  let t: TestApp

  beforeEach(async () => {
    t = await buildTestApp(async (app) => {
      await app.register(whitelistRoleRoutes, { prefix: '/api/admin' })
    })
  })

  it('updates slot_limit and returns { ok }', async () => {
    t.prisma.whitelistRole.findFirst.mockResolvedValueOnce(makeWlRole({ id: 5 }))
    t.prisma.whitelistRole.update.mockResolvedValueOnce(makeWlRole({ id: 5, slotLimit: 5 }))
    t.prisma.panel.findMany.mockResolvedValueOnce([])

    const res = await t.app.inject({
      method:  'PUT',
      url:     '/api/admin/whitelists/1/roles/555000555000555000',
      headers: { 'content-type': 'application/json' },
      payload: { slot_limit: 5 },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
  })

  it('returns 404 when role not found', async () => {
    t.prisma.whitelistRole.findFirst.mockResolvedValueOnce(null)

    const res = await t.app.inject({
      method:  'PUT',
      url:     '/api/admin/whitelists/1/roles/555000555000555000',
      headers: { 'content-type': 'application/json' },
      payload: { slot_limit: 3 },
    })

    expect(res.statusCode).toBe(404)
  })
})

// ─── DELETE ───────────────────────────────────────────────────────────────────

describe('DELETE /whitelists/:whitelistId/roles/:roleId', () => {
  let t: TestApp

  beforeEach(async () => {
    t = await buildTestApp(async (app) => {
      await app.register(whitelistRoleRoutes, { prefix: '/api/admin' })
    })
  })

  it('removes the role and queues panel refreshes', async () => {
    t.prisma.whitelistRole.findFirst.mockResolvedValueOnce(makeWlRole({ id: 5 }))
    t.prisma.whitelistRole.delete.mockResolvedValueOnce({})
    t.prisma.panel.findMany.mockResolvedValueOnce([{ id: 10 }])
    t.prisma.panelRefreshQueue.create.mockResolvedValue({})

    const res = await t.app.inject({
      method: 'DELETE',
      url:    '/api/admin/whitelists/1/roles/555000555000555000',
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
    expect(t.prisma.panelRefreshQueue.create).toHaveBeenCalledOnce()
  })

  it('returns 404 when role not found', async () => {
    t.prisma.whitelistRole.findFirst.mockResolvedValueOnce(null)

    const res = await t.app.inject({
      method: 'DELETE',
      url:    '/api/admin/whitelists/1/roles/555000555000555000',
    })

    expect(res.statusCode).toBe(404)
  })
})
