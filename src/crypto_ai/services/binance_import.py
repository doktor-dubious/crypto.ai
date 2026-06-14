"""Service for importing Binance kline data from CSV files or Binance API."""

import csv
import gzip
import io
import re
import zipfile
from datetime import UTC, datetime
from pathlib import Path
from typing import AsyncGenerator

import aiofiles
import httpx

from crypto_ai.database.models.kline import Kline
from crypto_ai.schemas.kline import KlineCreate
from sqlalchemy.ext.asyncio import AsyncSession


BINANCE_BASE_URL = "https://data.binance.vision/data/spot/daily/klines"
BINANCE_MONTHLY_BASE_URL = "https://data.binance.vision/data/spot/monthly/klines"


def _binance_ts_to_datetime(raw: str | int) -> datetime:
    """Convert a Binance kline timestamp to a UTC datetime.

    Binance has published kline timestamps in different units over time:
    seconds (10 digits), milliseconds (13 digits, data up to ~2024) and
    microseconds (16 digits, data from ~2025 onward). Detect the unit by
    magnitude instead of assuming one, so mixed-era imports are all correct.
    """
    ts = int(raw)
    if ts >= 1_000_000_000_000_000:  # microseconds (16+ digits)
        seconds = ts / 1_000_000
    elif ts >= 1_000_000_000_000:  # milliseconds (13 digits)
        seconds = ts / 1_000
    else:  # seconds (10 digits)
        seconds = ts
    return datetime.fromtimestamp(seconds, tz=UTC)


class BinanceImportService:
    """Service for importing Binance kline data."""

    def __init__(self, session: AsyncSession):
        self.session = session

    async def parse_csv_content(
        self,
        content: str,
        coin_id: str,
        interval: str,
        quote_asset: str = "USDT",
    ) -> list[KlineCreate]:
        """Parse Binance kline CSV content."""
        reader = csv.reader(io.StringIO(content))
        klines = []

        for row in reader:
            if len(row) < 11:
                continue

            try:
                # Unit varies by era (ms pre-2025, µs from 2025); detect per-row.
                open_time = _binance_ts_to_datetime(row[0])
                close_time = _binance_ts_to_datetime(row[6])

                kline = KlineCreate(
                    coin_id=coin_id,
                    quote_asset=quote_asset,
                    interval=interval,
                    open_time=open_time,
                    close_time=close_time,
                    open=float(row[1]),
                    high=float(row[2]),
                    low=float(row[3]),
                    close=float(row[4]),
                    volume=float(row[5]),
                    quote_asset_volume=float(row[7]),
                    number_of_trades=int(row[8]),
                    taker_buy_base_asset_volume=float(row[9]),
                    taker_buy_quote_asset_volume=float(row[10]),
                )
                klines.append(kline)
            except (ValueError, IndexError) as e:
                continue

        return klines

    async def import_from_file(
        self,
        file_path: str,
        coin_id: str,
        interval: str,
        quote_asset: str = "USDT",
    ) -> list[KlineCreate]:
        """Import klines from a local CSV or ZIP file."""
        path = Path(file_path)

        if not path.exists():
            raise FileNotFoundError(f"File not found: {file_path}")

        if file_path.endswith(".zip"):
            return await self._import_from_zip(file_path, coin_id, interval, quote_asset)
        elif file_path.endswith(".gz"):
            return await self._import_from_gzip(file_path, coin_id, interval, quote_asset)
        elif file_path.endswith(".csv"):
            return await self._import_from_csv(file_path, coin_id, interval, quote_asset)
        else:
            raise ValueError("Unsupported file format. Use .csv, .zip, or .gz")

    async def _import_from_csv(
        self,
        file_path: str,
        coin_id: str,
        interval: str,
        quote_asset: str = "USDT",
    ) -> list[KlineCreate]:
        """Import from CSV file."""
        async with aiofiles.open(file_path, "r") as f:
            content = await f.read()
        return await self.parse_csv_content(content, coin_id, interval, quote_asset)

    async def _import_from_gzip(
        self,
        file_path: str,
        coin_id: str,
        interval: str,
        quote_asset: str = "USDT",
    ) -> list[KlineCreate]:
        """Import from gzip-compressed CSV file."""
        async with aiofiles.open(file_path, "rb") as f:
            content = await f.read()
        decompressed = gzip.decompress(content).decode("utf-8")
        return await self.parse_csv_content(decompressed, coin_id, interval, quote_asset)

    async def _import_from_zip(
        self,
        file_path: str,
        coin_id: str,
        interval: str,
        quote_asset: str = "USDT",
    ) -> list[KlineCreate]:
        """Import from ZIP file containing CSV."""
        klines = []
        with zipfile.ZipFile(file_path, "r") as zf:
            for filename in zf.namelist():
                if filename.endswith(".csv"):
                    with zf.open(filename) as f:
                        content = f.read().decode("utf-8")
                        parsed = await self.parse_csv_content(content, coin_id, interval, quote_asset)
                        klines.extend(parsed)
        return klines

    async def import_from_binance(
        self,
        symbol: str,
        interval: str,
        coin_id: str,
        quote_asset: str = "USDT",
        start_date: str | None = None,
        end_date: str | None = None,
    ) -> AsyncGenerator[tuple[int, int, str], None]:
        """
        Import klines directly from Binance data source.
        Yields: (imported_count, total_count, status_message)
        """
        # Determine date range
        if start_date and end_date:
            dates = self._get_date_range(start_date, end_date)
        else:
            # Default: import last 30 days
            from datetime import timedelta

            end = datetime.now().date()
            start = end - timedelta(days=30)
            dates = self._get_date_range(start.isoformat(), end.isoformat())

        total_imported = 0
        total_files = len(dates)

        async with httpx.AsyncClient() as client:
            for idx, date_str in enumerate(dates):
                try:
                    # Build Binance URL
                    url = f"{BINANCE_BASE_URL}/{symbol}/{interval}/{symbol}-{interval}-{date_str}.zip"

                    yield (total_imported, total_files, f"Downloading {date_str}...")

                    # Download file
                    response = await client.get(url, timeout=30.0)
                    if response.status_code != 200:
                        yield (
                            total_imported,
                            total_files,
                            f"Skipped {date_str}: File not found (404)",
                        )
                        continue

                    # Parse ZIP content
                    zip_buffer = io.BytesIO(response.content)
                    klines = []

                    with zipfile.ZipFile(zip_buffer, "r") as zf:
                        for filename in zf.namelist():
                            if filename.endswith(".csv"):
                                with zf.open(filename) as f:
                                    content = f.read().decode("utf-8")
                                    parsed = await self.parse_csv_content(
                                        content, coin_id, interval, quote_asset
                                    )
                                    klines.extend(parsed)

                    if klines:
                        # Create klines in database
                        objs = [Kline(**k.model_dump()) for k in klines]
                        self.session.add_all(objs)
                        await self.session.flush()
                        total_imported += len(klines)

                    yield (
                        total_imported,
                        total_files,
                        f"Imported {date_str}: {len(klines)} klines",
                    )

                except Exception as e:
                    yield (
                        total_imported,
                        total_files,
                        f"Error on {date_str}: {str(e)}",
                    )

    def _get_date_range(self, start_date: str, end_date: str) -> list[str]:
        """Get list of dates between start and end (inclusive)."""
        from datetime import timedelta

        start = datetime.fromisoformat(start_date).date()
        end = datetime.fromisoformat(end_date).date()
        dates = []
        current = start

        while current <= end:
            dates.append(current.strftime("%Y-%m-%d"))
            current += timedelta(days=1)

        return dates

    def parse_symbol_from_url(self, url: str) -> tuple[str, str] | None:
        """Extract symbol and interval from Binance data URL.

        Example: https://data.binance.vision/?prefix=data/spot/daily/klines/BTCUSDT/1h/
        Returns: ('BTCUSDT', '1h')
        """
        # Extract from URL pattern
        match = re.search(r"/klines/([A-Z0-9]+)/(\d+[mhdwM])/", url)
        if match:
            return (match.group(1), match.group(2))
        return None
