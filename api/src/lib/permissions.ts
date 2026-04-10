/**
 * Granular permission system.
 *
 * Defines permission flags, resolution logic, and helpers for the
 * "Custom" permission level. Owner/admin users bypass this entirely.
 */

// ─── Permission Flags ────────────────────────────────────────────────────────

export const PERMISSION_FLAGS = [
  { key: "view_stats",          label: "View Stats",          group: "Dashboard",  description: "View dashboard stats, health status, and whitelist breakdowns" },
  { key: "view_logs",           label: "View Logs",           group: "Dashboard",  description: "View audit log entries and activity history" },
  { key: "manage_users",        label: "Manage Users",        group: "Content",    description: "Add, edit, and remove whitelist users and identifiers" },
  { key: "manage_whitelists",   label: "Manage Whitelists",   group: "Content",    description: "Create, edit, and delete whitelists and groups" },
  { key: "manage_panels",       label: "Manage Panels",       group: "Content",    description: "Create, edit, and delete panels and access roles" },
  { key: "manage_settings",     label: "Manage Settings",     group: "Content",    description: "Change bot settings, notification routing, and themes" },
  { key: "manage_seeding",      label: "Manage Seeding",      group: "Content",    description: "Configure seeding module, thresholds, and rewards" },
  { key: "manage_permissions",  label: "Manage Permissions",  group: "Content",    description: "Grant and revoke dashboard access for roles and users" },
  { key: "sftp_read",           label: "SFTP Read",           group: "Server",     description: "Read files from game servers via SFTP" },
  { key: "sftp_write",          label: "SFTP Write",          group: "Server",     description: "Write and push files to game servers via SFTP" },
  { key: "rcon_read",           label: "RCON Read",           group: "Server",     description: "View RCON output and server status" },
  { key: "rcon_warn",           label: "RCON Warn",           group: "Server",     description: "Warn players via RCON" },
  { key: "rcon_kick",           label: "RCON Kick",           group: "Server",     description: "Kick players via RCON" },
  { key: "rcon_broadcast",      label: "RCON Broadcast",      group: "Server",     description: "Send server-wide broadcast messages" },
  { key: "rcon_team_change",    label: "RCON Team/Squad",     group: "Server",     description: "Force team change, remove from squad, disband squad" },
  { key: "rcon_demote",         label: "RCON Demote",         group: "Server",     description: "Demote commander via RCON" },
  { key: "rcon_map_change",     label: "RCON Map/Match",      group: "Server",     description: "Change map, set next map, end/restart match" },
  { key: "rcon_execute",        label: "RCON All Commands",   group: "Server",     description: "Legacy: grants all RCON action permissions (warn, kick, broadcast, team, demote, map)" },
  { key: "push_config",         label: "Push Config",         group: "Server",     description: "Push configuration files to game servers" },
] as const

export type PermissionFlag = (typeof PERMISSION_FLAGS)[number]["key"]

export type GranularPermissions = {
  [K in PermissionFlag]?: boolean
}

// ─── Preset Permission Sets ─────────────────────────────────────────────────

/** Owner/admin bypass — every flag is true. */
export const ALL_PERMISSIONS: GranularPermissions = Object.fromEntries(
  PERMISSION_FLAGS.map((f) => [f.key, true]),
)

/** Implicit permissions for legacy roster_manager level. */
export const ROSTER_MANAGER_PERMISSIONS: GranularPermissions = {
  view_stats: true,
  manage_users: true,
  view_logs: true,
}

/** Viewer — no actionable permissions. */
export const VIEWER_PERMISSIONS: GranularPermissions = {
  view_stats: true,
}

// ─── Resolver ───────────────────────────────────────────────────────────────

/**
 * Resolve the effective granular permissions for a user.
 *
 * Rules:
 * - Owner/admin: ALL_PERMISSIONS (bypass)
 * - roster_manager: ROSTER_MANAGER_PERMISSIONS
 * - viewer: VIEWER_PERMISSIONS
 * - granular: union (OR) of all matching role + user grants
 * - Multiple grants: union across all
 */
export function resolvePermissions(
  highestLevel: string,
  grants: Array<{ permissionLevel: string; permissions: GranularPermissions | null }>,
): GranularPermissions {
  if (highestLevel === "owner" || highestLevel === "admin") {
    return { ...ALL_PERMISSIONS }
  }

  const result: GranularPermissions = {}

  for (const grant of grants) {
    if (grant.permissionLevel === "roster_manager") {
      Object.assign(result, ROSTER_MANAGER_PERMISSIONS)
    } else if (grant.permissionLevel === "granular" && grant.permissions) {
      for (const [key, value] of Object.entries(grant.permissions)) {
        if (value === true) {
          (result as Record<string, boolean>)[key] = true
        }
      }
    } else if (grant.permissionLevel === "viewer") {
      // Viewer gets view_stats at minimum
      if (!result.view_stats) result.view_stats = true
    }
  }

  // Legacy: rcon_execute expands into all granular RCON action flags
  if (result.rcon_execute) {
    result.rcon_warn = true
    result.rcon_kick = true
    result.rcon_broadcast = true
    result.rcon_team_change = true
    result.rcon_demote = true
    result.rcon_map_change = true
  }

  return result
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Check if a permissions object has a specific flag set. */
export function hasPermission(
  permissions: GranularPermissions | null | undefined,
  flag: PermissionFlag,
): boolean {
  return permissions?.[flag] === true
}

/** Validate that a permissions object only contains known flags. */
export function validatePermissions(obj: unknown): obj is GranularPermissions {
  if (typeof obj !== "object" || obj === null) return false
  const validKeys = new Set<string>(PERMISSION_FLAGS.map((f) => f.key))
  for (const [key, value] of Object.entries(obj)) {
    if (!validKeys.has(key)) return false
    if (typeof value !== "boolean") return false
  }
  return true
}
