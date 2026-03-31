/**
 * SquadJS MySQL client — per-guild dynamic connections.
 *
 * Each guild stores its own MySQL credentials in bridge_configs.
 * We create a short-lived connection per sync run (not a persistent pool)
 * since syncs run infrequently and we may have many guilds.
 */

import mysql from "mysql2/promise"

export interface GuildMysqlConfig {
  host:     string
  port:     number
  database: string
  user:     string
  password: string
}

export interface SquadPlayer {
  steamID:  string
  lastName: string
}

/**
 * Fetch valid player rows from DBLog_Players for a single guild's server.
 * Pass `since` for an incremental sync (only rows updated after that timestamp).
 * Opens a connection, reads, then closes — no persistent pool.
 */
export async function fetchPlayersForGuild(
  cfg: GuildMysqlConfig,
  since?: Date,
): Promise<SquadPlayer[]> {
  const conn = await mysql.createConnection({
    host:           cfg.host,
    port:           cfg.port,
    database:       cfg.database,
    user:           cfg.user,
    password:       cfg.password,
    connectTimeout: 15_000,
  })

  try {
    const baseWhere = `steamID IS NOT NULL AND steamID != '' AND steamID REGEXP '^[0-9]{17}$'`

    // Try incremental first; some SquadJS versions don't have an updatedAt column
    // so we detect the correct timestamp column name before filtering by it.
    let rows: mysql.RowDataPacket[]
    if (since) {
      const tsCol = await detectTimestampColumn(conn)
      if (tsCol) {
        ;[rows] = await conn.execute<mysql.RowDataPacket[]>(
          `SELECT steamID, lastName FROM DBLog_Players WHERE ${baseWhere} AND \`${tsCol}\` >= ?`,
          [since],
        )
      } else {
        // No timestamp column — fall back to full sync
        console.warn("[bridge][mysql] DBLog_Players has no updatedAt/updated_at column — falling back to full sync")
        ;[rows] = await conn.execute<mysql.RowDataPacket[]>(
          `SELECT steamID, lastName FROM DBLog_Players WHERE ${baseWhere}`,
        )
      }
    } else {
      ;[rows] = await conn.execute<mysql.RowDataPacket[]>(
        `SELECT steamID, lastName FROM DBLog_Players WHERE ${baseWhere}`,
      )
    }

    return (rows as mysql.RowDataPacket[]).map((r) => ({
      steamID:  String(r.steamID),
      lastName: String(r.lastName ?? ""),
    }))
  } finally {
    await conn.end().catch(() => {})
  }
}

/**
 * Returns the name of the timestamp column in DBLog_Players used for
 * incremental syncs ('updatedAt' or 'updated_at'), or null if neither exists.
 * Cached per-process to avoid repeated SHOW COLUMNS queries.
 */
const _tsColCache = new Map<string, string | null>()
async function detectTimestampColumn(conn: mysql.Connection): Promise<string | null> {
  const cacheKey = (conn as any).config?.database ?? "default"
  if (_tsColCache.has(cacheKey)) return _tsColCache.get(cacheKey)!

  const [cols] = await conn.execute<mysql.RowDataPacket[]>(
    `SHOW COLUMNS FROM DBLog_Players`,
  )
  const names = (cols as mysql.RowDataPacket[]).map((c) => String(c.Field))
  const col = names.find((n) => n === "updatedAt" || n === "updated_at") ?? null
  _tsColCache.set(cacheKey, col)
  return col
}
