import { describe, it, expect, beforeEach, vi } from 'vitest'
import { buildTestApp, TEST_GUILD_ID, type TestApp } from './helpers.js'

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

import roleSyncRoutes from '../routes/admin/rolesync.js'

const GUILD_ID_BIGINT = BigInt(TEST_GUILD_ID)

// ─── POST /role-sync/pull ─────────────────────────────────────────────────────

describe('POST /role-sync/pull', () => {
  let t: TestApp

  beforeEach(async () => {
    t = await buildTestApp(async (app) => {
      await app.register(roleSyncRoutes, { prefix: '/api/admin' })
    })
  })

  it('returns { added: 0 } when no active panel roles exist', async () => {
    t.prisma.panelRole.findMany.mockResolvedValueOnce([])

    const res = await t.app.inject({ method: 'POST', url: '/api/admin/role-sync/pull', payload: {} })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.ok).toBe(true)
    expect(body.added).toBe(0)
  })

  it('dry_run: counts new members without creating records', async () => {
    const roleId = '123456789012345678'
    const wlId = 1

    t.prisma.panelRole.findMany.mockResolvedValueOnce([
      { roleId: BigInt(roleId), roleName: 'VIP', slotLimit: 2, isActive: true, panel: { whitelistId: wlId, enabled: true } },
    ])
    t.prisma.whitelist.findUnique.mockResolvedValueOnce({ id: wlId, slug: 'default', guildId: GUILD_ID_BIGINT })
    t.discord.fetchAllMembers.mockResolvedValueOnce([
      { id: BigInt('300'), name: 'Alice', username: 'alice', roles: [roleId] },
      { id: BigInt('301'), name: 'Bob',   username: 'bob',   roles: [roleId] },
    ])
    // Both are new (findUnique returns null for each)
    t.prisma.whitelistUser.findUnique.mockResolvedValue(null)

    const res = await t.app.inject({
      method: 'POST', url: '/api/admin/role-sync/pull',
      payload: { dry_run: true },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.ok).toBe(true)
    expect(body.added).toBe(2)
    expect(body.dry_run).toBe(true)
    // No create calls in dry run
    expect(t.prisma.whitelistUser.create).not.toHaveBeenCalled()
  })

  it('skips already-existing users and counts them in already_exists', async () => {
    const roleId = '555000111222333444'
    const wlId = 2

    t.prisma.panelRole.findMany.mockResolvedValueOnce([
      { roleId: BigInt(roleId), roleName: 'Member', slotLimit: 1, isActive: true, panel: { whitelistId: wlId, enabled: true } },
    ])
    t.prisma.whitelist.findUnique.mockResolvedValueOnce({ id: wlId, slug: 'squad', guildId: GUILD_ID_BIGINT })
    t.discord.fetchAllMembers.mockResolvedValueOnce([
      { id: BigInt('400'), name: 'ExistingUser', username: 'existing', roles: [roleId] },
    ])
    // Already exists
    t.prisma.whitelistUser.findUnique.mockResolvedValueOnce({ id: 99 })

    const res = await t.app.inject({ method: 'POST', url: '/api/admin/role-sync/pull', payload: {} })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.added).toBe(0)
    expect(body.already_exists).toBe(1)
  })
})

// ─── GET /members/gap ─────────────────────────────────────────────────────────

describe('GET /members/gap', () => {
  let t: TestApp

  beforeEach(async () => {
    t = await buildTestApp(async (app) => {
      await app.register(roleSyncRoutes, { prefix: '/api/admin' })
    })
  })

  it('returns empty list when no whitelisted roles are configured', async () => {
    t.prisma.panelRole.findMany.mockResolvedValueOnce([])

    const res = await t.app.inject({ method: 'GET', url: '/api/admin/members/gap' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ members: [], total: 0 })
  })

  it('returns empty list when all role-holders are already registered', async () => {
    const roleId = '888777666555444333'
    t.prisma.panelRole.findMany.mockResolvedValueOnce([{ roleId: BigInt(roleId) }])
    t.discord.fetchAllMembers.mockResolvedValueOnce([
      { id: BigInt('500'), name: 'Registered', username: 'reg', roles: [roleId] },
    ])
    t.prisma.whitelistUser.findMany.mockResolvedValueOnce([{ discordId: BigInt('500') }])

    const res = await t.app.inject({ method: 'GET', url: '/api/admin/members/gap' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.members).toHaveLength(0)
    expect(body.total).toBe(0)
  })

  it('returns unregistered members who hold a whitelisted role', async () => {
    const roleId = '111333555777999000'
    t.prisma.panelRole.findMany.mockResolvedValueOnce([{ roleId: BigInt(roleId) }])
    t.discord.fetchAllMembers.mockResolvedValueOnce([
      { id: BigInt('600'), name: 'NoEntry', username: 'noentry', roles: [roleId] },
      { id: BigInt('601'), name: 'HasEntry', username: 'hasentry', roles: [roleId] },
    ])
    t.prisma.whitelistUser.findMany.mockResolvedValueOnce([{ discordId: BigInt('601') }])

    const res = await t.app.inject({ method: 'GET', url: '/api/admin/members/gap' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.total).toBe(1)
    expect(body.members[0].discord_id).toBe('600')
    expect(body.members[0].whitelisted_roles).toContain(roleId)
  })
})

// ─── POST /verify-roles ───────────────────────────────────────────────────────

describe('POST /verify-roles', () => {
  let t: TestApp

  beforeEach(async () => {
    t = await buildTestApp(async (app) => {
      await app.register(roleSyncRoutes, { prefix: '/api/admin' })
    })
  })

  it('returns { ok: true, issues: [] } when all roles exist in Discord', async () => {
    const roleId = '222444666888000111'
    t.prisma.panelRole.findMany.mockResolvedValueOnce([
      { roleId: BigInt(roleId), roleName: 'VIP', isActive: true },
    ])
    t.discord.fetchRoles.mockResolvedValueOnce([{ id: roleId, name: 'VIP' }])

    const res = await t.app.inject({ method: 'POST', url: '/api/admin/verify-roles', payload: {} })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.ok).toBe(true)
    expect(body.issues).toHaveLength(0)
  })

  it('reports missing roles as issues', async () => {
    const deletedRoleId = '999888777666555444'
    t.prisma.panelRole.findMany.mockResolvedValueOnce([
      { roleId: BigInt(deletedRoleId), roleName: 'OldRole', isActive: true },
    ])
    // Discord no longer has this role
    t.discord.fetchRoles.mockResolvedValueOnce([{ id: '111111111111111110', name: 'SomeOtherRole' }])

    const res = await t.app.inject({ method: 'POST', url: '/api/admin/verify-roles', payload: {} })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.ok).toBe(false)
    expect(body.issues).toHaveLength(1)
    expect(body.issues[0].type).toBe('missing')
    expect(body.issues[0].role_id).toBe(deletedRoleId)
    expect(body.issues[0].role_name).toBe('OldRole')
  })
})

// ─── POST /backfill/tiers ─────────────────────────────────────────────────────

describe('POST /backfill/tiers', () => {
  let t: TestApp

  beforeEach(async () => {
    t = await buildTestApp(async (app) => {
      await app.register(roleSyncRoutes, { prefix: '/api/admin' })
    })
  })

  it('returns { updated: 0 } when no active panel roles exist', async () => {
    t.prisma.panelRole.findMany.mockResolvedValueOnce([])

    const res = await t.app.inject({ method: 'POST', url: '/api/admin/backfill/tiers', payload: {} })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.ok).toBe(true)
    expect(body.updated).toBe(0)
  })

  it('returns 503 when Discord member fetch fails', async () => {
    t.prisma.panelRole.findMany.mockResolvedValueOnce([
      { roleId: BigInt('123'), roleName: 'VIP', slotLimit: 2, isStackable: false, displayName: null, isActive: true },
    ])
    t.discord.fetchAllMembers.mockRejectedValueOnce(new Error('Discord unavailable'))

    const res = await t.app.inject({ method: 'POST', url: '/api/admin/backfill/tiers', payload: {} })
    expect(res.statusCode).toBe(503)
  })

  it('updates tier label and slot limit for users matching a role', async () => {
    const roleId = '444555666777888999'
    t.prisma.panelRole.findMany.mockResolvedValueOnce([
      { roleId: BigInt(roleId), roleName: 'Veteran', slotLimit: 3, isStackable: false, displayName: 'Veteran', isActive: true },
    ])
    t.discord.fetchAllMembers.mockResolvedValueOnce([
      { id: BigInt('700'), name: 'Vet Player', username: 'vetp', roles: [roleId] },
    ])
    t.prisma.whitelistUser.findMany.mockResolvedValueOnce([
      { discordId: BigInt('700'), whitelistId: 10, guildId: GUILD_ID_BIGINT },
    ])
    t.prisma.whitelistUser.update.mockResolvedValueOnce({})

    const res = await t.app.inject({ method: 'POST', url: '/api/admin/backfill/tiers', payload: {} })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.ok).toBe(true)
    expect(body.updated).toBe(1)
    expect(t.prisma.whitelistUser.update).toHaveBeenCalledOnce()
  })
})

// ─── GET /role-stats ──────────────────────────────────────────────────────────

describe('GET /role-stats', () => {
  let t: TestApp

  beforeEach(async () => {
    t = await buildTestApp(async (app) => {
      await app.register(roleSyncRoutes, { prefix: '/api/admin' })
    })
  })

  it('returns { stats: [], gateway_mode: false } when no whitelist roles', async () => {
    t.prisma.panelRole.findMany.mockResolvedValueOnce([])

    const res = await t.app.inject({ method: 'GET', url: '/api/admin/role-stats' })
    expect(res.statusCode).toBe(200)

    const body = res.json()
    expect(body).toEqual({ stats: [], gateway_mode: false })
  })

  it('returns stats with correct shape for each role', async () => {
    const roleId = '555666777888999000'

    t.prisma.panelRole.findMany.mockResolvedValueOnce([
      { roleId: BigInt(roleId), roleName: 'VIP Tier' },
    ])

    // Discord fetchRoles returns live name
    t.discord.fetchRoles.mockResolvedValueOnce([
      { id: roleId, name: 'VIP Tier Live' },
    ])

    // fetchAllMembers returns 3 members, 2 have the role
    t.discord.fetchAllMembers.mockResolvedValueOnce([
      { id: BigInt('100'), roles: [roleId] },
      { id: BigInt('101'), roles: [roleId] },
      { id: BigInt('102'), roles: [] },
    ])

    // whitelistUser registered: 1 of the 2 role members is registered
    t.prisma.whitelistUser.findMany.mockResolvedValueOnce([
      { discordId: BigInt('100') },
    ])

    const res = await t.app.inject({ method: 'GET', url: '/api/admin/role-stats' })
    expect(res.statusCode).toBe(200)

    const body = res.json()
    expect(body.gateway_mode).toBe(false)
    expect(body.stats).toHaveLength(1)

    const stat = body.stats[0]
    expect(stat).toHaveProperty('role_id',            roleId)
    expect(stat).toHaveProperty('role_name',          'VIP Tier Live')
    expect(stat).toHaveProperty('discord_count',      2)
    expect(stat).toHaveProperty('registered_count',   1)
    expect(stat).toHaveProperty('unregistered_count', 1)
  })

  it('each stat has all required fields', async () => {
    t.prisma.panelRole.findMany.mockResolvedValueOnce([
      { roleId: BigInt('111222333444555666'), roleName: 'Some Role' },
    ])
    t.discord.fetchRoles.mockResolvedValueOnce([])
    t.discord.fetchAllMembers.mockResolvedValueOnce([])
    t.prisma.whitelistUser.findMany.mockResolvedValueOnce([])

    const res = await t.app.inject({ method: 'GET', url: '/api/admin/role-stats' })
    const body = res.json()

    expect(body.stats).toHaveLength(1)
    const stat = body.stats[0]
    expect(stat).toHaveProperty('role_id')
    expect(stat).toHaveProperty('role_name')
    expect(stat).toHaveProperty('discord_count')
    expect(stat).toHaveProperty('registered_count')
    expect(stat).toHaveProperty('unregistered_count')
    expect(typeof stat.role_id).toBe('string')
    expect(typeof stat.discord_count).toBe('number')
    expect(typeof stat.registered_count).toBe('number')
    expect(typeof stat.unregistered_count).toBe('number')
  })

  it('deduplicates same roleId appearing in multiple whitelists', async () => {
    const roleId = '777888999000111222'

    // Same role assigned to two different whitelists (whitelistId 1 and 2)
    t.prisma.panelRole.findMany.mockResolvedValueOnce([
      { roleId: BigInt(roleId), roleName: 'Dual Role' },
      { roleId: BigInt(roleId), roleName: 'Dual Role' },
    ])
    t.discord.fetchRoles.mockResolvedValueOnce([])
    t.discord.fetchAllMembers.mockResolvedValueOnce([])
    t.prisma.whitelistUser.findMany.mockResolvedValueOnce([])

    const res = await t.app.inject({ method: 'GET', url: '/api/admin/role-stats' })
    const body = res.json()

    // Should appear only once despite being in two whitelists
    expect(body.stats).toHaveLength(1)
  })
})
