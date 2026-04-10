-- Add RCON connection fields to game_servers

ALTER TABLE "game_servers" ADD COLUMN "rcon_host" VARCHAR(255);
ALTER TABLE "game_servers" ADD COLUMN "rcon_port" INTEGER NOT NULL DEFAULT 21114;
ALTER TABLE "game_servers" ADD COLUMN "rcon_password" TEXT;
