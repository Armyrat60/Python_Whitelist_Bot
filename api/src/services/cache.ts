/**
 * In-memory whitelist file cache.
 *
 * Stores { filename -> content } per guild. Populated at startup and
 * refreshed on every sync (bot push or 5-min heartbeat).
 *
 * Port of WebServer._cache / _token_to_guild from bot/web.py.
 */

type GuildCache = Map<string, string>   // filename -> content

/** Cache entries older than this are considered stale and will be regenerated. */
const CACHE_TTL_MS = 60_000  // 60 seconds

class FileCache {
  private _cache = new Map<bigint, GuildCache>()
  private _tokenToGuild = new Map<string, bigint>()
  private _lastUpdated = new Map<bigint, number>()  // guildId -> timestamp

  set(guildId: bigint, outputs: Record<string, string>): void {
    this._cache.set(guildId, new Map(Object.entries(outputs)))
    this._lastUpdated.set(guildId, Date.now())
  }

  get(guildId: bigint, filename: string): string | null {
    return this._cache.get(guildId)?.get(filename) ?? null
  }

  hasGuild(guildId: bigint): boolean {
    return this._cache.has(guildId)
  }

  hasFile(guildId: bigint, filename: string): boolean {
    return this._cache.get(guildId)?.has(filename) ?? false
  }

  /** Returns true if the cache for this guild is older than CACHE_TTL_MS. */
  isStale(guildId: bigint): boolean {
    const ts = this._lastUpdated.get(guildId)
    if (!ts) return true
    return Date.now() - ts > CACHE_TTL_MS
  }

  /** Register token -> guild mapping (called after set()). */
  registerToken(token: string, guildId: bigint): void {
    this._tokenToGuild.set(token, guildId)
  }

  lookupToken(token: string): bigint | null {
    return this._tokenToGuild.get(token) ?? null
  }

  removeToken(token: string): void {
    this._tokenToGuild.delete(token)
  }

  fileCount(): number {
    let n = 0
    for (const g of this._cache.values()) n += g.size
    return n
  }
}

export const cache = new FileCache()
