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

      // Get all active panel roles for this guild, optionally filtered by whitelist slug
      const wlRoles = await app.prisma.panelRole.findMany({
        where: {
          guildId,
          isActive: true,
        },
        include: {
          panel: {
            select: { whitelistId: true, enabled: true },
          },
        },
      })

      // Filter by whitelist slug if requested
      const filteredRoles = wlTypeFilter
        ? wlRoles.filter(r => {
            if (!r.panel.whitelistId) return false
            return true // slug filter below after wl lookup
          })
        : wlRoles

      if (!filteredRoles.length) {
        return reply.send({ ok: true, added: 0, already_exists: 0, message: "No active role mappings found." })
      }

      // Fetch all guild members once
      const allMembers = await app.discord.fetchAllMembers(guildId)

      let added = 0
      let alreadyExists = 0
      const now = new Date()

      for (const wlRole of filteredRoles) {
        if (!wlRole.panel.whitelistId) continue
        const wl = await app.prisma.whitelist.findUnique({ where: { id: wlRole.panel.whitelistId } })
        if (!wl) continue
        if (wlTypeFilter && wl.slug !== wlTypeFilter) continue

        const roleIdStr = String(wlRole.roleId)
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
                effectiveSlotLimit: wlRole.slotLimit,
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
                details: `Added via role sync: role ${wlRole.roleName} (${roleIdStr})`,
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
  // Returns per-role Discord member count vs. registered whitelist users.

  app.get("/role-stats", { preHandler: adminHook }, async (req, reply) => {
    const guildId = BigInt(req.session.activeGuildId!)

    // Collect all active panel role IDs (deduplicated — same role may be in multiple panels)
    const wlRoles = await app.prisma.panelRole.findMany({
      where: { guildId, isActive: true },
      select: { roleId: true, roleName: true },
    })

    // Build deduplicated role list with stored names as fallback
    const roleNames = new Map<string, string>()
    for (const r of wlRoles) roleNames.set(String(r.roleId), r.roleName)

    if (!roleNames.size) {
      return reply.send({ stats: [], gateway_mode: false })
    }

    // Fetch live role names from Discord
    try {
      const liveRoles = await app.discord.fetchRoles(guildId)
      for (const r of liveRoles) {
        if (roleNames.has(r.id)) roleNames.set(r.id, r.name)
      }
    } catch { /* non-fatal; fall back to stored names */ }

    // Fetch all guild members to count per-role Discord membership
    let allMembers: Array<{ id: bigint; roles: string[] }> = []
    let discordAvailable = false
    try {
      allMembers = await app.discord.fetchAllMembers(guildId)
      discordAvailable = true
    } catch { /* non-fatal; fall back to DB-only data */ }

    if (!discordAvailable) {
      // Discord unavailable — return role list from DB with null counts so the
      // frontend can still show role names with a degraded-mode warning.
      const stats = [...roleNames.keys()].map(roleId => ({
        role_id:            roleId,
        role_name:          roleNames.get(roleId) ?? roleId,
        discord_count:      null,
        registered_count:   null,
        unregistered_count: null,
      }))
      return reply.send({ stats, gateway_mode: false, discord_available: false })
    }

    // Count Discord members per role
    const discordCounts = new Map<string, number>()
    for (const roleId of roleNames.keys()) discordCounts.set(roleId, 0)
    for (const member of allMembers) {
      for (const roleId of member.roles) {
        if (discordCounts.has(roleId)) {
          discordCounts.set(roleId, (discordCounts.get(roleId) ?? 0) + 1)
        }
      }
    }

    // Fetch active registered users (distinct discord IDs)
    const registeredRows = await app.prisma.whitelistUser.findMany({
      where: { guildId, status: "active" },
      select: { discordId: true },
      distinct: ["discordId"],
    })
    const registeredIds = new Set(registeredRows.map(u => u.discordId))

    // Count registered per role (how many Discord members with this role are whitelisted)
    const registeredCounts = new Map<string, number>()
    for (const roleId of roleNames.keys()) registeredCounts.set(roleId, 0)
    for (const member of allMembers) {
      if (!registeredIds.has(member.id)) continue
      for (const roleId of member.roles) {
        if (registeredCounts.has(roleId)) {
          registeredCounts.set(roleId, (registeredCounts.get(roleId) ?? 0) + 1)
        }
      }
    }

    const stats = [...roleNames.keys()].map(roleId => {
      const discordCount    = discordCounts.get(roleId)    ?? 0
      const registeredCount = registeredCounts.get(roleId) ?? 0
      return {
        role_id:            roleId,
        role_name:          roleNames.get(roleId) ?? roleId,
        discord_count:      discordCount,
        registered_count:   registeredCount,
        unregistered_count: Math.max(0, discordCount - registeredCount),
      }
    })

    stats.sort((a, b) => b.discord_count - a.discord_count)

    return reply.send(toJSON({ stats, gateway_mode: false, discord_available: true }))
  })

  // ── GET /members/gap ─────────────────────────────────────────────────────
  // Discord members who hold a whitelisted role but have no active registration.

  app.get("/members/gap", { preHandler: adminHook }, async (req, reply) => {
    const guildId = BigInt(req.session.activeGuildId!)

    // Collect every role ID that grants whitelist access (deduplicated)
    const wlRoles = await app.prisma.panelRole.findMany({
      where: { guildId, isActive: true },
      select: { roleId: true },
    })

    const whitelistedRoleIds = new Set<string>(wlRoles.map((r) => String(r.roleId)))

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
  // Check that every active whitelist role refers to an existing Discord role.

  app.post("/verify-roles", { preHandler: adminHook }, async (req, reply) => {
    const guildId = BigInt(req.session.activeGuildId!)

    const [wlRoles, liveRoles] = await Promise.all([
      app.prisma.panelRole.findMany({ where: { guildId, isActive: true } }),
      app.discord.fetchRoles(guildId).catch(() => [] as Array<{ id: string; name: string }>),
    ])

    const liveRoleIds = new Set(liveRoles.map((r) => r.id))

    const issues: Array<{ type: string; role_id: string; role_name: string; source: string }> = []

    for (const r of wlRoles) {
      if (!liveRoleIds.has(String(r.roleId))) {
        issues.push({ type: "missing", role_id: String(r.roleId), role_name: r.roleName, source: "whitelist_role" })
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

    const wlRoles = await app.prisma.panelRole.findMany({ where: { guildId, isActive: true } })
    if (!wlRoles.length) {
      return reply.send({ ok: true, updated: 0, message: "No active tier entries found" })
    }

    const tierByRole = new Map(
      wlRoles.map((r) => [
        String(r.roleId),
        { name: r.displayName ?? r.roleName, slots: r.slotLimit, stackable: r.isStackable },
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
    let disabled = 0

    for (const user of activeUsers) {
      const roles = memberRoles.get(user.discordId) ?? []

      const stackable:    Array<{ name: string; slots: number }> = []
      const nonStackable: Array<{ name: string; slots: number }> = []

      for (const r of roles) {
        const entry = tierByRole.get(r)
        if (!entry) continue
        if (entry.stackable) stackable.push({ name: entry.name, slots: entry.slots })
        else nonStackable.push({ name: entry.name, slots: entry.slots })
      }

      // No matching panel role → 0 slots, disable the user
      if (!stackable.length && !nonStackable.length) {
        await app.prisma.whitelistUser.update({
          where: {
            guildId_discordId_whitelistId: {
              guildId,
              discordId:   user.discordId,
              whitelistId: user.whitelistId,
            },
          },
          data: { effectiveSlotLimit: 0, status: "disabled_role_lost", lastPlanName: null, updatedAt: new Date() },
        })
        disabled++
        continue
      }

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

    return reply.send({ ok: true, updated, disabled, total_active: activeUsers.length })
  })
}
