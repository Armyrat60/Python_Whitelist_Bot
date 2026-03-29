import { describe, it, expect, beforeEach } from 'vitest'
import { buildTestApp, TEST_GUILD_ID, type TestApp } from './helpers.js'
import panelRoutes from '../routes/admin/panels.js'

const GUILD_ID_BIGINT = BigInt(TEST_GUILD_ID)

function makePanel(overrides: Record<string, unknown> = {}) {
  return {
    id:               1,
    guildId:          GUILD_ID_BIGINT,
    name:             'Test Panel',
    channelId:        null,
    logChannelId:     null,
    whitelistId:      null,
    panelMessageId:   null,
    isDefault:        false,
    enabled:          true,
    showRoleMentions: false,
    createdAt:        new Date(),
    updatedAt:        new Date(),
    ...overrides,
  }
}

describe('GET /panels', () => {
  let t: TestApp

  beforeEach(async () => {
    t = await buildTestApp(async (app) => {
      await app.register(panelRoutes, { prefix: '/api/admin' })
    })
  })

  it('returns { panels: [] } when no panels exist', async () => {
    t.prisma.panel.findMany.mockResolvedValueOnce([])

    const res = await t.app.inject({ method: 'GET', url: '/api/admin/panels' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ panels: [] })
  })

  it('returns panels with correct snake_case shape', async () => {
    t.prisma.panel.findMany.mockResolvedValueOnce([
      makePanel({ id: 1, name: 'Main', channelId: BigInt('999888777666555444'), isDefault: true }),
    ])

    const res = await t.app.inject({ method: 'GET', url: '/api/admin/panels' })
    expect(res.statusCode).toBe(200)

    const { panels } = res.json()
    expect(panels).toHaveLength(1)
    expect(panels[0]).toMatchObject({
      id:                 1,
      name:               'Main',
      channel_id:         '999888777666555444',
      log_channel_id:     null,
      whitelist_id:       null,
      panel_message_id:   null,
      is_default:         true,
      enabled:            true,
      show_role_mentions: false,
    })
  })
})

describe('POST /panels', () => {
  let t: TestApp

  beforeEach(async () => {
    t = await buildTestApp(async (app) => {
      await app.register(panelRoutes, { prefix: '/api/admin' })
    })
  })

  it('creates a panel and returns { ok, id, name }', async () => {
    t.prisma.panel.count.mockResolvedValueOnce(0)
    t.prisma.panel.create.mockResolvedValueOnce(makePanel({ id: 5, name: 'New Panel' }))

    const res = await t.app.inject({
      method:  'POST',
      url:     '/api/admin/panels',
      headers: { 'content-type': 'application/json' },
      payload: { name: 'New Panel' },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({ ok: true, id: 5, name: 'New Panel' })
  })

  it('returns 400 when name is missing', async () => {
    const res = await t.app.inject({
      method:  'POST',
      url:     '/api/admin/panels',
      headers: { 'content-type': 'application/json' },
      payload: {},
    })

    expect(res.statusCode).toBe(400)
  })

  it('returns 400 when panel limit reached', async () => {
    t.prisma.panel.count.mockResolvedValueOnce(5)

    const res = await t.app.inject({
      method:  'POST',
      url:     '/api/admin/panels',
      headers: { 'content-type': 'application/json' },
      payload: { name: 'Over Limit' },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/maximum/i)
  })
})

describe('PUT /panels/:id', () => {
  let t: TestApp

  beforeEach(async () => {
    t = await buildTestApp(async (app) => {
      await app.register(panelRoutes, { prefix: '/api/admin' })
    })
  })

  it('queues a panel refresh and returns { ok, panel_id }', async () => {
    t.prisma.panel.findFirst.mockResolvedValueOnce(makePanel({ id: 1 }))
    t.prisma.panel.update.mockResolvedValueOnce(makePanel({ id: 1, name: 'Updated' }))
    t.prisma.panelRefreshQueue.create.mockResolvedValueOnce({})

    const res = await t.app.inject({
      method:  'PUT',
      url:     '/api/admin/panels/1',
      headers: { 'content-type': 'application/json' },
      payload: { name: 'Updated' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ ok: true, panel_id: 1 })
    expect(t.prisma.panelRefreshQueue.create).toHaveBeenCalledOnce()
  })

  it('returns 404 when panel not found', async () => {
    t.prisma.panel.findFirst.mockResolvedValueOnce(null)

    const res = await t.app.inject({
      method:  'PUT',
      url:     '/api/admin/panels/999',
      headers: { 'content-type': 'application/json' },
      payload: { name: 'X' },
    })

    expect(res.statusCode).toBe(404)
  })
})

describe('DELETE /panels/:id', () => {
  let t: TestApp

  beforeEach(async () => {
    t = await buildTestApp(async (app) => {
      await app.register(panelRoutes, { prefix: '/api/admin' })
    })
  })

  it('queues a delete action when channel+message exist', async () => {
    t.prisma.panel.count.mockResolvedValueOnce(2)
    t.prisma.panel.findFirst.mockResolvedValueOnce(
      makePanel({ id: 1, channelId: BigInt('777'), panelMessageId: BigInt('888') })
    )
    t.prisma.panelRefreshQueue.create.mockResolvedValueOnce({})
    t.prisma.panel.delete.mockResolvedValueOnce({})

    const res = await t.app.inject({ method: 'DELETE', url: '/api/admin/panels/1' })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
    expect(t.prisma.panelRefreshQueue.create).toHaveBeenCalledOnce()
    const call = t.prisma.panelRefreshQueue.create.mock.calls[0][0] as { data: Record<string, unknown> }
    expect(call.data.action).toBe('delete')
  })

  it('returns 400 when trying to delete the last panel', async () => {
    t.prisma.panel.count.mockResolvedValueOnce(1)

    const res = await t.app.inject({ method: 'DELETE', url: '/api/admin/panels/1' })

    expect(res.statusCode).toBe(400)
  })
})

describe('POST /panels/:id/push', () => {
  let t: TestApp

  beforeEach(async () => {
    t = await buildTestApp(async (app) => {
      await app.register(panelRoutes, { prefix: '/api/admin' })
    })
  })

  it('queues a refresh and returns { ok, queued: true }', async () => {
    t.prisma.panel.findFirst.mockResolvedValueOnce(makePanel({ id: 1 }))
    t.prisma.panelRefreshQueue.create.mockResolvedValueOnce({})

    const res = await t.app.inject({ method: 'POST', url: '/api/admin/panels/1/push' })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true, queued: true })
    expect(t.prisma.panelRefreshQueue.create).toHaveBeenCalledOnce()
    const call = t.prisma.panelRefreshQueue.create.mock.calls[0][0] as { data: Record<string, unknown> }
    expect(call.data.reason).toBe('manual_push')
  })

  it('returns 404 when panel not found', async () => {
    t.prisma.panel.findFirst.mockResolvedValueOnce(null)

    const res = await t.app.inject({ method: 'POST', url: '/api/admin/panels/999/push' })

    expect(res.statusCode).toBe(404)
  })
})
