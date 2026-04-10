-- Add granular permissions JSON column to dashboard permission tables.
-- Used when permission_level = 'granular' to store fine-grained flags.
-- Existing rows (roster_manager, viewer) keep this column as NULL.

ALTER TABLE "dashboard_permissions" ADD COLUMN "permissions" JSONB;
ALTER TABLE "dashboard_role_permissions" ADD COLUMN "permissions" JSONB;
