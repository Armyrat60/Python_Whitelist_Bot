import discord
from discord import app_commands
from discord.ext import commands
from typing import List

from bot.config import WHITELIST_TYPES
from bot.utils import _modal_on_error


async def setup_autocomplete(interaction: discord.Interaction, current: str):
    return [app_commands.Choice(name=item, value=item) for item in WHITELIST_TYPES if current.lower() in item][:25]


class IdentifierModal(discord.ui.Modal, title="Submit or Update Whitelist IDs"):
    on_error = _modal_on_error

    def __init__(self, bot, whitelist_type: str, slot_limit: int, existing: List[tuple]):
        super().__init__(timeout=300)
        self.bot = bot
        self.whitelist_type = whitelist_type
        self.slot_limit = slot_limit
        existing_steam = ", ".join(v for t, v, *_ in existing if t == "steam64")
        existing_eos = ", ".join(v for t, v, *_ in existing if t == "eosid")

        self.steam_ids = discord.ui.TextInput(
            label=f"Steam64 IDs (up to {slot_limit} total IDs across all fields)",
            default=existing_steam[:4000],
            required=False,
            style=discord.TextStyle.paragraph,
            placeholder="7656119xxxxxxxxxx, 7656119xxxxxxxxxx",
            max_length=4000,
        )
        self.eos_ids = discord.ui.TextInput(
            label="EOS IDs (32 hex chars each)",
            default=existing_eos[:4000],
            required=False,
            style=discord.TextStyle.paragraph,
            placeholder="0123456789abcdef0123456789abcdef",
            max_length=4000,
        )
        self.add_item(self.steam_ids)
        self.add_item(self.eos_ids)

    async def on_submit(self, interaction: discord.Interaction):
        await self.bot.handle_identifier_submission(interaction, self.whitelist_type, self.steam_ids.value, self.eos_ids.value)


class WhitelistPanelView(discord.ui.View):
    def __init__(self, bot, whitelist_type: str):
        super().__init__(timeout=None)
        self.bot = bot
        self.whitelist_type = whitelist_type

        start_btn = discord.ui.Button(
            label="Start / Update Whitelist",
            style=discord.ButtonStyle.green,
            custom_id=f"panel:start:{whitelist_type}",
        )
        start_btn.callback = self._start_callback
        self.add_item(start_btn)

        mod_btn = discord.ui.Button(
            label="Moderator Tools",
            style=discord.ButtonStyle.secondary,
            custom_id=f"panel:mod:{whitelist_type}",
        )
        mod_btn.callback = self._mod_callback
        self.add_item(mod_btn)

    async def _start_callback(self, interaction: discord.Interaction):
        await self.bot.start_whitelist_flow(interaction, self.whitelist_type)

    async def _mod_callback(self, interaction: discord.Interaction):
        if not await self.bot.user_is_mod(interaction.user):
            await interaction.response.send_message("You do not have permission.", ephemeral=True)
            return
        from bot.cogs.modtools import ModToolsView
        await interaction.response.send_message("Moderator tools", view=ModToolsView(self.bot, self.whitelist_type), ephemeral=True)


class WhitelistCog(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    @app_commands.command(name="whitelist", description="Submit or update your whitelist IDs")
    @app_commands.autocomplete(whitelist_type=setup_autocomplete)
    async def whitelist(self, interaction: discord.Interaction, whitelist_type: str):
        whitelist_type = whitelist_type.lower()
        if whitelist_type not in set(WHITELIST_TYPES):
            await interaction.response.send_message("Invalid whitelist type.", ephemeral=True)
            return
        await self.bot.start_whitelist_flow(interaction, whitelist_type)

    @app_commands.command(name="my_whitelist", description="View your saved whitelist IDs")
    @app_commands.autocomplete(whitelist_type=setup_autocomplete)
    async def my_whitelist(self, interaction: discord.Interaction, whitelist_type: str):
        whitelist_type = whitelist_type.lower()
        guild_id = interaction.guild.id
        row = await self.bot.db.get_user_record(guild_id, interaction.user.id, whitelist_type)
        ids = await self.bot.db.get_identifiers(guild_id, interaction.user.id, whitelist_type)
        if not row and not ids:
            await interaction.response.send_message("No record found.", ephemeral=True)
            return
        embed = discord.Embed(title=f"My {whitelist_type.title()} Whitelist", color=discord.Color.blurple())
        if row:
            embed.add_field(name="Status", value=row[1], inline=True)
            embed.add_field(name="Slots", value=str(row[3]), inline=True)
            embed.add_field(name="Plan", value=row[4] or "N/A", inline=True)
        embed.add_field(name="Identifiers", value="\n".join(f"{t}: `{v}`" for t, v, *_ in ids) if ids else "None", inline=False)
        await interaction.response.send_message(embed=embed, ephemeral=True)

    @app_commands.command(name="whitelist_panel", description="Post or refresh a whitelist panel")
    @app_commands.autocomplete(whitelist_type=setup_autocomplete)
    async def whitelist_panel(self, interaction: discord.Interaction, whitelist_type: str):
        if not await self.bot.require_mod(interaction):
            return
        whitelist_type = whitelist_type.lower()
        if whitelist_type not in set(WHITELIST_TYPES):
            await interaction.response.send_message("Invalid whitelist type.", ephemeral=True)
            return
        guild_id = interaction.guild.id
        posted = await self.bot.post_or_refresh_panel(interaction, guild_id, whitelist_type, interaction.channel)
        if posted:
            await interaction.response.send_message(f"Panel ready: https://discord.com/channels/{interaction.guild.id}/{posted.channel.id}/{posted.id}", ephemeral=True)
        else:
            await interaction.response.send_message("Could not post panel. Check bot permissions.", ephemeral=True)


async def setup(bot):
    await bot.add_cog(WhitelistCog(bot))
