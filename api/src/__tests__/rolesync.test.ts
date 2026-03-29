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

describe('GET /role-stats', () => {
  let t: TestApp

  beforeEach(async () => {
    t = await buildTestApp(async (app) => {
      await app.register(roleSyncRoutes, { prefix: '/api/admin' })
    })
  })

  it('returns { stats: [], gateway_mode: false } when no tier entries or role mappings', async () => {
    t.prisma.tierEntry.findMany.mockResolvedValueOnce([])
    t.prisma.roleMapping.findMany.mockResolvedValueOnce([])

    const res = await t.app.inject({ method: 'GET', url: '/api/admin/role-stats' })
    expect(res.statusCode).toBe(200)

    const body = res.json()
    expect(body).toEqual({ stats: [], gateway_mode: false })
  })

  it('returns stats with correct shape for each role', async () => {
    const roleId = '555666777888999000'

    t.prisma.tierEntry.findMany.mockResolvedValueOnce([
      { roleId: BigInt(roleId), roleName: 'VIP Tier' },
    ])
    t.prisma.roleMapping.findMany.mockResolvedValueOnce([])

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
    t.prisma.tierEntry.findMany.mockResolvedValueOnce([
      { roleId: BigInt('111222333444555666'), roleName: 'Some Role' },
    ])
    t.prisma.roleMapping.findMany.mockResolvedValueOnce([])
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

  it('deduplicates roles appearing in both tier entries and role mappings', async () => {
    const roleId = '777888999000111222'

    t.prisma.tierEntry.findMany.mockResolvedValueOnce([
      { roleId: BigInt(roleId), roleName: 'Dual Role' },
    ])
    t.prisma.roleMapping.findMany.mockResolvedValueOnce([
      { roleId: BigInt(roleId), roleName: 'Dual Role' },
    ])
    t.discord.fetchRoles.mockResolvedValueOnce([])
    t.discord.fetchAllMembers.mockResolvedValueOnce([])
    t.prisma.whitelistUser.findMany.mockResolvedValueOnce([])

    const res = await t.app.inject({ method: 'GET', url: '/api/admin/role-stats' })
    const body = res.json()

    // Should appear only once despite being in both lists
    expect(body.stats).toHaveLength(1)
  })
})
