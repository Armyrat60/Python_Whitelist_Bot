-- BattleMetrics: add multi-server support (up to 5 tracked servers)
-- Existing server_id/server_name columns kept for backwards compat.

ALTER TABLE "battlemetrics_configs" ADD COLUMN "server_ids" JSONB;
ALTER TABLE "battlemetrics_configs" ADD COLUMN "server_names" JSONB;
