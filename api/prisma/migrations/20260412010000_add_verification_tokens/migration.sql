-- Verification tokens for in-game code verification
CREATE TABLE "verification_tokens" (
    "id" SERIAL NOT NULL,
    "guild_id" BIGINT NOT NULL,
    "discord_id" BIGINT NOT NULL,
    "id_type" VARCHAR(20) NOT NULL,
    "id_value" VARCHAR(255) NOT NULL,
    "code" VARCHAR(10) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_tokens_pkey" PRIMARY KEY ("id")
);

-- Unique index on code for fast lookups
CREATE UNIQUE INDEX "verification_tokens_code_key" ON "verification_tokens"("code");

-- Index for looking up tokens by guild + ID value
CREATE INDEX "verification_tokens_guild_id_id_value_idx" ON "verification_tokens"("guild_id", "id_value");
