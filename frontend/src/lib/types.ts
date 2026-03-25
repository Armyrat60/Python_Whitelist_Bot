export interface Guild {
  id: string;
  name: string;
  icon: string | null;
  is_mod: boolean;
  mod_reason?: string;
}

export interface Session {
  logged_in: boolean;
  discord_id: string;
  username: string;
  avatar: string;
  guilds: Guild[];
  active_guild_id: string;
  is_mod: boolean;
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
}

export interface Panel {
  id: number;
  name: string;
  channel_id: string | null;
  log_channel_id: string | null;
  whitelist_id: number | null;
  tier_category_id: number | null;
  panel_message_id: string | null;
  is_default: boolean;
}

export interface TierCategory {
  id: number;
  name: string;
  description: string;
  is_default: boolean;
  entries: TierEntry[];
}

export interface TierEntry {
  id: number;
  role_id: string;
  role_name: string;
  slot_limit: number;
  display_name: string | null;
  sort_order: number;
  is_active: boolean;
}

export interface RoleMapping {
  id: number;
  role_id: string;
  role_name: string;
  slot_limit: number;
  is_active: boolean;
}

export interface SquadGroup {
  group_name: string;
  permissions: string;
  is_default: boolean;
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
}

export interface WhitelistUser {
  discord_id: string;
  discord_name: string;
  whitelist_slug: string;
  whitelist_name: string;
  status: string;
  effective_slot_limit: number;
  last_plan_name: string | null;
  steam_ids: string[];
  eos_ids: string[];
  updated_at: string;
  created_at: string;
}

export interface AuditEntry {
  id: number;
  action_type: string;
  actor_discord_id: string | null;
  target_discord_id: string | null;
  whitelist_name: string | null;
  details: string | null;
  created_at: string;
}

export interface Stats {
  total_active_users: number;
  total_identifiers: number;
  recent_audit_count: number;
  per_type: Record<string, { active_users: number; total_ids: number }>;
}

export interface HealthAlert {
  level: "warning" | "info" | "error";
  message: string;
}

export interface HealthStatus {
  alerts: HealthAlert[];
}
