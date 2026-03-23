from __future__ import annotations

import hashlib
import hmac
import secrets
import ssl
import time
from collections import defaultdict
from pathlib import Path
from typing import TYPE_CHECKING, Optional

import aiohttp_jinja2
import aiohttp_session
from aiohttp_session.cookie_storage import EncryptedCookieStorage
from aiohttp import web
import jinja2

from bot.config import (
    WEB_HOST, WEB_PORT, SSL_CERT_PATH, SSL_KEY_PATH,
    WEB_DISK_PATH, WEB_SESSION_SECRET, WEB_FILE_SECRET, log,
)
from bot.web_routes import auth, dashboard, api

if TYPE_CHECKING:
    from bot.bot import WhitelistBot

BASE_DIR = Path(__file__).resolve().parent


# ─── Security: Rate Limiter ──────────────────────────────────────────────────

class RateLimiter:
    """Simple in-memory rate limiter per IP address."""

    def __init__(self, max_requests: int = 60, window_seconds: int = 60):
        self.max_requests = max_requests
        self.window = window_seconds
        self._hits: dict[str, list[float]] = defaultdict(list)

    def is_rate_limited(self, ip: str) -> bool:
        now = time.monotonic()
        hits = self._hits[ip]
        # Remove old entries
        self._hits[ip] = [t for t in hits if now - t < self.window]
        if len(self._hits[ip]) >= self.max_requests:
            return True
        self._hits[ip].append(now)
        return False


# ─── Security: Middleware ─────────────────────────────────────────────────────

def _get_client_ip(request: web.Request) -> str:
    """Get real client IP, respecting Cloudflare/proxy headers."""
    # Cloudflare sets CF-Connecting-IP
    cf_ip = request.headers.get("CF-Connecting-IP")
    if cf_ip:
        return cf_ip
    # Standard proxy header
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    peername = request.transport.get_extra_info("peername")
    return peername[0] if peername else "unknown"


@web.middleware
async def security_headers_middleware(request: web.Request, handler):
    """Add security headers to all responses."""
    response = await handler(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    # Only set HSTS if we have SSL
    if SSL_CERT_PATH:
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    return response


@web.middleware
async def rate_limit_middleware(request: web.Request, handler):
    """Rate limit requests per IP."""
    limiter = request.app.get("rate_limiter")
    if limiter:
        ip = _get_client_ip(request)
        if limiter.is_rate_limited(ip):
            raise web.HTTPTooManyRequests(text="Rate limit exceeded. Try again later.")
    return await handler(request)


# ─── Security: Whitelist File Token ──────────────────────────────────────────

def generate_file_token(guild_identifier: str, secret: str) -> str:
    """Generate a deterministic but unguessable token for whitelist file URLs.

    Uses HMAC-SHA256 of guild identifier + secret, truncated to 16 hex chars.
    This means the same guild always gets the same token (stable URLs),
    but the token is impossible to guess without the secret.
    """
    mac = hmac.new(secret.encode(), guild_identifier.encode(), hashlib.sha256)
    return mac.hexdigest()[:16]


# ─── WebServer ────────────────────────────────────────────────────────────────

class WebServer:
    def __init__(self, bot: "WhitelistBot"):
        self.bot = bot

        # Generate or use provided file secret
        self._file_secret = WEB_FILE_SECRET or secrets.token_hex(32)
        if not WEB_FILE_SECRET:
            log.info("WEB_FILE_SECRET not set, generated random token. Set it in .env for stable URLs across restarts.")

        self.app = web.Application(
            middlewares=[security_headers_middleware, rate_limit_middleware],
        )

        # Rate limiter: 60 requests/minute for general, applied globally
        self.app["rate_limiter"] = RateLimiter(max_requests=60, window_seconds=60)

        # Store bot reference for route handlers
        self.app["bot"] = bot
        self.app["web_server"] = self

        # Session setup: hash the secret to exactly 32 bytes for Fernet
        secret_bytes = hashlib.sha256(WEB_SESSION_SECRET.encode("utf-8")).digest()
        aiohttp_session.setup(
            self.app,
            EncryptedCookieStorage(
                secret_bytes,
                cookie_name="wl_session",
                max_age=86400,        # 24 hour session
                httponly=True,         # Not accessible via JS
                samesite="Lax",       # CSRF protection
                secure=bool(SSL_CERT_PATH),  # HTTPS only if SSL configured
            ),
        )

        # Jinja2 template setup
        aiohttp_jinja2.setup(
            self.app,
            loader=jinja2.FileSystemLoader(str(BASE_DIR / "templates")),
        )

        # Mount route modules
        auth.setup_routes(self.app)
        dashboard.setup_routes(self.app)
        api.setup_routes(self.app)

        # Whitelist file routes with secret token path
        # URL format: /wl/{token}/{filename}
        # The token is derived from file secret, making URLs unguessable
        self.app.router.add_get("/wl/{token}/{filename}", self._handle_file)

        # Static file serving
        static_dir = BASE_DIR / "static"
        if static_dir.is_dir():
            self.app.router.add_static("/static", str(static_dir), name="static")

        self.runner: Optional[web.AppRunner] = None
        self._cache: dict[str, str] = {}

    def get_file_token(self) -> str:
        """Get the secret token used in whitelist file URLs."""
        from bot.config import GUILD_ID
        return generate_file_token(str(GUILD_ID or "default"), self._file_secret)

    def get_file_url(self, filename: str) -> str:
        """Get the full URL for a whitelist file (for display in setup/status)."""
        from bot.config import WEB_BASE_URL
        token = self.get_file_token()
        base = WEB_BASE_URL or f"http://{WEB_HOST}:{WEB_PORT}"
        return f"{base}/wl/{token}/{filename}"

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
        log.info("Web server started on %s://%s:%s/", proto, WEB_HOST, WEB_PORT)

        # Log the whitelist file URL so admin knows what to put in Squad config
        token = self.get_file_token()
        log.info("Whitelist file URL prefix: /wl/%s/<filename>", token)

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
        """Serve whitelist files only if the token matches."""
        token = request.match_info["token"]
        filename = request.match_info["filename"]

        # Validate token
        expected_token = self.get_file_token()
        if not hmac.compare_digest(token, expected_token):
            # Don't reveal whether the file exists — always 404 for wrong token
            raise web.HTTPNotFound(text="Not found")

        content = self._cache.get(filename)
        if content is None:
            raise web.HTTPNotFound(text="Not found")

        # No caching headers — Squad server should always get fresh content
        return web.Response(
            text=content,
            content_type="text/plain",
            charset="utf-8",
            headers={
                "Cache-Control": "no-store, no-cache, must-revalidate",
                "Pragma": "no-cache",
            },
        )
