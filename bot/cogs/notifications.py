import discord
from discord.ext import commands, tasks
from datetime import timedelta
from bot.config import WHITELIST_TYPES, log
from bot.utils import utcnow


class NotificationsCog(commands.Cog):
    def __init__(self, bot):
        self.bot = bot
        self.expiry_check.start()

    def cog_unload(self):
        self.expiry_check.cancel()

    @tasks.loop(hours=24)
    async def expiry_check(self):
        """Check for users expiring in 7 days or 1 day and DM them."""
        for guild in self.bot.guilds:
            guild_id = guild.id
            retention = int(await self.bot.db.get_setting(guild_id, "retention_days", "90"))

            for wt in WHITELIST_TYPES:
                cfg = await self.bot.db.get_type_config(guild_id, wt)
                if not cfg or not cfg["enabled"]:
                    continue

                # Find users whose status is not 'active' and updated_at is approaching retention cutoff
                # Users who have been inactive for (retention - 7) days = expiring in 7 days
                # Users who have been inactive for (retention - 1) days = expiring in 1 day
                for days_before in (7, 1):
                    cutoff_start = utcnow() - timedelta(days=retention - days_before)
                    cutoff_end = utcnow() - timedelta(days=retention - days_before - 1)

                    rows = await self.bot.db.fetchall(
                        """
                        SELECT discord_id, discord_name
                        FROM whitelist_users
                        WHERE guild_id=%s AND whitelist_type=%s AND status <> 'active'
                        AND updated_at >= %s AND updated_at < %s
                        """,
                        (guild_id, wt, cutoff_start, cutoff_end),
                    )

                    for discord_id, discord_name in rows:
                        try:
                            user = await self.bot.fetch_user(int(discord_id))
                            await user.send(
                                f"\u26a0\ufe0f Your **{wt.title()}** whitelist entry will be removed in **{days_before} day(s)** "
                                f"due to inactivity. Re-submit your IDs to keep your spot!"
                            )
                            log.info("Sent %d-day expiry notice to %s for %s", days_before, discord_name, wt)
                        except (discord.Forbidden, discord.HTTPException):
                            log.debug("Could not DM expiry notice to %s", discord_id)

    @expiry_check.before_loop
    async def _before_expiry(self):
        await self.bot.wait_until_ready()


async def setup(bot):
    await bot.add_cog(NotificationsCog(bot))
