from __future__ import annotations

import secrets
from urllib.parse import urlencode

import aiohttp
import aiohttp_session
from aiohttp import web

import os

from bot.config import DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, WEB_BASE_URL, log

# Frontend URL for post-login redirect (separate from API's WEB_BASE_URL)
FRONTEND_URL = os.environ.get("FRONTEND_URL", "").rstrip("/") or WEB_BASE_URL

DISCORD_API = "https://discord.com/api/v10"
OAUTH2_SCOPES = "identify guilds guilds.members.read"

# Discord permission bit flags
PERM_ADMINISTRATOR = 0x8
PERM_MANAGE_GUILD = 0x20


async def login(request: web.Request) -> web.Response:
    """Redirect the user to Discord OAuth2 authorize URL."""
    session = await aiohttp_session.get_session(request)
    state = secrets.token_urlsafe(32)
    session["oauth_state"] = state

    params = {
        "client_id": DISCORD_CLIENT_ID,
        "redirect_uri": WEB_BASE_URL + "/callback",
        "response_type": "code",
        "scope": OAUTH2_SCOPES,
        "state": state,
    }
    url = f"https://discord.com/api/oauth2/authorize?{urlencode(params)}"
    raise web.HTTPFound(url)


async def callback(request: web.Request) -> web.Response:
    """Exchange the OAuth2 code for a token, fetch user info, determine mutual guilds."""
    session = await aiohttp_session.get_session(request)

    # CSRF check
    state = request.query.get("state", "")
    expected = session.pop("oauth_state", None)
    if not state or state != expected:
        raise web.HTTPBadRequest(text="Invalid state parameter.")

    code = request.query.get("code")
    if not code:
        raise web.HTTPBadRequest(text="Missing code parameter.")

    # Exchange code for token
    data = {
        "client_id": DISCORD_CLIENT_ID,
        "client_secret": DISCORD_CLIENT_SECRET,
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": WEB_BASE_URL + "/callback",
    }
    async with aiohttp.ClientSession() as http:
        async with http.post(f"{DISCORD_API}/oauth2/token", data=data) as resp:
            if resp.status != 200:
                log.warning("OAuth2 token exchange failed: %s", await resp.text())
                raise web.HTTPBadRequest(text="Failed to exchange OAuth2 code.")
            token_data = await resp.json()

        access_token = token_data["access_token"]
        headers = {"Authorization": f"Bearer {access_token}"}

        # Fetch user identity
        async with http.get(f"{DISCORD_API}/users/@me", headers=headers) as resp:
            if resp.status != 200:
                raise web.HTTPBadRequest(text="Failed to fetch user info.")
            user_data = await resp.json()

        # Fetch user's guilds from Discord
        async with http.get(f"{DISCORD_API}/users/@me/guilds", headers=headers) as resp:
            if resp.status != 200:
                log.warning("Could not fetch user guilds: %s", await resp.text())
                user_guilds_list = []
            else:
                user_guilds_list = await resp.json()

        # Build set of user's guild IDs
        user_guild_ids = {int(g["id"]) for g in user_guilds_list}
        user_guilds_by_id = {int(g["id"]): g for g in user_guilds_list}

        # Intersect with bot's guilds (refresh cache first so new guilds appear instantly)
        bot = request.app["bot"]
        if hasattr(bot, "fetch_guilds"):
            try:
                await bot.fetch_guilds()
            except Exception:
                pass  # Use stale cache if refresh fails
        bot_guild_ids = {g.id for g in bot.guilds}
        mutual_guild_ids = user_guild_ids & bot_guild_ids

        # For each mutual guild, check if user has admin access and gather info
        guilds_info = []
        user_discord_id = int(user_data["id"])

        for gid in mutual_guild_ids:
            user_guild_data = user_guilds_by_id.get(gid, {})
            discord_guild = bot.get_guild(gid)
            guild_name = discord_guild.name if discord_guild else user_guild_data.get("name", "Unknown")
            guild_icon = None
            if discord_guild and discord_guild.icon:
                guild_icon = str(discord_guild.icon.url)
            elif user_guild_data.get("icon"):
                guild_icon = f"https://cdn.discordapp.com/icons/{gid}/{user_guild_data['icon']}.png"

            # Fetch member roles for this guild
            member_roles = []
            try:
                async with http.get(
                    f"{DISCORD_API}/users/@me/guilds/{gid}/member",
                    headers=headers,
                ) as resp:
                    if resp.status == 200:
                        member_data = await resp.json()
                        member_roles = member_data.get("roles", [])
            except Exception:
                log.warning("Could not fetch guild member data for user %s in guild %s", user_data.get("id"), gid)

            # ── Tiered admin detection ──────────────────────────────────
            is_mod = False
            mod_reason = None

            # 1. Guild owner — always admin
            if discord_guild and discord_guild.owner_id == user_discord_id:
                is_mod = True
                mod_reason = "owner"

            # 2. Discord Administrator permission (from guild permissions bitfield)
            if not is_mod:
                guild_perms = int(user_guild_data.get("permissions", 0))
                if guild_perms & PERM_ADMINISTRATOR:
                    is_mod = True
                    mod_reason = "administrator"

            # 3. Discord Manage Guild permission
            if not is_mod:
                guild_perms = int(user_guild_data.get("permissions", 0))
                if guild_perms & PERM_MANAGE_GUILD:
                    is_mod = True
                    mod_reason = "manage_guild"

            # 4. Check member's roles against role permissions in Discord
            if not is_mod and discord_guild:
                member = discord_guild.get_member(user_discord_id)
                if member:
                    if member.guild_permissions.administrator:
                        is_mod = True
                        mod_reason = "role_administrator"
                    elif member.guild_permissions.manage_guild:
                        is_mod = True
                        mod_reason = "role_manage_guild"

            # 5. Custom mod roles from bot settings (supports multiple)
            if not is_mod:
                mod_role_id_str = await bot.db.get_setting(gid, "mod_role_id", "0")
                if mod_role_id_str:
                    # Support comma-separated multiple mod role IDs
                    mod_role_ids = [r.strip() for r in mod_role_id_str.split(",") if r.strip()]
                    for mr_id in mod_role_ids:
                        if mr_id in member_roles:
                            is_mod = True
                            mod_reason = "custom_mod_role"
                            break

            if is_mod:
                log.info("User %s granted admin for guild %s (%s) via: %s",
                         user_data.get("username"), guild_name, gid, mod_reason)

            guilds_info.append({
                "id": str(gid),
                "name": guild_name,
                "icon": guild_icon,
                "is_mod": is_mod,
                "mod_reason": mod_reason,
                "roles": member_roles,
            })

    # Sort guilds by name for consistent display
    guilds_info.sort(key=lambda g: g["name"].lower())

    # Pick first mutual guild as active (or None if no mutual guilds)
    active_guild_id = guilds_info[0]["id"] if guilds_info else None

    # Store session data
    session["discord_id"] = user_data["id"]
    session["username"] = user_data.get("username", "")
    session["discriminator"] = user_data.get("discriminator", "0")
    session["avatar"] = user_data.get("avatar", "")
    session["guilds"] = guilds_info
    session["active_guild_id"] = active_guild_id
    session["logged_in"] = True

    # Compute is_mod for the active guild (convenience for templates)
    active_guild = next((g for g in guilds_info if g["id"] == active_guild_id), None)
    session["is_mod"] = active_guild["is_mod"] if active_guild else False
    session["roles"] = active_guild["roles"] if active_guild else []

    log.info(
        "User %s (%s) logged in via OAuth2, mutual guilds=%d, active_guild=%s, is_mod=%s",
        user_data.get("username"), user_data["id"],
        len(guilds_info), active_guild_id, session["is_mod"],
    )
    raise web.HTTPFound("/dashboard")


async def session_info(request: web.Request) -> web.Response:
    """Return current session data as JSON (for React frontend)."""
    session = await aiohttp_session.get_session(request)
    if not session.get("logged_in"):
        return web.json_response({"logged_in": False})

    active_guild_id = session.get("active_guild_id")
    guilds = session.get("guilds", [])
    active_guild = next((g for g in guilds if g["id"] == active_guild_id), None)

    # Derive is_mod from mod_reason (set at OAuth login, never overwritten by
    # re-verification) so that corrupted sessions recover automatically.
    # mod_reason is non-empty only when the user was a mod at login time.
    is_mod = bool(active_guild and (active_guild.get("mod_reason") or active_guild.get("is_mod")))

    return web.json_response({
        "logged_in": True,
        "discord_id": session.get("discord_id", ""),
        "username": session.get("username", ""),
        "discriminator": session.get("discriminator", "0"),
        "avatar": session.get("avatar", ""),
        "guilds": guilds,
        "active_guild_id": active_guild_id,
        "is_mod": is_mod,
        "roles": active_guild.get("roles", []) if active_guild else [],
    })


async def logout(request: web.Request) -> web.Response:
    """Clear the session and redirect to frontend home."""
    session = await aiohttp_session.get_session(request)
    session.invalidate()
    raise web.HTTPFound("/")


def setup_routes(app: web.Application):
    app.router.add_get("/login", login)
    app.router.add_get("/callback", callback)
    app.router.add_get("/api/auth/session", session_info)
    app.router.add_get("/logout", logout)
