"""Tests for web.py token generation and URL serving logic.

Does NOT require a running DB or Discord — all dependencies are mocked.
Run with: python -m pytest tests/
"""
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_web_server(guilds=None):
    """Return a WebServer-like object with the token logic wired up."""
    from bot.web import WebServer, generate_file_token

    # Minimal bot mock
    bot = MagicMock()
    bot.guilds = guilds or []
    bot.db = MagicMock()
    bot.db.get_setting = AsyncMock(return_value=None)

    # Patch the aiohttp app setup so we don't need a running event loop
    with patch("bot.web.aiohttp_session.setup"), \
         patch("bot.web.aiohttp_jinja2.setup"), \
         patch("bot.web.auth.setup_routes"), \
         patch("bot.web.dashboard.setup_routes"), \
         patch("bot.web.api.setup_routes"):
        ws = WebServer(bot)

    return ws


# ---------------------------------------------------------------------------
# Token generation
# ---------------------------------------------------------------------------

def test_same_guild_same_token():
    """Identical guild ID + secret always produces the same token (stable URLs)."""
    from bot.web import generate_file_token
    t1 = generate_file_token("123456789", "my-secret")
    t2 = generate_file_token("123456789", "my-secret")
    assert t1 == t2


def test_different_guilds_different_tokens():
    """Different guild IDs produce different tokens."""
    from bot.web import generate_file_token
    t1 = generate_file_token("111111111", "my-secret")
    t2 = generate_file_token("222222222", "my-secret")
    assert t1 != t2


def test_different_secrets_different_tokens():
    """Same guild ID, different secrets → different tokens."""
    from bot.web import generate_file_token
    t1 = generate_file_token("123456789", "secret-a")
    t2 = generate_file_token("123456789", "secret-b")
    assert t1 != t2


def test_token_is_hex_16_chars():
    """Token is a 16-character lowercase hex string."""
    from bot.web import generate_file_token
    token = generate_file_token("123456789", "my-secret")
    assert len(token) == 16
    assert all(c in "0123456789abcdef" for c in token)


# ---------------------------------------------------------------------------
# WebServer.update_cache / get_file_token / _token_to_guild mapping
# ---------------------------------------------------------------------------

def test_update_cache_registers_token_mapping():
    """update_cache must register the guild's token in _token_to_guild."""
    ws = _make_web_server()
    ws.update_cache(guild_id=111, outputs={"whitelist.txt": "Group=Reserve:reserve\n"})

    token = ws.get_file_token(111)
    assert ws._token_to_guild.get(token) == 111


def test_update_cache_stores_file_content():
    """update_cache must store file content accessible by guild_id + filename."""
    ws = _make_web_server()
    content = "Group=Reserve:reserve\n\nAdmin=76561198000000001:Reserve // TestPlayer"
    ws.update_cache(guild_id=111, outputs={"whitelist.txt": content})

    assert ws._cache[111]["whitelist.txt"] == content


def test_get_file_url_contains_token_and_filename():
    """get_file_url must embed the token and filename in the returned URL."""
    ws = _make_web_server()
    with patch("bot.web.WEB_BASE_URL", "https://example.com"):
        url = ws.get_file_url(111, "whitelist.txt")

    token = ws.get_file_token(111)
    assert token in url
    assert "whitelist.txt" in url
    assert url.startswith("https://example.com")


def test_url_salt_changes_token():
    """A guild salt must change the token so old URLs stop working after regeneration."""
    ws = _make_web_server()
    token_before = ws.get_file_token(111)
    ws._guild_salts[111] = "newsalt"
    token_after = ws.get_file_token(111)
    assert token_before != token_after


# ---------------------------------------------------------------------------
# _handle_file — token validation and cache-miss regeneration
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_handle_file_returns_content_from_cache():
    """Serving a known file should return its content as text/plain."""
    from aiohttp.test_utils import make_mocked_request

    ws = _make_web_server()
    content = "Group=Reserve:reserve\n\nAdmin=76561198000000001:Reserve // Player"
    ws.update_cache(111, {"whitelist.txt": content})
    token = ws.get_file_token(111)

    req = make_mocked_request("GET", f"/wl/{token}/whitelist.txt",
                              match_info={"token": token, "filename": "whitelist.txt"})

    response = await ws._handle_file(req)
    assert response.status == 200
    assert response.text == content


@pytest.mark.asyncio
async def test_handle_file_404_for_unknown_token():
    """An unknown token must result in 404, not a crash."""
    from aiohttp import web as aio_web
    from aiohttp.test_utils import make_mocked_request

    ws = _make_web_server()  # no guilds, no cache
    req = make_mocked_request("GET", "/wl/deadbeef12345678/whitelist.txt",
                              match_info={"token": "deadbeef12345678", "filename": "whitelist.txt"})

    with pytest.raises(aio_web.HTTPNotFound):
        await ws._handle_file(req)


@pytest.mark.asyncio
async def test_handle_file_regenerates_on_cache_miss():
    """If a filename is missing from cache, _handle_file should regenerate it."""
    from aiohttp.test_utils import make_mocked_request

    ws = _make_web_server()
    # Register the token but leave cache empty for that file
    ws._token_to_guild[ws.get_file_token(111)] = 111
    ws._cache[111] = {}  # guild known but file missing

    # Mock generate_output_files to return fresh content
    fresh_content = "Group=Reserve:reserve\n"
    with patch("bot.output.generate_output_files",
               new=AsyncMock(return_value={"whitelist.txt": fresh_content})):
        ws.bot.db = MagicMock()  # ensure db is not None

        token = ws.get_file_token(111)
        req = make_mocked_request("GET", f"/wl/{token}/whitelist.txt",
                                  match_info={"token": token, "filename": "whitelist.txt"})
        response = await ws._handle_file(req)

    assert response.status == 200
    assert response.text == fresh_content
