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
vi.mock('../services/token.js', () => ({
  getFileToken: vi.fn().mockReturnValue('test-token'),
  getFileUrl:   vi.fn().mockReturnValue('http://localhost/wl/test-token/test.txt'),
}))

import whitelistRoutes from '../routes/admin/whitelists.js'

const GUILD_ID_BIGINT = BigInt(TEST_GUILD_ID)

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

describe('POST /types/:type/toggle', () => {
  let t: TestApp

  beforeEach(async () => {
    t = await buildTestApp(async (app) => {
      await app.register(whitelistRoutes, { prefix: '/api/admin' })
    })
  })

  it('queues a panel refresh for each linked panel when toggling', async () => {
    // Whitelist starts enabled=true, will toggle to false
    t.prisma.whitelist.findUnique.mockResolvedValueOnce(makeWhitelist({ enabled: true }))
    t.prisma.whitelist.update.mockResolvedValueOnce(makeWhitelist({ enabled: false }))

    // Two panels linked to this whitelist
    t.prisma.panel.findMany.mockResolvedValueOnce([
      { id: 1 },
      { id: 2 },
    ])
    t.prisma.panelRefreshQueue.create.mockResolvedValue({})

    // syncOutputs mock will be called (handled by vi.mock above)
    t.prisma.botSetting.findUnique.mockResolvedValue(null)

    const res = await t.app.inject({
      method: 'POST',
      url:    '/api/admin/types/test/toggle',
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.ok).toBe(true)
    expect(body.type).toBe('test')
    expect(body.enabled).toBe(false)

    // Two panelRefreshQueue.create calls — one per panel
    expect(t.prisma.panelRefreshQueue.create).toHaveBeenCalledTimes(2)

    const calls = t.prisma.panelRefreshQueue.create.mock.calls as Array<[{ data: Record<string, unknown> }]>
    const reasons = calls.map((c) => c[0].data.reason)
    expect(reasons).toEqual(['whitelist_toggled', 'whitelist_toggled'])

    const actions = calls.map((c) => c[0].data.action)
    expect(actions).toEqual(['refresh', 'refresh'])
  })

  it('queues no refresh when no panels are linked', async () => {
    t.prisma.whitelist.findUnique.mockResolvedValueOnce(makeWhitelist({ enabled: false }))
    t.prisma.whitelist.update.mockResolvedValueOnce(makeWhitelist({ enabled: true }))
    t.prisma.panel.findMany.mockResolvedValueOnce([])
    t.prisma.botSetting.findUnique.mockResolvedValue(null)

    const res = await t.app.inject({
      method: 'POST',
      url:    '/api/admin/types/test/toggle',
    })

    expect(res.statusCode).toBe(200)
    expect(t.prisma.panelRefreshQueue.create).not.toHaveBeenCalled()
  })

  it('returns 400 for an unknown whitelist slug', async () => {
    t.prisma.whitelist.findUnique.mockResolvedValueOnce(null)

    const res = await t.app.inject({
      method: 'POST',
      url:    '/api/admin/types/nonexistent/toggle',
    })

    expect(res.statusCode).toBe(400)
    expect(res.json()).toHaveProperty('error')
  })

  it('toggles enabled from false to true', async () => {
    t.prisma.whitelist.findUnique.mockResolvedValueOnce(makeWhitelist({ enabled: false }))
    t.prisma.whitelist.update.mockResolvedValueOnce(makeWhitelist({ enabled: true }))
    t.prisma.panel.findMany.mockResolvedValueOnce([])
    t.prisma.botSetting.findUnique.mockResolvedValue(null)

    const res = await t.app.inject({
      method: 'POST',
      url:    '/api/admin/types/test/toggle',
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().enabled).toBe(true)
  })
})
