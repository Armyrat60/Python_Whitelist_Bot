"""Entry point for the standalone web service (no Discord bot).

Uses a lightweight Discord REST client for guild/channel/role data
instead of the full discord.py bot.
"""
import asyncio
import signal

from aiohttp import web

from bot.config import (
    DISCORD_TOKEN, DATABASE_URL, DB_HOST, DB_NAME, DB_USER,
    WEB_PORT, WEB_HOST, log,
)
from bot.database import Database
from bot.web import WebServer


class DiscordRESTClient:
    """Lightweight Discord REST API client for the web service.

    Provides guild, channel, and role data without a full bot connection.
    This replaces bot.get_guild() / guild.channels / guild.roles in the
    web routes when running standalone.
    """

    API_BASE = "https://discord.com/api/v10"

    def __init__(self, token: str):
        self.token = token
        self._session = None
        self._headers = {"Authorization": f"Bot {token}"}
        self._guild_cache: dict = {}

    async def _ensure_session(self):
        if self._session is None or self._session.closed:
            import aiohttp
            self._session = aiohttp.ClientSession()

    async def close(self):
        if self._session and not self._session.closed:
            await self._session.close()

    @property
    def guilds(self):
        """Return cached guilds as a list of lightweight guild objects."""
        return list(self._guild_cache.values())

    def get_guild(self, guild_id: int):
        """Return a lightweight guild object from cache."""
        return self._guild_cache.get(guild_id)

    async def fetch_guilds(self):
        """Fetch all guilds the bot is in."""
        await self._ensure_session()
        async with self._session.get(
            f"{self.API_BASE}/users/@me/guilds",
            headers=self._headers,
        ) as resp:
            if resp.status != 200:
                log.warning("Failed to fetch guilds: %s", resp.status)
                return []
            data = await resp.json()
            for g in data:
                gid = int(g["id"])
                self._guild_cache[gid] = _LightGuild(g)
            return data

    async def fetch_channels(self, guild_id: int) -> list:
        """Fetch text channels for a guild."""
        await self._ensure_session()
        async with self._session.get(
            f"{self.API_BASE}/guilds/{guild_id}/channels",
            headers=self._headers,
        ) as resp:
            if resp.status != 200:
                return []
            data = await resp.json()
            # Filter to text channels (type 0)
            return [ch for ch in data if ch.get("type") == 0]

    async def fetch_roles(self, guild_id: int) -> list:
        """Fetch roles for a guild."""
        await self._ensure_session()
        async with self._session.get(
            f"{self.API_BASE}/guilds/{guild_id}/roles",
            headers=self._headers,
        ) as resp:
            if resp.status != 200:
                return []
            data = await resp.json()
            # Exclude @everyone
            return [r for r in data if r.get("name") != "@everyone"]

    async def send_message(self, channel_id: int, content: str = None, embed: dict = None, components: list = None) -> dict | None:
        """Send a message to a channel via REST API."""
        await self._ensure_session()
        payload = {"allowed_mentions": {"parse": []}}  # Suppress all pings
        if content:
            payload["content"] = content
        if embed:
            payload["embeds"] = [embed]
        if components:
            payload["components"] = components
        async with self._session.post(
            f"{self.API_BASE}/channels/{channel_id}/messages",
            headers={**self._headers, "Content-Type": "application/json"},
            json=payload,
        ) as resp:
            if resp.status in (200, 201):
                return await resp.json()
            log.warning("Failed to send message to channel %s: %s %s", channel_id, resp.status, await resp.text())
            return None

    async def edit_message(self, channel_id: int, message_id: int, content: str = None, embed: dict = None, components: list = None) -> dict | None:
        """Edit an existing message via REST API."""
        await self._ensure_session()
        payload = {}
        if content is not None:
            payload["content"] = content
        if embed:
            payload["embeds"] = [embed]
        if components:
            payload["components"] = components
        async with self._session.patch(
            f"{self.API_BASE}/channels/{channel_id}/messages/{message_id}",
            headers={**self._headers, "Content-Type": "application/json"},
            json=payload,
        ) as resp:
            if resp.status == 200:
                return await resp.json()
            log.warning("Failed to edit message %s in channel %s: %s", message_id, channel_id, resp.status)
            return None

    async def delete_message(self, channel_id: int, message_id: int) -> bool:
        """Delete a message via REST API."""
        await self._ensure_session()
        async with self._session.delete(
            f"{self.API_BASE}/channels/{channel_id}/messages/{message_id}",
            headers=self._headers,
        ) as resp:
            return resp.status == 204

    async def fetch_guild_member(self, guild_id: int, user_id: int) -> dict | None:
        """Fetch a specific guild member."""
        await self._ensure_session()
        async with self._session.get(
            f"{self.API_BASE}/guilds/{guild_id}/members/{user_id}",
            headers=self._headers,
        ) as resp:
            if resp.status != 200:
                return None
            return await resp.json()

    async def fetch_all_members(self, guild_id: int) -> list[dict]:
        """Fetch all guild members via REST pagination. Returns raw member dicts."""
        await self._ensure_session()
        results = []
        after = 0
        while True:
            params = {"limit": 1000}
            if after:
                params["after"] = str(after)
            async with self._session.get(
                f"{self.API_BASE}/guilds/{guild_id}/members",
                headers=self._headers,
                params=params,
            ) as resp:
                if resp.status != 200:
                    break
                batch = await resp.json()
                if not batch:
                    break
                results.extend(batch)
                if len(batch) < 1000:
                    break
                after = int(batch[-1]["user"]["id"])
        return results

    async def fetch_members_with_role(self, guild_id: int, role_id: int) -> list[dict]:
        """Fetch all guild members that have a specific role (REST pagination)."""
        role_id_str = str(role_id)
        all_members = await self.fetch_all_members(guild_id)
        return [m for m in all_members if role_id_str in (m.get("roles") or [])]


class _LightGuild:
    """Lightweight guild object mimicking discord.Guild for web routes."""

    def __init__(self, data: dict):
        self.id = int(data["id"])
        self.name = data.get("name", "Unknown")
        self.owner_id = int(data.get("owner_id", 0)) if data.get("owner_id") else 0
        self._icon = data.get("icon")

    @property
    def icon(self):
        if self._icon:
            return _LightAsset(self.id, self._icon)
        return None

    @property
    def channels(self):
        return []  # Channels fetched via REST on demand

    @property
    def roles(self):
        return []  # Roles fetched via REST on demand

    def get_member(self, user_id):
        return None  # Members fetched via REST on demand


class _LightAsset:
    def __init__(self, guild_id, icon_hash):
        self.guild_id = guild_id
        self.icon_hash = icon_hash

    @property
    def url(self):
        return f"https://cdn.discordapp.com/icons/{self.guild_id}/{self.icon_hash}.png"

    def __str__(self):
        return self.url


class WebOnlyApp:
    """Mimics the bot interface that web routes expect, using REST API instead."""

    is_rest_only = True  # Signal to web routes that we have no gateway member cache

    def __init__(self, db: Database, discord_client: DiscordRESTClient):
        self.db = db
        self._discord = discord_client

    @property
    def guilds(self):
        return self._discord.guilds

    def get_guild(self, guild_id: int):
        return self._discord.get_guild(guild_id)

    async def get_channels(self, guild_id: int) -> list:
        """Fetch channels via REST (used by admin API)."""
        return await self._discord.fetch_channels(guild_id)

    async def get_roles(self, guild_id: int) -> list:
        """Fetch roles via REST (used by admin API)."""
        return await self._discord.fetch_roles(guild_id)

    async def get_member_roles(self, guild_id: int, user_id: int) -> list[int]:
        """Fetch a member's role IDs via REST."""
        member = await self._discord.fetch_guild_member(guild_id, user_id)
        if not member:
            return []
        return [int(r) for r in member.get("roles", [])]

    async def get_all_members_by_role(self, guild_id: int, role_ids: set[int]) -> dict[int, set[int]]:
        """Fetch all guild members once and return a mapping of role_id -> set of member IDs.
        Much faster than calling get_role_members() per role when checking multiple roles."""
        all_members = await self._discord.fetch_all_members(guild_id)
        result: dict[int, set[int]] = {rid: set() for rid in role_ids}
        role_id_strs = {str(rid): rid for rid in role_ids}
        for m in all_members:
            user = m.get("user") or {}
            try:
                uid = int(user.get("id", 0))
            except (ValueError, TypeError):
                continue
            for r_str in (m.get("roles") or []):
                if r_str in role_id_strs:
                    result[role_id_strs[r_str]].add(uid)
        return result

    async def get_role_members(self, guild_id: int, role_id: int) -> list[dict]:
        """Fetch all members with a specific role via REST. Returns list of {id, name, username} dicts."""
        raw = await self._discord.fetch_members_with_role(guild_id, role_id)
        members = []
        for m in raw:
            user = m.get("user") or {}
            raw_username = user.get("username", "")
            members.append({
                "id": int(user.get("id", 0)),
                "name": m.get("nick") or user.get("global_name") or raw_username,
                "username": raw_username,
            })
        return members

    def schedule_sync(self):
        """No-op in web-only mode — bot handles sync."""
        pass

    def schedule_report(self):
        """No-op in web-only mode — bot handles reports."""
        pass


async def start_web():
    if not DISCORD_TOKEN:
        raise RuntimeError("DISCORD_TOKEN is required (for Discord REST API access).")
    if not DATABASE_URL and not all([DB_HOST, DB_NAME, DB_USER]):
        raise RuntimeError("Database config required: set DATABASE_URL or DB_HOST/DB_NAME/DB_USER.")

    db = Database()
    await db.connect()
    await db.init_schema()
    log.info("DB connected")

    discord_client = DiscordRESTClient(DISCORD_TOKEN)
    await discord_client.fetch_guilds()
    log.info("Discord REST client initialized, %d guilds cached", len(discord_client.guilds))

    # Seed defaults for all guilds the bot is in
    for guild in discord_client.guilds:
        await db.seed_guild_defaults(guild.id)
    log.info("Guild defaults seeded")

    app_obj = WebOnlyApp(db, discord_client)
    web_server = WebServer(app_obj)

    # Start the aiohttp web server directly (not via bot)
    runner = web.AppRunner(web_server.app)
    await runner.setup()
    site = web.TCPSite(runner, WEB_HOST, WEB_PORT)
    await site.start()
    log.info("Web server started on http://%s:%s/", WEB_HOST, WEB_PORT)

    # Prime the output file cache for all guilds on startup
    from bot.output import sync_outputs
    for guild in discord_client.guilds:
        try:
            await sync_outputs(db, guild.id, web_server=web_server)
            log.info("Primed output cache for guild %s (%s)", guild.name, guild.id)
        except Exception:
            log.exception("Failed to prime cache for guild %s", guild.id)

    # Graceful shutdown: handle SIGTERM (Docker stop) by cancelling the main task
    loop = asyncio.get_running_loop()
    shutdown_event = asyncio.Event()

    def _handle_signal():
        log.info("Shutdown signal received — stopping web service cleanly")
        shutdown_event.set()

    for sig in (signal.SIGTERM, signal.SIGINT):
        try:
            loop.add_signal_handler(sig, _handle_signal)
        except (NotImplementedError, OSError):
            # Windows doesn't support add_signal_handler for SIGTERM
            pass

    # Keep running
    # In two-process deployments the bot-worker pushes cache updates immediately
    # via POST /internal/sync/{guild_id}, so we only need a slow heartbeat here
    # as a fallback (catches anything the push might have missed).
    _CACHE_HEARTBEAT = 300   # 5 minutes — fallback full refresh
    _GUILD_REFRESH   = 1800  # 30 minutes — guild list refresh
    tick = 0
    try:
        while not shutdown_event.is_set():
            try:
                await asyncio.wait_for(shutdown_event.wait(), timeout=_CACHE_HEARTBEAT)
                break  # Shutdown was signalled during sleep
            except asyncio.TimeoutError:
                pass

            tick += 1

            # Fallback: refresh whitelist file cache for all guilds
            for guild in discord_client.guilds:
                try:
                    await sync_outputs(db, guild.id, web_server=web_server)
                except Exception:
                    log.debug("Whitelist cache heartbeat failed for guild %s", guild.id)

            # Refresh Discord guild list every 30 minutes
            if tick * _CACHE_HEARTBEAT >= _GUILD_REFRESH * tick:
                try:
                    await discord_client.fetch_guilds()
                except Exception:
                    log.debug("Guild cache refresh failed")
    finally:
        log.info("Web service shutting down — draining connections")
        await runner.cleanup()
        await discord_client.close()
        log.info("Web service stopped cleanly")


def main():
    log.info("Starting web service (standalone)...")
    asyncio.run(start_web())


if __name__ == "__main__":
    main()
