/**
 * Dashboard permissions routes.
 * Manages who has dashboard access beyond the auto-detected admin/owner level.
 *
 * By User (Discord ID):
 *   GET    /api/admin/dashboard-permissions            — list all user grants
 *   POST   /api/admin/dashboard-permissions            — grant access to a user
 *   PUT    /api/admin/dashboard-permissions/:discordId — change a user's level
 *   DELETE /api/admin/dashboard-permissions/:discordId — revoke a user's access
 *
 * By Role (Discord role ID):
 *   GET    /api/admin/dashboard-role-permissions            — list all role grants
 *   POST   /api/admin/dashboard-role-permissions            — grant access by role
 *   PUT    /api/admin/dashboard-role-permissions/:roleId    — change a role's level
 *   DELETE /api/admin/dashboard-role-permissions/:roleId    — revoke a role's access
 *
 * NOTE: Prefix is /dashboard-permissions (not /permissions) to avoid conflict
 * with groups.ts which owns GET /api/admin/permissions for Squad permissions.
 */
import type { FastifyPluginAsync } from "fastify"

const VALID_LEVELS = ["roster_manager", "viewer"] as const
type GrantableLevel = typeof VALID_LEVELS[number]

const permissionsRoutes: FastifyPluginAsync = async (app) => {
  // ── GET /dashboard-permissions ─────────────────────────────────────────────

  app.get("/dashboard-permissions", { preValidation: app.requireAdmin }, async (req, reply) => {
    const guildId = BigInt(req.session.activeGuildId!)

    const rows = await app.prisma.dashboardPermission.findMany({
      where: { guildId },
      orderBy: { grantedAt: "asc" },
    })

    return reply.send(rows.map((r) => ({
      id:               r.id,
      discord_id:       r.discordId,
      discord_name:     r.discordName,
      permission_level: r.permissionLevel,
      granted_by:       r.grantedBy,
      granted_at:       r.grantedAt,
    })))
  })

  // ── POST /dashboard-permissions ────────────────────────────────────────────

  app.post<{
    Body: { discord_id: string; discord_name?: string; permission_level: string }
  }>("/dashboard-permissions", { preValidation: app.requireAdmin }, async (req, reply) => {
    const guildId = BigInt(req.session.activeGuildId!)
    const { discord_id, discord_name, permission_level } = req.body

    if (!discord_id) {
      return reply.code(400).send({ error: "discord_id is required" })
    }
    if (!VALID_LEVELS.includes(permission_level as GrantableLevel)) {
      return reply.code(400).send({ error: `permission_level must be one of: ${VALID_LEVELS.join(", ")}` })
    }

    const row = await app.prisma.dashboardPermission.upsert({
      where:  { guildId_discordId: { guildId, discordId: discord_id } },
      create: {
        guildId,
        discordId:       discord_id,
        discordName:     discord_name ?? null,
        permissionLevel: permission_level,
        grantedBy:       req.session.userId ?? null,
      },
      update: {
        discordName:     discord_name ?? undefined,
        permissionLevel: permission_level,
        grantedBy:       req.session.userId ?? null,
        grantedAt:       new Date(),
      },
    })

    return reply.code(201).send({
      id:               row.id,
      discord_id:       row.discordId,
      discord_name:     row.discordName,
      permission_level: row.permissionLevel,
      granted_by:       row.grantedBy,
      granted_at:       row.grantedAt,
    })
  })

  // ── PUT /dashboard-permissions/:discordId ──────────────────────────────────

  app.put<{
    Params: { discordId: string }
    Body:   { permission_level: string }
  }>("/dashboard-permissions/:discordId", { preValidation: app.requireAdmin }, async (req, reply) => {
    const guildId   = BigInt(req.session.activeGuildId!)
    const discordId = req.params.discordId
    const { permission_level } = req.body

    if (!VALID_LEVELS.includes(permission_level as GrantableLevel)) {
      return reply.code(400).send({ error: `permission_level must be one of: ${VALID_LEVELS.join(", ")}` })
    }

    const existing = await app.prisma.dashboardPermission.findUnique({
      where: { guildId_discordId: { guildId, discordId } },
    })
    if (!existing) return reply.code(404).send({ error: "Permission grant not found" })

    const updated = await app.prisma.dashboardPermission.update({
      where: { guildId_discordId: { guildId, discordId } },
      data:  { permissionLevel: permission_level },
    })

    return reply.send({ ok: true, permission_level: updated.permissionLevel })
  })

  // ── DELETE /dashboard-permissions/:discordId ───────────────────────────────

  app.delete<{
    Params: { discordId: string }
  }>("/dashboard-permissions/:discordId", { preValidation: app.requireAdmin }, async (req, reply) => {
    const guildId   = BigInt(req.session.activeGuildId!)
    const discordId = req.params.discordId

    const existing = await app.prisma.dashboardPermission.findUnique({
      where: { guildId_discordId: { guildId, discordId } },
    })
    if (!existing) return reply.code(404).send({ error: "Permission grant not found" })

    await app.prisma.dashboardPermission.delete({
      where: { guildId_discordId: { guildId, discordId } },
    })

    return reply.send({ ok: true })
  })
  // ── GET /dashboard-role-permissions ───────────────────────────────────────

  app.get("/dashboard-role-permissions", { preValidation: app.requireAdmin }, async (req, reply) => {
    const guildId = BigInt(req.session.activeGuildId!)

    const rows = await app.prisma.dashboardRolePermission.findMany({
      where: { guildId },
      orderBy: { grantedAt: "asc" },
    })

    return reply.send(rows.map((r) => ({
      id:               r.id,
      role_id:          r.roleId,
      role_name:        r.roleName,
      permission_level: r.permissionLevel,
      granted_by:       r.grantedBy,
      granted_at:       r.grantedAt,
    })))
  })

  // ── POST /dashboard-role-permissions ──────────────────────────────────────

  app.post<{
    Body: { role_id: string; role_name?: string; permission_level: string }
  }>("/dashboard-role-permissions", { preValidation: app.requireAdmin }, async (req, reply) => {
    const guildId = BigInt(req.session.activeGuildId!)
    const { role_id, role_name, permission_level } = req.body

    if (!role_id) {
      return reply.code(400).send({ error: "role_id is required" })
    }
    if (!VALID_LEVELS.includes(permission_level as GrantableLevel)) {
      return reply.code(400).send({ error: `permission_level must be one of: ${VALID_LEVELS.join(", ")}` })
    }

    const row = await app.prisma.dashboardRolePermission.upsert({
      where:  { guildId_roleId: { guildId, roleId: role_id } },
      create: {
        guildId,
        roleId:          role_id,
        roleName:        role_name ?? null,
        permissionLevel: permission_level,
        grantedBy:       req.session.userId ?? null,
      },
      update: {
        roleName:        role_name ?? undefined,
        permissionLevel: permission_level,
        grantedBy:       req.session.userId ?? null,
        grantedAt:       new Date(),
      },
    })

    return reply.code(201).send({
      id:               row.id,
      role_id:          row.roleId,
      role_name:        row.roleName,
      permission_level: row.permissionLevel,
      granted_by:       row.grantedBy,
      granted_at:       row.grantedAt,
    })
  })

  // ── PUT /dashboard-role-permissions/:roleId ────────────────────────────────

  app.put<{
    Params: { roleId: string }
    Body:   { permission_level: string }
  }>("/dashboard-role-permissions/:roleId", { preValidation: app.requireAdmin }, async (req, reply) => {
    const guildId = BigInt(req.session.activeGuildId!)
    const { roleId } = req.params
    const { permission_level } = req.body

    if (!VALID_LEVELS.includes(permission_level as GrantableLevel)) {
      return reply.code(400).send({ error: `permission_level must be one of: ${VALID_LEVELS.join(", ")}` })
    }

    const existing = await app.prisma.dashboardRolePermission.findUnique({
      where: { guildId_roleId: { guildId, roleId } },
    })
    if (!existing) return reply.code(404).send({ error: "Role grant not found" })

    const updated = await app.prisma.dashboardRolePermission.update({
      where: { guildId_roleId: { guildId, roleId } },
      data:  { permissionLevel: permission_level },
    })

    return reply.send({ ok: true, permission_level: updated.permissionLevel })
  })

  // ── DELETE /dashboard-role-permissions/:roleId ─────────────────────────────

  app.delete<{
    Params: { roleId: string }
  }>("/dashboard-role-permissions/:roleId", { preValidation: app.requireAdmin }, async (req, reply) => {
    const guildId = BigInt(req.session.activeGuildId!)
    const { roleId } = req.params

    const existing = await app.prisma.dashboardRolePermission.findUnique({
      where: { guildId_roleId: { guildId, roleId } },
    })
    if (!existing) return reply.code(404).send({ error: "Role grant not found" })

    await app.prisma.dashboardRolePermission.delete({
      where: { guildId_roleId: { guildId, roleId } },
    })

    return reply.send({ ok: true })
  })
}

export default permissionsRoutes
