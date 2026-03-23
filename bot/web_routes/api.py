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

from bot.config import WHITELIST_TYPES, DEFAULT_SETTINGS, SQUAD_PERMISSIONS, STEAM64_RE, EOSID_RE, log
from bot.utils import utcnow


# ── Helpers ─────────────────────────────────────────────────────────────────

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
async def get_my_whitelist(request: web.Request) -> web.Response:
    """Return the user's identifiers for a given whitelist type."""
    session = await aiohttp_session.get_session(request)
    wl_type = request.match_info["type"]
    if wl_type not in WHITELIST_TYPES:
        return web.json_response({"error": "Invalid whitelist type."}, status=400)

    bot = request.app["bot"]
    guild_id = int(session["active_guild_id"])
    discord_id = int(session["discord_id"])

    user_record = await bot.db.get_user_record(guild_id, discord_id, wl_type)
    identifiers = await bot.db.get_identifiers(guild_id, discord_id, wl_type)

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
    if wl_type not in WHITELIST_TYPES:
        return web.json_response({"error": "Invalid whitelist type."}, status=400)

    bot = request.app["bot"]
    guild_id = int(session["active_guild_id"])
    discord_id = int(session["discord_id"])
    username = session.get("username", "Unknown")

    # Check type is enabled
    type_config = await bot.db.get_type_config(guild_id, wl_type)
    if not type_config or not type_config["enabled"]:
        return web.json_response({"error": "This whitelist type is not enabled."}, status=400)

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
    user_record = await bot.db.get_user_record(guild_id, discord_id, wl_type)
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
    await bot.db.replace_identifiers(guild_id, discord_id, wl_type, identifiers)

    # Ensure user record exists
    if not user_record:
        await bot.db.upsert_user_record(
            guild_id, discord_id, wl_type, username, "active",
            slot_limit, "web", None,
        )

    # Audit
    await bot.db.audit(
        guild_id, "web_update_ids", discord_id, discord_id,
        f"Updated {wl_type} IDs via web: {len(steam_ids)} steam, {len(eos_ids)} eos",
        wl_type,
    )

    # Trigger sync
    try:
        if hasattr(bot, "schedule_sync"):
            bot.schedule_sync()
    except Exception:
        log.debug("Could not trigger sync after web update")

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
    for wl_type in WHITELIST_TYPES:
        active_row = await db.fetchone(
            "SELECT COUNT(*) FROM whitelist_users WHERE guild_id=%s AND whitelist_type=%s AND status='active'",
            (guild_id, wl_type),
        )
        id_row = await db.fetchone(
            "SELECT COUNT(*) FROM whitelist_identifiers WHERE guild_id=%s AND whitelist_type=%s",
            (guild_id, wl_type),
        )
        stats[wl_type] = {
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
        conditions.append("(u.discord_name LIKE %s OR CAST(u.discord_id AS CHAR) LIKE %s)")
        params.extend([f"%{search}%", f"%{search}%"])
    if wl_type and wl_type in WHITELIST_TYPES:
        conditions.append("u.whitelist_type=%s")
        params.append(wl_type)
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
        SELECT u.discord_id, u.discord_name, u.whitelist_type, u.status,
               u.effective_slot_limit, u.last_plan_name, u.updated_at
        FROM whitelist_users u
        {where}
        ORDER BY u.updated_at DESC
        LIMIT %s OFFSET %s
        """,
        tuple(params_page),
    )

    users = []
    for row in rows:
        meta = _unpack_plan_meta(row[5])
        users.append({
            "discord_id": str(row[0]),
            "discord_name": row[1],
            "whitelist_type": row[2],
            "status": row[3],
            "effective_slot_limit": row[4],
            "last_plan_name": meta["plan"],
            "notes": meta["notes"],
            "expires_at": meta["expires_at"],
            "updated_at": str(row[6]) if row[6] else "",
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

    if wl_type and wl_type in WHITELIST_TYPES:
        conditions.append("a.whitelist_type=%s")
        params.append(wl_type)
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
        SELECT a.id, a.whitelist_type, a.action_type, a.actor_discord_id,
               a.target_discord_id, a.details, a.created_at
        FROM audit_log a
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
            "whitelist_type": row[1],
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
    if wl_type not in WHITELIST_TYPES:
        return web.json_response({"error": f"Invalid whitelist_type. Must be one of: {', '.join(WHITELIST_TYPES)}"}, status=400)
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
    existing = await db.get_user_record(guild_id, discord_id, wl_type)
    if existing:
        return web.json_response(
            {"error": f"User {discord_id} already exists for whitelist type '{wl_type}'. Use PATCH to update."},
            status=409,
        )

    # -- Determine effective slot limit --
    type_config = await db.get_type_config(guild_id, wl_type)
    default_slot = type_config["default_slot_limit"] if type_config else 1
    effective_slot = slot_limit if slot_limit is not None else default_slot

    # -- Pack notes/expires_at into last_plan_name --
    plan_meta = _pack_plan_meta(notes=notes, expires_at=expires_at)

    # -- Create user record --
    await db.upsert_user_record(
        guild_id, discord_id, wl_type, discord_name, "active",
        effective_slot, plan_meta,
        slot_limit_override=slot_limit,
    )

    # -- Create identifiers --
    identifiers = []
    for sid in steam_ids:
        identifiers.append(("steam64", str(sid), False, "admin_web"))
    for eid in eos_ids:
        identifiers.append(("eosid", str(eid), False, "admin_web"))
    await db.replace_identifiers(guild_id, discord_id, wl_type, identifiers)

    # -- Audit --
    detail_parts = [f"Admin added user '{discord_name}' (discord_id={discord_id}) to {wl_type}"]
    detail_parts.append(f"steam_ids={steam_ids}")
    if eos_ids:
        detail_parts.append(f"eos_ids={eos_ids}")
    if notes:
        detail_parts.append(f"notes={notes}")
    if expires_at:
        detail_parts.append(f"expires_at={expires_at}")
    await db.audit(guild_id, "admin_add_user", actor_id, discord_id, "; ".join(detail_parts), wl_type)

    log.info("Guild %s: admin %s added user %s (%s) to %s", guild_id, actor_id, discord_id, discord_name, wl_type)

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
    if wl_type not in WHITELIST_TYPES:
        return web.json_response({"error": "Invalid whitelist type."}, status=400)

    # -- Check user exists --
    user_record = await db.get_user_record(guild_id, discord_id, wl_type)
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
            type_config = await db.get_type_config(guild_id, wl_type)
            new_effective_slot = type_config["default_slot_limit"] if type_config else 1
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
        await db.replace_identifiers(guild_id, discord_id, wl_type, identifiers)
        changes.append(f"identifiers replaced: {len(steam_ids)} steam, {len(eos_ids)} eos")

    # -- Update user record --
    await db.upsert_user_record(
        guild_id, discord_id, wl_type, current_name, new_status,
        new_effective_slot, plan_meta,
        slot_limit_override=new_slot_override,
    )

    # -- Audit --
    if changes:
        await db.audit(
            guild_id, "admin_update_user", actor_id, discord_id,
            f"Admin updated user {discord_id} in {wl_type}: {'; '.join(changes)}",
            wl_type,
        )

    log.info("Guild %s: admin %s updated user %s/%s: %s", guild_id, actor_id, discord_id, wl_type, changes)

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
    if wl_type not in WHITELIST_TYPES:
        return web.json_response({"error": "Invalid whitelist type."}, status=400)

    # -- Check user exists --
    user_record = await db.get_user_record(guild_id, discord_id, wl_type)
    if not user_record:
        return web.json_response({"error": "User not found."}, status=404)

    discord_name = user_record[0]

    # -- Delete identifiers --
    await db.execute(
        "DELETE FROM whitelist_identifiers WHERE guild_id=%s AND discord_id=%s AND whitelist_type=%s",
        (guild_id, discord_id, wl_type),
    )

    # -- Delete user record --
    await db.execute(
        "DELETE FROM whitelist_users WHERE guild_id=%s AND discord_id=%s AND whitelist_type=%s",
        (guild_id, discord_id, wl_type),
    )

    # -- Audit --
    await db.audit(
        guild_id, "admin_delete_user", actor_id, discord_id,
        f"Admin removed user '{discord_name}' (discord_id={discord_id}) from {wl_type}",
        wl_type,
    )

    log.info("Guild %s: admin %s deleted user %s (%s) from %s", guild_id, actor_id, discord_id, discord_name, wl_type)

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

    # Whitelist type configs
    type_configs = {}
    for wl_type in WHITELIST_TYPES:
        cfg = await db.get_type_config(guild_id, wl_type)
        type_configs[wl_type] = cfg if cfg else {}

    # Role mappings per type
    role_mappings = {}
    for wl_type in WHITELIST_TYPES:
        rows = await db.fetchall(
            "SELECT id, role_id, role_name, slot_limit, is_active "
            "FROM role_mappings WHERE guild_id=%s AND whitelist_type=%s "
            "ORDER BY role_name",
            (guild_id, wl_type),
        )
        role_mappings[wl_type] = [
            {
                "id": row[0],
                "role_id": str(row[1]),
                "role_name": row[2],
                "slot_limit": row[3],
                "is_active": bool(row[4]),
            }
            for row in (rows or [])
        ]

    # Squad groups
    squad_rows = await db.fetchall(
        "SELECT DISTINCT squad_group FROM whitelist_types "
        "WHERE guild_id=%s AND squad_group IS NOT NULL AND squad_group != ''",
        (guild_id,),
    )
    squad_groups = [row[0] for row in (squad_rows or [])]

    return web.json_response({
        "bot_settings": bot_settings,
        "type_configs": type_configs,
        "role_mappings": role_mappings,
        "squad_groups": squad_groups,
        "squad_permissions": SQUAD_PERMISSIONS,
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
    if wl_type not in WHITELIST_TYPES:
        return web.json_response({"error": "Invalid whitelist type."}, status=400)

    bot = request.app["bot"]
    db = bot.db

    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON body."}, status=400)

    if not isinstance(body, dict) or not body:
        return web.json_response({"error": "Body must be a non-empty JSON object."}, status=400)

    allowed_columns = {
        "enabled", "panel_channel_id", "log_channel_id", "github_enabled",
        "github_filename", "input_mode", "stack_roles", "default_slot_limit",
        "squad_group",
    }

    # Validate keys
    for key in body:
        if key not in allowed_columns:
            return web.json_response({"error": f"Unknown type config field: {key}"}, status=400)

    # Check if row exists
    existing = await db.fetchone(
        "SELECT guild_id FROM whitelist_types WHERE guild_id=%s AND whitelist_type=%s",
        (guild_id, wl_type),
    )

    now = utcnow()

    # Boolean columns need native types for PostgreSQL
    bool_columns = {"enabled", "github_enabled", "stack_roles", "is_active"}
    int_columns = {"default_slot_limit", "panel_channel_id", "log_channel_id", "panel_message_id"}

    def _coerce(key, value):
        if key in bool_columns:
            if db.engine == "postgres":
                return bool(value) if not isinstance(value, bool) else value
            return int(bool(value))
        if key in int_columns and value is not None:
            return int(value) if str(value).strip() else None
        return str(value)

    if existing:
        # Build dynamic UPDATE
        set_parts = []
        params = []
        for key, value in body.items():
            set_parts.append(f"{key}=%s")
            params.append(_coerce(key, value))
        set_parts.append("updated_at=%s")
        params.append(now)
        params.extend([guild_id, wl_type])
        await db.execute(
            f"UPDATE whitelist_types SET {', '.join(set_parts)} "
            f"WHERE guild_id=%s AND whitelist_type=%s",
            tuple(params),
        )
    else:
        # INSERT new row with provided values
        columns = ["guild_id", "whitelist_type", "updated_at"]
        placeholders = ["%s", "%s", "%s"]
        params = [guild_id, wl_type, now]
        for key, value in body.items():
            columns.append(key)
            placeholders.append("%s")
            params.append(_coerce(key, value))
        await db.execute(
            f"INSERT INTO whitelist_types ({', '.join(columns)}) VALUES ({', '.join(placeholders)})",
            tuple(params),
        )

    log.info("Guild %s: admin updated type config %s: %s", guild_id, wl_type, list(body.keys()))
    return web.json_response({"ok": True, "type": wl_type, "updated": list(body.keys())})


@require_admin
async def admin_toggle_type(request: web.Request) -> web.Response:
    """Quick toggle enable/disable for a whitelist type."""
    session = await aiohttp_session.get_session(request)
    guild_id = int(session["active_guild_id"])
    wl_type = request.match_info["type"]
    if wl_type not in WHITELIST_TYPES:
        return web.json_response({"error": "Invalid whitelist type."}, status=400)

    bot = request.app["bot"]
    db = bot.db

    # Get current state
    cfg = await db.get_type_config(guild_id, wl_type)
    current_enabled = cfg.get("enabled", False) if cfg else False
    new_enabled = not current_enabled

    now = utcnow()

    existing = await db.fetchone(
        "SELECT guild_id FROM whitelist_types WHERE guild_id=%s AND whitelist_type=%s",
        (guild_id, wl_type),
    )

    if existing:
        await db.execute(
            "UPDATE whitelist_types SET enabled=%s, updated_at=%s "
            "WHERE guild_id=%s AND whitelist_type=%s",
            (new_enabled if db.engine == 'postgres' else int(new_enabled), now, guild_id, wl_type),
        )
    else:
        await db.execute(
            "INSERT INTO whitelist_types (guild_id, whitelist_type, enabled, updated_at) "
            "VALUES (%s, %s, %s, %s)",
            (guild_id, wl_type, new_enabled if db.engine == 'postgres' else int(new_enabled), now),
        )

    log.info("Guild %s: admin toggled type %s -> %s", guild_id, wl_type, new_enabled)
    return web.json_response({"ok": True, "type": wl_type, "enabled": new_enabled})


@require_admin
async def admin_add_role(request: web.Request) -> web.Response:
    """Add a role mapping for a whitelist type."""
    session = await aiohttp_session.get_session(request)
    guild_id = int(session["active_guild_id"])
    wl_type = request.match_info["type"]
    if wl_type not in WHITELIST_TYPES:
        return web.json_response({"error": "Invalid whitelist type."}, status=400)

    bot = request.app["bot"]
    db = bot.db

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
        role_id = str(int(role_id))
    except (ValueError, TypeError):
        return web.json_response({"error": "role_id must be a numeric string."}, status=400)

    try:
        slot_limit = int(slot_limit)
    except (ValueError, TypeError):
        return web.json_response({"error": "slot_limit must be an integer."}, status=400)

    # Check for duplicate
    dup = await db.fetchone(
        "SELECT id FROM role_mappings WHERE guild_id=%s AND whitelist_type=%s AND role_id=%s",
        (guild_id, wl_type, role_id),
    )
    if dup:
        return web.json_response({"error": "Role mapping already exists for this type."}, status=409)

    now = utcnow()
    await db.execute(
        "INSERT INTO role_mappings (guild_id, whitelist_type, role_id, role_name, slot_limit, is_active, created_at) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s)",
        (guild_id, wl_type, role_id, role_name, slot_limit, True, now),
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
    role_id = request.match_info["role_id"]

    if wl_type not in WHITELIST_TYPES:
        return web.json_response({"error": "Invalid whitelist type."}, status=400)

    bot = request.app["bot"]
    db = bot.db

    existing = await db.fetchone(
        "SELECT id FROM role_mappings WHERE guild_id=%s AND whitelist_type=%s AND role_id=%s",
        (guild_id, wl_type, role_id),
    )
    if not existing:
        return web.json_response({"error": "Role mapping not found."}, status=404)

    await db.execute(
        "DELETE FROM role_mappings WHERE guild_id=%s AND whitelist_type=%s AND role_id=%s",
        (guild_id, wl_type, role_id),
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
    for wl_type in WHITELIST_TYPES:
        cfg = await db.get_type_config(guild_id, wl_type)
        if not cfg or not cfg.get("enabled"):
            continue
        if not cfg.get("panel_channel_id"):
            alerts.append({
                "level": "warning",
                "message": f"{wl_type} type is enabled but has no panel_channel_id configured",
            })
        if not cfg.get("log_channel_id"):
            alerts.append({
                "level": "warning",
                "message": f"{wl_type} type is enabled but has no log_channel_id configured",
            })
        # Check role mappings
        role_rows = await db.fetchall(
            "SELECT id FROM role_mappings WHERE guild_id=%s AND whitelist_type=%s AND is_active=1",
            (guild_id, wl_type),
        )
        if not role_rows:
            alerts.append({
                "level": "warning",
                "message": f"{wl_type} type has no role mappings configured",
            })

    # Duplicate Steam IDs across different whitelist types
    dup_rows = await db.fetchall(
        "SELECT i.id_value, GROUP_CONCAT(DISTINCT i.whitelist_type) AS types, COUNT(DISTINCT i.whitelist_type) AS cnt "
        "FROM whitelist_identifiers i "
        "WHERE i.guild_id=%s AND i.id_type='steam64' "
        "GROUP BY i.id_value HAVING cnt > 1"
        if db.engine != "postgres" else
        "SELECT i.id_value, STRING_AGG(DISTINCT i.whitelist_type, ',') AS types, COUNT(DISTINCT i.whitelist_type) AS cnt "
        "FROM whitelist_identifiers i "
        "WHERE i.guild_id=%s AND i.id_type='steam64' "
        "GROUP BY i.id_value HAVING COUNT(DISTINCT i.whitelist_type) > 1",
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
    """Trigger whitelist file regeneration."""
    bot = request.app["bot"]
    if hasattr(bot, "schedule_sync"):
        try:
            bot.schedule_sync()
        except Exception:
            log.warning("schedule_sync call failed")
    else:
        log.info("Resync requested but schedule_sync not available")
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


def _parse_csv_data(data: str, guild_id: int, wl_type: str, existing_steam_ids: set) -> tuple[list[dict], dict]:
    """Parse CSV data and return (rows, summary).

    Flexible column name matching:
    discord_name / name / player / playername
    discord_id / discordid
    steam64 / steamid / steam_id / steam64id
    eos_id / eosid / eos
    """
    reader = csv.DictReader(io.StringIO(data))
    if not reader.fieldnames:
        return [], {"total": 0, "new": 0, "duplicate": 0, "invalid": 0}

    # Normalise column names
    col_map: dict[str, str] = {}
    for fn in reader.fieldnames:
        lower = fn.strip().lower().replace(" ", "_")
        if lower in ("discord_name", "name", "player", "playername", "player_name"):
            col_map["discord_name"] = fn
        elif lower in ("discord_id", "discordid"):
            col_map["discord_id"] = fn
        elif lower in ("steam64", "steamid", "steam_id", "steam64id", "steam64_id"):
            col_map["steam64"] = fn
        elif lower in ("eos_id", "eosid", "eos"):
            col_map["eos_id"] = fn

    rows: list[dict] = []
    summary = {"total": 0, "new": 0, "duplicate": 0, "invalid": 0}

    for line in reader:
        summary["total"] += 1
        discord_name = line.get(col_map.get("discord_name", ""), "").strip()
        discord_id = line.get(col_map.get("discord_id", ""), "").strip()
        raw_steam = line.get(col_map.get("steam64", ""), "").strip()
        raw_eos = line.get(col_map.get("eos_id", ""), "").strip()

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
            "status": status,
        })

    return rows, summary


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


async def _get_existing_steam_ids(db, guild_id: int, wl_type: str) -> set:
    """Return set of all steam64 IDs already in the guild+type."""
    rows = await db.fetchall(
        "SELECT id_value FROM whitelist_identifiers "
        "WHERE guild_id=%s AND whitelist_type=%s AND id_type='steam64'",
        (guild_id, wl_type),
    )
    return {row[0] for row in (rows or [])}


@require_admin
async def admin_import_preview(request: web.Request) -> web.Response:
    """Preview import data without committing changes."""
    session = await aiohttp_session.get_session(request)
    guild_id = int(session["active_guild_id"])
    bot = request.app["bot"]
    db = bot.db

    # Accept multipart or JSON
    content_type = request.content_type or ""
    if "multipart" in content_type:
        reader = await request.multipart()
        data = ""
        fmt = "csv"
        wl_type = ""
        while True:
            part = await reader.next()
            if part is None:
                break
            if part.name == "data":
                data = (await part.read(decode=True)).decode("utf-8", errors="replace")
            elif part.name == "format":
                fmt = (await part.read(decode=True)).decode().strip()
            elif part.name == "whitelist_type":
                wl_type = (await part.read(decode=True)).decode().strip()
    else:
        try:
            body = await request.json()
        except Exception:
            return web.json_response({"error": "Invalid request body."}, status=400)
        data = body.get("data", "")
        fmt = body.get("format", "csv")
        wl_type = body.get("whitelist_type", "")

    if not data:
        return web.json_response({"error": "No data provided."}, status=400)
    if wl_type not in WHITELIST_TYPES:
        return web.json_response({"error": f"Invalid whitelist_type. Must be one of: {', '.join(WHITELIST_TYPES)}"}, status=400)
    if fmt not in ("csv", "squad_cfg"):
        return web.json_response({"error": "format must be 'csv' or 'squad_cfg'."}, status=400)

    existing = await _get_existing_steam_ids(db, guild_id, wl_type)

    if fmt == "csv":
        rows, summary = _parse_csv_data(data, guild_id, wl_type, existing)
    else:
        rows, summary = _parse_squad_cfg_data(data, existing)

    return web.json_response({"rows": rows, "summary": summary})


@require_admin
async def admin_import(request: web.Request) -> web.Response:
    """Execute the import, inserting/updating records."""
    session = await aiohttp_session.get_session(request)
    guild_id = int(session["active_guild_id"])
    actor_id = int(session["discord_id"])
    bot = request.app["bot"]
    db = bot.db

    # Accept multipart or JSON
    content_type = request.content_type or ""
    if "multipart" in content_type:
        reader = await request.multipart()
        data = ""
        fmt = "csv"
        wl_type = ""
        dup_handling = "skip"
        while True:
            part = await reader.next()
            if part is None:
                break
            if part.name == "data":
                data = (await part.read(decode=True)).decode("utf-8", errors="replace")
            elif part.name == "format":
                fmt = (await part.read(decode=True)).decode().strip()
            elif part.name == "whitelist_type":
                wl_type = (await part.read(decode=True)).decode().strip()
            elif part.name == "duplicate_handling":
                dup_handling = (await part.read(decode=True)).decode().strip()
    else:
        try:
            body = await request.json()
        except Exception:
            return web.json_response({"error": "Invalid request body."}, status=400)
        data = body.get("data", "")
        fmt = body.get("format", "csv")
        wl_type = body.get("whitelist_type", "")
        dup_handling = body.get("duplicate_handling", "skip")

    if not data:
        return web.json_response({"error": "No data provided."}, status=400)
    if wl_type not in WHITELIST_TYPES:
        return web.json_response({"error": f"Invalid whitelist_type. Must be one of: {', '.join(WHITELIST_TYPES)}"}, status=400)
    if fmt not in ("csv", "squad_cfg"):
        return web.json_response({"error": "format must be 'csv' or 'squad_cfg'."}, status=400)
    if dup_handling not in ("skip", "overwrite", "merge"):
        return web.json_response({"error": "duplicate_handling must be 'skip', 'overwrite', or 'merge'."}, status=400)

    existing = await _get_existing_steam_ids(db, guild_id, wl_type)

    if fmt == "csv":
        rows, _ = _parse_csv_data(data, guild_id, wl_type, existing)
    else:
        rows, _ = _parse_squad_cfg_data(data, existing)

    type_config = await db.get_type_config(guild_id, wl_type)
    default_slot = type_config["default_slot_limit"] if type_config else 1

    added = 0
    updated = 0
    skipped = 0
    errors = 0

    for row in rows:
        if row["status"] == "invalid":
            errors += 1
            continue

        steam_ids = row.get("steam_ids", [])
        eos_ids = row.get("eos_ids", [])
        discord_name = row.get("discord_name", "(unknown)")
        raw_discord_id = row.get("discord_id", "")

        try:
            discord_id = int(raw_discord_id) if raw_discord_id else 0
        except (ValueError, TypeError):
            discord_id = 0
        if discord_id == 0:
            discord_id = -abs(int(time.time() * 1000))
            # Small sleep-free offset to avoid collisions in batch
            time.sleep(0)  # yield, not actually sleeping

        is_dup = row["status"] == "duplicate"

        if is_dup:
            if dup_handling == "skip":
                skipped += 1
                continue
            elif dup_handling == "overwrite":
                # Find existing user by steam id
                for sid in steam_ids:
                    existing_user = await db.fetchone(
                        "SELECT discord_id FROM whitelist_identifiers "
                        "WHERE guild_id=%s AND whitelist_type=%s AND id_type='steam64' AND id_value=%s",
                        (guild_id, wl_type, sid),
                    )
                    if existing_user:
                        discord_id = existing_user[0]
                        break
                # Replace identifiers
                identifiers = []
                for sid in steam_ids:
                    identifiers.append(("steam64", str(sid), False, "import"))
                for eid in eos_ids:
                    identifiers.append(("eosid", str(eid), False, "import"))
                await db.replace_identifiers(guild_id, discord_id, wl_type, identifiers)
                await db.upsert_user_record(
                    guild_id, discord_id, wl_type, discord_name, "active",
                    default_slot, "", slot_limit_override=None,
                )
                updated += 1
            elif dup_handling == "merge":
                # Find existing user, add new IDs without removing old ones
                for sid in steam_ids:
                    existing_user = await db.fetchone(
                        "SELECT discord_id FROM whitelist_identifiers "
                        "WHERE guild_id=%s AND whitelist_type=%s AND id_type='steam64' AND id_value=%s",
                        (guild_id, wl_type, sid),
                    )
                    if existing_user:
                        discord_id = existing_user[0]
                        break
                # Get current identifiers
                current_ids = await db.get_identifiers(guild_id, discord_id, wl_type)
                current_set = {(r[0], r[1]) for r in current_ids}
                identifiers = [(r[0], r[1], False, "import") for r in current_ids]
                for sid in steam_ids:
                    if ("steam64", str(sid)) not in current_set:
                        identifiers.append(("steam64", str(sid), False, "import"))
                for eid in eos_ids:
                    if ("eosid", str(eid)) not in current_set:
                        identifiers.append(("eosid", str(eid), False, "import"))
                await db.replace_identifiers(guild_id, discord_id, wl_type, identifiers)
                updated += 1
        else:
            # New entry
            identifiers = []
            for sid in steam_ids:
                identifiers.append(("steam64", str(sid), False, "import"))
            for eid in eos_ids:
                identifiers.append(("eosid", str(eid), False, "import"))
            await db.upsert_user_record(
                guild_id, discord_id, wl_type, discord_name, "active",
                default_slot, "", slot_limit_override=None,
            )
            await db.replace_identifiers(guild_id, discord_id, wl_type, identifiers)
            added += 1

    # Audit
    await db.audit(
        guild_id, "admin_import", actor_id, None,
        f"Imported {fmt} into {wl_type}: added={added}, updated={updated}, skipped={skipped}, errors={errors}",
        wl_type,
    )
    log.info("Guild %s: admin %s imported %s into %s (added=%d updated=%d skipped=%d errors=%d)",
             guild_id, actor_id, fmt, wl_type, added, updated, skipped, errors)

    # Trigger sync
    try:
        if hasattr(bot, "schedule_sync"):
            bot.schedule_sync()
    except Exception:
        log.debug("Could not trigger sync after import")

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

    # Determine which types to query
    if wl_type == "combined":
        types_to_query = list(WHITELIST_TYPES)
    elif wl_type in WHITELIST_TYPES:
        types_to_query = [wl_type]
    else:
        return web.json_response({
            "error": f"Invalid type. Must be one of: {', '.join(WHITELIST_TYPES)}, combined",
        }, status=400)

    all_entries: list[dict] = []

    for qt in types_to_query:
        # Build filter conditions
        conditions = ["u.guild_id=%s", "u.whitelist_type=%s"]
        params: list = [guild_id, qt]

        if filt == "active":
            conditions.append("u.status='active'")
        elif filt == "expired":
            conditions.append("u.status='inactive'")
        # "all" = no status filter

        where = " AND ".join(conditions)

        rows = await db.fetchall(
            f"SELECT u.discord_id, u.discord_name, u.whitelist_type, u.status, "
            f"u.effective_slot_limit, u.last_plan_name, u.updated_at "
            f"FROM whitelist_users u WHERE {where} ORDER BY u.discord_name",
            tuple(params),
        )

        for row in (rows or []):
            discord_id = row[0]
            meta = _unpack_plan_meta(row[5])

            # Fetch identifiers
            id_rows = await db.fetchall(
                "SELECT id_type, id_value FROM whitelist_identifiers "
                "WHERE guild_id=%s AND discord_id=%s AND whitelist_type=%s",
                (guild_id, discord_id, qt),
            )
            steam_ids = [r[1] for r in (id_rows or []) if r[0] == "steam64"]
            eos_ids = [r[1] for r in (id_rows or []) if r[0] == "eosid"]

            # Check if actually expired by expires_at
            if filt == "expired" and row[3] == "active":
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
                "whitelist_type": row[2],
                "status": row[3],
                "effective_slot_limit": row[4],
                "plan": meta.get("plan"),
                "notes": meta.get("notes"),
                "expires_at": meta.get("expires_at"),
                "steam_ids": steam_ids,
                "eos_ids": eos_ids,
                "updated_at": str(row[6]) if row[6] else "",
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


def setup_routes(app: web.Application):
    # Guild API
    app.router.add_get("/api/guilds", get_guilds)
    app.router.add_post("/api/guilds/switch", switch_guild)
    # User API
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
    # Admin Import / Export
    app.router.add_post("/api/admin/import/preview", admin_import_preview)
    app.router.add_post("/api/admin/import", admin_import)
    app.router.add_get("/api/admin/export", admin_export)
