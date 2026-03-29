/**
 * Core sync logic.
 *
 * Reads all enabled guild configs from bridge_configs, then for each guild:
 *   1. Connects to that guild's SquadJS MySQL database
 *   2. Fetches all players from DBLog_Players
 *   3. Upserts them into squad_players in the whitelister PostgreSQL DB
 *   4. Updates last_sync_at / last_sync_status / last_sync_message
 */

import { pool, ensureTable, upsertPlayers, logSyncRun } from "./db.js"
import { fetchPlayersForGuild } from "./mysql.js"
import { config } from "./config.js"

interface BridgeConfigRow {
  id:                    number
  guild_id:              bigint
  mysql_host:            string
  mysql_port:            number
  mysql_database:        string
  mysql_user:            string
  mysql_password:        string
  server_name:           string
  sync_interval_minutes: number
}

/** Fetch all enabled guild bridge configs from the DB. */
async function loadEnabledConfigs(): Promise<BridgeConfigRow[]> {
  const result = await pool.query<BridgeConfigRow[]>(
    `SELECT id, guild_id, mysql_host, mysql_port, mysql_database,
            mysql_user, mysql_password, server_name, sync_interval_minutes
     FROM bridge_configs
     WHERE enabled = TRUE`,
  )
  // pg returns { rows: [...] }
  return (result as unknown as { rows: BridgeConfigRow[] }).rows
}

/** Update sync status after a run (success or error). */
async function updateSyncStatus(
  guildId: bigint,
  status:  "ok" | "error",
  message: string,
): Promise<void> {
  await pool.query(
    `UPDATE bridge_configs
     SET last_sync_at      = NOW(),
         last_sync_status  = $1,
         last_sync_message = $2
     WHERE guild_id = $3`,
    [status, message, guildId],
  )
}

/** Run a full sync across all enabled guilds. */
export async function runSync(): Promise<void> {
  await ensureTable()

  const configs = await loadEnabledConfigs()

  if (configs.length === 0) {
    console.log("[bridge] No enabled bridge configs found — nothing to sync")
    return
  }

  console.log(`[bridge] Syncing ${configs.length} guild(s)...`)

  for (const cfg of configs) {
    const label = `[bridge][guild=${cfg.guild_id}][server="${cfg.server_name}"]`

    let players
    try {
      players = await fetchPlayersForGuild({
        host:     cfg.mysql_host,
        port:     cfg.mysql_port,
        database: cfg.mysql_database,
        user:     cfg.mysql_user,
        password: cfg.mysql_password,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`${label} MySQL error: ${msg}`)
      await updateSyncStatus(cfg.guild_id, "error", `MySQL connection failed: ${msg}`)
      continue
    }

    console.log(`${label} Fetched ${players.length} player(s)`)

    if (players.length === 0) {
      await updateSyncStatus(cfg.guild_id, "ok", "Connected — DBLog_Players is empty")
      continue
    }

    try {
      let totalUpserted = 0
      let totalLinked   = 0
      const BATCH = config.BATCH_SIZE

      for (let i = 0; i < players.length; i += BATCH) {
        const batch = players.slice(i, i + BATCH).map((p) => ({
          steamId:  p.steamID,
          lastName: p.lastName,
        }))
        const { upserted, linked } = await upsertPlayers(cfg.guild_id, cfg.server_name, batch)
        totalUpserted += upserted
        totalLinked   += linked
      }

      const summary = `Synced ${players.length} player(s): ${totalUpserted} upserted, ${totalLinked} linked to Discord`
      console.log(`${label} ${summary}`)
      await updateSyncStatus(cfg.guild_id, "ok", summary)
      await logSyncRun(cfg.guild_id, summary)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`${label} PG write error: ${msg}`)
      await updateSyncStatus(cfg.guild_id, "error", `Sync write failed: ${msg}`)
    }
  }
}
