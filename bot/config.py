import os
import re
import secrets
import logging

from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
)
log = logging.getLogger("WhitelistBot")

DISCORD_TOKEN = os.getenv("DISCORD_TOKEN", "")
_raw_guild = os.getenv("GUILD_ID", "0") or "0"
try:
    GUILD_ID = int(_raw_guild)
except ValueError:
    GUILD_ID = 0  # Multi-guild mode (no single-guild override)

DB_ENGINE = os.getenv("DB_ENGINE", "mysql").strip().lower()  # "mysql" or "postgres"
DB_HOST = os.getenv("DB_HOST", "127.0.0.1")
DB_PORT = int(os.getenv("DB_PORT", "5432" if DB_ENGINE == "postgres" else "3306"))
DB_NAME = os.getenv("DB_NAME", "whitelist_bot")
DB_USER = os.getenv("DB_USER", "root" if DB_ENGINE == "mysql" else "postgres")
DB_PASSWORD = os.getenv("DB_PASSWORD", "")
DATABASE_URL = os.getenv("DATABASE_URL", "")  # Railway-style connection string

GITHUB_TOKEN = os.getenv("GITHUB_TOKEN", "")
GITHUB_REPO_OWNER = os.getenv("GITHUB_REPO_OWNER", "")
GITHUB_REPO_NAME = os.getenv("GITHUB_REPO_NAME", "")
WHITELIST_FILENAME = os.getenv("WHITELIST_FILENAME", "whitelist.txt")

DEFAULT_MOD_ROLE_ID = int(os.getenv("BOOTSTRAP_MOD_ROLE_ID", "0") or 0)
STEAM_API_KEY = os.getenv("STEAM_API_KEY", "")
SENTRY_DSN = os.getenv("SENTRY_DSN", "")  # Optional: Sentry error tracking

WEB_ENABLED = os.getenv("WEB_ENABLED", "true").strip().lower() in {"1", "true", "yes", "on", "enabled"}
WEB_HOST = os.getenv("WEB_HOST", "0.0.0.0")
WEB_PORT = int(os.getenv("PORT", "") or os.getenv("WEB_PORT", "8080"))  # Railway injects PORT
WEB_BASE_PATH = os.getenv("WEB_BASE_PATH", "/").rstrip("/")
SSL_CERT_PATH = os.getenv("SSL_CERT_PATH", "")
SSL_KEY_PATH = os.getenv("SSL_KEY_PATH", "")
WEB_DISK_PATH = os.getenv("WEB_DISK_PATH", "")
WEB_BASE_URL = os.getenv("WEB_BASE_URL", "").rstrip("/")  # e.g. https://wl.yourdomain.com
_raw_file_secret = os.getenv("WEB_FILE_SECRET", "")
if not _raw_file_secret:
    # Auto-generate a stable secret from DISCORD_TOKEN so it survives restarts
    # without needing an explicit env var.  Falls back to a random value if the
    # token is also absent (dev/test mode).
    _seed = os.getenv("DISCORD_TOKEN", "") or secrets.token_hex(32)
    import hmac as _hmac, hashlib as _hashlib
    WEB_FILE_SECRET = _hmac.new(_seed.encode(), b"wl-file-secret", _hashlib.sha256).hexdigest()
    log.warning("WEB_FILE_SECRET not set — derived from DISCORD_TOKEN. Set WEB_FILE_SECRET explicitly in production.")
else:
    WEB_FILE_SECRET = _raw_file_secret

DISCORD_CLIENT_ID = os.getenv("DISCORD_CLIENT_ID", "")
DISCORD_CLIENT_SECRET = os.getenv("DISCORD_CLIENT_SECRET", "")
_raw_session_secret = os.getenv("WEB_SESSION_SECRET", "")
if not _raw_session_secret or _raw_session_secret == "change-me-to-a-random-secret-key":
    if os.getenv("WEB_ENABLED", "true").strip().lower() in {"1", "true", "yes", "on", "enabled"}:
        log.warning(
            "WEB_SESSION_SECRET is not set or is the default placeholder. "
            "Sessions will be insecure. Set a strong random value in production."
        )
    WEB_SESSION_SECRET = _raw_session_secret or secrets.token_hex(32)
else:
    WEB_SESSION_SECRET = _raw_session_secret

STEAM64_RE = re.compile(r"^7656119\d{10}$")
EOSID_RE = re.compile(r"^[0-9a-fA-F]{32}$")

SQUAD_PERMISSIONS = {
    "startvote": "Start a vote (not currently used)",
    "changemap": "Change the map",
    "pause": "Pause server gameplay",
    "cheat": "Use server cheat commands",
    "private": "Password protect server",
    "balance": "Group ignores team balance",
    "chat": "Admin chat and server broadcast",
    "kick": "Kick players",
    "ban": "Ban players",
    "config": "Change server config",
    "cameraman": "Admin spectate mode",
    "immune": "Cannot be kicked or banned",
    "manageserver": "Shutdown server",
    "featuretest": "Dev team testing features",
    "reserve": "Reserve slot",
    "demos": "Record server-side demos",
    "clientdemos": "Record client-side demos",
    "debug": "Show admin stats and debug info",
    "teamchange": "No timer limits on team change",
    "forceteamchange": "Force team change command",
    "canseeadminchat": "View admin chat and TK notifications",
}

DEFAULT_SETTINGS = {
    "output_mode": "combined",
    "combined_filename": WHITELIST_FILENAME,
    "retention_days": "90",
    "report_frequency": "weekly",
    "mod_role_id": str(DEFAULT_MOD_ROLE_ID or ""),
    "allow_global_duplicates": "true",
    "duplicate_output_dedupe": "true",
    "auto_reactivate_on_role_return": "true",
    "notification_channel_id": "",
    "welcome_dm_enabled": "false",
    "welcome_dm_text": "",
    "timezone": "UTC",
    "bot_status_message": "",
    # Org-level dashboard theme (hex colors). Empty = no org theme set.
    "accent_primary": "",
    "accent_secondary": "",
}

# Legacy: hardcoded type definitions (used by Discord slash command cogs as fallback).
# New code uses dynamic whitelists from the database instead.
DEFAULT_TYPES = {}
WHITELIST_TYPES = ()  # Empty — types are now dynamic from DB
