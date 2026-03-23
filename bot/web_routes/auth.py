from __future__ import annotations

import secrets
from urllib.parse import urlencode

import aiohttp
import aiohttp_session
from aiohttp import web

from bot.config import DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, WEB_BASE_URL, GUILD_ID, log

DISCORD_API = "https://discord.com/api/v10"
OAUTH2_SCOPES = "identify guilds guilds.members.read"


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
    """Exchange the OAuth2 code for a token, fetch user info, create session."""
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

        # Fetch guild member info for role checking
        member_roles = []
        try:
            async with http.get(
                f"{DISCORD_API}/users/@me/guilds/{GUILD_ID}/member",
                headers=headers,
            ) as resp:
                if resp.status == 200:
                    member_data = await resp.json()
                    member_roles = member_data.get("roles", [])
        except Exception:
            log.warning("Could not fetch guild member data for user %s", user_data.get("id"))

    # Check if user has mod role
    bot = request.app["bot"]
    mod_role_id_str = await bot.db.get_setting("mod_role_id", "0")
    mod_role_id = int(mod_role_id_str) if mod_role_id_str else 0
    is_mod = str(mod_role_id) in member_roles if mod_role_id else False

    # Store session data
    session["discord_id"] = user_data["id"]
    session["username"] = user_data.get("username", "")
    session["discriminator"] = user_data.get("discriminator", "0")
    session["avatar"] = user_data.get("avatar", "")
    session["roles"] = member_roles
    session["is_mod"] = is_mod
    session["logged_in"] = True

    log.info("User %s (%s) logged in via OAuth2, is_mod=%s", user_data.get("username"), user_data["id"], is_mod)
    raise web.HTTPFound("/dashboard")


async def logout(request: web.Request) -> web.Response:
    """Clear the session and redirect to home."""
    session = await aiohttp_session.get_session(request)
    session.invalidate()
    raise web.HTTPFound("/")


def setup_routes(app: web.Application):
    app.router.add_get("/login", login)
    app.router.add_get("/callback", callback)
    app.router.add_get("/logout", logout)
