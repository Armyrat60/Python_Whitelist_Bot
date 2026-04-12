/**
 * Steam routes.
 * POST /api/steam/names              — resolve Steam64 IDs to persona names
 * GET  /api/steam/verify             — redirect to Steam OpenID login
 * GET  /api/steam/verify/callback    — handle Steam OpenID callback, mark identifier verified
 */
import type { FastifyPluginAsync } from "fastify"
import { env } from "../lib/env.js"
import { resolveSteamNames } from "../lib/steamNames.js"

const STEAM_OPENID = "https://steamcommunity.com/openid/login"
const STEAM_ID_RE  = /^https?:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/

export const steamRoutes: FastifyPluginAsync = async (app) => {
  // ── POST /api/internal/steam-names — bot-to-API proxy (no session required) ──
  app.post<{ Body: { steam_ids?: unknown[] } }>("/internal/steam-names", async (req, reply) => {
    const secret = process.env["BOT_INTERNAL_SECRET"] ?? ""
    if (!secret || req.headers["x-bot-secret"] !== secret) {
      return reply.code(401).send({ error: "Unauthorized" })
    }
    const rawIds = req.body?.steam_ids
    if (!rawIds || !Array.isArray(rawIds)) {
      return reply.code(400).send({ error: "steam_ids array required" })
    }
    const names = await resolveSteamNames(rawIds.slice(0, 100).map(String), app.prisma)
    return reply.send({ names })
  })

  app.post<{ Body: { steam_ids?: unknown[] } }>("/steam/names", { preHandler: app.requireAuth }, async (req, reply) => {
    const rawIds = req.body?.steam_ids
    if (!rawIds || !Array.isArray(rawIds)) {
      return reply.code(400).send({ error: "steam_ids array required" })
    }

    const steamIds = rawIds.slice(0, 100).map((id) => String(id))
    const names = await resolveSteamNames(steamIds, app.prisma)
    return reply.send({ names })
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

  // ── POST /api/internal/verify/create-code ──────────────────────────────────
  // Bot calls this to generate a temp verification code for in-game verification.
  app.post<{ Body: { guild_id: string; discord_id: string; id_type: string; id_value: string } }>(
    "/internal/verify/create-code",
    async (req, reply) => {
      const secret = process.env["BOT_INTERNAL_SECRET"] ?? ""
      if (!secret || req.headers["x-bot-secret"] !== secret) {
        return reply.code(401).send({ error: "Unauthorized" })
      }
      const { guild_id, discord_id, id_type, id_value } = req.body ?? {}
      if (!guild_id || !discord_id || !id_type || !id_value) {
        return reply.code(400).send({ error: "Missing required fields" })
      }

      // Invalidate any existing unused codes for this user+id
      await app.prisma.verificationToken.updateMany({
        where: { guildId: BigInt(guild_id), discordId: BigInt(discord_id), idValue: id_value, used: false },
        data: { used: true },
      })

      // Generate a 6-char alphanumeric code (uppercase, no ambiguous chars)
      const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
      let code = ""
      for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)]

      const expiresAt = new Date(Date.now() + 10 * 60 * 1000) // 10 minutes

      await app.prisma.verificationToken.create({
        data: {
          guildId: BigInt(guild_id),
          discordId: BigInt(discord_id),
          idType: id_type,
          idValue: id_value,
          code,
          expiresAt,
        },
      })

      return reply.send({ ok: true, code, expires_at: expiresAt.toISOString() })
    }
  )

  // ── POST /api/internal/verify/confirm ──────────────────────────────────────
  // Seeding-service or bot calls this to confirm a verification code from in-game chat.
  app.post<{ Body: { code: string; steam_id?: string; eos_id?: string } }>(
    "/internal/verify/confirm",
    async (req, reply) => {
      const secret = process.env["BOT_INTERNAL_SECRET"] ?? ""
      if (!secret || req.headers["x-bot-secret"] !== secret) {
        return reply.code(401).send({ error: "Unauthorized" })
      }
      const { code, steam_id, eos_id } = req.body ?? {}
      if (!code) return reply.code(400).send({ error: "code required" })

      const token = await app.prisma.verificationToken.findUnique({ where: { code } })
      if (!token) return reply.code(404).send({ error: "Invalid code" })
      if (token.used) return reply.code(410).send({ error: "Code already used" })
      if (token.expiresAt < new Date()) return reply.code(410).send({ error: "Code expired" })

      // Mark token as used
      await app.prisma.verificationToken.update({ where: { id: token.id }, data: { used: true } })

      // Mark the identifier as verified
      await app.prisma.whitelistIdentifier.updateMany({
        where: { guildId: token.guildId, discordId: token.discordId, idType: token.idType, idValue: token.idValue },
        data: { isVerified: true, verificationSource: "in_game_code", updatedAt: new Date() },
      })

      // If we got a Steam↔EOS pairing, link the EOS ID in squad_players
      if (steam_id && eos_id) {
        await app.prisma.squadPlayer.updateMany({
          where: { guildId: token.guildId, steamId: steam_id },
          data: { eosId: eos_id },
        }).catch(() => {})
      }

      return reply.send({
        ok: true,
        discord_id: token.discordId.toString(),
        guild_id: token.guildId.toString(),
        id_type: token.idType,
        id_value: token.idValue,
      })
    }
  )
}
