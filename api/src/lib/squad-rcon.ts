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
}

export interface SquadInfo {
  id: string
  name: string
  teamId: string
  size: number
  leader: string
}

export interface ServerInfo {
  name: string
  map: string
  playerCount: number
  maxPlayers: number
}

export interface TeamState {
  teamId: string
  squads: Array<SquadInfo & { players: SquadPlayer[] }>
  unassigned: SquadPlayer[]
}

export interface FullServerState {
  info: ServerInfo
  teams: TeamState[]
  totalPlayers: number
}

// ─── Response Parsers ────────────────────────────────────────────────────────

const PLAYER_REGEX = /ID:\s*(\d+)\s*\|\s*SteamID:\s*(\d+)\s*\|\s*Name:\s*(.+?)\s*\|\s*Team ID:\s*(\d+)\s*\|\s*Squad ID:\s*(\d+|N\/A)/g
const SQUAD_REGEX = /ID:\s*(\d+)\s*\|\s*Name:\s*(.+?)\s*\|\s*Size:\s*(\d+)\s*\|\s*Locked:\s*\w+\s*\|\s*Creator Name:\s*(.+?)(?:\s*\||$)/gm
const TEAM_ID_REGEX = /Team ID:\s*(\d+)/

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
    })
  }
  return players
}

function parseSquads(text: string): SquadInfo[] {
  const squads: SquadInfo[] = []
  // Split by lines and process each
  const lines = text.split("\n")
  for (const line of lines) {
    const squadMatch = line.match(/ID:\s*(\d+)\s*\|\s*Name:\s*(.+?)\s*\|\s*Size:\s*(\d+)\s*\|\s*Locked:\s*\w+\s*\|\s*Creator Name:\s*(.+?)(?:\s*\||$)/)
    if (squadMatch) {
      const teamMatch = line.match(TEAM_ID_REGEX)
      squads.push({
        id: squadMatch[1],
        name: squadMatch[2].trim(),
        teamId: teamMatch?.[1] ?? "0",
        size: parseInt(squadMatch[3], 10),
        leader: squadMatch[4].trim(),
      })
    }
  }
  return squads
}

function parseServerInfo(text: string): ServerInfo {
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
    playerCount: parseInt(info["playercount_i"] || info["players"] || "0", 10),
    maxPlayers: parseInt(info["maxplayers"] || info["publicqueuemax_i"] || "100", 10),
  }
}

// ─── High-Level Commands ─────────────────────────────────────────────────────

export async function getServerInfo(config: RconConfig): Promise<ServerInfo> {
  return withRcon(config, async (client) => {
    const response = await client.execute("ShowServerInfo")
    return parseServerInfo(response)
  })
}

export async function getPlayers(config: RconConfig): Promise<SquadPlayer[]> {
  return withRcon(config, async (client) => {
    const response = await client.execute("ListPlayers")
    return parsePlayers(response)
  })
}

export async function getSquads(config: RconConfig): Promise<SquadInfo[]> {
  return withRcon(config, async (client) => {
    const response = await client.execute("ListSquads")
    return parseSquads(response)
  })
}

export async function getFullServerState(config: RconConfig): Promise<FullServerState> {
  return withRcon(config, async (client) => {
    // Execute sequentially — parallel RCON commands can cause packet interleaving
    const playersText = await client.execute("ListPlayers")
    const squadsText = await client.execute("ListSquads")
    const infoText = await client.execute("ShowServerInfo")

    // Debug: log raw response lengths
    console.log(`[rcon] Raw response lengths — players: ${playersText.length}, squads: ${squadsText.length}, info: ${infoText.length}`)
    if (playersText.length < 50) console.log(`[rcon] Players raw: ${JSON.stringify(playersText)}`)
    if (squadsText.length < 50) console.log(`[rcon] Squads raw: ${JSON.stringify(squadsText)}`)
    if (infoText.length < 200) console.log(`[rcon] Info raw: ${JSON.stringify(infoText)}`)

    const info = parseServerInfo(infoText)
    const players = parsePlayers(playersText)
    const squads = parseSquads(squadsText)

    // Group into teams
    const teamIds = [...new Set([...players.map((p) => p.teamId), ...squads.map((s) => s.teamId)])]
      .filter((id) => id !== "0")
      .sort()

    const teams: TeamState[] = teamIds.map((teamId) => {
      const teamSquads = squads
        .filter((s) => s.teamId === teamId)
        .map((squad) => ({
          ...squad,
          players: players.filter((p) => p.teamId === teamId && p.squadId === squad.id),
        }))

      const unassigned = players.filter(
        (p) => p.teamId === teamId && (p.squadId === "0" || !squads.some((s) => s.id === p.squadId && s.teamId === teamId)),
      )

      return { teamId, squads: teamSquads, unassigned }
    })

    return {
      info,
      teams,
      totalPlayers: players.length,
    }
  })
}

export async function kickPlayer(config: RconConfig, playerId: string, reason: string): Promise<string> {
  return withRcon(config, async (client) => {
    return client.execute(`AdminKick ${playerId} ${reason}`)
  })
}

export async function warnPlayer(config: RconConfig, target: string, message: string): Promise<string> {
  return withRcon(config, async (client) => {
    return client.execute(`AdminWarn ${target} ${message}`)
  })
}

export async function broadcast(config: RconConfig, message: string): Promise<string> {
  return withRcon(config, async (client) => {
    return client.execute(`AdminBroadcast ${message}`)
  })
}

/**
 * Build an RconConfig from a GameServer record.
 */
export function toRconConfig(server: {
  rconHost: string | null
  rconPort: number
  rconPassword: string | null
}): RconConfig | null {
  if (!server.rconHost || !server.rconPassword) return null
  return {
    host: server.rconHost,
    port: server.rconPort,
    password: server.rconPassword,
  }
}
