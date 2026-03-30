import type { FastifyInstance } from "fastify"

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normalizeDiscordName(name: string): string {
  // Lowercase, strip discriminator (#1234), remove non-ASCII and punctuation
  let n = name.toLowerCase().trim().replace(/#\d{1,4}$/, "")
  // Strip non-ASCII (emoji, clan symbols, ™, ®, etc.)
  n = n.replace(/[^\x00-\x7F]/g, "")
  return n.replace(/[_.\-#!@$%^&*()+={}\[\]|;:,<>?/\\~` ]/g, "")
}

function bigrams(s: string): Set<string> {
  const bg = new Set<string>()
  for (let i = 0; i < s.length - 1; i++) bg.add(s.slice(i, i + 2))
  return bg
}

function bigramSim(a: string, b: string): number {
  if (!a || !b) return 0
  const ba = bigrams(a)
  const bb = bigrams(b)
  let intersect = 0
  for (const g of ba) if (bb.has(g)) intersect++
  return (2 * intersect) / (ba.size + bb.size)
}

/**
 * Return 0.0–1.0 confidence that orphanName matches memberName.
 *
 * Tiers:
 *   1.00  exact case-insensitive match
 *   0.95  exact after stripping discriminator / punctuation
 *   0.88  shorter (5+ chars) is a suffix of longer (clan-tag prefix pattern)
 *   0.80–0.87  shorter is a prefix/suffix of longer (scaled by length ratio)
 *   0.50–0.79  containment or bigram similarity on normalised names
 *   0.00  below threshold
 */
function reconcileScore(orphanName: string, memberName: string): number {
  if (!orphanName || !memberName) return 0.0
  const o = orphanName.toLowerCase().trim()
  const m = memberName.toLowerCase().trim()
  if (o === m) return 1.0
  const oN = normalizeDiscordName(o)
  const mN = normalizeDiscordName(m)
  if (!oN || !mN) return 0.0
  if (oN === mN) return 0.95
  // Prefix / suffix containment — clan tags always prepended, gamertag is a suffix
  const [shorter, longer] = oN.length <= mN.length ? [oN, mN] : [mN, oN]
  if (longer.endsWith(shorter) && shorter.length >= 5) return 0.88
  if (longer.startsWith(shorter) || longer.endsWith(shorter)) {
    return Math.round((0.80 * shorter.length / longer.length + 0.15) * 100) / 100
  }
  if (shorter.length >= 4 && longer.includes(shorter)) {
    return Math.round(0.75 * shorter.length / longer.length * 100) / 100
  }
  // Bigram similarity (mirrors SequenceMatcher ratio)
  const ratio = bigramSim(oN, mN)
  if (ratio >= 0.6) {
    return Math.round((0.50 + ratio * 0.29) * 100) / 100
  }
  return 0.0
}

/** Parse "Name,DiscordID" or "Name - DiscordID" lines into a name→id map. */
function parseDiscordMemberList(csv: string): Array<{ discord_name: string; discord_id: string }> {
  const results: Array<{ discord_name: string; discord_id: string }> = []
  for (const rawLine of csv.split("\n")) {
    const line = rawLine.trim()
    if (!line) continue
    // Try comma separator (last comma)
    let name = ""
    let idStr = ""
    const commaIdx = line.lastIndexOf(",")
    if (commaIdx > 0) {
      name = line.slice(0, commaIdx).trim()
      idStr = line.slice(commaIdx + 1).trim()
    } else {
      // Try " - " or " – " dash separator
      const dashMatch = line.match(/^(.+?)\s+[-–]\s+(\d{15,20})\s*$/)
      if (dashMatch) {
        name = dashMatch[1].trim()
        idStr = dashMatch[2].trim()
      }
    }
    if (!name || !idStr) continue
    // Strip discriminator from name
    name = name.replace(/#\d{1,4}$/, "").trim()
    const skipHeaders = ["user", "username", "name", "member"]
    if (skipHeaders.includes(name.toLowerCase())) continue
    if (!/^\d{15,20}$/.test(idStr)) continue
    results.push({ discord_name: name, discord_id: idStr })
  }
  return results
}

// ─── Routes ──────────────────────────────────────────────────────────────────

export default async function reconcileRoutes(app: FastifyInstance) {
  const adminHook = [app.requireAdmin]

  // POST /reconcile/preview
  // Preview matches between orphan records (discordId < 0) and a Discord member CSV.
  app.post("/reconcile/preview", { preHandler: adminHook }, async (req, reply) => {
    const guildId = BigInt(req.session.activeGuildId!)

    // Parse member CSV from body
    let memberCsv = ""
    const body = req.body as Record<string, unknown> | null
    if (body && typeof body === "object") {
      memberCsv = String(body.content ?? body.members ?? "")
    }

    if (!memberCsv.trim()) {
      return reply.code(400).send({ error: "No member CSV content provided" })
    }

    const parsed = parseDiscordMemberList(memberCsv)

    // Fallback: simple comma split
    if (parsed.length === 0) {
      for (const rawLine of memberCsv.split("\n")) {
        const line = rawLine.trim()
        if (!line) continue
        const idx = line.lastIndexOf(",")
        if (idx < 0) continue
        const name = line.slice(0, idx).replace(/#\d{1,4}$/, "").trim()
        const idStr = line.slice(idx + 1).trim()
        const skipHeaders = ["user", "username", "name", "member"]
        if (!name || skipHeaders.includes(name.toLowerCase())) continue
        if (!/^\d{15,20}$/.test(idStr)) continue
        parsed.push({ discord_name: name, discord_id: idStr })
      }
    }

    if (parsed.length === 0) {
      return reply.code(400).send({
        error: "No valid members found. Expected 'Username,DiscordID' or 'Username - DiscordID' format.",
      })
    }

    // Build name→id map (last wins)
    const members = new Map<string, bigint>() // name → discord_id
    for (const m of parsed) {
      try { members.set(m.discord_name, BigInt(m.discord_id)) } catch { continue }
    }

    // Fetch orphan records (discordId < 0)
    const orphanRows = await app.prisma.whitelistUser.findMany({
      where: { guildId, discordId: { lt: 0n } },
      include: { whitelist: { select: { slug: true, name: true } } },
      orderBy: { discordName: "asc" },
    })

    if (orphanRows.length === 0) {
      return reply.send({ ok: true, members_loaded: members.size, orphans_found: 0, results: [] })
    }

    // Fetch identifiers for all orphan IDs
    const orphanIds = [...new Set(orphanRows.map(r => r.discordId))]
    const idRows = await app.prisma.whitelistIdentifier.findMany({
      where: { guildId, discordId: { in: orphanIds } },
      select: { discordId: true, idType: true, idValue: true },
    })
    const idMap = new Map<bigint, string[]>()
    for (const row of idRows) {
      const key = row.discordId
      const arr = idMap.get(key) ?? []
      arr.push(`${row.idType}:${row.idValue}`)
      idMap.set(key, arr)
    }

    // Score each orphan against the member list
    const results = orphanRows.map(row => {
      const orphanName = row.discordName ?? ""
      let bestMatch: { discord_name: string; discord_id: string } | null = null
      let bestScore = 0.0
      for (const [memberName, memberDid] of members) {
        const score = reconcileScore(orphanName, memberName)
        if (score > bestScore) {
          bestScore = score
          bestMatch = { discord_name: memberName, discord_id: memberDid.toString() }
        }
      }
      return {
        orphan_discord_id: row.discordId.toString(),
        orphan_name: orphanName,
        whitelist_slug: row.whitelist.slug,
        whitelist_name: row.whitelist.name,
        identifiers: idMap.get(row.discordId) ?? [],
        match: bestMatch,
        confidence: Math.round(bestScore * 100) / 100,
      }
    })

    results.sort((a, b) => b.confidence - a.confidence)

    return reply.send({ ok: true, members_loaded: members.size, orphans_found: results.length, results })
  })

  // POST /reconcile/apply
  // Re-parent orphan records to real Discord IDs.
  // Body: { matches: [{orphan_discord_id, real_discord_id, real_discord_name}] }
  app.post("/reconcile/apply", { preHandler: adminHook }, async (req, reply) => {
    const guildId = BigInt(req.session.activeGuildId!)
    const actorDiscordId = req.session.userId ? BigInt(req.session.userId) : null

    const body = req.body as Record<string, unknown> | null
    if (!body || !Array.isArray(body.matches) || body.matches.length === 0) {
      return reply.code(400).send({ error: "No matches provided" })
    }

    let applied = 0, skipped = 0, errors = 0

    for (const match of body.matches as Record<string, unknown>[]) {
      try {
        const orphanId = BigInt(match.orphan_discord_id as string | number)
        const realId = BigInt(match.real_discord_id as string | number)
        const realName = String(match.real_discord_name ?? "")

        if (orphanId >= 0n) { skipped++; continue } // safety: never reparent real records

        // Check if real user already exists in whitelist_users
        const existing = await app.prisma.whitelistUser.findFirst({
          where: { guildId, discordId: realId },
          select: { discordId: true },
        })

        if (existing) {
          // Real user already exists — delete the orphan duplicate
          await app.prisma.$transaction([
            app.prisma.whitelistIdentifier.deleteMany({ where: { guildId, discordId: orphanId } }),
            app.prisma.whitelistUser.deleteMany({ where: { guildId, discordId: orphanId } }),
          ])
        } else {
          // Re-parent: update discordId in both tables
          await app.prisma.$transaction([
            app.prisma.whitelistIdentifier.updateMany({
              where: { guildId, discordId: orphanId },
              data: { discordId: realId },
            }),
            app.prisma.whitelistUser.updateMany({
              where: { guildId, discordId: orphanId },
              data: { discordId: realId, discordName: realName },
            }),
          ])
        }
        applied++
      } catch (err) {
        app.log.error({ err, match }, "Reconcile apply error")
        errors++
      }
    }

    await app.prisma.auditLog.create({
      data: {
        guildId,
        actionType: "admin_reconcile",
        actorDiscordId,
        details: `Reconciled ${applied} orphan record(s) — ${skipped} skipped, ${errors} errors`,
        createdAt: new Date(),
      },
    })

    return reply.send({ ok: true, applied, skipped, errors })
  })

  // POST /reconcile/rematch-orphans
  // Auto-match all orphans for this guild against existing real Discord users.
  // Optional body: { whitelist_slug?: string }
  app.post("/reconcile/rematch-orphans", { preHandler: adminHook }, async (req, reply) => {
    const guildId = BigInt(req.session.activeGuildId!)
    const actorDiscordId = req.session.userId ? BigInt(req.session.userId) : null

    const body = req.body as Record<string, unknown> | null
    const wlSlug = body?.whitelist_slug ? String(body.whitelist_slug) : ""

    const NAME_MATCH_THRESHOLD = 0.80

    // Resolve whitelist filter
    let whitelistId: number | undefined
    if (wlSlug) {
      const wl = await app.prisma.whitelist.findFirst({ where: { guildId, slug: wlSlug }, select: { id: true } })
      if (!wl) return reply.code(400).send({ error: "Invalid whitelist_slug" })
      whitelistId = wl.id
    }

    // Fetch orphan records
    const orphanRows = await app.prisma.whitelistUser.findMany({
      where: { guildId, discordId: { lt: 0n }, ...(whitelistId ? { whitelistId } : {}) },
      select: { discordId: true, discordName: true, whitelistId: true },
    })

    if (orphanRows.length === 0) {
      return reply.send({ ok: true, matched: 0, skipped: 0, errors: 0 })
    }

    // Fetch all real Discord users (discordId > 0)
    const realRows = await app.prisma.whitelistUser.findMany({
      where: { guildId, discordId: { gt: 0n } },
      select: { discordId: true, discordName: true },
      distinct: ["discordId"],
    })

    let matched = 0, skipped = 0, errors = 0

    for (const orphan of orphanRows) {
      if (!orphan.discordName) { skipped++; continue }

      let bestScore = 0.0
      let bestRealId = 0n
      let bestRealName = ""

      for (const real of realRows) {
        if (!real.discordName) continue
        const score = reconcileScore(orphan.discordName, real.discordName)
        if (score > bestScore) {
          bestScore = score
          bestRealId = real.discordId
          bestRealName = real.discordName
        }
      }

      if (bestScore < NAME_MATCH_THRESHOLD || bestRealId === 0n) { skipped++; continue }

      try {
        // Check if real user already has a record in this same whitelist
        const existing = await app.prisma.whitelistUser.findFirst({
          where: { guildId, discordId: bestRealId, whitelistId: orphan.whitelistId },
          select: { discordId: true },
        })

        if (existing) {
          // Real user exists — delete orphan
          await app.prisma.$transaction([
            app.prisma.whitelistIdentifier.deleteMany({
              where: { guildId, discordId: orphan.discordId, whitelistId: orphan.whitelistId },
            }),
            app.prisma.whitelistUser.deleteMany({
              where: { guildId, discordId: orphan.discordId, whitelistId: orphan.whitelistId },
            }),
          ])
        } else {
          // Re-parent orphan to real Discord user
          await app.prisma.$transaction([
            app.prisma.whitelistIdentifier.updateMany({
              where: { guildId, discordId: orphan.discordId, whitelistId: orphan.whitelistId },
              data: { discordId: bestRealId },
            }),
            app.prisma.whitelistUser.updateMany({
              where: { guildId, discordId: orphan.discordId, whitelistId: orphan.whitelistId },
              data: { discordId: bestRealId, discordName: bestRealName },
            }),
          ])
        }
        matched++
      } catch (err) {
        app.log.error({ err, orphan: orphan.discordId, real: bestRealId }, "Rematch orphan error")
        errors++
      }
    }

    await app.prisma.auditLog.create({
      data: {
        guildId,
        actionType: "admin_rematch_orphans",
        actorDiscordId,
        details: `Re-matched orphans: matched=${matched}, skipped=${skipped}, errors=${errors}`,
        createdAt: new Date(),
      },
    })

    return reply.send({ ok: true, matched, skipped, errors })
  })

  // GET /reconcile/suggest?orphan_id=<negative_id>&limit=5
  // Return top scored match candidates for a single orphan record.
  app.get("/reconcile/suggest", { preHandler: adminHook }, async (req, reply) => {
    const guildId = BigInt(req.session.activeGuildId!)

    const query = req.query as Record<string, string>
    const orphanIdRaw = (query.orphan_id ?? "").trim()
    const limit = Math.max(1, Math.min(10, parseInt(query.limit ?? "5", 10) || 5))

    if (!orphanIdRaw) return reply.code(400).send({ error: "orphan_id is required" })

    let orphanId: bigint
    try { orphanId = BigInt(orphanIdRaw) } catch {
      return reply.code(400).send({ error: "orphan_id must be an integer" })
    }
    if (orphanId >= 0n) {
      return reply.code(400).send({ error: "orphan_id must be a negative number (orphan record)" })
    }

    const orphanRow = await app.prisma.whitelistUser.findFirst({
      where: { guildId, discordId: orphanId },
      select: { discordName: true },
    })
    if (!orphanRow?.discordName) return reply.send({ suggestions: [] })

    const orphanName = orphanRow.discordName

    const realRows = await app.prisma.whitelistUser.findMany({
      where: { guildId, discordId: { gt: 0n } },
      select: { discordId: true, discordName: true },
      distinct: ["discordId"],
    })

    const scored: Array<{ discord_id: string; discord_name: string; score: number }> = []
    const seenIds = new Set<bigint>()

    for (const real of realRows) {
      if (!real.discordName || seenIds.has(real.discordId)) continue
      seenIds.add(real.discordId)

      const score = reconcileScore(orphanName, real.discordName)
      if (score <= 0) continue

      scored.push({
        discord_id: real.discordId.toString(),
        discord_name: real.discordName,
        score,
      })
    }

    scored.sort((a, b) => b.score - a.score)
    return reply.send({ orphan_name: orphanName, suggestions: scored.slice(0, limit) })
  })

  // POST /reconcile/purge-orphans
  // Permanently delete all orphan entries (discordId < 0) for this guild.
  app.post("/reconcile/purge-orphans", { preHandler: adminHook }, async (req, reply) => {
    const guildId     = BigInt(req.session.activeGuildId!)
    const actorId     = req.session.userId ? BigInt(req.session.userId) : null

    const orphans = await app.prisma.whitelistUser.findMany({
      where: { guildId, discordId: { lt: 0n } },
      select: { discordId: true },
      distinct: ["discordId"],
    })
    const orphanIds = orphans.map(o => o.discordId)

    if (orphanIds.length === 0) {
      return reply.send({ ok: true, purged: 0 })
    }

    await app.prisma.$transaction([
      app.prisma.whitelistIdentifier.deleteMany({ where: { guildId, discordId: { in: orphanIds } } }),
      app.prisma.whitelistUser.deleteMany({ where: { guildId, discordId: { in: orphanIds } } }),
    ])

    await app.prisma.auditLog.create({
      data: {
        guildId,
        actionType:    "admin_purge_orphans",
        actorDiscordId: actorId,
        details:       `Purged ${orphanIds.length} orphan entries`,
        createdAt:     new Date(),
      },
    })

    return reply.send({ ok: true, purged: orphanIds.length })
  })
}
