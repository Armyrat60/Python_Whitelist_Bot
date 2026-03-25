import re
from datetime import timedelta
from typing import Optional, List, Tuple, Dict, Any
from urllib.parse import urlparse

from bot.config import (
    DB_ENGINE,
    DB_HOST,
    DB_PORT,
    DB_NAME,
    DB_USER,
    DB_PASSWORD,
    DATABASE_URL,
    SQUAD_PERMISSIONS,
    DEFAULT_SETTINGS,
    DEFAULT_TYPES,
    log,
)
from bot.utils import utcnow, to_bool


# ─── Parameter placeholder conversion ────────────────────────────────────────

_PG_PARAM_RE = re.compile(r"%s")


def _to_pg_params(query: str) -> str:
    """Convert MySQL-style %s placeholders to PostgreSQL $1, $2, ... style."""
    counter = [0]

    def _replace(_match):
        counter[0] += 1
        return f"${counter[0]}"

    return _PG_PARAM_RE.sub(_replace, query)


# ─── Engine-specific adapters ────────────────────────────────────────────────

class _MySQLAdapter:
    """Adapter for aiomysql (MySQL/MariaDB)."""

    def __init__(self):
        self.pool = None

    async def connect(self):
        import aiomysql
        self.pool = await aiomysql.create_pool(
            host=DB_HOST,
            port=DB_PORT,
            user=DB_USER,
            password=DB_PASSWORD,
            db=DB_NAME,
            autocommit=True,
            minsize=1,
            maxsize=10,
            charset="utf8mb4",
        )

    async def execute(self, query: str, params: tuple = ()) -> int:
        async with self.pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(query, params)
                return cur.rowcount

    async def execute_returning(self, query: str, params: tuple = ()) -> Optional[tuple]:
        """Execute an INSERT and return the last inserted row id."""
        async with self.pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(query, params)
                last_id = cur.lastrowid
                return (last_id,) if last_id else None

    async def fetchone(self, query: str, params: tuple = ()) -> Optional[tuple]:
        async with self.pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(query, params)
                return await cur.fetchone()

    async def fetchall(self, query: str, params: tuple = ()) -> List[tuple]:
        async with self.pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(query, params)
                return await cur.fetchall()

    async def execute_transaction(self, queries: List[Tuple[str, tuple]]):
        async with self.pool.acquire() as conn:
            await conn.begin()
            try:
                async with conn.cursor() as cur:
                    for query, params in queries:
                        await cur.execute(query, params)
                await conn.commit()
            except Exception:
                await conn.rollback()
                raise


class _PostgresAdapter:
    """Adapter for asyncpg (PostgreSQL)."""

    def __init__(self):
        self.pool = None

    async def connect(self):
        import asyncpg
        import ssl as ssl_mod
        if DATABASE_URL:
            # Railway PostgreSQL may require SSL
            dsn = DATABASE_URL
            # asyncpg needs ssl='require' for Railway/cloud providers
            ssl_ctx = ssl_mod.create_default_context()
            ssl_ctx.check_hostname = False
            ssl_ctx.verify_mode = ssl_mod.CERT_NONE
            try:
                self.pool = await asyncpg.create_pool(dsn=dsn, min_size=1, max_size=10, ssl=ssl_ctx)
            except Exception:
                # Retry without SSL (local dev)
                self.pool = await asyncpg.create_pool(dsn=dsn, min_size=1, max_size=10)
        else:
            self.pool = await asyncpg.create_pool(
                host=DB_HOST,
                port=DB_PORT,
                user=DB_USER,
                password=DB_PASSWORD,
                database=DB_NAME,
                min_size=1,
                max_size=10,
            )

    async def execute(self, query: str, params: tuple = ()) -> int:
        pg_query = _to_pg_params(query)
        async with self.pool.acquire() as conn:
            result = await conn.execute(pg_query, *params)
            # asyncpg returns "INSERT 0 1" / "UPDATE 3" / "DELETE 2" etc.
            parts = result.split() if result else []
            return int(parts[-1]) if parts and parts[-1].isdigit() else 0

    async def execute_returning(self, query: str, params: tuple = ()) -> Optional[tuple]:
        """Execute an INSERT ... RETURNING and return the row."""
        pg_query = _to_pg_params(query)
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(pg_query, *params)
            return tuple(row.values()) if row else None

    async def fetchone(self, query: str, params: tuple = ()) -> Optional[tuple]:
        pg_query = _to_pg_params(query)
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(pg_query, *params)
            return tuple(row.values()) if row else None

    async def fetchall(self, query: str, params: tuple = ()) -> List[tuple]:
        pg_query = _to_pg_params(query)
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(pg_query, *params)
            return [tuple(r.values()) for r in rows]

    async def execute_transaction(self, queries: List[Tuple[str, tuple]]):
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                for query, params in queries:
                    pg_query = _to_pg_params(query)
                    await conn.execute(pg_query, *params)


# ─── Schema definitions per engine ───────────────────────────────────────────

MYSQL_SCHEMA = [
    """
    CREATE TABLE IF NOT EXISTS bot_settings (
        guild_id BIGINT NOT NULL DEFAULT 0,
        setting_key VARCHAR(100) NOT NULL,
        setting_value TEXT NOT NULL,
        PRIMARY KEY (guild_id, setting_key)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    """,
    """
    CREATE TABLE IF NOT EXISTS whitelists (
        id INT AUTO_INCREMENT PRIMARY KEY,
        guild_id BIGINT NOT NULL,
        name VARCHAR(100) NOT NULL,
        slug VARCHAR(50) NOT NULL,
        enabled TINYINT(1) NOT NULL DEFAULT 0,
        panel_channel_id BIGINT NULL,
        panel_message_id BIGINT NULL,
        log_channel_id BIGINT NULL,
        squad_group VARCHAR(100) NOT NULL DEFAULT 'Whitelist',
        output_filename VARCHAR(255) NOT NULL DEFAULT 'whitelist.txt',
        default_slot_limit INT NOT NULL DEFAULT 1,
        stack_roles TINYINT(1) NOT NULL DEFAULT 0,
        is_default TINYINT(1) NOT NULL DEFAULT 0,
        created_at DATETIME NOT NULL,
        updated_at DATETIME NOT NULL,
        UNIQUE KEY uq_guild_slug (guild_id, slug)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    """,
    # Legacy table kept for migration; new code uses whitelists
    """
    CREATE TABLE IF NOT EXISTS whitelist_types (
        guild_id BIGINT NOT NULL DEFAULT 0,
        whitelist_type VARCHAR(20) NOT NULL,
        enabled TINYINT(1) NOT NULL DEFAULT 0,
        panel_channel_id BIGINT NULL,
        panel_message_id BIGINT NULL,
        log_channel_id BIGINT NULL,
        github_enabled TINYINT(1) NOT NULL DEFAULT 1,
        github_filename VARCHAR(255) NOT NULL,
        input_mode VARCHAR(20) NOT NULL DEFAULT 'modal',
        stack_roles TINYINT(1) NOT NULL DEFAULT 1,
        default_slot_limit INT NOT NULL DEFAULT 1,
        squad_group VARCHAR(100) NOT NULL DEFAULT 'Whitelist',
        updated_at DATETIME NOT NULL,
        PRIMARY KEY (guild_id, whitelist_type)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    """,
    """
    CREATE TABLE IF NOT EXISTS role_mappings (
        id INT AUTO_INCREMENT PRIMARY KEY,
        guild_id BIGINT NOT NULL DEFAULT 0,
        whitelist_type VARCHAR(20) NULL,
        whitelist_id INT NULL,
        role_id BIGINT NOT NULL,
        role_name VARCHAR(255) NOT NULL,
        slot_limit INT NOT NULL,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        created_at DATETIME NOT NULL,
        UNIQUE KEY uq_guild_wl_role (guild_id, whitelist_id, role_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    """,
    """
    CREATE TABLE IF NOT EXISTS whitelist_users (
        guild_id BIGINT NOT NULL DEFAULT 0,
        discord_id BIGINT NOT NULL,
        whitelist_type VARCHAR(20) NULL,
        whitelist_id INT NULL,
        discord_name VARCHAR(255) NOT NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'active',
        slot_limit_override INT NULL,
        effective_slot_limit INT NOT NULL DEFAULT 0,
        last_plan_name VARCHAR(255) NULL,
        updated_at DATETIME NOT NULL,
        created_at DATETIME NOT NULL,
        PRIMARY KEY (guild_id, discord_id, whitelist_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    """,
    """
    CREATE TABLE IF NOT EXISTS whitelist_identifiers (
        id INT AUTO_INCREMENT PRIMARY KEY,
        guild_id BIGINT NOT NULL DEFAULT 0,
        discord_id BIGINT NOT NULL,
        whitelist_type VARCHAR(20) NULL,
        whitelist_id INT NULL,
        id_type VARCHAR(20) NOT NULL,
        id_value VARCHAR(255) NOT NULL,
        is_verified TINYINT(1) NOT NULL DEFAULT 0,
        verification_source VARCHAR(100) NULL,
        created_at DATETIME NOT NULL,
        updated_at DATETIME NOT NULL,
        UNIQUE KEY uq_guild_user_wl_identifier (guild_id, discord_id, whitelist_id, id_type, id_value)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    """,
    """
    CREATE TABLE IF NOT EXISTS audit_log (
        id INT AUTO_INCREMENT PRIMARY KEY,
        guild_id BIGINT NOT NULL DEFAULT 0,
        whitelist_type VARCHAR(20) NULL,
        whitelist_id INT NULL,
        action_type VARCHAR(100) NOT NULL,
        actor_discord_id BIGINT NULL,
        target_discord_id BIGINT NULL,
        details LONGTEXT NULL,
        created_at DATETIME NOT NULL,
        INDEX idx_guild_created (guild_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    """,
    """
    CREATE TABLE IF NOT EXISTS squad_permissions (
        permission VARCHAR(50) PRIMARY KEY,
        description VARCHAR(255) NOT NULL,
        is_active TINYINT(1) NOT NULL DEFAULT 1
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    """,
    """
    CREATE TABLE IF NOT EXISTS squad_groups (
        guild_id BIGINT NOT NULL DEFAULT 0,
        group_name VARCHAR(100) NOT NULL,
        permissions TEXT NOT NULL,
        is_default TINYINT(1) NOT NULL DEFAULT 0,
        created_at DATETIME NOT NULL,
        updated_at DATETIME NOT NULL,
        PRIMARY KEY (guild_id, group_name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    """,
    """
    CREATE TABLE IF NOT EXISTS panels (
        id INT AUTO_INCREMENT PRIMARY KEY,
        guild_id BIGINT NOT NULL DEFAULT 0,
        name VARCHAR(100) NOT NULL,
        channel_id BIGINT NULL,
        log_channel_id BIGINT NULL,
        whitelist_id INT NULL,
        panel_message_id BIGINT NULL,
        is_default TINYINT(1) NOT NULL DEFAULT 0,
        created_at DATETIME NOT NULL,
        updated_at DATETIME NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    """,
]

POSTGRES_SCHEMA = [
    """
    CREATE TABLE IF NOT EXISTS bot_settings (
        guild_id BIGINT NOT NULL DEFAULT 0,
        setting_key VARCHAR(100) NOT NULL,
        setting_value TEXT NOT NULL,
        PRIMARY KEY (guild_id, setting_key)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS whitelists (
        id SERIAL PRIMARY KEY,
        guild_id BIGINT NOT NULL,
        name VARCHAR(100) NOT NULL,
        slug VARCHAR(50) NOT NULL,
        enabled BOOLEAN NOT NULL DEFAULT FALSE,
        panel_channel_id BIGINT NULL,
        panel_message_id BIGINT NULL,
        log_channel_id BIGINT NULL,
        squad_group VARCHAR(100) NOT NULL DEFAULT 'Whitelist',
        output_filename VARCHAR(255) NOT NULL DEFAULT 'whitelist.txt',
        default_slot_limit INT NOT NULL DEFAULT 1,
        stack_roles BOOLEAN NOT NULL DEFAULT FALSE,
        is_default BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMP NOT NULL,
        updated_at TIMESTAMP NOT NULL,
        UNIQUE (guild_id, slug)
    )
    """,
    # Legacy table kept for migration; new code uses whitelists
    """
    CREATE TABLE IF NOT EXISTS whitelist_types (
        guild_id BIGINT NOT NULL DEFAULT 0,
        whitelist_type VARCHAR(20) NOT NULL,
        enabled BOOLEAN NOT NULL DEFAULT FALSE,
        panel_channel_id BIGINT NULL,
        panel_message_id BIGINT NULL,
        log_channel_id BIGINT NULL,
        github_enabled BOOLEAN NOT NULL DEFAULT TRUE,
        github_filename VARCHAR(255) NOT NULL,
        input_mode VARCHAR(20) NOT NULL DEFAULT 'modal',
        stack_roles BOOLEAN NOT NULL DEFAULT TRUE,
        default_slot_limit INT NOT NULL DEFAULT 1,
        squad_group VARCHAR(100) NOT NULL DEFAULT 'Whitelist',
        updated_at TIMESTAMP NOT NULL,
        PRIMARY KEY (guild_id, whitelist_type)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS role_mappings (
        id SERIAL PRIMARY KEY,
        guild_id BIGINT NOT NULL DEFAULT 0,
        whitelist_type VARCHAR(20) NULL,
        whitelist_id INT NULL,
        role_id BIGINT NOT NULL,
        role_name VARCHAR(255) NOT NULL,
        slot_limit INT NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP NOT NULL,
        UNIQUE (guild_id, whitelist_id, role_id)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS whitelist_users (
        guild_id BIGINT NOT NULL DEFAULT 0,
        discord_id BIGINT NOT NULL,
        whitelist_type VARCHAR(20) NULL,
        whitelist_id INT NULL,
        discord_name VARCHAR(255) NOT NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'active',
        slot_limit_override INT NULL,
        effective_slot_limit INT NOT NULL DEFAULT 0,
        last_plan_name VARCHAR(255) NULL,
        updated_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP NOT NULL,
        PRIMARY KEY (guild_id, discord_id, whitelist_id)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS whitelist_identifiers (
        id SERIAL PRIMARY KEY,
        guild_id BIGINT NOT NULL DEFAULT 0,
        discord_id BIGINT NOT NULL,
        whitelist_type VARCHAR(20) NULL,
        whitelist_id INT NULL,
        id_type VARCHAR(20) NOT NULL,
        id_value VARCHAR(255) NOT NULL,
        is_verified BOOLEAN NOT NULL DEFAULT FALSE,
        verification_source VARCHAR(100) NULL,
        created_at TIMESTAMP NOT NULL,
        updated_at TIMESTAMP NOT NULL,
        UNIQUE (guild_id, discord_id, whitelist_id, id_type, id_value)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS audit_log (
        id SERIAL PRIMARY KEY,
        guild_id BIGINT NOT NULL DEFAULT 0,
        whitelist_type VARCHAR(20) NULL,
        whitelist_id INT NULL,
        action_type VARCHAR(100) NOT NULL,
        actor_discord_id BIGINT NULL,
        target_discord_id BIGINT NULL,
        details TEXT NULL,
        created_at TIMESTAMP NOT NULL
    )
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_audit_guild_created ON audit_log (guild_id, created_at)
    """,
    """
    CREATE TABLE IF NOT EXISTS squad_permissions (
        permission VARCHAR(50) PRIMARY KEY,
        description VARCHAR(255) NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS squad_groups (
        guild_id BIGINT NOT NULL DEFAULT 0,
        group_name VARCHAR(100) NOT NULL,
        permissions TEXT NOT NULL,
        is_default BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMP NOT NULL,
        updated_at TIMESTAMP NOT NULL,
        PRIMARY KEY (guild_id, group_name)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS panels (
        id SERIAL PRIMARY KEY,
        guild_id BIGINT NOT NULL DEFAULT 0,
        name VARCHAR(100) NOT NULL,
        channel_id BIGINT NULL,
        log_channel_id BIGINT NULL,
        whitelist_id INT NULL REFERENCES whitelists(id) ON DELETE SET NULL,
        panel_message_id BIGINT NULL,
        is_default BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMP NOT NULL,
        updated_at TIMESTAMP NOT NULL
    )
    """,
]

# ─── Migration statements ────────────────────────────────────────────────────
# These handle upgrading from the old whitelist_types schema to the new
# whitelists table.  They add whitelist_id columns to existing tables and
# migrate data from whitelist_type -> whitelists -> whitelist_id.

MYSQL_MIGRATIONS = [
    # --- Legacy guild_id migrations (from previous multi-guild update) ---
    "ALTER TABLE bot_settings ADD COLUMN guild_id BIGINT NOT NULL DEFAULT 0",
    "ALTER TABLE bot_settings DROP PRIMARY KEY, ADD PRIMARY KEY (guild_id, setting_key)",
    "ALTER TABLE whitelist_types ADD COLUMN guild_id BIGINT NOT NULL DEFAULT 0",
    "ALTER TABLE whitelist_types DROP PRIMARY KEY, ADD PRIMARY KEY (guild_id, whitelist_type)",
    "ALTER TABLE squad_groups ADD COLUMN guild_id BIGINT NOT NULL DEFAULT 0",
    "ALTER TABLE squad_groups DROP PRIMARY KEY, ADD PRIMARY KEY (guild_id, group_name)",

    # --- New whitelists migration: add whitelist_id columns ---
    "ALTER TABLE role_mappings ADD COLUMN whitelist_id INT NULL",
    "ALTER TABLE whitelist_users ADD COLUMN whitelist_id INT NULL",
    "ALTER TABLE whitelist_identifiers ADD COLUMN whitelist_id INT NULL",
    "ALTER TABLE audit_log ADD COLUMN whitelist_id INT NULL",

    # --- Migrate data from whitelist_types into whitelists table ---
    # Insert existing whitelist_types as whitelists rows
    """
    INSERT IGNORE INTO whitelists (guild_id, name, slug, enabled, panel_channel_id, panel_message_id,
        log_channel_id, squad_group, output_filename, default_slot_limit, stack_roles, is_default, created_at, updated_at)
    SELECT guild_id, whitelist_type, whitelist_type, enabled, panel_channel_id, panel_message_id,
        log_channel_id, squad_group, github_filename, default_slot_limit, stack_roles, 0, updated_at, updated_at
    FROM whitelist_types
    """,

    # Populate whitelist_id from the old whitelist_type values
    """
    UPDATE role_mappings rm
    JOIN whitelists w ON w.guild_id = rm.guild_id AND w.slug = rm.whitelist_type
    SET rm.whitelist_id = w.id
    WHERE rm.whitelist_id IS NULL AND rm.whitelist_type IS NOT NULL
    """,
    """
    UPDATE whitelist_users wu
    JOIN whitelists w ON w.guild_id = wu.guild_id AND w.slug = wu.whitelist_type
    SET wu.whitelist_id = w.id
    WHERE wu.whitelist_id IS NULL AND wu.whitelist_type IS NOT NULL
    """,
    """
    UPDATE whitelist_identifiers wi
    JOIN whitelists w ON w.guild_id = wi.guild_id AND w.slug = wi.whitelist_type
    SET wi.whitelist_id = w.id
    WHERE wi.whitelist_id IS NULL AND wi.whitelist_type IS NOT NULL
    """,
    """
    UPDATE audit_log al
    JOIN whitelists w ON w.guild_id = al.guild_id AND w.slug = al.whitelist_type
    SET al.whitelist_id = w.id
    WHERE al.whitelist_id IS NULL AND al.whitelist_type IS NOT NULL
    """,
]

POSTGRES_MIGRATIONS = [
    # --- Legacy guild_id migrations (from previous multi-guild update) ---
    "ALTER TABLE bot_settings ADD COLUMN IF NOT EXISTS guild_id BIGINT NOT NULL DEFAULT 0",
    "ALTER TABLE bot_settings DROP CONSTRAINT IF EXISTS bot_settings_pkey, ADD PRIMARY KEY (guild_id, setting_key)",
    "ALTER TABLE whitelist_types ADD COLUMN IF NOT EXISTS guild_id BIGINT NOT NULL DEFAULT 0",
    "ALTER TABLE whitelist_types DROP CONSTRAINT IF EXISTS whitelist_types_pkey, ADD PRIMARY KEY (guild_id, whitelist_type)",
    "ALTER TABLE squad_groups ADD COLUMN IF NOT EXISTS guild_id BIGINT NOT NULL DEFAULT 0",
    "ALTER TABLE squad_groups DROP CONSTRAINT IF EXISTS squad_groups_pkey, ADD PRIMARY KEY (guild_id, group_name)",

    # --- Make legacy whitelist_type columns nullable ---
    "ALTER TABLE role_mappings ALTER COLUMN whitelist_type DROP NOT NULL",
    "ALTER TABLE whitelist_users ALTER COLUMN whitelist_type DROP NOT NULL",
    "ALTER TABLE whitelist_identifiers ALTER COLUMN whitelist_type DROP NOT NULL",

    # --- New whitelists migration: add whitelist_id columns ---
    "ALTER TABLE role_mappings ADD COLUMN IF NOT EXISTS whitelist_id INT NULL",
    "ALTER TABLE whitelist_users ADD COLUMN IF NOT EXISTS whitelist_id INT NULL",
    "ALTER TABLE whitelist_identifiers ADD COLUMN IF NOT EXISTS whitelist_id INT NULL",
    "ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS whitelist_id INT NULL",

    # --- Migrate data from whitelist_types into whitelists table ---
    """
    INSERT INTO whitelists (guild_id, name, slug, enabled, panel_channel_id, panel_message_id,
        log_channel_id, squad_group, output_filename, default_slot_limit, stack_roles, is_default, created_at, updated_at)
    SELECT guild_id, whitelist_type, whitelist_type, enabled, panel_channel_id, panel_message_id,
        log_channel_id, squad_group, github_filename, default_slot_limit, stack_roles, FALSE, updated_at, updated_at
    FROM whitelist_types
    ON CONFLICT (guild_id, slug) DO NOTHING
    """,

    # Populate whitelist_id from the old whitelist_type values
    """
    UPDATE role_mappings SET whitelist_id = w.id
    FROM whitelists w
    WHERE w.guild_id = role_mappings.guild_id AND w.slug = role_mappings.whitelist_type
      AND role_mappings.whitelist_id IS NULL AND role_mappings.whitelist_type IS NOT NULL
    """,
    """
    UPDATE whitelist_users SET whitelist_id = w.id
    FROM whitelists w
    WHERE w.guild_id = whitelist_users.guild_id AND w.slug = whitelist_users.whitelist_type
      AND whitelist_users.whitelist_id IS NULL AND whitelist_users.whitelist_type IS NOT NULL
    """,
    """
    UPDATE whitelist_identifiers SET whitelist_id = w.id
    FROM whitelists w
    WHERE w.guild_id = whitelist_identifiers.guild_id AND w.slug = whitelist_identifiers.whitelist_type
      AND whitelist_identifiers.whitelist_id IS NULL AND whitelist_identifiers.whitelist_type IS NOT NULL
    """,
    """
    UPDATE audit_log SET whitelist_id = w.id
    FROM whitelists w
    WHERE w.guild_id = audit_log.guild_id AND w.slug = audit_log.whitelist_type
      AND audit_log.whitelist_id IS NULL AND audit_log.whitelist_type IS NOT NULL
    """,

    # --- Force whitelist_type nullable (may have failed in earlier migration) ---
    "ALTER TABLE whitelist_users ALTER COLUMN whitelist_type DROP NOT NULL",
    "ALTER TABLE whitelist_identifiers ALTER COLUMN whitelist_type DROP NOT NULL",
    "ALTER TABLE role_mappings ALTER COLUMN whitelist_type DROP NOT NULL",

    # --- Ensure unique constraints exist for ON CONFLICT to work ---
    # Delete orphaned rows with NULL whitelist_id before adding constraints
    "DELETE FROM whitelist_users WHERE whitelist_id IS NULL",
    "DELETE FROM whitelist_identifiers WHERE whitelist_id IS NULL AND id_value IS NULL",
    # Make whitelist_id NOT NULL now that migration is done
    "ALTER TABLE whitelist_users ALTER COLUMN whitelist_id SET NOT NULL",
    # Add unique constraint if not exists (idempotent via DO NOTHING on error)
    """
    DO $$
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_wu_guild_discord_wl') THEN
            ALTER TABLE whitelist_users ADD CONSTRAINT uq_wu_guild_discord_wl UNIQUE (guild_id, discord_id, whitelist_id);
        END IF;
    END $$
    """,
]


# ─── Database class (engine-agnostic) ────────────────────────────────────────

class Database:
    def __init__(self):
        engine = DATABASE_URL.split("://")[0] if DATABASE_URL else DB_ENGINE
        # Normalize: "postgresql" -> "postgres"
        if engine in ("postgresql", "postgresql+asyncpg"):
            engine = "postgres"
        self.engine = engine
        self._adapter = _PostgresAdapter() if engine == "postgres" else _MySQLAdapter()

    async def connect(self):
        await self._adapter.connect()
        log.info("DB connected (engine=%s)", self.engine)

    async def execute(self, query: str, params: tuple = ()) -> int:
        return await self._adapter.execute(query, params)

    async def execute_returning(self, query: str, params: tuple = ()) -> Optional[tuple]:
        return await self._adapter.execute_returning(query, params)

    async def execute_transaction(self, queries: list):
        """Execute multiple queries atomically in a single transaction."""
        return await self._adapter.execute_transaction(queries)

    async def fetchone(self, query: str, params: tuple = ()) -> Optional[tuple]:
        return await self._adapter.fetchone(query, params)

    async def fetchall(self, query: str, params: tuple = ()) -> List[tuple]:
        return await self._adapter.fetchall(query, params)

    async def init_schema(self):
        schema = POSTGRES_SCHEMA if self.engine == "postgres" else MYSQL_SCHEMA
        for stmt in schema:
            await self.execute(stmt)

        # Run migrations (idempotent)
        migrations = POSTGRES_MIGRATIONS if self.engine == "postgres" else MYSQL_MIGRATIONS
        for stmt in migrations:
            try:
                await self.execute(stmt)
            except Exception as exc:
                # Column/constraint already exists or old constraint not found -- usually safe to ignore
                log.debug("Migration skipped (likely already applied): %s", str(exc)[:80])

        # Seed Squad permissions (global, no guild_id)
        for perm, desc in SQUAD_PERMISSIONS.items():
            if self.engine == "postgres":
                await self.execute(
                    """
                    INSERT INTO squad_permissions (permission, description, is_active)
                    VALUES (%s, %s, TRUE)
                    ON CONFLICT (permission) DO UPDATE SET description=EXCLUDED.description
                    """,
                    (perm, desc),
                )
            else:
                await self.execute(
                    """
                    INSERT INTO squad_permissions (permission, description, is_active)
                    VALUES (%s, %s, 1)
                    ON DUPLICATE KEY UPDATE description=VALUES(description)
                    """,
                    (perm, desc),
                )

        # Note: guild defaults are seeded per-guild in bot on_ready / web startup
        # No longer seed for guild_id=0 (legacy artifact)

    async def seed_guild_defaults(self, guild_id: int):
        """Seed a default whitelist and default squad group for a guild if they don't exist."""
        now = utcnow()

        # Seed default Whitelist squad group
        if self.engine == "postgres":
            await self.execute(
                """
                INSERT INTO squad_groups (guild_id, group_name, permissions, is_default, created_at, updated_at)
                VALUES (%s, %s, %s, TRUE, %s, %s)
                ON CONFLICT (guild_id, group_name) DO NOTHING
                """,
                (guild_id, "Whitelist", "reserve", now, now),
            )
        else:
            await self.execute(
                """
                INSERT INTO squad_groups (guild_id, group_name, permissions, is_default, created_at, updated_at)
                VALUES (%s, %s, %s, 1, %s, %s)
                ON DUPLICATE KEY UPDATE updated_at=updated_at
                """,
                (guild_id, "Whitelist", "reserve", now, now),
            )

        # Seed default settings
        for key, value in DEFAULT_SETTINGS.items():
            if self.engine == "postgres":
                await self.execute(
                    """
                    INSERT INTO bot_settings (guild_id, setting_key, setting_value)
                    VALUES (%s, %s, %s)
                    ON CONFLICT (guild_id, setting_key) DO NOTHING
                    """,
                    (guild_id, key, value),
                )
            else:
                await self.execute(
                    """
                    INSERT INTO bot_settings (guild_id, setting_key, setting_value)
                    VALUES (%s, %s, %s)
                    ON DUPLICATE KEY UPDATE setting_value = setting_value
                    """,
                    (guild_id, key, value),
                )

        # Seed one default whitelist ("Default Whitelist", slug "default") if none exists
        existing = await self.fetchone(
            "SELECT id FROM whitelists WHERE guild_id=%s AND slug=%s LIMIT 1",
            (guild_id, "default"),
        )
        if not existing:
            try:
                wl_id = await self.create_whitelist(
                    guild_id,
                    name="Default Whitelist",
                    slug="default",
                    enabled=False,
                    squad_group="Whitelist",
                    output_filename="whitelist.txt",
                    default_slot_limit=1,
                    stack_roles=False,
                    is_default=True,
                )
            except Exception:
                # Race condition: another process created it first
                row = await self.fetchone(
                    "SELECT id FROM whitelists WHERE guild_id=%s AND slug=%s LIMIT 1",
                    (guild_id, "default"),
                )
                wl_id = row[0] if row else None
        else:
            wl_id = existing[0]

        # Seed one default panel linked to the default whitelist if none exists
        if wl_id:
            existing_panel = await self.fetchone(
                "SELECT id FROM panels WHERE guild_id=%s AND is_default=%s LIMIT 1",
                (guild_id, True if self.engine == "postgres" else 1),
            )
            if not existing_panel:
                try:
                    await self.create_panel(
                        guild_id,
                        name="Default Panel",
                        whitelist_id=wl_id,
                        is_default=True,
                    )
                except Exception:
                    pass  # Race condition: another process created it

    # ── Settings ──

    async def get_setting(self, guild_id: int, key: str, default: Optional[str] = None) -> Optional[str]:
        row = await self.fetchone(
            "SELECT setting_value FROM bot_settings WHERE guild_id=%s AND setting_key=%s",
            (guild_id, key),
        )
        return row[0] if row else default

    async def set_setting(self, guild_id: int, key: str, value: str):
        if self.engine == "postgres":
            await self.execute(
                """
                INSERT INTO bot_settings (guild_id, setting_key, setting_value)
                VALUES (%s, %s, %s)
                ON CONFLICT (guild_id, setting_key) DO UPDATE SET setting_value=EXCLUDED.setting_value
                """,
                (guild_id, key, str(value)),
            )
        else:
            await self.execute(
                """
                INSERT INTO bot_settings (guild_id, setting_key, setting_value)
                VALUES (%s, %s, %s)
                ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)
                """,
                (guild_id, key, str(value)),
            )

    # ── Whitelists (replaces whitelist_types) ──

    _WHITELIST_COLUMNS = (
        "id", "guild_id", "name", "slug", "enabled", "panel_channel_id",
        "panel_message_id", "log_channel_id", "squad_group", "output_filename",
        "default_slot_limit", "stack_roles", "is_default", "created_at", "updated_at",
    )

    def _row_to_whitelist(self, row: tuple) -> Dict[str, Any]:
        """Convert a raw DB row to a whitelist dict."""
        d = dict(zip(self._WHITELIST_COLUMNS, row))
        d["enabled"] = bool(d["enabled"])
        d["stack_roles"] = bool(d["stack_roles"])
        d["is_default"] = bool(d["is_default"])
        d["default_slot_limit"] = int(d["default_slot_limit"])
        return d

    async def create_whitelist(self, guild_id: int, name: str, slug: str, **kwargs) -> int:
        """Create a new whitelist and return its id."""
        now = utcnow()
        enabled = kwargs.get("enabled", False)
        panel_channel_id = kwargs.get("panel_channel_id", None)
        panel_message_id = kwargs.get("panel_message_id", None)
        log_channel_id = kwargs.get("log_channel_id", None)
        squad_group = kwargs.get("squad_group", "Whitelist")
        output_filename = kwargs.get("output_filename", "whitelist.txt")
        default_slot_limit = kwargs.get("default_slot_limit", 1)
        stack_roles = kwargs.get("stack_roles", False)
        is_default = kwargs.get("is_default", False)

        if self.engine == "postgres":
            row = await self.execute_returning(
                """
                INSERT INTO whitelists
                (guild_id, name, slug, enabled, panel_channel_id, panel_message_id,
                 log_channel_id, squad_group, output_filename, default_slot_limit,
                 stack_roles, is_default, created_at, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id
                """,
                (guild_id, name, slug, enabled, panel_channel_id, panel_message_id,
                 log_channel_id, squad_group, output_filename, int(default_slot_limit),
                 stack_roles, is_default, now, now),
            )
            return row[0]
        else:
            row = await self.execute_returning(
                """
                INSERT INTO whitelists
                (guild_id, name, slug, enabled, panel_channel_id, panel_message_id,
                 log_channel_id, squad_group, output_filename, default_slot_limit,
                 stack_roles, is_default, created_at, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (guild_id, name, slug, 1 if enabled else 0, panel_channel_id, panel_message_id,
                 log_channel_id, squad_group, output_filename, int(default_slot_limit),
                 1 if stack_roles else 0, 1 if is_default else 0, now, now),
            )
            return row[0]

    async def get_whitelist(self, whitelist_id: int) -> Optional[Dict[str, Any]]:
        row = await self.fetchone(
            """
            SELECT id, guild_id, name, slug, enabled, panel_channel_id, panel_message_id,
                   log_channel_id, squad_group, output_filename, default_slot_limit,
                   stack_roles, is_default, created_at, updated_at
            FROM whitelists WHERE id=%s
            """,
            (whitelist_id,),
        )
        return self._row_to_whitelist(row) if row else None

    async def get_whitelists(self, guild_id: int) -> List[Dict[str, Any]]:
        rows = await self.fetchall(
            """
            SELECT id, guild_id, name, slug, enabled, panel_channel_id, panel_message_id,
                   log_channel_id, squad_group, output_filename, default_slot_limit,
                   stack_roles, is_default, created_at, updated_at
            FROM whitelists WHERE guild_id=%s
            ORDER BY is_default DESC, name ASC
            """,
            (guild_id,),
        )
        return [self._row_to_whitelist(r) for r in rows]

    async def get_whitelist_by_slug(self, guild_id: int, slug: str) -> Optional[Dict[str, Any]]:
        row = await self.fetchone(
            """
            SELECT id, guild_id, name, slug, enabled, panel_channel_id, panel_message_id,
                   log_channel_id, squad_group, output_filename, default_slot_limit,
                   stack_roles, is_default, created_at, updated_at
            FROM whitelists WHERE guild_id=%s AND slug=%s
            """,
            (guild_id, slug),
        )
        return self._row_to_whitelist(row) if row else None

    async def get_default_whitelist(self, guild_id: int) -> Optional[Dict[str, Any]]:
        is_def = True if self.engine == "postgres" else 1
        row = await self.fetchone(
            """
            SELECT id, guild_id, name, slug, enabled, panel_channel_id, panel_message_id,
                   log_channel_id, squad_group, output_filename, default_slot_limit,
                   stack_roles, is_default, created_at, updated_at
            FROM whitelists WHERE guild_id=%s AND is_default=%s LIMIT 1
            """,
            (guild_id, is_def),
        )
        return self._row_to_whitelist(row) if row else None

    async def update_whitelist(self, whitelist_id: int, **kwargs):
        allowed = {
            "name", "slug", "enabled", "panel_channel_id", "panel_message_id",
            "log_channel_id", "squad_group", "output_filename", "default_slot_limit",
            "stack_roles", "is_default",
        }
        bool_cols = {"enabled", "stack_roles", "is_default"}
        parts = []
        params = []
        for key, value in kwargs.items():
            if key in allowed:
                # Coerce boolean columns to the right type per engine
                if key in bool_cols:
                    value = bool(value) if self.engine == "postgres" else int(bool(value))
                parts.append(f"{key}=%s")
                params.append(value)
        if not parts:
            return
        parts.append("updated_at=%s")
        params.append(utcnow())
        params.append(whitelist_id)
        await self.execute(
            f"UPDATE whitelists SET {', '.join(parts)} WHERE id=%s",
            tuple(params),
        )

    async def delete_whitelist(self, whitelist_id: int):
        await self.execute("DELETE FROM whitelists WHERE id=%s", (whitelist_id,))

    # ── Panels ──

    _PANEL_COLUMNS = (
        "id", "guild_id", "name", "channel_id", "log_channel_id",
        "whitelist_id", "panel_message_id", "is_default", "created_at", "updated_at",
    )

    def _row_to_panel(self, row: tuple) -> Dict[str, Any]:
        """Convert a raw DB row to a panel dict."""
        d = dict(zip(self._PANEL_COLUMNS, row))
        d["is_default"] = bool(d["is_default"])
        return d

    async def get_panels(self, guild_id: int) -> List[Dict[str, Any]]:
        rows = await self.fetchall(
            """
            SELECT id, guild_id, name, channel_id, log_channel_id,
                   whitelist_id, panel_message_id, is_default, created_at, updated_at
            FROM panels WHERE guild_id=%s
            ORDER BY is_default DESC, name ASC
            """,
            (guild_id,),
        )
        return [self._row_to_panel(r) for r in rows]

    async def get_panel_by_id(self, panel_id: int) -> Optional[Dict[str, Any]]:
        row = await self.fetchone(
            """
            SELECT id, guild_id, name, channel_id, log_channel_id,
                   whitelist_id, panel_message_id, is_default, created_at, updated_at
            FROM panels WHERE id=%s
            """,
            (panel_id,),
        )
        return self._row_to_panel(row) if row else None

    async def create_panel(self, guild_id: int, name: str, **kwargs) -> int:
        """Create a new panel and return its id."""
        now = utcnow()
        channel_id = kwargs.get("channel_id", None)
        log_channel_id = kwargs.get("log_channel_id", None)
        whitelist_id = kwargs.get("whitelist_id", None)
        panel_message_id = kwargs.get("panel_message_id", None)
        is_default = kwargs.get("is_default", False)

        if self.engine == "postgres":
            row = await self.execute_returning(
                """
                INSERT INTO panels
                (guild_id, name, channel_id, log_channel_id, whitelist_id,
                 panel_message_id, is_default, created_at, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id
                """,
                (guild_id, name, channel_id, log_channel_id, whitelist_id,
                 panel_message_id, is_default, now, now),
            )
            return row[0]
        else:
            row = await self.execute_returning(
                """
                INSERT INTO panels
                (guild_id, name, channel_id, log_channel_id, whitelist_id,
                 panel_message_id, is_default, created_at, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (guild_id, name, channel_id, log_channel_id, whitelist_id,
                 panel_message_id, 1 if is_default else 0, now, now),
            )
            return row[0]

    async def update_panel(self, panel_id: int, **kwargs):
        allowed = {
            "name", "channel_id", "log_channel_id", "whitelist_id",
            "panel_message_id", "is_default",
        }
        bool_cols = {"is_default"}
        parts = []
        params = []
        for key, value in kwargs.items():
            if key in allowed:
                if key in bool_cols:
                    value = bool(value) if self.engine == "postgres" else int(bool(value))
                parts.append(f"{key}=%s")
                params.append(value)
        if not parts:
            return
        parts.append("updated_at=%s")
        params.append(utcnow())
        params.append(panel_id)
        await self.execute(
            f"UPDATE panels SET {', '.join(parts)} WHERE id=%s",
            tuple(params),
        )

    async def delete_panel(self, panel_id: int):
        await self.execute("DELETE FROM panels WHERE id=%s", (panel_id,))

    # ── Legacy type config (backward compatibility shim) ──

    async def get_type_config(self, guild_id: int, whitelist_type: str) -> Optional[dict]:
        """Legacy helper: look up a whitelist by slug and return old-style config dict."""
        wl = await self.get_whitelist_by_slug(guild_id, whitelist_type)
        if not wl:
            return None
        return {
            "enabled": wl["enabled"],
            "panel_channel_id": wl["panel_channel_id"],
            "panel_message_id": wl["panel_message_id"],
            "log_channel_id": wl["log_channel_id"],
            "github_enabled": True,
            "github_filename": wl["output_filename"],
            "input_mode": "modal",
            "stack_roles": wl["stack_roles"],
            "default_slot_limit": wl["default_slot_limit"],
            "squad_group": wl["squad_group"] or "Whitelist",
        }

    async def set_type_config(self, guild_id: int, whitelist_type: str, **kwargs):
        """Legacy helper: update a whitelist identified by slug."""
        wl = await self.get_whitelist_by_slug(guild_id, whitelist_type)
        if not wl:
            return
        # Map old field names to new ones
        mapped = {}
        rename = {"github_filename": "output_filename"}
        # Fields that are dropped in new schema (ignored)
        dropped = {"github_enabled", "input_mode"}
        for key, value in kwargs.items():
            if key in dropped:
                continue
            mapped[rename.get(key, key)] = value
        if mapped:
            await self.update_whitelist(wl["id"], **mapped)

    # ── Role mappings ──

    async def get_role_mappings(self, guild_id: int, whitelist_id: Optional[int] = None) -> List[tuple]:
        if whitelist_id is not None:
            return await self.fetchall(
                """
                SELECT role_id, role_name, slot_limit, is_active
                FROM role_mappings
                WHERE guild_id=%s AND whitelist_id=%s
                ORDER BY slot_limit ASC, role_name ASC
                """,
                (guild_id, whitelist_id),
            )
        return await self.fetchall(
            """
            SELECT whitelist_id, role_id, role_name, slot_limit, is_active
            FROM role_mappings
            WHERE guild_id=%s
            ORDER BY whitelist_id, slot_limit ASC, role_name ASC
            """,
            (guild_id,),
        )

    async def add_role_mapping(self, guild_id: int, whitelist_id: int, role_id: int, role_name: str, slot_limit: int):
        if self.engine == "postgres":
            await self.execute(
                """
                INSERT INTO role_mappings (guild_id, whitelist_id, role_id, role_name, slot_limit, is_active, created_at)
                VALUES (%s, %s, %s, %s, %s, TRUE, %s)
                ON CONFLICT (guild_id, whitelist_id, role_id) DO UPDATE
                    SET role_name=EXCLUDED.role_name, slot_limit=EXCLUDED.slot_limit, is_active=TRUE
                """,
                (guild_id, whitelist_id, role_id, role_name, slot_limit, utcnow()),
            )
        else:
            await self.execute(
                """
                INSERT INTO role_mappings (guild_id, whitelist_id, role_id, role_name, slot_limit, is_active, created_at)
                VALUES (%s, %s, %s, %s, %s, 1, %s)
                ON DUPLICATE KEY UPDATE role_name=VALUES(role_name), slot_limit=VALUES(slot_limit), is_active=1
                """,
                (guild_id, whitelist_id, role_id, role_name, slot_limit, utcnow()),
            )

    async def remove_role_mapping(self, guild_id: int, whitelist_id: int, role_id: int):
        await self.execute(
            "DELETE FROM role_mappings WHERE guild_id=%s AND whitelist_id=%s AND role_id=%s",
            (guild_id, whitelist_id, role_id),
        )

    # ── Audit log ──

    async def audit(self, guild_id: int, action_type: str, actor: Optional[int], target: Optional[int], details: str, whitelist_id: Optional[int] = None):
        await self.execute(
            """
            INSERT INTO audit_log (guild_id, whitelist_id, action_type, actor_discord_id, target_discord_id, details, created_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            """,
            (guild_id, whitelist_id, action_type, actor, target, details, utcnow()),
        )

    # ── User records ──

    async def get_user_record(self, guild_id: int, discord_id: int, whitelist_id: int) -> Optional[tuple]:
        return await self.fetchone(
            """
            SELECT discord_name, status, slot_limit_override, effective_slot_limit, last_plan_name, updated_at, created_at
            FROM whitelist_users
            WHERE guild_id=%s AND discord_id=%s AND whitelist_id=%s
            """,
            (guild_id, discord_id, whitelist_id),
        )

    async def upsert_user_record(self, guild_id: int, discord_id: int, whitelist_id: int, discord_name: str, status: str, effective_slot_limit: int, last_plan_name: str, slot_limit_override: Optional[int] = None):
        now = utcnow()
        if self.engine == "postgres":
            await self.execute(
                """
                INSERT INTO whitelist_users
                (guild_id, discord_id, whitelist_id, discord_name, status, slot_limit_override, effective_slot_limit, last_plan_name, updated_at, created_at)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT ON CONSTRAINT uq_wu_guild_discord_wl DO UPDATE SET
                    discord_name=EXCLUDED.discord_name,
                    status=EXCLUDED.status,
                    slot_limit_override=EXCLUDED.slot_limit_override,
                    effective_slot_limit=EXCLUDED.effective_slot_limit,
                    last_plan_name=EXCLUDED.last_plan_name,
                    updated_at=EXCLUDED.updated_at
                """,
                (guild_id, discord_id, whitelist_id, discord_name, status, slot_limit_override, effective_slot_limit, last_plan_name, now, now),
            )
        else:
            await self.execute(
                """
                INSERT INTO whitelist_users
                (guild_id, discord_id, whitelist_id, discord_name, status, slot_limit_override, effective_slot_limit, last_plan_name, updated_at, created_at)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                ON DUPLICATE KEY UPDATE
                    discord_name=VALUES(discord_name),
                    status=VALUES(status),
                    slot_limit_override=VALUES(slot_limit_override),
                    effective_slot_limit=VALUES(effective_slot_limit),
                    last_plan_name=VALUES(last_plan_name),
                    updated_at=VALUES(updated_at)
                """,
                (guild_id, discord_id, whitelist_id, discord_name, status, slot_limit_override, effective_slot_limit, last_plan_name, now, now),
            )

    async def set_user_status(self, guild_id: int, discord_id: int, whitelist_id: int, status: str):
        await self.execute(
            "UPDATE whitelist_users SET status=%s, updated_at=%s WHERE guild_id=%s AND discord_id=%s AND whitelist_id=%s",
            (status, utcnow(), guild_id, discord_id, whitelist_id),
        )

    async def set_override(self, guild_id: int, discord_id: int, whitelist_id: int, override_slots: Optional[int]):
        await self.execute(
            "UPDATE whitelist_users SET slot_limit_override=%s, updated_at=%s WHERE guild_id=%s AND discord_id=%s AND whitelist_id=%s",
            (override_slots, utcnow(), guild_id, discord_id, whitelist_id),
        )

    # ── Identifiers ──

    async def replace_identifiers(self, guild_id: int, discord_id: int, whitelist_id: int, identifiers: List[Tuple[str, str, bool, str]]):
        now = utcnow()
        queries = [
            ("DELETE FROM whitelist_identifiers WHERE guild_id=%s AND discord_id=%s AND whitelist_id=%s", (guild_id, discord_id, whitelist_id)),
        ]
        for id_type, id_value, is_verified, verification_source in identifiers:
            verified = is_verified if self.engine == "postgres" else (1 if is_verified else 0)
            queries.append((
                """
                INSERT INTO whitelist_identifiers
                (guild_id, discord_id, whitelist_id, id_type, id_value, is_verified, verification_source, created_at, updated_at)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
                """,
                (guild_id, discord_id, whitelist_id, id_type, id_value, verified, verification_source, now, now),
            ))
        await self._adapter.execute_transaction(queries)

    async def get_identifiers(self, guild_id: int, discord_id: int, whitelist_id: int) -> List[tuple]:
        return await self.fetchall(
            """
            SELECT id_type, id_value, is_verified, verification_source
            FROM whitelist_identifiers
            WHERE guild_id=%s AND discord_id=%s AND whitelist_id=%s
            ORDER BY id_type, id_value
            """,
            (guild_id, discord_id, whitelist_id),
        )

    async def get_active_export_rows(self, guild_id: int) -> List[tuple]:
        return await self.fetchall(
            """
            SELECT w.slug, w.output_filename, u.discord_id, u.discord_name, i.id_type, i.id_value
            FROM whitelist_users u
            JOIN whitelists w ON w.id = u.whitelist_id
            JOIN whitelist_identifiers i
              ON u.guild_id=i.guild_id AND u.discord_id=i.discord_id AND u.whitelist_id=i.whitelist_id
            WHERE u.guild_id=%s AND u.status='active'
            ORDER BY w.slug, u.discord_name, i.id_type, i.id_value
            """,
            (guild_id,),
        )

    async def purge_inactive_older_than(self, guild_id: int, days: int) -> int:
        cutoff = utcnow() - timedelta(days=days)
        rows = await self.fetchall(
            "SELECT discord_id, whitelist_id FROM whitelist_users WHERE guild_id=%s AND status <> 'active' AND updated_at < %s",
            (guild_id, cutoff),
        )
        if not rows:
            await self.execute(
                "DELETE FROM audit_log WHERE guild_id=%s AND created_at < %s",
                (guild_id, cutoff),
            )
            return 0
        queries = []
        for discord_id, whitelist_id in rows:
            queries.append((
                "DELETE FROM whitelist_identifiers WHERE guild_id=%s AND discord_id=%s AND whitelist_id=%s",
                (guild_id, discord_id, whitelist_id),
            ))
            queries.append((
                "DELETE FROM whitelist_users WHERE guild_id=%s AND discord_id=%s AND whitelist_id=%s",
                (guild_id, discord_id, whitelist_id),
            ))
        queries.append((
            "DELETE FROM audit_log WHERE guild_id=%s AND created_at < %s",
            (guild_id, cutoff),
        ))
        await self._adapter.execute_transaction(queries)
        return len(rows)

    # ── Squad Groups & Permissions ──

    async def get_squad_groups(self, guild_id: int) -> List[tuple]:
        return await self.fetchall(
            "SELECT group_name, permissions, is_default FROM squad_groups WHERE guild_id=%s ORDER BY is_default DESC, group_name",
            (guild_id,),
        )

    async def get_squad_group(self, guild_id: int, group_name: str) -> Optional[tuple]:
        return await self.fetchone(
            "SELECT group_name, permissions, is_default FROM squad_groups WHERE guild_id=%s AND group_name=%s",
            (guild_id, group_name),
        )

    async def create_squad_group(self, guild_id: int, group_name: str, permissions: str, is_default: bool = False):
        now = utcnow()
        if self.engine == "postgres":
            await self.execute(
                """
                INSERT INTO squad_groups (guild_id, group_name, permissions, is_default, created_at, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s)
                """,
                (guild_id, group_name, permissions, is_default, now, now),
            )
        else:
            await self.execute(
                """
                INSERT INTO squad_groups (guild_id, group_name, permissions, is_default, created_at, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s)
                """,
                (guild_id, group_name, permissions, 1 if is_default else 0, now, now),
            )

    async def update_squad_group(self, guild_id: int, group_name: str, permissions: str):
        await self.execute(
            "UPDATE squad_groups SET permissions=%s, updated_at=%s WHERE guild_id=%s AND group_name=%s",
            (permissions, utcnow(), guild_id, group_name),
        )

    async def upsert_squad_group(self, guild_id: int, group_name: str, permissions: str, is_default: bool = False):
        now = utcnow()
        if self.engine == "postgres":
            await self.execute(
                """
                INSERT INTO squad_groups (guild_id, group_name, permissions, is_default, created_at, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s)
                ON CONFLICT (guild_id, group_name) DO UPDATE SET
                    permissions=EXCLUDED.permissions, is_default=EXCLUDED.is_default, updated_at=EXCLUDED.updated_at
                """,
                (guild_id, group_name, permissions, is_default, now, now),
            )
        else:
            await self.execute(
                """
                INSERT INTO squad_groups (guild_id, group_name, permissions, is_default, created_at, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s)
                ON DUPLICATE KEY UPDATE permissions=VALUES(permissions), is_default=VALUES(is_default), updated_at=VALUES(updated_at)
                """,
                (guild_id, group_name, permissions, 1 if is_default else 0, now, now),
            )

    async def delete_squad_group(self, guild_id: int, group_name: str):
        if self.engine == "postgres":
            await self.execute(
                "DELETE FROM squad_groups WHERE guild_id=%s AND group_name=%s AND is_default=FALSE",
                (guild_id, group_name),
            )
        else:
            await self.execute(
                "DELETE FROM squad_groups WHERE guild_id=%s AND group_name=%s AND is_default=0",
                (guild_id, group_name),
            )

    async def get_squad_permissions(self, active_only: bool = True) -> List[tuple]:
        if active_only:
            if self.engine == "postgres":
                return await self.fetchall("SELECT permission, description FROM squad_permissions WHERE is_active=TRUE ORDER BY permission")
            return await self.fetchall("SELECT permission, description FROM squad_permissions WHERE is_active=1 ORDER BY permission")
        return await self.fetchall("SELECT permission, description, is_active FROM squad_permissions ORDER BY permission")
