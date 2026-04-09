-- ============================================================================
-- BASELINE MIGRATION
-- ----------------------------------------------------------------------------
-- Generated from schema.prisma via `prisma migrate diff --from-empty`, then
-- hand-edited so every CREATE TABLE / CREATE INDEX / FK ADD is idempotent
-- (IF NOT EXISTS / pg_constraint guards). This file represents the FULL
-- schema as of the consolidation cutover.
--
-- On a fresh database: this file creates everything.
-- On the existing production database: this file is marked as already-applied
--   via `prisma migrate resolve --applied 20260101000000_baseline` and is
--   never executed against prod. The IF NOT EXISTS / guard wrappers exist as
--   a safety net in case someone forgets the resolve step on a populated DB.
-- ============================================================================

-- CreateTable
CREATE TABLE IF NOT EXISTS "bot_settings" (
    "guild_id" BIGINT NOT NULL,
    "setting_key" VARCHAR(100) NOT NULL,
    "setting_value" TEXT NOT NULL,

    CONSTRAINT "bot_settings_pkey" PRIMARY KEY ("guild_id","setting_key")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "whitelists" (
    "id" SERIAL NOT NULL,
    "guild_id" BIGINT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "slug" VARCHAR(50) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "panel_channel_id" BIGINT,
    "panel_message_id" BIGINT,
    "log_channel_id" BIGINT,
    "squad_group" VARCHAR(100) NOT NULL DEFAULT 'Whitelist',
    "output_filename" VARCHAR(255) NOT NULL DEFAULT 'whitelist.txt',
    "default_slot_limit" INTEGER NOT NULL DEFAULT 1,
    "stack_roles" BOOLEAN NOT NULL DEFAULT false,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_manual" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whitelists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "whitelist_categories" (
    "id" SERIAL NOT NULL,
    "guild_id" BIGINT NOT NULL,
    "whitelist_id" INTEGER NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "slot_limit" INTEGER,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "squad_group" VARCHAR(100),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whitelist_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "category_managers" (
    "id" SERIAL NOT NULL,
    "category_id" INTEGER NOT NULL,
    "discord_id" BIGINT NOT NULL,
    "discord_name" VARCHAR(255) NOT NULL,
    "added_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "category_managers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "panel_roles" (
    "id" SERIAL NOT NULL,
    "guild_id" BIGINT NOT NULL,
    "panel_id" INTEGER NOT NULL,
    "role_id" BIGINT NOT NULL,
    "role_name" VARCHAR(100) NOT NULL,
    "slot_limit" INTEGER NOT NULL DEFAULT 1,
    "is_stackable" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "display_name" VARCHAR(100),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "panel_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "whitelist_users" (
    "guild_id" BIGINT NOT NULL DEFAULT 0,
    "discord_id" BIGINT NOT NULL,
    "whitelist_type" VARCHAR(20),
    "whitelist_id" INTEGER NOT NULL,
    "discord_name" VARCHAR(255) NOT NULL,
    "status" VARCHAR(50) NOT NULL DEFAULT 'active',
    "slot_limit_override" INTEGER,
    "effective_slot_limit" INTEGER NOT NULL DEFAULT 0,
    "last_plan_name" VARCHAR(255),
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3),
    "created_via" VARCHAR(50),
    "notes" VARCHAR(500),
    "category_id" INTEGER,
    "discord_username" VARCHAR(255),
    "discord_nick" VARCHAR(255),
    "clan_tag" VARCHAR(50),

    CONSTRAINT "whitelist_users_pkey" PRIMARY KEY ("guild_id","discord_id","whitelist_id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "whitelist_identifiers" (
    "id" SERIAL NOT NULL,
    "guild_id" BIGINT NOT NULL DEFAULT 0,
    "discord_id" BIGINT NOT NULL,
    "whitelist_type" VARCHAR(20),
    "whitelist_id" INTEGER,
    "id_type" VARCHAR(20) NOT NULL,
    "id_value" VARCHAR(255) NOT NULL,
    "is_verified" BOOLEAN NOT NULL DEFAULT false,
    "verification_source" VARCHAR(100),
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whitelist_identifiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "audit_log" (
    "id" SERIAL NOT NULL,
    "guild_id" BIGINT NOT NULL DEFAULT 0,
    "whitelist_type" VARCHAR(20),
    "whitelist_id" INTEGER,
    "action_type" VARCHAR(100) NOT NULL,
    "actor_discord_id" BIGINT,
    "target_discord_id" BIGINT,
    "details" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "squad_permissions" (
    "permission" VARCHAR(50) NOT NULL,
    "description" VARCHAR(255) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "squad_permissions_pkey" PRIMARY KEY ("permission")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "squad_groups" (
    "guild_id" BIGINT NOT NULL DEFAULT 0,
    "group_name" VARCHAR(100) NOT NULL,
    "permissions" TEXT NOT NULL,
    "description" VARCHAR(255) NOT NULL DEFAULT '',
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "squad_groups_pkey" PRIMARY KEY ("guild_id","group_name")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "panels" (
    "id" SERIAL NOT NULL,
    "guild_id" BIGINT NOT NULL DEFAULT 0,
    "name" VARCHAR(100) NOT NULL,
    "channel_id" BIGINT,
    "log_channel_id" BIGINT,
    "whitelist_id" INTEGER,
    "panel_message_id" BIGINT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "show_role_mentions" BOOLEAN NOT NULL DEFAULT true,
    "last_push_status" VARCHAR(20),
    "last_push_error" TEXT,
    "last_push_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "panels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "panel_refresh_queue" (
    "id" SERIAL NOT NULL,
    "guild_id" BIGINT NOT NULL,
    "panel_id" INTEGER NOT NULL,
    "reason" VARCHAR(200) NOT NULL DEFAULT 'settings_changed',
    "action" VARCHAR(20) NOT NULL DEFAULT 'refresh',
    "channel_id" BIGINT,
    "message_id" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "panel_refresh_queue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "notification_routing" (
    "guild_id" BIGINT NOT NULL DEFAULT 0,
    "event_type" VARCHAR(50) NOT NULL,
    "channel_id" VARCHAR(20) NOT NULL DEFAULT '',

    CONSTRAINT "notification_routing_pkey" PRIMARY KEY ("guild_id","event_type")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "dashboard_permissions" (
    "id" SERIAL NOT NULL,
    "guild_id" BIGINT NOT NULL,
    "discord_id" VARCHAR(32) NOT NULL,
    "discord_name" VARCHAR(100),
    "permission_level" VARCHAR(20) NOT NULL DEFAULT 'viewer',
    "granted_by" VARCHAR(32),
    "granted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dashboard_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "dashboard_role_permissions" (
    "id" SERIAL NOT NULL,
    "guild_id" BIGINT NOT NULL,
    "role_id" VARCHAR(32) NOT NULL,
    "role_name" VARCHAR(100),
    "permission_level" VARCHAR(20) NOT NULL DEFAULT 'viewer',
    "granted_by" VARCHAR(32),
    "granted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dashboard_role_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "steam_name_cache" (
    "steam_id" VARCHAR(20) NOT NULL,
    "persona_name" VARCHAR(255) NOT NULL,
    "cached_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "steam_name_cache_pkey" PRIMARY KEY ("steam_id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "bridge_configs" (
    "id" SERIAL NOT NULL,
    "guild_id" BIGINT NOT NULL,
    "mysql_host" VARCHAR(255) NOT NULL,
    "mysql_port" INTEGER NOT NULL DEFAULT 3306,
    "mysql_database" VARCHAR(255) NOT NULL,
    "mysql_user" VARCHAR(255) NOT NULL,
    "mysql_password" VARCHAR(500) NOT NULL,
    "server_name" VARCHAR(255) NOT NULL DEFAULT 'Game Server',
    "sync_interval_minutes" INTEGER NOT NULL DEFAULT 15,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "last_sync_at" TIMESTAMP(3),
    "last_sync_status" VARCHAR(20),
    "last_sync_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bridge_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "job_queue" (
    "id" SERIAL NOT NULL,
    "guild_id" BIGINT NOT NULL,
    "job_type" VARCHAR(50) NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "result" JSONB,
    "error" TEXT,

    CONSTRAINT "job_queue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "squad_players" (
    "id" SERIAL NOT NULL,
    "guild_id" BIGINT NOT NULL,
    "steam_id" VARCHAR(32) NOT NULL,
    "last_seen_name" VARCHAR(255),
    "server_name" VARCHAR(255),
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "discord_id" BIGINT,

    CONSTRAINT "squad_players_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "seeding_configs" (
    "id" SERIAL NOT NULL,
    "guild_id" BIGINT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "squadjs_host" VARCHAR(255) NOT NULL DEFAULT '',
    "squadjs_port" INTEGER NOT NULL DEFAULT 3000,
    "squadjs_token" VARCHAR(500) NOT NULL DEFAULT '',
    "seeding_start_player_count" INTEGER NOT NULL DEFAULT 2,
    "seeding_player_threshold" INTEGER NOT NULL DEFAULT 50,
    "points_required" INTEGER NOT NULL DEFAULT 120,
    "reward_whitelist_id" INTEGER,
    "reward_group_name" VARCHAR(100) NOT NULL DEFAULT 'Reserve',
    "reward_duration_hours" INTEGER NOT NULL DEFAULT 168,
    "tracking_mode" VARCHAR(20) NOT NULL DEFAULT 'fixed_reset',
    "reset_cron" VARCHAR(50) NOT NULL DEFAULT '0 0 * * *',
    "poll_interval_seconds" INTEGER NOT NULL DEFAULT 60,
    "seeding_window_enabled" BOOLEAN NOT NULL DEFAULT false,
    "seeding_window_start" VARCHAR(5) NOT NULL DEFAULT '07:00',
    "seeding_window_end" VARCHAR(5) NOT NULL DEFAULT '22:00',
    "last_poll_at" TIMESTAMP(3),
    "last_poll_status" VARCHAR(20),
    "last_poll_message" TEXT,
    "reward_tiers" JSONB,
    "rcon_warnings_enabled" BOOLEAN NOT NULL DEFAULT false,
    "rcon_warning_message" TEXT NOT NULL DEFAULT 'Seeding Progress: {progress}% ({points}/{required}). Keep seeding!',
    "decay_days_threshold" INTEGER NOT NULL DEFAULT 3,
    "decay_points_per_day" INTEGER NOT NULL DEFAULT 10,
    "discord_role_reward_enabled" BOOLEAN NOT NULL DEFAULT false,
    "discord_role_reward_id" VARCHAR(32),
    "discord_remove_role_on_expiry" BOOLEAN NOT NULL DEFAULT false,
    "auto_seed_alert_enabled" BOOLEAN NOT NULL DEFAULT false,
    "auto_seed_alert_role_id" VARCHAR(32),
    "auto_seed_alert_cooldown_min" INTEGER NOT NULL DEFAULT 30,
    "discord_notify_channel_id" VARCHAR(32),
    "rcon_broadcast_enabled" BOOLEAN NOT NULL DEFAULT false,
    "rcon_broadcast_message" TEXT NOT NULL DEFAULT 'This server is in seeding mode! Earn whitelist rewards by staying online.',
    "rcon_broadcast_interval_min" INTEGER NOT NULL DEFAULT 10,
    "reward_cooldown_hours" INTEGER NOT NULL DEFAULT 0,
    "require_discord_link" BOOLEAN NOT NULL DEFAULT false,
    "streak_enabled" BOOLEAN NOT NULL DEFAULT false,
    "streak_days_required" INTEGER NOT NULL DEFAULT 3,
    "streak_multiplier" DOUBLE PRECISION NOT NULL DEFAULT 1.5,
    "bonus_multiplier_enabled" BOOLEAN NOT NULL DEFAULT false,
    "bonus_multiplier_value" DOUBLE PRECISION NOT NULL DEFAULT 2.0,
    "bonus_multiplier_start" TIMESTAMP(3),
    "bonus_multiplier_end" TIMESTAMP(3),
    "custom_embed_title" VARCHAR(255),
    "custom_embed_description" TEXT,
    "custom_embed_image_url" VARCHAR(500),
    "custom_embed_color" VARCHAR(7),
    "population_tracking_enabled" BOOLEAN NOT NULL DEFAULT false,
    "webhook_url" VARCHAR(500),
    "webhook_enabled" BOOLEAN NOT NULL DEFAULT false,
    "points_per_server" BOOLEAN NOT NULL DEFAULT false,
    "leaderboard_public" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "seeding_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "seeding_servers" (
    "id" SERIAL NOT NULL,
    "guild_id" BIGINT NOT NULL,
    "server_name" VARCHAR(255) NOT NULL,
    "squadjs_host" VARCHAR(255) NOT NULL,
    "squadjs_port" INTEGER NOT NULL DEFAULT 3000,
    "squadjs_token" VARCHAR(500) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "last_poll_at" TIMESTAMP(3),
    "last_poll_status" VARCHAR(20),
    "last_poll_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "seeding_servers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "seeding_notifications" (
    "id" SERIAL NOT NULL,
    "guild_id" BIGINT NOT NULL,
    "event_type" VARCHAR(50) NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "seeding_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "population_snapshots" (
    "id" SERIAL NOT NULL,
    "guild_id" BIGINT NOT NULL,
    "player_count" INTEGER NOT NULL,
    "is_seeding" BOOLEAN NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "population_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "seeding_points" (
    "id" SERIAL NOT NULL,
    "guild_id" BIGINT NOT NULL,
    "server_id" INTEGER,
    "steam_id" VARCHAR(32) NOT NULL,
    "player_name" VARCHAR(255),
    "points" INTEGER NOT NULL DEFAULT 0,
    "last_award_at" TIMESTAMP(3),
    "last_reset_at" TIMESTAMP(3),
    "rewarded" BOOLEAN NOT NULL DEFAULT false,
    "rewarded_at" TIMESTAMP(3),
    "current_streak" INTEGER NOT NULL DEFAULT 0,
    "last_seed_date" VARCHAR(10),

    CONSTRAINT "seeding_points_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "seeding_sessions" (
    "id" SERIAL NOT NULL,
    "guild_id" BIGINT NOT NULL,
    "steam_id" VARCHAR(32) NOT NULL,
    "player_name" VARCHAR(255),
    "started_at" TIMESTAMP(3) NOT NULL,
    "ended_at" TIMESTAMP(3),
    "points_earned" INTEGER NOT NULL DEFAULT 0,
    "player_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "seeding_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "whitelists_guild_id_slug_key" ON "whitelists"("guild_id", "slug");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "whitelist_categories_whitelist_id_name_key" ON "whitelist_categories"("whitelist_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "category_managers_category_id_discord_id_key" ON "category_managers"("category_id", "discord_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "panel_roles_guild_id_panel_id_role_id_key" ON "panel_roles"("guild_id", "panel_id", "role_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_wu_guild_wl" ON "whitelist_users"("guild_id", "whitelist_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_wu_status" ON "whitelist_users"("guild_id", "whitelist_id", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_wi_guild_wl" ON "whitelist_identifiers"("guild_id", "whitelist_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "whitelist_identifiers_guild_id_discord_id_whitelist_id_id_t_key" ON "whitelist_identifiers"("guild_id", "discord_id", "whitelist_id", "id_type", "id_value");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "audit_log_guild_id_created_at_idx" ON "audit_log"("guild_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "dashboard_permissions_guild_id_idx" ON "dashboard_permissions"("guild_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "dashboard_permissions_guild_id_discord_id_key" ON "dashboard_permissions"("guild_id", "discord_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "dashboard_role_permissions_guild_id_idx" ON "dashboard_role_permissions"("guild_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "dashboard_role_permissions_guild_id_role_id_key" ON "dashboard_role_permissions"("guild_id", "role_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "bridge_configs_guild_id_key" ON "bridge_configs"("guild_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "job_queue_guild_id_status_idx" ON "job_queue"("guild_id", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "job_queue_status_priority_created_at_idx" ON "job_queue"("status", "priority", "created_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_squad_players_guild" ON "squad_players"("guild_id");

-- CreateIndex
-- Partial index: matches what exists in production (added by bot's POSTGRES_MIGRATIONS).
-- Prisma cannot express partial indexes in schema.prisma, so we hand-write it here.
CREATE INDEX IF NOT EXISTS "idx_squad_players_discord" ON "squad_players"("discord_id") WHERE "discord_id" IS NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "squad_players_guild_id_steam_id_key" ON "squad_players"("guild_id", "steam_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "seeding_configs_guild_id_key" ON "seeding_configs"("guild_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "seeding_servers_guild_id_idx" ON "seeding_servers"("guild_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "seeding_servers_guild_id_server_name_key" ON "seeding_servers"("guild_id", "server_name");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "seeding_notifications_guild_id_processed_created_at_idx" ON "seeding_notifications"("guild_id", "processed", "created_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "population_snapshots_guild_id_created_at_idx" ON "population_snapshots"("guild_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "seeding_points_guild_id_points_idx" ON "seeding_points"("guild_id", "points" DESC);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "seeding_points_guild_id_server_id_steam_id_key" ON "seeding_points"("guild_id", "server_id", "steam_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "seeding_sessions_guild_id_started_at_idx" ON "seeding_sessions"("guild_id", "started_at" DESC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "seeding_sessions_guild_id_steam_id_idx" ON "seeding_sessions"("guild_id", "steam_id");

-- AddForeignKey (idempotent: each FK is added only if its constraint name doesn't already exist)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'whitelist_categories_whitelist_id_fkey') THEN
    ALTER TABLE "whitelist_categories" ADD CONSTRAINT "whitelist_categories_whitelist_id_fkey" FOREIGN KEY ("whitelist_id") REFERENCES "whitelists"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'category_managers_category_id_fkey') THEN
    ALTER TABLE "category_managers" ADD CONSTRAINT "category_managers_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "whitelist_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'panel_roles_panel_id_fkey') THEN
    ALTER TABLE "panel_roles" ADD CONSTRAINT "panel_roles_panel_id_fkey" FOREIGN KEY ("panel_id") REFERENCES "panels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'whitelist_users_category_id_fkey') THEN
    ALTER TABLE "whitelist_users" ADD CONSTRAINT "whitelist_users_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "whitelist_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'whitelist_users_whitelist_id_fkey') THEN
    ALTER TABLE "whitelist_users" ADD CONSTRAINT "whitelist_users_whitelist_id_fkey" FOREIGN KEY ("whitelist_id") REFERENCES "whitelists"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'whitelist_identifiers_whitelist_id_fkey') THEN
    ALTER TABLE "whitelist_identifiers" ADD CONSTRAINT "whitelist_identifiers_whitelist_id_fkey" FOREIGN KEY ("whitelist_id") REFERENCES "whitelists"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'panels_whitelist_id_fkey') THEN
    ALTER TABLE "panels" ADD CONSTRAINT "panels_whitelist_id_fkey" FOREIGN KEY ("whitelist_id") REFERENCES "whitelists"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'seeding_servers_guild_id_fkey') THEN
    ALTER TABLE "seeding_servers" ADD CONSTRAINT "seeding_servers_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "seeding_configs"("guild_id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

