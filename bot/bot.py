import asyncio
import json
from datetime import datetime, timedelta, timezone
from typing import Optional, List

import discord
from discord.ext import commands, tasks

from bot.config import (
    DISCORD_TOKEN, WHITELIST_FILENAME, WEB_ENABLED,
    GITHUB_TOKEN, GITHUB_REPO_OWNER, GITHUB_REPO_NAME,
    log,
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
        self.github = GithubPublisher() if all([GITHUB_TOKEN, GITHUB_REPO_OWNER, GITHUB_REPO_NAME]) else None
        self.web = WebServer(self) if WEB_ENABLED else None
        self.panel_views = {}  # keyed by (guild_id, whitelist_id)
        self.write_lock = asyncio.Lock()
        self._sync_pending = False
        self._sync_task: Optional[asyncio.Task] = None

    async def setup_hook(self):
        await self.db.connect()
        await self.db.init_schema()
        if self.github:
            try:
                self.github.connect()
            except Exception:
                log.warning("GitHub connection failed (bad credentials?) -- disabling GitHub publishing")
                self.github = None
        else:
            log.info("GitHub publishing disabled (no GITHUB_TOKEN configured)")
        if self.web:
            await self.web.start()

        # Load cog extensions (setup, modtools, search, audit, importexport, admin moved to web dashboard)
        for ext in ("bot.cogs.general", "bot.cogs.whitelist", "bot.cogs.notifications"):
            await self.load_extension(ext)

        # Sync commands globally
        synced = await self.tree.sync()
        log.info("Synced %s global app commands", len(synced))
        for cmd in synced:
            log.info("  -> /%s", cmd.name)

        self.weekly_report.start()
        self.daily_housekeeping.start()

    async def on_ready(self):
        log.info("Connected as %s (%s)", self.user, self.user.id)
        # Seed defaults for all guilds
        for guild in self.guilds:
            await self.db.seed_guild_defaults(guild.id)
        # Register persistent views for whitelist panels per guild
        from bot.cogs.whitelist import WhitelistPanelView
        for guild in self.guilds:
            whitelists = await self.db.get_whitelists(guild.id)
            for wl in whitelists:
                key = (guild.id, wl["id"])
                if key not in self.panel_views:
                    view = WhitelistPanelView(self, wl["slug"])
                    self.panel_views[key] = view
                    self.add_view(view)
        # Prime the web cache with current content for all guilds
        if self.web:
            for guild in self.guilds:
                try:
                    outputs = await self.get_output_contents(guild.id)
                    self.web.update_cache(guild.id, outputs)
                except Exception:
                    log.debug("Could not prime web cache on startup for guild %s", guild.id)
        await self.log_startup_summary()
        # Refresh panels for all guilds
        for guild in self.guilds:
            whitelists = await self.db.get_whitelists(guild.id)
            for wl in whitelists:
                try:
                    await self.post_or_refresh_panel(None, guild.id, wl["slug"], wl_dict=wl)
                except Exception:
                    log.debug("Could not refresh %s panel for guild %s", wl["slug"], guild.id)

    async def on_guild_join(self, guild: discord.Guild):
        await self.db.seed_guild_defaults(guild.id)
        log.info("Joined guild %s (%s), seeded defaults", guild.name, guild.id)
        # Register persistent views for the new guild
        from bot.cogs.whitelist import WhitelistPanelView
        whitelists = await self.db.get_whitelists(guild.id)
        for wl in whitelists:
            key = (guild.id, wl["id"])
            if key not in self.panel_views:
                view = WhitelistPanelView(self, wl["slug"])
                self.panel_views[key] = view
                self.add_view(view)

    async def close(self):
        if self.web:
            await self.web.stop()
        await super().close()

    async def user_is_mod(self, guild_id: int, user: discord.abc.User) -> bool:
        """Tiered admin check:
        1. Guild owner
        2. Administrator permission
        3. Manage Guild permission
        4. Custom mod role(s) from bot settings
        """
        if not isinstance(user, discord.Member):
            return False
        # Guild owner
        if user.guild and user.guild.owner_id == user.id:
            return True
        # Discord Administrator permission
        if user.guild_permissions.administrator:
            return True
        # Discord Manage Guild permission
        if user.guild_permissions.manage_guild:
            return True
        # Custom mod roles (supports comma-separated IDs)
        mod_role_id_str = await self.db.get_setting(guild_id, "mod_role_id", "")
        if mod_role_id_str:
            mod_role_ids = {int(r.strip()) for r in mod_role_id_str.split(",") if r.strip().isdigit()}
            if any(r.id in mod_role_ids for r in user.roles):
                return True
        return False

    async def require_mod(self, interaction: discord.Interaction) -> bool:
        guild_id = interaction.guild.id
        if not await self.user_is_mod(guild_id, interaction.user):
            if interaction.response.is_done():
                await interaction.followup.send("You do not have permission.", ephemeral=True)
            else:
                await interaction.response.send_message("You do not have permission.", ephemeral=True)
            return False
        return True

    async def startup_summary_text(self, guild: discord.Guild) -> str:
        guild_id = guild.id
        output_mode = await self.db.get_setting(guild_id, "output_mode", "combined")
        combined_filename = await self.db.get_setting(guild_id, "combined_filename", WHITELIST_FILENAME)
        retention_days = await self.db.get_setting(guild_id, "retention_days", "90")
        parts = [f"guild_id={guild_id}", f"output_mode={output_mode}", f"combined_filename={combined_filename}", f"retention_days={retention_days}"]
        whitelists = await self.db.get_whitelists(guild_id)
        for wl in whitelists:
            parts.append(f"{wl['slug']}: enabled={wl['enabled']} panel_channel_id={wl['panel_channel_id']} log_channel_id={wl['log_channel_id']} file={wl['output_filename']}")
        return " | ".join(parts)

    async def log_startup_summary(self):
        for guild in self.guilds:
            log.info("Startup summary [%s] | %s", guild.name, await self.startup_summary_text(guild))

    async def build_status_embed(self, guild: discord.Guild) -> discord.Embed:
        guild_id = guild.id
        embed = discord.Embed(title="Whitelist Bot Status", color=discord.Color.blurple(), timestamp=datetime.now(timezone.utc))
        mod_role_id = int((await self.db.get_setting(guild_id, "mod_role_id", "")) or 0)
        embed.add_field(name="Mod Role", value=f"<@&{mod_role_id}>" if mod_role_id else "`Not set`", inline=True)
        embed.add_field(name="Output Mode", value=f"`{await self.db.get_setting(guild_id, 'output_mode', 'combined')}`", inline=True)
        embed.add_field(name="Retention", value=f"`{await self.db.get_setting(guild_id, 'retention_days', '90')}` days", inline=True)
        if self.web and self.web.runner:
            combined_fn = await self.db.get_setting(guild_id, "combined_filename", WHITELIST_FILENAME)
            wl_url = self.web.get_file_url(guild_id, combined_fn)
            embed.add_field(name="Whitelist URL", value=f"`{wl_url}`", inline=False)
        groups = await self.db.get_squad_groups(guild_id)
        if groups:
            group_text = " | ".join(f"`{n}`: {p}" for n, p, _ in groups)
            embed.add_field(name="Squad Groups", value=group_text, inline=False)
        whitelists = await self.db.get_whitelists(guild_id)
        for wl in whitelists:
            status = "Enabled" if wl["enabled"] else "Disabled"
            panel_ch = f"<#{wl['panel_channel_id']}>" if wl["panel_channel_id"] else "`Not set`"
            log_ch = f"<#{wl['log_channel_id']}>" if wl["log_channel_id"] else "`Not set`"
            mappings = await self.db.get_role_mappings(guild_id, wl["id"])
            role_lines = [f"<@&{rid}> = {sl} slots" for rid, _, sl, active in mappings if active] or ["`None`"]
            embed.add_field(
                name=wl["name"],
                value=(
                    f"**Status:** `{status}`\n"
                    f"**Panel:** {panel_ch} | **Log:** {log_ch}\n"
                    f"**Output file:** `{wl['output_filename']}`\n"
                    f"**Slots:** `{wl['default_slot_limit']}` default | Stack: `{'Yes' if wl['stack_roles'] else 'No'}`\n"
                    f"**Squad Group:** `{wl.get('squad_group') or 'Whitelist'}`\n"
                    f"**Roles:** " + ", ".join(role_lines)
                ),
                inline=False,
            )
        return embed

    async def send_log_embed(self, guild_id: int, whitelist_id_or_slug, title: str, description: str, color: discord.Color = discord.Color.blurple()):
        """Send an embed to the log channel for a whitelist. Accepts whitelist_id (int) or slug (str)."""
        if isinstance(whitelist_id_or_slug, int):
            # Look up the whitelist by id to get the log channel
            whitelists = await self.db.get_whitelists(guild_id)
            wl = next((w for w in whitelists if w["id"] == whitelist_id_or_slug), None)
            if not wl:
                return
            channel_id = wl["log_channel_id"]
        else:
            # Legacy: look up by slug
            wl = await self.db.get_whitelist_by_slug(guild_id, whitelist_id_or_slug)
            if not wl:
                return
            channel_id = wl["log_channel_id"]
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

    async def calculate_user_slots(self, guild_id: int, member: discord.Member, whitelist_id: int, *, user_record=None, wl=None, panel=None) -> tuple:
        """Calculate effective slots for a member. whitelist_id must be an int. wl is the whitelist dict.
        If panel is provided, its tier_category_id is checked first for tier_entries."""
        if user_record is None:
            user_record = await self.db.get_user_record(guild_id, member.id, whitelist_id)
        override_slots = user_record[2] if user_record else None
        if wl is None:
            whitelists = await self.db.get_whitelists(guild_id)
            wl = next((w for w in whitelists if w["id"] == whitelist_id), None)
            if not wl:
                return 0, "unknown"

        # Check for tier_category_id on the panel first
        tier_category_id = None
        if panel and panel.get("tier_category_id"):
            tier_category_id = panel["tier_category_id"]

        member_role_ids = {r.id for r in member.roles}
        if tier_category_id:
            # Use tier_entries from the category
            # te tuple: (id, role_id, role_name, slot_limit, display_name, sort_order, is_active)
            tier_entries = await self.db.get_tier_entries(guild_id, tier_category_id)
            matched = [
                (te[4] or te[2], te[3])  # (display_name or role_name, slot_limit)
                for te in tier_entries
                if bool(te[6]) and int(te[1]) in member_role_ids
            ]
            log.debug("Tier calc guild=%s member=%s category=%s entries=%d matched=%d member_roles=%s",
                       guild_id, member.id, tier_category_id, len(tier_entries), len(matched), member_role_ids)
        else:
            # Fall back to role_mappings for the whitelist (backward compat)
            mappings = await self.db.get_role_mappings(guild_id, whitelist_id)
            matched = [(role_name, slot_limit) for role_id, role_name, slot_limit, is_active in mappings if is_active and int(role_id) in member_role_ids]

        if override_slots is not None:
            return int(override_slots), f"override ({override_slots})"
        if matched:
            if wl["stack_roles"]:
                total = sum(x[1] for x in matched)
                return total, " + ".join(f"{n}:{s}" for n, s in matched)
            winner = max(matched, key=lambda x: x[1])
            return winner[1], f"{winner[0]}:{winner[1]}"
        return int(wl["default_slot_limit"]), f"default:{wl['default_slot_limit']}"

    async def start_whitelist_flow(self, interaction: discord.Interaction, whitelist_type: str):
        """Start the whitelist submission flow. whitelist_type is a slug string (for cog compat)."""
        try:
            from bot.cogs.whitelist import IdentifierModal
            guild_id = interaction.guild.id
            wl = await self.db.get_whitelist_by_slug(guild_id, whitelist_type)
            if not wl or not wl["enabled"]:
                await interaction.response.send_message(f"{whitelist_type.title()} whitelist is disabled.", ephemeral=True)
                return
            whitelist_id = wl["id"]
            member = interaction.guild.get_member(interaction.user.id)

            # Find panel for this whitelist to get tier_category_id
            panels = await self.db.get_panels(guild_id)
            panel = next((p for p in panels if p.get("whitelist_id") == whitelist_id and p.get("tier_category_id")), None)

            slots, _ = await self.calculate_user_slots(guild_id, member, whitelist_id, wl=wl, panel=panel)
            if slots <= 0:
                await interaction.response.send_message("You don't have a role that grants whitelist access. Contact your server admin.", ephemeral=True)
                return
            existing = await self.db.get_identifiers(guild_id, interaction.user.id, whitelist_id)
            await interaction.response.send_modal(IdentifierModal(self, whitelist_type, slots, existing))
        except Exception:
            log.exception("Error starting whitelist flow for %s (type=%s)", interaction.user, whitelist_type)
            try:
                if interaction.response.is_done():
                    await interaction.followup.send("Something went wrong. Please try again.", ephemeral=True)
                else:
                    await interaction.response.send_message("Something went wrong. Please try again.", ephemeral=True)
            except Exception:
                pass

    async def handle_identifier_submission(self, interaction: discord.Interaction, whitelist_type: str, steam_raw: str, eos_raw: str):
        try:
            await self._handle_identifier_submission_inner(interaction, whitelist_type, steam_raw, eos_raw)
        except Exception:
            log.exception("Error handling identifier submission for %s in guild %s", interaction.user, getattr(interaction.guild, 'id', '?'))
            try:
                if interaction.response.is_done():
                    await interaction.followup.send("Something went wrong while saving your whitelist. Please try again.", ephemeral=True)
                else:
                    await interaction.response.send_message("Something went wrong while saving your whitelist. Please try again.", ephemeral=True)
            except Exception:
                pass  # Interaction may have expired

    async def _handle_identifier_submission_inner(self, interaction: discord.Interaction, whitelist_type: str, steam_raw: str, eos_raw: str):
        guild_id = interaction.guild.id
        wl = await self.db.get_whitelist_by_slug(guild_id, whitelist_type)
        if not wl:
            await interaction.response.send_message("Whitelist not found.", ephemeral=True)
            return
        whitelist_id = wl["id"]
        member = interaction.guild.get_member(interaction.user.id)

        # Find panel for tier_category lookup
        panels = await self.db.get_panels(guild_id)
        panel = next((p for p in panels if p.get("whitelist_id") == whitelist_id and p.get("tier_category_id")), None)

        slots, plan = await self.calculate_user_slots(guild_id, member, whitelist_id, wl=wl, panel=panel)
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
            flat_params.extend([interaction.user.id, whitelist_id])
            rows = await self.db.fetchall(
                f"""
                SELECT DISTINCT id_type, id_value
                FROM whitelist_identifiers
                WHERE (id_type, id_value) IN ({placeholders})
                  AND NOT (discord_id=%s AND whitelist_id=%s)
                """,
                tuple(flat_params),
            )
            duplicate_warnings = [f"{r[0]}:{r[1]}" for r in rows]

        async with self.write_lock:
            await self.db.upsert_user_record(
                guild_id,
                interaction.user.id,
                whitelist_id,
                str(interaction.user),
                "active",
                slots,
                plan,
            )
            await self.db.replace_identifiers(guild_id, interaction.user.id, whitelist_id, submitted)
            await self.db.audit(
                guild_id,
                "user_submit",
                interaction.user.id,
                interaction.user.id,
                json.dumps({"whitelist_type": whitelist_type, "whitelist_id": whitelist_id, "slots": slots, "plan": plan, "count": len(submitted), "duplicates_warned": duplicate_warnings}),
                whitelist_id,
            )
        changed = await self.sync_github_outputs(guild_id)
        msg = f"Saved {len(submitted)} identifier(s). GitHub files changed: {changed}."
        if duplicate_warnings:
            msg += "\nWarning: duplicate identifiers exist elsewhere; published output is deduped."
        await interaction.response.send_message(msg, ephemeral=True)
        await self.send_log_embed(guild_id, whitelist_id, "Whitelist Updated", f"User: <@{interaction.user.id}>\nType: `{whitelist_type}`\nSlots: `{slots}`\nPlan: `{plan}`\nIDs: `{len(submitted)}`", discord.Color.green())

    async def get_output_contents(self, guild_id: int) -> dict:
        """Generate whitelist output files using shared module."""
        from bot.output import generate_output_files
        return await generate_output_files(self.db, guild_id)

    async def sync_github_outputs(self, guild_id: int = None) -> int:
        if guild_id is None:
            # Sync all guilds
            total = 0
            for guild in self.guilds:
                total += await self.sync_github_outputs(guild.id)
            return total
        # Sync specific guild
        outputs = await self.get_output_contents(guild_id)
        # Update web server cache and optional disk write
        if self.web:
            self.web.update_cache(guild_id, outputs)
        # Publish to GitHub if configured
        changed = 0
        if self.github:
            for filename, content in outputs.items():
                try:
                    updated = await asyncio.to_thread(self.github.update_file_if_needed, filename, content)
                    if updated:
                        changed += 1
                except Exception:
                    log.exception("Failed to sync %s to GitHub", filename)
        return changed

    def schedule_github_sync(self, guild_id: int = None):
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

    async def _build_panel_embed(self, guild_id: int, wl: dict) -> discord.Embed:
        wl_name = wl["name"]
        wl_id = wl["id"]

        # Get tier entries from panel's category, or fall back to role_mappings
        panels = await self.db.get_panels(guild_id)
        panel = next((p for p in panels if p.get("whitelist_id") == wl_id and p.get("tier_category_id")), None)

        tier_lines = []
        if panel and panel.get("tier_category_id"):
            tier_entries = await self.db.get_tier_entries(guild_id, panel["tier_category_id"])
            # Sort by slot_limit ascending
            tier_entries = sorted(tier_entries, key=lambda te: te[3])
            for te in tier_entries:
                role_id = te[1]  # role_id
                slot_limit = te[3]
                display_name = te[4] or te[2]  # display_name or role_name
                # Use role mention for colored display (pings suppressed via allowed_mentions)
                tier_lines.append(f"<@&{role_id}> — {slot_limit} {'slot' if slot_limit == 1 else 'slots'}")
        else:
            role_mappings = await self.db.get_role_mappings(guild_id, wl_id)
            for rm in role_mappings:
                role_id = rm[0] if len(rm) > 0 else 0
                role_name = rm[1] if len(rm) > 1 else "Unknown"
                slot_limit = rm[2] if len(rm) > 2 else 1
                tier_lines.append(f"<@&{role_id}> — {slot_limit} {'slot' if slot_limit == 1 else 'slots'}")

        description = "Use the buttons below to manage your whitelist entry.\n\n"
        if tier_lines:
            description += "**Available Tiers:**\n" + "\n".join(tier_lines) + "\n\n"
        description += (
            "🛡️ **Submit / Update ID** — Enter your Steam64 or EOS ID\n"
            "📋 **View My Whitelist** — Check your current entry and slots\n"
            "🌐 **Web Dashboard** — Manage everything from the browser"
        )

        embed = discord.Embed(
            title=f"🛡️ {wl_name}",
            description=description,
            color=discord.Color.from_rgb(249, 115, 22),  # Orange
        )
        embed.set_footer(text=f"Squad Whitelister • {WEB_BASE_URL.replace('https://', '') if WEB_BASE_URL else 'squadwhitelister.com'}")
        return embed

    async def post_or_refresh_panel(self, interaction: Optional[discord.Interaction], guild_id: int, whitelist_type: str, channel: Optional[discord.abc.Messageable] = None, *, wl_dict: dict = None):
        """Post or refresh a whitelist panel. whitelist_type is the slug for backward compat.
        Pass wl_dict to avoid an extra DB lookup."""
        wl = wl_dict
        if wl is None:
            wl = await self.db.get_whitelist_by_slug(guild_id, whitelist_type)
        if not wl:
            return None
        whitelist_id = wl["id"]
        embed = await self._build_panel_embed(guild_id, wl)

        view_key = (guild_id, whitelist_id)
        # Ensure we have a view for this guild+whitelist
        if view_key not in self.panel_views:
            from bot.cogs.whitelist import WhitelistPanelView
            view = WhitelistPanelView(self, wl["slug"])
            self.panel_views[view_key] = view
            self.add_view(view)
        panel_view = self.panel_views[view_key]

        # Try to find the existing panel in its stored channel first
        posted = None
        stored_channel_id = wl["panel_channel_id"]
        stored_message_id = wl["panel_message_id"]
        if stored_message_id and stored_channel_id:
            try:
                stored_ch = self.get_channel(int(stored_channel_id))
                if stored_ch:
                    old = await stored_ch.fetch_message(int(stored_message_id))
                    await old.edit(embed=embed, view=panel_view, allowed_mentions=discord.AllowedMentions.none())
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
                posted = await target.send(embed=embed, view=panel_view, allowed_mentions=discord.AllowedMentions.none())

        if posted is not None:
            await self.db.update_whitelist(whitelist_id, panel_channel_id=posted.channel.id, panel_message_id=posted.id)
            actor = interaction.user.id if interaction else None
            await self.db.audit(guild_id, "panel_post", actor, None, f"type={wl['slug']} channel={posted.channel.id} message={posted.id}", whitelist_id)
        return posted

    async def enforce_member_roles(self, member: discord.Member):
        guild_id = member.guild.id
        whitelists = await self.db.get_whitelists(guild_id)
        panels = await self.db.get_panels(guild_id)
        for wl in whitelists:
            if not wl["enabled"]:
                continue
            whitelist_id = wl["id"]
            user_record = await self.db.get_user_record(guild_id, member.id, whitelist_id)
            if not user_record:
                continue
            # Find panel with tier_category for this whitelist
            panel = next((p for p in panels if p.get("whitelist_id") == whitelist_id and p.get("tier_category_id")), None)
            slots, plan = await self.calculate_user_slots(guild_id, member, whitelist_id, user_record=user_record, wl=wl, panel=panel)
            status_before = user_record[1]
            if slots <= 0:
                if status_before == "active":
                    await self.db.set_user_status(guild_id, member.id, whitelist_id, "disabled_role_lost")
                    await self.db.audit(guild_id, "auto_disable_role_lost", None, member.id, f"type={wl['slug']}", whitelist_id)
                    await self.send_log_embed(guild_id, whitelist_id, "Whitelist Disabled", f"User <@{member.id}> lost required role(s).", discord.Color.orange())
            else:
                if status_before != "active" and to_bool(await self.db.get_setting(guild_id, "auto_reactivate_on_role_return", "true")):
                    await self.db.upsert_user_record(guild_id, member.id, whitelist_id, str(member), "active", slots, plan, user_record[2])
                    await self.db.audit(guild_id, "auto_reactivate_role_return", None, member.id, f"type={wl['slug']}", whitelist_id)
                    await self.send_log_embed(guild_id, whitelist_id, "Whitelist Re-enabled", f"User <@{member.id}> regained eligible role(s).", discord.Color.green())
                else:
                    await self.db.upsert_user_record(guild_id, member.id, whitelist_id, str(member), status_before, slots, plan, user_record[2])
        self.schedule_github_sync(guild_id)

    async def on_member_update(self, before: discord.Member, after: discord.Member):
        if before.roles != after.roles:
            await self.enforce_member_roles(after)

    async def on_member_remove(self, member: discord.Member):
        guild_id = member.guild.id
        whitelists = await self.db.get_whitelists(guild_id)
        for wl in whitelists:
            whitelist_id = wl["id"]
            row = await self.db.get_user_record(guild_id, member.id, whitelist_id)
            if row:
                await self.db.set_user_status(guild_id, member.id, whitelist_id, "left_guild")
                await self.db.audit(guild_id, "left_guild", None, member.id, f"type={wl['slug']}", whitelist_id)
                await self.send_log_embed(guild_id, whitelist_id, "User Left Guild", f"<@{member.id}> removed from active output.", discord.Color.red())
        self.schedule_github_sync(guild_id)

    @tasks.loop(hours=24)
    async def daily_housekeeping(self):
        for guild in self.guilds:
            guild_id = guild.id
            retention = int(await self.db.get_setting(guild_id, "retention_days", "90"))
            purged = await self.db.purge_inactive_older_than(guild_id, retention)
            if purged:
                log.info("Purged %s inactive records older than %s days for guild %s", purged, retention, guild_id)

    @daily_housekeeping.before_loop
    async def _before_housekeeping(self):
        await self.wait_until_ready()

    @tasks.loop(hours=24)
    async def weekly_report(self):
        for guild in self.guilds:
            guild_id = guild.id
            frequency = (await self.db.get_setting(guild_id, "report_frequency", "weekly")).lower()
            now = datetime.now(timezone.utc)
            should_send = frequency == "daily" or (frequency == "weekly" and now.weekday() == 0)
            if not should_send:
                continue
            whitelists = await self.db.get_whitelists(guild_id)
            for wl in whitelists:
                if not wl["log_channel_id"]:
                    continue
                whitelist_id = wl["id"]
                active = await self.db.fetchone("SELECT COUNT(*) FROM whitelist_users WHERE guild_id=%s AND whitelist_id=%s AND status='active'", (guild_id, whitelist_id))
                ids = await self.db.fetchone("SELECT COUNT(*) FROM whitelist_identifiers WHERE guild_id=%s AND whitelist_id=%s", (guild_id, whitelist_id))
                actions = await self.db.fetchone("SELECT COUNT(*) FROM audit_log WHERE guild_id=%s AND whitelist_id=%s AND created_at >= %s", (guild_id, whitelist_id, utcnow() - timedelta(days=7 if frequency == 'weekly' else 1)))
                await self.send_log_embed(guild_id, whitelist_id, f"{frequency.title()} Report", f"Active users: `{active[0]}`\nIdentifiers: `{ids[0]}`\nActions in window: `{actions[0]}`", discord.Color.blurple())

    @weekly_report.before_loop
    async def _before_weekly_report(self):
        await self.wait_until_ready()
