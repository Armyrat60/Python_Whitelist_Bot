import discord
from discord import app_commands
from discord.ext import commands
from bot.config import WHITELIST_TYPES, log


class SearchCog(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    @app_commands.command(name="search", description="Search for a Steam ID or EOS ID across all whitelists")
    @app_commands.describe(identifier="Steam64 ID or EOS ID to search for")
    async def search(self, interaction: discord.Interaction, identifier: str):
        if not await self.bot.require_mod(interaction):
            return

        guild_id = interaction.guild.id
        identifier = identifier.strip()

        # Search across all types
        rows = await self.bot.db.fetchall(
            """
            SELECT i.discord_id, u.discord_name, i.whitelist_type, i.id_type, i.id_value, u.status
            FROM whitelist_identifiers i
            JOIN whitelist_users u ON u.guild_id = i.guild_id AND u.discord_id = i.discord_id AND u.whitelist_type = i.whitelist_type
            WHERE i.guild_id = %s AND i.id_value = %s
            ORDER BY i.whitelist_type, u.discord_name
            """,
            (guild_id, identifier,),
        )

        if not rows:
            # Try partial match
            rows = await self.bot.db.fetchall(
                """
                SELECT i.discord_id, u.discord_name, i.whitelist_type, i.id_type, i.id_value, u.status
                FROM whitelist_identifiers i
                JOIN whitelist_users u ON u.guild_id = i.guild_id AND u.discord_id = i.discord_id AND u.whitelist_type = i.whitelist_type
                WHERE i.guild_id = %s AND i.id_value LIKE %s
                ORDER BY i.whitelist_type, u.discord_name
                LIMIT 20
                """,
                (guild_id, f"%{identifier}%",),
            )

        if not rows:
            await interaction.response.send_message(f"No results found for `{identifier}`.", ephemeral=True)
            return

        embed = discord.Embed(
            title=f"Search Results: `{identifier}`",
            color=discord.Color.blurple(),
        )

        for discord_id, discord_name, wl_type, id_type, id_value, status in rows[:25]:
            status_icon = "\u2705" if status == "active" else "\u274c"
            embed.add_field(
                name=f"{status_icon} {discord_name}",
                value=f"Type: `{wl_type}` | `{id_type}`: `{id_value}`\nDiscord: <@{discord_id}> | Status: `{status}`",
                inline=False,
            )

        if len(rows) > 25:
            embed.set_footer(text=f"Showing 25 of {len(rows)} results")
        else:
            embed.set_footer(text=f"{len(rows)} result(s) found")

        await interaction.response.send_message(embed=embed, ephemeral=True)


async def setup(bot):
    await bot.add_cog(SearchCog(bot))
