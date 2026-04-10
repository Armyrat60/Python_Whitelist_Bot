/**
 * Redis client with graceful degradation.
 *
 * If REDIS_URL is not set or Redis is unreachable, all operations
 * silently return null/false — the app continues with in-memory fallbacks.
 */
import Redis from "ioredis"
import { env } from "./env.js"

let client: Redis | null = null
let isConnected = false

/**
 * Initialize the Redis connection. Safe to call even without REDIS_URL.
 */
export function initRedis(): Redis | null {
  if (!env.REDIS_URL) {
    console.log("[redis] REDIS_URL not set — using in-memory fallbacks")
    return null
  }

  try {
    client = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => {
        if (times > 5) return null // stop retrying after 5 attempts
        return Math.min(times * 200, 2000)
      },
      lazyConnect: false,
    })

    client.on("connect", () => {
      isConnected = true
      console.log("[redis] Connected")
    })

    client.on("error", (err) => {
      console.error("[redis] Error:", err.message)
      isConnected = false
    })

    client.on("close", () => {
      isConnected = false
    })

    return client
  } catch (err) {
    console.error("[redis] Failed to initialize:", (err as Error).message)
    return null
  }
}

/** Get the Redis client (may be null). */
export function getRedis(): Redis | null {
  return isConnected ? client : null
}

/** Check if Redis is available. */
export function redisAvailable(): boolean {
  return isConnected && client !== null
}

// ─── Cache Helpers ──────────────────────────────────────────────────────────

/** Get a cached value. Returns null if Redis unavailable or key missing. */
export async function cacheGet(key: string): Promise<string | null> {
  const r = getRedis()
  if (!r) return null
  try {
    return await r.get(key)
  } catch {
    return null
  }
}

/** Set a cached value with optional TTL (seconds). */
export async function cacheSet(key: string, value: string, ttlSeconds?: number): Promise<boolean> {
  const r = getRedis()
  if (!r) return false
  try {
    if (ttlSeconds) {
      await r.setex(key, ttlSeconds, value)
    } else {
      await r.set(key, value)
    }
    return true
  } catch {
    return false
  }
}

/** Delete a cached key. */
export async function cacheDel(key: string): Promise<boolean> {
  const r = getRedis()
  if (!r) return false
  try {
    await r.del(key)
    return true
  } catch {
    return false
  }
}

/** Get all keys matching a pattern (use sparingly). */
export async function cacheKeys(pattern: string): Promise<string[]> {
  const r = getRedis()
  if (!r) return []
  try {
    return await r.keys(pattern)
  } catch {
    return []
  }
}

/** Cleanup on shutdown. */
export async function closeRedis(): Promise<void> {
  if (client) {
    try { await client.quit() } catch { /* ignore */ }
    client = null
    isConnected = false
  }
}
