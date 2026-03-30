/**
 * Steam name resolution with 3-tier caching.
 * Lookup order: in-memory → DB (steam_name_cache) → Steam API
 *
 * Import and call cacheSteamNames() anywhere identifiers are saved
 * to keep the cache warm without waiting for a display request.
 */
import type { PrismaClient } from "@prisma/client"

// In-memory cache: steamId -> { name, cachedAt }
const steamCache = new Map<string, { name: string; cachedAt: number }>()
const CACHE_TTL_MS = 30 * 60 * 1000  // 30 minutes

export async function resolveSteamNames(
  steamIds: string[],
  prisma?: PrismaClient,
): Promise<Record<string, string>> {
  if (!steamIds.length) return {}

  const now = Date.now()
  const results: Record<string, string> = {}
  let uncached: string[] = []

  // 1. In-memory cache
  for (const sid of steamIds) {
    const cached = steamCache.get(sid)
    if (cached && now - cached.cachedAt < CACHE_TTL_MS) {
      results[sid] = cached.name
    } else {
      uncached.push(sid)
    }
  }

  // 2. DB cache
  if (uncached.length > 0 && prisma) {
    try {
      const dbRows = await prisma.steamNameCache.findMany({ where: { steamId: { in: uncached } } })
      for (const row of dbRows) {
        results[row.steamId] = row.personaName
        steamCache.set(row.steamId, { name: row.personaName, cachedAt: now })
      }
      uncached = uncached.filter((sid) => !(sid in results))
    } catch { /* non-fatal */ }
  }

  // 3. Steam API
  const STEAM_API_KEY = process.env["STEAM_API_KEY"] ?? ""
  if (uncached.length > 0 && STEAM_API_KEY) {
    try {
      const url = `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${STEAM_API_KEY}&steamids=${uncached.join(",")}`
      const resp = await fetch(url)
      if (resp.ok) {
        const data = await resp.json() as { response?: { players?: Array<{ steamid: string; personaname: string }> } }
        const toCache: Array<{ steamId: string; personaName: string; cachedAt: Date }> = []
        for (const player of data.response?.players ?? []) {
          if (player.steamid) {
            results[player.steamid] = player.personaname ?? ""
            steamCache.set(player.steamid, { name: player.personaname ?? "", cachedAt: now })
            if (player.personaname) toCache.push({ steamId: player.steamid, personaName: player.personaname, cachedAt: new Date() })
          }
        }
        if (toCache.length > 0 && prisma) {
          for (const entry of toCache) {
            prisma.steamNameCache.upsert({
              where:  { steamId: entry.steamId },
              update: { personaName: entry.personaName, cachedAt: entry.cachedAt },
              create: entry,
            }).catch(() => { /* non-fatal */ })
          }
        }
      }
    } catch { /* non-fatal */ }
  }

  for (const sid of steamIds) {
    if (!(sid in results)) results[sid] = ""
  }

  return results
}

/** Fire-and-forget: warm the cache for a list of Steam IDs without blocking the caller. */
export function warmSteamCache(steamIds: string[], prisma: PrismaClient): void {
  if (!steamIds.length) return
  resolveSteamNames(steamIds, prisma).catch(() => { /* non-fatal */ })
}
