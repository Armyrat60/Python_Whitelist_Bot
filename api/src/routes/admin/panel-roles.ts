/**
 * Panel role access rules — CRUD.
 *
 * Each panel has a set of Discord roles that grant access with a
 * configurable slot limit. Roles are defined per-panel so different
 * panels can have different role requirements even when pointing to
 * the same whitelist.
 *
 * GET    /api/admin/panels/:panelId/roles
 * POST   /api/admin/panels/:panelId/roles
 * PUT    /api/admin/panels/:panelId/roles/:roleId
 * DELETE /api/admin/panels/:panelId/roles/:roleId
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify"
import { syncOutputs } from "../../services/output.js"
import { cache } from "../../services/cache.js"
import { toJSON } from "../../lib/json.js"

// ─── Helpers ─────────────────────────────────────────────────────────────────

const adminHook = async (req: FastifyRequest, reply: FastifyReply) => {
  if (!req.session.userId)      return reply.code(401).send({ error: "Not authenticated" })
  if (!req.session.activeGuildId) return reply.code(400).send({ error: "No guild selected" })
  const guild = req.session.guilds?.find(g => g.id === req.session.activeGuildId)
  if (!guild?.isAdmin)          return reply.code(403).send({ error: "Admin access required" })
}

async function queuePanelRefresh(
  app: FastifyInstance, guildId: bigint, panelId: number, reason: string
) {
  try {
    await app.prisma.panelRefreshQueue.create({
      data: { guildId, panelId, reason, action: "refresh" },
    })
  } catch (err) {
    app.log.warn({ err }, "Failed to queue panel refresh")
  }
}

async function triggerSync(app: FastifyInstance, guildId: bigint) {
  try {
    const outputs = await syncOutputs(app.prisma, guildId)
    await cache.set(guildId, outputs)
  } catch (err) {
    app.log.error({ err, guildId }, "triggerSync failed")
  }
}

async function pullMembersForRole(
  app: FastifyInstance,
  guildId: bigint,
  roleId: bigint,
  panelWhitelistId: number,
) {
  try {
    const wl = await app.prisma.whitelist.findUnique({ where: { id: panelWhitelistId } })
    if (!wl) return

    const members = await app.discord.fetchMembersWithRole(guildId, roleId)
    const now = new Date()
    let added = 0

    for (const member of members) {
      const existing = await app.prisma.whitelistUser.findUnique({
        where: { guildId_discordId_whitelistId: { guildId, discordId: member.id, whitelistId: wl.id } },
      })
      if (existing) continue

      const panelRole = await app.prisma.panelRole.findFirst({
        where: { guildId, roleId, isActive: true },
      })

      await app.prisma.whitelistUser.create({
        data: {
          guildId,
          discordId: member.id,
          whitelistId: wl.id,
          discordName: member.name,
          status: "active",
          effectiveSlotLimit: panelRole?.slotLimit ?? wl.defaultSlotLimit,
          lastPlanName: panelRole ? `${panelRole.roleName}:${panelRole.slotLimit}` : null,
          createdVia: "role_sync",
          createdAt: now,
          updatedAt: now,
        },
      })
      added++
    }

    if (added > 0) await triggerSync(app, guildId)
    app.log.info({ guildId: guildId.toString(), roleId: roleId.toString(), added }, "Auto-pull on panel role save")
  } catch (err) {
    app.log.error({ err, guildId: guildId.toString(), roleId: roleId.toString() }, "Auto-pull after panel role save failed")
  }
}

// ─── Routes ──────────────────────────────────────────────────────────────────

export default async function panelRoleRoutes(app: FastifyInstance) {
  const { prisma } = app

  // ── GET /api/admin/panels/:panelId/roles ─────────────────────────────────

  app.get<{ Params: { panelId: string } }>(
    "/panels/:panelId/roles",
    { preHandler: adminHook },
    async (req, reply) => {
      const guildId = BigInt(req.session.activeGuildId!)
      const panelId = parseInt(req.params.panelId, 10)
      if (isNaN(panelId)) return reply.code(400).send({ error: "Invalid panelId" })

      const panel = await prisma.panel.findFirst({ where: { id: panelId, guildId } })
      if (!panel) return reply.code(404).send({ error: "Panel not found" })

      const roles = await prisma.panelRole.findMany({
        where:   { panelId, guildId },
        orderBy: [{ sortOrder: "asc" }, { slotLimit: "desc" }, { roleName: "asc" }],
      })

      // Refresh role names from Discord (fire-and-forget)
      app.discord.fetchRoles(guildId).then(liveRoles => {
        const nameMap = new Map(liveRoles.map(r => [r.id, r.name]))
        for (const role of roles) {
          const liveName = nameMap.get(String(role.roleId))
          if (liveName && liveName !== role.roleName) {
            prisma.panelRole.update({
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

      return reply.send(toJSON({ roles: result }))
    }
  )

  // ── POST /api/admin/panels/:panelId/roles ────────────────────────────────

  app.post<{ Params: { panelId: string } }>(
    "/panels/:panelId/roles",
    { preHandler: adminHook },
    async (req, reply) => {
      const guildId = BigInt(req.session.activeGuildId!)
      const panelId = parseInt(req.params.panelId, 10)
      if (isNaN(panelId)) return reply.code(400).send({ error: "Invalid panelId" })

      const panel = await prisma.panel.findFirst({ where: { id: panelId, guildId }, select: { id: true, whitelistId: true } })
      if (!panel) return reply.code(404).send({ error: "Panel not found" })

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

      const role = await prisma.panelRole.upsert({
        where:  { guildId_panelId_roleId: { guildId, panelId, roleId } },
        create: {
          guildId,
          panelId,
          roleId,
          roleName:    body.role_name,
          slotLimit:   Number(body.slot_limit),
          isStackable: body.is_stackable ?? true,
          displayName: body.display_name ?? null,
          sortOrder:   body.sort_order   ?? 0,
          createdAt:   now,
          updatedAt:   now,
        },
        update: {
          roleName:    body.role_name,
          slotLimit:   Number(body.slot_limit),
          isStackable: body.is_stackable ?? true,
          displayName: body.display_name ?? null,
          isActive:    true,
          updatedAt:   now,
        },
      })

      await queuePanelRefresh(app, guildId, panelId, "role_added")
      triggerSync(app, guildId).catch(() => {})

      if (panel.whitelistId) {
        pullMembersForRole(app, guildId, roleId, panel.whitelistId).catch(() => {})
      }

      return reply.code(201).send(toJSON({ ok: true, id: role.id }))
    }
  )

  // ── PUT /api/admin/panels/:panelId/roles/:roleId ─────────────────────────

  app.put<{ Params: { panelId: string; roleId: string } }>(
    "/panels/:panelId/roles/:roleId",
    { preHandler: adminHook },
    async (req, reply) => {
      const guildId = BigInt(req.session.activeGuildId!)
      const panelId = parseInt(req.params.panelId, 10)
      const roleId  = (() => { try { return BigInt(req.params.roleId) } catch { return null } })()

      if (isNaN(panelId)) return reply.code(400).send({ error: "Invalid panelId" })
      if (!roleId)        return reply.code(400).send({ error: "Invalid roleId" })

      const existing = await prisma.panelRole.findFirst({
        where: { guildId, panelId, roleId },
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

      await prisma.panelRole.update({ where: { id: existing.id }, data })

      await queuePanelRefresh(app, guildId, panelId, "role_updated")

      return reply.send({ ok: true })
    }
  )

  // ── DELETE /api/admin/panels/:panelId/roles/:roleId ──────────────────────

  app.delete<{ Params: { panelId: string; roleId: string } }>(
    "/panels/:panelId/roles/:roleId",
    { preHandler: adminHook },
    async (req, reply) => {
      const guildId = BigInt(req.session.activeGuildId!)
      const panelId = parseInt(req.params.panelId, 10)
      const roleId  = (() => { try { return BigInt(req.params.roleId) } catch { return null } })()

      if (isNaN(panelId)) return reply.code(400).send({ error: "Invalid panelId" })
      if (!roleId)        return reply.code(400).send({ error: "Invalid roleId" })

      const existing = await prisma.panelRole.findFirst({
        where: { guildId, panelId, roleId },
      })
      if (!existing) return reply.code(404).send({ error: "Role not found" })

      await prisma.panelRole.delete({ where: { id: existing.id } })
      await queuePanelRefresh(app, guildId, panelId, "role_removed")
      triggerSync(app, guildId).catch(() => {})

      return reply.send({ ok: true })
    }
  )
}
