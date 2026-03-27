from __future__ import annotations

import csv
import io
import json
import re
import time
import functools
from datetime import datetime, timedelta, timezone
from typing import Callable

import aiohttp_session
from aiohttp import web

import aiohttp as _aiohttp

from bot.config import DEFAULT_SETTINGS, SQUAD_PERMISSIONS, STEAM64_RE, EOSID_RE, STEAM_API_KEY, WEB_BASE_URL, log

# Steam name cache: {steam64_id: (name, timestamp)}
_steam_name_cache: dict[str, tuple[str, float]] = {}
_STEAM_CACHE_TTL = 3600  # 1 hour
from bot.output import sync_outputs
from bot.utils import utcnow


# ── Helpers ─────────────────────────────────────────────────────────────────

async def _trigger_sync(request: web.Request, guild_id: int):
    """Trigger output file regeneration after a data change.

    Works in both bot-worker and web-standalone mode.
    """
    bot = request.app.get("bot")
    if not bot:
        return

    web_server = request.app.get("web_server")
    github = getattr(bot, "github", None)
    db = getattr(bot, "db", None)
    if not db:
        return

    try:
        await sync_outputs(db, guild_id, web_server=web_server, github=github)
        log.info("Sync triggered for guild %s", guild_id)
    except Exception:
        log.exception("Sync failed for guild %s", guild_id)


async def _resolve_whitelist(db, guild_id: int, slug_or_type: str) -> dict | None:
    """Resolve a whitelist slug (or legacy type name) to a whitelist dict.

    Returns the whitelist dict with 'id', 'name', 'slug', etc. or None.
    This bridges old code using type strings with the new whitelist_id system.
    """
    wl = await db.get_whitelist_by_slug(guild_id, slug_or_type)
    return wl


async def _resolve_whitelist_id(db, guild_id: int, slug_or_type: str) -> int | None:
    """Resolve a whitelist slug to its integer ID, or None if not found."""
    wl = await _resolve_whitelist(db, guild_id, slug_or_type)
    return wl["id"] if wl else None


async def _get_whitelist_slugs(db, guild_id: int) -> list[str]:
    """Get all whitelist slugs for a guild (replaces WHITELIST_TYPES)."""
    whitelists = await db.get_whitelists(guild_id)
    return [wl["slug"] for wl in whitelists]

async def _get_active_guild_id(request: web.Request) -> int | None:
    """Return the active guild_id from the session, or None."""
    session = await aiohttp_session.get_session(request)
    raw = session.get("active_guild_id")
    if raw is None:
        return None
    return int(raw)


def _find_guild_in_session(guilds: list[dict], guild_id: str) -> dict | None:
    """Find a guild dict in the session guilds list by id string."""
    for g in guilds:
        if g["id"] == guild_id:
            return g
    return None


def _pack_plan_meta(plan: str | None = None, notes: str | None = None,
                    expires_at: str | None = None,
                    username: str | None = None) -> str:
    """Encode plan/notes/expires_at/username into a JSON string for last_plan_name."""
    payload: dict = {}
    if plan:
        payload["plan"] = plan
    if notes:
        payload["notes"] = notes
    if expires_at:
        payload["expires_at"] = expires_at
    if username:
        payload["username"] = username
    return json.dumps(payload) if payload else ""


def _normalize_discord_name(name: str) -> str:
    """Lowercase, strip discriminator, remove punctuation/spaces/emoji/non-ASCII."""
    name = re.sub(r"#\d{1,4}$", "", name.lower().strip())
    # Strip non-ASCII characters (emoji, ™, ®, clan symbols, etc.)
    name = name.encode("ascii", errors="ignore").decode()
    return re.sub(r'[_.\-#!@$%^&*()+={}\[\]|;:,<>?/\\~` ]', '', name)


def _reconcile_score(orphan_name: str, member_name: str) -> float:
    """Return 0.0-1.0 confidence that orphan_name matches member_name.

    Tiers:
      1.00 - exact case-insensitive match
      0.95 - exact after stripping discriminator / punctuation
      0.88 - shorter (5+ chars) is a suffix of longer (clan-tag prefix pattern)
      0.80-0.87 - shorter is a prefix of longer (scaled by length ratio)
      0.50-0.79 - containment or SequenceMatcher ratio on normalised names
      0.00 - below threshold
    """
    from difflib import SequenceMatcher
    if not orphan_name or not member_name:
        return 0.0
    o = orphan_name.lower().strip()
    m = member_name.lower().strip()
    if o == m:
        return 1.0
    o_n = _normalize_discord_name(o)
    m_n = _normalize_discord_name(m)
    if not o_n or not m_n:
        return 0.0
    if o_n == m_n:
        return 0.95
    # Prefix / suffix containment — clan tags always prepended, so gamertag is a suffix
    shorter, longer = sorted([o_n, m_n], key=len)
    if longer.endswith(shorter) and len(shorter) >= 5:
        # Full gamertag appears at end of the longer name (clan tag prefix) — high confidence
        return 0.88
    if longer.startswith(shorter) or longer.endswith(shorter):
        return round(0.80 * len(shorter) / len(longer) + 0.15, 2)
    if shorter in longer and len(shorter) >= 4:
        return round(0.75 * len(shorter) / len(longer), 2)
    # Edit-distance ratio
    ratio = SequenceMatcher(None, o_n, m_n).ratio()
    if ratio >= 0.6:
        return round(0.50 + ratio * 0.29, 2)  # maps 0.6→0.67, 1.0→0.79
    return 0.0


def _unpack_plan_meta(raw: str | None) -> dict:
    """Decode last_plan_name into {"plan", "notes", "expires_at"} dict.

    If the stored value is plain text (not JSON), treat it as the plan name.
    """
    if not raw:
        return {"plan": None, "notes": None, "expires_at": None, "username": None}
    try:
        data = json.loads(raw)
        if isinstance(data, dict):
            return {
                "plan": data.get("plan"),
                "notes": data.get("notes"),
                "expires_at": data.get("expires_at"),
                "username": data.get("username"),
            }
    except (json.JSONDecodeError, TypeError):
        pass
    # Fallback: treat raw string as legacy plan name
    return {"plan": raw, "notes": None, "expires_at": None, "username": None}


# ── Auth decorators ──────────────────────────────────────────────────────────

def require_login(handler: Callable) -> Callable:
    """Decorator that checks the user is logged in, returns 401 otherwise."""
    @functools.wraps(handler)
    async def wrapper(request: web.Request) -> web.Response:
        session = await aiohttp_session.get_session(request)
        if not session.get("logged_in"):
            return web.json_response({"error": "Authentication required."}, status=401)
        if not session.get("active_guild_id"):
            return web.json_response({"error": "No active guild selected."}, status=400)
        return await handler(request)
    return wrapper


_IS_MOD_TTL = 300  # Re-verify every 5 minutes


async def _reverify_is_mod(request: web.Request, session, active_guild_id: str) -> bool:
    """Re-check mod status using the bot's guild cache + DB, without OAuth token.

    Returns the current is_mod value and updates the session guilds in-place.
    Falls back to the cached session value if the bot is unavailable.
    """
    bot = request.app.get("bot")
    if bot is None:
        # Web-only mode with no bot cache — keep existing value
        guilds = session.get("guilds", [])
        g = _find_guild_in_session(guilds, active_guild_id)
        return bool(g and g.get("is_mod"))

    discord_id_str = session.get("discord_id", "")
    try:
        user_discord_id = int(discord_id_str)
    except (ValueError, TypeError):
        return False

    try:
        guild_id_int = int(active_guild_id)
        discord_guild = bot.get_guild(guild_id_int)
        is_mod = False

        if discord_guild:
            # Guild owner is always admin
            if discord_guild.owner_id == user_discord_id:
                is_mod = True

            if not is_mod:
                member = discord_guild.get_member(user_discord_id)
                if member:
                    if member.guild_permissions.administrator:
                        is_mod = True
                    elif member.guild_permissions.manage_guild:
                        is_mod = True

                    if not is_mod:
                        # Check custom mod roles from DB
                        db = getattr(bot, "db", None) or request.app.get("db")
                        if db:
                            mod_role_id_str = await db.get_setting(guild_id_int, "mod_role_id", "")
                            if mod_role_id_str:
                                mod_role_ids = {
                                    int(r.strip())
                                    for r in mod_role_id_str.split(",")
                                    if r.strip().isdigit()
                                }
                                if any(r.id in mod_role_ids for r in member.roles):
                                    is_mod = True

        # Patch session in-place
        now = time.monotonic()
        guilds = session.get("guilds", [])
        for g in guilds:
            if str(g.get("id")) == active_guild_id:
                g["is_mod"] = is_mod
                g["_is_mod_verified_at"] = now
                break
        session["guilds"] = guilds
        session["is_mod"] = is_mod
        return is_mod

    except Exception:
        log.warning("is_mod re-verification failed for discord_id=%s guild=%s", discord_id_str, active_guild_id)
        guilds = session.get("guilds", [])
        g = _find_guild_in_session(guilds, active_guild_id)
        return bool(g and g.get("is_mod"))


def require_admin(handler: Callable) -> Callable:
    """Decorator that checks the user is a mod/admin for the ACTIVE guild.

    The is_mod flag is re-verified against the live Discord guild every
    _IS_MOD_TTL seconds so that demoted mods lose access promptly.
    """
    @functools.wraps(handler)
    async def wrapper(request: web.Request) -> web.Response:
        session = await aiohttp_session.get_session(request)
        if not session.get("logged_in"):
            return web.json_response({"error": "Authentication required."}, status=401)
        active_guild_id = session.get("active_guild_id")
        if not active_guild_id:
            return web.json_response({"error": "No active guild selected."}, status=400)

        guilds = session.get("guilds", [])
        active_guild = _find_guild_in_session(guilds, active_guild_id)

        # Re-verify is_mod if TTL has elapsed
        now = time.monotonic()
        verified_at = active_guild.get("_is_mod_verified_at", 0) if active_guild else 0
        if active_guild is None or (now - verified_at) > _IS_MOD_TTL:
            is_mod = await _reverify_is_mod(request, session, active_guild_id)
        else:
            is_mod = active_guild.get("is_mod", False)

        if not is_mod:
            return web.json_response({"error": "Admin access required for this guild."}, status=403)
        return await handler(request)
    return wrapper


# ── Guild API routes ────────────────────────────────────────────────────────

async def get_guilds(request: web.Request) -> web.Response:
    """Return the user's mutual guilds from session."""
    session = await aiohttp_session.get_session(request)
    if not session.get("logged_in"):
        return web.json_response({"error": "Authentication required."}, status=401)

    guilds = session.get("guilds", [])
    active_guild_id = session.get("active_guild_id")

    return web.json_response({
        "guilds": guilds,
        "active_guild_id": active_guild_id,
    })


async def switch_guild(request: web.Request) -> web.Response:
    """Switch the active guild in the session."""
    session = await aiohttp_session.get_session(request)
    if not session.get("logged_in"):
        return web.json_response({"error": "Authentication required."}, status=401)

    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON body."}, status=400)

    target_guild_id = body.get("guild_id")
    if not target_guild_id:
        return web.json_response({"error": "guild_id is required."}, status=400)

    target_guild_id = str(target_guild_id)

    # Verify user has access to this guild
    guilds = session.get("guilds", [])
    target_guild = _find_guild_in_session(guilds, target_guild_id)
    if not target_guild:
        return web.json_response({"error": "You do not have access to this guild."}, status=403)

    # Update session
    session["active_guild_id"] = target_guild_id
    session["is_mod"] = target_guild.get("is_mod", False)
    session["roles"] = target_guild.get("roles", [])

    log.info(
        "User %s switched active guild to %s (%s)",
        session.get("username"), target_guild.get("name"), target_guild_id,
    )

    return web.json_response({
        "ok": True,
        "active_guild_id": target_guild_id,
        "guild_name": target_guild.get("name"),
        "is_mod": target_guild.get("is_mod", False),
    })


async def guild_theme(request: web.Request) -> web.Response:
    """Return the active guild's org accent colors. Requires login only (not admin).

    Used by the frontend accent context to apply org-level theming on top of
    users' personal color preferences.
    """
    session = await aiohttp_session.get_session(request)
    if not session.get("logged_in"):
        return web.json_response({"error": "Authentication required."}, status=401)
    active_guild_id = session.get("active_guild_id")
    if not active_guild_id:
        return web.json_response({"accent_primary": "", "accent_secondary": ""})
    guild_id = int(active_guild_id)
    bot = request.app.get("bot")
    if not bot:
        return web.json_response({"accent_primary": "", "accent_secondary": ""})
    db = bot.db
    primary = await db.get_setting(guild_id, "accent_primary", "")
    secondary = await db.get_setting(guild_id, "accent_secondary", "")
    return web.json_response({"accent_primary": primary, "accent_secondary": secondary})


# ── User API routes ──────────────────────────────────────────────────────────

@require_login
async def get_my_whitelists_all(request: web.Request) -> web.Response:
    """Return all whitelists the user qualifies for based on their Discord roles.

    Auto-detects tier from current roles, calculates slots in real-time.
    Only returns whitelists where the user has a matching tier or existing entries.
    """
    session = await aiohttp_session.get_session(request)
    bot = request.app["bot"]
    guild_id = int(session["active_guild_id"])
    discord_id = int(session["discord_id"])
    db = bot.db

    # Fetch user's Discord roles — try guild cache first (bot-worker), fall back to REST API
    member_role_ids = set()
    try:
        guild_cache = bot.get_guild(guild_id) if hasattr(bot, "get_guild") else None
        member = guild_cache.get_member(discord_id) if guild_cache else None
        if member:
            member_role_ids = {r.id for r in member.roles}
        else:
            # Web service has no gateway cache — use Discord REST API
            from bot.config import DISCORD_TOKEN as _BOT_TOKEN
            if _BOT_TOKEN:
                async with _aiohttp.ClientSession() as _http:
                    async with _http.get(
                        f"https://discord.com/api/v10/guilds/{guild_id}/members/{discord_id}",
                        headers={"Authorization": f"Bot {_BOT_TOKEN}"},
                        timeout=_aiohttp.ClientTimeout(total=5),
                    ) as _resp:
                        if _resp.status == 200:
                            _data = await _resp.json()
                            member_role_ids = {int(r) for r in _data.get("roles", [])}
    except Exception:
        pass

    whitelists = await db.get_whitelists(guild_id)
    panels = await db.get_panels(guild_id)
    results = []

    for wl in whitelists:
        if not wl["enabled"]:
            continue
        wl_id = wl["id"]

        # Find panel for tier calculation
        panel = next((p for p in panels if p.get("whitelist_id") == wl_id and p.get("tier_category_id")), None)

        # Calculate slots from current roles
        tier_name = None
        slots = 0

        if panel and panel.get("tier_category_id"):
            tier_entries = await db.get_tier_entries(guild_id, panel["tier_category_id"])
            matched = []
            for te in tier_entries:
                te_role_id = int(te[1])
                if bool(te[6]) and te_role_id in member_role_ids:
                    matched.append((te[4] or te[2], te[3]))  # (name, slot_limit)

            if matched:
                if wl.get("stack_roles"):
                    slots = sum(s for _, s in matched)
                    tier_name = " + ".join(f"{n}" for n, _ in matched)
                else:
                    winner = max(matched, key=lambda x: x[1])
                    slots = winner[1]
                    tier_name = winner[0]

        # Fall back to role_mappings if no tier category match
        if slots <= 0 and member_role_ids:
            rm_rows = await db.fetchall(
                "SELECT role_id, role_name, slot_limit FROM role_mappings "
                "WHERE guild_id=%s AND whitelist_id=%s AND is_active=%s",
                (guild_id, wl_id, True if db.engine == "postgres" else 1),
            )
            for rm in (rm_rows or []):
                if int(rm[0]) in member_role_ids:
                    tier_name = rm[1]
                    slots = int(rm[2])
                    break

        # Fall back to default slot limit
        if slots <= 0:
            slots = int(wl.get("default_slot_limit", 1))

        # Get existing identifiers
        identifiers = await db.get_identifiers(guild_id, discord_id, wl_id)
        steam_ids = [row[1] for row in identifiers if row[0] == "steam64"]
        eos_ids = [row[1] for row in identifiers if row[0] == "eosid"]

        # Show if user has a tier/role match OR has existing entries
        if tier_name or identifiers:
            results.append({
                "whitelist_slug": wl["slug"],
                "whitelist_name": wl["name"],
                "tier_name": tier_name,
                "effective_slot_limit": slots,
                "steam_ids": steam_ids,
                "eos_ids": eos_ids,
            })

    return web.json_response(results)


@require_login
async def get_my_whitelist(request: web.Request) -> web.Response:
    """Return the user's identifiers for a given whitelist type."""
    session = await aiohttp_session.get_session(request)
    wl_type = request.match_info["type"]

    bot = request.app["bot"]
    guild_id = int(session["active_guild_id"])
    discord_id = int(session["discord_id"])

    wl_id = await _resolve_whitelist_id(bot.db, guild_id, wl_type)
    if wl_id is None:
        return web.json_response({"error": "Invalid whitelist type."}, status=400)

    user_record = await bot.db.get_user_record(guild_id, discord_id, wl_id)
    identifiers = await bot.db.get_identifiers(guild_id, discord_id, wl_id)

    steam_ids = [row[1] for row in identifiers if row[0] == "steam64"]
    eos_ids = [row[1] for row in identifiers if row[0] == "eosid"]

    result = {
        "type": wl_type,
        "steam_ids": steam_ids,
        "eos_ids": eos_ids,
        "user_record": None,
    }
    if user_record:
        result["user_record"] = {
            "discord_name": user_record[0],
            "status": user_record[1],
            "slot_limit_override": user_record[2],
            "effective_slot_limit": user_record[3],
            "last_plan_name": user_record[4],
        }
    return web.json_response(result)


@require_login
async def update_my_whitelist(request: web.Request) -> web.Response:
    """Submit/update the user's identifiers for a given whitelist type."""
    session = await aiohttp_session.get_session(request)
    wl_type = request.match_info["type"]

    bot = request.app["bot"]
    guild_id = int(session["active_guild_id"])
    discord_id = int(session["discord_id"])
    username = session.get("username", "Unknown")

    # Resolve whitelist by slug
    wl = await _resolve_whitelist(bot.db, guild_id, wl_type)
    if not wl:
        return web.json_response({"error": "Invalid whitelist type."}, status=400)
    wl_id = wl["id"]
    if not wl["enabled"]:
        return web.json_response({"error": "This whitelist type is not enabled."}, status=400)
    type_config = wl  # wl dict has all the config fields

    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON body."}, status=400)

    steam_ids = body.get("steam_ids", [])
    eos_ids = body.get("eos_ids", [])

    # Validate
    if not isinstance(steam_ids, list) or not isinstance(eos_ids, list):
        return web.json_response({"error": "steam_ids and eos_ids must be arrays."}, status=400)

    errors = []
    for sid in steam_ids:
        if not STEAM64_RE.match(str(sid)):
            errors.append(f"Invalid Steam64 ID: {sid}")
    for eid in eos_ids:
        if not EOSID_RE.match(str(eid)):
            errors.append(f"Invalid EOS ID: {eid}")
    if errors:
        return web.json_response({"error": "Validation failed.", "details": errors}, status=400)

    # Check slot limits
    user_record = await bot.db.get_user_record(guild_id, discord_id, wl_id)
    slot_limit = type_config["default_slot_limit"]
    if user_record and user_record[3]:  # effective_slot_limit
        slot_limit = user_record[3]

    total_ids = len(steam_ids) + len(eos_ids)
    if total_ids > slot_limit:
        return web.json_response(
            {"error": f"Too many IDs. Your slot limit is {slot_limit} total."},
            status=400,
        )

    # Build identifier tuples: (id_type, id_value, is_verified, verification_source)
    identifiers = []
    for sid in steam_ids:
        identifiers.append(("steam64", str(sid), False, "web_dashboard"))
    for eid in eos_ids:
        identifiers.append(("eosid", str(eid), False, "web_dashboard"))

    # Save to DB
    await bot.db.replace_identifiers(guild_id, discord_id, wl_id, identifiers)

    # Ensure user record exists
    if not user_record:
        await bot.db.upsert_user_record(
            guild_id, discord_id, wl_id, username, "active",
            slot_limit, "web", None,
        )

    # Audit
    await bot.db.audit(
        guild_id, "web_update_ids", discord_id, discord_id,
        f"Updated {wl_type} IDs via web: {len(steam_ids)} steam, {len(eos_ids)} eos",
        wl_id,
    )

    await _trigger_sync(request, guild_id)

    return web.json_response({"ok": True, "message": "Whitelist updated successfully."})


# ── Admin API routes ─────────────────────────────────────────────────────────

@require_admin
async def admin_stats(request: web.Request) -> web.Response:
    """Dashboard statistics for admins, scoped to the active guild."""
    session = await aiohttp_session.get_session(request)
    guild_id = int(session["active_guild_id"])

    bot = request.app["bot"]
    db = bot.db

    stats = {}
    whitelists = await db.get_whitelists(guild_id)
    for wl in whitelists:
        wl_id = wl["id"]
        wl_slug = wl["slug"]
        active_row = await db.fetchone(
            "SELECT COUNT(*) FROM whitelist_users WHERE guild_id=%s AND whitelist_id=%s AND status='active'",
            (guild_id, wl_id),
        )
        id_row = await db.fetchone(
            "SELECT COUNT(*) FROM whitelist_identifiers WHERE guild_id=%s AND whitelist_id=%s",
            (guild_id, wl_id),
        )
        stats[wl_slug] = {
            "active_users": active_row[0] if active_row else 0,
            "total_ids": id_row[0] if id_row else 0,
        }

    total_active = sum(s["active_users"] for s in stats.values())
    total_ids = sum(s["total_ids"] for s in stats.values())

    audit_row = await db.fetchone(
        "SELECT COUNT(*) FROM audit_log WHERE guild_id=%s AND created_at >= NOW() - INTERVAL 7 DAY"
        if db.engine != "postgres" else
        "SELECT COUNT(*) FROM audit_log WHERE guild_id=%s AND created_at >= NOW() - INTERVAL '7 days'",
        (guild_id,),
    )
    recent_audit = audit_row[0] if audit_row else 0

    return web.json_response({
        "total_active_users": total_active,
        "total_identifiers": total_ids,
        "recent_audit_count": recent_audit,
        "per_type": stats,
    })


@require_admin
async def admin_users(request: web.Request) -> web.Response:
    """List users with search/filter/pagination, scoped to the active guild."""
    session = await aiohttp_session.get_session(request)
    guild_id = int(session["active_guild_id"])

    bot = request.app["bot"]
    db = bot.db

    search = request.query.get("search", "").strip()
    wl_type = (request.query.get("type") or request.query.get("whitelist") or "").strip()
    status = request.query.get("status", "").strip()
    tier_filter = request.query.get("tier", "").strip()
    unlinked_only = request.query.get("unlinked", "").lower() in ("1", "true", "yes")
    page = max(1, int(request.query.get("page", "1")))
    per_page = min(100, max(1, int(request.query.get("per_page", "25"))))

    conditions = ["u.guild_id=%s"]
    params: list = [guild_id]

    if unlinked_only:
        conditions.append("u.discord_id < 0")

    if search:
        cast_expr = "CAST(u.discord_id AS TEXT)" if db.engine == "postgres" else "CAST(u.discord_id AS CHAR)"
        id_cast_expr = "CAST(i.id_value AS TEXT)" if db.engine == "postgres" else "CAST(i.id_value AS CHAR)"
        conditions.append(
            f"(u.discord_name LIKE %s OR {cast_expr} LIKE %s OR EXISTS ("
            f"SELECT 1 FROM whitelist_identifiers i "
            f"WHERE i.guild_id=u.guild_id AND i.discord_id=u.discord_id AND {id_cast_expr} LIKE %s))"
        )
        params.extend([f"%{search}%", f"%{search}%", f"%{search}%"])
    if wl_type:
        wl_resolved = await _resolve_whitelist(bot.db, guild_id, wl_type)
        if wl_resolved:
            conditions.append("u.whitelist_id=%s")
            params.append(wl_resolved["id"])
    if status:
        conditions.append("u.status=%s")
        params.append(status)
    if tier_filter:
        # Match both plain-text plan name and JSON-packed format {"plan": "Solo", ...}
        json_pattern = f'%"plan": "{tier_filter}"%'
        conditions.append("(u.last_plan_name = %s OR u.last_plan_name LIKE %s)")
        params.extend([tier_filter, json_pattern])

    where = f"WHERE {' AND '.join(conditions)}"

    count_row = await db.fetchone(
        f"SELECT COUNT(*) FROM whitelist_users u {where}",
        tuple(params),
    )
    total = count_row[0] if count_row else 0

    offset = (page - 1) * per_page
    params_page = list(params) + [per_page, offset]

    rows = await db.fetchall(
        f"""
        SELECT u.discord_id, u.discord_name, w.slug, u.status,
               u.effective_slot_limit, u.last_plan_name, u.updated_at, w.name
        FROM whitelist_users u
        LEFT JOIN whitelists w ON w.id = u.whitelist_id
        {where}
        ORDER BY u.updated_at DESC
        LIMIT %s OFFSET %s
        """,
        tuple(params_page),
    )

    # Fetch identifiers for all users on this page
    user_ids_on_page = [(row[0], row[2]) for row in rows]  # (discord_id, wl_slug)
    id_map: dict[str, dict] = {}  # key: "discord_id:wl_slug" -> {"steam_ids": [], "eos_ids": []}

    if rows:
        discord_id_list = list(set(str(r[0]) for r in rows))
        # Fetch all identifiers for these users in this guild
        placeholders = ",".join(["%s"] * len(discord_id_list))
        id_rows = await db.fetchall(
            f"""
            SELECT i.discord_id, i.id_type, i.id_value, w.slug, i.verification_source
            FROM whitelist_identifiers i
            LEFT JOIN whitelists w ON w.id = i.whitelist_id
            WHERE i.guild_id=%s AND CAST(i.discord_id AS TEXT) IN ({placeholders})
            """ if db.engine == "postgres" else f"""
            SELECT i.discord_id, i.id_type, i.id_value, w.slug, i.verification_source
            FROM whitelist_identifiers i
            LEFT JOIN whitelists w ON w.id = i.whitelist_id
            WHERE i.guild_id=%s AND CAST(i.discord_id AS CHAR) IN ({placeholders})
            """,
            tuple([guild_id] + discord_id_list),
        )
        for irow in (id_rows or []):
            key = f"{irow[0]}:{irow[3] or ''}"
            if key not in id_map:
                id_map[key] = {"steam_ids": [], "eos_ids": [], "sources": set()}
            if irow[1] == "steam64":
                id_map[key]["steam_ids"].append(str(irow[2]))
            elif irow[1] == "eosid":
                id_map[key]["eos_ids"].append(str(irow[2]))
            if irow[4]:
                id_map[key]["sources"].add(irow[4])

    # Priority order for registration_source derivation
    _REG_PRIORITY = ["self_register", "role_sync", "web_dashboard", "admin_web", "import"]

    users = []
    for row in rows:
        meta = _unpack_plan_meta(row[5])
        key = f"{row[0]}:{row[2] or ''}"
        ids = id_map.get(key, {"steam_ids": [], "eos_ids": [], "sources": set()})
        did = int(row[0])
        sources: set = ids.get("sources", set())
        if did < 0:
            reg_source = "orphan"
        else:
            reg_source = next((s for s in _REG_PRIORITY if s in sources), "admin" if not sources else sources.pop())
        users.append({
            "discord_id": str(row[0]),
            "discord_name": row[1],
            "whitelist_type": row[2] or "",
            "whitelist_slug": row[2] or "",
            "whitelist_name": row[7] or row[2] or "",
            "status": row[3],
            "effective_slot_limit": row[4],
            "last_plan_name": meta["plan"],
            "notes": meta["notes"],
            "expires_at": meta["expires_at"],
            "updated_at": str(row[6]) if row[6] else "",
            "created_at": str(row[6]) if row[6] else "",
            "steam_ids": ids["steam_ids"],
            "eos_ids": ids["eos_ids"],
            "registration_source": reg_source,
        })

    return web.json_response({
        "users": users,
        "total": total,
        "page": page,
        "per_page": per_page,
        "pages": max(1, (total + per_page - 1) // per_page),
    })


@require_admin
async def admin_audit(request: web.Request) -> web.Response:
    """Audit log with filters and pagination, scoped to the active guild."""
    session = await aiohttp_session.get_session(request)
    guild_id = int(session["active_guild_id"])

    bot = request.app["bot"]
    db = bot.db

    wl_type = request.query.get("type", "").strip()
    action = request.query.get("action", "").strip()
    page = max(1, int(request.query.get("page", "1")))
    per_page = min(100, max(1, int(request.query.get("per_page", "25"))))

    conditions = ["a.guild_id=%s"]
    params: list = [guild_id]

    if wl_type:
        wl_resolved = await _resolve_whitelist_id(bot.db, guild_id, wl_type)
        if wl_resolved is not None:
            conditions.append("a.whitelist_id=%s")
            params.append(wl_resolved)
    if action:
        conditions.append("a.action_type=%s")
        params.append(action)

    where = f"WHERE {' AND '.join(conditions)}"

    count_row = await db.fetchone(
        f"SELECT COUNT(*) FROM audit_log a {where}",
        tuple(params),
    )
    total = count_row[0] if count_row else 0

    offset = (page - 1) * per_page
    params_page = list(params) + [per_page, offset]

    rows = await db.fetchall(
        f"""
        SELECT a.id, w.slug, a.action_type, a.actor_discord_id,
               a.target_discord_id, a.details, a.created_at
        FROM audit_log a
        LEFT JOIN whitelists w ON w.id = a.whitelist_id
        {where}
        ORDER BY a.created_at DESC
        LIMIT %s OFFSET %s
        """,
        tuple(params_page),
    )

    entries = []
    for row in rows:
        entries.append({
            "id": row[0],
            "whitelist_type": row[1] or "",
            "action_type": row[2],
            "actor_discord_id": str(row[3]) if row[3] else None,
            "target_discord_id": str(row[4]) if row[4] else None,
            "details": row[5],
            "created_at": str(row[6]) if row[6] else "",
        })

    return web.json_response({
        "entries": entries,
        "total": total,
        "page": page,
        "per_page": per_page,
        "pages": max(1, (total + per_page - 1) // per_page),
    })


# ── Admin Player Management API routes ───────────────────────────────────────

@require_admin
async def admin_add_user(request: web.Request) -> web.Response:
    """Admin manually adds a player to a whitelist type."""
    session = await aiohttp_session.get_session(request)
    guild_id = int(session["active_guild_id"])
    actor_id = int(session["discord_id"])

    bot = request.app["bot"]
    db = bot.db

    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON body."}, status=400)

    # -- Required fields --
    discord_name = body.get("discord_name", "").strip()
    wl_type = (body.get("whitelist_slug") or body.get("whitelist_type", "")).strip()
    steam_ids = body.get("steam_ids", [])

    if not discord_name:
        return web.json_response({"error": "discord_name is required."}, status=400)
    if not wl_type:
        return web.json_response({"error": "whitelist_slug is required."}, status=400)
    wl = await _resolve_whitelist(bot.db, guild_id, wl_type)
    if not wl:
        return web.json_response({"error": "Invalid whitelist type."}, status=400)
    wl_id = wl["id"]
    if not isinstance(steam_ids, list) or len(steam_ids) == 0:
        return web.json_response({"error": "At least one steam_id is required."}, status=400)

    # -- Optional fields --
    eos_ids = body.get("eos_ids", [])
    if not isinstance(eos_ids, list):
        return web.json_response({"error": "eos_ids must be an array."}, status=400)

    raw_discord_id = body.get("discord_id", 0)
    try:
        discord_id = int(raw_discord_id) if raw_discord_id else 0
    except (ValueError, TypeError):
        return web.json_response({"error": "discord_id must be numeric."}, status=400)

    # Generate placeholder for non-Discord players
    if discord_id == 0:
        discord_id = -abs(int(time.time() * 1000))

    slot_limit = body.get("slot_limit")
    if slot_limit is not None:
        try:
            slot_limit = int(slot_limit)
        except (ValueError, TypeError):
            return web.json_response({"error": "slot_limit must be an integer."}, status=400)

    notes = body.get("notes")
    expires_at = body.get("expires_at")

    # -- Validate IDs --
    errors = []
    for sid in steam_ids:
        if not STEAM64_RE.match(str(sid)):
            errors.append(f"Invalid Steam64 ID: {sid}")
    for eid in eos_ids:
        if not EOSID_RE.match(str(eid)):
            errors.append(f"Invalid EOS ID: {eid}")
    if errors:
        return web.json_response({"error": "Validation failed.", "details": errors}, status=400)

    # -- Check for existing user --
    existing = await db.get_user_record(guild_id, discord_id, wl_id)
    if existing:
        return web.json_response(
            {"error": f"User {discord_id} already exists for whitelist type '{wl_type}'. Use PATCH to update."},
            status=409,
        )

    # -- Determine effective slot limit --
    default_slot = wl["default_slot_limit"] or 1
    effective_slot = slot_limit if slot_limit is not None else default_slot

    # -- Pack notes/expires_at into last_plan_name --
    plan_meta = _pack_plan_meta(notes=notes, expires_at=expires_at)

    # -- Create user record --
    await db.upsert_user_record(
        guild_id, discord_id, wl_id, discord_name, "active",
        effective_slot, plan_meta,
        slot_limit_override=slot_limit,
    )

    # -- Create identifiers --
    identifiers = []
    for sid in steam_ids:
        identifiers.append(("steam64", str(sid), False, "admin_web"))
    for eid in eos_ids:
        identifiers.append(("eosid", str(eid), False, "admin_web"))
    await db.replace_identifiers(guild_id, discord_id, wl_id, identifiers)

    # -- Audit --
    detail_parts = [f"Admin added user '{discord_name}' (discord_id={discord_id}) to {wl_type}"]
    detail_parts.append(f"steam_ids={steam_ids}")
    if eos_ids:
        detail_parts.append(f"eos_ids={eos_ids}")
    if notes:
        detail_parts.append(f"notes={notes}")
    if expires_at:
        detail_parts.append(f"expires_at={expires_at}")
    await db.audit(guild_id, "admin_add_user", actor_id, discord_id, "; ".join(detail_parts), wl_id)

    log.info("Guild %s: admin %s added user %s (%s) to %s", guild_id, actor_id, discord_id, discord_name, wl_type)

    await _trigger_sync(request, guild_id)

    return web.json_response({
        "ok": True,
        "discord_id": str(discord_id),
        "discord_name": discord_name,
        "whitelist_type": wl_type,
    }, status=201)


@require_admin
async def admin_update_user(request: web.Request) -> web.Response:
    """Update an existing user's settings for a whitelist type."""
    session = await aiohttp_session.get_session(request)
    guild_id = int(session["active_guild_id"])
    actor_id = int(session["discord_id"])

    bot = request.app["bot"]
    db = bot.db

    try:
        discord_id = int(request.match_info["discord_id"])
    except (ValueError, TypeError):
        return web.json_response({"error": "Invalid discord_id in URL."}, status=400)

    wl_type = request.match_info["type"]
    wl = await _resolve_whitelist(bot.db, guild_id, wl_type)
    if not wl:
        return web.json_response({"error": "Invalid whitelist type."}, status=400)
    wl_id = wl["id"]

    # -- Check user exists --
    user_record = await db.get_user_record(guild_id, discord_id, wl_id)
    if not user_record:
        return web.json_response({"error": "User not found."}, status=404)

    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON body."}, status=400)

    if not isinstance(body, dict) or not body:
        return web.json_response({"error": "Body must be a non-empty JSON object."}, status=400)

    # user_record layout: (discord_name, status, slot_limit_override, effective_slot_limit, last_plan_name, updated_at, created_at)
    current_name = user_record[0]
    current_status = user_record[1]
    current_slot_override = user_record[2]
    current_effective_slot = user_record[3]
    current_meta = _unpack_plan_meta(user_record[4])

    changes = []

    # -- Status --
    new_status = current_status
    if "status" in body:
        if body["status"] not in ("active", "inactive", "suspended"):
            return web.json_response({"error": "status must be 'active', 'inactive', or 'suspended'."}, status=400)
        new_status = body["status"]
        if new_status != current_status:
            changes.append(f"status: {current_status} -> {new_status}")

    # -- Slot limit override --
    new_slot_override = current_slot_override
    new_effective_slot = current_effective_slot
    if "slot_limit_override" in body:
        val = body["slot_limit_override"]
        if val is None:
            new_slot_override = None
            # Reset effective to default
            new_effective_slot = wl["default_slot_limit"] or 1
            if new_slot_override != current_slot_override:
                changes.append("slot_limit_override: cleared")
        else:
            try:
                new_slot_override = int(val)
                new_effective_slot = new_slot_override
                if new_slot_override != current_slot_override:
                    changes.append(f"slot_limit_override: {current_slot_override} -> {new_slot_override}")
            except (ValueError, TypeError):
                return web.json_response({"error": "slot_limit_override must be an integer or null."}, status=400)

    # -- Notes, expires_at, and plan (tier) --
    new_notes = current_meta.get("notes")
    new_expires = current_meta.get("expires_at")
    new_plan = current_meta.get("plan")

    if "notes" in body:
        new_notes = body["notes"] if body["notes"] else None
        changes.append("notes updated")
    if "expires_at" in body:
        new_expires = body["expires_at"] if body["expires_at"] else None
        changes.append(f"expires_at: {new_expires}")
    if "plan" in body:
        old_plan = new_plan
        new_plan = body["plan"] if body["plan"] else None
        if new_plan != old_plan:
            changes.append(f"tier: {old_plan} -> {new_plan}")

    # -- If plan changed with an explicit slot override, honour it --
    if "slot_limit_override" not in body and "plan" in body and body.get("plan_slot_limit"):
        # Auto-apply slot from the chosen tier entry when no manual override given
        try:
            tier_slots = int(body["plan_slot_limit"])
            new_slot_override = tier_slots
            new_effective_slot = tier_slots
            changes.append(f"slot_limit: set to {tier_slots} from tier")
        except (ValueError, TypeError):
            pass

    plan_meta = _pack_plan_meta(plan=new_plan, notes=new_notes, expires_at=new_expires)

    # -- Validate and replace identifiers if provided --
    if "steam_ids" in body or "eos_ids" in body:
        steam_ids = body.get("steam_ids", [])
        eos_ids = body.get("eos_ids", [])
        if not isinstance(steam_ids, list) or not isinstance(eos_ids, list):
            return web.json_response({"error": "steam_ids and eos_ids must be arrays."}, status=400)

        errors = []
        for sid in steam_ids:
            if not STEAM64_RE.match(str(sid)):
                errors.append(f"Invalid Steam64 ID: {sid}")
        for eid in eos_ids:
            if not EOSID_RE.match(str(eid)):
                errors.append(f"Invalid EOS ID: {eid}")
        if errors:
            return web.json_response({"error": "Validation failed.", "details": errors}, status=400)

        identifiers = []
        for sid in steam_ids:
            identifiers.append(("steam64", str(sid), False, "admin_web"))
        for eid in eos_ids:
            identifiers.append(("eosid", str(eid), False, "admin_web"))
        await db.replace_identifiers(guild_id, discord_id, wl_id, identifiers)
        changes.append(f"identifiers replaced: {len(steam_ids)} steam, {len(eos_ids)} eos")

    # -- Update user record --
    await db.upsert_user_record(
        guild_id, discord_id, wl_id, current_name, new_status,
        new_effective_slot, plan_meta,
        slot_limit_override=new_slot_override,
    )

    # -- Audit --
    if changes:
        await db.audit(
            guild_id, "admin_update_user", actor_id, discord_id,
            f"Admin updated user {discord_id} in {wl_type}: {'; '.join(changes)}",
            wl_id,
        )

    log.info("Guild %s: admin %s updated user %s/%s: %s", guild_id, actor_id, discord_id, wl_type, changes)

    await _trigger_sync(request, guild_id)

    return web.json_response({"ok": True, "changes": changes})


@require_admin
async def admin_delete_user(request: web.Request) -> web.Response:
    """Remove a user from a whitelist type entirely."""
    session = await aiohttp_session.get_session(request)
    guild_id = int(session["active_guild_id"])
    actor_id = int(session["discord_id"])

    bot = request.app["bot"]
    db = bot.db

    try:
        discord_id = int(request.match_info["discord_id"])
    except (ValueError, TypeError):
        return web.json_response({"error": "Invalid discord_id in URL."}, status=400)

    wl_type = request.match_info["type"]
    wl = await _resolve_whitelist(bot.db, guild_id, wl_type)
    if not wl:
        return web.json_response({"error": "Invalid whitelist type."}, status=400)
    wl_id = wl["id"]

    # -- Check user exists --
    user_record = await db.get_user_record(guild_id, discord_id, wl_id)
    if not user_record:
        return web.json_response({"error": "User not found."}, status=404)

    discord_name = user_record[0]

    # -- Delete identifiers --
    await db.execute(
        "DELETE FROM whitelist_identifiers WHERE guild_id=%s AND discord_id=%s AND whitelist_id=%s",
        (guild_id, discord_id, wl_id),
    )

    # -- Delete user record --
    await db.execute(
        "DELETE FROM whitelist_users WHERE guild_id=%s AND discord_id=%s AND whitelist_id=%s",
        (guild_id, discord_id, wl_id),
    )

    # -- Audit --
    await db.audit(
        guild_id, "admin_delete_user", actor_id, discord_id,
        f"Admin removed user '{discord_name}' (discord_id={discord_id}) from {wl_type}",
        wl_id,
    )

    log.info("Guild %s: admin %s deleted user %s (%s) from %s", guild_id, actor_id, discord_id, discord_name, wl_type)

    await _trigger_sync(request, guild_id)

    return web.json_response({"ok": True, "deleted_discord_id": str(discord_id), "whitelist_type": wl_type})


@require_admin
async def admin_bulk_delete_users(request: web.Request) -> web.Response:
    """Bulk delete users from a whitelist."""
    session = await aiohttp_session.get_session(request)
    guild_id = int(session["active_guild_id"])
    actor_id = int(session["discord_id"])
    bot = request.app["bot"]
    db = bot.db

    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON."}, status=400)

    discord_ids = body.get("discord_ids", [])
    wl_type = body.get("whitelist_slug", "")

    if not discord_ids:
        return web.json_response({"error": "No users specified."}, status=400)

    wl = await _resolve_whitelist(db, guild_id, wl_type) if wl_type else None
    deleted = 0

    for did in discord_ids:
        try:
            did = int(did)
        except (ValueError, TypeError):
            continue

        if wl:
            wl_id = wl["id"]
            await db.execute(
                "DELETE FROM whitelist_identifiers WHERE guild_id=%s AND discord_id=%s AND whitelist_id=%s",
                (guild_id, did, wl_id),
            )
            await db.execute(
                "DELETE FROM whitelist_users WHERE guild_id=%s AND discord_id=%s AND whitelist_id=%s",
                (guild_id, did, wl_id),
            )
        else:
            # Delete from all whitelists
            await db.execute(
                "DELETE FROM whitelist_identifiers WHERE guild_id=%s AND discord_id=%s",
                (guild_id, did),
            )
            await db.execute(
                "DELETE FROM whitelist_users WHERE guild_id=%s AND discord_id=%s",
                (guild_id, did),
            )
        deleted += 1

    await db.audit(
        guild_id, "admin_bulk_delete", actor_id, None,
        f"Bulk deleted {deleted} users from {wl_type or 'all whitelists'}",
        wl["id"] if wl else None,
    )

    log.info("Guild %s: admin %s bulk deleted %d users from %s", guild_id, actor_id, deleted, wl_type or "all")
    await _trigger_sync(request, guild_id)

    return web.json_response({"ok": True, "deleted": deleted})


@require_admin
async def admin_bulk_move_users(request: web.Request) -> web.Response:
    """Move users from one whitelist to another, preserving their identifiers."""
    session = await aiohttp_session.get_session(request)
    guild_id = int(session["active_guild_id"])
    actor_id = int(session["discord_id"])
    bot = request.app["bot"]
    db = bot.db

    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON."}, status=400)

    discord_ids = body.get("discord_ids", [])
    from_slug = body.get("from_whitelist_slug", "")
    to_slug = body.get("to_whitelist_slug", "")

    if not discord_ids:
        return web.json_response({"error": "No users specified."}, status=400)
    if not from_slug or not to_slug:
        return web.json_response({"error": "from_whitelist_slug and to_whitelist_slug are required."}, status=400)
    if from_slug == to_slug:
        return web.json_response({"error": "Source and destination whitelists must be different."}, status=400)

    from_wl = await _resolve_whitelist(db, guild_id, from_slug)
    if not from_wl:
        return web.json_response({"error": f"Source whitelist '{from_slug}' not found."}, status=404)
    to_wl = await _resolve_whitelist(db, guild_id, to_slug)
    if not to_wl:
        return web.json_response({"error": f"Destination whitelist '{to_slug}' not found."}, status=404)

    from_id = from_wl["id"]
    to_id = to_wl["id"]
    moved = 0
    skipped = 0

    for did in discord_ids:
        try:
            did = int(did)
        except (ValueError, TypeError):
            continue

        # Fetch the user record from the source whitelist
        user_record = await db.get_user_record(guild_id, did, from_id)
        if not user_record:
            skipped += 1
            continue

        discord_name = user_record[0]
        status = user_record[1]
        slot_override = user_record[2]
        plan_name = user_record[4]

        # Determine effective slot limit from destination whitelist default
        new_effective = slot_override if slot_override is not None else (to_wl.get("default_slot_limit") or 1)

        # Fetch identifiers from source
        rows = await db.fetchall(
            "SELECT id_type, id_value, is_verified, verification_source FROM whitelist_identifiers "
            "WHERE guild_id=%s AND discord_id=%s AND whitelist_id=%s",
            (guild_id, did, from_id),
        )
        identifiers = [(r[0], r[1], bool(r[2]), r[3] or "admin_web") for r in rows]

        # Upsert user into destination whitelist
        await db.upsert_user_record(
            guild_id, did, to_id, discord_name or "", status,
            new_effective, plan_name or "",
            slot_limit_override=slot_override,
        )

        # Move identifiers: replace in destination
        await db.replace_identifiers(guild_id, did, to_id, identifiers)

        # Remove from source
        await db.execute(
            "DELETE FROM whitelist_identifiers WHERE guild_id=%s AND discord_id=%s AND whitelist_id=%s",
            (guild_id, did, from_id),
        )
        await db.execute(
            "DELETE FROM whitelist_users WHERE guild_id=%s AND discord_id=%s AND whitelist_id=%s",
            (guild_id, did, from_id),
        )
        moved += 1

    await db.audit(
        guild_id, "admin_bulk_move", actor_id, None,
        f"Bulk moved {moved} users from {from_slug} to {to_slug}",
        to_id,
    )

    log.info("Guild %s: admin %s bulk moved %d users from %s to %s", guild_id, actor_id, moved, from_slug, to_slug)
    await _trigger_sync(request, guild_id)

    return web.json_response({"ok": True, "moved": moved, "skipped": skipped})


# ── Admin Setup API routes ───────────────────────────────────────────────────

@require_admin
async def admin_get_settings(request: web.Request) -> web.Response:
    """Return all settings for the active guild."""
    session = await aiohttp_session.get_session(request)
    guild_id = int(session["active_guild_id"])
    bot = request.app["bot"]
    db = bot.db

    # Bot-level settings
    bot_settings = {}
    for key, default in DEFAULT_SETTINGS.items():
        bot_settings[key] = await db.get_setting(guild_id, key, default)

    # Whitelist type configs from whitelists table (seed defaults if empty)
    whitelists = await db.get_whitelists(guild_id)
    if not whitelists:
        await db.seed_guild_defaults(guild_id)
        whitelists = await db.get_whitelists(guild_id)
    type_configs = {}
    for wl in whitelists:
        type_configs[wl["slug"]] = {
            "id": wl["id"],
            "name": wl["name"],
            "slug": wl["slug"],
            "enabled": wl["enabled"],
            "panel_channel_id": wl["panel_channel_id"],
            "panel_message_id": wl["panel_message_id"],
            "log_channel_id": wl["log_channel_id"],
            "output_filename": wl["output_filename"],
            "default_slot_limit": wl["default_slot_limit"],
            "stack_roles": wl["stack_roles"],
            "squad_group": wl["squad_group"],
            "is_default": wl["is_default"],
        }

    # Build live role name lookup from Discord API
    role_name_map: dict[str, str] = {}  # role_id_str -> live name
    try:
        if hasattr(bot, "get_roles"):
            raw_roles = await bot.get_roles(guild_id)
            for r in raw_roles:
                role_name_map[str(r["id"])] = r.get("name", "")
        elif hasattr(bot, "get_guild"):
            guild = bot.get_guild(guild_id)
            if guild:
                for r in guild.roles:
                    role_name_map[str(r.id)] = r.name
    except Exception:
        pass  # Fall back to DB-stored names

    # Role mappings per type (resolve names from Discord)
    role_mappings = {}
    for wl in whitelists:
        wl_id = wl["id"]
        wl_slug = wl["slug"]
        rows = await db.fetchall(
            "SELECT id, role_id, role_name, slot_limit, is_active "
            "FROM role_mappings WHERE guild_id=%s AND whitelist_id=%s "
            "ORDER BY role_name",
            (guild_id, wl_id),
        )
        role_mappings[wl_slug] = [
            {
                "id": row[0],
                "role_id": str(row[1]),
                "role_name": role_name_map.get(str(row[1]), row[2] or str(row[1])),
                "slot_limit": row[3],
                "is_active": bool(row[4]),
            }
            for row in (rows or [])
        ]

    # Squad groups
    squad_rows = await db.fetchall(
        "SELECT DISTINCT squad_group FROM whitelists "
        "WHERE guild_id=%s AND squad_group IS NOT NULL AND squad_group != ''",
        (guild_id,),
    )
    squad_groups = [row[0] for row in (squad_rows or [])]

    # Tier categories with entries
    tier_categories_raw = await db.get_tier_categories(guild_id)
    tier_categories = []
    for cat in tier_categories_raw:
        entries_raw = await db.get_tier_entries(guild_id, cat["id"])
        entries = []
        for e in entries_raw:
            entries.append({
                "id": e[0],
                "role_id": str(e[1]),
                "role_name": role_name_map.get(str(e[1]), e[2] or str(e[1])),
                "slot_limit": e[3],
                "display_name": e[4],
                "sort_order": e[5],
                "is_active": bool(e[6]),
            })
        tier_categories.append({
            "id": cat["id"],
            "name": cat["name"],
            "description": cat["description"],
            "is_default": cat["is_default"],
            "entries": entries,
        })

    return web.json_response({
        "bot_settings": bot_settings,
        "type_configs": type_configs,
        "role_mappings": role_mappings,
        "squad_groups": squad_groups,
        "squad_permissions": SQUAD_PERMISSIONS,
        "tier_categories": tier_categories,
    })


@require_admin
async def admin_update_settings(request: web.Request) -> web.Response:
    """Update global bot settings for the active guild."""
    session = await aiohttp_session.get_session(request)
    guild_id = int(session["active_guild_id"])
    bot = request.app["bot"]
    db = bot.db

    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON body."}, status=400)

    if not isinstance(body, dict) or not body:
        return web.json_response({"error": "Body must be a non-empty JSON object."}, status=400)

    allowed_keys = set(DEFAULT_SETTINGS.keys())
    updated = []
    for key, value in body.items():
        if key not in allowed_keys:
            return web.json_response({"error": f"Unknown setting: {key}"}, status=400)
        await db.set_setting(guild_id, key, str(value))
        updated.append(key)

    log.info("Guild %s: admin updated settings %s", guild_id, updated)
    return web.json_response({"ok": True, "updated": updated})


@require_admin
async def admin_update_type(request: web.Request) -> web.Response:
    """Update a whitelist type configuration."""
    session = await aiohttp_session.get_session(request)
    guild_id = int(session["active_guild_id"])
    wl_type = request.match_info["type"]

    bot = request.app["bot"]
    db = bot.db

    wl = await _resolve_whitelist(bot.db, guild_id, wl_type)
    if not wl:
        return web.json_response({"error": "Invalid whitelist type."}, status=400)
    wl_id = wl["id"]

    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON body."}, status=400)

    if not isinstance(body, dict) or not body:
        return web.json_response({"error": "Body must be a non-empty JSON object."}, status=400)

    # Map old field names to new whitelists table columns
    field_renames = {
        "github_filename": "output_filename",
    }
    # Fields that no longer exist in the new schema (silently ignored)
    dropped_fields = {"github_enabled", "input_mode"}

    allowed_columns = {
        "name", "slug", "enabled", "panel_channel_id", "log_channel_id",
        "output_filename", "stack_roles", "default_slot_limit",
        "squad_group", "panel_message_id",
    }

    # Build the update kwargs
    update_kwargs = {}
    for key, value in body.items():
        if key in dropped_fields:
            continue
        mapped_key = field_renames.get(key, key)
        if mapped_key not in allowed_columns:
            return web.json_response({"error": f"Unknown type config field: {key}"}, status=400)
        # Coerce types (boolean coercion handled by update_whitelist)
        bool_columns = {"enabled", "stack_roles"}
        int_columns = {"default_slot_limit", "panel_channel_id", "log_channel_id", "panel_message_id"}
        if mapped_key in bool_columns:
            value = bool(value) if not isinstance(value, bool) else value
        elif mapped_key in int_columns and value is not None:
            value = int(value) if str(value).strip() else None
        else:
            value = str(value) if value is not None else value
        update_kwargs[mapped_key] = value

    if update_kwargs:
        await db.update_whitelist(wl_id, **update_kwargs)

    log.info("Guild %s: admin updated type config %s: %s", guild_id, wl_type, list(body.keys()))
    return web.json_response({"ok": True, "type": wl_type, "updated": list(body.keys())})


@require_admin
async def admin_toggle_type(request: web.Request) -> web.Response:
    """Quick toggle enable/disable for a whitelist type."""
    session = await aiohttp_session.get_session(request)
    guild_id = int(session["active_guild_id"])
    wl_type = request.match_info["type"]

    bot = request.app["bot"]
    db = bot.db

    wl = await _resolve_whitelist(bot.db, guild_id, wl_type)
    if not wl:
        return web.json_response({"error": "Invalid whitelist type."}, status=400)
    wl_id = wl["id"]

    new_enabled = not wl["enabled"]
    await db.update_whitelist(wl_id, enabled=new_enabled)

    log.info("Guild %s: admin toggled type %s -> %s", guild_id, wl_type, new_enabled)
    await _trigger_sync(request, guild_id)
    return web.json_response({"ok": True, "type": wl_type, "enabled": new_enabled})


@require_admin
async def admin_add_role(request: web.Request) -> web.Response:
    """Add a role mapping for a whitelist type."""
    session = await aiohttp_session.get_session(request)
    guild_id = int(session["active_guild_id"])
    wl_type = request.match_info["type"]

    bot = request.app["bot"]
    db = bot.db

    wl = await _resolve_whitelist(bot.db, guild_id, wl_type)
    if not wl:
        return web.json_response({"error": "Invalid whitelist type."}, status=400)
    wl_id = wl["id"]

    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON body."}, status=400)

    role_id = body.get("role_id")
    role_name = body.get("role_name", "")
    slot_limit = body.get("slot_limit", 1)

    if not role_id:
        return web.json_response({"error": "role_id is required."}, status=400)

    try:
        role_id = int(role_id)
    except (ValueError, TypeError):
        return web.json_response({"error": "role_id must be numeric."}, status=400)

    try:
        slot_limit = int(slot_limit)
    except (ValueError, TypeError):
        return web.json_response({"error": "slot_limit must be an integer."}, status=400)

    # Check for duplicate
    dup = await db.fetchone(
        "SELECT id FROM role_mappings WHERE guild_id=%s AND whitelist_id=%s AND role_id=%s",
        (guild_id, wl_id, role_id),
    )
    if dup:
        return web.json_response({"error": "Role mapping already exists for this type."}, status=409)

    now = utcnow()
    is_active_val = True if db.engine == "postgres" else 1
    await db.execute(
        "INSERT INTO role_mappings (guild_id, whitelist_type, whitelist_id, role_id, role_name, slot_limit, is_active, created_at) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
        (guild_id, wl_type, wl_id, role_id, role_name, slot_limit, is_active_val, now),
    )

    log.info("Guild %s: admin added role %s (%s) to type %s with %d slots",
             guild_id, role_id, role_name, wl_type, slot_limit)
    return web.json_response({
        "ok": True,
        "role_id": role_id,
        "role_name": role_name,
        "slot_limit": slot_limit,
    })


@require_admin
async def admin_delete_role(request: web.Request) -> web.Response:
    """Remove a role mapping for a whitelist type."""
    session = await aiohttp_session.get_session(request)
    guild_id = int(session["active_guild_id"])
    wl_type = request.match_info["type"]
    try:
        role_id = int(request.match_info["role_id"])
    except (ValueError, TypeError):
        return web.json_response({"error": "Invalid role_id."}, status=400)

    bot = request.app["bot"]
    db = bot.db

    wl = await _resolve_whitelist(bot.db, guild_id, wl_type)
    if not wl:
        return web.json_response({"error": "Invalid whitelist type."}, status=400)
    wl_id = wl["id"]

    existing = await db.fetchone(
        "SELECT id FROM role_mappings WHERE guild_id=%s AND whitelist_id=%s AND role_id=%s",
        (guild_id, wl_id, role_id),
    )
    if not existing:
        return web.json_response({"error": "Role mapping not found."}, status=404)

    await db.execute(
        "DELETE FROM role_mappings WHERE guild_id=%s AND whitelist_id=%s AND role_id=%s",
        (guild_id, wl_id, role_id),
    )

    log.info("Guild %s: admin deleted role %s from type %s", guild_id, role_id, wl_type)
    return web.json_response({"ok": True, "deleted_role_id": role_id})


@require_admin
async def admin_get_channels(request: web.Request) -> web.Response:
    """Return list of text channels in the guild.

    Works with both the full Discord bot (gateway cache) and the
    standalone web service (REST API).
    """
    session = await aiohttp_session.get_session(request)
    guild_id = int(session["active_guild_id"])
    bot = request.app["bot"]

    # Standalone web service provides get_channels() via REST
    if hasattr(bot, "get_channels"):
        raw_channels = await bot.get_channels(guild_id)
        channels = []
        for ch in raw_channels:
            channels.append({
                "id": str(ch["id"]),
                "name": ch.get("name", ""),
                "category": None,  # REST doesn't group by category easily
            })
        channels.sort(key=lambda c: c["name"])
        return web.json_response({"channels": channels})

    # Full bot mode — use gateway cache
    import discord
    guild = bot.get_guild(guild_id)
    if not guild:
        return web.json_response({"error": "Guild not found in bot cache."}, status=404)

    channels = []
    for ch in guild.channels:
        if isinstance(ch, discord.TextChannel):
            channels.append({
                "id": str(ch.id),
                "name": ch.name,
                "category": ch.category.name if ch.category else None,
            })
    channels.sort(key=lambda c: (c["category"] or "", c["name"]))

    return web.json_response({"channels": channels})


@require_admin
async def admin_get_roles(request: web.Request) -> web.Response:
    """Return list of roles in the guild.

    Works with both the full Discord bot (gateway cache) and the
    standalone web service (REST API).
    """
    session = await aiohttp_session.get_session(request)
    guild_id = int(session["active_guild_id"])
    bot = request.app["bot"]

    # Standalone web service provides get_roles() via REST
    if hasattr(bot, "get_roles"):
        raw_roles = await bot.get_roles(guild_id)
        roles = []
        for r in raw_roles:
            roles.append({
                "id": str(r["id"]),
                "name": r.get("name", ""),
                "color": str(r.get("color", 0)),
                "position": r.get("position", 0),
            })
        roles.sort(key=lambda r: -r["position"])
        return web.json_response({"roles": roles})

    # Full bot mode — use gateway cache
    guild = bot.get_guild(guild_id)
    if not guild:
        return web.json_response({"error": "Guild not found in bot cache."}, status=404)

    roles = []
    for role in guild.roles:
        if role.is_default():
            continue
        roles.append({
            "id": str(role.id),
            "name": role.name,
            "color": str(role.color),
            "position": role.position,
        })
    roles.sort(key=lambda r: -r["position"])

    return web.json_response({"roles": roles})


# ── Health / Resync / Report / Import / Export API routes ─────────────────

@require_admin
async def admin_health(request: web.Request) -> web.Response:
    """Health check returning alerts for the active guild."""
    session = await aiohttp_session.get_session(request)
    guild_id = int(session["active_guild_id"])
    bot = request.app["bot"]
    db = bot.db

    alerts: list[dict] = []

    # Check panels for missing config
    panels = await db.get_panels(guild_id)
    for panel in panels:
        if not panel.get("enabled", True):
            continue
        panel_name = panel["name"]
        if not panel.get("channel_id"):
            alerts.append({
                "level": "warning",
                "message": f"Panel '{panel_name}' has no channel configured",
            })
        if not panel.get("log_channel_id"):
            alerts.append({
                "level": "info",
                "message": f"Panel '{panel_name}' has no log channel (optional)",
            })
        if not panel.get("whitelist_id"):
            alerts.append({
                "level": "warning",
                "message": f"Panel '{panel_name}' has no whitelist linked",
            })
        if not panel.get("tier_category_id"):
            alerts.append({
                "level": "warning",
                "message": f"Panel '{panel_name}' has no tier category assigned",
            })
        else:
            # Check if the tier category has entries
            entries = await db.get_tier_entries(guild_id, panel["tier_category_id"])
            if not entries:
                alerts.append({
                    "level": "warning",
                    "message": f"Panel '{panel_name}' tier category has no role entries",
                })

    # Duplicate Steam IDs across different whitelists
    dup_rows = await db.fetchall(
        "SELECT i.id_value, GROUP_CONCAT(DISTINCT w.slug) AS types, COUNT(DISTINCT i.whitelist_id) AS cnt "
        "FROM whitelist_identifiers i "
        "JOIN whitelists w ON w.id = i.whitelist_id "
        "WHERE i.guild_id=%s AND i.id_type='steam64' "
        "GROUP BY i.id_value HAVING cnt > 1"
        if db.engine != "postgres" else
        "SELECT i.id_value, STRING_AGG(DISTINCT w.slug, ',') AS types, COUNT(DISTINCT i.whitelist_id) AS cnt "
        "FROM whitelist_identifiers i "
        "JOIN whitelists w ON w.id = i.whitelist_id "
        "WHERE i.guild_id=%s AND i.id_type='steam64' "
        "GROUP BY i.id_value HAVING COUNT(DISTINCT i.whitelist_id) > 1",
        (guild_id,),
    )
    for row in (dup_rows or []):
        alerts.append({
            "level": "warning",
            "message": f"Duplicate Steam ID {row[0]} found in {row[1]}",
        })

    # Entries expiring within 7 days
    expiring_count = 0
    all_users = await db.fetchall(
        "SELECT last_plan_name FROM whitelist_users "
        "WHERE guild_id=%s AND status='active' AND last_plan_name IS NOT NULL AND last_plan_name != ''",
        (guild_id,),
    )
    now = datetime.now(timezone.utc)
    seven_days = now + timedelta(days=7)
    for (raw_plan,) in (all_users or []):
        meta = _unpack_plan_meta(raw_plan)
        exp = meta.get("expires_at")
        if exp:
            try:
                exp_dt = datetime.fromisoformat(exp.replace("Z", "+00:00"))
                if now <= exp_dt <= seven_days:
                    expiring_count += 1
            except (ValueError, TypeError):
                pass
    if expiring_count > 0:
        alerts.append({
            "level": "info",
            "message": f"{expiring_count} entries expiring within 7 days",
        })

    return web.json_response({"alerts": alerts})


@require_admin
async def admin_resync(request: web.Request) -> web.Response:
    """Trigger whitelist file regeneration for all guilds the user has access to."""
    session = await aiohttp_session.get_session(request)
    guild_id = int(session.get("active_guild_id", 0))
    if guild_id:
        await _trigger_sync(request, guild_id)
    return web.json_response({"ok": True, "message": "Whitelist sync triggered"})


@require_admin
async def admin_report(request: web.Request) -> web.Response:
    """Trigger report generation."""
    bot = request.app["bot"]
    if hasattr(bot, "schedule_report"):
        try:
            bot.schedule_report()
        except Exception:
            log.warning("schedule_report call failed")
    else:
        log.info("Report requested but schedule_report not available")
    return web.json_response({"ok": True, "message": "Report generation triggered"})


PLAN_SLOT_MAP = {
    "solo": 1, "single": 1, "basic": 1, "1": 1,
    "duo": 2, "double": 2, "pair": 2, "2": 2,
    "trio": 3, "triple": 3, "3": 3,
    "squad": 4, "quad": 4, "family": 4, "4": 4,
    "5": 5, "6": 6, "7": 7, "8": 8, "9": 9, "10": 10,
}


# Column auto-detection name sets for CSV headers
_AUTO_DETECT_MAP = {
    "discord_name": {"discord_name", "name", "player", "playername", "player_name",
                     "username", "user_name", "user"},
    "discord_id": {"discord_id", "discordid", "discord_user_id"},
    "steam64": {"steam64", "steamid", "steam_id", "steam64id", "steam64_id", "steam"},
    "eos_id": {"eos_id", "eosid", "eos", "eos_player_id"},
    "plan": {"plan", "plan_name", "role", "tier", "subscription"},
    "notes": {"notes", "note", "comment", "comments", "admin_notes"},
}


def _auto_detect_column_map(fieldnames: list[str]) -> dict[str, str]:
    """Auto-detect which CSV columns map to which internal fields.

    Returns a dict like {"Username": "discord_name", "Steam64ID": "steam64", ...}
    mapping original column name -> our field name.
    """
    result: dict[str, str] = {}
    for fn in fieldnames:
        lower = fn.strip().lower().replace(" ", "_")
        matched = False
        for field, aliases in _AUTO_DETECT_MAP.items():
            if lower in aliases:
                result[fn] = field
                matched = True
                break
        if not matched:
            result[fn] = "skip"
    return result


def _parse_csv_headers(data: str) -> list[str]:
    """Read just the header row from CSV data and return the column names."""
    reader = csv.DictReader(io.StringIO(data))
    return list(reader.fieldnames) if reader.fieldnames else []


def _parse_csv_data(data: str, guild_id: int, wl_type: str, existing_steam_ids: set,
                    column_map: dict[str, str] | None = None) -> tuple[list[dict], dict]:
    """Parse CSV data and return (rows, summary).

    If column_map is provided, it maps original CSV column names to our fields:
      {"Username": "discord_name", "Steam64ID": "steam64", "Plan": "plan", ...}
    If column_map is None, auto-detect using flexible column name matching.
    """
    reader = csv.DictReader(io.StringIO(data))
    if not reader.fieldnames:
        return [], {"total": 0, "new": 0, "duplicate": 0, "invalid": 0}

    # Build reverse map: our_field -> csv_column_name
    if column_map is not None:
        # column_map: {"CSV Col": "our_field", ...}
        rev: dict[str, str] = {}
        for csv_col, our_field in column_map.items():
            if our_field != "skip" and csv_col in reader.fieldnames:
                rev[our_field] = csv_col
    else:
        # Auto-detect (backward compat)
        auto = _auto_detect_column_map(reader.fieldnames)
        rev = {}
        for csv_col, our_field in auto.items():
            if our_field != "skip":
                rev[our_field] = csv_col

    rows: list[dict] = []
    summary = {"total": 0, "new": 0, "duplicate": 0, "invalid": 0}

    for line in reader:
        summary["total"] += 1
        discord_name = line.get(rev.get("discord_name", ""), "").strip()
        discord_id = line.get(rev.get("discord_id", ""), "").strip()
        raw_steam = line.get(rev.get("steam64", ""), "").strip()
        raw_eos = line.get(rev.get("eos_id", ""), "").strip()
        plan = line.get(rev.get("plan", ""), "").strip()
        notes = line.get(rev.get("notes", ""), "").strip()

        steam_ids = [s.strip() for s in raw_steam.split(";") if s.strip()] if raw_steam else []
        eos_ids = [e.strip() for e in raw_eos.split(";") if e.strip()] if raw_eos else []

        # Validate
        valid = True
        for sid in steam_ids:
            if not STEAM64_RE.match(sid):
                valid = False
        for eid in eos_ids:
            if not EOSID_RE.match(eid):
                valid = False

        if not valid or (not steam_ids and not eos_ids):
            summary["invalid"] += 1
            rows.append({
                "discord_name": discord_name or "(unknown)",
                "steam_ids": steam_ids,
                "eos_ids": eos_ids,
                "plan": plan,
                "notes": notes,
                "status": "invalid",
            })
            continue

        is_dup = any(sid in existing_steam_ids for sid in steam_ids)
        status = "duplicate" if is_dup else "new"
        summary[status] += 1
        rows.append({
            "discord_name": discord_name or "(unknown)",
            "discord_id": discord_id,
            "steam_ids": steam_ids,
            "eos_ids": eos_ids,
            "plan": plan,
            "notes": notes,
            "status": status,
        })

    return rows, summary


def _group_rows_by_user(rows: list[dict], default_slot_limit: int,
                        existing_discord_ids: set[int],
                        plan_map: dict[str, int] | None = None) -> list[dict]:
    """Group parsed rows by Discord ID (or Discord Name if no ID).

    Aggregates all Steam IDs and EOS IDs per user. Determines slot_limit
    from plan_map (user-defined), then PLAN_SLOT_MAP (built-in), then default.
    """
    groups: dict[str, dict] = {}  # key -> aggregated user dict

    for row in rows:
        if row.get("status") == "invalid":
            continue

        discord_id = row.get("discord_id", "").strip()
        discord_name = row.get("discord_name", "(unknown)")

        # Group key: prefer discord_id, fall back to discord_name
        key = discord_id if discord_id else f"name:{discord_name}"

        if key not in groups:
            groups[key] = {
                "discord_name": discord_name,
                "discord_id": discord_id,
                "plan": row.get("plan", ""),
                "notes": row.get("notes", ""),
                "steam_ids": [],
                "eos_ids": [],
            }
        else:
            # Update name if we didn't have one
            if not groups[key]["discord_name"] or groups[key]["discord_name"] == "(unknown)":
                groups[key]["discord_name"] = discord_name
            # Use the first non-empty plan
            if not groups[key]["plan"] and row.get("plan"):
                groups[key]["plan"] = row["plan"]
            if not groups[key]["notes"] and row.get("notes"):
                groups[key]["notes"] = row["notes"]

        # Aggregate IDs (deduplicate)
        for sid in row.get("steam_ids", []):
            if sid not in groups[key]["steam_ids"]:
                groups[key]["steam_ids"].append(sid)
        for eid in row.get("eos_ids", []):
            if eid not in groups[key]["eos_ids"]:
                groups[key]["eos_ids"].append(eid)

    # Build final user list with slot_limit and status
    users: list[dict] = []
    for user in groups.values():
        plan = user["plan"]
        plan_lower = plan.strip().lower() if plan else ""
        # Check user-provided plan_map first (exact match), then built-in, then default
        slot_limit = default_slot_limit
        if plan_map and plan in plan_map:
            slot_limit = plan_map[plan]
        elif plan_lower in PLAN_SLOT_MAP:
            slot_limit = PLAN_SLOT_MAP[plan_lower]

        # Determine status
        try:
            did = int(user["discord_id"]) if user["discord_id"] else 0
        except (ValueError, TypeError):
            did = 0
        status = "existing" if did in existing_discord_ids else "new"

        users.append({
            "discord_name": user["discord_name"],
            "discord_id": user["discord_id"],
            "plan": plan,
            "slot_limit": slot_limit,
            "steam_ids": user["steam_ids"],
            "eos_ids": user["eos_ids"],
            "notes": user["notes"],
            "status": status,
        })

    return users


_STEAM64_RE = re.compile(r"^\d{17}$")
_EOS_RE = re.compile(r"^[0-9a-f]{32}$", re.IGNORECASE)
_DISCORD_ID_RE = re.compile(r"^\d{17,20}$")


def _detect_format(data: str) -> str:
    """Sniff the data format: squad_cfg, plain_ids, discord_members, or csv."""
    non_blank = 0
    plain_id_lines = 0
    discord_member_lines = 0  # "Name,DiscordID" or "Name - DiscordID"

    for line in data.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("//") or stripped.startswith("#"):
            continue
        # Squad CFG: first non-comment line has Admin= or Group=
        if re.match(r"^(Admin|Group)\s*=", stripped, re.IGNORECASE):
            return "squad_cfg"
        non_blank += 1
        # Plain ID: entire line is a Steam64 or EOS ID
        if _STEAM64_RE.match(stripped) or _EOS_RE.match(stripped):
            plain_id_lines += 1
        # Discord member list: "Name,ID" or "Name - ID" where ID is a large int
        elif re.match(r"^.+[,\-–]\s*\d{17,20}\s*$", stripped):
            discord_member_lines += 1
        if non_blank >= 6:
            break

    if non_blank > 0:
        if plain_id_lines == non_blank:
            return "plain_ids"
        if discord_member_lines >= max(1, non_blank - 1):  # allow 1 header row
            return "discord_members"
    return "csv"


def _parse_plain_ids(data: str, existing_steam_ids: set) -> tuple[list[dict], dict]:
    """Parse a bare list of Steam64 or EOS IDs, one per line."""
    rows: list[dict] = []
    summary = {"total": 0, "new": 0, "duplicate": 0, "invalid": 0}

    for raw_line in data.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("//") or line.startswith("#"):
            continue
        summary["total"] += 1
        if _STEAM64_RE.match(line):
            status = "duplicate" if line in existing_steam_ids else "new"
            summary[status] += 1
            rows.append({
                "discord_name": "", "discord_id": "",
                "steam_ids": [line], "eos_ids": [],
                "plan": "", "notes": "", "status": status,
            })
        elif _EOS_RE.match(line):
            summary["new"] += 1
            rows.append({
                "discord_name": "", "discord_id": "",
                "steam_ids": [], "eos_ids": [line.lower()],
                "plan": "", "notes": "", "status": "new",
            })
        else:
            summary["invalid"] += 1

    return rows, summary


def _parse_discord_member_list(data: str) -> list[dict]:
    """Parse a Discord member list into {discord_name, discord_id} dicts.

    Accepts lines like:
      username,123456789012345678
      username - 123456789012345678
      username#1234,123456789012345678
    Returns list of {discord_name, discord_id} — no Steam/EOS IDs.
    """
    members = []
    for raw_line in data.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or line.startswith("//"):
            continue
        # Split on comma or dash/en-dash
        parts = re.split(r"[,\-–]", line, maxsplit=1)
        if len(parts) != 2:
            continue
        name_part = parts[0].strip()
        id_part = parts[1].strip()
        if _DISCORD_ID_RE.match(id_part):
            # Strip discriminator (#1234) from name
            name = re.sub(r"#\d{1,4}$", "", name_part).strip()
            members.append({"discord_name": name, "discord_id": id_part})
    return members


def _parse_squad_cfg_data(data: str, existing_steam_ids: set) -> tuple[list[dict], dict]:
    """Parse Squad RemoteAdminList / cfg format.

    Lines like: Admin=76561198012345678:reserve // PlayerName
    """
    rows: list[dict] = []
    summary = {"total": 0, "new": 0, "duplicate": 0, "invalid": 0}

    admin_re = re.compile(
        r"^Admin\s*=\s*(\d{17,19})\s*:\s*[^\s/]+(?:\s*//+\s*(.*))?$", re.IGNORECASE,
    )

    for raw_line in data.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("//") or line.lower().startswith("group="):
            continue
        m = admin_re.match(line)
        if not m:
            summary["total"] += 1
            summary["invalid"] += 1
            rows.append({
                "discord_name": line[:60],
                "steam_ids": [],
                "eos_ids": [],
                "status": "invalid",
            })
            continue

        summary["total"] += 1
        steam_id = m.group(1)
        name = (m.group(2) or "").strip() or "(unknown)"

        if not STEAM64_RE.match(steam_id):
            summary["invalid"] += 1
            rows.append({
                "discord_name": name,
                "steam_ids": [steam_id],
                "eos_ids": [],
                "status": "invalid",
            })
            continue

        is_dup = steam_id in existing_steam_ids
        status = "duplicate" if is_dup else "new"
        summary[status] += 1
        rows.append({
            "discord_name": name,
            "steam_ids": [steam_id],
            "eos_ids": [],
            "status": status,
        })

    return rows, summary


async def _get_existing_steam_ids(db, guild_id: int, wl_id: int) -> set:
    """Return set of all steam64 IDs already in the guild+whitelist."""
    rows = await db.fetchall(
        "SELECT id_value FROM whitelist_identifiers "
        "WHERE guild_id=%s AND whitelist_id=%s AND id_type='steam64'",
        (guild_id, wl_id),
    )
    return {row[0] for row in (rows or [])}


@require_admin
async def admin_import_headers(request: web.Request) -> web.Response:
    """Step 1: Upload/paste data and return the CSV column headers found.

    Accepts multipart (file upload) or JSON (paste_data).
    Returns {"headers": ["Col1", "Col2", ...], "auto_map": {"Col1": "discord_name", ...}}
    """
    session = await aiohttp_session.get_session(request)

    content_type = request.content_type or ""
    data = ""
    if "multipart" in content_type:
        reader = await request.multipart()
        while True:
            part = await reader.next()
            if part is None:
                break
            if part.name in ("data", "file", "paste_data"):
                data = (await part.read(decode=True)).decode("utf-8", errors="replace")
    else:
        try:
            body = await request.json()
        except Exception:
            return web.json_response({"error": "Invalid request body."}, status=400)
        data = body.get("data", "") or body.get("paste_data", "")

    if not data:
        return web.json_response({"error": "No data provided."}, status=400)

    headers = _parse_csv_headers(data)
    if not headers:
        return web.json_response({"error": "Could not detect any CSV columns."}, status=400)

    auto_map = _auto_detect_column_map(headers)

    return web.json_response({"headers": headers, "auto_map": auto_map})


@require_admin
async def admin_import_preview(request: web.Request) -> web.Response:
    """Step 3: Preview import data grouped by user with column mapping.

    Accepts the column_map dict along with data and whitelist type.
    Returns grouped users with slot_limit derived from plan field and optional plan_map.
    """
    session = await aiohttp_session.get_session(request)
    guild_id = int(session["active_guild_id"])
    bot = request.app["bot"]
    db = bot.db

    plan_map = None  # Optional: {plan_name: slot_count} from plan mapping step

    # Accept multipart or JSON
    content_type = request.content_type or ""
    if "multipart" in content_type:
        reader = await request.multipart()
        data = ""
        fmt = "csv"
        wl_type = ""
        column_map_raw = ""
        while True:
            part = await reader.next()
            if part is None:
                break
            if part.name in ("data", "file", "paste_data", "content"):
                data = (await part.read(decode=True)).decode("utf-8", errors="replace")
            elif part.name == "format":
                fmt = (await part.read(decode=True)).decode().strip()
            elif part.name in ("whitelist_type", "type", "whitelist_slug"):
                wl_type = (await part.read(decode=True)).decode().strip()
            elif part.name == "column_map":
                column_map_raw = (await part.read(decode=True)).decode().strip()
            elif part.name in ("duplicate_handling", "duplicate_mode"):
                pass  # Used in import, not preview
    else:
        try:
            body = await request.json()
        except Exception:
            return web.json_response({"error": "Invalid request body."}, status=400)
        data = body.get("data", "") or body.get("paste_data", "") or body.get("content", "")
        fmt = body.get("format", "csv")
        wl_type = body.get("whitelist_type", "") or body.get("type", "") or body.get("whitelist_slug", "")
        column_map_raw = ""
        if "column_map" in body:
            column_map_raw = json.dumps(body["column_map"]) if isinstance(body["column_map"], dict) else body["column_map"]
        if isinstance(body.get("plan_map"), dict):
            plan_map = {k: int(v) for k, v in body["plan_map"].items()}

    # Normalise format aliases sent from the frontend
    _VALID_FMTS = ("csv", "squad_cfg", "plain_ids", "discord_members")
    if fmt == "cfg":
        fmt = "squad_cfg"
    elif fmt == "auto":
        fmt = _detect_format(data)
    elif fmt not in _VALID_FMTS:
        fmt = "csv"

    if not data:
        return web.json_response({"error": "No data provided."}, status=400)
    wl = await _resolve_whitelist(bot.db, guild_id, wl_type)
    if not wl:
        valid_slugs = await _get_whitelist_slugs(bot.db, guild_id)
        return web.json_response({"error": f"Invalid whitelist_type. Must be one of: {', '.join(valid_slugs)}"}, status=400)
    wl_id = wl["id"]

    # Parse column_map if provided
    column_map: dict[str, str] | None = None
    if column_map_raw:
        try:
            column_map = json.loads(column_map_raw)
        except (json.JSONDecodeError, TypeError):
            return web.json_response({"error": "Invalid column_map JSON."}, status=400)

    existing_steam = await _get_existing_steam_ids(db, guild_id, wl_id)

    if fmt == "squad_cfg":
        rows, raw_summary = _parse_squad_cfg_data(data, existing_steam)
    elif fmt == "plain_ids":
        rows, raw_summary = _parse_plain_ids(data, existing_steam)
    elif fmt == "discord_members":
        # Discord member list has no Steam/EOS IDs — not useful for import preview
        return web.json_response({"error": "Use the Reconcile tab to match a Discord member list."}, status=400)
    else:
        rows, raw_summary = _parse_csv_data(data, guild_id, wl_type, existing_steam, column_map=column_map)

    # Get existing users (id + name) for this whitelist
    existing_users_rows = await db.fetchall(
        "SELECT discord_id, discord_name FROM whitelist_users WHERE guild_id=%s AND whitelist_id=%s",
        (guild_id, wl_id),
    )
    existing_discord_ids: set[int] = {row[0] for row in (existing_users_rows or [])}
    existing_name_map: list[tuple[str, int]] = [
        (row[1], row[0]) for row in (existing_users_rows or []) if row[0] > 0 and row[1]
    ]

    default_slot = wl["default_slot_limit"] or 1
    users = _group_rows_by_user(rows, default_slot, existing_discord_ids, plan_map=plan_map)

    # For entries with no discord_id, attempt name-based matching against existing users
    NAME_MATCH_THRESHOLD = 0.80
    for u in users:
        raw_did = u.get("discord_id", "")
        try:
            did = int(raw_did) if raw_did else 0
        except (ValueError, TypeError):
            did = 0
        if did == 0 and u.get("discord_name") and u["discord_name"] != "(unknown)" and existing_name_map:
            best_score = 0.0
            best_did = 0
            best_name = ""
            for ex_name, ex_did in existing_name_map:
                score = _reconcile_score(u["discord_name"], ex_name)
                if score > best_score:
                    best_score = score
                    best_did = ex_did
                    best_name = ex_name
            if best_score >= NAME_MATCH_THRESHOLD:
                u["discord_id"] = str(best_did)
                u["matched_name"] = best_name
                u["match_score"] = round(best_score, 2)
                u["status"] = "existing" if best_did in existing_discord_ids else "new"

    # Build summary
    total_users = len(users)
    total_ids = sum(len(u["steam_ids"]) + len(u["eos_ids"]) for u in users)
    new_count = sum(1 for u in users if u["status"] == "new")
    existing_count = sum(1 for u in users if u["status"] == "existing")
    invalid_count = raw_summary.get("invalid", 0)

    summary = {
        "total_users": total_users,
        "total_ids": total_ids,
        "new": new_count,
        "existing": existing_count,
        "invalid": invalid_count,
    }

    return web.json_response({"users": users, "summary": summary})


@require_admin
async def admin_import(request: web.Request) -> web.Response:
    """Step 4: Execute the import, creating proper whitelist_users and whitelist_identifiers records.

    Accepts column_map and groups rows by user before importing.
    Duplicate handling: skip, overwrite, merge.
    """
    session = await aiohttp_session.get_session(request)
    guild_id = int(session["active_guild_id"])
    actor_id = int(session["discord_id"])
    bot = request.app["bot"]
    db = bot.db

    plan_map = None  # Optional plan→slot mapping from plan mapping step

    # Accept multipart or JSON
    content_type = request.content_type or ""
    if "multipart" in content_type:
        reader = await request.multipart()
        data = ""
        fmt = "csv"
        wl_type = ""
        dup_handling = "skip"
        column_map_raw = ""
        while True:
            part = await reader.next()
            if part is None:
                break
            if part.name in ("data", "file", "paste_data", "content"):
                data = (await part.read(decode=True)).decode("utf-8", errors="replace")
            elif part.name == "format":
                fmt = (await part.read(decode=True)).decode().strip()
            elif part.name in ("whitelist_type", "type", "whitelist_slug"):
                wl_type = (await part.read(decode=True)).decode().strip()
            elif part.name in ("duplicate_handling", "duplicate_mode"):
                dup_handling = (await part.read(decode=True)).decode().strip()
            elif part.name == "column_map":
                column_map_raw = (await part.read(decode=True)).decode().strip()
    else:
        try:
            body = await request.json()
        except Exception:
            return web.json_response({"error": "Invalid request body."}, status=400)
        data = body.get("data", "") or body.get("paste_data", "") or body.get("content", "")
        fmt = body.get("format", "csv")
        wl_type = body.get("whitelist_type", "") or body.get("type", "") or body.get("whitelist_slug", "")
        dup_handling = body.get("duplicate_handling", "") or body.get("duplicate_mode", "skip")
        column_map_raw = ""
        if "column_map" in body:
            column_map_raw = json.dumps(body["column_map"]) if isinstance(body["column_map"], dict) else body["column_map"]
        plan_map = None
        if isinstance(body.get("plan_map"), dict):
            plan_map = {k: int(v) for k, v in body["plan_map"].items()}

    # Normalise format aliases sent from the frontend
    _VALID_FMTS = ("csv", "squad_cfg", "plain_ids", "discord_members")
    if fmt == "cfg":
        fmt = "squad_cfg"
    elif fmt == "auto":
        fmt = _detect_format(data)
    elif fmt not in _VALID_FMTS:
        fmt = "csv"

    # Normalise dup_handling aliases
    if dup_handling not in ("skip", "overwrite", "merge"):
        dup_handling = "skip"

    if not data:
        return web.json_response({"error": "No data provided."}, status=400)
    wl = await _resolve_whitelist(bot.db, guild_id, wl_type)
    if not wl:
        valid_slugs = await _get_whitelist_slugs(bot.db, guild_id)
        return web.json_response({"error": f"Invalid whitelist_type. Must be one of: {', '.join(valid_slugs)}"}, status=400)
    wl_id = wl["id"]

    # Parse column_map if provided
    column_map: dict[str, str] | None = None
    if column_map_raw:
        try:
            column_map = json.loads(column_map_raw)
        except (json.JSONDecodeError, TypeError):
            return web.json_response({"error": "Invalid column_map JSON."}, status=400)

    existing_steam = await _get_existing_steam_ids(db, guild_id, wl_id)

    if fmt == "squad_cfg":
        rows, _ = _parse_squad_cfg_data(data, existing_steam)
    elif fmt == "plain_ids":
        rows, _ = _parse_plain_ids(data, existing_steam)
    elif fmt == "discord_members":
        return web.json_response({"error": "Use the Reconcile tab to match a Discord member list."}, status=400)
    else:
        rows, _ = _parse_csv_data(data, guild_id, wl_type, existing_steam, column_map=column_map)

    default_slot = wl["default_slot_limit"] or 1

    # Get existing users (id + name) for this whitelist
    existing_users_rows = await db.fetchall(
        "SELECT discord_id, discord_name FROM whitelist_users WHERE guild_id=%s AND whitelist_id=%s",
        (guild_id, wl_id),
    )
    existing_discord_ids: set[int] = {row[0] for row in (existing_users_rows or [])}
    # Build name→discord_id map for name-based fuzzy matching (only real Discord IDs > 0)
    existing_name_map: list[tuple[str, int]] = [
        (row[1], row[0]) for row in (existing_users_rows or []) if row[0] > 0 and row[1]
    ]

    # Group rows by user (use plan_map if provided for slot limits)
    users = _group_rows_by_user(rows, default_slot, existing_discord_ids, plan_map=plan_map)

    added = 0
    updated = 0
    skipped = 0
    errors = 0
    id_counter = int(time.time() * 1000)
    NAME_MATCH_THRESHOLD = 0.80  # confidence required to auto-link to existing Discord user

    for user in users:
        steam_ids = user.get("steam_ids", [])
        eos_ids = user.get("eos_ids", [])
        discord_name = user.get("discord_name", "(unknown)")
        plan = user.get("plan", "")
        notes = user.get("notes", "")
        slot_limit = user.get("slot_limit", default_slot)

        raw_discord_id = user.get("discord_id", "")
        try:
            discord_id = int(raw_discord_id) if raw_discord_id else 0
        except (ValueError, TypeError):
            discord_id = 0

        # If no discord_id provided, try to match by name against existing real Discord users
        if discord_id == 0 and discord_name and discord_name != "(unknown)" and existing_name_map:
            best_score = 0.0
            best_did = 0
            for ex_name, ex_did in existing_name_map:
                score = _reconcile_score(discord_name, ex_name)
                if score > best_score:
                    best_score = score
                    best_did = ex_did
            if best_score >= NAME_MATCH_THRESHOLD:
                discord_id = best_did

        if discord_id == 0:
            id_counter += 1
            discord_id = -abs(id_counter)

        # If we resolved to a real Discord user (positive ID), clean up any orphan
        # records that currently hold the same Steam/EOS IDs so they don't linger.
        if discord_id > 0 and steam_ids:
            for sid in steam_ids:
                orphan_row = await db.fetchone(
                    "SELECT u.discord_id FROM whitelist_users u "
                    "JOIN whitelist_identifiers i "
                    "  ON i.discord_id=u.discord_id AND i.guild_id=u.guild_id AND i.whitelist_id=u.whitelist_id "
                    "WHERE u.guild_id=%s AND u.whitelist_id=%s AND u.discord_id<0 "
                    "AND i.id_type='steam64' AND i.id_value=%s",
                    (guild_id, wl_id, str(sid)),
                )
                if orphan_row:
                    orphan_did = orphan_row[0]
                    await db.execute_transaction([
                        ("DELETE FROM whitelist_identifiers WHERE guild_id=%s AND discord_id=%s AND whitelist_id=%s",
                         (guild_id, orphan_did, wl_id)),
                        ("DELETE FROM whitelist_users WHERE guild_id=%s AND discord_id=%s AND whitelist_id=%s",
                         (guild_id, orphan_did, wl_id)),
                    ])

        is_existing = discord_id in existing_discord_ids

        # Pack plan metadata
        plan_meta = _pack_plan_meta(plan=plan, notes=notes)

        if is_existing:
            if dup_handling == "skip":
                skipped += 1
                continue
            elif dup_handling == "overwrite":
                # Replace identifiers entirely
                identifiers = []
                for sid in steam_ids:
                    identifiers.append(("steam64", str(sid), False, "import"))
                for eid in eos_ids:
                    identifiers.append(("eosid", str(eid), False, "import"))
                await db.replace_identifiers(guild_id, discord_id, wl_id, identifiers)
                await db.upsert_user_record(
                    guild_id, discord_id, wl_id, discord_name, "active",
                    slot_limit, plan_meta, slot_limit_override=None,
                )
                updated += 1
            elif dup_handling == "merge":
                # Add new IDs without removing old ones
                current_ids = await db.get_identifiers(guild_id, discord_id, wl_id)
                current_set = {(r[0], r[1]) for r in current_ids}
                identifiers = [(r[0], r[1], False, "import") for r in current_ids]
                for sid in steam_ids:
                    if ("steam64", str(sid)) not in current_set:
                        identifiers.append(("steam64", str(sid), False, "import"))
                for eid in eos_ids:
                    if ("eosid", str(eid)) not in current_set:
                        identifiers.append(("eosid", str(eid), False, "import"))
                await db.replace_identifiers(guild_id, discord_id, wl_id, identifiers)
                updated += 1
        else:
            # New entry
            identifiers = []
            for sid in steam_ids:
                identifiers.append(("steam64", str(sid), False, "import"))
            for eid in eos_ids:
                identifiers.append(("eosid", str(eid), False, "import"))
            await db.upsert_user_record(
                guild_id, discord_id, wl_id, discord_name, "active",
                slot_limit, plan_meta, slot_limit_override=None,
            )
            await db.replace_identifiers(guild_id, discord_id, wl_id, identifiers)
            added += 1

    # Audit
    await db.audit(
        guild_id, "admin_import", actor_id, None,
        f"Imported {fmt} into {wl_type}: added={added}, updated={updated}, skipped={skipped}, errors={errors}",
        wl_id,
    )
    log.info("Guild %s: admin %s imported %s into %s (added=%d updated=%d skipped=%d errors=%d)",
             guild_id, actor_id, fmt, wl_type, added, updated, skipped, errors)

    await _trigger_sync(request, guild_id)

    return web.json_response({
        "ok": True,
        "imported": added + updated,
        "added": added,
        "updated": updated,
        "skipped": skipped,
        "errors": errors,
    })


@require_admin
async def admin_reconcile_preview(request: web.Request) -> web.Response:
    """Preview matches between orphan whitelist entries (discord_id < 0) and a Discord member list.

    Accepts multipart or JSON with a 'content' field containing the Discord member CSV
    (format: User,ID — username and Discord ID per line).
    Returns proposed matches sorted by confidence descending.
    """
    session = await aiohttp_session.get_session(request)
    guild_id = int(session["active_guild_id"])
    db = request.app["bot"].db

    # Parse member CSV from request
    member_csv = ""
    content_type = request.content_type or ""
    if "multipart" in content_type:
        reader = await request.multipart()
        while True:
            part = await reader.next()
            if part is None:
                break
            if part.name in ("file", "content", "members"):
                member_csv = (await part.read(decode=True)).decode("utf-8", errors="replace")
                break
    else:
        try:
            body = await request.json()
        except Exception:
            return web.json_response({"error": "Invalid request body"}, status=400)
        member_csv = body.get("content", "") or body.get("members", "")

    # Parse member list — supports comma, dash, en-dash separators; discriminators stripped
    parsed_members = _parse_discord_member_list(member_csv)
    # Also fall back to simple comma split in case _parse_discord_member_list is too strict
    if not parsed_members:
        for line in member_csv.splitlines():
            line = line.strip()
            if not line:
                continue
            parts = line.rsplit(",", 1)
            if len(parts) == 2:
                name = re.sub(r"#\d{1,4}$", "", parts[0].strip()).strip()
                try:
                    did = int(parts[1].strip())
                    if name and name.lower() not in ("user", "username", "name", "member"):
                        parsed_members.append({"discord_name": name, "discord_id": str(did)})
                except ValueError:
                    continue

    members: dict[str, int] = {}  # normalised_name -> discord_id (last wins)
    members_display: dict[int, str] = {}  # discord_id -> display name
    for m in parsed_members:
        name = m["discord_name"]
        try:
            did = int(m["discord_id"])
        except (ValueError, TypeError):
            continue
        if name.lower() in ("user", "username", "name", "member"):
            continue  # skip headers
        members[name] = did
        members_display[did] = name

    if not members:
        return web.json_response({"error": "No valid members found. Expected 'Username,DiscordID' or 'Username - DiscordID' format."}, status=400)

    # Fetch orphan records (discord_id < 0) for this guild
    orphan_rows = await db.fetchall(
        """
        SELECT u.discord_id, u.discord_name, w.slug, w.name, u.status, u.slot_limit
        FROM whitelist_users u
        JOIN whitelists w ON w.id = u.whitelist_id
        WHERE u.guild_id=%s AND u.discord_id < 0
        ORDER BY u.discord_name
        """,
        (guild_id,),
    )

    if not orphan_rows:
        return web.json_response({
            "ok": True,
            "members_loaded": len(members),
            "orphans_found": 0,
            "results": [],
        })

    # Fetch identifiers for orphan discord_ids
    orphan_ids = list({r[0] for r in orphan_rows})
    id_map: dict[int, list[str]] = {}
    if orphan_ids:
        placeholders = ",".join(["%s"] * len(orphan_ids))
        id_rows = await db.fetchall(
            f"SELECT discord_id, id_type, id_value FROM whitelist_identifiers WHERE guild_id=%s AND discord_id IN ({placeholders})",
            tuple([guild_id] + orphan_ids),
        )
        for irow in id_rows:
            key = int(irow[0])
            if key not in id_map:
                id_map[key] = []
            id_map[key].append(f"{irow[1]}:{irow[2]}")

    # Match each orphan against member list
    results = []
    for row in orphan_rows:
        orphan_id = int(row[0])
        orphan_name = row[1] or ""
        wl_slug = row[2]
        wl_name = row[3]
        identifiers = id_map.get(orphan_id, [])

        best_match = None
        best_score = 0.0
        for member_name, member_did in members.items():
            score = _reconcile_score(orphan_name, member_name)
            if score > best_score:
                best_score = score
                best_match = {"discord_name": member_name, "discord_id": member_did}

        results.append({
            "orphan_discord_id": orphan_id,
            "orphan_name": orphan_name,
            "whitelist_slug": wl_slug,
            "whitelist_name": wl_name,
            "identifiers": identifiers,
            "match": best_match,
            "confidence": round(best_score, 2),
        })

    results.sort(key=lambda x: x["confidence"], reverse=True)

    return web.json_response({
        "ok": True,
        "members_loaded": len(members),
        "orphans_found": len(results),
        "results": results,
    })


@require_admin
async def admin_reconcile_apply(request: web.Request) -> web.Response:
    """Apply reconcile matches: re-parent orphan records to real Discord IDs.

    Body: { matches: [{orphan_discord_id, real_discord_id, real_discord_name}] }
    For each match:
    - If the real user already has a record in the same whitelist, delete the orphan.
    - Otherwise re-parent by updating discord_id in both tables.
    """
    session = await aiohttp_session.get_session(request)
    guild_id = int(session["active_guild_id"])
    actor_id = int(session["discord_id"])
    db = request.app["bot"].db

    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid request body"}, status=400)

    matches = body.get("matches", [])
    if not matches:
        return web.json_response({"error": "No matches provided"}, status=400)

    applied = 0
    skipped = 0
    errors = 0

    for match in matches:
        try:
            orphan_id = int(match["orphan_discord_id"])
            real_id = int(match["real_discord_id"])
            real_name = str(match.get("real_discord_name", ""))

            if orphan_id >= 0:
                skipped += 1
                continue  # Safety: never touch real records this way

            # Check if real_id already has a record in whitelist_users
            existing = await db.fetchone(
                "SELECT discord_id FROM whitelist_users WHERE guild_id=%s AND discord_id=%s",
                (guild_id, real_id),
            )

            if existing:
                # Real user already exists — delete the orphan duplicate
                await db.execute_transaction([
                    ("DELETE FROM whitelist_identifiers WHERE guild_id=%s AND discord_id=%s",
                     (guild_id, orphan_id)),
                    ("DELETE FROM whitelist_users WHERE guild_id=%s AND discord_id=%s",
                     (guild_id, orphan_id)),
                ])
            else:
                # Re-parent: update discord_id in both tables
                await db.execute_transaction([
                    ("UPDATE whitelist_identifiers SET discord_id=%s WHERE guild_id=%s AND discord_id=%s",
                     (real_id, guild_id, orphan_id)),
                    ("UPDATE whitelist_users SET discord_id=%s, discord_name=%s WHERE guild_id=%s AND discord_id=%s",
                     (real_id, real_name, guild_id, orphan_id)),
                ])

            applied += 1
        except Exception as e:
            log.error("Reconcile apply error for match %s: %s", match, e)
            errors += 1

    await db.audit(
        guild_id, "admin_reconcile", actor_id, None,
        f"Reconciled {applied} orphan record(s) — {skipped} skipped, {errors} errors",
    )

    await _trigger_sync(request, guild_id)

    return web.json_response({"ok": True, "applied": applied, "skipped": skipped, "errors": errors})


@require_admin
async def admin_rematch_orphans(request: web.Request) -> web.Response:
    """Re-run name-based matching against all orphan records for this guild.

    For each orphan (discord_id < 0), tries _reconcile_score against all
    real Discord users. If score >= threshold, applies reconcile_apply logic
    (re-parent or delete the orphan).

    Optional body: {whitelist_slug: "..."} to scope to one whitelist.
    Returns: {matched, skipped, errors}
    """
    session = await aiohttp_session.get_session(request)
    guild_id = int(session["active_guild_id"])
    actor_id = int(session["discord_id"])
    db = request.app["bot"].db

    wl_slug = ""
    try:
        body = await request.json()
        wl_slug = body.get("whitelist_slug", "") or ""
    except Exception:
        pass

    NAME_MATCH_THRESHOLD = 0.80

    # Fetch all orphan records for this guild (optionally filtered by whitelist)
    if wl_slug:
        wl = await _resolve_whitelist(db, guild_id, wl_slug)
        if not wl:
            return web.json_response({"error": "Invalid whitelist_slug"}, status=400)
        orphan_rows = await db.fetchall(
            "SELECT u.discord_id, u.discord_name, u.whitelist_id "
            "FROM whitelist_users u "
            "WHERE u.guild_id=%s AND u.discord_id<0 AND u.whitelist_id=%s",
            (guild_id, wl["id"]),
        )
    else:
        orphan_rows = await db.fetchall(
            "SELECT u.discord_id, u.discord_name, u.whitelist_id "
            "FROM whitelist_users u "
            "WHERE u.guild_id=%s AND u.discord_id<0",
            (guild_id,),
        )

    if not orphan_rows:
        return web.json_response({"ok": True, "matched": 0, "skipped": 0, "errors": 0})

    # Fetch all real Discord users for this guild (positive discord_id) with metadata
    real_rows = await db.fetchall(
        "SELECT discord_id, discord_name, last_plan_name FROM whitelist_users "
        "WHERE guild_id=%s AND discord_id>0",
        (guild_id,),
    )
    real_users: list[tuple[int, str, str]] = [
        (int(r[0]), r[1] or "", r[2] or "") for r in (real_rows or []) if r[1]
    ]

    matched = 0
    skipped = 0
    errors = 0

    for orphan_did, orphan_name, wl_id in orphan_rows:
        if not orphan_name:
            skipped += 1
            continue

        best_score = 0.0
        best_real_id = 0
        best_real_name = ""
        for real_id, real_name, plan_raw in real_users:
            score = _reconcile_score(orphan_name, real_name)
            # Also try matching against stored username (discord login name)
            meta = _unpack_plan_meta(plan_raw)
            stored_username = meta.get("username") or ""
            if stored_username and stored_username != real_name:
                score = max(score, _reconcile_score(orphan_name, stored_username))
            if score > best_score:
                best_score = score
                best_real_id = real_id
                best_real_name = real_name

        if best_score < NAME_MATCH_THRESHOLD or best_real_id == 0:
            skipped += 1
            continue

        try:
            # Check if real user already has a record in this whitelist
            existing = await db.fetchone(
                "SELECT discord_id FROM whitelist_users "
                "WHERE guild_id=%s AND discord_id=%s AND whitelist_id=%s",
                (guild_id, best_real_id, wl_id),
            )
            if existing:
                # Real user exists — merge identifiers then delete orphan
                orphan_ids = await db.get_identifiers(guild_id, orphan_did, wl_id)
                if orphan_ids:
                    current_ids = await db.get_identifiers(guild_id, best_real_id, wl_id)
                    current_set = {(r[0], r[1]) for r in current_ids}
                    merged = list(current_ids)
                    for id_type, id_val, *_ in orphan_ids:
                        if (id_type, id_val) not in current_set:
                            merged.append((id_type, id_val, False, "rematch"))
                    await db.replace_identifiers(guild_id, best_real_id, wl_id,
                                                 [(r[0], r[1], False, "rematch") for r in merged])
                await db.execute_transaction([
                    ("DELETE FROM whitelist_identifiers WHERE guild_id=%s AND discord_id=%s AND whitelist_id=%s",
                     (guild_id, orphan_did, wl_id)),
                    ("DELETE FROM whitelist_users WHERE guild_id=%s AND discord_id=%s AND whitelist_id=%s",
                     (guild_id, orphan_did, wl_id)),
                ])
            else:
                # Re-parent orphan to real Discord user
                await db.execute_transaction([
                    ("UPDATE whitelist_identifiers SET discord_id=%s "
                     "WHERE guild_id=%s AND discord_id=%s AND whitelist_id=%s",
                     (best_real_id, guild_id, orphan_did, wl_id)),
                    ("UPDATE whitelist_users SET discord_id=%s, discord_name=%s "
                     "WHERE guild_id=%s AND discord_id=%s AND whitelist_id=%s",
                     (best_real_id, best_real_name, guild_id, orphan_did, wl_id)),
                ])
            matched += 1
        except Exception as e:
            log.error("Rematch orphan error orphan=%s real=%s: %s", orphan_did, best_real_id, e)
            errors += 1

    await db.audit(
        guild_id, "admin_rematch_orphans", actor_id, None,
        f"Re-matched orphans: matched={matched}, skipped={skipped}, errors={errors}",
    )
    await _trigger_sync(request, guild_id)

    return web.json_response({"ok": True, "matched": matched, "skipped": skipped, "errors": errors})


@require_admin
async def admin_reconcile_suggest(request: web.Request) -> web.Response:
    """Return top scored match candidates for a single orphan record.

    GET /api/admin/reconcile/suggest?orphan_id={discord_id}&limit=5
    Returns [{discord_id, discord_name, score, match_via}] sorted by score desc.
    """
    session = await aiohttp_session.get_session(request)
    guild_id = int(session["active_guild_id"])
    db = request.app["bot"].db

    orphan_id_raw = request.query.get("orphan_id", "").strip()
    limit = min(10, max(1, int(request.query.get("limit", "5"))))

    if not orphan_id_raw:
        return web.json_response({"error": "orphan_id is required"}, status=400)
    try:
        orphan_id = int(orphan_id_raw)
    except (ValueError, TypeError):
        return web.json_response({"error": "orphan_id must be an integer"}, status=400)
    if orphan_id >= 0:
        return web.json_response({"error": "orphan_id must be a negative number (orphan record)"}, status=400)

    orphan_row = await db.fetchone(
        "SELECT discord_name FROM whitelist_users WHERE guild_id=%s AND discord_id=%s",
        (guild_id, orphan_id),
    )
    if not orphan_row or not orphan_row[0]:
        return web.json_response({"suggestions": []})

    orphan_name = orphan_row[0]

    # Fetch all real Discord users with their stored metadata (for username lookup)
    real_rows = await db.fetchall(
        "SELECT discord_id, discord_name, last_plan_name FROM whitelist_users "
        "WHERE guild_id=%s AND discord_id>0",
        (guild_id,),
    )

    scored: list[dict] = []
    seen_ids: set[int] = set()
    for real_id, real_name, plan_raw in (real_rows or []):
        if not real_name:
            continue
        real_id = int(real_id)
        if real_id in seen_ids:
            continue
        seen_ids.add(real_id)

        # Score against stored display name (guild nickname)
        score_name = _reconcile_score(orphan_name, real_name)

        # Also score against raw username if stored
        score_username = 0.0
        match_via = "display_name"
        meta = _unpack_plan_meta(plan_raw)
        stored_username = meta.get("username") or ""
        if stored_username and stored_username != real_name:
            score_username = _reconcile_score(orphan_name, stored_username)

        best = max(score_name, score_username)
        if best <= 0.0:
            continue
        if score_username > score_name:
            match_via = "username"

        scored.append({
            "discord_id": str(real_id),
            "discord_name": real_name,
            "username": stored_username or None,
            "score": best,
            "match_via": match_via,
        })

    scored.sort(key=lambda x: x["score"], reverse=True)
    return web.json_response({"orphan_name": orphan_name, "suggestions": scored[:limit]})


@require_admin
async def admin_role_sync_pull(request: web.Request) -> web.Response:
    """Pull all current members of a Discord role into a whitelist.

    POST body: {role_id, whitelist_slug, dry_run=true}
    Returns:   {ok, role_name, whitelist_slug, total_role_members, added:[{discord_id,discord_name}],
                already_exist, dry_run}

    Requires the bot to be running in gateway mode (not standalone web service).
    """
    session = await aiohttp_session.get_session(request)
    guild_id = int(session["active_guild_id"])
    actor_id = int(session["discord_id"])
    bot = request.app["bot"]
    db = bot.db

    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON body."}, status=400)

    role_id_raw = body.get("role_id")
    whitelist_slug = body.get("whitelist_slug", "").strip()
    dry_run = bool(body.get("dry_run", True))

    if not role_id_raw:
        return web.json_response({"error": "role_id is required."}, status=400)
    try:
        role_id = int(role_id_raw)
    except (ValueError, TypeError):
        return web.json_response({"error": "role_id must be an integer."}, status=400)

    wl = await _resolve_whitelist(db, guild_id, whitelist_slug)
    if not wl:
        valid = await _get_whitelist_slugs(db, guild_id)
        return web.json_response({"error": f"Invalid whitelist. Must be one of: {', '.join(valid)}"}, status=400)

    # Fetch role members — gateway preferred, REST fallback
    role_name = f"role:{role_id}"
    members_raw: list[dict] = []  # each: {id: int, name: str}

    guild = getattr(bot, "get_guild", lambda _: None)(guild_id)
    if guild and hasattr(guild, "get_role"):
        # Full gateway bot — use cached guild
        role = guild.get_role(role_id)
        if not role:
            return web.json_response({"error": f"Role {role_id} not found in guild."}, status=404)
        role_name = role.name
        members_raw = [
            {"id": m.id, "name": m.display_name or str(m)}
            for m in role.members
        ]
    elif hasattr(bot, "get_role_members"):
        # Standalone web service — fetch via REST API
        try:
            members_raw = await bot.get_role_members(guild_id, role_id)
            # Try to get the role name from the roles list
            if hasattr(bot, "get_roles"):
                all_roles = await bot.get_roles(guild_id)
                for r in all_roles:
                    if int(r.get("id", 0)) == role_id:
                        role_name = r.get("name", role_name)
                        break
        except Exception as exc:
            log.error("REST role member fetch failed for role %s: %s", role_id, exc)
            return web.json_response({"error": f"Failed to fetch role members: {exc}"}, status=500)
        if not members_raw and not members_raw == []:
            return web.json_response(
                {"error": "Could not fetch role members. Check bot token permissions (GUILD_MEMBERS intent required)."},
                status=503,
            )
    else:
        return web.json_response(
            {"error": "Bot gateway required to fetch role members. Ensure the bot is running."},
            status=503,
        )

    # Existing whitelist members (any status — avoid re-adding removed users without merge)
    existing_rows = await db.fetchall(
        "SELECT discord_id FROM whitelist_users WHERE guild_id=%s AND whitelist_id=%s",
        (guild_id, wl["id"]),
    )
    existing_ids: set[int] = {row[0] for row in (existing_rows or [])}

    default_slot = wl.get("default_slot_limit") or 1
    added: list[dict] = []
    already_exist_count = 0

    for member in members_raw:
        mid = member["id"]
        if mid in existing_ids:
            already_exist_count += 1
            continue
        name = member["name"]
        username = member.get("username") or ""
        # Store username in plan_meta so matching can try both nick and username
        plan_meta = _pack_plan_meta(username=username) if username and username != name else ""
        if not dry_run:
            await db.upsert_user_record(
                guild_id, mid, wl["id"], name, "active", default_slot, plan_meta, None,
            )
            await db.audit(
                guild_id, "role_sync_pull", actor_id, mid,
                f"role={role_name}, whitelist={whitelist_slug}", wl["id"],
            )
        added.append({"discord_id": str(mid), "discord_name": name})

    if not dry_run and added:
        await _trigger_sync(request, guild_id)
        log.info("Guild %s: role sync pull added %d to %s from role %s",
                 guild_id, len(added), whitelist_slug, role_name)

    return web.json_response({
        "ok": True,
        "role_name": role_name,
        "whitelist_slug": whitelist_slug,
        "total_role_members": len(members_raw) + already_exist_count,
        "added": added,
        "already_exist": already_exist_count,
        "dry_run": dry_run,
    })


@require_admin
async def admin_export(request: web.Request) -> web.Response:
    """Export whitelist data in various formats."""
    session = await aiohttp_session.get_session(request)
    guild_id = int(session["active_guild_id"])
    bot = request.app["bot"]
    db = bot.db

    wl_type = request.query.get("type", "").strip()
    slugs_param = request.query.get("slugs", "").strip()
    fmt = request.query.get("format", "csv").strip()
    filt = request.query.get("filter", "active").strip()
    columns_param = request.query.get("columns", "").strip()

    # Normalise format alias
    if fmt == "cfg":
        fmt = "squad_cfg"
    if fmt not in ("csv", "squad_cfg", "json"):
        return web.json_response({"error": "format must be 'csv', 'squad_cfg', or 'json'."}, status=400)
    if filt not in ("active", "all", "expired"):
        return web.json_response({"error": "filter must be 'active', 'all', or 'expired'."}, status=400)

    # Determine which whitelists to query
    whitelists = await db.get_whitelists(guild_id)
    wl_by_slug = {wl["slug"]: wl for wl in whitelists}

    if wl_type == "combined":
        wls_to_query = whitelists
    elif slugs_param:
        # Frontend sends ?slugs=slug1,slug2 for multi-select export
        requested = {s.strip() for s in slugs_param.split(",") if s.strip()}
        wls_to_query = [wl for wl in whitelists if wl["slug"] in requested]
        if not wls_to_query:
            valid_slugs = list(wl_by_slug.keys())
            return web.json_response({
                "error": f"No matching whitelists. Valid: {', '.join(valid_slugs)}",
            }, status=400)
    elif wl_type in wl_by_slug:
        wls_to_query = [wl_by_slug[wl_type]]
    else:
        valid_slugs = list(wl_by_slug.keys())
        return web.json_response({
            "error": f"Invalid type. Must be one of: {', '.join(valid_slugs)}, combined",
        }, status=400)

    all_entries: list[dict] = []

    for wl in wls_to_query:
        wl_id = wl["id"]
        wl_slug = wl["slug"]
        # Build filter conditions
        conditions = ["u.guild_id=%s", "u.whitelist_id=%s"]
        params: list = [guild_id, wl_id]

        if filt == "active":
            conditions.append("u.status='active'")
        elif filt == "expired":
            conditions.append("u.status='inactive'")
        # "all" = no status filter

        where = " AND ".join(conditions)

        rows = await db.fetchall(
            f"SELECT u.discord_id, u.discord_name, u.status, "
            f"u.effective_slot_limit, u.last_plan_name, u.updated_at "
            f"FROM whitelist_users u WHERE {where} ORDER BY u.discord_name",
            tuple(params),
        )

        for row in (rows or []):
            discord_id = row[0]
            meta = _unpack_plan_meta(row[4])

            # Fetch identifiers
            id_rows = await db.fetchall(
                "SELECT id_type, id_value FROM whitelist_identifiers "
                "WHERE guild_id=%s AND discord_id=%s AND whitelist_id=%s",
                (guild_id, discord_id, wl_id),
            )
            steam_ids = [r[1] for r in (id_rows or []) if r[0] == "steam64"]
            eos_ids = [r[1] for r in (id_rows or []) if r[0] == "eosid"]

            # Check if actually expired by expires_at
            if filt == "expired" and row[2] == "active":
                # Only include if expires_at is in the past
                exp = meta.get("expires_at")
                if not exp:
                    continue
                try:
                    exp_dt = datetime.fromisoformat(exp.replace("Z", "+00:00"))
                    if exp_dt > datetime.now(timezone.utc):
                        continue
                except (ValueError, TypeError):
                    continue

            all_entries.append({
                "discord_id": str(discord_id),
                "discord_name": row[1],
                "whitelist_type": wl_slug,
                "status": row[2],
                "effective_slot_limit": row[3],
                "plan": meta.get("plan"),
                "notes": meta.get("notes"),
                "expires_at": meta.get("expires_at"),
                "steam_ids": steam_ids,
                "eos_ids": eos_ids,
                "updated_at": str(row[5]) if row[5] else "",
            })

    # Determine requested columns
    default_columns = [
        "discord_name", "discord_id", "whitelist_type", "status",
        "steam_ids", "eos_ids", "plan", "notes", "expires_at",
    ]
    if columns_param:
        requested_cols = [c.strip() for c in columns_param.split(",") if c.strip()]
    else:
        requested_cols = default_columns

    # Format output
    if fmt == "json":
        # Filter columns in JSON output
        filtered = []
        for entry in all_entries:
            filtered.append({k: v for k, v in entry.items() if k in requested_cols})
        return web.json_response(
            filtered,
            headers={
                "Content-Disposition": f'attachment; filename="whitelist_export.json"',
            },
        )

    if fmt == "squad_cfg":
        lines: list[str] = []
        lines.append("// Whitelist Export - Squad RemoteAdminList format")
        for entry in all_entries:
            for sid in entry["steam_ids"]:
                name = entry["discord_name"] or "(unknown)"
                lines.append(f"Admin={sid}:reserve // {name}")
        content = "\n".join(lines) + "\n"
        return web.Response(
            text=content,
            content_type="text/plain",
            headers={
                "Content-Disposition": f'attachment; filename="whitelist_export.cfg"',
            },
        )

    # CSV format
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=requested_cols, extrasaction="ignore")
    writer.writeheader()
    for entry in all_entries:
        # Flatten lists to semicolon-separated strings for CSV
        flat = dict(entry)
        if "steam_ids" in flat and isinstance(flat["steam_ids"], list):
            flat["steam_ids"] = ";".join(flat["steam_ids"])
        if "eos_ids" in flat and isinstance(flat["eos_ids"], list):
            flat["eos_ids"] = ";".join(flat["eos_ids"])
        writer.writerow(flat)

    csv_content = output.getvalue()
    return web.Response(
        text=csv_content,
        content_type="text/csv",
        headers={
            "Content-Disposition": f'attachment; filename="whitelist_export.csv"',
        },
    )


@require_admin
async def admin_members_gap(request: web.Request) -> web.Response:
    """Return Discord members who have a whitelisted role but haven't registered.

    Checks both role_mappings (legacy) and tier_entries (new system).
    """
    session = await aiohttp_session.get_session(request)
    guild_id = int(session["active_guild_id"])
    bot = request.app["bot"]
    db = bot.db

    # Collect all role IDs that grant whitelist access for this guild
    whitelisted_role_ids: set[int] = set()

    # From role_mappings
    rm_rows = await db.fetchall(
        "SELECT DISTINCT role_id FROM role_mappings WHERE guild_id=%s AND is_active=true",
        (guild_id,),
    ) if db.engine == "postgres" else await db.fetchall(
        "SELECT DISTINCT role_id FROM role_mappings WHERE guild_id=%s AND is_active=1",
        (guild_id,),
    )
    for r in (rm_rows or []):
        try:
            whitelisted_role_ids.add(int(r[0]))
        except (ValueError, TypeError):
            pass

    # From tier_entries
    te_rows = await db.fetchall(
        "SELECT DISTINCT role_id FROM tier_entries WHERE guild_id=%s AND is_active=true",
        (guild_id,),
    ) if db.engine == "postgres" else await db.fetchall(
        "SELECT DISTINCT role_id FROM tier_entries WHERE guild_id=%s AND is_active=1",
        (guild_id,),
    )
    for r in (te_rows or []):
        try:
            whitelisted_role_ids.add(int(r[0]))
        except (ValueError, TypeError):
            pass

    if not whitelisted_role_ids:
        return web.json_response({"gap": [], "total_role_holders": 0, "total_registered": 0})

    # Build role_id -> role_name map from DB (tier_entries + role_mappings)
    role_name_map: dict[int, str] = {}
    te_name_rows = await db.fetchall(
        "SELECT DISTINCT role_id, role_name FROM tier_entries WHERE guild_id=%s",
        (guild_id,),
    )
    for r in (te_name_rows or []):
        try:
            role_name_map[int(r[0])] = r[1] or str(r[0])
        except (ValueError, TypeError):
            pass

    # Fetch members for each whitelisted role via gateway or REST
    role_holders: dict[int, dict] = {}  # discord_id -> {name, matched_roles}

    guild = getattr(bot, "get_guild", lambda _: None)(guild_id)
    if guild and hasattr(guild, "get_role"):
        # Full gateway bot
        for rid in whitelisted_role_ids:
            role = guild.get_role(rid)
            if not role:
                continue
            role_name_map[rid] = role.name
            for member in role.members:
                if member.id not in role_holders:
                    role_holders[member.id] = {
                        "discord_id": str(member.id),
                        "name": member.display_name,
                        "matched_roles": [],
                    }
                role_holders[member.id]["matched_roles"].append(role.name)
    elif hasattr(bot, "get_role_members"):
        # REST fallback — paginate each role
        for rid in whitelisted_role_ids:
            role_name = role_name_map.get(rid, str(rid))
            try:
                members = await bot.get_role_members(guild_id, rid)
            except Exception as exc:
                log.warning("Gap report: failed to fetch role %s: %s", rid, exc)
                continue
            for m in members:
                mid = m["id"]
                if mid not in role_holders:
                    role_holders[mid] = {
                        "discord_id": str(mid),
                        "name": m["name"],
                        "matched_roles": [],
                    }
                role_holders[mid]["matched_roles"].append(role_name)
    else:
        return web.json_response({"error": "Bot not connected — cannot fetch Discord members."}, status=503)

    if not role_holders:
        return web.json_response({"gap": [], "total_role_holders": 0, "total_registered": 0})

    # Get all registered discord_ids for this guild (active status)
    reg_rows = await db.fetchall(
        "SELECT DISTINCT discord_id FROM whitelist_users WHERE guild_id=%s AND status='active'",
        (guild_id,),
    )
    registered_ids: set[int] = {int(r[0]) for r in (reg_rows or [])}

    # Build the gap list
    gap = []
    for member_id, info in role_holders.items():
        if member_id not in registered_ids:
            gap.append(info)

    # Sort by name
    gap.sort(key=lambda x: x["name"].lower())

    return web.json_response({
        "gap": gap,
        "total_role_holders": len(role_holders),
        "total_registered": len(registered_ids & set(role_holders.keys())),
    })


@require_admin
async def admin_verify_roles(request: web.Request) -> web.Response:
    """Verify Discord roles for a list of Discord IDs and suggest plan mappings."""
    session = await aiohttp_session.get_session(request)
    guild_id = int(session["active_guild_id"])
    bot = request.app["bot"]

    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON body."}, status=400)

    discord_ids = body.get("discord_ids", [])
    wl_type = body.get("whitelist_type", "")

    if not discord_ids:
        return web.json_response({"error": "No Discord IDs provided."}, status=400)

    # Get role mappings for this whitelist type
    db = bot.db
    wl = await _resolve_whitelist(db, guild_id, wl_type)
    role_mappings = []
    if wl:
        rows = await db.fetchall(
            "SELECT role_id, role_name, slot_limit FROM role_mappings "
            "WHERE guild_id=%s AND whitelist_id=%s",
            (guild_id, wl["id"]),
        )
        role_mappings = [{"role_id": int(r[0]), "role_name": r[1], "slot_limit": r[2]} for r in (rows or [])]

    # Use Discord REST client to look up member roles
    results = []
    rest = getattr(bot, "rest_client", None) or getattr(bot, "http", None)

    for did in discord_ids[:50]:  # Limit to 50 to avoid rate limits
        try:
            did_int = int(did)
            # Try getting member from bot's guild cache or REST
            member = None
            if hasattr(bot, "get_guild"):
                guild = bot.get_guild(guild_id)
                if guild:
                    member = guild.get_member(did_int)

            if member:
                member_roles = [{"id": r.id, "name": r.name} for r in member.roles if r.name != "@everyone"]
                # Find matching role mapping
                suggested_plan = None
                suggested_slots = 1
                for rm in role_mappings:
                    for mr in member_roles:
                        if mr["id"] == rm["role_id"]:
                            suggested_plan = rm["role_name"]
                            suggested_slots = rm["slot_limit"]
                            break
                    if suggested_plan:
                        break

                results.append({
                    "discord_id": str(did_int),
                    "name": member.display_name,
                    "roles": [r["name"] for r in member_roles],
                    "suggested_plan": suggested_plan,
                    "suggested_slots": suggested_slots,
                })
        except (ValueError, TypeError):
            continue

    return web.json_response({"results": results})


MAX_WHITELISTS_PER_GUILD = 5


@require_admin
async def admin_create_whitelist(request: web.Request) -> web.Response:
    """Create a new whitelist for the active guild (max 5)."""
    session = await aiohttp_session.get_session(request)
    guild_id = int(session["active_guild_id"])
    bot = request.app["bot"]
    db = bot.db

    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON body."}, status=400)

    name = (body.get("name") or "").strip()
    if not name or len(name) > 100:
        return web.json_response({"error": "Name is required (max 100 chars)."}, status=400)

    # Generate slug from name
    import re as _re
    slug = _re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:50]
    if not slug:
        return web.json_response({"error": "Invalid name — must contain letters or numbers."}, status=400)

    # Check limit
    existing = await db.get_whitelists(guild_id)
    if len(existing) >= MAX_WHITELISTS_PER_GUILD:
        return web.json_response(
            {"error": f"Maximum of {MAX_WHITELISTS_PER_GUILD} whitelists per community."},
            status=400,
        )

    # Check slug uniqueness
    for wl in existing:
        if wl["slug"] == slug:
            return web.json_response({"error": f"A whitelist with slug '{slug}' already exists."}, status=400)

    output_filename = body.get("output_filename", f"{slug}_whitelist.txt").strip()
    squad_group = body.get("squad_group", "Whitelist").strip()
    default_slot_limit = int(body.get("default_slot_limit", 1))

    wl_id = await db.create_whitelist(
        guild_id,
        name=name,
        slug=slug,
        enabled=False,
        squad_group=squad_group,
        output_filename=output_filename,
        default_slot_limit=default_slot_limit,
        stack_roles=False,
        is_default=False,
    )

    log.info("Guild %s: admin created whitelist '%s' (id=%s, slug=%s)", guild_id, name, wl_id, slug)
    return web.json_response({"ok": True, "id": wl_id, "slug": slug, "name": name})


@require_admin
async def admin_delete_whitelist(request: web.Request) -> web.Response:
    """Delete a whitelist (cannot delete the default one)."""
    session = await aiohttp_session.get_session(request)
    guild_id = int(session["active_guild_id"])
    bot = request.app["bot"]
    db = bot.db

    wl_slug = request.match_info["slug"]
    wl = await db.get_whitelist_by_slug(guild_id, wl_slug)
    if not wl:
        return web.json_response({"error": "Whitelist not found."}, status=404)
    if wl["is_default"]:
        return web.json_response({"error": "Cannot delete the default whitelist."}, status=400)

    wl_id = wl["id"]

    # Count affected data before deletion for audit trail
    id_count = await db.fetchone(
        "SELECT COUNT(*) FROM whitelist_identifiers WHERE guild_id=%s AND whitelist_id=%s",
        (guild_id, wl_id),
    )
    user_count = await db.fetchone(
        "SELECT COUNT(*) FROM whitelist_users WHERE guild_id=%s AND whitelist_id=%s",
        (guild_id, wl_id),
    )
    role_count = await db.fetchone(
        "SELECT COUNT(*) FROM role_mappings WHERE guild_id=%s AND whitelist_id=%s",
        (guild_id, wl_id),
    )

    # Write audit log BEFORE deletion so we have a record
    actor_id = int(session.get("user_id", 0))
    await db.audit(
        guild_id=guild_id,
        action_type="delete_whitelist",
        actor=actor_id,
        target=None,
        details=(
            f"Deleted whitelist '{wl['name']}' (slug={wl_slug}). "
            f"Removed {user_count[0] if user_count else 0} users, "
            f"{id_count[0] if id_count else 0} identifiers, "
            f"{role_count[0] if role_count else 0} role mappings."
        ),
        whitelist_id=wl_id,
    )

    # Delete all related data in a transaction to prevent orphaned records
    await db.execute_transaction([
        ("DELETE FROM whitelist_identifiers WHERE guild_id=%s AND whitelist_id=%s", (guild_id, wl_id)),
        ("DELETE FROM whitelist_users WHERE guild_id=%s AND whitelist_id=%s", (guild_id, wl_id)),
        ("DELETE FROM role_mappings WHERE guild_id=%s AND whitelist_id=%s", (guild_id, wl_id)),
        ("DELETE FROM whitelists WHERE id=%s", (wl_id,)),
    ])

    log.info("Guild %s: admin deleted whitelist '%s' (id=%s) — %s users, %s ids, %s roles removed",
             guild_id, wl_slug, wl_id,
             user_count[0] if user_count else 0,
             id_count[0] if id_count else 0,
             role_count[0] if role_count else 0)
    return web.json_response({"ok": True, "deleted": wl_slug})


@require_admin
async def admin_get_whitelist_urls(request: web.Request) -> web.Response:
    """Get the served URLs for all whitelists in this guild."""
    session = await aiohttp_session.get_session(request)
    guild_id = int(session["active_guild_id"])
    bot = request.app["bot"]
    db = bot.db

    whitelists = await db.get_whitelists(guild_id)
    web_server = request.app.get("web_server")
    output_mode = await db.get_setting(guild_id, "output_mode", "combined")
    combined_filename = await db.get_setting(guild_id, "combined_filename", "whitelist.txt")

    urls = []

    # Always show the combined file URL first (this is what Squad servers read)
    if output_mode in ("combined", "hybrid"):
        combined_url = ""
        if web_server and combined_filename:
            combined_url = web_server.get_file_url(guild_id, combined_filename)
        urls.append({
            "slug": "_combined",
            "name": "Combined Whitelist",
            "filename": combined_filename or "whitelist.txt",
            "url": combined_url,
            "enabled": True,
            "note": "Add this URL to your Squad server's RemoteAdminListHosts.cfg",
        })

    # Always show per-whitelist URLs (for whitelist cards and separate mode)
    for wl in whitelists:
        wl_url = ""
        # In combined mode, point to the combined file; in separate mode, per-file
        if web_server:
            if output_mode == "combined" and combined_filename:
                wl_url = web_server.get_file_url(guild_id, combined_filename)
            elif wl.get("output_filename"):
                wl_url = web_server.get_file_url(guild_id, wl["output_filename"])
        urls.append({
            "slug": wl["slug"],
            "name": wl["name"],
            "filename": wl.get("output_filename", ""),
            "url": wl_url,
            "enabled": wl["enabled"],
        })

    return web.json_response({"urls": urls})


# ── Admin Panel API routes ────────────────────────────────────────────────────

MAX_PANELS_PER_GUILD = 5


@require_admin
async def admin_get_panels(request: web.Request) -> web.Response:
    """Return all panels for the active guild."""
    session = await aiohttp_session.get_session(request)
    guild_id = int(session["active_guild_id"])
    bot = request.app["bot"]
    db = bot.db

    panels = await db.get_panels(guild_id)
    result = []
    for p in panels:
        result.append({
            "id": p["id"],
            "name": p["name"],
            "channel_id": str(p["channel_id"]) if p["channel_id"] else None,
            "log_channel_id": str(p["log_channel_id"]) if p["log_channel_id"] else None,
            "whitelist_id": p["whitelist_id"],
            "panel_message_id": str(p["panel_message_id"]) if p["panel_message_id"] else None,
            "is_default": p["is_default"],
            "tier_category_id": p.get("tier_category_id"),
        })
    return web.json_response({"panels": result})


@require_admin
async def admin_create_panel(request: web.Request) -> web.Response:
    """Create a new panel for the active guild (max 5)."""
    session = await aiohttp_session.get_session(request)
    guild_id = int(session["active_guild_id"])
    bot = request.app["bot"]
    db = bot.db

    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON body."}, status=400)

    name = (body.get("name") or "").strip()
    if not name or len(name) > 100:
        return web.json_response({"error": "Name is required (max 100 chars)."}, status=400)

    existing = await db.get_panels(guild_id)
    if len(existing) >= MAX_PANELS_PER_GUILD:
        return web.json_response(
            {"error": f"Maximum of {MAX_PANELS_PER_GUILD} panels per community."},
            status=400,
        )

    channel_id = body.get("channel_id")
    log_channel_id = body.get("log_channel_id")
    whitelist_id = body.get("whitelist_id")

    if channel_id:
        channel_id = int(channel_id)
    if log_channel_id:
        log_channel_id = int(log_channel_id)
    if whitelist_id:
        whitelist_id = int(whitelist_id)

    panel_id = await db.create_panel(
        guild_id,
        name=name,
        channel_id=channel_id,
        log_channel_id=log_channel_id,
        whitelist_id=whitelist_id,
        is_default=False,
    )

    log.info("Guild %s: admin created panel '%s' (id=%s)", guild_id, name, panel_id)
    return web.json_response({"ok": True, "id": panel_id, "name": name})


@require_admin
async def admin_update_panel(request: web.Request) -> web.Response:
    """Update a panel."""
    session = await aiohttp_session.get_session(request)
    guild_id = int(session["active_guild_id"])
    bot = request.app["bot"]
    db = bot.db

    try:
        panel_id = int(request.match_info["panel_id"])
    except (ValueError, TypeError):
        return web.json_response({"error": "Invalid panel_id."}, status=400)

    panel = await db.get_panel_by_id(panel_id)
    if not panel or panel["guild_id"] != guild_id:
        return web.json_response({"error": "Panel not found."}, status=404)

    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON body."}, status=400)

    update_kwargs = {}
    if "name" in body:
        name = (body["name"] or "").strip()
        if not name or len(name) > 100:
            return web.json_response({"error": "Name is required (max 100 chars)."}, status=400)
        update_kwargs["name"] = name
    if "channel_id" in body:
        val = body["channel_id"]
        update_kwargs["channel_id"] = int(val) if val else None
    if "log_channel_id" in body:
        val = body["log_channel_id"]
        update_kwargs["log_channel_id"] = int(val) if val else None
    if "whitelist_id" in body:
        val = body["whitelist_id"]
        update_kwargs["whitelist_id"] = int(val) if val else None
    if "tier_category_id" in body:
        val = body["tier_category_id"]
        update_kwargs["tier_category_id"] = int(val) if val else None

    if update_kwargs:
        await db.update_panel(panel_id, **update_kwargs)

    log.info("Guild %s: admin updated panel %s: %s", guild_id, panel_id, list(body.keys()))
    return web.json_response({"ok": True, "panel_id": panel_id})


@require_admin
async def admin_delete_panel(request: web.Request) -> web.Response:
    """Delete a panel (cannot delete the default one)."""
    session = await aiohttp_session.get_session(request)
    guild_id = int(session["active_guild_id"])
    bot = request.app["bot"]
    db = bot.db

    try:
        panel_id = int(request.match_info["panel_id"])
    except (ValueError, TypeError):
        return web.json_response({"error": "Invalid panel_id."}, status=400)

    panel = await db.get_panel_by_id(panel_id)
    if not panel or panel["guild_id"] != guild_id:
        return web.json_response({"error": "Panel not found."}, status=404)
    if panel["is_default"]:
        return web.json_response({"error": "Cannot delete the default panel."}, status=400)

    await db.delete_panel(panel_id)

    log.info("Guild %s: admin deleted panel %s", guild_id, panel_id)
    return web.json_response({"ok": True, "deleted_panel_id": panel_id})


@require_admin
async def admin_push_panel(request: web.Request) -> web.Response:
    """Push/refresh the Discord embed for a panel in its channel."""
    session = await aiohttp_session.get_session(request)
    guild_id = int(session["active_guild_id"])
    bot = request.app["bot"]
    db = bot.db

    try:
        panel_id = int(request.match_info["panel_id"])
    except (ValueError, TypeError):
        return web.json_response({"error": "Invalid panel_id."}, status=400)

    panel = await db.get_panel_by_id(panel_id)
    if not panel or panel["guild_id"] != guild_id:
        return web.json_response({"error": "Panel not found."}, status=404)

    if not panel["channel_id"]:
        return web.json_response({"error": "Panel has no channel assigned."}, status=400)

    if not panel["whitelist_id"]:
        return web.json_response({"error": "Panel has no whitelist linked."}, status=400)

    # Build the panel embed using the shared builder
    from bot.panel_builder import build_panel_embed_dict, build_panel_components
    wl = await db.get_whitelist(panel["whitelist_id"])
    wl_slug = wl["slug"] if wl else "default"
    embed = await build_panel_embed_dict(db, guild_id, panel, wl)
    components = build_panel_components(wl_slug)

    # Try to send or edit the message
    discord_client = getattr(bot, "_discord", None)
    if not discord_client:
        # Fallback: just trigger sync (bot-worker mode)
        await _trigger_sync(request, guild_id)
        return web.json_response({"ok": True, "panel_id": panel_id, "note": "Sync triggered (use /whitelist_panel in Discord for full embed)"})

    channel_id = int(panel["channel_id"])
    message_id = int(panel["panel_message_id"]) if panel.get("panel_message_id") else None

    if message_id:
        # Try to edit existing message
        result = await discord_client.edit_message(channel_id, message_id, embed=embed, components=components)
        if result:
            log.info("Guild %s: edited panel embed in channel %s message %s", guild_id, channel_id, message_id)
            return web.json_response({"ok": True, "panel_id": panel_id, "action": "edited"})
        else:
            # Edit failed (message deleted or channel changed) — try to delete old message
            try:
                await discord_client.delete_message(channel_id, message_id)
            except Exception:
                pass  # Old message already gone

    # Send new message
    result = await discord_client.send_message(channel_id, embed=embed, components=components)
    if result:
        new_message_id = result.get("id")
        if new_message_id:
            await db.update_panel(panel_id, panel_message_id=int(new_message_id))
        log.info("Guild %s: sent panel embed to channel %s", guild_id, channel_id)
        return web.json_response({"ok": True, "panel_id": panel_id, "action": "sent", "message_id": new_message_id})

    return web.json_response({"error": "Failed to send message. Check bot permissions in the channel (Send Messages, Embed Links)."}, status=400)


# ── Admin Squad Groups API routes ─────────────────────────────────────────────

MAX_GROUPS_PER_GUILD = 20


@require_admin
async def admin_get_groups(request: web.Request) -> web.Response:
    """Return all squad groups for the active guild."""
    session = await aiohttp_session.get_session(request)
    guild_id = int(session["active_guild_id"])
    bot = request.app["bot"]
    db = bot.db

    rows = await db.get_squad_groups(guild_id)
    groups = []
    for row in (rows or []):
        groups.append({
            "group_name": row[0],
            "permissions": row[1] or "",
            "is_default": bool(row[2]),
        })
    return web.json_response({"groups": groups})


@require_admin
async def admin_create_group(request: web.Request) -> web.Response:
    """Create a new squad group for the active guild."""
    session = await aiohttp_session.get_session(request)
    guild_id = int(session["active_guild_id"])
    bot = request.app["bot"]
    db = bot.db

    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON body."}, status=400)

    group_name = (body.get("group_name") or "").strip()
    if not group_name or len(group_name) > 100:
        return web.json_response({"error": "Group name is required (max 100 chars)."}, status=400)

    # Check for duplicates
    existing = await db.get_squad_group(guild_id, group_name)
    if existing:
        return web.json_response({"error": f"Group '{group_name}' already exists."}, status=409)

    # Check limit
    all_groups = await db.get_squad_groups(guild_id)
    if len(all_groups or []) >= MAX_GROUPS_PER_GUILD:
        return web.json_response(
            {"error": f"Maximum of {MAX_GROUPS_PER_GUILD} groups per community."},
            status=400,
        )

    permissions = (body.get("permissions") or "").strip()
    await db.create_squad_group(guild_id, group_name, permissions, is_default=False)

    log.info("Guild %s: admin created squad group '%s'", guild_id, group_name)
    return web.json_response({"ok": True, "group_name": group_name})


@require_admin
async def admin_update_group(request: web.Request) -> web.Response:
    """Update a squad group's name and/or permissions."""
    session = await aiohttp_session.get_session(request)
    guild_id = int(session["active_guild_id"])
    bot = request.app["bot"]
    db = bot.db

    group_name = request.match_info["group_name"]
    existing = await db.get_squad_group(guild_id, group_name)
    if not existing:
        return web.json_response({"error": "Group not found."}, status=404)

    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON body."}, status=400)

    new_name = (body.get("group_name") or "").strip()
    permissions = (body.get("permissions") or "").strip()

    # If renaming, delete old and create new
    if new_name and new_name != group_name:
        if len(new_name) > 100:
            return web.json_response({"error": "Group name max 100 chars."}, status=400)
        dup = await db.get_squad_group(guild_id, new_name)
        if dup:
            return web.json_response({"error": f"Group '{new_name}' already exists."}, status=409)
        is_default = bool(existing[2])
        await db.delete_squad_group(guild_id, group_name)
        await db.create_squad_group(guild_id, new_name, permissions, is_default=is_default)
        # Update whitelists referencing the old group name
        whitelists = await db.get_whitelists(guild_id)
        for wl in whitelists:
            if wl.get("squad_group") == group_name:
                await db.update_whitelist(wl["id"], squad_group=new_name)
        log.info("Guild %s: admin renamed squad group '%s' -> '%s'", guild_id, group_name, new_name)
    else:
        await db.update_squad_group(guild_id, group_name, permissions)
        log.info("Guild %s: admin updated squad group '%s'", guild_id, group_name)

    return web.json_response({"ok": True})


@require_admin
async def admin_delete_group(request: web.Request) -> web.Response:
    """Delete a squad group (cannot delete the default one)."""
    session = await aiohttp_session.get_session(request)
    guild_id = int(session["active_guild_id"])
    bot = request.app["bot"]
    db = bot.db

    group_name = request.match_info["group_name"]
    existing = await db.get_squad_group(guild_id, group_name)
    if not existing:
        return web.json_response({"error": "Group not found."}, status=404)
    if bool(existing[2]):
        return web.json_response({"error": "Cannot delete the default group."}, status=400)

    await db.delete_squad_group(guild_id, group_name)
    log.info("Guild %s: admin deleted squad group '%s'", guild_id, group_name)
    return web.json_response({"ok": True, "deleted": group_name})


@require_admin
async def admin_get_permissions(request: web.Request) -> web.Response:
    """Return the list of available Squad permissions."""
    return web.json_response({"permissions": SQUAD_PERMISSIONS})


@require_login
async def resolve_steam_names(request: web.Request) -> web.Response:
    """Resolve Steam64 IDs to player names using Steam Web API."""
    body = await request.json()
    steam_ids = body.get("steam_ids", [])

    if not steam_ids or not isinstance(steam_ids, list):
        return web.json_response({"error": "steam_ids array required"}, status=400)

    # Cap at 100 IDs per request
    steam_ids = steam_ids[:100]

    now = time.monotonic()
    results: dict[str, str] = {}
    uncached: list[str] = []

    # Check cache first
    for sid in steam_ids:
        sid = str(sid)
        cached = _steam_name_cache.get(sid)
        if cached and (now - cached[1]) < _STEAM_CACHE_TTL:
            results[sid] = cached[0]
        else:
            uncached.append(sid)

    # Fetch uncached from Steam API
    if uncached and STEAM_API_KEY:
        try:
            # Steam API accepts up to 100 IDs comma-separated
            ids_param = ",".join(uncached)
            url = f"https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key={STEAM_API_KEY}&steamids={ids_param}"
            async with _aiohttp.ClientSession() as session:
                async with session.get(url) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        for player in data.get("response", {}).get("players", []):
                            sid = player.get("steamid", "")
                            name = player.get("personaname", "")
                            avatar = player.get("avatarmedium", "")
                            if sid:
                                results[sid] = name
                                _steam_name_cache[sid] = (name, now)
        except Exception:
            log.debug("Steam API call failed for name resolution")

    # For any still unresolved, return empty string
    for sid in steam_ids:
        sid = str(sid)
        if sid not in results:
            results[sid] = ""

    return web.json_response({"names": results})


# ── Admin Tier Categories API routes ──────────────────────────────────────────

MAX_TIER_CATEGORIES_PER_GUILD = 20


@require_admin
async def admin_get_tier_categories(request: web.Request) -> web.Response:
    """Return all tier categories with their entries for the active guild."""
    session = await aiohttp_session.get_session(request)
    guild_id = int(session["active_guild_id"])
    bot = request.app["bot"]
    db = bot.db

    categories = await db.get_tier_categories(guild_id)

    # Build live role name lookup from Discord API
    role_name_map: dict[str, str] = {}
    try:
        if hasattr(bot, "get_roles"):
            raw_roles = await bot.get_roles(guild_id)
            for r in raw_roles:
                role_name_map[str(r["id"])] = r.get("name", "")
        elif hasattr(bot, "get_guild"):
            guild = bot.get_guild(guild_id)
            if guild:
                for r in guild.roles:
                    role_name_map[str(r.id)] = r.name
    except Exception:
        pass

    result = []
    for cat in categories:
        entries_raw = await db.get_tier_entries(guild_id, cat["id"])
        entries = []
        for e in entries_raw:
            entries.append({
                "id": e[0],
                "role_id": str(e[1]),
                "role_name": role_name_map.get(str(e[1]), e[2] or str(e[1])),
                "slot_limit": e[3],
                "display_name": e[4],
                "sort_order": e[5],
                "is_active": bool(e[6]),
            })
        result.append({
            "id": cat["id"],
            "name": cat["name"],
            "description": cat["description"],
            "is_default": cat["is_default"],
            "entries": entries,
        })

    return web.json_response({"categories": result})


@require_admin
async def admin_create_tier_category(request: web.Request) -> web.Response:
    """Create a new tier category."""
    session = await aiohttp_session.get_session(request)
    guild_id = int(session["active_guild_id"])
    bot = request.app["bot"]
    db = bot.db

    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON body."}, status=400)

    name = (body.get("name") or "").strip()
    if not name or len(name) > 100:
        return web.json_response({"error": "Name is required (max 100 chars)."}, status=400)

    description = (body.get("description") or "").strip()
    if len(description) > 500:
        return web.json_response({"error": "Description too long (max 500 chars)."}, status=400)

    existing = await db.get_tier_categories(guild_id)
    if len(existing) >= MAX_TIER_CATEGORIES_PER_GUILD:
        return web.json_response(
            {"error": f"Maximum of {MAX_TIER_CATEGORIES_PER_GUILD} tier categories per community."},
            status=400,
        )

    # Check for duplicate name
    for cat in existing:
        if cat["name"].lower() == name.lower():
            return web.json_response({"error": "A tier category with that name already exists."}, status=409)

    try:
        cat_id = await db.create_tier_category(guild_id, name, description)
    except Exception:
        return web.json_response({"error": "Failed to create tier category."}, status=500)

    log.info("Guild %s: admin created tier category '%s' (id=%s)", guild_id, name, cat_id)
    return web.json_response({"ok": True, "id": cat_id, "name": name}, status=201)


@require_admin
async def admin_update_tier_category(request: web.Request) -> web.Response:
    """Update a tier category."""
    session = await aiohttp_session.get_session(request)
    guild_id = int(session["active_guild_id"])
    bot = request.app["bot"]
    db = bot.db

    try:
        category_id = int(request.match_info["category_id"])
    except (ValueError, TypeError):
        return web.json_response({"error": "Invalid category_id."}, status=400)

    cat = await db.get_tier_category(category_id)
    if not cat or cat["guild_id"] != guild_id:
        return web.json_response({"error": "Tier category not found."}, status=404)

    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON body."}, status=400)

    update_kwargs = {}
    if "name" in body:
        name = (body["name"] or "").strip()
        if not name or len(name) > 100:
            return web.json_response({"error": "Name is required (max 100 chars)."}, status=400)
        update_kwargs["name"] = name
    if "description" in body:
        desc = (body["description"] or "").strip()
        if len(desc) > 500:
            return web.json_response({"error": "Description too long (max 500 chars)."}, status=400)
        update_kwargs["description"] = desc

    if update_kwargs:
        await db.update_tier_category(category_id, **update_kwargs)

    log.info("Guild %s: admin updated tier category %s: %s", guild_id, category_id, list(body.keys()))
    return web.json_response({"ok": True, "category_id": category_id})


@require_admin
async def admin_delete_tier_category(request: web.Request) -> web.Response:
    """Delete a tier category (cannot delete the default one)."""
    session = await aiohttp_session.get_session(request)
    guild_id = int(session["active_guild_id"])
    bot = request.app["bot"]
    db = bot.db

    try:
        category_id = int(request.match_info["category_id"])
    except (ValueError, TypeError):
        return web.json_response({"error": "Invalid category_id."}, status=400)

    cat = await db.get_tier_category(category_id)
    if not cat or cat["guild_id"] != guild_id:
        return web.json_response({"error": "Tier category not found."}, status=404)
    if cat["is_default"]:
        return web.json_response({"error": "Cannot delete the default tier category."}, status=400)

    await db.delete_tier_category(category_id)

    log.info("Guild %s: admin deleted tier category %s", guild_id, category_id)
    return web.json_response({"ok": True, "deleted_category_id": category_id})


# ── Admin Tier Entries API routes ─────────────────────────────────────────────

@require_admin
async def admin_add_tier_entry(request: web.Request) -> web.Response:
    """Add a tier entry to a category."""
    session = await aiohttp_session.get_session(request)
    guild_id = int(session["active_guild_id"])
    bot = request.app["bot"]
    db = bot.db

    try:
        category_id = int(request.match_info["category_id"])
    except (ValueError, TypeError):
        return web.json_response({"error": "Invalid category_id."}, status=400)

    cat = await db.get_tier_category(category_id)
    if not cat or cat["guild_id"] != guild_id:
        return web.json_response({"error": "Tier category not found."}, status=404)

    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON body."}, status=400)

    role_id = body.get("role_id")
    role_name = body.get("role_name", "")
    slot_limit = body.get("slot_limit", 1)
    display_name = body.get("display_name")

    if not role_id:
        return web.json_response({"error": "role_id is required."}, status=400)

    try:
        role_id = int(role_id)
    except (ValueError, TypeError):
        return web.json_response({"error": "role_id must be numeric."}, status=400)

    try:
        slot_limit = int(slot_limit)
    except (ValueError, TypeError):
        return web.json_response({"error": "slot_limit must be an integer."}, status=400)

    # Determine sort_order (append at end)
    existing_entries = await db.get_tier_entries(guild_id, category_id)
    sort_order = max((e[5] for e in existing_entries), default=-1) + 1

    try:
        entry_id = await db.add_tier_entry(
            guild_id, category_id, role_id, role_name, slot_limit,
            display_name=display_name, sort_order=sort_order,
        )
    except Exception:
        return web.json_response({"error": "Failed to add tier entry."}, status=500)

    # Queue affected panels for auto-refresh
    await db.queue_panels_for_category(guild_id, category_id, reason=f"tier_added:{role_name}")

    log.info("Guild %s: admin added tier entry role %s to category %s", guild_id, role_id, category_id)
    return web.json_response({
        "ok": True,
        "id": entry_id,
        "role_id": str(role_id),
        "role_name": role_name,
        "slot_limit": slot_limit,
        "display_name": display_name,
        "sort_order": sort_order,
    }, status=201)


@require_admin
async def admin_update_tier_entry(request: web.Request) -> web.Response:
    """Update a tier entry."""
    session = await aiohttp_session.get_session(request)
    guild_id = int(session["active_guild_id"])
    bot = request.app["bot"]
    db = bot.db

    try:
        category_id = int(request.match_info["category_id"])
        entry_id = int(request.match_info["entry_id"])
    except (ValueError, TypeError):
        return web.json_response({"error": "Invalid category_id or entry_id."}, status=400)

    cat = await db.get_tier_category(category_id)
    if not cat or cat["guild_id"] != guild_id:
        return web.json_response({"error": "Tier category not found."}, status=404)

    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON body."}, status=400)

    update_kwargs = {}
    if "slot_limit" in body:
        try:
            update_kwargs["slot_limit"] = int(body["slot_limit"])
        except (ValueError, TypeError):
            return web.json_response({"error": "slot_limit must be an integer."}, status=400)
    if "display_name" in body:
        update_kwargs["display_name"] = body["display_name"]
    if "sort_order" in body:
        try:
            update_kwargs["sort_order"] = int(body["sort_order"])
        except (ValueError, TypeError):
            return web.json_response({"error": "sort_order must be an integer."}, status=400)
    if "is_active" in body:
        update_kwargs["is_active"] = bool(body["is_active"])

    if update_kwargs:
        await db.update_tier_entry(entry_id, **update_kwargs)
        # Queue affected panels for auto-refresh
        await db.queue_panels_for_category(guild_id, category_id, reason=f"tier_updated:{entry_id}")

    log.info("Guild %s: admin updated tier entry %s in category %s", guild_id, entry_id, category_id)
    return web.json_response({"ok": True, "entry_id": entry_id})


@require_admin
async def admin_delete_tier_entry(request: web.Request) -> web.Response:
    """Remove a tier entry."""
    session = await aiohttp_session.get_session(request)
    guild_id = int(session["active_guild_id"])
    bot = request.app["bot"]
    db = bot.db

    try:
        category_id = int(request.match_info["category_id"])
        entry_id = int(request.match_info["entry_id"])
    except (ValueError, TypeError):
        return web.json_response({"error": "Invalid category_id or entry_id."}, status=400)

    cat = await db.get_tier_category(category_id)
    if not cat or cat["guild_id"] != guild_id:
        return web.json_response({"error": "Tier category not found."}, status=404)

    await db.remove_tier_entry(entry_id)
    # Queue affected panels for auto-refresh
    await db.queue_panels_for_category(guild_id, category_id, reason=f"tier_removed:{entry_id}")

    log.info("Guild %s: admin deleted tier entry %s from category %s", guild_id, entry_id, category_id)
    return web.json_response({"ok": True, "deleted_entry_id": entry_id})


def setup_routes(app: web.Application):
    # Guild API
    app.router.add_get("/api/guilds", get_guilds)
    app.router.add_post("/api/guilds/switch", switch_guild)
    app.router.add_get("/api/guild/theme", guild_theme)
    # User API
    app.router.add_get("/api/my-whitelist", get_my_whitelists_all)
    app.router.add_get("/api/my-whitelist/{type}", get_my_whitelist)
    app.router.add_post("/api/my-whitelist/{type}", update_my_whitelist)
    app.router.add_put("/api/my-whitelist/{type}", update_my_whitelist)
    # Admin API
    app.router.add_get("/api/admin/stats", admin_stats)
    app.router.add_get("/api/admin/users", admin_users)
    app.router.add_post("/api/admin/users", admin_add_user)
    app.router.add_patch("/api/admin/users/{discord_id}/{type}", admin_update_user)
    app.router.add_delete("/api/admin/users/{discord_id}/{type}", admin_delete_user)
    app.router.add_post("/api/admin/users/bulk-delete", admin_bulk_delete_users)
    app.router.add_post("/api/admin/users/bulk-move", admin_bulk_move_users)
    app.router.add_get("/api/admin/members/gap", admin_members_gap)
    app.router.add_get("/api/admin/audit", admin_audit)
    # Admin Setup API
    app.router.add_get("/api/admin/settings", admin_get_settings)
    app.router.add_post("/api/admin/settings", admin_update_settings)
    app.router.add_post("/api/admin/types/{type}", admin_update_type)
    app.router.add_post("/api/admin/types/{type}/toggle", admin_toggle_type)
    app.router.add_post("/api/admin/roles/{type}", admin_add_role)
    app.router.add_delete("/api/admin/roles/{type}/{role_id}", admin_delete_role)
    app.router.add_get("/api/admin/channels", admin_get_channels)
    app.router.add_get("/api/admin/roles", admin_get_roles)
    # Admin Health / Resync / Report
    app.router.add_get("/api/admin/health", admin_health)
    app.router.add_post("/api/admin/resync", admin_resync)
    app.router.add_post("/api/admin/report", admin_report)
    # Admin Whitelist CRUD
    app.router.add_post("/api/admin/whitelists", admin_create_whitelist)
    app.router.add_delete("/api/admin/whitelists/{slug}", admin_delete_whitelist)
    app.router.add_get("/api/admin/whitelist-urls", admin_get_whitelist_urls)
    # Admin Panel CRUD
    app.router.add_get("/api/admin/panels", admin_get_panels)
    app.router.add_post("/api/admin/panels", admin_create_panel)
    app.router.add_put("/api/admin/panels/{panel_id}", admin_update_panel)
    app.router.add_delete("/api/admin/panels/{panel_id}", admin_delete_panel)
    app.router.add_post("/api/admin/panels/{panel_id}/push", admin_push_panel)
    # Admin Squad Groups CRUD
    app.router.add_get("/api/admin/groups", admin_get_groups)
    app.router.add_post("/api/admin/groups", admin_create_group)
    app.router.add_put("/api/admin/groups/{group_name}", admin_update_group)
    app.router.add_delete("/api/admin/groups/{group_name}", admin_delete_group)
    app.router.add_get("/api/admin/permissions", admin_get_permissions)
    # Admin Import / Export
    app.router.add_post("/api/admin/import/headers", admin_import_headers)
    app.router.add_post("/api/admin/import/preview", admin_import_preview)
    app.router.add_post("/api/admin/import", admin_import)
    app.router.add_post("/api/admin/reconcile/preview", admin_reconcile_preview)
    app.router.add_post("/api/admin/reconcile/apply", admin_reconcile_apply)
    app.router.add_post("/api/admin/reconcile/rematch-orphans", admin_rematch_orphans)
    app.router.add_get("/api/admin/reconcile/suggest", admin_reconcile_suggest)
    app.router.add_post("/api/admin/role-sync/pull", admin_role_sync_pull)
    app.router.add_get("/api/admin/export", admin_export)
    app.router.add_post("/api/admin/verify-roles", admin_verify_roles)
    # Admin Tier Categories CRUD
    app.router.add_get("/api/admin/tier-categories", admin_get_tier_categories)
    app.router.add_post("/api/admin/tier-categories", admin_create_tier_category)
    app.router.add_put("/api/admin/tier-categories/{category_id}", admin_update_tier_category)
    app.router.add_delete("/api/admin/tier-categories/{category_id}", admin_delete_tier_category)
    # Admin Tier Entries CRUD
    app.router.add_post("/api/admin/tier-categories/{category_id}/entries", admin_add_tier_entry)
    app.router.add_put("/api/admin/tier-categories/{category_id}/entries/{entry_id}", admin_update_tier_entry)
    app.router.add_delete("/api/admin/tier-categories/{category_id}/entries/{entry_id}", admin_delete_tier_entry)
    # Steam name resolution
    app.router.add_post("/api/steam/names", resolve_steam_names)
