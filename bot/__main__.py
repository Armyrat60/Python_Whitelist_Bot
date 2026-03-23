import asyncio
from bot.bot import WhitelistBot
from bot.config import DISCORD_TOKEN, DB_HOST, DB_NAME, DB_USER, DATABASE_URL


def main():
    if not DISCORD_TOKEN:
        raise RuntimeError("DISCORD_TOKEN is required. Check your .env file.")
    if not DATABASE_URL and not all([DB_HOST, DB_NAME, DB_USER]):
        raise RuntimeError("Database config required: set DATABASE_URL or DB_HOST/DB_NAME/DB_USER.")
    bot = WhitelistBot()
    bot.run(DISCORD_TOKEN)


if __name__ == "__main__":
    main()
