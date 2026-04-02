export type PermissionLevel = "owner" | "admin" | "roster_manager" | "viewer";

export interface Guild {
  id: string;
  name: string;
  icon: string | null;
  is_mod: boolean;
  mod_reason?: string;
  permissionLevel?: PermissionLevel;
}

export interface Session {
  logged_in: boolean;
  discord_id: string;
  username: string;
  avatar: string;
  guilds: Guild[];
  active_guild_id: string;
  is_mod: boolean;
  permission_level: PermissionLevel | null;
}

export interface DashboardPermission {
  id: number;
  discord_id: string;
  discord_name: string | null;
  permission_level: PermissionLevel;
  granted_by: string | null;
  granted_at: string;
}

export interface DashboardRolePermission {
  id: number;
  role_id: string;
  role_name: string | null;
  permission_level: PermissionLevel;
  granted_by: string | null;
  granted_at: string;
}

export interface Whitelist {
  id: number;
  slug: string;
  name: string;
  enabled: boolean;
  default_slot_limit: number;
  stack_roles: boolean;
  squad_group: string;
  output_filename: string;
  is_default: boolean;
  url: string;
  is_manual?: boolean;
}

export interface WhitelistCategory {
  id: number;
  whitelist_id: number;
  name: string;
  slot_limit: number | null;
  sort_order: number;
  squad_group: string | null;
  created_at: string;
  updated_at: string;
  manager_count: number;
  user_count: number;
}

export interface CategoryManager {
  id: number;
  category_id: number;
  discord_id: string;
  discord_name: string;
  added_at: string;
}

export interface Panel {
  id: number;
  name: string;
  channel_id: string | null;
  log_channel_id: string | null;
  whitelist_id: number | null;
  panel_message_id: string | null;
  is_default: boolean;
  enabled: boolean;
  show_role_mentions: boolean;
  last_push_status: "ok" | "error" | null;
  last_push_error: string | null;
  last_push_at: string | null;
}

export interface PanelRole {
  id: number;
  role_id: string;
  role_name: string;
  slot_limit: number;
  is_stackable: boolean;
  is_active: boolean;
  display_name: string | null;
  sort_order: number;
}

export interface SquadGroup {
  group_name: string;
  permissions: string;
  is_default: boolean;
  description: string;
}

export interface DiscordRole {
  id: string;
  name: string;
  color: string;
  position: number;
}

export interface DiscordChannel {
  id: string;
  name: string;
  type: number;
  position: number;
}

export interface Settings {
  mod_role_id: string;
  report_frequency: string;
  notification_channel_id: string;
  welcome_dm_enabled: string;
  welcome_dm_text: string;
  auto_reactivate_on_role_return: string;
  allow_global_duplicates: string;
  timezone: string;
  bot_status_message: string;
  retention_days: string;
  role_sync_interval_hours: string;
  duplicate_output_dedupe: string;
}

export interface WhitelistUser {
  discord_id: string;
  discord_name: string;
  discord_username?: string | null;
  discord_nick?: string | null;
  clan_tag?: string | null;
  whitelist_slug: string;
  whitelist_name: string;
  status: string;
  effective_slot_limit: number;
  last_plan_name: string | null;
  notes: string | null;
  expires_at: string | null;
  steam_ids: string[];
  eos_ids: string[];
  updated_at: string;
  created_at: string;
  /** How this user was first added: self_register | role_sync | import | web_dashboard | admin_web | admin | orphan */
  registration_source?: string;
  is_verified?: boolean;
  category_id?: number | null;
  category_name?: string | null;
  created_via?: string | null;
}

export type CategoryEntry = WhitelistUser;

export interface AuditEntry {
  id: number;
  action_type: string;
  actor_discord_id: string | null;
  actor_discord_name: string | null;
  target_discord_id: string | null;
  target_discord_name: string | null;
  whitelist_name: string | null;
  details: string | null;
  created_at: string;
}

export interface Stats {
  total_active_users: number;
  total_identifiers: number;
  recent_audit_count: number;
  per_type: Record<string, { active_users: number; total_ids: number; slots_used: number; capacity: number }>;
  daily_submissions: { day: string; date: string; count: number }[];
  orphan_count: number;
  total_registered: number;
  disabled_role_lost_count: number;
  no_access_count: number;
}

export interface BridgeConfig {
  id: number;
  mysql_host: string;
  mysql_port: number;
  mysql_database: string;
  mysql_user: string;
  mysql_password: string;
  server_name: string;
  sync_interval_minutes: number;
  enabled: boolean;
  last_sync_at: string | null;
  last_sync_status: "ok" | "error" | null;
  last_sync_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface HealthAlert {
  level: "warning" | "info" | "error";
  message: string;
  link?: string;
}

export interface HealthStatus {
  alerts: HealthAlert[];
}

// ── Seeding Module ──────────────────────────────────────────────────────────

export interface SeedingConfig {
  id: number;
  squadjs_host: string;
  squadjs_port: number;
  squadjs_token: string;
  seeding_start_player_count: number;
  seeding_player_threshold: number;
  points_required: number;
  reward_whitelist_id: number | null;
  reward_group_name: string;
  reward_duration_hours: number;
  tracking_mode: "fixed_reset" | "daily_decay";
  reset_cron: string;
  poll_interval_seconds: number;
  seeding_window_enabled: boolean;
  seeding_window_start: string;
  seeding_window_end: string;
  enabled: boolean;
  last_poll_at: string | null;
  last_poll_status: "ok" | "error" | null;
  last_poll_message: string | null;
  reward_tiers: Array<{ points: number; duration_hours: number; label: string }> | null;
  rcon_warnings_enabled: boolean;
  rcon_warning_message: string;
  decay_days_threshold: number;
  decay_points_per_day: number;
  leaderboard_public: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface SeedingPlayer {
  steam_id: string;
  player_name: string | null;
  points: number;
  progress_pct: number;
  rewarded: boolean;
  rewarded_at: string | null;
  last_award_at?: string | null;
}

export interface SeedingPublicPlayer {
  player_name: string | null;
  points: number;
  progress_pct: number;
  rewarded: boolean;
}
