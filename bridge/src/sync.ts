/**
 * Core sync logic.
 *
 * On each cron tick (`runSync`):
 *   1. Enqueue a bridge_sync job for every enabled guild that isn't already queued
 *   2. Claim up to CONCURRENCY pending jobs and process them in parallel
 *
 * Job lifecycle: pending → running → done | failed
 * Manual syncs (POST /sync-now) enqueue with higher priority (10 vs 0).
 */

import {
  pool,
  ensureTable,
  upsertPlayers,
  logSyncRun,
  claimPendingJobs,
  completeJob,
  failJob,
  enqueueIfIdle,
} from "./db.js"
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
  last_sync_at:          Date | null
}

/** Fetch all enabled guild bridge configs from the DB. */
async function loadEnabledConfigs(): Promise<BridgeConfigRow[]> {
  const result = await pool.query<BridgeConfigRow>(
    `SELECT id, guild_id, mysql_host, mysql_port, mysql_database,
            mysql_user, mysql_password, server_name, sync_interval_minutes,
            last_sync_at
     FROM bridge_configs
     WHERE enabled = TRUE`,
  )
  return result.rows
}

/** Update last_sync_at / status / message on the bridge_configs row. */
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

/** Run the actual MySQL → PostgreSQL sync for one guild.
 *  Uses last_sync_at as a cursor for incremental syncs after the first run.
 *  A 5-minute buffer is applied to avoid missing records updated near the boundary.
 */
async function syncGuild(cfg: BridgeConfigRow): Promise<string> {
  const label = `[bridge][guild=${cfg.guild_id}][server="${cfg.server_name}"]`

  // Incremental: only fetch records updated since last sync (minus 5 min buffer)
  const since = cfg.last_sync_at
    ? new Date(cfg.last_sync_at.getTime() - 5 * 60 * 1000)
    : undefined
  const mode = since ? "incremental" : "full"

  const players = await fetchPlayersForGuild(
    {
      host:     cfg.mysql_host,
      port:     cfg.mysql_port,
      database: cfg.mysql_database,
      user:     cfg.mysql_user,
      password: cfg.mysql_password,
    },
    since,
  )

  console.log(`${label} [${mode}] Fetched ${players.length} player(s)`)

  if (players.length === 0) {
    const msg = since
      ? `Incremental sync — no new records since ${since.toISOString()}`
      : "Connected — DBLog_Players is empty"
    await updateSyncStatus(cfg.guild_id, "ok", msg)
    return msg
  }

  let totalUpserted = 0
  let totalLinked   = 0
  const BATCH = config.BATCH_SIZE

  for (let i = 0; i < players.length; i += BATCH) {
    const batch = players.slice(i, i + BATCH).map((p) => ({
      steamId:  p.steamID,
      eosId:    p.eosID ?? null,
      lastName: p.lastName,
    }))
    const { upserted, linked } = await upsertPlayers(cfg.guild_id, cfg.server_name, batch)
    totalUpserted += upserted
    totalLinked   += linked
  }

  const summary = `[${mode}] ${players.length} player(s): ${totalUpserted} upserted, ${totalLinked} linked to Discord`
  console.log(`${label} ${summary}`)
  await updateSyncStatus(cfg.guild_id, "ok", summary)
  await logSyncRun(cfg.guild_id, summary)
  return summary
}

/** Process a single claimed job. */
async function processJob(job: { id: number; guild_id: bigint }): Promise<void> {
  const configs = await loadEnabledConfigs()
  const cfg = configs.find((c) => c.guild_id === job.guild_id)

  if (!cfg) {
    await failJob(job.id, "Bridge config not found or disabled")
    return
  }

  try {
    const summary = await syncGuild(cfg)
    await completeJob(job.id, { summary })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[bridge][guild=${job.guild_id}] Sync error: ${msg}`)
    await updateSyncStatus(job.guild_id, "error", `Sync failed: ${msg}`)
    await failJob(job.id, msg)
  }
}

/** Main entry point — called by the cron scheduler. */
export async function runSync(): Promise<void> {
  await ensureTable()

  // 1. Enqueue a job for each enabled guild that isn't already queued
  const configs = await loadEnabledConfigs()

  if (configs.length === 0) {
    console.log("[bridge] No enabled bridge configs found — nothing to sync")
  } else {
    console.log(`[bridge] Enqueueing ${configs.length} guild(s) for sync...`)
    for (const cfg of configs) {
      await enqueueIfIdle(cfg.guild_id)
    }
  }

  // 2. Claim and process pending jobs (up to CONCURRENCY at once)
  const jobs = await claimPendingJobs(config.CONCURRENCY)

  if (jobs.length === 0) {
    console.log("[bridge] No pending jobs to process")
    return
  }

  console.log(`[bridge] Processing ${jobs.length} job(s) concurrently (max=${config.CONCURRENCY})`)

  await Promise.all(jobs.map(processJob))

  console.log(`[bridge] Done — processed ${jobs.length} job(s)`)
}
