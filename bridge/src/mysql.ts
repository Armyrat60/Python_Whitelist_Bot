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
    const [rows] = since
      ? await conn.execute<mysql.RowDataPacket[]>(
          `SELECT steamID, lastName FROM DBLog_Players WHERE ${baseWhere} AND updatedAt >= ?`,
          [since],
        )
      : await conn.execute<mysql.RowDataPacket[]>(
          `SELECT steamID, lastName FROM DBLog_Players WHERE ${baseWhere}`,
        )

    return (rows as mysql.RowDataPacket[]).map((r) => ({
      steamID:  String(r.steamID),
      lastName: String(r.lastName ?? ""),
    }))
  } finally {
    await conn.end().catch(() => {})
  }
}
