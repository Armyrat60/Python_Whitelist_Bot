/**
 * Admin settings, channel, and role routes.
 *
 * GET    /settings        — full settings snapshot
 * POST   /settings        — update bot_settings keys
 * GET    /channels        — list text channels for active guild
 * GET    /roles           — list roles for active guild
 */
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify"
import { syncOutputs } from "../../services/output.js"
import { cache } from "../../services/cache.js"
import { getFileToken, getFileUrl } from "../../services/token.js"

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_SETTINGS = [
  "duplicate_output_dedupe",
  "mod_role_id",
  "accent_primary",
  "accent_secondary",
  "notification_channel_id",
  "report_frequency",
  "retention_days",
  "url_salt",
  "auto_reactivate_on_role_return",
  "welcome_dm_enabled",
  "welcome_dm_text",
  "allow_global_duplicates",
  "bot_status_message",
  "role_sync_interval_hours",
  "timezone",
] as const

const MUTABLE_SETTINGS = new Set<string>([
  "duplicate_output_dedupe",
  "mod_role_id",
  "accent_primary",
  "accent_secondary",
  "notification_channel_id",
  "report_frequency",
  "retention_days",
  "auto_reactivate_on_role_return",
  "welcome_dm_enabled",
  "welcome_dm_text",
  "allow_global_duplicates",
  "bot_status_message",
  "role_sync_interval_hours",
  "timezone",
])

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
    await cache.set(guildId, outputs)
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
        is_manual:        wl.isManual,
        url:              getFileUrl(guildId, filename, urlSalt),
      }
    }

    // --- squad_groups (distinct names) ---
    const squadGroupRows = await app.prisma.squadGroup.findMany({
      where: { guildId },
      orderBy: { groupName: "asc" },
    })
    const squadGroups = squadGroupRows.map((g) => g.groupName)

    return reply.send({
      bot_settings:      botSettings,
      type_configs:      typeConfigs,
      squad_groups:      squadGroups,
      squad_permissions: [],   // frontend has the hardcoded list
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
    return reply.send({
      channels: channels
        .map((ch) => ({ id: ch.id, name: ch.name, position: ch.position ?? 0 }))
        .sort((a, b) => a.position - b.position),
    })
  })

  // ── GET /roles ────────────────────────────────────────────────────

  app.get("/roles", { preHandler: requireAdmin }, async (req, reply) => {
    const guildId = BigInt(req.session.activeGuildId!)
    const roles = await app.discord.fetchRoles(guildId)
    return reply.send({ roles: roles.map((r) => ({ id: r.id, name: r.name, color: r.color, position: r.position })) })
  })

}
