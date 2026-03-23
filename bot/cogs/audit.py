import discord
from discord import app_commands
from discord.ext import commands
from bot.config import WHITELIST_TYPES, log


async def type_autocomplete(interaction: discord.Interaction, current: str):
    choices = [app_commands.Choice(name="All Types", value="all")]
    choices.extend([
        app_commands.Choice(name=item.title(), value=item)
        for item in WHITELIST_TYPES if current.lower() in item
    ])
    return choices[:25]


class AuditCog(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    @app_commands.command(name="audit", description="View recent audit log entries")
    @app_commands.describe(
        whitelist_type="Filter by whitelist type (or All)",
        user="Filter by user",
        count="Number of entries to show (max 25)"
    )
    @app_commands.autocomplete(whitelist_type=type_autocomplete)
    async def audit(self, interaction: discord.Interaction, whitelist_type: str = "all", user: discord.Member = None, count: int = 10):
        if not await self.bot.require_mod(interaction):
            return

        guild_id = interaction.guild.id
        count = min(max(1, count), 25)

        conditions = ["a.guild_id=%s"]
        params = [guild_id]

        if whitelist_type != "all" and whitelist_type in WHITELIST_TYPES:
            conditions.append("a.whitelist_type=%s")
            params.append(whitelist_type)

        if user:
            conditions.append("(a.actor_discord_id=%s OR a.target_discord_id=%s)")
            params.extend([user.id, user.id])

        where = f"WHERE {' AND '.join(conditions)}"
        params.append(count)

        rows = await self.bot.db.fetchall(
            f"""
            SELECT a.action_type, a.actor_discord_id, a.target_discord_id,
                   a.whitelist_type, a.details, a.created_at
            FROM audit_log a
            {where}
            ORDER BY a.created_at DESC
            LIMIT %s
            """,
            tuple(params),
        )

        if not rows:
            await interaction.response.send_message("No audit entries found.", ephemeral=True)
            return

        title = "Audit Log"
        if whitelist_type != "all":
            title += f" \u2014 {whitelist_type.title()}"
        if user:
            title += f" \u2014 {user.display_name}"

        embed = discord.Embed(title=title, color=discord.Color.dark_gray())

        lines = []
        for action, actor_id, target_id, wtype, details, created_at in rows:
            timestamp = f"<t:{int(created_at.timestamp())}:R>" if created_at else "?"
            actor = f"<@{actor_id}>" if actor_id else "System"
            target = f" \u2192 <@{target_id}>" if target_id else ""
            type_tag = f"[{wtype}]" if wtype else ""
            # Truncate details
            detail_short = (details[:60] + "...") if details and len(details) > 60 else (details or "")
            lines.append(f"{timestamp} **{action}** {type_tag}\n{actor}{target} {detail_short}")

        embed.description = "\n\n".join(lines)
        embed.set_footer(text=f"Showing {len(rows)} entries")

        await interaction.response.send_message(embed=embed, ephemeral=True)


async def setup(bot):
    await bot.add_cog(AuditCog(bot))
