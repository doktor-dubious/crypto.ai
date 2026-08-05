"""Signed Binance Spot REST client for live order execution.

Defaults to the Spot TESTNET (https://testnet.binance.vision). The API surface
is identical to production — switching `binance_trade_rest_base` to
https://api.binance.com (with production keys) is the only change needed to go
live for real.

Only the small surface live trading needs is wrapped: account balances,
exchange filters, market orders, open orders, and order lookup. Requests are
signed per Binance's HMAC-SHA256 scheme: the full query string plus a
`timestamp` (and `recvWindow`) is signed with the API secret and appended as
`signature`; the key travels in the `X-MBX-APIKEY` header.
"""

from __future__ import annotations

import hashlib
import hmac
import time
from decimal import ROUND_DOWN, Decimal
from typing import Any
from urllib.parse import urlencode

import httpx

from crypto_ai.config import get_settings


class BinanceTradeError(Exception):
    """A trading request was rejected by Binance or could not be sent."""

    def __init__(self, message: str, code: int | None = None, status: int | None = None):
        super().__init__(message)
        self.code = code  # Binance error code, e.g. -2010 insufficient balance
        self.status = status  # HTTP status


class BinanceTradeNotConfiguredError(BinanceTradeError):
    """API key/secret are missing from settings."""

    def __init__(self) -> None:
        super().__init__(
            "Binance trading API key/secret not configured "
            "(set BINANCE_TRADE_API_KEY / BINANCE_TRADE_API_SECRET)"
        )


class SymbolFilters:
    """The subset of exchange filters needed to size a valid order."""

    def __init__(self, symbol: str, data: dict[str, Any]):
        self.symbol = symbol
        self.base_asset: str = data["baseAsset"]
        self.quote_asset: str = data["quoteAsset"]
        self.step_size = Decimal("0")
        self.min_qty = Decimal("0")
        self.tick_size = Decimal("0")
        self.min_notional = Decimal("0")
        for f in data.get("filters", []):
            ftype = f.get("filterType")
            if ftype == "LOT_SIZE":
                self.step_size = Decimal(f["stepSize"])
                self.min_qty = Decimal(f["minQty"])
            elif ftype == "PRICE_FILTER":
                self.tick_size = Decimal(f["tickSize"])
            elif ftype in ("NOTIONAL", "MIN_NOTIONAL"):
                self.min_notional = Decimal(f.get("minNotional", "0"))

    def round_qty(self, qty: Decimal) -> Decimal:
        """Round a quantity DOWN to the symbol's lot-size step."""
        if self.step_size <= 0:
            return qty
        return (qty / self.step_size).to_integral_value(rounding=ROUND_DOWN) * self.step_size

    def validate_order(self, qty: Decimal, price: Decimal) -> str | None:
        """Return a rejection reason if (qty, price) violates the filters."""
        if qty <= 0:
            return "quantity rounds to zero at symbol lot size"
        if qty < self.min_qty:
            return f"quantity {qty} below minQty {self.min_qty}"
        if self.min_notional > 0 and qty * price < self.min_notional:
            return f"notional {qty * price:.2f} below minNotional {self.min_notional}"
        return None


TESTNET_BASE = "https://testnet.binance.vision"
LIVE_BASE = "https://api.binance.com"


class BinanceTradeClient:
    """Async signed client against one Binance Spot venue.

    ``testnet`` pins the venue explicitly — that is how a run created as
    "Binance Live" keeps being stepped against production while a testnet run
    beside it is stepped against the testnet. Omitting it falls back to whatever
    ``binance_trade_rest_base`` points at, which is the pre-per-run behaviour.

    Credentials resolve per venue: the venue's own key pair if configured, else
    the legacy single pair — but only when the legacy base points at this same
    venue, so testnet keys can never be sent to production.
    """

    def __init__(self, testnet: bool | None = None) -> None:
        settings = get_settings()
        legacy_base = settings.binance_trade_rest_base.rstrip("/")
        legacy_is_testnet = "testnet" in legacy_base

        if testnet is None:
            self._base = legacy_base
            self._api_key = settings.binance_trade_api_key
            self._api_secret = settings.binance_trade_api_secret
        else:
            self._base = TESTNET_BASE if testnet else LIVE_BASE
            if testnet:
                key = settings.binance_trade_testnet_api_key
                secret = settings.binance_trade_testnet_api_secret
            else:
                key = settings.binance_trade_live_api_key
                secret = settings.binance_trade_live_api_secret
            if not (key and secret) and legacy_is_testnet == testnet:
                key = settings.binance_trade_api_key
                secret = settings.binance_trade_api_secret
            self._api_key = key
            self._api_secret = secret

        self._recv_window = settings.binance_trade_recv_window_ms
        # Filters change rarely; cache per-process for the run's lifetime.
        self._filters_cache: dict[str, SymbolFilters] = {}

    @staticmethod
    def venue_configured(testnet: bool) -> bool:
        """Whether this venue has usable credentials — drives which targets the
        Strategies page offers, so "Binance Live" is never offered as a button
        that can only fail."""
        return BinanceTradeClient(testnet=testnet).is_configured

    @property
    def is_configured(self) -> bool:
        return bool(self._api_key and self._api_secret)

    @property
    def is_testnet(self) -> bool:
        return "testnet" in self._base

    def _sign(self, params: dict[str, Any]) -> str:
        query = urlencode(params)
        assert self._api_secret is not None
        sig = hmac.new(
            self._api_secret.encode(), query.encode(), hashlib.sha256
        ).hexdigest()
        return f"{query}&signature={sig}"

    async def _request(
        self,
        method: str,
        path: str,
        params: dict[str, Any] | None = None,
        signed: bool = True,
    ) -> Any:
        params = {k: v for k, v in (params or {}).items() if v is not None}
        headers = {}
        url = f"{self._base}{path}"
        if signed:
            if not self.is_configured:
                raise BinanceTradeNotConfiguredError()
            params["timestamp"] = int(time.time() * 1000)
            params["recvWindow"] = self._recv_window
            query = self._sign(params)
            headers["X-MBX-APIKEY"] = self._api_key
            url = f"{url}?{query}"
            params = None
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                res = await client.request(method, url, params=params, headers=headers)
        except httpx.HTTPError as exc:
            raise BinanceTradeError(f"Binance request failed: {exc}") from exc
        if res.status_code >= 400:
            code = None
            msg = res.text
            try:
                body = res.json()
                code = body.get("code")
                msg = body.get("msg", msg)
            except ValueError:
                pass
            raise BinanceTradeError(
                f"Binance {method} {path} -> {res.status_code}: {msg}",
                code=code,
                status=res.status_code,
            )
        return res.json()

    # ── Account ──────────────────────────────────────────────────────────

    async def ping(self) -> bool:
        """Connectivity check (unsigned)."""
        await self._request("GET", "/api/v3/ping", signed=False)
        return True

    async def account(self) -> dict[str, Any]:
        """Account info incl. balances and trade permissions."""
        return await self._request("GET", "/api/v3/account", {"omitZeroBalances": "true"})

    async def balances(self) -> dict[str, Decimal]:
        """Free balances by asset (non-zero only)."""
        acct = await self.account()
        return {
            b["asset"]: Decimal(b["free"])
            for b in acct.get("balances", [])
            if Decimal(b["free"]) > 0
        }

    # ── Exchange info / filters ──────────────────────────────────────────

    async def symbol_filters(self, symbol: str) -> SymbolFilters:
        symbol = symbol.upper()
        cached = self._filters_cache.get(symbol)
        if cached is not None:
            return cached
        data = await self._request(
            "GET", "/api/v3/exchangeInfo", {"symbol": symbol}, signed=False
        )
        symbols = data.get("symbols") or []
        if not symbols:
            raise BinanceTradeError(f"symbol {symbol} not found on exchange")
        filters = SymbolFilters(symbol, symbols[0])
        self._filters_cache[symbol] = filters
        return filters

    # ── Orders ───────────────────────────────────────────────────────────

    async def market_order(
        self,
        symbol: str,
        side: str,  # "BUY" | "SELL"
        quantity: Decimal | None = None,
        quote_qty: Decimal | None = None,
        client_order_id: str | None = None,
    ) -> dict[str, Any]:
        """Place a MARKET order; returns the fill response.

        Size with exactly one of ``quantity`` (base asset — required for sells,
        must respect the lot-size step) or ``quote_qty`` (quote asset — the
        natural way to BUY with a budget; Binance handles the lot rounding).
        Uses newOrderRespType=FULL so the response includes the actual fills
        (price + commission) needed to record the real execution.
        """
        if (quantity is None) == (quote_qty is None):
            raise ValueError("market_order needs exactly one of quantity / quote_qty")
        return await self._request(
            "POST",
            "/api/v3/order",
            {
                "symbol": symbol.upper(),
                "side": side.upper(),
                "type": "MARKET",
                "quantity": format(quantity, "f") if quantity is not None else None,
                "quoteOrderQty": format(quote_qty, "f") if quote_qty is not None else None,
                "newClientOrderId": client_order_id,
                "newOrderRespType": "FULL",
            },
        )

    async def get_order(self, symbol: str, order_id: int) -> dict[str, Any]:
        return await self._request(
            "GET", "/api/v3/order", {"symbol": symbol.upper(), "orderId": order_id}
        )

    async def open_orders(self, symbol: str | None = None) -> list[dict[str, Any]]:
        return await self._request(
            "GET", "/api/v3/openOrders", {"symbol": symbol.upper() if symbol else None}
        )


def parse_fill(
    order_response: dict[str, Any], base_asset: str, quote_asset: str = "USDT"
) -> dict[str, Decimal]:
    """Digest a FULL order response into what the execution ledger records.

    Returns ``{qty, price, quote_qty, commission_base, commission_quote}``:
    executed base quantity, average fill price, total quote turned over, and
    commissions split by the asset they were charged in (Binance takes buy
    commission from the received base asset, sell commission from the received
    quote; anything else — e.g. BNB discounts — lands in neither bucket).
    """
    executed = Decimal(order_response.get("executedQty", "0"))
    cum_quote = Decimal(order_response.get("cummulativeQuoteQty", "0"))
    fills = order_response.get("fills") or []
    if executed > 0 and fills:
        notional = sum(Decimal(f["price"]) * Decimal(f["qty"]) for f in fills)
        avg_price = notional / executed
    else:
        avg_price = cum_quote / executed if executed > 0 else Decimal("0")
    commission_base = Decimal("0")
    commission_quote = Decimal("0")
    for f in fills:
        c = Decimal(f.get("commission", "0"))
        asset = f.get("commissionAsset", "")
        if asset == base_asset:
            commission_base += c
        elif asset == quote_asset:
            commission_quote += c
    return {
        "qty": executed,
        "price": avg_price,
        "quote_qty": cum_quote,
        "commission_base": commission_base,
        "commission_quote": commission_quote,
    }
