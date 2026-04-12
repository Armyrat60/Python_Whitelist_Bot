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

    // Check if user is an admin/mod for this guild (from session)
    const sessionGuild = req.session.guilds?.find((g) => g.id === String(guildId))
    const isAdmin = sessionGuild?.isAdmin ?? false

    const results: unknown[] = []

    for (const wl of whitelists) {
      let tierName: string | null = null
      let slots = 0

      // Admins/mods always get access with default slot limit
      if (isAdmin) {
        tierName = "Admin"
        slots = wl.defaultSlotLimit
      }

      // Check panel roles for this user's Discord roles
      // panel_roles are per-panel; gather all active roles from panels linked to this whitelist
      if (memberRoleIds.size > 0) {
        const wlRoles = await app.prisma.panelRole.findMany({
          where: { guildId, isActive: true, panel: { whitelistId: wl.id, enabled: true } },
        })
        const stackable: Array<{ name: string; slots: number }> = []
        const nonStackable: Array<{ name: string; slots: number }> = []
        for (const r of wlRoles) {
          if (!memberRoleIds.has(String(r.roleId))) continue
          const entry = { name: r.displayName ?? r.roleName, slots: r.slotLimit }
          if (r.isStackable) stackable.push(entry)
          else nonStackable.push(entry)
        }
        if (stackable.length > 0 || nonStackable.length > 0) {
          const stackSlots = stackable.reduce((s, m) => s + m.slots, 0)
          const best = nonStackable.reduce((a, b) => (b.slots > a.slots ? b : a), { name: "", slots: 0 })
          slots = stackSlots + best.slots
          tierName = [...stackable.map(m => m.name), ...(best.slots > 0 ? [best.name] : [])].join(" + ") || null
        }
      }

      if (slots <= 0) slots = wl.defaultSlotLimit

      // Get existing identifiers — include both whitelist-specific and global (NULL whitelist_id) links
      const identifiers = await app.prisma.whitelistIdentifier.findMany({
        where: { guildId, discordId, OR: [{ whitelistId: wl.id }, { whitelistId: null }] },
      })
      // Deduplicate: if same ID exists both globally and per-whitelist, keep the per-whitelist one
      const deduped = new Map<string, typeof identifiers[number]>()
      for (const ident of identifiers) {
        const key = `${ident.idType}:${ident.idValue}`
        const existing = deduped.get(key)
        if (!existing || (ident.whitelistId !== null)) {
          deduped.set(key, ident)
        }
      }
      const dedupedIdentifiers = Array.from(deduped.values())
      const steamIds = dedupedIdentifiers.filter((i) => i.idType === "steam64").map((i) => i.idValue)
      const eosIds = dedupedIdentifiers.filter((i) => i.idType === "eosid").map((i) => i.idValue)
      const verifiedSteamIds = dedupedIdentifiers.filter((i) => i.idType === "steam64" && i.isVerified).map((i) => i.idValue)
      const verifiedEosIds = dedupedIdentifiers.filter((i) => i.idType === "eosid" && i.isVerified).map((i) => i.idValue)

      // Build linking status per identifier
      const linkedIds: Record<string, string> = {}
      for (const ident of dedupedIdentifiers) {
        if (ident.isVerified) {
          linkedIds[ident.idValue] = ident.verificationSource === "discord_connection"
            ? "discord" : ident.verificationSource === "steam_oauth"
            ? "steam" : ident.verificationSource === "bridge"
            ? "bridge" : "verified"
        }
      }

      // Fetch user record for status / expiry / category
      const userRecord = await app.prisma.whitelistUser.findUnique({
        where: { guildId_discordId_whitelistId: { guildId, discordId, whitelistId: wl.id } },
        include: { category: { select: { name: true } } },
      })

      // Fallback: if live Discord role lookup yielded no match but the bot previously
      // stored an effective slot limit (written on Discord /whitelist usage), trust that.
      if (slots <= wl.defaultSlotLimit && !tierName && userRecord?.effectiveSlotLimit && userRecord.effectiveSlotLimit > wl.defaultSlotLimit) {
        slots = userRecord.effectiveSlotLimit
        tierName = userRecord.lastPlanName ?? null
      }

      // Only show if user has tier access, existing IDs, or an active record
      // Skip manual/imported whitelists that are inactive — these are stale imports
      // and the IDs are already visible on the Discord whitelist card if linked
      if (wl.isManual && userRecord?.status !== "active") continue
      const hasContent = dedupedIdentifiers.length > 0 || (userRecord && userRecord.status === "active")
      if (tierName || hasContent) {
        results.push({
          whitelist_slug: wl.slug,
          whitelist_name: wl.name,
          is_manual: wl.isManual,
          tier_name: tierName,
          effective_slot_limit: slots,
          steam_ids: steamIds,
          eos_ids: eosIds,
          verified_steam_ids: verifiedSteamIds,
          verified_eos_ids: verifiedEosIds,
          linked_ids: linkedIds,
          status: userRecord?.status ?? null,
          expires_at: userRecord?.expiresAt?.toISOString() ?? null,
          category_name: userRecord?.category?.name ?? null,
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

    // Replace identifiers atomically
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

    try {
    await app.prisma.$transaction(async (tx) => {
      // Check for cross-user conflicts before inserting
      for (const ident of identifiers) {
        const conflict = await tx.whitelistIdentifier.findFirst({
          where: {
            guildId, idValue: ident.idValue, discordId: { not: discordId },
            idType: { in: ident.idType === "steam64" ? ["steam64", "steamid"] : [ident.idType] },
          },
          select: { discordId: true },
        })
        if (conflict) {
          if (conflict.discordId < 0n) {
            // Auto-remove orphaned (imported) entries
            await tx.whitelistIdentifier.deleteMany({
              where: { guildId, discordId: conflict.discordId, idValue: ident.idValue,
                idType: { in: ident.idType === "steam64" ? ["steam64", "steamid"] : [ident.idType] } },
            })
          } else {
            throw new Error(`${ident.idType === "steam64" ? "Steam" : "EOS"} ID ${ident.idValue} is already registered to another user.`)
          }
        }
      }

      await tx.whitelistIdentifier.deleteMany({ where: { guildId, discordId, whitelistId: wl.id } })

      if (identifiers.length > 0) {
        await tx.whitelistIdentifier.createMany({ data: identifiers, skipDuplicates: true })
      }

      if (!user) {
        await tx.whitelistUser.create({
          data: {
            guildId, discordId, whitelistId: wl.id,
            discordName: req.session.username ?? "Unknown",
            status: "active",
            effectiveSlotLimit: slotLimit,
            createdAt: now, updatedAt: now,
          },
        })
      }

      await tx.auditLog.create({
        data: {
          guildId, actionType: "web_update_ids",
          actorDiscordId: discordId, targetDiscordId: discordId,
          details: `Updated ${type} IDs via web: ${steam_ids.length} steam, ${eos_ids.length} eos`,
          whitelistId: wl.id, createdAt: now,
        },
      })
    })
    } catch (err) {
      if (err instanceof Error && err.message.includes("already registered to")) {
        return reply.code(409).send({ error: err.message })
      }
      throw err
    }

    const outputs = await syncOutputs(app.prisma, guildId)
    await cache.set(guildId, outputs)

    return reply.send({ ok: true, message: "Whitelist updated successfully." })
  }

  app.post<{ Params: { type: string }; Body: { steam_ids?: string[]; eos_ids?: string[] } }>(
    "/my-whitelist/:type", { preHandler: requireAuth }, updateHandler,
  )
  app.put<{ Params: { type: string }; Body: { steam_ids?: string[]; eos_ids?: string[] } }>(
    "/my-whitelist/:type", { preHandler: requireAuth }, updateHandler,
  )

  // ── Account Linking ───────────────────────────────────────────────────────

  // GET /my-linked-accounts — show user's linked Steam/EOS IDs
  app.get("/my-linked-accounts", { preHandler: requireAuth }, async (req, reply) => {
    const guildId = BigInt(req.session.activeGuildId!)
    const discordId = BigInt(req.session.userId!)

    // Get all linked identifiers for this user (across all whitelists)
    const identifiers = await app.prisma.whitelistIdentifier.findMany({
      where: { guildId, discordId },
      select: { idType: true, idValue: true, isVerified: true, verificationSource: true },
    })

    // Get seeding stats if they have any
    const seedingPoints = await app.prisma.seedingPoints.findMany({
      where: { guildId },
    })
    // Find this user's points by matching their Steam IDs
    const steamIds = identifiers.filter((i) => i.idType === "steam64" || i.idType === "steamid").map((i) => i.idValue)
    const myPoints = seedingPoints.filter((p) => steamIds.includes(p.steamId))
    const totalPoints = myPoints.reduce((sum, p) => sum + p.points, 0)
    const isRewarded = myPoints.some((p) => p.rewarded)

    return reply.send({
      linked_accounts: identifiers.map((i) => ({
        id_type: i.idType,
        id_value: i.idValue,
        is_verified: i.isVerified,
        verification_source: i.verificationSource,
      })),
      seeding: {
        total_points: totalPoints,
        seeding_hours: Math.round(totalPoints / 60 * 10) / 10,
        rewarded: isRewarded,
      },
    })
  })

  // Manual linking removed — use Discord Connected Accounts (Steam OAuth via Discord)
  // or in-game verification code for EOS IDs (future feature)
}
