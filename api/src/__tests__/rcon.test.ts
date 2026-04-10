import { describe, it, expect, beforeEach, vi } from 'vitest'
import { buildTestApp, TEST_GUILD_ID, type TestApp } from './helpers.js'
import rconRoutes from '../routes/admin/rcon.js'

// ─── Mock squad-rcon module ─────────────────────────────────────────────────

vi.mock('../lib/squad-rcon.js', () => ({
  getServerInfo: vi.fn().mockResolvedValue({ name: 'Test', map: 'Yehorivka', gameMode: 'RAAS', playerCount: 50, maxPlayers: 100 }),
  getFullServerState: vi.fn().mockResolvedValue({ info: { name: 'Test', map: 'Yehorivka', gameMode: 'RAAS', playerCount: 50, maxPlayers: 100 }, teams: [], totalPlayers: 50 }),
  kickPlayer: vi.fn().mockResolvedValue('Kicked'),
  warnPlayer: vi.fn().mockResolvedValue('Warned'),
  broadcast: vi.fn().mockResolvedValue('Broadcast sent'),
  forceTeamChange: vi.fn().mockResolvedValue('Moved'),
  removeFromSquad: vi.fn().mockResolvedValue('Removed'),
  disbandSquad: vi.fn().mockResolvedValue('Disbanded'),
  demoteCommander: vi.fn().mockResolvedValue('Demoted'),
  changeLayer: vi.fn().mockResolvedValue('Changed'),
  setNextLayer: vi.fn().mockResolvedValue('Set'),
  endMatch: vi.fn().mockResolvedValue('Ended'),
  restartMatch: vi.fn().mockResolvedValue('Restarted'),
  listLayers: vi.fn().mockResolvedValue(['Yehorivka_RAAS_v1', 'Fallujah_Invasion_v1']),
  showCurrentMap: vi.fn().mockResolvedValue({ level: 'Yehorivka', layer: 'Yehorivka_RAAS_v1' }),
  showNextMap: vi.fn().mockResolvedValue({ level: 'Fallujah', layer: 'Fallujah_Invasion_v1' }),
  toRconConfig: vi.fn().mockReturnValue({ host: '127.0.0.1', port: 21114, password: 'test' }),
}))

vi.mock('../lib/rcon.js', () => ({
  testRconConnection: vi.fn().mockResolvedValue({ ok: true, message: 'Connected' }),
}))

// ─── Helpers ────────────────────────────────────────────────────────────────

const MOCK_SERVER = {
  id: 1,
  guildId: BigInt(TEST_GUILD_ID),
  name: 'Test Server',
  rconHost: '127.0.0.1',
  rconPort: 21114,
  rconPassword: 'test',
  sftpHost: null,
  sftpPort: 22,
  sftpUser: null,
  sftpPassword: null,
  sftpBasePath: '/SquadGame/ServerConfig',
  enabled: true,
  layers: null,
  createdAt: new Date(),
  updatedAt: new Date(),
}

function setupServer(t: TestApp) {
  t.prisma.gameServer.findFirst.mockResolvedValue(MOCK_SERVER as never)
  t.prisma.auditLog.create.mockResolvedValue({} as never)
  t.prisma.gameServer.update.mockResolvedValue(MOCK_SERVER as never)
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('RCON Routes', () => {
  let t: TestApp

  beforeEach(async () => {
    t = await buildTestApp(async (app) => {
      await app.register(rconRoutes, { prefix: '/api/admin' })
    })
    setupServer(t)
  })

  // ── Server not found ────────────────────────────────────────────────────

  describe('server resolution', () => {
    it('returns 404 for non-existent server', async () => {
      t.prisma.gameServer.findFirst.mockResolvedValueOnce(null as never)
      const res = await t.app.inject({ method: 'GET', url: '/api/admin/game-servers/999/rcon/status' })
      expect(res.statusCode).toBe(404)
    })
  })

  // ── Read endpoints ──────────────────────────────────────────────────────

  describe('GET /rcon/status', () => {
    it('returns server info', async () => {
      const res = await t.app.inject({ method: 'GET', url: '/api/admin/game-servers/1/rcon/status' })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.status).toBe('online')
      expect(body.name).toBe('Test')
    })
  })

  describe('GET /rcon/players', () => {
    it('returns server state with response time', async () => {
      const res = await t.app.inject({ method: 'GET', url: '/api/admin/game-servers/1/rcon/players' })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.totalPlayers).toBe(50)
      expect(body).toHaveProperty('responseTime')
    })
  })

  // ── Kick ────────────────────────────────────────────────────────────────

  describe('POST /rcon/kick', () => {
    it('returns 400 without player_id', async () => {
      const res = await t.app.inject({
        method: 'POST', url: '/api/admin/game-servers/1/rcon/kick',
        payload: {},
      })
      expect(res.statusCode).toBe(400)
    })

    it('kicks player and logs audit entry', async () => {
      const res = await t.app.inject({
        method: 'POST', url: '/api/admin/game-servers/1/rcon/kick',
        payload: { player_id: '1', player_name: 'TestPlayer', reason: 'AFK' },
      })
      expect(res.statusCode).toBe(200)
      expect(res.json().ok).toBe(true)
      expect(t.prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ actionType: 'rcon_kick' }),
        }),
      )
    })
  })

  // ── Warn ────────────────────────────────────────────────────────────────

  describe('POST /rcon/warn', () => {
    it('returns 400 without target or message', async () => {
      const res = await t.app.inject({
        method: 'POST', url: '/api/admin/game-servers/1/rcon/warn',
        payload: { target: '123' },
      })
      expect(res.statusCode).toBe(400)
    })

    it('warns player and logs audit', async () => {
      const res = await t.app.inject({
        method: 'POST', url: '/api/admin/game-servers/1/rcon/warn',
        payload: { target: '76561198000000000', message: 'Stop TKing' },
      })
      expect(res.statusCode).toBe(200)
      expect(res.json().ok).toBe(true)
      expect(t.prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ actionType: 'rcon_warn' }),
        }),
      )
    })
  })

  // ── Broadcast ───────────────────────────────────────────────────────────

  describe('POST /rcon/broadcast', () => {
    it('returns 400 without message', async () => {
      const res = await t.app.inject({
        method: 'POST', url: '/api/admin/game-servers/1/rcon/broadcast',
        payload: {},
      })
      expect(res.statusCode).toBe(400)
    })

    it('broadcasts and logs audit', async () => {
      const res = await t.app.inject({
        method: 'POST', url: '/api/admin/game-servers/1/rcon/broadcast',
        payload: { message: 'Server restarting in 5 minutes' },
      })
      expect(res.statusCode).toBe(200)
      expect(res.json().ok).toBe(true)
      expect(t.prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ actionType: 'rcon_broadcast' }),
        }),
      )
    })
  })

  // ── Force Team Change ───────────────────────────────────────────────────

  describe('POST /rcon/force-team-change', () => {
    it('returns 400 without player_id', async () => {
      const res = await t.app.inject({
        method: 'POST', url: '/api/admin/game-servers/1/rcon/force-team-change',
        payload: {},
      })
      expect(res.statusCode).toBe(400)
    })

    it('moves player and logs audit', async () => {
      const res = await t.app.inject({
        method: 'POST', url: '/api/admin/game-servers/1/rcon/force-team-change',
        payload: { player_id: '5', player_name: 'TestPlayer' },
      })
      expect(res.statusCode).toBe(200)
      expect(res.json().ok).toBe(true)
    })
  })

  // ── Disband Squad ───────────────────────────────────────────────────────

  describe('POST /rcon/disband-squad', () => {
    it('returns 400 without team_id or squad_id', async () => {
      const res = await t.app.inject({
        method: 'POST', url: '/api/admin/game-servers/1/rcon/disband-squad',
        payload: { team_id: '1' },
      })
      expect(res.statusCode).toBe(400)
    })

    it('disbands and logs audit', async () => {
      const res = await t.app.inject({
        method: 'POST', url: '/api/admin/game-servers/1/rcon/disband-squad',
        payload: { team_id: '1', squad_id: '3', squad_name: 'Squad 3' },
      })
      expect(res.statusCode).toBe(200)
      expect(res.json().ok).toBe(true)
    })
  })

  // ── Demote Commander ────────────────────────────────────────────────────

  describe('POST /rcon/demote-commander', () => {
    it('returns 400 without team_id', async () => {
      const res = await t.app.inject({
        method: 'POST', url: '/api/admin/game-servers/1/rcon/demote-commander',
        payload: {},
      })
      expect(res.statusCode).toBe(400)
    })

    it('demotes and logs audit', async () => {
      const res = await t.app.inject({
        method: 'POST', url: '/api/admin/game-servers/1/rcon/demote-commander',
        payload: { team_id: '1' },
      })
      expect(res.statusCode).toBe(200)
      expect(res.json().ok).toBe(true)
    })
  })

  // ── Change Layer ────────────────────────────────────────────────────────

  describe('POST /rcon/change-layer', () => {
    it('returns 400 without layer', async () => {
      const res = await t.app.inject({
        method: 'POST', url: '/api/admin/game-servers/1/rcon/change-layer',
        payload: {},
      })
      expect(res.statusCode).toBe(400)
    })

    it('changes layer and logs audit', async () => {
      const res = await t.app.inject({
        method: 'POST', url: '/api/admin/game-servers/1/rcon/change-layer',
        payload: { layer: 'Yehorivka_RAAS_v1' },
      })
      expect(res.statusCode).toBe(200)
      expect(res.json().ok).toBe(true)
      expect(t.prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ actionType: 'rcon_change_layer' }),
        }),
      )
    })
  })

  // ── Set Next Layer ──────────────────────────────────────────────────────

  describe('POST /rcon/set-next-layer', () => {
    it('returns 400 without layer', async () => {
      const res = await t.app.inject({
        method: 'POST', url: '/api/admin/game-servers/1/rcon/set-next-layer',
        payload: {},
      })
      expect(res.statusCode).toBe(400)
    })

    it('sets next layer and logs audit', async () => {
      const res = await t.app.inject({
        method: 'POST', url: '/api/admin/game-servers/1/rcon/set-next-layer',
        payload: { layer: 'Fallujah_Invasion_v1' },
      })
      expect(res.statusCode).toBe(200)
      expect(res.json().ok).toBe(true)
      expect(t.prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ actionType: 'rcon_set_next_layer' }),
        }),
      )
    })
  })

  // ── End Match ───────────────────────────────────────────────────────────

  describe('POST /rcon/end-match', () => {
    it('ends match and logs audit', async () => {
      const res = await t.app.inject({
        method: 'POST', url: '/api/admin/game-servers/1/rcon/end-match',
      })
      expect(res.statusCode).toBe(200)
      expect(res.json().ok).toBe(true)
      expect(t.prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ actionType: 'rcon_end_match' }),
        }),
      )
    })
  })

  // ── Restart Match ───────────────────────────────────────────────────────

  describe('POST /rcon/restart-match', () => {
    it('restarts match and logs audit', async () => {
      const res = await t.app.inject({
        method: 'POST', url: '/api/admin/game-servers/1/rcon/restart-match',
      })
      expect(res.statusCode).toBe(200)
      expect(res.json().ok).toBe(true)
      expect(t.prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ actionType: 'rcon_restart_match' }),
        }),
      )
    })
  })

  // ── Layers ──────────────────────────────────────────────────────────────

  describe('GET /rcon/layers', () => {
    it('fetches layers from server when no cache', async () => {
      const res = await t.app.inject({
        method: 'GET', url: '/api/admin/game-servers/1/rcon/layers',
      })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.layers).toEqual(['Yehorivka_RAAS_v1', 'Fallujah_Invasion_v1'])
      expect(body.fromCache).toBe(false)
    })

    it('returns cached layers when fresh', async () => {
      t.prisma.gameServer.findFirst.mockResolvedValueOnce({
        ...MOCK_SERVER,
        layers: { items: ['Cached_Layer_v1'], cachedAt: new Date().toISOString() },
      } as never)
      const res = await t.app.inject({
        method: 'GET', url: '/api/admin/game-servers/1/rcon/layers',
      })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.layers).toEqual(['Cached_Layer_v1'])
      expect(body.fromCache).toBe(true)
    })
  })

  // ── Current Map ─────────────────────────────────────────────────────────

  describe('GET /rcon/current-map', () => {
    it('returns current and next map', async () => {
      const res = await t.app.inject({
        method: 'GET', url: '/api/admin/game-servers/1/rcon/current-map',
      })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.current.layer).toBe('Yehorivka_RAAS_v1')
      expect(body.next.layer).toBe('Fallujah_Invasion_v1')
    })
  })

  // ── Test Connection ─────────────────────────────────────────────────────

  describe('POST /rcon/test', () => {
    it('returns connection test result', async () => {
      const res = await t.app.inject({
        method: 'POST', url: '/api/admin/game-servers/1/rcon/test',
      })
      expect(res.statusCode).toBe(200)
      expect(res.json().ok).toBe(true)
    })
  })

  // ── Permission tests ──────────────────────────────────────────────────

  describe('permission gating', () => {
    async function buildReadOnlyApp() {
      const app = await buildTestApp(
        async (a) => { await a.register(rconRoutes, { prefix: '/api/admin' }) },
        [{ id: TEST_GUILD_ID, name: 'Test Guild', icon: null, isAdmin: false, permissionLevel: 'granular', granularPermissions: { rcon_read: true } }],
      )
      setupServer(app)
      return app
    }

    it('kick requires rcon_kick permission', async () => {
      const a = await buildReadOnlyApp()
      const res = await a.app.inject({
        method: 'POST', url: '/api/admin/game-servers/1/rcon/kick',
        payload: { player_id: '1' },
      })
      expect(res.statusCode).toBe(403)
    })

    it('warn requires rcon_warn permission', async () => {
      const a = await buildReadOnlyApp()
      const res = await a.app.inject({
        method: 'POST', url: '/api/admin/game-servers/1/rcon/warn',
        payload: { target: '123', message: 'test' },
      })
      expect(res.statusCode).toBe(403)
    })

    it('broadcast requires rcon_broadcast permission', async () => {
      const a = await buildReadOnlyApp()
      const res = await a.app.inject({
        method: 'POST', url: '/api/admin/game-servers/1/rcon/broadcast',
        payload: { message: 'test' },
      })
      expect(res.statusCode).toBe(403)
    })

    it('change-layer requires rcon_map_change permission', async () => {
      const a = await buildReadOnlyApp()
      const res = await a.app.inject({
        method: 'POST', url: '/api/admin/game-servers/1/rcon/change-layer',
        payload: { layer: 'Yehorivka_RAAS_v1' },
      })
      expect(res.statusCode).toBe(403)
    })

    it('end-match requires rcon_map_change permission', async () => {
      const a = await buildReadOnlyApp()
      const res = await a.app.inject({
        method: 'POST', url: '/api/admin/game-servers/1/rcon/end-match',
      })
      expect(res.statusCode).toBe(403)
    })

    it('demote-commander requires rcon_demote permission', async () => {
      const a = await buildReadOnlyApp()
      const res = await a.app.inject({
        method: 'POST', url: '/api/admin/game-servers/1/rcon/demote-commander',
        payload: { team_id: '1' },
      })
      expect(res.statusCode).toBe(403)
    })

    it('read endpoints work with just rcon_read', async () => {
      const a = await buildReadOnlyApp()
      const status = await a.app.inject({ method: 'GET', url: '/api/admin/game-servers/1/rcon/status' })
      expect(status.statusCode).toBe(200)
      const players = await a.app.inject({ method: 'GET', url: '/api/admin/game-servers/1/rcon/players' })
      expect(players.statusCode).toBe(200)
    })
  })
})
