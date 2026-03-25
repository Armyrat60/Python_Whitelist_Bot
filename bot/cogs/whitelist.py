import discord
from discord import app_commands
from discord.ext import commands
from typing import List

from bot.config import WEB_BASE_URL
from bot.utils import _modal_on_error

_DASHBOARD_URL = WEB_BASE_URL or "https://squadwhitelister.com"


async def setup_autocomplete(interaction: discord.Interaction, current: str):
    guild_id = interaction.guild.id
    whitelists = await interaction.client.db.get_whitelists(guild_id)
    slugs = [wl["slug"] for wl in whitelists]
    return [app_commands.Choice(name=item, value=item) for item in slugs if current.lower() in item][:25]


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
    """Persistent panel view with interactive buttons for members and managers."""

    def __init__(self, bot, whitelist_type: str, whitelist_id: int = None):
        super().__init__(timeout=None)
        self.bot = bot
        self.whitelist_type = whitelist_type
        self.whitelist_id = whitelist_id

        # Row 1: Member buttons
        submit_btn = discord.ui.Button(
            label="Submit / Update ID",
            style=discord.ButtonStyle.green,
            emoji="🛡️",
            custom_id=f"panel:submit:{whitelist_type}",
            row=0,
        )
        submit_btn.callback = self._submit_callback
        self.add_item(submit_btn)

        view_btn = discord.ui.Button(
            label="View My Whitelist",
            style=discord.ButtonStyle.primary,
            emoji="📋",
            custom_id=f"panel:view:{whitelist_type}",
            row=0,
        )
        view_btn.callback = self._view_callback
        self.add_item(view_btn)

        web_btn = discord.ui.Button(
            label="Web Dashboard",
            style=discord.ButtonStyle.link,
            url=f"{_DASHBOARD_URL}/my-whitelist",
            emoji="🌐",
            row=0,
        )
        self.add_item(web_btn)

        # Row 2: Manager button
        manage_btn = discord.ui.Button(
            label="Manager Tools",
            style=discord.ButtonStyle.secondary,
            emoji="⚙️",
            custom_id=f"panel:manage:{whitelist_type}",
            row=1,
        )
        manage_btn.callback = self._manage_callback
        self.add_item(manage_btn)

    async def _submit_callback(self, interaction: discord.Interaction):
        await self.bot.start_whitelist_flow(interaction, self.whitelist_type)

    async def _view_callback(self, interaction: discord.Interaction):
        guild_id = interaction.guild.id
        wl = await self.bot.db.get_whitelist_by_slug(guild_id, self.whitelist_type)
        if not wl:
            await interaction.response.send_message("Whitelist not found.", ephemeral=True)
            return
        wl_id = wl["id"]
        row = await self.bot.db.get_user_record(guild_id, interaction.user.id, wl_id)
        ids = await self.bot.db.get_identifiers(guild_id, interaction.user.id, wl_id)
        if not row and not ids:
            await interaction.response.send_message("You don't have a whitelist entry yet. Click **Submit / Update ID** to get started!", ephemeral=True)
            return
        embed = discord.Embed(title=f"My {wl['name']} Whitelist", color=0xF97316)
        if row:
            embed.add_field(name="Status", value=row[1], inline=True)
            embed.add_field(name="Slots", value=str(row[3]), inline=True)
            if row[4]:
                embed.add_field(name="Tier", value=row[4], inline=True)
        if ids:
            id_lines = []
            for t, v, *_ in ids:
                label = "Steam64" if t == "steam64" else "EOS"
                id_lines.append(f"**{label}:** `{v}`")
            embed.add_field(name="Your IDs", value="\n".join(id_lines), inline=False)
        else:
            embed.add_field(name="Your IDs", value="None submitted yet", inline=False)
        embed.set_footer(text=f"Squad Whitelister • {_DASHBOARD_URL.replace('https://', '')}")
        await interaction.response.send_message(embed=embed, ephemeral=True)

    async def _manage_callback(self, interaction: discord.Interaction):
        if not await self.bot.user_is_mod(interaction.guild.id, interaction.user):
            await interaction.response.send_message("You need manager permissions to use this.", ephemeral=True)
            return
        # Show manager menu
        view = ManagerMenuView(self.bot, self.whitelist_type)
        embed = discord.Embed(
            title="⚙️ Manager Tools",
            description="Select an action below to manage whitelist entries.",
            color=0xF97316,
        )
        await interaction.response.send_message(embed=embed, view=view, ephemeral=True)


class ManagerMenuView(discord.ui.View):
    """Ephemeral manager tools menu."""

    def __init__(self, bot, whitelist_type: str):
        super().__init__(timeout=120)
        self.bot = bot
        self.whitelist_type = whitelist_type

        # Link buttons must be added manually (can't use decorator)
        self.add_item(discord.ui.Button(
            label="Open Dashboard",
            style=discord.ButtonStyle.link,
            url=f"{_DASHBOARD_URL}/dashboard",
            emoji="🌐",
        ))

    @discord.ui.button(label="Lookup User", style=discord.ButtonStyle.primary, emoji="🔍")
    async def lookup(self, interaction: discord.Interaction, button: discord.ui.Button):
        modal = LookupModal(self.bot, self.whitelist_type)
        await interaction.response.send_modal(modal)

    @discord.ui.button(label="View Stats", style=discord.ButtonStyle.secondary, emoji="📊")
    async def stats(self, interaction: discord.Interaction, button: discord.ui.Button):
        guild_id = interaction.guild.id
        wl = await self.bot.db.get_whitelist_by_slug(guild_id, self.whitelist_type)
        if not wl:
            await interaction.response.send_message("Whitelist not found.", ephemeral=True)
            return
        wl_id = wl["id"]
        active_row = await self.bot.db.fetchone(
            "SELECT COUNT(*) FROM whitelist_users WHERE guild_id=%s AND whitelist_id=%s AND status='active'",
            (guild_id, wl_id),
        )
        id_row = await self.bot.db.fetchone(
            "SELECT COUNT(*) FROM whitelist_identifiers WHERE guild_id=%s AND whitelist_id=%s",
            (guild_id, wl_id),
        )
        embed = discord.Embed(title=f"📊 {wl['name']} Stats", color=0xF97316)
        embed.add_field(name="Active Users", value=str(active_row[0] if active_row else 0), inline=True)
        embed.add_field(name="Total IDs", value=str(id_row[0] if id_row else 0), inline=True)
        embed.set_footer(text="Squad Whitelister")
        await interaction.response.send_message(embed=embed, ephemeral=True)


class LookupModal(discord.ui.Modal, title="Lookup User"):
    on_error = _modal_on_error

    def __init__(self, bot, whitelist_type: str):
        super().__init__(timeout=120)
        self.bot = bot
        self.whitelist_type = whitelist_type
        self.user_input = discord.ui.TextInput(
            label="Discord Username or ID",
            placeholder="e.g. armyrat60 or 268871213479231489",
            required=True,
            max_length=100,
        )
        self.add_item(self.user_input)

    async def on_submit(self, interaction: discord.Interaction):
        guild_id = interaction.guild.id
        query = self.user_input.value.strip()
        wl = await self.bot.db.get_whitelist_by_slug(guild_id, self.whitelist_type)
        if not wl:
            await interaction.response.send_message("Whitelist not found.", ephemeral=True)
            return
        wl_id = wl["id"]

        # Try to find by Discord ID or name
        target_id = None
        if query.isdigit():
            target_id = int(query)
        else:
            # Search by name in the guild
            member = discord.utils.find(lambda m: m.name.lower() == query.lower() or m.display_name.lower() == query.lower(), interaction.guild.members)
            if member:
                target_id = member.id

        if not target_id:
            await interaction.response.send_message(f"Could not find user `{query}`. Try their Discord ID.", ephemeral=True)
            return

        row = await self.bot.db.get_user_record(guild_id, target_id, wl_id)
        ids = await self.bot.db.get_identifiers(guild_id, target_id, wl_id)

        if not row and not ids:
            await interaction.response.send_message(f"No whitelist entry found for <@{target_id}>.", ephemeral=True)
            return

        embed = discord.Embed(title=f"Whitelist Entry for <@{target_id}>", color=0xF97316)
        if row:
            embed.add_field(name="Status", value=row[1], inline=True)
            embed.add_field(name="Slots", value=str(row[3]), inline=True)
            if row[4]:
                embed.add_field(name="Tier", value=row[4], inline=True)
        if ids:
            id_lines = [f"**{'Steam64' if t == 'steam64' else 'EOS'}:** `{v}`" for t, v, *_ in ids]
            embed.add_field(name="IDs", value="\n".join(id_lines), inline=False)
        embed.set_footer(text="Squad Whitelister")
        await interaction.response.send_message(embed=embed, ephemeral=True)


class WhitelistCog(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    @app_commands.command(name="whitelist", description="Submit or update your whitelist IDs")
    @app_commands.autocomplete(whitelist_type=setup_autocomplete)
    async def whitelist(self, interaction: discord.Interaction, whitelist_type: str):
        whitelist_type = whitelist_type.lower()
        guild_id = interaction.guild.id
        wl = await self.bot.db.get_whitelist_by_slug(guild_id, whitelist_type)
        if not wl:
            await interaction.response.send_message("Invalid whitelist type.", ephemeral=True)
            return
        await self.bot.start_whitelist_flow(interaction, whitelist_type)

    @app_commands.command(name="my_whitelist", description="View your saved whitelist IDs")
    @app_commands.autocomplete(whitelist_type=setup_autocomplete)
    async def my_whitelist(self, interaction: discord.Interaction, whitelist_type: str):
        whitelist_type = whitelist_type.lower()
        guild_id = interaction.guild.id
        wl = await self.bot.db.get_whitelist_by_slug(guild_id, whitelist_type)
        if not wl:
            await interaction.response.send_message("Invalid whitelist type.", ephemeral=True)
            return
        whitelist_id = wl["id"]
        row = await self.bot.db.get_user_record(guild_id, interaction.user.id, whitelist_id)
        ids = await self.bot.db.get_identifiers(guild_id, interaction.user.id, whitelist_id)
        if not row and not ids:
            await interaction.response.send_message("No record found.", ephemeral=True)
            return
        embed = discord.Embed(title=f"My {wl['name']} Whitelist", color=discord.Color.blurple())
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
        guild_id = interaction.guild.id
        wl = await self.bot.db.get_whitelist_by_slug(guild_id, whitelist_type)
        if not wl:
            await interaction.response.send_message("Invalid whitelist type.", ephemeral=True)
            return
        posted = await self.bot.post_or_refresh_panel(interaction, guild_id, whitelist_type, interaction.channel)
        if posted:
            await interaction.response.send_message(f"Panel ready: https://discord.com/channels/{interaction.guild.id}/{posted.channel.id}/{posted.id}", ephemeral=True)
        else:
            await interaction.response.send_message("Could not post panel. Check bot permissions.", ephemeral=True)


async def setup(bot):
    await bot.add_cog(WhitelistCog(bot))
