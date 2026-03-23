from __future__ import annotations

import ssl
from pathlib import Path
from typing import TYPE_CHECKING, Optional

from aiohttp import web

from bot.config import WEB_HOST, WEB_PORT, WEB_BASE_PATH, SSL_CERT_PATH, SSL_KEY_PATH, WEB_DISK_PATH, log

if TYPE_CHECKING:
    from bot.bot import WhitelistBot


class WebServer:
    def __init__(self, bot: "WhitelistBot"):
        self.bot = bot
        self.app = web.Application()
        self.app.router.add_get(f"{WEB_BASE_PATH}/{{filename}}", self._handle_file)
        self.app.router.add_get(f"{WEB_BASE_PATH}/", self._handle_index)
        self.runner: Optional[web.AppRunner] = None
        self._cache: dict[str, str] = {}

    async def start(self):
        ssl_ctx = None
        if SSL_CERT_PATH and SSL_KEY_PATH:
            ssl_ctx = ssl.create_default_context(ssl.Purpose.CLIENT_AUTH)
            ssl_ctx.load_cert_chain(SSL_CERT_PATH, SSL_KEY_PATH)
            log.info("Web server SSL enabled: cert=%s key=%s", SSL_CERT_PATH, SSL_KEY_PATH)
        self.runner = web.AppRunner(self.app)
        await self.runner.setup()
        site = web.TCPSite(self.runner, WEB_HOST, WEB_PORT, ssl_context=ssl_ctx)
        await site.start()
        proto = "https" if ssl_ctx else "http"
        log.info("Web server started on %s://%s:%s%s/", proto, WEB_HOST, WEB_PORT, WEB_BASE_PATH)

    async def stop(self):
        if self.runner:
            await self.runner.cleanup()

    def update_cache(self, outputs: dict[str, str]):
        self._cache = dict(outputs)
        if WEB_DISK_PATH:
            disk = Path(WEB_DISK_PATH)
            disk.mkdir(parents=True, exist_ok=True)
            for filename, content in outputs.items():
                (disk / filename).write_text(content, encoding="utf-8")

    async def _handle_file(self, request: web.Request) -> web.Response:
        filename = request.match_info["filename"]
        content = self._cache.get(filename)
        if content is None:
            raise web.HTTPNotFound(text=f"File not found: {filename}")
        return web.Response(text=content, content_type="text/plain", charset="utf-8")

    async def _handle_index(self, request: web.Request) -> web.Response:
        files = sorted(self._cache.keys())
        if not files:
            return web.Response(text="No whitelist files available.", content_type="text/plain")
        lines = ["Available whitelist files:", ""] + [f"  {f}" for f in files]
        return web.Response(text="\n".join(lines), content_type="text/plain", charset="utf-8")
