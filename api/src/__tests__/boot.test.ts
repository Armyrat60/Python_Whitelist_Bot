/**
 * Boot test — registers EVERY route plugin on a single app.
 *
 * Purpose: catch FST_ERR_DUPLICATED_ROUTE and other startup crashes
 * before they reach Railway. This test runs in under a second locally
 * with no real DB or Discord connection required.
 *
 * If this test fails, the API will also fail to start in production.
 */
import { describe, it, expect } from 'vitest'
import { buildTestApp } from './helpers.js'

// Admin routes
import importExportRoutes    from '../routes/admin/importexport.js'
import roleSyncRoutes        from '../routes/admin/rolesync.js'
import reconcileRoutes       from '../routes/admin/reconcile.js'
import { adminSettingsRoutes } from '../routes/admin/settings.js'
import whitelistRoutes       from '../routes/admin/whitelists.js'
import groupRoutes           from '../routes/admin/groups.js'
import panelRoutes           from '../routes/admin/panels.js'
import panelRoleRoutes       from '../routes/admin/panel-roles.js'
import categoryRoutes        from '../routes/admin/categories.js'
import userRoutes            from '../routes/admin/users.js'
import playerRoutes          from '../routes/admin/players.js'
import auditRoutes           from '../routes/admin/audit.js'
import notificationRoutes    from '../routes/admin/notifications.js'
import permissionsRoutes     from '../routes/admin/permissions.js'
import bridgeRoutes          from '../routes/admin/bridge.js'
import jobRoutes             from '../routes/admin/jobs.js'

// Non-admin routes
import { authRoutes }        from '../routes/auth.js'
import { guildRoutes }       from '../routes/guilds.js'
import { userRoutes as myWhitelistRoutes } from '../routes/user.js'
import { steamRoutes }       from '../routes/steam.js'

describe('API boot', () => {
  it('registers all routes without conflicts or crashes', async () => {
    // buildTestApp calls app.ready() internally — any FST_ERR_DUPLICATED_ROUTE
    // or registration error will reject the promise and fail this test.
    const { app } = await buildTestApp(async (app) => {
      // Non-admin routes
      await app.register(authRoutes)
      await app.register(guildRoutes,          { prefix: '/api' })
      await app.register(myWhitelistRoutes,    { prefix: '/api' })
      await app.register(steamRoutes,          { prefix: '/api' })

      // Admin routes — same prefixes as server.ts
      await app.register(adminSettingsRoutes,  { prefix: '/api/admin' })
      await app.register(whitelistRoutes,      { prefix: '/api/admin' })
      await app.register(groupRoutes,          { prefix: '/api/admin' })
      await app.register(panelRoutes,          { prefix: '/api/admin' })
      await app.register(panelRoleRoutes,      { prefix: '/api/admin' })
      await app.register(categoryRoutes,       { prefix: '/api/admin' })
      await app.register(userRoutes,           { prefix: '/api/admin' })
      await app.register(playerRoutes,         { prefix: '/api/admin' })
      await app.register(auditRoutes,          { prefix: '/api/admin' })
      await app.register(notificationRoutes,   { prefix: '/api/admin' })
      await app.register(permissionsRoutes,    { prefix: '/api/admin' })
      await app.register(importExportRoutes,   { prefix: '/api/admin' })
      await app.register(roleSyncRoutes,       { prefix: '/api/admin' })
      await app.register(reconcileRoutes,      { prefix: '/api/admin' })
      await app.register(bridgeRoutes,         { prefix: '/api/admin' })
      await app.register(jobRoutes,            { prefix: '/api/admin' })
    })

    // App started successfully — close cleanly
    await app.close()
    expect(true).toBe(true)
  })
})
