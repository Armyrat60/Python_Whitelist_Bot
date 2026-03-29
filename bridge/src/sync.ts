/**
 * Core sync logic: read players from SquadJS MySQL, write to whitelister PG.
 */

import { fetchAllPlayers } from "./mysql.js"
import { ensureTable, upsertPlayers, logSyncRun } from "./db.js"
import { config } from "./config.js"

export async function runSync(): Promise<void> {
  const guildId = BigInt(config.GUILD_ID)
  const label = `[bridge][guild=${config.GUILD_ID}][server="${config.SERVER_NAME}"]`

  console.log(`${label} Starting sync...`)

  await ensureTable()

  let players
  try {
    players = await fetchAllPlayers()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`${label} Failed to read from SquadJS MySQL: ${msg}`)
    throw err
  }

  console.log(`${label} Fetched ${players.length} player(s) from DBLog_Players`)

  if (players.length === 0) {
    await logSyncRun(guildId, `No players in DBLog_Players — nothing to sync`)
    return
  }

  // Process in batches to keep memory usage bounded on large servers
  const BATCH = config.BATCH_SIZE
  let totalUpserted = 0
  let totalLinked = 0

  for (let i = 0; i < players.length; i += BATCH) {
    const batch = players.slice(i, i + BATCH).map((p) => ({
      steamId: p.steamID,
      lastName: p.lastName,
    }))
    const { upserted, linked } = await upsertPlayers(guildId, config.SERVER_NAME, batch)
    totalUpserted += upserted
    totalLinked += linked
  }

  const summary = `Synced ${players.length} player(s): ${totalUpserted} upserted, ${totalLinked} linked to Discord`
  console.log(`${label} ${summary}`)
  await logSyncRun(guildId, summary)
}
