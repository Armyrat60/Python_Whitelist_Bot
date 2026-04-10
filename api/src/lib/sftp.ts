/**
 * SFTP service for game server file operations.
 *
 * Ported from SquadOps sftp-service.ts pattern with:
 * - Path traversal protection
 * - File extension whitelist
 * - Max file size enforcement
 * - Connection timeout + auto-cleanup
 */
import SftpClient from "ssh2-sftp-client"
import path from "path"

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SftpConfig {
  host: string
  port: number
  username: string
  password: string
  basePath: string
}

export interface SftpFileInfo {
  name: string
  type: "file" | "directory"
  size: number
  modifyTime: number
}

// ─── Constants ───────────────────────────────────────────────────────────────

const CONNECT_TIMEOUT = 10_000  // 10 seconds
const MAX_FILE_SIZE = 10 * 1024 * 1024  // 10 MB
const ALLOWED_EXTENSIONS = new Set([".cfg", ".txt", ".ini", ".log", ".md", ".json"])

// ─── Security ────────────────────────────────────────────────────────────────

function validateFilename(filename: string): void {
  if (!filename || filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
    throw new Error("Invalid filename: path traversal not allowed")
  }
  const ext = path.extname(filename).toLowerCase()
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new Error(`File type "${ext}" not allowed. Allowed: ${[...ALLOWED_EXTENSIONS].join(", ")}`)
  }
}

function validateSubDir(subDir: string): void {
  if (subDir.includes("..")) {
    throw new Error("Invalid path: directory traversal not allowed")
  }
}

// ─── Client Wrapper ──────────────────────────────────────────────────────────

/**
 * Run an SFTP operation with automatic connection management.
 * Opens a connection, runs the callback, then always disconnects.
 */
async function withSftpClient<T>(
  config: SftpConfig,
  fn: (client: SftpClient, basePath: string) => Promise<T>,
): Promise<T> {
  const client = new SftpClient()

  try {
    await client.connect({
      host: config.host,
      port: config.port,
      username: config.username,
      password: config.password,
      readyTimeout: CONNECT_TIMEOUT,
      retries: 0,
    })

    return await fn(client, config.basePath)
  } finally {
    try { await client.end() } catch { /* ignore disconnect errors */ }
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Test the SFTP connection and verify the base path exists.
 */
export async function testConnection(config: SftpConfig): Promise<{ ok: boolean; message: string }> {
  try {
    return await withSftpClient(config, async (client, basePath) => {
      const exists = await client.exists(basePath)
      if (!exists) {
        // Try common alternative paths
        const alternatives = [
          "/SquadGame/ServerConfig",
          "/home/" + config.username,
          "/",
        ]
        for (const alt of alternatives) {
          if (await client.exists(alt)) {
            return {
              ok: true,
              message: `Connected! Base path "${basePath}" not found, but "${alt}" exists. Update your base path.`,
            }
          }
        }
        return { ok: true, message: `Connected, but base path "${basePath}" not found. Check your path configuration.` }
      }
      return { ok: true, message: `Connected! Base path "${basePath}" verified.` }
    })
  } catch (err) {
    const msg = (err as Error).message
    if (msg.includes("Authentication failed") || msg.includes("All configured authentication")) {
      return { ok: false, message: "Authentication failed — check username and password" }
    }
    if (msg.includes("Timed out") || msg.includes("ECONNREFUSED")) {
      return { ok: false, message: "Connection failed — check host and port" }
    }
    if (msg.includes("ENOTFOUND") || msg.includes("getaddrinfo")) {
      return { ok: false, message: "Host not found — check the hostname" }
    }
    return { ok: false, message: `Connection failed: ${msg}` }
  }
}

/**
 * List files in the base path (or subdirectory).
 */
export async function listFiles(config: SftpConfig, subDir?: string): Promise<SftpFileInfo[]> {
  if (subDir) validateSubDir(subDir)

  return withSftpClient(config, async (client, basePath) => {
    const targetPath = subDir ? `${basePath}/${subDir}` : basePath
    const items = await client.list(targetPath)

    return items
      .filter((item) => item.type === "-" || item.type === "d")
      .map((item) => ({
        name: item.name,
        type: (item.type === "d" ? "directory" : "file") as "file" | "directory",
        size: item.size,
        modifyTime: item.modifyTime,
      }))
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === "directory" ? -1 : 1
        return a.name.localeCompare(b.name)
      })
  })
}

/**
 * Read a file from the server.
 */
export async function readFile(config: SftpConfig, filename: string): Promise<string> {
  validateFilename(filename)

  return withSftpClient(config, async (client, basePath) => {
    const remotePath = `${basePath}/${filename}`

    // Check file size before reading
    const stat = await client.stat(remotePath)
    if (stat.size > MAX_FILE_SIZE) {
      throw new Error(`File too large (${Math.round(stat.size / 1024)}KB). Maximum is ${MAX_FILE_SIZE / 1024 / 1024}MB.`)
    }

    const buffer = await client.get(remotePath)
    if (Buffer.isBuffer(buffer)) {
      return buffer.toString("utf-8")
    }
    return String(buffer)
  })
}

/**
 * Write a file to the server.
 */
export async function writeFile(config: SftpConfig, filename: string, content: string): Promise<void> {
  validateFilename(filename)

  if (Buffer.byteLength(content) > MAX_FILE_SIZE) {
    throw new Error(`Content too large. Maximum is ${MAX_FILE_SIZE / 1024 / 1024}MB.`)
  }

  return withSftpClient(config, async (client, basePath) => {
    const remotePath = `${basePath}/${filename}`
    await client.put(Buffer.from(content, "utf-8"), remotePath)
  })
}

/**
 * Build an SftpConfig from a GameServer record.
 */
export function toSftpConfig(server: {
  sftpHost: string | null
  sftpPort: number
  sftpUser: string | null
  sftpPassword: string | null
  sftpBasePath: string
}): SftpConfig | null {
  if (!server.sftpHost || !server.sftpUser || !server.sftpPassword) return null
  return {
    host: server.sftpHost,
    port: server.sftpPort,
    username: server.sftpUser,
    password: server.sftpPassword,
    basePath: server.sftpBasePath,
  }
}
