import re
from datetime import timedelta
from typing import Optional, List, Tuple
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
        if DATABASE_URL:
            self.pool = await asyncpg.create_pool(dsn=DATABASE_URL, min_size=1, max_size=10)
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
        whitelist_type VARCHAR(20) NOT NULL,
        role_id BIGINT NOT NULL,
        role_name VARCHAR(255) NOT NULL,
        slot_limit INT NOT NULL,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        created_at DATETIME NOT NULL,
        UNIQUE KEY uq_guild_type_role (guild_id, whitelist_type, role_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    """,
    """
    CREATE TABLE IF NOT EXISTS whitelist_users (
        guild_id BIGINT NOT NULL DEFAULT 0,
        discord_id BIGINT NOT NULL,
        whitelist_type VARCHAR(20) NOT NULL,
        discord_name VARCHAR(255) NOT NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'active',
        slot_limit_override INT NULL,
        effective_slot_limit INT NOT NULL DEFAULT 0,
        last_plan_name VARCHAR(255) NULL,
        updated_at DATETIME NOT NULL,
        created_at DATETIME NOT NULL,
        PRIMARY KEY (guild_id, discord_id, whitelist_type)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    """,
    """
    CREATE TABLE IF NOT EXISTS whitelist_identifiers (
        id INT AUTO_INCREMENT PRIMARY KEY,
        guild_id BIGINT NOT NULL DEFAULT 0,
        discord_id BIGINT NOT NULL,
        whitelist_type VARCHAR(20) NOT NULL,
        id_type VARCHAR(20) NOT NULL,
        id_value VARCHAR(255) NOT NULL,
        is_verified TINYINT(1) NOT NULL DEFAULT 0,
        verification_source VARCHAR(100) NULL,
        created_at DATETIME NOT NULL,
        updated_at DATETIME NOT NULL,
        UNIQUE KEY uq_guild_user_identifier (guild_id, discord_id, whitelist_type, id_type, id_value)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    """,
    """
    CREATE TABLE IF NOT EXISTS audit_log (
        id INT AUTO_INCREMENT PRIMARY KEY,
        guild_id BIGINT NOT NULL DEFAULT 0,
        whitelist_type VARCHAR(20) NULL,
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
        whitelist_type VARCHAR(20) NOT NULL,
        role_id BIGINT NOT NULL,
        role_name VARCHAR(255) NOT NULL,
        slot_limit INT NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP NOT NULL,
        UNIQUE (guild_id, whitelist_type, role_id)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS whitelist_users (
        guild_id BIGINT NOT NULL DEFAULT 0,
        discord_id BIGINT NOT NULL,
        whitelist_type VARCHAR(20) NOT NULL,
        discord_name VARCHAR(255) NOT NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'active',
        slot_limit_override INT NULL,
        effective_slot_limit INT NOT NULL DEFAULT 0,
        last_plan_name VARCHAR(255) NULL,
        updated_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP NOT NULL,
        PRIMARY KEY (guild_id, discord_id, whitelist_type)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS whitelist_identifiers (
        id SERIAL PRIMARY KEY,
        guild_id BIGINT NOT NULL DEFAULT 0,
        discord_id BIGINT NOT NULL,
        whitelist_type VARCHAR(20) NOT NULL,
        id_type VARCHAR(20) NOT NULL,
        id_value VARCHAR(255) NOT NULL,
        is_verified BOOLEAN NOT NULL DEFAULT FALSE,
        verification_source VARCHAR(100) NULL,
        created_at TIMESTAMP NOT NULL,
        updated_at TIMESTAMP NOT NULL,
        UNIQUE (guild_id, discord_id, whitelist_type, id_type, id_value)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS audit_log (
        id SERIAL PRIMARY KEY,
        guild_id BIGINT NOT NULL DEFAULT 0,
        whitelist_type VARCHAR(20) NULL,
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
]

# ─── Migration statements to add guild_id to existing tables ─────────────────

MYSQL_MIGRATIONS = [
    # bot_settings: add guild_id, drop old PK, add new composite PK
    "ALTER TABLE bot_settings ADD COLUMN guild_id BIGINT NOT NULL DEFAULT 0",
    "ALTER TABLE bot_settings DROP PRIMARY KEY, ADD PRIMARY KEY (guild_id, setting_key)",
    # whitelist_types
    "ALTER TABLE whitelist_types ADD COLUMN guild_id BIGINT NOT NULL DEFAULT 0",
    "ALTER TABLE whitelist_types DROP PRIMARY KEY, ADD PRIMARY KEY (guild_id, whitelist_type)",
    # role_mappings
    "ALTER TABLE role_mappings ADD COLUMN guild_id BIGINT NOT NULL DEFAULT 0",
    "ALTER TABLE role_mappings DROP INDEX uq_type_role, ADD UNIQUE KEY uq_guild_type_role (guild_id, whitelist_type, role_id)",
    # whitelist_users
    "ALTER TABLE whitelist_users ADD COLUMN guild_id BIGINT NOT NULL DEFAULT 0",
    "ALTER TABLE whitelist_users DROP PRIMARY KEY, ADD PRIMARY KEY (guild_id, discord_id, whitelist_type)",
    # whitelist_identifiers
    "ALTER TABLE whitelist_identifiers ADD COLUMN guild_id BIGINT NOT NULL DEFAULT 0",
    "ALTER TABLE whitelist_identifiers DROP INDEX uq_user_identifier, ADD UNIQUE KEY uq_guild_user_identifier (guild_id, discord_id, whitelist_type, id_type, id_value)",
    # audit_log
    "ALTER TABLE audit_log ADD COLUMN guild_id BIGINT NOT NULL DEFAULT 0",
    "ALTER TABLE audit_log ADD INDEX idx_guild_created (guild_id, created_at)",
    # squad_groups
    "ALTER TABLE squad_groups ADD COLUMN guild_id BIGINT NOT NULL DEFAULT 0",
    "ALTER TABLE squad_groups DROP PRIMARY KEY, ADD PRIMARY KEY (guild_id, group_name)",
]

POSTGRES_MIGRATIONS = [
    # bot_settings
    "ALTER TABLE bot_settings ADD COLUMN IF NOT EXISTS guild_id BIGINT NOT NULL DEFAULT 0",
    "ALTER TABLE bot_settings DROP CONSTRAINT IF EXISTS bot_settings_pkey, ADD PRIMARY KEY (guild_id, setting_key)",
    # whitelist_types
    "ALTER TABLE whitelist_types ADD COLUMN IF NOT EXISTS guild_id BIGINT NOT NULL DEFAULT 0",
    "ALTER TABLE whitelist_types DROP CONSTRAINT IF EXISTS whitelist_types_pkey, ADD PRIMARY KEY (guild_id, whitelist_type)",
    # role_mappings
    "ALTER TABLE role_mappings ADD COLUMN IF NOT EXISTS guild_id BIGINT NOT NULL DEFAULT 0",
    "ALTER TABLE role_mappings DROP CONSTRAINT IF EXISTS role_mappings_whitelist_type_role_id_key",
    "ALTER TABLE role_mappings ADD CONSTRAINT role_mappings_guild_type_role_key UNIQUE (guild_id, whitelist_type, role_id)",
    # whitelist_users
    "ALTER TABLE whitelist_users ADD COLUMN IF NOT EXISTS guild_id BIGINT NOT NULL DEFAULT 0",
    "ALTER TABLE whitelist_users DROP CONSTRAINT IF EXISTS whitelist_users_pkey, ADD PRIMARY KEY (guild_id, discord_id, whitelist_type)",
    # whitelist_identifiers
    "ALTER TABLE whitelist_identifiers ADD COLUMN IF NOT EXISTS guild_id BIGINT NOT NULL DEFAULT 0",
    "ALTER TABLE whitelist_identifiers DROP CONSTRAINT IF EXISTS whitelist_identifiers_discord_id_whitelist_type_id_type_id_key",
    "ALTER TABLE whitelist_identifiers ADD CONSTRAINT whitelist_identifiers_guild_user_key UNIQUE (guild_id, discord_id, whitelist_type, id_type, id_value)",
    # audit_log
    "ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS guild_id BIGINT NOT NULL DEFAULT 0",
    "CREATE INDEX IF NOT EXISTS idx_audit_guild_created ON audit_log (guild_id, created_at)",
    # squad_groups
    "ALTER TABLE squad_groups ADD COLUMN IF NOT EXISTS guild_id BIGINT NOT NULL DEFAULT 0",
    "ALTER TABLE squad_groups DROP CONSTRAINT IF EXISTS squad_groups_pkey, ADD PRIMARY KEY (guild_id, group_name)",
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

    async def fetchone(self, query: str, params: tuple = ()) -> Optional[tuple]:
        return await self._adapter.fetchone(query, params)

    async def fetchall(self, query: str, params: tuple = ()) -> List[tuple]:
        return await self._adapter.fetchall(query, params)

    async def init_schema(self):
        schema = POSTGRES_SCHEMA if self.engine == "postgres" else MYSQL_SCHEMA
        for stmt in schema:
            await self.execute(stmt)

        # Run migrations to add guild_id to existing tables (idempotent)
        migrations = POSTGRES_MIGRATIONS if self.engine == "postgres" else MYSQL_MIGRATIONS
        for stmt in migrations:
            try:
                await self.execute(stmt)
            except Exception:
                # Column/constraint already exists or old constraint not found — safe to ignore
                pass

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

        # Seed defaults for guild_id=0 (legacy / fallback)
        await self.seed_guild_defaults(0)

    async def seed_guild_defaults(self, guild_id: int):
        """Seed default settings, whitelist types, and default squad group for a specific guild."""
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

        # Seed default whitelist types
        for whitelist_type, cfg in DEFAULT_TYPES.items():
            enabled = to_bool(cfg["enabled"])
            gh_enabled = to_bool(cfg["github_enabled"])
            stack = to_bool(cfg["stack_roles"])
            panel_ch = cfg["panel_channel_id"] or None
            panel_msg = cfg["panel_message_id"] or None
            log_ch = cfg["log_channel_id"] or None

            if self.engine == "postgres":
                await self.execute(
                    """
                    INSERT INTO whitelist_types
                    (guild_id, whitelist_type, enabled, panel_channel_id, panel_message_id, log_channel_id,
                     github_enabled, github_filename, input_mode, stack_roles, default_slot_limit, updated_at)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (guild_id, whitelist_type) DO NOTHING
                    """,
                    (guild_id, whitelist_type, enabled, panel_ch, panel_msg, log_ch,
                     gh_enabled, cfg["github_filename"], cfg["input_mode"],
                     stack, int(cfg["default_slot_limit"]), now),
                )
            else:
                await self.execute(
                    """
                    INSERT INTO whitelist_types
                    (guild_id, whitelist_type, enabled, panel_channel_id, panel_message_id, log_channel_id,
                     github_enabled, github_filename, input_mode, stack_roles, default_slot_limit, updated_at)
                    VALUES (%s, %s, %s, NULLIF(%s,''), NULLIF(%s,''), NULLIF(%s,''), %s, %s, %s, %s, %s, %s)
                    ON DUPLICATE KEY UPDATE updated_at = updated_at
                    """,
                    (guild_id, whitelist_type, 1 if enabled else 0,
                     cfg["panel_channel_id"], cfg["panel_message_id"], cfg["log_channel_id"],
                     1 if gh_enabled else 0, cfg["github_filename"], cfg["input_mode"],
                     1 if stack else 0, int(cfg["default_slot_limit"]), now),
                )

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

    # ── Type config ──

    async def get_type_config(self, guild_id: int, whitelist_type: str) -> Optional[dict]:
        row = await self.fetchone(
            """
            SELECT enabled, panel_channel_id, panel_message_id, log_channel_id, github_enabled,
                   github_filename, input_mode, stack_roles, default_slot_limit, squad_group
            FROM whitelist_types
            WHERE guild_id=%s AND whitelist_type=%s
            """,
            (guild_id, whitelist_type),
        )
        if not row:
            return None
        return {
            "enabled": bool(row[0]),
            "panel_channel_id": row[1],
            "panel_message_id": row[2],
            "log_channel_id": row[3],
            "github_enabled": bool(row[4]),
            "github_filename": row[5],
            "input_mode": row[6],
            "stack_roles": bool(row[7]),
            "default_slot_limit": int(row[8]),
            "squad_group": row[9] or "Whitelist",
        }

    async def set_type_config(self, guild_id: int, whitelist_type: str, **kwargs):
        allowed = {
            "enabled", "panel_channel_id", "panel_message_id", "log_channel_id",
            "github_enabled", "github_filename", "input_mode", "stack_roles",
            "default_slot_limit", "squad_group"
        }
        parts = []
        params = []
        for key, value in kwargs.items():
            if key in allowed:
                parts.append(f"{key}=%s")
                params.append(value)
        if not parts:
            return
        parts.append("updated_at=%s")
        params.append(utcnow())
        params.append(guild_id)
        params.append(whitelist_type)
        await self.execute(
            f"UPDATE whitelist_types SET {', '.join(parts)} WHERE guild_id=%s AND whitelist_type=%s",
            tuple(params),
        )

    # ── Role mappings ──

    async def get_role_mappings(self, guild_id: int, whitelist_type: Optional[str] = None) -> List[tuple]:
        if whitelist_type:
            return await self.fetchall(
                """
                SELECT role_id, role_name, slot_limit, is_active
                FROM role_mappings
                WHERE guild_id=%s AND whitelist_type=%s
                ORDER BY slot_limit ASC, role_name ASC
                """,
                (guild_id, whitelist_type),
            )
        return await self.fetchall(
            """
            SELECT whitelist_type, role_id, role_name, slot_limit, is_active
            FROM role_mappings
            WHERE guild_id=%s
            ORDER BY whitelist_type, slot_limit ASC, role_name ASC
            """,
            (guild_id,),
        )

    async def add_role_mapping(self, guild_id: int, whitelist_type: str, role_id: int, role_name: str, slot_limit: int):
        if self.engine == "postgres":
            await self.execute(
                """
                INSERT INTO role_mappings (guild_id, whitelist_type, role_id, role_name, slot_limit, is_active, created_at)
                VALUES (%s, %s, %s, %s, %s, TRUE, %s)
                ON CONFLICT (guild_id, whitelist_type, role_id) DO UPDATE
                    SET role_name=EXCLUDED.role_name, slot_limit=EXCLUDED.slot_limit, is_active=TRUE
                """,
                (guild_id, whitelist_type, role_id, role_name, slot_limit, utcnow()),
            )
        else:
            await self.execute(
                """
                INSERT INTO role_mappings (guild_id, whitelist_type, role_id, role_name, slot_limit, is_active, created_at)
                VALUES (%s, %s, %s, %s, %s, 1, %s)
                ON DUPLICATE KEY UPDATE role_name=VALUES(role_name), slot_limit=VALUES(slot_limit), is_active=1
                """,
                (guild_id, whitelist_type, role_id, role_name, slot_limit, utcnow()),
            )

    async def remove_role_mapping(self, guild_id: int, whitelist_type: str, role_id: int):
        await self.execute(
            "DELETE FROM role_mappings WHERE guild_id=%s AND whitelist_type=%s AND role_id=%s",
            (guild_id, whitelist_type, role_id),
        )

    # ── Audit log ──

    async def audit(self, guild_id: int, action_type: str, actor: Optional[int], target: Optional[int], details: str, whitelist_type: Optional[str] = None):
        await self.execute(
            """
            INSERT INTO audit_log (guild_id, whitelist_type, action_type, actor_discord_id, target_discord_id, details, created_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            """,
            (guild_id, whitelist_type, action_type, actor, target, details, utcnow()),
        )

    # ── User records ──

    async def get_user_record(self, guild_id: int, discord_id: int, whitelist_type: str) -> Optional[tuple]:
        return await self.fetchone(
            """
            SELECT discord_name, status, slot_limit_override, effective_slot_limit, last_plan_name, updated_at, created_at
            FROM whitelist_users
            WHERE guild_id=%s AND discord_id=%s AND whitelist_type=%s
            """,
            (guild_id, discord_id, whitelist_type),
        )

    async def upsert_user_record(self, guild_id: int, discord_id: int, whitelist_type: str, discord_name: str, status: str, effective_slot_limit: int, last_plan_name: str, slot_limit_override: Optional[int] = None):
        now = utcnow()
        if self.engine == "postgres":
            await self.execute(
                """
                INSERT INTO whitelist_users
                (guild_id, discord_id, whitelist_type, discord_name, status, slot_limit_override, effective_slot_limit, last_plan_name, updated_at, created_at)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT (guild_id, discord_id, whitelist_type) DO UPDATE SET
                    discord_name=EXCLUDED.discord_name,
                    status=EXCLUDED.status,
                    slot_limit_override=EXCLUDED.slot_limit_override,
                    effective_slot_limit=EXCLUDED.effective_slot_limit,
                    last_plan_name=EXCLUDED.last_plan_name,
                    updated_at=EXCLUDED.updated_at
                """,
                (guild_id, discord_id, whitelist_type, discord_name, status, slot_limit_override, effective_slot_limit, last_plan_name, now, now),
            )
        else:
            await self.execute(
                """
                INSERT INTO whitelist_users
                (guild_id, discord_id, whitelist_type, discord_name, status, slot_limit_override, effective_slot_limit, last_plan_name, updated_at, created_at)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                ON DUPLICATE KEY UPDATE
                    discord_name=VALUES(discord_name),
                    status=VALUES(status),
                    slot_limit_override=VALUES(slot_limit_override),
                    effective_slot_limit=VALUES(effective_slot_limit),
                    last_plan_name=VALUES(last_plan_name),
                    updated_at=VALUES(updated_at)
                """,
                (guild_id, discord_id, whitelist_type, discord_name, status, slot_limit_override, effective_slot_limit, last_plan_name, now, now),
            )

    async def set_user_status(self, guild_id: int, discord_id: int, whitelist_type: str, status: str):
        await self.execute(
            "UPDATE whitelist_users SET status=%s, updated_at=%s WHERE guild_id=%s AND discord_id=%s AND whitelist_type=%s",
            (status, utcnow(), guild_id, discord_id, whitelist_type),
        )

    async def set_override(self, guild_id: int, discord_id: int, whitelist_type: str, override_slots: Optional[int]):
        await self.execute(
            "UPDATE whitelist_users SET slot_limit_override=%s, updated_at=%s WHERE guild_id=%s AND discord_id=%s AND whitelist_type=%s",
            (override_slots, utcnow(), guild_id, discord_id, whitelist_type),
        )

    # ── Identifiers ──

    async def replace_identifiers(self, guild_id: int, discord_id: int, whitelist_type: str, identifiers: List[Tuple[str, str, bool, str]]):
        now = utcnow()
        queries = [
            ("DELETE FROM whitelist_identifiers WHERE guild_id=%s AND discord_id=%s AND whitelist_type=%s", (guild_id, discord_id, whitelist_type)),
        ]
        for id_type, id_value, is_verified, verification_source in identifiers:
            verified = is_verified if self.engine == "postgres" else (1 if is_verified else 0)
            queries.append((
                """
                INSERT INTO whitelist_identifiers
                (guild_id, discord_id, whitelist_type, id_type, id_value, is_verified, verification_source, created_at, updated_at)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
                """,
                (guild_id, discord_id, whitelist_type, id_type, id_value, verified, verification_source, now, now),
            ))
        await self._adapter.execute_transaction(queries)

    async def get_identifiers(self, guild_id: int, discord_id: int, whitelist_type: str) -> List[tuple]:
        return await self.fetchall(
            """
            SELECT id_type, id_value, is_verified, verification_source
            FROM whitelist_identifiers
            WHERE guild_id=%s AND discord_id=%s AND whitelist_type=%s
            ORDER BY id_type, id_value
            """,
            (guild_id, discord_id, whitelist_type),
        )

    async def get_active_export_rows(self, guild_id: int) -> List[tuple]:
        return await self.fetchall(
            """
            SELECT u.whitelist_type, u.discord_id, u.discord_name, i.id_type, i.id_value
            FROM whitelist_users u
            JOIN whitelist_identifiers i
              ON u.guild_id=i.guild_id AND u.discord_id=i.discord_id AND u.whitelist_type=i.whitelist_type
            WHERE u.guild_id=%s AND u.status='active'
            ORDER BY u.whitelist_type, u.discord_name, i.id_type, i.id_value
            """,
            (guild_id,),
        )

    async def purge_inactive_older_than(self, guild_id: int, days: int) -> int:
        cutoff = utcnow() - timedelta(days=days)
        rows = await self.fetchall(
            "SELECT discord_id, whitelist_type FROM whitelist_users WHERE guild_id=%s AND status <> 'active' AND updated_at < %s",
            (guild_id, cutoff),
        )
        if not rows:
            await self.execute(
                "DELETE FROM audit_log WHERE guild_id=%s AND created_at < %s",
                (guild_id, cutoff),
            )
            return 0
        queries = []
        for discord_id, whitelist_type in rows:
            queries.append((
                "DELETE FROM whitelist_identifiers WHERE guild_id=%s AND discord_id=%s AND whitelist_type=%s",
                (guild_id, discord_id, whitelist_type),
            ))
            queries.append((
                "DELETE FROM whitelist_users WHERE guild_id=%s AND discord_id=%s AND whitelist_type=%s",
                (guild_id, discord_id, whitelist_type),
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
