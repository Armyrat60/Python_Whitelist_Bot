import discord
from discord import app_commands
from discord.ext import commands

from bot.config import WEB_BASE_URL


class GeneralCog(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    @app_commands.command(name="help", description="Show help")
    async def help_cmd(self, interaction: discord.Interaction):
        dashboard_url = WEB_BASE_URL or "https://squadwhitelister.com"
        embed = discord.Embed(title="Squad Whitelister", color=discord.Color.blurple())
        embed.add_field(
            name="Discord Commands",
            value=(
                "`/whitelist` \u2014 Submit your Steam/EOS IDs\n"
                "`/my_whitelist` \u2014 View your current whitelist entries\n"
                "`/status` \u2014 Check bot status"
            ),
            inline=False,
        )
        embed.add_field(
            name="Web Dashboard",
            value=(
                f"**{dashboard_url}**\n"
                "Setup, user management, search, audit log,\n"
                "import/export, statistics, and more."
            ),
            inline=False,
        )
        embed.set_footer(text="Steam64 and EOSID supported.")
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
