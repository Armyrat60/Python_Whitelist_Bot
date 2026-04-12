import asyncio
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

_DB_RETRIES = 3
_DB_RETRY_DELAY = 0.5  # seconds between retries (doubles each attempt)


async def _db_retry(fn, *args, **kwargs):
    """Retry a coroutine on transient DB errors (timeout, connection lost).

    Covers Railway postgres waking from idle and brief network blips.
    Raises on the final attempt.
    """
    import asyncpg
    _transient = (
        asyncio.TimeoutError,
        asyncpg.exceptions.TooManyConnectionsError,
        asyncpg.exceptions.ConnectionDoesNotExistError,
        asyncpg.exceptions.ConnectionFailureError,
        asyncpg.exceptions.CannotConnectNowError,
    )
    delay = _DB_RETRY_DELAY
    for attempt in range(_DB_RETRIES):
        try:
            return await fn(*args, **kwargs)
        except _transient as exc:
            if attempt == _DB_RETRIES - 1:
                raise
            log.warning("DB transient error (attempt %d/%d): %s — retrying in %.1fs",
                        attempt + 1, _DB_RETRIES, exc, delay)
            await asyncio.sleep(delay)
            delay *= 2


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
        async def _run():
            async with self.pool.acquire() as conn:
                result = await conn.execute(pg_query, *params)
                parts = result.split() if result else []
                return int(parts[-1]) if parts and parts[-1].isdigit() else 0
        return await _db_retry(_run)

    async def execute_returning(self, query: str, params: tuple = ()) -> Optional[tuple]:
        """Execute an INSERT ... RETURNING and return the row."""
        pg_query = _to_pg_params(query)
        async def _run():
            async with self.pool.acquire() as conn:
                row = await conn.fetchrow(pg_query, *params)
                return tuple(row.values()) if row else None
        return await _db_retry(_run)

    async def fetchone(self, query: str, params: tuple = ()) -> Optional[tuple]:
        pg_query = _to_pg_params(query)
        async def _run():
            async with self.pool.acquire() as conn:
                row = await conn.fetchrow(pg_query, *params)
                return tuple(row.values()) if row else None
        return await _db_retry(_run)

    async def fetchall(self, query: str, params: tuple = ()) -> List[tuple]:
        pg_query = _to_pg_params(query)
        async def _run():
            async with self.pool.acquire() as conn:
                rows = await conn.fetch(pg_query, *params)
                return [tuple(r.values()) for r in rows]
        return await _db_retry(_run)

    async def execute_transaction(self, queries: List[Tuple[str, tuple]]):
        async def _run():
            async with self.pool.acquire() as conn:
                async with conn.transaction():
                    for query, params in queries:
                        pg_query = _to_pg_params(query)
                        await conn.execute(pg_query, *params)
        return await _db_retry(_run)


# ─── Schema ──────────────────────────────────────────────────────────────────
#
# Schema definitions and incremental migrations have moved to Prisma. The
# canonical source of truth is `api/prisma/schema.prisma`, applied to the
# database via `prisma migrate deploy` (run by Railway as the API service's
# preDeployCommand). The bot is now a CONSUMER of the schema only — it must
# never run DDL.
#
# See:
#   - api/prisma/schema.prisma            (model definitions)
#   - api/prisma/migrations/              (migration history)
#   - api/scripts/db-snapshot-checklist.md (data-safety checklist)
#   - bot/database.py: Database.verify_schema() (read-only health check)

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

    async def verify_schema(self):
        """Verify that the database has been migrated by Prisma.

        Reads `_prisma_migrations` and refuses to start if no migrations have
        been applied. This is the safety net against the bot starting against
        an unmigrated DB (e.g. the API service hasn't deployed yet, or
        DATABASE_URL points at the wrong instance).

        Read-only — never runs DDL. All schema changes go through
        `prisma migrate deploy` from the api service.
        """
        try:
            row = await self.fetchone(
                """
                SELECT migration_name
                FROM _prisma_migrations
                WHERE finished_at IS NOT NULL
                ORDER BY finished_at DESC
                LIMIT 1
                """
            )
        except Exception as exc:
            raise RuntimeError(
                "Database has not been migrated by Prisma — `_prisma_migrations` "
                "is missing or unreadable. Run `prisma migrate deploy` from the "
                "api service first, then restart the bot. "
                f"Underlying error: {exc}"
            )

        if not row:
            raise RuntimeError(
                "Database has no applied Prisma migrations. Run "
                "`prisma migrate deploy` from the api service first, then "
                "restart the bot."
            )

        log.info("DB schema verified — latest applied migration: %s", row[0])

    async def seed_global_defaults(self):
        """Seed global (non-per-guild) reference data.

        Currently only the `squad_permissions` lookup table. Idempotent —
        safe to run on every startup.
        """
        for perm, desc in SQUAD_PERMISSIONS.items():
            await self.execute(
                """
                INSERT INTO squad_permissions (permission, description, is_active)
                VALUES (%s, %s, TRUE)
                ON CONFLICT (permission) DO UPDATE SET description=EXCLUDED.description
                """,
                (perm, desc),
            )

    async def seed_guild_defaults(self, guild_id: int):
        """Seed a default whitelist and default squad group for a guild if they don't exist."""
        now = utcnow()

        # Clean up legacy lowercase "reserve" group if the canonical "Reserve" also exists.
        # The seeding-service uses "Reserve" (capitalized); the bot used to seed "reserve"
        # (lowercase). Postgres PKs are case-sensitive so both could coexist as duplicates.
        # Migrate any whitelists pointing at the old name, then delete the old row.
        try:
            await self.execute(
                "UPDATE whitelists SET squad_group='Reserve' WHERE guild_id=%s AND squad_group='reserve'",
                (guild_id,),
            )
            await self.execute(
                "DELETE FROM squad_groups WHERE guild_id=%s AND group_name='reserve'",
                (guild_id,),
            )
        except Exception:
            pass  # Old row may not exist — that's fine

        # Seed default Whitelist squad group
        await self.execute(
            """
            INSERT INTO squad_groups (guild_id, group_name, permissions, description, is_default, created_at, updated_at)
            VALUES (%s, %s, %s, %s, TRUE, %s, %s)
            ON CONFLICT (guild_id, group_name) DO NOTHING
            """,
            (guild_id, "Reserve", "reserve", "Reserve slot for whitelisted players", now, now),
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
                    squad_group="Reserve",
                    output_filename="whitelist.txt",
                    default_slot_limit=0,
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

        # Only seed a default panel if NO panels exist at all (first-time setup)
        if wl_id:
            existing_panel = await self.fetchone(
                "SELECT id FROM panels WHERE guild_id=%s LIMIT 1",
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
        "default_slot_limit", "stack_roles", "is_default", "is_manual", "created_at", "updated_at",
    )

    def _row_to_whitelist(self, row: tuple) -> Dict[str, Any]:
        """Convert a raw DB row to a whitelist dict."""
        d = dict(zip(self._WHITELIST_COLUMNS, row))
        d["enabled"] = bool(d["enabled"])
        d["stack_roles"] = bool(d["stack_roles"])
        d["is_default"] = bool(d["is_default"])
        d["is_manual"] = bool(d.get("is_manual", False))
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
        default_slot_limit = kwargs.get("default_slot_limit", 0)
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
                   stack_roles, is_default, is_manual, created_at, updated_at
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
                   stack_roles, is_default, is_manual, created_at, updated_at
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
                   stack_roles, is_default, is_manual, created_at, updated_at
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
                   stack_roles, is_default, is_manual, created_at, updated_at
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
                   stack_roles, is_default, is_manual, created_at, updated_at
            FROM whitelists WHERE guild_id=%s AND is_default=TRUE LIMIT 1
            """,
            (guild_id,),
        )
        return self._row_to_whitelist(row) if row else None

    async def update_whitelist(self, whitelist_id: int, **kwargs):
        allowed = {
            "name", "slug", "enabled", "panel_channel_id", "panel_message_id",
            "log_channel_id", "squad_group", "output_filename", "default_slot_limit",
            "stack_roles", "is_default", "is_manual",
        }
        bool_cols = {"enabled", "stack_roles", "is_default", "is_manual"}
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

    # ── Categories ──

    _CATEGORY_COLUMNS = ("id", "guild_id", "whitelist_id", "name", "slot_limit", "sort_order", "created_at", "updated_at")

    def _row_to_category(self, row: tuple) -> Dict[str, Any]:
        d = dict(zip(self._CATEGORY_COLUMNS, row))
        if d.get("slot_limit") is not None:
            d["slot_limit"] = int(d["slot_limit"])
        d["sort_order"] = int(d["sort_order"])
        return d

    async def get_categories(self, guild_id: int, whitelist_id: int) -> List[Dict[str, Any]]:
        rows = await self.fetchall(
            """
            SELECT id, guild_id, whitelist_id, name, slot_limit, sort_order, created_at, updated_at
            FROM whitelist_categories
            WHERE guild_id=%s AND whitelist_id=%s
            ORDER BY sort_order ASC, name ASC
            """,
            (guild_id, whitelist_id),
        )
        return [self._row_to_category(r) for r in rows]

    async def create_category(self, guild_id: int, whitelist_id: int, name: str,
                               slot_limit: Optional[int] = None, sort_order: int = 0) -> Dict[str, Any]:
        now = utcnow()
        row = await self.execute_returning(
            """
            INSERT INTO whitelist_categories (guild_id, whitelist_id, name, slot_limit, sort_order, created_at, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            RETURNING id, guild_id, whitelist_id, name, slot_limit, sort_order, created_at, updated_at
            """,
            (guild_id, whitelist_id, name, slot_limit, sort_order, now, now),
        )
        return self._row_to_category(row)

    async def update_category(self, category_id: int, name: Optional[str] = None,
                               slot_limit: Optional[int] = None, sort_order: Optional[int] = None) -> Dict[str, Any]:
        parts = []
        params = []
        if name is not None:
            parts.append("name=%s")
            params.append(name)
        if slot_limit is not None:
            parts.append("slot_limit=%s")
            params.append(slot_limit)
        if sort_order is not None:
            parts.append("sort_order=%s")
            params.append(sort_order)
        parts.append("updated_at=%s")
        params.append(utcnow())
        params.append(category_id)
        await self.execute(
            f"UPDATE whitelist_categories SET {', '.join(parts)} WHERE id=%s",
            tuple(params),
        )
        row = await self.fetchone(
            """
            SELECT id, guild_id, whitelist_id, name, slot_limit, sort_order, created_at, updated_at
            FROM whitelist_categories WHERE id=%s
            """,
            (category_id,),
        )
        return self._row_to_category(row) if row else {}

    async def delete_category(self, category_id: int):
        await self.execute("DELETE FROM whitelist_categories WHERE id=%s", (category_id,))

    _CATEGORY_MANAGER_COLUMNS = ("id", "category_id", "discord_id", "discord_name", "added_at")

    def _row_to_category_manager(self, row: tuple) -> Dict[str, Any]:
        return dict(zip(self._CATEGORY_MANAGER_COLUMNS, row))

    async def get_category_managers(self, category_id: int) -> List[Dict[str, Any]]:
        rows = await self.fetchall(
            """
            SELECT id, category_id, discord_id, discord_name, added_at
            FROM category_managers WHERE category_id=%s
            ORDER BY added_at ASC
            """,
            (category_id,),
        )
        return [self._row_to_category_manager(r) for r in rows]

    async def add_category_manager(self, category_id: int, discord_id: int, discord_name: str) -> Dict[str, Any]:
        row = await self.execute_returning(
            """
            INSERT INTO category_managers (category_id, discord_id, discord_name)
            VALUES (%s, %s, %s)
            ON CONFLICT (category_id, discord_id) DO UPDATE SET discord_name=EXCLUDED.discord_name
            RETURNING id, category_id, discord_id, discord_name, added_at
            """,
            (category_id, discord_id, discord_name),
        )
        return self._row_to_category_manager(row)

    async def remove_category_manager(self, category_id: int, discord_id: int):
        await self.execute(
            "DELETE FROM category_managers WHERE category_id=%s AND discord_id=%s",
            (category_id, discord_id),
        )

    # ── Panels ──

    _PANEL_COLUMNS = (
        "id", "guild_id", "name", "channel_id", "log_channel_id",
        "whitelist_id", "panel_message_id", "is_default", "enabled",
        "show_role_mentions", "last_push_status", "last_push_error", "last_push_at",
        "created_at", "updated_at",
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
                   show_role_mentions, last_push_status, last_push_error, last_push_at,
                   created_at, updated_at
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
                   show_role_mentions, last_push_status, last_push_error, last_push_at,
                   created_at, updated_at
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
            "show_role_mentions", "last_push_status", "last_push_error", "last_push_at",
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

    async def upsert_user_record(self, guild_id: int, discord_id: int, whitelist_id: int, discord_name: str, status: str, effective_slot_limit: int, last_plan_name: str, slot_limit_override: Optional[int] = None, expires_at=None, created_via: Optional[str] = None, discord_username: Optional[str] = None, discord_nick: Optional[str] = None, clan_tag: Optional[str] = None, role_gained_at=None, role_lost_at="__unset__"):
        now = utcnow()
        # role_lost_at sentinel: "__unset__" means don't touch the column,
        # None means explicitly clear it, a datetime means set it.
        role_lost_at_sql = "whitelist_users.role_lost_at"  # preserve existing
        params_extra = []
        if role_lost_at != "__unset__":
            role_lost_at_sql = "EXCLUDED.role_lost_at"
        await self.execute(
            f"""
            INSERT INTO whitelist_users
            (guild_id, discord_id, whitelist_type, whitelist_id, discord_name, status, slot_limit_override, effective_slot_limit, last_plan_name, expires_at, updated_at, created_at, created_via, discord_username, discord_nick, clan_tag, role_gained_at, role_lost_at)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT ON CONSTRAINT uq_wu_guild_discord_wl DO UPDATE SET
                discord_name=EXCLUDED.discord_name,
                status=EXCLUDED.status,
                slot_limit_override=EXCLUDED.slot_limit_override,
                effective_slot_limit=EXCLUDED.effective_slot_limit,
                last_plan_name=EXCLUDED.last_plan_name,
                expires_at=EXCLUDED.expires_at,
                updated_at=EXCLUDED.updated_at,
                created_via=COALESCE(whitelist_users.created_via, EXCLUDED.created_via),
                discord_username=COALESCE(EXCLUDED.discord_username, whitelist_users.discord_username),
                discord_nick=COALESCE(EXCLUDED.discord_nick, whitelist_users.discord_nick),
                clan_tag=COALESCE(EXCLUDED.clan_tag, whitelist_users.clan_tag),
                role_gained_at=COALESCE(whitelist_users.role_gained_at, EXCLUDED.role_gained_at),
                role_lost_at={role_lost_at_sql}
            """,
            (guild_id, discord_id, '', whitelist_id, discord_name, status, slot_limit_override, effective_slot_limit, last_plan_name, expires_at, now, now, created_via, discord_username, discord_nick, clan_tag, role_gained_at or now, role_lost_at if role_lost_at != "__unset__" else None),
        )

    async def set_user_status(self, guild_id: int, discord_id: int, whitelist_id: int, status: str, role_lost_at="__unset__"):
        now = utcnow()
        if role_lost_at != "__unset__":
            await self.execute(
                "UPDATE whitelist_users SET status=%s, role_lost_at=%s, updated_at=%s WHERE guild_id=%s AND discord_id=%s AND whitelist_id=%s",
                (status, role_lost_at, now, guild_id, discord_id, whitelist_id),
            )
        else:
            await self.execute(
                "UPDATE whitelist_users SET status=%s, updated_at=%s WHERE guild_id=%s AND discord_id=%s AND whitelist_id=%s",
                (status, now, guild_id, discord_id, whitelist_id),
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
            # Remove orphaned entries (negative discord_id) for same ID to prevent conflicts
            queries.append((
                "DELETE FROM whitelist_identifiers WHERE guild_id=%s AND id_value=%s AND discord_id < 0",
                (guild_id, id_value),
            ))
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

    async def check_user_linked(self, guild_id: int, discord_id: int) -> bool:
        """Check if user has at least one truly verified identifier (Steam login, Discord connection, bridge, or in-game code)."""
        row = await self.fetchone(
            """
            SELECT 1 FROM whitelist_identifiers
            WHERE guild_id=%s AND discord_id=%s AND is_verified=TRUE
              AND verification_source IN ('discord_connection', 'steam_openid', 'bridge', 'in_game_code')
            LIMIT 1
            """,
            (guild_id, discord_id),
        )
        return bool(row)

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

    async def get_disabled_squad_group_names(self, guild_id: int) -> List[str]:
        rows = await self.fetchall(
            "SELECT group_name FROM squad_groups WHERE guild_id=%s AND enabled=FALSE",
            (guild_id,),
        )
        return [r[0] for r in rows]

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

    # ── Panel Roles ──

    async def get_panel_roles(self, guild_id: int, panel_id: int) -> List[tuple]:
        """Get roles for a specific panel. Returns (id, role_id, role_name, slot_limit, display_name, sort_order, is_active, is_stackable)."""
        return await self.fetchall(
            """
            SELECT id, role_id, role_name, slot_limit, display_name, sort_order, is_active, is_stackable
            FROM panel_roles
            WHERE guild_id=%s AND panel_id=%s
            ORDER BY sort_order ASC, slot_limit ASC, role_name ASC
            """,
            (guild_id, panel_id),
        )

    async def get_all_panel_roles(self, guild_id: int) -> List[tuple]:
        """Get all panel roles for a guild joined with panel whitelist_id. Returns (panel_id, whitelist_id, role_id, role_name, slot_limit, is_active)."""
        return await self.fetchall(
            """
            SELECT pr.panel_id, p.whitelist_id, pr.role_id, pr.role_name, pr.slot_limit, pr.is_active
            FROM panel_roles pr
            JOIN panels p ON p.id = pr.panel_id
            WHERE pr.guild_id=%s
            ORDER BY pr.panel_id, pr.slot_limit ASC, pr.role_name ASC
            """,
            (guild_id,),
        )

    async def add_panel_role(self, guild_id: int, panel_id: int, role_id: int, role_name: str, slot_limit: int, display_name: str = None, sort_order: int = 0, is_stackable: bool = False) -> int:
        now = utcnow()
        row = await self.execute_returning(
            """
            INSERT INTO panel_roles (guild_id, panel_id, role_id, role_name, slot_limit, display_name, sort_order, is_active, is_stackable, created_at, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, TRUE, %s, %s, %s)
            ON CONFLICT (guild_id, panel_id, role_id) DO UPDATE
                SET role_name=EXCLUDED.role_name, slot_limit=EXCLUDED.slot_limit,
                    display_name=EXCLUDED.display_name, sort_order=EXCLUDED.sort_order,
                    is_active=TRUE, is_stackable=EXCLUDED.is_stackable, updated_at=EXCLUDED.updated_at
            RETURNING id
            """,
            (guild_id, panel_id, role_id, role_name, slot_limit, display_name, sort_order, is_stackable, now, now),
        )
        return row[0]

    async def remove_panel_role(self, guild_id: int, panel_id: int, role_id: int):
        await self.execute(
            "DELETE FROM panel_roles WHERE guild_id=%s AND panel_id=%s AND role_id=%s",
            (guild_id, panel_id, role_id),
        )

    # ── Role Sync Rules ──────────────────────────────────────────────────────

    async def get_role_sync_rules(self, guild_id: int) -> list:
        """Fetch enabled role sync rules with their source role IDs."""
        rows = await self.fetchall(
            "SELECT id, target_role_id FROM role_sync_rules "
            "WHERE guild_id=%s AND enabled=TRUE",
            (guild_id,),
        )
        rules = []
        for r in rows:
            source_rows = await self.fetchall(
                "SELECT role_id FROM role_sync_source_roles WHERE rule_id=%s",
                (r[0],),
            )
            rules.append({
                "id": r[0],
                "target_role_id": int(r[1]),
                "source_role_ids": {int(s[0]) for s in source_rows},
            })
        return rules

    async def get_watched_role_ids(self, guild_id: int) -> dict:
        """Return dict of role_id → role_name for watched roles."""
        rows = await self.fetchall(
            "SELECT role_id, role_name FROM role_watch_configs WHERE guild_id=%s",
            (guild_id,),
        )
        return {int(r[0]): r[1] for r in rows}

    async def insert_role_change_log(self, guild_id: int, discord_id: int,
                                     discord_name: str, role_id: int,
                                     role_name: str, action: str):
        await self.execute(
            "INSERT INTO role_change_logs "
            "(guild_id, discord_id, discord_name, role_id, role_name, action, created_at) "
            "VALUES (%s, %s, %s, %s, %s, %s, NOW())",
            (guild_id, discord_id, discord_name, role_id, role_name, action),
        )
