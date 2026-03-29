/**
 * SquadJS MySQL client.
 *
 * We read from DBLog_Players (written by the SquadJS DBLog plugin) and
 * optionally from a bans table. We never write to the SquadJS database.
 *
 * Standard DBLog_Players columns:
 *   steamID  VARCHAR(32)   — Steam64 ID (17-digit string starting with 765611)
 *   lastName VARCHAR(255)  — Most recent in-game display name
 *   lastIP   VARCHAR(255)  — Last known IP (we ignore this for privacy)
 */

import mysql from "mysql2/promise"
import { config } from "./config.js"

let pool: mysql.Pool | null = null

function getPool(): mysql.Pool {
  if (!pool) {
    pool = mysql.createPool({
      uri: config.MYSQL_URL,
      connectionLimit: 5,
      waitForConnections: true,
      queueLimit: 0,
      enableKeepAlive: true,
      keepAliveInitialDelay: 10_000,
    })
  }
  return pool
}

export interface SquadPlayer {
  steamID: string
  lastName: string
}

/**
 * Fetch all non-empty player rows from DBLog_Players.
 * We do a full table scan every sync — DBLog_Players typically has no
 * updatedAt column, and player counts on most Squad servers are < 50k.
 */
export async function fetchAllPlayers(): Promise<SquadPlayer[]> {
  const [rows] = await getPool().execute<mysql.RowDataPacket[]>(
    `SELECT steamID, lastName
     FROM DBLog_Players
     WHERE steamID IS NOT NULL
       AND steamID != ''
       AND steamID REGEXP '^[0-9]{17}$'`,
  )
  return rows.map((r) => ({
    steamID: String(r.steamID),
    lastName: String(r.lastName ?? ""),
  }))
}

/** Close pool connections on graceful shutdown. */
export async function closeMySQL(): Promise<void> {
  if (pool) {
    await pool.end()
    pool = null
  }
}
