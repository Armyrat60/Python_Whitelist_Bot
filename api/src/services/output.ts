/**
 * Whitelist output file generator.
 *
 * Builds Squad RemoteAdminList format files from DB data.
 * Port of bot/output.py — generate_output_files().
 *
 * Each whitelist always gets its own file (separate mode only).
 * combined_filename and output_mode are no longer used.
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

  const dedupe = toBool(settings["duplicate_output_dedupe"] ?? "true")

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

  // ── Per-whitelist output (always separate mode) ───────────────────────────
  const enabledWhitelists = whitelists.filter((w) => w.enabled)

  const perWlLines:  Record<string, string[]> = {}
  const perWlSeen:   Record<string, Set<string>> = {}
  const perWlGroups: Record<string, Set<string>> = {}

  for (const wl of enabledWhitelists) {
    perWlGroups[wl.slug] = new Set([wl.squadGroup])
  }

  // Build slug -> whitelist lookup
  const wlBySlug = Object.fromEntries(whitelists.map((w) => [w.slug, w]))

  for (const row of rows) {
    const wl = wlBySlug[row.wlSlug]
    if (!wl || !wl.enabled) continue

    const groupName = wl.squadGroup || "Whitelist"
    const line      = buildLine(row.idType, row.idValue, row.discordName, groupName)
    const dedupKey  = dedupe ? `${row.idType}:${row.idValue}` : line
    const slug      = row.wlSlug

    perWlLines[slug]  ??= []
    perWlSeen[slug]   ??= new Set()
    perWlGroups[slug] ??= new Set([groupName])

    if (!perWlSeen[slug].has(dedupKey)) {
      perWlLines[slug].push(line)
      perWlSeen[slug].add(dedupKey)
      perWlGroups[slug].add(groupName)
    }
  }

  // ── Assemble outputs ──────────────────────────────────────────────────────
  const outputs: OutputMap = {}

  for (const wl of enabledWhitelists) {
    const filename = wl.outputFilename || `${wl.slug}.txt`
    const lines    = perWlLines[wl.slug]  ?? []
    const wlGroups = perWlGroups[wl.slug] ?? new Set([wl.squadGroup])
    outputs[filename] = [...buildGroupHeaders(wlGroups), ...lines].join("\n")
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
