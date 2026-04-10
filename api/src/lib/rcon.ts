/**
 * Source Engine RCON client.
 *
 * Native implementation using Node.js `net` module.
 * Implements the Source RCON protocol with multi-packet response support:
 *   [size:int32LE][id:int32LE][type:int32LE][body:utf8\0][padding:\0]
 *
 * Multi-packet handling: After sending a command, we send a follow-up
 * empty SERVERDATA_RESPONSE packet. All response packets before the
 * follow-up's response are concatenated as the command output.
 */
import { Socket } from "net"

// ─── Protocol Constants ──────────────────────────────────────────────────────

const SERVERDATA_AUTH = 3
const SERVERDATA_AUTH_RESPONSE = 2
const SERVERDATA_EXECCOMMAND = 2
const SERVERDATA_RESPONSE = 0

const AUTH_TIMEOUT = 5_000   // 5 seconds
const CMD_TIMEOUT = 15_000   // 15 seconds

// ─── Types ───────────────────────────────────────────────────────────────────

export interface RconConfig {
  host: string
  port: number
  password: string
}

// ─── Packet Encoding/Decoding ────────────────────────────────────────────────

function encodePacket(id: number, type: number, body: string): Buffer {
  const bodyBuf = Buffer.from(body, "utf8")
  const size = 4 + 4 + bodyBuf.length + 2
  const buf = Buffer.alloc(4 + size)
  buf.writeInt32LE(size, 0)
  buf.writeInt32LE(id, 4)
  buf.writeInt32LE(type, 8)
  bodyBuf.copy(buf, 12)
  return buf
}

function decodePacket(buf: Buffer): { size: number; id: number; type: number; body: string } | null {
  if (buf.length < 4) return null
  const size = buf.readInt32LE(0)
  if (buf.length < 4 + size) return null
  return {
    size,
    id: buf.readInt32LE(4),
    type: buf.readInt32LE(8),
    body: buf.toString("utf8", 12, 4 + size - 2),
  }
}

// ─── RCON Client ─────────────────────────────────────────────────────────────

class RconClient {
  private socket: Socket | null = null
  private requestId = 0
  private responseBuffer = Buffer.alloc(0)
  private authenticated = false

  // Multi-packet response accumulator
  private commandResponses = new Map<number, string[]>()
  private commandCallbacks = new Map<number, {
    resolve: (body: string) => void
    reject: (err: Error) => void
    timer: ReturnType<typeof setTimeout>
    sentinelId: number
  }>()
  // Auth callback
  private authCallback: {
    resolve: () => void
    reject: (err: Error) => void
    timer: ReturnType<typeof setTimeout>
    authId: number
  } | null = null

  async connect(config: RconConfig): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = new Socket()
      this.socket = socket

      const timeout = setTimeout(() => {
        socket.destroy()
        reject(new Error("RCON connection timed out"))
      }, AUTH_TIMEOUT)

      socket.on("error", (err) => {
        clearTimeout(timeout)
        reject(err)
      })

      socket.on("data", (data) => {
        this.responseBuffer = Buffer.concat([this.responseBuffer, data])
        this._processBuffer()
      })

      socket.on("close", () => {
        for (const [, cb] of this.commandCallbacks) {
          clearTimeout(cb.timer)
          cb.reject(new Error("Connection closed"))
        }
        this.commandCallbacks.clear()
        if (this.authCallback) {
          clearTimeout(this.authCallback.timer)
          this.authCallback.reject(new Error("Connection closed"))
          this.authCallback = null
        }
      })

      socket.connect(config.port, config.host, () => {
        const authId = this._nextId()
        this.authCallback = {
          resolve: () => { clearTimeout(timeout); this.authenticated = true; resolve() },
          reject: (err) => { clearTimeout(timeout); reject(err) },
          timer: timeout,
          authId,
        }
        socket.write(encodePacket(authId, SERVERDATA_AUTH, config.password))
      })
    })
  }

  async execute(command: string): Promise<string> {
    if (!this.socket || !this.authenticated) throw new Error("Not connected")

    return new Promise((resolve, reject) => {
      const cmdId = this._nextId()
      const sentinelId = this._nextId()

      const timer = setTimeout(() => {
        // On timeout, return whatever we've accumulated so far
        const parts = this.commandResponses.get(cmdId) ?? []
        this.commandResponses.delete(cmdId)
        this.commandCallbacks.delete(cmdId)
        if (parts.length > 0) {
          resolve(parts.join(""))
        } else {
          reject(new Error(`RCON command timed out: ${command}`))
        }
      }, CMD_TIMEOUT)

      this.commandResponses.set(cmdId, [])
      this.commandCallbacks.set(cmdId, { resolve, reject, timer, sentinelId })

      // Send the actual command
      this.socket!.write(encodePacket(cmdId, SERVERDATA_EXECCOMMAND, command))
      // Send a follow-up empty packet — its response marks the end of the command output
      this.socket!.write(encodePacket(sentinelId, SERVERDATA_EXECCOMMAND, ""))
    })
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.destroy()
      this.socket = null
    }
    for (const [, cb] of this.commandCallbacks) {
      clearTimeout(cb.timer)
    }
    this.commandCallbacks.clear()
    this.commandResponses.clear()
    if (this.authCallback) {
      clearTimeout(this.authCallback.timer)
      this.authCallback = null
    }
    this.responseBuffer = Buffer.alloc(0)
  }

  private _nextId(): number {
    return ++this.requestId
  }

  private _processBuffer(): void {
    while (true) {
      const packet = decodePacket(this.responseBuffer)
      if (!packet) break

      this.responseBuffer = this.responseBuffer.subarray(4 + packet.size)

      // ── Auth response handling ──
      if (this.authCallback) {
        // Skip the empty pre-auth SERVERDATA_RESPONSE packet
        if (packet.type === SERVERDATA_RESPONSE && packet.id === this.authCallback.authId) {
          continue
        }
        // Auth success
        if (packet.type === SERVERDATA_AUTH_RESPONSE && packet.id >= 0) {
          const cb = this.authCallback
          this.authCallback = null
          cb.resolve()
          continue
        }
        // Auth failure (id = -1)
        if (packet.type === SERVERDATA_AUTH_RESPONSE && packet.id === -1) {
          const cb = this.authCallback
          this.authCallback = null
          cb.reject(new Error("RCON authentication failed — check password"))
          continue
        }
      }

      // ── Command response handling ──
      // Check if this packet is a sentinel response (marks end of multi-packet output)
      for (const [cmdId, cb] of this.commandCallbacks) {
        if (packet.id === cb.sentinelId) {
          // Sentinel received — finalize the command response
          clearTimeout(cb.timer)
          const parts = this.commandResponses.get(cmdId) ?? []
          this.commandResponses.delete(cmdId)
          this.commandCallbacks.delete(cmdId)
          cb.resolve(parts.join(""))
          break
        }
        if (packet.id === cmdId) {
          // Accumulate response part
          const parts = this.commandResponses.get(cmdId)
          if (parts) parts.push(packet.body)
          break
        }
      }
    }
  }
}

// ─── Public Wrapper ──────────────────────────────────────────────────────────

export async function withRcon<T>(
  config: RconConfig,
  fn: (client: RconClient) => Promise<T>,
): Promise<T> {
  const client = new RconClient()
  try {
    await client.connect(config)
    return await fn(client)
  } finally {
    client.disconnect()
  }
}

export async function testRconConnection(config: RconConfig): Promise<{ ok: boolean; message: string }> {
  try {
    return await withRcon(config, async () => {
      return { ok: true, message: "RCON connected successfully" }
    })
  } catch (err) {
    const msg = (err as Error).message
    if (msg.includes("authentication failed")) return { ok: false, message: "Authentication failed — check RCON password" }
    if (msg.includes("ECONNREFUSED")) return { ok: false, message: "Connection refused — check host and port" }
    if (msg.includes("timed out")) return { ok: false, message: "Connection timed out — check host and port" }
    if (msg.includes("ENOTFOUND")) return { ok: false, message: "Host not found — check hostname" }
    return { ok: false, message: `Connection failed: ${msg}` }
  }
}
