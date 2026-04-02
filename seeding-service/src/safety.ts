/**
 * Safety checks for seeding rewards.
 *
 * Ensures the reward group only has safe permissions (e.g. reserve)
 * and never grants admin-level access like ban, kick, or changemap.
 */

import type pg from "pg"

/** Permissions that are safe to auto-grant via seeding rewards. */
const SAFE_PERMISSIONS = new Set([
  "reserve",
  "balance",
  "teamchange",
])

/** Permissions that must NEVER be auto-granted. */
const DANGEROUS_PERMISSIONS = new Set([
  "ban",
  "kick",
  "immune",
  "changemap",
  "config",
  "cameraman",
  "canseeadminchat",
  "manageserver",
  "cheat",
  "private",
  "forceteamchange",
])

export interface SafetyResult {
  safe: boolean
  reason?: string
}

/**
 * Validate that a Squad group only contains safe permissions.
 * Returns { safe: true } if OK, or { safe: false, reason } if dangerous.
 */
export async function validateRewardGroup(
  pool: pg.Pool,
  guildId: bigint,
  groupName: string,
): Promise<SafetyResult> {
  const result = await pool.query<{ permissions: string }>(
    `SELECT permissions FROM squad_groups
     WHERE guild_id = $1 AND group_name = $2`,
    [guildId, groupName],
  )

  if (result.rows.length === 0) {
    return { safe: false, reason: `Group "${groupName}" not found` }
  }

  const perms = result.rows[0].permissions
    .split(",")
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean)

  const dangerousFound = perms.filter((p) => DANGEROUS_PERMISSIONS.has(p))
  if (dangerousFound.length > 0) {
    return {
      safe: false,
      reason: `Group has dangerous permissions that cannot be auto-granted: ${dangerousFound.join(", ")}`,
    }
  }

  const unknownPerms = perms.filter((p) => !SAFE_PERMISSIONS.has(p))
  if (unknownPerms.length > 0) {
    return {
      safe: false,
      reason: `Group has non-safe permissions: ${unknownPerms.join(", ")}. Only ${[...SAFE_PERMISSIONS].join(", ")} are allowed for seeding rewards.`,
    }
  }

  return { safe: true }
}
