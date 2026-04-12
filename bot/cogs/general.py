import discord
from discord import app_commands
from discord.ext import commands

from bot.config import WEB_BASE_URL


class GeneralCog(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    @app_commands.command(name="help", description="Show available bot commands and dashboard link")
    async def help_cmd(self, interaction: discord.Interaction):
        dashboard_url = WEB_BASE_URL or "https://squadwhitelister.com"
        domain = dashboard_url.replace("https://", "").replace("http://", "").rstrip("/")

        embed = discord.Embed(
            title="🛡️ Squad Whitelister — Help",
            color=discord.Color.from_rgb(249, 115, 22),
        )

        embed.add_field(
            name="👤 Member Commands",
            value=(
                "`/whitelist` — Submit or update your Steam64 / EOS IDs\n"
                "`/verify` — Link your Steam or EOS account to your Discord profile\n"
                "`/my_whitelist` — View your current whitelist entries\n"
                "`/status` — Check bot and whitelist status\n"
                "`/help` — Show this message\n"
                f"**Website** — Same IDs as above: [My Whitelist]({dashboard_url}/my-whitelist)"
            ),
            inline=False,
        )

        embed.add_field(
            name="🔧 Moderator Commands",
            value=(
                "`/search` — Look up a Steam64 or EOS ID\n"
                "`/mod_view` — View a user's whitelist entries\n"
                "`/mod_override` — Set or clear a slot override for a user\n"
                "`/mod_remove` — Remove a user from the active whitelist\n"
                "`/mod_set` — Replace a user's IDs directly\n"
                "`/audit` — View recent audit log entries\n"
                "`/export` — Export whitelist data as CSV\n"
                "`/import_csv` — Import whitelist data from a CSV file\n"
                "`/stats` — Show whitelist statistics\n"
                "`/whitelist_panel` — Post or refresh the whitelist panel\n"
                "`/setup` — Launch the interactive setup wizard\n"
                "`/setup_mod_role` — Set the bot moderator role"
            ),
            inline=False,
        )

        embed.add_field(
            name="Diagnostics",
            value=(
                "`/ping` — Check bot latency and uptime\n"
                "`/permcheck` — Check bot permissions in the current channel\n"
                "`/panelstatus` — Show push status for all panels"
            ),
            inline=False,
        )

        embed.add_field(
            name=f"Web Dashboard — [{domain}]({dashboard_url})",
            value=(
                "Full user management, import/export, audit log,\n"
                "tier configuration, whitelist URLs, and more."
            ),
            inline=False,
        )

        embed.set_footer(text="Supports Steam64 IDs and EOS IDs • Replies are private")
        await interaction.response.send_message(embed=embed, ephemeral=True)

    @app_commands.command(name="status", description="Show bot status")
    async def status(self, interaction: discord.Interaction):
        embed = await self.bot.build_status_embed(interaction.guild)
        dashboard_url = WEB_BASE_URL or "https://squadwhitelister.com"
        embed.add_field(
            name="Web Dashboard",
            value=f"[Open Dashboard]({dashboard_url})",
            inline=False,
        )
        await interaction.response.send_message(embed=embed, ephemeral=True)

    @app_commands.command(name="reload", description="Hot-reload a bot module")
    @app_commands.describe(module="Module name to reload (e.g. general, whitelist, notifications, all)")
    async def reload_cmd(self, interaction: discord.Interaction, module: str):
        if not await self.bot.require_mod(interaction):
            return
        if module == "all":
            reloaded = []
            for ext in ("bot.cogs.general", "bot.cogs.whitelist", "bot.cogs.notifications"):
                try:
                    await self.bot.reload_extension(ext)
                    reloaded.append(ext.split(".")[-1])
                except Exception as e:
                    await interaction.followup.send(f"Failed to reload {ext}: {e}", ephemeral=True)
                    return
            await interaction.response.send_message(f"Reloaded: {', '.join(reloaded)}", ephemeral=True)
        else:
            ext = f"bot.cogs.{module}"
            try:
                await self.bot.reload_extension(ext)
                await interaction.response.send_message(f"Reloaded `{module}`.", ephemeral=True)
            except Exception as e:
                await interaction.response.send_message(f"Failed: {e}", ephemeral=True)


async def setup(bot):
    await bot.add_cog(GeneralCog(bot))
