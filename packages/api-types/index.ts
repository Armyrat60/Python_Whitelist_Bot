/**
 * Shared TypeScript interfaces for all admin API response shapes.
 * These match exactly what the API routes return.
 */

// ─── Panels ───────────────────────────────────────────────────────────────────

export interface PanelResponse {
  id: number
  name: string
  channel_id: string | null
  log_channel_id: string | null
  whitelist_id: number | null
  panel_message_id: string | null
  is_default: boolean
  enabled: boolean
  tier_category_id: number | null
  show_role_mentions: boolean
}

export interface PanelsListResponse {
  panels: PanelResponse[]
}

export interface PanelCreateResponse {
  ok: true
  id: number
  name: string
}

export interface PanelUpdateResponse {
  ok: true
  panel_id: number
}

export interface PanelPushResponse {
  ok: true
  queued: true
}

// ─── Whitelists ───────────────────────────────────────────────────────────────

export interface WhitelistUrlResponse {
  slug: string
  name: string
  filename: string
  url: string
  enabled: boolean
}

export interface WhitelistUrlsListResponse {
  urls: WhitelistUrlResponse[]
}

export interface WhitelistCreateResponse {
  ok: true
  id: number
  slug: string
  name: string
}

export interface WhitelistUpdateResponse {
  ok: true
  id: number
  updated: string[]
}

export interface WhitelistToggleResponse {
  ok: true
  type: string
  enabled: boolean
}

export interface WhitelistDeleteResponse {
  ok: true
  deleted: string
}

export interface WhitelistTypeUpdateResponse {
  ok: true
  type: string
  updated: string[]
}

// ─── Tiers ────────────────────────────────────────────────────────────────────

export interface TierEntryResponse {
  id: number
  role_id: string
  role_name: string
  slot_limit: number
  display_name: string | null
  sort_order: number
  is_active: boolean
  is_stackable: boolean
}

export interface TierCategoryResponse {
  id: number
  name: string
  description: string | null
  is_default: boolean
  entries: TierEntryResponse[]
}

export interface TierCategoriesListResponse {
  categories: TierCategoryResponse[]
}

export interface TierCategoryCreateResponse {
  ok: true
  id: number
  name: string
}

export interface TierCategoryUpdateResponse {
  ok: true
  category_id: number
}

export interface TierEntryCreateResponse {
  ok: true
  id: number
  role_id: string
  role_name: string
  slot_limit: number
  display_name: string | null
  sort_order: number
  is_stackable: boolean
}

export interface TierEntryUpdateResponse {
  ok: true
  entry_id: number
}

// ─── Users ────────────────────────────────────────────────────────────────────

export interface UserResponse {
  discord_id: string
  discord_name: string
  whitelist_slug: string
  whitelist_name: string
  status: string
  slot_limit_override: number | null
  effective_slot_limit: number
  last_plan_name: string | null
  created_at: string | Date
  updated_at: string | Date
  expires_at: string | Date | null
  created_via: string | null
  notes: string | null
  steam_ids: string[]
  eos_ids: string[]
}

export interface UsersListResponse {
  users: UserResponse[]
  total: number
  page: number
  per_page: number
  pages: number
}

export interface UserCreateResponse {
  ok: true
  discord_id: string
  discord_name: string
}

export interface UserUpdateResponse {
  ok: true
}

export interface UserBulkDeleteResponse {
  ok: true
  deleted: number
}

export interface UserBulkMoveResponse {
  ok: true
  moved: number
  skipped: number
}

// ─── Notifications ────────────────────────────────────────────────────────────

export interface EventTypeInfo {
  label: string
  description: string
}

export interface NotificationsConfigResponse {
  routing: Record<string, string>
  event_types: Record<string, EventTypeInfo>
}

export interface NotificationsSaveResponse {
  ok: true
}

// ─── Role Sync / Role Stats ───────────────────────────────────────────────────

export interface RoleStat {
  role_id: string
  role_name: string
  discord_count: number
  registered_count: number
  unregistered_count: number
}

export interface RoleStatsResponse {
  stats: RoleStat[]
  gateway_mode: boolean
}

export interface RoleSyncPullResponse {
  ok: true
  added: number
  already_exists: number
  dry_run: boolean
}

export interface GapMember {
  discord_id: string
  username: string
  display_name: string
  whitelisted_roles: string[]
}

export interface MembersGapResponse {
  members: GapMember[]
  total: number
}

export interface VerifyRolesIssue {
  type: string
  role_id: string
  role_name: string
  source: string
}

export interface VerifyRolesResponse {
  ok: boolean
  issues: VerifyRolesIssue[]
}

export interface BackfillResponse {
  ok: true
  updated: number
}

// ─── Settings ─────────────────────────────────────────────────────────────────

export interface RoleMappingResponse {
  id: number
  role_id: string
  role_name: string
  slot_limit: number
  is_active: boolean
}

export interface TierCategorySettingsEntry {
  id: number
  role_id: string
  role_name: string
  slot_limit: number
  display_name: string | null
  sort_order: number
  is_active: boolean
  is_stackable: boolean
}

export interface TierCategorySettings {
  id: number
  name: string
  description: string | null
  is_default: boolean
  entries: TierCategorySettingsEntry[]
}

export interface WhitelistTypeConfig {
  id: number
  name: string
  slug: string
  enabled: boolean
  squad_group: string
  output_filename: string
  default_slot_limit: number
  stack_roles: boolean
  is_default: boolean
  url: string
}

export interface SettingsResponse {
  bot_settings: Record<string, string | null>
  type_configs: Record<string, WhitelistTypeConfig>
  role_mappings: Record<string, RoleMappingResponse[]>
  squad_groups: string[]
  squad_permissions: unknown[]
  tier_categories: TierCategorySettings[]
}

export interface SettingsUpdateResponse {
  ok: true
  updated: string[]
}

export interface ChannelResponse {
  id: string
  name: string
}

export interface ChannelsListResponse {
  channels: ChannelResponse[]
}

export interface RoleResponse {
  id: string
  name: string
}

export interface RolesListResponse {
  roles: RoleResponse[]
}

export interface RoleMappingAddResponse {
  ok: true
  id: number
}
