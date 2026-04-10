-- Game servers with SFTP credentials for file push/pull

CREATE TABLE "game_servers" (
    "id" SERIAL NOT NULL,
    "guild_id" BIGINT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "sftp_host" VARCHAR(255),
    "sftp_port" INTEGER NOT NULL DEFAULT 22,
    "sftp_user" VARCHAR(100),
    "sftp_password" TEXT,
    "sftp_base_path" VARCHAR(500) NOT NULL DEFAULT '/SquadGame/ServerConfig',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "game_servers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "game_servers_guild_id_name_key" ON "game_servers"("guild_id", "name");
CREATE INDEX "game_servers_guild_id_idx" ON "game_servers"("guild_id");
