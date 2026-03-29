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
 * Fetch all valid player rows from DBLog_Players for a single guild's server.
 * Opens a connection, reads, then closes — no persistent pool.
 */
export async function fetchPlayersForGuild(cfg: GuildMysqlConfig): Promise<SquadPlayer[]> {
  const conn = await mysql.createConnection({
    host:           cfg.host,
    port:           cfg.port,
    database:       cfg.database,
    user:           cfg.user,
    password:       cfg.password,
    connectTimeout: 15_000,
  })

  try {
    const [rows] = await conn.execute<mysql.RowDataPacket[]>(
      `SELECT steamID, lastName
       FROM DBLog_Players
       WHERE steamID IS NOT NULL
         AND steamID != ''
         AND steamID REGEXP '^[0-9]{17}$'`,
    )
    return rows.map((r) => ({
      steamID:  String(r.steamID),
      lastName: String(r.lastName ?? ""),
    }))
  } finally {
    await conn.end().catch(() => {})
  }
}
