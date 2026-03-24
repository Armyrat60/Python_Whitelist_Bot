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
    """Fetch whitelist data for the logged-in user.

    Auto-populates user records from Discord roles:
    1. Fetches user's Discord roles via API
    2. Matches roles against role_mappings for each whitelist
    3. Auto-creates/updates whitelist_users with correct tier + slot limit
    4. Only returns whitelists the user has access to (matching role)

    Returns (whitelist_data, whitelist_names) or (None, None) if no guild.
    """
    active_guild_id = session.get("active_guild_id")
    guilds = session.get("guilds", [])

    if not active_guild_id or not guilds:
        return None, None

    guild_id = int(active_guild_id)
    bot = request.app["bot"]
    discord_id = int(session["discord_id"])
    discord_name = session.get("username", "")

    # Fetch dynamic whitelists for this guild
    whitelists = await bot.db.get_whitelists(guild_id)
    if not whitelists:
        await bot.db.seed_guild_defaults(guild_id)
        whitelists = await bot.db.get_whitelists(guild_id)

    # Fetch user's Discord roles via REST API
    user_role_ids = set()
    try:
        if hasattr(bot, "get_member_roles"):
            user_role_ids = set(await bot.get_member_roles(guild_id, discord_id))
        elif hasattr(bot, "get_guild"):
            guild = bot.get_guild(guild_id)
            if guild:
                member = guild.get_member(discord_id)
                if member:
                    user_role_ids = {r.id for r in member.roles}
    except Exception:
        log.debug("Could not fetch roles for %s in guild %s", discord_id, guild_id)

    whitelist_data = {}
    whitelist_names = []

    for wl in whitelists:
        if not wl["enabled"]:
            continue  # Skip disabled whitelists entirely

        wl_id = wl["id"]
        wl_slug = wl["slug"]

        # Fetch role mappings for this whitelist
        role_rows = await bot.db.fetchall(
            "SELECT role_id, role_name, slot_limit FROM role_mappings "
            "WHERE guild_id=%s AND whitelist_id=%s AND is_active=%s",
            (guild_id, wl_id, True if bot.db.engine == "postgres" else 1),
        )

        # Determine user's best matching role (highest slot limit wins)
        matched_role_name = None
        matched_slot_limit = 0
        has_access = False

        if role_rows:
            for role_id, role_name, slot_limit in role_rows:
                if role_id in user_role_ids:
                    has_access = True
                    if wl.get("stack_roles"):
                        # Stack mode: add all matching role slots together
                        matched_slot_limit += slot_limit
                        # Use highest-tier role name for display
                        if slot_limit > 0 and (not matched_role_name or slot_limit > len(matched_role_name)):
                            matched_role_name = role_name
                    else:
                        # Non-stack mode: use the role with most slots
                        if slot_limit > matched_slot_limit:
                            matched_slot_limit = slot_limit
                            matched_role_name = role_name
        else:
            # No role mappings configured — anyone can access with default slots
            has_access = True
            matched_slot_limit = wl["default_slot_limit"] or 1

        if not has_access:
            continue  # User doesn't have a matching role, skip this whitelist

        # Ensure minimum slot limit
        if matched_slot_limit == 0:
            matched_slot_limit = wl["default_slot_limit"] or 1

        # Auto-create or update the user record
        user_record = await bot.db.get_user_record(guild_id, discord_id, wl_id)
        if not user_record:
            # Create new user record with matched tier
            now = _utcnow()
            await bot.db.execute(
                "INSERT INTO whitelist_users "
                "(guild_id, discord_id, whitelist_type, whitelist_id, discord_name, "
                "status, effective_slot_limit, last_plan_name, created_at, updated_at) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
                (guild_id, discord_id, wl_slug, wl_id, discord_name,
                 "active", matched_slot_limit, matched_role_name or "", now, now),
            )
            user_record = await bot.db.get_user_record(guild_id, discord_id, wl_id)
        else:
            # Update slot limit and plan name if role changed
            current_slots = user_record[3]  # effective_slot_limit
            current_plan = user_record[4]   # last_plan_name
            if current_slots != matched_slot_limit or current_plan != (matched_role_name or ""):
                await bot.db.execute(
                    "UPDATE whitelist_users SET effective_slot_limit=%s, last_plan_name=%s, "
                    "status=%s, updated_at=%s "
                    "WHERE guild_id=%s AND discord_id=%s AND whitelist_id=%s",
                    (matched_slot_limit, matched_role_name or "", "active", _utcnow(),
                     guild_id, discord_id, wl_id),
                )
                user_record = await bot.db.get_user_record(guild_id, discord_id, wl_id)

        identifiers = await bot.db.get_identifiers(guild_id, discord_id, wl_id)
        steam_ids = [row[1] for row in identifiers if row[0] == "steam64"]
        eos_ids = [row[1] for row in identifiers if row[0] == "eosid"]

        whitelist_names.append(wl_slug)
        whitelist_data[wl_slug] = {
            "config": wl,
            "enabled": True,
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
                "effective_slot_limit": user_record[3] or matched_slot_limit,
                "last_plan_name": matched_role_name or user_record[4] or "",
                "updated_at": str(user_record[5]) if user_record[5] else "",
                "created_at": str(user_record[6]) if user_record[6] else "",
            }

    return whitelist_data, whitelist_names


def _utcnow():
    """Helper to get current UTC time string."""
    from bot.utils import utcnow
    return utcnow()


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


async def admin_dashboard(request: web.Request) -> web.Response:
    """Render the admin dashboard overview page."""
    context = await _get_admin_context(request)
    return aiohttp_jinja2.render_template("admin.html", request, context)


async def admin_whitelists_page(request: web.Request) -> web.Response:
    """Redirect to setup page whitelists tab."""
    raise web.HTTPFound("/admin/setup?tab=whitelists")


async def admin_settings_page(request: web.Request) -> web.Response:
    """Render the admin general settings page."""
    context = await _get_admin_context(request)
    return aiohttp_jinja2.render_template("admin_settings.html", request, context)


def setup_routes(app: web.Application):
    app.router.add_get("/", index)
    app.router.add_get("/dashboard", dashboard)
    app.router.add_get("/my-whitelist", my_whitelist)
    app.router.add_get("/admin", admin_dashboard)
    app.router.add_get("/admin/setup", admin_setup_page)
    app.router.add_get("/admin/settings", admin_settings_page)
    app.router.add_get("/admin/whitelists", admin_whitelists_page)
    app.router.add_get("/admin/users", admin_users_page)
    app.router.add_get("/admin/audit", admin_audit_page)
    app.router.add_get("/admin/import-export", admin_import_export_page)
