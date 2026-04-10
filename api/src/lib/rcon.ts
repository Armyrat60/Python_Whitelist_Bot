/**
 * Source Engine RCON client.
 *
 * Native implementation using Node.js `net` module.
 * Implements the Source RCON protocol:
 *   [size:int32LE][id:int32LE][type:int32LE][body:utf8\0][padding:\0]
 *
 * Ported from SquadOps rcon-client.ts pattern.
 */
import { Socket } from "net"

// ─── Protocol Constants ──────────────────────────────────────────────────────

const SERVERDATA_AUTH = 3
const SERVERDATA_AUTH_RESPONSE = 2
const SERVERDATA_EXECCOMMAND = 2
const SERVERDATA_RESPONSE = 0

const AUTH_TIMEOUT = 5_000   // 5 seconds
const CMD_TIMEOUT = 10_000   // 10 seconds

// ─── Types ───────────────────────────────────────────────────────────────────

export interface RconConfig {
  host: string
  port: number
  password: string
}

// ─── Packet Encoding/Decoding ────────────────────────────────────────────────

function encodePacket(id: number, type: number, body: string): Buffer {
  const bodyBuf = Buffer.from(body, "utf8")
  // size = 4 (id) + 4 (type) + body.length + 1 (null) + 1 (padding null)
  const size = 4 + 4 + bodyBuf.length + 2
  const buf = Buffer.alloc(4 + size)
  buf.writeInt32LE(size, 0)
  buf.writeInt32LE(id, 4)
  buf.writeInt32LE(type, 8)
  bodyBuf.copy(buf, 12)
  // Null terminators already zero from alloc
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
    body: buf.toString("utf8", 12, 4 + size - 2), // strip null terminators
  }
}

// ─── RCON Client ─────────────────────────────────────────────────────────────

class RconClient {
  private socket: Socket | null = null
  private requestId = 0
  private responseBuffer = Buffer.alloc(0)
  private pendingCallbacks = new Map<number, { resolve: (body: string) => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> }>()

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
        for (const [, cb] of this.pendingCallbacks) {
          clearTimeout(cb.timer)
          cb.reject(new Error("Connection closed"))
        }
        this.pendingCallbacks.clear()
      })

      socket.connect(config.port, config.host, () => {
        // Send auth packet
        const authId = this._nextId()
        const authPacket = encodePacket(authId, SERVERDATA_AUTH, config.password)

        const authCb = {
          resolve: (body: string) => {
            clearTimeout(timeout)
            resolve()
          },
          reject: (err: Error) => {
            clearTimeout(timeout)
            reject(err)
          },
          timer: timeout,
        }

        this.pendingCallbacks.set(authId, authCb)
        socket.write(authPacket)
      })
    })
  }

  async execute(command: string): Promise<string> {
    if (!this.socket) throw new Error("Not connected")

    return new Promise((resolve, reject) => {
      const id = this._nextId()
      const packet = encodePacket(id, SERVERDATA_EXECCOMMAND, command)

      const timer = setTimeout(() => {
        this.pendingCallbacks.delete(id)
        reject(new Error(`RCON command timed out: ${command}`))
      }, CMD_TIMEOUT)

      this.pendingCallbacks.set(id, { resolve, reject, timer })
      this.socket!.write(packet)
    })
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.destroy()
      this.socket = null
    }
    for (const [, cb] of this.pendingCallbacks) {
      clearTimeout(cb.timer)
    }
    this.pendingCallbacks.clear()
    this.responseBuffer = Buffer.alloc(0)
  }

  private _nextId(): number {
    return ++this.requestId
  }

  private _processBuffer(): void {
    while (true) {
      const packet = decodePacket(this.responseBuffer)
      if (!packet) break

      // Consume the packet from buffer
      this.responseBuffer = this.responseBuffer.subarray(4 + packet.size)

      const cb = this.pendingCallbacks.get(packet.id)
      if (cb) {
        clearTimeout(cb.timer)
        this.pendingCallbacks.delete(packet.id)

        if (packet.type === SERVERDATA_AUTH_RESPONSE) {
          if (packet.id === -1) {
            cb.reject(new Error("RCON authentication failed — check password"))
          } else {
            cb.resolve(packet.body)
          }
        } else {
          cb.resolve(packet.body)
        }
      }
    }
  }
}

// ─── Public Wrapper ──────────────────────────────────────────────────────────

/**
 * Run an RCON operation with automatic connection management.
 */
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

/**
 * Test RCON connection.
 */
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
