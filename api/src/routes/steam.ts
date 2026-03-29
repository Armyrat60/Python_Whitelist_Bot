/**
 * Steam name resolution routes.
 * POST /steam/names — resolve Steam64 IDs to persona names
 */
import type { FastifyPluginAsync } from "fastify"
import { env } from "../lib/env.js"

// In-memory cache: steamId -> { name, cachedAt }
const steamCache = new Map<string, { name: string; cachedAt: number }>()
const CACHE_TTL_MS = 30 * 60 * 1000  // 30 minutes

export const steamRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Body: { steam_ids?: unknown[] } }>("/steam/names", { preHandler: app.requireAuth }, async (req, reply) => {
    const rawIds = req.body?.steam_ids
    if (!rawIds || !Array.isArray(rawIds)) {
      return reply.code(400).send({ error: "steam_ids array required" })
    }

    const steamIds = rawIds.slice(0, 100).map((id) => String(id))
    const now = Date.now()
    const results: Record<string, string> = {}
    const uncached: string[] = []

    for (const sid of steamIds) {
      const cached = steamCache.get(sid)
      if (cached && now - cached.cachedAt < CACHE_TTL_MS) {
        results[sid] = cached.name
      } else {
        uncached.push(sid)
      }
    }

    const STEAM_API_KEY = process.env["STEAM_API_KEY"] ?? ""
    if (uncached.length > 0 && STEAM_API_KEY) {
      try {
        const idsParam = uncached.join(",")
        const url = `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${STEAM_API_KEY}&steamids=${idsParam}`
        const resp = await fetch(url)
        if (resp.ok) {
          const data = await resp.json() as { response?: { players?: Array<{ steamid: string; personaname: string }> } }
          for (const player of data.response?.players ?? []) {
            if (player.steamid) {
              results[player.steamid] = player.personaname ?? ""
              steamCache.set(player.steamid, { name: player.personaname ?? "", cachedAt: now })
            }
          }
        }
      } catch { /* non-fatal */ }
    }

    // Fill in blanks for unresolved IDs
    for (const sid of steamIds) {
      if (!(sid in results)) results[sid] = ""
    }

    return reply.send({ names: results })
  })
}
