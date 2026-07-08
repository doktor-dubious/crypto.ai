"""Configuration management using pydantic-settings."""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # Application
    app_name: str = "Gorm AI"
    debug: bool = False

    # Database
    database_url: str = "postgresql+asyncpg://gorm:gorm@localhost:5433/crypto_ai"
    database_echo: bool = False

    # Redis
    redis_url: str = "redis://localhost:6379/0"

    # Celery
    celery_broker_url: str = "redis://localhost:6379/1"
    celery_result_backend: str = "redis://localhost:6379/2"

    # API
    api_v1_prefix: str = "/api/v1"

    # Fine-tuned model
    finetuned_model_path: str = "models/timesfm_finetuned"

    # HuggingFace Hub
    hf_token: str | None = None
    hf_hub_cache: str | None = None

    # Anthropic / Claude
    claude_api: str | None = None

    # CoinGecko (coin categories / metadata). Optional — the public API works
    # without a key, a Demo key just raises the rate limit.
    coingecko_api_key: str | None = None

    # Live kline ingestion — continuously updates coin data for paper/live trading.
    # WebSocket is the push path; the REST mirror is used for gap-fill on reconnect
    # and as a fallback "poll" mode where the WS host is unreachable (e.g. a network
    # that TLS-intercepts stream.binance.com but allows data-api.binance.vision).
    binance_rest_base: str = "https://data-api.binance.vision"
    binance_ws_base: str = "wss://stream.binance.com:9443"
    live_ingest_mode: str = "ws"  # "ws" (push) | "poll" (periodic REST)
    # Comma-separated intervals to keep live. Defaults to the same set the batch
    # importer loads (STANDARD_INTERVALS) so every timeframe the app uses stays
    # current — each interval is its own Binance stream, closing on its own cadence.
    live_ingest_intervals: str = "5m,15m,30m,1h,4h,1d,1w,1M"
    live_ingest_poll_seconds: int = 5  # poll-mode cadence between full sweeps

    # Frontend
    frontend_url: str = "http://localhost:3000"


@lru_cache
def get_settings() -> Settings:
    """Get cached settings instance."""
    return Settings()
