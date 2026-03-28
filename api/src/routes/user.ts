/**
 * User-facing whitelist routes.
 * GET  /api/my-whitelist         — all whitelists visible to logged-in user
 * GET  /api/my-whitelist/:type   — user's identifiers for a specific whitelist
 * POST /api/my-whitelist/:type   — update user's identifiers
 * PUT  /api/my-whitelist/:type   — alias for POST
 */
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify"
import { syncOutputs } from "../services/output.js"
import { cache } from "../services/cache.js"

const STEAM64_RE = /^[0-9]{17}$/
const EOSID_RE = /^[0-9a-fA-F]{32}$/

async function requireAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!req.session.userId) {
    return reply.code(401).send({ error: "Not authenticated" })
  }
  if (!req.session.activeGuildId) {
    return reply.code(400).send({ error: "No guild selected" })
  }
}

export const userRoutes: FastifyPluginAsync = async (app) => {
  // GET /my-whitelist — all whitelists user qualifies for
  app.get("/my-whitelist", { preHandler: requireAuth }, async (req, reply) => {
    const guildId = BigInt(req.session.activeGuildId!)
    const discordId = BigInt(req.session.userId!)

    // Fetch member's roles from Discord
    let memberRoleIds: Set<string> = new Set()
    try {
      const member = await app.discord.fetchMember(guildId, discordId)
      if (member) memberRoleIds = new Set(member.roles)
    } catch { /* non-fatal */ }

    const whitelists = await app.prisma.whitelist.findMany({
      where: { guildId, enabled: true },
      orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    })
    const panels = await app.prisma.panel.findMany({
      where: { guildId, enabled: true },
    })

    // Check if user is an admin/mod for this guild (from session)
    const sessionGuild = req.session.guilds?.find((g) => g.id === String(guildId))
    const isAdmin = sessionGuild?.isAdmin ?? false

    const results: unknown[] = []

    for (const wl of whitelists) {
      // Find panel with tier category for this whitelist
      const panel = panels.find((p) => p.whitelistId === wl.id && p.tierCategoryId != null)

      let tierName: string | null = null
      let slots = 0

      // Admins/mods always get access with default slot limit
      if (isAdmin) {
        tierName = "Admin"
        slots = wl.defaultSlotLimit
      }

      if (panel?.tierCategoryId) {
        const entries = await app.prisma.tierEntry.findMany({
          where: { categoryId: panel.tierCategoryId, guildId, isActive: true },
        })
        const matched: Array<{ name: string; slots: number }> = []
        for (const te of entries) {
          if (memberRoleIds.has(String(te.roleId))) {
            matched.push({ name: te.displayName ?? te.roleName, slots: te.slotLimit })
          }
        }
        if (matched.length > 0) {
          if (wl.stackRoles) {
            slots = matched.reduce((sum, m) => sum + m.slots, 0)
            tierName = matched.map((m) => m.name).join(" + ")
          } else {
            const winner = matched.reduce((a, b) => (b.slots > a.slots ? b : a))
            slots = winner.slots
            tierName = winner.name
          }
        }
      }

      // Fall back to role_mappings
      if (slots <= 0 && memberRoleIds.size > 0) {
        const mappings = await app.prisma.roleMapping.findMany({
          where: { guildId, whitelistId: wl.id, isActive: true },
        })
        for (const rm of mappings) {
          if (memberRoleIds.has(String(rm.roleId))) {
            tierName = rm.roleName
            slots = rm.slotLimit
            break
          }
        }
      }

      if (slots <= 0) slots = wl.defaultSlotLimit

      // Get existing identifiers
      const identifiers = await app.prisma.whitelistIdentifier.findMany({
        where: { guildId, discordId, whitelistId: wl.id },
      })
      const steamIds = identifiers.filter((i) => i.idType === "steam64").map((i) => i.idValue)
      const eosIds = identifiers.filter((i) => i.idType === "eosid").map((i) => i.idValue)

      // Only show if user has tier access or existing entries
      if (tierName || identifiers.length > 0) {
        results.push({
          whitelist_slug: wl.slug,
          whitelist_name: wl.name,
          tier_name: tierName,
          effective_slot_limit: slots,
          steam_ids: steamIds,
          eos_ids: eosIds,
        })
      }
    }

    return reply.send(results)
  })

  // GET /my-whitelist/:type
  app.get<{ Params: { type: string } }>("/my-whitelist/:type", { preHandler: requireAuth }, async (req, reply) => {
    const guildId = BigInt(req.session.activeGuildId!)
    const discordId = BigInt(req.session.userId!)
    const { type } = req.params

    const wl = await app.prisma.whitelist.findUnique({ where: { guildId_slug: { guildId, slug: type } } })
    if (!wl) return reply.code(400).send({ error: "Invalid whitelist type." })

    const user = await app.prisma.whitelistUser.findUnique({
      where: { guildId_discordId_whitelistId: { guildId, discordId, whitelistId: wl.id } },
    })
    const identifiers = await app.prisma.whitelistIdentifier.findMany({
      where: { guildId, discordId, whitelistId: wl.id },
    })

    const steamIds = identifiers.filter((i) => i.idType === "steam64").map((i) => i.idValue)
    const eosIds = identifiers.filter((i) => i.idType === "eosid").map((i) => i.idValue)

    return reply.send({
      type,
      steam_ids: steamIds,
      eos_ids: eosIds,
      user_record: user ? {
        discord_name: user.discordName,
        status: user.status,
        slot_limit_override: user.slotLimitOverride,
        effective_slot_limit: user.effectiveSlotLimit,
        last_plan_name: user.lastPlanName,
      } : null,
    })
  })

  // POST /my-whitelist/:type (and PUT alias)
  const updateHandler = async (
    req: FastifyRequest<{ Params: { type: string }; Body: { steam_ids?: string[]; eos_ids?: string[] } }>,
    reply: FastifyReply,
  ) => {
    const guildId = BigInt(req.session.activeGuildId!)
    const discordId = BigInt(req.session.userId!)
    const { type } = req.params

    const wl = await app.prisma.whitelist.findUnique({ where: { guildId_slug: { guildId, slug: type } } })
    if (!wl) return reply.code(400).send({ error: "Invalid whitelist type." })
    if (!wl.enabled) return reply.code(400).send({ error: "This whitelist type is not enabled." })

    const { steam_ids = [], eos_ids = [] } = req.body ?? {}

    if (!Array.isArray(steam_ids) || !Array.isArray(eos_ids)) {
      return reply.code(400).send({ error: "steam_ids and eos_ids must be arrays." })
    }

    const errors: string[] = []
    for (const sid of steam_ids) { if (!STEAM64_RE.test(String(sid))) errors.push(`Invalid Steam64 ID: ${sid}`) }
    for (const eid of eos_ids) { if (!EOSID_RE.test(String(eid))) errors.push(`Invalid EOS ID: ${eid}`) }
    if (errors.length > 0) return reply.code(400).send({ error: "Validation failed.", details: errors })

    const user = await app.prisma.whitelistUser.findUnique({
      where: { guildId_discordId_whitelistId: { guildId, discordId, whitelistId: wl.id } },
    })
    const slotLimit = user?.effectiveSlotLimit || wl.defaultSlotLimit
    if (steam_ids.length + eos_ids.length > slotLimit) {
      return reply.code(400).send({ error: `Too many IDs. Your slot limit is ${slotLimit} total.` })
    }

    // Replace identifiers
    await app.prisma.whitelistIdentifier.deleteMany({ where: { guildId, discordId, whitelistId: wl.id } })
    const now = new Date()
    const identifiers = [
      ...steam_ids.map((sid) => ({
        guildId, discordId, whitelistId: wl.id,
        idType: "steam64", idValue: String(sid),
        isVerified: false, verificationSource: "web_dashboard",
        createdAt: now, updatedAt: now,
      })),
      ...eos_ids.map((eid) => ({
        guildId, discordId, whitelistId: wl.id,
        idType: "eosid", idValue: String(eid),
        isVerified: false, verificationSource: "web_dashboard",
        createdAt: now, updatedAt: now,
      })),
    ]
    if (identifiers.length > 0) {
      await app.prisma.whitelistIdentifier.createMany({ data: identifiers, skipDuplicates: true })
    }

    if (!user) {
      await app.prisma.whitelistUser.create({
        data: {
          guildId, discordId, whitelistId: wl.id,
          discordName: req.session.username ?? "Unknown",
          status: "active",
          effectiveSlotLimit: slotLimit,
          createdAt: now, updatedAt: now,
        },
      })
    }

    // Audit
    await app.prisma.auditLog.create({
      data: {
        guildId, actionType: "web_update_ids",
        actorDiscordId: discordId, targetDiscordId: discordId,
        details: `Updated ${type} IDs via web: ${steam_ids.length} steam, ${eos_ids.length} eos`,
        whitelistId: wl.id, createdAt: now,
      },
    })

    const outputs = await syncOutputs(app.prisma, guildId)
    cache.set(guildId, outputs)

    return reply.send({ ok: true, message: "Whitelist updated successfully." })
  }

  app.post<{ Params: { type: string }; Body: { steam_ids?: string[]; eos_ids?: string[] } }>(
    "/my-whitelist/:type", { preHandler: requireAuth }, updateHandler,
  )
  app.put<{ Params: { type: string }; Body: { steam_ids?: string[]; eos_ids?: string[] } }>(
    "/my-whitelist/:type", { preHandler: requireAuth }, updateHandler,
  )
}
