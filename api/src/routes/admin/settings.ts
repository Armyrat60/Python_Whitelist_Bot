/**
 * Admin settings, channel, and role-mapping routes.
 *
 * GET    /settings        — full settings snapshot
 * POST   /settings        — update bot_settings keys
 * GET    /channels        — list text channels for active guild
 * GET    /roles           — list roles for active guild
 * POST   /roles/:type     — add / upsert a role mapping
 * DELETE /roles/:type/:roleId — remove a role mapping
 */
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify"
import { syncOutputs } from "../../services/output.js"
import { cache } from "../../services/cache.js"
import { getFileToken, getFileUrl } from "../../services/token.js"

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_SETTINGS = [
  "duplicate_output_dedupe",
  "mod_role_ids",
  "accent_primary",
  "accent_secondary",
  "report_channel_id",
  "report_schedule",
  "retention_days",
  "url_salt",
] as const

const MUTABLE_SETTINGS = new Set<string>([
  "duplicate_output_dedupe",
  "mod_role_ids",
  "accent_primary",
  "accent_secondary",
  "report_channel_id",
  "report_schedule",
  "retention_days",
])

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Write-through cache: whenever we have fresh role names from Discord,
 * update any stale stored names in roleMapping and tierEntry tables.
 * This ensures the DB fallback stays accurate even after role renames.
 */
async function refreshStoredRoleNames(
  app: FastifyInstance,
  guildId: bigint,
  liveRoles: Map<string, string>,
): Promise<void> {
  if (!liveRoles.size) return

  const [roleMappings, tierEntries] = await Promise.all([
    app.prisma.roleMapping.findMany({
      where: { guildId },
      select: { id: true, roleId: true, roleName: true },
    }),
    app.prisma.tierEntry.findMany({
      where: { guildId },
      select: { id: true, roleId: true, roleName: true },
    }),
  ])

  const rmUpdates = roleMappings
    .filter(rm => {
      const live = liveRoles.get(String(rm.roleId))
      return live !== undefined && live !== rm.roleName
    })
    .map(rm => app.prisma.roleMapping.update({
      where: { id: rm.id },
      data:  { roleName: liveRoles.get(String(rm.roleId))! },
    }))

  const teUpdates = tierEntries
    .filter(te => {
      const live = liveRoles.get(String(te.roleId))
      return live !== undefined && live !== te.roleName
    })
    .map(te => app.prisma.tierEntry.update({
      where: { id: te.id },
      data:  { roleName: liveRoles.get(String(te.roleId))! },
    }))

  if (rmUpdates.length || teUpdates.length) {
    await Promise.all([...rmUpdates, ...teUpdates])
    app.log.info({ guildId, roleMappings: rmUpdates.length, tierEntries: teUpdates.length },
      "Refreshed stale stored role names")
  }
}

async function requireAdmin(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!req.session.userId) {
    return reply.code(401).send({ error: "Not authenticated" })
  }
  if (!req.session.activeGuildId) {
    return reply.code(400).send({ error: "No guild selected" })
  }
  const guild = req.session.guilds?.find((g) => g.id === req.session.activeGuildId)
  if (!guild?.isAdmin) {
    return reply.code(403).send({ error: "Admin access required" })
  }
}

async function triggerSync(app: FastifyInstance, guildId: bigint): Promise<void> {
  try {
    const outputs = await syncOutputs(app.prisma, guildId)
    cache.set(guildId, outputs)
    const salt = await app.prisma.botSetting.findUnique({
      where: { guildId_settingKey: { guildId, settingKey: "url_salt" } },
    })
    cache.registerToken(getFileToken(guildId, salt?.settingValue ?? null), guildId)
  } catch (err) {
    app.log.error({ err, guildId }, "triggerSync failed")
  }
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

export const adminSettingsRoutes: FastifyPluginAsync = async (app) => {
  // ── GET /settings ─────────────────────────────────────────────────

  app.get("/settings", { preHandler: requireAdmin }, async (req, reply) => {
    const guildId = BigInt(req.session.activeGuildId!)

    // --- bot_settings ---
    const settingsRows = await app.prisma.botSetting.findMany({ where: { guildId } })
    const settingsMap = Object.fromEntries(settingsRows.map((r) => [r.settingKey, r.settingValue]))
    const botSettings: Record<string, string | null> = {}
    for (const key of DEFAULT_SETTINGS) {
      botSettings[key] = settingsMap[key] ?? null
    }

    // --- whitelists (type_configs keyed by slug) ---
    const whitelists = await app.prisma.whitelist.findMany({
      where: { guildId },
      orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    })

    // Fetch salt once for URL generation
    const urlSalt = settingsMap["url_salt"] ?? null

    const typeConfigs: Record<string, unknown> = {}
    for (const wl of whitelists) {
      const filename = wl.outputFilename || `${wl.slug}.txt`
      typeConfigs[wl.slug] = {
        id:               wl.id,
        name:             wl.name,
        slug:             wl.slug,
        enabled:          wl.enabled,
        squad_group:      wl.squadGroup,
        output_filename:  filename,
        default_slot_limit: wl.defaultSlotLimit,
        stack_roles:      wl.stackRoles,
        is_default:       wl.isDefault,
        url:              getFileUrl(guildId, filename, urlSalt),
      }
    }

    // --- role_mappings per whitelist slug ---
    const roleMappings = await app.prisma.roleMapping.findMany({
      where: { guildId },
      orderBy: { id: "asc" },
    })

    // Fetch live role names once, then write-through any stale stored names
    let liveRoles: Map<string, string> = new Map()
    try {
      const roles = await app.discord.fetchRoles(guildId)
      liveRoles = new Map(roles.map((r) => [r.id, r.name]))

      // Refresh stale stored names — fire and forget (don't block the response)
      refreshStoredRoleNames(app, guildId, liveRoles).catch(() => {})
    } catch {
      // non-fatal; fall back to stored names
    }

    // Build slug -> whitelist id lookup
    const slugById = new Map(whitelists.map((wl) => [wl.id, wl.slug]))

    const roleMappingsBySlug: Record<string, unknown[]> = {}
    for (const rm of roleMappings) {
      const slug = rm.whitelistId != null ? (slugById.get(rm.whitelistId) ?? "__unknown__") : "__global__"
      const roleIdStr = String(rm.roleId)
      roleMappingsBySlug[slug] ??= []
      ;(roleMappingsBySlug[slug] as unknown[]).push({
        id:        rm.id,
        role_id:   roleIdStr,
        role_name: liveRoles.get(roleIdStr) ?? rm.roleName,
        slot_limit: rm.slotLimit,
        is_active: rm.isActive,
      })
    }

    // --- squad_groups (distinct names) ---
    const squadGroupRows = await app.prisma.squadGroup.findMany({
      where: { guildId },
      orderBy: { groupName: "asc" },
    })
    const squadGroups = squadGroupRows.map((g) => g.groupName)

    // --- tier_categories with enriched entries ---
    const tierCategories = await app.prisma.tierCategory.findMany({
      where: { guildId },
      include: {
        entries: {
          orderBy: { sortOrder: "asc" },
        },
      },
      orderBy: { id: "asc" },
    })

    const tierCategoriesOut = tierCategories.map((tc) => ({
      id:          tc.id,
      name:        tc.name,
      description: tc.description ?? null,
      is_default:  tc.isDefault,
      entries:     tc.entries.map((e) => {
        const roleIdStr = String(e.roleId)
        return {
          id:           e.id,
          role_id:      roleIdStr,
          role_name:    liveRoles.get(roleIdStr) ?? e.roleName,
          slot_limit:   e.slotLimit,
          display_name: e.displayName ?? null,
          sort_order:   e.sortOrder,
          is_active:    e.isActive,
          is_stackable: e.isStackable,
        }
      }),
    }))

    return reply.send({
      bot_settings:      botSettings,
      type_configs:      typeConfigs,
      role_mappings:     roleMappingsBySlug,
      squad_groups:      squadGroups,
      squad_permissions: [],   // frontend has the hardcoded list
      tier_categories:   tierCategoriesOut,
    })
  })

  // ── POST /settings ────────────────────────────────────────────────

  app.post<{ Body: Record<string, string> }>(
    "/settings",
    { preHandler: requireAdmin },
    async (req, reply) => {
      const guildId = BigInt(req.session.activeGuildId!)
      const updates = req.body

      const allowed = Object.entries(updates).filter(([k]) => MUTABLE_SETTINGS.has(k))
      if (!allowed.length) {
        return reply.code(400).send({ error: "No valid settings keys provided" })
      }

      await Promise.all(
        allowed.map(([settingKey, settingValue]) =>
          app.prisma.botSetting.upsert({
            where:  { guildId_settingKey: { guildId, settingKey } },
            update: { settingValue },
            create: { guildId, settingKey, settingValue },
          }),
        ),
      )

      await triggerSync(app, guildId)
      return reply.send({ ok: true, updated: allowed.map(([k]) => k) })
    },
  )

  // ── GET /channels ─────────────────────────────────────────────────

  app.get("/channels", { preHandler: requireAdmin }, async (req, reply) => {
    const guildId = BigInt(req.session.activeGuildId!)
    const channels = await app.discord.fetchChannels(guildId)
    return reply.send({ channels: channels.map((ch) => ({ id: ch.id, name: ch.name })) })
  })

  // ── GET /roles ────────────────────────────────────────────────────

  app.get("/roles", { preHandler: requireAdmin }, async (req, reply) => {
    const guildId = BigInt(req.session.activeGuildId!)
    const roles = await app.discord.fetchRoles(guildId)
    return reply.send({ roles: roles.map((r) => ({ id: r.id, name: r.name })) })
  })

  // ── POST /roles/:type ─────────────────────────────────────────────

  app.post<{
    Params: { type: string }
    Body: { role_id: string; role_name: string; slot_limit: number }
  }>(
    "/roles/:type",
    { preHandler: requireAdmin },
    async (req, reply) => {
      const guildId = BigInt(req.session.activeGuildId!)
      const { type } = req.params
      const { role_id, role_name, slot_limit } = req.body

      // Resolve whitelist by slug
      const whitelist = await app.prisma.whitelist.findUnique({
        where: { guildId_slug: { guildId, slug: type } },
      })
      if (!whitelist) {
        return reply.code(404).send({ error: `Whitelist type '${type}' not found` })
      }

      const roleId  = BigInt(role_id)
      const created = await app.prisma.roleMapping.upsert({
        where: {
          guildId_whitelistId_roleId: {
            guildId,
            whitelistId: whitelist.id,
            roleId,
          },
        },
        update: {
          roleName:  role_name,
          slotLimit: slot_limit,
          isActive:  true,
        },
        create: {
          guildId,
          whitelistType: type,
          whitelistId:   whitelist.id,
          roleId,
          roleName:      role_name,
          slotLimit:     slot_limit,
          isActive:      true,
          createdAt:     new Date(),
        },
      })

      await triggerSync(app, guildId)
      return reply.send({ ok: true, id: created.id })
    },
  )

  // ── DELETE /roles/:type/:roleId ───────────────────────────────────

  app.delete<{
    Params: { type: string; roleId: string }
  }>(
    "/roles/:type/:roleId",
    { preHandler: requireAdmin },
    async (req, reply) => {
      const guildId = BigInt(req.session.activeGuildId!)
      const { type, roleId: roleIdStr } = req.params

      const whitelist = await app.prisma.whitelist.findUnique({
        where: { guildId_slug: { guildId, slug: type } },
      })
      if (!whitelist) {
        return reply.code(404).send({ error: `Whitelist type '${type}' not found` })
      }

      await app.prisma.roleMapping.deleteMany({
        where: {
          guildId,
          whitelistId: whitelist.id,
          roleId:      BigInt(roleIdStr),
        },
      })

      await triggerSync(app, guildId)
      return reply.send({ ok: true })
    },
  )
}
