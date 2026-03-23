from __future__ import annotations

import json
import functools
from typing import Callable

import aiohttp_session
from aiohttp import web

from bot.config import WHITELIST_TYPES, STEAM64_RE, EOSID_RE, log


# ── Auth decorators ──────────────────────────────────────────────────────────

def require_login(handler: Callable) -> Callable:
    """Decorator that checks the user is logged in, returns 401 otherwise."""
    @functools.wraps(handler)
    async def wrapper(request: web.Request) -> web.Response:
        session = await aiohttp_session.get_session(request)
        if not session.get("logged_in"):
            return web.json_response({"error": "Authentication required."}, status=401)
        return await handler(request)
    return wrapper


def require_admin(handler: Callable) -> Callable:
    """Decorator that checks the user is a mod/admin, returns 403 otherwise."""
    @functools.wraps(handler)
    async def wrapper(request: web.Request) -> web.Response:
        session = await aiohttp_session.get_session(request)
        if not session.get("logged_in"):
            return web.json_response({"error": "Authentication required."}, status=401)
        if not session.get("is_mod"):
            return web.json_response({"error": "Admin access required."}, status=403)
        return await handler(request)
    return wrapper


# ── User API routes ──────────────────────────────────────────────────────────

@require_login
async def get_my_whitelist(request: web.Request) -> web.Response:
    """Return the user's identifiers for a given whitelist type."""
    session = await aiohttp_session.get_session(request)
    wl_type = request.match_info["type"]
    if wl_type not in WHITELIST_TYPES:
        return web.json_response({"error": "Invalid whitelist type."}, status=400)

    bot = request.app["bot"]
    discord_id = int(session["discord_id"])

    user_record = await bot.db.get_user_record(discord_id, wl_type)
    identifiers = await bot.db.get_identifiers(discord_id, wl_type)

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
    discord_id = int(session["discord_id"])
    username = session.get("username", "Unknown")

    # Check type is enabled
    type_config = await bot.db.get_type_config(wl_type)
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
    user_record = await bot.db.get_user_record(discord_id, wl_type)
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
    await bot.db.replace_identifiers(discord_id, wl_type, identifiers)

    # Ensure user record exists
    if not user_record:
        await bot.db.upsert_user_record(
            discord_id, wl_type, username, "active",
            slot_limit, "web", None,
        )

    # Audit
    await bot.db.audit(
        "web_update_ids", discord_id, discord_id,
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
    """Dashboard statistics for admins."""
    bot = request.app["bot"]
    db = bot.db

    stats = {}
    for wl_type in WHITELIST_TYPES:
        active_row = await db.fetchone(
            "SELECT COUNT(*) FROM whitelist_users WHERE whitelist_type=%s AND status='active'",
            (wl_type,),
        )
        id_row = await db.fetchone(
            "SELECT COUNT(*) FROM whitelist_identifiers WHERE whitelist_type=%s",
            (wl_type,),
        )
        stats[wl_type] = {
            "active_users": active_row[0] if active_row else 0,
            "total_ids": id_row[0] if id_row else 0,
        }

    total_active = sum(s["active_users"] for s in stats.values())
    total_ids = sum(s["total_ids"] for s in stats.values())

    audit_row = await db.fetchone(
        "SELECT COUNT(*) FROM audit_log WHERE created_at >= NOW() - INTERVAL 7 DAY"
        if db.engine != "postgres" else
        "SELECT COUNT(*) FROM audit_log WHERE created_at >= NOW() - INTERVAL '7 days'"
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
    """List users with search/filter/pagination."""
    bot = request.app["bot"]
    db = bot.db

    search = request.query.get("search", "").strip()
    wl_type = request.query.get("type", "").strip()
    status = request.query.get("status", "").strip()
    page = max(1, int(request.query.get("page", "1")))
    per_page = min(100, max(1, int(request.query.get("per_page", "25"))))

    conditions = []
    params = []

    if search:
        conditions.append("(u.discord_name LIKE %s OR CAST(u.discord_id AS CHAR) LIKE %s)")
        params.extend([f"%{search}%", f"%{search}%"])
    if wl_type and wl_type in WHITELIST_TYPES:
        conditions.append("u.whitelist_type=%s")
        params.append(wl_type)
    if status:
        conditions.append("u.status=%s")
        params.append(status)

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""

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
        users.append({
            "discord_id": str(row[0]),
            "discord_name": row[1],
            "whitelist_type": row[2],
            "status": row[3],
            "effective_slot_limit": row[4],
            "last_plan_name": row[5],
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
    """Audit log with filters and pagination."""
    bot = request.app["bot"]
    db = bot.db

    wl_type = request.query.get("type", "").strip()
    action = request.query.get("action", "").strip()
    page = max(1, int(request.query.get("page", "1")))
    per_page = min(100, max(1, int(request.query.get("per_page", "25"))))

    conditions = []
    params = []

    if wl_type and wl_type in WHITELIST_TYPES:
        conditions.append("a.whitelist_type=%s")
        params.append(wl_type)
    if action:
        conditions.append("a.action_type=%s")
        params.append(action)

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""

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


def setup_routes(app: web.Application):
    # User API
    app.router.add_get("/api/my-whitelist/{type}", get_my_whitelist)
    app.router.add_post("/api/my-whitelist/{type}", update_my_whitelist)
    # Admin API
    app.router.add_get("/api/admin/stats", admin_stats)
    app.router.add_get("/api/admin/users", admin_users)
    app.router.add_get("/api/admin/audit", admin_audit)
