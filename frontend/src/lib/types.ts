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
  url: string;
  is_manual?: boolean;
}

export interface WhitelistCategory {
  id: number;
  whitelist_id: number;
  name: string;
  slot_limit: number | null;
  sort_order: number;
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
  duplicate_output_dedupe: string;
}

export interface WhitelistUser {
  discord_id: string;
  discord_name: string;
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
  daily_submissions: { day: string; date: string; count: number }[];
  orphan_count: number;
}

export interface HealthAlert {
  level: "warning" | "info" | "error";
  message: string;
}

export interface HealthStatus {
  alerts: HealthAlert[];
}
