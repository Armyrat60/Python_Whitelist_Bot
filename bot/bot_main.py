"""Entry point for the Discord bot worker service."""
import os

from bot.bot import WhitelistBot
from bot.config import DISCORD_TOKEN, DATABASE_URL, DB_HOST, DB_NAME, DB_USER, log


def main():
    if not DISCORD_TOKEN:
        raise RuntimeError("DISCORD_TOKEN is required.")
    if not DATABASE_URL and not all([DB_HOST, DB_NAME, DB_USER]):
        raise RuntimeError("Database config required: set DATABASE_URL or DB_HOST/DB_NAME/DB_USER.")
    bot = WhitelistBot()
    log.info("Starting Discord bot worker...")
    bot.run(DISCORD_TOKEN)


if __name__ == "__main__":
    main()
