import discord
from discord.ext import commands, tasks
from datetime import timedelta
from bot.config import log
from bot.utils import utcnow


class NotificationsCog(commands.Cog):
    def __init__(self, bot):
        self.bot = bot
        self.expiry_check.start()
        self.bridge_health_check.start()
        self.seeding_notification_check.start()

    def cog_unload(self):
        self.expiry_check.cancel()
        self.bridge_health_check.cancel()
        self.seeding_notification_check.cancel()

    # ── Helpers ───────────────────────────────────────────────────────────────

    async def _get_notification_channel(self, guild_id: int):
        """Return the configured notification channel, or None."""
        channel_id_str = await self.bot.db.get_setting(guild_id, "notification_channel_id")
        if not channel_id_str:
            return None
        try:
            return self.bot.get_channel(int(channel_id_str))
        except (ValueError, TypeError):
            return None

    # ── Expiry notifications ──────────────────────────────────────────────────

    @tasks.loop(hours=24)
    async def expiry_check(self):
        """Check for memberships expiring in 7 or 1 days and notify users + channel."""
        for guild in self.bot.guilds:
            guild_id = guild.id

            notification_channel = await self._get_notification_channel(guild_id)

            for days_before in (7, 1):
                window_start = utcnow()
                window_end   = utcnow() + timedelta(days=days_before)

                rows = await self.bot.db.fetchall(
                    """
                    SELECT wu.discord_id, wu.discord_name, wl.name AS whitelist_name, wu.expires_at
                    FROM whitelist_users wu
                    JOIN whitelists wl ON wl.id = wu.whitelist_id
                    WHERE wu.guild_id = %s
                      AND wu.status = 'active'
                      AND wu.expires_at IS NOT NULL
                      AND wu.expires_at >= %s
                      AND wu.expires_at < %s
                    """,
                    (guild_id, window_start, window_end),
                )

                for row in rows:
                    discord_id, discord_name, wl_name, expires_at = row
                    exp_str = expires_at.strftime("%Y-%m-%d") if expires_at else "soon"

                    dm_msg = (
                        f"\u26a0\ufe0f Your **{wl_name}** whitelist membership expires on **{exp_str}** "
                        f"({days_before} day{'s' if days_before != 1 else ''} away). "
                        f"Contact an admin if you believe this is an error."
                    )

                    # DM the user
                    try:
                        user = await self.bot.fetch_user(int(discord_id))
                        await user.send(dm_msg)
                        log.info(
                            "Sent %d-day expiry DM to %s (%s) for %s",
                            days_before, discord_name, discord_id, wl_name,
                        )
                    except (discord.Forbidden, discord.HTTPException, ValueError):
                        log.debug("Could not DM expiry notice to %s", discord_id)

                    # Also post to notification channel
                    if notification_channel:
                        try:
                            mention = f"<@{discord_id}>"
                            await notification_channel.send(
                                f"\u23f3 {mention} (**{discord_name}**) — **{wl_name}** expires in "
                                f"**{days_before} day{'s' if days_before != 1 else ''}** ({exp_str})"
                            )
                        except (discord.Forbidden, discord.HTTPException):
                            log.debug("Could not post expiry notice to channel for guild %s", guild_id)

    @expiry_check.before_loop
    async def _before_expiry(self):
        await self.bot.wait_until_ready()

    # ── Bridge failure alerts ─────────────────────────────────────────────────

    @tasks.loop(minutes=30)
    async def bridge_health_check(self):
        """Alert the notification channel if the SquadJS bridge is in a failed state."""
        for guild in self.bot.guilds:
            guild_id = guild.id

            row = await self.bot.db.fetchone(
                """
                SELECT last_sync_status, last_sync_message, last_sync_at, enabled
                FROM bridge_configs
                WHERE guild_id = %s
                """,
                (guild_id,),
            )
            if not row:
                continue

            last_status, last_msg, last_sync_at, enabled = row
            if not enabled or last_status != "error":
                continue

            notification_channel = await self._get_notification_channel(guild_id)
            if not notification_channel:
                continue

            when = last_sync_at.strftime("%Y-%m-%d %H:%M UTC") if last_sync_at else "unknown time"
            detail = f": {last_msg}" if last_msg else ""
            try:
                await notification_channel.send(
                    f"\u274c **SquadJS Bridge Sync Failed** — last attempt at {when}{detail}\n"
                    f"Check your bridge configuration in the dashboard."
                )
            except (discord.Forbidden, discord.HTTPException):
                log.debug("Could not post bridge failure alert for guild %s", guild_id)

    @bridge_health_check.before_loop
    async def _before_bridge_health(self):
        await self.bot.wait_until_ready()

    # ── Seeding event notifications ──────────────────────────────────────────

    @tasks.loop(seconds=30)
    async def seeding_notification_check(self):
        """Poll seeding_notifications table and send Discord messages."""
        try:
            rows = await self.bot.db.fetchall(
                """
                SELECT id, guild_id, event_type, payload
                FROM seeding_notifications
                WHERE processed = FALSE
                ORDER BY created_at ASC
                LIMIT 20
                """
            )
            if not rows:
                return

            for row in rows:
                notif_id, guild_id, event_type, payload = row
                try:
                    await self._handle_seeding_notification(guild_id, event_type, payload or {})
                except Exception as e:
                    log.error("Failed to process seeding notification %s: %s", notif_id, e)
                finally:
                    # Mark as processed regardless of success to prevent infinite retry
                    await self.bot.db.execute(
                        "UPDATE seeding_notifications SET processed = TRUE WHERE id = %s",
                        (notif_id,),
                    )
        except Exception as e:
            log.error("Seeding notification poll failed: %s", e)

    async def _handle_seeding_notification(self, guild_id, event_type, payload):
        """Process a single seeding notification."""
        import json
        if isinstance(payload, str):
            payload = json.loads(payload)

        channel_id = payload.get("channel_id")
        channel = None
        if channel_id:
            try:
                channel = self.bot.get_channel(int(channel_id))
            except (ValueError, TypeError):
                pass

        guild = self.bot.get_guild(guild_id)
        if not guild:
            return

        if event_type == "seeding_reward_granted" and channel:
            player = payload.get("player_name") or payload.get("steam_id", "Unknown")
            tier = payload.get("tier_label", "Standard")
            duration = payload.get("duration_hours", 0)
            days = round(duration / 24, 1) if duration else "?"
            embed = discord.Embed(
                title="Seeding Reward Granted",
                description=f"**{player}** earned a seeding reward!",
                color=0x10b981,
            )
            embed.add_field(name="Tier", value=tier, inline=True)
            embed.add_field(name="Duration", value=f"{days} days", inline=True)
            try:
                await channel.send(embed=embed)
            except (discord.Forbidden, discord.HTTPException):
                pass

        elif event_type == "seeding_server_live" and channel:
            count = payload.get("player_count", 0)
            threshold = payload.get("threshold", 0)
            embed = discord.Embed(
                title="Server Is Live!",
                description=f"Server has reached **{count}** players (threshold: {threshold}). Seeding complete!",
                color=0x10b981,
            )
            try:
                await channel.send(embed=embed)
            except (discord.Forbidden, discord.HTTPException):
                pass

        elif event_type == "seeding_needs_seeders" and channel:
            count = payload.get("player_count", 0)
            threshold = payload.get("threshold", 0)
            role_id = payload.get("role_id")
            role_mention = f"<@&{role_id}>" if role_id else ""
            embed = discord.Embed(
                title="Server Needs Seeders!",
                description=f"Server is at **{count}** players. Help us reach {threshold}!",
                color=0xeab308,
            )
            try:
                await channel.send(content=role_mention, embed=embed)
            except (discord.Forbidden, discord.HTTPException):
                pass

        elif event_type == "seeding_role_grant":
            role_id = payload.get("role_id")
            steam_id = payload.get("steam_id")
            if not role_id or not steam_id:
                return
            # Find the Discord member linked to this Steam ID
            try:
                linked = await self.bot.db.fetchone(
                    """SELECT discord_id FROM squad_players
                       WHERE guild_id = %s AND steam_id = %s AND discord_id IS NOT NULL
                       LIMIT 1""",
                    (guild_id, steam_id),
                )
                if not linked:
                    linked = await self.bot.db.fetchone(
                        """SELECT DISTINCT discord_id FROM whitelist_identifiers
                           WHERE guild_id = %s AND id_type IN ('steam64', 'steamid')
                             AND id_value = %s AND discord_id > 0
                           LIMIT 1""",
                        (guild_id, steam_id),
                    )
                if linked:
                    discord_id = linked[0]
                    member = guild.get_member(int(discord_id))
                    if not member:
                        member = await guild.fetch_member(int(discord_id))
                    role = guild.get_role(int(role_id))
                    if member and role and role not in member.roles:
                        await member.add_roles(role, reason="Seeding reward")
                        log.info("Assigned seeding role %s to %s in guild %s", role_id, discord_id, guild_id)
            except Exception as e:
                log.error("Failed to assign seeding role for steam %s in guild %s: %s", steam_id, guild_id, e)

    @seeding_notification_check.before_loop
    async def _before_seeding_notif(self):
        await self.bot.wait_until_ready()


async def setup(bot):
    await bot.add_cog(NotificationsCog(bot))
