from __future__ import annotations

import json

import aiohttp_jinja2
import aiohttp_session
from aiohttp import web

from bot.config import log


async def index(request: web.Request) -> web.Response:
    """If logged in redirect based on role, else render login page."""
    session = await aiohttp_session.get_session(request)
    if session.get("logged_in"):
        # Admins go to dashboard, regular users go to their whitelist
        active_guild_id = session.get("active_guild_id")
        guilds = session.get("guilds", [])
        active_guild = next((g for g in guilds if g["id"] == active_guild_id), None)
        if active_guild and active_guild.get("is_mod"):
            raise web.HTTPFound("/dashboard")
        raise web.HTTPFound("/my-whitelist")
    context = {"session": {}}
    return aiohttp_jinja2.render_template("login.html", request, context)


async def _get_whitelist_data(request, session):
    """Fetch whitelist data for the logged-in user. Returns (whitelist_data, whitelist_names) or None if no guild."""
    active_guild_id = session.get("active_guild_id")
    guilds = session.get("guilds", [])

    if not active_guild_id or not guilds:
        return None, None

    guild_id = int(active_guild_id)
    bot = request.app["bot"]
    discord_id = int(session["discord_id"])

    # Fetch dynamic whitelists for this guild
    whitelists = await bot.db.get_whitelists(guild_id)
    if not whitelists:
        # Seed defaults if none exist
        await bot.db.seed_guild_defaults(guild_id)
        whitelists = await bot.db.get_whitelists(guild_id)

    whitelist_data = {}
    whitelist_names = []
    for wl in whitelists:
        wl_id = wl["id"]
        wl_slug = wl["slug"]
        whitelist_names.append(wl_slug)

        user_record = await bot.db.get_user_record(guild_id, discord_id, wl_id)
        identifiers = await bot.db.get_identifiers(guild_id, discord_id, wl_id)

        steam_ids = [row[1] for row in identifiers if row[0] == "steam64"]
        eos_ids = [row[1] for row in identifiers if row[0] == "eosid"]

        whitelist_data[wl_slug] = {
            "config": wl,
            "enabled": wl["enabled"],
            "name": wl["name"],
            "whitelist_id": wl_id,
            "user_record": None,
            "steam_ids": steam_ids,
            "eos_ids": eos_ids,
        }

        if user_record:
            whitelist_data[wl_slug]["user_record"] = {
                "discord_name": user_record[0],
                "status": user_record[1],
                "slot_limit_override": user_record[2],
                "effective_slot_limit": user_record[3],
                "last_plan_name": user_record[4],
                "updated_at": str(user_record[5]) if user_record[5] else "",
                "created_at": str(user_record[6]) if user_record[6] else "",
                "expires_at": "",
                "notes": "",
            }

            # Parse last_plan_name for expires_at metadata
            if user_record[4]:  # last_plan_name
                try:
                    meta = json.loads(user_record[4])
                    if isinstance(meta, dict):
                        whitelist_data[wl_slug]["user_record"]["expires_at"] = meta.get("expires_at", "")
                        whitelist_data[wl_slug]["user_record"]["notes"] = meta.get("notes", "")
                        # Show the display name from meta if available, otherwise keep raw
                        if meta.get("name"):
                            whitelist_data[wl_slug]["user_record"]["last_plan_name"] = meta["name"]
                except (json.JSONDecodeError, TypeError):
                    pass

    return whitelist_data, whitelist_names


async def dashboard(request: web.Request) -> web.Response:
    """Admin-only dashboard with stats, health, files, and quick actions."""
    session = await aiohttp_session.get_session(request)
    if not session.get("logged_in"):
        raise web.HTTPFound("/login")

    active_guild_id = session.get("active_guild_id")
    guilds = session.get("guilds", [])
    active_guild = next((g for g in guilds if g["id"] == active_guild_id), None)

    # Non-admins get redirected to My Whitelist
    if not active_guild or not active_guild.get("is_mod"):
        raise web.HTTPFound("/my-whitelist")

    if not active_guild_id or not guilds:
        context = {
            "session": dict(session),
            "guilds": guilds,
            "no_guilds": True,
        }
        return aiohttp_jinja2.render_template("dashboard_new.html", request, context)

    # Fetch user whitelist data for summary cards
    whitelist_data, whitelist_names = await _get_whitelist_data(request, session)

    context = {
        "session": dict(session),
        "whitelist_data": whitelist_data or {},
        "whitelist_types": whitelist_names or [],
        "guilds": guilds,
        "active_guild": active_guild,
        "active_guild_id": active_guild_id,
    }
    return aiohttp_jinja2.render_template("dashboard_new.html", request, context)


async def my_whitelist(request: web.Request) -> web.Response:
    """Render the user whitelist management page with chip editing."""
    session = await aiohttp_session.get_session(request)
    if not session.get("logged_in"):
        raise web.HTTPFound("/login")

    active_guild_id = session.get("active_guild_id")
    guilds = session.get("guilds", [])

    if not active_guild_id or not guilds:
        context = {
            "session": dict(session),
            "guilds": guilds,
            "no_guilds": True,
        }
        return aiohttp_jinja2.render_template("my_whitelist.html", request, context)

    active_guild = next((g for g in guilds if g["id"] == active_guild_id), None)

    # Fetch user whitelist data
    whitelist_data, whitelist_names = await _get_whitelist_data(request, session)

    context = {
        "session": dict(session),
        "whitelist_data": whitelist_data or {},
        "whitelist_types": whitelist_names or [],
        "guilds": guilds,
        "active_guild": active_guild,
        "active_guild_id": active_guild_id,
    }
    return aiohttp_jinja2.render_template("my_whitelist.html", request, context)


async def _get_admin_context(request: web.Request):
    """Common admin context builder. Returns (context, guild_id) or raises."""
    session = await aiohttp_session.get_session(request)
    if not session.get("logged_in"):
        raise web.HTTPFound("/login")

    active_guild_id = session.get("active_guild_id")
    guilds = session.get("guilds", [])
    active_guild = next((g for g in guilds if g["id"] == active_guild_id), None)

    if not active_guild or not active_guild.get("is_mod"):
        raise web.HTTPForbidden(text="Access denied.")

    guild_id = int(active_guild_id)
    bot = request.app["bot"]
    whitelists = await bot.db.get_whitelists(guild_id)
    whitelist_slugs = [wl["slug"] for wl in whitelists]

    context = {
        "session": dict(session),
        "whitelist_types": whitelist_slugs,
        "guilds": guilds,
        "active_guild": active_guild,
        "active_guild_id": active_guild_id,
    }
    return context


async def admin_users_page(request: web.Request) -> web.Response:
    """Render the admin user management page."""
    context = await _get_admin_context(request)
    return aiohttp_jinja2.render_template("admin_users.html", request, context)


async def admin_audit_page(request: web.Request) -> web.Response:
    """Render the admin audit log page."""
    context = await _get_admin_context(request)
    return aiohttp_jinja2.render_template("admin_audit.html", request, context)


async def admin_setup_page(request: web.Request) -> web.Response:
    """Render the admin community setup page."""
    context = await _get_admin_context(request)
    return aiohttp_jinja2.render_template("admin_setup.html", request, context)


async def admin_import_export_page(request: web.Request) -> web.Response:
    """Render the admin import/export page."""
    context = await _get_admin_context(request)
    return aiohttp_jinja2.render_template("admin_import_export.html", request, context)


async def admin_whitelists_page(request: web.Request) -> web.Response:
    """Render the admin whitelists management page."""
    context = await _get_admin_context(request)
    return aiohttp_jinja2.render_template("admin_whitelists.html", request, context)


def setup_routes(app: web.Application):
    app.router.add_get("/", index)
    app.router.add_get("/dashboard", dashboard)
    app.router.add_get("/my-whitelist", my_whitelist)
    app.router.add_get("/admin/setup", admin_setup_page)
    app.router.add_get("/admin/whitelists", admin_whitelists_page)
    app.router.add_get("/admin/users", admin_users_page)
    app.router.add_get("/admin/audit", admin_audit_page)
    app.router.add_get("/admin/import-export", admin_import_export_page)
