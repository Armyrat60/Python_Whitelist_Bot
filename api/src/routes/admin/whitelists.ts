import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify"
import { randomBytes } from "crypto"
import { cache } from "../../services/cache.js"
import { getFileToken, getFileUrl } from "../../services/token.js"
import { syncOutputs } from "../../services/output.js"

// ─── Admin preHandler ─────────────────────────────────────────────────────────

const adminHook = async (req: FastifyRequest, reply: FastifyReply) => {
  if (!req.session.userId) return reply.code(401).send({ error: "Not authenticated" })
  if (!req.session.activeGuildId) return reply.code(400).send({ error: "No guild selected" })
  const guild = req.session.guilds?.find(g => g.id === req.session.activeGuildId)
  if (!guild?.isAdmin) return reply.code(403).send({ error: "Admin access required" })
}

// ─── triggerSync ──────────────────────────────────────────────────────────────

async function triggerSync(app: FastifyInstance, guildId: bigint) {
  try {
    const outputs = await syncOutputs(app.prisma, guildId)
    await cache.set(guildId, outputs)
    const salt = await app.prisma.botSetting.findUnique({
      where: { guildId_settingKey: { guildId, settingKey: "url_salt" } }
    })
    cache.registerToken(getFileToken(guildId, salt?.settingValue ?? null), guildId)
  } catch (err) {
    app.log.error({ err, guildId }, "triggerSync failed")
  }
}

// ─── Routes ───────────────────────────────────────────────────────────────────

export default async function whitelistRoutes(app: FastifyInstance) {
  const { prisma } = app

  // GET /api/admin/whitelist-urls
  app.get("/whitelist-urls", { preHandler: adminHook }, async (req, reply) => {
    const guildId = BigInt(req.session.activeGuildId!)

    const salt = await prisma.botSetting.findUnique({
      where: { guildId_settingKey: { guildId, settingKey: "url_salt" } }
    })
    const saltVal = salt?.settingValue ?? null

    const whitelists = await prisma.whitelist.findMany({
      where: { guildId },
      orderBy: [{ isDefault: "desc" }, { name: "asc" }]
    })

    // Each whitelist always gets its own URL using its own output filename.
    const urls = whitelists.map(wl => ({
      slug:     wl.slug,
      name:     wl.name,
      filename: wl.outputFilename || `${wl.slug}.txt`,
      url:      getFileUrl(guildId, wl.outputFilename || `${wl.slug}.txt`, saltVal),
      enabled:  wl.enabled,
    }))

    return reply.send({ urls })
  })

  // POST /api/admin/whitelist-url/regenerate
  app.post("/whitelist-url/regenerate", { preHandler: adminHook }, async (req, reply) => {
    const guildId = BigInt(req.session.activeGuildId!)

    const oldSalt = await prisma.botSetting.findUnique({
      where: { guildId_settingKey: { guildId, settingKey: "url_salt" } }
    })
    const oldToken = getFileToken(guildId, oldSalt?.settingValue ?? null)
    cache.removeToken(oldToken)

    const newSalt = randomBytes(8).toString("hex")

    await prisma.botSetting.upsert({
      where:  { guildId_settingKey: { guildId, settingKey: "url_salt" } },
      update: { settingValue: newSalt },
      create: { guildId, settingKey: "url_salt", settingValue: newSalt }
    })

    const newToken = getFileToken(guildId, newSalt)
    cache.registerToken(newToken, guildId)

    return reply.send({ ok: true })
  })

  // POST /api/admin/whitelists
  app.post("/whitelists", { preHandler: adminHook }, async (req, reply) => {
    const guildId = BigInt(req.session.activeGuildId!)
    const body = req.body as {
      name: string
      output_filename?: string
      squad_group?: string
      default_slot_limit?: number
      is_manual?: boolean
    }

    if (!body.name || typeof body.name !== "string") {
      return reply.code(400).send({ error: "name is required" })
    }

    // Slugify
    const slug = body.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50)

    if (!slug) {
      return reply.code(400).send({ error: "name produces an empty slug" })
    }

    // Max 5 check
    const count = await prisma.whitelist.count({ where: { guildId } })
    if (count >= 5) {
      return reply.code(400).send({ error: "Maximum of 5 whitelists allowed" })
    }

    // Slug uniqueness
    const existing = await prisma.whitelist.findUnique({
      where: { guildId_slug: { guildId, slug } }
    })
    if (existing) {
      return reply.code(409).send({ error: `Slug "${slug}" already in use` })
    }

    const wl = await prisma.whitelist.create({
      data: {
        guildId,
        name:             body.name,
        slug,
        enabled:          false,
        squadGroup:       body.squad_group       ?? "Whitelist",
        outputFilename:   body.output_filename   ?? `${slug}.txt`,
        defaultSlotLimit: body.default_slot_limit ?? 0,
        stackRoles:       false,
        isDefault:        false,
        isManual:         body.is_manual         ?? false,
        createdAt:        new Date(),
        updatedAt:        new Date(),
      }
    })

    return reply.code(201).send({ ok: true, id: wl.id, slug: wl.slug, name: wl.name })
  })

  // PUT /api/admin/whitelists/:id
  app.put("/whitelists/:id", { preHandler: adminHook }, async (req, reply) => {
    const guildId = BigInt(req.session.activeGuildId!)
    const param = (req.params as { id: string }).id

    // Accept numeric id or slug
    const where = /^\d+$/.test(param)
      ? { id: parseInt(param, 10) }
      : { guildId_slug: { guildId, slug: param } }

    const wl = await prisma.whitelist.findFirst({
      where: /^\d+$/.test(param)
        ? { id: parseInt(param, 10), guildId }
        : { guildId, slug: param }
    })
    if (!wl) return reply.code(404).send({ error: "Whitelist not found" })

    const body = req.body as Record<string, unknown>

    const fieldMap: Record<string, string> = {
      name:             "name",
      slug:             "slug",
      enabled:          "enabled",
      panel_channel_id: "panelChannelId",
      log_channel_id:   "logChannelId",
      output_filename:  "outputFilename",
      stack_roles:      "stackRoles",
      default_slot_limit: "defaultSlotLimit",
      squad_group:      "squadGroup",
      panel_message_id: "panelMessageId",
      is_manual:        "isManual",
    }

    const data: Record<string, unknown> = { updatedAt: new Date() }
    const updated: string[] = []

    for (const [snakeKey, camelKey] of Object.entries(fieldMap)) {
      if (snakeKey in body) {
        let val = body[snakeKey]
        // BigInt fields
        if (["panelChannelId", "logChannelId", "panelMessageId"].includes(camelKey) && val != null) {
          val = BigInt(val as string)
        }
        data[camelKey] = val
        updated.push(snakeKey)
      }
    }

    // Auto-update outputFilename when name changes but output_filename was not explicitly provided
    if ("name" in body && !("output_filename" in body)) {
      const newName = String(body.name)
      const newSlug = newName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50)
      if (newSlug) {
        data.outputFilename = `${newSlug}.txt`
        updated.push("output_filename")
      }
    }

    const updated_wl = await prisma.whitelist.update({
      where: { id: wl.id },
      data
    })

    await triggerSync(app, guildId)

    // Refresh Discord embeds for panels linked to this whitelist
    try {
      const panels = await prisma.panel.findMany({
        where: { guildId, whitelistId: wl.id },
        select: { id: true },
      })
      await Promise.all(panels.map(p =>
        prisma.panelRefreshQueue.create({
          data: { guildId, panelId: p.id, reason: "whitelist_updated", action: "refresh" }
        })
      ))
    } catch (err) {
      app.log.warn({ err }, "Failed to queue panel refreshes after whitelist update")
    }

    return reply.send({ ok: true, id: updated_wl.id, updated })
  })

  // POST /api/admin/types/:type — update whitelist config fields
  app.post<{
    Params: { type: string }
    Body: Record<string, unknown>
  }>("/types/:type", { preHandler: adminHook }, async (req, reply) => {
    const guildId = BigInt(req.session.activeGuildId!)
    const { type } = req.params

    const wl = await prisma.whitelist.findUnique({ where: { guildId_slug: { guildId, slug: type } } })
    if (!wl) return reply.code(400).send({ error: "Invalid whitelist type." })

    const body = req.body
    if (!body || typeof body !== "object") return reply.code(400).send({ error: "Body must be a non-empty JSON object." })

    const ALLOWED = new Set(["name", "slug", "enabled", "panelChannelId", "panelMessageId", "logChannelId",
      "outputFilename", "stackRoles", "squadGroup"])
    const FIELD_MAP: Record<string, string> = {
      output_filename:   "outputFilename",
      stack_roles:       "stackRoles",
      squad_group:       "squadGroup",
      panel_channel_id:  "panelChannelId",
      log_channel_id:    "logChannelId",
      panel_message_id:  "panelMessageId",
      github_filename:   "outputFilename", // legacy alias
    }
    const DROPPED = new Set(["github_enabled", "input_mode", "default_slot_limit", "defaultSlotLimit"])
    const BOOL_FIELDS = new Set(["enabled", "stackRoles", "stack_roles"])
    const INT_FIELDS = new Set(["panelChannelId", "logChannelId", "panelMessageId",
      "panel_channel_id", "log_channel_id", "panel_message_id"])

    const data: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(body)) {
      if (DROPPED.has(k)) continue
      const mapped = FIELD_MAP[k] ?? k
      if (!ALLOWED.has(mapped)) return reply.code(400).send({ error: `Unknown field: ${k}` })
      if (BOOL_FIELDS.has(k) || BOOL_FIELDS.has(mapped)) data[mapped] = Boolean(v)
      else if (INT_FIELDS.has(k) || INT_FIELDS.has(mapped)) data[mapped] = v != null && String(v).trim() ? BigInt(String(v)) : null
      else data[mapped] = v != null ? String(v) : null
    }

    if (Object.keys(data).length > 0) {
      await prisma.whitelist.update({ where: { id: wl.id }, data: data as any })
    }

    return reply.send({ ok: true, type, updated: Object.keys(body) })
  })

  // POST /api/admin/types/:type/toggle — toggle enabled/disabled
  app.post<{ Params: { type: string } }>("/types/:type/toggle", { preHandler: adminHook }, async (req, reply) => {
    const guildId = BigInt(req.session.activeGuildId!)
    const { type } = req.params

    const wl = await prisma.whitelist.findUnique({ where: { guildId_slug: { guildId, slug: type } } })
    if (!wl) return reply.code(400).send({ error: "Invalid whitelist type." })

    const newEnabled = !wl.enabled
    await prisma.whitelist.update({ where: { id: wl.id }, data: { enabled: newEnabled } })

    const outputs = await syncOutputs(prisma, guildId)
    await cache.set(guildId, outputs)

    // Queue refresh for all panels linked to this whitelist
    try {
      const panels = await prisma.panel.findMany({
        where: { guildId, whitelistId: wl.id },
        select: { id: true },
      })
      await Promise.all(panels.map(p =>
        prisma.panelRefreshQueue.create({
          data: { guildId, panelId: p.id, reason: "whitelist_toggled", action: "refresh" }
        })
      ))
    } catch (err) {
      app.log.warn({ err }, "Failed to queue panel refreshes after whitelist toggle")
    }

    return reply.send({ ok: true, type, enabled: newEnabled })
  })

  // DELETE /api/admin/whitelists/:slug
  app.delete("/whitelists/:slug", { preHandler: adminHook }, async (req, reply) => {
    const guildId = BigInt(req.session.activeGuildId!)
    const { slug } = req.params as { slug: string }

    const count = await prisma.whitelist.count({ where: { guildId } })
    if (count <= 1) {
      return reply.code(400).send({ error: "Cannot delete the last whitelist" })
    }

    const wl = await prisma.whitelist.findUnique({
      where: { guildId_slug: { guildId, slug } }
    })
    if (!wl) return reply.code(404).send({ error: "Whitelist not found" })

    if (wl.isDefault) {
      return reply.code(400).send({ error: "Cannot delete the default whitelist" })
    }

    const [userCount, identifierCount] = await Promise.all([
      prisma.whitelistUser.count({ where: { whitelistId: wl.id } }),
      prisma.whitelistIdentifier.count({ where: { whitelistId: wl.id } }),
    ])

    await prisma.auditLog.create({
      data: {
        guildId,
        whitelistId:    wl.id,
        actionType:     "whitelist_deleted",
        actorDiscordId: req.session.userId ? BigInt(req.session.userId) : null,
        details:        JSON.stringify({ slug, name: wl.name, userCount, identifierCount }),
        createdAt:      new Date(),
      }
    })

    await prisma.$transaction([
      prisma.whitelistIdentifier.deleteMany({ where: { whitelistId: wl.id } }),
      prisma.whitelistUser.deleteMany({ where: { whitelistId: wl.id } }),
      prisma.whitelist.delete({ where: { id: wl.id } }),
    ])

    await triggerSync(app, guildId)

    return reply.send({ ok: true, deleted: slug })
  })
}
