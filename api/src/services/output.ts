/**
 * Whitelist output file generator.
 *
 * Builds Squad RemoteAdminList format files from DB data.
 *
 * Each whitelist always gets its own file (separate mode only).
 * Entries are grouped by source with comment headers for readability:
 *   // ─── Discord Roster ───
 *   // ─── Manual Roster ────
 *   // ─── Seeding Rewards ──
 *
 * Format:
 *   Group=Whitelist:reserve
 *   Admin=76561198012345678:Whitelist // PlayerName
 */
import type { PrismaClient } from "@prisma/client"

type OutputMap = Record<string, string>

/**
 * Generate all whitelist output files for a guild.
 * Returns { filename: content } for each file to serve.
 */
export async function syncOutputs(
  prisma: PrismaClient,
  guildId: bigint,
): Promise<OutputMap> {
  const settingsRows = await prisma.botSetting.findMany({
    where: { guildId },
    select: { settingKey: true, settingValue: true },
  })
  const settings = Object.fromEntries(settingsRows.map((r) => [r.settingKey, r.settingValue]))
  const dedupe = toBool(settings["duplicate_output_dedupe"] ?? "true")

  const whitelists = await prisma.whitelist.findMany({
    where: { guildId },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
  })

  const groups = await prisma.squadGroup.findMany({ where: { guildId } })
  const groupPerms = Object.fromEntries(groups.map((g) => [g.groupName, g.permissions]))
  const disabledGroups = new Set(groups.filter((g) => !g.enabled).map((g) => g.groupName))

  // Query includes created_via and category for section grouping
  const rows = await prisma.$queryRaw<ExportRow[]>`
    SELECT
      w.slug             AS "wlSlug",
      w.output_filename  AS "outputFilename",
      w.is_manual        AS "isManual",
      u.discord_id       AS "discordId",
      u.discord_name     AS "discordName",
      u.effective_slot_limit AS "slotLimit",
      u.created_via      AS "createdVia",
      u.category_id      AS "categoryId",
      i.id_type          AS "idType",
      i.id_value         AS "idValue",
      c.name             AS "categoryName"
    FROM whitelist_users u
    JOIN whitelists w ON w.id = u.whitelist_id
    JOIN whitelist_identifiers i
      ON u.guild_id = i.guild_id
     AND u.discord_id = i.discord_id
     AND u.whitelist_id = i.whitelist_id
    LEFT JOIN whitelist_categories c ON c.id = u.category_id
    WHERE u.guild_id = ${guildId}
      AND u.status = 'active'
    ORDER BY w.slug, u.created_via, c.name, u.discord_name, i.id_type, i.id_value
  `

  function buildGroupHeaders(usedGroups: Set<string>): string[] {
    const lines: string[] = []
    for (const name of [...usedGroups].sort()) {
      const perms = groupPerms[name] ?? "reserve"
      lines.push(`Group=${name}:${perms}`)
    }
    if (lines.length > 0) lines.push("")
    return lines
  }

  function buildLine(idType: string, idValue: string, name: string, groupName: string): string {
    const suffix = idType === "eosid" ? " [EOS]" : ""
    return `Admin=${idValue}:${groupName} // ${name}${suffix}`
  }

  /**
   * Determine a human-readable section label for a row.
   * Used to group entries with comment headers.
   */
  function getSectionLabel(row: ExportRow): string {
    if (row.createdVia === "seeding_reward") return "Seeding Rewards"
    if (row.isManual) {
      return row.categoryName ? `Manual Roster - ${row.categoryName}` : "Manual Roster"
    }
    return "Discord Roster"
  }

  // ── Build per-whitelist output ──────────────────────────────────────────

  const enabledWhitelists = whitelists.filter(
    (w) => w.enabled && !disabledGroups.has(w.squadGroup),
  )
  const wlBySlug = Object.fromEntries(whitelists.map((w) => [w.slug, w]))

  // Structured output: section -> lines
  const perWlSections: Record<string, Map<string, string[]>> = {}
  const perWlSeen:     Record<string, Set<string>> = {}
  const perWlGroups:   Record<string, Set<string>> = {}
  const userIdCounts = new Map<string, number>()

  for (const wl of enabledWhitelists) {
    perWlGroups[wl.slug] = new Set([wl.squadGroup])
  }

  for (const row of rows) {
    const wl = wlBySlug[row.wlSlug]
    if (!wl || !wl.enabled) continue

    const userKey = `${row.wlSlug}:${String(row.discordId)}`
    const exported = userIdCounts.get(userKey) ?? 0
    if (row.slotLimit > 0 && exported >= row.slotLimit) continue

    // Seeding rewards always use Reserve group regardless of whitelist's group
    const groupName = row.createdVia === "seeding_reward" ? "Reserve" : (wl.squadGroup || "Whitelist")
    const line      = buildLine(row.idType, row.idValue, row.discordName, groupName)
    const dedupKey  = dedupe ? `${row.idType}:${row.idValue}` : line
    const slug      = row.wlSlug
    const section   = getSectionLabel(row)

    perWlSections[slug] ??= new Map()
    perWlSeen[slug]     ??= new Set()
    perWlGroups[slug]   ??= new Set([groupName])

    if (!perWlSeen[slug].has(dedupKey)) {
      if (!perWlSections[slug].has(section)) {
        perWlSections[slug].set(section, [])
      }
      perWlSections[slug].get(section)!.push(line)
      perWlSeen[slug].add(dedupKey)
      perWlGroups[slug].add(groupName)
      userIdCounts.set(userKey, exported + 1)
    }
  }

  // ── Assemble outputs with section headers ─────────────────────────────

  const outputs: OutputMap = {}

  for (const wl of enabledWhitelists) {
    const filename = wl.outputFilename || `${wl.slug}.txt`
    const wlGroups = perWlGroups[wl.slug] ?? new Set([wl.squadGroup])
    const sections = perWlSections[wl.slug]

    const allLines: string[] = [...buildGroupHeaders(wlGroups)]

    if (sections && sections.size > 0) {
      for (const [sectionName, lines] of sections) {
        // Only add section headers if there are multiple sections
        if (sections.size > 1) {
          allLines.push(`// ─── ${sectionName} ${"─".repeat(Math.max(0, 40 - sectionName.length))}`)
        }
        allLines.push(...lines)
        if (sections.size > 1) allLines.push("")
      }
    }

    outputs[filename] = allLines.join("\n")
  }

  return outputs
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface ExportRow {
  wlSlug:         string
  outputFilename: string
  isManual:       boolean
  discordId:      bigint
  discordName:    string
  slotLimit:      number
  createdVia:     string | null
  categoryId:     number | null
  idType:         string
  idValue:        string
  categoryName:   string | null
}

function toBool(val: string): boolean {
  return ["1", "true", "yes", "on"].includes(val.toLowerCase())
}
