"""Continuous live ingestion of Binance klines for paper/live trading.

The batch importer (``binance_import``) pulls historical archives, which Binance
only publishes with a lag — useless for a strategy that must act on the latest
closed bar. This service keeps the ``klines`` table current in real time.

Two modes (``settings.live_ingest_mode``):

- ``ws`` (default, production): subscribe to Binance combined kline streams over
  WebSocket and upsert each candle the moment it closes (``k.x == true``). Zero
  polling, sub-second latency. Requires ``stream.binance.com`` reachability.
- ``poll``: periodically pull the last few bars per pair from the REST mirror and
  upsert the closed ones. Higher latency and load, but works on networks where the
  WS host is blocked/intercepted while ``data-api.binance.vision`` is not.

Both paths store **only closed bars** and reuse ``BinanceImportService.insert_klines``
(ON CONFLICT DO NOTHING), so they're idempotent and never freeze a partial candle.
On every (re)connect the WS path first gap-fills via REST so a disconnect (Binance
force-closes streams every ~24h) leaves no hole.

Run it as a standalone process:

    uv run python -m crypto_ai.live_ingest_main

Only the REST path is reachable from networks that intercept Binance's WS/API
hosts; set ``LIVE_INGEST_MODE=poll`` there to validate the full pipeline.
"""

import asyncio
import json
import time

import httpx
import structlog
import websockets
from sqlalchemy import and_, func, select

from crypto_ai.config import get_settings
from crypto_ai.database.connection import async_session_factory
from crypto_ai.database.models.coin import Coin
from crypto_ai.database.models.kline import Kline
from crypto_ai.schemas.kline import KlineCreate
from crypto_ai.services.binance_import import (
    BinanceImportService,
    _binance_ts_to_datetime,
)

log = structlog.get_logger()

QUOTE_ASSET = "USDT"
# Binance allows at most 1024 streams per combined connection; stay under it.
MAX_STREAMS_PER_CONN = 1000
# Cap the paging on a single gap-fill so a brand-new/long-idle pair can't spin
# forever (20 * 1000 bars ≈ 2 weeks of 1m data before we defer to the next pass).
MAX_GAPFILL_PAGES = 20
# How often the WS mode re-checks the active-coin set and rebuilds its stream
# connections when it changed. (Poll mode refreshes every sweep instead — a
# sweep already takes minutes over hundreds of pairs, so one extra cheap query
# per sweep is noise.) Without this, coins activated after startup were never
# ingested until the container was manually restarted.
SYMBOL_REFRESH_SECONDS = 300.0

# Redis key the ingester publishes its live status/stats to; the control API and
# Workers-page card read it. Written with a short TTL so it disappears when the
# process dies (→ the API reports the container as not-streaming).
STATUS_REDIS_KEY = "live_ingest:status"
STATUS_TTL_SECONDS = 20
STATUS_PUBLISH_INTERVAL = 5.0


class LiveIngestService:
    """Keeps the klines table current from Binance, over WebSocket or REST poll."""

    def __init__(self) -> None:
        s = get_settings()
        self.rest_base = s.binance_rest_base.rstrip("/")
        self.ws_base = s.binance_ws_base.rstrip("/")
        self.mode = s.live_ingest_mode.lower().strip()
        self.intervals = [i.strip() for i in s.live_ingest_intervals.split(",") if i.strip()]
        self.poll_seconds = max(1, s.live_ingest_poll_seconds)
        self.redis_url = s.redis_url

        # Live stats, snapshotted to Redis by the heartbeat loop. Mutated only from
        # the single asyncio loop, so no locking is needed.
        self._started_ms: int = 0
        self._coins: int = 0
        self._streams: int = 0
        self._conns_total: int = 0
        self._conns_up: int = 0
        self._bars_session: int = 0
        # interval -> {"bars": int, "last_bar_ms": int | None}
        self._per_interval: dict[str, dict] = {}
        self._last_error: str | None = None
        self._last_error_ms: int | None = None

    # ------------------------------------------------------------------ helpers

    async def _symbol_map(self) -> dict[str, str]:
        """Binance symbol (e.g. BTCUSDT) -> coin_id, for every active coin."""
        async with async_session_factory() as session:
            coins = (
                await session.execute(select(Coin).where(Coin.active.is_(True)))
            ).scalars().all()
        return {f"{c.symbol.upper()}{QUOTE_ASSET}": c.id for c in coins}

    async def _last_open_ms(self, coin_id: str, interval: str) -> int | None:
        """open_time (ms) of the latest stored bar for a pair, or None if empty."""
        async with async_session_factory() as session:
            hi = (
                await session.execute(
                    select(func.max(Kline.open_time)).where(
                        and_(
                            Kline.coin_id == coin_id,
                            Kline.quote_asset == QUOTE_ASSET,
                            Kline.interval == interval,
                            Kline.active.is_(True),
                        )
                    )
                )
            ).scalar()
        return int(hi.timestamp() * 1000) if hi else None

    async def _upsert(self, klines: list[KlineCreate]) -> int:
        if not klines:
            return 0
        async with async_session_factory() as session:
            inserted = await BinanceImportService(session).insert_klines(klines)
            await session.commit()
        return inserted

    # -------------------------------------------------------------------- stats

    def _record_bars(self, interval: str, inserted: int, last_bar_ms: int | None) -> None:
        """Fold a batch of ingested bars into the live stats for this interval."""
        pi = self._per_interval.setdefault(interval, {"bars": 0, "last_bar_ms": None})
        if inserted > 0:
            self._bars_session += inserted
            pi["bars"] += inserted
        if last_bar_ms is not None and (
            pi["last_bar_ms"] is None or last_bar_ms > pi["last_bar_ms"]
        ):
            pi["last_bar_ms"] = last_bar_ms

    def _note_error(self, message: str) -> None:
        self._last_error = message[:300]
        self._last_error_ms = int(time.time() * 1000)

    def _snapshot(self) -> dict:
        return {
            "mode": self.mode,
            "started_ms": self._started_ms,
            "heartbeat_ms": int(time.time() * 1000),
            "coins": self._coins,
            "intervals": self.intervals,
            "streams": self._streams,
            "connections_total": self._conns_total,
            "connections_up": self._conns_up,
            "bars_session": self._bars_session,
            "per_interval": [
                {
                    "interval": iv,
                    "bars": d["bars"],
                    "last_bar_ms": d["last_bar_ms"],
                }
                for iv, d in sorted(self._per_interval.items())
            ],
            "last_error": self._last_error,
            "last_error_ms": self._last_error_ms,
        }

    def _write_status(self, snapshot: dict) -> None:
        """Blocking Redis write — always call via asyncio.to_thread."""
        import json

        import redis

        client = redis.Redis.from_url(self.redis_url)
        client.set(STATUS_REDIS_KEY, json.dumps(snapshot), ex=STATUS_TTL_SECONDS)

    async def _publish_loop(self) -> None:
        while True:
            try:
                await asyncio.to_thread(self._write_status, self._snapshot())
            except Exception as exc:  # never let stats publishing kill ingestion
                log.warning("live ingest stats publish failed", error=str(exc))
            await asyncio.sleep(STATUS_PUBLISH_INTERVAL)

    def _kline_from_rest_row(self, row: list, coin_id: str, interval: str) -> KlineCreate:
        """Map a REST /klines array row (same column order as the CSV archives)."""
        return KlineCreate(
            coin_id=coin_id,
            quote_asset=QUOTE_ASSET,
            interval=interval,
            open_time=_binance_ts_to_datetime(row[0]),
            close_time=_binance_ts_to_datetime(row[6]),
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

    def _kline_from_ws_candle(self, k: dict, coin_id: str) -> KlineCreate:
        """Map a WS kline payload (the ``k`` object of a kline event)."""
        return KlineCreate(
            coin_id=coin_id,
            quote_asset=QUOTE_ASSET,
            interval=k["i"],
            open_time=_binance_ts_to_datetime(k["t"]),
            close_time=_binance_ts_to_datetime(k["T"]),
            open=float(k["o"]),
            high=float(k["h"]),
            low=float(k["l"]),
            close=float(k["c"]),
            volume=float(k["v"]),
            quote_asset_volume=float(k["q"]),
            number_of_trades=int(k["n"]),
            taker_buy_base_asset_volume=float(k["V"]),
            taker_buy_quote_asset_volume=float(k["Q"]),
        )

    async def _fetch_rest(
        self, client: httpx.AsyncClient, symbol: str, interval: str, start_ms: int | None
    ) -> list[list]:
        params: dict = {"symbol": symbol, "interval": interval, "limit": 1000}
        if start_ms is not None:
            params["startTime"] = start_ms
        resp = await client.get(f"{self.rest_base}/api/v3/klines", params=params, timeout=30.0)
        resp.raise_for_status()
        return resp.json()

    async def _gap_fill(
        self, client: httpx.AsyncClient, symbol: str, interval: str, coin_id: str
    ) -> int:
        """Pull every closed bar newer than what we have, upsert it. Returns count.

        Fetches from just after the latest stored bar (or the mirror's default
        window when the pair is empty), pages forward, and drops the still-forming
        candle (closeTime in the future) so a partial bar is never frozen by the
        DO-NOTHING upsert.
        """
        last = await self._last_open_ms(coin_id, interval)
        start_ms = last + 1 if last is not None else None
        now_ms = int(time.time() * 1000)
        inserted = 0
        last_bar_ms: int | None = None
        for _ in range(MAX_GAPFILL_PAGES):
            rows = await self._fetch_rest(client, symbol, interval, start_ms)
            if not rows:
                break
            closed = [r for r in rows if int(r[6]) < now_ms]
            if closed:
                last_bar_ms = int(
                    _binance_ts_to_datetime(closed[-1][0]).timestamp() * 1000
                )
            inserted += await self._upsert(
                [self._kline_from_rest_row(r, coin_id, interval) for r in closed]
            )
            if len(rows) < 1000:
                break
            start_ms = int(rows[-1][0]) + 1
        self._record_bars(interval, inserted, last_bar_ms)
        return inserted

    # --------------------------------------------------------------------- poll

    async def _run_poll(self, symbol_map: dict[str, str]) -> None:
        self._conns_total = 1
        self._conns_up = 1  # the REST client is "up" for the duration of the loop
        log.info(
            "live ingest poll loop", coins=len(symbol_map), every_s=self.poll_seconds
        )
        async with httpx.AsyncClient() as client:
            while True:
                pairs = [
                    (sym, iv, cid)
                    for sym, cid in symbol_map.items()
                    for iv in self.intervals
                ]
                self._streams = len(pairs)
                total = 0
                for sym, iv, cid in pairs:
                    try:
                        total += await self._gap_fill(client, sym, iv, cid)
                    except Exception as exc:  # one bad pair must not stall the sweep
                        self._note_error(f"{sym} {iv}: {exc}")
                        log.warning(
                            "poll pair failed", symbol=sym, interval=iv, error=str(exc)
                        )
                if total:
                    log.info("poll sweep upserted", bars=total)
                await asyncio.sleep(self.poll_seconds)
                # Pick up coins activated (or deactivated) since the last sweep —
                # new pairs join the next sweep and gap-fill from their newest
                # stored bar automatically.
                try:
                    new_map = await self._symbol_map()
                except Exception as exc:  # DB hiccup: keep sweeping the old set
                    self._note_error(f"symbol refresh: {exc}")
                    continue
                if set(new_map) != set(symbol_map):
                    log.info(
                        "live ingest: coin set changed",
                        before=len(symbol_map), after=len(new_map),
                    )
                symbol_map = new_map
                self._coins = len(symbol_map)

    # ----------------------------------------------------------------------- ws

    async def _run_ws(self, symbol_map: dict[str, str]) -> None:
        """Hold the stream connections open, rebuilding them whenever the
        active-coin set changes (checked every SYMBOL_REFRESH_SECONDS) so coins
        added after startup start streaming without a container restart. A
        rebuild reconnects, and every (re)connect gap-fills first, so no bars
        are lost across the swap."""
        while True:
            streams = [
                f"{sym.lower()}@kline_{iv}"
                for sym in symbol_map
                for iv in self.intervals
            ]
            chunks = [
                streams[i : i + MAX_STREAMS_PER_CONN]
                for i in range(0, len(streams), MAX_STREAMS_PER_CONN)
            ]
            self._streams = len(streams)
            self._conns_total = len(chunks)
            log.info(
                "live ingest ws", streams=len(streams), connections=len(chunks),
                intervals=self.intervals,
            )
            conn_tasks = [
                asyncio.create_task(self._ws_connection(chunk, symbol_map))
                for chunk in chunks
            ]
            try:
                while True:
                    await asyncio.sleep(SYMBOL_REFRESH_SECONDS)
                    try:
                        new_map = await self._symbol_map()
                    except Exception as exc:  # DB hiccup: keep current streams
                        self._note_error(f"symbol refresh: {exc}")
                        continue
                    if set(new_map) != set(symbol_map):
                        log.info(
                            "live ingest: coin set changed; rebuilding streams",
                            before=len(symbol_map), after=len(new_map),
                        )
                        symbol_map = new_map
                        self._coins = len(symbol_map)
                        break  # tear down and rebuild connections below
            finally:
                for t in conn_tasks:
                    t.cancel()
                await asyncio.gather(*conn_tasks, return_exceptions=True)
                self._conns_up = 0

    async def _ws_connection(
        self, streams: list[str], symbol_map: dict[str, str]
    ) -> None:
        url = f"{self.ws_base}/stream?streams={'/'.join(streams)}"
        # Symbols carried by this connection, for the on-connect gap-fill.
        conn_symbols = sorted({s.split("@", 1)[0].upper() for s in streams})
        backoff = 1.0
        while True:
            try:
                async with websockets.connect(
                    url, ping_interval=180, ping_timeout=60, max_size=2**22
                ) as ws:
                    log.info("ws connected", streams=len(streams))
                    self._conns_up += 1
                    try:
                        await self._gap_fill_symbols(conn_symbols, symbol_map)
                        backoff = 1.0
                        async for raw in ws:
                            await self._handle_ws_message(raw, symbol_map)
                    finally:
                        self._conns_up = max(0, self._conns_up - 1)
            except Exception as exc:
                self._note_error(str(exc))
                log.warning("ws disconnected; reconnecting", error=str(exc), backoff=backoff)
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 30.0)

    async def _gap_fill_symbols(
        self, symbols: list[str], symbol_map: dict[str, str]
    ) -> None:
        """REST gap-fill for the given symbols across all intervals (on connect)."""
        async with httpx.AsyncClient() as client:
            for sym in symbols:
                coin_id = symbol_map.get(sym)
                if not coin_id:
                    continue
                for iv in self.intervals:
                    try:
                        await self._gap_fill(client, sym, iv, coin_id)
                    except Exception as exc:
                        log.warning(
                            "gap-fill failed", symbol=sym, interval=iv, error=str(exc)
                        )

    async def _handle_ws_message(self, raw: str | bytes, symbol_map: dict[str, str]) -> None:
        try:
            msg = json.loads(raw)
        except (ValueError, TypeError):
            return
        data = msg.get("data", msg)  # combined stream wraps payloads under "data"
        k = data.get("k")
        if not k or not k.get("x"):  # only fully-closed candles
            return
        coin_id = symbol_map.get(data.get("s", "").upper())
        if not coin_id:
            return
        inserted = await self._upsert([self._kline_from_ws_candle(k, coin_id)])
        last_bar_ms = int(_binance_ts_to_datetime(k["t"]).timestamp() * 1000)
        self._record_bars(k["i"], inserted, last_bar_ms)

    # --------------------------------------------------------------------- entry

    async def run(self) -> None:
        symbol_map = await self._symbol_map()
        if not symbol_map:
            log.warning("live ingest: no active coins to stream; exiting")
            return
        self._started_ms = int(time.time() * 1000)
        self._coins = len(symbol_map)
        log.info(
            "live ingest starting",
            mode=self.mode, coins=len(symbol_map), intervals=self.intervals,
        )
        publisher = asyncio.create_task(self._publish_loop())
        try:
            if self.mode == "poll":
                await self._run_poll(symbol_map)
            else:
                await self._run_ws(symbol_map)
        finally:
            publisher.cancel()
