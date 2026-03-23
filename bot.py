
# bot.py
import os
import re
import json
import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional, List, Tuple

import aiomysql
import discord
from discord import app_commands
from discord.ext import commands, tasks
from dotenv import load_dotenv
from github import Github, GithubException, UnknownObjectException
from github import Auth

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
)
log = logging.getLogger("WhitelistBot")

DISCORD_TOKEN = os.getenv("DISCORD_TOKEN", "")
GUILD_ID = int(os.getenv("GUILD_ID", "0") or 0)

DB_HOST = os.getenv("DB_HOST", "127.0.0.1")
DB_PORT = int(os.getenv("DB_PORT", "3306"))
DB_NAME = os.getenv("DB_NAME", "whitelist_bot")
DB_USER = os.getenv("DB_USER", "root")
DB_PASSWORD = os.getenv("DB_PASSWORD", "")

GITHUB_TOKEN = os.getenv("GITHUB_TOKEN", "")
GITHUB_REPO_OWNER = os.getenv("GITHUB_REPO_OWNER", "")
GITHUB_REPO_NAME = os.getenv("GITHUB_REPO_NAME", "")
WHITELIST_FILENAME = os.getenv("WHITELIST_FILENAME", "PhantomCoWhitelist.txt")

DEFAULT_MOD_ROLE_ID = int(os.getenv("BOOTSTRAP_MOD_ROLE_ID", "0") or 0)

STEAM64_RE = re.compile(r"^7656119\d{10}$")
EOSID_RE = re.compile(r"^[0-9a-fA-F]{32}$")


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def to_bool(value: str) -> bool:
    return str(value).strip().lower() in {"1", "true", "yes", "on", "enabled"}


def validate_identifier(id_type: str, id_value: str) -> bool:
    id_type = id_type.lower().strip()
    id_value = id_value.strip()
    if id_type == "steam64":
        return bool(STEAM64_RE.fullmatch(id_value))
    if id_type == "eosid":
        return bool(EOSID_RE.fullmatch(id_value))
    return False


def split_identifier_tokens(raw: str) -> List[str]:
    raw = raw.replace("\n", ",")
    return [token.strip() for token in raw.split(",") if token.strip()]


DEFAULT_SETTINGS = {
    "output_mode": "combined",
    "combined_filename": WHITELIST_FILENAME,
    "retention_days": "90",
    "report_frequency": "weekly",
    "mod_role_id": str(DEFAULT_MOD_ROLE_ID or ""),
    "allow_global_duplicates": "true",
    "duplicate_output_dedupe": "true",
    "auto_reactivate_on_role_return": "true",
}

DEFAULT_TYPES = {
    "subscription": {
        "enabled": "false",
        "panel_channel_id": "",
        "panel_message_id": "",
        "log_channel_id": "",
        "github_enabled": "true",
        "github_filename": "SubscriptionWhitelist.txt",
        "input_mode": "modal",
        "stack_roles": "true",
        "default_slot_limit": "1",
    },
    "clan": {
        "enabled": "false",
        "panel_channel_id": "",
        "panel_message_id": "",
        "log_channel_id": "",
        "github_enabled": "true",
        "github_filename": "ClanWhitelist.txt",
        "input_mode": "modal",
        "stack_roles": "false",
        "default_slot_limit": "1",
    },
}


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
        ]
        for stmt in stmts:
            await self.execute(stmt)

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
                   github_filename, input_mode, stack_roles, default_slot_limit
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
        }

    async def set_type_config(self, whitelist_type: str, **kwargs):
        allowed = {
            "enabled", "panel_channel_id", "panel_message_id", "log_channel_id",
            "github_enabled", "github_filename", "input_mode", "stack_roles",
            "default_slot_limit"
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


class GithubPublisher:
    def __init__(self):
        self.client = None
        self.repo = None

    def connect(self):
        auth = Auth.Token(GITHUB_TOKEN)
        self.client = Github(auth=auth)
        self.repo = self.client.get_repo(f"{GITHUB_REPO_OWNER}/{GITHUB_REPO_NAME}")
        log.info("GitHub connected")

    def update_file_if_needed(self, filename: str, content: str) -> bool:
        try:
            contents = self.repo.get_contents(filename)
            old = contents.decoded_content.decode("utf-8")
            if old == content:
                return False
            self.repo.update_file(contents.path, "Update whitelist output", content, contents.sha)
            return True
        except UnknownObjectException:
            self.repo.create_file(filename, "Create whitelist output", content)
            return True
        except GithubException:
            log.exception("GitHub API error updating %s", filename)
            raise


async def _modal_on_error(modal, interaction: discord.Interaction, error: Exception):
    log.exception("Modal %s error", type(modal).__name__, exc_info=error)
    msg = "Something went wrong. Please try again."
    try:
        if interaction.response.is_done():
            await interaction.followup.send(msg, ephemeral=True)
        else:
            await interaction.response.send_message(msg, ephemeral=True)
    except discord.HTTPException:
        pass


async def _view_on_error(view, interaction: discord.Interaction, error: Exception, item):
    log.exception("View %s error on %s", type(view).__name__, item, exc_info=error)
    msg = "Something went wrong. Please try again."
    try:
        if interaction.response.is_done():
            await interaction.followup.send(msg, ephemeral=True)
        else:
            await interaction.response.send_message(msg, ephemeral=True)
    except discord.HTTPException:
        pass


class IdentifierModal(discord.ui.Modal, title="Submit or Update Whitelist IDs"):
    on_error = _modal_on_error
    def __init__(self, bot: "WhitelistBot", whitelist_type: str, slot_limit: int, existing: List[tuple]):
        super().__init__(timeout=300)
        self.bot = bot
        self.whitelist_type = whitelist_type
        self.slot_limit = slot_limit
        existing_steam = ", ".join(v for t, v, *_ in existing if t == "steam64")
        existing_eos = ", ".join(v for t, v, *_ in existing if t == "eosid")

        self.steam_ids = discord.ui.TextInput(
            label=f"Steam64 IDs (up to {slot_limit} total IDs across all fields)",
            default=existing_steam[:4000],
            required=False,
            style=discord.TextStyle.paragraph,
            placeholder="7656119xxxxxxxxxx, 7656119xxxxxxxxxx",
            max_length=4000,
        )
        self.eos_ids = discord.ui.TextInput(
            label="EOS IDs (32 hex chars each)",
            default=existing_eos[:4000],
            required=False,
            style=discord.TextStyle.paragraph,
            placeholder="0123456789abcdef0123456789abcdef",
            max_length=4000,
        )
        self.add_item(self.steam_ids)
        self.add_item(self.eos_ids)

    async def on_submit(self, interaction: discord.Interaction):
        await self.bot.handle_identifier_submission(interaction, self.whitelist_type, self.steam_ids.value, self.eos_ids.value)


# ─── Filename modal (only used for text that can't be a dropdown) ─────────────

class FilenameModal(discord.ui.Modal):
    on_error = _modal_on_error

    def __init__(self, bot: "WhitelistBot", setting_key: str, current_value: str, label: str):
        super().__init__(title=f"Edit {label}", timeout=120)
        self.bot = bot
        self.setting_key = setting_key
        self.label = label
        self.filename = discord.ui.TextInput(label=label, default=current_value, max_length=255, required=True)
        self.add_item(self.filename)

    async def on_submit(self, interaction: discord.Interaction):
        value = self.filename.value.strip()
        if not value:
            await interaction.response.send_message("Filename cannot be empty.", ephemeral=True)
            return
        await self.bot.db.set_setting(self.setting_key, value)
        await self.bot.db.audit("setup_global", interaction.user.id, None, f"{self.setting_key}={value}")
        await interaction.response.send_message(f"{self.label} set to `{value}`.", ephemeral=True)


class TypeFilenameModal(discord.ui.Modal):
    on_error = _modal_on_error

    def __init__(self, bot: "WhitelistBot", whitelist_type: str, current_value: str):
        super().__init__(title=f"{whitelist_type.title()} GitHub Filename", timeout=120)
        self.bot = bot
        self.whitelist_type = whitelist_type
        self.filename = discord.ui.TextInput(label="GitHub filename", default=current_value, max_length=255, required=True)
        self.add_item(self.filename)

    async def on_submit(self, interaction: discord.Interaction):
        value = self.filename.value.strip()
        if not value:
            await interaction.response.send_message("Filename cannot be empty.", ephemeral=True)
            return
        await self.bot.db.set_type_config(self.whitelist_type, github_filename=value)
        await self.bot.db.audit("setup_type", interaction.user.id, None, f"type={self.whitelist_type} github_filename={value}", self.whitelist_type)
        await interaction.response.send_message(f"GitHub filename set to `{value}`.", ephemeral=True)


class SlotLimitModal(discord.ui.Modal):
    on_error = _modal_on_error

    def __init__(self, bot: "WhitelistBot", whitelist_type: str, role_id: int, role_name: str):
        super().__init__(title=f"Slot Limit for {role_name[:30]}", timeout=120)
        self.bot = bot
        self.whitelist_type = whitelist_type
        self.role_id = role_id
        self.role_name = role_name
        self.slots = discord.ui.TextInput(label="Number of whitelist slots", placeholder="e.g. 4", max_length=10, required=True)
        self.add_item(self.slots)

    async def on_submit(self, interaction: discord.Interaction):
        try:
            slot_limit = int(self.slots.value.strip())
        except ValueError:
            await interaction.response.send_message("Slot limit must be a number.", ephemeral=True)
            return
        if slot_limit < 1:
            await interaction.response.send_message("Slot limit must be at least 1.", ephemeral=True)
            return
        await self.bot.db.add_role_mapping(self.whitelist_type, self.role_id, self.role_name, slot_limit)
        await self.bot.db.audit("setup_rolemap_add", interaction.user.id, None, f"type={self.whitelist_type} role={self.role_name}({self.role_id}) slots={slot_limit}", self.whitelist_type)
        await interaction.response.send_message(f"Mapped **{self.role_name}** to **{slot_limit}** slot(s) for {self.whitelist_type}.", ephemeral=True)


# ─── Setup: Main Hub ─────────────────────────────────────────────────────────

class MainSetupView(discord.ui.View):
    on_error = _view_on_error

    def __init__(self, bot: "WhitelistBot"):
        super().__init__(timeout=600)
        self.bot = bot

    async def _build_hub_embed(self, guild: discord.Guild) -> discord.Embed:
        output_mode = await self.bot.db.get_setting("output_mode", "combined")
        combined_fn = await self.bot.db.get_setting("combined_filename", WHITELIST_FILENAME)
        retention = await self.bot.db.get_setting("retention_days", "90")
        frequency = await self.bot.db.get_setting("report_frequency", "weekly")
        mod_role_id = int((await self.bot.db.get_setting("mod_role_id", "")) or 0)
        mod_role_text = f"<@&{mod_role_id}>" if mod_role_id else "`Not set`"

        e = discord.Embed(
            title="Setup Hub",
            description="Use the buttons below to configure each section.\nSettings update instantly when you make a selection.",
            color=discord.Color.blurple(),
        )
        e.add_field(name="Mod Role", value=mod_role_text, inline=True)
        e.add_field(name="Output Mode", value=f"`{output_mode}`", inline=True)
        e.add_field(name="Combined File", value=f"`{combined_fn}`", inline=True)
        e.add_field(name="Retention", value=f"`{retention}` days", inline=True)
        e.add_field(name="Reports", value=f"`{frequency}`", inline=True)
        e.add_field(name="\u200b", value="\u200b", inline=True)

        for wt in ("subscription", "clan"):
            cfg = await self.bot.db.get_type_config(wt)
            if not cfg:
                continue
            status = "Enabled" if cfg["enabled"] else "Disabled"
            panel_ch = f"<#{cfg['panel_channel_id']}>" if cfg["panel_channel_id"] else "`Not set`"
            log_ch = f"<#{cfg['log_channel_id']}>" if cfg["log_channel_id"] else "`Not set`"
            gh = "On" if cfg["github_enabled"] else "Off"
            mappings = await self.bot.db.get_role_mappings(wt)
            role_lines = [f"<@&{rid}> = {sl} slots" for rid, _, sl, active in mappings if active] or ["`None`"]
            e.add_field(
                name=f"{wt.title()}",
                value=(
                    f"**Status:** `{status}`\n"
                    f"**Panel:** {panel_ch}\n"
                    f"**Log:** {log_ch}\n"
                    f"**GitHub:** `{gh}` | `{cfg['github_filename']}`\n"
                    f"**Default Slots:** `{cfg['default_slot_limit']}`\n"
                    f"**Stack Roles:** `{'Yes' if cfg['stack_roles'] else 'No'}`\n"
                    f"**Role Mappings:**\n" + "\n".join(role_lines)
                ),
                inline=False,
            )
        return e

    @discord.ui.button(label="Global Settings", style=discord.ButtonStyle.blurple, row=0)
    async def global_btn(self, interaction: discord.Interaction, button: discord.ui.Button):
        await interaction.response.send_message(
            embed=discord.Embed(title="Global Settings", description="Use the dropdowns and buttons below.", color=discord.Color.blurple()),
            view=GlobalSettingsView(self.bot),
            ephemeral=True,
        )

    @discord.ui.button(label="Subscription", style=discord.ButtonStyle.gray, row=0)
    async def subscription_btn(self, interaction: discord.Interaction, button: discord.ui.Button):
        cfg = await self.bot.db.get_type_config("subscription")
        await interaction.response.send_message(
            embed=await TypeSettingsView.build_embed(self.bot, "subscription", cfg, interaction.guild),
            view=TypeSettingsView(self.bot, "subscription"),
            ephemeral=True,
        )

    @discord.ui.button(label="Clan", style=discord.ButtonStyle.gray, row=0)
    async def clan_btn(self, interaction: discord.Interaction, button: discord.ui.Button):
        cfg = await self.bot.db.get_type_config("clan")
        await interaction.response.send_message(
            embed=await TypeSettingsView.build_embed(self.bot, "clan", cfg, interaction.guild),
            view=TypeSettingsView(self.bot, "clan"),
            ephemeral=True,
        )

    @discord.ui.button(label="Refresh", emoji="\U0001f504", style=discord.ButtonStyle.secondary, row=1)
    async def refresh_btn(self, interaction: discord.Interaction, button: discord.ui.Button):
        embed = await self._build_hub_embed(interaction.guild)
        await interaction.response.edit_message(embed=embed, view=self)

    @discord.ui.button(label="Done", style=discord.ButtonStyle.red, row=1)
    async def done_btn(self, interaction: discord.Interaction, button: discord.ui.Button):
        await interaction.response.edit_message(content="Setup closed.", view=None, embed=None)


# ─── Setup: Global Settings (dropdowns) ──────────────────────────────────────

class GlobalSettingsView(discord.ui.View):
    on_error = _view_on_error

    def __init__(self, bot: "WhitelistBot"):
        super().__init__(timeout=300)
        self.bot = bot

    @discord.ui.select(
        placeholder="Output Mode",
        options=[
            discord.SelectOption(label="Combined", value="combined", description="One file with all whitelisted IDs"),
            discord.SelectOption(label="Separate", value="separate", description="Separate files per type (sub/clan)"),
            discord.SelectOption(label="Hybrid", value="hybrid", description="Combined + separate files"),
        ],
        row=0,
    )
    async def output_mode_select(self, interaction: discord.Interaction, select: discord.ui.Select):
        mode = select.values[0]
        await self.bot.db.set_setting("output_mode", mode)
        await self.bot.db.audit("setup_global", interaction.user.id, None, f"output_mode={mode}")
        await interaction.response.send_message(f"Output mode set to **{mode}**.", ephemeral=True)

    @discord.ui.select(
        placeholder="Report Frequency",
        options=[
            discord.SelectOption(label="Disabled", value="disabled", description="No automatic reports"),
            discord.SelectOption(label="Daily", value="daily", description="Report every day"),
            discord.SelectOption(label="Weekly", value="weekly", description="Report every Monday"),
        ],
        row=1,
    )
    async def report_freq_select(self, interaction: discord.Interaction, select: discord.ui.Select):
        freq = select.values[0]
        await self.bot.db.set_setting("report_frequency", freq)
        await self.bot.db.audit("setup_global", interaction.user.id, None, f"report_frequency={freq}")
        await interaction.response.send_message(f"Report frequency set to **{freq}**.", ephemeral=True)

    @discord.ui.select(
        placeholder="Retention Period",
        options=[
            discord.SelectOption(label="30 days", value="30"),
            discord.SelectOption(label="60 days", value="60"),
            discord.SelectOption(label="90 days", value="90", description="Default"),
            discord.SelectOption(label="180 days", value="180"),
            discord.SelectOption(label="365 days", value="365"),
        ],
        row=2,
    )
    async def retention_select(self, interaction: discord.Interaction, select: discord.ui.Select):
        days = select.values[0]
        await self.bot.db.set_setting("retention_days", days)
        await self.bot.db.audit("setup_global", interaction.user.id, None, f"retention_days={days}")
        await interaction.response.send_message(f"Retention set to **{days}** days.", ephemeral=True)

    @discord.ui.button(label="Edit Combined Filename", style=discord.ButtonStyle.secondary, row=3)
    async def filename_btn(self, interaction: discord.Interaction, button: discord.ui.Button):
        current = await self.bot.db.get_setting("combined_filename", WHITELIST_FILENAME)
        await interaction.response.send_modal(FilenameModal(self.bot, "combined_filename", current, "Combined Filename"))


# ─── Setup: Type Settings (subscription / clan) ──────────────────────────────

class TypeSettingsView(discord.ui.View):
    on_error = _view_on_error

    def __init__(self, bot: "WhitelistBot", whitelist_type: str):
        super().__init__(timeout=300)
        self.bot = bot
        self.whitelist_type = whitelist_type

    @staticmethod
    async def build_embed(bot, whitelist_type: str, cfg: dict, guild: discord.Guild) -> discord.Embed:
        status = "Enabled" if cfg["enabled"] else "Disabled"
        panel_ch = f"<#{cfg['panel_channel_id']}>" if cfg["panel_channel_id"] else "`Not set`"
        log_ch = f"<#{cfg['log_channel_id']}>" if cfg["log_channel_id"] else "`Not set`"
        gh = "On" if cfg["github_enabled"] else "Off"
        mappings = await bot.db.get_role_mappings(whitelist_type)
        role_lines = [f"<@&{rid}> = {sl} slots" for rid, _, sl, active in mappings if active] or ["`None`"]
        e = discord.Embed(title=f"{whitelist_type.title()} Settings", color=discord.Color.green() if cfg["enabled"] else discord.Color.greyple())
        e.add_field(name="Status", value=f"`{status}`", inline=True)
        e.add_field(name="GitHub", value=f"`{gh}` | `{cfg['github_filename']}`", inline=True)
        e.add_field(name="Default Slots", value=f"`{cfg['default_slot_limit']}`", inline=True)
        e.add_field(name="Stack Roles", value=f"`{'Yes' if cfg['stack_roles'] else 'No'}`", inline=True)
        e.add_field(name="Panel Channel", value=panel_ch, inline=True)
        e.add_field(name="Log Channel", value=log_ch, inline=True)
        e.add_field(name="Role Mappings", value="\n".join(role_lines), inline=False)
        return e

    @discord.ui.button(label="Toggle Enabled", style=discord.ButtonStyle.green, row=0)
    async def toggle_enabled(self, interaction: discord.Interaction, button: discord.ui.Button):
        cfg = await self.bot.db.get_type_config(self.whitelist_type)
        new_val = 0 if cfg["enabled"] else 1
        await self.bot.db.set_type_config(self.whitelist_type, enabled=new_val)
        state = "enabled" if new_val else "disabled"
        await self.bot.db.audit("setup_type", interaction.user.id, None, f"type={self.whitelist_type} enabled={state}", self.whitelist_type)
        await interaction.response.send_message(f"{self.whitelist_type.title()} is now **{state}**.", ephemeral=True)

    @discord.ui.button(label="Toggle GitHub", style=discord.ButtonStyle.gray, row=0)
    async def toggle_github(self, interaction: discord.Interaction, button: discord.ui.Button):
        cfg = await self.bot.db.get_type_config(self.whitelist_type)
        new_val = 0 if cfg["github_enabled"] else 1
        await self.bot.db.set_type_config(self.whitelist_type, github_enabled=new_val)
        state = "enabled" if new_val else "disabled"
        await self.bot.db.audit("setup_type", interaction.user.id, None, f"type={self.whitelist_type} github_enabled={state}", self.whitelist_type)
        await interaction.response.send_message(f"GitHub publishing **{state}** for {self.whitelist_type}.", ephemeral=True)

    @discord.ui.button(label="Toggle Stack Roles", style=discord.ButtonStyle.gray, row=0)
    async def toggle_stack(self, interaction: discord.Interaction, button: discord.ui.Button):
        cfg = await self.bot.db.get_type_config(self.whitelist_type)
        new_val = 0 if cfg["stack_roles"] else 1
        await self.bot.db.set_type_config(self.whitelist_type, stack_roles=new_val)
        state = "on" if new_val else "off"
        await self.bot.db.audit("setup_type", interaction.user.id, None, f"type={self.whitelist_type} stack_roles={state}", self.whitelist_type)
        await interaction.response.send_message(f"Role stacking **{state}** for {self.whitelist_type}.", ephemeral=True)

    @discord.ui.select(
        cls=discord.ui.ChannelSelect,
        placeholder="Set Panel Channel",
        channel_types=[discord.ChannelType.text],
        row=1,
    )
    async def panel_channel_select(self, interaction: discord.Interaction, select: discord.ui.ChannelSelect):
        channel = select.values[0]
        await self.bot.db.set_type_config(self.whitelist_type, panel_channel_id=channel.id)
        await self.bot.db.audit("setup_channels", interaction.user.id, None, f"type={self.whitelist_type} panel={channel.id}", self.whitelist_type)
        await interaction.response.send_message(f"Panel channel set to {channel.mention}.", ephemeral=True)

    @discord.ui.select(
        cls=discord.ui.ChannelSelect,
        placeholder="Set Log Channel",
        channel_types=[discord.ChannelType.text],
        row=2,
    )
    async def log_channel_select(self, interaction: discord.Interaction, select: discord.ui.ChannelSelect):
        channel = select.values[0]
        await self.bot.db.set_type_config(self.whitelist_type, log_channel_id=channel.id)
        await self.bot.db.audit("setup_channels", interaction.user.id, None, f"type={self.whitelist_type} log={channel.id}", self.whitelist_type)
        await interaction.response.send_message(f"Log channel set to {channel.mention}.", ephemeral=True)

    @discord.ui.select(
        cls=discord.ui.RoleSelect,
        placeholder="Add Role Mapping",
        row=3,
    )
    async def role_map_select(self, interaction: discord.Interaction, select: discord.ui.RoleSelect):
        role = select.values[0]
        await interaction.response.send_modal(SlotLimitModal(self.bot, self.whitelist_type, role.id, role.name))

    @discord.ui.select(
        placeholder="Default Slot Limit",
        options=[
            discord.SelectOption(label="1 slot", value="1"),
            discord.SelectOption(label="2 slots", value="2"),
            discord.SelectOption(label="3 slots", value="3"),
            discord.SelectOption(label="4 slots", value="4"),
            discord.SelectOption(label="5 slots", value="5"),
            discord.SelectOption(label="8 slots", value="8"),
            discord.SelectOption(label="10 slots", value="10"),
        ],
        row=4,
    )
    async def default_slots_select(self, interaction: discord.Interaction, select: discord.ui.Select):
        slots = int(select.values[0])
        await self.bot.db.set_type_config(self.whitelist_type, default_slot_limit=slots)
        await self.bot.db.audit("setup_type", interaction.user.id, None, f"type={self.whitelist_type} default_slot_limit={slots}", self.whitelist_type)
        await interaction.response.send_message(f"Default slot limit set to **{slots}** for {self.whitelist_type}.", ephemeral=True)


class WhitelistPanelView(discord.ui.View):
    def __init__(self, bot: "WhitelistBot", whitelist_type: str):
        super().__init__(timeout=None)
        self.bot = bot
        self.whitelist_type = whitelist_type

        start_btn = discord.ui.Button(
            label="Start / Update Whitelist",
            style=discord.ButtonStyle.green,
            custom_id=f"panel:start:{whitelist_type}",
        )
        start_btn.callback = self._start_callback
        self.add_item(start_btn)

        mod_btn = discord.ui.Button(
            label="Moderator Tools",
            style=discord.ButtonStyle.secondary,
            custom_id=f"panel:mod:{whitelist_type}",
        )
        mod_btn.callback = self._mod_callback
        self.add_item(mod_btn)

    async def _start_callback(self, interaction: discord.Interaction):
        await self.bot.start_whitelist_flow(interaction, self.whitelist_type)

    async def _mod_callback(self, interaction: discord.Interaction):
        if not await self.bot.user_is_mod(interaction.user):
            await interaction.response.send_message("You do not have permission.", ephemeral=True)
            return
        await interaction.response.send_message("Moderator tools", view=ModToolsView(self.bot, self.whitelist_type), ephemeral=True)


class ModToolsView(discord.ui.View):
    on_error = _view_on_error

    def __init__(self, bot: "WhitelistBot", whitelist_type: str):
        super().__init__(timeout=600)
        self.bot = bot
        self.whitelist_type = whitelist_type

    @discord.ui.button(label="Post / Refresh Panel", style=discord.ButtonStyle.blurple)
    async def panel_btn(self, interaction: discord.Interaction, button: discord.ui.Button):
        await self.bot.post_or_refresh_panel(interaction, self.whitelist_type, interaction.channel)
        await interaction.response.send_message("Panel refreshed.", ephemeral=True)

    @discord.ui.button(label="Resync GitHub", style=discord.ButtonStyle.green)
    async def resync_btn(self, interaction: discord.Interaction, button: discord.ui.Button):
        changed = await self.bot.sync_github_outputs()
        await interaction.response.send_message(f"Resync complete. Changed files: {changed}", ephemeral=True)

    @discord.ui.button(label="Status", style=discord.ButtonStyle.secondary)
    async def status_btn(self, interaction: discord.Interaction, button: discord.ui.Button):
        embed = await self.bot.build_status_embed(interaction.guild)
        await interaction.response.send_message(embed=embed, ephemeral=True)


class WhitelistBot(commands.Bot):
    def __init__(self):
        intents = discord.Intents.default()
        intents.guilds = True
        intents.members = True
        intents.message_content = False
        super().__init__(command_prefix="!", intents=intents)
        self.db = Database()
        self.github = GithubPublisher()
        self.panel_views = {}
        self.write_lock = asyncio.Lock()
        self._sync_pending = False
        self._sync_task: Optional[asyncio.Task] = None

    async def setup_hook(self):
        await self.db.connect()
        await self.db.init_schema()
        self.github.connect()
        for whitelist_type in ("subscription", "clan"):
            self.panel_views[whitelist_type] = WhitelistPanelView(self, whitelist_type)
            self.add_view(self.panel_views[whitelist_type])
        if GUILD_ID:
            guild_obj = discord.Object(id=GUILD_ID)
            self.tree.clear_commands(guild=guild_obj)
            self.tree.copy_global_to(guild=guild_obj)
            synced = await self.tree.sync(guild=guild_obj)
            log.info("Synced %s guild app commands to guild %s", len(synced), GUILD_ID)
        else:
            synced = await self.tree.sync()
            log.info("Synced %s global app commands", len(synced))
        self.weekly_report.start()
        self.daily_housekeeping.start()

    async def on_ready(self):
        log.info("Connected as %s (%s)", self.user, self.user.id)
        await self.log_startup_summary()
        # Refresh existing panels so buttons are live after restart
        for wt in ("subscription", "clan"):
            try:
                await self.post_or_refresh_panel(None, wt)
            except Exception:
                log.debug("Could not refresh %s panel on startup", wt)

    async def user_is_mod(self, user: discord.abc.User) -> bool:
        if not isinstance(user, discord.Member):
            return False
        mod_role_id = int((await self.db.get_setting("mod_role_id", "")) or 0)
        return bool(mod_role_id and any(r.id == mod_role_id for r in user.roles))

    async def require_mod(self, interaction: discord.Interaction) -> bool:
        if not await self.user_is_mod(interaction.user):
            if interaction.response.is_done():
                await interaction.followup.send("You do not have permission.", ephemeral=True)
            else:
                await interaction.response.send_message("You do not have permission.", ephemeral=True)
            return False
        return True

    async def startup_summary_text(self, guild: Optional[discord.Guild]) -> str:
        output_mode = await self.db.get_setting("output_mode", "combined")
        combined_filename = await self.db.get_setting("combined_filename", WHITELIST_FILENAME)
        retention_days = await self.db.get_setting("retention_days", "90")
        parts = [f"guild_id={guild.id if guild else 'n/a'}", f"output_mode={output_mode}", f"combined_filename={combined_filename}", f"retention_days={retention_days}"]
        for wt in ("subscription", "clan"):
            cfg = await self.db.get_type_config(wt)
            parts.append(f"{wt}: enabled={cfg['enabled']} panel_channel_id={cfg['panel_channel_id']} log_channel_id={cfg['log_channel_id']} github_enabled={cfg['github_enabled']} file={cfg['github_filename']}")
        return " | ".join(parts)

    async def log_startup_summary(self):
        guild = self.get_guild(GUILD_ID) if GUILD_ID else None
        log.info("Startup summary | %s", await self.startup_summary_text(guild))

    async def build_status_embed(self, guild: Optional[discord.Guild]) -> discord.Embed:
        embed = discord.Embed(title="Whitelist Bot Status", color=discord.Color.blurple(), timestamp=datetime.now(timezone.utc))
        embed.add_field(name="Output mode", value=await self.db.get_setting("output_mode", "combined"), inline=True)
        embed.add_field(name="Combined file", value=await self.db.get_setting("combined_filename", WHITELIST_FILENAME), inline=True)
        embed.add_field(name="Retention", value=f"{await self.db.get_setting('retention_days', '90')} days", inline=True)
        mappings = await self.db.get_role_mappings()
        by_type = {"subscription": [], "clan": []}
        for row in mappings:
            wt, role_id, role_name, slot_limit, is_active = row
            if is_active:
                by_type[wt].append(f"{role_name} ({role_id}) → {slot_limit}")
        for wt in ("subscription", "clan"):
            cfg = await self.db.get_type_config(wt)
            channel_name = "Not set"
            if guild and cfg["panel_channel_id"]:
                ch = guild.get_channel(int(cfg["panel_channel_id"]))
                if ch:
                    channel_name = ch.mention
            log_channel_name = "Not set"
            if guild and cfg["log_channel_id"]:
                ch = guild.get_channel(int(cfg["log_channel_id"]))
                if ch:
                    log_channel_name = ch.mention
            embed.add_field(
                name=f"{wt.title()}",
                value=f"Enabled: `{cfg['enabled']}`\nPanel: {channel_name}\nLog: {log_channel_name}\nGitHub: `{cfg['github_enabled']}` → `{cfg['github_filename']}`\nInput: `{cfg['input_mode']}`\nDefault slots: `{cfg['default_slot_limit']}`\nRoles:\n" + ("\n".join(by_type[wt]) if by_type[wt] else "None"),
                inline=False,
            )
        return embed

    async def send_log_embed(self, whitelist_type: str, title: str, description: str, color: discord.Color = discord.Color.blurple()):
        cfg = await self.db.get_type_config(whitelist_type)
        channel_id = cfg["log_channel_id"]
        if not channel_id:
            return
        channel = self.get_channel(int(channel_id))
        if not channel:
            return
        embed = discord.Embed(title=title, description=description, color=color, timestamp=datetime.now(timezone.utc))
        try:
            await channel.send(embed=embed)
        except discord.Forbidden:
            log.warning("Missing access to log channel %s", channel_id)

    async def calculate_user_slots(self, member: discord.Member, whitelist_type: str, *, user_record=None, cfg=None) -> tuple[int, str]:
        if user_record is None:
            user_record = await self.db.get_user_record(member.id, whitelist_type)
        override_slots = user_record[2] if user_record else None
        if cfg is None:
            cfg = await self.db.get_type_config(whitelist_type)
        mappings = await self.db.get_role_mappings(whitelist_type)
        matched = [(role_name, slot_limit) for role_id, role_name, slot_limit, is_active in mappings if is_active and any(r.id == role_id for r in member.roles)]
        if override_slots is not None:
            return int(override_slots), f"override ({override_slots})"
        if matched:
            if cfg["stack_roles"]:
                total = sum(x[1] for x in matched)
                return total, " + ".join(f"{n}:{s}" for n, s in matched)
            winner = max(matched, key=lambda x: x[1])
            return winner[1], f"{winner[0]}:{winner[1]}"
        return int(cfg["default_slot_limit"]), f"default:{cfg['default_slot_limit']}"

    async def start_whitelist_flow(self, interaction: discord.Interaction, whitelist_type: str):
        cfg = await self.db.get_type_config(whitelist_type)
        if not cfg["enabled"]:
            await interaction.response.send_message(f"{whitelist_type.title()} whitelist is disabled.", ephemeral=True)
            return
        member = interaction.guild.get_member(interaction.user.id)
        slots, _ = await self.calculate_user_slots(member, whitelist_type)
        if slots <= 0:
            await interaction.response.send_message("You are not eligible for this whitelist.", ephemeral=True)
            return
        existing = await self.db.get_identifiers(interaction.user.id, whitelist_type)
        if cfg["input_mode"] == "thread":
            await interaction.response.send_message("Thread mode is not enabled in this build. Use modal mode.", ephemeral=True)
            return
        await interaction.response.send_modal(IdentifierModal(self, whitelist_type, slots, existing))

    async def handle_identifier_submission(self, interaction: discord.Interaction, whitelist_type: str, steam_raw: str, eos_raw: str):
        member = interaction.guild.get_member(interaction.user.id)
        slots, plan = await self.calculate_user_slots(member, whitelist_type)
        steam_ids = list(dict.fromkeys(token for token in split_identifier_tokens(steam_raw) if token))
        eos_ids = list(dict.fromkeys(token.lower() for token in split_identifier_tokens(eos_raw) if token))

        invalid_steam = [v for v in steam_ids if not validate_identifier("steam64", v)]
        invalid_eos = [v for v in eos_ids if not validate_identifier("eosid", v)]
        if invalid_steam or invalid_eos:
            errors = []
            if invalid_steam:
                errors.append("Invalid Steam64: " + ", ".join(invalid_steam[:5]))
            if invalid_eos:
                errors.append("Invalid EOSID: " + ", ".join(invalid_eos[:5]))
            await interaction.response.send_message("\n".join(errors), ephemeral=True)
            return

        submitted = [("steam64", v, True, "format_only") for v in steam_ids] + [("eosid", v, False, "unverified") for v in eos_ids]
        if not submitted:
            await interaction.response.send_message("Submit at least one Steam64 or EOSID.", ephemeral=True)
            return
        if len(submitted) > slots:
            await interaction.response.send_message(f"You have {slots} slot(s), but submitted {len(submitted)} identifiers.", ephemeral=True)
            return

        duplicate_warnings = []
        if submitted:
            pairs = [(id_type, id_value) for id_type, id_value, *_ in submitted]
            placeholders = ",".join(["(%s,%s)"] * len(pairs))
            flat_params = [v for pair in pairs for v in pair]
            flat_params.extend([interaction.user.id, whitelist_type])
            rows = await self.db.fetchall(
                f"""
                SELECT DISTINCT id_type, id_value
                FROM whitelist_identifiers
                WHERE (id_type, id_value) IN ({placeholders})
                  AND NOT (discord_id=%s AND whitelist_type=%s)
                """,
                tuple(flat_params),
            )
            duplicate_warnings = [f"{r[0]}:{r[1]}" for r in rows]

        async with self.write_lock:
            await self.db.upsert_user_record(
                interaction.user.id,
                whitelist_type,
                str(interaction.user),
                "active",
                slots,
                plan,
            )
            await self.db.replace_identifiers(interaction.user.id, whitelist_type, submitted)
            await self.db.audit(
                "user_submit",
                interaction.user.id,
                interaction.user.id,
                json.dumps({"whitelist_type": whitelist_type, "slots": slots, "plan": plan, "count": len(submitted), "duplicates_warned": duplicate_warnings}),
                whitelist_type,
            )
        changed = await self.sync_github_outputs()
        msg = f"Saved {len(submitted)} identifier(s). GitHub files changed: {changed}."
        if duplicate_warnings:
            msg += "\nWarning: duplicate identifiers exist elsewhere; published output is deduped."
        await interaction.response.send_message(msg, ephemeral=True)
        await self.send_log_embed(whitelist_type, "Whitelist Updated", f"User: <@{interaction.user.id}>\nType: `{whitelist_type}`\nSlots: `{slots}`\nPlan: `{plan}`\nIDs: `{len(submitted)}`", discord.Color.green())

    async def get_output_contents(self) -> dict[str, str]:
        rows = await self.db.get_active_export_rows()
        mode = await self.db.get_setting("output_mode", "combined")
        dedupe_output = to_bool(await self.db.get_setting("duplicate_output_dedupe", "true"))
        outputs = {}

        def build_line(id_type: str, id_value: str, name: str) -> str:
            if id_type == "steam64":
                return f"Admin={id_value}:Whitelist // {name}"
            return f"Admin={id_value}:Whitelist // {name} [EOS]"

        combined_lines = ["Group=Whitelist:reserve", "", ""]
        combined_seen = set()
        type_lines = {wt: ["Group=Whitelist:reserve", "", ""] for wt in ("subscription", "clan")}
        type_seen = {wt: set() for wt in ("subscription", "clan")}

        for whitelist_type, _, discord_name, id_type, id_value in rows:
            line = build_line(id_type, id_value, discord_name)
            key = f"{id_type}:{id_value}" if dedupe_output else line
            if mode in {"combined", "hybrid"} and key not in combined_seen:
                combined_lines.append(line)
                combined_seen.add(key)
            if mode in {"separate", "hybrid"}:
                if key not in type_seen[whitelist_type]:
                    type_lines[whitelist_type].append(line)
                    type_seen[whitelist_type].add(key)

        if mode in {"combined", "hybrid"}:
            outputs[await self.db.get_setting("combined_filename", WHITELIST_FILENAME)] = "\n".join(combined_lines)
        if mode in {"separate", "hybrid"}:
            for whitelist_type in ("subscription", "clan"):
                cfg = await self.db.get_type_config(whitelist_type)
                if cfg["github_enabled"]:
                    outputs[cfg["github_filename"]] = "\n".join(type_lines[whitelist_type])
        return outputs

    async def sync_github_outputs(self) -> int:
        outputs = await self.get_output_contents()
        changed = 0
        for filename, content in outputs.items():
            try:
                updated = await asyncio.to_thread(self.github.update_file_if_needed, filename, content)
                if updated:
                    changed += 1
            except Exception:
                log.exception("Failed to sync %s to GitHub", filename)
        return changed

    def schedule_github_sync(self):
        """Debounced GitHub sync — waits 5s then syncs once, coalescing rapid-fire events."""
        if self._sync_task and not self._sync_task.done():
            self._sync_pending = True
            return
        self._sync_task = asyncio.create_task(self._debounced_sync())

    async def _debounced_sync(self):
        await asyncio.sleep(5)
        while True:
            self._sync_pending = False
            try:
                await self.sync_github_outputs()
            except Exception:
                log.exception("Debounced GitHub sync failed")
            if not self._sync_pending:
                break

    def _build_panel_embed(self, whitelist_type: str) -> discord.Embed:
        embed = discord.Embed(
            title=f"{whitelist_type.title()} Whitelist",
            description=(
                "Click **Start / Update Whitelist** to submit or change your IDs.\n\n"
                "**Supported formats:**\n"
                "- **Steam64** — 17-digit ID starting with `7656119`\n"
                "- **EOSID** — 32-character hex string"
            ),
            color=discord.Color.blurple(),
        )
        return embed

    async def post_or_refresh_panel(self, interaction: Optional[discord.Interaction], whitelist_type: str, channel: Optional[discord.abc.Messageable] = None):
        cfg = await self.db.get_type_config(whitelist_type)
        if not cfg:
            return None
        embed = self._build_panel_embed(whitelist_type)

        # Try to find the existing panel in its stored channel first
        posted = None
        stored_channel_id = cfg["panel_channel_id"]
        stored_message_id = cfg["panel_message_id"]
        if stored_message_id and stored_channel_id:
            try:
                stored_ch = self.get_channel(int(stored_channel_id))
                if stored_ch:
                    old = await stored_ch.fetch_message(int(stored_message_id))
                    await old.edit(embed=embed, view=self.panel_views[whitelist_type])
                    posted = old
            except Exception:
                posted = None

        # If no existing panel found, post a new one in the provided channel
        if posted is None and channel is not None:
            posted = await channel.send(embed=embed, view=self.panel_views[whitelist_type])

        if posted is not None:
            await self.db.set_type_config(whitelist_type, panel_channel_id=posted.channel.id, panel_message_id=posted.id)
            actor = interaction.user.id if interaction else None
            await self.db.audit("panel_post", actor, None, f"type={whitelist_type} channel={posted.channel.id} message={posted.id}", whitelist_type)
        return posted

    async def enforce_member_roles(self, member: discord.Member):
        for whitelist_type in ("subscription", "clan"):
            cfg = await self.db.get_type_config(whitelist_type)
            if not cfg or not cfg["enabled"]:
                continue
            user_record = await self.db.get_user_record(member.id, whitelist_type)
            if not user_record:
                continue
            slots, plan = await self.calculate_user_slots(member, whitelist_type, user_record=user_record, cfg=cfg)
            status_before = user_record[1]
            if slots <= 0:
                if status_before == "active":
                    await self.db.set_user_status(member.id, whitelist_type, "disabled_role_lost")
                    await self.db.audit("auto_disable_role_lost", None, member.id, f"type={whitelist_type}", whitelist_type)
                    await self.send_log_embed(whitelist_type, "Whitelist Disabled", f"User <@{member.id}> lost required role(s).", discord.Color.orange())
            else:
                if status_before != "active" and to_bool(await self.db.get_setting("auto_reactivate_on_role_return", "true")):
                    await self.db.upsert_user_record(member.id, whitelist_type, str(member), "active", slots, plan, user_record[2])
                    await self.db.audit("auto_reactivate_role_return", None, member.id, f"type={whitelist_type}", whitelist_type)
                    await self.send_log_embed(whitelist_type, "Whitelist Re-enabled", f"User <@{member.id}> regained eligible role(s).", discord.Color.green())
                else:
                    await self.db.upsert_user_record(member.id, whitelist_type, str(member), status_before, slots, plan, user_record[2])
        self.schedule_github_sync()

    async def on_member_update(self, before: discord.Member, after: discord.Member):
        if before.roles != after.roles:
            await self.enforce_member_roles(after)

    async def on_member_remove(self, member: discord.Member):
        for whitelist_type in ("subscription", "clan"):
            row = await self.db.get_user_record(member.id, whitelist_type)
            if row:
                await self.db.set_user_status(member.id, whitelist_type, "left_guild")
                await self.db.audit("left_guild", None, member.id, f"type={whitelist_type}", whitelist_type)
                await self.send_log_embed(whitelist_type, "User Left Guild", f"<@{member.id}> removed from active output.", discord.Color.red())
        self.schedule_github_sync()

    @tasks.loop(hours=24)
    async def daily_housekeeping(self):
        retention = int(await self.db.get_setting("retention_days", "90"))
        purged = await self.db.purge_inactive_older_than(retention)
        if purged:
            log.info("Purged %s inactive records older than %s days", purged, retention)

    @daily_housekeeping.before_loop
    async def _before_housekeeping(self):
        await self.wait_until_ready()

    @tasks.loop(hours=24)
    async def weekly_report(self):
        frequency = (await self.db.get_setting("report_frequency", "weekly")).lower()
        now = datetime.now(timezone.utc)
        should_send = frequency == "daily" or (frequency == "weekly" and now.weekday() == 0)
        if not should_send:
            return
        for whitelist_type in ("subscription", "clan"):
            cfg = await self.db.get_type_config(whitelist_type)
            if not cfg["log_channel_id"]:
                continue
            active = await self.db.fetchone("SELECT COUNT(*) FROM whitelist_users WHERE whitelist_type=%s AND status='active'", (whitelist_type,))
            ids = await self.db.fetchone("SELECT COUNT(*) FROM whitelist_identifiers WHERE whitelist_type=%s", (whitelist_type,))
            actions = await self.db.fetchone("SELECT COUNT(*) FROM audit_log WHERE whitelist_type=%s AND created_at >= %s", (whitelist_type, utcnow() - timedelta(days=7 if frequency == 'weekly' else 1)))
            await self.send_log_embed(whitelist_type, f"{frequency.title()} Report", f"Active users: `{active[0]}`\nIdentifiers: `{ids[0]}`\nActions in window: `{actions[0]}`", discord.Color.blurple())

    @weekly_report.before_loop
    async def _before_weekly_report(self):
        await self.wait_until_ready()


bot = WhitelistBot()

async def setup_autocomplete(interaction: discord.Interaction, current: str):
    return [app_commands.Choice(name=item, value=item) for item in ("subscription", "clan") if current.lower() in item][:25]


@bot.tree.command(name="ping", description="Check bot latency and health")
async def ping(interaction: discord.Interaction):
    db_ok = False
    try:
        await bot.db.fetchone("SELECT 1")
        db_ok = True
    except Exception:
        db_ok = False
    await interaction.response.send_message(f"Pong.\nLatency: `{round(bot.latency*1000)}ms`\nDB: `{db_ok}`\nGitHub: `{bool(bot.github.repo)}`", ephemeral=True)


@bot.tree.command(name="help", description="Show help")
async def help_cmd(interaction: discord.Interaction):
    embed = discord.Embed(title="Whitelist Bot Help", color=discord.Color.blurple())
    embed.add_field(name="User", value="/whitelist\n/my_whitelist\n/status\n/ping", inline=False)
    embed.add_field(name="Setup / Admin", value="/setup\n/setup_channels\n/setup_rolemap_remove\n/setup_mod_role\n/setup_status\n/whitelist_panel\n/resync_whitelist", inline=False)
    embed.add_field(name="Moderator", value="/mod_view\n/mod_set\n/mod_remove\n/mod_override\n/report_now", inline=False)
    embed.add_field(name="IDs", value="Steam64 and EOSID supported. Duplicate output is deduped before GitHub publishing.", inline=False)
    await interaction.response.send_message(embed=embed, ephemeral=True)


@bot.tree.command(name="status", description="Show bot status")
async def status(interaction: discord.Interaction):
    embed = await bot.build_status_embed(interaction.guild)
    await interaction.response.send_message(embed=embed, ephemeral=True)


@bot.tree.command(name="setup", description="Launch interactive setup wizard")
async def setup(interaction: discord.Interaction):
    if not await bot.require_mod(interaction):
        return
    view = MainSetupView(bot)
    embed = await view._build_hub_embed(interaction.guild)
    await interaction.response.send_message(embed=embed, view=view, ephemeral=True)


@bot.tree.command(name="setup_mod_role", description="Set the moderator role used by the bot")
async def setup_mod_role(interaction: discord.Interaction, role: discord.Role):
    current = int((await bot.db.get_setting("mod_role_id", "0")) or 0)
    if current and not await bot.user_is_mod(interaction.user):
        await interaction.response.send_message("Only the configured mod role can change this.", ephemeral=True)
        return
    await bot.db.set_setting("mod_role_id", str(role.id))
    await bot.db.audit("setup_mod_role", interaction.user.id, None, f"mod_role_id={role.id}")
    await interaction.response.send_message(f"Moderator role set to {role.mention}.", ephemeral=True)


@bot.tree.command(name="setup_channels", description="Set panel and log channel for a whitelist type")
@app_commands.autocomplete(whitelist_type=setup_autocomplete)
async def setup_channels(interaction: discord.Interaction, whitelist_type: str, panel_channel: discord.TextChannel, log_channel: discord.TextChannel):
    if not await bot.require_mod(interaction):
        return
    whitelist_type = whitelist_type.lower()
    if whitelist_type not in {"subscription", "clan"}:
        await interaction.response.send_message("Invalid whitelist type.", ephemeral=True)
        return
    await bot.db.set_type_config(whitelist_type, panel_channel_id=panel_channel.id, log_channel_id=log_channel.id)
    await bot.db.audit("setup_channels", interaction.user.id, None, f"type={whitelist_type} panel={panel_channel.id} log={log_channel.id}", whitelist_type)
    await interaction.response.send_message(f"Updated {whitelist_type} channels.\nPanel: {panel_channel.mention}\nLog: {log_channel.mention}", ephemeral=True)


@bot.tree.command(name="setup_rolemap_remove", description="Remove a role mapping")
@app_commands.autocomplete(whitelist_type=setup_autocomplete)
async def setup_rolemap_remove(interaction: discord.Interaction, whitelist_type: str, role: discord.Role):
    if not await bot.require_mod(interaction):
        return
    whitelist_type = whitelist_type.lower()
    await bot.db.remove_role_mapping(whitelist_type, role.id)
    await bot.db.audit("setup_rolemap_remove", interaction.user.id, None, f"type={whitelist_type} role={role.id}", whitelist_type)
    await interaction.response.send_message(f"Removed mapping for {role.mention} from {whitelist_type}.", ephemeral=True)


@bot.tree.command(name="setup_status", description="Show setup status")
async def setup_status(interaction: discord.Interaction):
    if not await bot.require_mod(interaction):
        return
    embed = await bot.build_status_embed(interaction.guild)
    await interaction.response.send_message(embed=embed, ephemeral=True)


@bot.tree.command(name="whitelist", description="Submit or update your whitelist IDs")
@app_commands.autocomplete(whitelist_type=setup_autocomplete)
async def whitelist(interaction: discord.Interaction, whitelist_type: str):
    whitelist_type = whitelist_type.lower()
    if whitelist_type not in {"subscription", "clan"}:
        await interaction.response.send_message("Invalid whitelist type.", ephemeral=True)
        return
    await bot.start_whitelist_flow(interaction, whitelist_type)


@bot.tree.command(name="my_whitelist", description="View your saved whitelist IDs")
@app_commands.autocomplete(whitelist_type=setup_autocomplete)
async def my_whitelist(interaction: discord.Interaction, whitelist_type: str):
    whitelist_type = whitelist_type.lower()
    row = await bot.db.get_user_record(interaction.user.id, whitelist_type)
    ids = await bot.db.get_identifiers(interaction.user.id, whitelist_type)
    if not row and not ids:
        await interaction.response.send_message("No record found.", ephemeral=True)
        return
    embed = discord.Embed(title=f"My {whitelist_type.title()} Whitelist", color=discord.Color.blurple())
    if row:
        embed.add_field(name="Status", value=row[1], inline=True)
        embed.add_field(name="Slots", value=str(row[3]), inline=True)
        embed.add_field(name="Plan", value=row[4] or "N/A", inline=True)
    embed.add_field(name="Identifiers", value="\n".join(f"{t}: `{v}`" for t, v, *_ in ids) if ids else "None", inline=False)
    await interaction.response.send_message(embed=embed, ephemeral=True)


@bot.tree.command(name="whitelist_panel", description="Post or refresh a whitelist panel")
@app_commands.autocomplete(whitelist_type=setup_autocomplete)
async def whitelist_panel(interaction: discord.Interaction, whitelist_type: str):
    if not await bot.require_mod(interaction):
        return
    whitelist_type = whitelist_type.lower()
    posted = await bot.post_or_refresh_panel(interaction, whitelist_type, interaction.channel)
    await interaction.response.send_message(f"Panel ready: https://discord.com/channels/{interaction.guild.id}/{interaction.channel.id}/{posted.id}", ephemeral=True)


@bot.tree.command(name="resync_whitelist", description="Force GitHub whitelist sync")
async def resync_whitelist(interaction: discord.Interaction):
    if not await bot.require_mod(interaction):
        return
    changed = await bot.sync_github_outputs()
    await bot.db.audit("manual_resync", interaction.user.id, None, f"changed_files={changed}")
    await interaction.response.send_message(f"GitHub sync complete. Changed files: {changed}", ephemeral=True)


@bot.tree.command(name="mod_view", description="Moderator: view a user's whitelist")
@app_commands.autocomplete(whitelist_type=setup_autocomplete)
async def mod_view(interaction: discord.Interaction, user: discord.Member, whitelist_type: str):
    if not await bot.require_mod(interaction):
        return
    row = await bot.db.get_user_record(user.id, whitelist_type)
    ids = await bot.db.get_identifiers(user.id, whitelist_type)
    embed = discord.Embed(title=f"{user} | {whitelist_type.title()}", color=discord.Color.blurple())
    if row:
        embed.add_field(name="Status", value=row[1], inline=True)
        embed.add_field(name="Override", value=str(row[2]), inline=True)
        embed.add_field(name="Effective Slots", value=str(row[3]), inline=True)
        embed.add_field(name="Plan", value=row[4] or "N/A", inline=True)
    embed.add_field(name="IDs", value="\n".join(f"{t}: `{v}`" for t, v, *_ in ids) if ids else "None", inline=False)
    await interaction.response.send_message(embed=embed, ephemeral=True)


@bot.tree.command(name="mod_override", description="Moderator: set or clear a slot override")
@app_commands.autocomplete(whitelist_type=setup_autocomplete)
async def mod_override(interaction: discord.Interaction, user: discord.Member, whitelist_type: str, slots: int):
    if not await bot.require_mod(interaction):
        return
    value = None if slots < 0 else slots
    await bot.db.set_override(user.id, whitelist_type, value)
    await bot.db.audit("mod_override", interaction.user.id, user.id, f"type={whitelist_type} override={value}", whitelist_type)
    await interaction.response.send_message(f"Override updated for {user.mention}: {value}", ephemeral=True)


@bot.tree.command(name="mod_remove", description="Moderator: remove a user's whitelist from active output")
@app_commands.autocomplete(whitelist_type=setup_autocomplete)
async def mod_remove(interaction: discord.Interaction, user: discord.Member, whitelist_type: str):
    if not await bot.require_mod(interaction):
        return
    await bot.db.set_user_status(user.id, whitelist_type, "removed_by_staff")
    await bot.db.audit("mod_remove", interaction.user.id, user.id, f"type={whitelist_type}", whitelist_type)
    await bot.sync_github_outputs()
    await interaction.response.send_message(f"Removed {user.mention} from active {whitelist_type} output.", ephemeral=True)


@bot.tree.command(name="mod_set", description="Moderator: replace a user's IDs")
@app_commands.autocomplete(whitelist_type=setup_autocomplete)
async def mod_set(interaction: discord.Interaction, user: discord.Member, whitelist_type: str, steam_ids: str = "", eos_ids: str = ""):
    if not await bot.require_mod(interaction):
        return
    member = user
    slots, plan = await bot.calculate_user_slots(member, whitelist_type)
    steam_vals = list(dict.fromkeys(token for token in split_identifier_tokens(steam_ids) if token))
    eos_vals = list(dict.fromkeys(token.lower() for token in split_identifier_tokens(eos_ids) if token))
    invalid_steam = [v for v in steam_vals if not validate_identifier("steam64", v)]
    invalid_eos = [v for v in eos_vals if not validate_identifier("eosid", v)]
    if invalid_steam or invalid_eos:
        await interaction.response.send_message("Invalid IDs supplied.", ephemeral=True)
        return
    submitted = [("steam64", v, True, "format_only") for v in steam_vals] + [("eosid", v, False, "unverified") for v in eos_vals]
    if len(submitted) > slots:
        await interaction.response.send_message(f"Target user only has {slots} slots.", ephemeral=True)
        return
    await bot.db.upsert_user_record(user.id, whitelist_type, str(user), "active", slots, plan)
    await bot.db.replace_identifiers(user.id, whitelist_type, submitted)
    await bot.db.audit("mod_set", interaction.user.id, user.id, f"type={whitelist_type} count={len(submitted)}", whitelist_type)
    changed = await bot.sync_github_outputs()
    await interaction.response.send_message(f"Saved {len(submitted)} IDs for {user.mention}. Changed files: {changed}", ephemeral=True)


@bot.tree.command(name="report_now", description="Send a report immediately")
@app_commands.autocomplete(whitelist_type=setup_autocomplete)
async def report_now(interaction: discord.Interaction, whitelist_type: str):
    if not await bot.require_mod(interaction):
        return
    active = await bot.db.fetchone("SELECT COUNT(*) FROM whitelist_users WHERE whitelist_type=%s AND status='active'", (whitelist_type,))
    ids = await bot.db.fetchone("SELECT COUNT(*) FROM whitelist_identifiers WHERE whitelist_type=%s", (whitelist_type,))
    await interaction.response.send_message(f"{whitelist_type.title()} report\nActive users: {active[0]}\nIdentifiers: {ids[0]}", ephemeral=True)


if __name__ == "__main__":
    if not all([DISCORD_TOKEN, DB_HOST, DB_NAME, DB_USER, GITHUB_TOKEN, GITHUB_REPO_OWNER, GITHUB_REPO_NAME]):
        raise RuntimeError("Missing required environment variables.")
    bot.run(DISCORD_TOKEN)
