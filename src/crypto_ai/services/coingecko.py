"""Client for CoinGecko coin metadata (categories).

The public API works without a key; a Demo API key just raises the rate limit
(~30 calls/min). We use it to tag coins with categories like "Layer 1", "DeFi",
"Meme", "Stablecoins" — a coin usually belongs to several at once.

Resolving our (symbol, name) to a CoinGecko id is the tricky part: symbols
collide heavily (dozens of coins share "UNI"), so on a collision we break the
tie by market-cap rank, preferring the most prominent coin.
"""

import asyncio

import httpx

COINGECKO_BASE = "https://api.coingecko.com/api/v3"


class CoinGeckoService:
    """Thin async wrapper over the CoinGecko REST API."""

    def __init__(self, api_key: str | None = None):
        self.api_key = api_key
        self._headers = {"x-cg-demo-api-key": api_key} if api_key else {}

    async def _get(
        self, client: httpx.AsyncClient, path: str, params: dict | None = None, retries: int = 4
    ):
        """GET with backoff on 429 (CoinGecko's keyless tier is only a few calls/min)."""
        for attempt in range(retries + 1):
            resp = await client.get(
                f"{COINGECKO_BASE}{path}", params=params, headers=self._headers, timeout=30.0
            )
            if resp.status_code == 429 and attempt < retries:
                wait = float(resp.headers.get("retry-after", 15))
                await asyncio.sleep(min(max(wait, 5.0), 60.0))
                continue
            resp.raise_for_status()
            return resp.json()

    async def fetch_coin_list(self, client: httpx.AsyncClient) -> list[dict]:
        """All CoinGecko coins as [{id, symbol, name}, ...]."""
        return await self._get(client, "/coins/list")

    async def fetch_categories(self, client: httpx.AsyncClient, gecko_id: str) -> list[str]:
        """Category tags for a CoinGecko coin id (empty list if none)."""
        data = await self._get(
            client,
            f"/coins/{gecko_id}",
            params={
                "localization": "false",
                "tickers": "false",
                "market_data": "false",
                "community_data": "false",
                "developer_data": "false",
                "sparkline": "false",
            },
        )
        return [c for c in (data.get("categories") or []) if c]

    async def resolve_gecko_id(
        self,
        client: httpx.AsyncClient,
        symbol: str,
        name: str,
        listing: list[dict],
    ) -> str | None:
        """Best CoinGecko id for our (symbol, name), or None if unmatched.

        Prefers an exact name match; on a remaining tie, picks the coin with the
        best (lowest) market-cap rank so we don't tag against an obscure clone.
        """
        sym = symbol.lower()
        candidates = [c for c in listing if c.get("symbol", "").lower() == sym]
        if not candidates:
            return None
        if len(candidates) == 1:
            return candidates[0]["id"]

        nm = name.lower()
        exact = [c for c in candidates if c.get("name", "").lower() == nm]
        if len(exact) == 1:
            return exact[0]["id"]

        pool = exact or candidates
        ids = ",".join(c["id"] for c in pool[:100])
        try:
            markets = await self._get(
                client,
                "/coins/markets",
                params={"vs_currency": "usd", "ids": ids, "per_page": 100, "page": 1},
            )
        except httpx.HTTPError:
            markets = []
        ranked = sorted(
            (m for m in markets if m.get("market_cap_rank")),
            key=lambda m: m["market_cap_rank"],
        )
        if ranked:
            return ranked[0]["id"]
        return pool[0]["id"]
