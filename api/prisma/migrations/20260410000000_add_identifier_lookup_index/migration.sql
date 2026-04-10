-- Add index for Steam ID → Discord ID lookups used by bridge sync.
-- Speeds up the whitelist_identifiers query from O(n) to O(log n).

CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_wi_guild_id_lookup"
ON "whitelist_identifiers" ("guild_id", "id_type", "id_value");
