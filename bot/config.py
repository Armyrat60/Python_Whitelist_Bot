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

DB_ENGINE = os.getenv("DB_ENGINE", "postgres").strip().lower()
DB_HOST = os.getenv("DB_HOST", "127.0.0.1")
DB_PORT = int(os.getenv("DB_PORT", "5432"))
DB_NAME = os.getenv("DB_NAME", "whitelist_bot")
DB_USER = os.getenv("DB_USER", "postgres")
DB_PASSWORD = os.getenv("DB_PASSWORD", "")
DATABASE_URL = os.getenv("DATABASE_URL", "")  # Railway-style connection string

GITHUB_TOKEN = os.getenv("GITHUB_TOKEN", "")
GITHUB_REPO_OWNER = os.getenv("GITHUB_REPO_OWNER", "")
GITHUB_REPO_NAME = os.getenv("GITHUB_REPO_NAME", "")
WHITELIST_FILENAME = os.getenv("WHITELIST_FILENAME", "whitelist.txt")

DEFAULT_MOD_ROLE_ID = int(os.getenv("BOOTSTRAP_MOD_ROLE_ID", "0") or 0)
STEAM_API_KEY = os.getenv("STEAM_API_KEY", "")
BOT_INTERNAL_SECRET = os.getenv("BOT_INTERNAL_SECRET", "")
SENTRY_DSN = os.getenv("SENTRY_DSN", "")  # Optional: Sentry error tracking

WEB_BASE_URL = os.getenv("WEB_BASE_URL", "").rstrip("/")  # Dashboard URL e.g. https://squadwhitelister.com
WEB_INTERNAL_URL = os.getenv("WEB_INTERNAL_URL", "").rstrip("/")  # TypeScript API internal URL e.g. http://api:8080
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
    "role_sync_interval_hours": "24",  # how often the role sync runs (1–168 hours)
    # Org-level dashboard theme (hex colors). Empty = no org theme set.
    "accent_primary": "",
    "accent_secondary": "",
}

# Notification event types for per-channel routing
NOTIFICATION_EVENT_TYPES = {
    "user_joined":       {"label": "User Joined Whitelist",    "description": "Sent when a user is added to a whitelist via panel submit or admin action"},
    "user_removed":      {"label": "User Removed",             "description": "Sent when a user is removed, disabled, or their entry expires"},
    "role_lost":         {"label": "Role Lost (Auto-Disable)", "description": "Sent when a user is auto-disabled because they lost their whitelisted role"},
    "role_returned":     {"label": "Role Returned (Re-Enable)","description": "Sent when a user is re-enabled because their role returned"},
    "user_left_discord": {"label": "User Left Discord",        "description": "Sent when a whitelisted user leaves the Discord server"},
    "report":            {"label": "Scheduled Reports",        "description": "Daily or weekly whitelist summary reports"},
    "bot_alert":         {"label": "Bot System Alerts",        "description": "System-level alerts: expiry batches, errors, resync events"},
    "admin_action":      {"label": "Admin Actions",            "description": "Bulk imports, bulk deletes, panel pushes, and settings changes"},
}

# Legacy: hardcoded type definitions (used by Discord slash command cogs as fallback).
# New code uses dynamic whitelists from the database instead.
DEFAULT_TYPES = {}
WHITELIST_TYPES = ()  # Empty — types are now dynamic from DB
