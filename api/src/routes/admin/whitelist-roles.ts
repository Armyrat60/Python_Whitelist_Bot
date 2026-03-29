/**
 * Whitelist role access rules — CRUD.
 *
 * Each whitelist has a set of Discord roles that grant access with a
 * configurable slot limit. This replaces the old role_mappings +
 * tier_categories + tier_entries tables.
 *
 * GET    /api/admin/whitelists/:whitelistId/roles
 * POST   /api/admin/whitelists/:whitelistId/roles
 * PUT    /api/admin/whitelists/:whitelistId/roles/:roleId
 * DELETE /api/admin/whitelists/:whitelistId/roles/:roleId
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify"
import { syncOutputs } from "../../services/output.js"
import { cache } from "../../services/cache.js"

// ─── Helpers ─────────────────────────────────────────────────────────────────

const adminHook = async (req: FastifyRequest, reply: FastifyReply) => {
  if (!req.session.userId)      return reply.code(401).send({ error: "Not authenticated" })
  if (!req.session.activeGuildId) return reply.code(400).send({ error: "No guild selected" })
  const guild = req.session.guilds?.find(g => g.id === req.session.activeGuildId)
  if (!guild?.isAdmin)          return reply.code(403).send({ error: "Admin access required" })
}

function bigintReplacer(_: string, v: unknown): unknown {
  return typeof v === "bigint" ? v.toString() : v
}
function safeJson(data: unknown): unknown {
  return JSON.parse(JSON.stringify(data, bigintReplacer))
}

async function queuePanelsForWhitelist(
  app: FastifyInstance, guildId: bigint, whitelistId: number, reason: string
) {
  try {
    const panels = await app.prisma.panel.findMany({
      where:  { guildId, whitelistId },
      select: { id: true },
    })
    await Promise.all(panels.map(p =>
      app.prisma.panelRefreshQueue.create({
        data: { guildId, panelId: p.id, reason, action: "refresh" },
      })
    ))
  } catch (err) {
    app.log.warn({ err }, "Failed to queue panel refreshes for whitelist")
  }
}

async function triggerSync(app: FastifyInstance, guildId: bigint) {
  try {
    const outputs = await syncOutputs(app.prisma, guildId)
    cache.set(guildId, outputs)
  } catch (err) {
    app.log.error({ err, guildId }, "triggerSync failed")
  }
}

// ─── Routes ──────────────────────────────────────────────────────────────────

export default async function whitelistRoleRoutes(app: FastifyInstance) {
  const { prisma } = app

  // ── GET /api/admin/whitelists/:whitelistId/roles ─────────────────────────

  app.get<{ Params: { whitelistId: string } }>(
    "/whitelists/:whitelistId/roles",
    { preHandler: adminHook },
    async (req, reply) => {
      const guildId     = BigInt(req.session.activeGuildId!)
      const whitelistId = parseInt(req.params.whitelistId, 10)
      if (isNaN(whitelistId)) return reply.code(400).send({ error: "Invalid whitelistId" })

      const wl = await prisma.whitelist.findFirst({ where: { id: whitelistId, guildId } })
      if (!wl) return reply.code(404).send({ error: "Whitelist not found" })

      const roles = await prisma.whitelistRole.findMany({
        where:   { whitelistId, guildId },
        orderBy: [{ sortOrder: "asc" }, { slotLimit: "asc" }, { roleName: "asc" }],
      })

      // Refresh role names from Discord (fire-and-forget)
      app.discord.fetchRoles(guildId).then(liveRoles => {
        const nameMap = new Map(liveRoles.map(r => [r.id, r.name]))
        for (const role of roles) {
          const liveName = nameMap.get(String(role.roleId))
          if (liveName && liveName !== role.roleName) {
            prisma.whitelistRole.update({
              where: { id: role.id },
              data:  { roleName: liveName },
            }).catch(() => {})
          }
        }
      }).catch(() => {})

      const result = roles.map(r => ({
        id:           r.id,
        role_id:      r.roleId.toString(),
        role_name:    r.roleName,
        slot_limit:   r.slotLimit,
        is_stackable: r.isStackable,
        is_active:    r.isActive,
        display_name: r.displayName,
        sort_order:   r.sortOrder,
      }))

      return reply.send(safeJson({ roles: result }))
    }
  )

  // ── POST /api/admin/whitelists/:whitelistId/roles ─────────────────────────

  app.post<{ Params: { whitelistId: string } }>(
    "/whitelists/:whitelistId/roles",
    { preHandler: adminHook },
    async (req, reply) => {
      const guildId     = BigInt(req.session.activeGuildId!)
      const whitelistId = parseInt(req.params.whitelistId, 10)
      if (isNaN(whitelistId)) return reply.code(400).send({ error: "Invalid whitelistId" })

      const wl = await prisma.whitelist.findFirst({ where: { id: whitelistId, guildId } })
      if (!wl) return reply.code(404).send({ error: "Whitelist not found" })

      const body = req.body as {
        role_id:      string
        role_name:    string
        slot_limit:   number
        is_stackable?: boolean
        display_name?: string | null
        sort_order?:   number
      }

      if (!body.role_id)                         return reply.code(400).send({ error: "role_id is required" })
      if (!body.role_name)                       return reply.code(400).send({ error: "role_name is required" })
      if (body.slot_limit == null || isNaN(Number(body.slot_limit))) {
        return reply.code(400).send({ error: "slot_limit is required" })
      }

      const roleId = BigInt(body.role_id)
      const now    = new Date()

      const role = await prisma.whitelistRole.upsert({
        where:  { guildId_whitelistId_roleId: { guildId, whitelistId, roleId } },
        create: {
          guildId,
          whitelistId,
          roleId,
          roleName:    body.role_name,
          slotLimit:   Number(body.slot_limit),
          isStackable: body.is_stackable ?? false,
          displayName: body.display_name ?? null,
          sortOrder:   body.sort_order   ?? 0,
          createdAt:   now,
          updatedAt:   now,
        },
        update: {
          roleName:    body.role_name,
          slotLimit:   Number(body.slot_limit),
          isStackable: body.is_stackable ?? false,
          displayName: body.display_name ?? null,
          isActive:    true,
          updatedAt:   now,
        },
      })

      await queuePanelsForWhitelist(app, guildId, whitelistId, "role_added")
      triggerSync(app, guildId).catch(() => {})

      return reply.code(201).send(safeJson({ ok: true, id: role.id }))
    }
  )

  // ── PUT /api/admin/whitelists/:whitelistId/roles/:roleId ──────────────────

  app.put<{ Params: { whitelistId: string; roleId: string } }>(
    "/whitelists/:whitelistId/roles/:roleId",
    { preHandler: adminHook },
    async (req, reply) => {
      const guildId     = BigInt(req.session.activeGuildId!)
      const whitelistId = parseInt(req.params.whitelistId, 10)
      const roleId      = (() => { try { return BigInt(req.params.roleId) } catch { return null } })()

      if (isNaN(whitelistId)) return reply.code(400).send({ error: "Invalid whitelistId" })
      if (!roleId)            return reply.code(400).send({ error: "Invalid roleId" })

      const existing = await prisma.whitelistRole.findFirst({
        where: { guildId, whitelistId, roleId },
      })
      if (!existing) return reply.code(404).send({ error: "Role not found" })

      const body = req.body as {
        slot_limit?:   number
        is_stackable?: boolean
        is_active?:    boolean
        display_name?: string | null
        sort_order?:   number
      }

      const data: Record<string, unknown> = { updatedAt: new Date() }
      if (body.slot_limit   !== undefined) data["slotLimit"]   = Number(body.slot_limit)
      if (body.is_stackable !== undefined) data["isStackable"] = body.is_stackable
      if (body.is_active    !== undefined) data["isActive"]    = body.is_active
      if (body.display_name !== undefined) data["displayName"] = body.display_name
      if (body.sort_order   !== undefined) data["sortOrder"]   = body.sort_order

      await prisma.whitelistRole.update({ where: { id: existing.id }, data })

      await queuePanelsForWhitelist(app, guildId, whitelistId, "role_updated")

      return reply.send({ ok: true })
    }
  )

  // ── DELETE /api/admin/whitelists/:whitelistId/roles/:roleId ──────────────

  app.delete<{ Params: { whitelistId: string; roleId: string } }>(
    "/whitelists/:whitelistId/roles/:roleId",
    { preHandler: adminHook },
    async (req, reply) => {
      const guildId     = BigInt(req.session.activeGuildId!)
      const whitelistId = parseInt(req.params.whitelistId, 10)
      const roleId      = (() => { try { return BigInt(req.params.roleId) } catch { return null } })()

      if (isNaN(whitelistId)) return reply.code(400).send({ error: "Invalid whitelistId" })
      if (!roleId)            return reply.code(400).send({ error: "Invalid roleId" })

      const existing = await prisma.whitelistRole.findFirst({
        where: { guildId, whitelistId, roleId },
      })
      if (!existing) return reply.code(404).send({ error: "Role not found" })

      await prisma.whitelistRole.delete({ where: { id: existing.id } })
      await queuePanelsForWhitelist(app, guildId, whitelistId, "role_removed")
      triggerSync(app, guildId).catch(() => {})

      return reply.send({ ok: true })
    }
  )
}
