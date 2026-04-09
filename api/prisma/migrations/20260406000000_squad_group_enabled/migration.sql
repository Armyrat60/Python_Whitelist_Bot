-- AlterTable
-- Idempotent: baseline migration also creates squad_groups with this column,
-- so on a fresh DB this is a no-op.
ALTER TABLE "squad_groups" ADD COLUMN IF NOT EXISTS "enabled" BOOLEAN NOT NULL DEFAULT true;
