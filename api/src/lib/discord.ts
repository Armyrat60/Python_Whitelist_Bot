/**
 * Lightweight Discord REST client.
 *
 * Provides guild, channel, role, and member data without a full gateway
 * connection. Used by the web service (same role as DiscordRESTClient in
 * bot/web_main.py).
 */

const API_BASE = "https://discord.com/api/v10"

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LightGuild {
  id:      bigint
  name:    string
  icon:    string | null
  ownerId: bigint
}

export interface DiscordChannel {
  id:   string
  name: string
  type: number
}

export interface DiscordRole {
  id:   string
  name: string
}

export interface DiscordMember {
  id:       bigint
  name:     string
  username: string
  roles:    string[]
}

// ─── Client ───────────────────────────────────────────────────────────────────

export class DiscordRESTClient {
  private readonly headers: Record<string, string>
  private guilds = new Map<bigint, LightGuild>()

  constructor(token: string) {
    this.headers = { Authorization: `Bot ${token}` }
  }

  // ── Guild list ─────────────────────────────────────────────────────────────

  async fetchGuilds(): Promise<void> {
    const data = await this._get<Array<{ id: string; name: string; icon: string | null; owner_id: string }>>(
      "/users/@me/guilds",
    )
    this.guilds.clear()
    for (const g of data) {
      const guild: LightGuild = {
        id:      BigInt(g.id),
        name:    g.name,
        icon:    g.icon,
        ownerId: BigInt(g.owner_id ?? 0),
      }
      this.guilds.set(guild.id, guild)
    }
  }

  getGuilds(): LightGuild[] {
    return [...this.guilds.values()]
  }

  getGuild(guildId: bigint): LightGuild | null {
    return this.guilds.get(guildId) ?? null
  }

  guildCount(): number {
    return this.guilds.size
  }

  // ── Channels ───────────────────────────────────────────────────────────────

  async fetchChannels(guildId: bigint): Promise<DiscordChannel[]> {
    const data = await this._get<DiscordChannel[]>(`/guilds/${guildId}/channels`)
    return data.filter((ch) => ch.type === 0)  // text channels only
  }

  // ── Roles ──────────────────────────────────────────────────────────────────

  async fetchRoles(guildId: bigint): Promise<DiscordRole[]> {
    const data = await this._get<DiscordRole[]>(`/guilds/${guildId}/roles`)
    return data.filter((r) => r.name !== "@everyone")
  }

  // ── Members ────────────────────────────────────────────────────────────────

  async fetchMember(guildId: bigint, userId: bigint): Promise<DiscordMember | null> {
    try {
      const data = await this._get<{
        user: { id: string; username: string; global_name?: string }
        nick?: string
        roles: string[]
      }>(`/guilds/${guildId}/members/${userId}`)
      return {
        id:       BigInt(data.user.id),
        name:     data.nick ?? data.user.global_name ?? data.user.username,
        username: data.user.username,
        roles:    data.roles,
      }
    } catch {
      return null
    }
  }

  async fetchAllMembers(guildId: bigint): Promise<DiscordMember[]> {
    const results: DiscordMember[] = []
    let after = BigInt(0)

    while (true) {
      const params = new URLSearchParams({ limit: "1000" })
      if (after > 0n) params.set("after", String(after))

      const batch = await this._get<Array<{
        user: { id: string; username: string; global_name?: string }
        nick?: string
        roles: string[]
      }>>(`/guilds/${guildId}/members?${params}`)

      if (!batch.length) break

      for (const m of batch) {
        results.push({
          id:       BigInt(m.user.id),
          name:     m.nick ?? m.user.global_name ?? m.user.username,
          username: m.user.username,
          roles:    m.roles,
        })
      }

      if (batch.length < 1000) break
      after = BigInt(batch[batch.length - 1].user.id)
    }

    return results
  }

  async fetchMembersWithRole(guildId: bigint, roleId: bigint): Promise<DiscordMember[]> {
    const all = await this.fetchAllMembers(guildId)
    const roleStr = String(roleId)
    return all.filter((m) => m.roles.includes(roleStr))
  }

  // ── OAuth ──────────────────────────────────────────────────────────────────

  async fetchCurrentUser(accessToken: string): Promise<{ id: string; username: string; avatar: string | null }> {
    return this._getWithToken(accessToken, "/users/@me")
  }

  async fetchUserGuilds(accessToken: string): Promise<Array<{ id: string; name: string; icon: string | null; permissions: string }>> {
    return this._getWithToken(accessToken, "/users/@me/guilds")
  }

  // ── HTTP helpers ───────────────────────────────────────────────────────────

  private async _get<T>(path: string): Promise<T> {
    const res = await fetch(`${API_BASE}${path}`, { headers: this.headers })
    if (!res.ok) throw new Error(`Discord API ${path} returned ${res.status}`)
    return res.json() as Promise<T>
  }

  private async _getWithToken<T>(token: string, path: string): Promise<T> {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) throw new Error(`Discord API ${path} returned ${res.status}`)
    return res.json() as Promise<T>
  }
}
