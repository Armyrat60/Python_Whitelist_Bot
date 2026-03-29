-- Migration: simplify_role_tiers
-- Merges role_mappings + tier_categories + tier_entries into whitelist_roles
-- Removes tierCategoryId from panels

-- 1. Create whitelist_roles table
CREATE TABLE "whitelist_roles" (
    "id" SERIAL PRIMARY KEY,
    "guild_id" BIGINT NOT NULL,
    "whitelist_id" INTEGER NOT NULL,
    "role_id" BIGINT NOT NULL,
    "role_name" VARCHAR(100) NOT NULL,
    "slot_limit" INTEGER NOT NULL DEFAULT 1,
    "is_stackable" BOOLEAN NOT NULL DEFAULT FALSE,
    "is_active" BOOLEAN NOT NULL DEFAULT TRUE,
    "display_name" VARCHAR(100),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT "whitelist_roles_whitelist_id_fkey"
        FOREIGN KEY ("whitelist_id") REFERENCES "whitelists"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "whitelist_roles_guild_id_whitelist_id_role_id_key"
    ON "whitelist_roles"("guild_id", "whitelist_id", "role_id");

-- 2. Remove tier_category_id from panels
ALTER TABLE "panels" DROP COLUMN IF EXISTS "tier_category_id";

-- 3. Drop old tables (order matters: dependent tables first)
DROP TABLE IF EXISTS "tier_entries";
DROP TABLE IF EXISTS "tier_categories";
DROP TABLE IF EXISTS "role_mappings";
