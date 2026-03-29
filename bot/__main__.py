"""Entry point router.

Usage:
  python -m bot          # Start the Discord bot (default)
  python -m bot bot      # Start the Discord bot explicitly
"""
import sys

from bot.config import SENTRY_DSN


def _init_sentry():
    """Initialize Sentry error tracking if DSN is configured."""
    if not SENTRY_DSN:
        return
    try:
        import sentry_sdk
        sentry_sdk.init(
            dsn=SENTRY_DSN,
            environment="bot",
            traces_sample_rate=0.1,
            send_default_pii=False,
        )
    except ImportError:
        pass  # sentry-sdk not installed, skip silently


def main():
    _init_sentry()
    from bot.bot_main import main as bot_main
    bot_main()


if __name__ == "__main__":
    main()
