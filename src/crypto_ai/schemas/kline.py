"""Pydantic schemas for kline (OHLCV) data."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator, field_serializer


class KlineBase(BaseModel):
    """Base kline data without IDs."""

    coin_id: str
    quote_asset: str = Field(
        default="USDT",
        description="Quote asset (USDT, USD, USDC, etc.)",
    )
    interval: str = Field(
        ...,
        description="Timeframe: 5m, 15m, 1h, 4h, 1d, 1w, 1M",
    )
    open_time: datetime = Field(..., description="Kline open time (UTC)")
    close_time: datetime = Field(..., description="Kline close time (UTC)")
    open: float = Field(..., description="Open price")
    high: float = Field(..., description="High price")
    low: float = Field(..., description="Low price")
    close: float = Field(..., description="Close price")
    volume: float = Field(..., description="Base asset volume")
    quote_asset_volume: float = Field(..., description="Quote asset volume")
    number_of_trades: int = Field(..., description="Number of trades")
    taker_buy_base_asset_volume: float = Field(...)
    taker_buy_quote_asset_volume: float = Field(...)


class KlineCreate(KlineBase):
    """Request model for creating a kline."""

    pass


class KlineUpdate(BaseModel):
    """Request model for updating a kline."""

    quote_asset: str | None = None
    interval: str | None = None
    open: float | None = None
    high: float | None = None
    low: float | None = None
    close: float | None = None
    volume: float | None = None
    quote_asset_volume: float | None = None
    number_of_trades: int | None = None
    taker_buy_base_asset_volume: float | None = None
    taker_buy_quote_asset_volume: float | None = None


class KlineResponse(BaseModel):
    """Response model for a kline."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    coin_id: str
    quote_asset: str
    interval: str
    open_time: int = Field(..., description="Kline open time as Unix timestamp (milliseconds)")
    close_time: int = Field(..., description="Kline close time as Unix timestamp (milliseconds)")
    open: float
    high: float
    low: float
    close: float
    volume: float
    quote_asset_volume: float
    number_of_trades: int
    taker_buy_base_asset_volume: float
    taker_buy_quote_asset_volume: float
    active: bool
    created_at: datetime
    updated_at: datetime

    @field_validator("open_time", "close_time", mode="before")
    @classmethod
    def convert_datetime_to_millis(cls, v):
        """Convert datetime to Unix timestamp in milliseconds."""
        if isinstance(v, datetime):
            # Always convert datetime to milliseconds
            return int(v.timestamp() * 1000)
        return v

    @field_serializer("open_time", "close_time", when_used="json")
    def serialize_timestamps(self, v: int) -> int:
        """Ensure timestamps are in milliseconds when serializing to JSON."""
        # If value is < 1e11, it's likely in seconds, so multiply by 1000
        if v < 1e11:
            return v * 1000
        return v


class KlineListResponse(BaseModel):
    """Response model for list of klines."""

    klines: list[KlineResponse]
    count: int
