"""Shared panel embed builder.

Both the Discord bot (bot.py) and the REST web service (api.py) used to
maintain separate, nearly-identical embed builders that would drift out of
sync.  This module provides a single source of truth.

Usage
-----
From bot.py (returns a discord.Embed object):
    from bot.panel_builder import build_panel_embed
    embed = await build_panel_embed(db, guild_id, panel_record, wl)

From api.py (returns a plain dict for the REST API):
    from bot.panel_builder import build_panel_embed_dict, build_panel_components
    embed_dict = await build_panel_embed_dict(db, guild_id, panel_record, wl)
    components = build_panel_components(wl_slug)
"""
from __future__ import annotations

import re
from typing import TYPE_CHECKING

from bot.config import WEB_BASE_URL, log

if TYPE_CHECKING:
    from bot.database import Database

_DEFAULT_RE = re.compile(r"^\s*Default\s+", re.IGNORECASE)
_EMBED_COLOR = 0xF97316  # Orange


def _strip_default(name: str) -> str:
    """Remove a leading 'Default ' prefix for cleaner embed titles."""
    return _DEFAULT_RE.sub("", name).strip() or name


async def _build_tier_lines(db: "Database", guild_id: int, panel: dict, wl: dict, *, show_role_mentions: bool = True) -> list[str]:
    """Return formatted tier lines for the embed description."""
    tier_lines: list[str] = []

    if not wl:
        return tier_lines

    # panel_role tuple: (id, role_id, role_name, slot_limit, display_name, sort_order, is_active, is_stackable)
    panel_id = panel["id"] if panel else None
    wl_roles = await db.get_panel_roles(guild_id, panel_id) if panel_id else []
    wl_roles = sorted(
        [r for r in wl_roles if bool(r[6])],  # r[6] = is_active
        key=lambda r: r[3],  # sort by slot_limit ascending
    )
    for r in wl_roles:
        slots = r[3]
        if show_role_mentions:
            display = r[4] or f"<@&{r[1]}>"
        else:
            display = r[4] or r[2]  # display_name or role_name
        tier_lines.append(f"▸ **{display}** — **{slots} {'slot' if slots == 1 else 'slots'}**")

    return tier_lines


def _build_description(tier_lines: list[str], base_url: str, domain: str) -> str:
    desc = "Use the buttons below to manage your whitelist entry.\n\n"
    if tier_lines:
        desc += "**Available Tiers:**\n" + "\n".join(tier_lines) + "\n\n"
    desc += (
        "🛡️ **Manage Whitelist** — View your slots and IDs, or register for the first time\n"
        "⚙️ **Manager Tools** — Admin lookup and management *(mods only)*\n\n"
        f"🌐 [**{domain}**]({base_url})"
    )
    return desc


async def build_panel_embed(db: "Database", guild_id: int, panel: dict | None, wl: dict):
    """Build a discord.Embed for the panel.  Requires discord.py to be installed."""
    import discord  # local import so this module is safe to import in web-only mode

    # Use panel name if available, otherwise fall back to whitelist name
    raw_title = (panel["name"] if panel else None) or wl["name"]
    title = _strip_default(raw_title)

    show_rm = panel.get("show_role_mentions", True) if panel else True
    tier_lines = await _build_tier_lines(db, guild_id, panel, wl, show_role_mentions=show_rm)

    base_url = WEB_BASE_URL or "https://squadwhitelister.com"
    domain = base_url.replace("https://", "").replace("http://", "").rstrip("/")

    embed = discord.Embed(
        title=f"🛡️ {title}",
        description=_build_description(tier_lines, base_url, domain),
        color=discord.Color.from_rgb(249, 115, 22),
    )
    embed.set_footer(text=f"Squad Whitelister • {domain}")
    return embed


async def build_panel_embed_dict(db: "Database", guild_id: int, panel: dict | None, wl: dict) -> dict:
    """Build a plain-dict embed payload for the Discord REST API."""
    raw_title = (panel["name"] if panel else None) or wl["name"]
    title = _strip_default(raw_title)

    show_rm = panel.get("show_role_mentions", True) if panel else True
    tier_lines = await _build_tier_lines(db, guild_id, panel, wl, show_role_mentions=show_rm)

    base_url = WEB_BASE_URL or "https://squadwhitelister.com"
    domain = base_url.replace("https://", "").replace("http://", "").rstrip("/")

    return {
        "title": f"🛡️ {title}",
        "description": _build_description(tier_lines, base_url, domain),
        "color": _EMBED_COLOR,
        "footer": {"text": f"Squad Whitelister • {domain}"},
    }


def build_panel_components(wl_slug: str) -> list[dict]:
    """Build the Discord message components (buttons) for a panel.

    Both buttons are in a single ACTION_ROW so they render side-by-side.
    The custom_ids match the bot-worker persistent views so the bot handles clicks.
    """
    return [
        {
            "type": 1,  # ACTION_ROW
            "components": [
                {
                    "type": 2,  # BUTTON
                    "style": 3,  # SUCCESS (green)
                    "label": "Manage Whitelist",
                    "emoji": {"name": "🛡️"},
                    "custom_id": f"panel:submit:{wl_slug}",
                },
                {
                    "type": 2,  # BUTTON
                    "style": 2,  # SECONDARY (gray)
                    "label": "Manager Tools",
                    "emoji": {"name": "⚙️"},
                    "custom_id": f"panel:manage:{wl_slug}",
                },
            ],
        },
    ]
