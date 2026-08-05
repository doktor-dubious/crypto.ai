"""Determine which Binance markets (spot / USDⓈ-M perpetual) list a coin.

This drives the fee models a trading strategy may pick: a spot-taker cost only
makes sense with a spot market, and futures maker/taker costs only with a
perpetual contract.

Sources:
  * Spot — Binance's public spot ``exchangeInfo`` (the vision mirror the kline
    importer already uses; the main futures REST hosts are network-blocked from
    this deployment).
  * Futures — CoinGecko's ``binance_futures`` derivatives listing, because the
    Binance futures REST API is unreachable here. Binance lists many perps under
    a price-scaled symbol (e.g. ``1000PEPE``, ``1000000BOB``, ``1MBABYDOGE``), so
    the underlying base is also recovered by stripping the scale prefix.

Any source that fails to fetch yields ``None`` for that market, meaning "unknown"
— callers must leave the existing flag untouched rather than assume "not listed".
"""

import httpx

SPOT_URL = "https://data-api.binance.vision/api/v3/exchangeInfo"
FUTURES_URL = "https://api.coingecko.com/api/v3/derivatives/exchanges/binance_futures"

# Longest first so "1000000BOB" strips the 1e6 prefix, not "1000".
_SCALE_PREFIXES = ("1000000", "100000", "10000", "1000", "1M")


def _descale(base: str) -> str:
    """Recover the underlying base of a price-scaled perp symbol (1000PEPE→PEPE)."""
    for p in _SCALE_PREFIXES:
        if base.startswith(p) and len(base) > len(p):
            return base[len(p):]
    return base


class MarketSets:
    """Resolved base-asset sets for each market. A ``None`` set means the source
    was unavailable (flag should be left unchanged), an empty match means "no"."""

    def __init__(self, spot: set[str] | None, futures: set[str] | None) -> None:
        self.spot = spot
        self.futures = futures

    def spot_flag(self, symbol: str) -> bool | None:
        return None if self.spot is None else symbol.upper() in self.spot

    def futures_flag(self, symbol: str) -> bool | None:
        return None if self.futures is None else symbol.upper() in self.futures


class MarketAvailabilityService:
    """Fetch Binance spot + perpetual base-asset sets for a given quote asset."""

    def __init__(self, quote_asset: str = "USDT") -> None:
        self.quote_asset = quote_asset.upper()

    async def fetch(self, client: httpx.AsyncClient) -> MarketSets:
        return MarketSets(
            await self._fetch_spot(client),
            await self._fetch_futures(client),
        )

    async def _fetch_spot(self, client: httpx.AsyncClient) -> set[str] | None:
        try:
            resp = await client.get(SPOT_URL, timeout=30.0)
            resp.raise_for_status()
            data = resp.json()
        except (httpx.HTTPError, ValueError):
            return None
        bases = {
            s["baseAsset"].upper()
            for s in data.get("symbols", [])
            if s.get("quoteAsset") == self.quote_asset and s.get("status") == "TRADING"
        }
        return bases or None

    async def _fetch_futures(self, client: httpx.AsyncClient) -> set[str] | None:
        try:
            resp = await client.get(
                FUTURES_URL, params={"include_tickers": "all"}, timeout=40.0
            )
            resp.raise_for_status()
            data = resp.json()
        except (httpx.HTTPError, ValueError):
            return None
        bases: set[str] = set()
        for t in data.get("tickers", []):
            if t.get("contract_type") != "perpetual" or t.get("target") != self.quote_asset:
                continue
            base = (t.get("base") or "").upper()
            if base:
                bases.add(base)
                bases.add(_descale(base))
        return bases or None
