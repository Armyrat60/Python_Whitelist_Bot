/**
 * Source Engine RCON client for Squad servers.
 *
 * Uses timer-based multi-packet response collection:
 * After receiving a response packet, waits for more packets.
 * If no more arrive within COLLECT_WINDOW_MS, the response is complete.
 * This handles Squad's large ListPlayers responses (60+ players).
 */
import { Socket } from "net"

// ─── Protocol Constants ──────────────────────────────────────────────────────

const SERVERDATA_AUTH = 3
const SERVERDATA_AUTH_RESPONSE = 2
const SERVERDATA_EXECCOMMAND = 2
const SERVERDATA_RESPONSE = 0

const AUTH_TIMEOUT = 5_000       // 5s for auth
const CMD_TIMEOUT = 20_000       // 20s max wait for any response
const COLLECT_WINDOW_MS = 300    // 300ms silence = response complete

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

function decodePackets(buf: Buffer): Array<{ size: number; id: number; type: number; body: string }> {
  const packets: Array<{ size: number; id: number; type: number; body: string }> = []
  let offset = 0
  while (offset + 4 <= buf.length) {
    const size = buf.readInt32LE(offset)
    if (offset + 4 + size > buf.length) break // incomplete packet
    packets.push({
      size,
      id: buf.readInt32LE(offset + 4),
      type: buf.readInt32LE(offset + 8),
      body: buf.toString("utf8", offset + 12, offset + 4 + size - 2),
    })
    offset += 4 + size
  }
  return packets
}

// ─── RCON Client ─────────────────────────────────────────────────────────────

class RconClient {
  private socket: Socket | null = null
  private requestId = 0
  private responseBuffer = Buffer.alloc(0)
  private authenticated = false
  private packetListeners: Array<(packet: { id: number; type: number; body: string }) => void> = []

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
        const packets = decodePackets(this.responseBuffer)

        // Calculate consumed bytes
        let consumed = 0
        for (const p of packets) consumed += 4 + p.size
        if (consumed > 0) {
          this.responseBuffer = this.responseBuffer.subarray(consumed)
        }

        for (const p of packets) {
          for (const listener of this.packetListeners) {
            listener(p)
          }
        }
      })

      socket.on("close", () => {
        this.packetListeners = []
      })

      // Connect and authenticate
      socket.connect(config.port, config.host, () => {
        const authId = this._nextId()

        const onPacket = (p: { id: number; type: number; body: string }) => {
          // Skip the empty pre-auth response
          if (p.type === SERVERDATA_RESPONSE && p.id === authId) return

          if (p.type === SERVERDATA_AUTH_RESPONSE) {
            this.packetListeners = this.packetListeners.filter(l => l !== onPacket)
            clearTimeout(timeout)
            if (p.id === -1) {
              reject(new Error("RCON authentication failed — check password"))
            } else {
              this.authenticated = true
              resolve()
            }
          }
        }

        this.packetListeners.push(onPacket)
        socket.write(encodePacket(authId, SERVERDATA_AUTH, config.password))
      })
    })
  }

  /**
   * Execute an RCON command and collect the full multi-packet response.
   * Uses timer-based collection: after each packet, waits COLLECT_WINDOW_MS
   * for more. If no more arrive, returns the accumulated response.
   */
  async execute(command: string): Promise<string> {
    if (!this.socket || !this.authenticated) throw new Error("Not connected")

    return new Promise((resolve, reject) => {
      const id = this._nextId()
      const parts: string[] = []
      let collectTimer: ReturnType<typeof setTimeout> | null = null

      const maxTimer = setTimeout(() => {
        cleanup()
        // Return whatever we have on timeout
        resolve(parts.join(""))
      }, CMD_TIMEOUT)

      const finalize = () => {
        clearTimeout(maxTimer)
        cleanup()
        resolve(parts.join(""))
      }

      const onPacket = (p: { id: number; type: number; body: string }) => {
        if (p.id !== id) return

        parts.push(p.body)

        // Reset the collection timer — wait for more packets
        if (collectTimer) clearTimeout(collectTimer)
        collectTimer = setTimeout(finalize, COLLECT_WINDOW_MS)
      }

      const cleanup = () => {
        this.packetListeners = this.packetListeners.filter(l => l !== onPacket)
        if (collectTimer) clearTimeout(collectTimer)
      }

      this.packetListeners.push(onPacket)
      this.socket!.write(encodePacket(id, SERVERDATA_EXECCOMMAND, command))
    })
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.destroy()
      this.socket = null
    }
    this.packetListeners = []
    this.responseBuffer = Buffer.alloc(0)
    this.authenticated = false
  }

  private _nextId(): number {
    return ++this.requestId
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
