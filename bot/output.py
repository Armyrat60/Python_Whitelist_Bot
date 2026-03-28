"""Shared whitelist output file generator.

Used by both the Discord bot worker and the standalone web service
to generate Squad RemoteAdminList format output files.
"""
from __future__ import annotations

from typing import TYPE_CHECKING

from bot.config import log, WEB_FILE_SECRET, WEB_INTERNAL_URL

if TYPE_CHECKING:
    from bot.database import Database


async def generate_output_files(db: "Database", guild_id: int) -> dict[str, str]:
    """Generate all whitelist output files for a guild.

    Returns a dict of {filename: content} for each output file.
    The files are in Squad RemoteAdminList format:

        Group=Whitelist:reserve
        Group=Admin:kick,ban,chat,cameraman,immune,reserve

        Admin=76561198012345678:Whitelist // PlayerName
        Admin=76561198087654321:Admin // AdminPlayer

    Args:
        db: Database instance
        guild_id: The guild to generate files for

    Returns:
        Dict mapping filename -> file content string
    """
    from bot.utils import to_bool

    # Get output mode setting
    output_mode = await db.get_setting(guild_id, "output_mode", "combined")
    combined_filename = await db.get_setting(guild_id, "combined_filename", "whitelist.txt")
    dedupe = to_bool(await db.get_setting(guild_id, "duplicate_output_dedupe", "true"))

    # Get all whitelists for this guild
    whitelists = await db.get_whitelists(guild_id)
    whitelist_by_id = {wl["id"]: wl for wl in whitelists}

    # Get all squad groups for this guild
    squad_groups = await db.get_squad_groups(guild_id)
    group_perms = {name: perms for name, perms, _ in squad_groups}

    # Get all active export rows
    # Returns: (whitelist_slug, output_filename, discord_id, discord_name, id_type, id_value)
    rows = await db.get_active_export_rows(guild_id)

    # Build group headers
    def build_group_headers(used_groups: set) -> list[str]:
        lines = []
        for gname in sorted(used_groups):
            perms = group_perms.get(gname, "reserve")
            lines.append(f"Group={gname}:{perms}")
        if lines:
            lines.extend(["", ""])  # Blank lines after group headers
        return lines

    # Build a single admin line
    def build_line(id_type: str, id_value: str, name: str, group_name: str) -> str:
        suffix = " [EOS]" if id_type == "eosid" else ""
        return f"Admin={id_value}:{group_name} // {name}{suffix}"

    outputs = {}

    # Pre-seed group sets from all enabled whitelists so group headers always appear
    # even when a whitelist has zero entries.
    all_enabled_groups: set[str] = set()
    per_wl_default_groups: dict[str, set] = {}
    for wl in whitelists:
        if not wl.get("enabled"):
            continue
        grp = wl.get("squad_group") or "Whitelist"
        all_enabled_groups.add(grp)
        per_wl_default_groups[wl["slug"]] = {grp}

    # Combined mode: all whitelists in one file
    combined_lines = []
    combined_seen = set()
    combined_groups: set[str] = set(all_enabled_groups)  # always include all groups

    # Per-whitelist mode: separate file per whitelist
    per_wl_lines: dict[str, list[str]] = {}
    per_wl_seen: dict[str, set] = {}
    per_wl_groups: dict[str, set] = {slug: set(grps) for slug, grps in per_wl_default_groups.items()}

    for row in rows:
        wl_slug, output_filename, discord_id, discord_name, id_type, id_value = row

        # Find the squad group for this whitelist
        wl = next((w for w in whitelists if w["slug"] == wl_slug), None)
        group_name = wl["squad_group"] if wl else "Whitelist"

        line = build_line(id_type, id_value, discord_name, group_name)
        dedup_key = f"{id_type}:{id_value}" if dedupe else line

        # Combined
        if output_mode in ("combined", "hybrid"):
            if dedup_key not in combined_seen:
                combined_lines.append(line)
                combined_seen.add(dedup_key)
                combined_groups.add(group_name)

        # Separate / Hybrid
        if output_mode in ("separate", "hybrid"):
            if wl_slug not in per_wl_lines:
                per_wl_lines[wl_slug] = []
                per_wl_seen[wl_slug] = set()
            if wl_slug not in per_wl_groups:
                per_wl_groups[wl_slug] = {group_name}

            if dedup_key not in per_wl_seen[wl_slug]:
                per_wl_lines[wl_slug].append(line)
                per_wl_seen[wl_slug].add(dedup_key)
                per_wl_groups[wl_slug].add(group_name)

    # Build combined output
    if output_mode in ("combined", "hybrid"):
        content = build_group_headers(combined_groups) + combined_lines
        combined_content = "\n".join(content)
        outputs[combined_filename] = combined_content
        # Also serve the combined content under each whitelist's own output_filename so
        # per-whitelist URLs always work regardless of output_mode.
        for wl in whitelists:
            if not wl.get("enabled"):
                continue
            wl_fn = wl.get("output_filename")
            if wl_fn and wl_fn != combined_filename:
                outputs[wl_fn] = combined_content

    # Build per-whitelist outputs
    if output_mode in ("separate", "hybrid"):
        for wl in whitelists:
            if not wl["enabled"]:
                continue
            slug = wl["slug"]
            filename = wl["output_filename"]
            lines = per_wl_lines.get(slug, [])
            groups = per_wl_groups.get(slug, set())
            content = build_group_headers(groups) + lines
            outputs[filename] = "\n".join(content)

    return outputs


async def _notify_web_service(guild_id: int) -> None:
    """Fire-and-forget HTTP call to tell the web service to refresh its cache.

    Only called by the bot-worker in two-process deployments where WEB_INTERNAL_URL
    is set.  The web service validates WEB_FILE_SECRET and re-runs sync_outputs.
    """
    import aiohttp
    url = f"{WEB_INTERNAL_URL}/internal/sync/{guild_id}"
    headers = {"Authorization": f"Bearer {WEB_FILE_SECRET}"}
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(url, headers=headers, timeout=aiohttp.ClientTimeout(total=5)) as resp:
                if resp.status != 200:
                    log.debug("Web service sync notification returned %s for guild %s", resp.status, guild_id)
    except Exception:
        log.debug("Web service sync notification failed for guild %s (web service may be down)", guild_id)


async def sync_outputs(db: "Database", guild_id: int, web_server=None, github=None) -> int:
    """Generate output files and push to web cache + optional GitHub.

    Args:
        db: Database instance
        guild_id: Guild to sync (or None for all guilds)
        web_server: Optional WebServer instance to update cache
        github: Optional GithubPublisher instance

    Returns:
        Number of files changed
    """
    import asyncio

    outputs = await generate_output_files(db, guild_id)

    # Update web server cache (single-process mode)
    if web_server:
        web_server.update_cache(guild_id, outputs)
    elif WEB_INTERNAL_URL:
        # Two-process mode: notify the web service to pull fresh data from DB
        import asyncio
        asyncio.create_task(_notify_web_service(guild_id))

    # Publish to GitHub if configured
    changed = 0
    if github:
        for filename, content in outputs.items():
            try:
                updated = await asyncio.to_thread(github.update_file_if_needed, filename, content)
                if updated:
                    changed += 1
            except Exception:
                log.exception("Failed to sync %s to GitHub", filename)

    return changed
