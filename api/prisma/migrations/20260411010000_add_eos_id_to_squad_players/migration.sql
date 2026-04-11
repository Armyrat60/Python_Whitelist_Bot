-- Add EOS ID column to squad_players for Steam↔EOS pairing
ALTER TABLE "squad_players" ADD COLUMN "eos_id" VARCHAR(64);

-- Index for EOS ID lookups
CREATE INDEX "idx_squad_players_eos" ON "squad_players"("guild_id", "eos_id");
