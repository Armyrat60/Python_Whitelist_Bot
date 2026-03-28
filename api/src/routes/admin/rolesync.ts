/**
 * Role sync and gap analysis routes.
 *
 * POST /role-sync/check     — trigger immediate role sync (requires Discord gateway — stubs 503)
 * POST /role-sync/pull      — pull members with any mapped role into the whitelist
 * GET  /role-stats          — role mapping statistics
 * GET  /members/gap         — members with whitelisted roles who haven't registered
 * POST /verify-roles        — verify role mappings are still valid
 * POST /backfill/sources    — backfill created_via from audit log
 * POST /backfill/tiers      — backfill tier info from current Discord roles
 */
import type { FastifyInstance } from "fastify"
import { syncOutputs } from "../../services/output.js"
import { cache } from "../../services/cache.js"

// ─── BigInt JSON helpers ──────────────────────────────────────────────────────

function bigIntReplacer(_: string, v: unknown) { return typeof v === "bigint" ? v.toString() : v }
function toJSON(data: unknown) { return JSON.parse(JSON.stringify(data, bigIntReplacer)) }

// ─── triggerSync ──────────────────────────────────────────────────────────────

async function triggerSync(app: FastifyInstance, guildId: bigint): Promise<void> {
  try {
    const outputs = await syncOutputs(app.prisma, guildId)
    cache.set(guildId, outputs)
  } catch (err) {
    app.log.error({ err, guildId }, "triggerSync failed")
  }
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

export default async function roleSyncRoutes(app: FastifyInstance) {
  const adminHook = [app.requireAdmin]

  // ── POST /role-sync/check — requires gateway bot, stubs 503 here ─────────

  app.post("/role-sync/check", { preHandler: adminHook }, async (_req, reply) => {
    return reply.code(503).send({
      error: "Role sync check requires the bot to be running in gateway mode.",
    })
  })

  // ── POST /role-sync/pull ─────────────────────────────────────────────────
  // Fetch all guild members with any mapped role and add them to the whitelist.

  app.post<{ Body: { whitelist_type?: string; dry_run?: boolean } }>(
    "/role-sync/pull",
    { preHandler: adminHook },
    async (req, reply) => {
      const guildId = BigInt(req.session.activeGuildId!)
      const actorId = BigInt(req.session.userId!)
      const { whitelist_type: wlTypeFilter, dry_run: dryRun = false } = req.body ?? {}

      // Get all active role mappings for this guild, optionally filtered by whitelist slug
      const mappings = await app.prisma.roleMapping.findMany({
        where: {
          guildId,
          isActive: true,
          ...(wlTypeFilter
            ? { whitelist: { slug: wlTypeFilter } }
            : {}),
        },
      })

      if (!mappings.length) {
        return reply.send({ ok: true, added: 0, already_exists: 0, message: "No active role mappings found." })
      }

      // Fetch all guild members once
      const allMembers = await app.discord.fetchAllMembers(guildId)

      let added = 0
      let alreadyExists = 0
      const now = new Date()

      for (const mapping of mappings) {
        if (mapping.whitelistId == null) continue

        const wl = await app.prisma.whitelist.findUnique({ where: { id: mapping.whitelistId } })
        if (!wl) continue

        const roleIdStr = String(mapping.roleId)
        const membersWithRole = allMembers.filter((m) => m.roles.includes(roleIdStr))

        for (const member of membersWithRole) {
          const existing = await app.prisma.whitelistUser.findUnique({
            where: {
              guildId_discordId_whitelistId: {
                guildId,
                discordId: member.id,
                whitelistId: wl.id,
              },
            },
          })
          if (existing) { alreadyExists++; continue }

          if (!dryRun) {
            await app.prisma.whitelistUser.create({
              data: {
                guildId,
                discordId: member.id,
                whitelistId: wl.id,
                discordName: member.name,
                status: "active",
                effectiveSlotLimit: mapping.slotLimit,
                createdVia: "role_sync",
                createdAt: now,
                updatedAt: now,
              },
            })
            await app.prisma.auditLog.create({
              data: {
                guildId,
                actionType: "role_sync_pull",
                actorDiscordId: actorId,
                targetDiscordId: member.id,
                details: `Added via role sync: role ${mapping.roleName} (${roleIdStr})`,
                whitelistId: wl.id,
                createdAt: now,
              },
            })
          }
          added++
        }
      }

      if (!dryRun && added > 0) await triggerSync(app, guildId)

      return reply.send(toJSON({ ok: true, added, already_exists: alreadyExists, dry_run: dryRun }))
    },
  )

  // ── GET /role-stats ──────────────────────────────────────────────────────

  app.get("/role-stats", { preHandler: adminHook }, async (req, reply) => {
    const guildId = BigInt(req.session.activeGuildId!)

    const mappings = await app.prisma.roleMapping.findMany({
      where: { guildId, isActive: true },
      include: { whitelist: { select: { slug: true, name: true } } },
    })

    // Fetch live role names from Discord (non-fatal if unavailable)
    let liveRoles: Map<string, string> = new Map()
    try {
      const roles = await app.discord.fetchRoles(guildId)
      liveRoles = new Map(roles.map((r) => [r.id, r.name]))
    } catch { /* non-fatal */ }

    const stats = mappings.map((m) => ({
      id:             m.id,
      role_id:        String(m.roleId),
      role_name:      liveRoles.get(String(m.roleId)) ?? m.roleName,
      slot_limit:     m.slotLimit,
      whitelist_slug: m.whitelist?.slug ?? null,
      whitelist_name: m.whitelist?.name ?? null,
    }))

    return reply.send({ role_mappings: stats })
  })

  // ── GET /members/gap ─────────────────────────────────────────────────────
  // Discord members who hold a whitelisted role but have no active registration.

  app.get("/members/gap", { preHandler: adminHook }, async (req, reply) => {
    const guildId = BigInt(req.session.activeGuildId!)

    // Collect every role ID that grants whitelist access
    const [rmRows, teRows] = await Promise.all([
      app.prisma.roleMapping.findMany({ where: { guildId, isActive: true }, select: { roleId: true } }),
      app.prisma.tierEntry.findMany({ where: { guildId, isActive: true }, select: { roleId: true } }),
    ])

    const whitelistedRoleIds = new Set<string>([
      ...rmRows.map((r) => String(r.roleId)),
      ...teRows.map((r) => String(r.roleId)),
    ])

    if (!whitelistedRoleIds.size) {
      return reply.send({ members: [], total: 0 })
    }

    const allMembers = await app.discord.fetchAllMembers(guildId)

    // Collect all discord_ids that have at least one active whitelist entry
    const registeredUsers = await app.prisma.whitelistUser.findMany({
      where: { guildId, status: "active" },
      select: { discordId: true },
      distinct: ["discordId"],
    })
    const registeredIds = new Set(registeredUsers.map((u) => u.discordId))

    const gap = allMembers
      .filter((m) => {
        if (registeredIds.has(m.id)) return false
        return m.roles.some((r) => whitelistedRoleIds.has(r))
      })
      .map((m) => ({
        discord_id:       String(m.id),
        username:         m.username,
        display_name:     m.name,
        whitelisted_roles: m.roles.filter((r) => whitelistedRoleIds.has(r)),
      }))

    return reply.send({ members: gap, total: gap.length })
  })

  // ── POST /verify-roles ───────────────────────────────────────────────────
  // Check that every active role mapping/tier entry refers to an existing Discord role.

  app.post("/verify-roles", { preHandler: adminHook }, async (req, reply) => {
    const guildId = BigInt(req.session.activeGuildId!)

    const [mappings, tierEntries, liveRoles] = await Promise.all([
      app.prisma.roleMapping.findMany({ where: { guildId, isActive: true } }),
      app.prisma.tierEntry.findMany({ where: { guildId, isActive: true } }),
      app.discord.fetchRoles(guildId).catch(() => [] as Array<{ id: string; name: string }>),
    ])

    const liveRoleIds = new Set(liveRoles.map((r) => r.id))

    const issues: Array<{ type: string; role_id: string; role_name: string; source: string }> = []

    for (const m of mappings) {
      if (!liveRoleIds.has(String(m.roleId))) {
        issues.push({ type: "missing", role_id: String(m.roleId), role_name: m.roleName, source: "role_mapping" })
      }
    }
    for (const te of tierEntries) {
      if (!liveRoleIds.has(String(te.roleId))) {
        issues.push({ type: "missing", role_id: String(te.roleId), role_name: te.roleName, source: "tier_entry" })
      }
    }

    return reply.send({ ok: issues.length === 0, issues })
  })

  // ── POST /backfill/sources ───────────────────────────────────────────────
  // Fill in created_via on whitelist_users rows that are NULL, using audit_log.

  app.post("/backfill/sources", { preHandler: adminHook }, async (req, reply) => {
    const guildId = BigInt(req.session.activeGuildId!)

    const ACTION_TO_SOURCE: Record<string, string> = {
      user_submit:           "self_register",
      orphan_self_claimed:   "self_register",
      web_update_ids:        "web_dashboard",
      admin_add_user:        "admin",
      admin_import:          "import",
      role_sync_pull:        "role_sync",
      daily_role_sync_add:   "role_sync",
      auto_enroll_role_gain: "role_sync",
    }

    const auditRows = await app.prisma.auditLog.findMany({
      where: {
        guildId,
        actionType:      { in: Object.keys(ACTION_TO_SOURCE) },
        targetDiscordId: { not: null },
        whitelistId:     { not: null },
      },
      orderBy: { createdAt: "asc" },
    })

    // Keep only the first audit entry per (targetDiscordId, whitelistId)
    const seen = new Set<string>()
    let updated = 0

    for (const row of auditRows) {
      const key = `${row.targetDiscordId}-${row.whitelistId}`
      if (seen.has(key)) continue
      seen.add(key)

      const source = ACTION_TO_SOURCE[row.actionType]
      if (!source || row.whitelistId == null || row.targetDiscordId == null) continue

      const result = await app.prisma.whitelistUser.updateMany({
        where: {
          guildId,
          discordId:   row.targetDiscordId,
          whitelistId: row.whitelistId,
          createdVia:  null,
        },
        data: { createdVia: source },
      })
      updated += result.count
    }

    return reply.send({ ok: true, updated })
  })

  // ── POST /backfill/tiers ─────────────────────────────────────────────────
  // Recalculate lastPlanName and effectiveSlotLimit from current Discord roles.

  app.post("/backfill/tiers", { preHandler: adminHook }, async (req, reply) => {
    const guildId = BigInt(req.session.activeGuildId!)

    const tierEntries = await app.prisma.tierEntry.findMany({ where: { guildId, isActive: true } })
    if (!tierEntries.length) {
      return reply.send({ ok: true, updated: 0, message: "No active tier entries found" })
    }

    const tierByRole = new Map(
      tierEntries.map((te) => [
        String(te.roleId),
        { name: te.displayName ?? te.roleName, slots: te.slotLimit, stackable: te.isStackable },
      ]),
    )

    let allMembers: Array<{ id: bigint; roles: string[] }>
    try {
      allMembers = await app.discord.fetchAllMembers(guildId)
    } catch {
      return reply.code(503).send({ error: "Cannot fetch Discord members" })
    }

    const memberRoles = new Map(allMembers.map((m) => [m.id, m.roles]))

    const activeUsers = await app.prisma.whitelistUser.findMany({
      where: { guildId, status: "active" },
    })

    let updated = 0

    for (const user of activeUsers) {
      const roles = memberRoles.get(user.discordId) ?? []
      if (!roles.length) continue

      const stackable:    Array<{ name: string; slots: number }> = []
      const nonStackable: Array<{ name: string; slots: number }> = []

      for (const r of roles) {
        const entry = tierByRole.get(r)
        if (!entry) continue
        if (entry.stackable) stackable.push({ name: entry.name, slots: entry.slots })
        else nonStackable.push({ name: entry.name, slots: entry.slots })
      }

      if (!stackable.length && !nonStackable.length) continue

      let tierLabel: string | null = null
      let totalSlots = 0

      if (stackable.length > 0) {
        totalSlots += stackable.reduce((s, e) => s + e.slots, 0)
        tierLabel = stackable.map((e) => `${e.name}:${e.slots}`).join("+")
      }
      if (nonStackable.length > 0) {
        const best = nonStackable.reduce((a, b) => (b.slots > a.slots ? b : a))
        totalSlots += best.slots
        tierLabel = tierLabel ? `${tierLabel}+${best.name}:${best.slots}` : `${best.name}:${best.slots}`
      }

      if (tierLabel) {
        await app.prisma.whitelistUser.update({
          where: {
            guildId_discordId_whitelistId: {
              guildId,
              discordId:   user.discordId,
              whitelistId: user.whitelistId,
            },
          },
          data: { lastPlanName: tierLabel, effectiveSlotLimit: totalSlots, updatedAt: new Date() },
        })
        updated++
      }
    }

    return reply.send({ ok: true, updated })
  })
}
