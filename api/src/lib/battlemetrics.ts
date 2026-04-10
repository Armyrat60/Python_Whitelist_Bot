/**
 * BattleMetrics REST client.
 *
 * Fetches player hours, server info, and player lookups from the
 * BattleMetrics API. Uses JSON:API format.
 *
 * Endpoints (from SquadOps proven pattern):
 *   POST /players/match               — resolve Steam ID → BM player ID
 *   GET  /players/{id}/servers/{sid}   — player-server timePlayed (all-time)
 *   GET  /players/{id}/time-played-history/{sid}?start=&stop= — period hours
 *   GET  /servers/{id}                 — server details
 */

const BM_API = "https://api.battlemetrics.com"

// ─── Types ───────────────────────────────────────────────────────────────────

export interface BMPlayerServerInfo {
  firstSeen: string | null
  lastSeen: string | null
  timePlayed: number          // seconds (all-time)
  online: boolean
}

export interface BMPlayerHours {
  bmId: string
  bmName: string | null
  serverName: string | null
  hoursAllTime: number
  hours30d: number
  firstSeen: string | null
  lastSeen: string | null
  online: boolean
}

interface BMMatchResponse {
  data: Array<{
    type: string
    attributes: { identifier: string }
    relationships?: {
      player?: { data?: { id: string } }
    }
  }>
}

interface BMPlayerServerResponse {
  data: {
    attributes: {
      firstSeen: string
      lastSeen: string
      timePlayed: number
      online: boolean
    }
  }
  included?: Array<{
    type: string
    id: string
    attributes: Record<string, unknown>
  }>
}

interface BMTimePlayedResponse {
  data: Array<{
    attributes: { value: number }  // seconds
  }>
}

interface BMServerResponse {
  data: {
    id: string
    attributes: {
      name: string
      ip: string
      port: number
      players: number
      maxPlayers: number
      status: string
    }
  }
}

interface BMPlayerResponse {
  data: {
    id: string
    attributes: {
      name: string
    }
  }
}

// ─── Client ──────────────────────────────────────────────────────────────────

export class BattleMetricsClient {
  private readonly token: string

  constructor(token: string) {
    this.token = token
  }

  /**
   * Resolve a Steam64 ID to a BattleMetrics player ID.
   * Returns null if not found.
   */
  async matchPlayer(steamId: string): Promise<string | null> {
    const body = {
      data: [
        {
          type: "identifier",
          attributes: {
            type: "steamID",
            identifier: steamId,
          },
        },
      ],
    }

    const res = await this._post<BMMatchResponse>("/players/match", body)
    const match = res.data?.[0]
    return match?.relationships?.player?.data?.id ?? null
  }

  /**
   * Get basic player info (name).
   */
  async getPlayer(bmId: string): Promise<{ id: string; name: string } | null> {
    try {
      const res = await this._get<BMPlayerResponse>(`/players/${bmId}`)
      return { id: res.data.id, name: res.data.attributes.name }
    } catch {
      return null
    }
  }

  /**
   * Get player-server relationship (all-time timePlayed, firstSeen, lastSeen, online).
   */
  async getPlayerServerInfo(bmId: string, serverId: string): Promise<BMPlayerServerInfo | null> {
    try {
      const res = await this._get<BMPlayerServerResponse>(`/players/${bmId}/servers/${serverId}`)
      return {
        firstSeen:  res.data.attributes.firstSeen,
        lastSeen:   res.data.attributes.lastSeen,
        timePlayed: res.data.attributes.timePlayed,
        online:     res.data.attributes.online,
      }
    } catch {
      return null
    }
  }

  /**
   * Get time played for a specific period (e.g., last 30 days).
   * Returns hours as a number.
   */
  async getTimePlayed(bmId: string, serverId: string, days: number): Promise<number> {
    const stop = new Date().toISOString()
    const start = new Date(Date.now() - days * 86400000).toISOString()

    try {
      const res = await this._get<BMTimePlayedResponse>(
        `/players/${bmId}/time-played-history/${serverId}?start=${start}&stop=${stop}`
      )
      const totalSeconds = res.data?.reduce((sum, entry) => sum + (entry.attributes.value ?? 0), 0) ?? 0
      return Math.round((totalSeconds / 3600) * 100) / 100
    } catch {
      return 0
    }
  }

  /**
   * Get full player hours breakdown for a server.
   * Combines all-time + 30-day data.
   */
  async getPlayerHours(steamId: string, serverId: string): Promise<BMPlayerHours | null> {
    const bmId = await this.matchPlayer(steamId)
    if (!bmId) return null

    const [player, serverInfo, hours30d] = await Promise.all([
      this.getPlayer(bmId),
      this.getPlayerServerInfo(bmId, serverId),
      this.getTimePlayed(bmId, serverId, 30),
    ])

    if (!serverInfo) return null

    return {
      bmId,
      bmName: player?.name ?? null,
      serverName: null,  // filled by caller if needed
      hoursAllTime: Math.round((serverInfo.timePlayed / 3600) * 100) / 100,
      hours30d,
      firstSeen: serverInfo.firstSeen,
      lastSeen: serverInfo.lastSeen,
      online: serverInfo.online,
    }
  }

  /**
   * Get server info (validates server ID and returns name/status).
   */
  async getServerInfo(serverId: string): Promise<{
    id: string
    name: string
    players: number
    maxPlayers: number
    status: string
  } | null> {
    try {
      const res = await this._get<BMServerResponse>(`/servers/${serverId}`)
      return {
        id:         res.data.id,
        name:       res.data.attributes.name,
        players:    res.data.attributes.players,
        maxPlayers: res.data.attributes.maxPlayers,
        status:     res.data.attributes.status,
      }
    } catch {
      return null
    }
  }

  /**
   * Validate the API token by fetching account servers.
   */
  async testConnection(): Promise<{ ok: boolean; message: string }> {
    try {
      const res = await fetch(`${BM_API}/servers?page[size]=1`, {
        headers: this._headers(),
      })
      if (!res.ok) {
        if (res.status === 401) return { ok: false, message: "Invalid API token" }
        return { ok: false, message: `BattleMetrics returned ${res.status}` }
      }
      return { ok: true, message: "Connected to BattleMetrics" }
    } catch (err) {
      return { ok: false, message: `Connection failed: ${(err as Error).message}` }
    }
  }

  // ── HTTP helpers ──────────────────────────────────────────────────────────

  private _headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    }
  }

  private async _get<T>(path: string): Promise<T> {
    const res = await fetch(`${BM_API}${path}`, { headers: this._headers() })
    if (!res.ok) throw new Error(`BM API ${path} returned ${res.status}`)
    return res.json() as Promise<T>
  }

  private async _post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${BM_API}${path}`, {
      method: "POST",
      headers: this._headers(),
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`BM API POST ${path} returned ${res.status}`)
    return res.json() as Promise<T>
  }
}
