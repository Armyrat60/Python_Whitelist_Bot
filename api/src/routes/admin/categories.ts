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
import { toJSON } from "../../lib/json.js"

// ─── Helpers ─────────────────────────────────────────────────────────────────

const adminHook = async (req: FastifyRequest, reply: FastifyReply) => {
  if (!req.session.userId)        return reply.code(401).send({ error: "Not authenticated" })
  if (!req.session.activeGuildId) return reply.code(400).send({ error: "No guild selected" })
  const guild = req.session.guilds?.find(g => g.id === req.session.activeGuildId)
  if (!guild?.isAdmin)            return reply.code(403).send({ error: "Admin access required" })
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
        squad_group:    c.squadGroup ?? null,
        tags:           c.tags ?? null,
        created_at:     c.createdAt,
        updated_at:     c.updatedAt,
        manager_count:  c._count.managers,
        user_count:     c._count.users,
      }))

      return reply.send(toJSON({ categories: result }))
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
        squad_group?: string | null
      }

      if (!body.name || typeof body.name !== "string") {
        return reply.code(400).send({ error: "name is required" })
      }

      const now = new Date()
      const category = await prisma.whitelistCategory.create({
        data: {
          guildId,
          whitelistId,
          name:       body.name.trim(),
          slotLimit:  body.slot_limit ?? null,
          sortOrder:  body.sort_order ?? 0,
          squadGroup: body.squad_group ?? null,
          createdAt:  now,
          updatedAt:  now,
        },
      })

      return reply.code(201).send(toJSON({
        ok:          true,
        id:          category.id,
        name:        category.name,
        slot_limit:  category.slotLimit,
        sort_order:  category.sortOrder,
        squad_group: category.squadGroup ?? null,
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
        name?:         string
        slot_limit?:   number | null
        sort_order?:   number
        squad_group?:  string | null
        tags?:         string | null
        whitelist_id?: number
      }

      const data: Record<string, unknown> = { updatedAt: new Date() }
      if (body.name        !== undefined) data.name       = body.name.trim()
      if (body.slot_limit  !== undefined) data.slotLimit  = body.slot_limit ?? null
      if (body.sort_order  !== undefined) data.sortOrder  = body.sort_order
      if (body.squad_group !== undefined) data.squadGroup = body.squad_group ?? null
      if (body.tags        !== undefined) data.tags       = body.tags ?? null

      // Support reassigning category to a different whitelist
      if (body.whitelist_id !== undefined && body.whitelist_id !== whitelistId) {
        const targetWl = await prisma.whitelist.findFirst({ where: { id: body.whitelist_id, guildId } })
        if (!targetWl) return reply.code(404).send({ error: "Target whitelist not found" })
        data.whitelistId = body.whitelist_id
        // Get user IDs BEFORE moving them
        const usersToMove = await prisma.whitelistUser.findMany({
          where: { guildId, whitelistId, categoryId },
          select: { discordId: true },
        })
        const discordIds = usersToMove.map(u => u.discordId)
        // Move identifiers first (while they still reference old whitelistId)
        if (discordIds.length > 0) {
          await prisma.whitelistIdentifier.updateMany({
            where: { guildId, whitelistId, discordId: { in: discordIds } },
            data: { whitelistId: body.whitelist_id },
          })
        }
        // Then move users
        await prisma.whitelistUser.updateMany({
          where: { guildId, whitelistId, categoryId },
          data: { whitelistId: body.whitelist_id, updatedAt: new Date() },
        })
      }

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

      return reply.send(toJSON({ managers: result }))
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

      return reply.code(201).send(toJSON({
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

  // ── GET /api/admin/whitelists/:whitelistId/categories/:categoryId/entries

  app.get<{ Params: { whitelistId: string; categoryId: string } }>(
    "/whitelists/:whitelistId/categories/:categoryId/entries",
    { preHandler: adminHook },
    async (req, reply) => {
      const guildId     = BigInt(req.session.activeGuildId!)
      const whitelistId = parseInt(req.params.whitelistId, 10)
      const categoryId  = parseInt(req.params.categoryId, 10)

      if (isNaN(whitelistId)) return reply.code(400).send({ error: "Invalid whitelistId" })
      if (isNaN(categoryId))  return reply.code(400).send({ error: "Invalid categoryId" })

      const query = req.query as { page?: string; per_page?: string; search?: string }
      const page    = Math.max(1, parseInt(query.page    ?? "1",  10))
      const perPage = Math.min(200, Math.max(1, parseInt(query.per_page ?? "20", 10)))
      const search  = query.search?.trim() ?? ""

      // Cross-guild leak prevention: verify category belongs to this guild's whitelist
      const category = await prisma.whitelistCategory.findFirst({
        where: { id: categoryId, whitelistId, guildId },
      })
      if (!category) return reply.code(404).send({ error: "Category not found" })

      let where: Record<string, unknown> = { guildId, whitelistId, categoryId }
      if (search) {
        // Search by name or Steam ID
        const isSteamId = /^\d{10,17}$/.test(search)
        if (isSteamId) {
          // Find users whose identifiers match this Steam ID
          const matchingIdents = await prisma.whitelistIdentifier.findMany({
            where: { guildId, whitelistId, idValue: { contains: search } },
            select: { discordId: true },
            take: 200,
          })
          const matchingDiscordIds = matchingIdents.map(i => i.discordId)
          where = { ...where, discordId: { in: matchingDiscordIds } }
        } else {
          where.discordName = { contains: search, mode: "insensitive" }
        }
      }

      const [total, users] = await Promise.all([
        prisma.whitelistUser.count({ where }),
        prisma.whitelistUser.findMany({
          where,
          include: {
            whitelist: { select: { slug: true, name: true } },
            category:  { select: { id: true, name: true } },
          },
          orderBy: { createdAt: "desc" },
          take:    perPage,
          skip:    (page - 1) * perPage,
        }),
      ])

      // Fetch identifiers for all returned users in one query
      const discordIds = users.map(u => u.discordId)
      const identifiers = discordIds.length > 0
        ? await prisma.whitelistIdentifier.findMany({
            where: { guildId, discordId: { in: discordIds } },
            select: { discordId: true, whitelistId: true, idType: true, idValue: true },
          })
        : []

      // Group identifiers by discordId + whitelistId
      const identMap = new Map<string, { steam_ids: string[]; eos_ids: string[] }>()
      for (const ident of identifiers) {
        const key = `${ident.discordId}:${ident.whitelistId}`
        if (!identMap.has(key)) identMap.set(key, { steam_ids: [], eos_ids: [] })
        const entry = identMap.get(key)!
        if (ident.idType === "steamid" || ident.idType === "steam64") entry.steam_ids.push(ident.idValue)
        if (ident.idType === "eosid")   entry.eos_ids.push(ident.idValue)
      }

      const entries = users.map(u => {
        const idents = identMap.get(`${u.discordId}:${u.whitelistId}`) ?? { steam_ids: [], eos_ids: [] }
        return {
          discord_id:           u.discordId.toString(),
          discord_name:         u.discordName,
          whitelist_slug:       u.whitelist.slug,
          whitelist_name:       u.whitelist.name,
          status:               u.status,
          slot_limit_override:  u.slotLimitOverride,
          effective_slot_limit: u.effectiveSlotLimit,
          last_plan_name:       u.lastPlanName,
          created_at:           u.createdAt,
          updated_at:           u.updatedAt,
          expires_at:           u.expiresAt,
          created_via:          u.createdVia,
          notes:                u.notes,
          category_id:          u.categoryId ?? null,
          category_name:        u.category?.name ?? null,
          steam_ids:            idents.steam_ids,
          eos_ids:              idents.eos_ids,
        }
      })

      return reply.send(toJSON({ entries, total, page, per_page: perPage }))
    }
  )

  // ── POST /api/admin/whitelists/:whitelistId/categories/:categoryId/entries

  app.post<{ Params: { whitelistId: string; categoryId: string } }>(
    "/whitelists/:whitelistId/categories/:categoryId/entries",
    { preHandler: adminHook },
    async (req, reply) => {
      const guildId     = BigInt(req.session.activeGuildId!)
      const whitelistId = parseInt(req.params.whitelistId, 10)
      const categoryId  = parseInt(req.params.categoryId, 10)

      if (isNaN(whitelistId)) return reply.code(400).send({ error: "Invalid whitelistId" })
      if (isNaN(categoryId))  return reply.code(400).send({ error: "Invalid categoryId" })

      const category = await prisma.whitelistCategory.findFirst({
        where: { id: categoryId, whitelistId, guildId },
        include: { _count: { select: { users: true } } },
      })
      if (!category) return reply.code(404).send({ error: "Category not found" })

      const body = req.body as {
        steam_id:     string
        discord_id?:  string
        discord_name?: string
        notes?:       string
        expires_at?:  string | null
      }

      if (!body.steam_id?.trim()) {
        return reply.code(400).send({ error: "steam_id is required" })
      }

      const steamId    = body.steam_id.trim()
      const discordName = body.discord_name?.trim() || "[No Discord]"

      // If no discord_id provided, generate synthetic one from steam_id
      let discordId: bigint
      if (body.discord_id?.trim()) {
        try {
          discordId = BigInt(body.discord_id.trim())
        } catch {
          return reply.code(400).send({ error: "Invalid discord_id" })
        }
      } else {
        discordId = BigInt("1" + steamId.slice(-16).padStart(16, "0"))
      }

      const createdVia = body.discord_id?.trim() ? "admin" : "manual_steam_only"
      const now        = new Date()

      // Verify whitelist exists for this guild
      const wl = await prisma.whitelist.findFirst({ where: { id: whitelistId, guildId } })
      if (!wl) return reply.code(404).send({ error: "Whitelist not found" })

      try {
        await prisma.$transaction(async (tx) => {
          // Re-check slot limit inside transaction to prevent race condition
          if (category.slotLimit !== null) {
            const currentCount = await tx.whitelistUser.count({
              where: { guildId, whitelistId, categoryId },
            })
            if (currentCount >= category.slotLimit) {
              throw new Error("__CATEGORY_FULL__")
            }
          }

          await tx.whitelistUser.upsert({
            where: { guildId_discordId_whitelistId: { guildId, discordId, whitelistId } },
            update: {
              discordName,
              categoryId,
              notes:     body.notes ?? null,
              expiresAt: body.expires_at ? new Date(body.expires_at) : null,
              updatedAt: now,
            },
            create: {
              guildId,
              discordId,
              whitelistId,
              discordName,
              categoryId,
              status:             "active",
              effectiveSlotLimit: wl.defaultSlotLimit,
              notes:              body.notes ?? null,
              expiresAt:          body.expires_at ? new Date(body.expires_at) : null,
              createdVia,
              createdAt:          now,
              updatedAt:          now,
            },
          })

          await tx.whitelistIdentifier.upsert({
            where: {
              guildId_discordId_whitelistId_idType_idValue: {
                guildId, discordId, whitelistId, idType: "steam64", idValue: steamId,
              },
            },
            update: { updatedAt: now },
            create: {
              guildId, discordId, whitelistId,
              idType: "steam64", idValue: steamId,
              isVerified: false, createdAt: now, updatedAt: now,
            },
          })
        })
      } catch (err) {
        if (err instanceof Error && err.message === "__CATEGORY_FULL__") {
          return reply.code(409).send({ error: "Category is full" })
        }
        throw err
      }

      return reply.code(201).send(toJSON({
        ok:           true,
        discord_id:   discordId.toString(),
        discord_name: discordName,
        steam_id:     steamId,
      }))
    }
  )

  // ── DELETE /api/admin/whitelists/:whitelistId/categories/:categoryId/entries/:discordId

  app.delete<{ Params: { whitelistId: string; categoryId: string; discordId: string } }>(
    "/whitelists/:whitelistId/categories/:categoryId/entries/:discordId",
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

      const user = await prisma.whitelistUser.findUnique({
        where: { guildId_discordId_whitelistId: { guildId, discordId, whitelistId } },
      })
      if (!user) return reply.code(404).send({ error: "Entry not found" })

      // Confirm the user is actually in this category
      if (user.categoryId !== categoryId) {
        return reply.code(409).send({ error: "Entry does not belong to this category" })
      }

      if (user.createdVia === "admin" || user.createdVia === "manual_steam_only") {
        // Fully delete the user and their identifiers
        await prisma.$transaction([
          prisma.whitelistIdentifier.deleteMany({ where: { guildId, discordId, whitelistId } }),
          prisma.whitelistUser.delete({
            where: { guildId_discordId_whitelistId: { guildId, discordId, whitelistId } },
          }),
        ])
      } else {
        // Role-based user assigned to category: just unassign from category
        await prisma.whitelistUser.update({
          where: { guildId_discordId_whitelistId: { guildId, discordId, whitelistId } },
          data: { categoryId: null, updatedAt: new Date() },
        })
      }

      return reply.send({ ok: true })
    }
  )

  // ── POST /api/admin/whitelists/:whitelistId/categories/:categoryId/entries/import
  // Bulk CSV import. Body: { csv: string } — rows: steam_id,discord_id,discord_name,notes,expires_at

  app.post<{ Params: { whitelistId: string; categoryId: string } }>(
    "/whitelists/:whitelistId/categories/:categoryId/entries/import",
    { preHandler: adminHook },
    async (req, reply) => {
      const guildId     = BigInt(req.session.activeGuildId!)
      const whitelistId = parseInt(req.params.whitelistId, 10)
      const categoryId  = parseInt(req.params.categoryId, 10)

      if (isNaN(whitelistId)) return reply.code(400).send({ error: "Invalid whitelistId" })
      if (isNaN(categoryId))  return reply.code(400).send({ error: "Invalid categoryId" })

      const [category, wl] = await Promise.all([
        prisma.whitelistCategory.findFirst({ where: { id: categoryId, whitelistId, guildId } }),
        prisma.whitelist.findFirst({ where: { id: whitelistId, guildId } }),
      ])
      if (!category) return reply.code(404).send({ error: "Category not found" })
      if (!wl)       return reply.code(404).send({ error: "Whitelist not found" })

      const body = req.body as { csv?: string }
      if (!body.csv?.trim()) return reply.code(400).send({ error: "csv field is required" })

      // Parse CSV: first line may be a header
      const lines = body.csv.trim().split(/\r?\n/).map(l => l.trim()).filter(Boolean)
      if (lines.length === 0) return reply.code(400).send({ error: "No rows in CSV" })

      // Detect header by checking if first cell looks like a column name
      const firstCell = lines[0].split(",")[0].trim().toLowerCase()
      const hasHeader = ["steam_id", "steamid", "steam64", "id"].includes(firstCell)
      const dataLines = hasHeader ? lines.slice(1) : lines

      if (dataLines.length === 0) return reply.code(400).send({ error: "No data rows found (only header)" })
      if (dataLines.length > 500) return reply.code(400).send({ error: "Too many rows — max 500 per import" })

      const results = { added: 0, updated: 0, errors: [] as { row: number; message: string }[] }
      const now = new Date()

      for (let i = 0; i < dataLines.length; i++) {
        const [col0, col1, col2, col3, col4] = dataLines[i].split(",").map(c => c.trim().replace(/^"|"$/g, "").trim())
        const steamId = col0
        if (!steamId) { results.errors.push({ row: i + 1, message: "Missing steam_id" }); continue }

        const discordIdStr  = col1 ?? ""
        const discordName   = col2?.trim() || "[No Discord]"
        const notes         = col3?.trim() || null
        const expiresAtStr  = col4?.trim() || null

        let discordId: bigint
        if (discordIdStr) {
          try { discordId = BigInt(discordIdStr) }
          catch { results.errors.push({ row: i + 1, message: `Invalid discord_id: ${discordIdStr}` }); continue }
        } else {
          discordId = BigInt("1" + steamId.slice(-16).padStart(16, "0"))
        }

        const expiresAt = expiresAtStr ? (() => { try { const d = new Date(expiresAtStr); return isNaN(d.getTime()) ? null : d } catch { return null } })() : null
        const createdVia = discordIdStr ? "admin" : "manual_steam_only"

        try {
          const existing = await prisma.whitelistUser.findUnique({
            where: { guildId_discordId_whitelistId: { guildId, discordId, whitelistId } },
          })

          await prisma.$transaction(async (tx) => {
            await tx.whitelistUser.upsert({
              where: { guildId_discordId_whitelistId: { guildId, discordId, whitelistId } },
              update: { discordName, categoryId, notes, expiresAt, updatedAt: now },
              create: {
                guildId, discordId, whitelistId, discordName, categoryId,
                status: "active", effectiveSlotLimit: wl.defaultSlotLimit,
                notes, expiresAt, createdVia, createdAt: now, updatedAt: now,
              },
            })
            await tx.whitelistIdentifier.upsert({
              where: { guildId_discordId_whitelistId_idType_idValue: { guildId, discordId, whitelistId, idType: "steam64", idValue: steamId } },
              update: { updatedAt: now },
              create: { guildId, discordId, whitelistId, idType: "steam64", idValue: steamId, isVerified: false, createdAt: now, updatedAt: now },
            })
          })

          if (existing) results.updated++ ; else results.added++
        } catch (err) {
          app.log.warn({ err, row: i + 1 }, "CSV import row failed")
          results.errors.push({ row: i + 1, message: "Database error — row skipped" })
        }
      }

      return reply.send(toJSON({ ok: true, ...results }))
    }
  )
}
