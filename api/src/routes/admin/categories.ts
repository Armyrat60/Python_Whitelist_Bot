/**
 * Whitelist category management routes.
 *
 * Categories allow manual whitelists to segment users into named groups,
 * each optionally with their own slot limit and a set of category managers.
 *
 * GET    /api/admin/whitelists/:whitelistId/categories
 * POST   /api/admin/whitelists/:whitelistId/categories
 * PUT    /api/admin/whitelists/:whitelistId/categories/:categoryId
 * DELETE /api/admin/whitelists/:whitelistId/categories/:categoryId
 *
 * GET    /api/admin/whitelists/:whitelistId/categories/:categoryId/managers
 * POST   /api/admin/whitelists/:whitelistId/categories/:categoryId/managers
 * DELETE /api/admin/whitelists/:whitelistId/categories/:categoryId/managers/:discordId
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify"

// ─── Helpers ─────────────────────────────────────────────────────────────────

const adminHook = async (req: FastifyRequest, reply: FastifyReply) => {
  if (!req.session.userId)        return reply.code(401).send({ error: "Not authenticated" })
  if (!req.session.activeGuildId) return reply.code(400).send({ error: "No guild selected" })
  const guild = req.session.guilds?.find(g => g.id === req.session.activeGuildId)
  if (!guild?.isAdmin)            return reply.code(403).send({ error: "Admin access required" })
}

function bigIntReplacer(_: string, v: unknown): unknown {
  return typeof v === "bigint" ? v.toString() : v
}
function safeJson(data: unknown): unknown {
  return JSON.parse(JSON.stringify(data, bigIntReplacer))
}

// ─── Routes ──────────────────────────────────────────────────────────────────

export default async function categoryRoutes(app: FastifyInstance) {
  const { prisma } = app

  // ── GET /api/admin/whitelists/:whitelistId/categories ────────────────────

  app.get<{ Params: { whitelistId: string } }>(
    "/whitelists/:whitelistId/categories",
    { preHandler: adminHook },
    async (req, reply) => {
      const guildId     = BigInt(req.session.activeGuildId!)
      const whitelistId = parseInt(req.params.whitelistId, 10)
      if (isNaN(whitelistId)) return reply.code(400).send({ error: "Invalid whitelistId" })

      // Cross-guild leak prevention
      const wl = await prisma.whitelist.findFirst({ where: { id: whitelistId, guildId } })
      if (!wl) return reply.code(404).send({ error: "Whitelist not found" })

      const categories = await prisma.whitelistCategory.findMany({
        where:   { whitelistId, guildId },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        include: {
          _count: {
            select: { managers: true, users: true },
          },
        },
      })

      const result = categories.map(c => ({
        id:             c.id,
        whitelist_id:   c.whitelistId,
        name:           c.name,
        slot_limit:     c.slotLimit,
        sort_order:     c.sortOrder,
        created_at:     c.createdAt,
        updated_at:     c.updatedAt,
        manager_count:  c._count.managers,
        user_count:     c._count.users,
      }))

      return reply.send(safeJson({ categories: result }))
    }
  )

  // ── POST /api/admin/whitelists/:whitelistId/categories ───────────────────

  app.post<{ Params: { whitelistId: string } }>(
    "/whitelists/:whitelistId/categories",
    { preHandler: adminHook },
    async (req, reply) => {
      const guildId     = BigInt(req.session.activeGuildId!)
      const whitelistId = parseInt(req.params.whitelistId, 10)
      if (isNaN(whitelistId)) return reply.code(400).send({ error: "Invalid whitelistId" })

      const wl = await prisma.whitelist.findFirst({ where: { id: whitelistId, guildId } })
      if (!wl) return reply.code(404).send({ error: "Whitelist not found" })

      const body = req.body as {
        name:        string
        slot_limit?: number | null
        sort_order?: number
      }

      if (!body.name || typeof body.name !== "string") {
        return reply.code(400).send({ error: "name is required" })
      }

      const now = new Date()
      const category = await prisma.whitelistCategory.create({
        data: {
          guildId,
          whitelistId,
          name:      body.name.trim(),
          slotLimit: body.slot_limit ?? null,
          sortOrder: body.sort_order ?? 0,
          createdAt: now,
          updatedAt: now,
        },
      })

      return reply.code(201).send(safeJson({
        ok:         true,
        id:         category.id,
        name:       category.name,
        slot_limit: category.slotLimit,
        sort_order: category.sortOrder,
      }))
    }
  )

  // ── PUT /api/admin/whitelists/:whitelistId/categories/:categoryId ────────

  app.put<{ Params: { whitelistId: string; categoryId: string } }>(
    "/whitelists/:whitelistId/categories/:categoryId",
    { preHandler: adminHook },
    async (req, reply) => {
      const guildId     = BigInt(req.session.activeGuildId!)
      const whitelistId = parseInt(req.params.whitelistId, 10)
      const categoryId  = parseInt(req.params.categoryId, 10)

      if (isNaN(whitelistId)) return reply.code(400).send({ error: "Invalid whitelistId" })
      if (isNaN(categoryId))  return reply.code(400).send({ error: "Invalid categoryId" })

      // Cross-guild leak prevention: verify category belongs to this guild's whitelist
      const existing = await prisma.whitelistCategory.findFirst({
        where: { id: categoryId, whitelistId, guildId },
      })
      if (!existing) return reply.code(404).send({ error: "Category not found" })

      const body = req.body as {
        name?:       string
        slot_limit?: number | null
        sort_order?: number
      }

      const data: Record<string, unknown> = { updatedAt: new Date() }
      if (body.name       !== undefined) data.name      = body.name.trim()
      if (body.slot_limit !== undefined) data.slotLimit = body.slot_limit ?? null
      if (body.sort_order !== undefined) data.sortOrder = body.sort_order

      await prisma.whitelistCategory.update({ where: { id: categoryId }, data })

      return reply.send({ ok: true })
    }
  )

  // ── DELETE /api/admin/whitelists/:whitelistId/categories/:categoryId ─────

  app.delete<{ Params: { whitelistId: string; categoryId: string } }>(
    "/whitelists/:whitelistId/categories/:categoryId",
    { preHandler: adminHook },
    async (req, reply) => {
      const guildId     = BigInt(req.session.activeGuildId!)
      const whitelistId = parseInt(req.params.whitelistId, 10)
      const categoryId  = parseInt(req.params.categoryId, 10)

      if (isNaN(whitelistId)) return reply.code(400).send({ error: "Invalid whitelistId" })
      if (isNaN(categoryId))  return reply.code(400).send({ error: "Invalid categoryId" })

      const existing = await prisma.whitelistCategory.findFirst({
        where: { id: categoryId, whitelistId, guildId },
      })
      if (!existing) return reply.code(404).send({ error: "Category not found" })

      // Cascade: managers deleted by FK ON DELETE CASCADE.
      // Users: category_id set to NULL by FK ON DELETE SET NULL.
      await prisma.whitelistCategory.delete({ where: { id: categoryId } })

      return reply.send({ ok: true })
    }
  )

  // ── GET /api/admin/whitelists/:whitelistId/categories/:categoryId/managers

  app.get<{ Params: { whitelistId: string; categoryId: string } }>(
    "/whitelists/:whitelistId/categories/:categoryId/managers",
    { preHandler: adminHook },
    async (req, reply) => {
      const guildId     = BigInt(req.session.activeGuildId!)
      const whitelistId = parseInt(req.params.whitelistId, 10)
      const categoryId  = parseInt(req.params.categoryId, 10)

      if (isNaN(whitelistId)) return reply.code(400).send({ error: "Invalid whitelistId" })
      if (isNaN(categoryId))  return reply.code(400).send({ error: "Invalid categoryId" })

      const category = await prisma.whitelistCategory.findFirst({
        where: { id: categoryId, whitelistId, guildId },
      })
      if (!category) return reply.code(404).send({ error: "Category not found" })

      const managers = await prisma.categoryManager.findMany({
        where:   { categoryId },
        orderBy: { addedAt: "asc" },
      })

      const result = managers.map(m => ({
        id:           m.id,
        category_id:  m.categoryId,
        discord_id:   m.discordId.toString(),
        discord_name: m.discordName,
        added_at:     m.addedAt,
      }))

      return reply.send(safeJson({ managers: result }))
    }
  )

  // ── POST /api/admin/whitelists/:whitelistId/categories/:categoryId/managers

  app.post<{ Params: { whitelistId: string; categoryId: string } }>(
    "/whitelists/:whitelistId/categories/:categoryId/managers",
    { preHandler: adminHook },
    async (req, reply) => {
      const guildId     = BigInt(req.session.activeGuildId!)
      const whitelistId = parseInt(req.params.whitelistId, 10)
      const categoryId  = parseInt(req.params.categoryId, 10)

      if (isNaN(whitelistId)) return reply.code(400).send({ error: "Invalid whitelistId" })
      if (isNaN(categoryId))  return reply.code(400).send({ error: "Invalid categoryId" })

      const category = await prisma.whitelistCategory.findFirst({
        where: { id: categoryId, whitelistId, guildId },
      })
      if (!category) return reply.code(404).send({ error: "Category not found" })

      const body = req.body as {
        discord_id:   string
        discord_name: string
      }

      if (!body.discord_id || !body.discord_name) {
        return reply.code(400).send({ error: "discord_id and discord_name are required" })
      }

      const discordId = (() => { try { return BigInt(body.discord_id) } catch { return null } })()
      if (!discordId) return reply.code(400).send({ error: "Invalid discord_id" })

      const manager = await prisma.categoryManager.upsert({
        where:  { categoryId_discordId: { categoryId, discordId } },
        update: { discordName: body.discord_name },
        create: { categoryId, discordId, discordName: body.discord_name },
      })

      return reply.code(201).send(safeJson({
        ok:           true,
        id:           manager.id,
        discord_id:   manager.discordId.toString(),
        discord_name: manager.discordName,
      }))
    }
  )

  // ── DELETE /api/admin/whitelists/:whitelistId/categories/:categoryId/managers/:discordId

  app.delete<{ Params: { whitelistId: string; categoryId: string; discordId: string } }>(
    "/whitelists/:whitelistId/categories/:categoryId/managers/:discordId",
    { preHandler: adminHook },
    async (req, reply) => {
      const guildId     = BigInt(req.session.activeGuildId!)
      const whitelistId = parseInt(req.params.whitelistId, 10)
      const categoryId  = parseInt(req.params.categoryId, 10)

      if (isNaN(whitelistId)) return reply.code(400).send({ error: "Invalid whitelistId" })
      if (isNaN(categoryId))  return reply.code(400).send({ error: "Invalid categoryId" })

      const discordId = (() => { try { return BigInt(req.params.discordId) } catch { return null } })()
      if (!discordId) return reply.code(400).send({ error: "Invalid discordId" })

      // Cross-guild leak prevention
      const category = await prisma.whitelistCategory.findFirst({
        where: { id: categoryId, whitelistId, guildId },
      })
      if (!category) return reply.code(404).send({ error: "Category not found" })

      const existing = await prisma.categoryManager.findUnique({
        where: { categoryId_discordId: { categoryId, discordId } },
      })
      if (!existing) return reply.code(404).send({ error: "Manager not found" })

      await prisma.categoryManager.delete({
        where: { categoryId_discordId: { categoryId, discordId } },
      })

      return reply.send({ ok: true })
    }
  )
}
