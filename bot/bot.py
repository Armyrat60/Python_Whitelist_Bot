import asyncio
import json
from datetime import datetime, timedelta, timezone
from typing import Optional, List

import discord
from discord.ext import commands, tasks

from bot.config import (
    DISCORD_TOKEN, GUILD_ID, WHITELIST_FILENAME, WEB_ENABLED,
    WHITELIST_TYPES, log,
)
from bot.utils import utcnow, to_bool, split_identifier_tokens, validate_identifier
from bot.database import Database
from bot.github_publisher import GithubPublisher
from bot.web import WebServer


class WhitelistBot(commands.Bot):
    def __init__(self):
        intents = discord.Intents.default()
        intents.guilds = True
        intents.members = True
        intents.message_content = False
        super().__init__(command_prefix="!", intents=intents)
        self.db = Database()
        self.github = GithubPublisher()
        self.web = WebServer(self) if WEB_ENABLED else None
        self.panel_views = {}
        self.write_lock = asyncio.Lock()
        self._sync_pending = False
        self._sync_task: Optional[asyncio.Task] = None

    async def setup_hook(self):
        await self.db.connect()
        await self.db.init_schema()
        self.github.connect()
        if self.web:
            await self.web.start()
            # Prime the web cache with current content
            try:
                outputs = await self.get_output_contents()
                self.web.update_cache(outputs)
            except Exception:
                log.debug("Could not prime web cache on startup")

        # Load cog extensions
        for ext in ("bot.cogs.general", "bot.cogs.setup", "bot.cogs.whitelist", "bot.cogs.modtools", "bot.cogs.admin", "bot.cogs.notifications", "bot.cogs.search", "bot.cogs.audit", "bot.cogs.importexport"):
            await self.load_extension(ext)

        # Register persistent views for whitelist panels
        from bot.cogs.whitelist import WhitelistPanelView
        for whitelist_type in WHITELIST_TYPES:
            self.panel_views[whitelist_type] = WhitelistPanelView(self, whitelist_type)
            self.add_view(self.panel_views[whitelist_type])

        if GUILD_ID:
            guild_obj = discord.Object(id=GUILD_ID)
            # Copy current global commands to guild, then sync guild
            # This replaces ALL guild commands with exactly what's in the global tree
            self.tree.copy_global_to(guild=guild_obj)
            synced = await self.tree.sync(guild=guild_obj)
            log.info("Synced %s guild app commands to guild %s", len(synced), GUILD_ID)
            for cmd in synced:
                log.info("  -> /%s", cmd.name)
            # Clear global commands from Discord (we only want guild commands)
            self.tree.clear_commands(guild=None)
            await self.tree.sync()
        else:
            synced = await self.tree.sync()
            log.info("Synced %s global app commands", len(synced))
        self.weekly_report.start()
        self.daily_housekeeping.start()

    async def on_ready(self):
        log.info("Connected as %s (%s)", self.user, self.user.id)
        await self.log_startup_summary()
        # Refresh existing panels so buttons are live after restart
        for wt in WHITELIST_TYPES:
            try:
                await self.post_or_refresh_panel(None, wt)
            except Exception:
                log.debug("Could not refresh %s panel on startup", wt)

    async def close(self):
        if self.web:
            await self.web.stop()
        await super().close()

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
        for wt in WHITELIST_TYPES:
            cfg = await self.db.get_type_config(wt)
            parts.append(f"{wt}: enabled={cfg['enabled']} panel_channel_id={cfg['panel_channel_id']} log_channel_id={cfg['log_channel_id']} github_enabled={cfg['github_enabled']} file={cfg['github_filename']}")
        return " | ".join(parts)

    async def log_startup_summary(self):
        guild = self.get_guild(GUILD_ID) if GUILD_ID else None
        log.info("Startup summary | %s", await self.startup_summary_text(guild))

    async def build_status_embed(self, guild: Optional[discord.Guild]) -> discord.Embed:
        embed = discord.Embed(title="Whitelist Bot Status", color=discord.Color.blurple(), timestamp=datetime.now(timezone.utc))
        mod_role_id = int((await self.db.get_setting("mod_role_id", "")) or 0)
        embed.add_field(name="Mod Role", value=f"<@&{mod_role_id}>" if mod_role_id else "`Not set`", inline=True)
        embed.add_field(name="Output Mode", value=f"`{await self.db.get_setting('output_mode', 'combined')}`", inline=True)
        embed.add_field(name="Retention", value=f"`{await self.db.get_setting('retention_days', '90')}` days", inline=True)
        if self.web and self.web.runner:
            combined_fn = await self.db.get_setting("combined_filename", WHITELIST_FILENAME)
            wl_url = self.web.get_file_url(combined_fn)
            embed.add_field(name="Whitelist URL", value=f"`{wl_url}`", inline=False)
        groups = await self.db.get_squad_groups()
        if groups:
            group_text = " | ".join(f"`{n}`: {p}" for n, p, _ in groups)
            embed.add_field(name="Squad Groups", value=group_text, inline=False)
        for wt in WHITELIST_TYPES:
            cfg = await self.db.get_type_config(wt)
            if not cfg:
                continue
            status = "Enabled" if cfg["enabled"] else "Disabled"
            panel_ch = f"<#{cfg['panel_channel_id']}>" if cfg["panel_channel_id"] else "`Not set`"
            log_ch = f"<#{cfg['log_channel_id']}>" if cfg["log_channel_id"] else "`Not set`"
            gh = "On" if cfg["github_enabled"] else "Off"
            mappings = await self.db.get_role_mappings(wt)
            role_lines = [f"<@&{rid}> = {sl} slots" for rid, _, sl, active in mappings if active] or ["`None`"]
            embed.add_field(
                name=wt.title(),
                value=(
                    f"**Status:** `{status}`\n"
                    f"**Panel:** {panel_ch} | **Log:** {log_ch}\n"
                    f"**GitHub:** `{gh}` | `{cfg['github_filename']}`\n"
                    f"**Slots:** `{cfg['default_slot_limit']}` default | Stack: `{'Yes' if cfg['stack_roles'] else 'No'}`\n"
                    f"**Squad Group:** `{cfg.get('squad_group', 'Whitelist')}`\n"
                    f"**Roles:** " + ", ".join(role_lines)
                ),
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

    async def calculate_user_slots(self, member: discord.Member, whitelist_type: str, *, user_record=None, cfg=None) -> tuple:
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
        from bot.cogs.whitelist import IdentifierModal
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

    async def get_output_contents(self) -> dict:
        rows = await self.db.get_active_export_rows()
        mode = await self.db.get_setting("output_mode", "combined")
        dedupe_output = to_bool(await self.db.get_setting("duplicate_output_dedupe", "true"))

        # Load group configs per type and all squad groups
        type_cfgs = {}
        for wt in WHITELIST_TYPES:
            cfg = await self.db.get_type_config(wt)
            if cfg:
                type_cfgs[wt] = cfg

        squad_groups = await self.db.get_squad_groups()
        group_perms = {name: perms for name, perms, _ in squad_groups}

        def build_group_headers(used_groups: set) -> List[str]:
            lines = []
            for gname in sorted(used_groups):
                perms = group_perms.get(gname, "reserve")
                lines.append(f"Group={gname}:{perms}")
            lines.extend(["", ""])
            return lines

        def build_line(id_type: str, id_value: str, name: str, group_name: str) -> str:
            suffix = " [EOS]" if id_type == "eosid" else ""
            return f"Admin={id_value}:{group_name} // {name}{suffix}"

        outputs = {}
        combined_lines = []
        combined_seen = set()
        combined_groups = set()
        type_lines = {wt: [] for wt in WHITELIST_TYPES}
        type_seen = {wt: set() for wt in WHITELIST_TYPES}
        type_groups = {wt: set() for wt in WHITELIST_TYPES}

        for whitelist_type, _, discord_name, id_type, id_value in rows:
            group_name = type_cfgs.get(whitelist_type, {}).get("squad_group", "Whitelist")
            line = build_line(id_type, id_value, discord_name, group_name)
            key = f"{id_type}:{id_value}" if dedupe_output else line

            if mode in {"combined", "hybrid"} and key not in combined_seen:
                combined_lines.append(line)
                combined_seen.add(key)
                combined_groups.add(group_name)
            if mode in {"separate", "hybrid"}:
                if key not in type_seen.get(whitelist_type, set()):
                    type_lines.setdefault(whitelist_type, []).append(line)
                    type_seen.setdefault(whitelist_type, set()).add(key)
                    type_groups.setdefault(whitelist_type, set()).add(group_name)

        if mode in {"combined", "hybrid"}:
            content = build_group_headers(combined_groups) + combined_lines
            outputs[await self.db.get_setting("combined_filename", WHITELIST_FILENAME)] = "\n".join(content)
        if mode in {"separate", "hybrid"}:
            for wt in WHITELIST_TYPES:
                cfg = type_cfgs.get(wt)
                if cfg and cfg["github_enabled"]:
                    content = build_group_headers(type_groups.get(wt, set())) + type_lines.get(wt, [])
                    outputs[cfg["github_filename"]] = "\n".join(content)
        return outputs

    async def sync_github_outputs(self) -> int:
        outputs = await self.get_output_contents()
        # Update web server cache and optional disk write
        if self.web:
            self.web.update_cache(outputs)
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
        """Debounced GitHub sync -- waits 5s then syncs once, coalescing rapid-fire events."""
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
                "- **Steam64** \u2014 17-digit ID starting with `7656119`\n"
                "- **EOSID** \u2014 32-character hex string"
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

        # If no existing panel found, post a new one
        if posted is None:
            # Use provided channel, or fall back to the configured panel channel
            target = channel
            if target is None and stored_channel_id:
                target = self.get_channel(int(stored_channel_id))
            if target is not None:
                posted = await target.send(embed=embed, view=self.panel_views[whitelist_type])

        if posted is not None:
            await self.db.set_type_config(whitelist_type, panel_channel_id=posted.channel.id, panel_message_id=posted.id)
            actor = interaction.user.id if interaction else None
            await self.db.audit("panel_post", actor, None, f"type={whitelist_type} channel={posted.channel.id} message={posted.id}", whitelist_type)
        return posted

    async def enforce_member_roles(self, member: discord.Member):
        for whitelist_type in WHITELIST_TYPES:
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
        for whitelist_type in WHITELIST_TYPES:
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
        for whitelist_type in WHITELIST_TYPES:
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
