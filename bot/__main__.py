"""Entry point router.

Usage:
  python -m bot          # Start the Discord bot (default, backward compatible)
  python -m bot bot      # Start the Discord bot explicitly
  python -m bot web      # Start the standalone web service
"""
import sys

from bot.config import SENTRY_DSN


def _init_sentry(mode: str):
    """Initialize Sentry error tracking if DSN is configured."""
    if not SENTRY_DSN:
        return
    try:
        import sentry_sdk
        sentry_sdk.init(
            dsn=SENTRY_DSN,
            environment=mode,
            traces_sample_rate=0.1,
            send_default_pii=False,
        )
    except ImportError:
        pass  # sentry-sdk not installed, skip silently


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "bot"
    _init_sentry(mode)

    if mode == "web":
        from bot.web_main import main as web_main
        web_main()
    else:
        from bot.bot_main import main as bot_main
        bot_main()


if __name__ == "__main__":
    main()
