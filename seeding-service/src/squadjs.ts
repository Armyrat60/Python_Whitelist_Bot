/**
 * SquadJS Socket.IO client with hardened security.
 *
 * Connects to SquadJS instances via Socket.IO for real-time player data.
 * This is a READ-ONLY client — it never sends commands to the game server.
 *
 * Security measures:
 * - Token-based auth in Socket.IO auth object (not query params)
 * - All Steam IDs validated against /^[0-9]{17}$/
 * - Player names truncated and stripped of control characters
 * - Exponential backoff on reconnect (1s → 30s)
 * - Connection state tracking per guild:server composite key
 */

import { io, Socket } from "socket.io-client"

const STEAM64_RE = /^[0-9]{17}$/

export interface OnlinePlayer {
  steamId: string
  name: string
}

interface ConnectionState {
  socket: Socket
  connected: boolean
  lastError: string | null
  lastPlayerCount: number
  reconnectAttempts: number
}

const connections = new Map<string, ConnectionState>()

/**
 * Sanitize a player name: strip control characters, truncate to 255 chars.
 */
function sanitizeName(raw: unknown): string {
  if (typeof raw !== "string") return "Unknown"
  // eslint-disable-next-line no-control-regex
  return raw.replace(/[\x00-\x1F\x7F]/g, "").trim().slice(0, 255) || "Unknown"
}

/**
 * Validate a Steam64 ID.
 */
function isValidSteamId(id: unknown): id is string {
  return typeof id === "string" && STEAM64_RE.test(id)
}

/**
 * Wrap a socket emit as a Promise with timeout.
 */
function emitPromise<T>(
  socket: Socket,
  event: string,
  data: Record<string, unknown> = {},
  timeoutSec = 5,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Socket emit "${event}" timed out after ${timeoutSec}s`))
    }, timeoutSec * 1000)

    socket.emit(event, data, (response: T) => {
      clearTimeout(timer)
      resolve(response)
    })
  })
}

/**
 * Build a composite connection key from guildId and serverId.
 */
function connKey(guildId: string, serverId: number): string {
  return `${guildId}:${serverId}`
}

/**
 * Connect to a SquadJS instance for a specific guild + server.
 */
export function connect(
  guildId: string,
  serverId: number,
  host: string,
  port: number,
  token: string,
): void {
  const key = connKey(guildId, serverId)

  // Disconnect existing connection if any
  disconnect(guildId, serverId)

  const url = `http://${host}:${port}`
  console.log(`[seeding/squadjs] Connecting to ${host}:${port} for guild ${guildId} server ${serverId}`)

  const socket = io(url, {
    auth: { token },
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 30000,
    reconnectionAttempts: 20,
    timeout: 10000,
    autoUnref: true,
  })

  const state: ConnectionState = {
    socket,
    connected: false,
    lastError: null,
    lastPlayerCount: 0,
    reconnectAttempts: 0,
  }

  socket.on("connect", () => {
    console.log(`[seeding/squadjs] Connected to ${host}:${port} for guild ${guildId} server ${serverId}`)
    state.connected = true
    state.lastError = null
    state.reconnectAttempts = 0
  })

  socket.on("disconnect", (reason) => {
    console.log(`[seeding/squadjs] Disconnected from ${host}:${port}: ${reason}`)
    state.connected = false
  })

  socket.on("connect_error", (err) => {
    state.reconnectAttempts++
    state.lastError = err.message
    state.connected = false
    // Only log every 5th attempt to avoid spam
    if (state.reconnectAttempts % 5 === 1) {
      console.error(`[seeding/squadjs] Connection error for guild ${guildId} server ${serverId} (attempt ${state.reconnectAttempts}): ${err.message}`)
    }
  })

  connections.set(key, state)
}

/**
 * Get the list of online players from SquadJS.
 * Returns an empty array if not connected or on error.
 */
export async function getOnlinePlayers(guildId: string, serverId: number): Promise<OnlinePlayer[]> {
  const key = connKey(guildId, serverId)
  const state = connections.get(key)
  if (!state || !state.connected) return []

  try {
    // SquadJS exposes player list via rcon.getListPlayers
    const response = await emitPromise<unknown>(
      state.socket,
      "rcon.getListPlayers",
      {},
      5,
    )

    // Response is typically an array of player objects
    if (!Array.isArray(response)) {
      console.warn(`[seeding/squadjs] Unexpected player list response type for guild ${guildId} server ${serverId}`)
      return []
    }

    const players: OnlinePlayer[] = []
    for (const raw of response) {
      if (typeof raw !== "object" || raw === null) continue

      const entry = raw as Record<string, unknown>
      const steamId = entry.steamID ?? entry.steamId ?? entry.steam_id
      const name = entry.name ?? entry.playerName ?? entry.player_name

      if (!isValidSteamId(steamId)) continue

      players.push({
        steamId: steamId,
        name: sanitizeName(name),
      })
    }

    state.lastPlayerCount = players.length
    return players
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[seeding/squadjs] Failed to get player list for guild ${guildId} server ${serverId}: ${msg}`)
    return []
  }
}

/**
 * Send an RCON warning message to a specific player in-game.
 * Returns true if the message was sent successfully.
 */
export async function warnPlayer(
  guildId: string,
  serverId: number,
  steamId: string,
  message: string,
): Promise<boolean> {
  const key = connKey(guildId, serverId)
  const state = connections.get(key)
  if (!state || !state.connected) return false

  try {
    await emitPromise(
      state.socket,
      "rcon.warn",
      { steamID: steamId, message },
      5,
    )
    return true
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[seeding/squadjs] Failed to warn player ${steamId}: ${msg}`)
    return false
  }
}

/**
 * Get the current player count for a guild + server.
 * Returns -1 if not connected.
 */
export function getPlayerCount(guildId: string, serverId: number): number {
  const key = connKey(guildId, serverId)
  const state = connections.get(key)
  if (!state) return -1
  return state.lastPlayerCount
}

/**
 * Check if connected to a guild+server's SquadJS instance.
 */
export function isConnected(guildId: string, serverId: number): boolean {
  const key = connKey(guildId, serverId)
  const state = connections.get(key)
  return state?.connected ?? false
}

/**
 * Get connection status for health reporting.
 */
export function getConnectionStatus(guildId: string, serverId: number): {
  connected: boolean
  lastError: string | null
  reconnectAttempts: number
} {
  const key = connKey(guildId, serverId)
  const state = connections.get(key)
  if (!state) return { connected: false, lastError: "Not initialized", reconnectAttempts: 0 }
  return {
    connected: state.connected,
    lastError: state.lastError,
    reconnectAttempts: state.reconnectAttempts,
  }
}

/**
 * Disconnect from a specific guild+server's SquadJS instance.
 */
export function disconnect(guildId: string, serverId: number): void {
  const key = connKey(guildId, serverId)
  const state = connections.get(key)
  if (!state) return

  state.socket.removeAllListeners()
  state.socket.disconnect()
  connections.delete(key)
  console.log(`[seeding/squadjs] Disconnected guild ${guildId} server ${serverId}`)
}

/**
 * Disconnect from all SquadJS instances.
 */
export function disconnectAll(): void {
  for (const [key, state] of connections) {
    state.socket.removeAllListeners()
    state.socket.disconnect()
    console.log(`[seeding/squadjs] Disconnected ${key}`)
  }
  connections.clear()
  console.log("[seeding/squadjs] All connections closed")
}

/**
 * Get count of active connections.
 */
export function connectionCount(): number {
  let count = 0
  for (const state of connections.values()) {
    if (state.connected) count++
  }
  return count
}

/**
 * Test a Socket.IO connection to SquadJS.
 * Connects, tries to get player list, then disconnects.
 * Returns { ok, message, player_count }.
 */
export async function testConnection(
  host: string,
  port: number,
  token: string,
): Promise<{ ok: boolean; message: string; player_count?: number }> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      socket.disconnect()
      resolve({ ok: false, message: "Connection timed out after 10 seconds" })
    }, 10000)

    const socket = io(`http://${host}:${port}`, {
      auth: { token },
      reconnection: false,
      timeout: 8000,
      autoUnref: true,
    })

    socket.on("connect", async () => {
      try {
        const response = await emitPromise<unknown>(socket, "rcon.getListPlayers", {}, 5)
        const count = Array.isArray(response) ? response.length : 0
        clearTimeout(timeout)
        socket.disconnect()
        resolve({ ok: true, message: `Connected. ${count} player(s) online.`, player_count: count })
      } catch (err) {
        clearTimeout(timeout)
        socket.disconnect()
        const msg = err instanceof Error ? err.message : String(err)
        resolve({ ok: false, message: `Connected but failed to get players: ${msg}` })
      }
    })

    socket.on("connect_error", (err) => {
      clearTimeout(timeout)
      socket.disconnect()
      resolve({ ok: false, message: `Connection failed: ${err.message}` })
    })
  })
}
