/**
 * Admin user management routes.
 *
 * Prefix: /api/admin
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify"
import { Prisma } from "@prisma/client"
import { syncOutputs } from "../../services/output.js"
import { cache } from "../../services/cache.js"
import { getFileToken } from "../../services/token.js"
import { warmSteamCache } from "../../lib/steamNames.js"
import { toJSON } from "../../lib/json.js"

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
      unlinked?:    string   // "true" → orphan entries (discordId < 0)
      verified?:    string   // "true" → users with at least one verified identifier
      role_name?:   string   // filter by panel role display name (matches lastPlanName)
      sort?:        string   // "name" | "slots" | "status" | "updated" | "whitelist"
      order?:       string   // "asc" | "desc"
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
    if (query.unlinked === "true") where.discordId = { lt: 0n }
    if (query.verified === "true") where.identifiers = { some: { isVerified: true } }
    if (query.role_name) where.lastPlanName = { contains: `${query.role_name}:`, mode: "insensitive" }
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

    const sortField = query.sort ?? "name"
    const sortDir: Prisma.SortOrder = query.order === "desc" ? "desc" : "asc"
    const orderBy: Prisma.WhitelistUserOrderByWithRelationInput =
      sortField === "slots"     ? { effectiveSlotLimit: sortDir } :
      sortField === "status"    ? { status: sortDir } :
      sortField === "updated"   ? { updatedAt: sortDir } :
      sortField === "whitelist" ? { whitelist: { name: sortDir } } :
                                  { discordName: sortDir }

    const [total, users] = await Promise.all([
      prisma.whitelistUser.count({ where }),
      prisma.whitelistUser.findMany({
        where,
        include: {
          whitelist: { select: { slug: true, name: true } },
          category:  { select: { id: true, name: true } },
        },
        orderBy,
        take:    perPage,
        skip:    (page - 1) * perPage,
      }),
    ])

    // Fetch identifiers for all returned users in one query
    const discordIds = users.map(u => u.discordId)
    const identifiers = discordIds.length > 0
      ? await prisma.whitelistIdentifier.findMany({
          where: { guildId, discordId: { in: discordIds } },
          select: { discordId: true, whitelistId: true, idType: true, idValue: true, isVerified: true },
        })
      : []

    // Group identifiers by discordId + whitelistId; track per-user verification
    const identMap = new Map<string, { steam_ids: string[]; eos_ids: string[]; is_verified: boolean }>()
    const verifiedByDiscord = new Set<string>()
    for (const ident of identifiers) {
      const key = `${ident.discordId}:${ident.whitelistId}`
      if (!identMap.has(key)) identMap.set(key, { steam_ids: [], eos_ids: [], is_verified: false })
      const entry = identMap.get(key)!
      if (ident.idType === "steamid" || ident.idType === "steam64") entry.steam_ids.push(ident.idValue)
      if (ident.idType === "eosid")   entry.eos_ids.push(ident.idValue)
      if (ident.isVerified) {
        entry.is_verified = true
        verifiedByDiscord.add(ident.discordId.toString())
      }
    }

    const result = users.map(u => {
      const idents = identMap.get(`${u.discordId}:${u.whitelistId}`) ?? { steam_ids: [], eos_ids: [], is_verified: false }
      return {
        discord_id:           u.discordId.toString(),
        discord_name:         u.discordName,
        discord_username:     u.discordUsername ?? null,
        discord_nick:         u.discordNick ?? null,
        clan_tag:             u.clanTag ?? null,
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
        is_verified:          idents.is_verified,
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

  // ── GET /api/admin/users/export ─────────────────────────────────────────────

  app.get("/users/export", { preHandler: adminHook }, async (req, reply) => {
    const guildId = BigInt(req.session.activeGuildId!)
    const query   = req.query as {
      search?:      string
      whitelist?:   string
      status?:      string
      category_id?: string
      unlinked?:    string
      verified?:    string
    }

    const status = query.status ?? "all"
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
    if (query.search?.trim()) where.discordName = { contains: query.search.trim(), mode: "insensitive" }
    if (query.unlinked === "true") where.discordId = { lt: 0n }
    if (query.verified === "true") where.identifiers = { some: { isVerified: true } }
    if (query.category_id) {
      const catId = parseInt(query.category_id, 10)
      if (!isNaN(catId)) where.categoryId = catId
    }

    const users = await prisma.whitelistUser.findMany({
      where,
      include: { whitelist: { select: { slug: true, name: true } } },
      orderBy: { discordName: "asc" },
      take:    5000,
    })
    const discordIds = users.map(u => u.discordId)
    const identifiers = discordIds.length > 0
      ? await prisma.whitelistIdentifier.findMany({
          where:  { guildId, discordId: { in: discordIds } },
          select: { discordId: true, whitelistId: true, idType: true, idValue: true, isVerified: true },
        })
      : []

    const identMap = new Map<string, { steam_ids: string[]; eos_ids: string[]; is_verified: boolean }>()
    for (const id of identifiers) {
      const key = `${id.discordId}:${id.whitelistId}`
      if (!identMap.has(key)) identMap.set(key, { steam_ids: [], eos_ids: [], is_verified: false })
      const entry = identMap.get(key)!
      if (id.idType === "steamid" || id.idType === "steam64") entry.steam_ids.push(id.idValue)
      if (id.idType === "eosid") entry.eos_ids.push(id.idValue)
      if (id.isVerified) entry.is_verified = true
    }

    const header = "discord_id,discord_name,whitelist,status,tier,expires_at,steam_ids,eos_ids,slot_limit,is_verified,notes"
    const rows = users.map(u => {
      const idents = identMap.get(`${u.discordId}:${u.whitelistId}`) ?? { steam_ids: [], eos_ids: [], is_verified: false }
      const escape = (s: string | null | undefined) => `"${(s ?? "").replace(/"/g, '""')}"`
      return [
        u.discordId.toString(),
        escape(u.discordName),
        u.whitelist?.slug ?? "",
        u.status,
        escape(u.lastPlanName),
        u.expiresAt?.toISOString().slice(0, 10) ?? "",
        idents.steam_ids.join(";"),
        idents.eos_ids.join(";"),
        u.effectiveSlotLimit,
        idents.is_verified ? "true" : "false",
        escape(u.notes),
      ].join(",")
    })

    const csv = [header, ...rows].join("\n")
    reply.header("Content-Type", "text/csv")
    reply.header("Content-Disposition", 'attachment; filename="roster-export.csv"')
    return reply.send(csv)
  })

  // ── POST /api/admin/users ────────────────────────────────────────────────────

  app.post("/users", { preHandler: adminHook }, async (req, reply) => {
    const guildId = BigInt(req.session.activeGuildId!)
    const body    = req.body as {
      discord_id?:          string
      discord_name:         string
      whitelist_slug:       string
      steam_ids?:           string[]
      eos_ids?:             string[]
      slot_limit_override?: number | null
      expires_at?:          string | null
      notes?:               string | null
      category_id?:         number | null
    }

    if (!body.discord_name || !body.whitelist_slug) {
      return reply.code(400).send({ error: "discord_name and whitelist_slug are required" })
    }

    const wl = await prisma.whitelist.findUnique({
      where: { guildId_slug: { guildId, slug: body.whitelist_slug } },
    })
    if (!wl) return reply.code(404).send({ error: "Whitelist not found" })

    // If no discord_id provided, generate a synthetic one from the first Steam ID
    let discordId: bigint
    const createdVia = body.discord_id ? "admin" : "manual_steam_only"
    if (body.discord_id) {
      discordId = BigInt(body.discord_id)
    } else {
      const firstSteam = (body.steam_ids ?? [])[0]?.trim()
      const firstEos   = (body.eos_ids   ?? [])[0]?.trim()
      const seed       = firstSteam || firstEos
      if (!seed) {
        return reply.code(400).send({ error: "discord_id or at least one steam/eos ID is required" })
      }
      discordId = BigInt("1" + seed.slice(-16).padStart(16, "0"))
    }
    const now = new Date()

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
          createdVia,
        },
      })

      const steamIds = body.steam_ids ?? []
      const eosIds   = body.eos_ids   ?? []

      for (const idValue of steamIds) {
        await tx.whitelistIdentifier.upsert({
          where: {
            guildId_discordId_whitelistId_idType_idValue: {
              guildId, discordId, whitelistId: wl.id, idType: "steam64", idValue,
            },
          },
          update: { updatedAt: now },
          create: {
            guildId, discordId, whitelistId: wl.id,
            idType: "steam64", idValue,
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
    warmSteamCache(body.steam_ids ?? [], app.prisma)

    return reply.code(201).send(toJSON({
      ok:           true,
      discord_id:   discordId.toString(),
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
      steam_ids?:           string[]
      eos_ids?:             string[]
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

    const now = new Date()
    const data: Record<string, unknown> = { updatedAt: now }
    if (body.status              !== undefined) data.status            = body.status
    if (body.slot_limit_override !== undefined) data.slotLimitOverride = body.slot_limit_override
    if (body.expires_at          !== undefined) data.expiresAt         = body.expires_at ? new Date(body.expires_at) : null
    if (body.notes               !== undefined) data.notes             = body.notes ?? null
    if (body.category_id         !== undefined) data.categoryId        = body.category_id ?? null

    const steamIds = body.steam_ids
    const eosIds   = body.eos_ids
    const hasIdUpdate = steamIds !== undefined || eosIds !== undefined

    await prisma.$transaction(async (tx) => {
      await tx.whitelistUser.update({
        where: { guildId_discordId_whitelistId: { guildId, discordId, whitelistId: wl.id } },
        data,
      })

      if (hasIdUpdate) {
        // Remove old identifiers for the types being replaced
        if (steamIds !== undefined) {
          await tx.whitelistIdentifier.deleteMany({
            where: { guildId, discordId, whitelistId: wl.id, idType: { in: ["steam64", "steamid"] } },
          })
        }
        if (eosIds !== undefined) {
          await tx.whitelistIdentifier.deleteMany({
            where: { guildId, discordId, whitelistId: wl.id, idType: "eosid" },
          })
        }

        // Insert new identifiers
        for (const idValue of steamIds ?? []) {
          if (!idValue.trim()) continue
          await tx.whitelistIdentifier.create({
            data: {
              guildId, discordId, whitelistId: wl.id,
              idType: "steam64", idValue: idValue.trim(),
              isVerified: false, createdAt: now, updatedAt: now,
            },
          })
        }
        for (const idValue of eosIds ?? []) {
          if (!idValue.trim()) continue
          await tx.whitelistIdentifier.create({
            data: {
              guildId, discordId, whitelistId: wl.id,
              idType: "eosid", idValue: idValue.trim(),
              isVerified: false, createdAt: now, updatedAt: now,
            },
          })
        }
      }
    })

    const changes = Object.keys(data)
    if (steamIds !== undefined) changes.push("steam_ids")
    if (eosIds   !== undefined) changes.push("eos_ids")

    await prisma.auditLog.create({
      data: {
        guildId,
        whitelistId:     wl.id,
        actionType:      "user_updated",
        actorDiscordId:  req.session.userId ? BigInt(req.session.userId) : null,
        targetDiscordId: discordId,
        details:         JSON.stringify({ changes }),
        createdAt:       now,
      },
    })

    await triggerSync(app, guildId)
    if (steamIds?.length) warmSteamCache(steamIds, app.prisma)

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

  // ── GET /api/admin/role-loss ─────────────────────────────────────────────────
  // Returns users who lost their Discord role in the last N days.

  app.get("/role-loss", { preHandler: adminHook }, async (req, reply) => {
    const guildId = BigInt(req.session.activeGuildId!)
    const query = req.query as { days?: string; whitelist_slug?: string }
    const days = Math.min(Math.max(parseInt(query.days ?? "90", 10), 1), 365)
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

    const where: Record<string, unknown> = {
      guildId,
      status: "disabled_role_lost",
      updatedAt: { gte: since },
    }

    if (query.whitelist_slug) {
      const wl = await prisma.whitelist.findUnique({
        where: { guildId_slug: { guildId, slug: query.whitelist_slug } },
      })
      if (wl) where.whitelistId = wl.id
    }

    const users = await prisma.whitelistUser.findMany({
      where,
      include: {
        whitelist: { select: { name: true, slug: true, isManual: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: 500,
    })

    const filtered = users.filter(u => !(u as unknown as { whitelist: { isManual: boolean } }).whitelist.isManual)

    return reply.send(toJSON({
      users: filtered.map(u => ({
        discord_id: u.discordId.toString(),
        discord_name: u.discordName,
        whitelist_slug: (u as unknown as { whitelist: { slug: string } }).whitelist.slug,
        whitelist_name: (u as unknown as { whitelist: { name: string } }).whitelist.name,
        lost_at: u.updatedAt.toISOString(),
        added_at: u.createdAt.toISOString(),
        last_plan_name: u.lastPlanName,
        effective_slot_limit: u.effectiveSlotLimit,
      })),
    }))
  })
}
