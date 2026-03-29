import { describe, it, expect, beforeEach } from 'vitest'
import { buildTestApp, type TestApp } from './helpers.js'
import notificationRoutes from '../routes/admin/notifications.js'

describe('GET /notifications', () => {
  let t: TestApp

  beforeEach(async () => {
    t = await buildTestApp(async (app) => {
      await app.register(notificationRoutes, { prefix: '/api/admin' })
    })
  })

  it('returns routing map and 8 event_types when no rows exist', async () => {
    t.prisma.notificationRouting.findMany.mockResolvedValueOnce([])

    const res = await t.app.inject({ method: 'GET', url: '/api/admin/notifications' })
    expect(res.statusCode).toBe(200)

    const body = res.json()
    expect(body).toHaveProperty('routing')
    expect(body).toHaveProperty('event_types')
    expect(Object.keys(body.event_types)).toHaveLength(8)
    expect(body.routing).toEqual({})
  })

  it('event_types includes all expected keys with label and description', async () => {
    t.prisma.notificationRouting.findMany.mockResolvedValueOnce([])

    const res = await t.app.inject({ method: 'GET', url: '/api/admin/notifications' })
    const body = res.json()

    const expectedKeys = [
      'user_joined',
      'user_removed',
      'user_left_discord',
      'role_lost',
      'role_returned',
      'report',
      'bot_alert',
      'admin_action',
    ]

    for (const key of expectedKeys) {
      expect(body.event_types).toHaveProperty(key)
      expect(body.event_types[key]).toHaveProperty('label')
      expect(body.event_types[key]).toHaveProperty('description')
      expect(typeof body.event_types[key].label).toBe('string')
      expect(typeof body.event_types[key].description).toBe('string')
    }
  })

  it('returns existing routing rows as a flat map', async () => {
    t.prisma.notificationRouting.findMany.mockResolvedValueOnce([
      { eventType: 'user_joined', channelId: '999000111222333' },
      { eventType: 'bot_alert',   channelId: '444555666777888' },
    ])

    const res = await t.app.inject({ method: 'GET', url: '/api/admin/notifications' })
    expect(res.statusCode).toBe(200)

    const body = res.json()
    expect(body.routing).toEqual({
      user_joined: '999000111222333',
      bot_alert:   '444555666777888',
    })
  })
})

describe('PUT /notifications', () => {
  let t: TestApp

  beforeEach(async () => {
    t = await buildTestApp(async (app) => {
      await app.register(notificationRoutes, { prefix: '/api/admin' })
    })
  })

  it('saves routing entries and returns ok', async () => {
    t.prisma.notificationRouting.upsert.mockResolvedValue({
      eventType: 'user_joined', channelId: '123456789012345678',
    })

    const res = await t.app.inject({
      method:  'PUT',
      url:     '/api/admin/notifications',
      headers: { 'content-type': 'application/json' },
      payload: { user_joined: '123456789012345678', bot_alert: '987654321098765432' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
    expect(t.prisma.notificationRouting.upsert).toHaveBeenCalledTimes(2)
  })

  it('rejects a non-object body with 400', async () => {
    const res = await t.app.inject({
      method:  'PUT',
      url:     '/api/admin/notifications',
      headers: { 'content-type': 'application/json' },
      payload: ['not', 'an', 'object'],
    })

    expect(res.statusCode).toBe(400)
  })
})

describe('GET after PUT returns updated routing', () => {
  let t: TestApp

  beforeEach(async () => {
    t = await buildTestApp(async (app) => {
      await app.register(notificationRoutes, { prefix: '/api/admin' })
    })
  })

  it('reflects saved values on next GET', async () => {
    // First PUT
    t.prisma.notificationRouting.upsert.mockResolvedValue({})
    await t.app.inject({
      method:  'PUT',
      url:     '/api/admin/notifications',
      headers: { 'content-type': 'application/json' },
      payload: { report: '111222333444555666' },
    })

    // GET returns the saved value (mocked from DB)
    t.prisma.notificationRouting.findMany.mockResolvedValueOnce([
      { eventType: 'report', channelId: '111222333444555666' },
    ])

    const res = await t.app.inject({ method: 'GET', url: '/api/admin/notifications' })
    expect(res.json().routing).toEqual({ report: '111222333444555666' })
  })
})
