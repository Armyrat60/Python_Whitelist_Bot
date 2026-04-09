"""Tests for bot/output.py — whitelist file generation.

Covers the core logic that builds Squad RemoteAdminList files from DB data.
Run with: python -m pytest tests/
"""
import asyncio
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest
import pytest_asyncio

# Ensure the project root is on sys.path so `bot.*` imports work.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

# ---------------------------------------------------------------------------
# Helpers — build fake DB rows in the exact shapes get_* returns
# ---------------------------------------------------------------------------

def _make_db(
    *,
    output_mode="combined",
    combined_filename="whitelist.txt",
    dedupe="true",
    whitelists=None,
    squad_groups=None,
    export_rows=None,
):
    """Return a mock Database with all methods output.py calls."""
    if whitelists is None:
        whitelists = [
            {
                "id": 1,
                "slug": "whitelist-1",
                "name": "Whitelist 1",
                "enabled": True,
                "squad_group": "Reserve",
                "output_filename": "whitelist.cfg",
            }
        ]
    if squad_groups is None:
        # 4-column tuple: group_name, permissions, is_default, description
        squad_groups = [("Reserve", "reserve", False, "Default reserve group")]

    if export_rows is None:
        export_rows = []

    db = MagicMock()

    async def _get_setting(guild_id, key, default=None):
        return {
            "output_mode": output_mode,
            "combined_filename": combined_filename,
            "duplicate_output_dedupe": dedupe,
        }.get(key, default)

    db.get_setting = _get_setting
    db.get_whitelists = AsyncMock(return_value=whitelists)
    db.get_squad_groups = AsyncMock(return_value=squad_groups)
    db.get_disabled_squad_group_names = AsyncMock(return_value=[])
    db.get_active_export_rows = AsyncMock(return_value=export_rows)
    return db


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_combined_mode_basic():
    """generate_output_files returns content under combined_filename."""
    from bot.output import generate_output_files

    db = _make_db(
        export_rows=[
            ("whitelist-1", "whitelist.cfg", 12345, "TestPlayer", "steamid", "76561198000000001"),
        ]
    )
    outputs = await generate_output_files(db, guild_id=999)

    assert "whitelist.txt" in outputs
    content = outputs["whitelist.txt"]
    assert "Group=Reserve:reserve" in content
    assert "Admin=76561198000000001:Reserve // TestPlayer" in content


@pytest.mark.asyncio
async def test_combined_mode_copies_to_per_whitelist_filename():
    """In combined mode, each whitelist's output_filename also gets the combined content."""
    from bot.output import generate_output_files

    db = _make_db(combined_filename="combined.cfg")
    outputs = await generate_output_files(db, guild_id=999)

    # Both files present
    assert "combined.cfg" in outputs
    assert "whitelist.cfg" in outputs
    # Both have the same content
    assert outputs["combined.cfg"] == outputs["whitelist.cfg"]


@pytest.mark.asyncio
async def test_group_headers_appear_even_when_whitelist_is_empty():
    """Group headers must appear in the file even if the whitelist has no entries."""
    from bot.output import generate_output_files

    db = _make_db(export_rows=[])  # no players
    outputs = await generate_output_files(db, guild_id=999)

    content = outputs["whitelist.txt"]
    assert "Group=Reserve:reserve" in content, (
        "Group header missing when whitelist is empty — "
        "Squad server needs the Group= line to recognise the permission set"
    )


@pytest.mark.asyncio
async def test_squad_groups_4_tuple_schema():
    """
    Regression: get_squad_groups returns 4-tuple (name, perms, is_default, description).
    If output.py unpacks fewer columns it raises ValueError and silently returns no cache.
    This test ensures the function succeeds with the current 4-column schema.
    """
    from bot.output import generate_output_files

    db = _make_db(
        squad_groups=[
            # 4-column tuple — any change to column count will break this
            ("Reserve", "reserve", False, "Reserve whitelist group"),
            ("Admin",   "kick,ban,chat,cameraman,immune,reserve", True, "Full admin"),
        ],
        whitelists=[
            {
                "id": 1, "slug": "wl-reserve", "name": "Whitelist 1",
                "enabled": True, "squad_group": "Reserve", "output_filename": "reserve.cfg",
            },
            {
                "id": 2, "slug": "wl-admin", "name": "Admins",
                "enabled": True, "squad_group": "Admin", "output_filename": "admins.cfg",
            },
        ],
        export_rows=[
            ("wl-reserve", "reserve.cfg", 111, "Player1", "steamid", "76561198000000001"),
            ("wl-admin",   "admins.cfg",  222, "Admin1",  "steamid", "76561198000000002"),
        ],
    )

    # This must not raise
    outputs = await generate_output_files(db, guild_id=999)

    assert "Group=Reserve:reserve" in outputs["whitelist.txt"]
    assert "Group=Admin:kick,ban,chat,cameraman,immune,reserve" in outputs["whitelist.txt"]


@pytest.mark.asyncio
async def test_disabled_whitelist_excluded_from_output():
    """Disabled whitelists must not appear in any output file."""
    from bot.output import generate_output_files

    db = _make_db(
        whitelists=[
            {
                "id": 1, "slug": "wl-active", "name": "Active",
                "enabled": True,  "squad_group": "Reserve", "output_filename": "active.cfg",
            },
            {
                "id": 2, "slug": "wl-disabled", "name": "Disabled",
                "enabled": False, "squad_group": "VIP",     "output_filename": "disabled.cfg",
            },
        ],
        squad_groups=[
            ("Reserve", "reserve", False, ""),
            ("VIP",     "reserve", False, "VIP group"),
        ],
        # DB returns all active rows; output.py filters disabled whitelists in Python
        export_rows=[
            ("wl-active",   "active.cfg",   111, "Player1", "steamid", "76561198000000001"),
            ("wl-disabled", "disabled.cfg", 222, "Player2", "steamid", "76561198000000002"),
        ],
    )
    outputs = await generate_output_files(db, guild_id=999)

    content = outputs["whitelist.txt"]
    assert "Player1" in content
    assert "Player2" not in content
    # Disabled whitelist's group header should not appear
    assert "Group=VIP" not in content


@pytest.mark.asyncio
async def test_deduplication_combined_mode():
    """Same Steam ID in two whitelists appears only once in combined output."""
    from bot.output import generate_output_files

    db = _make_db(
        whitelists=[
            {"id": 1, "slug": "wl-a", "name": "A", "enabled": True, "squad_group": "Reserve", "output_filename": "a.cfg"},
            {"id": 2, "slug": "wl-b", "name": "B", "enabled": True, "squad_group": "Reserve", "output_filename": "b.cfg"},
        ],
        squad_groups=[("Reserve", "reserve", False, "")],
        export_rows=[
            ("wl-a", "a.cfg", 111, "Player1", "steamid", "76561198000000001"),
            ("wl-b", "b.cfg", 111, "Player1", "steamid", "76561198000000001"),  # duplicate
        ],
        dedupe="true",
    )
    outputs = await generate_output_files(db, guild_id=999)

    content = outputs["whitelist.txt"]
    assert content.count("76561198000000001") == 1


@pytest.mark.asyncio
async def test_eosid_gets_eos_suffix():
    """EOS IDs must have the [EOS] suffix in the output line."""
    from bot.output import generate_output_files

    db = _make_db(
        export_rows=[
            ("whitelist-1", "whitelist.cfg", 111, "Player1", "eosid", "abcdef1234567890abcdef1234567890"),
        ]
    )
    outputs = await generate_output_files(db, guild_id=999)

    content = outputs["whitelist.txt"]
    assert "[EOS]" in content
    assert "Admin=abcdef1234567890abcdef1234567890:Reserve // Player1 [EOS]" in content


@pytest.mark.asyncio
async def test_separate_mode_one_file_per_whitelist():
    """In separate mode, each whitelist gets its own file, not a combined file."""
    from bot.output import generate_output_files

    db = _make_db(
        output_mode="separate",
        whitelists=[
            {"id": 1, "slug": "wl-a", "name": "A", "enabled": True, "squad_group": "Reserve", "output_filename": "a.cfg"},
            {"id": 2, "slug": "wl-b", "name": "B", "enabled": True, "squad_group": "VIP",     "output_filename": "b.cfg"},
        ],
        squad_groups=[
            ("Reserve", "reserve", False, ""),
            ("VIP",     "reserve", False, ""),
        ],
        export_rows=[
            ("wl-a", "a.cfg", 111, "PlayerA", "steamid", "76561198000000001"),
            ("wl-b", "b.cfg", 222, "PlayerB", "steamid", "76561198000000002"),
        ],
    )
    outputs = await generate_output_files(db, guild_id=999)

    assert "whitelist.txt" not in outputs  # no combined file in separate mode
    assert "a.cfg" in outputs
    assert "b.cfg" in outputs
    assert "PlayerA" in outputs["a.cfg"]
    assert "PlayerB" not in outputs["a.cfg"]
    assert "PlayerB" in outputs["b.cfg"]


@pytest.mark.asyncio
async def test_multiple_guilds_isolated():
    """Outputs for different guild IDs use the correct DB data."""
    from bot.output import generate_output_files

    db_g1 = _make_db(
        export_rows=[("whitelist-1", "whitelist.cfg", 1, "GuildOnePlayer", "steamid", "76561198000000001")],
    )
    db_g2 = _make_db(
        export_rows=[("whitelist-1", "whitelist.cfg", 2, "GuildTwoPlayer", "steamid", "76561198000000002")],
    )

    out1 = await generate_output_files(db_g1, guild_id=111)
    out2 = await generate_output_files(db_g2, guild_id=222)

    assert "GuildOnePlayer" in out1["whitelist.txt"]
    assert "GuildOnePlayer" not in out2["whitelist.txt"]
    assert "GuildTwoPlayer" in out2["whitelist.txt"]
    assert "GuildTwoPlayer" not in out1["whitelist.txt"]
