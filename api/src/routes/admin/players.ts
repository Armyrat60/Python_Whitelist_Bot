/**
 * Player profile and search routes.
 *
 * Prefix: /api/admin
 * GET /players/search?q=  — search players by name, Discord ID, Steam ID, EOS ID
 * GET /players/:discordId — full player profile
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify"

const adminHook = async (req: FastifyRequest, reply: FastifyReply) => {
  if (!req.session.userId) return reply.code(401).send({ error: "Not authenticated" })
  if (!req.session.activeGuildId) return reply.code(400).send({ error: "No guild selected" })
  const guild = req.session.guilds?.find(g => g.id === req.session.activeGuildId)
  if (!guild?.isAdmin) return reply.code(403).send({ error: "Admin access required" })
}

function bigIntReplacer(_: string, v: unknown) { return typeof v === "bigint" ? v.toString() : v }
function toJSON(data: unknown) { return JSON.parse(JSON.stringify(data, bigIntReplacer)) }

export default async function playerRoutes(app: FastifyInstance) {
  const { prisma } = app

  // ── GET /api/admin/players/search?q= ─────────────────────────────────────

  app.get("/players/search", { preHandler: adminHook }, async (req, reply) => {
    const guildId = BigInt(req.session.activeGuildId!)
    const query   = req.query as { q?: string }
    const q       = query.q?.trim() ?? ""

    if (q.length < 2) {
      return reply.send({ players: [] })
    }

    // Search by discord name
    const byName = await prisma.whitelistUser.findMany({
      where: { guildId, discordName: { contains: q, mode: "insensitive" } },
      select: { discordId: true },
      distinct: ["discordId"],
      take: 50,
    })

    // Search by exact discord ID (if numeric)
    let byDiscordId: { discordId: bigint }[] = []
    if (/^\d{15,20}$/.test(q)) {
      try {
        byDiscordId = await prisma.whitelistUser.findMany({
          where: { guildId, discordId: BigInt(q) },
          select: { discordId: true },
          distinct: ["discordId"],
        })
      } catch { /* ignore invalid bigint */ }
    }

    // Search by Steam ID or EOS ID via identifiers
    const byIdent = await prisma.whitelistIdentifier.findMany({
      where: { guildId, idValue: { contains: q, mode: "insensitive" } },
      select: { discordId: true },
      distinct: ["discordId"],
      take: 50,
    })

    // Collect unique discord IDs
    const seen = new Set<bigint>()
    const discordIds: bigint[] = []
    for (const r of [...byName, ...byDiscordId, ...byIdent]) {
      if (!seen.has(r.discordId)) {
        seen.add(r.discordId)
        discordIds.push(r.discordId)
      }
    }

    if (discordIds.length === 0) return reply.send({ players: [] })

    // Fetch all whitelist memberships for matched players
    const memberships = await prisma.whitelistUser.findMany({
      where: { guildId, discordId: { in: discordIds } },
      include: {
        whitelist: { select: { slug: true, name: true, isManual: true } },
        category:  { select: { name: true } },
      },
    })

    // Fetch all identifiers
    const identifiers = await prisma.whitelistIdentifier.findMany({
      where: { guildId, discordId: { in: discordIds } },
      select: { discordId: true, idType: true, idValue: true },
    })

    // Group by discordId
    const playerMap = new Map<string, {
      discord_id: string
      discord_name: string
      memberships: unknown[]
      steam_ids: string[]
      eos_ids: string[]
    }>()

    for (const m of memberships) {
      const id = m.discordId.toString()
      if (!playerMap.has(id)) {
        playerMap.set(id, { discord_id: id, discord_name: m.discordName, memberships: [], steam_ids: [], eos_ids: [] })
      }
      playerMap.get(id)!.memberships.push({
        whitelist_slug: m.whitelist.slug,
        whitelist_name: m.whitelist.name,
        is_manual:      m.whitelist.isManual,
        status:         m.status,
        expires_at:     m.expiresAt?.toISOString() ?? null,
        category_name:  m.category?.name ?? null,
      })
    }

    for (const ident of identifiers) {
      const id = ident.discordId.toString()
      const p  = playerMap.get(id)
      if (!p) continue
      if (ident.idType === "steamid" || ident.idType === "steam64") p.steam_ids.push(ident.idValue)
      if (ident.idType === "eosid") p.eos_ids.push(ident.idValue)
    }

    return reply.send(toJSON({ players: [...playerMap.values()] }))
  })

  // ── GET /api/admin/players/:discordId ─────────────────────────────────────

  app.get("/players/:discordId", { preHandler: adminHook }, async (req, reply) => {
    const guildId   = BigInt(req.session.activeGuildId!)
    const { discordId: rawId } = req.params as { discordId: string }

    let discordId: bigint
    try {
      discordId = BigInt(rawId)
    } catch {
      return reply.code(400).send({ error: "Invalid discord ID" })
    }

    const [memberships, identifiers, auditEntries] = await Promise.all([
      prisma.whitelistUser.findMany({
        where: { guildId, discordId },
        include: {
          whitelist: { select: { slug: true, name: true, isManual: true } },
          category:  { select: { id: true, name: true } },
        },
        orderBy: { createdAt: "asc" },
      }),
      prisma.whitelistIdentifier.findMany({
        where: { guildId, discordId },
        select: { whitelistId: true, idType: true, idValue: true, isVerified: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      }),
      prisma.auditLog.findMany({
        where: { guildId, targetDiscordId: discordId },
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
    ])

    if (memberships.length === 0 && identifiers.length === 0) {
      return reply.code(404).send({ error: "Player not found in this guild" })
    }

    const discordName = memberships[0]?.discordName ?? "Unknown"

    const membershipData = memberships.map(m => ({
      whitelist_slug:       m.whitelist.slug,
      whitelist_name:       m.whitelist.name,
      is_manual:            m.whitelist.isManual,
      status:               m.status,
      expires_at:           m.expiresAt?.toISOString() ?? null,
      created_at:           m.createdAt.toISOString(),
      notes:                m.notes ?? null,
      category_id:          m.categoryId ?? null,
      category_name:        m.category?.name ?? null,
      effective_slot_limit: m.effectiveSlotLimit,
      slot_limit_override:  m.slotLimitOverride ?? null,
      created_via:          m.createdVia ?? null,
    }))

    // Deduplicate identifiers across whitelists
    const steamSeen = new Set<string>()
    const eosSeen   = new Set<string>()
    const steam_ids: string[] = []
    const eos_ids:   string[] = []
    for (const ident of identifiers) {
      if ((ident.idType === "steamid" || ident.idType === "steam64") && !steamSeen.has(ident.idValue)) {
        steamSeen.add(ident.idValue)
        steam_ids.push(ident.idValue)
      }
      if (ident.idType === "eosid" && !eosSeen.has(ident.idValue)) {
        eosSeen.add(ident.idValue)
        eos_ids.push(ident.idValue)
      }
    }

    const auditData = auditEntries.map(e => ({
      id:               e.id,
      action_type:      e.actionType,
      actor_discord_id: e.actorDiscordId?.toString() ?? null,
      details:          e.details,
      created_at:       e.createdAt.toISOString(),
    }))

    return reply.send(toJSON({
      discord_id:   discordId.toString(),
      discord_name: discordName,
      steam_ids,
      eos_ids,
      memberships:  membershipData,
      audit_log:    auditData,
    }))
  })
}
