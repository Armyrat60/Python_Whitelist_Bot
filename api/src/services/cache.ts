/**
 * Whitelist file cache — Redis-backed with in-memory fallback.
 *
 * Stores { filename -> content } per guild. Populated at startup and
 * refreshed on every sync (bot push or 5-min heartbeat).
 *
 * When Redis is available, files are cached there with 60s TTL.
 * Token → guild mappings are always kept in-memory (lightweight).
 * Falls back to pure in-memory if Redis is unavailable.
 */

import { cacheGet, cacheSet, cacheDel, cacheKeys, redisAvailable } from "../lib/redis.js"

type GuildCache = Map<string, string>   // filename -> content

/** Cache entries older than this are considered stale and will be regenerated. */
const CACHE_TTL_S = 60  // 60 seconds
const CACHE_TTL_MS = CACHE_TTL_S * 1000

class FileCache {
  // In-memory fallback (always populated as backup)
  private _cache = new Map<bigint, GuildCache>()
  private _tokenToGuild = new Map<string, bigint>()
  private _lastUpdated = new Map<bigint, number>()

  async set(guildId: bigint, outputs: Record<string, string>): Promise<void> {
    // Always update in-memory
    this._cache.set(guildId, new Map(Object.entries(outputs)))
    this._lastUpdated.set(guildId, Date.now())

    // Also push to Redis if available
    if (redisAvailable()) {
      for (const [filename, content] of Object.entries(outputs)) {
        await cacheSet(`wl:${guildId}:${filename}`, content, CACHE_TTL_S)
      }
      await cacheSet(`wl:${guildId}:__ts`, String(Date.now()), CACHE_TTL_S)
    }
  }

  async get(guildId: bigint, filename: string): Promise<string | null> {
    // Try Redis first
    if (redisAvailable()) {
      const val = await cacheGet(`wl:${guildId}:${filename}`)
      if (val !== null) return val
    }
    // Fall back to in-memory
    return this._cache.get(guildId)?.get(filename) ?? null
  }

  hasGuild(guildId: bigint): boolean {
    return this._cache.has(guildId)
  }

  async hasFile(guildId: bigint, filename: string): Promise<boolean> {
    if (redisAvailable()) {
      const val = await cacheGet(`wl:${guildId}:${filename}`)
      if (val !== null) return true
    }
    return this._cache.get(guildId)?.has(filename) ?? false
  }

  async isStale(guildId: bigint): Promise<boolean> {
    // Check Redis timestamp first
    if (redisAvailable()) {
      const ts = await cacheGet(`wl:${guildId}:__ts`)
      if (ts) {
        return Date.now() - parseInt(ts, 10) > CACHE_TTL_MS
      }
    }
    // Fall back to in-memory
    const ts = this._lastUpdated.get(guildId)
    if (!ts) return true
    return Date.now() - ts > CACHE_TTL_MS
  }

  /** Register token -> guild mapping (always in-memory, lightweight). */
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
