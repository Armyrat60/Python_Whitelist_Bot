-- Role Sync Module: rules, source roles, watch configs, and change logs

-- Role sync rules (source roles → target role mapping)
CREATE TABLE "role_sync_rules" (
    "id" SERIAL NOT NULL,
    "guild_id" BIGINT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "target_role_id" BIGINT NOT NULL,
    "target_role_name" VARCHAR(100) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "role_sync_rules_pkey" PRIMARY KEY ("id")
);

-- Source roles for each rule (up to 20 per rule)
CREATE TABLE "role_sync_source_roles" (
    "id" SERIAL NOT NULL,
    "rule_id" INTEGER NOT NULL,
    "role_id" BIGINT NOT NULL,
    "role_name" VARCHAR(100) NOT NULL,

    CONSTRAINT "role_sync_source_roles_pkey" PRIMARY KEY ("id")
);

-- Watched roles for change logging
CREATE TABLE "role_watch_configs" (
    "id" SERIAL NOT NULL,
    "guild_id" BIGINT NOT NULL,
    "role_id" BIGINT NOT NULL,
    "role_name" VARCHAR(100) NOT NULL,

    CONSTRAINT "role_watch_configs_pkey" PRIMARY KEY ("id")
);

-- Role change event log (append-only)
CREATE TABLE "role_change_logs" (
    "id" SERIAL NOT NULL,
    "guild_id" BIGINT NOT NULL,
    "discord_id" BIGINT NOT NULL,
    "discord_name" VARCHAR(255) NOT NULL,
    "role_id" BIGINT NOT NULL,
    "role_name" VARCHAR(100) NOT NULL,
    "action" VARCHAR(10) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_change_logs_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX "role_sync_rules_guild_id_idx" ON "role_sync_rules"("guild_id");
CREATE UNIQUE INDEX "role_sync_source_roles_rule_id_role_id_key" ON "role_sync_source_roles"("rule_id", "role_id");
CREATE UNIQUE INDEX "role_watch_configs_guild_id_role_id_key" ON "role_watch_configs"("guild_id", "role_id");
CREATE INDEX "role_change_logs_guild_id_created_at_idx" ON "role_change_logs"("guild_id", "created_at" DESC);
CREATE INDEX "role_change_logs_guild_id_role_id_idx" ON "role_change_logs"("guild_id", "role_id");
CREATE INDEX "role_change_logs_guild_id_discord_id_idx" ON "role_change_logs"("guild_id", "discord_id");

-- Foreign keys
ALTER TABLE "role_sync_source_roles" ADD CONSTRAINT "role_sync_source_roles_rule_id_fkey"
    FOREIGN KEY ("rule_id") REFERENCES "role_sync_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;
