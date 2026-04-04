/**
 * Admin import/export routes.
 *
 * POST /import/headers  — detect CSV columns from pasted/uploaded data
 * POST /import/preview  — preview parsed rows grouped by user
 * POST /import          — execute the import (skip/overwrite/merge)
 * GET  /export          — export whitelist data as CSV/JSON/squad_cfg
 */
import type { FastifyInstance, FastifyPluginAsync } from "fastify"
import { syncOutputs } from "../../services/output.js"
import { cache } from "../../services/cache.js"
import { env } from "../../lib/env.js"

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STEAM64_RE = /^[0-9]{17}$/
const EOSID_RE = /^[0-9a-fA-F]{32}$/

/** Auto-detect CSV column → field mapping from header names. */
function autoDetectColumnMap(headers: string[]): Record<string, string> {
  const map: Record<string, string> = {}
  for (const h of headers) {
    const lh = h.toLowerCase().replace(/[^a-z0-9]/g, "")
    if (["discordid", "discorduid", "userid", "snowflake"].includes(lh)) map[h] = "discord_id"
    else if (["discordname", "discordusername", "username", "name", "player"].includes(lh)) map[h] = "discord_name"
    else if (["steamid", "steam64", "steamid64", "steam"].includes(lh)) map[h] = "steam64"
    else if (["eosid", "epicid", "eos"].includes(lh)) map[h] = "eosid"
    else if (["plan", "tier", "subscription", "rank"].includes(lh)) map[h] = "plan"
    else if (["slots", "slotlimit", "maxslots", "limit"].includes(lh)) map[h] = "slot_limit"
    else if (["notes", "note", "comment"].includes(lh)) map[h] = "notes"
    else if (["category", "group", "roster"].includes(lh)) map[h] = "category"
  }
  return map
}

/** Parse CSV headers from raw data string. */
function parseCsvHeaders(data: string): string[] {
  const firstLine = data.split(/\r?\n/)[0]?.trim()
  if (!firstLine) return []
  // Simple CSV split (doesn't handle quoted commas, but good enough for headers)
  return firstLine.split(",").map((h) => h.trim().replace(/^["']|["']$/g, ""))
}

/** Detect format from data content. */
function detectFormat(data: string): string {
  const trimmed = data.trim()
  if (trimmed.startsWith("//") || /^Admin=/m.test(trimmed)) return "squad_cfg"
  if (/^\d{17}$/m.test(trimmed.split("\n")[0]?.trim() ?? "")) return "plain_ids"
  return "csv"
}

/** Similarity score between two strings (0–1). */
function reconcileScore(a: string, b: string): number {
  const na = a.toLowerCase().replace(/[^a-z0-9]/g, "")
  const nb = b.toLowerCase().replace(/[^a-z0-9]/g, "")
  if (!na || !nb) return 0
  if (na === nb) return 1.0
  // Simple Jaccard-like on bigrams
  const bigrams = (s: string) => new Set(Array.from({ length: s.length - 1 }, (_, i) => s.slice(i, i + 2)))
  const ba = bigrams(na)
  const bb = bigrams(nb)
  if (ba.size === 0 || bb.size === 0) return 0
  let inter = 0
  for (const b of ba) if (bb.has(b)) inter++
  return inter / (ba.size + bb.size - inter)
}

interface ParsedRow {
  discord_id?: string
  discord_name?: string
  steam64?: string
  eosid?: string
  plan?: string
  slot_limit?: number
  notes?: string
  category?: string
}

interface UserGroup {
  discord_id: string
  discord_name: string
  steam_ids: string[]
  eos_ids: string[]
  plan: string
  slot_limit: number
  notes: string
  category: string
  status: "new" | "existing"
  matched_name?: string
  match_score?: number
}

/** Parse CSV data rows into ParsedRow[]. */
function parseCsvData(data: string, columnMap: Record<string, string> | null): { rows: ParsedRow[]; invalid: number } {
  const lines = data.split(/\r?\n/).filter((l) => l.trim())
  if (!lines.length) return { rows: [], invalid: 0 }
  const headers = lines[0].split(",").map((h) => h.trim().replace(/^["']|["']$/g, ""))
  const effectiveMap = columnMap ?? autoDetectColumnMap(headers)

  const rows: ParsedRow[] = []
  let invalid = 0

  for (const line of lines.slice(1)) {
    if (!line.trim()) continue
    const cells = line.split(",").map((c) => c.trim().replace(/^["']|["']$/g, ""))
    const row: ParsedRow = {}
    for (let i = 0; i < headers.length; i++) {
      const field = effectiveMap[headers[i]]
      if (!field || i >= cells.length) continue
      const val = cells[i]?.trim()
      if (!val) continue
      if (field === "steam64") {
        if (STEAM64_RE.test(val)) row.steam64 = val
        else invalid++
      } else if (field === "eosid") {
        if (EOSID_RE.test(val)) row.eosid = val
        else invalid++
      } else if (field === "slot_limit") {
        row.slot_limit = parseInt(val, 10) || undefined
      } else {
        (row as Record<string, string>)[field] = val
      }
    }
    rows.push(row)
  }
  return { rows, invalid }
}

/** Parse Squad .cfg format: Admin=STEAM64:group // name */
function parseSquadCfg(data: string, existingSteam: Set<string>): { rows: ParsedRow[]; invalid: number } {
  const rows: ParsedRow[] = []
  let invalid = 0
  for (const line of data.split(/\r?\n/)) {
    const m = line.match(/^Admin=(\d{17}):([^/\s]+)(?:\s*\/\/\s*(.+))?/)
    if (!m) continue
    const steam64 = m[1]
    if (!STEAM64_RE.test(steam64)) { invalid++; continue }
    const category = m[2]?.trim() || ""
    rows.push({ steam64, category, discord_name: m[3]?.trim() || "(unknown)" })
  }
  return { rows, invalid }
}

/** Parse plain Steam64 ID list */
function parsePlainIds(data: string, existingSteam: Set<string>): { rows: ParsedRow[]; invalid: number } {
  const rows: ParsedRow[] = []
  let invalid = 0
  for (const line of data.split(/\r?\n/)) {
    const val = line.trim()
    if (!val) continue
    if (STEAM64_RE.test(val)) rows.push({ steam64: val })
    else invalid++
  }
  return { rows, invalid }
}

/** Group parsed rows by user. */
function groupRowsByUser(
  rows: ParsedRow[],
  defaultSlot: number,
  existingIds: Set<bigint>,
  planMap: Record<string, number> | null,
): UserGroup[] {
  const byUser = new Map<string, UserGroup>()

  for (const row of rows) {
    const discordId = row.discord_id?.trim() || ""
    const key = discordId || `__anon_${row.steam64 ?? row.eosid ?? Math.random()}`

    if (!byUser.has(key)) {
      let slotLimit = defaultSlot
      if (row.plan && planMap && planMap[row.plan] != null) {
        slotLimit = planMap[row.plan]
      } else if (row.slot_limit != null && row.slot_limit > 0) {
        slotLimit = row.slot_limit
      }

      const did = discordId ? BigInt(discordId) : 0n
      byUser.set(key, {
        discord_id: discordId,
        discord_name: row.discord_name || "(unknown)",
        steam_ids: [],
        eos_ids: [],
        plan: row.plan || "",
        slot_limit: slotLimit,
        notes: row.notes || "",
        category: row.category || "",
        status: (discordId && existingIds.has(did)) ? "existing" : "new",
      })
    }

    const user = byUser.get(key)!
    if (row.steam64 && !user.steam_ids.includes(row.steam64)) user.steam_ids.push(row.steam64)
    if (row.eosid && !user.eos_ids.includes(row.eosid)) user.eos_ids.push(row.eosid)
  }

  return [...byUser.values()]
}

/** Helper: sync outputs after an import. */
async function triggerSync(app: FastifyInstance, guildId: bigint): Promise<void> {
  try {
    const outputs = await syncOutputs(app.prisma, guildId)
    cache.set(guildId, outputs)
  } catch (err) {
    app.log.error({ err, guildId }, "triggerSync failed")
  }
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

export default async function importExportRoutes(app: FastifyInstance) {
  const adminHook = [app.requireAdmin]

  // POST /import/headers
  app.post("/import/headers", { preHandler: adminHook }, async (req, reply) => {
    const body = req.body as Record<string, unknown>
    const data = String(body?.data ?? body?.paste_data ?? "")
    if (!data.trim()) return reply.code(400).send({ error: "No data provided." })

    const headers = parseCsvHeaders(data)
    if (!headers.length) return reply.code(400).send({ error: "Could not detect any CSV columns." })

    return reply.send({ headers, auto_map: autoDetectColumnMap(headers) })
  })

  // POST /import/preview
  app.post("/import/preview", { preHandler: adminHook }, async (req, reply) => {
    const guildId = BigInt(req.session.activeGuildId!)
    const body = req.body as Record<string, unknown>

    let data = String(body?.data ?? body?.paste_data ?? body?.content ?? "")
    const url = String(body?.url ?? "").trim()

    // Fetch from URL if provided and no inline data
    if (!data.trim() && url) {
      try {
        const resp = await fetch(url, { signal: AbortSignal.timeout(15_000) })
        if (!resp.ok) return reply.code(400).send({ error: `URL fetch failed: ${resp.status} ${resp.statusText}` })
        data = await resp.text()
      } catch (err) {
        return reply.code(400).send({ error: `URL fetch failed: ${err instanceof Error ? err.message : "Unknown error"}` })
      }
    }

    let fmt = String(body?.format ?? "csv")
    const wlType = String(body?.whitelist_type ?? body?.type ?? body?.whitelist_slug ?? "")
    const columnMap = body?.column_map ? (typeof body.column_map === "string" ? JSON.parse(body.column_map) : body.column_map) as Record<string, string> : null
    const planMap = body?.plan_map && typeof body.plan_map === "object"
      ? Object.fromEntries(Object.entries(body.plan_map as Record<string, unknown>).map(([k, v]) => [k, Number(v)]))
      : null

    if (fmt === "cfg") fmt = "squad_cfg"
    else if (fmt === "auto") fmt = detectFormat(data)
    else if (!["csv", "squad_cfg", "plain_ids"].includes(fmt)) fmt = "csv"
    if (!data.trim()) return reply.code(400).send({ error: "No data provided." })
    if (fmt === "discord_members") return reply.code(400).send({ error: "Use the Reconcile tab to match a Discord member list." })

    const wl = await app.prisma.whitelist.findUnique({ where: { guildId_slug: { guildId, slug: wlType } } })
    if (!wl) return reply.code(400).send({ error: "Invalid whitelist_type." })

    const existingUsers = await app.prisma.whitelistUser.findMany({ where: { guildId, whitelistId: wl.id } })
    const existingIds = new Set(existingUsers.map((u) => u.discordId))
    const existingNameMap = existingUsers.filter((u) => u.discordId > 0n && u.discordName).map((u) => ({ name: u.discordName, id: u.discordId }))

    const existingSteam = new Set(
      (await app.prisma.whitelistIdentifier.findMany({ where: { guildId, whitelistId: wl.id, idType: "steam64" } })).map((i) => i.idValue)
    )

    let parsed: { rows: ParsedRow[]; invalid: number }
    if (fmt === "squad_cfg") parsed = parseSquadCfg(data, existingSteam)
    else if (fmt === "plain_ids") parsed = parsePlainIds(data, existingSteam)
    else parsed = parseCsvData(data, columnMap)

    const users = groupRowsByUser(parsed.rows, wl.defaultSlotLimit, existingIds, planMap)

    // Name-based matching for entries without discord_id
    const NAME_THRESHOLD = 0.80
    for (const u of users) {
      if (!u.discord_id && u.discord_name !== "(unknown)" && existingNameMap.length > 0) {
        let best = { score: 0, id: 0n, name: "" }
        for (const ex of existingNameMap) {
          const score = reconcileScore(u.discord_name, ex.name)
          if (score > best.score) best = { score, id: ex.id, name: ex.name }
        }
        if (best.score >= NAME_THRESHOLD) {
          u.discord_id = String(best.id)
          u.matched_name = best.name
          u.match_score = Math.round(best.score * 100) / 100
          u.status = existingIds.has(best.id) ? "existing" : "new"
        }
      }
    }

    return reply.send({
      users,
      summary: {
        total_users: users.length,
        total_ids: users.reduce((s, u) => s + u.steam_ids.length + u.eos_ids.length, 0),
        new: users.filter((u) => u.status === "new").length,
        existing: users.filter((u) => u.status === "existing").length,
        invalid: parsed.invalid,
      },
    })
  })

  // POST /import
  app.post("/import", { preHandler: adminHook }, async (req, reply) => {
    const guildId = BigInt(req.session.activeGuildId!)
    const actorId = BigInt(req.session.userId!)
    const body = req.body as Record<string, unknown>

    let data = String(body?.data ?? body?.paste_data ?? body?.content ?? "")
    const url = String(body?.url ?? "").trim()

    // Fetch from URL if provided and no inline data
    if (!data.trim() && url) {
      try {
        const resp = await fetch(url, { signal: AbortSignal.timeout(15_000) })
        if (!resp.ok) return reply.code(400).send({ error: `URL fetch failed: ${resp.status} ${resp.statusText}` })
        data = await resp.text()
      } catch (err) {
        return reply.code(400).send({ error: `URL fetch failed: ${err instanceof Error ? err.message : "Unknown error"}` })
      }
    }

    let fmt = String(body?.format ?? "csv")
    const wlType = String(body?.whitelist_type ?? body?.type ?? body?.whitelist_slug ?? "")
    let dupHandling = String(body?.duplicate_handling ?? body?.duplicate_mode ?? "skip")
    const columnMap = body?.column_map ? (typeof body.column_map === "string" ? JSON.parse(body.column_map) : body.column_map) as Record<string, string> : null
    const planMap = body?.plan_map && typeof body.plan_map === "object"
      ? Object.fromEntries(Object.entries(body.plan_map as Record<string, unknown>).map(([k, v]) => [k, Number(v)]))
      : null

    if (fmt === "cfg") fmt = "squad_cfg"
    else if (fmt === "auto") fmt = detectFormat(data)
    else if (!["csv", "squad_cfg", "plain_ids"].includes(fmt)) fmt = "csv"
    if (!["skip", "overwrite", "merge"].includes(dupHandling)) dupHandling = "skip"
    if (!data.trim()) return reply.code(400).send({ error: "No data provided." })
    if (fmt === "discord_members") return reply.code(400).send({ error: "Use the Reconcile tab to match a Discord member list." })

    const wl = await app.prisma.whitelist.findUnique({ where: { guildId_slug: { guildId, slug: wlType } } })
    if (!wl) return reply.code(400).send({ error: "Invalid whitelist_type." })

    const existingUsers = await app.prisma.whitelistUser.findMany({ where: { guildId, whitelistId: wl.id } })
    const existingIds = new Set(existingUsers.map((u) => u.discordId))
    const existingNameMap = existingUsers.filter((u) => u.discordId > 0n && u.discordName).map((u) => ({ name: u.discordName, id: u.discordId }))

    const existingSteam = new Set(
      (await app.prisma.whitelistIdentifier.findMany({ where: { guildId, whitelistId: wl.id, idType: "steam64" } })).map((i) => i.idValue)
    )

    let parsed: { rows: ParsedRow[]; invalid: number }
    if (fmt === "squad_cfg") parsed = parseSquadCfg(data, existingSteam)
    else if (fmt === "plain_ids") parsed = parsePlainIds(data, existingSteam)
    else parsed = parseCsvData(data, columnMap)

    const users = groupRowsByUser(parsed.rows, wl.defaultSlotLimit, existingIds, planMap)

    let added = 0, updated = 0, skipped = 0, errors = 0
    let idCounter = Date.now()
    const NAME_THRESHOLD = 0.80
    const now = new Date()

    // ── Category handling: auto-create categories if any row has one ──
    const hasCategories = users.some((u) => u.category)
    const categoryIdMap = new Map<string, number>() // category name → id

    if (hasCategories) {
      // Ensure whitelist is manual so categories show on the Manual Roster page
      if (!wl.isManual) {
        await app.prisma.whitelist.update({ where: { id: wl.id }, data: { isManual: true } })
      }

      // Fetch existing categories
      const existingCats = await app.prisma.whitelistCategory.findMany({
        where: { whitelistId: wl.id },
      })
      for (const cat of existingCats) categoryIdMap.set(cat.name.toLowerCase(), cat.id)

      // Create any new categories
      const uniqueCats = [...new Set(users.map((u) => u.category).filter(Boolean))]
      let sortOrder = existingCats.length
      for (const catName of uniqueCats) {
        if (categoryIdMap.has(catName.toLowerCase())) continue
        const created = await app.prisma.whitelistCategory.create({
          data: { guildId, whitelistId: wl.id, name: catName, sortOrder: sortOrder++ },
        })
        categoryIdMap.set(catName.toLowerCase(), created.id)
      }
    }

    for (const user of users) {
      try {
        let discordId = user.discord_id ? BigInt(user.discord_id) : 0n

        // Name-based matching
        if (discordId === 0n && user.discord_name !== "(unknown)" && existingNameMap.length > 0) {
          let best = { score: 0, id: 0n }
          for (const ex of existingNameMap) {
            const score = reconcileScore(user.discord_name, ex.name)
            if (score > best.score) best = { score, id: ex.id }
          }
          if (best.score >= NAME_THRESHOLD) discordId = best.id
        }

        if (discordId === 0n) {
          idCounter++
          discordId = BigInt(-Math.abs(idCounter))
        }

        const isExisting = existingIds.has(discordId)

        const categoryId = user.category ? (categoryIdMap.get(user.category.toLowerCase()) ?? null) : null

        if (isExisting) {
          if (dupHandling === "skip") { skipped++; continue }

          if (dupHandling === "overwrite") {
            await app.prisma.whitelistIdentifier.deleteMany({ where: { guildId, discordId, whitelistId: wl.id } })
            const ids = [
              ...user.steam_ids.map((sid) => ({ guildId, discordId, whitelistId: wl.id, idType: "steam64", idValue: sid, isVerified: false, verificationSource: "import", createdAt: now, updatedAt: now })),
              ...user.eos_ids.map((eid) => ({ guildId, discordId, whitelistId: wl.id, idType: "eosid", idValue: eid, isVerified: false, verificationSource: "import", createdAt: now, updatedAt: now })),
            ]
            if (ids.length > 0) await app.prisma.whitelistIdentifier.createMany({ data: ids, skipDuplicates: true })
            await app.prisma.whitelistUser.update({
              where: { guildId_discordId_whitelistId: { guildId, discordId, whitelistId: wl.id } },
              data: { discordName: user.discord_name, status: "active", effectiveSlotLimit: user.slot_limit, ...(categoryId != null ? { categoryId } : {}), updatedAt: now },
            })
            updated++
          } else if (dupHandling === "merge") {
            // Add new IDs without removing old
            const newIds = [
              ...user.steam_ids.map((sid) => ({ guildId, discordId, whitelistId: wl.id, idType: "steam64", idValue: sid, isVerified: false, verificationSource: "import", createdAt: now, updatedAt: now })),
              ...user.eos_ids.map((eid) => ({ guildId, discordId, whitelistId: wl.id, idType: "eosid", idValue: eid, isVerified: false, verificationSource: "import", createdAt: now, updatedAt: now })),
            ]
            if (newIds.length > 0) await app.prisma.whitelistIdentifier.createMany({ data: newIds, skipDuplicates: true })
            // Update category if provided
            if (categoryId != null) {
              await app.prisma.whitelistUser.update({
                where: { guildId_discordId_whitelistId: { guildId, discordId, whitelistId: wl.id } },
                data: { categoryId, updatedAt: now },
              })
            }
            updated++
          }
        } else {
          // New user
          await app.prisma.whitelistUser.create({
            data: { guildId, discordId, whitelistId: wl.id, discordName: user.discord_name, status: "active", effectiveSlotLimit: user.slot_limit, ...(categoryId != null ? { categoryId } : {}), createdVia: "import", createdAt: now, updatedAt: now },
          })
          const ids = [
            ...user.steam_ids.map((sid) => ({ guildId, discordId, whitelistId: wl.id, idType: "steam64", idValue: sid, isVerified: false, verificationSource: "import", createdAt: now, updatedAt: now })),
            ...user.eos_ids.map((eid) => ({ guildId, discordId, whitelistId: wl.id, idType: "eosid", idValue: eid, isVerified: false, verificationSource: "import", createdAt: now, updatedAt: now })),
          ]
          if (ids.length > 0) await app.prisma.whitelistIdentifier.createMany({ data: ids, skipDuplicates: true })
          added++
        }
      } catch (err) {
        app.log.error({ err }, "Import row failed")
        errors++
      }
    }

    await app.prisma.auditLog.create({
      data: {
        guildId, actionType: "admin_import", actorDiscordId: actorId,
        details: `Imported ${fmt} into ${wlType}: added=${added}, updated=${updated}, skipped=${skipped}, errors=${errors}`,
        whitelistId: wl.id, createdAt: now,
      },
    })

    await triggerSync(app, guildId)

    return reply.send({ ok: true, imported: added + updated, added, updated, skipped, errors })
  })

  // GET /export
  app.get("/export", { preHandler: adminHook }, async (req, reply) => {
    const guildId = BigInt(req.session.activeGuildId!)
    const { type: wlType = "", slugs = "", format: fmt = "csv", filter: filt = "active", columns = "" } = req.query as Record<string, string>

    const normalFmt = fmt === "cfg" ? "squad_cfg" : fmt
    if (!["csv", "squad_cfg", "json"].includes(normalFmt)) return reply.code(400).send({ error: "format must be 'csv', 'squad_cfg', or 'json'." })
    if (!["active", "all", "expired"].includes(filt)) return reply.code(400).send({ error: "filter must be 'active', 'all', or 'expired'." })

    const allWhitelists = await app.prisma.whitelist.findMany({ where: { guildId } })
    const wlBySlug = new Map(allWhitelists.map((w) => [w.slug, w]))

    let wlsToQuery = allWhitelists
    if (wlType !== "combined") {
      if (slugs) {
        const requested = new Set(slugs.split(",").map((s) => s.trim()).filter(Boolean))
        wlsToQuery = allWhitelists.filter((w) => requested.has(w.slug))
        if (!wlsToQuery.length) return reply.code(400).send({ error: "No matching whitelists." })
      } else if (wlBySlug.has(wlType)) {
        wlsToQuery = [wlBySlug.get(wlType)!]
      } else {
        return reply.code(400).send({ error: "Invalid type." })
      }
    }

    const entries: Record<string, unknown>[] = []

    for (const wl of wlsToQuery) {
      const statusFilter = filt === "active" ? { status: "active" } : filt === "expired" ? { status: "inactive" } : {}
      const users = await app.prisma.whitelistUser.findMany({
        where: { guildId, whitelistId: wl.id, ...statusFilter },
        orderBy: { discordName: "asc" },
      })

      for (const u of users) {
        const ids = await app.prisma.whitelistIdentifier.findMany({
          where: { guildId, discordId: u.discordId, whitelistId: wl.id },
        })
        entries.push({
          discord_id: String(u.discordId),
          discord_name: u.discordName,
          whitelist_type: wl.slug,
          status: u.status,
          effective_slot_limit: u.effectiveSlotLimit,
          steam_ids: ids.filter((i) => i.idType === "steam64" || i.idType === "steamid").map((i) => i.idValue),
          eos_ids: ids.filter((i) => i.idType === "eosid").map((i) => i.idValue),
          updated_at: u.updatedAt.toISOString(),
        })
      }
    }

    if (normalFmt === "json") {
      reply.header("Content-Disposition", 'attachment; filename="whitelist_export.json"')
      return reply.send(entries)
    }

    if (normalFmt === "squad_cfg") {
      const lines = ["// Whitelist Export - Squad RemoteAdminList format"]
      for (const e of entries) {
        const wl = wlBySlug.get(e.whitelist_type as string)
        const group = wl?.squadGroup || "reserve"
        for (const sid of e.steam_ids as string[]) {
          lines.push(`Admin=${sid}:${group} // ${e.discord_name}`)
        }
      }
      reply.header("Content-Type", "text/plain")
      reply.header("Content-Disposition", 'attachment; filename="whitelist_export.cfg"')
      return reply.send(lines.join("\n") + "\n")
    }

    // CSV
    const cols = columns ? columns.split(",").map((c) => c.trim()).filter(Boolean) : [
      "discord_name", "discord_id", "whitelist_type", "status", "steam_ids", "eos_ids", "updated_at",
    ]
    const csvLines = [cols.join(",")]
    for (const e of entries) {
      const row = cols.map((c) => {
        const v = (e as Record<string, unknown>)[c]
        if (Array.isArray(v)) return `"${v.join(";").replace(/"/g, '""')}"`
        return `"${String(v ?? "").replace(/"/g, '""')}"`
      })
      csvLines.push(row.join(","))
    }
    reply.header("Content-Type", "text/csv")
    reply.header("Content-Disposition", 'attachment; filename="whitelist_export.csv"')
    return reply.send(csvLines.join("\n"))
  })
}
