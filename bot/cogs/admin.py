import discord
from discord import app_commands
from discord.ext import commands


class AdminCog(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    @app_commands.command(name="reload", description="Hot-reload a bot module")
    @app_commands.describe(module="Module name to reload (e.g. setup, whitelist, modtools, general, all)")
    async def reload_cmd(self, interaction: discord.Interaction, module: str):
        if not await self.bot.require_mod(interaction):
            return
        if module == "all":
            reloaded = []
            for ext in ("bot.cogs.general", "bot.cogs.setup", "bot.cogs.whitelist", "bot.cogs.modtools", "bot.cogs.admin"):
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
    await bot.add_cog(AdminCog(bot))
