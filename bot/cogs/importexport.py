import csv
import io
from datetime import timedelta

import discord
from discord import app_commands
from discord.ext import commands
from bot.config import WHITELIST_TYPES, STEAM64_RE, EOSID_RE, log
from bot.utils import utcnow, validate_identifier, split_identifier_tokens


async def type_autocomplete(interaction: discord.Interaction, current: str):
    return [app_commands.Choice(name=item.title(), value=item) for item in WHITELIST_TYPES if current.lower() in item][:25]


class ImportExportCog(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    @app_commands.command(name="export", description="Export whitelist data as CSV")
    @app_commands.autocomplete(whitelist_type=type_autocomplete)
    @app_commands.describe(whitelist_type="Which type to export", include_inactive="Include inactive users")
    async def export_cmd(self, interaction: discord.Interaction, whitelist_type: str, include_inactive: bool = False):
        if not await self.bot.require_mod(interaction):
            return

        await interaction.response.defer(ephemeral=True)

        if include_inactive:
            rows = await self.bot.db.fetchall(
                """
                SELECT u.discord_id, u.discord_name, u.status, u.effective_slot_limit,
                       u.last_plan_name, u.updated_at
                FROM whitelist_users u
                WHERE u.whitelist_type=%s
                ORDER BY u.discord_name
                """,
                (whitelist_type,),
            )
        else:
            rows = await self.bot.db.fetchall(
                """
                SELECT u.discord_id, u.discord_name, u.status, u.effective_slot_limit,
                       u.last_plan_name, u.updated_at
                FROM whitelist_users u
                WHERE u.whitelist_type=%s AND u.status='active'
                ORDER BY u.discord_name
                """,
                (whitelist_type,),
            )

        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["discord_id", "discord_name", "status", "slots", "plan", "updated_at", "steam64_ids", "eos_ids"])

        for discord_id, discord_name, status, slots, plan, updated_at in rows:
            identifiers = await self.bot.db.get_identifiers(int(discord_id), whitelist_type)
            steam_ids = ";".join(v for t, v, *_ in identifiers if t == "steam64")
            eos_ids = ";".join(v for t, v, *_ in identifiers if t == "eosid")
            writer.writerow([str(discord_id), discord_name, status, slots, plan or "", str(updated_at or ""), steam_ids, eos_ids])

        output.seek(0)
        file = discord.File(io.BytesIO(output.getvalue().encode("utf-8")), filename=f"{whitelist_type}_export.csv")
        await interaction.followup.send(f"Exported {len(rows)} {whitelist_type} entries.", file=file, ephemeral=True)

    @app_commands.command(name="import_csv", description="Import whitelist data from a CSV file")
    @app_commands.autocomplete(whitelist_type=type_autocomplete)
    @app_commands.describe(whitelist_type="Which type to import into", file="CSV file to import")
    async def import_cmd(self, interaction: discord.Interaction, whitelist_type: str, file: discord.Attachment):
        if not await self.bot.require_mod(interaction):
            return

        if not file.filename.endswith(".csv"):
            await interaction.response.send_message("Please upload a .csv file.", ephemeral=True)
            return

        if file.size > 5 * 1024 * 1024:  # 5MB limit
            await interaction.response.send_message("File too large. Maximum 5MB.", ephemeral=True)
            return

        await interaction.response.defer(ephemeral=True)

        content = (await file.read()).decode("utf-8")
        reader = csv.DictReader(io.StringIO(content))

        imported = 0
        skipped = 0
        errors = []

        for row_num, row in enumerate(reader, start=2):
            try:
                discord_id = int(row.get("discord_id", "0"))
                discord_name = row.get("discord_name", f"User#{discord_id}")
                steam_raw = row.get("steam64_ids", "")
                eos_raw = row.get("eos_ids", "")

                if not discord_id:
                    skipped += 1
                    continue

                # Parse IDs
                identifiers = []
                for sid in steam_raw.split(";"):
                    sid = sid.strip()
                    if sid and validate_identifier("steam64", sid):
                        identifiers.append(("steam64", sid, True, "csv_import"))
                    elif sid:
                        errors.append(f"Row {row_num}: Invalid Steam64 `{sid}`")

                for eid in eos_raw.split(";"):
                    eid = eid.strip()
                    if eid and validate_identifier("eosid", eid):
                        identifiers.append(("eosid", eid, False, "csv_import"))
                    elif eid:
                        errors.append(f"Row {row_num}: Invalid EOSID `{eid}`")

                if not identifiers:
                    skipped += 1
                    continue

                # Upsert user and identifiers
                slots = len(identifiers)
                await self.bot.db.upsert_user_record(
                    discord_id, whitelist_type, discord_name, "active",
                    slots, "csv_import", None,
                )
                await self.bot.db.replace_identifiers(discord_id, whitelist_type, identifiers)
                imported += 1

            except Exception as e:
                errors.append(f"Row {row_num}: {str(e)[:80]}")

        # Sync after import
        changed = await self.bot.sync_github_outputs()
        await self.bot.db.audit("bulk_import", interaction.user.id, None, f"type={whitelist_type} imported={imported} skipped={skipped} errors={len(errors)}", whitelist_type)

        msg = f"Import complete.\n**Imported:** {imported}\n**Skipped:** {skipped}\n**Errors:** {len(errors)}\n**Files synced:** {changed}"
        if errors:
            msg += "\n\n**First errors:**\n" + "\n".join(errors[:10])

        await interaction.followup.send(msg, ephemeral=True)

    @app_commands.command(name="stats", description="Show whitelist statistics")
    async def stats(self, interaction: discord.Interaction):
        if not await self.bot.require_mod(interaction):
            return

        embed = discord.Embed(title="\U0001f4ca Whitelist Statistics", color=discord.Color.blurple())

        total_active = 0
        total_ids = 0

        for wt in WHITELIST_TYPES:
            cfg = await self.bot.db.get_type_config(wt)
            if not cfg:
                continue

            active = await self.bot.db.fetchone(
                "SELECT COUNT(*) FROM whitelist_users WHERE whitelist_type=%s AND status='active'", (wt,)
            )
            inactive = await self.bot.db.fetchone(
                "SELECT COUNT(*) FROM whitelist_users WHERE whitelist_type=%s AND status<>'active'", (wt,)
            )
            ids = await self.bot.db.fetchone(
                "SELECT COUNT(*) FROM whitelist_identifiers WHERE whitelist_type=%s", (wt,)
            )

            active_count = active[0] if active else 0
            inactive_count = inactive[0] if inactive else 0
            id_count = ids[0] if ids else 0
            total_active += active_count
            total_ids += id_count

            icon = "\u2705" if cfg["enabled"] else "\u2b1b"
            embed.add_field(
                name=f"{icon} {wt.title()}",
                value=f"Active: `{active_count}` | Inactive: `{inactive_count}` | IDs: `{id_count}`",
                inline=False,
            )

        embed.add_field(
            name="\U0001f4cb Totals",
            value=f"Active users: `{total_active}` | Total IDs: `{total_ids}`",
            inline=False,
        )

        # Recent activity
        recent = await self.bot.db.fetchone(
            "SELECT COUNT(*) FROM audit_log WHERE created_at >= %s",
            (utcnow() - timedelta(days=7),),
        )
        embed.add_field(
            name="\U0001f4c8 Activity (7 days)",
            value=f"`{recent[0] if recent else 0}` audit entries",
            inline=False,
        )

        await interaction.response.send_message(embed=embed, ephemeral=True)


async def setup(bot):
    await bot.add_cog(ImportExportCog(bot))
