import asyncio
from bot.bot import WhitelistBot
from bot.config import DISCORD_TOKEN, GITHUB_TOKEN, GITHUB_REPO_OWNER, GITHUB_REPO_NAME, DB_HOST, DB_NAME, DB_USER


def main():
    if not all([DISCORD_TOKEN, DB_HOST, DB_NAME, DB_USER, GITHUB_TOKEN, GITHUB_REPO_OWNER, GITHUB_REPO_NAME]):
        raise RuntimeError("Missing required environment variables. Check your .env file.")
    bot = WhitelistBot()
    bot.run(DISCORD_TOKEN)


if __name__ == "__main__":
    main()
