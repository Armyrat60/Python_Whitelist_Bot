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
                    expires_at: str | None = None) -> str:
    """Encode plan/notes/expires_at into a JSON string for last_plan_name."""
    payload: dict = {}
    if plan:
        payload["plan"] = plan
    if notes:
        payload["notes"] = notes
    if expires_at:
        payload["expires_at"] = expires_at
    return json.dumps(payload) if payload else ""


def _unpack_plan_meta(raw: str | None) -> dict:
    """Decode last_plan_name into {"plan", "notes", "expires_at"} dict.

    If the stored value is plain text (not JSON), treat it as the plan name.
    """
    if not raw:
        return {"plan": None, "notes": None, "expires_at": None}
    try:
        data = json.loads(raw)
        if isinstance(data, dict):
            return {
                "plan": data.get("plan"),
                "notes": data.get("notes"),
                "expires_at": data.get("expires_at"),
            }
    except (json.JSONDecodeError, TypeError):
        pass
    # Fallback: treat raw string as legacy plan name
    return {"plan": raw, "notes": None, "expires_at": None}


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


def require_admin(handler: Callable) -> Callable:
    """Decorator that checks the user is a mod/admin for the ACTIVE guild."""
    @functools.wraps(handler)
    async def wrapper(request: web.Request) -> web.Response:
        session = await aiohttp_session.get_session(request)
        if not session.get("logged_in"):
            return web.json_response({"error": "Authentication required."}, status=401)
        active_guild_id = session.get("active_guild_id")
        if not active_guild_id:
            return web.json_response({"error": "No active guild selected."}, status=400)
        # Check is_mod for the active guild
        guilds = session.get("guilds", [])
        active_guild = _find_guild_in_session(guilds, active_guild_id)
        if not active_guild or not active_guild.get("is_mod"):
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


# ── User API routes ──────────────────────────────────────────────────────────

@require_login
async def get_my_whitelists_all(request: web.Request) -> web.Response:
    """Return all whitelists the user is enrolled in with their identifiers."""
    session = await aiohttp_session.get_session(request)
    bot = request.app["bot"]
    guild_id = int(session["active_guild_id"])
    discord_id = int(session["discord_id"])
    db = bot.db

    whitelists = await db.get_whitelists(guild_id)
    results = []
    for wl in whitelists:
        if not wl["enabled"]:
            continue
        wl_id = wl["id"]
        user_record = await db.get_user_record(guild_id, discord_id, wl_id)
        identifiers = await db.get_identifiers(guild_id, discord_id, wl_id)

        steam_ids = [row[1] for row in identifiers if row[0] == "steam64"]
        eos_ids = [row[1] for row in identifiers if row[0] == "eosid"]

        entry = {
            "whitelist_slug": wl["slug"],
            "whitelist_name": wl["name"],
            "tier_name": None,
            "effective_slot_limit": wl.get("default_slot_limit", 1),
            "steam_ids": steam_ids,
            "eos_ids": eos_ids,
        }
        if user_record:
            entry["tier_name"] = user_record[4]  # last_plan_name
            entry["effective_slot_limit"] = user_record[3]  # effective_slot_limit
        results.append(entry)

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
    # Each "slot" allows one steam + one eos pair, so check max of each
    if len(steam_ids) > slot_limit:
        return web.json_response(
            {"error": f"Too many Steam IDs. Your limit is {slot_limit}."},
            status=400,
        )
    if len(eos_ids) > slot_limit:
        return web.json_response(
            {"error": f"Too many EOS IDs. Your limit is {slot_limit}."},
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
    wl_type = request.query.get("type", "").strip()
    status = request.query.get("status", "").strip()
    page = max(1, int(request.query.get("page", "1")))
    per_page = min(100, max(1, int(request.query.get("per_page", "25"))))

    conditions = ["u.guild_id=%s"]
    params: list = [guild_id]

    if search:
        cast_expr = "CAST(u.discord_id AS TEXT)" if db.engine == "postgres" else "CAST(u.discord_id AS CHAR)"
        conditions.append(f"(u.discord_name LIKE %s OR {cast_expr} LIKE %s)")
        params.extend([f"%{search}%", f"%{search}%"])
    if wl_type:
        wl_resolved = await _resolve_whitelist(bot.db, guild_id, wl_type)
        if wl_resolved:
            conditions.append("u.whitelist_id=%s")
            params.append(wl_resolved["id"])
    if status:
        conditions.append("u.status=%s")
        params.append(status)

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
               u.effective_slot_limit, u.last_plan_name, u.updated_at
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
            SELECT i.discord_id, i.id_type, i.id_value, w.slug
            FROM whitelist_identifiers i
            LEFT JOIN whitelists w ON w.id = i.whitelist_id
            WHERE i.guild_id=%s AND CAST(i.discord_id AS TEXT) IN ({placeholders})
            """ if db.engine == "postgres" else f"""
            SELECT i.discord_id, i.id_type, i.id_value, w.slug
            FROM whitelist_identifiers i
            LEFT JOIN whitelists w ON w.id = i.whitelist_id
            WHERE i.guild_id=%s AND CAST(i.discord_id AS CHAR) IN ({placeholders})
            """,
            tuple([guild_id] + discord_id_list),
        )
        for irow in (id_rows or []):
            key = f"{irow[0]}:{irow[3] or ''}"
            if key not in id_map:
                id_map[key] = {"steam_ids": [], "eos_ids": []}
            if irow[1] == "steam64":
                id_map[key]["steam_ids"].append(str(irow[2]))
            elif irow[1] == "eosid":
                id_map[key]["eos_ids"].append(str(irow[2]))

    users = []
    for row in rows:
        meta = _unpack_plan_meta(row[5])
        key = f"{row[0]}:{row[2] or ''}"
        ids = id_map.get(key, {"steam_ids": [], "eos_ids": []})
        users.append({
            "discord_id": str(row[0]),
            "discord_name": row[1],
            "whitelist_type": row[2] or "",
            "whitelist_slug": row[2] or "",
            "status": row[3],
            "effective_slot_limit": row[4],
            "last_plan_name": meta["plan"],
            "notes": meta["notes"],
            "expires_at": meta["expires_at"],
            "updated_at": str(row[6]) if row[6] else "",
            "created_at": str(row[6]) if row[6] else "",
            "steam_ids": ids["steam_ids"],
            "eos_ids": ids["eos_ids"],
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
    wl_type = body.get("whitelist_type", "").strip()
    steam_ids = body.get("steam_ids", [])

    if not discord_name:
        return web.json_response({"error": "discord_name is required."}, status=400)
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

    # -- Notes and expires_at --
    new_notes = current_meta.get("notes")
    new_expires = current_meta.get("expires_at")
    new_plan = current_meta.get("plan")

    if "notes" in body:
        new_notes = body["notes"] if body["notes"] else None
        changes.append("notes updated")
    if "expires_at" in body:
        new_expires = body["expires_at"] if body["expires_at"] else None
        changes.append(f"expires_at: {new_expires}")

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

    # Check each whitelist type for missing config
    whitelists = await db.get_whitelists(guild_id)
    for wl in whitelists:
        if not wl["enabled"]:
            continue
        wl_slug = wl["slug"]
        wl_id = wl["id"]
        if not wl.get("panel_channel_id"):
            alerts.append({
                "level": "warning",
                "message": f"{wl_slug} type is enabled but has no panel_channel_id configured",
            })
        if not wl.get("log_channel_id"):
            alerts.append({
                "level": "warning",
                "message": f"{wl_slug} type is enabled but has no log_channel_id configured",
            })
        # Check role mappings
        is_active_expr = "is_active=TRUE" if db.engine == "postgres" else "is_active=1"
        role_rows = await db.fetchall(
            f"SELECT id FROM role_mappings WHERE guild_id=%s AND whitelist_id=%s AND {is_active_expr}",
            (guild_id, wl_id),
        )
        if not role_rows:
            alerts.append({
                "level": "warning",
                "message": f"{wl_slug} type has no role mappings configured",
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


def _parse_squad_cfg_data(data: str, existing_steam_ids: set) -> tuple[list[dict], dict]:
    """Parse Squad RemoteAdminList / cfg format.

    Lines like: Admin=76561198012345678:reserve // PlayerName
    """
    rows: list[dict] = []
    summary = {"total": 0, "new": 0, "duplicate": 0, "invalid": 0}

    admin_re = re.compile(
        r"^Admin\s*=\s*(\d{17})\s*:\s*\S+(?:\s*//\s*(.*))?$", re.IGNORECASE,
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
            if part.name in ("data", "file", "paste_data"):
                data = (await part.read(decode=True)).decode("utf-8", errors="replace")
            elif part.name == "format":
                fmt = (await part.read(decode=True)).decode().strip()
            elif part.name in ("whitelist_type", "type"):
                wl_type = (await part.read(decode=True)).decode().strip()
            elif part.name == "column_map":
                column_map_raw = (await part.read(decode=True)).decode().strip()
            elif part.name == "duplicate_handling":
                pass  # Used in import, not preview
    else:
        try:
            body = await request.json()
        except Exception:
            return web.json_response({"error": "Invalid request body."}, status=400)
        data = body.get("data", "") or body.get("paste_data", "")
        fmt = body.get("format", "csv")
        wl_type = body.get("whitelist_type", "") or body.get("type", "")
        column_map_raw = ""
        if "column_map" in body:
            column_map_raw = json.dumps(body["column_map"]) if isinstance(body["column_map"], dict) else body["column_map"]
        if isinstance(body.get("plan_map"), dict):
            plan_map = {k: int(v) for k, v in body["plan_map"].items()}

    if not data:
        return web.json_response({"error": "No data provided."}, status=400)
    wl = await _resolve_whitelist(bot.db, guild_id, wl_type)
    if not wl:
        valid_slugs = await _get_whitelist_slugs(bot.db, guild_id)
        return web.json_response({"error": f"Invalid whitelist_type. Must be one of: {', '.join(valid_slugs)}"}, status=400)
    wl_id = wl["id"]
    if fmt not in ("csv", "squad_cfg"):
        return web.json_response({"error": "format must be 'csv' or 'squad_cfg'."}, status=400)

    # Parse column_map if provided
    column_map: dict[str, str] | None = None
    if column_map_raw:
        try:
            column_map = json.loads(column_map_raw)
        except (json.JSONDecodeError, TypeError):
            return web.json_response({"error": "Invalid column_map JSON."}, status=400)

    existing_steam = await _get_existing_steam_ids(db, guild_id, wl_id)

    if fmt == "csv":
        rows, raw_summary = _parse_csv_data(data, guild_id, wl_type, existing_steam, column_map=column_map)
    else:
        rows, raw_summary = _parse_squad_cfg_data(data, existing_steam)

    # Get existing discord_ids for this whitelist to determine new vs existing
    existing_users_rows = await db.fetchall(
        "SELECT discord_id FROM whitelist_users WHERE guild_id=%s AND whitelist_id=%s",
        (guild_id, wl_id),
    )
    existing_discord_ids: set[int] = {row[0] for row in (existing_users_rows or [])}

    default_slot = wl["default_slot_limit"] or 1
    users = _group_rows_by_user(rows, default_slot, existing_discord_ids, plan_map=plan_map)

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
            if part.name in ("data", "file", "paste_data"):
                data = (await part.read(decode=True)).decode("utf-8", errors="replace")
            elif part.name == "format":
                fmt = (await part.read(decode=True)).decode().strip()
            elif part.name in ("whitelist_type", "type"):
                wl_type = (await part.read(decode=True)).decode().strip()
            elif part.name == "duplicate_handling":
                dup_handling = (await part.read(decode=True)).decode().strip()
            elif part.name == "column_map":
                column_map_raw = (await part.read(decode=True)).decode().strip()
    else:
        try:
            body = await request.json()
        except Exception:
            return web.json_response({"error": "Invalid request body."}, status=400)
        data = body.get("data", "") or body.get("paste_data", "")
        fmt = body.get("format", "csv")
        wl_type = body.get("whitelist_type", "") or body.get("type", "")
        dup_handling = body.get("duplicate_handling", "skip")
        column_map_raw = ""
        if "column_map" in body:
            column_map_raw = json.dumps(body["column_map"]) if isinstance(body["column_map"], dict) else body["column_map"]
        plan_map = None
        if isinstance(body.get("plan_map"), dict):
            plan_map = {k: int(v) for k, v in body["plan_map"].items()}

    if not data:
        return web.json_response({"error": "No data provided."}, status=400)
    wl = await _resolve_whitelist(bot.db, guild_id, wl_type)
    if not wl:
        valid_slugs = await _get_whitelist_slugs(bot.db, guild_id)
        return web.json_response({"error": f"Invalid whitelist_type. Must be one of: {', '.join(valid_slugs)}"}, status=400)
    wl_id = wl["id"]
    if fmt not in ("csv", "squad_cfg"):
        return web.json_response({"error": "format must be 'csv' or 'squad_cfg'."}, status=400)
    if dup_handling not in ("skip", "overwrite", "merge"):
        return web.json_response({"error": "duplicate_handling must be 'skip', 'overwrite', or 'merge'."}, status=400)

    # Parse column_map if provided
    column_map: dict[str, str] | None = None
    if column_map_raw:
        try:
            column_map = json.loads(column_map_raw)
        except (json.JSONDecodeError, TypeError):
            return web.json_response({"error": "Invalid column_map JSON."}, status=400)

    existing_steam = await _get_existing_steam_ids(db, guild_id, wl_id)

    if fmt == "csv":
        rows, _ = _parse_csv_data(data, guild_id, wl_type, existing_steam, column_map=column_map)
    else:
        rows, _ = _parse_squad_cfg_data(data, existing_steam)

    default_slot = wl["default_slot_limit"] or 1

    # Get existing discord_ids
    existing_users_rows = await db.fetchall(
        "SELECT discord_id FROM whitelist_users WHERE guild_id=%s AND whitelist_id=%s",
        (guild_id, wl_id),
    )
    existing_discord_ids: set[int] = {row[0] for row in (existing_users_rows or [])}

    # Group rows by user (use plan_map if provided for slot limits)
    users = _group_rows_by_user(rows, default_slot, existing_discord_ids, plan_map=plan_map)

    added = 0
    updated = 0
    skipped = 0
    errors = 0
    id_counter = int(time.time() * 1000)

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
        if discord_id == 0:
            id_counter += 1
            discord_id = -abs(id_counter)

        is_existing = user["status"] == "existing"

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
        "added": added,
        "updated": updated,
        "skipped": skipped,
        "errors": errors,
    })


@require_admin
async def admin_export(request: web.Request) -> web.Response:
    """Export whitelist data in various formats."""
    session = await aiohttp_session.get_session(request)
    guild_id = int(session["active_guild_id"])
    bot = request.app["bot"]
    db = bot.db

    wl_type = request.query.get("type", "").strip()
    fmt = request.query.get("format", "csv").strip()
    filt = request.query.get("filter", "active").strip()
    columns_param = request.query.get("columns", "").strip()

    if fmt not in ("csv", "squad_cfg", "json"):
        return web.json_response({"error": "format must be 'csv', 'squad_cfg', or 'json'."}, status=400)
    if filt not in ("active", "all", "expired"):
        return web.json_response({"error": "filter must be 'active', 'all', or 'expired'."}, status=400)

    # Determine which whitelists to query
    whitelists = await db.get_whitelists(guild_id)
    wl_by_slug = {wl["slug"]: wl for wl in whitelists}

    if wl_type == "combined":
        wls_to_query = whitelists
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

    # Build the panel embed
    wl = await db.get_whitelist(panel["whitelist_id"])
    wl_name = wl["name"] if wl else "Whitelist"

    # Get tiers: prefer tier_category_id on panel, fall back to role_mappings
    # Use plain text names (not role mentions) to avoid pinging members on embed update
    tier_lines = []
    if panel.get("tier_category_id"):
        tier_entries = await db.get_tier_entries(guild_id, panel["tier_category_id"])
        for te in tier_entries:
            if not bool(te[6]):
                continue
            display = te[4] or te[2]  # display_name or role_name
            slots = te[3]
            tier_lines.append(f"**{display}** — {slots} {'slot' if slots == 1 else 'slots'}")
    else:
        role_mappings = await db.get_role_mappings(guild_id, panel["whitelist_id"])
        for rm in role_mappings:
            if isinstance(rm, tuple):
                name = rm[1] if len(rm) > 1 else "Unknown"
                slots = rm[2] if len(rm) > 2 else 1
            else:
                name = rm.get("role_name", "Unknown")
                slots = rm.get("slot_limit", 1)
            tier_lines.append(f"**{name}** — {slots} {'slot' if slots == 1 else 'slots'}")

    description = "Use the buttons below to manage your whitelist entry.\n\n"
    if tier_lines:
        description += "**Available Tiers:**\n" + "\n".join(tier_lines) + "\n\n"
    description += (
        "🛡️ **Submit / Update ID** — Enter your Steam64 or EOS ID\n"
        "📋 **View My Whitelist** — Check your current entry and slots\n"
        "🌐 **Web Dashboard** — Manage everything from the browser"
    )

    _domain = WEB_BASE_URL.replace("https://", "").replace("http://", "") if WEB_BASE_URL else "squadwhitelister.com"
    _dashboard_url = WEB_BASE_URL or "https://squadwhitelister.com"
    wl_slug = wl["slug"] if wl else "default"

    embed = {
        "title": f"🛡️ {panel['name']} — {wl_name}",
        "description": description,
        "color": 0xF97316,  # Orange
        "footer": {"text": f"Squad Whitelister • {_domain}"},
    }

    # Build interactive button components
    # These custom_ids match the bot-worker's persistent views, so the bot handles clicks
    components = [
        {
            "type": 1,  # ACTION_ROW
            "components": [
                {
                    "type": 2,  # BUTTON
                    "style": 3,  # SUCCESS (green)
                    "label": "Submit / Update ID",
                    "emoji": {"name": "🛡️"},
                    "custom_id": f"panel:submit:{wl_slug}",
                },
                {
                    "type": 2,  # BUTTON
                    "style": 1,  # PRIMARY (blue)
                    "label": "View My Whitelist",
                    "emoji": {"name": "📋"},
                    "custom_id": f"panel:view:{wl_slug}",
                },
                {
                    "type": 2,  # BUTTON
                    "style": 5,  # LINK
                    "label": "Web Dashboard",
                    "emoji": {"name": "🌐"},
                    "url": f"{_dashboard_url}/my-whitelist",
                },
            ],
        },
        {
            "type": 1,  # ACTION_ROW
            "components": [
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

    log.info("Guild %s: admin deleted tier entry %s from category %s", guild_id, entry_id, category_id)
    return web.json_response({"ok": True, "deleted_entry_id": entry_id})


def setup_routes(app: web.Application):
    # Guild API
    app.router.add_get("/api/guilds", get_guilds)
    app.router.add_post("/api/guilds/switch", switch_guild)
    # User API
    app.router.add_get("/api/my-whitelist", get_my_whitelists_all)
    app.router.add_get("/api/my-whitelist/{type}", get_my_whitelist)
    app.router.add_post("/api/my-whitelist/{type}", update_my_whitelist)
    # Admin API
    app.router.add_get("/api/admin/stats", admin_stats)
    app.router.add_get("/api/admin/users", admin_users)
    app.router.add_post("/api/admin/users", admin_add_user)
    app.router.add_patch("/api/admin/users/{discord_id}/{type}", admin_update_user)
    app.router.add_delete("/api/admin/users/{discord_id}/{type}", admin_delete_user)
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
