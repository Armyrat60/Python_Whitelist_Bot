/**
 * Admin user management routes.
 *
 * Prefix: /api/admin
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify"
import { syncOutputs } from "../../services/output.js"
import { cache } from "../../services/cache.js"
import { getFileToken } from "../../services/token.js"

// ─── Auth preHandlers ─────────────────────────────────────────────────────────

const adminHook = async (req: FastifyRequest, reply: FastifyReply) => {
  if (!req.session.userId) return reply.code(401).send({ error: "Not authenticated" })
  if (!req.session.activeGuildId) return reply.code(400).send({ error: "No guild selected" })
  const guild = req.session.guilds?.find(g => g.id === req.session.activeGuildId)
  if (!guild?.isAdmin) return reply.code(403).send({ error: "Admin access required" })
}

// Allows admins AND roster_managers (roster managers get scoped to their categories)
const rosterOrAdminHook = async (req: FastifyRequest, reply: FastifyReply) => {
  if (!req.session.userId) return reply.code(401).send({ error: "Not authenticated" })
  if (!req.session.activeGuildId) return reply.code(400).send({ error: "No guild selected" })
  const guild = req.session.guilds?.find(g => g.id === req.session.activeGuildId)
  if (!guild) return reply.code(403).send({ error: "Not a member of this guild" })
  const ok = guild.isAdmin || guild.permissionLevel === "roster_manager"
  if (!ok) return reply.code(403).send({ error: "Access denied" })
}

function isRosterManager(req: FastifyRequest) {
  const guild = req.session.guilds?.find(g => g.id === req.session.activeGuildId)
  return guild?.permissionLevel === "roster_manager" && !guild?.isAdmin
}

// ─── BigInt JSON helpers ──────────────────────────────────────────────────────

function bigIntReplacer(_: string, v: unknown) { return typeof v === "bigint" ? v.toString() : v }
function toJSON(data: unknown) { return JSON.parse(JSON.stringify(data, bigIntReplacer)) }

// ─── triggerSync ──────────────────────────────────────────────────────────────

async function triggerSync(app: FastifyInstance, guildId: bigint) {
  try {
    const outputs = await syncOutputs(app.prisma, guildId)
    cache.set(guildId, outputs)
    const salt = await app.prisma.botSetting.findUnique({
      where: { guildId_settingKey: { guildId, settingKey: "url_salt" } }
    })
    cache.registerToken(getFileToken(guildId, salt?.settingValue ?? null), guildId)
  } catch (err) {
    app.log.error({ err, guildId }, "triggerSync failed")
  }
}

// ─── Routes ───────────────────────────────────────────────────────────────────

export default async function userRoutes(app: FastifyInstance) {
  const { prisma } = app

  // ── GET /api/admin/users ─────────────────────────────────────────────────────

  app.get("/users", { preHandler: rosterOrAdminHook }, async (req, reply) => {
    const guildId      = BigInt(req.session.activeGuildId!)
    const rosterMgr    = isRosterManager(req)
    const query        = req.query as {
      page?:        string
      per_page?:    string
      search?:      string
      whitelist?:   string
      status?:      string
      category_id?: string
    }

    const page    = Math.max(1, parseInt(query.page    ?? "1",  10))
    const perPage = Math.min(200, Math.max(1, parseInt(query.per_page ?? "50", 10)))
    const search  = query.search?.trim() ?? ""
    const status  = query.status ?? "all"

    // For roster managers, find categories they manage and restrict scope
    let allowedCategoryIds: number[] | undefined
    if (rosterMgr) {
      const managed = await prisma.categoryManager.findMany({
        where: { discordId: BigInt(req.session.userId!) },
        select: { categoryId: true },
      })
      allowedCategoryIds = managed.map(m => m.categoryId)
      if (allowedCategoryIds.length === 0) {
        // Manager with no assigned categories sees nothing
        return reply.send({ users: [], total: 0, page, per_page: perPage, pages: 0 })
      }
    }

    // Resolve whitelist_id from slug if provided
    let whitelistId: number | undefined
    if (query.whitelist) {
      const wl = await prisma.whitelist.findUnique({
        where: { guildId_slug: { guildId, slug: query.whitelist } },
        select: { id: true },
      })
      if (!wl) return reply.code(404).send({ error: "Whitelist not found" })
      whitelistId = wl.id
    }

    const where: Record<string, unknown> = { guildId }
    if (status !== "all") where.status = status
    if (whitelistId !== undefined) where.whitelistId = whitelistId
    if (search) {
      where.discordName = { contains: search, mode: "insensitive" }
    }
    if (allowedCategoryIds !== undefined) {
      // Roster manager: restrict to their assigned categories
      const catId = query.category_id ? parseInt(query.category_id, 10) : NaN
      if (!isNaN(catId) && allowedCategoryIds.includes(catId)) {
        where.categoryId = catId
      } else {
        where.categoryId = { in: allowedCategoryIds }
      }
    } else if (query.category_id) {
      const catId = parseInt(query.category_id, 10)
      if (!isNaN(catId)) where.categoryId = catId
    }

    const [total, users] = await Promise.all([
      prisma.whitelistUser.count({ where }),
      prisma.whitelistUser.findMany({
        where,
        include: {
          whitelist: { select: { slug: true, name: true } },
          category:  { select: { id: true, name: true } },
        },
        orderBy: { discordName: "asc" },
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
      if (ident.idType === "steamid") entry.steam_ids.push(ident.idValue)
      if (ident.idType === "eosid")   entry.eos_ids.push(ident.idValue)
    }

    const result = users.map(u => {
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
        notes:                rosterMgr ? undefined : u.notes,  // hidden from roster managers
        category_id:          u.categoryId ?? null,
        category_name:        u.category?.name ?? null,
        steam_ids:            idents.steam_ids,
        eos_ids:              idents.eos_ids,
      }
    })

    return reply.send(toJSON({
      users:    result,
      total,
      page,
      per_page: perPage,
      pages:    Math.ceil(total / perPage),
    }))
  })

  // ── POST /api/admin/users ────────────────────────────────────────────────────

  app.post("/users", { preHandler: adminHook }, async (req, reply) => {
    const guildId = BigInt(req.session.activeGuildId!)
    const body    = req.body as {
      discord_id:           string
      discord_name:         string
      whitelist_slug:       string
      steam_ids?:           string[]
      eos_ids?:             string[]
      slot_limit_override?: number | null
      expires_at?:          string | null
      notes?:               string | null
      category_id?:         number | null
    }

    if (!body.discord_id || !body.discord_name || !body.whitelist_slug) {
      return reply.code(400).send({ error: "discord_id, discord_name, and whitelist_slug are required" })
    }

    const wl = await prisma.whitelist.findUnique({
      where: { guildId_slug: { guildId, slug: body.whitelist_slug } },
    })
    if (!wl) return reply.code(404).send({ error: "Whitelist not found" })

    const discordId = BigInt(body.discord_id)
    const now       = new Date()

    await prisma.$transaction(async (tx) => {
      await tx.whitelistUser.upsert({
        where: { guildId_discordId_whitelistId: { guildId, discordId, whitelistId: wl.id } },
        update: {
          discordName:       body.discord_name,
          status:            "active",
          slotLimitOverride: body.slot_limit_override ?? null,
          expiresAt:         body.expires_at ? new Date(body.expires_at) : null,
          notes:             body.notes ?? null,
          categoryId:        body.category_id ?? null,
          updatedAt:         now,
        },
        create: {
          guildId,
          discordId,
          whitelistId:       wl.id,
          discordName:       body.discord_name,
          status:            "active",
          slotLimitOverride: body.slot_limit_override ?? null,
          effectiveSlotLimit: body.slot_limit_override ?? wl.defaultSlotLimit,
          expiresAt:         body.expires_at ? new Date(body.expires_at) : null,
          notes:             body.notes ?? null,
          categoryId:        body.category_id ?? null,
          createdAt:         now,
          updatedAt:         now,
          createdVia:        "admin",
        },
      })

      const steamIds = body.steam_ids ?? []
      const eosIds   = body.eos_ids   ?? []

      for (const idValue of steamIds) {
        await tx.whitelistIdentifier.upsert({
          where: {
            guildId_discordId_whitelistId_idType_idValue: {
              guildId, discordId, whitelistId: wl.id, idType: "steamid", idValue,
            },
          },
          update: { updatedAt: now },
          create: {
            guildId, discordId, whitelistId: wl.id,
            idType: "steamid", idValue,
            isVerified: false, createdAt: now, updatedAt: now,
          },
        })
      }

      for (const idValue of eosIds) {
        await tx.whitelistIdentifier.upsert({
          where: {
            guildId_discordId_whitelistId_idType_idValue: {
              guildId, discordId, whitelistId: wl.id, idType: "eosid", idValue,
            },
          },
          update: { updatedAt: now },
          create: {
            guildId, discordId, whitelistId: wl.id,
            idType: "eosid", idValue,
            isVerified: false, createdAt: now, updatedAt: now,
          },
        })
      }

      await tx.auditLog.create({
        data: {
          guildId,
          whitelistId:    wl.id,
          actionType:     "user_added",
          actorDiscordId: req.session.userId ? BigInt(req.session.userId) : null,
          targetDiscordId: discordId,
          details:        JSON.stringify({ discord_name: body.discord_name, notes: body.notes ?? null }),
          createdAt:      now,
        },
      })
    })

    await triggerSync(app, guildId)

    return reply.code(201).send(toJSON({
      ok:           true,
      discord_id:   body.discord_id,
      discord_name: body.discord_name,
    }))
  })

  // ── PATCH /api/admin/users/:discordId/:type ──────────────────────────────────
  // :type is the whitelist slug

  app.patch("/users/:discordId/:type", { preHandler: rosterOrAdminHook }, async (req, reply) => {
    const guildId    = BigInt(req.session.activeGuildId!)
    const rosterMgr  = isRosterManager(req)
    const params     = req.params as { discordId: string; type: string }
    const discordId  = BigInt(params.discordId)
    const body       = req.body as {
      status?:              string
      slot_limit_override?: number | null
      expires_at?:          string | null
      notes?:               string | null
      category_id?:         number | null
    }

    // Roster managers cannot change expiry dates or admin notes
    if (rosterMgr) {
      if (body.expires_at !== undefined) return reply.code(403).send({ error: "Roster managers cannot change expiry dates" })
      if (body.notes      !== undefined) return reply.code(403).send({ error: "Roster managers cannot edit admin notes" })
    }

    const wl = await prisma.whitelist.findUnique({
      where: { guildId_slug: { guildId, slug: params.type } },
    })
    if (!wl) return reply.code(404).send({ error: "Whitelist not found" })

    const user = await prisma.whitelistUser.findUnique({
      where: { guildId_discordId_whitelistId: { guildId, discordId, whitelistId: wl.id } },
    })
    if (!user) return reply.code(404).send({ error: "User not found" })

    // Roster managers can only modify users in their assigned categories
    if (rosterMgr && user.categoryId !== null) {
      const managed = await prisma.categoryManager.findFirst({
        where: { categoryId: user.categoryId, discordId: BigInt(req.session.userId!) },
      })
      if (!managed) return reply.code(403).send({ error: "Not a manager of this category" })
    } else if (rosterMgr && user.categoryId === null) {
      return reply.code(403).send({ error: "Cannot edit users without an assigned category" })
    }

    const data: Record<string, unknown> = { updatedAt: new Date() }
    if (body.status              !== undefined) data.status            = body.status
    if (body.slot_limit_override !== undefined) data.slotLimitOverride = body.slot_limit_override
    if (body.expires_at          !== undefined) data.expiresAt         = body.expires_at ? new Date(body.expires_at) : null
    if (body.notes               !== undefined) data.notes             = body.notes ?? null
    if (body.category_id         !== undefined) data.categoryId        = body.category_id ?? null

    await prisma.whitelistUser.update({
      where: { guildId_discordId_whitelistId: { guildId, discordId, whitelistId: wl.id } },
      data,
    })

    await prisma.auditLog.create({
      data: {
        guildId,
        whitelistId:     wl.id,
        actionType:      "user_updated",
        actorDiscordId:  req.session.userId ? BigInt(req.session.userId) : null,
        targetDiscordId: discordId,
        details:         JSON.stringify({ changes: Object.keys(data) }),
        createdAt:       new Date(),
      },
    })

    await triggerSync(app, guildId)

    return reply.send({ ok: true })
  })

  // ── DELETE /api/admin/users/:discordId/:type ─────────────────────────────────
  // :type is the whitelist slug

  app.delete("/users/:discordId/:type", { preHandler: adminHook }, async (req, reply) => {
    const guildId   = BigInt(req.session.activeGuildId!)
    const params    = req.params as { discordId: string; type: string }
    const discordId = BigInt(params.discordId)

    const wl = await prisma.whitelist.findUnique({
      where: { guildId_slug: { guildId, slug: params.type } },
    })
    if (!wl) return reply.code(404).send({ error: "Whitelist not found" })

    const user = await prisma.whitelistUser.findUnique({
      where: { guildId_discordId_whitelistId: { guildId, discordId, whitelistId: wl.id } },
    })
    if (!user) return reply.code(404).send({ error: "User not found" })

    await prisma.$transaction([
      prisma.whitelistIdentifier.deleteMany({ where: { guildId, discordId, whitelistId: wl.id } }),
      prisma.whitelistUser.delete({
        where: { guildId_discordId_whitelistId: { guildId, discordId, whitelistId: wl.id } },
      }),
    ])

    await prisma.auditLog.create({
      data: {
        guildId,
        whitelistId:     wl.id,
        actionType:      "user_removed",
        actorDiscordId:  req.session.userId ? BigInt(req.session.userId) : null,
        targetDiscordId: discordId,
        details:         JSON.stringify({ discord_name: user.discordName }),
        createdAt:       new Date(),
      },
    })

    await triggerSync(app, guildId)

    return reply.send({ ok: true })
  })

  // ── POST /api/admin/users/bulk-delete ────────────────────────────────────────

  app.post("/users/bulk-delete", { preHandler: adminHook }, async (req, reply) => {
    const guildId = BigInt(req.session.activeGuildId!)
    const body    = req.body as { discord_ids: string[]; whitelist_slug: string }

    if (!Array.isArray(body.discord_ids) || body.discord_ids.length === 0) {
      return reply.code(400).send({ error: "discord_ids must be a non-empty array" })
    }
    if (!body.whitelist_slug) {
      return reply.code(400).send({ error: "whitelist_slug is required" })
    }

    const wl = await prisma.whitelist.findUnique({
      where: { guildId_slug: { guildId, slug: body.whitelist_slug } },
    })
    if (!wl) return reply.code(404).send({ error: "Whitelist not found" })

    const discordIds = body.discord_ids.map(id => BigInt(id))

    const { count } = await prisma.$transaction(async (tx) => {
      await tx.whitelistIdentifier.deleteMany({
        where: { guildId, whitelistId: wl.id, discordId: { in: discordIds } },
      })
      return tx.whitelistUser.deleteMany({
        where: { guildId, whitelistId: wl.id, discordId: { in: discordIds } },
      })
    })

    await triggerSync(app, guildId)

    return reply.send({ ok: true, deleted: count })
  })

  // ── POST /api/admin/users/bulk-move ──────────────────────────────────────────

  app.post("/users/bulk-move", { preHandler: adminHook }, async (req, reply) => {
    const guildId = BigInt(req.session.activeGuildId!)
    const body    = req.body as {
      discord_ids: string[]
      from_slug:   string
      to_slug:     string
    }

    if (!Array.isArray(body.discord_ids) || body.discord_ids.length === 0) {
      return reply.code(400).send({ error: "discord_ids must be a non-empty array" })
    }
    if (!body.from_slug || !body.to_slug) {
      return reply.code(400).send({ error: "from_slug and to_slug are required" })
    }
    if (body.from_slug === body.to_slug) {
      return reply.code(400).send({ error: "from_slug and to_slug must be different" })
    }

    const [fromWl, toWl] = await Promise.all([
      prisma.whitelist.findUnique({ where: { guildId_slug: { guildId, slug: body.from_slug } } }),
      prisma.whitelist.findUnique({ where: { guildId_slug: { guildId, slug: body.to_slug } } }),
    ])
    if (!fromWl) return reply.code(404).send({ error: "Source whitelist not found" })
    if (!toWl)   return reply.code(404).send({ error: "Destination whitelist not found" })

    let moved   = 0
    let skipped = 0
    const now   = new Date()

    for (const rawId of body.discord_ids) {
      const discordId = BigInt(rawId)

      const sourceUser = await prisma.whitelistUser.findUnique({
        where: { guildId_discordId_whitelistId: { guildId, discordId, whitelistId: fromWl.id } },
      })
      if (!sourceUser) {
        skipped++
        continue
      }

      try {
        await prisma.$transaction(async (tx) => {
          // Upsert user in destination whitelist
          await tx.whitelistUser.upsert({
            where: { guildId_discordId_whitelistId: { guildId, discordId, whitelistId: toWl.id } },
            update: {
              discordName:       sourceUser.discordName,
              status:            sourceUser.status,
              slotLimitOverride: sourceUser.slotLimitOverride,
              updatedAt:         now,
            },
            create: {
              guildId,
              discordId,
              whitelistId:        toWl.id,
              discordName:        sourceUser.discordName,
              status:             sourceUser.status,
              slotLimitOverride:  sourceUser.slotLimitOverride,
              effectiveSlotLimit: sourceUser.effectiveSlotLimit,
              lastPlanName:       sourceUser.lastPlanName,
              createdAt:          now,
              updatedAt:          now,
              createdVia:         "admin_move",
            },
          })

          // Move identifiers
          const idents = await tx.whitelistIdentifier.findMany({
            where: { guildId, discordId, whitelistId: fromWl.id },
          })
          for (const ident of idents) {
            await tx.whitelistIdentifier.upsert({
              where: {
                guildId_discordId_whitelistId_idType_idValue: {
                  guildId, discordId, whitelistId: toWl.id,
                  idType: ident.idType, idValue: ident.idValue,
                },
              },
              update: { updatedAt: now },
              create: {
                guildId, discordId, whitelistId: toWl.id,
                idType: ident.idType, idValue: ident.idValue,
                isVerified: ident.isVerified,
                verificationSource: ident.verificationSource,
                createdAt: now, updatedAt: now,
              },
            })
          }

          // Delete from source
          await tx.whitelistIdentifier.deleteMany({ where: { guildId, discordId, whitelistId: fromWl.id } })
          await tx.whitelistUser.delete({
            where: { guildId_discordId_whitelistId: { guildId, discordId, whitelistId: fromWl.id } },
          })
        })
        moved++
      } catch {
        skipped++
      }
    }

    await triggerSync(app, guildId)

    return reply.send({ ok: true, moved, skipped })
  })
}
