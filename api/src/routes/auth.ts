/**
 * Discord OAuth2 authentication routes.
 *
 * GET  /login            — redirect to Discord OAuth2
 * GET  /callback         — exchange code, build session
 * GET  /api/auth/session — return session info for frontend
 * GET  /logout           — clear session, redirect to "/"
 *
 * Port of bot/web_routes/auth.py.
 */
import type { FastifyPluginAsync } from "fastify"
import { randomBytes } from "crypto"
import { env } from "../lib/env.js"

// ─── Session type augmentation ────────────────────────────────────────────────

declare module "@fastify/session" {
  interface FastifySessionObject {
    oauthState?: string
  }
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DISCORD_API   = "https://discord.com/api/v10"
const OAUTH_SCOPES  = "identify guilds guilds.members.read"
const ADMINISTRATOR = 0x8n
const MANAGE_GUILD  = 0x20n

// ─── Routes ───────────────────────────────────────────────────────────────────

export const authRoutes: FastifyPluginAsync = async (app) => {
  // ── GET /login ──────────────────────────────────────────────────────────────

  app.get("/login", async (req, reply) => {
    const state = randomBytes(16).toString("hex")
    req.session.oauthState = state

    const params = new URLSearchParams({
      client_id:     env.DISCORD_CLIENT_ID,
      redirect_uri:  `${env.WEB_BASE_URL}/callback`,
      response_type: "code",
      scope:         OAUTH_SCOPES,
      state,
    })

    return reply.redirect(`https://discord.com/api/oauth2/authorize?${params}`)
  })

  // ── GET /callback ───────────────────────────────────────────────────────────

  app.get<{
    Querystring: { code?: string; state?: string; error?: string }
  }>("/callback", async (req, reply) => {
    const { code, state, error } = req.query

    if (error) {
      return reply.redirect(`${env.CORS_ORIGIN || env.WEB_BASE_URL}/dashboard?error=oauth_denied`)
    }

    if (!code || !state || state !== req.session.oauthState) {
      return reply.code(400).send({ error: "Invalid OAuth state" })
    }

    // ── Exchange code for access token ────────────────────────────────────────

    const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id:     env.DISCORD_CLIENT_ID,
        client_secret: env.DISCORD_CLIENT_SECRET,
        grant_type:    "authorization_code",
        code,
        redirect_uri:  `${env.WEB_BASE_URL}/callback`,
      }),
    })

    if (!tokenRes.ok) {
      app.log.error({ status: tokenRes.status }, "Discord token exchange failed")
      return reply.code(502).send({ error: "Token exchange failed" })
    }

    const tokenData = await tokenRes.json() as { access_token: string }
    const accessToken = tokenData.access_token

    // ── Fetch user + guilds ───────────────────────────────────────────────────

    const [discordUser, userGuilds] = await Promise.all([
      app.discord.fetchCurrentUser(accessToken),
      app.discord.fetchUserGuilds(accessToken),
    ])

    // ── Build mutual-guild list with admin/mod check ──────────────────────────

    type SessionGuild = { id: string; name: string; icon: string | null; isAdmin: boolean }
    const mutualGuilds: SessionGuild[] = []

    for (const ug of userGuilds) {
      const botGuild = app.discord.getGuild(BigInt(ug.id))
      if (!botGuild) continue  // bot is not in this guild

      // Fetch member info via user token (includes roles)
      let memberRoles: string[] = []
      try {
        const memberRes = await fetch(`${DISCORD_API}/users/@me/guilds/${ug.id}/member`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        })
        if (memberRes.ok) {
          const memberData = await memberRes.json() as { roles: string[] }
          memberRoles = memberData.roles ?? []
        }
      } catch {
        // non-fatal — member roles unavailable, fall back to permissions
      }

      // Check guild owner
      const isOwner = botGuild.ownerId === BigInt(discordUser.id)

      // Check permission bits (Discord sends permissions as a decimal string)
      const perms = BigInt(ug.permissions ?? "0")
      const hasAdminPerm = (perms & ADMINISTRATOR) === ADMINISTRATOR
        || (perms & MANAGE_GUILD) === MANAGE_GUILD

      // Check mod roles from bot_settings
      const modRoleSetting = await app.prisma.botSetting.findUnique({
        where: {
          guildId_settingKey: {
            guildId:    BigInt(ug.id),
            settingKey: "mod_role_ids",
          },
        },
      })
      const modRoleIds = modRoleSetting?.settingValue?.split(",").filter(Boolean) ?? []
      const hasModRole = memberRoles.some((r) => modRoleIds.includes(r))

      mutualGuilds.push({
        id:      ug.id,
        name:    ug.name,
        icon:    ug.icon,
        isAdmin: isOwner || hasAdminPerm || hasModRole,
      })
    }

    // ── Write session ─────────────────────────────────────────────────────────

    req.session.userId       = discordUser.id
    req.session.username     = discordUser.username
    req.session.avatar       = discordUser.avatar ?? undefined
    req.session.guilds       = mutualGuilds
    req.session.activeGuildId = mutualGuilds[0]?.id
    delete req.session.oauthState

    const dashboardUrl = `${env.CORS_ORIGIN || env.WEB_BASE_URL}/dashboard`
    return reply.redirect(dashboardUrl)
  })

  // ── GET /api/auth/session ───────────────────────────────────────────────────

  app.get("/api/auth/session", async (req, reply) => {
    if (!req.session.userId) {
      return reply.send({ logged_in: false })
    }

    const activeGuild = req.session.guilds?.find(
      (g) => g.id === req.session.activeGuildId,
    )

    return reply.send({
      logged_in:       true,
      user_id:         req.session.userId,
      username:        req.session.username,
      avatar:          req.session.avatar ?? null,
      guilds:          req.session.guilds ?? [],
      active_guild_id: req.session.activeGuildId ?? null,
      is_mod:          activeGuild?.isAdmin ?? false,
    })
  })

  // ── GET /logout ─────────────────────────────────────────────────────────────

  app.get("/logout", async (req, reply) => {
    await req.session.destroy()
    return reply.redirect("/")
  })
}
