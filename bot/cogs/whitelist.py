import discord
from discord import app_commands
from discord.ext import commands
from difflib import SequenceMatcher
from typing import List

from bot.config import WEB_BASE_URL
from bot.utils import _modal_on_error

_DASHBOARD_URL = WEB_BASE_URL or "https://squadwhitelister.com"


async def setup_autocomplete(interaction: discord.Interaction, current: str):
    guild_id = interaction.guild.id
    whitelists = await interaction.client.db.get_whitelists(guild_id)
    slugs = [wl["slug"] for wl in whitelists]
    return [app_commands.Choice(name=item, value=item) for item in slugs if current.lower() in item][:25]


def _parse_role_names(plan: str | None) -> list[str]:
    """Extract role names from a plan string like 'Solo:1 + Duo:2' → ['Solo', 'Duo']."""
    if not plan:
        return []
    names = []
    for part in plan.split(" + "):
        part = part.strip()
        name = part.split(":")[0].strip() if ":" in part else part
        if name and name.lower() != "default":
            names.append(name)
    return names


def _name_similarity(a: str, b: str) -> float:
    """Return 0–1 similarity between two display names (case-insensitive)."""
    a, b = a.lower().strip(), b.lower().strip()
    if a == b:
        return 1.0
    return SequenceMatcher(None, a, b).ratio()


async def _find_orphan_candidate(db, guild_id: int, whitelist_id: int, display_name: str):
    """Return the best-matching orphan record for a user, or None if no good match."""
    rows = await db.fetchall(
        "SELECT discord_id, discord_name FROM whitelist_users "
        "WHERE guild_id=%s AND whitelist_id=%s AND discord_id < 0",
        (guild_id, whitelist_id),
    )
    if not rows:
        return None
    best_score = 0.0
    best_row = None
    for row in rows:
        score = _name_similarity(display_name, row[1] or "")
        if score > best_score:
            best_score = score
            best_row = row
    return best_row if best_score >= 0.70 else None


class IdentifierModal(discord.ui.Modal, title="Manage Whitelist IDs"):
    on_error = _modal_on_error

    def __init__(self, bot, whitelist_type: str, slot_limit: int, existing: List[tuple]):
        super().__init__(timeout=300)
        self.bot = bot
        self.whitelist_type = whitelist_type
        self.slot_limit = slot_limit

        # Combine all existing IDs into one field (Steam64 and EOS together)
        existing_ids = ", ".join(v for _, v, *_ in existing)

        self.ids_field = discord.ui.TextInput(
            label=f"Your IDs ({len(existing)}/{slot_limit} slots used)",
            default=existing_ids[:4000],
            required=True,
            style=discord.TextStyle.paragraph,
            placeholder="Paste Steam64 IDs, EOS IDs, or Steam profile URLs — comma or newline separated",
            max_length=4000,
        )
        self.add_item(self.ids_field)

    async def on_submit(self, interaction: discord.Interaction):
        # Parse the unified input — auto-detect Steam64 vs EOS
        from bot.utils import split_identifier_tokens
        from bot.config import STEAM64_RE, EOSID_RE

        raw = self.ids_field.value
        tokens = split_identifier_tokens(raw)

        # Resolve vanity URLs first
        from bot.utils import resolve_steam_vanity
        resolved_tokens = []
        for token in tokens:
            if token.startswith("vanity:"):
                vanity_name = token[7:]
                steam64 = await resolve_steam_vanity(vanity_name)
                if steam64:
                    resolved_tokens.append(steam64)
                else:
                    resolved_tokens.append(token)  # Will fail validation with helpful error
            else:
                resolved_tokens.append(token)

        # Auto-classify each token
        steam_ids = []
        eos_ids = []
        for token in resolved_tokens:
            if STEAM64_RE.fullmatch(token):
                steam_ids.append(token)
            elif EOSID_RE.fullmatch(token.lower()):
                eos_ids.append(token.lower())
            else:
                # Unknown format — try as Steam64 anyway (will fail validation later)
                steam_ids.append(token)

        await self.bot.handle_identifier_submission(
            interaction,
            self.whitelist_type,
            ", ".join(steam_ids),
            ", ".join(eos_ids),
        )


class _ClaimOrphanView(discord.ui.View):
    """Shown to first-time users when we find an orphan record that matches their name."""

    def __init__(self, bot, whitelist_type: str, whitelist_id: int, orphan_id: int,
                 slots: int, existing_ids: List[tuple]):
        super().__init__(timeout=120)
        self.bot = bot
        self.whitelist_type = whitelist_type
        self.whitelist_id = whitelist_id
        self.orphan_id = orphan_id
        self.slots = slots
        self.existing_ids = existing_ids

    @discord.ui.button(label="Yes, that's me!", style=discord.ButtonStyle.green, emoji="✅")
    async def claim_yes(self, interaction: discord.Interaction, button: discord.ui.Button):
        guild_id = interaction.guild.id
        real_id = interaction.user.id
        orphan_id = self.orphan_id
        try:
            # Re-parent orphan record to real Discord ID
            await self.bot.db.execute_transaction([
                (
                    "UPDATE whitelist_identifiers SET discord_id=%s WHERE guild_id=%s AND discord_id=%s",
                    (real_id, guild_id, orphan_id),
                ),
                (
                    "UPDATE whitelist_users SET discord_id=%s, discord_name=%s WHERE guild_id=%s AND discord_id=%s",
                    (real_id, interaction.user.display_name, guild_id, orphan_id),
                ),
            ])
            await self.bot.db.audit(
                guild_id, "orphan_self_claimed", real_id, real_id,
                f"User claimed orphan record (orphan_id={orphan_id})", self.whitelist_id,
            )
            await self.bot.sync_github_outputs(guild_id)
        except Exception:
            from bot.config import log
            log.exception("Failed to claim orphan %s for user %s", orphan_id, real_id)
            await interaction.response.send_message(
                "Something went wrong claiming your record. Please try again.", ephemeral=True
            )
            return

        # Refresh IDs after claim and show the normal manage view
        ids = await self.bot.db.get_identifiers(guild_id, real_id, self.whitelist_id)
        edit_view = _EditIDsView(self.bot, self.whitelist_type, self.whitelist_id, self.slots, ids)

        if ids:
            id_lines = [f"`{i}.` `{v}`" for i, (_, v, *_) in enumerate(ids, 1)]
            for i in range(len(ids) + 1, self.slots + 1):
                id_lines.append(f"`{i}.` *— empty —*")
            ids_text = "\n".join(id_lines)
        else:
            ids_text = "\n".join(f"`{i}.` *— empty —*" for i in range(1, self.slots + 1))

        embed = discord.Embed(
            title="✅ Record Linked!",
            description="Your existing record has been linked to your Discord account.",
            color=0x22C55E,
        )
        embed.add_field(name="Slots", value=f"{len(ids)} / {self.slots} used", inline=True)
        embed.add_field(name="Your IDs", value=ids_text, inline=False)
        embed.set_footer(text="Use Edit to add or update your IDs")
        await interaction.response.edit_message(embed=embed, view=edit_view)

    @discord.ui.button(label="No, start fresh", style=discord.ButtonStyle.secondary, emoji="➡️")
    async def claim_no(self, interaction: discord.Interaction, button: discord.ui.Button):
        """User says this isn't them — open the normal ID modal."""
        await interaction.response.send_modal(
            IdentifierModal(self.bot, self.whitelist_type, self.slots, [])
        )


class WhitelistPanelView(discord.ui.View):
    """Persistent panel view with interactive buttons for members and managers."""

    def __init__(self, bot, whitelist_type: str, whitelist_id: int = None):
        super().__init__(timeout=None)
        self.bot = bot
        self.whitelist_type = whitelist_type
        self.whitelist_id = whitelist_id

        # Row 0: Member button + Manager button side by side
        manage_wl_btn = discord.ui.Button(
            label="Manage Whitelist",
            style=discord.ButtonStyle.green,
            emoji="🛡️",
            custom_id=f"panel:submit:{whitelist_type}",
            row=0,
        )
        manage_wl_btn.callback = self._manage_whitelist_callback
        self.add_item(manage_wl_btn)

        verify_btn = discord.ui.Button(
            label="Link ID",
            style=discord.ButtonStyle.primary,
            emoji="🔗",
            custom_id=f"panel:verify:{whitelist_type}",
            row=0,
        )
        verify_btn.callback = lambda i: _panel_verify_callback(self.bot, self.whitelist_type, self.whitelist_id, i)
        self.add_item(verify_btn)

        manage_btn = discord.ui.Button(
            label="Manager Tools",
            style=discord.ButtonStyle.secondary,
            emoji="⚙️",
            custom_id=f"panel:manage:{whitelist_type}",
            row=0,
        )
        manage_btn.callback = lambda i: _panel_manage_callback(self.bot, self.whitelist_type, i)
        self.add_item(manage_btn)

    async def _manage_whitelist_callback(self, interaction: discord.Interaction):
        """Show user's whitelist info with an Edit button to modify their IDs."""
        await interaction.response.defer(ephemeral=True)
        try:
            guild_id = interaction.guild.id
            wl = await self.bot.db.get_whitelist_by_slug(guild_id, self.whitelist_type)
            if not wl:
                await interaction.followup.send("Whitelist not found.", ephemeral=True)
                return
            wl_id = wl["id"]
            member = interaction.guild.get_member(interaction.user.id)
            ids = await self.bot.db.get_identifiers(guild_id, interaction.user.id, wl_id)

            # Always recalculate slots from current roles
            panels = await self.bot.db.get_panels(guild_id)
            panel = next((p for p in panels if p.get("whitelist_id") == wl_id and p.get("enabled")), None)
            slots, plan = await self.bot.calculate_user_slots(guild_id, member, wl_id, wl=wl, panel=panel)

            if slots <= 0 and not ids:
                await interaction.followup.send(
                    "You don't have a whitelist role. Contact your server admin to get access.",
                    ephemeral=True,
                )
                return

            # First-time user with no IDs — check for an orphan record that matches their name
            has_record = await self.bot.db.get_user_record(guild_id, interaction.user.id, wl_id)
            if not has_record and not ids:
                orphan = await _find_orphan_candidate(
                    self.bot.db, guild_id, wl_id, member.display_name if member else interaction.user.display_name
                )
                if orphan:
                    orphan_id, orphan_name = orphan[0], orphan[1]
                    orphan_ids = await self.bot.db.get_identifiers(guild_id, orphan_id, wl_id)

                    id_lines = [f"`{v}`" for _, v, *_ in orphan_ids] if orphan_ids else ["*No IDs on file*"]
                    embed = discord.Embed(
                        title="🔍 We found a record that may be yours",
                        description=(
                            f"A record exists under the name **{orphan_name}** that closely matches yours.\n\n"
                            f"**Saved IDs:**\n" + "\n".join(id_lines) + "\n\n"
                            f"Is this your record?"
                        ),
                        color=0xF97316,
                    )
                    embed.set_footer(text="Selecting 'No' will start a fresh registration")
                    claim_view = _ClaimOrphanView(self.bot, self.whitelist_type, wl_id, orphan_id, slots, orphan_ids)
                    await interaction.followup.send(embed=embed, view=claim_view, ephemeral=True)
                    return

            role_names = _parse_role_names(plan)
            role_display = "\n".join(f"• {r}" for r in role_names) if role_names else "—"
            embed = discord.Embed(title=f"My {wl['name']} Whitelist", color=0xF97316)
            embed.add_field(name="Role" + ("s" if len(role_names) > 1 else ""), value=role_display, inline=True)
            embed.add_field(name="Slots", value=f"{len(ids)} / {slots} used", inline=True)

            # Resolve Steam names for display
            from bot.utils import resolve_steam_names
            steam64_ids = [v for t, v, *_ in ids if t == "steam64"]
            steam_names = await resolve_steam_names(steam64_ids, db=self.bot.db)

            if ids:
                id_lines = []
                for i, (t, v, *_) in enumerate(ids, 1):
                    label = "Steam64" if t == "steam64" else "EOS"
                    name = steam_names.get(v, "")
                    name_str = f" — **{name}**" if name else ""
                    id_lines.append(f"`{i}.` `{v}`{name_str}")

                # Show empty slots
                for i in range(len(ids) + 1, slots + 1):
                    id_lines.append(f"`{i}.` *— empty —*")
                embed.add_field(name="Your IDs", value="\n".join(id_lines), inline=False)
            else:
                empty_lines = [f"`{i}.` *— empty —*" for i in range(1, slots + 1)]
                embed.add_field(name="Your Slots", value="\n".join(empty_lines), inline=False)

            embed.set_footer(text=f"Use Edit to modify a slot or Add to fill empty ones • {_DASHBOARD_URL.replace('https://', '')}")

            # Add Edit (opens full modal) and slot selector for individual edits
            edit_view = _EditIDsView(self.bot, self.whitelist_type, wl_id, slots, ids)
            await interaction.followup.send(embed=embed, view=edit_view, ephemeral=True)
        except Exception:
            from bot.config import log
            log.exception("Error in manage whitelist callback for %s", interaction.user)
            try:
                await interaction.followup.send("Something went wrong. Please try again.", ephemeral=True)
            except Exception:
                pass

class _SingleSlotModal(discord.ui.Modal, title="Edit Slot"):
    """Modal for editing a single slot."""
    on_error = _modal_on_error

    def __init__(self, bot, whitelist_type: str, whitelist_id: int, slot_number: int, current_value: str, total_slots: int, all_existing: List[tuple]):
        super().__init__(timeout=300)
        self.bot = bot
        self.whitelist_type = whitelist_type
        self.whitelist_id = whitelist_id
        self.slot_number = slot_number
        self.all_existing = all_existing

        self.id_field = discord.ui.TextInput(
            label=f"Slot {slot_number} — Paste Steam64, EOS, or Profile URL",
            default=current_value,
            required=False,
            style=discord.TextStyle.short,
            placeholder="76561198xxxxxxxxx or steamcommunity.com/id/username",
            max_length=200,
        )
        self.add_item(self.id_field)

    async def on_submit(self, interaction: discord.Interaction):
        from bot.utils import split_identifier_tokens, resolve_steam_vanity
        from bot.config import STEAM64_RE, EOSID_RE

        raw = self.id_field.value.strip()

        # Build the updated ID list
        new_ids = list(self.all_existing)  # Copy existing

        if raw:
            # Parse and resolve the input
            tokens = split_identifier_tokens(raw)
            resolved = []
            for token in tokens:
                if token.startswith("vanity:"):
                    steam64 = await resolve_steam_vanity(token[7:])
                    resolved.append(steam64 if steam64 else token)
                else:
                    resolved.append(token)

            if resolved:
                val = resolved[0]
                if STEAM64_RE.fullmatch(val):
                    entry = ("steam64", val, True, "format_only")
                elif EOSID_RE.fullmatch(val.lower()):
                    entry = ("eosid", val.lower(), False, "unverified")
                else:
                    await interaction.response.send_message(f"Invalid ID format: `{val}`", ephemeral=True)
                    return

                idx = self.slot_number - 1
                if idx < len(new_ids):
                    new_ids[idx] = entry
                else:
                    new_ids.append(entry)
        else:
            # Empty = remove this slot
            idx = self.slot_number - 1
            if idx < len(new_ids):
                new_ids.pop(idx)

        guild_id = interaction.guild.id
        await self.bot.db.replace_identifiers(guild_id, interaction.user.id, self.whitelist_id, new_ids)
        await self.bot.sync_github_outputs(guild_id)
        await interaction.response.send_message(f"Slot {self.slot_number} updated!", ephemeral=True)


class _EditIDsView(discord.ui.View):
    """Ephemeral view shown after Manage Whitelist — lets user edit their IDs."""

    def __init__(self, bot, whitelist_type: str, whitelist_id: int, slots: int, existing: List[tuple]):
        super().__init__(timeout=120)
        self.bot = bot
        self.whitelist_type = whitelist_type
        self.whitelist_id = whitelist_id
        self.slots = slots
        self.existing = existing

        # Slot selector dropdown — only needed when there are multiple slots
        # Discord limits Select menus to 25 options; for >25 slots use "Edit All"
        if slots > 1 and slots <= 25:
            options = []
            for i in range(1, min(slots + 1, 26)):
                current = existing[i - 1] if i - 1 < len(existing) else None
                label = f"Slot {i}"
                desc = f"{current[1][:30]}..." if current else "Empty"
                options.append(discord.SelectOption(label=label, value=str(i), description=desc))

            select = discord.ui.Select(
                placeholder="Select a slot to edit...",
                options=options,
                custom_id="slot_select",
            )
            select.callback = self._slot_selected
            self.add_item(select)

        # Single-slot: relabel the button so it reads "Edit" instead of "Edit All"
        if slots == 1:
            self.edit_button.label = "Edit"

    async def _slot_selected(self, interaction: discord.Interaction):
        slot_num = int(interaction.data["values"][0])
        current = self.existing[slot_num - 1][1] if slot_num - 1 < len(self.existing) else ""
        await interaction.response.send_modal(
            _SingleSlotModal(self.bot, self.whitelist_type, self.whitelist_id, slot_num, current, self.slots, self.existing)
        )

    @discord.ui.button(label="Edit All", style=discord.ButtonStyle.primary, emoji="✏️", row=2)
    async def edit_button(self, interaction: discord.Interaction, button: discord.ui.Button):
        if self.slots == 1:
            # Single slot — open a direct single-slot modal, no need to pick from a list
            current = self.existing[0][1] if self.existing else ""
            await interaction.response.send_modal(
                _SingleSlotModal(self.bot, self.whitelist_type, self.whitelist_id, 1, current, self.slots, self.existing)
            )
        else:
            await interaction.response.send_modal(
                IdentifierModal(self.bot, self.whitelist_type, self.slots, self.existing)
            )

    @discord.ui.button(label="Clear All", style=discord.ButtonStyle.danger, emoji="🗑️", row=2)
    async def clear_button(self, interaction: discord.Interaction, button: discord.ui.Button):
        guild_id = interaction.guild.id
        await self.bot.db.replace_identifiers(guild_id, interaction.user.id, self.whitelist_id, [])
        await self.bot.db.audit(
            guild_id, "user_clear", interaction.user.id, interaction.user.id,
            f"Cleared all IDs from {self.whitelist_type}", self.whitelist_id,
        )
        await self.bot.sync_github_outputs(guild_id)
        await interaction.response.send_message("All your IDs have been cleared.", ephemeral=True)


async def _panel_verify_callback(bot, whitelist_type: str, whitelist_id: int, interaction: discord.Interaction):
    """Verify ID button on the panel — standalone function called from WhitelistPanelView."""
    guild_id = interaction.guild.id
    discord_id = interaction.user.id

    # Get identifiers for this whitelist
    if whitelist_id:
        ids = await bot.db.get_identifiers(guild_id, discord_id, whitelist_id)
    else:
        wl = await bot.db.get_whitelist_by_slug(guild_id, whitelist_type)
        ids = await bot.db.get_identifiers(guild_id, discord_id, wl["id"]) if wl else []

    # Also check global identifiers
    global_ids = await bot.db.fetchall(
        "SELECT id_type, id_value, is_verified FROM whitelist_identifiers WHERE guild_id=%s AND discord_id=%s AND whitelist_id IS NULL",
        (guild_id, discord_id),
    )

    unverified_steam = []
    unverified_eos = []
    for id_type, id_value, is_verified, *_ in ids:
        if not is_verified:
            if id_type == "steam64":
                unverified_steam.append(id_value)
            elif id_type == "eosid":
                unverified_eos.append(id_value)
    for row in global_ids:
        if not row[2]:
            if row[0] == "steam64":
                unverified_steam.append(row[1])
            elif row[0] == "eosid":
                unverified_eos.append(row[1])

    from bot.config import WEB_BASE_URL

    if not unverified_steam and not unverified_eos:
        if ids or global_ids:
            await interaction.response.send_message("All your IDs are already verified!", ephemeral=True)
            return

        # No IDs at all — offer direct verification options instead of redirecting
        embed = discord.Embed(
            title="Link Your Game Account",
            description=(
                "Connect your Steam or EOS account to your Discord profile so we can "
                "identify you in-game. This is required for whitelist features and player stats.\n\n"
                "**Option 1 — Steam Login** (recommended)\n"
                "Click the button below to log in with Steam. This instantly links your Steam ID.\n\n"
                "**Option 2 — Discord Connection**\n"
                "Add Steam to your Discord under **User Settings > Connections > Steam**. "
                "It links automatically next time you visit the dashboard.\n\n"
                "**Option 3 — Manual**\n"
                "Click **Manage Whitelist** to paste your Steam64 or EOS ID, then come back here to link it."
            ),
            color=discord.Color.blurple(),
        )
        view = discord.ui.View(timeout=120)
        if WEB_BASE_URL:
            view.add_item(discord.ui.Button(
                label="Link via Steam Login",
                url=f"{WEB_BASE_URL}/api/steam/verify",
                style=discord.ButtonStyle.link,
            ))
            view.add_item(discord.ui.Button(
                label="Open Dashboard",
                url=f"{WEB_BASE_URL}/my-whitelist",
                style=discord.ButtonStyle.link,
            ))
        await interaction.response.send_message(embed=embed, view=view, ephemeral=True)
        return

    embed = discord.Embed(title="Link Your IDs", color=discord.Color.blurple())

    if unverified_steam:
        verify_url = f"{WEB_BASE_URL}/api/steam/verify" if WEB_BASE_URL else ""
        embed.add_field(
            name="Unverified Steam IDs",
            value="\n".join(f"`{s}`" for s in unverified_steam) + (f"\n\n[Click here to verify via Steam Login]({verify_url})" if verify_url else ""),
            inline=False,
        )
    if unverified_eos:
        embed.add_field(
            name="Unverified EOS IDs",
            value="\n".join(f"`{e}`" for e in unverified_eos) + "\n\nUse the **Get In-Game Code** button below.",
            inline=False,
        )

    eos_pairs = [("", v) for v in unverified_eos]
    view = _VerifyView(bot, guild_id, discord_id, eos_pairs)
    await interaction.response.send_message(embed=embed, view=view, ephemeral=True)


async def _panel_manage_callback(bot, whitelist_type: str, interaction: discord.Interaction):
    """Manager tools callback — standalone function called from WhitelistPanelView."""
    if not await bot.user_is_mod(interaction.guild.id, interaction.user):
        await interaction.response.send_message("You need manager permissions to use this.", ephemeral=True)
        return
    view = ManagerMenuView(bot, whitelist_type)
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
        # Show a user select menu instead of a text modal
        view = _UserLookupView(self.bot, self.whitelist_type)
        await interaction.response.send_message("Select a member to look up:", view=view, ephemeral=True)

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


class _UserLookupView(discord.ui.View):
    """View with Discord's built-in user select menu for looking up members."""

    def __init__(self, bot, whitelist_type: str):
        super().__init__(timeout=60)
        self.bot = bot
        self.whitelist_type = whitelist_type

    @discord.ui.select(cls=discord.ui.UserSelect, placeholder="Search for a member...", min_values=1, max_values=1)
    async def user_select(self, interaction: discord.Interaction, select: discord.ui.UserSelect):
        target = select.values[0]
        target_id = target.id
        guild_id = interaction.guild.id

        wl = await self.bot.db.get_whitelist_by_slug(guild_id, self.whitelist_type)
        if not wl:
            await interaction.response.send_message("Whitelist not found.", ephemeral=True)
            return
        wl_id = wl["id"]

        row = await self.bot.db.get_user_record(guild_id, target_id, wl_id)
        ids = await self.bot.db.get_identifiers(guild_id, target_id, wl_id)

        if not row and not ids:
            # Check if user has a qualifying role
            member = interaction.guild.get_member(target_id)
            role_info = ""
            if member:
                panels = await self.bot.db.get_panels(guild_id)
                panel = next((p for p in panels if p.get("whitelist_id") == wl_id and p.get("enabled")), None)
                slots, plan = await self.bot.calculate_user_slots(guild_id, member, wl_id, wl=wl, panel=panel)
                if slots > 0:
                    role_info = f"\n\nThis user has the **{plan.split(':')[0] if ':' in plan else plan}** role ({slots} slots) but hasn't submitted any IDs yet."
            await interaction.response.send_message(f"No whitelist entry found for <@{target_id}>.{role_info}", ephemeral=True)
            return

        # Resolve Steam names
        from bot.utils import resolve_steam_names
        steam64_ids = [v for t, v, *_ in ids if t == "steam64"]
        steam_names = await resolve_steam_names(steam64_ids, db=self.bot.db)

        embed = discord.Embed(title=f"Whitelist: {target.display_name}", color=0xF97316)
        embed.set_thumbnail(url=target.display_avatar.url)
        if row:
            embed.add_field(name="Status", value=row[1], inline=True)
            embed.add_field(name="Slots", value=f"{len(ids)} / {row[3]}", inline=True)
            if row[4]:
                role_names = _parse_role_names(str(row[4]))
                role_display = "\n".join(f"• {r}" for r in role_names) if role_names else str(row[4])
                embed.add_field(name="Role" + ("s" if len(role_names) > 1 else ""), value=role_display, inline=True)
        if ids:
            id_lines = []
            for i, (t, v, *_) in enumerate(ids, 1):
                name = steam_names.get(v, "")
                name_str = f" — {name}" if name else ""
                id_lines.append(f"`{i}.` `{v}`{name_str}")
            embed.add_field(name="IDs", value="\n".join(id_lines), inline=False)
        embed.set_footer(text=f"Discord ID: {target_id}")
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


    @app_commands.command(name="verify", description="Link your Steam or EOS account to your Discord profile")
    async def verify_cmd(self, interaction: discord.Interaction):
        guild_id = interaction.guild.id
        discord_id = interaction.user.id

        # Get all whitelists and find unverified identifiers
        whitelists = await self.bot.db.get_whitelists(guild_id)
        unverified = []
        for wl in whitelists:
            ids = await self.bot.db.get_identifiers(guild_id, discord_id, wl["id"])
            for id_type, id_value, is_verified, *_ in ids:
                if not is_verified:
                    unverified.append((wl["name"], id_type, id_value))

        # Also check global identifiers (whitelist_id = NULL from auto-link)
        global_ids = await self.bot.db.fetchall(
            "SELECT id_type, id_value, is_verified FROM whitelist_identifiers WHERE guild_id=%s AND discord_id=%s AND whitelist_id IS NULL",
            (guild_id, discord_id),
        )
        for row in global_ids:
            if not row[2]:  # not verified
                unverified.append(("Global", row[0], row[1]))

        if not unverified:
            # Check if they have any IDs at all
            all_ids = []
            for wl in whitelists:
                all_ids.extend(await self.bot.db.get_identifiers(guild_id, discord_id, wl["id"]))
            if all_ids or global_ids:
                embed = discord.Embed(
                    title="All IDs Linked",
                    description="All your Steam and EOS IDs are already linked to your account!",
                    color=discord.Color.green(),
                )
                await interaction.response.send_message(embed=embed, ephemeral=True)
            else:
                embed = discord.Embed(
                    title="No IDs Found",
                    description="You haven't submitted any Steam or EOS IDs yet.\nUse `/whitelist` or the whitelist panel to add your IDs first.",
                    color=discord.Color.yellow(),
                )
                await interaction.response.send_message(embed=embed, ephemeral=True)
            return

        from bot.config import WEB_BASE_URL
        embed = discord.Embed(
            title="Verify Your IDs",
            description="Choose how to verify your unverified IDs:",
            color=discord.Color.blurple(),
        )

        steam_ids = [(wl, v) for wl, t, v in unverified if t == "steam64"]
        eos_ids = [(wl, v) for wl, t, v in unverified if t == "eosid"]

        if steam_ids:
            verify_url = f"{WEB_BASE_URL}/api/steam/verify" if WEB_BASE_URL else ""
            steam_lines = []
            for wl_name, sid in steam_ids:
                steam_lines.append(f"`{sid}`")
            embed.add_field(
                name="Steam IDs (Not Verified)",
                value="\n".join(steam_lines) + (f"\n\n[Click here to verify via Steam Login]({verify_url})" if verify_url else "\nVisit the web dashboard to verify via Steam Login."),
                inline=False,
            )

        if eos_ids:
            embed.add_field(
                name="EOS IDs (Not Verified)",
                value="\n".join(f"`{v}`" for _, v in eos_ids) + "\n\nUse the **Verify In-Game** button below to get a temp code.\nType the code in any in-game chat to verify.",
                inline=False,
            )

        view = _VerifyView(self.bot, guild_id, discord_id, eos_ids)
        await interaction.response.send_message(embed=embed, view=view, ephemeral=True)


class _VerifyView(discord.ui.View):
    """View with buttons for verification methods."""
    def __init__(self, bot, guild_id: int, discord_id: int, eos_ids: list):
        super().__init__(timeout=120)
        self.bot = bot
        self.guild_id = guild_id
        self.discord_id = discord_id
        self.eos_ids = eos_ids

        from bot.config import WEB_BASE_URL
        if WEB_BASE_URL:
            self.add_item(discord.ui.Button(
                label="Link via Steam Login",
                url=f"{WEB_BASE_URL}/api/steam/verify",
                style=discord.ButtonStyle.link,
                row=0,
            ))

        if eos_ids:
            btn = discord.ui.Button(
                label="Get In-Game Code",
                style=discord.ButtonStyle.primary,
                custom_id="verify_ingame_code",
                row=0,
            )
            btn.callback = self._generate_code
            self.add_item(btn)

    async def _generate_code(self, interaction: discord.Interaction):
        import aiohttp
        from bot.config import WEB_INTERNAL_URL, BOT_INTERNAL_SECRET

        if not self.eos_ids:
            await interaction.response.send_message("No EOS IDs to verify.", ephemeral=True)
            return

        # Generate a code for the first unverified EOS ID
        wl_name, eos_id = self.eos_ids[0]
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    f"{WEB_INTERNAL_URL}/api/internal/verify/create-code",
                    json={
                        "guild_id": str(self.guild_id),
                        "discord_id": str(self.discord_id),
                        "id_type": "eosid",
                        "id_value": eos_id,
                    },
                    headers={"x-bot-secret": BOT_INTERNAL_SECRET},
                    timeout=aiohttp.ClientTimeout(total=5),
                ) as resp:
                    if resp.status != 200:
                        await interaction.response.send_message("Failed to generate code. Try again later.", ephemeral=True)
                        return
                    data = await resp.json()
        except Exception:
            await interaction.response.send_message("Failed to contact the API. Try again later.", ephemeral=True)
            return

        code = data["code"]
        embed = discord.Embed(
            title="In-Game Verification Code",
            description=(
                f"Your verification code is:\n\n"
                f"# `{code}`\n\n"
                f"**Type this code in any in-game chat** (All, Team, or Squad) within 10 minutes.\n\n"
                f"This will verify your EOS ID: `{eos_id}`"
            ),
            color=discord.Color.blurple(),
        )
        embed.set_footer(text="Code expires in 10 minutes")
        await interaction.response.send_message(embed=embed, ephemeral=True)


async def setup(bot):
    await bot.add_cog(WhitelistCog(bot))
