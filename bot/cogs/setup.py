import discord
from discord import app_commands
from discord.ext import commands
from typing import List

from bot.config import WHITELIST_FILENAME, SQUAD_PERMISSIONS, WHITELIST_TYPES, log
from bot.utils import _view_on_error, _modal_on_error


# ─── Filename modal (only used for text that can't be a dropdown) ─────────────

class FilenameModal(discord.ui.Modal):
    on_error = _modal_on_error

    def __init__(self, bot, setting_key: str, current_value: str, label: str):
        super().__init__(title=f"Edit {label}", timeout=120)
        self.bot = bot
        self.setting_key = setting_key
        self.label = label
        self.filename = discord.ui.TextInput(label=label, default=current_value, max_length=255, required=True)
        self.add_item(self.filename)

    async def on_submit(self, interaction: discord.Interaction):
        guild_id = interaction.guild.id
        value = self.filename.value.strip()
        if not value:
            await interaction.response.send_message("Filename cannot be empty.", ephemeral=True)
            return
        await self.bot.db.set_setting(guild_id, self.setting_key, value)
        await self.bot.db.audit(guild_id, "setup_global", interaction.user.id, None, f"{self.setting_key}={value}")
        await interaction.response.send_message(f"{self.label} set to `{value}`.", ephemeral=True)


class TypeFilenameModal(discord.ui.Modal):
    on_error = _modal_on_error

    def __init__(self, bot, whitelist_type: str, current_value: str):
        super().__init__(title=f"{whitelist_type.title()} GitHub Filename", timeout=120)
        self.bot = bot
        self.whitelist_type = whitelist_type
        self.filename = discord.ui.TextInput(label="GitHub filename", default=current_value, max_length=255, required=True)
        self.add_item(self.filename)

    async def on_submit(self, interaction: discord.Interaction):
        guild_id = interaction.guild.id
        value = self.filename.value.strip()
        if not value:
            await interaction.response.send_message("Filename cannot be empty.", ephemeral=True)
            return
        await self.bot.db.set_type_config(guild_id, self.whitelist_type, github_filename=value)
        await self.bot.db.audit(guild_id, "setup_type", interaction.user.id, None, f"type={self.whitelist_type} github_filename={value}", self.whitelist_type)
        await interaction.response.send_message(f"GitHub filename set to `{value}`.", ephemeral=True)


class SlotLimitModal(discord.ui.Modal):
    on_error = _modal_on_error

    def __init__(self, bot, whitelist_type: str, role_id: int, role_name: str):
        super().__init__(title=f"Slot Limit for {role_name[:30]}", timeout=120)
        self.bot = bot
        self.whitelist_type = whitelist_type
        self.role_id = role_id
        self.role_name = role_name
        self.slots = discord.ui.TextInput(label="Number of whitelist slots", placeholder="e.g. 4", max_length=10, required=True)
        self.add_item(self.slots)

    async def on_submit(self, interaction: discord.Interaction):
        guild_id = interaction.guild.id
        try:
            slot_limit = int(self.slots.value.strip())
        except ValueError:
            await interaction.response.send_message("Slot limit must be a number.", ephemeral=True)
            return
        if slot_limit < 1:
            await interaction.response.send_message("Slot limit must be at least 1.", ephemeral=True)
            return
        wl = await self.bot.db.get_whitelist_by_slug(guild_id, self.whitelist_type)
        if not wl:
            await interaction.response.send_message(f"Whitelist `{self.whitelist_type}` not found.", ephemeral=True)
            return
        panels = await self.bot.db.fetchall(
            "SELECT id FROM panels WHERE guild_id=%s AND enabled=TRUE LIMIT 1",
            (guild_id,),
        )
        if not panels:
            await interaction.response.send_message("No enabled panel found. Create a panel first.", ephemeral=True)
            return
        panel_id = int(panels[0][0])
        await self.bot.db.add_panel_role(guild_id, panel_id, self.role_id, self.role_name, slot_limit)
        await self.bot.db.audit(guild_id, "setup_rolemap_add", interaction.user.id, None, f"type={self.whitelist_type} role={self.role_name}({self.role_id}) slots={slot_limit}", self.whitelist_type)
        await interaction.response.send_message(f"Mapped **{self.role_name}** to **{slot_limit}** slot(s) for {self.whitelist_type}.", ephemeral=True)


# ─── Setup: Group Management ──────────────────────────────────────────────────

class CreateGroupModal(discord.ui.Modal, title="Create Squad Group"):
    on_error = _modal_on_error

    def __init__(self, bot):
        super().__init__(timeout=120)
        self.bot = bot
        self.group_name = discord.ui.TextInput(label="Group Name", placeholder="e.g. Whitelist, Staff, VIP", max_length=100, required=True)
        self.add_item(self.group_name)

    async def on_submit(self, interaction: discord.Interaction):
        guild_id = interaction.guild.id
        name = self.group_name.value.strip()
        if not name or not name.replace("_", "").replace("-", "").isalnum():
            await interaction.response.send_message("Group name must be alphanumeric (dashes/underscores OK).", ephemeral=True)
            return
        existing = await self.bot.db.get_squad_group(guild_id, name)
        if existing:
            await interaction.response.send_message(f"Group **{name}** already exists.", ephemeral=True)
            return
        await self.bot.db.upsert_squad_group(guild_id, name, "reserve")
        await self.bot.db.audit(guild_id, "group_create", interaction.user.id, None, f"group={name}")
        await interaction.response.send_message(f"Created group **{name}** with default `reserve` permission. Use **Edit Permissions** to change.", ephemeral=True)


class EditGroupPermsView(discord.ui.View):
    """Dynamic view showing permission checkboxes for a specific group."""
    on_error = _view_on_error

    def __init__(self, bot, group_name: str, current_perms: str):
        super().__init__(timeout=300)
        self.bot = bot
        self.group_name = group_name
        current_set = {p.strip() for p in current_perms.split(",") if p.strip()}
        # Build options from all known permissions (max 25 in a select)
        options = []
        for perm, desc in SQUAD_PERMISSIONS.items():
            options.append(discord.SelectOption(
                label=perm,
                value=perm,
                description=desc[:100],
                default=perm in current_set,
            ))
        select = discord.ui.Select(
            placeholder="Select permissions for this group",
            options=options,
            min_values=1,
            max_values=len(options),
        )
        select.callback = self._on_select
        self.add_item(select)

    async def _on_select(self, interaction: discord.Interaction):
        guild_id = interaction.guild.id
        perms = ",".join(sorted(interaction.data["values"]))
        await self.bot.db.upsert_squad_group(guild_id, self.group_name, perms)
        await self.bot.db.audit(guild_id, "group_edit_perms", interaction.user.id, None, f"group={self.group_name} perms={perms}")
        await interaction.response.send_message(f"**{self.group_name}** permissions updated to: `{perms}`", ephemeral=True)


class GroupManagementView(discord.ui.View):
    on_error = _view_on_error

    def __init__(self, bot, *, hub_view: "MainSetupView" = None):
        super().__init__(timeout=300)
        self.bot = bot
        self.hub_view = hub_view

    async def _build_embed(self, guild: discord.Guild) -> discord.Embed:
        guild_id = guild.id
        groups = await self.bot.db.get_squad_groups(guild_id)
        lines = []
        if groups:
            for name, perms, is_default in groups:
                tag = " *(default)*" if is_default else ""
                lines.append(f"**{name}**{tag}\n`{perms}`")
        # Show which types are assigned to which groups
        assignments = []
        for wt in WHITELIST_TYPES:
            cfg = await self.bot.db.get_type_config(guild_id, wt)
            if cfg:
                assignments.append(f"{wt.title()} \u2192 `{cfg.get('squad_group', 'Whitelist')}`")
        e = discord.Embed(
            title="\U0001f396\ufe0f Squad Group Management",
            description="\n\n".join(lines) if lines else "No groups configured.",
            color=discord.Color.dark_gold(),
        )
        if assignments:
            e.add_field(name="Type Assignments", value="\n".join(assignments), inline=False)
        e.set_footer(text="Groups define the permission set in RemoteAdminList output")
        return e

    @discord.ui.button(label="Create Group", style=discord.ButtonStyle.green, row=0)
    async def create_btn(self, interaction: discord.Interaction, button: discord.ui.Button):
        await interaction.response.send_modal(CreateGroupModal(self.bot))

    @discord.ui.button(label="Edit Permissions", style=discord.ButtonStyle.blurple, row=0)
    async def edit_btn(self, interaction: discord.Interaction, button: discord.ui.Button):
        guild_id = interaction.guild.id
        groups = await self.bot.db.get_squad_groups(guild_id)
        if not groups:
            await interaction.response.send_message("No groups to edit.", ephemeral=True)
            return
        options = [discord.SelectOption(label=name, value=name, description=perms[:100]) for name, perms, _ in groups]
        view = discord.ui.View(timeout=120)
        select = discord.ui.Select(placeholder="Select group to edit", options=options)

        async def _on_group_select(sel_interaction: discord.Interaction):
            gid = sel_interaction.guild.id
            gname = sel_interaction.data["values"][0]
            group = await self.bot.db.get_squad_group(gid, gname)
            if not group:
                await sel_interaction.response.send_message("Group not found.", ephemeral=True)
                return
            await sel_interaction.response.send_message(
                f"Select permissions for **{gname}**:",
                view=EditGroupPermsView(self.bot, gname, group[1]),
                ephemeral=True,
            )

        select.callback = _on_group_select
        view.add_item(select)
        await interaction.response.send_message("Select a group to edit:", view=view, ephemeral=True)

    @discord.ui.button(label="Delete Group", style=discord.ButtonStyle.red, row=0)
    async def delete_btn(self, interaction: discord.Interaction, button: discord.ui.Button):
        guild_id = interaction.guild.id
        groups = await self.bot.db.get_squad_groups(guild_id)
        deletable = [(name, perms) for name, perms, is_default in groups if not is_default]
        if not deletable:
            await interaction.response.send_message("No deletable groups (default groups cannot be removed).", ephemeral=True)
            return
        options = [discord.SelectOption(label=name, value=name, description=perms[:100]) for name, perms in deletable]
        view = discord.ui.View(timeout=120)
        select = discord.ui.Select(placeholder="Select group to delete", options=options)

        async def _on_delete_select(sel_interaction: discord.Interaction):
            gid = sel_interaction.guild.id
            gname = sel_interaction.data["values"][0]
            await self.bot.db.delete_squad_group(gid, gname)
            await self.bot.db.audit(gid, "group_delete", sel_interaction.user.id, None, f"group={gname}")
            await sel_interaction.response.send_message(f"Deleted group **{gname}**.", ephemeral=True)

        select.callback = _on_delete_select
        view.add_item(select)
        await interaction.response.send_message("Select a group to delete:", view=view, ephemeral=True)

    @discord.ui.button(label="Assign to Type", style=discord.ButtonStyle.gray, row=1)
    async def assign_btn(self, interaction: discord.Interaction, button: discord.ui.Button):
        guild_id = interaction.guild.id
        groups = await self.bot.db.get_squad_groups(guild_id)
        if not groups:
            await interaction.response.send_message("Create a group first.", ephemeral=True)
            return
        # Build type selector
        type_options = []
        for wt in WHITELIST_TYPES:
            cfg = await self.bot.db.get_type_config(guild_id, wt)
            if cfg and cfg["enabled"]:
                current = cfg.get("squad_group", "Whitelist")
                type_options.append(discord.SelectOption(label=wt.title(), value=wt, description=f"Currently: {current}"))
        if not type_options:
            await interaction.response.send_message("No enabled whitelist types to assign.", ephemeral=True)
            return
        group_options = [
            discord.SelectOption(label=name, value=name, description=f"Perms: {perms[:80]}")
            for name, perms, _ in groups
        ]
        view = discord.ui.View(timeout=120)
        type_select = discord.ui.Select(placeholder="Select whitelist type", options=type_options, row=0)
        group_select = discord.ui.Select(placeholder="Select group to assign", options=group_options, row=1)
        chosen = {}

        async def _on_type(sel_interaction: discord.Interaction):
            chosen["type"] = sel_interaction.data["values"][0]
            await sel_interaction.response.defer()

        async def _on_group(sel_interaction: discord.Interaction):
            gid = sel_interaction.guild.id
            wt = chosen.get("type")
            if not wt:
                await sel_interaction.response.send_message("Select a whitelist type first.", ephemeral=True)
                return
            gname = sel_interaction.data["values"][0]
            await self.bot.db.set_type_config(gid, wt, squad_group=gname)
            await self.bot.db.audit(gid, "setup_type", sel_interaction.user.id, None, f"type={wt} squad_group={gname}", wt)
            await sel_interaction.response.send_message(f"**{wt.title()}** now uses group **{gname}**.", ephemeral=True)

        type_select.callback = _on_type
        group_select.callback = _on_group
        view.add_item(type_select)
        view.add_item(group_select)
        await interaction.response.send_message("Assign a group to a whitelist type:", view=view, ephemeral=True)

    @discord.ui.button(label="Refresh", style=discord.ButtonStyle.secondary, row=2, emoji="\U0001f504")
    async def refresh_btn(self, interaction: discord.Interaction, button: discord.ui.Button):
        embed = await self._build_embed(interaction.guild)
        await interaction.response.edit_message(embed=embed, view=self)

    @discord.ui.button(label="Back", style=discord.ButtonStyle.secondary, row=2, emoji="\U0001f519")
    async def back_btn(self, interaction: discord.Interaction, button: discord.ui.Button):
        if self.hub_view:
            embed = await self.hub_view._build_hub_embed(interaction.guild)
            await interaction.response.edit_message(embed=embed, view=self.hub_view)
        else:
            await interaction.response.defer()


# ─── Setup: Main Hub ─────────────────────────────────────────────────────────

class MainSetupView(discord.ui.View):
    on_error = _view_on_error

    def __init__(self, bot):
        super().__init__(timeout=600)
        self.bot = bot

    async def _build_hub_embed(self, guild: discord.Guild) -> discord.Embed:
        guild_id = guild.id
        from bot.config import SSL_CERT_PATH, WEB_PORT
        output_mode = await self.bot.db.get_setting(guild_id, "output_mode", "combined")
        combined_fn = await self.bot.db.get_setting(guild_id, "combined_filename", WHITELIST_FILENAME)
        retention = await self.bot.db.get_setting(guild_id, "retention_days", "90")
        frequency = await self.bot.db.get_setting(guild_id, "report_frequency", "weekly")
        mod_role_id = int((await self.bot.db.get_setting(guild_id, "mod_role_id", "")) or 0)
        mod_role_text = f"<@&{mod_role_id}>" if mod_role_id else "`Not set`"

        # Web server status
        if self.bot.web and self.bot.web.runner:
            proto = "https" if SSL_CERT_PATH else "http"
            web_text = f"`{proto}://...:{WEB_PORT}`"
        else:
            web_text = "`Off`"

        desc_lines = [
            f"\u2699\ufe0f **Global Settings**",
            f"\u2003Mod Role: {mod_role_text}",
            f"\u2003Output: `{output_mode}` \u2192 `{combined_fn}`",
            f"\u2003Reports: `{frequency}` \u2502 Retention: `{retention}` days \u2502 Web: {web_text}",
            "",
        ]

        for wt in WHITELIST_TYPES:
            cfg = await self.bot.db.get_type_config(guild_id, wt)
            if not cfg:
                continue
            icon = "\u2705" if cfg["enabled"] else "\u274c"
            panel_ch = f"<#{cfg['panel_channel_id']}>" if cfg["panel_channel_id"] else "`Not set`"
            log_ch = f"<#{cfg['log_channel_id']}>" if cfg["log_channel_id"] else "`Not set`"
            gh_icon = "\u2705" if cfg["github_enabled"] else "\u274c"
            wl = await self.bot.db.get_whitelist_by_slug(guild_id, wt)
            panel_rows_hub = await self.bot.db.fetchall(
                "SELECT id FROM panels WHERE guild_id=%s AND whitelist_id=%s AND enabled=TRUE LIMIT 1",
                (guild_id, wl["id"] if wl else -1),
            ) if wl else []
            if panel_rows_hub:
                mappings = await self.bot.db.get_panel_roles(guild_id, int(panel_rows_hub[0][0]))
            else:
                mappings = []
            # tuple: (id, role_id, role_name, slot_limit, display_name, sort_order, is_active, is_stackable)
            active_roles = [f"<@&{r[1]}>=`{r[3]}`" for r in mappings if r[6]]
            roles_text = ", ".join(active_roles) if active_roles else "`None`"
            desc_lines.append(f"\U0001f4e6 **{wt.title()}** \u2014 {icon} Enabled")
            desc_lines.append(f"\u2003Panel: {panel_ch} \u2502 Log: {log_ch} \u2502 GitHub: {gh_icon} `{cfg['github_filename']}`")
            desc_lines.append(f"\u2003Slots: `{cfg['default_slot_limit']}` \u2502 Stack: `{'Yes' if cfg['stack_roles'] else 'No'}` \u2502 Group: `{cfg.get('squad_group', 'Whitelist')}`")
            desc_lines.append(f"\u2003Roles: {roles_text}")
            desc_lines.append("")

        # Squad groups summary
        groups = await self.bot.db.get_squad_groups(guild_id)
        if groups:
            group_parts = [f"`{n}` ({p})" for n, p, _ in groups]
            desc_lines.append(f"\U0001f396\ufe0f **Groups:** {', '.join(group_parts)}")
        else:
            desc_lines.append(f"\U0001f396\ufe0f **Groups:** `None configured`")

        e = discord.Embed(
            title="\U0001f4cb Setup Hub",
            description="\n".join(desc_lines),
            color=discord.Color.blurple(),
        )
        e.set_footer(text="Select a section below to configure.")
        return e

    # ── Row 0: Section navigation ──

    @discord.ui.button(label="Global", style=discord.ButtonStyle.blurple, row=0, emoji="\u2699\ufe0f")
    async def global_btn(self, interaction: discord.Interaction, button: discord.ui.Button):
        view = GlobalSettingsView(self.bot, hub_view=self)
        embed = await view._build_embed(interaction.guild)
        await interaction.response.edit_message(embed=embed, view=view)

    @discord.ui.button(label="Subscription", style=discord.ButtonStyle.gray, row=0, emoji="\U0001f4e6")
    async def subscription_btn(self, interaction: discord.Interaction, button: discord.ui.Button):
        view = TypeSettingsView(self.bot, "subscription", hub_view=self)
        embed = await view._build_embed(interaction.guild)
        await interaction.response.edit_message(embed=embed, view=view)

    @discord.ui.button(label="Clan", style=discord.ButtonStyle.gray, row=0, emoji="\U0001f4e6")
    async def clan_btn(self, interaction: discord.Interaction, button: discord.ui.Button):
        view = TypeSettingsView(self.bot, "clan", hub_view=self)
        embed = await view._build_embed(interaction.guild)
        await interaction.response.edit_message(embed=embed, view=view)

    @discord.ui.button(label="Staff", style=discord.ButtonStyle.gray, row=0, emoji="\U0001f6e1\ufe0f")
    async def staff_btn(self, interaction: discord.Interaction, button: discord.ui.Button):
        view = TypeSettingsView(self.bot, "staff", hub_view=self)
        embed = await view._build_embed(interaction.guild)
        await interaction.response.edit_message(embed=embed, view=view)

    @discord.ui.button(label="Groups", style=discord.ButtonStyle.green, row=1, emoji="\U0001f396\ufe0f")
    async def groups_btn(self, interaction: discord.Interaction, button: discord.ui.Button):
        view = GroupManagementView(self.bot, hub_view=self)
        embed = await view._build_embed(interaction.guild)
        await interaction.response.edit_message(embed=embed, view=view)

    # ── Row 1: Utility buttons ──

    @discord.ui.button(label="Refresh", emoji="\U0001f504", style=discord.ButtonStyle.secondary, row=1)
    async def refresh_btn(self, interaction: discord.Interaction, button: discord.ui.Button):
        embed = await self._build_hub_embed(interaction.guild)
        await interaction.response.edit_message(embed=embed, view=self)

    @discord.ui.button(label="Done", style=discord.ButtonStyle.red, row=1)
    async def done_btn(self, interaction: discord.Interaction, button: discord.ui.Button):
        await interaction.response.edit_message(content="Setup closed.", view=None, embed=None)


# ─── Setup: Global Settings (dropdowns) ──────────────────────────────────────

class GlobalSettingsView(discord.ui.View):
    on_error = _view_on_error

    def __init__(self, bot, *, hub_view: "MainSetupView" = None):
        super().__init__(timeout=300)
        self.bot = bot
        self.hub_view = hub_view

    async def _build_embed(self, guild: discord.Guild = None) -> discord.Embed:
        guild_id = guild.id if guild else None
        output_mode = await self.bot.db.get_setting(guild_id, "output_mode", "combined")
        combined_fn = await self.bot.db.get_setting(guild_id, "combined_filename", WHITELIST_FILENAME)
        retention = await self.bot.db.get_setting(guild_id, "retention_days", "90")
        frequency = await self.bot.db.get_setting(guild_id, "report_frequency", "weekly")
        mod_role_id = int((await self.bot.db.get_setting(guild_id, "mod_role_id", "")) or 0)
        mod_role_text = f"<@&{mod_role_id}>" if mod_role_id else "`Not set`"
        e = discord.Embed(
            title="\u2699\ufe0f Global Settings",
            description=(
                f"**Mod Role:** {mod_role_text}\n"
                f"**Output Mode:** `{output_mode}` \u2192 `{combined_fn}`\n"
                f"**Report Frequency:** `{frequency}`\n"
                f"**Retention Period:** `{retention}` days\n\n"
                "Use the dropdowns below to change settings."
            ),
            color=discord.Color.blurple(),
        )
        return e

    @discord.ui.select(
        placeholder="Output Mode",
        options=[
            discord.SelectOption(label="Combined", value="combined", description="One file with all whitelisted IDs"),
            discord.SelectOption(label="Separate", value="separate", description="Separate files per type (sub/clan)"),
            discord.SelectOption(label="Hybrid", value="hybrid", description="Combined + separate files"),
        ],
        row=0,
    )
    async def output_mode_select(self, interaction: discord.Interaction, select: discord.ui.Select):
        guild_id = interaction.guild.id
        mode = select.values[0]
        await self.bot.db.set_setting(guild_id, "output_mode", mode)
        await self.bot.db.audit(guild_id, "setup_global", interaction.user.id, None, f"output_mode={mode}")
        embed = await self._build_embed(interaction.guild)
        await interaction.response.edit_message(embed=embed, view=self)

    @discord.ui.select(
        placeholder="Report Frequency",
        options=[
            discord.SelectOption(label="Disabled", value="disabled", description="No automatic reports"),
            discord.SelectOption(label="Daily", value="daily", description="Report every day"),
            discord.SelectOption(label="Weekly", value="weekly", description="Report every Monday"),
        ],
        row=1,
    )
    async def report_freq_select(self, interaction: discord.Interaction, select: discord.ui.Select):
        guild_id = interaction.guild.id
        freq = select.values[0]
        await self.bot.db.set_setting(guild_id, "report_frequency", freq)
        await self.bot.db.audit(guild_id, "setup_global", interaction.user.id, None, f"report_frequency={freq}")
        embed = await self._build_embed(interaction.guild)
        await interaction.response.edit_message(embed=embed, view=self)

    @discord.ui.select(
        placeholder="Retention Period",
        options=[
            discord.SelectOption(label="30 days", value="30"),
            discord.SelectOption(label="60 days", value="60"),
            discord.SelectOption(label="90 days", value="90", description="Default"),
            discord.SelectOption(label="180 days", value="180"),
            discord.SelectOption(label="365 days", value="365"),
        ],
        row=2,
    )
    async def retention_select(self, interaction: discord.Interaction, select: discord.ui.Select):
        guild_id = interaction.guild.id
        days = select.values[0]
        await self.bot.db.set_setting(guild_id, "retention_days", days)
        await self.bot.db.audit(guild_id, "setup_global", interaction.user.id, None, f"retention_days={days}")
        embed = await self._build_embed(interaction.guild)
        await interaction.response.edit_message(embed=embed, view=self)

    @discord.ui.select(
        cls=discord.ui.RoleSelect,
        placeholder="Set Moderator Role",
        row=3,
    )
    async def mod_role_select(self, interaction: discord.Interaction, select: discord.ui.RoleSelect):
        guild_id = interaction.guild.id
        role = select.values[0]
        await self.bot.db.set_setting(guild_id, "mod_role_id", str(role.id))
        await self.bot.db.audit(guild_id, "setup_mod_role", interaction.user.id, None, f"mod_role_id={role.id}")
        embed = await self._build_embed(interaction.guild)
        await interaction.response.edit_message(embed=embed, view=self)

    @discord.ui.button(label="Edit Combined Filename", style=discord.ButtonStyle.secondary, row=4)
    async def filename_btn(self, interaction: discord.Interaction, button: discord.ui.Button):
        guild_id = interaction.guild.id
        current = await self.bot.db.get_setting(guild_id, "combined_filename", WHITELIST_FILENAME)
        await interaction.response.send_modal(FilenameModal(self.bot, "combined_filename", current, "Combined Filename"))

    @discord.ui.button(label="Back", style=discord.ButtonStyle.secondary, row=4, emoji="\U0001f519")
    async def back_btn(self, interaction: discord.Interaction, button: discord.ui.Button):
        if self.hub_view:
            embed = await self.hub_view._build_hub_embed(interaction.guild)
            await interaction.response.edit_message(embed=embed, view=self.hub_view)
        else:
            await interaction.response.defer()


# ─── Setup: Type Settings (subscription / clan / staff) ───────────────────────

class TypeSettingsView(discord.ui.View):
    """Per-type settings: toggles on row 0, channels on rows 1-2, actions on row 3, slots on row 4."""
    on_error = _view_on_error

    def __init__(self, bot, whitelist_type: str, *, hub_view: "MainSetupView" = None):
        super().__init__(timeout=300)
        self.bot = bot
        self.whitelist_type = whitelist_type
        self.hub_view = hub_view

    async def _build_embed(self, guild: discord.Guild = None) -> discord.Embed:
        guild_id = guild.id if guild else None
        cfg = await self.bot.db.get_type_config(guild_id, self.whitelist_type)
        if not cfg:
            return discord.Embed(title=f"{self.whitelist_type.title()} Settings", description="Type not found.", color=discord.Color.red())
        icon = "\u2705" if cfg["enabled"] else "\u274c"
        gh_icon = "\u2705" if cfg["github_enabled"] else "\u274c"
        panel_ch = f"<#{cfg['panel_channel_id']}>" if cfg["panel_channel_id"] else "`Not set`"
        log_ch = f"<#{cfg['log_channel_id']}>" if cfg["log_channel_id"] else "`Not set`"
        wl = await self.bot.db.get_whitelist_by_slug(guild_id, self.whitelist_type)
        panel_rows = await self.bot.db.fetchall(
            "SELECT id FROM panels WHERE guild_id=%s AND whitelist_id=%s AND enabled=TRUE LIMIT 1",
            (guild_id, wl["id"] if wl else -1),
        ) if wl else []
        if panel_rows:
            mappings = await self.bot.db.get_panel_roles(guild_id, int(panel_rows[0][0]))
        else:
            mappings = []
        # tuple: (id, role_id, role_name, slot_limit, display_name, sort_order, is_active, is_stackable)
        active_roles = [f"<@&{r[1]}> \u2192 `{r[3]}` slots" for r in mappings if r[6]]
        roles_text = "\n".join(active_roles) if active_roles else "`No role mappings configured`"
        e = discord.Embed(
            title=f"\U0001f4e6 {self.whitelist_type.title()} Settings",
            description=(
                f"**Status:** {icon} {'Enabled' if cfg['enabled'] else 'Disabled'}\n"
                f"**GitHub:** {gh_icon} `{cfg['github_filename']}`\n"
                f"**Panel Channel:** {panel_ch}\n"
                f"**Log Channel:** {log_ch}\n"
                f"**Default Slots:** `{cfg['default_slot_limit']}` \u2502 **Stack Roles:** `{'Yes' if cfg['stack_roles'] else 'No'}`\n"
                f"**Squad Group:** `{cfg.get('squad_group', 'Whitelist')}`\n\n"
                f"**Role Mappings:**\n{roles_text}"
            ),
            color=discord.Color.green() if cfg["enabled"] else discord.Color.greyple(),
        )
        e.set_footer(text="Changes apply instantly. Use Back to return to the hub.")
        return e

    async def _refresh(self, interaction: discord.Interaction):
        embed = await self._build_embed(interaction.guild)
        await interaction.response.edit_message(embed=embed, view=self)

    # ── Row 0: Toggle buttons + filename ──

    @discord.ui.button(label="Toggle Enabled", style=discord.ButtonStyle.green, row=0)
    async def toggle_enabled(self, interaction: discord.Interaction, button: discord.ui.Button):
        guild_id = interaction.guild.id
        cfg = await self.bot.db.get_type_config(guild_id, self.whitelist_type)
        new_val = 0 if cfg["enabled"] else 1
        await self.bot.db.set_type_config(guild_id, self.whitelist_type, enabled=new_val)
        await self.bot.db.audit(guild_id, "setup_type", interaction.user.id, None, f"type={self.whitelist_type} enabled={bool(new_val)}", self.whitelist_type)
        await self._refresh(interaction)

    @discord.ui.button(label="Toggle GitHub", style=discord.ButtonStyle.gray, row=0)
    async def toggle_github(self, interaction: discord.Interaction, button: discord.ui.Button):
        guild_id = interaction.guild.id
        cfg = await self.bot.db.get_type_config(guild_id, self.whitelist_type)
        new_val = 0 if cfg["github_enabled"] else 1
        await self.bot.db.set_type_config(guild_id, self.whitelist_type, github_enabled=new_val)
        await self.bot.db.audit(guild_id, "setup_type", interaction.user.id, None, f"type={self.whitelist_type} github_enabled={bool(new_val)}", self.whitelist_type)
        await self._refresh(interaction)

    @discord.ui.button(label="Toggle Stack", style=discord.ButtonStyle.gray, row=0)
    async def toggle_stack(self, interaction: discord.Interaction, button: discord.ui.Button):
        guild_id = interaction.guild.id
        cfg = await self.bot.db.get_type_config(guild_id, self.whitelist_type)
        new_val = 0 if cfg["stack_roles"] else 1
        await self.bot.db.set_type_config(guild_id, self.whitelist_type, stack_roles=new_val)
        await self.bot.db.audit(guild_id, "setup_type", interaction.user.id, None, f"type={self.whitelist_type} stack_roles={bool(new_val)}", self.whitelist_type)
        await self._refresh(interaction)

    @discord.ui.button(label="Edit Filename", style=discord.ButtonStyle.secondary, row=0)
    async def filename_btn(self, interaction: discord.Interaction, button: discord.ui.Button):
        guild_id = interaction.guild.id
        cfg = await self.bot.db.get_type_config(guild_id, self.whitelist_type)
        await interaction.response.send_modal(TypeFilenameModal(self.bot, self.whitelist_type, cfg["github_filename"]))

    # ── Row 1: Panel channel select ──

    @discord.ui.select(
        cls=discord.ui.ChannelSelect,
        placeholder="Set Panel Channel",
        channel_types=[discord.ChannelType.text],
        row=1,
    )
    async def panel_channel_select(self, interaction: discord.Interaction, select: discord.ui.ChannelSelect):
        guild_id = interaction.guild.id
        channel = select.values[0]
        await self.bot.db.set_type_config(guild_id, self.whitelist_type, panel_channel_id=channel.id)
        await self.bot.db.audit(guild_id, "setup_channels", interaction.user.id, None, f"type={self.whitelist_type} panel={channel.id}", self.whitelist_type)
        await self._refresh(interaction)

    # ── Row 2: Log channel select ──

    @discord.ui.select(
        cls=discord.ui.ChannelSelect,
        placeholder="Set Log Channel",
        channel_types=[discord.ChannelType.text],
        row=2,
    )
    async def log_channel_select(self, interaction: discord.Interaction, select: discord.ui.ChannelSelect):
        guild_id = interaction.guild.id
        channel = select.values[0]
        await self.bot.db.set_type_config(guild_id, self.whitelist_type, log_channel_id=channel.id)
        await self.bot.db.audit(guild_id, "setup_channels", interaction.user.id, None, f"type={self.whitelist_type} log={channel.id}", self.whitelist_type)
        await self._refresh(interaction)

    # ── Row 3: Role mapping + panel + back ──

    @discord.ui.button(label="Add Role", style=discord.ButtonStyle.green, row=3)
    async def add_role_btn(self, interaction: discord.Interaction, button: discord.ui.Button):
        view = AddRoleMappingView(self.bot, self.whitelist_type)
        await interaction.response.send_message("Select a role to map:", view=view, ephemeral=True)

    @discord.ui.button(label="Remove Role", style=discord.ButtonStyle.red, row=3)
    async def remove_role_btn(self, interaction: discord.Interaction, button: discord.ui.Button):
        guild_id = interaction.guild.id
        wl = await self.bot.db.get_whitelist_by_slug(guild_id, self.whitelist_type)
        if not wl:
            await interaction.response.send_message(f"Whitelist `{self.whitelist_type}` not found.", ephemeral=True)
            return
        panel_rows_rm = await self.bot.db.fetchall(
            "SELECT id FROM panels WHERE guild_id=%s AND whitelist_id=%s AND enabled=TRUE LIMIT 1",
            (guild_id, wl["id"]),
        )
        if not panel_rows_rm:
            await interaction.response.send_message(f"No enabled panel found for `{self.whitelist_type}`.", ephemeral=True)
            return
        panel_id_rm = int(panel_rows_rm[0][0])
        # tuple: (id, role_id, role_name, slot_limit, display_name, sort_order, is_active, is_stackable)
        mappings = await self.bot.db.get_panel_roles(guild_id, panel_id_rm)
        active = [m for m in mappings if m[6]]
        if not active:
            await interaction.response.send_message(f"No {self.whitelist_type} role mappings to remove.", ephemeral=True)
            return
        await interaction.response.send_message(
            f"Select a {self.whitelist_type} role mapping to remove:",
            view=RemoveRoleMappingView(self.bot, self.whitelist_type, mappings),
            ephemeral=True,
        )

    @discord.ui.button(label="Post Panel", style=discord.ButtonStyle.blurple, row=3)
    async def panel_btn(self, interaction: discord.Interaction, button: discord.ui.Button):
        guild_id = interaction.guild.id
        await interaction.response.defer(ephemeral=True)
        posted = await self.bot.post_or_refresh_panel(interaction, guild_id, self.whitelist_type)
        if posted:
            await interaction.followup.send(f"Panel refreshed in <#{posted.channel.id}>.", ephemeral=True)
        else:
            await interaction.followup.send("Set a panel channel first.", ephemeral=True)

    @discord.ui.button(label="Back", style=discord.ButtonStyle.secondary, row=3, emoji="\U0001f519")
    async def back_btn(self, interaction: discord.Interaction, button: discord.ui.Button):
        if self.hub_view:
            embed = await self.hub_view._build_hub_embed(interaction.guild)
            await interaction.response.edit_message(embed=embed, view=self.hub_view)
        else:
            await interaction.response.defer()

    # ── Row 4: Default slot limit ──

    @discord.ui.select(
        placeholder="Default Slot Limit",
        options=[
            discord.SelectOption(label="1 slot", value="1"),
            discord.SelectOption(label="2 slots", value="2"),
            discord.SelectOption(label="3 slots", value="3"),
            discord.SelectOption(label="4 slots", value="4"),
            discord.SelectOption(label="5 slots", value="5"),
            discord.SelectOption(label="8 slots", value="8"),
            discord.SelectOption(label="10 slots", value="10"),
        ],
        row=4,
    )
    async def default_slots_select(self, interaction: discord.Interaction, select: discord.ui.Select):
        guild_id = interaction.guild.id
        slots = int(select.values[0])
        await self.bot.db.set_type_config(guild_id, self.whitelist_type, default_slot_limit=slots)
        await self.bot.db.audit(guild_id, "setup_type", interaction.user.id, None, f"type={self.whitelist_type} default_slot_limit={slots}", self.whitelist_type)
        await self._refresh(interaction)


class AddRoleMappingView(discord.ui.View):
    """Ephemeral view with a RoleSelect for adding role mappings."""
    on_error = _view_on_error

    def __init__(self, bot, whitelist_type: str):
        super().__init__(timeout=120)
        self.bot = bot
        self.whitelist_type = whitelist_type

    @discord.ui.select(
        cls=discord.ui.RoleSelect,
        placeholder="Select a role to map",
        row=0,
    )
    async def role_select(self, interaction: discord.Interaction, select: discord.ui.RoleSelect):
        role = select.values[0]
        await interaction.response.send_modal(SlotLimitModal(self.bot, self.whitelist_type, role.id, role.name))


class RemoveRoleMappingView(discord.ui.View):
    """Dynamically built view showing mapped roles as select options for removal."""
    on_error = _view_on_error

    def __init__(self, bot, whitelist_type: str, mappings: List[tuple]):
        super().__init__(timeout=120)
        self.bot = bot
        self.whitelist_type = whitelist_type
        # tuple: (id, role_id, role_name, slot_limit, display_name, sort_order, is_active, is_stackable)
        options = [
            discord.SelectOption(label=f"{r[2]} ({r[3]} slots)", value=str(r[1]))
            for r in mappings if r[6]
        ]
        if not options:
            return
        select = discord.ui.Select(placeholder="Select role mapping to remove", options=options)
        select.callback = self._on_select
        self.add_item(select)

    async def _on_select(self, interaction: discord.Interaction):
        guild_id = interaction.guild.id
        role_id = int(interaction.data["values"][0])
        wl = await self.bot.db.get_whitelist_by_slug(guild_id, self.whitelist_type)
        if not wl:
            await interaction.response.send_message(f"Whitelist `{self.whitelist_type}` not found.", ephemeral=True)
            return
        panel_rows_del = await self.bot.db.fetchall(
            "SELECT id FROM panels WHERE guild_id=%s AND whitelist_id=%s AND enabled=TRUE LIMIT 1",
            (guild_id, wl["id"]),
        )
        if not panel_rows_del:
            await interaction.response.send_message(f"No enabled panel found for `{self.whitelist_type}`.", ephemeral=True)
            return
        panel_id_del = int(panel_rows_del[0][0])
        await self.bot.db.remove_panel_role(guild_id, panel_id_del, role_id)
        await self.bot.db.audit(guild_id, "setup_rolemap_remove", interaction.user.id, None, f"type={self.whitelist_type} role_id={role_id}", self.whitelist_type)
        await interaction.response.send_message(f"Removed role mapping for <@&{role_id}> from {self.whitelist_type}.", ephemeral=True)


# ─── Cog ──────────────────────────────────────────────────────────────────────

class SetupCog(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    @app_commands.command(name="setup", description="Launch interactive setup wizard")
    async def setup_cmd(self, interaction: discord.Interaction):
        if not await self.bot.require_mod(interaction):
            return
        view = MainSetupView(self.bot)
        embed = await view._build_hub_embed(interaction.guild)
        await interaction.response.send_message(embed=embed, view=view, ephemeral=True)

    @app_commands.command(name="setup_mod_role", description="Set the moderator role used by the bot")
    async def setup_mod_role(self, interaction: discord.Interaction, role: discord.Role):
        guild_id = interaction.guild.id
        current = int((await self.bot.db.get_setting(guild_id, "mod_role_id", "0")) or 0)
        if current and not await self.bot.user_is_mod(interaction.user):
            await interaction.response.send_message("Only the configured mod role can change this.", ephemeral=True)
            return
        await self.bot.db.set_setting(guild_id, "mod_role_id", str(role.id))
        await self.bot.db.audit(guild_id, "setup_mod_role", interaction.user.id, None, f"mod_role_id={role.id}")
        await interaction.response.send_message(f"Moderator role set to {role.mention}.", ephemeral=True)


async def setup(bot):
    await bot.add_cog(SetupCog(bot))
