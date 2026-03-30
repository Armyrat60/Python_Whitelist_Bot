/**
 * Steam routes.
 * POST /api/steam/names              — resolve Steam64 IDs to persona names
 * GET  /api/steam/verify             — redirect to Steam OpenID login
 * GET  /api/steam/verify/callback    — handle Steam OpenID callback, mark identifier verified
 */
import type { FastifyPluginAsync } from "fastify"
import { env } from "../lib/env.js"

const STEAM_OPENID = "https://steamcommunity.com/openid/login"
const STEAM_ID_RE  = /^https?:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/

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

  // ── GET /api/steam/verify — redirect to Steam OpenID ────────────────────────

  app.get("/steam/verify", { preHandler: app.requireAuth }, async (req, reply) => {
    const returnTo = `${env.WEB_BASE_URL}/api/steam/verify/callback`
    const realm    = env.WEB_BASE_URL || "https://localhost"

    const params = new URLSearchParams({
      "openid.ns":         "http://specs.openid.net/auth/2.0",
      "openid.mode":       "checkid_setup",
      "openid.return_to":  returnTo,
      "openid.realm":      realm,
      "openid.identity":   "http://specs.openid.net/auth/2.0/identifier_select",
      "openid.claimed_id": "http://specs.openid.net/auth/2.0/identifier_select",
    })

    return reply.redirect(`${STEAM_OPENID}?${params}`)
  })

  // ── GET /api/steam/verify/callback — Steam OpenID response ──────────────────

  app.get("/steam/verify/callback", async (req, reply) => {
    const frontendBase = env.CORS_ORIGIN || env.WEB_BASE_URL
    const returnUrl    = (suffix: string) => `${frontendBase}/my-whitelist?${suffix}`

    if (!req.session.userId || !req.session.activeGuildId) {
      return reply.redirect(returnUrl("steam_verify=error&reason=not_logged_in"))
    }

    const query = req.query as Record<string, string>

    if (query["openid.mode"] !== "id_res") {
      return reply.redirect(returnUrl("steam_verify=cancelled"))
    }

    // Extract Steam64 ID from claimed_id
    const claimed = query["openid.claimed_id"] ?? ""
    const idMatch = claimed.match(STEAM_ID_RE)
    if (!idMatch) {
      return reply.redirect(returnUrl("steam_verify=error&reason=invalid_id"))
    }
    const steam64 = idMatch[1]

    // Validate with Steam — resend params with mode=check_authentication
    const verifyParams = new URLSearchParams(Object.entries(query))
    verifyParams.set("openid.mode", "check_authentication")

    try {
      const steamRes = await fetch(STEAM_OPENID, {
        method:  "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body:    verifyParams.toString(),
      })
      if (!steamRes.ok) throw new Error(`Steam returned ${steamRes.status}`)
      const body = await steamRes.text()
      if (!body.includes("is_valid:true")) {
        return reply.redirect(returnUrl("steam_verify=error&reason=invalid_sig"))
      }
    } catch {
      return reply.redirect(returnUrl("steam_verify=error&reason=steam_unreachable"))
    }

    // Find the identifier in the user's registered IDs
    const guildId   = BigInt(req.session.activeGuildId)
    const discordId = BigInt(req.session.userId)

    const existing = await app.prisma.whitelistIdentifier.findFirst({
      where: { guildId, discordId, idType: "steam64", idValue: steam64 },
    })

    if (!existing) {
      return reply.redirect(returnUrl(`steam_verify=error&reason=id_not_registered&steam_id=${steam64}`))
    }

    // Mark all matching identifiers for this user as verified
    await app.prisma.whitelistIdentifier.updateMany({
      where: { guildId, discordId, idType: "steam64", idValue: steam64 },
      data:  { isVerified: true, verificationSource: "steam_openid", updatedAt: new Date() },
    })

    return reply.redirect(returnUrl(`steam_verify=success&steam_id=${steam64}`))
  })
}
