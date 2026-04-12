import discord
from discord import app_commands
from discord.ext import commands
from datetime import datetime, timezone


class DiagnosticsCog(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    @app_commands.command(name="ping", description="Check bot latency and uptime")
    async def ping(self, interaction: discord.Interaction):
        latency_ms = round(self.bot.latency * 1000)
        uptime = datetime.now(timezone.utc) - self.bot._start_time if hasattr(self.bot, "_start_time") else None
        uptime_str = str(uptime).split(".")[0] if uptime else "Unknown"

        embed = discord.Embed(
            title="Pong!",
            color=discord.Color.green() if latency_ms < 200 else discord.Color.yellow(),
        )
        embed.add_field(name="Latency", value=f"`{latency_ms}ms`", inline=True)
        embed.add_field(name="Uptime", value=f"`{uptime_str}`", inline=True)
        embed.add_field(name="Guilds", value=f"`{len(self.bot.guilds)}`", inline=True)
        await interaction.response.send_message(embed=embed, ephemeral=True)

    @app_commands.command(name="permcheck", description="Check bot permissions in this channel")
    async def permcheck(self, interaction: discord.Interaction):
        channel = interaction.channel
        if not isinstance(channel, (discord.TextChannel, discord.Thread)):
            await interaction.response.send_message("This command only works in text channels.", ephemeral=True)
            return

        perms = channel.permissions_for(interaction.guild.me)

        required = {
            "View Channel": perms.view_channel,
            "Send Messages": perms.send_messages,
            "Embed Links": perms.embed_links,
            "Attach Files": perms.attach_files,
            "Read Message History": perms.read_message_history,
            "Use External Emojis": perms.use_external_emojis,
            "Add Reactions": perms.add_reactions,
            "Manage Messages": perms.manage_messages,
        }

        lines = []
        missing = []
        for name, has in required.items():
            if has:
                lines.append(f"  {name}")
            else:
                lines.append(f"  {name}")
                missing.append(name)

        if missing:
            embed = discord.Embed(
                title=f"Permission Check — #{channel.name}",
                description=f"**Missing {len(missing)} permission(s):**\n" + "\n".join(f"- {m}" for m in missing),
                color=discord.Color.red(),
            )
        else:
            embed = discord.Embed(
                title=f"Permission Check — #{channel.name}",
                description="All required permissions are granted.",
                color=discord.Color.green(),
            )

        detail = "\n".join(f"{'Yes' :>3}  {name}" if has else f"{'No' :>3}  {name}" for name, has in required.items())
        embed.add_field(name="Details", value=f"```\n{detail}\n```", inline=False)
        await interaction.response.send_message(embed=embed, ephemeral=True)

    @app_commands.command(name="panelstatus", description="Show push status for all panels in this server")
    async def panelstatus(self, interaction: discord.Interaction):
        if not await self.bot.require_mod(interaction):
            return

        guild_id = interaction.guild_id
        panels = await self.bot.db.get_panels(guild_id)
        if not panels:
            await interaction.response.send_message("No panels configured for this server.", ephemeral=True)
            return

        embed = discord.Embed(
            title="Panel Status",
            color=discord.Color.blurple(),
            timestamp=datetime.now(timezone.utc),
        )

        for p in panels:
            name = p.get("name", "Unknown")
            channel_id = p.get("channel_id")
            message_id = p.get("panel_message_id")
            status = p.get("last_push_status")
            error = p.get("last_push_error")
            push_at = p.get("last_push_at")
            enabled = p.get("enabled", False)

            channel_str = f"<#{channel_id}>" if channel_id else "`Not configured`"

            if message_id and channel_id:
                msg_link = f"[Jump to message](https://discord.com/channels/{guild_id}/{channel_id}/{message_id})"
            else:
                msg_link = "`No message posted`"

            status_icon = "Unknown"
            if status == "ok":
                status_icon = "OK"
            elif status == "error":
                status_icon = "Error"
            elif status is None:
                status_icon = "Never pushed"

            push_time = ""
            if push_at:
                if isinstance(push_at, datetime):
                    push_time = f"\n**Last push:** <t:{int(push_at.timestamp())}:R>"
                else:
                    push_time = f"\n**Last push:** {push_at}"

            error_line = f"\n**Error:** `{error}`" if error else ""

            embed.add_field(
                name=f"{'Enabled' if enabled else 'Disabled'} — {name}",
                value=(
                    f"**Channel:** {channel_str}\n"
                    f"**Status:** `{status_icon}`{error_line}{push_time}\n"
                    f"**Message:** {msg_link}"
                ),
                inline=False,
            )

        await interaction.response.send_message(embed=embed, ephemeral=True)


async def setup(bot):
    await bot.add_cog(DiagnosticsCog(bot))
