import re
from datetime import datetime, timezone
from typing import List

import discord

from bot.config import STEAM64_RE, EOSID_RE, log


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def to_bool(value: str) -> bool:
    return str(value).strip().lower() in {"1", "true", "yes", "on", "enabled"}


def validate_identifier(id_type: str, id_value: str) -> bool:
    id_type = id_type.lower().strip()
    id_value = id_value.strip()
    if id_type == "steam64":
        return bool(STEAM64_RE.fullmatch(id_value))
    if id_type == "eosid":
        return bool(EOSID_RE.fullmatch(id_value))
    return False


_STEAM_PROFILE_RE = re.compile(r'steamcommunity\.com/profiles/(\d{17})', re.IGNORECASE)
_STEAM_VANITY_RE = re.compile(r'steamcommunity\.com/id/([a-zA-Z0-9_-]+)', re.IGNORECASE)


async def resolve_steam_names(steam64_ids: list[str], db=None) -> dict[str, str]:
    """Resolve Steam64 IDs to persona names.

    Lookup order:
      1. DB steam_name_cache (if db provided)
      2. Internal API proxy  (requires BOT_INTERNAL_SECRET + WEB_INTERNAL_URL)
      3. Direct Steam API    (requires STEAM_API_KEY)

    Newly resolved names are written back to the DB cache.
    Returns a dict of {steam64_id: persona_name}.
    """
    if not steam64_ids:
        return {}

    names: dict[str, str] = {}

    # 1. DB cache
    if db:
        cached = await db.get_steam_names(steam64_ids)
        names.update(cached)

    uncached = [sid for sid in steam64_ids if sid not in names]
    if not uncached:
        return names

    from bot.config import BOT_INTERNAL_SECRET, WEB_INTERNAL_URL, STEAM_API_KEY
    import aiohttp

    newly_resolved: dict[str, str] = {}

    # 2. Internal API proxy
    if BOT_INTERNAL_SECRET and WEB_INTERNAL_URL:
        try:
            async with aiohttp.ClientSession() as http:
                async with http.post(
                    f"{WEB_INTERNAL_URL}/api/internal/steam-names",
                    json={"steam_ids": uncached},
                    headers={"x-bot-secret": BOT_INTERNAL_SECRET, "Content-Type": "application/json"},
                    timeout=aiohttp.ClientTimeout(total=5),
                ) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        newly_resolved = {k: v for k, v in data.get("names", {}).items() if v}
        except Exception:
            pass

    # 3. Direct Steam API fallback
    if not newly_resolved and STEAM_API_KEY:
        try:
            ids_param = ",".join(uncached)
            async with aiohttp.ClientSession() as http:
                async with http.get(
                    f"https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key={STEAM_API_KEY}&steamids={ids_param}",
                    timeout=aiohttp.ClientTimeout(total=5),
                ) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        newly_resolved = {
                            p["steamid"]: p.get("personaname", "")
                            for p in data.get("response", {}).get("players", [])
                            if p.get("personaname")
                        }
        except Exception:
            pass

    if newly_resolved:
        names.update(newly_resolved)
        if db:
            try:
                await db.cache_steam_names(newly_resolved)
            except Exception:
                pass

    return names


async def resolve_steam_vanity(vanity_name: str) -> str | None:
    """Resolve a Steam vanity URL name to a Steam64 ID using the Steam API.

    Returns the Steam64 ID string, or None if resolution fails.
    """
    from bot.config import STEAM_API_KEY
    if not STEAM_API_KEY:
        return None
    try:
        import aiohttp
        async with aiohttp.ClientSession() as session:
            url = f"https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/?key={STEAM_API_KEY}&vanityurl={vanity_name}"
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=5)) as resp:
                if resp.status != 200:
                    return None
                data = await resp.json()
                if data.get("response", {}).get("success") == 1:
                    return data["response"]["steamid"]
    except Exception:
        pass
    return None


def split_identifier_tokens(raw: str) -> List[str]:
    """Split raw input into identifier tokens.

    Handles:
    - Comma/newline separated Steam64 IDs
    - Full Steam profile URLs (extracts the ID)
    - Mixed input (URLs + raw IDs)
    """
    raw = raw.replace("\n", ",")
    tokens = []
    for token in raw.split(","):
        token = token.strip()
        if not token:
            continue
        # Extract Steam64 from profile URLs
        m = _STEAM_PROFILE_RE.search(token)
        if m:
            tokens.append(m.group(1))
            continue
        # Flag vanity URLs for async resolution (prefix with vanity:)
        vm = _STEAM_VANITY_RE.search(token)
        if vm:
            tokens.append(f"vanity:{vm.group(1)}")
            continue
        tokens.append(token)
    return tokens


async def _modal_on_error(modal, interaction: discord.Interaction, error: Exception):
    log.exception("Modal %s error", type(modal).__name__, exc_info=error)
    msg = "Something went wrong. Please try again."
    try:
        if interaction.response.is_done():
            await interaction.followup.send(msg, ephemeral=True)
        else:
            await interaction.response.send_message(msg, ephemeral=True)
    except discord.HTTPException:
        pass


async def _view_on_error(view, interaction: discord.Interaction, error: Exception, item):
    log.exception("View %s error on %s", type(view).__name__, item, exc_info=error)
    msg = "Something went wrong. Please try again."
    try:
        if interaction.response.is_done():
            await interaction.followup.send(msg, ephemeral=True)
        else:
            await interaction.response.send_message(msg, ephemeral=True)
    except discord.HTTPException:
        pass
