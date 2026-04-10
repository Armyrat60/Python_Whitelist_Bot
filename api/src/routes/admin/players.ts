/**
 * Player profile and search routes.
 *
 * Prefix: /api/admin
 * GET /players/search?q=  — search players by name, Discord ID, Steam ID, EOS ID
 * GET /players/:discordId — full player profile
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify"
import { toJSON } from "../../lib/json.js"

const adminHook = async (req: FastifyRequest, reply: FastifyReply) => {
  if (!req.session.userId) return reply.code(401).send({ error: "Not authenticated" })
  if (!req.session.activeGuildId) return reply.code(400).send({ error: "No guild selected" })
  const guild = req.session.guilds?.find(g => g.id === req.session.activeGuildId)
  if (!guild?.isAdmin) return reply.code(403).send({ error: "Admin access required" })
}

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

    // Search by SquadJS in-game name — find Discord IDs linked via squad_players
    const bySquadName = await prisma.squadPlayer.findMany({
      where: {
        guildId,
        discordId: { not: null },
        lastSeenName: { contains: q, mode: "insensitive" },
      },
      select: { discordId: true },
      distinct: ["discordId"],
      take: 50,
    })
    const bySquadNameMapped = bySquadName
      .filter((r): r is { discordId: bigint } => r.discordId !== null)

    // Collect unique discord IDs
    const seen = new Set<bigint>()
    const discordIds: bigint[] = []
    for (const r of [...byName, ...byDiscordId, ...byIdent, ...bySquadNameMapped]) {
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
      select: { discordId: true, idType: true, idValue: true, isVerified: true },
    })

    // Group by discordId
    const playerMap = new Map<string, {
      discord_id: string
      discord_name: string
      is_verified: boolean
      memberships: unknown[]
      steam_ids: string[]
      eos_ids: string[]
    }>()

    for (const m of memberships) {
      const id = m.discordId.toString()
      if (!playerMap.has(id)) {
        playerMap.set(id, { discord_id: id, discord_name: m.discordName, is_verified: false, memberships: [], steam_ids: [], eos_ids: [] })
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
      if (ident.isVerified) p.is_verified = true
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

    const [memberships, identifiers, auditEntries, squadPlayers] = await Promise.all([
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
      prisma.squadPlayer.findMany({
        where: { guildId, discordId },
        select: { steamId: true, lastSeenName: true, serverName: true, lastSeenAt: true },
        orderBy: { lastSeenAt: "desc" },
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
      role_gained_at:       m.roleGainedAt?.toISOString() ?? null,
      role_lost_at:         m.roleLostAt?.toISOString() ?? null,
    }))

    // Deduplicate identifiers across whitelists, tracking per-ID verification
    const steamSeen = new Map<string, boolean>() // value → isVerified
    const eosSeen   = new Set<string>()
    const steam_ids: string[] = []
    const eos_ids:   string[] = []
    for (const ident of identifiers) {
      if ((ident.idType === "steamid" || ident.idType === "steam64") && !steamSeen.has(ident.idValue)) {
        steamSeen.set(ident.idValue, ident.isVerified)
        steam_ids.push(ident.idValue)
      }
      // A later record for the same steam_id can upgrade isVerified to true
      if ((ident.idType === "steamid" || ident.idType === "steam64") && ident.isVerified) {
        steamSeen.set(ident.idValue, true)
      }
      if (ident.idType === "eosid" && !eosSeen.has(ident.idValue)) {
        eosSeen.add(ident.idValue)
        eos_ids.push(ident.idValue)
      }
    }
    const verified_steam_ids = steam_ids.filter(id => steamSeen.get(id) === true)
    const is_verified = verified_steam_ids.length > 0

    const auditData = auditEntries.map(e => ({
      id:               e.id,
      action_type:      e.actionType,
      actor_discord_id: e.actorDiscordId?.toString() ?? null,
      details:          e.details,
      created_at:       e.createdAt.toISOString(),
    }))

    const squadData = squadPlayers.map(p => ({
      steam_id:      p.steamId,
      last_seen_name: p.lastSeenName ?? null,
      server_name:   p.serverName ?? null,
      last_seen_at:  p.lastSeenAt.toISOString(),
    }))

    // Fetch seeding data for this player's Steam IDs
    let seedingData: { points: number; seeding_hours: number; rewarded: boolean; current_streak: number } | null = null
    if (steam_ids.length > 0) {
      const seedingRecord = await prisma.seedingPoints.findFirst({
        where: { guildId, steamId: { in: steam_ids } },
        orderBy: { points: "desc" },
      })
      if (seedingRecord) {
        seedingData = {
          points: seedingRecord.points,
          seeding_hours: Math.round(seedingRecord.points / 60 * 10) / 10,
          rewarded: seedingRecord.rewarded,
          current_streak: seedingRecord.currentStreak,
        }
      }
    }

    // Calculate membership tenure (days since earliest role_gained_at or created_at)
    const earliestJoin = memberships.reduce((earliest, m) => {
      const d = m.roleGainedAt ?? m.createdAt
      return d < earliest ? d : earliest
    }, new Date())
    const memberDays = Math.floor((Date.now() - earliestJoin.getTime()) / 86400000)

    return reply.send(toJSON({
      discord_id:         discordId.toString(),
      discord_name:       discordName,
      is_verified,
      verified_steam_ids,
      steam_ids,
      eos_ids,
      memberships:        membershipData,
      audit_log:          auditData,
      squad_players:      squadData,
      seeding:            seedingData,
      stats: {
        member_days:        memberDays,
        active_whitelists:  memberships.filter(m => m.status === "active").length,
        total_whitelists:   memberships.length,
      },
    }))
  })

  // ── GET /api/admin/squad-players ─────────────────────────────────────────
  // List players synced from SquadJS, with optional search by in-game name
  // or Steam ID. Results include linked Discord user when known.
  //
  // Query params:
  //   q        — search by last_seen_name or steam_id (min 2 chars)
  //   page     — 1-based page number (default 1)
  //   per_page — results per page (default 50, max 200)

  app.get("/squad-players", { preHandler: adminHook }, async (req, reply) => {
    const guildId = BigInt(req.session.activeGuildId!)
    const query   = req.query as { q?: string; page?: string; per_page?: string }
    const q       = query.q?.trim() ?? ""
    const page    = Math.max(1, parseInt(query.page ?? "1", 10))
    const perPage = Math.min(200, Math.max(1, parseInt(query.per_page ?? "50", 10)))
    const skip    = (page - 1) * perPage

    const where = q.length >= 2
      ? {
          guildId,
          OR: [
            { lastSeenName: { contains: q, mode: "insensitive" as const } },
            { steamId: { contains: q } },
          ],
        }
      : { guildId }

    const [players, total] = await Promise.all([
      prisma.squadPlayer.findMany({
        where,
        orderBy: { lastSeenAt: "desc" },
        skip,
        take: perPage,
      }),
      prisma.squadPlayer.count({ where }),
    ])

    const results = players.map((p) => ({
      id:             p.id,
      steam_id:       p.steamId,
      last_seen_name: p.lastSeenName,
      server_name:    p.serverName,
      first_seen_at:  p.firstSeenAt.toISOString(),
      last_seen_at:   p.lastSeenAt.toISOString(),
      discord_id:     p.discordId?.toString() ?? null,
    }))

    return reply.send(toJSON({ players: results, total, page, per_page: perPage }))
  })

  // ── GET /api/admin/player-leaderboard ─────────────────────────────────────
  // Aggregated leaderboard: membership tenure, seeding, activity.
  // Query: sort=tenure|seeding_hours|seeding_points (default: tenure)

  app.get<{
    Querystring: { sort?: string; limit?: string }
  }>("/player-leaderboard", { preHandler: adminHook }, async (req, reply) => {
    const guildId = BigInt(req.session.activeGuildId!)
    const sortMode = req.query.sort ?? "tenure"
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit ?? "50", 10)))

    if (sortMode === "seeding_hours" || sortMode === "seeding_points") {
      // Seeding-based leaderboard
      const orderBy = sortMode === "seeding_hours" ? { points: "desc" as const } : { points: "desc" as const }
      const seeders = await prisma.seedingPoints.findMany({
        where: { guildId, points: { gt: 0 } },
        orderBy,
        take: limit,
      })

      const entries = seeders.map((s, idx) => ({
        rank: idx + 1,
        steam_id: s.steamId,
        player_name: s.playerName ?? `Seeder_${s.steamId.slice(-6)}`,
        discord_id: null as string | null,
        seeding_points: s.points,
        seeding_hours: Math.round(s.points / 60 * 10) / 10,
        rewarded: s.rewarded,
        current_streak: s.currentStreak,
        member_days: null as number | null,
      }))

      return reply.send({ entries, sort: sortMode, total: seeders.length })
    }

    // Tenure-based leaderboard (longest active members)
    const users = await prisma.whitelistUser.findMany({
      where: { guildId, status: "active" },
      orderBy: { createdAt: "asc" },
      take: limit,
      select: {
        discordId: true,
        discordName: true,
        createdAt: true,
        roleGainedAt: true,
        status: true,
        whitelist: { select: { name: true } },
      },
    })

    const now = Date.now()
    // Dedupe by discord_id (take earliest join)
    const seen = new Map<string, typeof users[number]>()
    for (const u of users) {
      const id = u.discordId.toString()
      if (!seen.has(id)) seen.set(id, u)
    }

    const entries = [...seen.values()]
      .map((u) => {
        const joinDate = u.roleGainedAt ?? u.createdAt
        return {
          rank: 0,
          discord_id: u.discordId.toString(),
          player_name: u.discordName,
          steam_id: null as string | null,
          member_days: Math.floor((now - joinDate.getTime()) / 86400000),
          whitelist_name: u.whitelist.name,
          seeding_points: null as number | null,
          seeding_hours: null as number | null,
          rewarded: null as boolean | null,
          current_streak: null as number | null,
        }
      })
      .sort((a, b) => (b.member_days ?? 0) - (a.member_days ?? 0))
      .map((e, idx) => ({ ...e, rank: idx + 1 }))

    return reply.send({ entries, sort: sortMode, total: entries.length })
  })

  // ── GET /api/admin/discord/member/:discordId — lookup Discord member name ──

  app.get<{ Params: { discordId: string } }>(
    "/discord/member/:discordId",
    { preHandler: adminHook },
    async (req, reply) => {
      const guildId = BigInt(req.session.activeGuildId!)
      const discordId = (() => { try { return BigInt(req.params.discordId) } catch { return null } })()
      if (!discordId) return reply.code(400).send({ error: "Invalid Discord ID" })

      try {
        const member = await app.discord.fetchMember(guildId, discordId)
        if (!member) return reply.code(404).send({ error: "Member not found in this server" })
        return reply.send({
          discord_id: String(member.id),
          name: member.name,
          username: member.username,
        })
      } catch {
        return reply.code(404).send({ error: "Member not found" })
      }
    }
  )
}
