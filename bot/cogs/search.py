import discord
from discord import app_commands
from discord.ext import commands
from datetime import timedelta
from bot.utils import utcnow


def _status_icon(status: str, expires_at=None) -> str:
    if status != "active":
        return "\u274c"  # ❌
    if expires_at:
        if expires_at <= utcnow():
            return "\u23f0"  # ⏰ expired
        if expires_at <= utcnow() + timedelta(days=7):
            return "\u26a0\ufe0f"  # ⚠️ expiring soon
    return "\u2705"  # ✅


class SearchCog(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    # ── /search — search by identifier (Steam64 / EOS ID) ────────────────────

    @app_commands.command(name="search", description="Search for a player by Steam64, EOS ID, or Discord name")
    @app_commands.describe(query="Discord name, Discord ID, Steam64, or EOS ID")
    async def search(self, interaction: discord.Interaction, query: str):
        if not await self.bot.require_mod(interaction):
            return

        await interaction.response.defer(ephemeral=True)
        guild_id = interaction.guild.id
        q = query.strip()

        rows = await self.bot.db.fetchall(
            """
            SELECT DISTINCT
                u.discord_id, u.discord_name, wl.name AS whitelist_name, u.status, u.expires_at,
                i.id_type, i.id_value
            FROM whitelist_users u
            JOIN whitelists wl ON wl.id = u.whitelist_id
            LEFT JOIN whitelist_identifiers i ON i.discord_id = u.discord_id
                AND i.whitelist_id = u.whitelist_id AND i.guild_id = u.guild_id
            WHERE u.guild_id = %s
              AND (
                    u.discord_name ILIKE %s
                 OR u.discord_id::text = %s
                 OR i.id_value = %s
                 OR i.id_value ILIKE %s
              )
            ORDER BY u.discord_name, wl.name
            LIMIT 50
            """,
            (guild_id, f"%{q}%", q, q, f"%{q}%"),
        )

        if not rows:
            await interaction.followup.send(f"No players found matching `{q}`.", ephemeral=True)
            return

        # Group by discord_id to build per-player embed fields
        players: dict[int, dict] = {}
        for row in rows:
            discord_id, discord_name, wl_name, status, expires_at, id_type, id_value = row
            if discord_id not in players:
                players[discord_id] = {
                    "name": discord_name or "Unknown",
                    "memberships": [],
                    "ids": set(),
                }
            p = players[discord_id]
            icon = _status_icon(status, expires_at)
            membership = f"{icon} **{wl_name}** (`{status}`)"
            if membership not in p["memberships"]:
                p["memberships"].append(membership)
            if id_value:
                p["ids"].add(f"`{id_value}`")

        embed = discord.Embed(
            title=f"Player Search: `{q}`",
            color=discord.Color.blurple(),
            description=f"{len(players)} player(s) found",
        )

        for discord_id, info in list(players.items())[:10]:
            ids_str    = " ".join(list(info["ids"])[:3]) if info["ids"] else "No IDs on file"
            member_str = "\n".join(info["memberships"][:4]) or "No memberships"
            embed.add_field(
                name=f"{info['name']}",
                value=f"<@{discord_id}> · `{discord_id}`\n{ids_str}\n{member_str}",
                inline=False,
            )

        if len(players) > 10:
            embed.set_footer(text=f"Showing 10 of {len(players)} players — refine your search for better results")

        await interaction.followup.send(embed=embed, ephemeral=True)

    # ── /player — detailed profile for a single player ────────────────────────

    @app_commands.command(name="player", description="Show detailed whitelist profile for a Discord user")
    @app_commands.describe(member="Discord member to look up", discord_id="Discord ID (if member is not in server)")
    async def player(
        self,
        interaction: discord.Interaction,
        member: discord.Member | None = None,
        discord_id: str | None = None,
    ):
        if not await self.bot.require_mod(interaction):
            return

        await interaction.response.defer(ephemeral=True)
        guild_id = interaction.guild.id

        if member:
            target_id = member.id
            display_name = str(member.display_name)
        elif discord_id:
            try:
                target_id = int(discord_id.strip())
            except ValueError:
                await interaction.followup.send("Invalid Discord ID.", ephemeral=True)
                return
            display_name = discord_id
        else:
            await interaction.followup.send("Provide a member or Discord ID.", ephemeral=True)
            return

        rows = await self.bot.db.fetchall(
            """
            SELECT u.discord_name, wl.name AS whitelist_name, u.status, u.expires_at,
                   u.last_plan_name, u.created_at
            FROM whitelist_users u
            JOIN whitelists wl ON wl.id = u.whitelist_id
            WHERE u.guild_id = %s AND u.discord_id = %s
            ORDER BY wl.name
            """,
            (guild_id, target_id),
        )

        id_rows = await self.bot.db.fetchall(
            """
            SELECT DISTINCT id_type, id_value, is_verified
            FROM whitelist_identifiers
            WHERE guild_id = %s AND discord_id = %s
            ORDER BY id_type, id_value
            """,
            (guild_id, target_id),
        )

        if not rows and not id_rows:
            await interaction.followup.send(
                f"No whitelist records found for Discord ID `{target_id}`.",
                ephemeral=True,
            )
            return

        player_name = rows[0][0] if rows else display_name
        is_verified = any(r[2] for r in id_rows)

        verified_str = " \u2705 Verified" if is_verified else ""
        embed = discord.Embed(
            title=f"{player_name}{verified_str}",
            description=f"<@{target_id}> · `{target_id}`",
            color=discord.Color.green() if is_verified else discord.Color.blurple(),
        )

        # Identifiers
        if id_rows:
            steam_ids = [r[1] for r in id_rows if r[0] in ("steamid", "steam64")]
            eos_ids   = [r[1] for r in id_rows if r[0] == "eosid"]
            id_lines  = []
            if steam_ids:
                id_lines.append("**Steam64:** " + ", ".join(f"`{s}`" for s in steam_ids[:3]))
            if eos_ids:
                id_lines.append("**EOS:** " + ", ".join(f"`{e[:20]}…`" if len(e) > 20 else f"`{e}`" for e in eos_ids[:2]))
            if id_lines:
                embed.add_field(name="Identifiers", value="\n".join(id_lines), inline=False)

        # Memberships
        if rows:
            membership_lines = []
            for _, wl_name, status, expires_at, tier, created_at in rows:
                icon = _status_icon(status, expires_at)
                line = f"{icon} **{wl_name}** — `{status}`"
                if tier:
                    line += f" · {tier}"
                if expires_at:
                    line += f"\n  ↳ Expires {expires_at.strftime('%Y-%m-%d')}"
                membership_lines.append(line)
            embed.add_field(
                name=f"Memberships ({len(rows)})",
                value="\n".join(membership_lines[:8]) or "None",
                inline=False,
            )

        embed.set_footer(text=f"ID: {target_id}")
        await interaction.followup.send(embed=embed, ephemeral=True)


async def setup(bot):
    await bot.add_cog(SearchCog(bot))
