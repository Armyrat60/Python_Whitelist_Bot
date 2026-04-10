/**
 * Squad-specific RCON commands and response parsing.
 *
 * Uses the raw RCON client to execute Squad commands and parse
 * their text-based responses into structured data.
 */
import { withRcon, type RconConfig } from "./rcon.js"

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SquadPlayer {
  id: string
  steamId: string
  name: string
  teamId: string
  squadId: string
  isLeader: boolean
  role: string
}

export interface SquadInfo {
  id: string
  name: string
  teamId: string
  size: number
  leader: string
  locked: boolean
}

export interface ServerInfo {
  name: string
  map: string
  gameMode: string
  playerCount: number
  maxPlayers: number
}

export interface TeamState {
  teamId: string
  factionTag: string
  factionName: string
  squads: Array<SquadInfo & { players: SquadPlayer[] }>
  unassigned: SquadPlayer[]
}

export interface FullServerState {
  info: ServerInfo
  teams: TeamState[]
  totalPlayers: number
}

// ─── Faction Lookup ─────────────────────────────────────────────────────────

const FACTION_MAP: Record<string, string> = {
  USA:    "United States Army",
  USMC:   "US Marine Corps",
  RUS:    "Russian Ground Forces",
  RGF:    "Russian Ground Forces",
  VDV:    "Russian Airborne",
  CAF:    "Canadian Armed Forces",
  GB:     "British Armed Forces",
  BAF:    "British Armed Forces",
  MEA:    "Middle Eastern Alliance",
  INS:    "Insurgents",
  MIL:    "Irregular Militia",
  IMF:    "Irregular Militia Forces",
  AUS:    "Australian Defence Force",
  ADF:    "Australian Defence Force",
  PLANMC: "PLA Navy Marine Corps",
  PLA:    "People's Liberation Army",
  TLF:    "Turkish Land Forces",
  WPMC:   "Western PMC",
  RADF:   "Royal Australian Defence Force",
}

function extractFactionTag(roles: string[]): string {
  const prefixCounts = new Map<string, number>()
  for (const role of roles) {
    if (!role) continue
    const prefix = role.split("_")[0].toUpperCase()
    if (prefix && prefix.length >= 2) {
      prefixCounts.set(prefix, (prefixCounts.get(prefix) ?? 0) + 1)
    }
  }
  let best = ""
  let bestCount = 0
  for (const [prefix, count] of prefixCounts) {
    if (count > bestCount) { best = prefix; bestCount = count }
  }
  return best
}

// ─── Response Parsers ────────────────────────────────────────────────────────

// Modern Squad format: ID: X | Online IDs: EOS: xxx steam: STEAMID | Name: X | Team ID: X | Squad ID: X | Is Leader: True | Role: CAF_SL_05
const PLAYER_REGEX = /ID:\s*(\d+)\s*\|\s*Online IDs:\s*(?:EOS:\s*\S+\s*)?steam:\s*(\d{17})\s*\|\s*Name:\s*(.+?)\s*\|\s*Team ID:\s*(\d+)\s*\|\s*Squad ID:\s*(\d+|N\/A)\s*\|\s*Is Leader:\s*(True|False)\s*\|\s*Role:\s*(.+?)$/gm

function parsePlayers(text: string): SquadPlayer[] {
  const players: SquadPlayer[] = []
  let match: RegExpExecArray | null
  PLAYER_REGEX.lastIndex = 0
  while ((match = PLAYER_REGEX.exec(text)) !== null) {
    players.push({
      id: match[1],
      steamId: match[2],
      name: match[3].trim(),
      teamId: match[4],
      squadId: match[5] === "N/A" ? "0" : match[5],
      isLeader: match[6] === "True",
      role: match[7]?.trim() ?? "",
    })
  }
  return players
}

function parseSquads(text: string): SquadInfo[] {
  const squads: SquadInfo[] = []
  const lines = text.split("\n")
  let currentTeamId = "0"
  for (const line of lines) {
    // Check for team header lines like "Team ID: 1" or "----- Team 1 -----"
    const teamHeader = line.match(/Team ID:\s*(\d+)/)
      ?? line.match(/-+\s*Team\s+(\d+)\s*-+/)
    if (teamHeader) {
      currentTeamId = teamHeader[1]
      continue
    }

    const squadMatch = line.match(/ID:\s*(\d+)\s*\|\s*Name:\s*(.+?)\s*\|\s*Size:\s*(\d+)\s*\|\s*Locked:\s*(True|False|true|false)\s*\|\s*Creator Name:\s*(.+?)(?:\s*\||$)/)
    if (squadMatch) {
      // Try inline Team ID first, fall back to section header
      const inlineTeam = line.match(/Team ID:\s*(\d+)/)
      squads.push({
        id: squadMatch[1],
        name: squadMatch[2].trim(),
        teamId: inlineTeam?.[1] ?? currentTeamId,
        size: parseInt(squadMatch[3], 10),
        locked: squadMatch[4].toLowerCase() === "true",
        leader: squadMatch[5].trim(),
      })
    }
  }
  return squads
}

function parseServerInfo(text: string): ServerInfo {
  try {
    const json = JSON.parse(text.trim())
    return {
      name: json.ServerName_s || json.servername || "Unknown",
      map: json.MapName_s || json.map || "Unknown",
      gameMode: json.GameMode_s || json.gamemode || "",
      playerCount: parseInt(json.PlayerCount_I || json.playercount || "0", 10),
      maxPlayers: parseInt(json.MaxPlayers || json.maxplayers || "100", 10),
    }
  } catch {
    const lines = text.split("\n")
    const info: Record<string, string> = {}
    for (const line of lines) {
      const colonIdx = line.indexOf(":")
      if (colonIdx > 0) {
        const key = line.slice(0, colonIdx).trim().toLowerCase()
        info[key] = line.slice(colonIdx + 1).trim()
      }
    }
    return {
      name: info["servername"] || info["server name"] || "Unknown",
      map: info["mapname_s"] || info["currentmap"] || info["map"] || "Unknown",
      gameMode: info["gamemode_s"] || info["gamemode"] || "",
      playerCount: parseInt(info["playercount_i"] || info["players"] || "0", 10),
      maxPlayers: parseInt(info["maxplayers"] || "100", 10),
    }
  }
}

// ─── High-Level Commands ─────────────────────────────────────────────────────

export async function getServerInfo(config: RconConfig): Promise<ServerInfo> {
  return withRcon(config, async (client) => {
    const response = await client.execute("ShowServerInfo")
    return parseServerInfo(response)
  })
}

export async function getFullServerState(config: RconConfig): Promise<FullServerState> {
  return withRcon(config, async (client) => {
    const playersText = await client.execute("ListPlayers")
    const squadsText = await client.execute("ListSquads")
    const infoText = await client.execute("ShowServerInfo")

    const players = parsePlayers(playersText)
    const squads = parseSquads(squadsText)
    const info = parseServerInfo(infoText)

    // Infer squad team from players when squad parser couldn't determine it
    for (const squad of squads) {
      if (squad.teamId === "0") {
        const member = players.find((p) => p.squadId === squad.id)
        if (member) squad.teamId = member.teamId
      }
    }

    console.log(`[rcon] Parsed — ${players.length} players, ${squads.length} squads`)
    for (const s of squads) console.log(`[rcon] Squad: id=${s.id} team=${s.teamId} name="${s.name}" size=${s.size} locked=${s.locked}`)

    // Group into teams with faction detection
    const teamIds = [...new Set([...players.map((p) => p.teamId), ...squads.map((s) => s.teamId)])]
      .filter((id) => id !== "0")
      .sort()

    const teams: TeamState[] = teamIds.map((teamId) => {
      const teamPlayers = players.filter((p) => p.teamId === teamId)
      const teamSquads = squads
        .filter((s) => s.teamId === teamId)
        .map((squad) => ({
          ...squad,
          players: teamPlayers.filter((p) => p.squadId === squad.id),
        }))

      const unassigned = teamPlayers.filter(
        (p) => p.squadId === "0" || !squads.some((s) => s.id === p.squadId && s.teamId === teamId),
      )

      // Extract faction from player roles
      const teamRoles = teamPlayers.map((p) => p.role)
      const factionTag = extractFactionTag(teamRoles)
      const factionName = FACTION_MAP[factionTag] ?? ""

      return { teamId, factionTag, factionName, squads: teamSquads, unassigned }
    })

    return { info, teams, totalPlayers: players.length }
  })
}

// ─── Admin Commands ─────────────────────────────────────────────────────────

export async function kickPlayer(config: RconConfig, playerId: string, reason: string): Promise<string> {
  return withRcon(config, (client) => client.execute(`AdminKickById ${playerId} ${reason}`))
}

export async function warnPlayer(config: RconConfig, target: string, message: string): Promise<string> {
  return withRcon(config, (client) => client.execute(`AdminWarn ${target} ${message}`))
}

export async function broadcast(config: RconConfig, message: string): Promise<string> {
  return withRcon(config, (client) => client.execute(`AdminBroadcast ${message}`))
}

export async function forceTeamChange(config: RconConfig, playerId: string): Promise<string> {
  return withRcon(config, (client) => client.execute(`AdminForceTeamChange ${playerId}`))
}

export async function removeFromSquad(config: RconConfig, playerId: string): Promise<string> {
  return withRcon(config, (client) => client.execute(`AdminRemovePlayerFromSquad ${playerId}`))
}

export async function disbandSquad(config: RconConfig, teamId: string, squadId: string): Promise<string> {
  return withRcon(config, (client) => client.execute(`AdminDisbandSquad ${teamId} ${squadId}`))
}

export async function demoteCommander(config: RconConfig, teamId: string): Promise<string> {
  return withRcon(config, (client) => client.execute(`AdminDemoteCommander ${teamId}`))
}

// ─── Server-Level Commands ─────────────────────────────────────────────────

export async function changeLayer(config: RconConfig, layerName: string): Promise<string> {
  return withRcon(config, (client) => client.execute(`AdminChangeLayer ${layerName}`))
}

export async function setNextLayer(config: RconConfig, layerName: string): Promise<string> {
  return withRcon(config, (client) => client.execute(`AdminSetNextLayer ${layerName}`))
}

export async function endMatch(config: RconConfig): Promise<string> {
  return withRcon(config, (client) => client.execute(`AdminEndMatch`))
}

export async function restartMatch(config: RconConfig): Promise<string> {
  return withRcon(config, (client) => client.execute(`AdminRestartMatch`))
}

export async function listLayers(config: RconConfig): Promise<string[]> {
  return withRcon(config, async (client) => {
    const response = await client.execute("ListLayers")
    if (!response || !response.trim()) return []
    return response
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("-") && !line.toLowerCase().startsWith("layer"))
  })
}

export async function showCurrentMap(config: RconConfig): Promise<{ level: string; layer: string }> {
  return withRcon(config, async (client) => {
    const response = await client.execute("ShowCurrentMap")
    const match = response.match(/level is (.+?),\s*layer is (.+)/)
    return {
      level: match?.[1]?.trim() ?? "Unknown",
      layer: match?.[2]?.trim() ?? "Unknown",
    }
  })
}

export async function showNextMap(config: RconConfig): Promise<{ level: string; layer: string }> {
  return withRcon(config, async (client) => {
    const response = await client.execute("ShowNextMap")
    const match = response.match(/level is (.+?),\s*layer is (.+)/)
    return {
      level: match?.[1]?.trim() ?? "Unknown",
      layer: match?.[2]?.trim() ?? "Unknown",
    }
  })
}

// ─── Helpers ────────────────────────────────────────────────────────────────

export function toRconConfig(server: {
  rconHost: string | null
  rconPort: number
  rconPassword: string | null
}): RconConfig | null {
  if (!server.rconHost || !server.rconPassword) return null
  return { host: server.rconHost, port: server.rconPort, password: server.rconPassword }
}
