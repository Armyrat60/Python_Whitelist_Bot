"""Entry point router.

Usage:
  python -m bot          # Start the Discord bot (default, backward compatible)
  python -m bot bot      # Start the Discord bot explicitly
  python -m bot web      # Start the standalone web service
"""
import sys


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "bot"

    if mode == "web":
        from bot.web_main import main as web_main
        web_main()
    else:
        from bot.bot_main import main as bot_main
        bot_main()


if __name__ == "__main__":
    main()
