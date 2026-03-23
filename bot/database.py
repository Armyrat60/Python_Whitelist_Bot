from datetime import timedelta
from typing import Optional, List, Tuple

import aiomysql

from bot.config import (
    DB_HOST,
    DB_PORT,
    DB_NAME,
    DB_USER,
    DB_PASSWORD,
    SQUAD_PERMISSIONS,
    DEFAULT_SETTINGS,
    DEFAULT_TYPES,
    log,
)
from bot.utils import utcnow, to_bool


class Database:
    def __init__(self):
        self.pool: Optional[aiomysql.Pool] = None

    async def connect(self):
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
        log.info("DB connected")

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

    async def init_schema(self):
        stmts = [
            """
            CREATE TABLE IF NOT EXISTS bot_settings (
                setting_key VARCHAR(100) PRIMARY KEY,
                setting_value TEXT NOT NULL
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            """,
            """
            CREATE TABLE IF NOT EXISTS whitelist_types (
                whitelist_type VARCHAR(20) PRIMARY KEY,
                enabled TINYINT(1) NOT NULL DEFAULT 0,
                panel_channel_id BIGINT NULL,
                panel_message_id BIGINT NULL,
                log_channel_id BIGINT NULL,
                github_enabled TINYINT(1) NOT NULL DEFAULT 1,
                github_filename VARCHAR(255) NOT NULL,
                input_mode VARCHAR(20) NOT NULL DEFAULT 'modal',
                stack_roles TINYINT(1) NOT NULL DEFAULT 1,
                default_slot_limit INT NOT NULL DEFAULT 1,
                updated_at DATETIME NOT NULL
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            """,
            """
            CREATE TABLE IF NOT EXISTS role_mappings (
                id INT AUTO_INCREMENT PRIMARY KEY,
                whitelist_type VARCHAR(20) NOT NULL,
                role_id BIGINT NOT NULL,
                role_name VARCHAR(255) NOT NULL,
                slot_limit INT NOT NULL,
                is_active TINYINT(1) NOT NULL DEFAULT 1,
                created_at DATETIME NOT NULL,
                UNIQUE KEY uq_type_role (whitelist_type, role_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            """,
            """
            CREATE TABLE IF NOT EXISTS whitelist_users (
                discord_id BIGINT NOT NULL,
                whitelist_type VARCHAR(20) NOT NULL,
                discord_name VARCHAR(255) NOT NULL,
                status VARCHAR(50) NOT NULL DEFAULT 'active',
                slot_limit_override INT NULL,
                effective_slot_limit INT NOT NULL DEFAULT 0,
                last_plan_name VARCHAR(255) NULL,
                updated_at DATETIME NOT NULL,
                created_at DATETIME NOT NULL,
                PRIMARY KEY (discord_id, whitelist_type)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            """,
            """
            CREATE TABLE IF NOT EXISTS whitelist_identifiers (
                id INT AUTO_INCREMENT PRIMARY KEY,
                discord_id BIGINT NOT NULL,
                whitelist_type VARCHAR(20) NOT NULL,
                id_type VARCHAR(20) NOT NULL,
                id_value VARCHAR(255) NOT NULL,
                is_verified TINYINT(1) NOT NULL DEFAULT 0,
                verification_source VARCHAR(100) NULL,
                created_at DATETIME NOT NULL,
                updated_at DATETIME NOT NULL,
                UNIQUE KEY uq_user_identifier (discord_id, whitelist_type, id_type, id_value)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            """,
            """
            CREATE TABLE IF NOT EXISTS audit_log (
                id INT AUTO_INCREMENT PRIMARY KEY,
                whitelist_type VARCHAR(20) NULL,
                action_type VARCHAR(100) NOT NULL,
                actor_discord_id BIGINT NULL,
                target_discord_id BIGINT NULL,
                details LONGTEXT NULL,
                created_at DATETIME NOT NULL
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
                group_name VARCHAR(100) PRIMARY KEY,
                permissions TEXT NOT NULL,
                is_default TINYINT(1) NOT NULL DEFAULT 0,
                created_at DATETIME NOT NULL,
                updated_at DATETIME NOT NULL
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            """,
        ]
        for stmt in stmts:
            await self.execute(stmt)

        # Add squad_group column to whitelist_types if it doesn't exist
        try:
            await self.execute(
                "ALTER TABLE whitelist_types ADD COLUMN squad_group VARCHAR(100) NOT NULL DEFAULT 'Whitelist'"
            )
        except Exception:
            pass  # Column already exists

        # Seed Squad permissions
        for perm, desc in SQUAD_PERMISSIONS.items():
            await self.execute(
                """
                INSERT INTO squad_permissions (permission, description, is_active)
                VALUES (%s, %s, 1)
                ON DUPLICATE KEY UPDATE description=VALUES(description)
                """,
                (perm, desc),
            )

        # Seed default Whitelist group
        await self.execute(
            """
            INSERT INTO squad_groups (group_name, permissions, is_default, created_at, updated_at)
            VALUES ('Whitelist', 'reserve', 1, %s, %s)
            ON DUPLICATE KEY UPDATE updated_at=updated_at
            """,
            (utcnow(), utcnow()),
        )

        for key, value in DEFAULT_SETTINGS.items():
            await self.execute(
                """
                INSERT INTO bot_settings (setting_key, setting_value)
                VALUES (%s, %s)
                ON DUPLICATE KEY UPDATE setting_value = setting_value
                """,
                (key, value),
            )

        for whitelist_type, cfg in DEFAULT_TYPES.items():
            await self.execute(
                """
                INSERT INTO whitelist_types
                (whitelist_type, enabled, panel_channel_id, panel_message_id, log_channel_id,
                 github_enabled, github_filename, input_mode, stack_roles, default_slot_limit, updated_at)
                VALUES (%s, %s, NULLIF(%s,''), NULLIF(%s,''), NULLIF(%s,''), %s, %s, %s, %s, %s, %s)
                ON DUPLICATE KEY UPDATE updated_at = updated_at
                """,
                (
                    whitelist_type,
                    1 if to_bool(cfg["enabled"]) else 0,
                    cfg["panel_channel_id"],
                    cfg["panel_message_id"],
                    cfg["log_channel_id"],
                    1 if to_bool(cfg["github_enabled"]) else 0,
                    cfg["github_filename"],
                    cfg["input_mode"],
                    1 if to_bool(cfg["stack_roles"]) else 0,
                    int(cfg["default_slot_limit"]),
                    utcnow(),
                ),
            )

    async def get_setting(self, key: str, default: Optional[str] = None) -> Optional[str]:
        row = await self.fetchone("SELECT setting_value FROM bot_settings WHERE setting_key=%s", (key,))
        return row[0] if row else default

    async def set_setting(self, key: str, value: str):
        await self.execute(
            """
            INSERT INTO bot_settings (setting_key, setting_value)
            VALUES (%s, %s)
            ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)
            """,
            (key, str(value)),
        )

    async def get_type_config(self, whitelist_type: str) -> Optional[dict]:
        row = await self.fetchone(
            """
            SELECT enabled, panel_channel_id, panel_message_id, log_channel_id, github_enabled,
                   github_filename, input_mode, stack_roles, default_slot_limit, squad_group
            FROM whitelist_types
            WHERE whitelist_type=%s
            """,
            (whitelist_type,),
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

    async def set_type_config(self, whitelist_type: str, **kwargs):
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
        params.append(whitelist_type)
        await self.execute(f"UPDATE whitelist_types SET {', '.join(parts)} WHERE whitelist_type=%s", tuple(params))

    async def get_role_mappings(self, whitelist_type: Optional[str] = None) -> List[tuple]:
        if whitelist_type:
            return await self.fetchall(
                """
                SELECT role_id, role_name, slot_limit, is_active
                FROM role_mappings
                WHERE whitelist_type=%s
                ORDER BY slot_limit ASC, role_name ASC
                """,
                (whitelist_type,),
            )
        return await self.fetchall(
            """
            SELECT whitelist_type, role_id, role_name, slot_limit, is_active
            FROM role_mappings
            ORDER BY whitelist_type, slot_limit ASC, role_name ASC
            """
        )

    async def add_role_mapping(self, whitelist_type: str, role_id: int, role_name: str, slot_limit: int):
        await self.execute(
            """
            INSERT INTO role_mappings (whitelist_type, role_id, role_name, slot_limit, is_active, created_at)
            VALUES (%s, %s, %s, %s, 1, %s)
            ON DUPLICATE KEY UPDATE role_name=VALUES(role_name), slot_limit=VALUES(slot_limit), is_active=1
            """,
            (whitelist_type, role_id, role_name, slot_limit, utcnow()),
        )

    async def remove_role_mapping(self, whitelist_type: str, role_id: int):
        await self.execute("DELETE FROM role_mappings WHERE whitelist_type=%s AND role_id=%s", (whitelist_type, role_id))

    async def audit(self, action_type: str, actor: Optional[int], target: Optional[int], details: str, whitelist_type: Optional[str] = None):
        await self.execute(
            """
            INSERT INTO audit_log (whitelist_type, action_type, actor_discord_id, target_discord_id, details, created_at)
            VALUES (%s, %s, %s, %s, %s, %s)
            """,
            (whitelist_type, action_type, actor, target, details, utcnow()),
        )

    async def get_user_record(self, discord_id: int, whitelist_type: str) -> Optional[tuple]:
        return await self.fetchone(
            """
            SELECT discord_name, status, slot_limit_override, effective_slot_limit, last_plan_name, updated_at, created_at
            FROM whitelist_users
            WHERE discord_id=%s AND whitelist_type=%s
            """,
            (discord_id, whitelist_type),
        )

    async def upsert_user_record(self, discord_id: int, whitelist_type: str, discord_name: str, status: str, effective_slot_limit: int, last_plan_name: str, slot_limit_override: Optional[int] = None):
        await self.execute(
            """
            INSERT INTO whitelist_users
            (discord_id, whitelist_type, discord_name, status, slot_limit_override, effective_slot_limit, last_plan_name, updated_at, created_at)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON DUPLICATE KEY UPDATE
                discord_name=VALUES(discord_name),
                status=VALUES(status),
                slot_limit_override=VALUES(slot_limit_override),
                effective_slot_limit=VALUES(effective_slot_limit),
                last_plan_name=VALUES(last_plan_name),
                updated_at=VALUES(updated_at)
            """,
            (discord_id, whitelist_type, discord_name, status, slot_limit_override, effective_slot_limit, last_plan_name, utcnow(), utcnow()),
        )

    async def set_user_status(self, discord_id: int, whitelist_type: str, status: str):
        await self.execute(
            "UPDATE whitelist_users SET status=%s, updated_at=%s WHERE discord_id=%s AND whitelist_type=%s",
            (status, utcnow(), discord_id, whitelist_type),
        )

    async def set_override(self, discord_id: int, whitelist_type: str, override_slots: Optional[int]):
        await self.execute(
            "UPDATE whitelist_users SET slot_limit_override=%s, updated_at=%s WHERE discord_id=%s AND whitelist_type=%s",
            (override_slots, utcnow(), discord_id, whitelist_type),
        )

    async def replace_identifiers(self, discord_id: int, whitelist_type: str, identifiers: List[Tuple[str, str, bool, str]]):
        async with self.pool.acquire() as conn:
            await conn.begin()
            try:
                async with conn.cursor() as cur:
                    await cur.execute("DELETE FROM whitelist_identifiers WHERE discord_id=%s AND whitelist_type=%s", (discord_id, whitelist_type))
                    now = utcnow()
                    for id_type, id_value, is_verified, verification_source in identifiers:
                        await cur.execute(
                            """
                            INSERT INTO whitelist_identifiers
                            (discord_id, whitelist_type, id_type, id_value, is_verified, verification_source, created_at, updated_at)
                            VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
                            """,
                            (discord_id, whitelist_type, id_type, id_value, 1 if is_verified else 0, verification_source, now, now),
                        )
                await conn.commit()
            except Exception:
                await conn.rollback()
                raise

    async def get_identifiers(self, discord_id: int, whitelist_type: str) -> List[tuple]:
        return await self.fetchall(
            """
            SELECT id_type, id_value, is_verified, verification_source
            FROM whitelist_identifiers
            WHERE discord_id=%s AND whitelist_type=%s
            ORDER BY id_type, id_value
            """,
            (discord_id, whitelist_type),
        )

    async def get_active_export_rows(self) -> List[tuple]:
        return await self.fetchall(
            """
            SELECT u.whitelist_type, u.discord_id, u.discord_name, i.id_type, i.id_value
            FROM whitelist_users u
            JOIN whitelist_identifiers i
              ON u.discord_id=i.discord_id AND u.whitelist_type=i.whitelist_type
            WHERE u.status='active'
            ORDER BY u.whitelist_type, u.discord_name, i.id_type, i.id_value
            """
        )

    async def purge_inactive_older_than(self, days: int) -> int:
        cutoff = utcnow() - timedelta(days=days)
        rows = await self.fetchall(
            "SELECT discord_id, whitelist_type FROM whitelist_users WHERE status <> 'active' AND updated_at < %s",
            (cutoff,),
        )
        if not rows:
            await self.execute("DELETE FROM audit_log WHERE created_at < %s", (cutoff,))
            return 0
        async with self.pool.acquire() as conn:
            await conn.begin()
            try:
                async with conn.cursor() as cur:
                    for discord_id, whitelist_type in rows:
                        await cur.execute("DELETE FROM whitelist_identifiers WHERE discord_id=%s AND whitelist_type=%s", (discord_id, whitelist_type))
                        await cur.execute("DELETE FROM whitelist_users WHERE discord_id=%s AND whitelist_type=%s", (discord_id, whitelist_type))
                    await cur.execute("DELETE FROM audit_log WHERE created_at < %s", (cutoff,))
                await conn.commit()
            except Exception:
                await conn.rollback()
                raise
        return len(rows)

    # ── Squad Groups & Permissions ──

    async def get_squad_groups(self) -> List[tuple]:
        return await self.fetchall(
            "SELECT group_name, permissions, is_default FROM squad_groups ORDER BY is_default DESC, group_name"
        )

    async def get_squad_group(self, group_name: str) -> Optional[tuple]:
        return await self.fetchone(
            "SELECT group_name, permissions, is_default FROM squad_groups WHERE group_name=%s",
            (group_name,),
        )

    async def upsert_squad_group(self, group_name: str, permissions: str, is_default: bool = False):
        await self.execute(
            """
            INSERT INTO squad_groups (group_name, permissions, is_default, created_at, updated_at)
            VALUES (%s, %s, %s, %s, %s)
            ON DUPLICATE KEY UPDATE permissions=VALUES(permissions), is_default=VALUES(is_default), updated_at=VALUES(updated_at)
            """,
            (group_name, permissions, 1 if is_default else 0, utcnow(), utcnow()),
        )

    async def delete_squad_group(self, group_name: str):
        await self.execute("DELETE FROM squad_groups WHERE group_name=%s AND is_default=0", (group_name,))

    async def get_squad_permissions(self, active_only: bool = True) -> List[tuple]:
        if active_only:
            return await self.fetchall("SELECT permission, description FROM squad_permissions WHERE is_active=1 ORDER BY permission")
        return await self.fetchall("SELECT permission, description, is_active FROM squad_permissions ORDER BY permission")
