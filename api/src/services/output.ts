/**
 * Whitelist output file generator.
 *
 * Builds Squad RemoteAdminList format files from DB data.
 * Port of bot/output.py — generate_output_files().
 *
 * Format:
 *   Group=Whitelist:reserve
 *   Group=Admin:kick,ban,chat,cameraman,immune,reserve
 *
 *   Admin=76561198012345678:Whitelist // PlayerName
 *   Admin=76561198087654321:Admin // AdminPlayer [EOS]
 */
import type { PrismaClient } from "@prisma/client"

// ─── Types ────────────────────────────────────────────────────────────────────

type OutputMap = Record<string, string>  // filename -> file content

// ─── Main export ─────────────────────────────────────────────────────────────

/**
 * Generate all whitelist output files for a guild.
 * Returns { filename: content } for each file to serve.
 */
export async function syncOutputs(
  prisma: PrismaClient,
  guildId: bigint,
): Promise<OutputMap> {
  // ── Settings ──────────────────────────────────────────────────────────────
  const settingsRows = await prisma.botSetting.findMany({
    where: { guildId },
    select: { settingKey: true, settingValue: true },
  })
  const settings = Object.fromEntries(settingsRows.map((r) => [r.settingKey, r.settingValue]))

  const outputMode      = settings["output_mode"]      ?? "combined"
  const combinedFilename = settings["combined_filename"] ?? "whitelist.txt"
  const dedupe          = toBool(settings["duplicate_output_dedupe"] ?? "true")

  // ── Whitelists ────────────────────────────────────────────────────────────
  const whitelists = await prisma.whitelist.findMany({
    where: { guildId },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
  })

  // ── Squad groups → permissions map ────────────────────────────────────────
  const groups = await prisma.squadGroup.findMany({ where: { guildId } })
  const groupPerms = Object.fromEntries(groups.map((g) => [g.groupName, g.permissions]))

  // ── Active export rows ────────────────────────────────────────────────────
  const rows = await prisma.$queryRaw<ExportRow[]>`
    SELECT
      w.slug          AS "wlSlug",
      w.output_filename AS "outputFilename",
      u.discord_id    AS "discordId",
      u.discord_name  AS "discordName",
      i.id_type       AS "idType",
      i.id_value      AS "idValue"
    FROM whitelist_users u
    JOIN whitelists w ON w.id = u.whitelist_id
    JOIN whitelist_identifiers i
      ON u.guild_id = i.guild_id
     AND u.discord_id = i.discord_id
     AND u.whitelist_id = i.whitelist_id
    WHERE u.guild_id = ${guildId}
      AND u.status = 'active'
    ORDER BY w.slug, u.discord_name, i.id_type, i.id_value
  `

  // ── Build helpers ─────────────────────────────────────────────────────────

  function buildGroupHeaders(usedGroups: Set<string>): string[] {
    const lines: string[] = []
    for (const name of [...usedGroups].sort()) {
      const perms = groupPerms[name] ?? "reserve"
      lines.push(`Group=${name}:${perms}`)
    }
    if (lines.length > 0) lines.push("", "")
    return lines
  }

  function buildLine(idType: string, idValue: string, name: string, groupName: string): string {
    const suffix = idType === "eosid" ? " [EOS]" : ""
    return `Admin=${idValue}:${groupName} // ${name}${suffix}`
  }

  // ── Pre-seed group sets from all enabled whitelists ───────────────────────
  // Ensures group headers always appear even when a whitelist is empty.
  const enabledWhitelists = whitelists.filter((w) => w.enabled)
  const allEnabledGroups = new Set(enabledWhitelists.map((w) => w.squadGroup))

  // Build slug -> whitelist lookup for the loop below
  const wlBySlug = Object.fromEntries(whitelists.map((w) => [w.slug, w]))

  // ── Combined mode ─────────────────────────────────────────────────────────
  const combinedLines:   string[] = []
  const combinedSeen  = new Set<string>()
  const combinedGroups = new Set<string>(allEnabledGroups)

  // ── Per-whitelist mode ────────────────────────────────────────────────────
  const perWlLines:  Record<string, string[]> = {}
  const perWlSeen:   Record<string, Set<string>> = {}
  const perWlGroups: Record<string, Set<string>> = {}

  for (const wl of enabledWhitelists) {
    perWlGroups[wl.slug] = new Set([wl.squadGroup])
  }

  // ── Process rows ──────────────────────────────────────────────────────────
  for (const row of rows) {
    const wl = wlBySlug[row.wlSlug]
    if (!wl || !wl.enabled) continue

    const groupName = wl.squadGroup || "Whitelist"
    const line      = buildLine(row.idType, row.idValue, row.discordName, groupName)
    const dedupKey  = dedupe ? `${row.idType}:${row.idValue}` : line

    if (outputMode === "combined" || outputMode === "hybrid") {
      if (!combinedSeen.has(dedupKey)) {
        combinedLines.push(line)
        combinedSeen.add(dedupKey)
        combinedGroups.add(groupName)
      }
    }

    if (outputMode === "separate" || outputMode === "hybrid") {
      const slug = row.wlSlug
      perWlLines[slug]  ??= []
      perWlSeen[slug]   ??= new Set()
      perWlGroups[slug] ??= new Set([groupName])

      if (!perWlSeen[slug].has(dedupKey)) {
        perWlLines[slug].push(line)
        perWlSeen[slug].add(dedupKey)
        perWlGroups[slug].add(groupName)
      }
    }
  }

  // ── Assemble outputs ──────────────────────────────────────────────────────
  const outputs: OutputMap = {}

  if (outputMode === "combined" || outputMode === "hybrid") {
    const content = [...buildGroupHeaders(combinedGroups), ...combinedLines].join("\n")
    outputs[combinedFilename] = content

    // Also serve combined content under each whitelist's own filename so
    // per-whitelist URLs are always valid regardless of output_mode.
    for (const wl of enabledWhitelists) {
      if (wl.outputFilename && wl.outputFilename !== combinedFilename) {
        outputs[wl.outputFilename] = content
      }
    }
  }

  if (outputMode === "separate" || outputMode === "hybrid") {
    for (const wl of enabledWhitelists) {
      const lines  = perWlLines[wl.slug]  ?? []
      const groups = perWlGroups[wl.slug] ?? new Set([wl.squadGroup])
      outputs[wl.outputFilename] = [...buildGroupHeaders(groups), ...lines].join("\n")
    }
  }

  return outputs
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface ExportRow {
  wlSlug:      string
  outputFilename: string
  discordId:   bigint
  discordName: string
  idType:      string
  idValue:     string
}

function toBool(val: string): boolean {
  return ["1", "true", "yes", "on"].includes(val.toLowerCase())
}
