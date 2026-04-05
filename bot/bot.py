import asyncio
import json
import re
from datetime import datetime, timedelta, timezone
from typing import Optional, List

import discord
from discord.ext import commands, tasks

from bot.config import (
    DISCORD_TOKEN, WHITELIST_FILENAME,
    GITHUB_TOKEN, GITHUB_REPO_OWNER, GITHUB_REPO_NAME,
    SENTRY_DSN, log,
)

# Initialise Sentry as early as possible so all unhandled exceptions are captured
if SENTRY_DSN:
    try:
        import sentry_sdk
        sentry_sdk.init(dsn=SENTRY_DSN, traces_sample_rate=0.1)
        log.info("Sentry error tracking enabled")
    except ImportError:
        log.warning("SENTRY_DSN set but sentry-sdk is not installed. Run: pip install sentry-sdk")
from bot.utils import utcnow, to_bool, split_identifier_tokens, validate_identifier
from bot.database import Database
from bot.github_publisher import GithubPublisher

_CLAN_TAG_RE = re.compile(r'^\[([A-Za-z0-9 _\-]{1,15})\]\s*')

def parse_clan_tag(display_name: str) -> tuple[str | None, str]:
    """Extract a [TAG] prefix from a Discord display name. Returns (tag, clean_name)."""
    m = _CLAN_TAG_RE.match(display_name)
    if m:
        tag = m.group(1).strip()
        clean = display_name[m.end():].strip()
        return tag, clean or display_name
    return None, display_name


class WhitelistBot(commands.Bot):
    def __init__(self):
        intents = discord.Intents.default()
        intents.guilds = True
        intents.members = True
        intents.message_content = False
        super().__init__(command_prefix="!", intents=intents)
        self.db = Database()
        self.github = GithubPublisher() if all([GITHUB_TOKEN, GITHUB_REPO_OWNER, GITHUB_REPO_NAME]) else None
        self.panel_views = {}  # keyed by (guild_id, whitelist_id)
        self.write_lock = asyncio.Lock()
        self._sync_pending = False
        self._sync_task: Optional[asyncio.Task] = None
        # Limit concurrent panel refreshes so startup doesn't hammer the Discord API
        self._panel_refresh_sem = asyncio.Semaphore(3)

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
        # Load cog extensions (setup, modtools, search, audit, importexport, admin moved to web dashboard)
        for ext in ("bot.cogs.general", "bot.cogs.whitelist", "bot.cogs.notifications"):
            await self.load_extension(ext)

        # Register persistent views for ALL whitelist panels BEFORE gateway connects.
        # This ensures button interactions are handled immediately, even during reconnects.
        from bot.cogs.whitelist import WhitelistPanelView
        all_guild_whitelists = await self.db.fetchall(
            "SELECT guild_id, id, slug FROM whitelists"
        )
        for row in all_guild_whitelists:
            g_id, wl_id, slug = int(row[0]), int(row[1]), row[2]
            key = (g_id, wl_id)
            if key not in self.panel_views:
                view = WhitelistPanelView(self, slug, whitelist_id=wl_id)
                self.panel_views[key] = view
                self.add_view(view)
        log.info("Registered %d persistent panel views", len(self.panel_views))

        # Sync commands globally — retry once on transient Discord outage
        try:
            synced = await self.tree.sync()
            log.info("Synced %s global app commands", len(synced))
            for cmd in synced:
                log.info("  -> /%s", cmd.name)
        except discord.HTTPException as e:
            log.warning("tree.sync() failed (Discord may be unavailable): %s — commands may not update until next restart", e)

        self.weekly_report.start()
        self.daily_housekeeping.start()
        self.panel_refresh_poller.start()

    async def on_ready(self):
        log.info("Connected as %s (%s)", self.user, self.user.id)
        # Seed defaults for all guilds
        for guild in self.guilds:
            await self.db.seed_guild_defaults(guild.id)
        # Panel views already registered in setup_hook — just check for any new ones
        from bot.cogs.whitelist import WhitelistPanelView
        for guild in self.guilds:
            whitelists = await self.db.get_whitelists(guild.id)
            for wl in whitelists:
                key = (guild.id, wl["id"])
                if key not in self.panel_views:
                    view = WhitelistPanelView(self, wl["slug"], whitelist_id=wl["id"])
                    self.panel_views[key] = view
                    self.add_view(view)
        await self.log_startup_summary()
        # Refresh all active panels on startup (updates buttons + tier info)
        # Use a semaphore to avoid flooding the Discord API when many panels exist
        async def _refresh_one(guild, panel):
            wl = await self.db.get_whitelist_by_id(panel["whitelist_id"])
            if wl and wl["enabled"]:
                async with self._panel_refresh_sem:
                    try:
                        await self.post_or_refresh_panel(None, guild.id, wl["slug"], wl_dict=wl)
                        log.info("Refreshed panel '%s' in guild %s", panel["name"], guild.name)
                    except Exception:
                        log.exception("Startup: failed to refresh panel '%s' (id=%s) for guild %s", panel["name"], panel.get("id"), guild.id)

        refresh_tasks = []
        for guild in self.guilds:
            panels = await self.db.get_panels(guild.id)
            for panel in panels:
                if not panel.get("channel_id") or not panel.get("whitelist_id"):
                    continue
                if not panel.get("enabled", True):
                    continue
                refresh_tasks.append(_refresh_one(guild, panel))
        if refresh_tasks:
            log.info("Startup: refreshing %d panel(s) across %d guild(s)", len(refresh_tasks), len(self.guilds))
            await asyncio.gather(*refresh_tasks)

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

    async def on_error(self, event_method: str, *args, **kwargs):
        """Catch unhandled exceptions in event listeners and log them."""
        log.exception("Unhandled exception in event '%s'", event_method)

    async def on_command_error(self, ctx, error):
        """Catch unhandled slash-command errors."""
        log.exception("Unhandled command error in '%s'", ctx.command, exc_info=error)

    async def close(self):
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
        groups = await self.db.get_squad_groups(guild_id)
        if groups:
            group_text = " | ".join(f"`{n}`: {p}" for n, p, _ in groups)
            embed.add_field(name="Squad Groups", value=group_text, inline=False)
        whitelists = await self.db.get_whitelists(guild_id)
        for wl in whitelists:
            status = "Enabled" if wl["enabled"] else "Disabled"
            panel_ch = f"<#{wl['panel_channel_id']}>" if wl["panel_channel_id"] else "`Not set`"
            log_ch = f"<#{wl['log_channel_id']}>" if wl["log_channel_id"] else "`Not set`"
            panels_for_wl = await self.db.fetchall(
                "SELECT id FROM panels WHERE guild_id=%s AND whitelist_id=%s AND enabled=TRUE LIMIT 1",
                (guild_id, wl["id"]),
            )
            panel_id_for_wl = int(panels_for_wl[0][0]) if panels_for_wl else None
            wl_roles = await self.db.get_panel_roles(guild_id, panel_id_for_wl) if panel_id_for_wl else []
            role_lines = [f"<@&{r[1]}> = {r[3]} slots" for r in wl_roles if r[6]] or ["`None`"]
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
            await channel.send(embed=embed, allowed_mentions=discord.AllowedMentions.none())
        except discord.Forbidden:
            log.warning("Missing access to log channel %s", channel_id)

    async def send_notification(self, guild_id: int, title: str, description: str, color: discord.Color = discord.Color.orange()):
        """Send a system notification to the guild's configured notification channel."""
        await self.send_notification_event(guild_id, "bot_alert", title, description, color)

    async def send_notification_event(self, guild_id: int, event_type: str, title: str, description: str, color: discord.Color = discord.Color.blurple()):
        """Route a notification to the configured channel for this event type.
        Falls back to the legacy notification_channel_id setting if no routing is configured."""
        routing = await self.db.get_notification_routing(guild_id)
        channel_id = routing.get(event_type, "")
        if not channel_id:
            channel_id = await self.db.get_setting(guild_id, "notification_channel_id") or ""
        if not channel_id:
            return
        channel = self.get_channel(int(channel_id))
        if not channel:
            return
        embed = discord.Embed(title=title, description=description, color=color, timestamp=datetime.now(timezone.utc))
        embed.set_footer(text="Squad Whitelister")
        try:
            await channel.send(embed=embed, allowed_mentions=discord.AllowedMentions.none())
        except discord.Forbidden:
            log.warning("Missing access to notification channel %s for event %s", channel_id, event_type)

    async def calculate_user_slots(self, guild_id: int, member: discord.Member, whitelist_id: int, *, user_record=None, wl=None, panel=None) -> tuple:
        """Calculate effective slots for a member.

        Returns (slot_count: int, plan_description: str).
        Every code path is logged at INFO level for audit trail.
        """
        if member is None:
            log.warning("calculate_user_slots called with member=None guild=%s wl=%s", guild_id, whitelist_id)
            return 0, "error:no_member"

        if user_record is None:
            user_record = await self.db.get_user_record(guild_id, member.id, whitelist_id)
        override_slots = user_record[2] if user_record else None
        if wl is None:
            whitelists = await self.db.get_whitelists(guild_id)
            wl = next((w for w in whitelists if w["id"] == whitelist_id), None)
            if not wl:
                log.warning("calculate_user_slots: whitelist %s not found for guild %s", whitelist_id, guild_id)
                return 0, "error:whitelist_not_found"

        # Admin override takes priority
        if override_slots is not None:
            log.info("Slot calc: guild=%s user=%s (%s) → OVERRIDE %s slots",
                     guild_id, member.id, member.display_name, override_slots)
            return int(override_slots), f"override ({override_slots})"

        member_role_ids = {r.id for r in member.roles}
        member_role_names = {r.id: r.name for r in member.roles}

        # Resolve panel_id: use provided panel or find the first enabled panel for this whitelist
        panel_id = panel["id"] if panel else None
        if panel_id is None:
            panels = await self.db.fetchall(
                "SELECT id FROM panels WHERE guild_id=%s AND whitelist_id=%s AND enabled=TRUE LIMIT 1",
                (guild_id, whitelist_id),
            )
            panel_id = int(panels[0][0]) if panels else None

        # panel_role tuple: (id, role_id, role_name, slot_limit, display_name, sort_order, is_active, is_stackable)
        wl_roles = await self.db.get_panel_roles(guild_id, panel_id) if panel_id else []
        stackable_matched = []
        non_stackable_matched = []
        for r in wl_roles:
            r_role_id = int(r[1])
            r_active = bool(r[6])
            r_stackable = bool(r[7])
            r_slots = r[3]
            r_name = r[4] or r[2]
            if r_active and r_role_id in member_role_ids:
                if r_stackable:
                    stackable_matched.append((r_name, r_slots))
                    log.info("Slot calc: guild=%s user=%s (%s) → MATCHED stackable '%s' = %d slots",
                             guild_id, member.id, member.display_name, r_name, r_slots)
                else:
                    non_stackable_matched.append((r_name, r_slots))
                    log.info("Slot calc: guild=%s user=%s (%s) → MATCHED exclusive '%s' = %d slots",
                             guild_id, member.id, member.display_name, r_name, r_slots)

        # Combine: all stackable entries + only the highest exclusive (non-stackable) entry
        matched = list(stackable_matched)
        if non_stackable_matched:
            best_exclusive = max(non_stackable_matched, key=lambda x: x[1])
            matched.append(best_exclusive)
            if len(non_stackable_matched) > 1:
                log.info("Slot calc: guild=%s user=%s (%s) → multiple exclusive roles, using highest '%s'",
                         guild_id, member.id, member.display_name, best_exclusive[0])

        if not matched:
            log.info("Slot calc: guild=%s user=%s (%s) → NO MATCH (%d roles). "
                     "User roles: %s. Mapped role IDs: %s",
                     guild_id, member.id, member.display_name, len(wl_roles),
                     [(rid, member_role_names.get(rid, '?')) for rid in sorted(member_role_ids)],
                     [(int(r[1]), r[2], bool(r[6])) for r in wl_roles])

        if matched:
            total = sum(x[1] for x in matched)
            plan = " + ".join(f"{n}:{s}" for n, s in matched) if len(matched) > 1 else f"{matched[0][0]}:{matched[0][1]}"
            log.info("Slot calc: guild=%s user=%s (%s) → RESULT %d slots (%s)",
                     guild_id, member.id, member.display_name, total, plan)
            return total, plan

        log.info("Slot calc: guild=%s user=%s (%s) → NO ROLE MATCH — 0 slots",
                 guild_id, member.id, member.display_name)
        return 0, "no_role"

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

            slots, _ = await self.calculate_user_slots(guild_id, member, whitelist_id, wl=wl)
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

        slots, plan = await self.calculate_user_slots(guild_id, member, whitelist_id, wl=wl)
        log.info("Submit: guild=%s user=%s (%s) wl=%s slots=%d plan=%s",
                 guild_id, member.id if member else '?', interaction.user, whitelist_type, slots, plan)
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
                  AND discord_id > 0
                """,
                tuple(flat_params),
            )
            duplicate_warnings = [f"{r[0]}:{r[1]}" for r in rows]

        # Auto-claim: if any submitted IDs are owned by orphan records (discord_id < 0,
        # created during bulk import with no Discord ID), silently delete those orphans
        # so this real user cleanly takes ownership of their IDs.
        if submitted:
            pairs_claim = [(id_type, id_value) for id_type, id_value, *_ in submitted]
            ph_claim = ",".join(["(%s,%s)"] * len(pairs_claim))
            flat_claim = [v for pair in pairs_claim for v in pair]
            flat_claim.extend([guild_id, whitelist_id])
            orphan_rows = await self.db.fetchall(
                f"""
                SELECT DISTINCT discord_id FROM whitelist_identifiers
                WHERE (id_type, id_value) IN ({ph_claim})
                  AND guild_id=%s AND whitelist_id=%s AND discord_id < 0
                """,
                tuple(flat_claim),
            )
            for orphan_row in orphan_rows:
                orphan_id = orphan_row[0]
                await self.db.execute_transaction([
                    (
                        "DELETE FROM whitelist_identifiers WHERE guild_id=%s AND whitelist_id=%s AND discord_id=%s",
                        (guild_id, whitelist_id, orphan_id),
                    ),
                    (
                        "DELETE FROM whitelist_users WHERE guild_id=%s AND whitelist_id=%s AND discord_id=%s",
                        (guild_id, whitelist_id, orphan_id),
                    ),
                ])
                log.info(
                    "Auto-claimed orphan discord_id=%s → real user=%s in guild=%s wl=%s",
                    orphan_id, interaction.user.id, guild_id, whitelist_id,
                )

        existing_before_save = await self.db.get_identifiers(guild_id, interaction.user.id, whitelist_id)
        _u_nick = getattr(interaction.user, 'nick', None)
        _u_display = _u_nick or interaction.user.display_name or str(interaction.user)
        _u_tag, _ = parse_clan_tag(_u_display)
        async with self.write_lock:
            await self.db.upsert_user_record(
                guild_id,
                interaction.user.id,
                whitelist_id,
                _u_display,
                "active",
                slots,
                plan,
                created_via="self_register",
                discord_username=interaction.user.name,
                discord_nick=_u_nick,
                clan_tag=_u_tag,
            )
            await self.db.replace_identifiers(guild_id, interaction.user.id, whitelist_id, submitted)

        # Warm Steam name cache for any new Steam IDs (fire and forget)
        new_steam_ids = [v for t, v, *_ in submitted if t == "steam64"]
        if new_steam_ids:
            from bot.utils import resolve_steam_names
            asyncio.create_task(resolve_steam_names(new_steam_ids, db=self.db))

            # Post-save verification: read back and confirm
            saved_ids = await self.db.get_identifiers(guild_id, interaction.user.id, whitelist_id)
            if len(saved_ids) != len(submitted):
                log.error("DATA INTEGRITY: guild=%s user=%s submitted %d IDs but only %d saved! submitted=%s saved=%s",
                          guild_id, interaction.user.id, len(submitted), len(saved_ids),
                          [(t, v) for t, v, *_ in submitted],
                          [(t, v) for t, v, *_ in saved_ids])
            else:
                log.info("Submit verified: guild=%s user=%s (%s) saved %d IDs to wl=%s",
                         guild_id, interaction.user.id, interaction.user, len(saved_ids), whitelist_type)
            await self.db.audit(
                guild_id,
                "user_submit",
                interaction.user.id,
                interaction.user.id,
                json.dumps({"whitelist_type": whitelist_type, "whitelist_id": whitelist_id, "slots": slots, "plan": plan, "count": len(submitted), "duplicates_warned": duplicate_warnings}),
                whitelist_id,
            )
        changed = await self.sync_github_outputs(guild_id)
        msg = f"Saved {len(submitted)} identifier(s)."
        if duplicate_warnings:
            msg += "\nWarning: duplicate identifiers exist elsewhere; published output is deduped."
        await interaction.response.send_message(msg, ephemeral=True)
        await self.send_log_embed(guild_id, whitelist_id, "Whitelist Updated", f"User: <@{interaction.user.id}>\nType: `{whitelist_type}`\nSlots: `{slots}`\nPlan: `{plan}`\nIDs: `{len(submitted)}`", discord.Color.green())

        # Send welcome DM on first submission
        try:
            is_first = not bool(existing_before_save)
            if is_first and to_bool(await self.db.get_setting(guild_id, "welcome_dm_enabled", "false")):
                welcome_text = await self.db.get_setting(guild_id, "welcome_dm_text", "")
                if welcome_text:
                    guild_name = interaction.guild.name if interaction.guild else "the server"
                    dm_text = welcome_text.replace("{user}", str(interaction.user)).replace("{guild}", guild_name).replace("{slots}", str(slots)).replace("{tier}", plan.split(":")[0] if ":" in plan else plan)
                    try:
                        await interaction.user.send(dm_text)
                    except discord.Forbidden:
                        pass  # User has DMs disabled
        except Exception:
            pass  # Don't fail the submission over a DM error

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
        from bot.panel_builder import build_panel_embed
        panels = await self.db.get_panels(guild_id)
        panel = next((p for p in panels if p.get("whitelist_id") == wl["id"]), None)
        return await build_panel_embed(self.db, guild_id, panel, wl)

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

        # Find the panel record that links to this whitelist
        panels = await self.db.get_panels(guild_id)
        panel_record = next((p for p in panels if p.get("whitelist_id") == whitelist_id), None)

        # Try to find the existing panel message in its stored channel
        posted = None
        stored_channel_id = panel_record["channel_id"] if panel_record else wl.get("panel_channel_id")
        stored_message_id = panel_record["panel_message_id"] if panel_record else wl.get("panel_message_id")

        label = f"[panel][guild={guild_id}][wl={whitelist_id}]"

        async def _resolve_channel(ch_id: int):
            """Get channel from cache; fall back to REST fetch if not cached."""
            ch = self.get_channel(ch_id)
            if ch is None:
                try:
                    ch = await self.fetch_channel(ch_id)
                except discord.NotFound:
                    log.warning("%s Channel %s not found — was it deleted?", label, ch_id)
                except discord.Forbidden:
                    log.warning("%s Bot lacks access to channel %s — check permissions", label, ch_id)
                except Exception as e:
                    log.exception("%s Unexpected error fetching channel %s: %s", label, ch_id, e)
            return ch

        log.debug("%s panel_record=%s channel=%s message=%s", label,
                  panel_record["id"] if panel_record else None, stored_channel_id, stored_message_id)

        if stored_message_id and stored_channel_id:
            stored_ch = await _resolve_channel(int(stored_channel_id))
            if stored_ch:
                try:
                    old = await stored_ch.fetch_message(int(stored_message_id))
                    await old.edit(embed=embed, view=panel_view, allowed_mentions=discord.AllowedMentions.none())
                    posted = old
                except discord.NotFound:
                    # Old message was deleted — will post fresh below
                    log.info("Panel message %s not found in channel %s, posting fresh", stored_message_id, stored_channel_id)
                except discord.Forbidden:
                    log.warning(
                        "post_or_refresh_panel: Missing Permissions to edit message %s in channel %s (guild=%s) — "
                        "grant the bot Send Messages + Embed Links in that channel",
                        stored_message_id, stored_channel_id, guild_id,
                    )
                except discord.HTTPException as e:
                    log.exception("Failed to edit panel message %s: %s", stored_message_id, e)

        # If no existing panel found (or edit failed), post a new one
        if posted is None:
            # Use provided channel, or fall back to the configured panel channel
            target = channel
            if target is None and stored_channel_id:
                target = await _resolve_channel(int(stored_channel_id))
            if target is None:
                log.warning("%s No target channel — stored_channel_id=%s, passed channel=%s. Set a channel on the panel.", label, stored_channel_id, channel)
            if target is not None:
                try:
                    posted = await target.send(embed=embed, view=panel_view, allowed_mentions=discord.AllowedMentions.none())
                except discord.Forbidden:
                    log.warning(
                        "post_or_refresh_panel: Missing Permissions to send in channel %s (guild=%s) — "
                        "grant the bot Send Messages + Embed Links in that channel",
                        stored_channel_id or getattr(target, "id", "?"), guild_id,
                    )
                except discord.HTTPException as e:
                    log.exception("post_or_refresh_panel: Discord HTTP error sending panel (guild=%s): %s", guild_id, e)

        if posted is not None:
            # Save message ID to BOTH panels table and whitelists table (for backward compat)
            if panel_record:
                await self.db.update_panel(
                    panel_record["id"],
                    panel_message_id=posted.id,
                    channel_id=posted.channel.id,
                    last_push_status="ok",
                    last_push_error=None,
                    last_push_at=utcnow(),
                )
            await self.db.update_whitelist(whitelist_id, panel_channel_id=posted.channel.id, panel_message_id=posted.id)
            actor = interaction.user.id if interaction else None
            await self.db.audit(guild_id, "panel_post", actor, None, f"panel={panel_record['name'] if panel_record else 'unknown'} channel={posted.channel.id} message={posted.id}", whitelist_id)
        else:
            # Determine the specific error message for the status
            _push_err = (
                "Bot is missing Send Messages or Embed Links permission in the configured channel"
                if stored_channel_id
                else "No channel is configured for this panel"
            )
            log.warning(
                "%s nothing posted — panel_record=%s stored_channel_id=%s stored_message_id=%s",
                label, panel_record["id"] if panel_record else None,
                stored_channel_id, stored_message_id,
            )
            if panel_record:
                await self.db.update_panel(
                    panel_record["id"],
                    last_push_status="error",
                    last_push_error=_push_err,
                    last_push_at=utcnow(),
                )
        return posted

    async def enforce_member_roles(self, member: discord.Member):
        guild_id = member.guild.id
        whitelists = await self.db.get_whitelists(guild_id)
        member_role_ids = {r.id for r in member.roles}
        for wl in whitelists:
            if not wl["enabled"]:
                continue
            whitelist_id = wl["id"]
            user_record = await self.db.get_user_record(guild_id, member.id, whitelist_id)
            if not user_record:
                # Auto-enroll: check panel_roles for any panel linked to this whitelist
                panels = await self.db.fetchall(
                    "SELECT id FROM panels WHERE guild_id=%s AND whitelist_id=%s AND enabled=TRUE LIMIT 1",
                    (guild_id, whitelist_id),
                )
                panel_id = int(panels[0][0]) if panels else None
                wl_roles = await self.db.get_panel_roles(guild_id, panel_id) if panel_id else []
                active_mapped = {int(r[1]) for r in wl_roles if r[6]}

                if not active_mapped or not (active_mapped & member_role_ids):
                    continue

                # Member has a qualifying role — auto-enroll
                name = member.nick or member.display_name or str(member)
                _tag, _ = parse_clan_tag(name)
                default_slot = wl.get("default_slot_limit") or 1
                await self.db.upsert_user_record(
                    guild_id, member.id, whitelist_id, name, "active", default_slot, "", None,
                    created_via="role_sync", discord_username=member.name, discord_nick=member.nick, clan_tag=_tag,
                )
                await self.db.audit(
                    guild_id, "auto_enroll_role_gain", None, member.id,
                    f"type={wl['slug']}", whitelist_id,
                )
                await self.send_log_embed(
                    guild_id, whitelist_id, "Auto-Enrolled",
                    f"<@{member.id}> gained a qualifying role — added to **{wl['slug']}** whitelist.",
                    discord.Color.green(),
                )
                await self.send_notification_event(
                    guild_id, "user_joined", "✅ Auto-Enrolled",
                    f"<@{member.id}> was auto-enrolled in `{wl['name']}` after gaining a qualifying role.",
                    discord.Color.green(),
                )
                user_record = await self.db.get_user_record(guild_id, member.id, whitelist_id)
                if not user_record:
                    continue
            slots, plan = await self.calculate_user_slots(guild_id, member, whitelist_id, user_record=user_record, wl=wl)
            status_before = user_record[1]
            if slots <= 0:
                if status_before == "active":
                    await self.db.set_user_status(guild_id, member.id, whitelist_id, "disabled_role_lost")
                    await self.db.audit(guild_id, "auto_disable_role_lost", None, member.id, f"type={wl['slug']}", whitelist_id)
                    await self.send_log_embed(guild_id, whitelist_id, "Whitelist Disabled", f"User <@{member.id}> lost required role(s).", discord.Color.orange())
                    await self.send_notification_event(guild_id, "role_lost", "⚠️ Role Lost — Whitelist Disabled", f"<@{member.id}> lost their required role and was auto-disabled from `{wl['name']}`.", discord.Color.orange())
            else:
                _m_name = member.nick or member.display_name or str(member)
                _m_tag, _ = parse_clan_tag(_m_name)
                if status_before != "active" and to_bool(await self.db.get_setting(guild_id, "auto_reactivate_on_role_return", "true")):
                    await self.db.upsert_user_record(guild_id, member.id, whitelist_id, _m_name, "active", slots, plan, user_record[2], discord_username=member.name, discord_nick=member.nick, clan_tag=_m_tag)
                    await self.db.audit(guild_id, "auto_reactivate_role_return", None, member.id, f"type={wl['slug']}", whitelist_id)
                    await self.send_log_embed(guild_id, whitelist_id, "Whitelist Re-enabled", f"User <@{member.id}> regained eligible role(s).", discord.Color.green())
                    await self.send_notification_event(guild_id, "role_returned", "✅ Role Returned — Re-enabled", f"<@{member.id}> regained their role and was re-enabled in `{wl['name']}`.", discord.Color.green())
                else:
                    await self.db.upsert_user_record(guild_id, member.id, whitelist_id, _m_name, status_before, slots, plan, user_record[2], discord_username=member.name, discord_nick=member.nick, clan_tag=_m_tag)
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
                await self.send_notification_event(guild_id, "user_left_discord", "🚪 User Left Discord", f"<@{member.id}> left the server and was removed from the `{wl['name']}` whitelist.", discord.Color.red())
        self.schedule_github_sync(guild_id)

    @tasks.loop(hours=1)
    async def daily_housekeeping(self):
        for guild in self.guilds:
            guild_id = guild.id
            # Expire timed whitelists
            expired = await self.db.expire_timed_whitelists(guild_id)
            if expired:
                log.info("Expired %d timed whitelist entries for guild %s", len(expired), guild_id)
                names = []
                for discord_id, whitelist_id in expired:
                    await self.db.audit(guild_id, "auto_expire", None, discord_id, f"Timed whitelist expired", whitelist_id)
                    names.append(f"<@{discord_id}>")
                self.schedule_github_sync(guild_id)
                await self.send_notification(guild_id, "⏰ Timed Whitelists Expired", f"{len(expired)} entries expired:\n" + "\n".join(names[:20]))
            # Purge old inactive records
            retention = int(await self.db.get_setting(guild_id, "retention_days", "90"))
            purged = await self.db.purge_inactive_older_than(guild_id, retention)
            if purged:
                log.info("Purged %s inactive records older than %s days for guild %s", purged, retention, guild_id)
            # Role-based membership sync — runs on a configurable interval (default 24h)
            try:
                interval_hours = max(1, min(168, int(await self.db.get_setting(guild_id, "role_sync_interval_hours", "24") or "24")))
                last_sync_str  = await self.db.get_setting(guild_id, "last_role_sync_at")
                due_for_sync   = True
                if last_sync_str:
                    try:
                        from datetime import datetime, timezone
                        last_dt   = datetime.fromisoformat(last_sync_str.replace("Z", "+00:00"))
                        elapsed_h = (utcnow() - last_dt).total_seconds() / 3600
                        due_for_sync = elapsed_h >= interval_hours
                    except (ValueError, TypeError):
                        pass
                if due_for_sync:
                    await self._daily_role_sync(guild)
                    await self.db.set_setting(guild_id, "last_role_sync_at", utcnow().isoformat())
            except Exception as e:
                log.error("Guild %s: daily role sync failed: %s", guild_id, e)

    async def _daily_role_sync(self, guild: "discord.Guild") -> None:
        """Ensure whitelist membership matches Discord role membership for all mapped roles."""
        guild_id = guild.id
        all_wl_roles = await self.db.get_all_panel_roles(guild_id)
        if not all_wl_roles:
            return

        # Group active role_ids by whitelist_id (via panel join)
        # get_all_panel_roles returns (panel_id, whitelist_id, role_id, role_name, slot_limit, is_active)
        by_whitelist: dict[int, list[int]] = {}
        for row in all_wl_roles:
            _panel_id, wl_id, role_id, _name, _slots, is_active = row[0], row[1], row[2], row[3], row[4], row[5]
            if is_active and wl_id:
                by_whitelist.setdefault(wl_id, []).append(role_id)

        whitelists = {wl["id"]: wl for wl in await self.db.get_whitelists(guild_id)}

        for wl_id, role_ids in by_whitelist.items():
            wl = whitelists.get(wl_id)
            if not wl or not wl["enabled"]:
                continue

            existing_rows = await self.db.fetchall(
                "SELECT discord_id, status FROM whitelist_users WHERE guild_id=%s AND whitelist_id=%s",
                (guild_id, wl_id),
            )
            existing: dict[int, str] = {row[0]: row[1] for row in (existing_rows or [])}

            # Collect all members currently holding any mapped role
            role_member_ids: set[int] = set()
            for role_id in role_ids:
                role = guild.get_role(role_id)
                if role:
                    role_member_ids.update(m.id for m in role.members)

            added = removed = tier_updated = 0

            # Add anyone with the role who isn't in the whitelist yet,
            # and update tiers for existing members
            for member_id in role_member_ids:
                member = guild.get_member(member_id)
                if not member:
                    continue
                if member_id not in existing:
                    # New user — calculate proper slots from their roles
                    name = member.nick or member.display_name or str(member)
                    _d_tag, _ = parse_clan_tag(name)
                    slots, plan = await self.calculate_user_slots(guild_id, member, wl_id, wl=wl)
                    if slots <= 0:
                        slots = wl.get("default_slot_limit") or 1
                        plan = ""
                    await self.db.upsert_user_record(
                        guild_id, member_id, wl_id, name, "active", slots, plan, None,
                        created_via="role_sync", discord_username=member.name, discord_nick=member.nick, clan_tag=_d_tag,
                    )
                    await self.db.audit(guild_id, "daily_role_sync_add", None, member_id,
                                        f"type={wl['slug']}", wl_id)
                    added += 1
                else:
                    # Existing user — recalculate tiers to keep them current
                    user_record = await self.db.get_user_record(guild_id, member_id, wl_id)
                    if not user_record:
                        continue
                    slots, plan = await self.calculate_user_slots(guild_id, member, wl_id, user_record=user_record, wl=wl)
                    if slots > 0:
                        name = member.nick or member.display_name or str(member)
                        _d_tag, _ = parse_clan_tag(name)
                        status = "active" if existing[member_id] == "disabled_role_lost" else existing[member_id]
                        await self.db.upsert_user_record(
                            guild_id, member_id, wl_id, name, status, slots, plan, user_record[2],
                            discord_username=member.name, discord_nick=member.nick, clan_tag=_d_tag,
                        )
                        tier_updated += 1

            # Disable active members who no longer hold any mapped role
            for member_id, status in existing.items():
                if member_id > 0 and member_id not in role_member_ids and status == "active":
                    await self.db.set_user_status(guild_id, member_id, wl_id, "disabled_role_lost")
                    await self.db.audit(guild_id, "daily_role_sync_remove", None, member_id,
                                        f"type={wl['slug']}", wl_id)
                    removed += 1

            if added or removed or tier_updated:
                log.info("Guild %s daily role sync %s: +%d -%d ~%d tiers", guild_id, wl["slug"], added, removed, tier_updated)
                self.schedule_github_sync(guild_id)

    @daily_housekeeping.before_loop
    async def _before_housekeeping(self):
        await self.wait_until_ready()

    @tasks.loop(hours=1)
    async def weekly_report(self):
        """Check every hour and send reports based on guild frequency settings."""
        for guild in self.guilds:
            guild_id = guild.id
            try:
                await self._send_report_for_guild(guild_id)
            except Exception:
                log.exception("Error sending report for guild %s", guild_id)

    @weekly_report.before_loop
    async def _before_weekly_report(self):
        await self.wait_until_ready()

    async def _send_report_for_guild(self, guild_id: int, force: bool = False):
        """Send a whitelist report for a single guild. If force=True, ignore frequency gate."""
        frequency = (await self.db.get_setting(guild_id, "report_frequency", "weekly")).lower()
        if frequency == "disabled" and not force:
            return
        now = datetime.now(timezone.utc)
        should_send = force or frequency == "daily" or (frequency == "weekly" and now.weekday() == 0)
        if not should_send:
            return
        whitelists = await self.db.get_whitelists(guild_id)
        lines = []
        for wl in whitelists:
            whitelist_id = wl["id"]
            active = await self.db.fetchone(
                "SELECT COUNT(*) FROM whitelist_users WHERE guild_id=%s AND whitelist_id=%s AND status='active'",
                (guild_id, whitelist_id))
            ids_row = await self.db.fetchone(
                "SELECT COUNT(*) FROM whitelist_identifiers WHERE guild_id=%s AND whitelist_id=%s",
                (guild_id, whitelist_id))
            actions = await self.db.fetchone(
                "SELECT COUNT(*) FROM audit_log WHERE guild_id=%s AND whitelist_id=%s AND created_at >= %s",
                (guild_id, whitelist_id, utcnow() - timedelta(days=7 if frequency == "weekly" else 1)))
            lines.append(
                f"**{wl['name']}** — {active[0]} active | {ids_row[0]} IDs | {actions[0]} actions"
            )
        if not lines:
            return
        label = "Forced" if force else frequency.title()
        description = "\n".join(lines)
        # Try notification routing channel first; fall back to first whitelist log channel
        await self.send_notification_event(
            guild_id, "report",
            f"📊 {label} Whitelist Report",
            description,
            discord.Color.blurple(),
        )
        # Also send to each whitelist's own log channel if set (preserves existing behaviour)
        for wl in whitelists:
            if wl.get("log_channel_id"):
                whitelist_id = wl["id"]
                active = await self.db.fetchone(
                    "SELECT COUNT(*) FROM whitelist_users WHERE guild_id=%s AND whitelist_id=%s AND status='active'",
                    (guild_id, whitelist_id))
                ids_row = await self.db.fetchone(
                    "SELECT COUNT(*) FROM whitelist_identifiers WHERE guild_id=%s AND whitelist_id=%s",
                    (guild_id, whitelist_id))
                actions = await self.db.fetchone(
                    "SELECT COUNT(*) FROM audit_log WHERE guild_id=%s AND whitelist_id=%s AND created_at >= %s",
                    (guild_id, whitelist_id, utcnow() - timedelta(days=7 if frequency == "weekly" else 1)))
                await self.send_log_embed(
                    guild_id, whitelist_id,
                    f"📊 {label} Report",
                    f"Active users: `{active[0]}`\nIdentifiers: `{ids_row[0]}`\nActions in window: `{actions[0]}`",
                    discord.Color.blurple(),
                )

    def schedule_report(self):
        """Immediately trigger reports for all guilds. Called by the web API."""
        import asyncio
        asyncio.get_event_loop().create_task(self._run_reports_now())

    async def _run_reports_now(self):
        """Force-send reports for all guilds regardless of frequency schedule."""
        for guild in self.guilds:
            try:
                await self._send_report_for_guild(guild.id, force=True)
            except Exception:
                log.exception("Error in forced report for guild %s", guild.id)

    @tasks.loop(seconds=15)
    async def panel_refresh_poller(self):
        """Poll for panel refresh requests from the web dashboard."""
        try:
            pending = await self.db.get_pending_refreshes()
            if pending:
                log.info("[panel_poller] Processing %d pending refresh(es)", len(pending))
            for row in pending:
                refresh_id, guild_id, panel_id, reason = int(row[0]), int(row[1]), int(row[2]), row[3]
                action     = row[4] if len(row) > 4 else "refresh"
                channel_id = int(row[5]) if len(row) > 5 and row[5] else None
                message_id = int(row[6]) if len(row) > 6 and row[6] else None
                try:
                    if action == "delete":
                        if channel_id and message_id:
                            ch = self.get_channel(channel_id)
                            if ch is None:
                                try:
                                    ch = await self.fetch_channel(channel_id)
                                except Exception:
                                    pass
                            if ch:
                                try:
                                    msg = await ch.fetch_message(message_id)
                                    await msg.delete()
                                    log.info("Deleted panel message %s in channel %s (panel=%s)", message_id, channel_id, panel_id)
                                except discord.NotFound:
                                    pass  # already gone
                                except Exception:
                                    log.exception("Failed to delete panel message %s", message_id)
                    else:
                        panel = await self.db.get_panel_by_id(panel_id)
                        if not panel:
                            log.warning("Panel refresh: panel_id=%s not found in DB", panel_id)
                        elif not panel.get("whitelist_id"):
                            log.warning("Panel refresh: panel_id=%s has no whitelist_id set — skipping", panel_id)
                        else:
                            wl = await self.db.get_whitelist_by_id(panel["whitelist_id"])
                            if not wl:
                                log.warning("Panel refresh: whitelist_id=%s not found for panel_id=%s", panel["whitelist_id"], panel_id)
                            else:
                                result = await self.post_or_refresh_panel(None, guild_id, wl["slug"], wl_dict=wl)
                                if result:
                                    log.info("Auto-refreshed panel %s (guild=%s) reason=%s", panel_id, guild_id, reason)
                                else:
                                    log.warning("Panel refresh: post_or_refresh_panel returned None for panel_id=%s (channel configured? %s)", panel_id, bool(panel.get("channel_id")))
                except Exception:
                    log.exception("Failed to process panel queue entry %s (panel=%s action=%s)", refresh_id, panel_id, action)
                await self.db.mark_refresh_processed(refresh_id)
        except Exception:
            log.exception("[panel_poller] Unexpected error fetching/processing refresh queue")

    @panel_refresh_poller.before_loop
    async def _before_panel_poller(self):
        await self.wait_until_ready()
