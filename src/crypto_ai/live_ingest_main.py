"""Entrypoint for the live kline ingester.

    uv run python -m crypto_ai.live_ingest_main

Runs until interrupted, keeping the klines table current from Binance. Mode and
targets come from settings (LIVE_INGEST_MODE, LIVE_INGEST_INTERVALS, ...). See
``crypto_ai.services.live_ingest`` for the WS vs poll behaviour.
"""

import asyncio

import structlog

from crypto_ai.logging import configure_logging
from crypto_ai.services.live_ingest import LiveIngestService

log = structlog.get_logger()


def main() -> None:
    # Attach the file handlers (incl. binance.log) so ingester errors land in the
    # "Binance Data" log, not just stdout.
    configure_logging()
    try:
        asyncio.run(LiveIngestService().run())
    except KeyboardInterrupt:
        log.info("live ingest stopped")


if __name__ == "__main__":
    main()
