from __future__ import annotations

import aiohttp_jinja2
import aiohttp_session
from aiohttp import web

from bot.config import WHITELIST_TYPES, log


async def index(request: web.Request) -> web.Response:
    """If logged in redirect to /dashboard, else render login page."""
    session = await aiohttp_session.get_session(request)
    if session.get("logged_in"):
        raise web.HTTPFound("/dashboard")
    context = {"session": {}}
    return aiohttp_jinja2.render_template("login.html", request, context)


async def dashboard(request: web.Request) -> web.Response:
    """Render the user dashboard with whitelist data for all types."""
    session = await aiohttp_session.get_session(request)
    if not session.get("logged_in"):
        raise web.HTTPFound("/login")

    bot = request.app["bot"]
    discord_id = int(session["discord_id"])

    whitelist_data = {}
    for wl_type in WHITELIST_TYPES:
        type_config = await bot.db.get_type_config(wl_type)
        user_record = await bot.db.get_user_record(discord_id, wl_type)
        identifiers = await bot.db.get_identifiers(discord_id, wl_type)

        steam_ids = [row[1] for row in identifiers if row[0] == "steam64"]
        eos_ids = [row[1] for row in identifiers if row[0] == "eosid"]

        whitelist_data[wl_type] = {
            "config": type_config,
            "enabled": type_config["enabled"] if type_config else False,
            "user_record": None,
            "steam_ids": steam_ids,
            "eos_ids": eos_ids,
        }

        if user_record:
            whitelist_data[wl_type]["user_record"] = {
                "discord_name": user_record[0],
                "status": user_record[1],
                "slot_limit_override": user_record[2],
                "effective_slot_limit": user_record[3],
                "last_plan_name": user_record[4],
                "updated_at": str(user_record[5]) if user_record[5] else "",
                "created_at": str(user_record[6]) if user_record[6] else "",
            }

    context = {
        "session": dict(session),
        "whitelist_data": whitelist_data,
        "whitelist_types": WHITELIST_TYPES,
    }
    return aiohttp_jinja2.render_template("dashboard.html", request, context)


async def admin_page(request: web.Request) -> web.Response:
    """Render the admin dashboard."""
    session = await aiohttp_session.get_session(request)
    if not session.get("logged_in"):
        raise web.HTTPFound("/login")
    if not session.get("is_mod"):
        raise web.HTTPForbidden(text="Access denied.")
    context = {"session": dict(session)}
    return aiohttp_jinja2.render_template("admin.html", request, context)


async def admin_users_page(request: web.Request) -> web.Response:
    """Render the admin user management page."""
    session = await aiohttp_session.get_session(request)
    if not session.get("logged_in"):
        raise web.HTTPFound("/login")
    if not session.get("is_mod"):
        raise web.HTTPForbidden(text="Access denied.")
    context = {"session": dict(session), "whitelist_types": WHITELIST_TYPES}
    return aiohttp_jinja2.render_template("admin_users.html", request, context)


async def admin_audit_page(request: web.Request) -> web.Response:
    """Render the admin audit log page."""
    session = await aiohttp_session.get_session(request)
    if not session.get("logged_in"):
        raise web.HTTPFound("/login")
    if not session.get("is_mod"):
        raise web.HTTPForbidden(text="Access denied.")
    context = {"session": dict(session), "whitelist_types": WHITELIST_TYPES}
    return aiohttp_jinja2.render_template("admin_audit.html", request, context)


def setup_routes(app: web.Application):
    app.router.add_get("/", index)
    app.router.add_get("/dashboard", dashboard)
    app.router.add_get("/admin", admin_page)
    app.router.add_get("/admin/users", admin_users_page)
    app.router.add_get("/admin/audit", admin_audit_page)
