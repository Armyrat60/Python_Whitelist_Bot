import re
from datetime import timedelta
from typing import Optional, List, Tuple, Dict, Any
from urllib.parse import urlparse

from bot.config import (
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
    """Convert %s placeholders to PostgreSQL $1, $2, ... style."""
    counter = [0]

    def _replace(_match):
        counter[0] += 1
        return f"${counter[0]}"

    return _PG_PARAM_RE.sub(_replace, query)


# ─── Database adapter ────────────────────────────────────────────────────────

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
                self.pool = await asyncpg.create_pool(dsn=dsn, min_size=2, max_size=25, ssl=ssl_ctx, command_timeout=30)
            except Exception:
                # Retry without SSL (local dev)
                self.pool = await asyncpg.create_pool(dsn=dsn, min_size=2, max_size=25, command_timeout=30)
        else:
            self.pool = await asyncpg.create_pool(
                host=DB_HOST,
                port=DB_PORT,
                user=DB_USER,
                password=DB_PASSWORD,
                database=DB_NAME,
                min_size=2,
                max_size=25,
                command_timeout=30,
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


# ─── Schema ──────────────────────────────────────────────────────────────────

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
        description VARCHAR(255) NOT NULL DEFAULT '',
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
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP NOT NULL,
        updated_at TIMESTAMP NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS whitelist_roles (
        id SERIAL PRIMARY KEY,
        guild_id BIGINT NOT NULL,
        whitelist_id INTEGER NOT NULL,
        role_id BIGINT NOT NULL,
        role_name VARCHAR(100) NOT NULL,
        slot_limit INTEGER NOT NULL DEFAULT 1,
        is_stackable BOOLEAN NOT NULL DEFAULT FALSE,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        display_name VARCHAR(100),
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        FOREIGN KEY (whitelist_id) REFERENCES whitelists(id) ON DELETE CASCADE,
        UNIQUE (guild_id, whitelist_id, role_id)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS panel_refresh_queue (
        id SERIAL PRIMARY KEY,
        guild_id BIGINT NOT NULL,
        panel_id INT NOT NULL,
        reason VARCHAR(200) NOT NULL DEFAULT 'settings_changed',
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        processed BOOLEAN NOT NULL DEFAULT FALSE
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS notification_routing (
        guild_id BIGINT NOT NULL DEFAULT 0,
        event_type VARCHAR(50) NOT NULL,
        channel_id VARCHAR(20) NOT NULL DEFAULT '',
        PRIMARY KEY (guild_id, event_type)
    )
    """,
]

# ─── Migration statements ────────────────────────────────────────────────────
# These handle upgrading from the old whitelist_types schema to the new
# whitelists table.  They add whitelist_id columns to existing tables and
# migrate data from whitelist_type -> whitelists -> whitelist_id.

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

    # --- Clean up legacy whitelist_types table to prevent re-migration ---
    # This stops old clan/staff/subscription from being re-created after deletion
    "TRUNCATE TABLE whitelist_types",

    # --- Performance indexes ---
    "CREATE INDEX IF NOT EXISTS idx_wu_guild_wl ON whitelist_users (guild_id, whitelist_id)",
    "CREATE INDEX IF NOT EXISTS idx_wi_guild_wl ON whitelist_identifiers (guild_id, whitelist_id)",
    "CREATE INDEX IF NOT EXISTS idx_al_guild_created ON audit_log (guild_id, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_rm_guild_wl ON role_mappings (guild_id, whitelist_id)",
    "CREATE INDEX IF NOT EXISTS idx_wu_status ON whitelist_users (guild_id, whitelist_id, status)",

    # --- Tier categories migration ---
    "ALTER TABLE panels ADD COLUMN IF NOT EXISTS tier_category_id INT NULL",

    # --- Panel enabled column ---
    "ALTER TABLE panels ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT TRUE",

    # --- Timed whitelist: optional expiration ---
    "ALTER TABLE whitelist_users ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP NULL",

    # --- Registration source tracking ---
    "ALTER TABLE whitelist_users ADD COLUMN IF NOT EXISTS created_via VARCHAR(50) NULL",

    # --- Tier entry per-role stackable flag ---
    "ALTER TABLE tier_entries ADD COLUMN IF NOT EXISTS is_stackable BOOLEAN NOT NULL DEFAULT FALSE",

    # --- Fix duplicate is_default flags on squad_groups ---
    """
    UPDATE squad_groups
    SET is_default = FALSE
    WHERE is_default = TRUE
      AND group_name != (
          SELECT MIN(g2.group_name)
          FROM squad_groups g2
          WHERE g2.guild_id = squad_groups.guild_id
            AND g2.is_default = TRUE
      )
    """,

    # --- Steam name cache ---
    """
    CREATE TABLE IF NOT EXISTS steam_name_cache (
        steam_id VARCHAR(20) PRIMARY KEY,
        persona_name VARCHAR(255) NOT NULL,
        cached_at TIMESTAMP NOT NULL
    )
    """,

    # --- Squad group description column ---
    "ALTER TABLE squad_groups ADD COLUMN IF NOT EXISTS description VARCHAR(255) NOT NULL DEFAULT ''",

    # --- Per-panel role mention toggle ---
    "ALTER TABLE panels ADD COLUMN IF NOT EXISTS show_role_mentions BOOLEAN NOT NULL DEFAULT TRUE",

    # --- Panel refresh queue: action + message coordinates for delete support ---
    "ALTER TABLE panel_refresh_queue ADD COLUMN IF NOT EXISTS action VARCHAR(20) NOT NULL DEFAULT 'refresh'",
    "ALTER TABLE panel_refresh_queue ADD COLUMN IF NOT EXISTS channel_id BIGINT NULL",
    "ALTER TABLE panel_refresh_queue ADD COLUMN IF NOT EXISTS message_id BIGINT NULL",

    "ALTER TABLE panels DROP COLUMN IF EXISTS tier_category_id",
]


# ─── Database class (engine-agnostic) ────────────────────────────────────────

class Database:
    def __init__(self):
        self._adapter = _PostgresAdapter()

    async def connect(self):
        await self._adapter.connect()
        log.info("DB connected (engine=postgres)")

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
        for stmt in POSTGRES_SCHEMA:
            await self.execute(stmt)

        # Run migrations (idempotent)
        for stmt in POSTGRES_MIGRATIONS:
            try:
                await self.execute(stmt)
            except Exception as exc:
                # Column/constraint already exists or old constraint not found -- usually safe to ignore
                log.debug("Migration skipped (likely already applied): %s", str(exc)[:80])

        # Seed Squad permissions (global, no guild_id)
        for perm, desc in SQUAD_PERMISSIONS.items():
            await self.execute(
                """
                INSERT INTO squad_permissions (permission, description, is_active)
                VALUES (%s, %s, TRUE)
                ON CONFLICT (permission) DO UPDATE SET description=EXCLUDED.description
                """,
                (perm, desc),
            )

        # Note: guild defaults are seeded per-guild in bot on_ready / web startup
        # No longer seed for guild_id=0 (legacy artifact)

    async def seed_guild_defaults(self, guild_id: int):
        """Seed a default whitelist and default squad group for a guild if they don't exist."""
        now = utcnow()

        # Seed default Whitelist squad group
        await self.execute(
            """
            INSERT INTO squad_groups (guild_id, group_name, permissions, description, is_default, created_at, updated_at)
            VALUES (%s, %s, %s, %s, TRUE, %s, %s)
            ON CONFLICT (guild_id, group_name) DO NOTHING
            """,
            (guild_id, "Whitelist", "reserve", "Reserve slot for whitelisted players", now, now),
        )

        # Seed default settings
        for key, value in DEFAULT_SETTINGS.items():
            await self.execute(
                """
                INSERT INTO bot_settings (guild_id, setting_key, setting_value)
                VALUES (%s, %s, %s)
                ON CONFLICT (guild_id, setting_key) DO NOTHING
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
                    name="Whitelist 1",
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
                "SELECT id FROM panels WHERE guild_id=%s AND is_default=TRUE LIMIT 1",
                (guild_id,),
            )
            if not existing_panel:
                try:
                    await self.create_panel(
                        guild_id,
                        name="Panel 1",
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
        await self.execute(
            """
            INSERT INTO bot_settings (guild_id, setting_key, setting_value)
            VALUES (%s, %s, %s)
            ON CONFLICT (guild_id, setting_key) DO UPDATE SET setting_value=EXCLUDED.setting_value
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

    async def get_whitelist_by_id(self, whitelist_id: int) -> Optional[Dict[str, Any]]:
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

    async def get_default_whitelist(self, guild_id: int) -> Optional[Dict[str, Any]]:
        row = await self.fetchone(
            """
            SELECT id, guild_id, name, slug, enabled, panel_channel_id, panel_message_id,
                   log_channel_id, squad_group, output_filename, default_slot_limit,
                   stack_roles, is_default, created_at, updated_at
            FROM whitelists WHERE guild_id=%s AND is_default=TRUE LIMIT 1
            """,
            (guild_id,),
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
                if key in bool_cols:
                    value = bool(value)
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
        "whitelist_id", "panel_message_id", "is_default", "enabled",
        "show_role_mentions", "created_at", "updated_at",
    )

    def _row_to_panel(self, row: tuple) -> Dict[str, Any]:
        """Convert a raw DB row to a panel dict."""
        d = dict(zip(self._PANEL_COLUMNS, row))
        d["is_default"] = bool(d["is_default"])
        d["enabled"] = bool(d.get("enabled", True))
        d["show_role_mentions"] = bool(d.get("show_role_mentions", True))
        return d

    async def get_panels(self, guild_id: int) -> List[Dict[str, Any]]:
        rows = await self.fetchall(
            """
            SELECT id, guild_id, name, channel_id, log_channel_id,
                   whitelist_id, panel_message_id, is_default, enabled,
                   show_role_mentions, created_at, updated_at
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
                   whitelist_id, panel_message_id, is_default, enabled,
                   show_role_mentions, created_at, updated_at
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

        row = await self.execute_returning(
            """
            INSERT INTO panels (guild_id, name, channel_id, log_channel_id, whitelist_id,
             panel_message_id, is_default, created_at, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (guild_id, name, channel_id, log_channel_id, whitelist_id,
             panel_message_id, is_default, now, now),
        )
        return row[0]

    async def update_panel(self, panel_id: int, **kwargs):
        allowed = {
            "name", "channel_id", "log_channel_id", "whitelist_id",
            "panel_message_id", "is_default", "enabled",
            "show_role_mentions",
        }
        bool_cols = {"is_default", "enabled", "show_role_mentions"}
        parts = []
        params = []
        for key, value in kwargs.items():
            if key in allowed:
                if key in bool_cols:
                    value = bool(value)
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

    # ── Panel refresh queue ──

    async def queue_panel_refresh(self, guild_id: int, panel_id: int, reason: str = "settings_changed",
                                   action: str = "refresh", channel_id: int = None, message_id: int = None):
        """Queue a panel for Discord embed refresh or message deletion."""
        await self.execute(
            "INSERT INTO panel_refresh_queue (guild_id, panel_id, reason, action, channel_id, message_id, created_at) VALUES (%s, %s, %s, %s, %s, %s, %s)",
            (guild_id, panel_id, reason, action, channel_id, message_id, utcnow()),
        )

    async def queue_panels_for_whitelist(self, guild_id: int, whitelist_id: int, reason: str = "role_changed"):
        """Queue all panels linked to a whitelist for refresh."""
        panels = await self.fetchall(
            "SELECT id FROM panels WHERE guild_id=%s AND whitelist_id=%s",
            (guild_id, whitelist_id),
        )
        for row in panels:
            await self.queue_panel_refresh(guild_id, row[0], reason)

    async def get_pending_refreshes(self) -> List[tuple]:
        """Get unprocessed panel refreshes. Returns (id, guild_id, panel_id, reason, action, channel_id, message_id)."""
        return await self.fetchall(
            "SELECT id, guild_id, panel_id, reason, action, channel_id, message_id FROM panel_refresh_queue WHERE processed=FALSE ORDER BY created_at LIMIT 50",
            (),
        )

    async def mark_refresh_processed(self, refresh_id: int):
        await self.execute(
            "UPDATE panel_refresh_queue SET processed=TRUE WHERE id=%s",
            (refresh_id,),
        )

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

    # ── Notification routing ──

    async def get_notification_routing(self, guild_id: int) -> dict:
        """Return a dict of {event_type: channel_id} for the guild."""
        rows = await self.fetchall(
            "SELECT event_type, channel_id FROM notification_routing WHERE guild_id=%s",
            (guild_id,),
        )
        return {row[0]: row[1] for row in rows if row[1]}

    async def set_notification_routing(self, guild_id: int, event_type: str, channel_id: str):
        """Upsert a single routing entry. Empty channel_id removes the route."""
        if not channel_id:
            await self.execute(
                "DELETE FROM notification_routing WHERE guild_id=%s AND event_type=%s",
                (guild_id, event_type),
            )
            return
        await self.execute(
            """
            INSERT INTO notification_routing (guild_id, event_type, channel_id)
            VALUES (%s, %s, %s)
            ON CONFLICT (guild_id, event_type) DO UPDATE SET channel_id=EXCLUDED.channel_id
            """,
            (guild_id, event_type, channel_id),
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

    async def upsert_user_record(self, guild_id: int, discord_id: int, whitelist_id: int, discord_name: str, status: str, effective_slot_limit: int, last_plan_name: str, slot_limit_override: Optional[int] = None, expires_at=None, created_via: Optional[str] = None):
        now = utcnow()
        await self.execute(
            """
            INSERT INTO whitelist_users
            (guild_id, discord_id, whitelist_type, whitelist_id, discord_name, status, slot_limit_override, effective_slot_limit, last_plan_name, expires_at, updated_at, created_at, created_via)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT ON CONSTRAINT uq_wu_guild_discord_wl DO UPDATE SET
                discord_name=EXCLUDED.discord_name,
                status=EXCLUDED.status,
                slot_limit_override=EXCLUDED.slot_limit_override,
                effective_slot_limit=EXCLUDED.effective_slot_limit,
                last_plan_name=EXCLUDED.last_plan_name,
                expires_at=EXCLUDED.expires_at,
                updated_at=EXCLUDED.updated_at,
                created_via=COALESCE(whitelist_users.created_via, EXCLUDED.created_via)
            """,
            (guild_id, discord_id, '', whitelist_id, discord_name, status, slot_limit_override, effective_slot_limit, last_plan_name, expires_at, now, now, created_via),
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
            queries.append((
                """
                INSERT INTO whitelist_identifiers
                (guild_id, discord_id, whitelist_type, whitelist_id, id_type, id_value, is_verified, verification_source, created_at, updated_at)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                """,
                (guild_id, discord_id, '', whitelist_id, id_type, id_value, is_verified, verification_source, now, now),
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

    async def expire_timed_whitelists(self, guild_id: int) -> List[tuple]:
        """Deactivate whitelist entries that have passed their expires_at date.
        Returns list of (discord_id, whitelist_id) that were expired."""
        now = utcnow()
        rows = await self.fetchall(
            "SELECT discord_id, whitelist_id FROM whitelist_users "
            "WHERE guild_id=%s AND status='active' AND expires_at IS NOT NULL AND expires_at < %s",
            (guild_id, now),
        )
        for discord_id, whitelist_id in (rows or []):
            await self.execute(
                "UPDATE whitelist_users SET status='expired', updated_at=%s "
                "WHERE guild_id=%s AND discord_id=%s AND whitelist_id=%s",
                (now, guild_id, discord_id, whitelist_id),
            )
        return rows or []

    # ── Steam Name Cache ──

    async def get_steam_names(self, steam_ids: List[str]) -> dict:
        """Get cached Steam names. Returns {steam_id: persona_name}."""
        if not steam_ids:
            return {}
        placeholders = ",".join(["%s"] * len(steam_ids))
        rows = await self.fetchall(
            f"SELECT steam_id, persona_name FROM steam_name_cache WHERE steam_id IN ({placeholders})",
            tuple(steam_ids),
        )
        return {r[0]: r[1] for r in (rows or [])}

    async def cache_steam_names(self, names: dict):
        """Cache Steam names. names = {steam_id: persona_name}."""
        now = utcnow()
        for steam_id, name in names.items():
            await self.execute(
                "INSERT INTO steam_name_cache (steam_id, persona_name, cached_at) "
                "VALUES (%s, %s, %s) ON CONFLICT (steam_id) DO UPDATE SET persona_name=EXCLUDED.persona_name, cached_at=EXCLUDED.cached_at",
                (steam_id, name, now),
            )

    # ── Squad Groups & Permissions ──

    async def get_squad_groups(self, guild_id: int) -> List[tuple]:
        return await self.fetchall(
            "SELECT group_name, permissions, is_default, description FROM squad_groups WHERE guild_id=%s ORDER BY group_name",
            (guild_id,),
        )

    async def get_squad_group(self, guild_id: int, group_name: str) -> Optional[tuple]:
        return await self.fetchone(
            "SELECT group_name, permissions, is_default, description FROM squad_groups WHERE guild_id=%s AND group_name=%s",
            (guild_id, group_name),
        )

    async def create_squad_group(self, guild_id: int, group_name: str, permissions: str, is_default: bool = False, description: str = ""):
        now = utcnow()
        await self.execute(
            """
            INSERT INTO squad_groups (guild_id, group_name, permissions, description, is_default, created_at, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            """,
            (guild_id, group_name, permissions, description, is_default, now, now),
        )

    async def update_squad_group(self, guild_id: int, group_name: str, permissions: str, description: str = ""):
        await self.execute(
            "UPDATE squad_groups SET permissions=%s, description=%s, updated_at=%s WHERE guild_id=%s AND group_name=%s",
            (permissions, description, utcnow(), guild_id, group_name),
        )

    async def upsert_squad_group(self, guild_id: int, group_name: str, permissions: str, is_default: bool = False, description: str = ""):
        now = utcnow()
        await self.execute(
            """
            INSERT INTO squad_groups (guild_id, group_name, permissions, description, is_default, created_at, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (guild_id, group_name) DO UPDATE SET
                permissions=EXCLUDED.permissions, description=EXCLUDED.description, is_default=EXCLUDED.is_default, updated_at=EXCLUDED.updated_at
            """,
            (guild_id, group_name, permissions, description, is_default, now, now),
        )

    async def delete_squad_group(self, guild_id: int, group_name: str):
        await self.execute(
            "DELETE FROM squad_groups WHERE guild_id=%s AND group_name=%s",
            (guild_id, group_name),
        )

    async def get_squad_permissions(self, active_only: bool = True) -> List[tuple]:
        if active_only:
            return await self.fetchall("SELECT permission, description FROM squad_permissions WHERE is_active=TRUE ORDER BY permission")
        return await self.fetchall("SELECT permission, description, is_active FROM squad_permissions ORDER BY permission")

    # ── Whitelist Roles ──

    async def get_whitelist_roles(self, guild_id: int, whitelist_id: int) -> List[tuple]:
        """Get roles for a specific whitelist. Returns (id, role_id, role_name, slot_limit, display_name, sort_order, is_active, is_stackable)."""
        return await self.fetchall(
            """
            SELECT id, role_id, role_name, slot_limit, display_name, sort_order, is_active, is_stackable
            FROM whitelist_roles
            WHERE guild_id=%s AND whitelist_id=%s
            ORDER BY sort_order ASC, slot_limit ASC, role_name ASC
            """,
            (guild_id, whitelist_id),
        )

    async def get_all_whitelist_roles(self, guild_id: int) -> List[tuple]:
        """Get all whitelist roles for a guild. Returns (whitelist_id, role_id, role_name, slot_limit, is_active)."""
        return await self.fetchall(
            """
            SELECT whitelist_id, role_id, role_name, slot_limit, is_active
            FROM whitelist_roles
            WHERE guild_id=%s
            ORDER BY whitelist_id, slot_limit ASC, role_name ASC
            """,
            (guild_id,),
        )

    async def add_whitelist_role(self, guild_id: int, whitelist_id: int, role_id: int, role_name: str, slot_limit: int, display_name: str = None, sort_order: int = 0, is_stackable: bool = False) -> int:
        now = utcnow()
        row = await self.execute_returning(
            """
            INSERT INTO whitelist_roles (guild_id, whitelist_id, role_id, role_name, slot_limit, display_name, sort_order, is_active, is_stackable, created_at, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, TRUE, %s, %s, %s)
            ON CONFLICT (guild_id, whitelist_id, role_id) DO UPDATE
                SET role_name=EXCLUDED.role_name, slot_limit=EXCLUDED.slot_limit,
                    display_name=EXCLUDED.display_name, sort_order=EXCLUDED.sort_order,
                    is_active=TRUE, is_stackable=EXCLUDED.is_stackable, updated_at=EXCLUDED.updated_at
            RETURNING id
            """,
            (guild_id, whitelist_id, role_id, role_name, slot_limit, display_name, sort_order, is_stackable, now, now),
        )
        return row[0]

    async def remove_whitelist_role(self, guild_id: int, whitelist_id: int, role_id: int):
        await self.execute(
            "DELETE FROM whitelist_roles WHERE guild_id=%s AND whitelist_id=%s AND role_id=%s",
            (guild_id, whitelist_id, role_id),
        )
