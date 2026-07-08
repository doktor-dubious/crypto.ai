"""Service for importing Binance kline data from CSV files or Binance API."""

import csv
import gzip
import io
import re
import zipfile
from datetime import UTC, date, datetime
from pathlib import Path
from typing import AsyncGenerator

import aiofiles
import httpx

from crypto_ai.database.models.kline import Kline
from crypto_ai.schemas.kline import KlineCreate
from sqlalchemy.ext.asyncio import AsyncSession


BINANCE_BASE_URL = "https://data.binance.vision/data/spot/daily/klines"
BINANCE_MONTHLY_BASE_URL = "https://data.binance.vision/data/spot/monthly/klines"

# Binance spot kline archives start in 2017 (BTCUSDT listed 2017-08). Used as the
# back-fill floor when loading a coin/interval that has no data yet.
BINANCE_EARLIEST_DATE = "2017-01-01"

# Every kline interval we load for a coin when refreshing its data. Quote asset is
# always USDT (see refresh endpoints).
STANDARD_INTERVALS = ["5m", "15m", "30m", "1h", "4h", "1d", "1w", "1M"]


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


async def fetch_earliest_listing_date(symbol: str) -> str | None:
    """Return the ISO date (YYYY-MM-DD) of a pair's first-ever daily bar, or None.

    Binance has no listing-date endpoint, but ``/klines`` with ``startTime=0``
    returns the earliest available bars. Used to floor a back-fill: coins listed
    after 2017 otherwise request (and 404 on) dozens of pre-listing monthly
    archives. Returns None on any failure so callers fall back to the 2017 floor.
    """
    from crypto_ai.config import get_settings

    base = get_settings().binance_rest_base.rstrip("/")
    params = {"symbol": symbol, "interval": "1d", "startTime": 0, "limit": 1}
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(f"{base}/api/v3/klines", params=params, timeout=30.0)
            resp.raise_for_status()
            rows = resp.json()
    except Exception:
        return None
    if not rows:
        return None
    return _binance_ts_to_datetime(rows[0][0]).date().isoformat()


class BinanceImportService:
    """Service for importing Binance kline data."""

    def __init__(self, session: AsyncSession):
        self.session = session

    async def insert_klines(self, klines: list[KlineCreate]) -> int:
        """Insert klines, skipping bars already present (idempotent re-imports).

        Uses ON CONFLICT DO NOTHING against the unique
        (coin_id, quote_asset, interval, open_time) index so overlapping import
        ranges can't create duplicate bars. Returns the number actually inserted.
        """
        if not klines:
            return 0
        from sqlalchemy.dialects.postgresql import insert as pg_insert

        # Insert in chunks: asyncpg caps a statement at 32767 bind params. Each row
        # binds ~18 (14 explicit fields + the id/active/created_at/updated_at
        # Python-side defaults Core evaluates per row), so a monthly 5m archive
        # (~8600 rows) would overflow. 1000 rows/chunk (~18k params) stays safe
        # with margin regardless of interval or archive span.
        batch_size = 1000
        total = 0
        for start in range(0, len(klines), batch_size):
            chunk = klines[start : start + batch_size]
            stmt = pg_insert(Kline).values([k.model_dump() for k in chunk])
            stmt = stmt.on_conflict_do_nothing(
                index_elements=["coin_id", "quote_asset", "interval", "open_time"]
            )
            result = await self.session.execute(stmt)
            total += result.rowcount or 0
        return total

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
        # symbol/interval are interpolated into the fetched URL path — reject
        # anything that isn't a plain Binance symbol/interval token.
        if not re.fullmatch(r"[A-Z0-9]{1,20}", symbol):
            raise ValueError(f"Invalid Binance symbol: {symbol!r}")
        if not re.fullmatch(r"\d{1,3}(m|h|d|w|mo|M)", interval):
            raise ValueError(f"Invalid Binance interval: {interval!r}")

        # Determine date range
        if not (start_date and end_date):
            # Default: import last 30 days
            from datetime import timedelta

            end = datetime.now().date()
            start = end - timedelta(days=30)
            start_date, end_date = start.isoformat(), end.isoformat()

        # Fetch complete past months as monthly archives and the trailing month as
        # daily files. A full-history load is then dozens of requests, not thousands.
        targets = self._build_import_urls(symbol, interval, start_date, end_date)

        total_imported = 0
        total_files = len(targets)
        failed: list[tuple[str, str]] = []

        async with httpx.AsyncClient() as client:
            for idx, (url, label) in enumerate(targets):
                try:
                    yield (total_imported, total_files, f"Downloading {label}...")

                    # Download file
                    response = await client.get(url, timeout=60.0)
                    if response.status_code != 200:
                        yield (
                            total_imported,
                            total_files,
                            f"Skipped {label}: File not found (404)",
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

                    inserted = await self.insert_klines(klines)
                    total_imported += inserted

                    skipped = len(klines) - inserted
                    yield (
                        total_imported,
                        total_files,
                        f"Imported {label}: {inserted} klines"
                        + (f" ({skipped} already present)" if skipped else ""),
                    )

                except Exception as e:
                    # Missing archives (404 above) are expected before a coin was
                    # listed; anything else is a real failure. Don't swallow it — a
                    # silently skipped file leaves a gap the simulations treat as
                    # adjacent bars. Cap the message: some driver errors embed the
                    # whole failed SQL, which would overflow the varchar progress
                    # column and mask the real error.
                    err = str(e).splitlines()[0][:200]
                    failed.append((label, err))
                    yield (
                        total_imported,
                        total_files,
                        f"Error on {label}: {err}",
                    )

        if failed:
            preview = "; ".join(f"{d}: {err}" for d, err in failed[:3])[:400]
            raise RuntimeError(
                f"Import failed for {len(failed)} of {total_files} files "
                f"({total_imported} klines imported before failing). First errors: {preview}"
            )

    def _build_import_urls(
        self, symbol: str, interval: str, start_date: str, end_date: str
    ) -> list[tuple[str, str]]:
        """Build (url, label) pairs covering [start_date, end_date] inclusive.

        Complete months strictly before the end date's month are fetched as monthly
        archives; the end month (which may still be open — Binance only publishes a
        monthly file once the month closes) is fetched as daily files. Overlapping
        bars are skipped on insert, so pulling a whole first/last month is harmless.
        """
        from datetime import timedelta

        start = date.fromisoformat(start_date)
        end = date.fromisoformat(end_date)
        urls: list[tuple[str, str]] = []

        # Monthly archives for every full month up to (but excluding) the end month.
        y, m = start.year, start.month
        while (y, m) < (end.year, end.month):
            label = f"{y:04d}-{m:02d}"
            urls.append(
                (
                    f"{BINANCE_MONTHLY_BASE_URL}/{symbol}/{interval}/{symbol}-{interval}-{label}.zip",
                    label,
                )
            )
            m += 1
            if m > 12:
                m, y = 1, y + 1

        # Daily files for the end month (partial/current month).
        day = max(start, date(end.year, end.month, 1))
        while day <= end:
            label = day.isoformat()
            urls.append(
                (
                    f"{BINANCE_BASE_URL}/{symbol}/{interval}/{symbol}-{interval}-{label}.zip",
                    label,
                )
            )
            day += timedelta(days=1)

        return urls

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
