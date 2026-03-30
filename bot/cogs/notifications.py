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

    def cog_unload(self):
        self.expiry_check.cancel()
        self.bridge_health_check.cancel()

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


async def setup(bot):
    await bot.add_cog(NotificationsCog(bot))
