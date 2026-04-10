-- BattleMetrics integration config (per-guild API key + tracked server)

CREATE TABLE "battlemetrics_configs" (
    "guild_id" BIGINT NOT NULL,
    "api_key" TEXT NOT NULL,
    "server_id" VARCHAR(32),
    "server_name" VARCHAR(255),
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "battlemetrics_configs_pkey" PRIMARY KEY ("guild_id")
);
