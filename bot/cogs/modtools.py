import discord
from discord import app_commands
from discord.ext import commands

from bot.utils import _view_on_error, split_identifier_tokens, validate_identifier


async def setup_autocomplete(interaction: discord.Interaction, current: str):
    return []  # Legacy type system removed — whitelists are now dynamic


class ModToolsView(discord.ui.View):
    on_error = _view_on_error

    def __init__(self, bot, whitelist_type: str):
        super().__init__(timeout=600)
        self.bot = bot
        self.whitelist_type = whitelist_type

    @discord.ui.button(label="Post / Refresh Panel", style=discord.ButtonStyle.blurple)
    async def panel_btn(self, interaction: discord.Interaction, button: discord.ui.Button):
        guild_id = interaction.guild.id
        await interaction.response.defer(ephemeral=True)
        posted = await self.bot.post_or_refresh_panel(interaction, guild_id, self.whitelist_type, interaction.channel)
        if posted:
            await interaction.followup.send(f"Panel refreshed in <#{posted.channel.id}>.", ephemeral=True)
        else:
            await interaction.followup.send("Could not refresh panel.", ephemeral=True)

    @discord.ui.button(label="Resync GitHub", style=discord.ButtonStyle.green)
    async def resync_btn(self, interaction: discord.Interaction, button: discord.ui.Button):
        guild_id = interaction.guild.id
        changed = await self.bot.sync_github_outputs(guild_id=guild_id)
        await interaction.response.send_message(f"Resync complete. Changed files: {changed}", ephemeral=True)

    @discord.ui.button(label="Status", style=discord.ButtonStyle.secondary)
    async def status_btn(self, interaction: discord.Interaction, button: discord.ui.Button):
        embed = await self.bot.build_status_embed(interaction.guild)
        await interaction.response.send_message(embed=embed, ephemeral=True)


class ModToolsCog(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    @app_commands.command(name="mod_view", description="Moderator: view a user's whitelist")
    @app_commands.autocomplete(whitelist_type=setup_autocomplete)
    async def mod_view(self, interaction: discord.Interaction, user: discord.Member, whitelist_type: str):
        if not await self.bot.require_mod(interaction):
            return
        guild_id = interaction.guild.id
        row = await self.bot.db.get_user_record(guild_id, user.id, whitelist_type)
        ids = await self.bot.db.get_identifiers(guild_id, user.id, whitelist_type)
        embed = discord.Embed(title=f"{user} | {whitelist_type.title()}", color=discord.Color.blurple())
        if row:
            embed.add_field(name="Status", value=row[1], inline=True)
            embed.add_field(name="Override", value=str(row[2]), inline=True)
            embed.add_field(name="Effective Slots", value=str(row[3]), inline=True)
            embed.add_field(name="Plan", value=row[4] or "N/A", inline=True)
        embed.add_field(name="IDs", value="\n".join(f"{t}: `{v}`" for t, v, *_ in ids) if ids else "None", inline=False)
        await interaction.response.send_message(embed=embed, ephemeral=True)

    @app_commands.command(name="mod_override", description="Moderator: set or clear a slot override")
    @app_commands.autocomplete(whitelist_type=setup_autocomplete)
    async def mod_override(self, interaction: discord.Interaction, user: discord.Member, whitelist_type: str, slots: int):
        if not await self.bot.require_mod(interaction):
            return
        guild_id = interaction.guild.id
        value = None if slots < 0 else slots
        await self.bot.db.set_override(guild_id, user.id, whitelist_type, value)
        await self.bot.db.audit(guild_id, "mod_override", interaction.user.id, user.id, f"type={whitelist_type} override={value}", whitelist_type)
        await interaction.response.send_message(f"Override updated for {user.mention}: {value}", ephemeral=True)

    @app_commands.command(name="mod_remove", description="Moderator: remove a user's whitelist from active output")
    @app_commands.autocomplete(whitelist_type=setup_autocomplete)
    async def mod_remove(self, interaction: discord.Interaction, user: discord.Member, whitelist_type: str):
        if not await self.bot.require_mod(interaction):
            return
        guild_id = interaction.guild.id
        await self.bot.db.set_user_status(guild_id, user.id, whitelist_type, "removed_by_staff")
        await self.bot.db.audit(guild_id, "mod_remove", interaction.user.id, user.id, f"type={whitelist_type}", whitelist_type)
        await self.bot.sync_github_outputs(guild_id=guild_id)
        await interaction.response.send_message(f"Removed {user.mention} from active {whitelist_type} output.", ephemeral=True)

    @app_commands.command(name="mod_set", description="Moderator: replace a user's IDs")
    @app_commands.autocomplete(whitelist_type=setup_autocomplete)
    async def mod_set(self, interaction: discord.Interaction, user: discord.Member, whitelist_type: str, steam_ids: str = "", eos_ids: str = ""):
        if not await self.bot.require_mod(interaction):
            return
        guild_id = interaction.guild.id
        member = user
        slots, plan = await self.bot.calculate_user_slots(guild_id, member, whitelist_type)
        steam_vals = list(dict.fromkeys(token for token in split_identifier_tokens(steam_ids) if token))
        eos_vals = list(dict.fromkeys(token.lower() for token in split_identifier_tokens(eos_ids) if token))
        invalid_steam = [v for v in steam_vals if not validate_identifier("steam64", v)]
        invalid_eos = [v for v in eos_vals if not validate_identifier("eosid", v)]
        if invalid_steam or invalid_eos:
            await interaction.response.send_message("Invalid IDs supplied.", ephemeral=True)
            return
        submitted = [("steam64", v, True, "format_only") for v in steam_vals] + [("eosid", v, False, "unverified") for v in eos_vals]
        if len(submitted) > slots:
            await interaction.response.send_message(f"Target user only has {slots} slots.", ephemeral=True)
            return
        await self.bot.db.upsert_user_record(guild_id, user.id, whitelist_type, str(user), "active", slots, plan)
        await self.bot.db.replace_identifiers(guild_id, user.id, whitelist_type, submitted)
        await self.bot.db.audit(guild_id, "mod_set", interaction.user.id, user.id, f"type={whitelist_type} count={len(submitted)}", whitelist_type)
        changed = await self.bot.sync_github_outputs(guild_id=guild_id)
        await interaction.response.send_message(f"Saved {len(submitted)} IDs for {user.mention}. Changed files: {changed}", ephemeral=True)

async def setup(bot):
    await bot.add_cog(ModToolsCog(bot))
