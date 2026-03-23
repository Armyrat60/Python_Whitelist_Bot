import discord
from discord import app_commands
from discord.ext import commands
from datetime import timedelta, timezone

from bot.config import WHITELIST_TYPES
from bot.utils import utcnow


async def setup_autocomplete(interaction: discord.Interaction, current: str):
    return [app_commands.Choice(name=item, value=item) for item in WHITELIST_TYPES if current.lower() in item][:25]


class GeneralCog(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    @app_commands.command(name="ping", description="Check bot latency and health")
    async def ping(self, interaction: discord.Interaction):
        db_ok = False
        try:
            await self.bot.db.fetchone("SELECT 1")
            db_ok = True
        except Exception:
            db_ok = False
        web_status = "Off"
        if self.bot.web and self.bot.web.runner:
            web_status = "Running"
        await interaction.response.send_message(
            f"Pong.\nLatency: `{round(self.bot.latency*1000)}ms`\nDB: `{db_ok}`\nGitHub: `{bool(self.bot.github.repo)}`\nWeb: `{web_status}`",
            ephemeral=True,
        )

    @app_commands.command(name="help", description="Show help")
    async def help_cmd(self, interaction: discord.Interaction):
        embed = discord.Embed(title="Whitelist Bot Help", color=discord.Color.blurple())
        embed.add_field(
            name="User Commands",
            value=(
                "`/whitelist` \u2014 Submit or update your whitelist IDs\n"
                "`/my_whitelist` \u2014 View your saved IDs and slots\n"
                "`/status` \u2014 View bot configuration\n"
                "`/ping` \u2014 Check bot health"
            ),
            inline=False,
        )
        embed.add_field(
            name="Admin Commands",
            value=(
                "`/setup` \u2014 Interactive setup wizard (channels, roles, groups, settings)\n"
                "`/setup_mod_role` \u2014 Set the moderator role (first-time bootstrap)\n"
                "`/whitelist_panel` \u2014 Post or refresh a whitelist panel\n"
                "`/resync_whitelist` \u2014 Force GitHub + web sync"
            ),
            inline=False,
        )
        embed.add_field(
            name="Moderator Commands",
            value=(
                "`/mod_view` \u2014 View a user's whitelist\n"
                "`/mod_set` \u2014 Replace a user's IDs\n"
                "`/mod_remove` \u2014 Remove user from active output\n"
                "`/mod_override` \u2014 Set or clear a slot override\n"
                "`/search` \u2014 Find a Steam/EOS ID across all whitelists\n"
                "`/audit` \u2014 View recent audit log entries\n"
                "`/stats` \u2014 Whitelist statistics overview\n"
                "`/export` \u2014 Export whitelist data as CSV\n"
                "`/import_csv` \u2014 Bulk import from CSV file\n"
                "`/report_now` \u2014 Generate an ad-hoc report\n"
                "`/reload` \u2014 Hot-reload bot modules"
            ),
            inline=False,
        )
        embed.set_footer(text="Steam64 and EOSID supported. Output published to GitHub + web server.")
        await interaction.response.send_message(embed=embed, ephemeral=True)

    @app_commands.command(name="status", description="Show bot status")
    async def status(self, interaction: discord.Interaction):
        embed = await self.bot.build_status_embed(interaction.guild)
        await interaction.response.send_message(embed=embed, ephemeral=True)

    @app_commands.command(name="resync_whitelist", description="Force GitHub whitelist sync")
    async def resync_whitelist(self, interaction: discord.Interaction):
        if not await self.bot.require_mod(interaction):
            return
        changed = await self.bot.sync_github_outputs()
        await self.bot.db.audit("manual_resync", interaction.user.id, None, f"changed_files={changed}")
        await interaction.response.send_message(f"GitHub sync complete. Changed files: {changed}", ephemeral=True)

    @app_commands.command(name="report_now", description="Send a report immediately")
    @app_commands.autocomplete(whitelist_type=setup_autocomplete)
    async def report_now(self, interaction: discord.Interaction, whitelist_type: str):
        if not await self.bot.require_mod(interaction):
            return
        active = await self.bot.db.fetchone("SELECT COUNT(*) FROM whitelist_users WHERE whitelist_type=%s AND status='active'", (whitelist_type,))
        ids = await self.bot.db.fetchone("SELECT COUNT(*) FROM whitelist_identifiers WHERE whitelist_type=%s", (whitelist_type,))
        await interaction.response.send_message(f"{whitelist_type.title()} report\nActive users: {active[0]}\nIdentifiers: {ids[0]}", ephemeral=True)


async def setup(bot):
    await bot.add_cog(GeneralCog(bot))
