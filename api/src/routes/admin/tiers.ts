/**
 * Tier category and tier entry management routes.
 *
 * Prefix: /api/admin
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify"

// ─── Admin preHandler ─────────────────────────────────────────────────────────

const adminHook = async (req: FastifyRequest, reply: FastifyReply) => {
  if (!req.session.userId) return reply.code(401).send({ error: "Not authenticated" })
  if (!req.session.activeGuildId) return reply.code(400).send({ error: "No guild selected" })
  const guild = req.session.guilds?.find(g => g.id === req.session.activeGuildId)
  if (!guild?.isAdmin) return reply.code(403).send({ error: "Admin access required" })
}

// ─── BigInt JSON helpers ──────────────────────────────────────────────────────

function bigIntReplacer(_: string, v: unknown) { return typeof v === "bigint" ? v.toString() : v }
function toJSON(data: unknown) { return JSON.parse(JSON.stringify(data, bigIntReplacer)) }

// ─── Routes ───────────────────────────────────────────────────────────────────

export default async function tierRoutes(app: FastifyInstance) {
  const { prisma } = app

  // ── GET /api/admin/tier-categories ──────────────────────────────────────────

  app.get("/tier-categories", { preHandler: adminHook }, async (req, reply) => {
    const guildId = BigInt(req.session.activeGuildId!)

    const categories = await prisma.tierCategory.findMany({
      where: { guildId },
      include: {
        entries: {
          where: { isActive: true },
          orderBy: { sortOrder: "asc" },
        },
      },
      orderBy: { id: "asc" },
    })

    // Fetch live role names from Discord
    const roles = await req.server.discord.fetchRoles(guildId).catch(() => [])
    const roleMap = new Map(roles.map((r: { id: string; name: string }) => [r.id, r.name]))

    const result = categories.map(cat => ({
      id:          cat.id,
      name:        cat.name,
      description: cat.description,
      is_default:  cat.isDefault,
      entries:     cat.entries.map(e => ({
        id:           e.id,
        role_id:      e.roleId.toString(),
        role_name:    roleMap.get(e.roleId.toString()) ?? e.roleName,
        slot_limit:   e.slotLimit,
        display_name: e.displayName,
        sort_order:   e.sortOrder,
        is_active:    e.isActive,
        is_stackable: e.isStackable,
      })),
    }))

    return reply.send(toJSON({ categories: result }))
  })

  // ── POST /api/admin/tier-categories ─────────────────────────────────────────

  app.post("/tier-categories", { preHandler: adminHook }, async (req, reply) => {
    const guildId = BigInt(req.session.activeGuildId!)
    const body = req.body as { name?: string; description?: string }

    if (!body.name || typeof body.name !== "string") {
      return reply.code(400).send({ error: "name is required" })
    }

    // Max 10 categories per guild
    const count = await prisma.tierCategory.count({ where: { guildId } })
    if (count >= 10) {
      return reply.code(400).send({ error: "Maximum of 10 tier categories allowed" })
    }

    // Name uniqueness
    const existing = await prisma.tierCategory.findUnique({
      where: { guildId_name: { guildId, name: body.name } },
    })
    if (existing) {
      return reply.code(409).send({ error: `Category name "${body.name}" already in use` })
    }

    const category = await prisma.tierCategory.create({
      data: {
        guildId,
        name:        body.name,
        description: body.description ?? null,
        isDefault:   false,
        createdAt:   new Date(),
        updatedAt:   new Date(),
      },
    })

    return reply.code(201).send({ ok: true, id: category.id, name: category.name })
  })

  // ── PUT /api/admin/tier-categories/:categoryId ───────────────────────────────

  app.put("/tier-categories/:categoryId", { preHandler: adminHook }, async (req, reply) => {
    const guildId    = BigInt(req.session.activeGuildId!)
    const categoryId = parseInt((req.params as { categoryId: string }).categoryId, 10)
    const body       = req.body as { name?: string; description?: string }

    const existing = await prisma.tierCategory.findFirst({
      where: { id: categoryId, guildId },
    })
    if (!existing) return reply.code(404).send({ error: "Category not found" })

    const data: Record<string, unknown> = { updatedAt: new Date() }
    if (body.name        !== undefined) data.name        = body.name
    if (body.description !== undefined) data.description = body.description

    await prisma.tierCategory.update({ where: { id: categoryId }, data })

    return reply.send({ ok: true, category_id: categoryId })
  })

  // ── DELETE /api/admin/tier-categories/:categoryId ────────────────────────────

  app.delete("/tier-categories/:categoryId", { preHandler: adminHook }, async (req, reply) => {
    const guildId    = BigInt(req.session.activeGuildId!)
    const categoryId = parseInt((req.params as { categoryId: string }).categoryId, 10)

    const count = await prisma.tierCategory.count({ where: { guildId } })
    if (count <= 1) {
      return reply.code(400).send({ error: "Cannot delete the last tier category" })
    }

    const existing = await prisma.tierCategory.findFirst({
      where: { id: categoryId, guildId },
    })
    if (!existing) return reply.code(404).send({ error: "Category not found" })

    // Cascade deletes entries via DB relation
    await prisma.tierCategory.delete({ where: { id: categoryId } })

    return reply.send({ ok: true, deleted_category_id: categoryId })
  })

  // ── POST /api/admin/tier-categories/:categoryId/entries ──────────────────────

  app.post("/tier-categories/:categoryId/entries", { preHandler: adminHook }, async (req, reply) => {
    const guildId    = BigInt(req.session.activeGuildId!)
    const categoryId = parseInt((req.params as { categoryId: string }).categoryId, 10)
    const body       = req.body as {
      role_id:       string
      role_name:     string
      slot_limit:    number
      display_name?: string
      sort_order?:   number
      is_stackable?: boolean
    }

    if (!body.role_id || !body.role_name || body.slot_limit == null) {
      return reply.code(400).send({ error: "role_id, role_name, and slot_limit are required" })
    }

    // Validate category belongs to this guild
    const category = await prisma.tierCategory.findFirst({
      where: { id: categoryId, guildId },
    })
    if (!category) return reply.code(404).send({ error: "Category not found" })

    const entry = await prisma.tierEntry.create({
      data: {
        guildId,
        categoryId,
        roleId:      BigInt(body.role_id),
        roleName:    body.role_name,
        slotLimit:   body.slot_limit,
        displayName: body.display_name ?? null,
        sortOrder:   body.sort_order   ?? 0,
        isActive:    true,
        isStackable: body.is_stackable ?? false,
        createdAt:   new Date(),
      },
    })

    return reply.code(201).send(toJSON({
      ok:           true,
      id:           entry.id,
      role_id:      entry.roleId.toString(),
      role_name:    entry.roleName,
      slot_limit:   entry.slotLimit,
      display_name: entry.displayName,
      sort_order:   entry.sortOrder,
      is_stackable: entry.isStackable,
    }))
  })

  // ── PUT /api/admin/tier-categories/:categoryId/entries/:entryId ──────────────

  app.put("/tier-categories/:categoryId/entries/:entryId", { preHandler: adminHook }, async (req, reply) => {
    const guildId    = BigInt(req.session.activeGuildId!)
    const categoryId = parseInt((req.params as { categoryId: string; entryId: string }).categoryId, 10)
    const entryId    = parseInt((req.params as { categoryId: string; entryId: string }).entryId, 10)
    const body       = req.body as {
      slot_limit?:   number
      display_name?: string | null
      sort_order?:   number
      is_active?:    boolean
      is_stackable?: boolean
    }

    const existing = await prisma.tierEntry.findFirst({
      where: { id: entryId, categoryId, guildId },
    })
    if (!existing) return reply.code(404).send({ error: "Entry not found" })

    const data: Record<string, unknown> = {}
    if (body.slot_limit   !== undefined) data.slotLimit   = body.slot_limit
    if (body.display_name !== undefined) data.displayName = body.display_name
    if (body.sort_order   !== undefined) data.sortOrder   = body.sort_order
    if (body.is_active    !== undefined) data.isActive    = body.is_active
    if (body.is_stackable !== undefined) data.isStackable = body.is_stackable

    await prisma.tierEntry.update({ where: { id: entryId }, data })

    return reply.send({ ok: true, entry_id: entryId })
  })

  // ── DELETE /api/admin/tier-categories/:categoryId/entries/:entryId ───────────

  app.delete("/tier-categories/:categoryId/entries/:entryId", { preHandler: adminHook }, async (req, reply) => {
    const guildId    = BigInt(req.session.activeGuildId!)
    const categoryId = parseInt((req.params as { categoryId: string; entryId: string }).categoryId, 10)
    const entryId    = parseInt((req.params as { categoryId: string; entryId: string }).entryId, 10)

    const existing = await prisma.tierEntry.findFirst({
      where: { id: entryId, categoryId, guildId },
    })
    if (!existing) return reply.code(404).send({ error: "Entry not found" })

    await prisma.tierEntry.delete({ where: { id: entryId } })

    return reply.send({ ok: true, deleted_entry_id: entryId })
  })
}
