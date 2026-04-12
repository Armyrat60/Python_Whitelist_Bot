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
import { randomBytes, createHmac } from "crypto"
import { env } from "../lib/env.js"

// ─── OAuth state helpers ───────────────────────────────────────────────────────
// State is stored in a signed cookie rather than the in-memory session so it
// survives server restarts and doesn't require server-side session storage.

function signState(state: string): string {
  const sig = createHmac("sha256", env.WEB_SESSION_SECRET).update(state).digest("hex").slice(0, 16)
  return `${state}.${sig}`
}

function verifyState(cookie: string, urlState: string): boolean {
  const dot = cookie.lastIndexOf(".")
  if (dot < 0) return false
  const stateValue = cookie.slice(0, dot)
  const sig = cookie.slice(dot + 1)
  const expected = createHmac("sha256", env.WEB_SESSION_SECRET).update(stateValue).digest("hex").slice(0, 16)
  return sig === expected && stateValue === urlState
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DISCORD_API   = "https://discord.com/api/v10"
const OAUTH_SCOPES  = "identify guilds guilds.members.read connections"
const ADMINISTRATOR = 0x8n
const MANAGE_GUILD  = 0x20n

// ─── Routes ───────────────────────────────────────────────────────────────────

export const authRoutes: FastifyPluginAsync = async (app) => {
  // ── GET /login ──────────────────────────────────────────────────────────────

  app.get("/login", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req, reply) => {
    const state = randomBytes(16).toString("hex")
    const isSecure = env.NODE_ENV === "production"

    reply.setCookie("oauth_state", signState(state), {
      httpOnly: true,
      secure: isSecure,
      sameSite: "lax",
      maxAge: 300,  // 5 minutes — enough time to complete OAuth
      path: "/",
    })

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

    const stateCookie = req.cookies.oauth_state ?? ""
    if (!code || !state || !verifyState(stateCookie, state)) {
      return reply.code(400).send({ error: "Invalid OAuth state" })
    }
    reply.clearCookie("oauth_state", { path: "/" })

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

    // ── Build mutual-guild list with permission level ─────────────────────────

    type PermissionLevel = "owner" | "admin" | "roster_manager" | "viewer" | "granular"
    type SessionGuild = { id: string; name: string; icon: string | null; isAdmin: boolean; permissionLevel: PermissionLevel; granularPermissions?: import("../lib/permissions.js").GranularPermissions }
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
        where: { guildId_settingKey: { guildId: BigInt(ug.id), settingKey: "mod_role_id" } },
      })
      const modRoleIds = modRoleSetting?.settingValue?.split(",").filter(Boolean) ?? []
      const hasModRole = memberRoles.some((r) => modRoleIds.includes(r))

      // Check explicit dashboard_permissions grant (by user ID)
      const explicitGrant = await app.prisma.dashboardPermission.findUnique({
        where: { guildId_discordId: { guildId: BigInt(ug.id), discordId: discordUser.id } },
      })

      // Check role-based grants — find all matching roles
      let allRoleGrants: Array<{ permissionLevel: string; permissions: unknown }> = []
      if (memberRoles.length > 0) {
        allRoleGrants = await app.prisma.dashboardRolePermission.findMany({
          where: { guildId: BigInt(ug.id), roleId: { in: memberRoles } },
          select: { permissionLevel: true, permissions: true },
        })
      }

      // Resolve permission level (highest wins; user grant takes priority over role grant at same level)
      const LEVEL_RANK: Record<string, number> = { granular: 2, roster_manager: 1, viewer: 0 }
      const allGrants = [
        ...(explicitGrant ? [{ permissionLevel: explicitGrant.permissionLevel, permissions: explicitGrant.permissions }] : []),
        ...allRoleGrants,
      ]
      const highestGrant = allGrants.length > 0
        ? allGrants.reduce((best, cur) =>
            (LEVEL_RANK[cur.permissionLevel] ?? -1) > (LEVEL_RANK[best.permissionLevel] ?? -1) ? cur : best
          )
        : null
      const effectiveGrant = highestGrant?.permissionLevel

      let permissionLevel: PermissionLevel
      if (isOwner) {
        permissionLevel = "owner"
      } else if (hasAdminPerm || hasModRole) {
        permissionLevel = "admin"
      } else if (effectiveGrant === "granular") {
        permissionLevel = "granular"
      } else if (effectiveGrant === "roster_manager") {
        permissionLevel = "roster_manager"
      } else if (effectiveGrant === "viewer") {
        permissionLevel = "viewer"
      } else {
        continue  // no access — skip this guild
      }

      // Resolve granular permissions
      const { resolvePermissions } = await import("../lib/permissions.js")
      const granularPermissions = resolvePermissions(
        permissionLevel,
        allGrants.map((g) => ({
          permissionLevel: g.permissionLevel,
          permissions: g.permissions as import("../lib/permissions.js").GranularPermissions | null,
        })),
      )

      mutualGuilds.push({
        id:              ug.id,
        name:            ug.name,
        icon:            ug.icon,
        isAdmin:         permissionLevel === "owner" || permissionLevel === "admin",
        permissionLevel,
        granularPermissions,
      })
    }

    // ── Auto-link Steam from Discord connections ──────────────────────────────
    // Only if auto_link_steam is enabled for at least one guild (default: true)

    try {
      const connRes = await fetch(`${DISCORD_API}/users/@me/connections`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      if (connRes.ok) {
        const connections = await connRes.json() as Array<{ type: string; id: string; verified: boolean; visibility: number }>
        const steamConn = connections.find((c) => c.type === "steam" && c.verified)
        if (steamConn) {
          // Auto-link Steam ID to all mutual guilds
          const discordId = BigInt(discordUser.id)
          let notified = false
          for (const guild of mutualGuilds) {
            const guildId = BigInt(guild.id)
            // Check if auto-linking is enabled for this guild (default: true)
            const autoLinkSetting = await app.prisma.botSetting.findUnique({
              where: { guildId_settingKey: { guildId, settingKey: "auto_link_steam" } },
            })
            if (autoLinkSetting?.settingValue === "false") continue
            // Check if this Steam ID is already linked for this user+guild
            const existing = await app.prisma.$queryRaw<{ count: bigint }[]>`
              SELECT COUNT(*)::bigint AS count FROM whitelist_identifiers
              WHERE guild_id = ${guildId} AND discord_id = ${discordId}
                AND id_type = 'steam64' AND id_value = ${steamConn.id} AND is_verified = TRUE
            `
            if (existing[0]?.count && existing[0].count > 0n) continue // already linked
            // Remove orphaned/imported entries (negative discordId) for this Steam ID
            // to prevent conflicts when a real user links the same ID
            await app.prisma.$executeRaw`
              DELETE FROM whitelist_identifiers
              WHERE guild_id = ${guildId} AND id_type = 'steam64' AND id_value = ${steamConn.id}
                AND discord_id < 0
            `
            // Insert the Steam link (verified via Discord connection)
            await app.prisma.$executeRaw`
              INSERT INTO whitelist_identifiers (guild_id, discord_id, id_type, id_value, is_verified, verification_source, created_at, updated_at)
              VALUES (${guildId}, ${discordId}, 'steam64', ${steamConn.id}, TRUE, 'discord_connection', NOW(), NOW())
            `
            // Also link in squad_players if they exist
            await app.prisma.squadPlayer.updateMany({
              where: { guildId, steamId: steamConn.id, discordId: null },
              data: { discordId },
            })
            // Send one DM notification — but only if we haven't already notified this user+steam combo
            if (!notified) {
              const alreadySent = await app.prisma.$queryRaw<{ count: bigint }[]>`
                SELECT COUNT(*)::bigint AS count FROM seeding_notifications
                WHERE event_type = 'steam_account_linked'
                  AND payload->>'discord_id' = ${discordUser.id}
                  AND payload->>'steam_id' = ${steamConn.id}
              `.catch(() => [{ count: 0n }])
              if (!alreadySent[0]?.count || alreadySent[0].count === 0n) {
                notified = true
                await app.prisma.$executeRaw`
                  INSERT INTO seeding_notifications (guild_id, event_type, payload, created_at)
                  VALUES (${guildId}, 'steam_account_linked', ${JSON.stringify({
                    discord_id: discordUser.id,
                    steam_id: steamConn.id,
                    username: discordUser.username,
                  })}::jsonb, NOW())
                `.catch(() => {}) // non-fatal
              }
            }
          }
          app.log.info(`Auto-linked Steam ${steamConn.id} for Discord user ${discordUser.id}`)
        }
      }
    } catch (err) {
      app.log.debug({ err }, "Failed to fetch Discord connections (non-fatal)")
    }

    // ── Write session ─────────────────────────────────────────────────────────

    req.session.userId       = discordUser.id
    req.session.username     = discordUser.username
    req.session.avatar       = discordUser.avatar ?? undefined
    req.session.guilds       = mutualGuilds
    req.session.activeGuildId = mutualGuilds[0]?.id
    // oauth_state cookie already cleared above after state verification
    await req.session.save()  // flush session to cookie before redirect

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
      logged_in:        true,
      user_id:          req.session.userId,
      username:         req.session.username,
      avatar:           req.session.avatar ?? null,
      guilds:           req.session.guilds ?? [],
      active_guild_id:  req.session.activeGuildId ?? null,
      is_mod:           activeGuild?.isAdmin ?? false,
      permission_level: activeGuild?.permissionLevel ?? null,
      granular_permissions: activeGuild?.granularPermissions ?? null,
    })
  })

  // ── GET /logout ─────────────────────────────────────────────────────────────

  app.get("/logout", async (req, reply) => {
    await req.session.destroy()
    return reply.redirect("/")
  })
}
